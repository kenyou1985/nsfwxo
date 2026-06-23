/**
 * GPT Image 2 历史记录服务
 * - 元信息存到 nsfwxo_gpt2_history
 * - 图片使用 imageCacheService 的统一缓存（storeImage），
 *   支持大配额、LRU 淘汰和内容去重，不受 localStorage 5MB 限制影响
 */

import { getFavorites, addFavorite, removeFavorite } from './storage';
import { storeImage, resolveImageRef, _ensureSync } from './imageCacheService';

console.log('[GptImage2History] module loaded');

export interface GptImage2Record {
  id: string;
  prompt: string;
  style: string;
  size: string;
  quality: string;
  n: number;
  mode: 'txt2img' | 'edit';
  /** 图片在统一缓存中的 content hash 引用列表 */
  imageRefs: string[];
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

/** 保存记录到 localStorage */
function _saveRecord(record: GptImage2Record, records: GptImage2Record[]): GptImage2Record {
  const existing = records.findIndex((r) => r.id === record.id);
  if (existing >= 0) {
    records[existing] = record;
  } else {
    records.unshift(record);
  }

  if (records.length > MAX_RECORDS) {
    records.splice(MAX_RECORDS);
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (e) {
    console.warn('[GptImage2History] saveRecord failed:', e);
  }

  return record;
}

/** 保存单条记录（不含图片，图片通过 saveGeneratedImages 单独存储） */
export function saveRecord(record: Omit<GptImage2Record, 'id' | 'imageRefs' | 'createdAt'>): GptImage2Record {
  const id = genId();
  const newRecord: GptImage2Record = {
    ...record,
    id,
    imageRefs: [],
    createdAt: Date.now(),
  };
  const records = getRecords();
  return _saveRecord(newRecord, records);
}

/**
 * 从统一缓存读取图片 data URLs。
 * 兼容新格式（imageRefs 哈希引用）和旧格式（img_cache_ 直接存储）。
 */
export async function getCachedImageDataUrls(cacheKey: string, count: number): Promise<string[]> {
  await _ensureSync();
  console.log('[GptImage2History] getCachedImageDataUrls:', { cacheKey, count });
  const results: string[] = [];

  // 尝试从 imageRefs 解析（新格式）
  const records = getRecords();
  const rec = records.find((r) => r.id === cacheKey);
  console.log('[GptImage2History] lookup record by id:', cacheKey, 'found:', !!rec, 'imageRefs:', rec?.imageRefs);

  if (rec && rec.imageRefs && rec.imageRefs.length > 0) {
    for (let i = 0; i < count; i++) {
      const ref = rec.imageRefs[i];
      if (!ref) {
        results.push('');
      } else if (ref.startsWith('FALLBACK:')) {
        // 降级模式：ref 本身是 data URL
        results.push(ref.replace('FALLBACK:', ''));
      } else {
        const dataUrl = resolveImageRef(ref);
        if (dataUrl) {
          results.push(dataUrl);
        } else {
          results.push('');
        }
      }
    }
    return results;
  }

  // 旧格式：直接从 img_cache_ 读取（兼容旧记录）
  for (let i = 0; i < count; i++) {
    try {
      const raw = localStorage.getItem(`img_cache_${cacheKey}_${i}`);
      if (raw) {
        const entry = JSON.parse(raw);
        if (typeof entry === 'object' && entry.dataUrl) {
          results.push(entry.dataUrl);
        } else if (typeof entry === 'string' && entry.startsWith('data:')) {
          results.push(entry);
        } else {
          results.push('');
        }
      } else {
        results.push('');
      }
    } catch {
      results.push('');
    }
  }
  return results;
}

/** 删除单条记录 */
export function deleteRecord(id: string): void {
  const records = getRecords();
  const filtered = records.filter((r) => r.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.warn('[GptImage2History] deleteRecord failed:', e);
  }
}

/** 清除全部记录 */
export function clearAllRecords(): void {
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

/**
 * 存储生成的图片（data URLs）并保存记录。
 * 使用 imageCacheService 的 storeImage 存入统一缓存（支持大配额、LRU 淘汰），
 * 结果通过 imageRefs（content hash 引用）关联到记录。
 */
export async function saveGeneratedImages(
  dataUrls: string[],
  prompt: string,
  style: string,
  size: string,
  quality: string,
  n: number,
  mode: 'txt2img' | 'edit',
): Promise<GptImage2Record> {
  console.log('[GptImage2History] saveGeneratedImages:', { count: dataUrls.length, sampleLen: dataUrls[0]?.length, mode });

  // 将每张图片存入统一缓存，获取 content hash 引用
  // 降级策略：如果统一缓存写入失败（配额超限等），则存储 data URL
  const refs: string[] = [];
  for (let i = 0; i < dataUrls.length; i++) {
    const dataUrl = dataUrls[i];
    if (!dataUrl || !dataUrl.startsWith('data:')) {
      console.warn('[GptImage2History] invalid dataUrl at index', i, dataUrl?.slice(0, 50));
      continue;
    }
    try {
      const ref = await storeImage(dataUrl);
      refs.push(ref);
    } catch (e) {
      console.warn('[GptImage2History] storeImage failed, falling back to direct dataUrl:', e);
      refs.push(`FALLBACK:${dataUrl}`);
    }
  }
  console.log('[GptImage2History] all refs:', refs);
  const newRecord: GptImage2Record = {
    id: genId(),
    prompt,
    style,
    size,
    quality,
    n,
    mode,
    imageRefs: refs,
    createdAt: Date.now(),
  };
  const records = getRecords();
  _saveRecord(newRecord, records);
  console.log('[GptImage2History] record saved:', newRecord.id, 'imageRefs:', newRecord.imageRefs);

  return newRecord;
}