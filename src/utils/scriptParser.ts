/**
 * Storyboard Script Parser
 * Parses multi-shot storyboard script text (e.g. from pasted scripts)
 * into structured panel data. Handles garbled/mixed-script text.
 */

// Garbled video-label normalization.
//
// AI corrupts "视频提示词" into Bengali/Devanagari prefix + garbage suffix.
// The suffix is a random non-Chinese character(s) after "提示".
//
// Known variants from production:
//   Prefix (Bengali):  ভিডিও  ভিডিও  ভিডিও
//   Prefix (mixed):    ভিডিয়ো  ভিডिओ
//   Suffix garbage:    尉 ు ு ் ॄ ि ք  ו 尉 ు 尉 ु 出 梄尉 梄尉 尉 出
//                     ים  ג եં び ե 梄 梄 出
//   Embedded colon:    ডিও提示び:t  (the :t is part of garbage before the value)
//
// Approach: use a regex that matches the structural pattern:
//   (ভিড(?:ি(?:ও|ো)|িও)|ডিও) — Bengali/Devanagari video prefix
//   提示                           — correct Chinese "提示"
//   (?:[^\n:]*?)                  — any non-colon/non-newline garbage (lazy)
//   (?=[:\n]|$)                   — stop before colon/label separator or end-of-text
//
// This handles all cases:
//   "ভিডিও提示尉:Camera"   → "视频提示词:Camera"
//   "ডিও提示び:t 12:30"     → "视频提示词 12:30"  (colon in garbage → dropped)
//   "ভিডিও提示尉" (end)     → "视频提示词"
//   "ভিডিও提示尉\n景别:..." → "视频提示词\n景别:..."
// ────────────────────────────────────────────────────────────────────────────────

// Matches any garbled "视频提示词" variant:
//   Group 1: the Bengali/Devanagari video prefix
//   Then 提示 (literal)
//   Then any non-colon/non-newline chars (lazy)
//   Stop at next colon, newline, or end-of-string
const GARBLED_VIDEO_LABEL_RE =
  /((?:ভিড(?:ি(?:ও|ো)|িও)|ডিও)提示[^\n:]*?)(?=[:\n]|$)/gu;

// Matches garbled video label at end of string (no colon follows):
// Handles cases like "ভিডিও提示尉" at the very end of the text.
const GARBLED_VIDEO_LABEL_END_RE =
  /((?:ভিড(?:ি(?:ও|ো)|িও)|ডিও)提示[^\n]*$)/gmu;

function replaceGarbledVideoLabel(
  match: string,
  _prefix: string,
  _offset: number,
  _text: string
): string {
  return '视频提示词';
}

function replaceGarbledVideoLabelEnd(
  match: string,
  _prefix: string,
  _offset: number,
  _text: string
): string {
  return '视频提示词';
}

// ─── Time word conversion ────────────────────────────────────────────────────────

const NUM_TO_WORDS: Record<number, string> = {
  0: 'o\'clock',
  1: 'one', 2: 'two', 3: 'three', 4: 'four',
  5: 'five', 6: 'six', 7: 'seven', 8: 'eight',
  9: 'nine', 10: 'ten', 11: 'eleven', 12: 'twelve',
  13: 'thirteen', 14: 'fourteen', 15: 'fifteen', 16: 'sixteen',
  17: 'seventeen', 18: 'eighteen', 19: 'nineteen',
  20: 'twenty', 30: 'thirty', 40: 'forty', 50: 'fifty',
};

function hourToWord(h: number): string {
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return NUM_TO_WORDS[h12] ?? String(h12);
}

function minuteToWord(m: number): string {
  if (m === 0) return 'o\'clock';
  if (m === 15) return 'fifteen';
  if (m === 30) return 'thirty';
  if (m === 45) return 'forty-five';
  if (m < 10) return NUM_TO_WORDS[m] ?? `oh ${NUM_TO_WORDS[m]}`;
  if (m < 20) return NUM_TO_WORDS[m] ?? String(m);
  const tens = Math.floor(m / 10) * 10;
  const ones = m % 10;
  return ones === 0 ? NUM_TO_WORDS[tens]! : `${NUM_TO_WORDS[tens]}-${NUM_TO_WORDS[ones]}`;
}

function convertTime(match: string, hours: string, minutes: string, suffix: string): string {
  const h = parseInt(hours, 10);
  const m = parseInt(minutes, 10);
  if (isNaN(h) || isNaN(m)) return match;
  const hWord = hourToWord(h);
  const mWord = minuteToWord(m);
  const suffixNorm = suffix.replace(/[. ]/g, '').toLowerCase();
  const suffixWord = suffixNorm === 'am' ? 'a.m.' : suffixNorm === 'pm' ? 'p.m.' : suffix;
  return `${hWord} ${mWord} ${suffixWord}`.trim();
}

/**
 * Convert numeric time formats in English text to word format.
 * e.g. "11:40 a.m." → "eleven forty a.m."
 *      "around 3:15" → "around three fifteen"
 * Handles times without am/pm suffix as well.
 */
function convertTimesToWords(text: string): string {
  // Guard: skip ordinals like "8th", "12th"
  return text.replace(
    /(\d{1,2}):(\d{2})([ .]*?(?:a\.?m\.?|p\.?m\.?))?/gi,
    (match, hours, minutes, suffix) => {
      if (/^\d{1,2}th?$/i.test(hours)) return match;
      if (suffix !== undefined) {
        const norm = suffix.replace(/[ .]/g, '').toLowerCase();
        if (norm && !/^(a\.?m\.?|p\.?m\.?)$/i.test(norm)) return match;
      }
      return convertTime(match, hours, minutes, suffix ?? '');
    }
  );
}

/**
 * Normalize garbled text: replace Bengali/Indian-script garbled "视频提示词"
 * labels with correct Chinese, and normalize "动画" variants.
 * Also ensures each field label starts on its own line for reliable parsing.
 */
export function normalizeScriptText(text: string): string {
  let result = text;

  // Step 1: Replace garbled video labels (prefix + 提示 + garbage) with correct Chinese.
  // Run the main regex first (handles labels followed by colon/newline):
  result = result.replace(GARBLED_VIDEO_LABEL_RE, replaceGarbledVideoLabel);

  // Run the end-of-string regex for any remaining garbled labels at text end:
  result = result.replace(GARBLED_VIDEO_LABEL_END_RE, replaceGarbledVideoLabelEnd);

  // Also handle garbled prefix + correct 提示词 suffix (rare case):
  result = result.replace(
    /((?:ভিড(?:ি(?:ও|ো)|িও)|ডিও)提示词)/gu,
    '视频提示词'
  );

  // Normalize "动画提示词" → "视频提示词"
  result = result.replace(/动画提示词/g, '视频提示词');

  // Convert numeric times to English words so they render correctly in image prompts
  // e.g. "11:40 a.m." → "eleven forty a.m."
  result = convertTimesToWords(result);

  // Ensure each field label starts on its own line.
  // All label variants (simplified + traditional) for newline insertion
  const labels = [
    '视频提示词', '視頻提示詞', '动画提示词', '動畫提示詞',
    '图片提示词', '圖片提示詞',
    '镜头文案', '鏡頭文案',
    '景别', '景別',
    '语音分镜', '語音分鏡',
    '音效',
    '镜头', '鏡頭',
  ];
  for (const label of labels) {
    result = result.replace(new RegExp(
      '(?<!\\n)(?=' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')',
      'g'
    ), '\n');
  }

  return result;
}

export interface ParsedScriptPanel {
  panel_number: number;
  scene_description: string;
  image_prompt: string;
  video_prompt: string;
  shot_type: string;
  voiceover: string;
  sound_cue: string;
  raw_text: string;
}

export interface ParseScriptResult {
  panels: ParsedScriptPanel[];
  parse_errors: string[];
  raw_text: string;
}

/**
 * Parse the raw script text (already normalized) into panels.
 * Handles two formats:
 * 1. Multi-line: each field on its own line (proper formatting)
 * 2. Single-line / OCR: fields separated by LABEL:VALUE without newlines
 */
function parseNormalizedText(raw: string): { panels: ParsedScriptPanel[]; errors: string[] } {
  const panels: ParsedScriptPanel[] = [];
  const errors: string[] = [];

  const FIELD_LABELS: { label: string; field: string }[] = [
    { label: '视频提示词', field: 'video_prompt' },
    { label: '視頻提示詞', field: 'video_prompt' },
    { label: '动画提示词', field: 'video_prompt' },
    { label: '動畫提示詞', field: 'video_prompt' },
    { label: '图片提示词', field: 'image_prompt' },
    { label: '圖片提示詞', field: 'image_prompt' },
    { label: '镜头文案',   field: 'scene_description' },
    { label: '鏡頭文案',   field: 'scene_description' },
    { label: '景别',       field: 'shot_type' },
    { label: '景別',       field: 'shot_type' },
    { label: '语音分镜',   field: 'voiceover' },
    { label: '語音分鏡',   field: 'voiceover' },
    { label: '音效',       field: 'sound_cue' },
  ];

  const escapedLabels = FIELD_LABELS.map((f) => f.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Add garbled video prefix patterns to the lookahead so they never become field boundaries
  const garbledPrefixes = [
    '(?:ভিড(?:ি(?:ও|ো)|িও)|ডিও)提示[^\\n:]*?',
  ];
  const allLabelLookahead = [...escapedLabels, ...garbledPrefixes].join('|');
  const labelRegex = new RegExp(
    '(?:^|(?:\\n))(' + escapedLabels.join('|') + ')[：:][ \\t]*',
    'gmu'
  );

  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Split into panel blocks by "镜头" header (both simplified and traditional)
  const panelBlocks = normalized.split(/(?=^(?:镜头|鏡頭)\s*\d+)/mu);

  for (const block of panelBlocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const headerMatch = trimmed.match(/^(?:镜头|鏡頭)\s*(\d+)/m);
    const panel_number = headerMatch ? parseInt(headerMatch[1], 10) : 0;

    const fieldValues: Record<string, string> = {};

    for (const fl of FIELD_LABELS) {
      const escaped = fl.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const fieldRegex = new RegExp(
        '(?:^|(?:\\n))(' + escaped + ')[：:][ \\t]*(.*?)(?=(?:\\n)(?:' + allLabelLookahead + ')[：:]|$)',
        'smu'
      );
      const match = trimmed.match(fieldRegex);
      if (match && match[1]) {
        fieldValues[fl.field] = match[2].trim();
      }
    }

    const hasContent =
      fieldValues['scene_description'] ||
      fieldValues['image_prompt'] ||
      fieldValues['video_prompt'] ||
      fieldValues['shot_type'];

    if (hasContent) {
      panels.push({
        panel_number,
        scene_description: fieldValues['scene_description'] || '',
        image_prompt: fieldValues['image_prompt'] || '',
        video_prompt: fieldValues['video_prompt'] || '',
        shot_type: fieldValues['shot_type'] || '',
        voiceover: fieldValues['voiceover'] || '',
        sound_cue: fieldValues['sound_cue'] || '',
        raw_text: trimmed,
      });
    }
  }

  return { panels, errors };
}

/**
 * Main entry point: normalize + parse script text.
 */
export function parseStoryboardScript(rawText: string): ParseScriptResult {
  if (!rawText.trim()) {
    return { panels: [], parse_errors: [], raw_text: '' };
  }

  const normalized = normalizeScriptText(rawText);
  const { panels, errors } = parseNormalizedText(normalized);

  return {
    panels,
    parse_errors: errors,
    raw_text: normalized,
  };
}

/**
 * Convert parsed panels to the app's VideoScriptPanel format.
 */
export function toVideoScriptPanels(
  parsed: ParsedScriptPanel[]
): Array<{
  panel: number;
  heading: string;
  action: string;
  dialogue: string;
  sound_cue: string;
  camera: string;
}> {
  return parsed.map((p) => ({
    panel: p.panel_number,
    heading: p.scene_description || '',
    action: p.video_prompt || '',
    dialogue: p.voiceover || '',
    sound_cue: p.sound_cue || '',
    camera: p.shot_type || '',
  }));
}
