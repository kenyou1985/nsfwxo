import type { GridPanel } from './storage';

/**
 * 把九宫格分镜转成 MiniMax H3 六段式 60 秒视频提示词。
 * 一格一镜；最多 15 个 shot，默认 9 格 9 个 shot。
 */
export function buildGridH3VideoPrompt(panels: GridPanel[], title = '九宫格分镜'): string {
  const shots = panels.slice(0, 15);
  const allText = panels.map(p => `${p.image_prompt || ''} ${p.scene_description || ''}`).join(' ');
  const hasMale = /男人|男性|男主|他|man\b/i.test(allText);
  const t = title;
  const dialogue = /偷拍|窥|偷情/.test(t)
    ? ['求求你放过我……', '不要出声。']
    : /乳胶|拘束|捆绑|SM/i.test(t)
      ? ['不要这样……很疼。', '乖乖听话。']
      : /公交|地铁|车厢|公共/.test(t)
        ? ['不要在这里……', '不许叫。']
        : ['求求你……慢一点。', '夹紧，别出声。'];
  const shotLines = shots.map((p, i) => {
    const time = (i * 60 / Math.max(1, shots.length)).toFixed(1).padStart(4, '0');
    const text = (p.image_prompt || p.scene_description || '').replace(/\s+/g, ' ').trim();
    let line = `[Shot ${i + 1}] At 00:${time}.000, ${text}`;
    if (i === 2) line += ` The East Asian woman whispers (S1): <d>[Chinese] ${dialogue[0]}</d>`;
    if (i === 5 && hasMale) line += ` The East Asian man answers low (S2): <d>[Chinese] ${dialogue[1]}</d>`;
    return line;
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
The 9-grid storyboard is the shot plan. Extract the cells in strict left-to-right, top-to-bottom order and use each cell as the literal first frame of its corresponding shot. Cut in cell order; no repeated panel, no skipped cell, no new unrelated scene.

overall_soundscape: room tone, fabric friction, skin contact and breathing. Only the exact dialogue inside <d>...</d> tags may be spoken; no improvised lines, no whispers, no chatter, no narrator, no crowd.
non_diegetic_music: None`;
}
