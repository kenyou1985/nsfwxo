import type { QueuedTask, NodeInfo } from '../types';
import { cacheImages } from './imageCacheService';

export interface HistoryRecord {
  id: string;
  name: string;
  taskId?: string;
  workflowType: 'txt2img' | 'img2img' | 'img2vid' | 'multi-ref-img2img' | 'daotai-img' | 'daotai-video';
  prompt: string;
  params: Record<string, unknown>;
  nodeInfoList?: NodeInfo[];
  workflowIdOverride?: string;
  images: string[]; // Data URLs — kept empty to avoid localStorage quota overflow; images retrieved from zip URL via cache
  zipUrl: string | null;
  coins: string | null;
  createdAt: number;
  /** Which UI module produced this record — used to render a source badge
   * (e.g. "智能扩写", "随机抽卡", "剧情分镜") on the history page card.
   * Falls back to workflowType-derived label when missing. */
  source?: 'expand' | 'random' | 'smart-storyboard' | 'storyboard' | 'txt2img' | 'img2img' | 'img2vid' | 'multi-ref-img2img' | 'gpt-image-2' | 'daotai-img' | 'daotai-video';
  /** Storyboard / random theme title. Rendered as a "剧情: xxx" badge
   * alongside the source tag on the history card so the user can identify
   * which story/theme the image belongs to. */
  themeTitle?: string;
  /** 1-based panel number for storyboard tasks. Combined with themeTitle
   * gives a "剧情: xxx · 第N镜" annotation. */
  panelNumber?: number;
}

const STORAGE_KEY = 'nsfwxo_history';
const MAX_RECORDS = 200;

let _migrationDone = false;

/** Strip large data URLs from existing records to free up localStorage quota. */
function migrateExistingRecords(): void {
  if (_migrationDone) return;
  _migrationDone = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const records: HistoryRecord[] = JSON.parse(raw);
    let changed = false;
    for (const r of records) {
      // Clear any embedded data URLs — they should be fetched from zip URL via cache instead
      if (Array.isArray(r.images) && r.images.length > 0) {
        const first = r.images[0];
        if (typeof first === 'string' && first.startsWith('data:')) {
          r.images = [];
          changed = true;
        }
      }
      // 修复 2026-10-19 之前的 bug：saveRecord 强制 images=[]，导致 daotai-img 记录没图。
      // 现在的 saveRecord 已经保留非 data URL 的 images；这里再兜底：daotai 记录 images=[] 但
      // zipUrl 是 /api/daotai/image/media/... 时，把 zipUrl 拆成 images 数组，刷新后即可显示。
      if (
        (r.workflowType === 'daotai-img' || r.workflowType === 'daotai-video') &&
        (!Array.isArray(r.images) || r.images.length === 0) &&
        typeof r.zipUrl === 'string' &&
        r.zipUrl.startsWith('/api/daotai/image/media/')
      ) {
        r.images = [r.zipUrl];
        changed = true;
        console.debug(`[historyService] Backfilled images for daotai record ${r.id} from zipUrl`);
      }
    }
    if (changed) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
      console.debug('[historyService] Migrated existing records — stripped embedded data URLs');
    }
  } catch {
    // ignore
  }
}

// Run migration once when the module is imported
migrateExistingRecords();

function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function generateId(): string {
  const dateStr = formatDate(Date.now());
  const random = Math.random().toString(36).slice(2, 6);
  return `${dateStr}_${random}`;
}

export function createRecord(
  workflowType: 'txt2img' | 'img2img' | 'img2vid',
  prompt: string,
  params: Record<string, unknown>,
  images: string[],
  zipUrl: string | null,
  coins: string | null
): HistoryRecord {
  return {
    id: generateId(),
    name: generateId(),
    workflowType,
    prompt,
    params,
    images,
    zipUrl,
    coins,
    createdAt: Date.now(),
  };
}

export function saveRecord(record: HistoryRecord): void {
  // Strip data URLs from the record — they are retrieved from zip URL via cache on demand.
  // This prevents localStorage QuotaExceededError.
  // 导演台 (daotai) 任务的 images 是直接 URL（/api/daotai/image/media/...），不是 data URL，
  // 必须保留（saveTaskToHistory 已把 imagesToStore 设好），这里只清掉真正的 data URL。
  const _stripped = (record.images || []).filter(
    (u) => typeof u === 'string' && !u.startsWith('data:'),
  );
  const recordToSave: HistoryRecord = {
    ...record,
    images: _stripped,
  };

  const saveWithRetry = (recordsToSave: HistoryRecord[]): boolean => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(recordsToSave));
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        // Evict oldest records until it fits
        if (recordsToSave.length > 1) {
          recordsToSave.splice(1); // Keep the new record, evict all old ones first
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(recordsToSave));
            return true;
          } catch {
            // Still too large even with only 1 record — record itself is the problem
          }
        }
        console.warn('Failed to save history (quota exceeded even after eviction):', e);
      } else {
        console.warn('Failed to save history:', e);
      }
      return false;
    }
  };

  const records = getRecords();
  // If record already exists, update it (don't add duplicate)
  const existingIdx = records.findIndex((r) => r.id === recordToSave.id);
  if (existingIdx >= 0) {
    records[existingIdx] = recordToSave;
  } else {
    records.unshift(recordToSave);
  }

  if (records.length > MAX_RECORDS) {
    records.splice(MAX_RECORDS);
  }

  saveWithRetry(records);
}

export function getRecords(): HistoryRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HistoryRecord[];
  } catch {
    return [];
  }
}

export function deleteRecord(id: string): void {
  const records = getRecords().filter((r) => r.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

/**
 * P3.4 批量删除：一次性从 history 中移除多条记录，避免 N 次 localStorage 写入。
 * 返回实际删除的条目数（用于 toast 反馈）。
 */
export function deleteRecords(ids: string[]): number {
  if (ids.length === 0) return 0;
  const idSet = new Set(ids);
  const before = getRecords();
  const after = before.filter((r) => !idSet.has(r.id));
  if (after.length === before.length) return 0;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(after));
  return before.length - after.length;
}

export function clearAllHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function renameRecord(id: string, newName: string): void {
  const records = getRecords().map((r) =>
    r.id === id ? { ...r, name: newName } : r
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export function saveTaskToHistory(task: QueuedTask): void {
  if (task.status !== 'FINISHED') return;
  const records = getRecords();
  if (task.taskId && records.some((r) => r.taskId === task.taskId)) return;

  const images = task.images || [];

  // Cache images first so they're available even if the record is large.
  // Do NOT store data URL images in the record itself — they are retrieved
  // from the zip URL via cacheImages on demand. This prevents localStorage
  // QuotaExceededError from large data URLs.
  if (images.length > 0 && task.zipUrl) {
    void cacheImages(task.zipUrl, images);
  }

  // 导演台 (daotai) 任务没有 zipUrl —— 后端直接返回 images/thumbs 完整 URL 列表（路径如
  // `/api/daotai/image/media/xxx/yyy.png`），它们不是 data URL，可以直接存在 record.images
  // 里让 HistoryPage 渲染。不挤占 localStorage 配额（这些是路径字符串，不是 base64）。
  const isDaotaiTask = task.workflowType === 'daotai-img' || task.workflowType === 'daotai-video';
  const imagesToStore = isDaotaiTask ? images : [];
  // 导演台任务的 zipUrl 设为第一张图 URL，让 HistoryPage 的 loadImagesForRecord 走 direct CDN 分支
  const zipUrlToStore = isDaotaiTask
    ? (images[0] || task.zipUrl)
    : task.zipUrl;

  const record: HistoryRecord = {
    id: `${task.id}-${Date.now()}`,
    name: generateId(),
    taskId: task.taskId || undefined,
    workflowType: task.workflowType,
    prompt: task.prompt,
    params: {},
    nodeInfoList: task.nodeInfoList,
    workflowIdOverride: task.workflowIdOverride,
    // 导演台任务：保留直接 URL 数组（不是 data URL，体积小）
    // 其他任务：空数组，由 zipUrl 缓存按需加载
    images: imagesToStore,
    zipUrl: zipUrlToStore,
    coins: task.coins,
    createdAt: Date.now(),
    source: task.source,
    themeTitle: task.themeTitle,
    panelNumber: task.panelNumber,
  };
  saveRecord(record);
}
