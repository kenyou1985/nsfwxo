import { fetchImageAsDataUrl } from './runninghub';

const IMAGE_CACHE_PREFIX = 'img_cache_';
const MAX_CACHE_SIZE_MB = 50;

interface CacheEntry {
  dataUrl: string;
  cachedAt: number;
  sizeBytes: number;
}

function getCacheKey(zipUrl: string, index: number): string {
  let hash = 0;
  for (let i = 0; i < zipUrl.length; i++) {
    const char = zipUrl.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `${IMAGE_CACHE_PREFIX}${Math.abs(hash)}_${index}`;
}

function getAllCacheEntries(): Map<string, CacheEntry> {
  const map = new Map<string, CacheEntry>();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(IMAGE_CACHE_PREFIX)) {
      try {
        const entry = JSON.parse(localStorage.getItem(key) || '{}') as CacheEntry;
        if (entry.dataUrl) {
          map.set(key, entry);
        }
      } catch {
        localStorage.removeItem(key);
      }
    }
  }
  return map;
}

function getTotalCacheSize(): number {
  return Array.from(getAllCacheEntries().values()).reduce((sum, e) => sum + e.sizeBytes, 0);
}

function evictLRU(targetBytes: number): void {
  const entries = getAllCacheEntries();
  const sorted = Array.from(entries.entries()).sort((a, b) => a[1].cachedAt - b[1].cachedAt);

  let freed = 0;
  for (const [key, entry] of sorted) {
    if (getTotalCacheSize() - freed <= targetBytes) break;
    freed += entry.sizeBytes;
    localStorage.removeItem(key);
  }
}

export async function getCachedImages(zipUrl: string, count: number): Promise<string[]> {
  const results: string[] = [];
  for (let i = 0; i < count; i++) {
    const key = getCacheKey(zipUrl, i);
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const entry = JSON.parse(raw) as CacheEntry;
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

export async function cacheImages(zipUrl: string, images: string[]): Promise<void> {
  const totalBytes = images.reduce((sum, url) => sum + (url.length * 2), 0);
  const maxBytes = MAX_CACHE_SIZE_MB * 1024 * 1024;

  if (totalBytes > maxBytes) return;

  const currentSize = getTotalCacheSize();
  if (currentSize + totalBytes > maxBytes) {
    evictLRU(maxBytes - currentSize - totalBytes + totalBytes);
  }

  for (let i = 0; i < images.length; i++) {
    const key = getCacheKey(zipUrl, i);
    const entry: CacheEntry = {
      dataUrl: images[i],
      cachedAt: Date.now(),
      sizeBytes: images[i].length * 2,
    };
    try {
      localStorage.setItem(key, JSON.stringify(entry));
    } catch {
      evictLRU(entry.sizeBytes);
      try {
        localStorage.setItem(key, JSON.stringify(entry));
      } catch {
        // Single image too large, skip
      }
    }
  }
}

export async function getOrFetchImage(zipUrl: string, index: number, fetchUrl: string): Promise<string> {
  const cacheKey = getCacheKey(zipUrl, index);
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const entry = JSON.parse(raw) as CacheEntry;
      if (entry.dataUrl) return entry.dataUrl;
    }
  } catch {}

  const dataUrl = await fetchImageAsDataUrl(fetchUrl);
  if (dataUrl) {
    await cacheImages(zipUrl, [dataUrl]);
  }
  return dataUrl || '';
}

export async function refreshCacheFromZip(zipUrl: string, blobUrls: string[]): Promise<string[]> {
  const dataUrls: string[] = [];

  for (let i = 0; i < blobUrls.length; i++) {
    const cacheKey = getCacheKey(zipUrl, i);
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const entry = JSON.parse(raw) as CacheEntry;
        if (entry.dataUrl) {
          dataUrls.push(entry.dataUrl);
          continue;
        }
      }
    } catch {}

    const dataUrl = await fetchImageAsDataUrl(blobUrls[i]);
    if (dataUrl) {
      dataUrls.push(dataUrl);
      const entry: CacheEntry = {
        dataUrl,
        cachedAt: Date.now(),
        sizeBytes: dataUrl.length * 2,
      };
      try {
        const maxBytes = MAX_CACHE_SIZE_MB * 1024 * 1024;
        if (getTotalCacheSize() + entry.sizeBytes > maxBytes) {
          evictLRU(maxBytes - entry.sizeBytes);
        }
        localStorage.setItem(cacheKey, JSON.stringify(entry));
      } catch {
        // skip
      }
    } else {
      dataUrls.push(blobUrls[i]);
    }
  }

  return dataUrls;
}

export function clearImageCache(): void {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(IMAGE_CACHE_PREFIX)) {
      keys.push(key);
    }
  }
  keys.forEach((k) => localStorage.removeItem(k));
}
