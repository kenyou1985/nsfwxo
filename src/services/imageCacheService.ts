import { fetchImageAsDataUrl, extractImagesFromZipAsDataUrls } from './runninghub';
import { getStorageQuota } from './storageQuota';
import { openDB, idbGet, idbGetAll, idbPut, idbDelete, idbClear, idbCount } from './idb';

const IMAGE_CACHE_PREFIX = 'img_cache_';

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

// FNV-1a 64-bit hash of the zipUrl. Returns a hex string.
//
// We previously used a 32-bit djb2 hash with Math.abs() which has two
// failure modes: (1) djb2 in a 32-bit signed range has poor collision
// resistance — birthday collisions appear around 65k inputs, and
// modern zipUrls are short random strings, so the search space is
// small enough that real batches run into collisions; (2) Math.abs on
// INT_MIN (-2147483648) returns the same negative number, so two
// different zipUrls hashing to that exact value collide to a single
// key, with the second zipUrl's images silently overwriting the
// first's. The result was panels in the same storyboard showing
// identical or stale cached images — exactly what the user
// reported. 64-bit FNV-1a makes accidental collisions effectively
// impossible for any realistic batch size.
function hashZipUrl(zipUrl: string): string {
  let hashHigh = 0x811c9dc5 >>> 0;
  let hashLow = 0xcbf29ce4 >>> 0;
  for (let i = 0; i < zipUrl.length; i++) {
    const c = zipUrl.charCodeAt(i);
    hashLow ^= c & 0xff;
    const lowPart = (hashLow * 0x00000193) >>> 0;
    const carryFromLow = Math.floor((hashLow * 0x00000193) / 0x100000000);
    hashLow = lowPart;
    hashHigh = (hashHigh * 0x00000193 + carryFromLow) >>> 0;
    if (i + 1 < zipUrl.length) {
      hashLow ^= (c >>> 8) & 0xff;
      const lp2 = (hashLow * 0x00000193) >>> 0;
      const cf2 = Math.floor((hashLow * 0x00000193) / 0x100000000);
      hashLow = lp2;
      hashHigh = (hashHigh * 0x00000193 + cf2) >>> 0;
    }
  }
  return hashHigh.toString(16).padStart(8, '0') + hashLow.toString(16).padStart(8, '0');
}

// Legacy 32-bit djb2 hash — preserved so we can still read cache
// entries written by older app versions. New writes use hashZipUrl.
function hashZipUrlLegacy(zipUrl: string): number {
  let hash = 0;
  for (let i = 0; i < zipUrl.length; i++) {
    const char = zipUrl.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function getCacheKey(zipUrl: string, index: number): string {
  return `${IMAGE_CACHE_PREFIX}${hashZipUrl(zipUrl)}_${index}`;
}

function getCacheKeyLegacy(zipUrl: string, index: number): string {
  return `${IMAGE_CACHE_PREFIX}${hashZipUrlLegacy(zipUrl)}_${index}`;
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
    freed += entry.sizeBytes;
    localStorage.removeItem(key);
    if (getTotalCacheSize() <= targetBytes) break;
  }
}

export async function getCachedImages(zipUrl: string, count: number): Promise<string[]> {
  await ensureLimits();
  const results: string[] = [];
  for (let i = 0; i < count; i++) {
    // Try the current hash first, then fall back to the legacy djb2
    // key. Older app versions wrote entries under img_cache_<djb2>_<i>;
    // once the FNV-1a hash rolled out those keys became unreadable and
    // every panel would lose its cache. Reading both forms keeps the
    // user's existing cache hits working during the transition.
    const newKey = getCacheKey(zipUrl, i);
    const legacyKey = getCacheKeyLegacy(zipUrl, i);
    try {
      let raw = localStorage.getItem(newKey);
      if (!raw) raw = localStorage.getItem(legacyKey);
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
  // Use FNV-1a 64-bit to match getCacheKey; the legacy djb2 path is
  // read as a fallback so entries written by older versions still
  // resolve. Same hash-and-Math.abs footgun as elsewhere in this file
  // (INT_MIN collision), so the new path can't reuse the legacy hash.
  const fnv = hashZipUrl(key);
  const djb2 = hashZipUrlLegacy(key);
  const newPrefix = `${IMAGE_CACHE_PREFIX}${fnv}_`;
  const legacyPrefix = `${IMAGE_CACHE_PREFIX}${djb2}_`;

  const results: string[] = [];
  for (let i = 0; i < count; i++) {
    const newKey = `${newPrefix}${i}`;
    const legacyKey = `${legacyPrefix}${i}`;
    try {
      let raw = localStorage.getItem(newKey);
      if (!raw) raw = localStorage.getItem(legacyKey);
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
  panelIdx: number,
  panelZipUrlOverride?: string
): Promise<string[]> {
  await ensureLimits();
  // Each panel in a batch may be generated by a separate RunningHub
  // task with its own zipUrl. Older versions of this function took a
  // single zipUrl and used it for every panel, which silently mapped
  // every panel's cache lookup to the same set of img_cache_<hash>_
  // entries — so the rendered storyboard would show whichever panel
  // happened to be processed last for every slot, plus a high rate
  // of djb2 hash collisions on top. Prefer the explicit per-panel
  // override when provided; fall back to the legacy single-zipUrl.
  const effectiveZipUrl = panelZipUrlOverride || zipUrl;

  // Try unified panel cache first (this is where cacheStoryboardPanelImages writes)
  const cached = getCachedStoryboardPanelImages(historyId, panelIdx);
  if (cached.length > 0) return cached;

  // Fallback: also check the generic cache keyed by zipUrl hash. This is
  // where the older extractFinishedTaskImages path wrote its images (via
  // cacheImages), and where images from prior app versions still live.
  // Without this, refresh-after-generation would always miss the cache
  // and try to re-download the (now 404'd) zip on every page load.
  if (effectiveZipUrl) {
    const genericCached = (await getCachedImages(effectiveZipUrl, count)).filter(Boolean);
    if (genericCached.length > 0) {
      console.debug(`[loadCachedOrExtractPanelImages] hit generic cache for ${historyId}#${panelIdx} via zipUrl (${genericCached.length} imgs)`);
      // Write back to the unified panel cache so subsequent loads hit the
      // faster path.
      try { await cacheStoryboardPanelImages(historyId, panelIdx, genericCached); } catch {}
      return genericCached;
    } else {
      console.debug(`[loadCachedOrExtractPanelImages] generic cache miss for ${historyId}#${panelIdx} (zipUrl len=${effectiveZipUrl.length})`);
    }
  } else {
    console.debug(`[loadCachedOrExtractPanelImages] no zipUrl for ${historyId}#${panelIdx}`);
  }

  // Cache miss — try zip extraction if we have a zipUrl
  if (!effectiveZipUrl) return [];

  try {
    const allImages = await extractImagesFromZipAsDataUrls(effectiveZipUrl);
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
// Uses IndexedDB so images are not limited by localStorage's 5MB quota.
// A synchronous in-memory copy is kept for fast resolveImageRef / storeImageSync reads.

const UNIFIED_DB_NAME = 'nsfwxo_unified_img';
const UNIFIED_DB_VERSION = 1;
const UNIFIED_STORE_NAME = 'images';

// In-memory snapshot of the unified cache for synchronous reads.
// Updated whenever IndexedDB is written.
let _memStore: Record<string, UnifiedImageEntry> = {};
let _db: IDBDatabase | null = null;
/** Resolves when the in-memory store is first loaded from IndexedDB. */
let _syncReady: Promise<void> | null = null;

async function getUnifiedDB(): Promise<IDBDatabase> {
  if (_db) return _db;
  _db = await openDB(UNIFIED_DB_NAME, UNIFIED_DB_VERSION, (db) => {
    if (!db.objectStoreNames.contains(UNIFIED_STORE_NAME)) {
      const store = db.createObjectStore(UNIFIED_STORE_NAME, { keyPath: 'key' });
      store.createIndex('cachedAt', 'cachedAt');
      store.createIndex('refCount', 'refCount');
    }
  });
  return _db;
}

interface UnifiedImageEntry {
  key: string;
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

/** Load from IndexedDB into memory. Called once on startup and after each write. */
async function _syncMemStore(): Promise<void> {
  try {
    const db = await getUnifiedDB();
    const all = await idbGetAll(db, UNIFIED_STORE_NAME) as UnifiedImageEntry[];
    _memStore = {};
    for (const entry of all) {
      _memStore[entry.key] = entry;
    }
  } catch (e) {
    console.error('[imageCache] _syncMemStore failed:', e);
  }
}

/** Bootstrap: load IndexedDB into memory on first import. Other modules must call
 *  _ensureSync() before reading _memStore to avoid races on cold start. */
_syncReady = _syncMemStore().catch((e) => {
  console.error('[imageCache] initial _syncMemStore failed:', e);
});

export function getUnifiedStore(): Record<string, UnifiedImageEntry> {
  return _memStore;
}

function _persistToIDB(entry: UnifiedImageEntry): Promise<void> {
  return getUnifiedDB().then((db) => {
    return idbPut(db, UNIFIED_STORE_NAME, entry).catch((e) => console.error('[imageCache] idbPut failed:', e));
  });
}

function _removeFromIDB(key: string): Promise<void> {
  return getUnifiedDB().then((db) => {
    return idbDelete(db, UNIFIED_STORE_NAME, key).catch((e) => console.error('[imageCache] idbDelete failed:', e));
  });
}

function getUnifiedCacheSize(): number {
  return Object.values(_memStore).reduce((sum, e) => sum + e.sizeBytes, 0);
}

async function evictUnifiedCache(targetBytes: number): Promise<void> {
  const entries = Object.entries(_memStore)
    .filter(([, e]) => e.refCount <= 0)
    .sort(([, a], [, b]) => a.cachedAt - b.cachedAt);

  let freed = 0;
  for (const [key, entry] of entries) {
    freed += entry.sizeBytes;
    delete _memStore[key];
    await _removeFromIDB(key);
    if (getUnifiedCacheSize() <= targetBytes) break;
  }
}

export function computeImageHash(dataUrl: string): string {
  return hashString(dataUrl);
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
  const key = computeImageHash(dataUrl);
  const now = Date.now();

  if (_memStore[key]) {
    _memStore[key].cachedAt = now;
    _memStore[key].refCount += 1;
    await _persistToIDB(_memStore[key]);
  } else {
    const sizeBytes = dataUrl.length * 2;
    const maxBytes = await ensureUnifiedLimits();
    const currentSize = getUnifiedCacheSize();
    if (currentSize + sizeBytes > maxBytes) {
      await evictUnifiedCache(maxBytes - sizeBytes);
    }
    _memStore[key] = { key, dataUrl, cachedAt: now, sizeBytes, refCount: 1 };
    await _persistToIDB(_memStore[key]);
  }
  return key;
}

/**
 * Synchronous variant of storeImage. Used by paths (e.g. addFavorite) that
 * must return a ref the caller can read back IMMEDIATELY.
 */
export function storeImageSync(dataUrl: string): string {
  const key = computeImageHash(dataUrl);
  const now = Date.now();
  if (!_memStore[key]) {
    _memStore[key] = { key, dataUrl, cachedAt: now, sizeBytes: dataUrl.length * 2, refCount: 1 };
    _persistToIDB(_memStore[key]).catch(() => {});
  }
  return key;
}

/**
 * Resolve a content hash reference back to the actual data URL.
 */
export async function _ensureSync(): Promise<void> {
  if (_syncReady) await _syncReady;
}

export function resolveImageRef(ref: string): string {
  if (!ref) return '';
  if (ref.startsWith('data:') || ref.startsWith('blob:') || ref.startsWith('http')) return ref;
  if (ref.startsWith('FALLBACK:')) return ref.replace('FALLBACK:', '');
  const entry = _memStore[ref];
  if (!entry) {
    console.warn('[resolveImageRef] ref not found in cache:', ref, '(store has', Object.keys(_memStore).length, 'entries)');
  }
  return entry?.dataUrl || '';
}

/**
 * Touch (update cachedAt) for an image so LRU eviction keeps it alive.
 */
function touchImage(ref: string): void {
  if (!ref || ref.startsWith('data:')) return;
  if (_memStore[ref]) {
    _memStore[ref].cachedAt = Date.now();
    _persistToIDB(_memStore[ref]).catch(() => {});
  }
}

/**
 * Decrease ref count for an image.
 */
function releaseImage(ref: string): void {
  if (!ref || ref.startsWith('data:')) return;
  if (_memStore[ref]) {
    _memStore[ref].refCount = Math.max(0, _memStore[ref].refCount - 1);
    _persistToIDB(_memStore[ref]).catch(() => {});
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
      return s + (_memStore[r]?.sizeBytes || 0);
    }, 0)).catch(() => {});
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

  const resolved = entry.refs.map((r) => resolveImageRef(r)).filter(Boolean);
  if (resolved.length === 0) {
    console.debug(`[Cache] hit panel ${cacheKey} but ${entry.refs.length} refs all unresolved (unified cache miss)`);
    return [];
  }
  console.debug(`[Cache] hit panel ${cacheKey}, ${resolved.length}/${entry.refs.length} refs resolved`);

  entry.refs.forEach((r) => touchImage(r));
  entry.cachedAt = Date.now();
  try { localStorage.setItem(cacheKey, JSON.stringify(entry)); } catch {}

  return resolved;
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
    return dataUrl || '';
  }
  return '';
}

// ─── Export unified cache stats for debugging ───────────────────────────────────

export function getUnifiedCacheStats(): Promise<{ count: number; sizeMB: number }> {
  return _syncMemStore().then(() => {
    const count = Object.keys(_memStore).length;
    const sizeBytes = Object.values(_memStore).reduce((s, e) => s + e.sizeBytes, 0);
    return { count, sizeMB: sizeBytes / (1024 * 1024) };
  });
}

export function clearUnifiedImageCache(): void {
  _memStore = {};
  localStorage.removeItem('uni_img_store_v2'); // legacy key cleanup
  getUnifiedDB().then((db) => {
    idbClear(db, UNIFIED_STORE_NAME).catch(() => {});
  });
}

// ─── Bootstrap: load IndexedDB into memory on first import ─────────────────────
_syncMemStore().catch(console.error);
