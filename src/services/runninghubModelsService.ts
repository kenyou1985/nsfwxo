export interface RunningHubCategory {
  id: string;
  label: string;
}

export interface RunningHubModelEntry {
  id?: string;
  name: string;
  label: string;
  category: string[];
  defaultWeight: number;
  description: string;
  baseModel?: string;
  baseModelSubtype?: string;
  version?: string;
  tags?: string[];
  triggerWords?: string;
  /** 封面 URL（rh-images.xiaoyaoyou.com 的 thumbnailUrl）；为空时回退到模型名占位 */
  cover?: string;
  /** 上传时间 */
  createTime?: string;
  /** 更新日期 */
  updateTime?: string;
  /** 版本名称 */
  versionName?: string;
  /** 下载量 */
  downloads?: number;
  /** 评分 */
  rating?: number;
  /** 作者 */
  owner?: string;
  /** 基础信息 */
  basicInfo?: string;
  /** 模型信息 */
  modelInfo?: string;
}

export interface RunningHubModelDatabase {
  version: number;
  baseModelFilter: string[];
  source: string;
  updatedAt: string;
  fetchedAt?: string;
  lastFetchedAt?: string;
  categories: RunningHubCategory[];
  checkpoints: RunningHubModelEntry[];
  loras: RunningHubModelEntry[];
  unets: RunningHubModelEntry[];
}

let dbPromise: Promise<RunningHubModelDatabase> | null = null;

async function loadDb(): Promise<RunningHubModelDatabase> {
  if (!dbPromise) {
    dbPromise = fetch('/data/runninghubModels.json').then((r) => {
      if (!r.ok) throw new Error(`failed to load model db: ${r.status}`);
      return r.json();
    });
  }
  return dbPromise;
}

let dbCache: RunningHubModelDatabase | null = null;
let idxPromise: Promise<{
  checkpoints: Map<string, RunningHubModelEntry>;
  loras: Map<string, RunningHubModelEntry>;
  unets: Map<string, RunningHubModelEntry>;
  ckptBuckets: Map<string, RunningHubModelEntry[]>;
  loraBuckets: Map<string, RunningHubModelEntry[]>;
  unetBuckets: Map<string, RunningHubModelEntry[]>;
}> | null = null;

async function buildIndices() {
  if (idxPromise) return idxPromise;
  idxPromise = (async () => {
    const d = await loadDb();
    dbCache = d;

    const cpIdx = new Map<string, RunningHubModelEntry>();
    const lrIdx = new Map<string, RunningHubModelEntry>();
    const unetIdx = new Map<string, RunningHubModelEntry>();

    for (const e of d.checkpoints) {
      const k = e.name.toLowerCase();
      if (!cpIdx.has(k)) cpIdx.set(k, e);
    }
    for (const e of d.loras) {
      const k = e.name.toLowerCase();
      if (!lrIdx.has(k)) lrIdx.set(k, e);
    }
    for (const e of d.unets || []) {
      const k = e.name.toLowerCase();
      if (!unetIdx.has(k)) unetIdx.set(k, e);
    }

    const mkBuckets = (list: RunningHubModelEntry[]) => {
      const buckets = new Map<string, RunningHubModelEntry[]>();
      buckets.set('all', list);
      for (const e of list) {
        for (const c of e.category || []) {
          let b = buckets.get(c);
          if (!b) { b = []; buckets.set(c, b); }
          b.push(e);
        }
      }
      return buckets;
    };

    const cpBuckets = mkBuckets(d.checkpoints);
    const lrBuckets = mkBuckets(d.loras);
    const unetBuckets = mkBuckets(d.unets || []);

    return { checkpoints: cpIdx, loras: lrIdx, unets: unetIdx, ckptBuckets: cpBuckets, loraBuckets: lrBuckets, unetBuckets };
  })();
  return idxPromise;
}

export type ModelKind = 'checkpoint' | 'lora' | 'unet';

/** 复用旧的 DB_META shape，但 fields 由运行时 db 填充 */
export const DB_META = {
  source: 'https://www.runninghub.ai/openapi/v2/resource/list',
  updatedAt: '',
  fetchedAt: '',
  lastFetchedAt: '',
  baseModelFilter: [] as string[],
  totalCheckpoints: 0,
  totalLoras: 0,
  totalUnets: 0,
};

export const CATEGORIES: RunningHubCategory[] = [
  { id: 'all', label: '全部' },
  { id: 'rh-pick', label: '推荐' },
  { id: 'realistic', label: '真实' },
  { id: 'anime', label: '二次元' },
  { id: 'character', label: 'IP 角色' },
  { id: 'stylization', label: '风格化' },
  { id: 'helper', label: '辅助' },
  { id: 'concept', label: '概念' },
  { id: 'composition', label: '构图' },
  { id: 'other', label: '其他' },
];

export const MODEL_KIND_META: Record<ModelKind, { label: string; badge: string; badgeClass: string }> = {
  checkpoint: { label: 'Checkpoint', badge: 'CKPT', badgeClass: 'bg-purple-500/85 text-white' },
  lora:       { label: 'LoRA',      badge: 'LoRA', badgeClass: 'bg-blue-500/85 text-white' },
  unet:       { label: 'UNET',     badge: 'UNET', badgeClass: 'bg-green-500/85 text-white' },
};

export type BaseModelFilter = 'all' | 'il-xl' | 'krea2';

export const BASE_MODEL_OPTIONS: { id: BaseModelFilter; label: string; apiValue?: string }[] = [
  { id: 'all',   label: '全部底模' },
  { id: 'il-xl', label: 'IL-XL', apiValue: 'IL-XL' },
  { id: 'krea2', label: 'kea2', apiValue: 'krea2' },
];

export type SortField = 'default' | 'newest' | 'oldest' | 'name';

export const SORT_OPTIONS: { id: SortField; label: string }[] = [
  { id: 'default', label: '默认' },
  { id: 'newest',  label: '最新' },
  { id: 'oldest',  label: '最旧' },
  { id: 'name',    label: '名称' },
];

export async function filterByKindAndCategory(
  kind: ModelKind,
  categoryId: string,
  baseModelFilter: BaseModelFilter = 'all',
): Promise<RunningHubModelEntry[]> {
  const { ckptBuckets, loraBuckets, unetBuckets } = await buildIndices();
  const buckets = kind === 'checkpoint' ? ckptBuckets : kind === 'unet' ? unetBuckets : loraBuckets;
  let list = buckets.get(categoryId || 'all') || [];

  // baseModel filter for UNET (kea2 vs IL-XL)
  if (kind === 'unet' && baseModelFilter !== 'all') {
    const bm = baseModelFilter === 'il-xl' ? 'IL-XL' : 'krea2';
    list = list.filter(e => (e.baseModel || '').toLowerCase().includes(bm.toLowerCase()));
  }

  return list;
}

export async function getAllModels(kind: ModelKind): Promise<RunningHubModelEntry[]> {
  return filterByKindAndCategory(kind, 'all');
}

export async function findModel(kind: ModelKind, name: string): Promise<RunningHubModelEntry | undefined> {
  if (!name) return undefined;
  const { checkpoints, loras, unets } = await buildIndices();
  const map = kind === 'checkpoint' ? checkpoints : kind === 'unet' ? unets : loras;
  return map.get(name.toLowerCase());
}

export function searchModels(list: RunningHubModelEntry[], query: string): RunningHubModelEntry[] {
  if (!query) return list;
  const q = query.toLowerCase();
  // 支持多种筛选格式：
  // - 普通关键词搜索
  // - base:xxx 按底模筛选
  // - tag:xxx 按标签筛选
  // - trigger:xxx 按触发词筛选

  // 检查是否是特殊筛选格式
  if (q.startsWith('base:')) {
    const baseFilter = q.slice(5).trim();
    return list.filter((m) =>
      (m.baseModel || '').toLowerCase().includes(baseFilter) ||
      (m.baseModelSubtype || '').toLowerCase().includes(baseFilter)
    );
  }
  if (q.startsWith('tag:')) {
    const tagFilter = q.slice(4).trim();
    return list.filter((m) =>
      (m.tags || []).some((t) => t.toLowerCase().includes(tagFilter))
    );
  }
  if (q.startsWith('trigger:')) {
    const triggerFilter = q.slice(8).trim();
    return list.filter((m) =>
      (m.triggerWords || '').toLowerCase().includes(triggerFilter)
    );
  }

  // 普通关键词搜索
  return list.filter((m) =>
    m.name.toLowerCase().includes(q) ||
    (m.label || '').toLowerCase().includes(q) ||
    (m.tags || []).some((t) => t.toLowerCase().includes(q)) ||
    (m.triggerWords || '').toLowerCase().includes(q) ||
    (m.description || '').toLowerCase().includes(q) ||
    (m.baseModel || '').toLowerCase().includes(q) ||
    (m.baseModelSubtype || '').toLowerCase().includes(q)
  );
}

export function sortModels(list: RunningHubModelEntry[], field: SortField): RunningHubModelEntry[] {
  const arr = [...list];
  switch (field) {
    case 'newest':
      return arr.sort((a, b) => (b.updateTime || b.createTime || '').localeCompare(a.updateTime || a.createTime || ''));
    case 'oldest':
      return arr.sort((a, b) => (a.updateTime || a.createTime || '').localeCompare(b.updateTime || b.createTime || ''));
    case 'name':
      return arr.sort((a, b) => a.label.localeCompare(b.label));
    default:
      return arr;
  }
}

export function getModelAccent(name: string): { from: string; to: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return {
    from: `hsl(${hue} 70% 55%)`,
    to: `hsl(${(hue + 40) % 360} 70% 45%)`,
  };
}

export function getModelInitial(name: string): string {
  const cleaned = name.replace(/\.safetensors$/i, '').replace(/[-_]+/g, ' ').trim();
  return (cleaned[0] || '?').toUpperCase();
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr.replace(/\./g, '-'));
    if (isNaN(d.getTime())) return dateStr;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return dateStr;
  }
}

export function getDbMeta() {
  if (dbCache) {
    return {
      source: dbCache.source || 'https://www.runninghub.ai/openapi/v2/resource/list',
      updatedAt: dbCache.updatedAt || dbCache.fetchedAt || '',
      fetchedAt: dbCache.fetchedAt || '',
      lastFetchedAt: dbCache.lastFetchedAt || '',
      baseModelFilter: dbCache.baseModelFilter || [],
      totalCheckpoints: dbCache.checkpoints?.length || 0,
      totalLoras: dbCache.loras?.length || 0,
      totalUnets: dbCache.unets?.length || 0,
    };
  }
  return null;
}
