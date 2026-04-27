import { fetchImageAsDataUrl, extractImagesFromZipAsDataUrls } from './runninghub';
import { getStorageQuota } from './storageQuota';

const IMAGE_CACHE_PREFIX = 'img_cache_';
const UNIFIED_CACHE_PREFIX = 'uni_cache_';

/** Fallback constants used until quota is detected. */
const FALLBACK_MAX_CACHE_MB = 100;
const FALLBACK_STORYBOARD_MAX_MB = 500;

interface CacheEntry {
  dataUrl: string;
  cachedAt: number;
  sizeBytes: number;
}

/** Cached limits — populated asynchronously on first use. */
let _maxCacheBytes = FALLBACK_MAX_CACHE_MB * 1024 * 1024;
let _storyboardMaxBytes = FALLBACK_STORYBOARD_MAX_MB * 1024 * 1024;
let _limitsReady = false;

async function ensureLimits(): Promise<void> {
  if (_limitsReady) return;
  try {
    const quota = await getStorageQuota();
    // Storyboard gets the bulk of the budget; generic cache gets a reasonable slice
    _storyboardMaxBytes = Math.floor(quota.totalCacheLimit);
    _maxCacheBytes = Math.min(_maxCacheBytes, Math.floor(quota.totalCacheLimit * 0.5));
    _limitsReady = true;
    console.debug(
      `[Cache] Storage limits ready — storyboard: ${Math.round(_storyboardMaxBytes / 1024 / 1024)}MB, ` +
        `generic: ${Math.round(_maxCacheBytes / 1024 / 1024)}MB`
    );
  } catch {
    // Keep fallback values
  }
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
  await ensureLimits();
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

/**
 * Read cached panel images from the generic img_cache_ store using a composite key.
 * Unlike getCachedImages (which hashes the zipUrl), this accepts an already-computed
 * composite key like `${historyId}_${panelIdx}` and reads img_cache_${hash}_N entries.
 */
async function getCachedPanelImages(key: string, count: number): Promise<string[]> {
  // Compute same hash as getCacheKey does so we read the right entries
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const prefix = `${IMAGE_CACHE_PREFIX}${Math.abs(hash)}_`;

  const results: string[] = [];
  for (let i = 0; i < count; i++) {
    const fullKey = `${prefix}${i}`;
    try {
      const raw = localStorage.getItem(fullKey);
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
  await ensureLimits();
  const totalBytes = images.reduce((sum, url) => sum + (url.length * 2), 0);
  const maxBytes = _maxCacheBytes;

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
  await ensureLimits();
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
  await ensureLimits();
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
        if (getTotalCacheSize() + entry.sizeBytes > _maxCacheBytes) {
          evictLRU(_maxCacheBytes - entry.sizeBytes);
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

export async function loadCachedOrExtractedImages(zipUrl: string, extract: () => Promise<string[]>): Promise<string[]> {
  await ensureLimits();
  const cached = await getCachedImages(zipUrl, 10);
  const cachedImages = cached.filter(Boolean);
  if (cachedImages.length > 0) return cachedImages;

  const extracted = await extract();
  await cacheImages(zipUrl, extracted);
  return extracted;
}

/**
 * Load cached images for a storyboard panel, falling back to zip extraction on cache miss.
 * Mirrors the pattern used by HistoryPage for image history.
 *
 * @param zipUrl      - zip URL to extract from if cache misses
 * @param count       - how many images to try to load
 * @param historyId   - history entry id
 * @param panelIdx    - panel index
 * @returns           - array of data URL images (empty if nothing found)
 */
export async function loadCachedOrExtractPanelImages(
  zipUrl: string | undefined,
  count: number,
  historyId: string,
  panelIdx: number
): Promise<string[]> {
  await ensureLimits();
  // Try unified panel cache first (this is where cacheStoryboardPanelImages writes)
  const cached = getCachedStoryboardPanelImages(historyId, panelIdx);
  if (cached.length > 0) return cached;

  // Cache miss — try zip extraction if we have a zipUrl
  if (!zipUrl) return [];

  try {
    const allImages = await extractImagesFromZipAsDataUrls(zipUrl);
    // Cache the result for future visits
    if (allImages.length > 0) {
      // Write back to both: unified cache (via storeImage) and generic cache (via cacheImages)
      const toCache = allImages.slice(0, count);
      await cacheStoryboardPanelImages(historyId, panelIdx, toCache);
      return toCache;
    }
    return [];
  } catch (err) {
    console.warn('[loadCachedOrExtractPanelImages] zip extraction failed:', err);
    return [];
  }
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

// ─── Task Image Cache (via zip URL) ─────────────────────────────────────────────
// Used by taskManager to persist and restore task images across page refreshes.

export async function getOrFetchTaskImages(zipUrl: string, blobUrls: string[]): Promise<string[]> {
  await ensureLimits();
  if (!zipUrl || blobUrls.length === 0) return blobUrls;
  const cached = await getCachedImages(zipUrl, blobUrls.length);
  const cachedImages = cached.filter(Boolean);
  if (cachedImages.length === blobUrls.length) return cachedImages;

  // Some or all missing — fetch and cache
  const dataUrls: string[] = [];
  for (let i = 0; i < blobUrls.length; i++) {
    if (cached[i] && cached[i].startsWith('data:')) {
      dataUrls.push(cached[i]);
    } else {
      const dataUrl = await fetchImageAsDataUrl(blobUrls[i]);
      dataUrls.push(dataUrl || blobUrls[i]);
    }
  }
  // Cache all successfully fetched data URLs
  const toCache = dataUrls.filter((u) => u.startsWith('data:'));
  if (toCache.length > 0) {
    await cacheImages(zipUrl, toCache);
  }
  return dataUrls;
}

// ─── Unified Image Cache (shared across all features) ──────────────────────────
// Uses content-based hashing so identical images share the same entry regardless of source.

const UNIFIED_CACHE_STORE_KEY = 'uni_img_store_v2'; // v2 format — do NOT change, or existing cache entries become unreadable

interface UnifiedImageEntry {
  dataUrl: string;
  cachedAt: number;
  sizeBytes: number;
  refCount: number;
}

export function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function getUnifiedStore(): Record<string, UnifiedImageEntry> {
  try {
    const raw = localStorage.getItem(UNIFIED_CACHE_STORE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, UnifiedImageEntry>;
  } catch {
    return {};
  }
}

function saveUnifiedStore(store: Record<string, UnifiedImageEntry>): void {
  try {
    localStorage.setItem(UNIFIED_CACHE_STORE_KEY, JSON.stringify(store));
  } catch {}
}

function getUnifiedCacheSize(): number {
  const store = getUnifiedStore();
  return Object.values(store).reduce((sum, e) => sum + e.sizeBytes, 0);
}

function evictUnifiedCache(targetBytes: number): void {
  const store = getUnifiedStore();
  const entries = Object.entries(store)
    .filter(([, e]) => e.refCount <= 0)
    .sort(([, a], [, b]) => a.cachedAt - b.cachedAt);

  let freed = 0;
  for (const [key, entry] of entries) {
    if (getUnifiedCacheSize() - freed <= targetBytes) break;
    freed += entry.sizeBytes;
    delete store[key];
  }
  saveUnifiedStore(store);
}

function computeImageHash(dataUrl: string): string {
  const content = dataUrl.slice(0, 2048);
  return hashString(content);
}

async function ensureUnifiedLimits(): Promise<number> {
  await ensureLimits();
  return _storyboardMaxBytes;
}

/**
 * Store an image in the unified cache. Returns the content hash as reference.
 */
export async function storeImage(dataUrl: string): Promise<string> {
  await ensureLimits();
  const store = getUnifiedStore();
  const key = computeImageHash(dataUrl);
  const now = Date.now();

  if (store[key]) {
    store[key].cachedAt = now;
    store[key].refCount += 1;
  } else {
    const sizeBytes = dataUrl.length * 2;
    const maxBytes = await ensureUnifiedLimits();
    const currentSize = getUnifiedCacheSize();
    if (currentSize + sizeBytes > maxBytes) {
      evictUnifiedCache(maxBytes - sizeBytes);
    }
    store[key] = { dataUrl, cachedAt: now, sizeBytes, refCount: 1 };
  }
  saveUnifiedStore(store);
  return key;
}

/**
 * Resolve a content hash reference back to the actual data URL.
 */
export function resolveImageRef(ref: string): string {
  if (!ref) return ref;
  if (ref.startsWith('data:')) return ref;
  const store = getUnifiedStore();
  return store[ref]?.dataUrl || ref;
}

/**
 * Touch (update cachedAt) for an image so LRU eviction keeps it alive.
 */
function touchImage(ref: string): void {
  if (!ref || ref.startsWith('data:')) return;
  const store = getUnifiedStore();
  if (store[ref]) {
    store[ref].cachedAt = Date.now();
    saveUnifiedStore(store);
  }
}

/**
 * Decrease ref count for an image.
 */
function releaseImage(ref: string): void {
  if (!ref || ref.startsWith('data:')) return;
  const store = getUnifiedStore();
  if (store[ref]) {
    store[ref].refCount = Math.max(0, store[ref].refCount - 1);
    saveUnifiedStore(store);
  }
}

// ─── Storyboard Panel Image Cache (using unified store) ──────────────────────────

const PANEL_IMAGE_CACHE_PREFIX = 'sb_panel_v2_';

interface PanelCacheEntry {
  refs: string[];
  cachedAt: number;
}

function getPanelCacheKey(historyId: string, panelIdx: number): string {
  return `${PANEL_IMAGE_CACHE_PREFIX}${historyId}_${panelIdx}`;
}

export async function cacheStoryboardPanelImages(
  historyId: string,
  panelIdx: number,
  images: string[]
): Promise<void> {
  await ensureLimits();
  if (images.length === 0) return;

  console.debug(`[Cache] caching ${images.length} images for panel ${historyId}_${panelIdx}`);

  const dataUrlImages = await Promise.all(
    images.map((img) => ensureDataUrlInternal(img))
  );

  const oldEntry = getPanelCacheEntry(historyId, panelIdx);
  if (oldEntry) {
    oldEntry.refs.forEach((r) => releaseImage(r));
  }

  const refs = await Promise.all(dataUrlImages.map((img) => storeImage(img)));
  console.debug(`[Cache] stored ${refs.length} refs in unified cache`);

  const cacheKey = getPanelCacheKey(historyId, panelIdx);
  const entry: PanelCacheEntry = { refs, cachedAt: Date.now() };

  try {
    localStorage.setItem(cacheKey, JSON.stringify(entry));
  } catch {
    evictUnifiedCache(entry.refs.reduce((s, r) => {
      const store = getUnifiedStore();
      return s + (store[r]?.sizeBytes || 0);
    }, 0));
    try { localStorage.setItem(cacheKey, JSON.stringify(entry)); } catch {}
  }
}

function getPanelCacheEntry(historyId: string, panelIdx: number): PanelCacheEntry | null {
  const cacheKey = getPanelCacheKey(historyId, panelIdx);
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      return JSON.parse(raw) as PanelCacheEntry;
    }
  } catch {}
  return null;
}

export function getCachedStoryboardPanelImages(historyId: string, panelIdx: number): string[] {
  const cacheKey = getPanelCacheKey(historyId, panelIdx);
  const entry = getPanelCacheEntry(historyId, panelIdx);
  if (!entry || !entry.refs || entry.refs.length === 0) {
    console.debug(`[Cache] miss panel ${cacheKey}`);
    return [];
  }
  console.debug(`[Cache] hit panel ${cacheKey}, ${entry.refs.length} refs`);
  console.debug(`[Cache] refs for ${cacheKey}:`, entry.refs.slice(0, 2));

  entry.refs.forEach((r) => touchImage(r));
  entry.cachedAt = Date.now();
  try { localStorage.setItem(cacheKey, JSON.stringify(entry)); } catch {}

  return entry.refs.map((r) => resolveImageRef(r));
}

export function getAllCachedPanelImages(
  historyId: string,
  panelCount: number
): Record<number, string[]> {
  const result: Record<number, string[]> = {};
  for (let i = 0; i < panelCount; i++) {
    const imgs = getCachedStoryboardPanelImages(historyId, i);
    if (imgs.length > 0) result[i] = imgs;
  }
  console.debug(`[Cache] getAllCachedPanelImages(${historyId}, ${panelCount}) => ${Object.keys(result).length} panels with images`);
  return result;
}

export function deleteCachedStoryboardPanelImages(historyId: string): void {
  for (let i = 0; i < 100; i++) {
    const entry = getPanelCacheEntry(historyId, i);
    if (entry) {
      entry.refs.forEach((r) => releaseImage(r));
    }
    const cacheKey = getPanelCacheKey(historyId, i);
    localStorage.removeItem(cacheKey);
  }
}

async function ensureDataUrlInternal(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  if (url.startsWith('blob:') || url.startsWith('http://') || url.startsWith('https://')) {
    const dataUrl = await fetchImageAsDataUrl(url);
    return dataUrl || url;
  }
  return url;
}

// ─── Export unified cache stats for debugging ───────────────────────────────────

export function getUnifiedCacheStats(): { count: number; sizeMB: number } {
  const store = getUnifiedStore();
  const count = Object.keys(store).length;
  const sizeBytes = Object.values(store).reduce((s, e) => s + e.sizeBytes, 0);
  return { count, sizeMB: sizeBytes / (1024 * 1024) };
}

export function clearUnifiedImageCache(): void {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(UNIFIED_CACHE_STORE_KEY) || key?.startsWith(PANEL_IMAGE_CACHE_PREFIX)) {
      keys.push(key);
    }
  }
  keys.forEach((k) => localStorage.removeItem(k));
}
