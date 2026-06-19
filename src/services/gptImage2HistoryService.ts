/**
 * GPT Image 2 历史记录服务
 * - 将生成的图片缓存到 localStorage（img_cache_ 前缀，与 runninghub 共用缓存机制）
 * - 将记录元信息存到 nsfwxo_gpt2_history
 * - 图片永久以 data URL 形式缓存，不依赖网络 URL
 */

import { getFavorites, addFavorite, removeFavorite } from './storage';

export interface GptImage2Record {
  id: string;
  prompt: string;
  style: string;
  size: string;
  quality: string;
  n: number;
  mode: 'txt2img' | 'edit';
  /** Cache key 前缀，用于读取 img_cache_ 中的图片 */
  cacheKey: string;
  createdAt: number;
}

const STORAGE_KEY = 'nsfwxo_gpt2_history';
const MAX_RECORDS = 100;

/** 生成唯一 ID */
function genId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `gpt2_${dateStr}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 将 data URL 图片缓存到 localStorage */
function cacheImageDataUrls(cacheKey: string, dataUrls: string[]): void {
  for (let i = 0; i < dataUrls.length; i++) {
    const entry = {
      dataUrl: dataUrls[i],
      cachedAt: Date.now(),
      sizeBytes: dataUrls[i].length * 2,
    };
    try {
      localStorage.setItem(`img_cache_${cacheKey}_${i}`, JSON.stringify(entry));
    } catch (e) {
      console.warn('[GptImage2History] cacheImageDataUrls failed:', e);
    }
  }
}

/** 从 localStorage 读取缓存的图片 data URLs */
export function getCachedImageDataUrls(cacheKey: string, count: number): string[] {
  const results: string[] = [];
  for (let i = 0; i < count; i++) {
    try {
      const raw = localStorage.getItem(`img_cache_${cacheKey}_${i}`);
      if (raw) {
        const entry = JSON.parse(raw);
        results.push(entry.dataUrl);
      } else {
        results.push('');
      }
    } catch {
      results.push('');
    }
  }
  return results;
}

/** 读取所有记录 */
export function getRecords(): GptImage2Record[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as GptImage2Record[];
  } catch {
    return [];
  }
}

/** 保存单条记录（附带图片缓存） */
export function saveRecord(record: Omit<GptImage2Record, 'id' | 'cacheKey' | 'createdAt'>): GptImage2Record {
  const id = genId();
  const cacheKey = id;
  const newRecord: GptImage2Record = {
    ...record,
    id,
    cacheKey,
    createdAt: Date.now(),
  };

  const records = getRecords();
  // 避免重复（同一 id）
  const existing = records.findIndex((r) => r.id === id);
  if (existing >= 0) {
    records[existing] = newRecord;
  } else {
    records.unshift(newRecord);
  }

  if (records.length > MAX_RECORDS) {
    // 淘汰最旧的记录并清理其图片缓存
    const evicted = records.splice(MAX_RECORDS);
    for (const r of evicted) {
      for (let i = 0; i < r.n; i++) {
        localStorage.removeItem(`img_cache_${r.cacheKey}_${i}`);
      }
    }
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (e) {
    console.warn('[GptImage2History] saveRecord failed:', e);
  }

  return newRecord;
}

/** 删除单条记录（清理图片缓存） */
export function deleteRecord(id: string): void {
  const records = getRecords();
  const record = records.find((r) => r.id === id);
  if (record) {
    for (let i = 0; i < record.n; i++) {
      localStorage.removeItem(`img_cache_${record.cacheKey}_${i}`);
    }
  }
  const filtered = records.filter((r) => r.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.warn('[GptImage2History] deleteRecord failed:', e);
  }
}

/** 清除全部记录 */
export function clearAllRecords(): void {
  const records = getRecords();
  for (const record of records) {
    for (let i = 0; i < record.n; i++) {
      localStorage.removeItem(`img_cache_${record.cacheKey}_${i}`);
    }
  }
  localStorage.removeItem(STORAGE_KEY);
}

/** 收藏图片 */
export function toggleFavorite(imageUrl: string, prompt?: string): boolean {
  const favs = getFavorites();
  const existing = favs.find((f) => f.imageUrl === imageUrl);
  if (existing) {
    removeFavorite(existing.id);
    return false;
  } else {
    return !!addFavorite({ imageUrl, prompt, source: 'gpt-image-2', r18: false });
  }
}

/** 存储生成的图片（data URLs）并保存记录 */
export async function saveGeneratedImages(
  dataUrls: string[],
  prompt: string,
  style: string,
  size: string,
  quality: string,
  n: number,
  mode: 'txt2img' | 'edit',
): Promise<GptImage2Record> {
  const record = saveRecord({ prompt, style, size, quality, n, mode });
  cacheImageDataUrls(record.cacheKey, dataUrls);
  return record;
}
