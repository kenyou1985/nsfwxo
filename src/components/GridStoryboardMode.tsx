import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  LayoutList, Wand2, Loader2, Check, X, Film, Sparkles,
  RotateCcw, Zap, History, Trash2, AlertCircle, ChevronDown,
  ChevronUp, ChevronLeft, ChevronRight, Grid3X3, LayoutGrid,
  BookTemplate, ArrowLeft, Settings,
  Download, Heart, Copy, RefreshCw, ZoomIn, Shuffle, XCircle,
} from 'lucide-react';
import { GridPanelEditor } from './GridPanelEditor';
import { GRID_TEMPLATES, type GridTemplate } from '../data/gridTemplates';
import type { GridPanel, GridHistoryItem } from '../services/storage';
import {
  getGridHistory, addGridHistory, removeGridHistory, clearGridHistory, updateGridHistoryImages,
  getGridSession, saveGridSession, clearGridSession,
  cacheStoryboardPanelImages, getCachedStoryboardPanelImages,
  addFavorite, removeFavorite, getFavorites, isFavorited as isFavoritedFn,
} from '../services/storage';
import {
  generateStoryboardOutline,
  generateStoryboardThemes, listStoryboardThemes,
  getPromptTaskStatus,
  type StoryboardThemeOption,
  type StoryboardPanel,
} from '../services/promptApi';
import { useFinishedTaskImages } from '../contexts/FinishedTaskImagesContext';
import { MAX_TASKS, type TaskManagerReturn } from '../hooks/useTaskManager';
import type { GirlfriendPreset } from '../data/girlfriendPresets';
import { buildTxt2ImgNodeList } from '../utils/txt2imgNodeBuilder';
import { buildUnifiedTxt2ImgOptions } from '../utils/txt2imgDefaults';
import { withQualityBoost } from '../constants';
import { WORKFLOW, uploadImage } from '../services/runninghub';
import { composeGridStoryboard } from '../utils/gridComposite';
import type { TabType } from '../types';

const GRID_LOG_PREFIX = '[GridStoryboardMode]';

type GridStep = 'themes' | 'edit' | 'view';
type GridSize = 4 | 6 | 9 | 12;

/**
 * Compute the (cols, rows) layout for a given number of panels.
 * Always uses a vertical 9:16 sheet, so cols ≤ rows:
 *   4 panels  → 2 cols × 2 rows (2×2)
 *   6 panels  → 2 cols × 3 rows (2×3)
 *   9 panels  → 3 cols × 3 rows (3×3)
 *  12 panels  → 3 cols × 4 rows (3×4)
 *  other → square-root balanced layout (still cols ≤ rows).
 */
function getGridLayout(panelCount: number): { cols: number; rows: number; label: string } {
  if (panelCount === 4) return { cols: 2, rows: 2, label: '2×2' };
  if (panelCount === 6) return { cols: 2, rows: 3, label: '2×3' };
  if (panelCount === 9) return { cols: 3, rows: 3, label: '3×3' };
  if (panelCount === 12) return { cols: 3, rows: 4, label: '3×4' };
  // Generic fallback — pick the smallest cols such that cols*rows >= count
  const cols = Math.max(2, Math.ceil(Math.sqrt(panelCount)));
  const rows = Math.ceil(panelCount / cols);
  return { cols, rows, label: `${cols}×${rows}` };
}

// All available categories for built-in templates
const ALL_CATEGORIES = [
  '全部',
  '都市夜景',
  '自然野外',
  '猎奇场景',
  '废弃工业',
  '运动健身',
  '猎奇特奇',
  '凌辱羞耻',
  '恐怖惊奇',
  '角色扮演',
  '著名景点',
  '中国著名',
  '裸体运动',
  '口交高潮',
] as const;

function formatElapsedTime(startTime?: number): string {
  if (!startTime) return '';
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return `${mins}m${secs}s`;
}

interface GridStoryboardModeProps {
  r18Mode: boolean;
  taskManager: TaskManagerReturn;
  apiKey: string;
  displayLang: 'en' | 'zh';
  digitalHumanMode: boolean;
  selectedGirlfriend: GirlfriendPreset | null;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  onNavigate?: (tab: TabType) => void;
}

/**
 * Random sexy outfit for variety across panels.
 */
const sexyOutfitPool = [
  'sexy lace lingerie',
  'slip satin dress',
  'tight mini skirt with crop top',
  'V-neck silk blouse',
  'leather mini dress',
  'off-shoulder bodysuit',
  'sheer mesh top',
  'wrap dress with deep neckline',
  'corset with garter belt',
  'backless halter top',
  'bodycon dress',
  'plunging neckline top',
];

/**
 * Build a single grid storyboard prompt from individual panels.
 * Automatically adds sexy clothing descriptions to the base prompt.
 * Ensures character consistency and camera angle variety across panels.
 */
// Camera angles and shot types for variety
const cameraAngles = [
  'medium shot', 'close-up shot', 'wide shot', 'low angle shot',
  'high angle shot', 'over-the-shoulder shot', 'side profile shot',
  'Dutch angle shot', 'tracking shot', 'POV shot', 'establishing shot',
  'bird eye view', 'worm eye view', 'three-quarter view',
];

// Default clothing fallback for early panels lacking clothing descriptions
const SHE_CLOTHES = [
  'in a black evening gown','in a white blouse and pencil skirt','in a red cocktail dress',
  'in a casual t-shirt and jeans','in a light trench coat and skirt','in a floral sundress',
  'in a silk slip dress','in a denim jacket and shorts','in a cozy knit sweater and leggings',
  'in a white summer dress','in a black turtleneck and pleated skirt',
];
const HE_CLOTHES = [
  'in a dark shirt and slacks','in a white button-up and dress pants','in a black hoodie and jeans',
  'in a grey sweater and chinos','in a leather jacket and dark pants','in a light blue shirt and cargo pants',
  'in a navy blazer and trousers','in a casual polo and dark jeans',
];
const CLOTHING_RE = /\b(wearing|in a|in her|in his|in the|dressed in|dressed as|clothed|穿着|blouse|sweater|dress|skirt|shirt|jeans|suit|jacket|coat|lingerie|bikini|underwear|pants|t-shirt|hoodie|gown|apron|uniform|corset|silk|leather)/i;

export interface GridPromptBuildResult {
  prompt: string;
  warnings: string[];
}

function buildFullGridPrompt(panels: GridPanel[], gridSize: number): string {
  return buildFullGridPromptDetailed(panels, gridSize).prompt;
}

function buildFullGridPromptDetailed(
  panels: GridPanel[],
  gridSize: number,
  options?: { anchorText?: string },
): GridPromptBuildResult {
  if (panels.length === 0) return { prompt: '', warnings: [] };

  // Extract base prompt from first panel (everything before "Panel1:")
  const firstPanelPrompt = panels[0].image_prompt;
  const baseMatch = firstPanelPrompt.match(/^(.*?)(?=Panel\d+:|$)/s);
  const basePart = baseMatch ? baseMatch[1].trim() : firstPanelPrompt;

  // Determine the actual layout for this prompt — derived from the panel
  // count the user has chosen (2×2 / 2×3 / 3×3 / 3×4). Without this, even
  // when the user picks 2×2 the prompt still says "9-panel 3×3 grid" and
  // the model obediently renders 9 panels.
  const layout = getGridLayout(gridSize);
  const cols = layout.cols;
  const rows = layout.rows;
  const panelTotal = cols * rows;
  const layoutLabel = layout.label;

  // The grid layout HEADER must ALWAYS be present at the start of the
  // assembled prompt — even when the template's basePrompt already says
  // "no grid layout / single cinematic vertical frame" (which was added
  // for the per-panel redraw path). When we re-assemble the full grid
  // prompt for "Generate Grid Storyboard Image", we DO want a
  // ${cols}×${rows} grid of ${panelTotal} panels in ONE image, so we
  // override the template's "no grid" wording.
  //
  // CRITICAL: this header is intentionally aggressive — Krea2 (especially
  // in img2img mode with a strong face reference image) tends to render
  // a single dominant subject instead of a grid. We:
  //   1. State the layout requirement EXPLICITLY ("exactly N panels in a
  //      ${cols}×${rows} grid layout, ${cols} columns and ${rows} rows")
  //   2. Forbid any 1×N / 2×N / single-frame interpretations
  //   3. Reinforce that the SAME female character appears in ALL panels
  //      with a consistent face — this is the strongest single signal that
  //      the face reference image should not be upscaled to dominate
  //   4. Require each panel to be a separate moment with its own framing
  //
  // The header is also written to be readable as a literal instruction
  // to the model, not as description of the layout — Krea2 parses
  // imperative language ("must be", "do not render") more reliably than
  // descriptive language.
  //
  // SHOT TYPE REQUIREMENT: Every panel must show a WIDE or MEDIUM shot of
  // the SCENE (environment, setting, full body in context). AVOID close-up
  // portrait shots. Each tile shows the complete scene moment, not a face.

  // Build the list of forbidden panel counts so the model doesn't render
  // 1, 2, 4, 6 or 9 panels when we only want 4 / 6 / etc.
  const forbiddenCounts = [1, 2, 3, 4, 6, 9, 12]
    .filter((n) => n !== panelTotal)
    .join(', ');

  const GRID_HEADER =
    `OUTPUT LAYOUT — MANDATORY: render a ${panelTotal}-PANEL STORYBOARD SHEET in strict ${rows} rows × ${cols} columns grid format (${layoutLabel}). ` +
    `Each of the ${panelTotal} tiles is an EQUAL-SIZED rectangular panel separated by thin white borders, each tile occupies ONLY 1/${panelTotal} of the image area. ` +
    `Total image: strict 9:16 vertical aspect ratio (taller than wide), single coherent narrative across all ${panelTotal} panels, cinematic movie storyboard. ` +
    `Each panel is its own distinct moment separated by thin borders. ` +
    `Each of the ${panelTotal} panels must contain the same female character with the same face in a different pose/action, ` +
    `and the same male character (if present) with consistent appearance. ` +
    `The female face is identical in all ${panelTotal} panels and must not change, consistent lighting style across all ${panelTotal} panels. ` +
    `FORBIDDEN: do not render ${forbiddenCounts} panels, single portrait, horizontal strip, blank tiles, or face scaled to dominate the image. ` +
    `REQUIRED: exactly ${panelTotal} filled tiles in ${layoutLabel} grid. ` +
    `SHOT TYPE: Each tile MUST show a WIDE SHOT or MEDIUM SHOT of the ENTIRE SCENE - the environment, setting, and full body of characters in context. ` +
    `AVOID portrait close-ups, face close-ups, or headshot compositions. ` +
    `The character face should appear SMALL within each tile, showing the complete scene moment, not a portrait. `;

  // Build a regex that matches the GRID_HEADER (with any whitespace/case variations)
  // so we can strip the duplicate header that the template basePrompt already
  // contains before we prepend our own. Without this, the user's prompt contains
  // duplicated layout instructions which confuse the model.
  //
  // The template basePrompt typically contains the OLD header form
  // ("cinematic storyboard grid in strict 9:16 vertical aspect ratio, 9 panels
  // arranged in 3×3 grid, ..."). We strip that whole leading chunk to avoid
  // duplicating the layout instruction.
  //
  // This regex matches the original 9-panel header — even when gridSize is
  // not 9, the user's basePrompt may still contain the old 9-panel wording
  // and we want to remove it so the dynamic header below wins.
  const GRID_HEADER_PATTERN =
    /^\s*(?:cinematic\s+storyboard\s+grid\s+in\s+strict[^,]*,\s*\d*\s*panel[s]?\s*arranged\s+in\s*\d*\s*[×x*]\s*\d*\s*grid\s*,?\s*|output\s+layout\s*[—-]\s*mandatory[^.]*\.|important\s*[—-]\s*layout\s+requirement[^.]*\.)/i;

  // Remove any "no grid layout / no multiple panels / no storyboard split /
  // single cinematic vertical frame" lines that the template basePrompt may
  // contain (these were added to fix per-panel redraw, but they conflict
  // with the dynamic grid header we are injecting now).
  //
  // NOTE on regex flavor: every starts-with pattern uses \s* to tolerate
  // leading whitespace left behind by prior [^,]*, strips. Without \s*,
  // leftover tokens like " no grid layout" / " no multiple panels" can leak
  // through and Krea2 lays out the wrong panel count instead of the one
  // the user picked.
  let cleanedBase = basePart
    .replace(GRID_HEADER_PATTERN, '')            // strip duplicated GRID_HEADER
    .replace(/^\s*no\s+grid\s+layout,\s*/gi, '')
    .replace(/,\s*no\s+grid\s+layout,\s*/gi, ',')
    .replace(/^\s*no\s+multiple\s+panels,\s*/gi, '')
    .replace(/,\s*no\s+multiple\s+panels,\s*/gi, ',')
    .replace(/^\s*no\s+storyboard\s+split,\s*/gi, '')
    .replace(/,\s*no\s+storyboard\s+split,\s*/gi, ',')
    .replace(/^\s*full\s+frame\s+single\s+subject\s+composition,\s*/gi, '')
    .replace(/,\s*full\s+frame\s+single\s+subject\s+composition,\s*/gi, ',')
    .replace(/^\s*single\s+cinematic\s+vertical\s+frame[^,]*,/gi, '')
    .replace(/,\s*single\s+cinematic\s+vertical\s+frame[^,]*,/gi, ',')
    .replace(/^\s*single\s+cinematic\s+shot,\s*/gi, '')
    .replace(/,\s*single\s+cinematic\s+shot,\s*/gi, ',')
    .replace(/^\s*single\s+subject\s+only,\s*/gi, '')
    .replace(/,\s*single\s+subject\s+only,\s*/gi, ',')
    .replace(/^\s*focused\s+on\s+this\s+moment\s+only,\s*/gi, '')
    .replace(/,\s*focused\s+on\s+this\s+moment\s+only,\s*/gi, ',')
    .replace(/^[\s,]+/g, '')
    .trim();

  // Use grid header + (optional) anchor + cleaned base prompt.
  //
  // The anchor (when provided, e.g. for img2img / digital-human mode) is a
  // CONCISE character-consistency description that sits BETWEEN the layout
  // header and the base prompt — the same structural slot that txt2img's
  // `[ANCHOR: ...]` block occupies (which is part of `cleanedBase` because
  // it comes from the template's basePrompt).
  //
  // Keeping the anchor INSIDE the prompt builder (rather than prepending it
  // in the caller) guarantees that:
  //   1. There is exactly ONE GRID_HEADER block (no duplicate layout
  //      instruction that confuses the model into 3 wide panels)
  //   2. The anchor lands in the same structural position as txt2img,
  //      so the model sees consistent prompt shape across both modes
  //   3. The anchor text is concise (the caller is responsible for that)
  //      so it never crowds out the per-panel descriptions below.
  //
  // IMPORTANT: When the anchor is in Chinese 【严格锁定】 format (from
  // digital-human mode), we DON'T add the English [CHARACTER ANCHOR] prefix
  // since the Chinese format is self-contained and adding English would
  // dilute the character-locking effectiveness.
  const isChineseAnchor = options?.anchorText?.includes('【严格锁定】');
  const anchorBlock = options?.anchorText?.trim()
    ? (isChineseAnchor
        ? `\n\n${options.anchorText.trim()}`
        : `\n\n[CHARACTER ANCHOR — must remain identical across all ${panelTotal} panels] ${options.anchorText.trim()}`)
    : '';
  let fullPrompt = GRID_HEADER + anchorBlock + (cleanedBase ? '\n\n' + cleanedBase : '');

  // Add each panel with simple action description
  // ─────────────────────────────────────────────────────────────────
  // CRITICAL: empty or near-empty panels (e.g. user typed "Panel3: ")
  // would otherwise leave a blank tile in the 3×3 grid, which makes
  // Krea2 collapse the layout to 2×N or 1×N. We auto-fill empty panels
  // from their neighbors and run every panel through sanitizePanelContent
  // to fix obvious logical errors (male breast, wrong race, etc.).
  // ─────────────────────────────────────────────────────────────────
  const allWarnings: string[] = [];

  // First pass: extract sanitized per-panel text + detect empties
  const panelTexts: string[] = [];
  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i];
    const panelPrompt = panel.image_prompt || '';
    const panelSpecificMatch = panelPrompt.match(/Panel\d+:\s*(.*)/s);
    let panelSpecific = panelSpecificMatch ? panelSpecificMatch[1].trim() : panelPrompt;

    // Empty panel? Auto-fill from neighbors.
    const MIN_PANEL_CONTENT = 30; // chars
    if (panelSpecific.length < MIN_PANEL_CONTENT) {
      const prev = i > 0 ? panelTexts[i - 1] : null;
      const next = i < panels.length - 1
        ? (() => {
            const np = panels[i + 1].image_prompt || '';
            const m = np.match(/Panel\d+:\s*(.*)/s);
            return m ? m[1].trim() : np;
          })()
        : null;
      const filled = autoFillPanelContent(i + 1, prev, next);
      console.warn(`${GRID_LOG_PREFIX} Panel${i + 1} was empty, auto-filled with: ${filled.slice(0, 80)}…`);
      allWarnings.push(`第${i + 1}镜为空 → 已自动续写`);
      panelSpecific = filled;
    }

    // Sanitize logical errors
    const { text: sanitized, warnings } = sanitizePanelContent(panelSpecific);
    if (warnings.length > 0) {
      console.warn(`${GRID_LOG_PREFIX} Panel${i + 1} sanitized:`, warnings.join('; '));
      allWarnings.push(`第${i + 1}镜: ${warnings.join('; ')}`);
    }
    panelSpecific = sanitized;

    panelTexts.push(panelSpecific);
  }

  // Second pass: assemble the full prompt with sanitized text
  for (let i = 0; i < panelTexts.length; i++) {
    let panelSpecific = panelTexts[i];

    const hasClothing = CLOTHING_RE.test(panelSpecific);

    // Early panels (Panel 1-2): ensure clothing descriptions present
    // IMPORTANT: Use scene-focused descriptions instead of character pronouns
    // to avoid portrait/close-up generation. Focus on the environment and setting.
    if (i <= 1 && !hasClothing) {
      const she = SHE_CLOTHES[Math.floor(Math.random() * SHE_CLOTHES.length)];
      const he = HE_CLOTHES[Math.floor(Math.random() * HE_CLOTHES.length)];
      // Use scene description instead of "woman/man" to avoid portrait focus
      // The character is referenced by ID in the anchor, not by pronoun here
      panelSpecific = `in ${she} and ${he}, ${panelSpecific}`;
    }
    // Mid panels (Panel 3-4): add undressing progression if still no clothing hint
    else if (i <= 3 && i < gridSize * 0.6 && !hasClothing) {
      panelSpecific = `partially undressed, ${panelSpecific}`;
    }

    // For late panels (60%+), remove clothing descriptions (nude/intimate scenes)
    if (i >= gridSize * 0.6) {
      panelSpecific = panelSpecific
        .replace(/wearing[^,.;]{2,40}/gi, '')
        .replace(/穿着[^,.;。]{2,20}/g, '')
        .replace(/dressed in[^,.;]{2,40}/gi, '')
        .replace(/in a (black|white|red|blue|pink|grey|dark|light|silk|leather|casual|floral|cozy|summer)[^,.;]{2,30}/gi, '');
    }

    // Strip any per-panel "single cinematic shot / no grid layout" leftovers
    // that were added for the per-panel redraw path. When assembling the
    // FULL 9-panel prompt we want the 3×3 grid header (GRID_HEADER) to win.
    //
    // NOTE on regex flavor: each "starts-with" pattern must accept optional
    // leading whitespace (^\s*) because the prior `[^,]*,` strip can leave
    // a leading space when the matched fragment ends with a comma. Without
    // \s* the leading " no grid layout" / " no multiple panels" tokens leak
    // through and Krea2 lays out a 6-panel or 4-panel grid instead of 9.
    panelSpecific = panelSpecific
      .replace(/^\s*single\s+cinematic\s+vertical\s+frame[^,]*,/gi, '')
      .replace(/,\s*single\s+cinematic\s+vertical\s+frame[^,]*,/gi, ',')
      .replace(/^\s*single\s+cinematic\s+shot,\s*/gi, '')
      .replace(/^\s*no\s+grid\s+layout,\s*/gi, '')
      .replace(/,\s*no\s+grid\s+layout,\s*/gi, ',')
      .replace(/^\s*no\s+multiple\s+panels,\s*/gi, '')
      .replace(/,\s*no\s+multiple\s+panels,\s*/gi, ',')
      .replace(/^\s*full\s+frame\s+single\s+subject,\s*/gi, '')
      .replace(/,\s*full\s+frame\s+single\s+subject,\s*/gi, ',')
      .replace(/,\s*full\s+frame\s+single\s+subject\s+composition,\s*/gi, ',')
      .replace(/^\s*focused\s+on\s+this\s+moment\s+only,\s*/gi, '')
      .replace(/,\s*focused\s+on\s+this\s+moment\s+only,\s*/gi, ',')
      .replace(/,\s*no\s+storyboard\s+split,\s*/gi, ',')
      .replace(/,\s*single\s+subject\s+only,\s*/gi, ',')
      .replace(/^\s*Partially\s+undressed,\s*/gi, '')
      .replace(/^\s*partially\s+undressed,\s*/gi, '')
      .replace(/^[\s,]+/g, '')
      .trim();

    fullPrompt += `\nPanel${panels[i].panel_number}: ${panelSpecific}`;
  }
  return { prompt: fullPrompt, warnings: allWarnings };
}

// Apply clothing progression to generated panels
// Early panels: clothed, Middle: semi-nude, Late: nude (no clothing descriptions)
function applyClothingProgression(panels: GridPanel[]): GridPanel[] {
  const totalPanels = panels.length;
  const nudeStart = Math.floor(totalPanels * 0.6);

  return panels.map((panel, i) => {
    const { scene_description, image_prompt } = panel;

    // For late panels (intimate scenes), remove clothing descriptions
    if (i >= nudeStart) {
      const cleanedPrompt = removeClothingFromPrompt(image_prompt);
      return { ...panel, image_prompt: cleanedPrompt };
    }

    return panel;
  });
}

// Remove clothing descriptions from prompt for intimate scenes
function removeClothingFromPrompt(text: string): string {
  return text
    .replace(/wearing[^,]*,?\s*/gi, '')
    .replace(/穿着[^,，]*,?/g, '')
    .replace(/dressed in[^,]*,?\s*/gi, '')
    .replace(/in[^,]*outfit,?\s*/gi, '');
}

/**
 * Validate a single panel's prompt content and auto-fix obvious logical
 * errors that would otherwise confuse Krea2 (e.g. "the male client's
 * breast" — the model would happily render female breasts on a male
 * body, producing nonsense).
 *
 * Returns { text, warnings } so the caller can show the user what was
 * fixed. If the input is essentially empty (less than 30 chars of real
 * content), the caller should call autoFillPanelContent() instead.
 */
function sanitizePanelContent(text: string): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  let cleaned = text;

  // ── Fix 1: "the male client's breast / breasts" → "chest"
  //     The NSFW template often describes the woman squeezing or
  //     fondling the male client's "breast" which is anatomically wrong
  //     (men have flat chests with nipples, not breasts). Replace with
  //     "chest" so the model doesn't render female breasts on the male.
  const breastFixes = [
    [/\b(client|man|male|guy|gentleman|husband|boyfriend|partner|customer|gent|crew member|african|black|asian|white)\s*'s\s+(breast|breasts)\b/gi,
      (m: string) => `${m.replace(/\s*(breast|breasts)\s*$/i, '')} chest`],
    [/\b(her|she|woman|female|girl)'s\s+(client|man|male|guy|husband|boyfriend)\s+(breast|breasts)\b/gi,
      (m: string) => m.replace(/(breast|breasts)/i, 'chest')],
    [/\bsqueezes\s+(?:and\s+rubs\s+)?the\s+(client|man|male|guy|husband|boyfriend|partner)'s\s+(breast|breasts|chest\s+bra)\b/gi,
      'caresses the male client\'s chest and abdomen'],
    [/\b(rubs?|touches?|squeezes?)\s+(?:and\s+(?:rubs?|touches?|squeezes?)\s+)?the\s+(client|man|male|guy|husband|boyfriend)'s\s+(breast|breasts)\b/gi,
      'touches the male client\'s chest'],
  ];
  for (const [pat, rep] of breastFixes) {
    const before = cleaned;
    // Use replace with a function wrapper so TypeScript can resolve the
    // overload: RegExp.prototype.replace accepts (string | function) but
    // when `rep` is typed as a union of `string | function`, TS picks
    // the string overload. We coerce to a function-only form here.
    cleaned = cleaned.replace(pat as RegExp, ((m: string) =>
      typeof rep === 'string' ? rep : (rep as (s: string) => string)(m)
    ) as (substring: string, ...args: unknown[]) => string);
    if (before !== cleaned) {
      warnings.push('"男性客户的乳房" → 已替换为"胸部"，避免模型在男性身上画出女性乳房');
    }
  }

  // ── Fix 2: "strong black female flight attendant" when only Asian
  //     female is in the scene → strip the racial descriptor that
  //     doesn't apply to her (or remove the duplicate character).
  const wrongRaceFemale = /\b(strong|muscular|big|tall|athletic)\s+(black|african|white|caucasian)\s+(female|woman|girl|flight attendant|stewardess)\b/gi;
  if (wrongRaceFemale.test(cleaned)) {
    cleaned = cleaned.replace(wrongRaceFemale, 'east asian female');
    warnings.push('"strong black female" 与实际角色不符 → 已改为 "east asian female"');
  }

  // ── Fix 3: red high heels / different colored heels that contradict
  //     the ANCHOR describing "black high heels" earlier in the same
  //     template. If "black high heels" appears in the ANCHOR/header and
  //     "red high heels" appears later, replace red with black.
  const anchorSaysBlack = /\bblack\s+(high\s+heels?|stiletto(?:es)?|pumps?|stilettos)\b/i.test(cleaned);
  if (anchorSaysBlack) {
    const redHeels = /\b(red|pink|blue|white|gold|silver|green|yellow|purple)\s+(high\s+heels?|stiletto(?:es)?|pumps?|stilettos)\b/gi;
    if (redHeels.test(cleaned)) {
      cleaned = cleaned.replace(redHeels, 'black $2');
      warnings.push('"红色高跟鞋" 与 anchor 中的 "黑色高跟鞋" 矛盾 → 已统一为黑色');
    }
  }

  // ── Fix 4: Panel that mentions "two blacks" but the scene has only
  //     one black male + one Asian female — remove the duplicate.
  if (/\b(black|african)\s+(male|female|man|woman|girl|guy)\s+(and|with|,)\s+(black|african)\s+(male|female|man|woman|girl|guy)\b/i.test(cleaned)) {
    cleaned = cleaned.replace(
      /\b(black|african)\s+(male|female|man|woman|girl|guy)\s+(and|with|,)\s+(black|african)\s+(male|female|man|woman|girl|guy)\b/gi,
      'one black male and one east asian female'
    );
    warnings.push('描述了"两个黑人"但场景只有一黑男一亚女 → 已修正');
  }

  // ── Fix 5: physically impossible simultaneous actions on a single
  //     character — e.g. "his tongue deeply licking her breasts while
  //     his tongue and fingers intensely lick her vagina" (one tongue
  //     cannot lick breasts and vagina at the same time). Simplify to
  //     a single action.
  const impossibleTongue = /\b(his|her)\s+tongue\s+([\w\s,]{2,80}?)\s+while\s+(his|her)\s+tongue\s+([\w\s,]{2,80}?)/i;
  if (impossibleTongue.test(cleaned)) {
    cleaned = cleaned.replace(impossibleTongue, '$1 tongue $2 while $1 fingers $4');
    warnings.push('"一条舌头同时做两件事"在物理上不可能 → 已修正为舌头+手指分工');
  }

  return { text: cleaned, warnings };
}

/**
 * Auto-fill an empty panel by interpolating between its neighbors.
  //
  // Triggered when a panel's image_prompt is missing or has less than
  // ~30 chars of real content after "PanelN:". Without this, Krea2 is
  // given "Panel3: " and renders a blank or random tile, breaking the
  // 3×3 grid.
  //
  // The interpolation strategy:
  //   - If only prev panel exists → repeat prev with a slight progression
  //   - If only next panel exists → anticipate next by reversing from it
  //   - If both → blend the two with a transitional action
  //
  // The generated content is intentionally conservative (re-uses the
  // prev/next panel's setting + camera angle) so it doesn't invent
  // content that contradicts the surrounding panels.
 */
function autoFillPanelContent(
  panelNumber: number,
  prevText: string | null,
  nextText: string | null
): string {
  // Extract a "key props" hint from prev/next: look for vertical shot
  // descriptions, lighting hints, and location phrases.
  const extractShotAndSetting = (text: string): string => {
    const shotMatch = text.match(/\b(vertical|medium|close-up|tight|wide|low-angle|high-angle|over-the-shoulder|side|profile|establishing)\s+(shot|close-up|view|angle|cinematic|frame)\b/i);
    const settingMatch = text.match(/\b(in|inside|at|on|within)\s+(the\s+)?([a-z\s]{3,40}?)(?=,|\.)/i);
    const shot = shotMatch ? shotMatch[0] : 'medium shot';
    const setting = settingMatch ? settingMatch[0] : '';
    return `${shot}${setting ? `, ${setting}` : ''}`;
  };

  const transitionalActions = [
    'continuing the same scene, the moment between actions',
    'a transitional beat as they pause and look at each other',
    'the same setting with tension building between them',
    'continuing the same pose with subtle movement',
    'a brief pause in the action with eye contact',
    'the same characters in the same setting, a transitional moment',
  ];

  const action = transitionalActions[panelNumber % transitionalActions.length];

  if (prevText && nextText) {
    const prevShot = extractShotAndSetting(prevText);
    const nextShot = extractShotAndSetting(nextText);
    return `Vertical medium shot, ${action}, ${prevShot}, characters in the same setting, photorealistic, 8k`;
  }
  if (prevText) {
    const prevShot = extractShotAndSetting(prevText);
    return `Vertical medium shot, ${action}, continuing from previous frame, ${prevShot}, same characters and setting, photorealistic, 8k`;
  }
  if (nextText) {
    const nextShot = extractShotAndSetting(nextText);
    return `Vertical medium shot, ${action}, building toward next frame, ${nextShot}, same characters and setting, photorealistic, 8k`;
  }
  return `Vertical medium shot, ${action}, photorealistic, 8k, cinematic storyboard panel`;
}

export function GridStoryboardMode({
  r18Mode,
  taskManager,
  apiKey,
  displayLang,
  digitalHumanMode,
  selectedGirlfriend,
  onError,
  onSuccess,
  onNavigate,
}: GridStoryboardModeProps) {
  // Step state
  const [step, setStep] = useState<GridStep>('themes');
  const [gridSize, setGridSize] = useState<GridSize>(9);

  // Theme selection state
  const [themeOptions, setThemeOptions] = useState<StoryboardThemeOption[]>([]);
  const [selectedTemplates, setSelectedTemplates] = useState<GridTemplate[]>([]);
  const [templateCategoryFilter, setTemplateCategoryFilter] = useState<string>('全部');
  const [customThemeMode, setCustomThemeMode] = useState(false);
  const [customThemeDescription, setCustomThemeDescription] = useState('');
  const [customThemeCount, setCustomThemeCount] = useState(3);
  const [themeLibraryOpen, setThemeLibraryOpen] = useState(false);
  const [loadingThemeLibrary, setLoadingThemeLibrary] = useState(false);
  const [themeSearchQuery, setThemeSearchQuery] = useState('');
  const [themeCategoryFilter, setThemeCategoryFilter] = useState('');
  const [generatingThemes, setGeneratingThemes] = useState(false);

  // Selected themes (like linear storyboard)
  const [selectedThemes, setSelectedThemes] = useState<StoryboardThemeOption[]>([]);

  // Random theme confirmation state
  const [randomThemes, setRandomThemes] = useState<StoryboardThemeOption[]>([]);
  const [showRandomConfirm, setShowRandomConfirm] = useState(false);

  // Grid task tracking - one per selected theme
  const [gridTasks, setGridTasks] = useState<Array<{ taskId: string; themeTitle: string; status: string; progress?: string; panels?: GridPanel[]; startTime?: number }>>([]);
  const gridPollIntervalsRef = useRef<ReturnType<typeof setInterval>[]>([]);

  // Completed themes - user can click to load any of them
  const [completedThemes, setCompletedThemes] = useState<Array<{ themeTitle: string; panels: GridPanel[]; gridSize: GridSize }>>([]);
  const [activeThemeIdx, setActiveThemeIdx] = useState<number>(0);
  const completedThemesRef = useRef<Array<{ themeTitle: string; panels: GridPanel[]; gridSize: GridSize }>>([]);

  // Per-panel redraw state
  const [redrawPanelIdx, setRedrawPanelIdx] = useState<number | null>(null);
  const streamPanelsRef = useRef<GridPanel[]>([]);

  // ── Generate mode toggle: separate per-panel images vs one composite grid ──
  // When true, txt2img submits one task per panel (like digital-human mode),
  // each going to redrawnPanelImages so they auto-compose after completion.
  // Locked to true when digitalHumanMode is active.
  const [generateSeparatePanels, setGenerateSeparatePanels] = useState(false);
  // Dedicated historyId for the separate-panel generation batch — used by
  // finishedTasks to distinguish these tasks from the composite-grid path.
  const [separatePanelsHistoryId, setSeparatePanelsHistoryId] = useState<string | null>(null);

  // Enforce separate-panel mode when digital-human anchoring is active.
  useEffect(() => {
    if (digitalHumanMode) {
      setGenerateSeparatePanels(true);
    }
  }, [digitalHumanMode]);

  // Panels state
  const [panels, setPanels] = useState<GridPanel[]>([]);
  const [fullPrompt, setFullPrompt] = useState('');
  const [gridPromptWarnings, setGridPromptWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // Multiple images state (API may return multiple grid images)
  // Store images per-theme to support multi-theme switching
  const [gridImagesMap, setGridImagesMap] = useState<Record<number, string[]>>({});
  const [gridImages, setGridImages] = useState<string[]>([]);
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  // Track generating state per-theme
  const [isGeneratingMap, setIsGeneratingMap] = useState<Record<number, boolean>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  // Track historyId per-theme
  const [currentHistoryIdMap, setCurrentHistoryIdMap] = useState<Record<number, string | null>>({});
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);

  // Track task IDs that belong to per-panel redraws (not the original 9-grid generation).
  // We need this so the finishedTasks handler can route redraw images to
  // `redrawnPanelImages[panelIdx]` instead of mixing them with the original grid
  // images, which is what was filling Panel 1 and Panel 2 with the full-grid
  // thumbnails even though the user never redrew them.
  const redrawTaskIdsRef = useRef<Set<string>>(new Set());

  // Tracks the 9 task IDs submitted by handleGenerateImage in digital-human
  // mode (one task per panel, all routing to redrawnPanelImages[panelIdx]).
  // When this set is empty, the 9-panel batch is fully done and we can
  // clear the isGenerating flag for the batch. Each entry is removed as
  // its corresponding task finishes (mirrors the redrawTaskIdsRef pattern).
  const batchTaskIdsRef = useRef<Set<string>>(new Set());

  // Lightbox state
  const [showLightbox, setShowLightbox] = useState(false);

  // History
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<GridHistoryItem[]>(() => getGridHistory());

  // Favorites
  const [favorites, setFavorites] = useState(() => getFavorites());

  // Per-panel redrawn images (cleared when theme changes).
  const [redrawnPanelImages, setRedrawnPanelImages] = useState<Record<number, string[]>>({});

  // Per-panel images and composite sheet saved per theme (themeIdx → data).
  // This is what makes theme switching seamless — each theme's per-panel
  // images are restored when you switch back to it, no collisions.
  const [redrawnPanelImagesMap, setRedrawnPanelImagesMap] = useState<Record<number, Record<number, string[]>>>({});
  const [compositeSheetUrlMap, setCompositeSheetUrlMap] = useState<Record<number, string | null>>({});

  // Frontend-composited 9-panel sheet (data: URL). Built on demand from
  // redrawnPanelImages via composeNinePanelGrid. Only populated when the
  // user clicks "合成/下载" or the main image area in digital-human mode
  // (where we no longer receive a single composite from the model).
  const [compositeSheetUrl, setCompositeSheetUrl] = useState<string | null>(null);
  const [compositing, setCompositing] = useState(false);

  // Lightbox state for redrawn images
  const [showRedrawLightbox, setShowRedrawLightbox] = useState(false);
  const [lightboxImageList, setLightboxImageList] = useState<string[]>([]);
  const [lightboxImageIdx, setLightboxImageIdx] = useState(0);
  const [lightboxPanelIdx, setLightboxPanelIdx] = useState<number | null>(null);

  // Refs
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // Restore session on mount - default to theme selection page
  useEffect(() => {
    // Reset generation lock on mount (in case page was refreshed during generation)
    isGeneratingRef.current = false;

    // Always start at theme selection page (screenshot 3)
    setStep('themes');
    setPanels([]);
    setGridImages([]);
  }, []);

  // Persist session
  useEffect(() => {
    if (panels.length > 0) {
      saveGridSession({
        plot: selectedTemplates[0]?.titleZh || '',
        gridSize,
        panels,
        themeTitle: selectedTemplates[0]?.titleZh,
        historyId: currentHistoryId || undefined,
      });
    }
  }, [panels, gridSize, selectedTemplates, currentHistoryId]);

  // Update fullPrompt whenever panels change
  //
  // Preview builds the SAME prompt that will be submitted in either mode:
  //   - txt2img:  uses the base GRID_HEADER + cleanedBase + Panel1..9
  //   - img2img:  inserts a concise CHARACTER ANCHOR block between
  //               GRID_HEADER and cleanedBase (matches the user's
  //               `[ANCHOR: ...]` working pattern in txt2img prompts)
  //
  // Building the preview with the same anchor as the submit means what
  // the user sees in the prompt editor is exactly what gets sent to the
  // model — no silent differences.
  useEffect(() => {
    if (panels.length > 0) {
      // Use the same 【严格锁定】 format as linear storyboard and handleGenerateImage
      // to ensure consistent character locking across both modes.
      // This format explicitly locks the character's face, features, and proportions
      // without using pronouns like "woman/her" which can cause portrait focus.
      let anchorText: string | undefined;
      if (digitalHumanMode && selectedGirlfriend) {
        const charId = (selectedGirlfriend.id as string).toUpperCase().slice(0, 4);
        anchorText =
          `【严格锁定】严格锁定图中22岁女性（ID:${charId}），完全保留原有面部特征，` +
          `五官轮廓、脸型、眼睛、鼻子、嘴唇、发型、肤色、身材比例完全不变，不做任何面部修改，` +
          `动作流畅不僵硬。超高清8K，写实细节，皮肤质感细腻，无畸变、无模糊、无穿模。`;
      }
      const result = buildFullGridPromptDetailed(panels, panels.length, { anchorText });
      setFullPrompt(result.prompt);
      // Surface auto-fills / logical fixes to the user so they know
      // what was changed before submitting the prompt to Krea2.
      if (result.warnings.length > 0) {
        console.warn(`${GRID_LOG_PREFIX} grid prompt warnings:`, result.warnings);
        setGridPromptWarnings(result.warnings);
        // Also bubble the first warning to the toast so the user notices
        onSuccess(`提示词已自动修复 ${result.warnings.length} 处（空镜续写/逻辑矛盾），请检查预览`);
      } else {
        setGridPromptWarnings([]);
      }
    }
  }, [panels, digitalHumanMode, selectedGirlfriend]);

  // Watch gridTasks and update loading state when all tasks are done
  useEffect(() => {
    if (gridTasks.length === 0) return;
    const allDone = gridTasks.every((t) => ['DONE', 'FAILED'].includes(t.status));
    if (allDone) {
      setLoading(false);
      isGeneratingRef.current = false;
      gridPollIntervalsRef.current = [];
    }
  }, [gridTasks]);

  // Auto-compose the 9-panel sheet when all 9 per-panel images are present
  // and we're in the view step. The composite is what the user sees in the
  // main image area and downloads — it's built locally from the 9 individual
  // per-panel images, so it is ALWAYS a true 3×3 of 9 full panels (one
  // image per tile), no matter what the model produced.
  //
  // We don't auto-compose while generating (would race against the still-
  // arriving panels) — the view-mode UI handles the "in progress" state.
  const allPanelsReady = panels.length > 0 && Array.from({ length: panels.length }, (_, i) => redrawnPanelImages[i]?.[0]).every(Boolean);
  useEffect(() => {
    // Reset the composite whenever we change theme or regenerate — it'll
    // be rebuilt lazily the first time the view renders with all panels
    // ready.
    setCompositeSheetUrl(null);
  }, [panels, activeThemeIdx, currentHistoryId]);

  const buildComposite = useCallback(async () => {
    if (panels.length === 0) return;
    setCompositing(true);
    try {
      const urls = Array.from({ length: panels.length }, (_, i) => redrawnPanelImages[i]?.[0] ?? null);
      const labels = Array.from({ length: panels.length }, (_, i) => `Panel ${i + 1}`);
      // composeGridStoryboard auto-derives the (cols, rows) layout from
      // urls.length, so the composite sheet always matches the user's
      // selected panel count (2×2 / 2×3 / 3×3 / 3×4).
      const url = await composeGridStoryboard(urls, { panelLabels: labels });
      setCompositeSheetUrl(url);
      // Save to per-theme map so the composite is restored on theme switch.
      setCompositeSheetUrlMap((prev) => ({ ...prev, [activeThemeIdx]: url }));
    } catch (err) {
      console.error(`${GRID_LOG_PREFIX} buildComposite failed:`, err);
      onError('合成面板图失败：' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setCompositing(false);
    }
  }, [panels, redrawnPanelImages, onError, activeThemeIdx]);

  // Auto-build the composite when entering the view step with all panels
  // ready (and no composite yet). Skips if user is regenerating.
  useEffect(() => {
    if (step !== 'view') return;
    if (!allPanelsReady) return;
    if (compositeSheetUrl) return;
    if (isGenerating) return;
    if (digitalHumanMode && batchTaskIdsRef.current.size > 0) return;
    void buildComposite();
  }, [step, allPanelsReady, compositeSheetUrl, isGenerating, digitalHumanMode, buildComposite]);

  // Subscribe to finished task images - handles per-theme image tracking
  const { finishedTasks } = useFinishedTaskImages();
  useEffect(() => {
    // Collect all active history IDs from all themes
    const allHistoryIds = new Set<string>();
    if (currentHistoryId) allHistoryIds.add(currentHistoryId);
    Object.values(currentHistoryIdMap).forEach((hid) => { if (hid) allHistoryIds.add(hid); });
    if (sessionStorage.getItem('sb_latest_history_id')) allHistoryIds.add(sessionStorage.getItem('sb_latest_history_id')!);
    // Also track the separate-panel batch history ID.
    if (separatePanelsHistoryId) allHistoryIds.add(separatePanelsHistoryId);

    if (allHistoryIds.size === 0) return;

    // Process finished tasks for each theme
    for (const [taskId, info] of Object.entries(finishedTasks)) {
      const { images, storyboardInfo } = info;
      if (!images || images.length === 0) continue;
      const hid = storyboardInfo?.historyId;
      if (!hid || !allHistoryIds.has(hid)) continue;
      const { panelIdx } = storyboardInfo ?? {};
      if (panelIdx === undefined) continue;

      // ── Distinguish per-panel redraw vs original 9-grid generation.
      // If we registered this taskId when the user clicked "重绘" we treat it
      // as a redraw and route the image only to redrawnPanelImages. Otherwise
      // it is the original storyboard generation and we route to gridImages.
      const isRedraw = redrawTaskIdsRef.current.has(taskId);
      if (isRedraw) redrawTaskIdsRef.current.delete(taskId);

      // Same routing is used for the 9-panel digital-human batch (each
      // per-panel task also lives in batchTaskIdsRef). We check this so
      // we can detect "all 9 panels are done" and clear isGenerating.
      const isBatchTask = batchTaskIdsRef.current.has(taskId);
      if (isBatchTask) batchTaskIdsRef.current.delete(taskId);

      // Find which theme this historyId belongs to
      let themeIdx = -1;
      if (currentHistoryId === hid) {
        themeIdx = activeThemeIdx;
      } else {
        for (const [idx, historyId] of Object.entries(currentHistoryIdMap)) {
          if (historyId === hid) {
            themeIdx = parseInt(idx);
            break;
          }
        }
      }
      if (themeIdx < 0) themeIdx = activeThemeIdx;

      // Collect images for this task
      const newImages: string[] = [];
      if (images.length > 1) {
        for (let i = 0; i < images.length; i++) {
          if (images[i] && !newImages[i]) newImages[i] = images[i];
        }
      } else {
        if (!newImages[panelIdx]) newImages[panelIdx] = images[0];
      }

      if (newImages.length === 0) continue;

      if (isRedraw) {
        // ── Per-panel redraw branch ──
        // The single redrawn image goes to the corresponding panel slot in the
        // active theme's redrawnPanelImages. Do NOT touch gridImagesMap.
        if (themeIdx === activeThemeIdx) {
          setRedrawnPanelImages((prev) => {
            const next = { ...prev };
            for (let i = 0; i < newImages.length; i++) {
              if (newImages[i]) {
                next[i] = [...(prev[i] || []), newImages[i]];
              }
            }
            return next;
          });
          // Also persist to the per-theme map so theme-switching restores it.
          setRedrawnPanelImagesMap((prev) => {
            const themeImages = { ...(prev[activeThemeIdx] || {}) };
            for (let i = 0; i < newImages.length; i++) {
              if (newImages[i]) {
                themeImages[i] = [...(themeImages[i] || []), newImages[i]];
              }
            }
            return { ...prev, [activeThemeIdx]: themeImages };
          });
          // Persist to per-panel image cache so it survives page refresh.
          for (let i = 0; i < newImages.length; i++) {
            if (newImages[i]) {
              cacheStoryboardPanelImages(hid, i, [newImages[i]]).catch(() => {});
            }
          }
          onSuccess?.(`第 ${(panelIdx ?? 0) + 1} 镜图片已生成`);
        }
        // Clear the per-panel loading indicator now that the image arrived.
        setRedrawPanelIdx(null);
        setLoading(false);

        // If this task was part of a 9-panel digital-human batch and the
        // batch is now fully done, clear isGenerating so the UI can
        // settle on the view step. We check batchTaskIdsRef.current.size
        // — when it reaches 0, all N per-panel tasks have completed.
        if (isBatchTask && batchTaskIdsRef.current.size === 0) {
          setIsGenerating(false);
          setIsGeneratingMap((prev) => ({ ...prev, [activeThemeIdx]: false }));
          // Clear the separate-panel history ID since the batch is done.
          setSeparatePanelsHistoryId(null);
          const layoutHint = panels.length >= 9 ? '3×3' : panels.length >= 6 ? '2×3' : '2×2';
          onSuccess?.(`独立 ${panels.length} 张分镜图已全部生成，已自动合成 ${layoutHint} 分镜`);
        }
        continue;
      }

      // ── Original 9-grid generation branch (existing behaviour) ──
      // Update images for this theme
      setGridImagesMap((prev) => {
        const existing = prev[themeIdx] || [];
        const merged = [...existing];
        for (let i = 0; i < newImages.length; i++) {
          if (newImages[i]) merged[i] = newImages[i];
        }
        return { ...prev, [themeIdx]: merged };
      });

      // Update current theme's images if this is the active theme
      if (themeIdx === activeThemeIdx) {
        setGridImages((prev) => {
          const merged = [...prev];
          for (let i = 0; i < newImages.length; i++) {
            if (newImages[i]) merged[i] = newImages[i];
          }
          return merged;
        });
        setStep('view');
      }

      // Set generating to false for this theme
      setIsGeneratingMap((prev) => ({ ...prev, [themeIdx]: false }));
      if (themeIdx === activeThemeIdx) setIsGenerating(false);

      // Cache all images
      for (let i = 0; i < newImages.length; i++) {
        if (newImages[i]) {
          cacheStoryboardPanelImages(hid, i, [newImages[i]]).catch(() => {});
        }
      }

      // Save images to history record for thumbnail display
      const panelImages: Record<number, string[]> = {};
      for (let i = 0; i < newImages.length; i++) {
        if (newImages[i]) panelImages[i] = [newImages[i]];
      }
      updateGridHistoryImages(hid, panelImages);
      // Refresh history list to show thumbnails
      setHistory(getGridHistory());
    }
  }, [finishedTasks, currentHistoryId, currentHistoryIdMap, activeThemeIdx]);

  // ── Theme selection handlers ──

  const handleLoadThemeLibrary = async () => {
    console.log(`${GRID_LOG_PREFIX} handleLoadThemeLibrary called`);
    setThemeLibraryOpen(true);
    setLoadingThemeLibrary(true);
    try {
      const res = await listStoryboardThemes();
      console.log(`${GRID_LOG_PREFIX} handleLoadThemeLibrary success:`, res.themes?.length, 'themes');
      setThemeOptions(res.themes);
    } catch (err) {
      console.error(`${GRID_LOG_PREFIX} handleLoadThemeLibrary error:`, err);
      onError(err instanceof Error ? err.message : '主题库加载失败');
    } finally {
      setLoadingThemeLibrary(false);
    }
  };

  const handleGenerateThemes = async () => {
    console.log(`${GRID_LOG_PREFIX} handleGenerateThemes called, count=${customThemeCount}`);
    setGeneratingThemes(true);
    try {
      const desc = customThemeMode && customThemeDescription.trim() ? customThemeDescription.trim() : undefined;
      const res = await generateStoryboardThemes(r18Mode, customThemeCount, desc || undefined, false);
      console.log(`${GRID_LOG_PREFIX} handleGenerateThemes success:`, res.themes?.length, 'themes');
      setThemeOptions(res.themes);
      setThemeLibraryOpen(true);
      // Auto-select the generated themes
      setSelectedThemes(res.themes);
      onSuccess(`生成了 ${res.themes.length} 个主题，已自动选中，点击"生成九宫格分镜"开始生成`);
    } catch (err) {
      console.error(`${GRID_LOG_PREFIX} handleGenerateThemes error:`, err);
      onError(err instanceof Error ? err.message : '主题生成失败');
    } finally {
      setGeneratingThemes(false);
    }
  };

  const handleToggleTemplate = (template: GridTemplate) => {
    console.log(`${GRID_LOG_PREFIX} handleToggleTemplate:`, template.titleZh);
    setSelectedTemplates((prev) => {
      const exists = prev.some((t) => t.id === template.id);
      if (exists) {
        return prev.filter((t) => t.id !== template.id);
      }
      return [...prev, template];
    });
  };

  const handleLoadTemplate = (template: GridTemplate) => {
    const templatePanels = template.panels.map((p) => ({
      panel_number: p.panel_number,
      scene_description: p.scene_description,
      image_prompt: `${template.basePrompt}\n${p.image_prompt}`,
    }));
    setPanels(templatePanels);
    setGridSize(templatePanels.length as GridSize);
    setStep('edit');
    onSuccess(`已加载模板「${template.titleZh}」，可编辑提示词后生成图片`);
  };

  const handleGenerateSelectedTemplates = () => {
    if (selectedTemplates.length === 0) {
      onError('请至少选择一个模板');
      return;
    }
    // Add all selected templates to completedThemes (same flow as theme library)
    const newCompleted = selectedTemplates.map((template) => ({
      themeTitle: template.titleZh,
      panels: template.panels.map((p) => ({
        panel_number: p.panel_number,
        scene_description: p.scene_description,
        // Format: basePrompt\nPanelX: panel-specific-description (matches API format)
        image_prompt: `${template.basePrompt}\nPanel${p.panel_number}: ${p.image_prompt}`,
      })),
      gridSize: template.panels.length as GridSize,
    }));

    // Merge with existing completedThemes and create history entries
    setCompletedThemes((prev) => {
      const merged = [...prev];
      const newHistoryIdMap: Record<number, string | null> = {};

      for (const entry of newCompleted) {
        const existing = merged.findIndex((t) => t.themeTitle === entry.themeTitle);
        if (existing >= 0) {
          merged[existing] = entry;
        } else {
          merged.push(entry);
        }
        // Create history entry for this template
        const idx = merged.findIndex((t) => t.themeTitle === entry.themeTitle);
        const historyId = addGridHistory({
          plot: entry.themeTitle,
          gridSize: entry.gridSize,
          r18: r18Mode,
          panels: entry.panels,
        });
        newHistoryIdMap[idx] = historyId;
      }

      completedThemesRef.current = merged;

      // Merge history ID map
      setCurrentHistoryIdMap((prevMap) => ({ ...prevMap, ...newHistoryIdMap }));

      // Load first template's panels and show editor with theme tabs
      const first = newCompleted[0];
      setPanels(first.panels);
      setGridSize(first.gridSize);
      setActiveThemeIdx(0);
      setCurrentHistoryId(newHistoryIdMap[0] || null);
      sessionStorage.setItem('sb_latest_history_id', newHistoryIdMap[0] || '');
      setStep('edit');
      setSelectedTemplates([]);

      return merged;
    });

    onSuccess(`已选择 ${selectedTemplates.length} 个模板，点击主题标签切换编辑`);
  };

  // ── Generate grid storyboard using the same API as linear storyboard ──
  // Uses async mode (returns task_id) + polling, identical to linear storyboard flow

  // Cancel a specific task by index - just stop polling and mark as cancelled
  const handleCancelTask = (taskIndex: number) => {
    // Find and clear the polling interval for this task
    const interval = gridPollIntervalsRef.current[taskIndex];
    if (interval) {
      clearInterval(interval);
      gridPollIntervalsRef.current[taskIndex] = undefined as any;
    }
    // Mark as cancelled
    setGridTasks((prev) => {
      const next = [...prev];
      if (next[taskIndex] && ['SUBMITTING', 'RUNNING'].includes(next[taskIndex].status)) {
        next[taskIndex] = { ...next[taskIndex], status: 'FAILED', progress: '已取消' };
      }
      return next;
    });
  };

  // Retry counters for storyboard generation
  const retryCountRef = useRef<Record<number, number>>({});
  const maxRetries = 2;

  // Poll for grid task result - keeps polling until DONE or FAILED (no max limit)
  const startGridTaskPolling = (taskId: string, themeTitle: string, taskIndex: number) => {
    let pollCount = 0;

    const pollInterval = setInterval(async () => {
      pollCount++;

      try {
        const statusRes = await getPromptTaskStatus(taskId);
        console.log(`${GRID_LOG_PREFIX} poll ${pollCount} for ${themeTitle}: status=${statusRes.status}`);

        // Still running - update progress and keep polling
        if (statusRes.status === 'RUNNING' || statusRes.status === 'PENDING') {
          setGridTasks((prev) => {
            const next = [...prev];
            if (next[taskIndex]) {
              next[taskIndex] = {
                ...next[taskIndex],
                status: statusRes.status,
                progress: statusRes.progress || `生成中 (${Math.floor(pollCount * 3 / 60)}分${(pollCount * 3) % 60}秒)`,
              };
            }
            return next;
          });
          return; // keep polling
        }

        // Done or failed - stop polling
        clearInterval(pollInterval);

        if (statusRes.status === 'DONE' && statusRes.result) {
          let resultPanels = statusRes.result.storyboard || [];

          // Check if panels have empty content - retry if needed
          const emptyPanels = resultPanels.filter((p: GridPanel) => !p.scene_description?.trim() || !p.image_prompt?.trim());
          const retryCount = retryCountRef.current[taskIndex] || 0;

          if (emptyPanels.length > 0 && retryCount < maxRetries) {
            // Has empty panels - retry
            retryCountRef.current[taskIndex] = retryCount + 1;
            console.warn(`${GRID_LOG_PREFIX} ${themeTitle} has ${emptyPanels.length} empty panels, retrying (${retryCount + 1}/${maxRetries})...`);

            setGridTasks((prev) => {
              const next = [...prev];
              if (next[taskIndex]) {
                next[taskIndex] = {
                  ...next[taskIndex],
                  status: 'RUNNING',
                  progress: `重试中 (${retryCount + 1}/${maxRetries}) - ${emptyPanels.length}格为空`,
                };
              }
              return next;
            });

            // Retry the generation
            try {
              const retryRes = await generateStoryboardOutline(
                selectedThemes[taskIndex]?.id || 0,
                themeTitle,
                gridSize,
                r18Mode,
                true
              );
              if (retryRes.task_id) {
                // Start new polling for retry
                startGridTaskPolling(retryRes.task_id, themeTitle, taskIndex);
                return;
              } else if (retryRes.storyboard?.length) {
                // Sync result - use retry result
                resultPanels = retryRes.storyboard;
                const stillEmpty = resultPanels.filter((p: GridPanel) => !p.scene_description?.trim() || !p.image_prompt?.trim());
                if (stillEmpty.length > 0 && retryCount + 1 < maxRetries) {
                  // Still empty, will retry on next poll check - but since sync, just use what we have
                }
              }
            } catch (retryErr) {
              console.error(`${GRID_LOG_PREFIX} retry failed for ${themeTitle}:`, retryErr);
            }
          }

          // Post-process panels for clothing progression
          const processedPanels = applyClothingProgression(resultPanels);

          setGridTasks((prev) => {
            const next = [...prev];
            if (next[taskIndex]) {
              next[taskIndex] = {
                ...next[taskIndex],
                status: 'DONE',
                panels: processedPanels,
                progress: `完成 ${processedPanels.length} 格`,
              };
            }
            return next;
          });
          // Add to completedThemes immediately when done
          const completedEntry = {
            themeTitle,
            panels: processedPanels,
            gridSize: processedPanels.length as GridSize,
          };
          setCompletedThemes((prev) => {
            const existing = prev.findIndex((t) => t.themeTitle === themeTitle);
            if (existing >= 0) {
              const next = [...prev];
              next[existing] = completedEntry;
              completedThemesRef.current = next;
              return next;
            }
            const next = [...prev, completedEntry];
            completedThemesRef.current = next;
            return next;
          });
        } else if (statusRes.status === 'FAILED') {
          // Retry on failure
          const retryCount = retryCountRef.current[taskIndex] || 0;
          if (retryCount < maxRetries) {
            retryCountRef.current[taskIndex] = retryCount + 1;
            console.warn(`${GRID_LOG_PREFIX} ${themeTitle} failed, retrying (${retryCount + 1}/${maxRetries})...`);

            setGridTasks((prev) => {
              const next = [...prev];
              if (next[taskIndex]) {
                next[taskIndex] = {
                  ...next[taskIndex],
                  status: 'RUNNING',
                  progress: `重试中 (${retryCount + 1}/${maxRetries})`,
                };
              }
              return next;
            });

            // Retry the generation
            try {
              const retryRes = await generateStoryboardOutline(
                selectedThemes[taskIndex]?.id || 0,
                themeTitle,
                gridSize,
                r18Mode,
                true
              );
              if (retryRes.task_id) {
                startGridTaskPolling(retryRes.task_id, themeTitle, taskIndex);
                return;
              }
            } catch (retryErr) {
              console.error(`${GRID_LOG_PREFIX} retry failed for ${themeTitle}:`, retryErr);
            }
          }

          setGridTasks((prev) => {
            const next = [...prev];
            if (next[taskIndex]) {
              next[taskIndex] = {
                ...next[taskIndex],
                status: 'FAILED',
                progress: statusRes.error || '生成失败',
              };
            }
            return next;
          });
        }
      } catch (err) {
        console.warn(`${GRID_LOG_PREFIX} poll error for ${themeTitle}:`, err);
        // Don't stop polling on network errors - keep trying
      }
    }, 3000); // poll every 3 seconds

    gridPollIntervalsRef.current.push(pollInterval);
  };

  // Cancel all ongoing tasks - stop polling and mark as cancelled
  const handleCancelAll = () => {
    // Stop all polling intervals
    gridPollIntervalsRef.current.forEach((interval) => clearInterval(interval));
    gridPollIntervalsRef.current = [];

    // Mark running tasks as cancelled
    setGridTasks((prev) =>
      prev.map((t) =>
        ['SUBMITTING', 'RUNNING'].includes(t.status)
          ? { ...t, status: 'FAILED', progress: '已取消' }
          : t
      )
    );

    setLoading(false);
    isGeneratingRef.current = false;
    onError('已取消生成任务');
  };

  // Check if all tasks are complete - just add to completedThemes
  // The useEffect watching gridTasks handles setting loading=false
  const checkAllTasksComplete = () => {
    setGridTasks((current) => {
      const allDone = current.every((t) => ['DONE', 'FAILED'].includes(t.status));
      if (allDone) {
        const successful = current.filter((t) => t.status === 'DONE' && t.panels?.length);
        if (successful.length > 0) {
          const newCompleted = successful.map((t) => ({
            themeTitle: t.themeTitle,
            panels: t.panels!,
            gridSize: t.panels!.length as GridSize,
          }));
          completedThemesRef.current = newCompleted;
          setCompletedThemes(newCompleted);
          // Auto-load first theme only if no theme is currently displayed
          if (panels.length === 0 || step === 'themes') {
            setPanels(successful[0].panels!);
            setGridSize(successful[0].panels!.length as GridSize);
            setActiveThemeIdx(0);
            setStep('edit');
            // Create history entry for first theme only if none exists
            let historyId = currentHistoryIdMap[0];
            if (!historyId) {
              historyId = addGridHistory({
                plot: successful[0].themeTitle || `九宫格主题1`,
                grid_size: successful[0].panels!.length,
                r18: r18Mode,
                panels: successful[0].panels!,
              });
            }
            setCurrentHistoryId(historyId);
            setCurrentHistoryIdMap((prev) => ({ ...prev, [0]: historyId }));
            sessionStorage.setItem('sb_latest_history_id', historyId);
          }
          setTimeout(() => onSuccess(`${successful.length} 个主题分镜已生成完成`), 0);
        } else {
          setTimeout(() => onError('所有主题的分镜生成均失败，请重试'), 0);
        }
      }
      return current;
    });
  };

  // Load a theme by its themeTitle (works for both gridTasks and completedThemes)
  const handleLoadTheme = (themeTitle: string) => {
    // Find in completedThemes first
    let theme = completedThemesRef.current.find((t) => t.themeTitle === themeTitle);
    if (!theme) theme = completedThemes.find((t) => t.themeTitle === themeTitle);
    // Also check gridTasks for DONE status
    if (!theme) {
      const task = gridTasks.find((t) => t.themeTitle === themeTitle && t.status === 'DONE');
      if (task?.panels) {
        theme = { themeTitle: task.themeTitle, panels: task.panels, gridSize: task.panels.length as GridSize };
      }
    }
    if (theme) {
      // Save current theme's images and generating state before switching
      setGridImagesMap((prev) => ({ ...prev, [activeThemeIdx]: gridImages }));
      setIsGeneratingMap((prev) => ({ ...prev, [activeThemeIdx]: isGenerating }));
      setCurrentHistoryIdMap((prev) => ({ ...prev, [activeThemeIdx]: currentHistoryId }));
      // Save per-panel images per theme so they are restored when switching back.
      setRedrawnPanelImagesMap((prev) => ({
        ...prev,
        [activeThemeIdx]: redrawnPanelImages,
      }));
      // Save composite sheet per theme too.
      setCompositeSheetUrlMap((prev) => ({
        ...prev,
        [activeThemeIdx]: compositeSheetUrl,
      }));

      // Restore new theme's images and state
      const themeIdx = completedThemes.findIndex((t) => t.themeTitle === themeTitle);
      const newThemeIdx = themeIdx >= 0 ? themeIdx : activeThemeIdx;
      const newImages = gridImagesMap[newThemeIdx] || [];
      const newIsGenerating = isGeneratingMap[newThemeIdx] || false;
      const newHistoryId = currentHistoryIdMap[newThemeIdx] || null;
      // Restore per-panel images for the target theme (or empty if not yet generated).
      const newRedrawnPanelImages = redrawnPanelImagesMap[newThemeIdx] || {};
      const newCompositeSheet = compositeSheetUrlMap[newThemeIdx] || null;

      setGridImages(newImages);
      setActiveImageIdx(0);
      setIsGenerating(newIsGenerating);
      setCurrentHistoryId(newHistoryId);
      setRedrawnPanelImages(newRedrawnPanelImages);
      setCompositeSheetUrl(newCompositeSheet);
      setPanels(theme.panels);
      setGridSize(theme.gridSize);
      setActiveThemeIdx(newThemeIdx);
      // Restore step: if generating, show view; if has images, show view; else show edit
      if (newIsGenerating) {
        setStep('view');
      } else if (newImages.length > 0) {
        setStep('view');
      } else {
        setStep('edit');
      }
      // Note: Do NOT create new history entry when loading a theme - this causes duplicates
      onSuccess(`已加载「${theme.themeTitle}」分镜`);
    }
  };

  // ── Random: pick 3 themes from library and add to theme pool ──

  const handleRandomClick = async () => {
    console.log(`${GRID_LOG_PREFIX} handleRandomClick called`);
    // If we don't have themes loaded yet, load them first
    let themes = themeOptions;
    if (themes.length === 0) {
      try {
        const res = await listStoryboardThemes();
        themes = res.themes;
        setThemeOptions(res.themes);
      } catch (err) {
        onError('主题库加载失败，无法随机选择');
        return;
      }
    }
    // Pick 3 random themes and add to themeOptions for display
    const shuffled = [...themes].sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, 3);
    // Add to themeOptions if not already there
    setThemeOptions((prev) => {
      const existingIds = new Set(prev.map((t) => t.id));
      const newThemes = picked.filter((t) => !existingIds.has(t.id));
      return [...prev, ...newThemes];
    });
    // Auto-select the 3 random themes
    setSelectedThemes(picked);
    onSuccess(`已随机选择 3 个主题，点击"生成九宫格分镜"按钮开始生成`);
  };

  // Toggle theme selection
  const handleToggleTheme = (theme: StoryboardThemeOption) => {
    setSelectedThemes((prev) => {
      const exists = prev.some((t) => t.id === theme.id);
      if (exists) {
        return prev.filter((t) => t.id !== theme.id);
      }
      return [...prev, theme];
    });
  };

  // Ref to prevent concurrent generation calls
  const isGeneratingRef = useRef(false);

  // Generate grid storyboard from the first selected theme
  const handleGenerateGridStoryboard = async () => {
    console.log(`${GRID_LOG_PREFIX} handleGenerateGridStoryboard called, selectedThemes=${selectedThemes.length}`);
    if (selectedThemes.length === 0) {
      onError('请先选择一个主题');
      return;
    }

    // Clear any existing polling
    gridPollIntervalsRef.current.forEach((interval) => clearInterval(interval));
    gridPollIntervalsRef.current = [];

    // Prevent concurrent generation
    if (isGeneratingRef.current) {
      console.log(`${GRID_LOG_PREFIX} generation already in progress`);
      return;
    }
    isGeneratingRef.current = true;
    setLoading(true);

    // Generate for ALL selected themes in parallel
    const tasks: Array<{ taskId: string; themeTitle: string; status: string; progress?: string; panels?: GridPanel[]; startTime?: number }> = [];

    for (const theme of selectedThemes) {
      console.log(`${GRID_LOG_PREFIX} submitting task for theme: ${theme.title}`);
      tasks.push({ taskId: '', themeTitle: theme.title, status: 'SUBMITTING', startTime: Date.now() });
    }
    setGridTasks([...tasks]);

    // Submit all tasks in parallel
    const results = await Promise.allSettled(
      selectedThemes.map(async (theme, index) => {
        try {
          const res = await generateStoryboardOutline(theme.id, theme.title, gridSize, r18Mode, true);
          if (res.task_id) {
            setGridTasks((prev) => {
              const next = [...prev];
              next[index] = { ...next[index], taskId: res.task_id!, status: 'RUNNING' };
              return next;
            });
            return { taskId: res.task_id, themeTitle: theme.title, index };
          } else if (res.storyboard?.length) {
            // Check for empty panels
            const emptyPanels = res.storyboard.filter((p: GridPanel) => !p.scene_description?.trim() || !p.image_prompt?.trim());
            const retryCount = retryCountRef.current[index] || 0;

            if (emptyPanels.length > 0 && retryCount < maxRetries) {
              // Has empty panels - retry
              retryCountRef.current[index] = retryCount + 1;
              console.warn(`${GRID_LOG_PREFIX} ${theme.title} has ${emptyPanels.length} empty panels, retrying (${retryCount + 1}/${maxRetries})...`);

              // Retry the generation (async mode)
              const retryRes = await generateStoryboardOutline(theme.id, theme.title, gridSize, r18Mode, true);
              if (retryRes.task_id) {
                setGridTasks((prev) => {
                  const next = [...prev];
                  next[index] = { ...next[index], taskId: retryRes.task_id!, status: 'RUNNING' };
                  return next;
                });
                return { taskId: retryRes.task_id, themeTitle: theme.title, index };
              } else if (retryRes.storyboard?.length) {
                res.storyboard = retryRes.storyboard;
              }
            }

            // Post-process panels for clothing progression
            const processedPanels = applyClothingProgression(res.storyboard);
            setGridTasks((prev) => {
              const next = [...prev];
              next[index] = { ...next[index], status: 'DONE', panels: processedPanels };
              return next;
            });
            return { taskId: '', themeTitle: theme.title, index, panels: processedPanels };
          }
          throw new Error('返回的分镜为空');
        } catch (err) {
          setGridTasks((prev) => {
            const next = [...prev];
            next[index] = { ...next[index], status: 'FAILED', progress: err instanceof Error ? err.message : '生成失败' };
            return next;
          });
          return { taskId: '', themeTitle: theme.title, index };
        }
      }),
    );

    // Start polling for tasks that got a task_id
    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value?.taskId) {
        startGridTaskPolling(result.value.taskId, result.value.themeTitle, result.value.index);
      }
    });

    onSuccess(`已为 ${selectedThemes.length} 个主题提交分镜生成任务`);
  };

  const handleToggleLibraryTheme = (theme: StoryboardThemeOption) => {
    handleToggleTheme(theme);
  };

  const handleConfirmLibraryThemes = () => {
    setThemeLibraryOpen(false);
    onSuccess(`已选择 ${selectedThemes.length} 个主题，点击"生成九宫格分镜"按钮开始生成`);
  };

  // ── Panel editing handlers ──

  const handleUpdatePanel = useCallback((idx: number, field: 'scene_description' | 'image_prompt', value: string) => {
    setPanels((prev) => {
      const next = [...prev];
      if (next[idx]) {
        next[idx] = { ...next[idx], [field]: value };
      }
      return next;
    });
  }, []);

  const handleFullPromptChange = useCallback((prompt: string) => {
    setFullPrompt(prompt);
  }, []);

  // ── Image generation handler (single grid image) ──

  const handleGenerateImage = useCallback(async () => {
    if (!fullPrompt.trim()) return;
    if (taskManager.isFull) { onError('任务队列已满'); return; }

    console.log(`${GRID_LOG_PREFIX} handleGenerateImage called, prompt length=${fullPrompt.length}`);

    // Get theme title from completedThemes or gridTasks for THIS theme index
    const themeTitle = completedThemesRef.current[activeThemeIdx]?.themeTitle
      || gridTasks[activeThemeIdx]?.themeTitle
      || selectedTemplates[0]?.titleZh
      || `九宫格${activeThemeIdx + 1}`;

    // Reuse existing history ID for this theme if available, otherwise create new
    let historyId = currentHistoryIdMap[activeThemeIdx];
    if (!historyId) {
      historyId = addGridHistory({
        plot: themeTitle,
        grid_size: panels.length,
        r18: r18Mode,
        panels,
      });
    }
    setCurrentHistoryId(historyId);
    setCurrentHistoryIdMap((prev) => ({ ...prev, [activeThemeIdx]: historyId }));
    sessionStorage.setItem('sb_latest_history_id', historyId);

    setIsGenerating(true);
    setIsGeneratingMap((prev) => ({ ...prev, [activeThemeIdx]: true }));
    setStep('view');
    setGridImages([]);
    setActiveImageIdx(0);
    // Save images for current theme index
    setGridImagesMap((prev) => ({ ...prev, [activeThemeIdx]: [] }));
    // Reset per-panel redrawn images since the user is regenerating the whole grid.
    setRedrawnPanelImages({});
    // Reset the batch tracker so the finishedTasks effect knows this is a
    // fresh 9-task digital-human batch.
    batchTaskIdsRef.current.clear();
    // Reset the frontend-composited sheet so the view shows a fresh build.
    setCompositeSheetUrl(null);

    let imagePath = selectedGirlfriend?.portraitUrl || '';
    let downloadUrl = '';
    if (digitalHumanMode && selectedGirlfriend) {
      try {
        const file = await (async () => {
          const res = await fetch(selectedGirlfriend.portraitUrl);
          const blob = await res.blob();
          return new File([blob], `${selectedGirlfriend.id}.jpg`, { type: blob.type || 'image/jpeg' });
        })();
        const result = await uploadImage(apiKey, file);
        imagePath = result.imagePath;
        downloadUrl = result.downloadUrl;
      } catch {
        onError('AI 女友图片上传失败');
        setIsGenerating(false);
        return;
      }
    }

    // Submit image generation tasks (may produce multiple images)
    // We submit one task per expected image (usually 1-2)
    const imageCount = 2; // Request 2 images by default

    // ── Determine the effective generation mode ────────────────────────────
    // digitalHumanMode always uses separate-per-panel tasks (character anchor).
    // For txt2img, the user can choose via the generateSeparatePanels toggle.
    const useSeparatePanels = digitalHumanMode || generateSeparatePanels;

    try {
      if (useSeparatePanels && selectedGirlfriend && digitalHumanMode) {
        // ── Digital human mode: 9-PANEL = 9 SEPARATE img2img tasks ──
        //
        // Why one task per panel (instead of one big grid task).
        //
        // Empirically we saw two failure modes when we asked the model to
        // render all 9 panels in ONE img2img call with a strong face
        // reference image:
        //
        //   A. The model collapses to a wide strip of three half-faces
        //      (a horizontal layout with 3 large tiles, each 1/3 of a
        //      face) — exactly what the user reported in the screenshot.
        //   B. The model overemphasises layout instructions and renders
        //      tiny abstract tiles with no usable scene content.
        //
        // The reliable path — same one the linear storyboard page uses for
        // every panel — is to issue 9 INDEPENDENT img2img tasks, one per
        // panel, each with `count=1` and a per-panel prompt that contains
        // NO layout / grid / 9-panel instructions at all. The UI then
        // arranges the 9 results in a 3×3 sheet (and `composeGridStoryboard`
        // stitches them into a single PNG for download).
        //
        // The per-panel prompt is exactly what `panels[i].image_prompt`
        // already contains (the text after `PanelN:` in the assembled
        // prompt). We strip the `PanelN:` prefix because that label only
        // makes sense inside a single 9-panel composite prompt — a
        // standalone task should just describe the scene.
        //
        // For the anchor, we use the same Chinese `【严格锁定】` text as
        // `AIPromptPage.handleStoryboardGenerateImage` (the linear
        // storyboard page), which the user has confirmed works.

        const charId = (selectedGirlfriend.id as string).toUpperCase().slice(0, 4);
        const anchorPrompt =
          `【严格锁定】严格锁定图中22岁女性（ID:${charId}），完全保留原有面部特征，` +
          `五官轮廓、脸型、眼睛、鼻子、嘴唇、发型、肤色、身材比例完全不变，不做任何面部修改，` +
          `动作流畅不僵硬。超高清8K，写实细节，皮肤质感细腻，无畸变、无模糊、无穿模。`;

        // Track the 9 task IDs in redrawTaskIdsRef so the finishedTasks
        // handler routes their images into `redrawnPanelImages[panelIdx]`
        // (the existing redraw branch). This makes the new 9-task flow
        // indistinguishable from the per-panel redraw flow in the rest of
        // the component — we reuse the same UI states without touching
        // the finishedTasks effect.
        const submittedTaskIds: string[] = [];
        let submittedCount = 0;
        let skippedEmpty = 0;

        for (let i = 0; i < panels.length; i++) {
          const panel = panels[i];

          // Extract the per-panel text. Strip "PanelN:" prefix and any
          // leftover single-shot / no-grid qualifiers that the per-panel
          // redraw path added — for a true standalone panel those words
          // are harmless, but they don't help either.
          const rawPrompt = panel.image_prompt || panel.scene_description || '';
          const panelMatch = rawPrompt.match(/Panel\d+:\s*(.*)/s);
          let panelText = (panelMatch ? panelMatch[1] : rawPrompt).trim();

          if (panelText.length < 20) {
            // Skip near-empty panels rather than submit a meaningless task.
            skippedEmpty++;
            console.warn(`${GRID_LOG_PREFIX} skipping empty panel ${i + 1}`);
            continue;
          }

          const finalPrompt = `${anchorPrompt}\n\n${panelText}`;
          const nodes = [
            { nodeId: '291', fieldName: 'prompt', fieldValue: finalPrompt, description: 'prompt' },
            { nodeId: '172', fieldName: 'value', fieldValue: '9', description: 'width' },
            { nodeId: '173', fieldName: 'value', fieldValue: '16', description: 'height' },
            { nodeId: '269', fieldName: 'value', fieldValue: '1', description: 'count' },
            { nodeId: '104', fieldName: 'image', fieldValue: downloadUrl || imagePath, description: 'image' },
            { nodeId: '273', fieldName: 'value', fieldValue: 'false', description: 'enhance' },
          ];

          try {
            const tid = await taskManager.addTask(
              'img2img',
              nodes,
              finalPrompt,
              WORKFLOW.IMAGE_TO_IMAGE,
              undefined,
              { historyId, panelIdx: i },
              'storyboard',
              themeTitle,
              i + 1,
            );
            submittedTaskIds.push(tid);
            redrawTaskIdsRef.current.add(tid);
            // Register in the batch tracker so finishedTasks knows when the
            // full 9-panel batch has completed (used to clear isGenerating
            // and trigger composite rebuild).
            batchTaskIdsRef.current.add(tid);
            submittedCount++;
            console.log(`${GRID_LOG_PREFIX} panel ${i + 1} task submitted, taskId=${tid}`);
          } catch (panelErr) {
            console.error(`${GRID_LOG_PREFIX} panel ${i + 1} submit failed:`, panelErr);
          }
        }

        if (submittedCount === 0) {
          throw new Error('所有 9 镜的提示词均为空，无法生成');
        }
        console.log(
          `${GRID_LOG_PREFIX} submitted ${submittedCount} per-panel img2img tasks ` +
          `(skipped ${skippedEmpty} empty)`,
        );
        onSuccess(
          `已为 ${submittedCount} 个分镜提交图生图任务${skippedEmpty ? `（跳过 ${skippedEmpty} 个空白镜）` : ''}，` +
          `完成后将自动合成 ${panels.length >= 9 ? '3×3' : panels.length >= 6 ? '2×3' : '2×2'} 分镜`,
        );
      } else if (useSeparatePanels && !digitalHumanMode) {
        // ── Txt2img separate panel mode ─────────────────────────────────
        //
        // User toggled "一键生成独立9张" in txt2img mode (no character anchor).
        // We submit one txt2img task per panel, each going to redrawnPanelImages
        // so they auto-compose after all complete — same UX as digital-human mode.
        //
        // We create a dedicated historyId so finishedTasks can distinguish
        // these separate-panel tasks from any concurrent composite-grid tasks.

        const sepHistoryId = addGridHistory({
          plot: `${themeTitle}（独立分镜）`,
          grid_size: panels.length,
          r18: r18Mode,
          panels,
        });
        setSeparatePanelsHistoryId(sepHistoryId);

        let submittedCount = 0;
        let skippedEmpty = 0;

        for (let i = 0; i < panels.length; i++) {
          const panel = panels[i];
          const rawPrompt = panel.image_prompt || panel.scene_description || '';
          const panelMatch = rawPrompt.match(/Panel\d+:\s*(.*)/s);
          let panelText = (panelMatch ? panelMatch[1] : rawPrompt).trim();

          if (panelText.length < 20) {
            skippedEmpty++;
            continue;
          }

          const finalPrompt = withQualityBoost(panelText);
          const txt2imgOptions = buildUnifiedTxt2ImgOptions(finalPrompt);
          txt2imgOptions.imageCount = 1; // one panel = one image
          txt2imgOptions.width = 832;
          txt2imgOptions.height = 1475; // ~9:16
          const nodes = buildTxt2ImgNodeList(txt2imgOptions);

          try {
            const tid = await taskManager.addTask(
              'txt2img',
              nodes,
              finalPrompt,
              undefined,
              undefined,
              { historyId: sepHistoryId, panelIdx: i },
              'storyboard',
              themeTitle,
              i + 1,
            );
            redrawTaskIdsRef.current.add(tid);
            batchTaskIdsRef.current.add(tid);
            submittedCount++;
          } catch (panelErr) {
            console.error(`${GRID_LOG_PREFIX} panel ${i + 1} txt2img submit failed:`, panelErr);
          }
        }

        if (submittedCount === 0) {
          throw new Error('所有分镜的提示词均为空，无法生成');
        }
        onSuccess(
          `已为 ${submittedCount} 个分镜提交独立图生图任务，${skippedEmpty > 0 ? `跳过 ${skippedEmpty} 个空白镜，` : ''}完成后自动合成`,
        );
      } else {
        // ── Default: one composite grid image (existing behaviour) ────────
        const storyboardInfo = { historyId, panelIdx: 0 };
        const finalPrompt = withQualityBoost(fullPrompt);
        const txt2imgOptions = buildUnifiedTxt2ImgOptions(finalPrompt);
        txt2imgOptions.imageCount = imageCount;
        const nodes = buildTxt2ImgNodeList(txt2imgOptions);
        await taskManager.addTask('txt2img', nodes, finalPrompt, undefined, undefined, storyboardInfo, 'storyboard', themeTitle, 1);
        onSuccess('九宫格合成图生成中...');
      }
      console.log(`${GRID_LOG_PREFIX} task(s) submitted successfully`);
    } catch (err) {
      console.error(`${GRID_LOG_PREFIX} handleGenerateImage error:`, err);
      onError(err instanceof Error ? err.message : '生成失败');
      setIsGenerating(false);
    }
  }, [fullPrompt, panels, taskManager, onError, onSuccess, digitalHumanMode, selectedGirlfriend, apiKey, r18Mode, selectedTemplates, generateSeparatePanels]);

  // ── Regenerate handler ──

  const handleRegenerate = useCallback(async () => {
    if (!fullPrompt.trim() || isGenerating || isGeneratingMap[activeThemeIdx]) return;
    if (taskManager.isFull) { onError('任务队列已满'); return; }
    await handleGenerateImage();
  }, [fullPrompt, isGenerating, isGeneratingMap, activeThemeIdx, taskManager, onError, handleGenerateImage]);

  // ── Per-panel smart edit: modify prompt to emphasize variety ──
  // (The regenerateGridPanel API is not available, so we use a smart edit approach:
  // when user clicks "重绘", we auto-enhance the panel's prompt with diverse actions/clothing)

  const sexyOutfits = [
    'sexy lace lingerie',
    'slip satin dress',
    'tight mini skirt with crop top',
    'V-neck silk blouse unbuttoned',
    'leather mini dress',
    'off-shoulder bodysuit',
    'sheer mesh top',
    'wrap dress with deep neckline',
    'corset with garter belt',
    'backless halter top',
  ];

  const undressingActions = [
    'unbuttoning her blouse',
    'slipping off her dress zipper',
    'pulling down her skirt',
    'unhooking her bra',
    'sliding off her straps',
    'peeling off her stockings',
    'wriggling out of her tight dress',
  ];

  // ── Per-panel redraw: use same API as linear storyboard ──

  const handleRedrawPanel = useCallback(async (idx: number) => {
    if (idx < 0 || idx >= panels.length) return;
    const panelSnapshot = panels[idx];
    console.log(`[Redraw] === START panel=${panelSnapshot.panel_number} idx=${idx} ===`);
    setRedrawPanelIdx(idx);
    setLoading(true);

    // ── Build the single-panel prompt.
    // The LLM generates a 9-panel storyboard prompt that contains the shared
    // "cinematic storyboard grid in strict 9:16 vertical aspect ratio,
    // 9 panels arranged in 3×3 grid, ..." prefix. For a single-panel redraw
    // we must:
    //   1. Strip the "3×3 grid" / "9 panels" prefix.
    //   2. Strip the leading "Panel N:" / "PanelN:" markers (they are 9-grid
    //      indices that confuse Krea2 into rendering the full 9-grid).
    //   3. NEUTRALIZE any plural-character-coherence phrases inherited from
    //      the template basePrompt, e.g.:
    //        - "consistent young asian woman throughout all panels"
    //        - "identical character face and body proportions preserved in every panel"
    //      These plural phrases still hint "this is one of N panels" and make
    //      Krea2 lay out a grid even when we add "single cinematic shot".
    //      Replace them with singular equivalents so the model renders ONE shot.
    //   4. Prepend a "single cinematic vertical frame" hint so Krea2 always
    //      treats this as a single full-frame image, not a storyboard split.
    const rawPrompt = panelSnapshot.image_prompt || panelSnapshot.scene_description || '';

    const SINGLE_PANEL_HINT =
      'single cinematic vertical frame, full frame single subject, focused on this moment only, no grid layout, no multiple panels, no storyboard split, single subject only, ';

    // Strip the "9 panels arranged in 3×3 grid" prefix anywhere in the prompt.
    const NINE_GRID_REGEX = /cinematic storyboard grid[^,]*,\s*9 panels arranged in\s*(?:3×3|3x3)\s*grid,?\s*/gi;

    // Neutralize any plural-character-coherence phrases inherited from the
    // template basePrompt so Krea2 does not interpret the prompt as describing
    // ONE panel out of MANY (which causes it to lay out a grid anyway).
    // We replace each plural phrase with a singular equivalent.
    const PLURAL_NEUTRALIZERS: Array<[RegExp, string]> = [
      [/consistent\s+(\w[\w\s,-]{0,80}?)\s+throughout\s+all\s+panels/gi,
        'consistent $1 in this single shot'],
      [/consistent\s+(\w[\w\s,-]{0,80}?)\s+across\s+all\s+panels/gi,
        'consistent $1 in this single shot'],
      [/identical\s+(\w[\w\s,-]{0,80}?)\s+preserved\s+in\s+every\s+panel/gi,
        'identical $1 in this single shot'],
      [/preserved\s+in\s+every\s+panel/gi, 'preserved in this single shot'],
      [/throughout\s+all\s+panels/gi, 'in this single shot'],
      [/across\s+all\s+panels/gi, 'in this single shot'],
      [/in\s+every\s+panel/gi, 'in this single shot'],
      [/in\s+all\s+\d+\s+panels/gi, 'in this single shot'],
      [/\b9\s+panels\b/gi, 'this single shot'],
      [/\b9-panel\s+grid\b/gi, 'this single shot'],
      [/\b3×3\s+grid\b/gi, 'this single shot'],
      [/\b3x3\s+grid\b/gi, 'this single shot'],
      [/\bmulti-panel\b/gi, 'single panel'],
      [/\bmultiple\s+panels\b/gi, 'this single shot'],
    ];

    let cleanedPrompt = rawPrompt
      .replace(NINE_GRID_REGEX, '')
      .replace(/^Panel\d+:\s*/gi, '')
      .replace(/\nPanel\d+:\s*/gi, '\n')
      .trim();

    for (const [regex, replacement] of PLURAL_NEUTRALIZERS) {
      cleanedPrompt = cleanedPrompt.replace(regex, replacement);
    }

    const finalPrompt = withQualityBoost(SINGLE_PANEL_HINT + cleanedPrompt, { force: true });
    console.log(`[Redraw] cleaned prompt: ${finalPrompt.slice(0, 200)}`);

    if (taskManager.isFull) {
      console.warn('[Redraw] taskManager.isFull=true');
      onError('任务队列已满，无法自动生成图片，请稍后重试');
      setRedrawPanelIdx(null);
      setLoading(false);
      return;
    }

    const historyId = currentHistoryIdMap[activeThemeIdx];
    const themeTitle =
      completedThemesRef.current[activeThemeIdx]?.themeTitle ||
      gridTasks[activeThemeIdx]?.themeTitle ||
      selectedTemplates[0]?.titleZh ||
      `九宫格${activeThemeIdx + 1}`;
    const storyboardInfo = { historyId: historyId ?? '', panelIdx: idx };
    console.log(`[Redraw] submitting: panelIdx=${idx} promptLen=${finalPrompt.length}`);

    try {
      if (digitalHumanMode && selectedGirlfriend) {
        console.log('[Redraw] img2img path');
        let downloadUrl = selectedGirlfriend.portraitUrl;
        let imgPath = selectedGirlfriend.portraitUrl;
        try {
          const file = await (async () => {
            const res = await fetch(selectedGirlfriend.portraitUrl);
            const blob = await res.blob();
            return new File([blob], `${selectedGirlfriend.id}.jpg`, { type: blob.type || 'image/jpeg' });
          })();
          const result = await uploadImage(apiKey, file);
          imgPath = result.imagePath;
          downloadUrl = result.downloadUrl;
        } catch (e) {
          console.warn('[Redraw] img2img upload failed:', e);
        }
        const charId = (selectedGirlfriend.id as string).toUpperCase().slice(0, 4);
        const anchorPrompt = `【严格锁定】严格锁定图中22岁女性（ID:${charId}），完全保留原有面部特征，五官轮廓、脸型、眼睛、鼻子、嘴唇、发型、肤色、身材比例完全不变，不做任何面部修改，动作流畅不僵硬。超高清8K，写实细节，皮肤质感细腻，无畸变、无模糊、无穿模。`;
        const imgFinalPrompt = `${anchorPrompt}\n\n${finalPrompt}`;
        const nodes = [
          { nodeId: '291', fieldName: 'prompt', fieldValue: imgFinalPrompt, description: 'prompt' },
          { nodeId: '172', fieldName: 'value', fieldValue: '9', description: 'width' },
          { nodeId: '173', fieldName: 'value', fieldValue: '16', description: 'height' },
          { nodeId: '269', fieldName: 'value', fieldValue: '1', description: 'count' },
          { nodeId: '104', fieldName: 'image', fieldValue: downloadUrl || imgPath, description: 'image' },
          { nodeId: '273', fieldName: 'value', fieldValue: 'false', description: 'enhance' },
        ];
        const taskId = await taskManager.addTask('img2img', nodes, imgFinalPrompt, WORKFLOW.IMAGE_TO_IMAGE, undefined, storyboardInfo, 'storyboard', themeTitle, 1);
        redrawTaskIdsRef.current.add(taskId);
        console.log(`[Redraw] ✅ img2img task submitted! taskId=${taskId}`);
      } else {
        console.log('[Redraw] txt2img path');
        const txt2imgOptions = buildUnifiedTxt2ImgOptions(finalPrompt);
        // Force single image and a strict 9:16 vertical aspect ratio for
        // per-panel redraws so the model can never render a 3×3 grid again.
        txt2imgOptions.imageCount = 1;
        txt2imgOptions.width = 832;
        txt2imgOptions.height = 1472;
        const nodes = buildTxt2ImgNodeList(txt2imgOptions);
        console.log(`[Redraw] nodes count=${nodes.length} (9:16 single)`);
        const taskId = await taskManager.addTask('txt2img', nodes, finalPrompt, undefined, undefined, storyboardInfo, 'storyboard', themeTitle, 1);
        redrawTaskIdsRef.current.add(taskId);
        console.log(`[Redraw] ✅ txt2img task submitted! taskId=${taskId}`);
      }
      onSuccess(`第 ${panelSnapshot.panel_number} 镜图片生成中，请等待…`);
    } catch (genErr) {
      console.error('[Redraw] task submission failed:', genErr);
      onError(`第 ${panelSnapshot.panel_number} 镜图片生成失败（${genErr instanceof Error ? genErr.message : String(genErr)}）。请手动点击"生成"出图。`);
      // Submission failed → clear the per-panel loading state immediately.
      setRedrawPanelIdx(null);
      setLoading(false);
    }
    // Note: we deliberately do NOT clear redrawPanelIdx on success here.
    // The redraw task runs in the background for 1–2 minutes, and the user
    // must keep seeing the spinning button + "重绘中…" indicator on the
    // panel card the whole time. The indicator is cleared by the
    // finishedTasks handler below when the redraw image is actually received.
  }, [panels, onError, onSuccess, taskManager, activeThemeIdx, currentHistoryIdMap, completedThemesRef, gridTasks, selectedTemplates, digitalHumanMode, selectedGirlfriend, apiKey]);

  // ── History handlers ──

  const handleHistoryLoad = async (item: GridHistoryItem) => {
    console.log(`${GRID_LOG_PREFIX} handleHistoryLoad:`, item.plot);
    // Guard: if a redraw is in progress, don't overwrite the panel state with stale history data.
    // The redraw API call is still running and will update the panels when it completes.
    if (redrawPanelIdx !== null) {
      console.warn(`${GRID_LOG_PREFIX} handleHistoryLoad: blocked because redrawPanelIdx=${redrawPanelIdx} (redraw in progress)`);
      setShowHistory(false);
      return;
    }
    setPanels(item.panels);
    setGridSize(item.grid_size as GridSize);
    setCurrentHistoryId(item.id);
    setCurrentHistoryIdMap((prev) => ({ ...prev, [activeThemeIdx]: item.id }));
    setShowHistory(false);
    setStep('edit');

    const cached = getCachedStoryboardPanelImages(item.id, 0);
    if (cached.length > 0) {
      // Load all cached images for this history
      const allCached: string[] = [];
      for (let i = 0; i < 4; i++) {
        const imgs = getCachedStoryboardPanelImages(item.id, i);
        if (imgs.length > 0) allCached[i] = imgs[0];
      }
      setGridImages(allCached);
      setGridImagesMap((prev) => ({ ...prev, [activeThemeIdx]: allCached }));
      setStep('view');
    }
    onSuccess(`已加载历史记录：${item.plot}`);
  };

  const handleDeleteHistory = (id: string) => {
    removeGridHistory(id);
    setHistory(getGridHistory());
  };

  // Refresh history when panel opens or when images are saved
  useEffect(() => {
    if (showHistory) {
      setHistory(getGridHistory());
    }
  }, [showHistory]);

  // Refresh history after images are generated
  useEffect(() => {
    setHistory(getGridHistory());
  }, [currentHistoryIdMap]);

  // ── Favorites ──

  const handleToggleFavorite = useCallback((imageUrl: string, prompt?: string) => {
    const existing = favorites.find((f) => f.imageRef === imageUrl || f.imageUrl === imageUrl);
    if (existing) {
      removeFavorite(existing.id);
    } else {
      addFavorite({ imageUrl, prompt, source: 'storyboard', r18: r18Mode });
    }
    setFavorites(getFavorites());
  }, [favorites, r18Mode]);

  // ── Download ──

  const handleDownload = (imageUrl?: string) => {
    // Prefer an explicitly-passed URL (e.g. when downloading a single
    // per-panel image). Otherwise, in digital-human mode, synthesize the
    // 9-panel sheet on the fly so the user downloads a TRUE 3×3 grid
    // instead of whatever the model produced (which is what gave us the
    // "3 wide tiles, each 1/3 of a face" bug).
    if (imageUrl) {
      downloadDataUrl(imageUrl, `grid_storyboard_${Date.now()}.png`);
      return;
    }
    if (digitalHumanMode && compositeSheetUrl) {
      downloadDataUrl(compositeSheetUrl, `grid_storyboard_${Date.now()}.png`);
      return;
    }
    if (digitalHumanMode) {
      // Composite not built yet — build it now, then download.
      void (async () => {
        try {
          await buildComposite();
          // Read the latest value via closure on the React state: we
          // re-call after a microtask so buildComposite's setState has
          // landed. The cleanest way is to call buildComposite and then
          // rely on the auto-build effect to populate compositeSheetUrl,
          // but for download on demand we synthesize inline.
          const urls = Array.from({ length: panels.length }, (_, i) => redrawnPanelImages[i]?.[0] ?? null);
          const url = await composeGridStoryboard(urls, {
            panelLabels: Array.from({ length: panels.length }, (_, i) => `Panel ${i + 1}`),
          });
          downloadDataUrl(url, `grid_storyboard_${Date.now()}.png`);
        } catch (err) {
          console.error(`${GRID_LOG_PREFIX} download (digital-human) failed:`, err);
          onError('下载 9 宫格失败：' + (err instanceof Error ? err.message : String(err)));
        }
      })();
      return;
    }
    // txt2img path: use the model-produced composite image directly.
    const url = gridImages[activeImageIdx];
    if (!url) return;
    downloadDataUrl(url, `grid_storyboard_${Date.now()}.png`);
  };

  const downloadDataUrl = (url: string, filename: string) => {
    try {
      const a = document.createElement('a');
      a.href = url;
      const mimeMatch = url.match(/^data:(image\/[a-zA-Z0-9+.-]+);/);
      const ext = mimeMatch ? mimeMatch[1].split('/')[1] : 'png';
      a.download = filename.replace(/\.png$/, `.${ext}`);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error(`${GRID_LOG_PREFIX} download failed:`, err);
    }
  };

  // ── Reset ──

  const handleReset = () => {
    setPanels([]);
    setFullPrompt('');
    setGridImages([]);
    setActiveImageIdx(0);
    setSelectedTemplate(null);
    setStep('themes');
    setCurrentHistoryId(null);
    clearGridSession();
  };

  // ── Render ──

  // Image display strategy:
  //
  // In digital-human mode we no longer receive a single composite image
  // from the model. Instead we have `redrawnPanelImages[0..8]` (one
  // image per panel from 9 independent img2img tasks) and we render them
  // as a 3×3 grid directly — the user sees 9 full panels exactly as the
  // linear storyboard UI does.
  //
  // For txt2img mode the existing behavior (single composite image from
  // the model) is unchanged.
  //
  // For the header buttons (Enlarge / Download / Favorite) we synthesize
  // a 3×3 composite on demand via `composeNinePanelGrid`, then use that
  // data: URL like any other image. This means "Download" downloads a
  // proper 9-panel sheet in both modes.
  const showPerPanelGrid =
    digitalHumanMode &&
    panels.length > 0 &&
    // Show as soon as ANY per-panel image is available so the user sees
    // progress while the remaining panels generate.
    Object.values(redrawnPanelImages).some((arr) => arr && arr.length > 0);

  // CSS grid-template-columns value for the per-panel digital-human view.
  // Derived from the user's selected panel count so the visible layout
  // matches what the model was asked to render:
  //   4 panels  → 2 cols
  //   6 panels  → 2 cols
  //   9 panels  → 3 cols
  //  12 panels  → 3 cols
  const perPanelCols = (() => {
    if (panels.length === 4) return 2;
    if (panels.length === 6) return 2;
    if (panels.length === 9) return 3;
    if (panels.length === 12) return 3;
    return Math.max(2, Math.ceil(Math.sqrt(panels.length)));
  })();
  const heroImage = digitalHumanMode ? compositeSheetUrl : gridImages[activeImageIdx];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-2xl bg-white border border-border shadow-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Grid3X3 size={14} className={r18Mode ? 'text-red-500' : 'text-primary'} />
            <span className="text-sm font-medium text-text-primary">
              {displayLang === 'zh' ? '九宫格分镜' : 'Grid Storyboard'}
            </span>
            {r18Mode && <span className="text-xs text-red-500 font-medium">(R18)</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium transition-all ${showHistory ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'}`}
            >
              <History size={12} />
              {displayLang === 'zh' ? '历史' : 'History'}
            </button>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-3">
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${step === 'themes' ? 'bg-primary text-white' : 'bg-bg-elevated text-text-tertiary'}`}>
            <span className="w-4 h-4 rounded-full bg-current/20 flex items-center justify-center text-[10px] font-bold">1</span>
            <span>{displayLang === 'zh' ? '选主题' : 'Theme'}</span>
          </div>
          <div className="flex-1 h-px bg-border" />
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${step === 'edit' ? 'bg-primary text-white' : step === 'view' ? 'bg-green-500 text-white' : 'bg-bg-elevated text-text-tertiary'}`}>
            <span className="w-4 h-4 rounded-full bg-current/20 flex items-center justify-center text-[10px] font-bold">2</span>
            <span>{displayLang === 'zh' ? '编辑分镜' : 'Edit'}</span>
          </div>
          <div className="flex-1 h-px bg-border" />
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${step === 'view' ? 'bg-green-500 text-white' : 'bg-bg-elevated text-text-tertiary'}`}>
            <span className="w-4 h-4 rounded-full bg-current/20 flex items-center justify-center text-[10px] font-bold">3</span>
            <span>{displayLang === 'zh' ? '图片展示' : 'View'}</span>
          </div>
        </div>

        {/* Grid size selector (only in themes step) */}
        {step === 'themes' && (
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs text-text-tertiary">{displayLang === 'zh' ? '网格尺寸:' : 'Grid:'}</span>
            <div className="flex gap-1">
              {([4, 6, 9, 12] as GridSize[]).map((n) => (
                <button
                  key={n}
                  onClick={() => setGridSize(n)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                    gridSize === n
                      ? 'bg-primary text-white'
                      : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'
                  }`}
                >
                  {n === 4 ? '2×2' : n === 6 ? '2×3' : n === 9 ? '3×3' : '3×4'}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Theme selection area */}
        {step === 'themes' && (
          <div className="space-y-3">
            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={handleLoadThemeLibrary}
                disabled={loadingThemeLibrary}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-sm transition-all ${
                  loadingThemeLibrary
                    ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                    : 'bg-gradient-to-r from-primary to-primary/80 text-white hover:opacity-90 active:scale-[0.98]'
                }`}
              >
                {loadingThemeLibrary ? (
                  <><Loader2 size={14} className="animate-spin" /> {displayLang === 'zh' ? '加载中...' : 'Loading...'}</>
                ) : (
                  <><LayoutList size={14} />{displayLang === 'zh' ? '从主题库选择' : 'Theme Library'}</>
                )}
              </button>
              <button
                onClick={handleRandomClick}
                disabled={loading}
                className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${
                  loading
                    ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                    : 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:opacity-90 active:scale-[0.98]'
                }`}
              >
                {loading ? (
                  <><Loader2 size={14} className="animate-spin" /></>
                ) : (
                  <><Shuffle size={14} />{displayLang === 'zh' ? '随机选题' : 'Random'}</>
                )}
              </button>
            </div>

            {/* Custom theme input */}
            <div className="p-3 rounded-xl border border-border bg-bg-elevated">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-text-primary">{displayLang === 'zh' ? '自定义选题' : 'Custom Theme'}</span>
                  <span className="text-[10px] text-text-tertiary">{displayLang === 'zh' ? '输入描述生成主题' : 'Enter description'}</span>
                </div>
                <button
                  onClick={() => setCustomThemeMode(!customThemeMode)}
                  className={`relative w-10 h-5 rounded-full transition-all flex-shrink-0 ${customThemeMode ? 'bg-primary' : 'bg-gray-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${customThemeMode ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
              {customThemeMode && (
                <div className="space-y-2">
                  <textarea
                    value={customThemeDescription}
                    onChange={(e) => setCustomThemeDescription(e.target.value)}
                    placeholder={displayLang === 'zh' ? '例如：办公室暧昧、浴室激情、古风青楼...' : 'e.g., office romance, bathroom passion...'}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-border text-sm text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                    rows={2}
                  />
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-text-tertiary">{displayLang === 'zh' ? '生成数量:' : 'Count:'}</span>
                      <div className="flex gap-0.5">
                        {[1, 3, 5, 10].map((n) => (
                          <button
                            key={n}
                            onClick={() => setCustomThemeCount(n)}
                            className={`w-7 h-6 rounded text-[10px] font-medium transition-all ${
                              customThemeCount === n
                                ? 'bg-primary text-white'
                                : 'bg-white border border-border text-text-tertiary hover:bg-bg-hover'
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex-1" />
                    <button
                      onClick={handleGenerateThemes}
                      disabled={generatingThemes || !customThemeDescription.trim()}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        generatingThemes || !customThemeDescription.trim()
                          ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                          : 'bg-primary text-white hover:bg-primary/90'
                      }`}
                    >
                      {generatingThemes ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                      {displayLang === 'zh' ? '生成主题' : 'Generate'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Selected themes + Generate button (like linear storyboard) */}
            {selectedThemes.length > 0 && (
              <div className="p-3 rounded-xl border border-purple-200 bg-purple-50/30">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-text-primary">
                      {displayLang === 'zh' ? `已选主题 ${selectedThemes.length}` : `Selected ${selectedThemes.length}`}
                    </span>
                  </div>
                  <button
                    onClick={() => setSelectedThemes([])}
                    className="text-[10px] text-text-tertiary hover:text-red-400 transition-colors"
                  >
                    {displayLang === 'zh' ? '清空' : 'Clear'}
                  </button>
                </div>
                <div className="space-y-1.5 mb-3">
                  {selectedThemes.map((theme) => (
                    <div key={theme.id} className="flex items-center gap-2 p-2 rounded-lg bg-white border border-purple-100">
                      <span className="text-xs font-semibold text-text-primary flex-1">{theme.title}</span>
                      <span className={`text-[9px] px-1 py-0.5 rounded-full font-medium ${
                        theme.r18_level === 'hard' ? 'bg-red-100 text-red-600' : theme.r18_level === 'medium' ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'
                      }`}>
                        {theme.r18_level === 'hard' ? '高强度' : theme.r18_level === 'medium' ? '中等' : '柔和'}
                      </span>
                      <button
                        onClick={() => handleToggleTheme(theme)}
                        className="p-0.5 rounded text-text-tertiary hover:text-red-400 transition-colors"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleGenerateGridStoryboard}
                  disabled={loading}
                  className="w-full py-2.5 rounded-lg text-xs font-medium bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-1.5">
                      <Loader2 size={12} className="animate-spin" />
                      {displayLang === 'zh' ? '生成中...' : 'Generating...'}
                    </span>
                  ) : (
                    displayLang === 'zh' ? '✨ 生成九宫格分镜' : '✨ Generate Grid Storyboard'
                  )}
                </button>
              </div>
            )}

            {/* Built-in templates - Multi-select with scroll */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <BookTemplate size={12} className="text-purple-500" />
                  <span className="text-xs font-medium text-text-primary">{displayLang === 'zh' ? '内置模板' : 'Templates'}</span>
                  <span className="text-[10px] text-text-tertiary">
                    {templateCategoryFilter === '全部'
                      ? (displayLang === 'zh' ? `快速套用 (${GRID_TEMPLATES.length})` : `Quick start (${GRID_TEMPLATES.length})`)
                      : (displayLang === 'zh' ? `${templateCategoryFilter} (${GRID_TEMPLATES.filter((t) => t.category === templateCategoryFilter).length})` : `${templateCategoryFilter} (${GRID_TEMPLATES.filter((t) => t.category === templateCategoryFilter).length})`)
                    }
                  </span>
                </div>
                {selectedTemplates.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-purple-600 font-medium">{selectedTemplates.length} 已选</span>
                    <button
                      onClick={() => setSelectedTemplates([])}
                      className="px-2 py-1 rounded-lg text-[10px] font-medium bg-bg-elevated text-text-secondary hover:bg-bg-hover transition-colors"
                    >
                      {displayLang === 'zh' ? '清空' : 'Clear'}
                    </button>
                    <button
                      onClick={handleGenerateSelectedTemplates}
                      className="px-2 py-1 rounded-lg text-[10px] font-medium bg-purple-500 text-white hover:bg-purple-600 transition-colors"
                    >
                      {displayLang === 'zh' ? '生成选中' : 'Generate'}
                    </button>
                  </div>
                )}
              </div>
              {/* Category filter bar */}
              <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1 scrollbar-thin">
                {ALL_CATEGORIES.map((cat) => {
                  const catCount = cat === '全部'
                    ? GRID_TEMPLATES.length
                    : GRID_TEMPLATES.filter((t) => t.category === cat).length;
                  if (catCount === 0 && cat !== '全部') return null;
                  const isActive = templateCategoryFilter === cat;
                  return (
                    <button
                      key={cat}
                      onClick={() => setTemplateCategoryFilter(cat)}
                      className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-medium transition-all ${
                        isActive
                          ? 'bg-purple-500 text-white shadow-sm'
                          : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border'
                      }`}
                    >
                      {cat}
                      <span className={`ml-1 ${isActive ? 'text-purple-200' : 'text-text-tertiary'}`}>{catCount}</span>
                    </button>
                  );
                })}
              </div>
              <div className="max-h-[280px] overflow-y-auto pr-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {GRID_TEMPLATES.filter((t) =>
                    templateCategoryFilter === '全部' || t.category === templateCategoryFilter
                  ).map((template) => {
                    const isSelected = selectedTemplates.some((t) => t.id === template.id);
                    return (
                      <div
                        key={template.id}
                        className={`relative rounded-xl border transition-all ${
                          isSelected
                            ? 'border-purple-400 bg-purple-50/50 ring-2 ring-purple-200'
                            : 'border-border bg-bg-elevated hover:border-purple-300'
                        }`}
                      >
                        <button
                          onClick={() => handleLoadTemplate(template)}
                          className="text-left p-3 w-full"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-semibold text-text-primary">{template.titleZh}</span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-600 font-medium">9格</span>
                          </div>
                          <p className="text-[10px] text-text-tertiary leading-relaxed line-clamp-2">{template.description}</p>
                        </button>
                        {/* Category tag */}
                        <span className="absolute bottom-2 left-3 text-[9px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">{template.category}</span>
                        {/* Checkbox overlay */}
                        <button
                          onClick={() => handleToggleTemplate(template)}
                          className={`absolute top-2 right-2 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                            isSelected
                              ? 'border-purple-500 bg-purple-500'
                              : 'border-gray-300 bg-white hover:border-purple-400'
                          }`}
                        >
                          {isSelected && <Check size={12} className="text-white" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Back to themes button */}
        {step !== 'themes' && (
          <div className="flex gap-2">
            <button
              onClick={() => setStep('themes')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-bg-elevated text-text-secondary hover:bg-bg-hover transition-colors"
            >
              <ArrowLeft size={12} />
              {displayLang === 'zh' ? '返回选主题' : 'Back'}
            </button>
            {step === 'view' && (
              <button
                onClick={() => setStep('edit')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-bg-elevated text-text-secondary hover:bg-bg-hover transition-colors"
              >
                {displayLang === 'zh' ? '继续编辑' : 'Edit More'}
              </button>
            )}
            <div className="flex-1" />
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-text-tertiary hover:text-red-400 transition-colors"
            >
              <RotateCcw size={12} />
              {displayLang === 'zh' ? '重新开始' : 'Reset'}
            </button>
          </div>
        )}
      </div>

      {/* Random Theme Modal - shows 3 random themes for selection */}
      {showRandomConfirm && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowRandomConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Shuffle size={18} className="text-purple-500" />
                <span className="font-semibold text-text-primary">{displayLang === 'zh' ? '随机选题' : 'Random Theme'}</span>
              </div>
              <button onClick={() => setShowRandomConfirm(false)} className="p-2 rounded-lg hover:bg-bg-hover transition-colors">
                <X size={18} className="text-text-tertiary" />
              </button>
            </div>
            <div className="p-5">
              <p className="text-sm text-text-secondary mb-4">
                {displayLang === 'zh' ? '已为您随机选择 3 个主题，点击选择：' : '3 random themes picked for you:'}
              </p>
              <div className="space-y-2">
                {randomThemes.map((theme) => {
                  const isSelected = selectedThemes.some((t) => t.id === theme.id);
                  return (
                    <button
                      key={theme.id}
                      onClick={() => handleToggleTheme(theme)}
                      className={`w-full text-left p-3 rounded-xl border transition-all ${
                        isSelected
                          ? 'border-purple-400 bg-purple-50 ring-2 ring-purple-200'
                          : 'border-border bg-bg-elevated hover:bg-purple-50/50 hover:border-purple-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                          isSelected ? 'border-purple-500 bg-purple-500' : 'border-gray-300'
                        }`}>
                          {isSelected && <Check size={10} className="text-white" />}
                        </div>
                        <span className="text-sm font-semibold text-text-primary">{theme.title}</span>
                        <span className={`text-[9px] px-1 py-0.5 rounded-full font-medium ${
                          theme.r18_level === 'hard' ? 'bg-red-100 text-red-600' : theme.r18_level === 'medium' ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'
                        }`}>
                          {theme.r18_level === 'hard' ? '高强度' : theme.r18_level === 'medium' ? '中等' : '柔和'}
                        </span>
                      </div>
                      <p className="text-[11px] text-text-tertiary leading-relaxed ml-6">{theme.description}</p>
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={handleRandomClick}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-medium bg-bg-elevated text-text-secondary hover:bg-bg-hover transition-colors"
                >
                  <RefreshCw size={12} />
                  {displayLang === 'zh' ? '换一批' : 'Refresh'}
                </button>
                <button
                  onClick={() => {
                    setShowRandomConfirm(false);
                    onSuccess(`已选择 ${selectedThemes.length} 个主题，点击"生成九宫格分镜"按钮开始生成`);
                  }}
                  disabled={selectedThemes.length === 0}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-medium transition-all ${
                    selectedThemes.length === 0
                      ? 'bg-bg-elevated text-text-tertiary cursor-not-allowed'
                      : 'bg-purple-500 text-white hover:bg-purple-600'
                  }`}
                >
                  <Check size={12} />
                  {displayLang === 'zh' ? `确定 (${selectedThemes.length})` : `Confirm (${selectedThemes.length})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Grid Tasks Progress Overlay */}
      {gridTasks.length > 0 && (
        <div className="rounded-2xl bg-white shadow-card p-4 border border-purple-200">
          <div className="flex items-center gap-2 mb-3">
            {loading ? (
              <Loader2 size={16} className="animate-spin text-purple-500" />
            ) : (
              <Check size={16} className="text-green-500" />
            )}
            <span className="text-sm font-medium text-text-primary">
              {loading
                ? (displayLang === 'zh' ? `正在为 ${gridTasks.length} 个主题生成分镜...` : `Generating for ${gridTasks.length} themes...`)
                : (displayLang === 'zh' ? `${gridTasks.length} 个主题分镜生成完成` : `${gridTasks.length} themes completed`)
              }
            </span>
            {loading && (
              <button
                onClick={handleCancelAll}
                className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-red-500 hover:bg-red-50 transition-colors"
              >
                <XCircle size={12} />
                {displayLang === 'zh' ? '取消' : 'Cancel'}
              </button>
            )}
          </div>
          <div className="space-y-2">
            {gridTasks.map((task, idx) => (
              <div key={idx}>
                <div
                  className={`flex items-center gap-2 p-2 rounded-lg ${
                    task.status === 'DONE' && task.panels?.length
                      ? 'bg-green-50 cursor-pointer hover:bg-green-100 transition-colors'
                      : 'bg-bg-elevated'
                  }`}
                  onClick={() => {
                    if (task.status === 'DONE' && task.panels?.length) {
                      handleLoadTheme(task.themeTitle);
                    }
                  }}
                >
                  <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                    {task.status === 'DONE' ? (
                      <Check size={14} className="text-green-500" />
                    ) : task.status === 'FAILED' ? (
                      <X size={14} className="text-red-500" />
                    ) : (
                      <Loader2 size={14} className="animate-spin text-purple-500" />
                    )}
                  </div>
                  <span className="text-xs text-text-primary flex-1 truncate">{task.themeTitle}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    task.status === 'DONE' ? 'bg-green-100 text-green-700' :
                    task.status === 'FAILED' ? 'bg-red-100 text-red-700' :
                    'bg-purple-100 text-purple-700'
                  }`}>
                    {task.status === 'SUBMITTING' ? (displayLang === 'zh' ? '提交中' : 'Submitting') :
                     task.status === 'RUNNING' ? (displayLang === 'zh' ? '生成中' : 'Running') :
                     task.status === 'DONE' ? (displayLang === 'zh' ? `完成 ${task.panels?.length || 0} 格` : `Done ${task.panels?.length || 0}`) :
                     task.status === 'FAILED' ? (displayLang === 'zh' ? '失败' : 'Failed') :
                     task.status}
                  </span>
                  {task.status === 'DONE' && task.panels?.length && (
                    <button
                      className="text-[10px] text-purple-600 hover:text-purple-800 font-medium"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleLoadTheme(task.themeTitle);
                      }}
                    >
                      {displayLang === 'zh' ? '加载' : 'Load'}
                    </button>
                  )}
                  {(task.status === 'SUBMITTING' || task.status === 'RUNNING') && (
                    <button
                      className="text-[10px] text-red-500 hover:text-red-700 font-medium"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCancelTask(idx);
                      }}
                    >
                      {displayLang === 'zh' ? '取消' : 'Cancel'}
                    </button>
                  )}
                </div>
                {task.status === 'RUNNING' && (
                  <div className="mt-1.5 ml-7">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 rounded-full bg-bg-elevated overflow-hidden">
                        <div className="h-full rounded-full bg-purple-400 animate-pulse" style={{ width: '60%' }} />
                      </div>
                      <span className="text-[9px] text-text-tertiary">
                        {task.startTime ? formatElapsedTime(task.startTime) : ''}
                      </span>
                    </div>
                    {task.progress && (
                      <p className="text-[9px] text-text-tertiary mt-0.5 truncate">{task.progress}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-text-tertiary mt-2">
            {displayLang === 'zh'
              ? loading
                ? '提示：每个主题独立生成，完成后可点击"加载"查看（其他任务继续在后台运行）'
                : '提示：点击"加载"按钮或主题标签切换查看不同主题的分镜'
              : loading
                ? 'Each theme generates independently. Click "Load" when ready (others continue in background)'
                : 'Click "Load" or theme tabs to switch between completed themes'}
          </p>
        </div>
      )}

      {/* Theme Library Modal */}
      {themeLibraryOpen && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4 animate-fade-in" onClick={() => setThemeLibraryOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-2">
                <LayoutList size={18} className="text-primary" />
                <span className="font-semibold text-text-primary">{displayLang === 'zh' ? '主题库' : 'Theme Library'}</span>
                <span className="px-2 py-0.5 rounded-full text-[11px] bg-bg-elevated text-text-tertiary">{themeOptions.length}</span>
              </div>
              <button onClick={() => setThemeLibraryOpen(false)} className="p-2 rounded-lg hover:bg-bg-hover transition-colors">
                <X size={18} className="text-text-tertiary" />
              </button>
            </div>
            <div className="px-5 py-3 border-b border-border flex-shrink-0 space-y-2">
              <input
                type="text"
                placeholder={displayLang === 'zh' ? '搜索主题...' : 'Search themes...'}
                className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30"
                onChange={(e) => setThemeSearchQuery(e.target.value.toLowerCase())}
              />
              <div className="flex flex-wrap gap-1">
                {[
                  { label: '全部', cat: '' },
                  { label: '户外', cat: 'outdoor' },
                  { label: '室内', cat: 'indoor' },
                  { label: '制服', cat: 'costume' },
                  { label: 'SM', cat: 'sm' },
                  { label: '幻想', cat: 'fantasy' },
                  { label: '职场', cat: 'work' },
                  { label: '交通', cat: 'transport' },
                ].map(({ label, cat }) => (
                  <button
                    key={cat}
                    onClick={() => setThemeCategoryFilter(cat)}
                    className={`px-2 py-0.5 rounded-full text-[11px] transition-all ${
                      themeCategoryFilter === cat ? 'bg-primary text-white' : 'bg-bg-elevated text-text-secondary hover:bg-primary hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {loadingThemeLibrary ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-text-tertiary" />
                </div>
              ) : themeOptions.length === 0 ? (
                <div className="text-center py-12 text-text-tertiary text-sm">
                  <LayoutList size={32} className="mx-auto mb-2 opacity-40" />
                  <p>{displayLang === 'zh' ? '暂无主题，请先点击「从主题库选择」或「自定义选题」生成' : 'No themes loaded yet'}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {themeOptions
                    .filter((t) => {
                      const matchesCategory = !themeCategoryFilter || t.category === themeCategoryFilter;
                      const matchesSearch = !themeSearchQuery ||
                        t.title.toLowerCase().includes(themeSearchQuery) ||
                        t.description.toLowerCase().includes(themeSearchQuery) ||
                        t.tags.some((tag) => tag.toLowerCase().includes(themeSearchQuery));
                      return matchesCategory && matchesSearch;
                    })
                    .map((theme) => {
                      const isSelected = selectedThemes.some((st) => st.id === theme.id);
                      return (
                        <div
                          key={theme.id}
                          className={`p-3 rounded-xl border transition-all cursor-pointer ${
                            isSelected
                              ? 'border-purple-400 bg-purple-50 ring-2 ring-purple-200'
                              : 'border-border bg-bg-elevated hover:bg-bg-hover hover:border-primary/40'
                          }`}
                          onClick={() => handleToggleLibraryTheme(theme)}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                              isSelected ? 'border-purple-500 bg-purple-500' : 'border-gray-300'
                            }`}>
                              {isSelected && <Check size={10} className="text-white" />}
                            </div>
                            <span className="text-sm font-semibold text-text-primary">{theme.title}</span>
                            <span className={`text-[9px] px-1 py-0.5 rounded-full font-medium ${
                              theme.r18_level === 'hard' ? 'bg-red-100 text-red-600' : theme.r18_level === 'medium' ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'
                            }`}>
                              {theme.r18_level === 'hard' ? '高强度' : theme.r18_level === 'medium' ? '中等' : '柔和'}
                            </span>
                          </div>
                          <p className="text-[11px] text-text-tertiary leading-relaxed line-clamp-2 ml-6">{theme.description}</p>
                          {theme.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5 ml-6">
                              {theme.tags.slice(0, 3).map((tag, i) => (
                                <span key={i} className="text-[9px] px-1 py-0.5 rounded-full bg-bg-elevated text-text-secondary">{tag}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
            {/* Bottom confirm bar */}
            {themeOptions.length > 0 && (
              <div className="px-5 py-3 border-t border-border flex items-center gap-3 flex-shrink-0">
                <span className="text-xs text-text-tertiary">
                  {selectedThemes.length > 0
                    ? (displayLang === 'zh' ? `已选 ${selectedThemes.length} 个主题` : `${selectedThemes.length} selected`)
                    : (displayLang === 'zh' ? '点击主题进行选择' : 'Click themes to select')
                  }
                </span>
                <div className="flex-1" />
                <button
                  onClick={() => setSelectedThemes([])}
                  disabled={selectedThemes.length === 0}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-bg-elevated text-text-secondary hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {displayLang === 'zh' ? '清空' : 'Clear'}
                </button>
                <button
                  onClick={handleConfirmLibraryThemes}
                  disabled={selectedThemes.length === 0}
                  className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    selectedThemes.length === 0
                      ? 'bg-bg-elevated text-text-tertiary cursor-not-allowed'
                      : 'bg-purple-500 text-white hover:bg-purple-600'
                  }`}
                >
                  {displayLang === 'zh' ? '确定' : 'Confirm'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* History Panel */}
      {showHistory && (
        <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-bg-elevated">
            <div className="flex items-center gap-2">
              <History size={14} className="text-text-tertiary" />
              <span className="text-sm font-medium text-text-primary">{displayLang === 'zh' ? '九宫格历史' : 'Grid History'}</span>
              <span className="px-2 py-0.5 rounded-full text-[11px] bg-bg-elevated text-text-tertiary">{history.length}</span>
            </div>
            <div className="flex items-center gap-2">
              {history.length > 0 && (
                <button onClick={() => { clearGridHistory(); setHistory([]); }} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-all">
                  <Trash2 size={11} />{displayLang === 'zh' ? '清空' : 'Clear'}
                </button>
              )}
              <button onClick={() => setShowHistory(false)} className="p-1.5 rounded-lg text-text-tertiary hover:bg-bg-hover transition-all">
                <X size={14} />
              </button>
            </div>
          </div>
          {history.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <ClockIcon size={24} className="mx-auto text-text-tertiary/40 mb-2" />
              <p className="text-sm text-text-tertiary">{displayLang === 'zh' ? '暂无历史记录' : 'No history'}</p>
            </div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto divide-y divide-border/50">
              {history.map((h) => {
                // Get first available image for preview: from history or cache
                const cachedPreview = getCachedStoryboardPanelImages(h.id, 0)[0];
                const previewImage = h.images?.[0] || h.panelImages?.[0]?.[0] || cachedPreview || undefined;
                return (
                  <div key={h.id} className="flex items-center gap-2 px-4 py-3 hover:bg-bg-hover/30 transition-colors">
                    <button onClick={() => handleHistoryLoad(h)} className="flex-1 flex items-start gap-2 w-full min-w-0 text-left group">
                      {/* Preview image or grid icon */}
                      {previewImage ? (
                        <div className="flex-shrink-0 w-10 h-10 rounded-lg overflow-hidden border border-border/50">
                          <img src={previewImage} alt="" className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-bg-elevated flex items-center justify-center border border-border/50">
                          <Grid3X3 size={16} className="text-text-tertiary/40" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-text-primary font-medium line-clamp-1">{h.plot}</p>
                        <p className="text-[10px] text-text-tertiary">{h.grid_size} 格 · {new Date(h.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                    </button>
                    <button onClick={() => handleDeleteHistory(h.id)} className="p-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-all flex-shrink-0">
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Step 2: Panel Editor */}
      {step === 'edit' && panels.length > 0 && (
        <div className="rounded-2xl bg-white border border-border shadow-card p-4">
          {/* Theme tabs - show when multiple themes completed */}
          {completedThemes.length > 1 && (
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border overflow-x-auto">
              <span className="text-[10px] text-text-tertiary flex-shrink-0">
                {displayLang === 'zh' ? '主题' : 'Theme'}:
              </span>
              {completedThemes.map((theme, idx) => (
                <button
                  key={idx}
                  onClick={() => handleLoadTheme(theme.themeTitle)}
                  className={`flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                    activeThemeIdx === idx
                      ? 'bg-purple-500 text-white'
                      : 'bg-bg-elevated text-text-secondary hover:bg-purple-100 hover:text-purple-700'
                  }`}
                >
                  {theme.themeTitle}
                </button>
              ))}
            </div>
          )}

          {/* Auto-fix warnings — shown when buildFullGridPrompt sanitized
              empty panels or fixed obvious logical errors (male breast,
              wrong race, etc.) so the user knows what was changed before
              submitting to Krea2. Hidden when no fixes were applied. */}
          {gridPromptWarnings.length > 0 && (
            <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs">
              <div className="flex items-start gap-2">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-amber-600" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-amber-800 mb-1">
                    已自动修复 {gridPromptWarnings.length} 处提示词问题
                  </div>
                  <ul className="space-y-0.5 text-amber-700">
                    {gridPromptWarnings.map((w, i) => (
                      <li key={i} className="break-all">• {w}</li>
                    ))}
                  </ul>
                  <div className="mt-1 text-amber-600 text-[11px]">
                    可点击下方"完整提示词"查看修复后的最终内容，再点击"生成图片"
                  </div>
                </div>
              </div>
            </div>
          )}

          <GridPanelEditor
            panels={panels}
            gridSize={panels.length}
            fullPrompt={fullPrompt}
            onUpdatePanel={handleUpdatePanel}
            onFullPromptChange={handleFullPromptChange}
            onGenerateImages={handleGenerateImage}
            onRedrawPanel={handleRedrawPanel}
            isGenerating={isGenerating}
            redrawPanelIdx={redrawPanelIdx}
            displayLang={displayLang}
            redrawnPanelImages={redrawnPanelImages}
            // Generate mode toggle — locked to true when digitalHumanMode is active
            generateSeparatePanels={generateSeparatePanels}
            onGenerateSeparatePanelsChange={digitalHumanMode ? undefined : setGenerateSeparatePanels}
            isDigitalHumanMode={digitalHumanMode}
            onImageClick={(panelIdx, imgUrl) => {
              const all = redrawnPanelImages[panelIdx] || [];
              const idx = all.indexOf(imgUrl);
              setLightboxPanelIdx(panelIdx);
              setLightboxImageIdx(idx >= 0 ? idx : 0);
              setLightboxImageList(all);
              setShowRedrawLightbox(true);
            }}
            onDownloadImage={(_panelIdx, imgUrl) => handleDownload(imgUrl)}
            onToggleFavorite={(_panelIdx, imgUrl) => {
              handleToggleFavorite(imgUrl, panels[_panelIdx]?.image_prompt);
              setFavorites(getFavorites());
            }}
            isFavorited={(url) => isFavoritedFn(url)}
          />
        </div>
      )}

      {/* Step 3: Image Viewer - Multiple images as tabs */}
      {step === 'view' && (
        <div className="rounded-2xl bg-white border border-border shadow-card p-4">
          {/* Theme tabs - show when multiple themes completed */}
          {completedThemes.length > 1 && (
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border overflow-x-auto">
              <span className="text-[10px] text-text-tertiary flex-shrink-0">
                {displayLang === 'zh' ? '主题' : 'Theme'}:
              </span>
              {completedThemes.map((theme, idx) => (
                <button
                  key={idx}
                  onClick={() => handleLoadTheme(theme.themeTitle)}
                  className={`flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                    activeThemeIdx === idx
                      ? 'bg-purple-500 text-white'
                      : 'bg-bg-elevated text-text-secondary hover:bg-purple-100 hover:text-purple-700'
                  }`}
                >
                  {theme.themeTitle}
                </button>
              ))}
            </div>
          )}
          <div className="space-y-3">
            {/* Image tabs */}
            {gridImages.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {gridImages.map((img, idx) => (
                  <button
                    key={idx}
                    onClick={() => setActiveImageIdx(idx)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      activeImageIdx === idx
                        ? 'bg-purple-500 text-white'
                        : 'bg-bg-elevated text-text-secondary hover:bg-purple-50'
                    }`}
                  >
                    {displayLang === 'zh' ? `图片 ${idx + 1}` : `Image ${idx + 1}`}
                  </button>
                ))}
              </div>
            )}

            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Film size={14} className="text-purple-500" />
                <span className="text-xs font-medium text-purple-700">
                  {displayLang === 'zh' ? `九宫格分镜图片${gridImages.length > 1 ? ` (${activeImageIdx + 1}/${gridImages.length})` : ''}` : `Grid Storyboard${gridImages.length > 1 ? ` (${activeImageIdx + 1}/${gridImages.length})` : ''}`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {heroImage && (
                  <>
                    <button
                      onClick={() => setShowLightbox(true)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors"
                    >
                      <ZoomIn size={10} />
                      {displayLang === 'zh' ? '放大查看' : 'Enlarge'}
                    </button>
                    <button
                      onClick={() => handleDownload()}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-bg-elevated text-text-secondary hover:bg-bg-hover transition-colors"
                    >
                      <Download size={10} />
                      {displayLang === 'zh' ? '下载' : 'Download'}
                    </button>
                    {isFavoritedFn && (
                      <button
                        onClick={() => handleToggleFavorite(heroImage, fullPrompt)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                          isFavoritedFn(heroImage) ? 'bg-red-100 text-red-600' : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover'
                        }`}
                      >
                        <Heart size={10} fill={isFavoritedFn(heroImage) ? 'currentColor' : 'none'} />
                        {isFavoritedFn(heroImage) ? (displayLang === 'zh' ? '已收藏' : 'Favorited') : (displayLang === 'zh' ? '收藏' : 'Favorite')}
                      </button>
                    )}
                  </>
                )}
                <button
                  onClick={handleRegenerate}
                  disabled={isGenerating}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                    isGenerating ? 'bg-bg-elevated text-text-tertiary cursor-not-allowed' : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover'
                  }`}
                >
                  {isGenerating ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                  {displayLang === 'zh' ? '重新生成' : 'Regenerate'}
                </button>
              </div>
            </div>

            <div
              className="relative rounded-lg overflow-hidden border border-purple-100/60 bg-bg-elevated"
            >
              {showPerPanelGrid ? (
                // ── Digital-human mode: 3×3 grid of per-panel images ──
                // Renders a 3-column × 3-row grid of the per-panel images. Each
                // tile is clickable to open a lightbox of that panel's images.
                // The cells maintain a 9:16 tile aspect ratio so the sheet is
                // exactly the 9:16 vertical aspect ratio the user expects.
                <div
                  className="grid gap-1 p-1 bg-bg-elevated"
                  style={{ aspectRatio: '9 / 16', gridTemplateColumns: `repeat(${perPanelCols}, minmax(0, 1fr))` }}
                >
                  {panels.map((panel, idx) => {
                    const url = redrawnPanelImages[idx]?.[0];
                    const isThisPanelGenerating = isGenerating && !url;
                    return (
                      <button
                        key={`dh-grid-${panel.panel_number}-${idx}`}
                        onClick={() => {
                          if (url) {
                            const all = redrawnPanelImages[idx] || [];
                            const i = all.indexOf(url);
                            setLightboxPanelIdx(idx);
                            setLightboxImageList(all);
                            setLightboxImageIdx(i);
                            setShowRedrawLightbox(true);
                          }
                        }}
                        disabled={!url}
                        className={`relative rounded-md overflow-hidden border border-purple-100/40 ${
                          url ? 'cursor-zoom-in hover:border-purple-300' : 'cursor-default'
                        } transition-colors`}
                        style={{ aspectRatio: '9 / 16' }}
                        title={url ? `Panel ${panel.panel_number}` : `Panel ${panel.panel_number} 等待生成…`}
                      >
                        {url ? (
                          <img
                            src={url}
                            alt={`Panel ${panel.panel_number}`}
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        ) : (
                          <div className="absolute inset-0 bg-bg-elevated flex flex-col items-center justify-center">
                            {isThisPanelGenerating ? (
                              <>
                                <Loader2 size={16} className="animate-spin text-purple-400" />
                                <span className="mt-1 text-[9px] text-text-tertiary">
                                  {displayLang === 'zh' ? '生成中' : 'Generating'}
                                </span>
                              </>
                            ) : (
                              <span className="text-[9px] text-text-tertiary">
                                Panel {panel.panel_number}
                              </span>
                            )}
                          </div>
                        )}
                        <span className="absolute top-1 left-1 px-1 py-0.5 rounded text-[9px] font-bold bg-black/55 text-white">
                          {panel.panel_number}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : heroImage ? (
                <div
                  className="relative group cursor-pointer"
                  onClick={() => setShowLightbox(true)}
                >
                  <img
                    src={heroImage}
                    alt="Grid Storyboard"
                    className="w-full h-auto object-contain"
                    style={{ maxHeight: '70vh' }}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                        <ZoomIn size={24} className="text-gray-700" />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="aspect-[9/16] flex flex-col items-center justify-center">
                  {isGenerating ? (
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 size={32} className="animate-spin text-purple-400" />
                      <span className="text-sm text-text-tertiary">
                        {displayLang === 'zh'
                          ? (digitalHumanMode
                              ? '九宫格 9 张图生成中（每张单独生成）...'
                              : '九宫格分镜图片生成中...')
                          : 'Generating grid storyboard...'}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <Film size={32} className="text-purple-200" />
                      <span className="text-sm text-text-tertiary">
                        {displayLang === 'zh' ? '点击上方"生成"按钮获取九宫格图片' : 'Click "Generate" above to create grid image'}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Panel descriptions - editable with per-panel redraw */}
            {panels.length > 0 && (
              <div className="pt-2 border-t border-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-text-tertiary font-medium">
                    {displayLang === 'zh' ? '分镜描述（可编辑 / 可单独重绘）' : 'Panel Descriptions (editable / redrawable)'}
                  </span>
                  <span className="text-[9px] text-text-tertiary bg-bg-elevated px-1.5 py-0.5 rounded">
                    {displayLang === 'zh' ? '✏️ 点击编辑 🔄 重绘' : '✏️ Edit 🔄 Redraw'}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {panels.map((panel, idx) => (
                    <div
                      key={panel.panel_number}
                      className={`rounded-lg p-2.5 border transition-colors ${
                        redrawPanelIdx === idx
                          ? 'border-orange-300 bg-orange-50/50'
                          : 'border-purple-100/60 bg-bg-elevated hover:border-purple-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-purple-500 text-white text-[9px] font-bold">
                            {panel.panel_number}
                          </span>
                          <span className="text-[10px] text-purple-600 font-medium">
                            {displayLang === 'zh' ? '镜' : 'Panel'}
                          </span>
                        </div>
                        <button
                          onClick={() => handleRedrawPanel(idx)}
                          disabled={redrawPanelIdx === idx}
                          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] text-orange-500 hover:bg-orange-50 transition-colors disabled:opacity-50"
                          title={displayLang === 'zh' ? '单独重绘此镜' : 'Redraw this panel'}
                        >
                          {redrawPanelIdx === idx ? (
                            <Loader2 size={9} className="animate-spin" />
                          ) : (
                            <RefreshCw size={9} />
                          )}
                          <span>{displayLang === 'zh' ? '重绘' : 'Redraw'}</span>
                        </button>
                      </div>
                      <textarea
                        value={panel.scene_description}
                        onChange={(e) => handleUpdatePanel(idx, 'scene_description', e.target.value)}
                        rows={2}
                        className="w-full px-2 py-1 rounded-md border border-purple-100 bg-white text-[10px] text-text-primary resize-none focus:outline-none focus:border-purple-300 focus:ring-1 focus:ring-purple-200"
                        placeholder={displayLang === 'zh' ? '描述这个镜头...' : 'Describe this scene...'}
                      />
                      {/* Redraw progress indicator (view-mode panel) */}
                      {redrawPanelIdx === idx && (
                        <div className="mt-2 rounded-md border border-orange-200 bg-orange-50/70 px-2 py-1.5 flex items-center gap-1.5">
                          <Loader2 size={11} className="animate-spin text-orange-500 flex-shrink-0" />
                          <span className="text-[10px] text-orange-600 font-medium">
                            {displayLang === 'zh' ? '重绘中…' : 'Redrawing…'}
                          </span>
                        </div>
                      )}
                      {/* Redrawn images preview (view-mode panel) */}
                      {redrawnPanelImages && redrawnPanelImages[idx] && redrawnPanelImages[idx].length > 0 && (
                        <div className="mt-2 space-y-1">
                          <div className="text-[9px] text-text-tertiary font-medium flex items-center gap-1">
                            <span className="w-1 h-1 rounded-full bg-orange-400" />
                            {displayLang === 'zh' ? `已生成 ${redrawnPanelImages[idx].length} 张` : `${redrawnPanelImages[idx].length} image(s)`}
                          </div>
                          <div className="flex flex-col gap-1">
                            {redrawnPanelImages[idx].map((imgUrl, imgIdx) => (
                              <div
                                key={`view-${idx}-${imgIdx}-${imgUrl.slice(-16)}`}
                                className="relative group rounded-md overflow-hidden border border-purple-100 bg-bg-elevated"
                                style={{ aspectRatio: '9 / 16' }}
                              >
                                <img
                                  src={imgUrl}
                                  alt={`Panel ${panel.panel_number} redraw ${imgIdx + 1}`}
                                  className="absolute inset-0 w-full h-full object-cover cursor-zoom-in hover:scale-105 transition-transform"
                                  onClick={() => {
                                    const all = redrawnPanelImages[idx] || [];
                                    const i = all.indexOf(imgUrl);
                                    setLightboxPanelIdx(idx);
                                    setLightboxImageIdx(i >= 0 ? i : 0);
                                    setLightboxImageList(all);
                                    setShowRedrawLightbox(true);
                                  }}
                                />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                                  <button
                                    onClick={() => {
                                      const all = redrawnPanelImages[idx] || [];
                                      const i = all.indexOf(imgUrl);
                                      setLightboxPanelIdx(idx);
                                      setLightboxImageIdx(i >= 0 ? i : 0);
                                      setLightboxImageList(all);
                                      setShowRedrawLightbox(true);
                                    }}
                                    className="w-5 h-5 rounded-full bg-white/90 text-gray-800 hover:bg-white flex items-center justify-center"
                                    title={displayLang === 'zh' ? '放大' : 'Zoom'}
                                  >
                                    <ZoomIn size={9} />
                                  </button>
                                  <button
                                    onClick={() => handleDownload(imgUrl)}
                                    className="w-5 h-5 rounded-full bg-white/90 text-gray-800 hover:bg-white flex items-center justify-center"
                                    title={displayLang === 'zh' ? '下载' : 'Download'}
                                  >
                                    <Download size={9} />
                                  </button>
                                  <button
                                    onClick={() => {
                                      handleToggleFavorite(imgUrl, panel.image_prompt);
                                      setFavorites(getFavorites());
                                    }}
                                    className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
                                      isFavoritedFn(imgUrl)
                                        ? 'bg-red-500 text-white hover:bg-red-600'
                                        : 'bg-white/90 text-gray-800 hover:bg-white'
                                    }`}
                                    title={displayLang === 'zh' ? '收藏' : 'Favorite'}
                                  >
                                    <Heart size={9} fill={isFavoritedFn(imgUrl) ? 'currentColor' : 'none'} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Lightbox */}
      {showLightbox && heroImage && (
        <div
          className="fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center animate-fade-in"
          onClick={() => setShowLightbox(false)}
        >
          <div className="relative w-full h-full flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowLightbox(false)}
              className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
            >
              <X size={20} />
            </button>

            {/* Image navigation for multiple images (txt2img only) */}
            {!digitalHumanMode && gridImages.length > 1 && activeImageIdx > 0 && (
              <button
                onClick={() => setActiveImageIdx(i => i - 1)}
                className="absolute left-4 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
              >
                <ChevronLeft size={24} />
              </button>
            )}

            <img
              src={heroImage}
              alt="Grid Storyboard"
              className="max-w-full max-h-full object-contain rounded-lg"
            />

            {!digitalHumanMode && gridImages.length > 1 && activeImageIdx < gridImages.length - 1 && (
              <button
                onClick={() => setActiveImageIdx(i => i + 1)}
                className="absolute right-4 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
              >
                <ChevronRight size={24} />
              </button>
            )}

            {/* Bottom actions */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3">
              {!digitalHumanMode && gridImages.length > 1 && (
                <span className="px-3 py-2 rounded-xl bg-black/60 text-white text-sm font-medium">
                  {activeImageIdx + 1} / {gridImages.length}
                </span>
              )}
              <button
                onClick={() => handleDownload()}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/90 text-gray-800 text-sm font-medium hover:bg-white transition-colors"
              >
                <Download size={16} /> {displayLang === 'zh' ? '下载' : 'Download'}
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(fullPrompt);
                  onSuccess('提示词已复制');
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/90 text-gray-800 text-sm font-medium hover:bg-white transition-colors"
              >
                <Copy size={16} /> {displayLang === 'zh' ? '复制提示词' : 'Copy Prompt'}
              </button>
              <button
                onClick={handleRegenerate}
                disabled={isGenerating}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 transition-colors disabled:opacity-50"
              >
                {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                {displayLang === 'zh' ? '重新生成' : 'Regenerate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Redraw Lightbox */}
      {showRedrawLightbox && lightboxImageList[lightboxImageIdx] && (
        <div
          className="fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center animate-fade-in"
          onClick={() => setShowRedrawLightbox(false)}
        >
          <div className="relative w-full h-full flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowRedrawLightbox(false)}
              className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
            >
              <X size={20} />
            </button>

            {lightboxImageList.length > 1 && lightboxImageIdx > 0 && (
              <button
                onClick={() => setLightboxImageIdx((i) => Math.max(0, i - 1))}
                className="absolute left-4 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
              >
                <ChevronLeft size={24} />
              </button>
            )}

            <img
              src={lightboxImageList[lightboxImageIdx]}
              alt={`Panel ${(lightboxPanelIdx ?? 0) + 1} redraw`}
              className="max-w-full max-h-full object-contain rounded-lg"
            />

            {lightboxImageList.length > 1 && lightboxImageIdx < lightboxImageList.length - 1 && (
              <button
                onClick={() => setLightboxImageIdx((i) => Math.min(lightboxImageList.length - 1, i + 1))}
                className="absolute right-4 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
              >
                <ChevronRight size={24} />
              </button>
            )}

            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3">
              <span className="px-3 py-2 rounded-xl bg-black/60 text-white text-sm font-medium">
                {displayLang === 'zh'
                  ? `第 ${(lightboxPanelIdx ?? 0) + 1} 镜重绘 ${lightboxImageIdx + 1}/${lightboxImageList.length}`
                  : `Panel ${(lightboxPanelIdx ?? 0) + 1} redraw ${lightboxImageIdx + 1}/${lightboxImageList.length}`}
              </span>
              <button
                onClick={() => handleDownload(lightboxImageList[lightboxImageIdx])}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/90 text-gray-800 text-sm font-medium hover:bg-white transition-colors"
              >
                <Download size={16} /> {displayLang === 'zh' ? '下载' : 'Download'}
              </button>
              <button
                onClick={() => {
                  const url = lightboxImageList[lightboxImageIdx];
                  handleToggleFavorite(url, panels[lightboxPanelIdx ?? 0]?.image_prompt);
                  setFavorites(getFavorites());
                }}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                  isFavoritedFn(lightboxImageList[lightboxImageIdx])
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'bg-white/90 text-gray-800 hover:bg-white'
                }`}
              >
                <Heart
                  size={16}
                  fill={isFavoritedFn(lightboxImageList[lightboxImageIdx]) ? 'currentColor' : 'none'}
                />
                {displayLang === 'zh' ? '收藏' : 'Favorite'}
              </button>
              <button
                onClick={() => {
                  if (lightboxPanelIdx !== null) {
                    setShowRedrawLightbox(false);
                    handleRedrawPanel(lightboxPanelIdx);
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 transition-colors"
              >
                <RefreshCw size={16} />
                {displayLang === 'zh' ? '再次重绘' : 'Redraw Again'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ClockIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
