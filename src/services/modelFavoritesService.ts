import type { RunningHubModelEntry, ModelKind } from './runninghubModelsService';

const STORAGE_KEY = 'nsfwxo_model_favorites_v1';

export interface ModelFavorite {
  /** 唯一 id（用 model.id || model.name + kind 派生） */
  id: string;
  /** CHECKPOINT 或 LORA */
  kind: ModelKind;
  /** 模型文件名 */
  name: string;
  /** 自定义名称（用户重命名） */
  customName: string;
  /** 自定义分类 id（用户归类） */
  customCategory: string;
  /** 创建时间 */
  createdAt: number;
  /** 缓存的快照 — picker 关闭后也能展示封面 */
  snapshot: {
    label: string;
    cover?: string;
    description?: string;
    baseModel?: string;
    triggerWords?: string;
    defaultWeight: number;
    tags?: string[];
  };
}

export interface ModelFavoriteCategory {
  id: string;
  label: string;
}

function readAll(): ModelFavorite[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(items: ModelFavorite[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (e) {
    console.warn('[modelFavorites] write failed', e);
  }
}

function makeId(kind: ModelKind, name: string): string {
  return `${kind}:${name}`;
}

export function getModelFavorites(): ModelFavorite[] {
  return readAll();
}

export function isModelFavorited(kind: ModelKind, name: string): boolean {
  const id = makeId(kind, name);
  return readAll().some((f) => f.id === id);
}

export function getModelFavorite(kind: ModelKind, name: string): ModelFavorite | undefined {
  const id = makeId(kind, name);
  return readAll().find((f) => f.id === id);
}

export function addModelFavorite(entry: RunningHubModelEntry, kind: ModelKind, customCategory = '默认'): ModelFavorite {
  const all = readAll();
  const id = makeId(kind, entry.name);
  const existing = all.find((f) => f.id === id);
  if (existing) return existing;
  const fav: ModelFavorite = {
    id,
    kind,
    name: entry.name,
    customName: entry.label || entry.name.replace(/\.safetensors$/i, ''),
    customCategory,
    createdAt: Date.now(),
    snapshot: {
      label: entry.label || entry.name,
      cover: entry.cover,
      description: entry.description,
      baseModel: entry.baseModel,
      triggerWords: entry.triggerWords,
      defaultWeight: entry.defaultWeight,
      tags: entry.tags,
    },
  };
  all.unshift(fav);
  writeAll(all);
  return fav;
}

export function removeModelFavorite(kind: ModelKind, name: string): void {
  const id = makeId(kind, name);
  writeAll(readAll().filter((f) => f.id !== id));
}

export function toggleModelFavorite(entry: RunningHubModelEntry, kind: ModelKind, customCategory?: string): boolean {
  if (isModelFavorited(kind, entry.name)) {
    removeModelFavorite(kind, entry.name);
    return false;
  }
  addModelFavorite(entry, kind, customCategory);
  return true;
}

export function updateModelFavorite(id: string, patch: Partial<Pick<ModelFavorite, 'customName' | 'customCategory'>>): void {
  const all = readAll();
  const idx = all.findIndex((f) => f.id === id);
  if (idx === -1) return;
  all[idx] = { ...all[idx], ...patch };
  writeAll(all);
}

export function getModelFavoriteCategories(): ModelFavoriteCategory[] {
  const cats = new Set<string>();
  for (const f of readAll()) cats.add(f.customCategory || '默认');
  return [{ id: 'all', label: '全部' }, ...Array.from(cats).map((c) => ({ id: c, label: c }))];
}

export function clearAllModelFavorites(): void {
  writeAll([]);
}

/**
 * 订阅收藏变更 — 用于多页面间同步
 * Picker、ModelLibraryPage 都订阅它以实时刷新
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeModelFavorites(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyFavoritesChanged(): void {
  for (const fn of listeners) {
    try { fn(); } catch (e) { console.warn('[modelFavorites] listener error', e); }
  }
}

function writeAllAndNotify(items: ModelFavorite[]): void {
  writeAll(items);
  notifyFavoritesChanged();
}

// 重写所有变更函数以触发通知
export function addModelFavoriteNotify(entry: RunningHubModelEntry, kind: ModelKind, customCategory = '默认'): ModelFavorite {
  const all = readAll();
  const id = makeId(kind, entry.name);
  const existing = all.find((f) => f.id === id);
  if (existing) return existing;
  const fav: ModelFavorite = {
    id,
    kind,
    name: entry.name,
    customName: entry.label || entry.name.replace(/\.safetensors$/i, ''),
    customCategory,
    createdAt: Date.now(),
    snapshot: {
      label: entry.label || entry.name,
      cover: entry.cover,
      description: entry.description,
      baseModel: entry.baseModel,
      triggerWords: entry.triggerWords,
      defaultWeight: entry.defaultWeight,
      tags: entry.tags,
    },
  };
  all.unshift(fav);
  writeAllAndNotify(all);
  return fav;
}

export function removeModelFavoriteNotify(kind: ModelKind, name: string): void {
  const id = makeId(kind, name);
  writeAllAndNotify(readAll().filter((f) => f.id !== id));
}

export function toggleModelFavoriteNotify(entry: RunningHubModelEntry, kind: ModelKind, customCategory?: string): boolean {
  if (isModelFavorited(kind, entry.name)) {
    removeModelFavoriteNotify(kind, entry.name);
    return false;
  }
  addModelFavoriteNotify(entry, kind, customCategory);
  return true;
}

export function updateModelFavoriteNotify(id: string, patch: Partial<Pick<ModelFavorite, 'customName' | 'customCategory'>>): void {
  const all = readAll();
  const idx = all.findIndex((f) => f.id === id);
  if (idx === -1) return;
  all[idx] = { ...all[idx], ...patch };
  writeAllAndNotify(all);
}