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
  if (/(尾随|跟踪|胁迫|强迫|不情愿|强奸|强暴|迷奸|威胁|骚扰|猥亵|痴汉|凌辱|按在|拖进|锁喉|扒光|rape|coerc|stalk|choke|drag|grope|assault|squat|lick|tongue|under her skirt|against her will|holds her|forces|forced|public violation)/i.test(t)) return 'coercive';
  return 'consensual';
}

const MALE_COMMAND = /(别动|别叫|继续|转过去|脱|站好|跪好|趴好|张开|夹紧|不许|闭嘴|看着|叫出来|吞下去|含住|按住了|衣服一件件|这件|裙子|自己把|求我|给谁看|奶子|屁股|巨乳|讲课|下次|教室正好|出丑|这么大|手感|丢脸|巨乳女老师|两件都|讲台|黑板前|这才叫|衣服都|站直|挺胸|给全班|给谁|手放下|讲台就是|一件件都脱|没有衣服|叫。|转过来|让他们看|按着|给我|裙子也别想留|把胸挺起来|再敢动一下|手拿开|记住今天|别想留|挺起来|再敢|张嘴|夹紧|别躲|接好|站稳|裙子脱掉|内裤留着|自己动|含深点|把舌头|让他舔|手拿开|拿开|别动|别叫|继续写|继续站着|别回头|站好|不许动|松开|趴好|跪好|内裤拉开|让我摸|蹲下|用舌头|喷得|舔干净)/;
const FEMALE_PLEA = /(求你|放过|不要|别|放开|疼|轻点|停下|不行|羞|丢脸|救命|我错|饶了我|别摸|别脱|别这样|不敢|你干什么|你怎么|你谁|这里是|谁？|谁\.\.\.|你在|我裙子|我站不住|好湿|拿开.*好湿|我忍不住|潮吹|我会|我不敢|我错|有人|会看到|要用舌头|吗[。…！？]?$|啊[。…！？]?$)/;

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
      if ((MALE_COMMAND.test(text) && !FEMALE_PLEA.test(text)) || /(别躲|别回头|继续站着|站好|张嘴|接好|夹紧|别动|别叫)/.test(text)) cleaned = cleaned.replace(line, setSpeaker(line, 'S2'));
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

/** 去掉正文里的 S1/S2 代称，只保留真正的台词标签。 */
export function cleanSpeakerProse(text: string): string {
  return String(text || '').split('\n').map((line) => {
    if (/speaker_mapping\s*:/i.test(line)) return line;
    if (/\(S[12]\):\s*<d>/.test(line)) return line;
    return line
      .replace(/\bS2[’']s\b/gi, 'his')
      .replace(/\bS1[’']s\b/gi, 'her')
      .replace(/\bAll S2 lines\b/gi, "All the man's lines")
      .replace(/\bS2\b/g, 'the man')
      .replace(/\bS1\b/g, 'the woman');
  }).join('\n');
}

/** 最终硬校正：只按台词文本判断男女，防止任何前置归一器把男性命令写成 S1。 */
export function enforceH3Speakers(text: string): string {
  if (!text) return text;
  return text.replace(/\(S[12]\):\s*<d>[\s\S]*?<\/d>/g, (line) => {
    const body = line.replace(/^<d>|<\/d>$/g, '');
    const raw = body.replace(/<[^>]+>/g, '');
    if (/^(?:他|男|马库斯|MARCUS)$/i.test(raw)) return line;
    if ((MALE_COMMAND.test(raw) && !FEMALE_PLEA.test(raw)) || /^(?:别动|别回头|继续站着|站好|张嘴|接好|夹紧|站稳|转过来|腿抬好|自己动|含深点|脱掉|裙子|内裤|蹲下|用舌头|喷得)/.test(raw)) {
      return line.replace(/^\(S[12]\):/, '(S2):');
    }
    if (FEMALE_PLEA.test(raw) || /^(?:你|我|他蹲|这里|有人|会看到)/.test(raw)) {
      return line.replace(/^\(S[12]\):/, '(S1):');
    }
    return line;
  });
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
  const blocks = out.split(/(?=\[Shot\s+\d+\])/);
  out = blocks.map((block) => {
    if (!/^\[Shot\s+\d+\]/i.test(block)) return block;
    return normalizeShotDialogue(block, framework);
  }).join('');

  // 全局台词预算：coercive 不是每镜都说；20 镜约 4-5 句，30 镜约 7-8 句。
  // 只保留动作节点上的关键句，其余全部删掉，避免 H3 生成密集对白/口型错位。
  if (framework === 'coercive') {
    const shotCount = (out.match(/\[Shot\s+\d+\]/g) || []).length;
    const budget = Math.max(3, Math.ceil(shotCount / 4));
    const keyLine = /(脱|夹紧|张嘴|接好|含深|别躲|自己动|站稳|转过来|腿抬好|不敢|求|不要|站|停|轻点)/;
    let used = 0;
    out = out.split(/(?=\[Shot\s+\d+\])/).map((block) => {
      if (!/^\[Shot\s+\d+\]/i.test(block)) return block;
      const lines = block.match(/\(S[12]\):\s*<d>[\s\S]*?<\/d>/g) || [];
      if (!lines.length) return block;
      let next = block;
      for (const line of lines) {
        const text = line.replace(/<[^>]+>/g, '');
        if (used < budget && keyLine.test(text)) {
          used += 1;
        } else {
          next = next.replace(line, '');
        }
      }
      return next;
    }).join('');
  }

  return out.replace(/\n{3,}/g, '\n\n');
}



export interface PositionPlan {
  p1: string;
  p2: string;
  p3: string;
}

/** 按场景选择三种插入姿势；只决定“可用空间”，不覆盖主题动作。 */
/** 地点分组：key 是规范地点，words 是各语言别名。 */
const LOCATION_GROUPS: Array<{ key: string; words: string[] }> = [
  { key: 'elevator', words: ['elevator', 'lift', '电梯'] },
  { key: 'bedroom', words: ['bedroom', 'bed', '卧室', '床'] },
  { key: 'sofa', words: ['sofa', 'couch', '沙发'] },
  { key: 'classroom', words: ['classroom', 'lecture hall', 'blackboard', 'podium', '教室', '讲台', '黑板'] },
  { key: 'office', words: ['office', '办公'] },
  { key: 'kitchen', words: ['kitchen', '厨房'] },
  { key: 'bathroom', words: ['bathroom', '浴室', '卫生间'] },
  { key: 'subway', words: ['subway', 'metro', 'train', 'carriage', '地铁', '车厢', '列车'] },
  { key: 'alley', words: ['alley', '巷子', '小巷'] },
  { key: 'street', words: ['street', '街道'] },
  { key: 'park', words: ['park', '公园'] },
  { key: 'mall', words: ['mall', '商场'] },
  { key: 'room', words: ['storeroom', 'dark room', 'small room', 'room', '小黑屋', '仓库', '房间'] },
  { key: 'corridor', words: ['corridor', '走廊'] },
  { key: 'escalator', words: ['escalator', '扶梯'] },
];

/** 英文词用词边界匹配，避免 "mall" 命中 "small"、"train" 命中 "strain/restraint"。 */
function termIndex(text: string, term: string): number {
  const ascii = /^[a-z ]+$/i.test(term);
  const re = ascii
    ? new RegExp(`\\b${term.replace(/\s+/g, '\\s+')}\\b`, 'i')
    : new RegExp(term, 'i');
  const m = text.match(re);
  return m && typeof m.index === 'number' ? m.index : -1;
}

/** 按正文出现顺序返回去重后的地点序列（alley/巷子 视为同一地点）。 */
export function detectLocationProgression(text: string): string[] {
  const t = String(text || '');
  const hits: Array<{ key: string; idx: number }> = [];
  for (const g of LOCATION_GROUPS) {
    let best = Infinity;
    for (const w of g.words) {
      const idx = termIndex(t, w);
      if (idx >= 0 && idx < best) best = idx;
    }
    if (best < Infinity) hits.push({ key: g.key, idx: best });
  }
  hits.sort((a, b) => a.idx - b.idx);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of hits) {
    if (!seen.has(h.key)) {
      seen.add(h.key);
      out.push(h.key);
    }
  }
  return out;
}

export function pickPenetrationPositions(context: string): PositionPlan {
  // 插入姿势由“主题最后出现的地点”决定；不做关键词子串匹配，避免扶梯/走廊主题被误判成地铁或室内。
  const progression = detectLocationProgression(context);
  const last = progression.length ? progression[progression.length - 1] : 'room';
  switch (last) {
    case 'elevator':
      return {
        p1: 'against the elevator wall, one leg lifted, taken from the front',
        p2: 'bent over the elevator handrail, taken from behind in the same car',
        p3: 'down on the elevator floor in missionary, the same car around them',
      };
    case 'bedroom':
      return {
        p1: 'on all fours on the bed, taken from behind',
        p2: 'on her side with one leg lifted, entered at an angle',
        p3: 'on her back in missionary, legs around his waist',
      };
    case 'sofa':
      return {
        p1: 'bent over the sofa arm, taken from behind',
        p2: 'straddling his lap on the sofa, riding him',
        p3: 'laid back on the sofa in missionary, legs pushed up',
      };
    case 'classroom':
      return {
        p1: 'bent over the desk, taken from behind',
        p2: 'one leg lifted onto the chair or desk, entered at a new angle',
        p3: 'laid back on the desk in missionary',
      };
    case 'office':
      return {
        p1: 'bent over the office desk, taken from behind',
        p2: 'one leg lifted onto the chair, entered at a new angle',
        p3: 'laid back on the desk in missionary',
      };
    case 'kitchen':
      return {
        p1: 'bent over the kitchen counter, taken from behind',
        p2: 'one leg lifted onto a stool, entered from the side',
        p3: 'laid back on the counter in missionary',
      };
    case 'bathroom':
      return {
        p1: 'bent over the bathroom sink, taken from behind',
        p2: 'one leg lifted onto the edge of the tub, entered from the front',
        p3: 'down on the bathroom floor in missionary',
      };
    case 'subway':
      return {
        p1: 'standing in the same car, bent forward against the pole, taken from behind',
        p2: 'one leg lifted in the aisle, her back against the pole, entered from the front',
        p3: 'held up against the pole with both legs around him, fucked standing',
      };
    case 'alley':
    case 'street':
    case 'park':
      return {
        p1: 'against the alley or park wall, one leg lifted, taken from the front',
        p2: 'bent over a dumpster or bench, taken from behind',
        p3: 'down on the ground or bench in missionary, legs held open',
      };
    case 'room':
      return {
        p1: 'against the storeroom wall, one leg lifted, taken from the front',
        p2: 'bent over the mattress or crates, taken from behind',
        p3: 'down on the mattress in missionary, legs held open',
      };
    case 'mall':
    case 'corridor':
    case 'escalator':
      return {
        p1: 'against the nearest wall, one leg lifted, taken from the front',
        p2: 'bent over the nearest stable surface, taken from behind',
        p3: 'down on the floor in missionary, legs held open',
      };
    default:
      return {
        p1: 'against the nearest wall, one leg lifted, taken from the front',
        p2: 'bent over the nearest stable surface, taken from behind',
        p3: 'down on the floor in missionary, legs held open',
      };
  }
}

/**
 * coercive 框架的最低动作弧：只补缺失的强制 oral/penetration/ending，
 * 不删除主题已有的动作；所有内容仍是当前主题的胁迫场景。
 */
/** 前戏/尾随阶段女性必须仍穿衣服：把 LLM 偶发的过早裸体描述改回“仍穿着”。 */
// 只拦截“全裸/彻底脱光”，不拦截 upskirt/露点/露阴这类“仍穿着但暴露”的合法前戏内容。
const EARLY_FEMALE_NUDE_RE = /(?:she is (?:now |still )?(?:completely|fully)?\s*nude|(?:completely|fully) nude|strips? the last garment from her|no clothing remains|her clothes (?:are|are now) (?:gone|off)|she's (?:now )?(?:completely|fully)?\s*nude)/i;

export function ensureCoerciveArc(shots: string[], context = '', targetShots = 12): string[] {
  if (!Array.isArray(shots) || shots.length === 0) return shots;
  // 前 4（20/30镜为 8）镜保留主题自己的接近/压制/反抗/脱上衣；
  // 后半段由 coercive 框架保证：全裸→强制口交→插入→抽插→内射→被迫顺从。
  const headCount = targetShots >= 20 ? Math.min(8, targetShots - 8) : 4;
  // LLM 剧本过短时不能直接失败：用中性“接近/尾随”镜头补齐前戏，保证最终镜头数达到 targetShots。
  const rawHead = shots.slice(0, headCount);
  // 剧本过短时用“不同”的中性接近镜头补齐，避免同一句重复 6 次被 H3 当成循环台词/音频污染。
  const headFillers = [
    'He keeps pace behind her at a distance, eyes on her, still not touching; she remains clothed and unaware.',
    'He closes the gap by one step as the light shifts; she glances back but sees only shadow, and keeps walking.',
    'He pauses at the corner, lets her round it first, then follows; her clothes stay on, her breath quickening.',
    'He matches her pace through the turn, keeping out of sight; the tension tightens without contact.',
  ];
  for (let i = 0; rawHead.length < headCount; i++) {
    rawHead.push(headFillers[i % headFillers.length]);
  }
  // 前戏阶段强制女性“仍穿衣服”：把过早的全裸/露点描述改回“仍穿着”，
  // 真正脱光只由 tail[0]（He strips the last garment...）在正式性行为前触发一次。
  const head = rawHead.map((s) =>
    s.replace(/She is still fully clothed[^.]*\./gi, '').replace(EARLY_FEMALE_NUDE_RE, 'she is still clothed').trim()
  );
  // 模型偶尔第一镜只写对白，没有构图；补一个中性视觉锚点，不能让 H3 第一镜空画面。
  if (head[0] && !/(camera|location|body|action|\b(she|her|he|his)\b)/i.test(head[0]) && head[1]) {
    head[0] = `At the current location, she holds the written pose; he stands close behind her, not yet touching. ${head[0]}`;
  }
  const positions = pickPenetrationPositions(context);
  // 地点衔接：如果主题最终发生在小黑屋/室内，但剧本前戏还停在小巷/户外，补一个“拖进门”转场，
  // 避免镜头直接从巷子跳到室内性行为（场景断裂）。已有转场则不重复。
  const progression = detectLocationProgression(context);
  const finalLoc = progression.length ? progression[progression.length - 1] : '';
  const headText = head.join(' ');
  const headHasRoom = /(storeroom|dark room|small room|\broom\b|小黑屋|仓库|室内)/i.test(headText);
  if (['room', 'bedroom', 'sofa', 'kitchen', 'bathroom', 'office', 'classroom', 'elevator'].includes(finalLoc) && !headHasRoom) {
    const needsBind = /捆绑|绑住|绑|绳索|绳|rope|bind|tie/i.test(context);
    head.push(needsBind
      ? 'He drags her through the metal door into the small dark room, shoves her onto the mattress, and ties her wrists with rope; she is still clothed and struggling.'
      : 'He drags her through the metal door into the small dark room and shoves her onto the mattress; she is still clothed and struggling.');
  }
  const tail = [
    'He strips the last garment from her; she is completely nude. He then shoves his dark trousers and boxers down to his ankles, frees his cock, and kicks them aside; he is fully nude too; no clothing remains. She stops kicking and only shakes.',
    'He forces her to her knees, fists her hair, and pushes his cock into her mouth; she gags, saliva stringing, hands clawing at his thigh. (S2): <d>[Chinese] 张嘴。</d>',
    `He drags her up by the hair, positions her ${positions.p1}, and drives into her in one hard thrust; her body jolts and she cries out. (S2): <d>[Chinese] 夹紧。</d>`,
    `Without pulling out, he changes her position: ${positions.p2}; she gasps as he enters at the new angle. (S2): <d>[Chinese] 转过来。腿抬好。</d>`,
    'Extreme close-up on the join: his cock sliding in and out of her wet pussy, fluid stringing, her thighs trembling, his hand gripping her raised thigh. (S1): <d>[Chinese] 不要看那里…</d>',
    `He changes once more: ${positions.p3}; then fucks her hard and fast, one hand in her hair, the other holding her hip; her resistance breaks into helpless noise. (S2): <d>[Chinese] 别躲。</d>`,
    'He buries himself to the hilt and finishes inside her; thick creampie pulses out as her resistance collapses into shaking submission. (S2): <d>[Chinese] 接好。</d>',
    'She sinks down at the same spot, spent and trembling, fully nude, his hands still on her; he does not dress her. (S1): <d>[Chinese] 我不敢了…</d>',
  ];
  if (targetShots >= 30) {
    // 30 镜/180s：更多前戏、冲突、羞辱和插入姿势；所有家具仍然只取当前场景。
    const long30 = [
      tail[0], tail[1], tail[2], tail[3], tail[4], tail[5],
      'He pulls out and slaps her ass, then pushes her back to her knees for a second oral beat; she gags around him, mascara running, hands braced on his thighs. (S2): <d>[Chinese] 含深点。</d>',
      'He hauls her up by the hair and bends her forward again, this time slower, making her feel every inch; her resistance is nearly gone. (S2): <d>[Chinese] 自己动。</d>',
      'He reaches around to squeeze her breast and rub her clit while he fucks her, forcing a broken moan out of her. (S1): <d>[Chinese] 不要…又要去了…</d>',
      `He turns her into another position: ${positions.p2}; then takes her with slow, deep strokes while she grips his arm. (S2): <d>[Chinese] 看着我。</d>`,
      'Insertion close-up again: his shaft glistening, her inner thighs wet, his fingers spreading her ass while he pushes back in.',
      `He lifts her leg against the board and enters her from the side, using only the wall/board already present. (S2): <d>[Chinese] 站稳。</d>`,
      'He pulls out and makes her lick his shaft clean before pushing her back down; she obeys with a broken, humiliated expression. (S1): <d>[Chinese] 好脏…</d>',
      `Back to ${positions.p1}; he fucks her faster, one hand in her hair, the other spanking her bare ass. (S2): <d>[Chinese] 夹紧。</d>`,
      `He changes to ${positions.p3} and drives deep; her breasts bounce, sweat dripping onto her. (S1): <d>[Chinese] 太深了…</d>`,
      'He slows to a punishing grind, making her feel every inch, then pulls almost all the way out and slams back in. (S2): <d>[Chinese] 数着。</d>',
      `He takes her in ${positions.p2} again, this time reaching around to rub her clit in rhythm; her legs shake. (S1): <d>[Chinese] 不要…会坏掉…</d>`,
      'He pulls her upright against his chest, one hand on her throat without crushing, the other holding her hip; she stops fighting. (S2): <d>[Chinese] 乖一点。</d>',
      'He bends her forward and spanks her in a slow rhythm, then pushes back inside before she can recover. (S1): <d>[Chinese] 疼…又进来了…</d>',
      'Close-up on her face and the join: tears, sweat, open mouth, his cock sliding in and out of her wet pussy.',
      `He pulls her onto his lap, guiding her hips down onto him; she rides him with shaking thighs while he watches her face. (S2): <d>[Chinese] 自己动。</d>`,
      'He holds both her wrists behind her back and takes her in short, hard strokes, his other hand smacking her ass between thrusts. (S1): <d>[Chinese] 太深了…停一下…</d>',
      'He pulls out and slaps his wet cock against her pussy, then pushes back in without warning; she gasps and her nails scrape his back. (S2): <d>[Chinese] 别躲。</d>',
      'He makes her look at the blackboard while he takes her from behind, one hand in her hair, the other spreading her ass for the camera. (S2): <d>[Chinese] 看着前面。</d>',
      `He turns her onto her back in ${positions.p3}; legs over his shoulders, he fucks her through the final stretch. (S2): <d>[Chinese] 接好。</d>`,
      'He buries himself to the hilt and finishes inside her; thick creampie pulses out as her resistance collapses into shaking submission.',
      'She sinks down at the same spot, spent and trembling, fully nude, his hands still on her; he does not dress her. (S1): <d>[Chinese] 我不敢了…</d>',
      'Afterglow in the exact same location and position: both bodies still, breathing slowing, sweat cooling on skin; no new act, no reset.',
    ];
    return [...head, ...long30].slice(0, targetShots);
  }
  if (targetShots >= 20) {
    const longTail = [
      tail[0], tail[1], tail[2], tail[3], tail[4], tail[5],
      'He pulls out and slaps her ass, then pushes her back to her knees for a second oral beat; she gags around him, mascara running, hands braced on his thighs. (S2): <d>[Chinese] 含深点。</d>',
      'He hauls her up by the hair and bends her forward again, this time slower, making her feel every inch; her resistance is nearly gone. (S2): <d>[Chinese] 自己动。</d>',
      'He reaches around to squeeze her breast and rub her clit while he fucks her, forcing a broken moan out of her. (S1): <d>[Chinese] 不要…又要去了…</d>',
      'He turns her into the final position: ' + positions.p3 + '; then fucks her through the last stretch, sweat dripping from his chest onto hers.',
      tail[6], tail[7],
    ];
    return [...head, ...longTail].slice(0, targetShots);
  }
  return [...head, ...tail].slice(0, Math.min(12, targetShots));
}

/**
 * 上游 LLM 内容审核拒写时的兜底剧本：只从“当前主题”里抽动作/服装/地点，
 * 生成与主题一致的分镜骨架，再交给 coercive 框架补齐到 12/20/30 镜。
 * 这是拒写兜底，不是主路径；正常生成仍优先用 LLM 剧本。
 */
export function buildFallbackScript(theme: string): string {
  const t = String(theme || '');
  const has = (re: RegExp) => re.test(t);
  const outfit = [
    has(/红色低胸衬衫|红色衬衫|red low-cut|red blouse|red shirt/i) ? 'a red low-cut blouse' : '',
    has(/白色超短裙|白色短裙|white mini|white skirt/i) ? 'a white ultra-mini skirt' : '',
    has(/黑色丁字裤|丁字裤|black thong|thong/i) ? 'a black thong' : '',
  ].filter(Boolean).join(', ');
  const place = has(/小巷|巷子|alley/i) ? 'the alley'
    : has(/地铁|车厢|subway|metro|train/i) ? 'the subway car'
    : has(/电梯|elevator/i) ? 'the elevator'
    : has(/教室|classroom/i) ? 'the classroom'
    : has(/办公室|office/i) ? 'the office'
    : 'the scene described by the current theme';
  const room = has(/小黑屋|仓库|dark room|storeroom|small room|房间/i) ? 'a small dark room' : null;
  const b: string[] = [];
  b.push(`She walks through ${place} wearing ${outfit || 'the outfit described by the current theme'}, hips swaying, unaware.`);
  if (has(/尾随|跟踪|follow|stalk/i)) b.push(`A man in a dark shirt follows two metres behind her, phone in hand, eyes locked on her skirt.`);
  if (has(/蹲|偷窥|偷拍|抄底|upskirt|squat/i)) b.push(`He drops into a low squat behind her and tilts his phone under the skirt, recording her thong.`);
  b.push(`He rises and keeps tailing her through ${place}, closing the distance.`);
  if (has(/扑倒|按倒|扑|tackle|pin/i)) b.push(`He lunges and pins her against the nearest wall, one hand over her mouth.`);
  if (room) b.push(`He drags her through a metal door into ${room}.`);
  if (has(/捆绑|绑|rope|bind|tie/i)) b.push(`He forces her onto a stained mattress and binds her wrists and ankles with rope.`);
  b.push(`He tears the blouse open and pulls the skirt down, leaving her in only her thong.`);
  return b.map((x, i) => `SHOT ${i + 1}: ${x}`).join('\n');
}
