/**
 * Storyboard Script Parser
 * Parses multi-shot storyboard script text (e.g. from pasted scripts)
 * into structured panel data. Handles garbled/mixed-script text.
 */

// Garbled "视频" prefixes from Bengali/Indian scripts that get rendered
// when AI models corrupt Chinese characters
const GARBLED_VIDEO_PREFIXES = [
  'ভিডಿಯೋ',  // Bengali + Kannada
  'ভিডിയോ',  // Bengali + Malayalam
  'ভিডियো',   // Bengali + Devanagari
];

/**
 * Normalize garbled text: replace Bengali/Indian-script garbled "视频"
 * prefixes with correct Chinese "视频", and normalize "动画" variants.
 */
export function normalizeScriptText(text: string): string {
  let result = text;

  // Fix garbled "视频" prefixes
  for (const prefix of GARBLED_VIDEO_PREFIXES) {
    result = result.replace(new RegExp(prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '视频');
  }

  // Also handle "ভিড" alone followed by "提示词" (partial corruption)
  result = result.replace(/ভিড(?=[提示词])/g, '视频');

  // Normalize "动画提示词" → "视频提示词" (treat animation prompt same as video prompt)
  result = result.replace(/动画提示词/g, '视频提示词');

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
 * Uses indexOf-based field boundary detection — reliable regardless of
 * block content (handles : in timestamps, Chinese chars in body text, etc.).
 */
function parseNormalizedText(raw: string): { panels: ParsedScriptPanel[]; errors: string[] } {
  const panels: ParsedScriptPanel[] = [];
  const errors: string[] = [];

  // Field label names (without regex) — must appear at the start of a line
  const FIELD_LABELS: { label: string; field: string }[] = [
    { label: '视频提示词', field: 'video_prompt' },
    { label: '图片提示词', field: 'image_prompt' },
    { label: '镜头文案',   field: 'scene_description' },
    { label: '景别',       field: 'shot_type' },
    { label: '语音分镜',   field: 'voiceover' },
    { label: '音效',       field: 'sound_cue' },
  ];

  // For each label, build variants: "LABEL：" and "LABEL:"
  const labelVariants: { label: string; colon: string; field: string }[] = [];
  for (const { label, field } of FIELD_LABELS) {
    labelVariants.push({ label, colon: label + '：', field });
    labelVariants.push({ label, colon: label + ':', field });
  }
  // Sort by length descending so longer labels match before shorter ones
  labelVariants.sort((a, b) => b.colon.length - a.colon.length);

  // Split into panel blocks by "镜头" header at line start
  const panelBlocks = raw.split(/(?=^镜头\s*\d+)/mu);

  for (const block of panelBlocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Extract panel number
    const headerMatch = trimmed.match(/^镜头\s*(\d+)/m);
    const panel_number = headerMatch ? parseInt(headerMatch[1], 10) : 0;

    // For each label variant, find its position in the block.
    // We scan through the block by looking for the first occurrence of each
    // label variant, then find the field value between that position and
    // the next field's position (or end of block).
    const labelPositions: { pos: number; field: string }[] = [];

    for (const lv of labelVariants) {
      // Search from the end of the header line onwards to avoid matching "镜头1" itself
      const searchStart = headerMatch ? headerMatch.index! + headerMatch[0].length : 0;
      const pos = trimmed.indexOf(lv.colon, searchStart);
      if (pos !== -1) {
        labelPositions.push({ pos, field: lv.field });
      }
    }

    // Sort by position in text (ascending)
    labelPositions.sort((a, b) => a.pos - b.pos);

    // Extract value for each field: from end of label to start of next label
    const fieldValues: Record<string, string> = {};
    for (let i = 0; i < labelPositions.length; i++) {
      const { pos, field } = labelPositions[i];
      const colonStr = labelVariants.find((lv) => lv.field === field && trimmed.substring(pos, pos + lv.colon.length) === lv.colon)!.colon;
      const valueStart = pos + colonStr.length;
      const valueEnd = i + 1 < labelPositions.length ? labelPositions[i + 1].pos : trimmed.length;
      const rawValue = trimmed.substring(valueStart, valueEnd);
      fieldValues[field] = rawValue.trim();
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
