import {
  cacheStoryboardPanelImages,
  getCachedStoryboardPanelImages,
  getAllCachedPanelImages,
  deleteCachedStoryboardPanelImages,
  resolveImageRef,
  clearUnifiedImageCache,
  getUnifiedStore,
  hashString,
} from './imageCacheService';

// Re-export for backwards compatibility with code that imports from storage.ts
export {
  cacheStoryboardPanelImages,
  getCachedStoryboardPanelImages,
  getAllCachedPanelImages,
  deleteCachedStoryboardPanelImages,
};

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
  /** zipUrl used to extract images — enables cache+zip fallback on restore. */
  zipUrl?: string;
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
    // Store content hash references instead of full data URLs to avoid localStorage
    // quota overflow. Images are already stored in the unified cache via
    // cacheStoryboardPanelImages (called separately in the same code path).
    const normalizedPanelImages: Record<number, string[]> = {};
    for (const [panelIdx, imgs] of Object.entries(panelImages)) {
      const refs = imgs.map((img) => {
        // If it's already a hash ref (short alphanumeric string), use it directly.
        // Otherwise compute the hash so we can look it up in the unified cache.
        if (img && !img.startsWith('data:') && !img.startsWith('blob:') && !img.startsWith('http')) {
          return img;
        }
        return hashString(img.slice(0, 2048));
      });
      normalizedPanelImages[Number(panelIdx)] = refs;
    }
    history[index] = {
      ...history[index],
      // Store hash refs so the history entry stays small (<5KB per entry)
      panelImages: normalizedPanelImages,
      // Resolve the first 12 images for thumbnail preview (non-blocking, uses sync cache)
      images: Object.values(normalizedPanelImages).flat().slice(0, 12).map((ref) => resolveImageRef(ref)),
      ...(zipUrl !== undefined ? { zipUrl } : {}),
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
    // Try unified cache first (for hash-based references)
    const fromCache = resolveImageRef(item.imageRef);
    if (fromCache) return { ...item, imageUrl: fromCache };
    // Direct URL reference — return as-is (works for data:, blob:, http: URLs)
    return { ...item, imageUrl: item.imageRef };
  });
}

export function addFavorite(item: Omit<FavoriteItem, 'id' | 'timestamp'>): boolean {
  const favorites = getFavorites();
  const imageUrl = item.imageUrl ?? '';
  if (!imageUrl) return false;

  // Store the URL directly as imageRef. No additional storage used.
  // - data: URLs are stored inline (~1MB each in localStorage is OK if few items)
  // - blob/http URLs are session references
  // Resolution happens at read-time in getFavorites().
  if (favorites.some((f) => f.imageRef === imageUrl)) return false;

  const newItem: FavoriteItem = {
    ...item,
    id: genId(),
    timestamp: Date.now(),
    imageRef: imageUrl,
    // imageUrl intentionally omitted — resolved at read-time via getFavorites()
    imageUrl: undefined,
  };
  favorites.unshift(newItem);
  saveHistory(FAVORITES_KEY, favorites);
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

    // Migrate storyboard history: resolve and re-store panelImages as hash refs
    const rawSb = localStorage.getItem(STORYBOARD_HISTORY_KEY);
    if (rawSb) {
      const bytes = rawSb.length * 2;
      const history = JSON.parse(rawSb) as StoryboardHistoryItem[];
      let modified = false;
      const migrated = history.map((h) => {
        if (h.panelImages) {
          for (const [idx, imgs] of Object.entries(h.panelImages)) {
            const resolved = imgs.map((img) => {
              if (!img) return img;
              if (!img.startsWith('data:') && !img.startsWith('blob:')) return img;
              return hashString(img.slice(0, 2048));
            });
            if (JSON.stringify(resolved) !== JSON.stringify(imgs)) {
              (h.panelImages as Record<number, string[]>)[Number(idx)] = resolved;
              modified = true;
              storyboardsCleaned++;
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
        console.log(`[migrateLegacyStorageData] cleaned ${storyboardsCleaned} legacy storyboard panel entries`);
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

