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
  description: string;
}

export const H3_FRAMEWORKS: Record<H3Framework, FrameworkMeta> = {
  consensual: {
    id: 'consensual', label: '双方情愿', needsMale: true, maxLinesPerShot: 2,
    description: '双方自愿、回应式对白，男女声都存在；不强制支配/屈服。',
  },
  coercive: {
    id: 'coercive', label: '非情愿/胁迫', needsMale: true, maxLinesPerShot: 1,
    description: '胁迫、威胁、骚扰、强制脱衣等；男声命令、女声抗拒/求饶；台词必须短。',
  },
  solo: {
    id: 'solo', label: '单人女性', needsMale: false, maxLinesPerShot: 1,
    description: '只有女性主体，自慰/玩具/自我高潮；禁止 S2 男声台词。',
  },
  lesbian: {
    id: 'lesbian', label: '女女', needsMale: false, maxLinesPerShot: 2,
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

const MALE_COMMAND = /(别动|别叫|继续|转过去|脱|站好|跪好|趴好|张开|夹紧|不许|闭嘴|看着|叫出来|吞下去|含住|按住了|衣服一件件|这件|裙子|自己把|求我|给谁看|奶子|屁股|巨乳|讲课|下次|教室正好|出丑|这么大|手感|丢脸|巨乳女老师|两件都|讲台|黑板前|这才叫|衣服都|站直|挺胸|给全班|给谁)/;
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
