import type { GridPanel } from './storage';

/**
 * 把九宫格分镜转成 MiniMax H3 六段式 60 秒视频提示词。
 * 一格一镜；最多 15 个 shot，默认 9 格 9 个 shot。
 */
export function buildGridH3VideoPrompt(panels: GridPanel[], title = '九宫格分镜'): string {
  const shots = panels.slice(0, 15);
  const shotLines = shots.map((p, i) => {
    const t = (i * 60 / Math.max(1, shots.length)).toFixed(1).padStart(4, '0');
    const text = (p.image_prompt || p.scene_description || '').replace(/\s+/g, ' ').trim();
    return `[Shot ${i + 1}] At 00:${t}.000, ${text}`;
  });

  return `subject_definitions:
<Subject 1> is @Woman <Picture 1> — the East Asian woman in the first frame; preserve her exact face, hair, body proportions and clothing from <Picture 1>.
<Subject 2> is @Scene — ${title}; keep the same location, lighting and props in every shot.

summary:
[reference generation] A 60-second vertical short film built from a 9-grid storyboard. Each grid cell is one shot; the nine cells form one continuous escalating story with explicit consensual adult interaction. Identity and body proportions stay consistent.

retention_analysis:
<Subject 1> <Picture 1>: fully_preserved — face, hair and body consistent with the first frame.
<Subject 2> @Scene: fully_preserved — same location, lighting and props in all shots.

detailed_description:
${shotLines.join('\n')}
The 9-grid storyboard is the shot plan: each cell is a shot, cut in cell order, no repeated panel and no new unrelated scene.

overall_soundscape: room tone, fabric friction, skin contact and breathing. Only the exact dialogue inside <d>...</d> tags may be spoken; no improvised lines, no whispers, no chatter, no narrator, no crowd.
non_diegetic_music: None`;
}
