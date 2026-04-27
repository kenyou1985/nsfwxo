/**
 * Storyboard Script Parser
 * Parses multi-shot storyboard script text (e.g. from pasted scripts)
 * into structured panel data. Handles garbled/mixed-script text.
 */

// Garbled label normalization.
//
// Problem 1 — "视频提示词" gets corrupted into Indic-script prefixes + garbage suffixes:
//   - Prefix:  ভিডিও / ভিডিয়ো / ভিডಿಯೋ / ভিডിയോ / ভিডิও  (Bengali/Devanagari/Kannada/Malayalam)
//   - Suffix:  提示尉 / 提示ు / 提示ு / 提示ि / 提示ք  (Chinese 提示 + random non-Chinese char)
//
// Problem 2 — Time digits before "a.m." / "p.m." can be eaten by regex when the
//   garbled label confuses the field boundary. Fix: normalize garbled labels BEFORE
//   time conversion so the full text is intact.
//
// Approach: replace each garbled label with its correct Chinese equivalent, using a
//   regex that matches the full garbled sequence (prefix + suffix) regardless of the
//   random garbage character after "提示".
//
// ────────────────────────────────────────────────────────────────────────────────

const GARBLED_LABELS: Array<{ garbled: string; correct: string }> = [
  // Prefix: pure Bengali ভিডিও
  { garbled: 'ভিডিও提示尉', correct: '视频提示词' },
  { garbled: 'ভিডিও提示ు', correct: '视频提示词' },
  { garbled: 'ভিডিও提示ு', correct: '视频提示词' },
  { garbled: 'ভিডিও提示ి', correct: '视频提示词' },
  { garbled: 'ভিডিও提示ו', correct: '视频提示词' },
  // Prefix: mixed Bengali-Devanagari ভিডিও
  { garbled: 'ভিডিও提示尉', correct: '视频提示词' },
  { garbled: 'ভিডিও提示ు', correct: '视频提示词' },
  // Prefix: pure Bengali ভিডিয়ো
  { garbled: 'ভিডিয়ো提示尉', correct: '视频提示词' },
  { garbled: 'ভিডিয়ো提示ु', correct: '视频提示词' },
  { garbled: 'ভিডিয়ো提示ք', correct: '视频提示词' },
  // Prefix: Devanagari variant ভিডिओ
  { garbled: 'ভিডिओ提示尉', correct: '视频提示词' },
  { garbled: 'ভিডिओ提示ు', correct: '视频提示词' },
  // Also handle the case where only the prefix is corrupted (suffix is correct 提示词)
  { garbled: 'ভিডಿಯೋ提示词', correct: '视频提示词' },
  { garbled: 'ভিডിയോ提示词', correct: '视频提示词' },
  { garbled: 'ভিডियো提示词', correct: '视频提示词' },
  { garbled: 'ভিডিও提示词', correct: '视频提示词' },
];

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
  // Normalize suffix: strip dots and spaces -> "a.m." or "am" or "p.m."
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
  // Pattern: HH:MM followed by optional am/pm (with flexible dot/space variations)
  // Handles: "11:40 a.m." "11:40 a.m" "11:40 am" "11:40 a.m" "11:40 a. m." "11:40 p.m."
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
 * Normalize garbled text: replace Bengali/Indian-script garbled "视频"
 * prefixes with correct Chinese "视频", and normalize "动画" variants.
 * Also ensures each field label starts on its own line for reliable parsing.
 */
export function normalizeScriptText(text: string): string {
  let result = text;

  // Step 1: Replace garbled full labels (prefix + garbage suffix) with correct Chinese.
  // This must run BEFORE the newline-insertion loop so the garbage doesn't confuse it.
  for (const entry of GARBLED_LABELS) {
    const escaped = entry.garbled.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'g'), entry.correct);
  }

  // Normalize "动画提示词" → "视频提示词"
  result = result.replace(/动画提示词/g, '视频提示词');

  // Convert numeric times to English words so they render correctly in image prompts
  // e.g. "11:40 a.m." → "eleven forty a.m."
  result = convertTimesToWords(result);

  // Ensure each field label starts on its own line.
  // Handles both multi-line scripts (already formatted) and single-line / OCR
  // scripts where labels appear mid-sentence without preceding newlines.
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
    // Insert a newline before the label only if it's NOT already at line start.
    // Pattern: preceded by any character that is NOT a newline or string start.
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

  // Field label names — longer/more specific first.
  // Includes simplified and traditional Chinese variants.
  const FIELD_LABELS: { label: string; field: string }[] = [
    { label: '视频提示词', field: 'video_prompt' },
    { label: '視頻提示詞', field: 'video_prompt' },   // traditional
    { label: '动画提示词', field: 'video_prompt' },
    { label: '動畫提示詞', field: 'video_prompt' },   // traditional
    { label: '图片提示词', field: 'image_prompt' },
    { label: '圖片提示詞', field: 'image_prompt' },   // traditional
    { label: '镜头文案',   field: 'scene_description' },
    { label: '鏡頭文案',   field: 'scene_description' }, // traditional
    { label: '景别',       field: 'shot_type' },
    { label: '景別',       field: 'shot_type' },        // traditional
    { label: '语音分镜',   field: 'voiceover' },
    { label: '語音分鏡',   field: 'voiceover' },        // traditional
    { label: '音效',       field: 'sound_cue' },
  ];

  // Build regex: match field label (at start of string, or after newline),
  // followed by colon/fullwidth-colon and optional whitespace.
  // This works for both multi-line scripts and OCR single-line scripts.
  const escapedLabels = FIELD_LABELS.map((f) => f.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Include garbled labels in the lookahead so the regex never uses them as field boundaries
  const garbledLabelParts = GARBLED_LABELS.map((e) => e.garbled.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const allLabelLookahead = [...escapedLabels, ...garbledLabelParts].join('|');
  const labelRegex = new RegExp(
    '(?:^|(?:\\n))(' + escapedLabels.join('|') + ')[：:][ \\t]*',
    'gmu'
  );

  // Normalize line endings and collapse excessive whitespace
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Split into panel blocks by "镜头" header (both simplified and traditional)
  const panelBlocks = normalized.split(/(?=^(?:镜头|鏡頭)\s*\d+)/mu);

  for (const block of panelBlocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Extract panel number from header
    const headerMatch = trimmed.match(/^(?:镜头|鏡頭)\s*(\d+)/m);
    const panel_number = headerMatch ? parseInt(headerMatch[1], 10) : 0;

    // Extract field values using regex on the whole block string.
    // For each field, find its label position, then take text up to the
    // next label (or end). This correctly handles content that contains
    // characters that look like label starts (e.g. "11:40", "8th Street").
    const fieldValues: Record<string, string> = {};

    for (const fl of FIELD_LABELS) {
      // Find this label in the block
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
