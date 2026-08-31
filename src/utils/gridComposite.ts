/**
 * Grid composite utility
 *
 * Multi-panel storyboard frontend compositor.
 *
 * Why this exists
 * ───────────────
 * The grid storyboard's "Generate Image" button wants to produce ONE
 * multi-panel image. But running a SINGLE img2img task that asks the
 * model to render e.g. a 3×3 grid in a single image is unreliable when a
 * strong face reference is supplied: Krea2 tends to collapse the layout
 * into a wide strip of three half-faces (we observed this empirically —
 * 3 wide tiles, each containing 1/3 of a face, instead of a true 3×3 grid).
 *
 * The reliable approach, used by the linear-storyboard page, is to issue
 * N INDEPENDENT img2img tasks — one per panel, each with `count=1` and a
 * per-panel prompt that contains NO layout / grid instructions. The UI then
 * arranges the N results into a grid display, and this helper stitches
 * them into a single PNG when the user clicks "保存" or "下载".
 *
 * ── Public API ─────────────────────────────────────────────────────────
 *
 *   composeNinePanelGrid(images, options?): Promise<string>
 *     → legacy alias for composeGridStoryboard. Kept for backwards-compat
 *       with existing callers; internally forces a 3×3 (9-panel) layout.
 *
 *   composeGridStoryboard(images, options?): Promise<string>
 *     → returns a data: URL of a vertically-laid-out storyboard sheet.
 *       The (cols, rows) layout is auto-derived from images.length when
 *       no explicit cols/rows are passed:
 *         4 panels  → 2×2
 *         6 panels  → 2×3
 *         9 panels  → 3×3
 *        12 panels  → 3×4
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
  /** Force a specific number of columns. Default: auto-derive from count. */
  cols?: number;
  /** Force a specific number of rows. Default: auto-derive from count. */
  rows?: number;
}

const DEFAULT_WIDTH = 832;          // 832 × 16 / 9 ≈ 1479 (a comfy 9:16 sheet)
const DEFAULT_BORDER = 2;
const DEFAULT_PLACEHOLDER = '#1f2937';

/**
 * Compute the (cols, rows) layout for a given panel count.
 *
 * Layout mapping (always cols ≤ rows to keep the sheet vertical):
 *   4 panels  → 2 cols × 2 rows (2×2)
 *   6 panels  → 2 cols × 3 rows (2×3)
 *   9 panels  → 3 cols × 3 rows (3×3)
 *  12 panels  → 3 cols × 4 rows (3×4)
 *  other      → smallest cols s.t. cols*rows >= count
 */
function getLayoutForCount(count: number): { cols: number; rows: number } {
  if (count === 4) return { cols: 2, rows: 2 };
  if (count === 6) return { cols: 2, rows: 3 };
  if (count === 9) return { cols: 3, rows: 3 };
  if (count === 12) return { cols: 3, rows: 4 };
  const cols = Math.max(2, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / cols);
  return { cols, rows };
}

/**
 * Load an image URL into an HTMLImageElement. Resolves only when the image
 * has fully decoded (or failed). Used by composeGridStoryboard and reusable
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
 * Compose N panel images into a single storyboard sheet (data: URL).
 *
 * Layout is auto-derived from images.length when options.cols/rows are not
 * provided. Supports 2×2 (4 panels), 2×3 (6 panels), 3×3 (9 panels),
 * 3×4 (12 panels), and other balanced grids.
 *
 * The output is always a strict 9:16 vertical aspect ratio (taller than
 * wide) regardless of the panel count — this matches Krea2's native
 * 9:16 storyboard output so the composite looks correct when uploaded
 * back to the model.
 *
 *   ┌─────┬─────┐    ┌─────┬─────┐    ┌─────┬─────┬─────┐
 *   │  1  │  2  │    │  1  │  2  │    │  1  │  2  │  3  │
 *   ├─────┼─────┤    ├─────┼─────┤    ├─────┼─────┼─────┤
 *   │  3  │  4  │    │  3  │  4  │    │  4  │  5  │  6  │
 *   └─────┴─────┘    ├─────┼─────┤    ├─────┼─────┼─────┤
 *                   │  5  │  6  │    │  7  │  8  │  9  │
 *                   └─────┴─────┘    └─────┴─────┴─────┘
 *     2×2 (4)           2×3 (6)            3×3 (9)
 *
 * - Each tile is the SAME size (1/cols width × 1/rows height of the canvas).
 * - Missing images render as a dark placeholder with a small "等待生成…"
 *   hint so the user sees which slots still need generation.
 * - A thin white border separates the tiles for visual clarity.
 *
 * Always returns a Promise; never throws synchronously.
 */
export async function composeGridStoryboard(
  images: Array<string | null | undefined>,
  options: CompositeOptions = {},
): Promise<string> {
  const width = options.width ?? DEFAULT_WIDTH;
  const layout = (() => {
    if (options.cols && options.rows) {
      return { cols: options.cols, rows: options.rows };
    }
    if (options.cols) {
      return { cols: options.cols, rows: Math.ceil(images.length / options.cols) };
    }
    if (options.rows) {
      return { cols: Math.ceil(images.length / options.rows), rows: options.rows };
    }
    return getLayoutForCount(images.length);
  })();
  const cols = layout.cols;
  const rows = layout.rows;
  const slotCount = cols * rows;
  const tileW = Math.floor(width / cols);
  const tileH = Math.floor((width * 16 / 9) / rows);
  const totalW = tileW * cols;
  const totalH = tileH * rows;
  const borderPx = options.borderPx ?? DEFAULT_BORDER;
  const borderColor = options.borderColor ?? '#ffffff';
  const placeholderColor = options.placeholderColor ?? DEFAULT_PLACEHOLDER;
  const showPlaceholder = options.showPlaceholder ?? true;

  if (typeof document === 'undefined') {
    throw new Error('composeGridStoryboard requires a browser DOM (document/canvas)');
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
    images.slice(0, slotCount).map(async (url) => {
      if (!url) return null;
      try {
        return await loadImage(url);
      } catch {
        return null;
      }
    }),
  );

  for (let i = 0; i < slotCount; i++) {
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
 * Legacy alias for composeGridStoryboard. Kept for backwards-compat with
 * existing callers; internally always used a hardcoded 3×3 (9-panel) grid.
 *
 * New code should call composeGridStoryboard directly so the layout
 * matches the user's selected panel count.
 */
export async function composeNinePanelGrid(
  images: Array<string | null | undefined>,
  options: CompositeOptions = {},
): Promise<string> {
  // Preserve historical behaviour: 3×3 layout when no explicit cols/rows.
  const merged: CompositeOptions = { cols: 3, rows: 3, ...options };
  return composeGridStoryboard(images, merged);
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