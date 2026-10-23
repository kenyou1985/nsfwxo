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
    const raw = (p.image_prompt || p.scene_description || '').replace(/\s+/g, ' ').trim();
    const panelMatch = raw.match(/Panel\s*\d+\s*:\s*(.*)$/i);
    let text = (panelMatch ? panelMatch[1] : raw)
      .replace(/\[ANCHOR:[^\]]*\]/gi, '')
      .replace(/cinematic storyboard grid[^.]*\.?/gi, '')
      .replace(/\b\d+\s*panels?[^.]*\.?/gi, '')
      .replace(/3\s*[x×]\s*3[^.]*\.?/gi, '')
      .replace(/storyboard/gi, 'cinematic frame')
      .replace(/\s+/g, ' ')
      .trim();
    // 单镜只保留一种服装状态，避免“穿着戏服 + fully nude”互相冲突
    const hasCostume = /costume|leotard|dress|lingerie|thong|stockings|heels|tuxedo|tailcoat/i.test(text);
    if (hasCostume) text = text.replace(/\bfully nude\b/gi, 'partially undressed');
    // 收尾镜头明确“精液在脸上”，避免模型把 facial 误画成舔脸/接吻
    if (i === shots.length - 1) {
      text = text
        .replace(/\bfacial\b/gi, 'thick white semen streaking across her cheek and open mouth')
        .replace(/tongue[^.]*\.?/gi, 'only her own tongue visible, no other person\'s tongue or mouth on her face.');
    }
    // 每镜限制长度，防止一格里塞入过多动作
    if (text.length > 520) text = text.slice(0, 520).replace(/[,，]\s*$/, '') + '.';

    let line = `[Shot ${i + 1}] At 00:${time}.000, ${text}`;
    if (i === 2) line += ` The East Asian woman whispers (S1): <d>[Chinese] ${dialogue[0]}</d>`;
    if (i === 5 && hasMale) line += ` The East Asian man answers low (S2): <d>[Chinese] ${dialogue[1]}</d>`;
    return line;
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
