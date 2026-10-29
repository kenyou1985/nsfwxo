/**
 * H3 提示词二次自检 + 清洗。
 * 在 LLM 输出 → 框架组装的最后一步运行，按框架规则检查并修复：
 *  - <d> 台词/锚定名之外的中文 → 翻译或删除
 *  - 结构化字段标签 → 去掉
 *  - Scene 地点列表 → 中心名词归一
 *  - 重复镜头 → 去重
 *  - 无 <d> 的说话句 → 删除
 *  - 时间戳 → 按实际镜头数重建
 *  - 说话人标签 → 归一
 */
import { collapseLocations, translateChineseTerms, enforceH3Speakers } from './h3Frameworks';
import { stripOrphanSpeech } from './h3ScriptNormalizer';

const SEX_FILL = [
  'He fucks her hard in the same position, hips snapping.',
  'He drives into her from behind, one hand in her hair.',
  'He pins her to the pole and thrusts deep, breathing at her ear.',
  'He holds her hips and pounds into her, the steel creaking under them.',
];

const PROTECT_RE = /(<d>[\s\S]*?<\/d>|河北彩花|马库斯)/g;

function stripChineseOutside(text: string): { text: string; hit: boolean } {
  const parts: string[] = [];
  let t = String(text || '').replace(PROTECT_RE, (m) => {
    parts.push(m);
    return `\u0000${parts.length - 1}\u0000`;
  });
  const before = t;
  t = t.replace(/[\u4e00-\u9fff]+/g, ' ');
  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => parts[Number(i)]);
  return { text: t, hit: t !== before };
}

export interface SelfCheckResult {
  prompt: string;
  issues: string[];
}

export function selfCheckH3Prompt(raw: string): SelfCheckResult {
  const issues: string[] = [];
  let text = String(raw || '').trim();
  if (!text) return { prompt: '', issues: ['empty'] };

  // 1) 已知中文地点/支撑物翻英文
  const t0 = text;
  text = translateChineseTerms(text);
  if (text !== t0) issues.push('zh-translated');

  // 2) <d>/锚定名之外的中文删除（安全网）
  const s1 = stripChineseOutside(text);
  text = s1.text;
  if (s1.hit) issues.push('zh-removed');

  // 3) 结构化字段标签
  const t1 = text;
  text = text
    .replace(/^[ \t]*(?:Body positions?|Physical action|Clothing state|Emotional beat|Positions?)\s*[:：]\s*/gmi, '')
    .replace(/^[ \t]*(?:Location|Camera|Body|Action|Clothing)\s*[:：]\s*/gmi, '')
    .replace(/\b(?:LOCATION|BODY|CLOTHING|ACTION|POSITIONS?|EMOTIONAL(?:\s+BEAT)?)\s*[:：]\s*/g, ' ')
    .replace(/\b(?:EMOTIONAL|Emotional)\b\s*[:：]?\s*/g, ' ')
    .replace(/\b(?:Body|Action|Clothing|Position)\s*[:：]\s*/g, ' ');
  if (text !== t1) issues.push('labels');

  // 4) Scene 地点列表按中心名词归一
  text = text.replace(/(Scene:\s*the theme's location progression is\s*)([^;\n]+)(;)/i, (m, pre, list, post) => {
    const items = String(list).split(/→|->/).map((x: string) => x.trim()).filter(Boolean);
    const collapsed = collapseLocations(items);
    if (collapsed.length !== items.length) issues.push('scene-collapsed');
    return `${pre}${collapsed.join(' → ')}${post}`;
  });

  // 4b) 场景固定化：把宽泛的场地词归到锚定最后地点，减少 H3 场景漂移。
  const sceneM = text.match(/Scene:\s*the theme's location progression is\s*([^;\n]+);/i);
  if (sceneM) {
    const locs = sceneM[1].split(/→|->/).map((x) => x.trim()).filter(Boolean);
    const finalLoc = locs[locs.length - 1] || '';
    if (finalLoc) {
      const before = text;
      text = text.replace(/\b(?:abandoned construction yard|construction yard|abandoned yard|open yard|abandoned lot|vacant lot|open lot|construction site|abandoned site|gravel|concrete)\b/gi, `the ${finalLoc}`);
      if (text !== before) issues.push('scene-pinned');
    }
  }

  // 5) 逐镜清理、去重、重建时间戳
  if (/^\[Shot\s+\d+\]/im.test(text)) {
    const blocks = text.split(/(?=^\[Shot\s+\d+\])/im);
    const preamble = blocks.shift() || '';
    const shots: string[] = [];
    const seen = new Set<string>();
    let prevVisual = '';
    for (const b of blocks) {
      const originalBody = b
        .replace(/^\[Shot\s+\d+\]\s*(?:\d{2}:\d{2}\.\d{3}\s*)?/i, '')
        .replace(/^(?:Same pose; continue\.?\s*)+/i, '')
        // 最后一镜可能吞进尾部区块：从镜头正文里截掉。
        .replace(/\s*(?:overall_soundscape|non_diegetic_music|speaker_mapping)\s*:[\s\S]*$/i, '')
        // 正文自带的多个时间戳只保留动作文本。
        .replace(/^\s*(?:\d{2}:\d{2}\.\d{3}\s*)+/i, '')
        .trim();
      let body = stripOrphanSpeech(originalBody).trim();
      // 清洗后不能变空镜：退回原始正文，保持镜头数不变。
      if (!body) body = originalBody;
      // 脱光后的镜头：若没有性行为动词，强制补一句，避免“He keeps her pinned”这类中性空镜。
      const SEX_RE = /(?:fucks?|thrusts?|drives?|enters?|pounds?|penetrat\w*|strokes?|hips|pins? her|bends her|knees?|mouth|gags?|sucks?|licks?|spanks?|slaps?|fingers?|rubs?|throat|oral|rides?|lap|creampie|finishes?|pulls? out|slams?|join)/i;
      if (/Both are fully nude; no clothing on either body/i.test(body)
        && !/(?:strips? the last garment|completely nude|no clothing remains)/i.test(body)) {
        const bodyNoNude = body.replace(/Both are fully nude;? no clothing on either body\.?/gi, '').trim();
        if (!SEX_RE.test(bodyNoNude)) {
          body = `${SEX_FILL[shots.length % SEX_FILL.length]} ${body}`.trim();
          issues.push('sex-gap');
        }
      }
      // 只有台词没有画面的镜头：补一句承接动作，避免 H3 生成静止空镜。
      const visual = body
        .replace(/\(S[12]\):\s*<d>[\s\S]*?<\/d>/g, '')
        .replace(/<d>[\s\S]*?<\/d>/g, '')
        .replace(/Both are fully nude; no clothing on either body\.?/gi, '')
        .trim();
      if (visual.length < 15) {
        const dlg = (body.match(/<d>([\s\S]*?)<\/d>/) || [])[1] || '';
        const sexCtx = /夹紧|转过来|腿抬好|自己动|含深点|张嘴|别躲|接好|又要去了|受不了|好深|轻点|不要停/.test(dlg);
        const sexFillers = [
          'He drives into her from behind, hips snapping, one hand in her hair.',
          'He holds her hips and fucks her harder, the steel creaking under them.',
          'He pins her to the pole and thrusts deep, breathing at her ear.',
        ];
        const neutralFillers = [
          'He keeps her in place at the same spot, body close, still holding her.',
          'He holds her still, one hand on her hip, the other braced on the steel.',
          'He keeps her pinned where she is, breathing close to her ear.',
        ];
        const arr = sexCtx ? sexFillers : neutralFillers;
        body = `${arr[shots.length % arr.length]} ${body}`.trim();
        issues.push('dialogue-only');
      }
      const key = body.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      // 重复只标记、不删除，避免镜头数从 30 掉到 29。
      if (seen.has(key)) issues.push('dup');
      seen.add(key);
      shots.push(body);
    }
    if (shots.length) {
      const count = shots.length;
      const duration = count >= 30 ? 180 : count >= 20 ? 120 : 60;
      const rebuilt = shots.map((s, i) => {
        const sec = i * (duration / count);
        const stamp = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}.000`;
        return `[Shot ${i + 1}] ${stamp} ${s}`;
      }).join('\n');
      const ddStart = text.search(/detailed_description\s*:/i);
      const tailStart = text.search(/\n\s*overall_soundscape\s*:/i);
      if (ddStart >= 0) {
        const head = `${text.slice(0, ddStart)}detailed_description:\n`;
        const tail = tailStart > ddStart ? text.slice(tailStart) : '';
        text = `${head}${rebuilt}${tail ? `\n${tail.trimStart()}` : ''}`;
      }
    }
    // preamble 不参与镜头重建，保留原文本的其它部分（已在 text 中）
    void preamble;
  }

  // 6) 去重复尾部区块（overall_soundscape / non_diegetic_music / speaker_mapping 只留一个）
  for (const key of ['overall_soundscape', 'non_diegetic_music', 'speaker_mapping']) {
    const re = new RegExp(`^[ \\t]*${key}\\s*:[^\\n]*`, 'gmi');
    const all = text.match(re);
    if (all && all.length > 1) {
      let seenCount = 0;
      text = text.replace(re, (m) => {
        seenCount += 1;
        return seenCount < all.length ? '' : m;
      });
      issues.push('dup-section');
    }
  }

  // 7a) 单一男性：Black man → the man，并清理 the <adj> the man
  text = text
    .replace(/\b(?:the\s+)?(?:adult\s+|tall\s+|big\s+)?Black\s+man\b/gi, 'the man')
    .replace(/\b(a|an)\s+((?:\w+\s+){0,2})the man\b/gi, '$1 $2man')
    .replace(/\bthe\s+(\w+)\s+the man\b/gi, 'the $1 man');

  // 7) 说话人标签归一
  const t2 = text;
  text = enforceH3Speakers(text);
  if (text !== t2) issues.push('speakers');

  // 8) 收尾
  text = text.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return { prompt: text, issues };
}
