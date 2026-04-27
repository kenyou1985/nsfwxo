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
 * Uses line-based parsing to correctly handle field values containing
 * characters that look like field label prefixes.
 */
function parseNormalizedText(raw: string): { panels: ParsedScriptPanel[]; errors: string[] } {
  const panels: ParsedScriptPanel[] = [];
  const errors: string[] = [];

  // Field label names (without regex) — must match /^LABEL/
  const FIELD_LABELS: { label: string; field: string }[] = [
    { label: '视频提示词', field: 'video_prompt' },
    { label: '图片提示词', field: 'image_prompt' },
    { label: '镜头文案',   field: 'scene_description' },
    { label: '景别',       field: 'shot_type' },
    { label: '语音分镜',   field: 'voiceover' },
    { label: '音效',       field: 'sound_cue' },
  ];

  // Build regex that matches any field label at the start of a line
  // The label can be followed by : or ： and optional whitespace
  const labelRegex = new RegExp(
    '^(' + FIELD_LABELS.map((f) => f.label).join('|') + ')[：:][ \\t]*',
    'mu'
  );

  // Split into panel blocks by "镜头" header (at line start)
  const panelBlocks = raw.split(/(?=^镜头\s*\d+)/mu);

  for (const block of panelBlocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Extract panel number from header
    const headerMatch = trimmed.match(/^镜头\s*(\d+)/m);
    const panel_number = headerMatch ? parseInt(headerMatch[1], 10) : 0;

    // Parse all labeled fields within this block using line scanning
    const fieldValues: Record<string, string> = {};
    const lines = trimmed.split('\n');
    let currentField = '';
    let currentLines: string[] = [];

    const flushField = () => {
      if (currentField && currentLines.length > 0) {
        fieldValues[currentField] = currentLines.join('\n').trim();
      }
      currentField = '';
      currentLines = [];
    };

    for (const line of lines) {
      const labelMatch = line.match(labelRegex);
      if (labelMatch) {
        flushField();
        // Find which field this label corresponds to
        const matchedText = labelMatch[1];
        const fieldDef = FIELD_LABELS.find((f) => f.label === matchedText);
        if (fieldDef) {
          currentField = fieldDef.field;
          // Value is everything after the label part (preserving the rest of this line)
          const afterLabel = line.substring(labelMatch[0].length);
          currentLines.push(afterLabel);
        }
      } else {
        // Continuation line — only append if we're inside a field value
        if (currentField) {
          currentLines.push(line);
        }
        // Otherwise (e.g. "镜头1" header line with no content) — skip
      }
    }
    flushField();

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
