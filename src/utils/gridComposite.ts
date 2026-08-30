/**
 * Grid composite utility
 *
 * 9-Panel storyboard frontend compositor.
 *
 * Why this exists
 * ───────────────
 * The grid storyboard's "Generate Image" button wants to produce ONE 9-panel
 * image. But running a SINGLE img2img task that asks the model to render a
 * 3×3 grid in a single image is unreliable when a strong face reference is
 * supplied: Krea2 tends to collapse the layout into a wide strip of three
 * half-faces (we observed this empirically — 3 wide tiles, each containing
 * 1/3 of a face, instead of a true 3×3 grid).
 *
 * The reliable approach, used by the linear-storyboard page, is to issue
 * 9 INDEPENDENT img2img tasks — one per panel, each with `count=1` and a
 * per-panel prompt that contains NO layout / grid instructions. The UI then
 * arranges the 9 results into a 3×3 grid display, and this helper stitches
 * them into a single PNG when the user clicks "保存 9 宫格" or "下载".
 *
 * ── Public API ─────────────────────────────────────────────────────────
 *
 *   composeNinePanelGrid(images: (string | null | undefined)[]): Promise<string>
 *     → returns a data: URL of a vertically-laid-out 3×3 sheet (9:16).
 *       Missing panels are rendered as empty placeholder tiles so the user
 *       can see which slots haven't been generated yet.
 *
 *   loadImage(url): Promise<HTMLImageElement>
 *     → shared image loader used by both the compositor and the unit test.
 */

export interface CompositeOptions {
  /** Total image width in pixels. Final image is `width × width * 16 / 9`. */
  width?: number;
  /** Tile border color (CSS string). Defaults to white. */
  borderColor?: string;
  /** Tile border width in pixels. Defaults to 2. */
  borderPx?: number;
  /** Optional labels rendered in the top-left corner of each tile (e.g. "Panel 1"). */
  panelLabels?: string[];
  /** Show the "等待生成..." placeholder for missing tiles. Default true. */
  showPlaceholder?: boolean;
  /** Placeholder color. Default #1f2937 (slate-800). */
  placeholderColor?: string;
}

const DEFAULT_WIDTH = 832;          // 832 × 16 / 9 ≈ 1479 (a comfy 9:16 sheet)
const DEFAULT_BORDER = 2;
const DEFAULT_PLACEHOLDER = '#1f2937';

/**
 * Load an image URL into an HTMLImageElement. Resolves only when the image
 * has fully decoded (or failed). Used by composeNinePanelGrid and reusable
 * for callers that want to draw on top of a panel image.
 *
 * Supports http(s) URLs and data: URLs. Cross-origin images that don't
 * return a CORS-friendly response will reject with an error.
 */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // CrossOrigin only matters for remote URLs — data URLs always work.
    if (/^https?:\/\//i.test(url)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`Image load failed: ${url.slice(0, 80)}`));
    img.src = url;
  });
}

/**
 * Compose 9 panel images into a single 3×3 grid image (data: URL).
 *
 * Layout (9:16 vertical, 3 rows × 3 columns):
 *
 *   ┌─────┬─────┬─────┐
 *   │  1  │  2  │  3  │
 *   ├─────┼─────┼─────┤
 *   │  4  │  5  │  6  │
 *   ├─────┼─────┼─────┤
 *   │  7  │  8  │  9  │
 *   └─────┴─────┴─────┘
 *
 * - Each tile is the SAME size (1/3 width × 1/3 height of the canvas).
 * - Missing images render as a dark placeholder with a small "等待生成…"
 *   hint so the user can see which slots still need generation.
 * - A thin white border separates the tiles for visual clarity.
 *
 * Always returns a Promise; never throws synchronously.
 */
export async function composeNinePanelGrid(
  images: Array<string | null | undefined>,
  options: CompositeOptions = {},
): Promise<string> {
  const width = options.width ?? DEFAULT_WIDTH;
  const cols = 3;
  const rows = 3;
  const tileW = Math.floor(width / cols);
  const tileH = Math.floor((width * 16 / 9) / rows);
  const totalW = tileW * cols;
  const totalH = tileH * rows;
  const borderPx = options.borderPx ?? DEFAULT_BORDER;
  const borderColor = options.borderColor ?? '#ffffff';
  const placeholderColor = options.placeholderColor ?? DEFAULT_PLACEHOLDER;
  const showPlaceholder = options.showPlaceholder ?? true;

  if (typeof document === 'undefined') {
    throw new Error('composeNinePanelGrid requires a browser DOM (document/canvas)');
  }

  const canvas = document.createElement('canvas');
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  // Background (also the placeholder fill).
  ctx.fillStyle = placeholderColor;
  ctx.fillRect(0, 0, totalW, totalH);

  // Pre-load all present images in parallel; tolerate failures (the
  // placeholder will be drawn instead).
  const slots = await Promise.all(
    images.slice(0, cols * rows).map(async (url) => {
      if (!url) return null;
      try {
        return await loadImage(url);
      } catch {
        return null;
      }
    }),
  );

  for (let i = 0; i < cols * rows; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const x = col * tileW;
    const y = row * tileH;
    const img = slots[i];

    // Tile background (placeholder fill).
    ctx.fillStyle = placeholderColor;
    ctx.fillRect(x, y, tileW, tileH);

    if (img) {
      // Cover-fit the image into the tile (matches Krea2's 9:16 tile output
      // by trimming the long axis if aspect ratios don't match).
      drawCover(ctx, img, x, y, tileW, tileH);
    } else if (showPlaceholder) {
      // Hint text so the user sees which slots are still missing.
      ctx.fillStyle = '#9ca3af';
      ctx.font = `${Math.max(12, Math.floor(tileW * 0.05))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Panel ${i + 1}`, x + tileW / 2, y + tileH / 2 - 12);
      ctx.fillText('(等待生成)', x + tileW / 2, y + tileH / 2 + 12);
    }

    // Border between tiles (only inner borders + outer frame).
    if (borderPx > 0) {
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = borderPx;
      ctx.strokeRect(x + borderPx / 2, y + borderPx / 2, tileW - borderPx, tileH - borderPx);
    }

    // Optional panel label in the top-left corner.
    if (options.panelLabels?.[i]) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x + 6, y + 6, tileW * 0.32, 22);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(options.panelLabels[i], x + 10, y + 10);
    }
  }

  return canvas.toDataURL('image/png');
}

/**
 * Cover-fit an image into a (x, y, w, h) rectangle on the canvas.
 * Crops (rather than letterboxes) so the tile stays full-bleed.
 */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const imgAspect = img.width / img.height;
  const tileAspect = w / h;
  let sx = 0;
  let sy = 0;
  let sw = img.width;
  let sh = img.height;
  if (imgAspect > tileAspect) {
    // Image wider than tile → crop horizontally
    sw = img.height * tileAspect;
    sx = (img.width - sw) / 2;
  } else {
    // Image taller than tile → crop vertically
    sh = img.width / tileAspect;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}