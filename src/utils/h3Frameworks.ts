/**
 * H3 场景框架层（与具体主题无关）
 *
 * 框架只约束：谁在说话、最多几句、谁能说话、声线映射、基本结构。
 * 具体动作/地点/服装仍然来自当前主题剧本，不用框架替换剧情。
 */
export type H3Framework = 'consensual' | 'coercive' | 'solo' | 'lesbian';

export interface FrameworkMeta {
  id: H3Framework;
  label: string;
  needsMale: boolean;
  maxLinesPerShot: number;
  allowPenetration: boolean;
  actionArc: string[];
  description: string;
}

export const H3_FRAMEWORKS: Record<H3Framework, FrameworkMeta> = {
  consensual: {
    id: 'consensual', label: '双方情愿', needsMale: true, maxLinesPerShot: 2,
    allowPenetration: true,
    actionArc: ['approach', 'kiss/foreplay', 'undress', 'oral', 'penetration', 'climax', 'aftercare'],
    description: '双方自愿、回应式对白，男女声都存在；不强制支配/屈服。',
  },
  coercive: {
    id: 'coercive', label: '非情愿/胁迫', needsMale: true, maxLinesPerShot: 1,
    allowPenetration: true,
    actionArc: ['approach/trap', 'restrain', 'slap/spank/drag', 'strip', 'forced oral', 'penetration position 1', 'penetration position 2', 'join close-up', 'creampie/facial/ass cum', 'resistance weakening', 'submission/aftermath'],
    description: '胁迫、威胁、骚扰、强制脱衣等；男声命令、女声抗拒/求饶；动作推进为主，台词必须短。',
  },
  solo: {
    id: 'solo', label: '单人女性', needsMale: false, maxLinesPerShot: 1,
    allowPenetration: false,
    actionArc: ['setup', 'self-touch', 'toy/fingers', 'climax', 'afterglow'],
    description: '只有女性主体，自慰/玩具/自我高潮；禁止 S2 男声台词。',
  },
  lesbian: {
    id: 'lesbian', label: '女女', needsMale: false, maxLinesPerShot: 2,
    allowPenetration: true,
    actionArc: ['approach', 'kiss', 'mutual touch', 'oral', 'toy/fingers', 'climax', 'aftercare'],
    description: '两名女性，无男性插入；S1/S2 都是女声。',
  },
};

export function detectFramework(theme: string, hasMan: boolean): H3Framework {
  const t = String(theme || '');
  if (/(two women|two girls|lesbian|女女|百合|双女|两个女人|两名女性)/i.test(t)) return 'lesbian';
  if (!hasMan) return 'solo';
  if (/(尾随|跟踪|胁迫|强迫|不情愿|强奸|强暴|迷奸|威胁|骚扰|猥亵|痴汉|凌辱|按在|拖进|锁喉|扒光|rape|coerc|stalk|choke|drag|grope|assault)/i.test(t)) return 'coercive';
  return 'consensual';
}

const MALE_COMMAND = /(别动|别叫|继续|转过去|脱|站好|跪好|趴好|张开|夹紧|不许|闭嘴|看着|叫出来|吞下去|含住|按住了|衣服一件件|这件|裙子|自己把|求我|给谁看|奶子|屁股|巨乳|讲课|下次|教室正好|出丑|这么大|手感|丢脸|巨乳女老师|两件都|讲台|黑板前|这才叫|衣服都|站直|挺胸|给全班|给谁|手放下|讲台就是|一件件都脱|没有衣服|叫。|转过来|让他们看|按着|给我|裙子也别想留|把胸挺起来|再敢动一下|手拿开|记住今天|别想留|挺起来|再敢|张嘴|夹紧|别躲|接好)/;
const FEMALE_PLEA = /(求你|放过|不要|别|放开|疼|轻点|停下|不行|羞|丢脸|救命|我错|饶了我|别摸|别脱|别这样|不敢|你干什么|你怎么|你谁|这里是|谁？|谁\.\.\.)/;

function stripS2(line: string): string {
  return line.replace(/^\(S2\):\s*/i, '(S1): ');
}

function setSpeaker(line: string, speaker: 'S1' | 'S2'): string {
  return line.replace(/^\(S[12]\):\s*/i, `(${speaker}): `);
}

/** 清理一镜中的台词：重新判定明显命令/求饶，按框架剪辑到最多 N 句。 */
function normalizeShotDialogue(block: string, framework: H3Framework): string {
  const lines = block.match(/\(S[12]\):\s*<d>[\s\S]*?<\/d>/g) || [];
  if (!lines.length) return block;

  let cleaned = block;
  for (const line of lines) {
    const inner = line.replace(/^\(S[12]\):\s*/i, '');
    const text = inner.replace(/<[^>]+>/g, '');
    if (framework === 'solo') {
      cleaned = cleaned.replace(line, '');
      continue;
    }
    if (framework === 'lesbian') {
      cleaned = cleaned.replace(line, stripS2(line));
      continue;
    }
    if (framework === 'coercive') {
      if ((MALE_COMMAND.test(text) && !FEMALE_PLEA.test(text)) || /(别躲|张嘴|接好|夹紧|别动|别叫)/.test(text)) cleaned = cleaned.replace(line, setSpeaker(line, 'S2'));
      else if (FEMALE_PLEA.test(text)) cleaned = cleaned.replace(line, setSpeaker(line, 'S1'));
    }
  }

  // 框架级密度控制：每镜最多保留 maxLinesPerShot 句，优先保留 S2 命令 + 一句 S1 反应。
  const kept = (cleaned.match(/\(S[12]\):\s*<d>[\s\S]*?<\/d>/g) || []);
  const max = H3_FRAMEWORKS[framework].maxLinesPerShot;
  if (kept.length > max) {
    // 胁迫框架优先保留男声命令；否则保留第一条，避免把关键命令裁掉后只剩求饶。
    const preferred = framework === 'coercive'
      ? [...kept.filter((l) => /^\(S2\)/i.test(l)), ...kept.filter((l) => /^\(S1\)/i.test(l))]
      : kept;
    const chosen = preferred.slice(0, max);
    const seen = new Set<string>();
    cleaned = cleaned.replace(/\(S[12]\):\s*<d>[\s\S]*?<\/d>/g, (line) => {
      if (chosen.includes(line) && !seen.has(line)) {
        seen.add(line);
        return line;
      }
      return '';
    });
  }
  return cleaned.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
}

export function applyFramework(text: string, framework: H3Framework): string {
  if (!text) return text;
  let out = text;

  // 框架层修正 speaker_mapping，不信任剧本里可能错误的映射。
  if (framework === 'solo') {
    out = out.replace(/\(S2\):\s*<d>[\s\S]*?<\/d>/g, '');
    out = out.replace(/speaker_mapping\s*:\s*\{[\s\S]*?\}/i,
      'speaker_mapping: {"S1":"Chinese (Mandarin)_Adult_Female_Soft"}');
  } else if (framework === 'lesbian') {
    out = out.replace(/\(S2\):\s*<d>[\s\S]*?<\/d>/g, (m) => m.replace(/^\(S2\)/i, '(S1)'));
    out = out.replace(/speaker_mapping\s*:\s*\{[\s\S]*?\}/i,
      'speaker_mapping: {"S1":"Chinese (Mandarin)_Adult_Female_Soft","S2":"Chinese (Mandarin)_Adult_Female_Soft"}');
  } else {
    out = out.replace(/speaker_mapping\s*:\s*\{[\s\S]*?\}/i,
      'speaker_mapping: {"S1":"Chinese (Mandarin)_Adult_Female_Soft","S2":"Chinese (Mandarin)_Adult_Male_Low"}');
  }

  // 按镜头块处理台词，避免跨镜误删。
  out = out.split(/(?=\[Shot\s+\d+\])/).map((block) => {
    if (!/^\[Shot\s+\d+\]/i.test(block)) return block;
    return normalizeShotDialogue(block, framework);
  }).join('');

  return out.replace(/\n{3,}/g, '\n\n');
}



export interface PositionPlan {
  p1: string;
  p2: string;
  p3: string;
}

/** 按场景选择三种插入姿势；只决定“可用空间”，不覆盖主题动作。 */
export function pickPenetrationPositions(context: string): PositionPlan {
  const t = String(context || '');
  if (/(classroom|lecture|blackboard|desk|podium|教室|讲台|黑板|课桌)/i.test(t)) {
    const hasChair = /(chair|stool|椅子|凳子|椅)/i.test(t);
    const hasDesk = /(desk|table|podium|讲台|课桌|桌)/i.test(t);
    return {
      p1: hasDesk ? 'bent over the desk already in the scene, both feet on the floor, chest pressed to the surface' : 'bent over the nearest stable surface already in the scene, taken from behind',
      p2: hasChair && hasDesk
        ? 'one knee on the chair and one leg lifted onto the desk, entering her from behind at a new angle'
        : hasDesk
          ? 'one leg lifted onto the desk, entering her from behind at a new angle, no new furniture added'
          : 'turned and entered with one leg lifted, using only the surface already in frame',
      p3: hasDesk ? 'laid back on the desk in missionary, legs over his shoulders, the same desk under her' : 'laid back on the nearest existing surface in missionary, legs held open',
    };
  }
  if (/(subway|metro|train|carriage|地铁|车厢|列车)/i.test(t)) {
    return {
      p1: 'standing in the same crowded car, bent forward against the pole, taken from behind',
      p2: 'one leg lifted in the aisle, her back against the same pole, entered from the front',
      p3: 'held up against the pole with both legs around him, fucked standing in the same car',
    };
  }
  if (/(bed|mattress|床上|床)/i.test(t)) {
    return {
      p1: 'on all fours on the bed, taken from behind',
      p2: 'on her side with one leg lifted, entered at an angle',
      p3: 'on her back in missionary, legs around his waist',
    };
  }
  if (/(sofa|couch|沙发)/i.test(t)) {
    return {
      p1: 'bent over the sofa arm, taken from behind',
      p2: 'straddling his lap on the sofa, riding him',
      p3: 'laid back on the sofa in missionary, legs pushed up',
    };
  }
  if (/(office|desk|办公|桌子)/i.test(t)) {
    return {
      p1: 'bent over the office desk, taken from behind',
      p2: 'one leg lifted onto the chair, entered at a new angle',
      p3: 'laid back on the desk in missionary',
    };
  }
  if (/(kitchen|counter|厨房|台面)/i.test(t)) {
    return {
      p1: 'bent over the kitchen counter, taken from behind',
      p2: 'one leg lifted onto a stool, entered from the side',
      p3: 'laid back on the counter in missionary',
    };
  }
  return {
    p1: 'bent over the nearest stable surface, taken from behind',
    p2: 'turned and entered with one leg lifted, her back against the surface',
    p3: 'laid back on the surface in missionary, legs held open',
  };
}

/**
 * coercive 框架的最低动作弧：只补缺失的强制 oral/penetration/ending，
 * 不删除主题已有的动作；所有内容仍是当前主题的胁迫场景。
 */
export function ensureCoerciveArc(shots: string[], context = '', targetShots = 12): string[] {
  if (!Array.isArray(shots) || shots.length < 4) return shots;
  // 前 4 镜保留主题自己的接近/压制/反抗/脱上衣；
  // 后半段由 coercive 框架保证：全裸→强制口交→插入→抽插→内射→被迫顺从。
  const headCount = targetShots >= 20 ? Math.min(8, targetShots - 8) : 4;
  const head = shots.slice(0, headCount).map((s) => s.replace(/She is still fully clothed[^.]*\./gi, '').trim());
  // 模型偶尔第一镜只写对白，没有构图；补一个中性视觉锚点，不能让 H3 第一镜空画面。
  if (head[0] && !/(camera|location|body|action|\b(she|her|he|his)\b)/i.test(head[0]) && head[1]) {
    head[0] = `At the current location, she holds the written pose; he stands close behind her, not yet touching. ${head[0]}`;
  }
  const positions = pickPenetrationPositions(context);
  const tail = [
    'He strips the last garment from her; she is completely nude. He then shoves his dark trousers and boxers down to his ankles, frees his cock, and kicks them aside; he is fully nude too; no clothing remains. She stops kicking and only shakes.',
    'He forces her to her knees, fists her hair, and pushes his cock into her mouth; she gags, saliva stringing, hands clawing at his thigh. (S2): <d>[Chinese] 张嘴。</d>',
    `He drags her up by the hair, positions her ${positions.p1}, and drives into her in one hard thrust; her body jolts and she cries out. (S2): <d>[Chinese] 夹紧。</d>`,
    `Without pulling out, he changes her position: ${positions.p2}; she gasps as he enters at the new angle. (S2): <d>[Chinese] 转过来。腿抬好。</d>`,
    'Extreme close-up on the join: his cock sliding in and out of her wet pussy, fluid stringing, her thighs trembling, his hand gripping her raised thigh. (S1): <d>[Chinese] 不要看那里…</d>',
    `He changes once more: ${positions.p3}; then fucks her hard and fast, one hand in her hair, the other holding her hip; her resistance breaks into helpless noise. (S2): <d>[Chinese] 别躲。</d>`,
    'He buries himself to the hilt and finishes inside her; thick creampie pulses out as her resistance collapses into shaking submission. (S2): <d>[Chinese] 接好。</d>',
    'She sinks down against the surface, spent and trembling, fully nude, his hands still on her; he does not dress her. (S1): <d>[Chinese] 我不敢了…</d>',
  ];
  if (targetShots >= 30) {
    // 30 镜/180s：更多前戏、冲突、羞辱和插入姿势；所有家具仍然只取当前场景。
    const long30 = [
      tail[0], tail[1], tail[2], tail[3], tail[4], tail[5],
      'He pulls out and slaps her ass, then pushes her back to her knees for a second oral beat; she gags around him, mascara running, hands braced on his thighs. (S2): <d>[Chinese] 含深点。</d>',
      'He hauls her up by the hair and bends her over the same surface again, this time slower, making her feel every inch; her resistance is nearly gone. (S2): <d>[Chinese] 自己动。</d>',
      'He reaches around to squeeze her breast and rub her clit while he fucks her, forcing a broken moan out of her. (S1): <d>[Chinese] 不要…又要去了…</d>',
      `He turns her into another position: ${positions.p2}; then takes her with slow, deep strokes while she grips the surface. (S2): <d>[Chinese] 看着我。</d>`,
      'Insertion close-up again: his shaft glistening, her inner thighs wet, his fingers spreading her ass while he pushes back in.',
      `He lifts her leg against the board and enters her from the side, using only the wall/board already present. (S2): <d>[Chinese] 站稳。</d>`,
      'He pulls out and makes her lick his shaft clean before pushing her back down; she obeys with a broken, humiliated expression. (S1): <d>[Chinese] 好脏…</d>',
      `Back to ${positions.p1}; he fucks her faster, one hand in her hair, the other spanking her bare ass. (S2): <d>[Chinese] 夹紧。</d>`,
      `He changes to ${positions.p3} and drives deep; her breasts bounce, sweat dripping onto the surface. (S1): <d>[Chinese] 太深了…</d>`,
      'He slows to a punishing grind, making her feel every inch, then pulls almost all the way out and slams back in. (S2): <d>[Chinese] 数着。</d>',
      `He takes her in ${positions.p2} again, this time reaching around to rub her clit in rhythm; her legs shake. (S1): <d>[Chinese] 不要…会坏掉…</d>`,
      'He pulls her upright against his chest, one hand on her throat without crushing, the other holding her hip; she stops fighting. (S2): <d>[Chinese] 乖一点。</d>',
      'He bends her over the surface and spanks her in a slow rhythm, then pushes back inside before she can recover. (S1): <d>[Chinese] 疼…又进来了…</d>',
      'Close-up on her face and the join: tears, sweat, open mouth, his cock sliding in and out of her wet pussy.',
      `He pulls her onto his lap on the same surface, guiding her hips down onto him; she rides him with shaking thighs while he watches her face. (S2): <d>[Chinese] 自己动。</d>`,
      'He holds both her wrists behind her back and takes her in short, hard strokes, his other hand smacking her ass between thrusts. (S1): <d>[Chinese] 太深了…停一下…</d>',
      'He pulls out and slaps his wet cock against her pussy, then pushes back in without warning; she gasps and her nails scrape the surface. (S2): <d>[Chinese] 别躲。</d>',
      'He makes her look at the blackboard while he takes her from behind, one hand in her hair, the other spreading her ass for the camera. (S2): <d>[Chinese] 看着前面。</d>',
      `He turns her onto her back on the same surface in ${positions.p3}; legs over his shoulders, he fucks her through the final stretch. (S2): <d>[Chinese] 接好。</d>`,
      'He buries himself to the hilt and finishes inside her; thick creampie pulses out as her resistance collapses into shaking submission.',
      'She sinks down against the surface, spent and trembling, fully nude, his hands still on her; he does not dress her. (S1): <d>[Chinese] 我不敢了…</d>',
      'Afterglow in the exact same location and position: both bodies still, breathing slowing, sweat cooling on skin; no new act, no reset.',
    ];
    return [...head, ...long30].slice(0, targetShots);
  }
  if (targetShots >= 20) {
    const longTail = [
      tail[0], tail[1], tail[2], tail[3], tail[4], tail[5],
      'He pulls out and slaps her ass, then pushes her back to her knees for a second oral beat; she gags around him, mascara running, hands braced on his thighs. (S2): <d>[Chinese] 含深点。</d>',
      'He hauls her up by the hair and bends her over the same surface again, this time slower, making her feel every inch; her resistance is nearly gone. (S2): <d>[Chinese] 自己动。</d>',
      'He reaches around to squeeze her breast and rub her clit while he fucks her, forcing a broken moan out of her. (S1): <d>[Chinese] 不要…又要去了…</d>',
      'He turns her into the final position: ' + positions.p3 + '; then fucks her through the last stretch, sweat dripping from his chest onto hers.',
      tail[6], tail[7],
    ];
    return [...head, ...longTail].slice(0, targetShots);
  }
  return [...head, ...tail].slice(0, Math.min(12, targetShots));
}
