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

/**
 * Field label patterns to match (normalized + variants).
 * Order matters: more specific patterns first.
 */
const FIELD_PATTERNS: { label: string; pattern: RegExp; field: string }[] = [
  { label: '视频提示词', pattern: /视频提示词[：:]\s*/i, field: 'video_prompt' },
  { label: '图片提示词', pattern: /图片提示词[：:]\s*/i, field: 'image_prompt' },
  { label: '镜头文案',   pattern: /镜头文案[：:]\s*/i, field: 'scene_description' },
  { label: '景别',       pattern: /景别[：:]\s*/i, field: 'shot_type' },
  { label: '语音分镜',   pattern: /语音分镜[：:]\s*/i, field: 'voiceover' },
  { label: '音效',       pattern: /音效[：:]\s*/i, field: 'sound_cue' },
  { label: '镜头',       pattern: /镜头\d*[：:]\s*/i, field: 'shot_number' },
];

/**
 * Parse a block of storyboard script text into structured panels.
 * Returns an array of parsed panels with all fields extracted.
 */
export interface ParsedScriptPanel {
  panel_number: number;
  scene_description: string;
  image_prompt: string;
  video_prompt: string;
  shot_type: string;
  voiceover: string;
  sound_cue: string;
  /** Raw text of this block before parsing */
  raw_text: string;
}

export interface ParseScriptResult {
  panels: ParsedScriptPanel[];
  parse_errors: string[];
  raw_text: string;
}

/**
 * Parse the raw script text (already normalized) into panels.
 */
function parseNormalizedText(raw: string): { panels: ParsedScriptPanel[]; errors: string[] } {
  const panels: ParsedScriptPanel[] = [];
  const errors: string[] = [];

  // Split into blocks by "镜头" header
  // Pattern: "镜头1\n" or "镜头 1\n" or "镜头1：" etc.
  const blocks = raw.split(/(?=^镜头\s*\d+)/mu);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (!block) continue;

    // Extract panel number from header
    const headerMatch = block.match(/^镜头\s*(\d+)/m);
    const panel_number = headerMatch ? parseInt(headerMatch[1], 10) : i + 1;

    // Initialize fields
    const fields: Record<string, string> = {
      panel_number: String(panel_number),
      scene_description: '',
      image_prompt: '',
      video_prompt: '',
      shot_type: '',
      voiceover: '',
      sound_cue: '',
    };

    // Try to extract each field
    for (const fp of FIELD_PATTERNS) {
      const match = block.match(fp.pattern);
      if (match) {
        const afterLabel = block.substring(match.index! + match[0].length);
        // Field value ends at next field label, blank line, or end
        let value = '';
        let endIdx = -1;
        for (const nextFp of FIELD_PATTERNS) {
          const nextMatch = afterLabel.indexOf(nextFp.pattern.source.match(/^[^\[]*/)![0]);
          if (nextMatch !== -1 && (endIdx === -1 || nextMatch < endIdx)) {
            endIdx = nextMatch;
          }
        }
        // Also end at double newline
        const blankIdx = afterLabel.search(/\n\s*\n/);
        if (blankIdx !== -1 && (endIdx === -1 || blankIdx < endIdx)) {
          endIdx = blankIdx;
        }

        value = endIdx === -1 ? afterLabel.trim() : afterLabel.substring(0, endIdx).trim();
        fields[fp.field] = value;
      }
    }

    // Only add if we found at least some content
    const hasContent = fields.scene_description || fields.image_prompt || fields.video_prompt || fields.shot_type;
    if (hasContent) {
      panels.push({
        panel_number,
        scene_description: fields.scene_description,
        image_prompt: fields.image_prompt,
        video_prompt: fields.video_prompt,
        shot_type: fields.shot_type,
        voiceover: fields.voiceover,
        sound_cue: fields.sound_cue,
        raw_text: block,
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
