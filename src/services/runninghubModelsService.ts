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
  tags?: string[];
  triggerWords?: string;
  /** 封面 URL（rh-images.xiaoyaoyou.com 的 thumbnailUrl）；为空时回退到模型名占位 */
  cover?: string;
}

export interface RunningHubModelDatabase {
  version: number;
  baseModelFilter: string;
  source: string;
  updatedAt: string;
  fetchedAt?: string;
  categories: RunningHubCategory[];
  checkpoints: RunningHubModelEntry[];
  loras: RunningHubModelEntry[];
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
  ckptBuckets: Map<string, RunningHubModelEntry[]>;
  loraBuckets: Map<string, RunningHubModelEntry[]>;
}> | null = null;

async function buildIndices() {
  if (idxPromise) return idxPromise;
  idxPromise = (async () => {
    const d = await loadDb();
    const cpIdx = new Map<string, RunningHubModelEntry>();
    const lrIdx = new Map<string, RunningHubModelEntry>();
    for (const e of d.checkpoints) {
      const k = e.name.toLowerCase();
      if (!cpIdx.has(k)) cpIdx.set(k, e);
    }
    for (const e of d.loras) {
      const k = e.name.toLowerCase();
      if (!lrIdx.has(k)) lrIdx.set(k, e);
    }
    const cpBuckets = new Map<string, RunningHubModelEntry[]>();
    cpBuckets.set('all', d.checkpoints);
    for (const e of d.checkpoints) {
      for (const c of e.category) {
        let b = cpBuckets.get(c);
        if (!b) {
          b = [];
          cpBuckets.set(c, b);
        }
        b.push(e);
      }
    }
    const lrBuckets = new Map<string, RunningHubModelEntry[]>();
    lrBuckets.set('all', d.loras);
    for (const e of d.loras) {
      for (const c of e.category) {
        let b = lrBuckets.get(c);
        if (!b) {
          b = [];
          lrBuckets.set(c, b);
        }
        b.push(e);
      }
    }
    return { checkpoints: cpIdx, loras: lrIdx, ckptBuckets: cpBuckets, loraBuckets: lrBuckets };
  })();
  return idxPromise;
}

export const DB_META = {
  source: 'https://www.runninghub.cn/openapi/v2/resource/list',
  updatedAt: '2026-06-27',
  baseModelFilter: 'IL-XL',
  totalCheckpoints: 630,
  totalLoras: 4386,
  fetchedAt: new Date().toISOString().slice(0, 10),
};

/** 加载 CATEGORIES（categories 字段很小，可以先写死或从 db 取） */
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

export type ModelKind = 'checkpoint' | 'lora';

export async function filterByKindAndCategory(kind: ModelKind, categoryId: string): Promise<RunningHubModelEntry[]> {
  const { ckptBuckets, loraBuckets } = await buildIndices();
  const buckets = kind === 'checkpoint' ? ckptBuckets : loraBuckets;
  return buckets.get(categoryId || 'all') || [];
}

export async function getAllModels(kind: ModelKind): Promise<RunningHubModelEntry[]> {
  return filterByKindAndCategory(kind, 'all');
}

export async function findModel(kind: ModelKind, name: string): Promise<RunningHubModelEntry | undefined> {
  if (!name) return undefined;
  const { checkpoints, loras } = await buildIndices();
  return (kind === 'checkpoint' ? checkpoints : loras).get(name.toLowerCase());
}

export function searchModels(list: RunningHubModelEntry[], query: string): RunningHubModelEntry[] {
  if (!query) return list;
  const q = query.toLowerCase();
  return list.filter((m) =>
    m.name.toLowerCase().includes(q) ||
    (m.label || '').toLowerCase().includes(q) ||
    (m.tags || []).some((t) => t.toLowerCase().includes(q)) ||
    (m.triggerWords || '').toLowerCase().includes(q)
  );
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