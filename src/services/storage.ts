import {
  cacheStoryboardPanelImages,
  getCachedStoryboardPanelImages,
  getAllCachedPanelImages,
  deleteCachedStoryboardPanelImages,
  resolveImageRef,
  clearUnifiedImageCache,
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
  try {
    localStorage.setItem(key, JSON.stringify(items.slice(0, MAX_HISTORY)));
  } catch {
    // storage full or unavailable
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
    const allImages: string[] = [];
    const normalizedPanelImages: Record<number, string[]> = {};
    for (const [panelIdx, imgs] of Object.entries(panelImages)) {
      const resolved = imgs.map((img) => resolveImageRef(img));
      normalizedPanelImages[Number(panelIdx)] = resolved;
      allImages.push(...resolved);
    }
    history[index] = {
      ...history[index],
      panelImages: normalizedPanelImages,
      images: allImages.slice(0, 12),
      ...(zipUrl !== undefined ? { zipUrl } : {}),
      ...(panelImageCounts !== undefined ? { panelImageCounts } : {}),
    };
    saveHistory(STORYBOARD_HISTORY_KEY, history);
  }
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

export interface FavoriteItem {
  id: string;
  imageUrl: string; // data URL
  prompt?: string;
  source: 'expand' | 'random' | 'storyboard' | 'batch' | 'history';
  sourceId?: string; // history item id if applicable
  tags?: Record<string, string[]>;
  r18: boolean;
  timestamp: number;
}

const FAVORITES_KEY = 'nsfwxo_favorites';

export function getFavorites(): FavoriteItem[] {
  return loadHistory<FavoriteItem>(FAVORITES_KEY);
}

export function addFavorite(item: Omit<FavoriteItem, 'id' | 'timestamp'>): void {
  const favorites = getFavorites();
  // Avoid duplicates by image URL
  if (favorites.some((f) => f.imageUrl === item.imageUrl)) return;
  favorites.unshift({ ...item, id: genId(), timestamp: Date.now() });
  saveHistory(FAVORITES_KEY, favorites);
}

export function removeFavorite(id: string): void {
  const favorites = getFavorites().filter((f) => f.id !== id);
  saveHistory(FAVORITES_KEY, favorites);
}

export function isFavorited(imageUrl: string): boolean {
  return getFavorites().some((f) => f.imageUrl === imageUrl);
}

export function clearFavorites(): void {
  try { localStorage.removeItem(FAVORITES_KEY); } catch {}
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

