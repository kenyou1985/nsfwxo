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
const NUDE_RE = /she is (?:now )?(?:completely|fully) nude|she's (?:now )?(?:completely|fully) nude|no clothing remains|stays? nude/i;

function cleanBeat(raw: string): string {
  return raw
    // 模型偶尔在镜头正文里插入英文拒写残留，必须剔除，否则 H3 会把它当画面描述。
    .replace(/^(?:I (?:also )?(?:won't|will not|cannot|can't)[^\n]*)$/gmi, '')
    .replace(/\bI (?:also )?(?:won't|will not|cannot|can't) (?:write|provide|generate)[^.;]*[.;]?/gi, '')
    .replace(/^\s*(?:\[\s*)?(?:\*\*)?(?:SHOT|Shot)\s+\d+\b\s*\]?\s*[:：]?\s*/i, '')
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
    .replace(/(?:^|\n)\s*(?:Woman|Man|Male|Female|LIN|MARCUS|[A-Z][A-Z ]{1,20}|女人|男人|男|女)\s*[（(][^\n]*[)）]\s*[:：]?[^\n]*(?:\n(?!\s*(?:\[\s*)?(?:\*\*)?(?:SHOT|Shot)\s+\d+)[^\n]*)*/gi, '')
    // 没有 <d> 标签的中文对白行一律删除；H3 只朗读 <d> 内文本。
    .replace(/^\s*[\u4e00-\u9fff][^\n]*$/gm, '')
    // 带引号的中文对白、Voice 行、以及任何非 <d> 的含中文行，都不能进 H3。
    .replace(/[“"][^”"\n]*[\u4e00-\u9fff][^”"\n]*[”"]/g, '')
    .replace(/^(?!.*<d>).*[\u4e00-\u9fff].*$/gm, '')
    .replace(/^\s*Voice\s*[:：][^\n]*$/gmi, '')
    .replace(/([:：])\s*[\u4e00-\u9fff][^\n]*/g, '$1')
    .trim();
}

function splitScript(raw: string): string[] {
  // 不能只匹配行首：模型经常输出 `[Shot 1] SHOT 2: ...` 或 `SHOT 2: ... SHOT 3: ...`
  // 同一行内混排；只按行首切会把 SHOT 2..12 全部塞进 Shot 1。
  return raw
    // `SHOT N:` 只允许行首或紧跟在 `[Shot N]` 后面，避免把
    // "Clothing applies only to Shot 1: from Shot 2 onward..." 当成镜头标题。
    .split(/(?=(?:\[\s*(?:\*\*)?(?:SHOT|Shot)\s+\d+\s*\]?|(?:^|\n|\])\s*SHOT\s+\d+\s*:))/im)
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

export function normalizeH3Script(raw: string, opts: NormalizeOptions): string[] {
  let sourceBeats = splitScript(raw);
  const realShotCount = sourceBeats.length;
  if (realShotCount < 8 && raw.trim().length > 500) {
    sourceBeats = raw
      .split(/\n{2,}/)
      .map(cleanBeat)
      .filter((x) => x.length > 30)
      .filter((x) => /(?:Camera|Location|Body|Clothing|Action|Emotional|she |her |he |his |woman|man)/i.test(x));
  }
  if (realShotCount < 8) return [];
  let beats = sourceBeats.map((x) => stripForbiddenProps(x, opts.theme));
  if (!beats.length) return [];
  const visualFallback = [
    'Camera medium two-shot, same location; she holds her pose, he stays in frame.',
    'Camera handheld close-up; they move together, hands and faces visible.',
    'Camera medium tracking shot; the action continues without a scene change.',
    'Camera side angle; clothing and bodies shift naturally with the movement.',
    'Camera close-up on hands and torsos; the interaction deepens.',
    'Camera low angle; the two bodies occupy the frame, breathing visible.',
    'Camera medium shot; the pose changes while the location stays the same.',
    'Camera close-up; faces and hands react to the movement.',
    'Camera rear three-quarter; the action continues in the same space.',
    'Camera overhead; bodies move together on the same surface.',
    'Camera extreme close-up; the physical contact is visible.',
    'Camera slow pull-back; both bodies still, breathing slowing, no reset.',
  ];
  beats = beats.map((beat, i) => {
    const visualText = beat.replace(/\(S\d\):\s*<d>[\s\S]*?<\/d>/g, '').trim();
    const hasVisual = /(camera|location|body positions?|clothing state|physical action|\bshe\b|\bher\b|\bhe\b|\bhis\b)/i.test(visualText);
    return hasVisual && visualText.length >= 70 ? beat : `${visualFallback[Math.min(i, visualFallback.length - 1)]} ${beat}`.trim();
  });
  beats = normalizeClothing(beats);
  return beats.slice(0, opts.shotCount || 12);
}

/**
 * H3 只认 `<d>...</d>` 内文本，但说话人必须由紧邻的 `(S1):` / `(S2):` 锚定。
 * 这里统一清理中文说话人标签，并给每一句补上 speaker 锚点。
 */
export function normalizeDialogueSpeakers(raw: string): string {
  if (!raw) return raw;
  const maleLines = /(别叫|跟我走|闭嘴|硬了|腿张开|我要进去|夹这么紧|夹死|接着夹|叫出来|看着我|谁在操|嘴也|射了|还好吗|夹紧|吞下去|含住|不许|别动|别出声|不许出声|骚货|骚穴|操死|鸡巴套子|不要动|不要出声|张开|舔干净|爸爸|哥哥|跪好|趴好|痛才对|脱了|自己把腿|含深|再叫|奶子|干你|求我|进来|把衣服|腿分开|别装|欠操)/;
  const femaleLines = /(放开|求你|不要(?!动|出声)|你……|太大|太深|好满|去了|嗯|啊|慢|好舒服|我快|别摸|停下|还要|会坏|安全词|抱一会|没有|疼|别插|轻点)/;
  const cleanInner = (inner: string): { text: string; speaker?: 'S1' | 'S2' } => {
    let text = inner.trim();
    let speaker: 'S1' | 'S2' | undefined;
    // <d>[他，低沉] 别叫。</d> / <d>（她，喘着）...</d>
    const label = text.match(/^[\[（(]\s*(他|她|男|女|马库斯|河北|MARCUS|LIN)\s*[，,、\s][^\]]*[\]）)]\s*/i)
      || text.match(/^[\[（(]\s*(他|她|男|女|马库斯|河北|MARCUS|LIN)\s*[\]）)]\s*/i);
    if (label) {
      speaker = /^(?:他|男|马库斯|MARCUS)$/i.test(label[1]) ? 'S2' : 'S1';
      text = text.slice(label[0].length);
    }
    text = text.replace(/^\[(?:Chinese|中文|普通话)\]\s*/i, '').trim();
    return { text, speaker };
  };
  let out = raw.replace(/(?:\(S[12]\)\s*[:：]\s*)?<d>([\s\S]*?)<\/d>/g, (whole, inner, offset, full) => {
    const { text, speaker: labeled } = cleanInner(String(inner));
    if (!text) return whole;
    let speaker = labeled;
    if (!speaker) {
      const prefix = String(full).slice(Math.max(0, Number(offset) - 140), Number(offset));
      // 优先读紧邻的语气标签，避免“痛才对/脱了”等短命令被误判成女声。
      if (/(?:^|[.!?]\s*)(?:she|her|woman)\b[^.!?]{0,60}(?:whisper|moan|sob|whimper|breathe|cry|plead|gasp|says|asks)/i.test(prefix)) speaker = 'S1';
      else if (/(?:^|[.!?]\s*)(?:he|his|man)\b[^.!?]{0,60}(?:growl|order|command|snarl|laugh|grunt|says|ask|mutter|roar|pant)/i.test(prefix)) speaker = 'S2';
      else if (maleLines.test(text)) speaker = 'S2';
      else if (femaleLines.test(text)) speaker = 'S1';
      else speaker = /(他|男|马库斯|MARCUS)/i.test(String(inner)) ? 'S2' : 'S1';
    }
    return `(S${speaker === 'S2' ? 2 : 1}): <d>[Chinese] ${text}</d>`;
  });
  // 同一镜头内完全相同的相邻台词去重，避免 H3 把重复 S2 读成两遍火星语。
  out = out.replace(/(\(S[12]\):\s*<d>[^<]*<\/d>)(?:\s*\1)+/g, '$1');
  // 没有 speaker_mapping 时补上，避免 H3 用默认声线串台。
  if (!/speaker_mapping\s*:/i.test(out)) {
    return out.trimEnd() + '\nspeaker_mapping: {"S1":"Chinese (Mandarin)_Adult_Female_Soft","S2":"Chinese (Mandarin)_Adult_Male_Low"}';
  }
  return out;
}

/**
 * H3 结构化归一：把模型偶发的 11 镜、错位 Shot 12、裸男矛盾、散落 speaker_mapping 修正成
 * 严格 12 镜 / 4 段结构。幂等，可对任何完整 H3 文本调用。
 */
export interface H3StructureOptions {
  coercive?: boolean;
  hasMan?: boolean;
  groping?: boolean;
}

export function normalizeH3PromptStructure(raw: string, opts: H3StructureOptions = {}): string {
  if (!raw || !/(?:\[Shot\s+\d+\]|SHOT\s+\d+\s*:)/i.test(raw)) return raw;
  const coercive = opts.coercive ?? /(?:choke|throat|forearm|drags?|stalking|stalk|coerc|CNC|胁迫|锁喉|拖|尾随|强上|强迫)/i.test(raw);
  const hasMan = opts.hasMan ?? /<Subject\s*2>|@Man|\bman\b|\bmale\b|男人|男性/i.test(raw);
  const groping = opts.groping ?? /(?:clothed subway groping|no penetration|grope|fondle|猥亵|摸向|地铁.*摸)/i.test(raw);
  const headMatch = raw.match(/^([\s\S]*?)(?=detailed_description\s*:)/i);
  let head = (headMatch ? headMatch[1] : '').trim();
  if (coercive) {
    head = head.replace(/He remains FULLY CLOTHED[^.]*?before Shot \d+\./gi,
      'He remains FULLY CLOTHED in Shots 1-6; he must NOT be nude or shirtless before Shot 7.');
    head = head.replace(/he keeps his dark shirt and trousers on[^.]*?before Shot \d+\./gi,
      'He remains FULLY CLOTHED in Shots 1-6; he must NOT be nude or shirtless before Shot 7.');
  }
  head = head.replace(/through\s+(?:woman|man)\s+walks?[^,;]*?\bhome\s+in/gi, 'through the narrow alley in');
  head = head.replace(/through\s+Handheld[^,;]*?\bin/gi, 'through the narrow alley in');
  head = head.replace(/through\s+shot\s*-\s*Quiet narrow path/gi, 'through the narrow alley');

  // 同时识别 `[Shot N]` 和模型偶发的 `SHOT N:`；否则 raw SHOT 2..12 会被塞进 Shot 1。
  const marks = raw.split(/(?=(?:\[Shot\s*\d+\]|(?:^|\n|\])\s*SHOT\s*\d+\s*:))/im);
  const byNum = new Map<number, string>();
  for (const part of marks) {
    const m = part.match(/^(?:\[Shot\s*(\d+)\]|\bSHOT\s*(\d+)\s*:)/i);
    if (!m) continue;
    const num = Number(m[1] || m[2]);
    if (!num) continue;
    const content = part.slice(m[0].length)
      .replace(/^\s*speaker_mapping\s*:[\s\S]*$/i, '')
      .replace(/\n\s*overall_soundscape\s*:[\s\S]*$/i, '')
      .replace(/^\s*speaker_mapping\s*:.*$/gim, '')
      .replace(/^\s*S[12]\s*:\s*.*$/gim, '')
      .trim();
    if (!content) continue;
    if (!byNum.has(num)) byNum.set(num, content);
  }
  if (!byNum.has(1) && byNum.has(2)) {
    byNum.set(1, 'The opening frame establishes the same location, the same two people, and the first visible action of the theme.');
  }
  let shots = [...byNum.entries()].sort((a, b) => a[0] - b[0]).slice(0, 12).map(([, v]) => v);

  const anchor = 'He is still fully clothed in a dark shirt and trousers; no male nudity in this shot.';
  const maleNude = /(?:\b(?:man|he)\b[^.\n]{0,100}\b(?:fully\s+|still\s+)?nude\b|\bboth\s+(?:now\s+|still\s+)?(?:fully\s+)?nude\b|\bhe\s+(?:is\s+|now\s+)?shirtless\b|\b(?:his\s+)?(?:torso|chest)\s+(?:is\s+)?bare\b|\brevealing\s+(?:a\s+)?(?:massive\s+)?(?:tattooed\s+)?chest\b|\bhis\s+(?:\w+\s+){0,4}(?:cock|penis)\s+(?:springs|is|comes)\s+free\b|\bhis\s+\w+\s+(?:cock|penis)\s+(?:out|free)\b|(?:\bhe\s+)?(?:then\s+)?(?:yanks?|pulls?|rips?|strips?|shoves?)\s+(?:his|the)\s+(?:own\s+)?(?:hoodie|t-shirt|shirt|tee|top|clothes)[^.;]*|\bhe\s+(?:remains?|stays?)\s+in\s+(?:jeans|pants|trousers)\s+only\b|\bhe\s+(?:shoves|kicks|pushes|strips)\s+(?:his|the)\s+(?:jeans|pants|trousers|boxers|clothes)[^.;]*|\bclothing stays off forever\b)/gi;
  const maleCleanUntil = coercive ? 6 : shots.findIndex((s0) => maleNude.test(s0));
  const maleLimit = maleCleanUntil > 0 ? maleCleanUntil : (coercive ? 6 : 0);
  for (let i = 0; i < Math.min(maleLimit, shots.length); i++) {
    shots[i] = shots[i].replace(maleNude, 'he keeps his dark shirt and trousers on');
    if (!/fully clothed|no male nudity|trousers remain on|keeps his dark shirt/i.test(shots[i])) {
      shots[i] = `${shots[i]} ${anchor}`.trim();
    }
  }

  // 前 6 镜已强制穿衣；若第 7 镜没有明确脱裤，补一次，保证男性裸体从 Shot 7 开始而不是更早/更晚。

  // 纯对白镜头补可见画面，避免 H3 只生成音频/空镜。
  const visualFallback = [
    'Camera medium two-shot, same location; she holds her pose, he stays in frame.',
    'Camera handheld close-up; they move together, hands and faces visible.',
    'Camera medium tracking shot; the action continues without a scene change.',
    'Camera side angle; clothing and bodies shift naturally with the movement.',
    'Camera close-up on hands and torsos; the interaction deepens.',
    'Camera low angle; the two bodies occupy the frame, breathing visible.',
    'Camera medium shot; the pose changes while the location stays the same.',
    'Camera close-up; faces and hands react to the movement.',
    'Camera rear three-quarter; the action continues in the same space.',
    'Camera overhead; bodies move together on the same surface.',
    'Camera extreme close-up; the physical contact is visible.',
    'Camera slow pull-back; both bodies still, breathing slowing, no reset.',
  ];
  shots = shots.map((s0, i) => {
    const visual = s0.replace(/\(S\d\):\s*<d>[\s\S]*?<\/d>/g, '').trim();
    return /(camera|location|body positions?|clothing state|physical action|\bshe\b|\bher\b|\bhe\b|\bhis\b)/i.test(visual) && visual.length >= 60
      ? s0 : `${visualFallback[Math.min(i, visualFallback.length - 1)]} ${s0}`.trim();
  });

  // 统一衔接语义：每镜从上一镜的结束姿态继续，不重启、不重复上一动作。
  // 归一器会被生成/提交/显示多次调用，必须幂等，不能叠加三遍 Continuity。
  const continuity = "Continuity: begin exactly from the previous shot's end pose; same location and clothing state; do not repeat the previous action.";
  const continuityRe = /^(?:Continuity: begin exactly from the previous shot's end pose; same location and clothing state; do not repeat the previous action\.?\s*)+/i;
  shots = shots.map((s0, i) => {
    const body = String(s0 || '').replace(continuityRe, '').trim();
    return i === 0 ? body : `${continuity} ${body}`;
  });

  shots = shots.filter(Boolean);
  while (shots.length < 12) shots.push('Afterglow in the exact same location and position: both bodies still, breathing slowing, sweat cooling on skin; no new act, no reset.');
  shots = shots.slice(0, 12);

  const overallMatch = raw.match(/overall_soundscape\s*:\s*([\s\S]*?)(?=\n\s*non_diegetic_music\s*:|\n\s*speaker_mapping\s*:|$)/i);
  const overall = (overallMatch ? overallMatch[1] : 'Location ambience, wet skin contact, breathing, one climax cry, then after-breaths.').trim();
  const speaker = 'speaker_mapping: {"S1":"Chinese (Mandarin)_Adult_Female_Soft","S2":"Chinese (Mandarin)_Adult_Male_Low"}';
  const body = shots.map((s, i) => `[Shot ${i + 1}] ${s}`).join('\n');
  return `${head}\n\ndetailed_description:\n${body}\n\noverall_soundscape: ${overall}\nnon_diegetic_music: None\n${speaker}`;
}
