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
/** Preview thumbnails for the long-video 参考图 grid — bigger than storage
 *  thumbnails (256×256 vs 64×64) because that grid shows tiles at 100–200 px.
 *  Still tiny enough to keep sessionStorage well under the 5 MB quota even
 *  with dozens of previews stored. */
const PREVIEW_MAX_SIDE = 384;
const PREVIEW_QUALITY = 0.85;

export async function makeThumbnailForStorage(imageUrl: string): Promise<string> {
  return makeSizedThumbnail(imageUrl, THUMB_MAX_SIDE, THUMB_QUALITY);
}

/**
 * Higher-quality preview thumbnail for surfaces that show the image at 100–200 px
 * (e.g. the long-video 参考图 grid). Falls back to the original on errors.
 */
export async function makePreviewForStorage(imageUrl: string): Promise<string> {
  return makeSizedThumbnail(imageUrl, PREVIEW_MAX_SIDE, PREVIEW_QUALITY);
}

async function makeSizedThumbnail(imageUrl: string, maxSide: number, quality: number): Promise<string> {
  if (!imageUrl) return '';
  if (!imageUrl.startsWith('data:') && !imageUrl.startsWith('blob:')) {
    return imageUrl;
  }

  try {
    const img = await loadImage(imageUrl);
    const { width, height } = img;
    if (width === 0 || height === 0) return imageUrl;

    const scale = Math.min(1, maxSide / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return imageUrl;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
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