/**
 * 与具体主题无关的 H3 剧本规范化器。
 * 输入：11 个原始 SHOT 文本 + 用户主题/角色信息
 * 输出：满足 H3 连续状态机的分镜数组
 *
 * 不针对“城中村/骑车/胁迫”等单个主题写补丁，而是统一处理：
 *  - 分镜数量、时间戳残留
 *  - 服装状态单调性（一旦全裸，不回穿、不重复脱）
 *  - 首镜接触动作只出现一次
 *  - 台词只允许 <d> 标签
 *  - 用户主题里不存在的道具（自行车/森林等）不进入画面
 */
export interface NormalizeOptions {
  hasMan: boolean;
  coercive: boolean;
  theme: string;
  shotCount?: number;
}

const CLOTHING_NOUNS = 'top|bra|shirt|blouse|skirt|jeans|panties|thong|underwear|lower garment|dress|clothes|fabric';
const NUDE_RE = /(?:she is|she's|now|remains?|body|clothing state:?)\s*(?:completely|fully) nude|completely nude from|no clothing remains|stays? nude/i;

function cleanBeat(raw: string): string {
  return raw
    .replace(/^\s*(?:\[\s*)?(?:\*\*)?(?:SHOT|Shot)\s+\d+\b\s*\]?[^\n]*\n?/i, '')
    .replace(/^\s*\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}[^\n]*\n?/i, '')
    .replace(/^\s*Time range[^\n]*\n?/gmi, '')
    .replace(/^\s*(?:TITLE|SETTING|Clothing tracked)\s*[:：][^\n]*\n?/gmi, '')
    .replace(/^\s*\d+\.\s*(?:\(?\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}\)?)?\s*/i, '')
    .replace(/^\s*\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}\s*\|?\s*/i, '')
    .replace(/\s*\((?:her|his) voice:[^)]*\)/gi, '')
    .replace(/^\s*FADE OUT\b[^\n]*\n?/gmi, '')
    .replace(/^\s*AFTERGLOW\b[^\n]*\n?/gmi, '')
    .replace(/\bFADE OUT\b\.?/gi, '')
    .split(/CHINESE\s+DIALOGUE/i)[0]
    // 剧本文本里裸露的说话人标签，不是 <d> 台词，全部清掉
    .replace(/(?:^|\n)\s*(?:Woman|Man|Male|Female|女人|男人|男|女)\s*[（(][^\n]*[)）]\s*[:：]?[^\n]*(?:\n(?!\s*(?:\[\s*)?(?:\*\*)?(?:SHOT|Shot)\s+\d+)[^\n]*)*/gi, '')
    .trim();
}

function splitScript(raw: string): string[] {
  return raw
    .split(/(?=^\s*(?:\[\s*)?(?:\*\*)?(?:SHOT|Shot)\s+\d+\b\s*\]?)/mi)
    .slice(1)
    .map(cleanBeat)
    .filter((x) => x.length > 30);
}

function stripForbiddenProps(text: string, theme: string): string {
  const themeHasBike = /\b(?:bicycle|bike|cycling|cyclist|pedal(?:ing)?)\b|骑行|自行车|骑车/i.test(theme);
  const themeHasForest = /\b(?:forest|woods|trees?)\b|森林|树林/i.test(theme);
  const forbidden: RegExp[] = [];
  if (!themeHasBike) forbidden.push(/\b(?:bicycle|bike|cycling|cyclist|pedal(?:ing)?|riding a bike)\b[^.;]*[.;]?/gi);
  if (!themeHasForest) forbidden.push(/\b(?:forest|woods|ferns?|tree trunk|pine trunk)\b[^.;]*[.;]?/gi);
  return forbidden.reduce((acc, re) => acc.replace(re, ''), text);
}

function normalizeClothing(beats: string[]): string[] {
  let nude = false;
  return beats.map((beat) => {
    let out = beat;
    if (nude) {
      out = out.replace(
        new RegExp(`(?:He|She)\\s+(?:rips?|strips?|tears?|yanks?|pulls?|peels?|shoves?)\\s+(?:her|the)\\s+(?:${CLOTHING_NOUNS})[^.;]*[.;]?`, 'gi'),
        '',
      );
      out = out.replace(
        new RegExp(`\\b(?:${CLOTHING_NOUNS})\\b[^.;]*?(?:bunched|pulled|hanging|aside|around|at waist|on|off)[^.;]*[.;]?`, 'gi'),
        'no clothing remains. ',
      );
      out = out.replace(/her clothes bunch[^.;]*/gi, 'her nude body arches');
      if (!NUDE_RE.test(out)) out = `She is completely nude; no clothing remains. ${out}`;
    }
    if (NUDE_RE.test(out)) nude = true;
    return out.trim();
  });
}

function dedupeFirstContact(beats: string[], opts: NormalizeOptions): string[] {
  if (!opts.hasMan || !opts.coercive || beats.length < 3) return beats;
  const firstHasContact = /(choke|throat|forearm|clamp(?:s|ed)? (?:a )?hand|drags? her|lifts? her)/i.test(beats[0]);
  if (!firstHasContact) {
    beats[0] += ' In the same continuous shot, he closes the distance behind her, loops his forearm around her throat, pulls her back against his chest, and drags her toward the dark doorway; she gasps and claws at his arm.';
  }
  // 首镜已经完成接近/控制，后续两镜改成室内延续，避免三次重复勒颈。
  const dialogue = (text: string) => (text.match(/\(S\d\):\s*<d>[\s\S]*?<\/d>/g) || []).join(' ');
  beats[1] = `Inside the dark room, he keeps his forearm across her throat and pushes her deeper; she gasps and claws at his arm. ${dialogue(beats[1])}`.trim();
  beats[2] = `Inside the dark room, he pins her against the wall and starts tearing her blouse open; she pleads. ${dialogue(beats[2])}`.trim();
  return beats;
}

export function normalizeH3Script(raw: string, opts: NormalizeOptions): string[] {
  let sourceBeats = splitScript(raw);
  if (sourceBeats.length < 8 && raw.trim().length > 500) {
    // 模型偶尔不写 SHOT 标题，只写多段剧本；不能静默回退旧模板，按段落切成镜头。
    sourceBeats = raw
      .split(/\n{2,}/)
      .map(cleanBeat)
      .filter((x) => x.length > 30)
      // 纯中文对白段不是镜头，不能当成 Shot；没有画面/动作锚点的段落丢弃。
      .filter((x) => /(?:Camera|Location|Body|Clothing|Action|Emotional|she |her |he |his |woman|man)/i.test(x));
  }
  let beats = sourceBeats.map((x) => stripForbiddenProps(x, opts.theme));
  if (!beats.length) return [];
  beats = dedupeFirstContact(beats, opts);
  beats = normalizeClothing(beats);
  const count = opts.shotCount || 11;
  while (beats.length < count) {
    beats.push('Afterglow in the exact same location and position: both bodies still, breathing slowing, sweat cooling on skin, the final physical evidence of the act still visible; no new act, no reset.');
  }
  return beats.slice(0, count);
}
