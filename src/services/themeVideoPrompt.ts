import type { GridPanel } from './storage';

/**
 * 把九宫格分镜转成 MiniMax H3 六段式 60 秒视频提示词。
 * 一格一镜；最多 15 个 shot，默认 9 格 9 个 shot。
 */
export function buildGridH3VideoPrompt(panels: GridPanel[], title = '九宫格分镜'): string {
  const cells = (panels || []).filter(Boolean).slice(0, 9);
  const shotSpecs = cells.flatMap((p, i) => {
    const raw = (p.image_prompt || p.scene_description || '').replace(/\s+/g, ' ').trim();
    const panelMatch = raw.match(/Panel\s*\d+\s*:\s*(.*)$/i);
    const text = (panelMatch ? panelMatch[1] : raw)
      .replace(/\[ANCHOR:[^\]]*\]/gi, '')
      .replace(/cinematic storyboard grid[^.]*\.?/gi, '')
      .replace(/\b\d+\s*panels?[^.]*\.?/gi, '')
      .replace(/3\s*[x×]\s*3[^.]*\.?/gi, '')
      .replace(/\bfully nude\b/gi, 'partially undressed')
      .trim()
      .slice(0, 420);
    return [
      { i, text: `${text} Medium framing, hold the exact storyboard-cell composition.` },
      { i, text: `${text} Cut to a closer angle, same pose and same clothing state, action continues.` },
      { i, text: `${text} Detail or face close-up, same action continues and ends on a small movement.` },
    ];
  });
  const shotLines = shotSpecs.map((s, idx) => {
    const time = (idx * 60 / Math.max(1, shotSpecs.length)).toFixed(1).padStart(4, '0');
    return `[Shot ${idx + 1}] At 00:${time}.000, ${s.text}`;
  });
  return `subject_definitions:
<Subject 1> is @Woman <Picture 1> — the East Asian woman in the first frame; preserve her exact face, hair, body proportions and clothing from <Picture 1>.
<Subject 2> is @Scene — ${title}; keep the same location, lighting and props in every shot.

summary:
[reference generation] A 60-second vertical single-frame cinematic short film with 9 sequential shots and explicit consensual adult interaction. Identity and body proportions stay consistent.

retention_analysis:
<Subject 1> <Picture 1>: fully_preserved — face, hair and body consistent with the first frame.
<Subject 2> @Scene: fully_preserved — same location, lighting and props in all shots.

detailed_description:
${shotLines.join('\n')}
Each shot is ONE single full-frame cinematic image. Do NOT show a storyboard sheet, 3x3 grid, panels, borders, split screen, or multiple images in one frame. Cut in strict shot order; no repeated shot and no unrelated scene.

overall_soundscape: room tone, fabric friction, skin contact and breathing. Only the exact dialogue inside <d>...</d> tags may be spoken; no improvised lines, no whispers, no chatter, no narrator, no crowd.
non_diegetic_music: None`;
}

/** 单个九宫格格子 → 7 秒 H3 提示词（2-3 个 shot，同一格内推进） */
export function buildGridCellH3Prompt(panel: any, index: number, total = 9): string {
  const raw = String(panel?.image_prompt || panel?.scene_description || '').replace(/\s+/g, ' ').trim();
  const cleaned = raw
    .replace(/\[ANCHOR:[^\]]*\]/gi, '')
    .replace(/cinematic storyboard grid[^.]*\.?/gi, '')
    .replace(/\b\d+\s*panels?[^.]*\.?/gi, '')
    .replace(/3\s*[x×]\s*3[^.]*\.?/gi, '')
    .replace(/\bfully nude\b/gi, 'partially undressed')
    .trim()
    .slice(0, 480);
  return `subject_definitions:
<Subject 1> is @Woman <Picture 1> — the East Asian woman in this storyboard cell; preserve her exact face, hair and body proportions from <Picture 1>.
<Subject 2> is @Scene — the same location, lighting and props as <Picture 1>.

summary:
[reference generation] A 15-second vertical shot continuing storyboard cell ${index + 1} of ${total}. Three micro-shots inside the same scene, same body state and same camera axis.

retention_analysis:
<Subject 1> <Picture 1>: fully_preserved — face, hair, body proportions and identity stay consistent.

detailed_description:
[Shot 1] At 00:00.000, ${cleaned} Hold the exact framing of <Picture 1> as the literal first frame with only breathing and a very slow push-in.
[Shot 2] At 00:05.000, the same pose and same clothing state, cut to a closer angle on the primary action; keep hands, body contact and eye line continuous with Shot 1.
[Shot 3] At 00:10.000, the same action continues, cut to a face or detail close-up, end on a small movement that leads into the next storyboard cell.

overall_soundscape: room tone, fabric friction, skin contact and breathing. Only the exact dialogue inside <d>...</d> tags may be spoken; no improvised lines, no narrator.
non_diegetic_music: None`;
}
