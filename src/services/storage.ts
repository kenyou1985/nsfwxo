import {
  cacheStoryboardPanelImages,
  getCachedStoryboardPanelImages,
  getAllCachedPanelImages,
  deleteCachedStoryboardPanelImages,
  resolveImageRef,
  clearUnifiedImageCache,
  getUnifiedStore,
  computeImageHash,
  hashString,
  storeImage,
  storeImageSync,
} from './imageCacheService';

// Re-export for backwards compatibility with code that imports from storage.ts
export {
  cacheStoryboardPanelImages,
  getCachedStoryboardPanelImages,
  getAllCachedPanelImages,
  deleteCachedStoryboardPanelImages,
};

// resolvePanelImages is defined locally below — it's a small wrapper around
// resolveImageRef that strips orphan hash refs and empty strings, then drops
// per-panel entries that have no usable images left.

const STORAGE_KEY = 'rh_api_key';
const YUNWU_KEY = 'yunwu_api_key';
const BACKEND_URL_KEY = 'prompt_backend_url';
const EXPAND_HISTORY_KEY = 'ai_prompt_expand_history';
const RANDOM_HISTORY_KEY = 'ai_prompt_random_history';
const STORYBOARD_HISTORY_KEY = 'ai_prompt_storyboard_history';
const EXPAND_SESSION_KEY = 'ai_prompt_expand_session';
const RANDOM_SESSION_KEY = 'ai_prompt_random_session';
const STORYBOARD_SESSION_KEY = 'ai_prompt_storyboard_session';

export function getApiKey(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setApiKey(key: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, key.trim());
  } catch {
    // storage full or unavailable
  }
}

export function clearApiKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

// ─── Yunwu AI API Key ───────────────────────────────────────────────────────

export function getYunwuKey(): string | null {
  try {
    return localStorage.getItem(YUNWU_KEY);
  } catch {
    return null;
  }
}

export function setYunwuKey(key: string): void {
  try {
    localStorage.setItem(YUNWU_KEY, key.trim());
  } catch {
    // ignore
  }
}

export function clearYunwuKey(): void {
  try {
    localStorage.removeItem(YUNWU_KEY);
  } catch {
    // ignore
  }
}

export function maskYunwuKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

// ─── Default Male Character Setting ─────────────────────────────────────────────────

export const MALE_CHARACTER_OPTIONS = [
  { id: 'black', label: '强壮黑人男性', labelEn: 'Strong Black Male', prompt: 'tall muscular black male with dark skin, thick large black penis with prominent veins' },
  { id: 'white', label: '强壮白人男性', labelEn: 'Strong White Male', prompt: 'tall muscular white male with fair skin, thick large penis with prominent veins' },
  { id: 'asian', label: '强壮亚洲男性', labelEn: 'Strong Asian Male', prompt: 'tall muscular Asian male with tan skin, thick large penis with prominent veins' },
  { id: 'latino', label: '强壮拉丁裔男性', labelEn: 'Strong Latino Male', prompt: 'tall muscular Latino male with olive skin, thick large penis with prominent veins' },
  { id: 'none', label: '不指定男性角色', labelEn: 'No Male Specified', prompt: '' },
] as const;

export type MaleCharacterId = typeof MALE_CHARACTER_OPTIONS[number]['id'];

export function getDefaultMaleCharacter(): MaleCharacterId {
  try {
    const stored = localStorage.getItem('default_male_character');
    if (stored && MALE_CHARACTER_OPTIONS.some((o) => o.id === stored)) {
      return stored as MaleCharacterId;
    }
  } catch {}
  return 'black'; // Default to black male for backwards compatibility
}

export function setDefaultMaleCharacter(id: MaleCharacterId): void {
  try {
    localStorage.setItem('default_male_character', id);
  } catch {}
}

export function getMaleCharacterPrompt(id: MaleCharacterId): string {
  const option = MALE_CHARACTER_OPTIONS.find((o) => o.id === id);
  return option?.prompt || '';
}

// ─── Backend URL ─────────────────────────────────────────────────────────────

const DEFAULT_BACKEND_URL = 'http://localhost:8000';

export function getBackendUrl(): string {
  try {
    return localStorage.getItem(BACKEND_URL_KEY) || DEFAULT_BACKEND_URL;
  } catch {
    return DEFAULT_BACKEND_URL;
  }
}

export function setBackendUrl(url: string): void {
  try {
    localStorage.setItem(BACKEND_URL_KEY, url.trim());
  } catch {
    // ignore
  }
}

export function clearBackendUrl(): void {
  try {
    localStorage.removeItem(BACKEND_URL_KEY);
  } catch {
    // ignore
  }
}

export function getDefaultBackendUrl(): string {
  return DEFAULT_BACKEND_URL;
}

// ─── AI Prompt History ────────────────────────────────────────────────────────

export interface ExpandHistoryItem {
  id: string;
  original: string;
  type: string;
  r18: boolean;
  prompts: string[];
  timestamp: number;
}

export interface RandomHistoryItem {
  id: string;
  type: string;
  r18: boolean;
  theme: string;
  results: {
    prompt: string;
    tags_used: Record<string, string[]>;
    theme_label: string;
  }[];
  timestamp: number;
}

export interface StoryboardHistoryItem {
  id: string;
  plot: string;
  panel_count: number;
  r18: boolean;
  panels: { panel_number: number; scene_description: string; image_prompt: string }[];
  timestamp: number;
  panelImages?: Record<number, string[]>; // panelIdx -> cached data URL images (for direct storage)
  images?: string[]; // flat array of all images for easy display
  /**
   * zipUrl used to extract images — enables cache+zip fallback on restore.
   * Note: each panel may have its own zipUrl in modern code paths; check
   * panelZipUrls first, falling back to this legacy single-zipUrl field.
   */
  zipUrl?: string;
  /**
   * Per-panel zipUrl map. Each panel in a batch may be generated by a
   * separate RunningHub task with its own zipUrl, so a single zipUrl
   * field is not enough to restore the gallery. panelZipUrls[panelIdx]
   * is the authoritative zipUrl for that panel; readers must fall back
   * to `zipUrl` for entries written by older versions of the app.
   */
  panelZipUrls?: Record<number, string>;
  /** How many images were generated per panel — used to re-extract from zip on cache miss. */
  panelImageCounts?: Record<number, number>;
}

const MAX_HISTORY = 200;

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function loadHistory<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory<T>(key: string, items: T[]): void {
  let dataToSave: T[] = items.slice(0, MAX_HISTORY);

  // Strip data URLs from FavoriteItems to prevent localStorage quota overflow.
  if (key === FAVORITES_KEY) {
    dataToSave = (dataToSave as FavoriteItem[]).map((f) => {
      if (!f.imageUrl || !f.imageUrl.startsWith('data:')) return f as FavoriteItem;
      const imageRef = f.imageRef || hashString(f.imageUrl.slice(0, 2048));
      return { ...f, imageRef, imageUrl: '' } as FavoriteItem;
    }) as unknown as T[];
  }

  try {
    localStorage.setItem(key, JSON.stringify(dataToSave));
  } catch (err) {
    console.warn('[saveHistory] localStorage write failed, attempting cleanup:', err);
    try {
      freeStorageSpace();
    } catch {}
    try {
      // Aggressive truncation: keep only 20 most recent items
      const minimal = dataToSave.slice(0, 20);
      localStorage.setItem(key, JSON.stringify(minimal));
      console.warn(`[saveHistory] Saved with aggressive truncation to 20 items`);
    } catch (e2) {
      console.error('[saveHistory] localStorage fully unavailable:', e2);
    }
  }
}

function freeStorageSpace(): void {
  const MB = 1024 * 1024;

  // Always clean favorites first — it is the primary quota offender (contains legacy data: URLs)
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (raw) {
      const bytes = raw.length * 2;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.map((f: Record<string, unknown>) => {
          if (f.imageUrl && typeof f.imageUrl === 'string' && f.imageUrl.startsWith('data:')) {
            const imageRef = (f.imageRef as string) || hashString((f.imageUrl as string).slice(0, 2048));
            return { ...f, imageRef, imageUrl: '' };
          }
          return f;
        });
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(cleaned));
        console.warn(`[freeStorageSpace] Cleaned ${FAVORITES_KEY}, freed ~${Math.round(bytes / MB)}MB`);
      }
    }
  } catch {}

  // Clean oversized history keys
  const historyKeys = [
    'nsfwxo_expand_history', 'nsfwxo_random_history', 'nsfwxo_storyboard_history',
  ];
  for (const k of historyKeys) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const bytes = raw.length * 2;
      if (bytes > 50 * MB) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          // Keep latest 100 items, strip any large blob fields
          const trimmed = parsed.slice(0, 100).map((item: Record<string, unknown>) => {
            const cleaned = { ...item };
            if (cleaned.panels && Array.isArray(cleaned.panels)) {
              cleaned.panels = (cleaned.panels as Record<string, unknown>[]).slice(0, 5);
            }
            return cleaned;
          });
          localStorage.setItem(k, JSON.stringify(trimmed));
          console.warn(`[freeStorageSpace] Trimmed ${k}, freed ~${Math.round(bytes / MB)}MB`);
        }
      }
    } catch {}
  }
}

// Expand history
export function getExpandHistory(): ExpandHistoryItem[] {
  return loadHistory<ExpandHistoryItem>(EXPAND_HISTORY_KEY);
}

export function addExpandHistory(item: Omit<ExpandHistoryItem, 'id' | 'timestamp'>): void {
  const history = getExpandHistory();
  history.unshift({ ...item, id: genId(), timestamp: Date.now() });
  saveHistory(EXPAND_HISTORY_KEY, history);
}

export function removeExpandHistory(id: string): void {
  const history = getExpandHistory().filter((h) => h.id !== id);
  saveHistory(EXPAND_HISTORY_KEY, history);
}

export function clearExpandHistory(): void {
  try { localStorage.removeItem(EXPAND_HISTORY_KEY); } catch {}
}

// Random history
export function getRandomHistory(): RandomHistoryItem[] {
  return loadHistory<RandomHistoryItem>(RANDOM_HISTORY_KEY);
}

export function addRandomHistory(item: Omit<RandomHistoryItem, 'id' | 'timestamp'>): void {
  const history = getRandomHistory();
  history.unshift({ ...item, id: genId(), timestamp: Date.now() });
  saveHistory(RANDOM_HISTORY_KEY, history);
}

export function removeRandomHistory(id: string): void {
  const history = getRandomHistory().filter((h) => h.id !== id);
  saveHistory(RANDOM_HISTORY_KEY, history);
}

export function clearRandomHistory(): void {
  try { localStorage.removeItem(RANDOM_HISTORY_KEY); } catch {}
}

// Storyboard history
export function getStoryboardHistory(): StoryboardHistoryItem[] {
  return loadHistory<StoryboardHistoryItem>(STORYBOARD_HISTORY_KEY);
}

export function addStoryboardHistory(item: Omit<StoryboardHistoryItem, 'id' | 'timestamp'>): string {
  const history = getStoryboardHistory();
  const id = genId();
  history.unshift({ ...item, id, timestamp: Date.now() });
  saveHistory(STORYBOARD_HISTORY_KEY, history);
  return id;
}

export function removeStoryboardHistory(id: string): void {
  const history = getStoryboardHistory().filter((h) => h.id !== id);
  saveHistory(STORYBOARD_HISTORY_KEY, history);
  deleteCachedStoryboardPanelImages(id);
}

export function updateStoryboardHistoryImages(
  id: string,
  panelImages: Record<number, string[]>,
  zipUrl?: string,
  panelImageCounts?: Record<number, number>
): void {
  const history = getStoryboardHistory();
  const index = history.findIndex((h) => h.id === id);
  if (index !== -1) {
    // Persist the FULL data: URLs back into panelImages (sanitized of
    // any orphan hash refs from older broken migrations) so the
    // storyboard can render thumbnails directly via <img src=...>
    // without depending on the unified image cache. The cache can be
    // evicted at any time (quota pressure, dev-tools clear, multi-tab
    // race conditions) — and historically the cache-miss path fell
    // through to a 404 zip download, leaving the user with broken
    // thumbnails. Storing data: URLs inline trades localStorage space
    // for resilience: the history list is bounded (30 entries via
    // migration trim) and each entry's per-panel image count is bounded
    // (4 by default for storyboards), so worst-case usage is
    // 30 entries × 4 imgs × ~600KB = ~70MB which is over the typical
    // 5-10MB localStorage quota. We rely on the migration's trim and
    // the per-panel cap below to keep this in check.
    const PER_PANEL_CAP = 4;
    const normalizedPanelImages: Record<number, string[]> = {};
    // Track which panel indices just received new images so we can map
    // the supplied zipUrl to those specific panels instead of clobbering
    // the zipUrl of unrelated panels. Each panel's images are produced
    // by a separate RunningHub task with its own zipUrl, so merging
    // zipUrls into a single field per entry was actively destroying the
    // cross-reference that the cache fallback depends on.
    const updatedPanelIdxs: number[] = [];
    for (const [panelIdx, imgs] of Object.entries(panelImages)) {
      const idx = Number(panelIdx);
      updatedPanelIdxs.push(idx);
      const limited = imgs.slice(0, PER_PANEL_CAP);
      const cleaned = limited.map((img) => {
        if (!img) return img;
        // Keep data:/blob:/http: as-is — valid <img> sources.
        if (img.startsWith('data:') || img.startsWith('blob:') || img.startsWith('http')) return img;
        // Drop orphan hash refs from older broken migrations.
        return '';
      });
      normalizedPanelImages[idx] = cleaned;
    }

    // Merge the existing panelZipUrls map with the new zipUrl for the
    // panels that just received images. Existing entries for other
    // panels are preserved verbatim — we never drop a panel's zipUrl
    // here, only add or update.
    const existingPanelZipUrls = history[index].panelZipUrls || {};
    const mergedPanelZipUrls: Record<number, string> = { ...existingPanelZipUrls };
    if (zipUrl !== undefined) {
      for (const idx of updatedPanelIdxs) {
        mergedPanelZipUrls[idx] = zipUrl;
      }
    }

    // Preserve the legacy single zipUrl field for entries that already
    // had it set, otherwise default to the most recent zipUrl so
    // older code paths that only know about entry.zipUrl still work.
    const legacyZipUrl = zipUrl ?? history[index].zipUrl;

    history[index] = {
      ...history[index],
      // Merge with existing panelImages rather than overwriting, so a
      // newly-arrived task only updates its own panel — adjacent panels
      // that have already been written keep their data: URLs.
      panelImages: { ...(history[index].panelImages || {}), ...normalizedPanelImages },
      // Flatten for thumbnail preview. resolvePanelImages() and the
      // StoryboardPanelCard rendering path both filter out empty
      // strings, so this works regardless of whether some entries
      // are empty.
      images: Object.values({ ...(history[index].panelImages || {}), ...normalizedPanelImages }).flat().slice(0, 12),
      panelZipUrls: mergedPanelZipUrls,
      ...(legacyZipUrl !== undefined ? { zipUrl: legacyZipUrl } : {}),
      ...(panelImageCounts !== undefined ? { panelImageCounts } : {}),
    };
    saveHistory(STORYBOARD_HISTORY_KEY, history);
  }
}

/**
 * Resolve panel images from a history record, converting hash refs back to data URLs.
 * Uses the unified image cache for resolution. Returns an empty array on cache miss.
 */
export function resolvePanelImages(panelImages: Record<number, string[]>): Record<number, string[]> {
  if (!panelImages) return {};
  const resolved: Record<number, string[]> = {};
  for (const [idx, refs] of Object.entries(panelImages)) {
    const images = refs.map((ref) => resolveImageRef(ref)).filter(Boolean);
    if (images.length > 0) resolved[Number(idx)] = images;
  }
  return resolved;
}

export function clearStoryboardHistory(): void {
  try { localStorage.removeItem(STORYBOARD_HISTORY_KEY); } catch {}
  // Clear all cached panel images using the unified cache
  clearUnifiedImageCache();
}

// ─── Storyboard Panel Image Cache (re-exported from unified cache) ─────────────────

// All storyboard panel image caching now uses the unified image cache in imageCacheService.ts.
// This eliminates duplicate storage and ensures identical images share the same entry.

// ─── Favorites ───────────────────────────────────────────────────────────────────
//
// IMPORTANT: Favorites store content hash references (`imageRef`) instead of full
// data URLs to avoid exhausting localStorage quota (typically 5–10MB).
// A single base64 data URL can be 500KB–2MB, so storing URLs directly allowed
// only ~5–20 favorites before quota overflow.
// By storing content hashes (~20 bytes each) that reference the unified image
// cache, we can store thousands of favorites in the same space.
// Images are resolved at read-time via `resolveImageRef()` from imageCacheService.

export interface FavoriteItem {
  id: string;
  /** Reference to the image source.
   * - data: URLs → stored directly (short, inline, no cache needed)
   * - blob: URLs → stored directly (valid for session lifetime)
   * - http: URLs → stored directly (valid for session lifetime)
   * - hash strings (36 chars) → looked up in unified cache
   * Consumers use resolveFavoriteImageRef() to get the actual display URL. */
  imageRef?: string;
  /** Always empty in storage (avoids quota overflow). Resolved at read-time. */
  imageUrl?: string;
  prompt?: string;
  source: 'expand' | 'random' | 'storyboard' | 'batch' | 'history';
  sourceId?: string;
  tags?: Record<string, string[]>;
  r18: boolean;
  timestamp: number;
}

const FAVORITES_KEY = 'nsfwxo_favorites';

export function getFavorites(): FavoriteItem[] {
  const items = loadHistory<FavoriteItem>(FAVORITES_KEY);
  // Resolve imageRef to actual display URL for each item.
  return items.map((item) => {
    if (!item.imageRef) return { ...item, imageUrl: item.imageUrl ?? '' };
    // If the ref is itself a data:/blob:/http: URL (legacy or session
    // references), pass it through verbatim.
    if (item.imageRef.startsWith('data:') || item.imageRef.startsWith('blob:') || item.imageRef.startsWith('http')) {
      return { ...item, imageUrl: item.imageRef };
    }
    // Try unified cache (for hash-based references written by the new
    // addFavorite path). On miss, return an empty string so callers can
    // show a "missing image" placeholder rather than a broken src.
    const fromCache = resolveImageRef(item.imageRef);
    return { ...item, imageUrl: fromCache ?? '' };
  });
}

export function addFavorite(item: Omit<FavoriteItem, 'id' | 'timestamp'>): boolean {
  const favorites = getFavorites();
  const imageUrl = item.imageUrl ?? '';
  if (!imageUrl) return false;

  // Hash-ref strategy:
  // - data: URLs (full image data inline) MUST be offloaded to the unified
  //   image cache so we only store a small hash ref in the favorites list.
  //   Storing raw data: URLs here would blow past the localStorage quota
  //   after just a handful of favorites (~1MB per data URL).
  // - blob:/http: URLs are session-scoped references and resolve at read
  //   time via getFavorites() → resolveImageRef or direct passthrough.
  let refForStorage: string;
  let dataUrlToCache: string | null = null;
  if (imageUrl.startsWith('data:')) {
    dataUrlToCache = imageUrl;
    // Compute the same hash storeImage() will produce, and write the image
    // into the unified cache SYNCHRONOUSLY so getFavorites() can resolve
    // the ref on the very next read. Without the sync write, the async
    // storeImage() takes a tick (longer on first call when ensureLimits()
    // awaits the quota API), and the favorites tab renders with an empty
    // imageUrl → broken <img src="">. With this write the ref is hot by
    // the time we return.
    refForStorage = storeImageSync(imageUrl);
  } else {
    // blob:/http: keep the URL as-is — it will resolve at read time.
    refForStorage = imageUrl;
  }

  // One-time cleanup of legacy entries: previous versions of addFavorite
  // stored the full data: URL inside imageRef, which silently ate tens of
  // megabytes of localStorage quota. Strip those now so the new write
  // has room to land and so the History page can render them properly.
  const migrated = favorites.map((f) => {
    if (f.imageRef && f.imageRef.startsWith('data:')) {
      return { ...f, imageRef: hashString(f.imageRef.slice(0, 2048)) };
    }
    return f;
  });

  if (migrated.some((f) => f.imageRef === refForStorage)) return false;

  const newItemId = genId();
  const newItem: FavoriteItem = {
    ...item,
    id: newItemId,
    timestamp: Date.now(),
    imageRef: refForStorage,
    // imageUrl intentionally omitted — resolved at read-time via getFavorites()
    imageUrl: undefined,
  };
  migrated.unshift(newItem);
  saveHistory(FAVORITES_KEY, migrated);
  // Fire-and-forget the unified-store write. The provisional hash ref
  // already dedupes correctly; once storeImage resolves we swap the real
  // ref in. Failures are logged and the entry remains usable via the
  // provisional ref (resolveImageRef will miss → empty imageUrl but the
  // heart icon and metadata still display).
  if (dataUrlToCache !== null) {
    const captured = newItemId;
    storeImage(dataUrlToCache).then((ref) => {
      const stored = getFavorites();
      const idx = stored.findIndex((f) => f.id === captured);
      if (idx === -1) return;
      const updated = [...stored];
      updated[idx] = { ...updated[idx], imageRef: ref };
      try { saveHistory(FAVORITES_KEY, updated); } catch {}
    }).catch((err) => {
      console.warn('[addFavorite] storeImage failed, keeping provisional ref:', err);
    });
  }
  return true;
}

export function removeFavorite(id: string): void {
  const favorites = getFavorites().filter((f) => f.id !== id);
  saveHistory(FAVORITES_KEY, favorites);
}

/**
 * Check if an image URL (data URL, blob URL, or http URL) is favorited.
 * Supports both the new hash-based format and legacy data URL format.
 */
export function isFavorited(imageUrl: string): boolean {
  if (!imageUrl) return false;
  return getFavorites().some((f) => f.imageRef === imageUrl || f.imageUrl === imageUrl);
}

export function clearFavorites(): void {
  try { localStorage.removeItem(FAVORITES_KEY); } catch {}
}

/**
 * One-time migration: strips data URLs from legacy favorites/storyboard history
 * that predate the hash-ref migration. Can be called on app startup.
 * Returns the number of items cleaned.
 */
export function migrateLegacyStorageData(): { favoritesCleaned: number; storyboardsCleaned: number } {
  let favoritesCleaned = 0;
  let storyboardsCleaned = 0;

  try {
    // Migrate favorites: remove imageUrl field, keep imageRef
    const rawFavs = localStorage.getItem(FAVORITES_KEY);
    if (rawFavs) {
      const bytes = rawFavs.length * 2;
      const favs = JSON.parse(rawFavs) as FavoriteItem[];

      // Always strip data: URLs. Also trim to 50 items if storage exceeds 5MB
      // (avoids quota overflow on subsequent saves when legacy data is still present)
      let needsSave = false;
      const cleaned = favs.map((f) => {
        const cleaned: FavoriteItem = { ...f };
        if (cleaned.imageUrl && cleaned.imageUrl.startsWith('data:')) {
          if (!cleaned.imageRef) {
            cleaned.imageRef = hashString(cleaned.imageUrl.slice(0, 2048));
          }
          cleaned.imageUrl = '';
          favoritesCleaned++;
          needsSave = true;
        }
        // Legacy: previous addFavorite versions stored the full data: URL
        // inside imageRef instead of a small hash. That silently ate tens
        // of megabytes of localStorage quota. Replace it with a hash
        // derived from the content so the unified cache (or any future
        // storeImage call) can resolve it.
        if (cleaned.imageRef && typeof cleaned.imageRef === 'string' && cleaned.imageRef.startsWith('data:')) {
          cleaned.imageRef = hashString(cleaned.imageRef.slice(0, 2048));
          favoritesCleaned++;
          needsSave = true;
        }
        return cleaned;
      });

      const shouldTrim = bytes > 5 * 1024 * 1024 && cleaned.length > 50;
      if (shouldTrim) {
        // Keep 50 most recent, all data: URLs already stripped above
        cleaned.splice(50);
        needsSave = true;
        console.warn(`[migrateLegacyStorageData] trimmed favorites from ${favs.length} to 50 items (size was ${Math.round(bytes / 1024 / 1024)}MB)`);
      }

      if (needsSave) {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(cleaned));
        console.log(`[migrateLegacyStorageData] cleaned ${favoritesCleaned} legacy favorites, trimmed: ${shouldTrim}`);
      }
    }

    // Migrate storyboard history: panelImages is allowed to hold full
    // data: URLs (used directly as <img src=...> at render time). We
    // historically attempted to convert them to short hash refs here,
    // but that broke image display: the hash function used in migration
    // (hashString, content-derived but lossy) is incompatible with the
    // hash the unified cache uses (computeImageHash, on full bytes), so
    // the migrated refs became orphans — resolveImageRef returned ''
    // for every panel and users saw empty placeholders after refresh.
    //
    // Keep data: URLs inline. The runtime path can still cache them
    // into the unified store via storeImage on the next render, which
    // is the right place to do it (it has the full payload).
    //
    // We do still need to guard against a previous (broken) version of
    // this migration that already rewrote panelImages into orphan hash
    // refs. Detect those entries (short strings that don't look like
    // a URL) and clear them, so the runtime cache fallback (generic
    // img_cache_${zipUrlHash}_N) can re-populate the panel on the
    // next load.
    const rawSb = localStorage.getItem(STORYBOARD_HISTORY_KEY);
    if (rawSb) {
      const bytes = rawSb.length * 2;
      const history = JSON.parse(rawSb) as StoryboardHistoryItem[];
      let modified = false;
      const migrated = history.map((h) => {
        if (h.panelImages) {
          for (const [idx, imgs] of Object.entries(h.panelImages)) {
            const cleaned = imgs.map((img) => {
              if (!img) return img;
              // Keep data:/blob:/http: URLs as-is — these are valid <img> sources.
              if (img.startsWith('data:') || img.startsWith('blob:') || img.startsWith('http')) return img;
              // Anything else is a stale orphan hash from the broken
              // migration. Drop it so the generic cache fallback can
              // repopulate the panel from img_cache_${zipUrlHash}_N.
              storyboardsCleaned++;
              modified = true;
              return '';
            });
            if (JSON.stringify(cleaned) !== JSON.stringify(imgs)) {
              (h.panelImages as Record<number, string[]>)[Number(idx)] = cleaned;
            }
          }
        }
        return h;
      });

      // Trim storyboard history if > 5MB
      if (bytes > 5 * 1024 * 1024 && migrated.length > 30) {
        migrated.splice(30);
        modified = true;
        console.warn(`[migrateLegacyStorageData] trimmed storyboard history from ${history.length} to 30 items`);
      }

      if (modified) {
        localStorage.setItem(STORYBOARD_HISTORY_KEY, JSON.stringify(migrated));
        console.log(`[migrateLegacyStorageData] cleared ${storyboardsCleaned} orphan hash refs from storyboard panel entries`);
      }
    }
  } catch (e) {
    console.warn('[migrateLegacyStorageData] failed:', e);
  }

  return { favoritesCleaned, storyboardsCleaned };
}

// ─── Active Session Storage (persists current expand/random/storyboard state across page switches) ───

export interface ExpandSession {
  input: string;
  type: 'image' | 'video';
  count: number;
  results: { id: string; original: string; prompt: string; r18: boolean }[];
  outputPrompts: string[];
  selectedOutputIdx: number;
  outputText: string;
}

export interface RandomSession {
  type: 'image' | 'video';
  count: number;
  theme: string;
  results: {
    theme_label: string;
    theme: string;
    tags_used: Record<string, string[]>;
    prompt: string;
  }[];
  expandedIdx: number | null;
}

export interface GeneratedCard {
  id: string; // unique key for this card
  themeId: number;
  themeTitle: string;
  themeR18Level: string;
  outlineArc: string;
  outlineScenes: string[];
  panels: { panel_number: number; scene_description: string; image_prompt: string }[];
  expandedPanel: number | null;
  generatingOutline: boolean;
  error: string | null;
}

export interface StoryboardSession {
  plot: string;
  panelCount: number;
  panels: { panel_number: number; scene_description: string; image_prompt: string }[];
  expandedPanel: number | null;
  themeId?: number;
  themeTitle?: string;
  outlineArc?: string;
  outlineScenes?: string[];
  historyId?: string; // reference to storyboard history entry for image cache lookup
}

function loadSession<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function saveSession(key: string, data: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(data));
  } catch {}
}

function clearSession(key: string): void {
  try { sessionStorage.removeItem(key); } catch {}
}

// Expand session
export function getExpandSession(): ExpandSession | null {
  return loadSession<ExpandSession>(EXPAND_SESSION_KEY);
}

export function saveExpandSession(session: ExpandSession): void {
  saveSession(EXPAND_SESSION_KEY, session);
}

export function clearExpandSession(): void {
  clearSession(EXPAND_SESSION_KEY);
}

// Random session
export function getRandomSession(): RandomSession | null {
  return loadSession<RandomSession>(RANDOM_SESSION_KEY);
}

export function saveRandomSession(session: RandomSession): void {
  saveSession(RANDOM_SESSION_KEY, session);
}

export function clearRandomSession(): void {
  clearSession(RANDOM_SESSION_KEY);
}

// Storyboard session
export function getStoryboardSession(): StoryboardSession | null {
  return loadSession<StoryboardSession>(STORYBOARD_SESSION_KEY);
}

export function saveStoryboardSession(session: StoryboardSession): void {
  saveSession(STORYBOARD_SESSION_KEY, session);
}

export function clearStoryboardSession(): void {
  clearSession(STORYBOARD_SESSION_KEY);
}

