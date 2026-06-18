import type { QueuedTask, NodeInfo } from '../types';
import { cacheImages } from './imageCacheService';

export interface HistoryRecord {
  id: string;
  name: string;
  taskId?: string;
  workflowType: 'txt2img' | 'img2img' | 'img2vid';
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
  source?: 'expand' | 'random' | 'smart-storyboard' | 'storyboard' | 'txt2img' | 'img2img' | 'img2vid';
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
  const recordToSave: HistoryRecord = {
    ...record,
    images: [],
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

  const record: HistoryRecord = {
    id: `${task.id}-${Date.now()}`,
    name: generateId(),
    taskId: task.taskId || undefined,
    workflowType: task.workflowType,
    prompt: task.prompt,
    params: {},
    nodeInfoList: task.nodeInfoList,
    workflowIdOverride: task.workflowIdOverride,
    // images intentionally omitted — retrieved from zip URL cache on demand
    images: [],
    zipUrl: task.zipUrl,
    coins: task.coins,
    createdAt: Date.now(),
    source: task.source,
    themeTitle: task.themeTitle,
    panelNumber: task.panelNumber,
  };
  saveRecord(record);
}
