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
    actionArc: ['approach/trap', 'restrain', 'slap/spank/drag', 'strip', 'forced oral', 'forced penetration', 'creampie/facial/ass cum', 'resistance weakening', 'submission/aftermath'],
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
const FEMALE_PLEA = /(求你|放过|不要|别|放开|疼|轻点|停下|不行|羞|丢脸|救命|我错|饶了我|别摸|别脱|别这样|不敢)/;

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
      if (MALE_COMMAND.test(text) && !FEMALE_PLEA.test(text)) cleaned = cleaned.replace(line, setSpeaker(line, 'S2'));
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


/**
 * coercive 框架的最低动作弧：只补缺失的强制 oral/penetration/ending，
 * 不删除主题已有的动作；所有内容仍是当前主题的胁迫场景。
 */
export function ensureCoerciveArc(shots: string[]): string[] {
  if (!Array.isArray(shots) || shots.length < 4) return shots;
  // 前 4 镜保留主题自己的接近/压制/反抗/脱上衣；
  // 后半段由 coercive 框架保证：全裸→强制口交→插入→抽插→内射→被迫顺从。
  const head = shots.slice(0, 4).map((s) => s.replace(/She is still fully clothed[^.]*\./gi, '').trim());
  // 模型偶尔第一镜只写对白，没有构图；补一个中性视觉锚点，不能让 H3 第一镜空画面。
  if (head[0] && !/(camera|location|body|action|\b(she|her|he|his)\b)/i.test(head[0]) && head[1]) {
    head[0] = `At the current location, she holds the written pose; he stands close behind her, not yet touching. ${head[0]}`;
  }
  const tail = [
    'He strips the last garment from her; she is completely nude. He then shoves his dark trousers and boxers down to his ankles, frees his cock, and kicks them aside; he is fully nude too; no clothing remains. She stops kicking and only shakes.',
    'He forces her to her knees, fists her hair, and pushes his cock into her mouth; she gags, saliva stringing, hands clawing at his thigh. (S2): <d>[Chinese] 张嘴。</d>',
    'He drags her up by the hair, bends her over the nearest surface, and drives into her from behind in one hard thrust; her body jolts and she cries out. (S2): <d>[Chinese] 夹紧。</d>',
    'He fucks her hard and fast, one hand in her hair, the other holding her hip; her resistance breaks into helpless noise; he spanks her bare ass in rhythm. (S2): <d>[Chinese] 别躲。</d>',
    'He keeps her pinned and uses her, pulling her hair and slapping her ass while she stops fighting and takes it, her body shaking. (S1): <d>[Chinese] 求求你…</d>',
    'He buries himself to the hilt and finishes inside her; thick creampie pulses out as her resistance collapses into shaking submission. (S2): <d>[Chinese] 接好。</d>',
    'She sinks down against the surface, spent and trembling, fully nude, his hands still on her; he does not dress her. (S1): <d>[Chinese] 我不敢了…</d>',
    'Afterglow in the exact same location and position: both bodies still, breathing slowing, sweat cooling on skin; no new act, no reset.',
  ];
  return [...head, ...tail].slice(0, 12);
}
