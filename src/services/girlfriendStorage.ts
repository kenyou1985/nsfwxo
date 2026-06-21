import type { GirlfriendPreset } from '../data/girlfriendPresets';

const STORAGE_KEY = 'girlfriend_custom';
const MAX_CUSTOM = 50;

export interface CustomGirlfriend {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  characterPrompt: string;
  tags: string[];
  imageDataUrl: string;
  thumbnailDataUrl: string;
  aspectRatio: string;
  createdAt: number;
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function loadCustom(): CustomGirlfriend[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCustom(items: CustomGirlfriend[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_CUSTOM)));
  } catch {
    // storage full or unavailable
  }
}

export function getCustomGirlfriends(): CustomGirlfriend[] {
  return loadCustom();
}

export interface SaveCustomGirlfriendResult {
  success: boolean;
  data?: CustomGirlfriend;
  error?: string;
}

export function saveCustomGirlfriend(
  data: Omit<CustomGirlfriend, 'id' | 'createdAt'>
): SaveCustomGirlfriendResult {
  try {
    const list = loadCustom();
    const item: CustomGirlfriend = {
      ...data,
      id: genId(),
      createdAt: Date.now(),
    };
    list.unshift(item);

    const serialized = JSON.stringify(list.slice(0, MAX_CUSTOM));
    try {
      localStorage.setItem(STORAGE_KEY, serialized);
    } catch (quotaErr) {
      const msg = quotaErr instanceof Error ? quotaErr.message : String(quotaErr);
      return { success: false, error: `存储失败（配额不足）：${msg}` };
    }
    return { success: true, data: item };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `保存失败：${msg}` };
  }
}

export function removeCustomGirlfriend(id: string): void {
  const list = loadCustom().filter((g) => g.id !== id);
  saveCustom(list);
}

export function clearCustomGirlfriends(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function renameCustomGirlfriend(id: string, name: string, nameZh: string): void {
  const list = loadCustom().map((g) =>
    g.id === id ? { ...g, name, nameZh } : g
  );
  saveCustom(list);
}

export function toPreset(custom: CustomGirlfriend): GirlfriendPreset {
  return {
    id: `custom_${custom.id}`,
    name: custom.name,
    nameZh: custom.nameZh,
    description: custom.description,
    characterPrompt: custom.characterPrompt,
    tags: custom.tags,
    portraitUrl: custom.imageDataUrl,
    thumbnailUrl: custom.thumbnailDataUrl,
    aspectRatio: custom.aspectRatio,
    isCustom: true,
  };
}

export function createThumbnail(dataUrl: string, maxWidth = 300, maxHeight = 533): Promise<string> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ratio = img.width / img.height;
      let w = maxWidth;
      let h = w / ratio;
      if (h > maxHeight) {
        h = maxHeight;
        w = h * ratio;
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Compress image before localStorage storage.
 * localStorage on mobile is often limited to ~5MB; compress full-size
 * images to JPEG ~80% quality at max 1024px wide to stay well under quota.
 */
export async function compressImageForStorage(dataUrl: string, maxWidth = 1024): Promise<string> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (w > maxWidth) {
        h = Math.round((h * maxWidth) / w);
        w = maxWidth;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
