/**
 * Downscale a data: or blob: image URL to a small JPEG so it's safe to stash
 * in localStorage for UI thumbnails (typically 48×48 px in VideoTaskList).
 *
 * Raw `data:image/png;base64,...` of a 1024×1024 image is ~1.5 MB; the
 * browser's ~5 MB localStorage budget can fit only 3-4 of those before
 * throwing `QuotaExceededError`. A 64×64 JPEG (~3-5 KB) gives identical
 * visual quality at thumbnail size and lets us store 200+ entries safely.
 *
 * Behavior:
 * - Returns the input unchanged if it isn't a data: / blob: URL (e.g. already
 *   a ComfyUI server path), since those don't need resizing for storage.
 * - Falls back to the original on any decode/draw error (Canvas tainted,
 *   image load fails, etc.) so the call site never breaks.
 */
const THUMB_MAX_SIDE = 64;
const THUMB_QUALITY = 0.75;

export async function makeThumbnailForStorage(imageUrl: string): Promise<string> {
  if (!imageUrl) return '';
  if (!imageUrl.startsWith('data:') && !imageUrl.startsWith('blob:')) {
    return imageUrl;
  }

  try {
    const img = await loadImage(imageUrl);
    const { width, height } = img;
    if (width === 0 || height === 0) return imageUrl;

    const scale = Math.min(1, THUMB_MAX_SIDE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return imageUrl;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', THUMB_QUALITY);
  } catch {
    // CORS-tainted images can't be drawn; just return the original.
    return imageUrl;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}