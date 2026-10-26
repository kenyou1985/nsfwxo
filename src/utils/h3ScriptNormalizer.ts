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

function dedupeFirstContact(beats: string[], opts: NormalizeOptions): string[] {
  if (!opts.hasMan || !opts.coercive || beats.length < 3) return beats;
  const firstHasContact = /(choke|throat|forearm|clamp(?:s|ed)? (?:a )?hand|drags? her|lifts? her)/i.test(beats[0]);
  if (!firstHasContact) {
    beats[0] += ' In the same continuous shot, he closes the distance behind her, loops his forearm around her throat, pulls her back against his chest, and drags her toward the dark doorway; she gasps and claws at his arm.';
  }
  const dialogue = (text: string) => (text.match(/\(S\d\):\s*<d>[\s\S]*?<\/d>/g) || []).join(' ');
  if ((opts.shotCount || 11) >= 12) {
    // 12 镜版本：第 1 镜只走路/尾随，第 2 镜锁喉，第 3 镜拖入暗门。
    // 这样每一段 3 个分镜都有清晰动作递进，H3 不会把锁喉和脱衣压进第一段。
    beats[0] = beats[0]
      .replace(/(?:In the same continuous shot,\s*)?he closes[^.;]*?(?:throat|choke)[^.;]*[.;]?/gi, '')
      .replace(/(?:choke|throat|forearm)[^.;]*[.;]?/gi, '');
    beats[1] = `He closes the distance behind her, grabs her waist, locks a forearm around her throat, and pulls her back against his chest; both are still fully clothed. She gasps and claws at his arm. ${dialogue(beats[1])}`.trim();
    beats[2] = `He drags her through the dark doorway in one continuous pull; both are still fully clothed, no nudity yet. ${dialogue(beats[2])}`.trim();
  } else {
    // 11 镜旧版：首镜完成接近/控制，后续两镜室内延续。
    beats[1] = `Inside the dark room, he keeps his forearm across her throat and pushes her deeper; she gasps and claws at his arm. ${dialogue(beats[1])}`.trim();
    beats[2] = `Inside the dark room, he pins her against the wall and starts tearing her blouse open; she pleads. ${dialogue(beats[2])}`.trim();
  }
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
  // 模型偶发只给对白不给画面；H3 的分镜必须有可视动作，否则这一段会变成纯旁白/空镜。
  const visualFallback = opts.coercive ? [
    'Camera medium tracking shot; same location; she walks ahead, he follows behind.',
    'Camera handheld two-shot; he closes the distance, grabs her waist, and locks a forearm around her throat.',
    'Camera low angle following the drag; he pulls her through the dark doorway into the room.',
    'Camera tight two-shot against the wall; he pins her, tears the blouse open, and gropes her bare breasts.',
    'Camera close-up on hands and bodies; he strips the remaining clothes and fingers her.',
    'Camera low angle; he pushes her to her knees and feeds her his cock.',
    'Camera side profile; he lifts her and thrusts into her against the wall.',
    'Camera handheld close-up; he chokes her and fucks her harder.',
    'Camera rear three-quarter; he bends her over the surface and drives in from behind.',
    'Camera overhead; he folds her legs back and pounds her on the mattress.',
    'Camera extreme close-up on the join; he finishes deep inside her, then pulls back.',
    'Camera slow pull-back; afterglow, both bodies still, sweat cooling, no reset.',
  ] : [
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
  beats = dedupeFirstContact(beats, opts);
  beats = normalizeClothing(beats);
  const count = opts.shotCount || 12;
  while (beats.length < count) {
    beats.push('Afterglow in the exact same location and position: both bodies still, breathing slowing, sweat cooling on skin, the final physical evidence of the act still visible; no new act, no reset.');
  }
  return beats.slice(0, count);
}

/**
 * H3 只认 `<d>...</d>` 内文本，但说话人必须由紧邻的 `(S1):` / `(S2):` 锚定。
 * 这里统一清理中文说话人标签，并给每一句补上 speaker 锚点。
 */
export function normalizeDialogueSpeakers(raw: string): string {
  if (!raw) return raw;
  const maleLines = /(别叫|跟我走|闭嘴|硬了|腿张开|我要进去|夹这么紧|夹死|接着夹|叫出来|看着我|谁在操|嘴也|射了|还好吗|夹紧|吞下去|含住|不许|骚货|骚穴|操死|鸡巴套子|不要动|不要出声|张开|舔干净|爸爸|哥哥|跪好|趴好|痛才对|脱了|自己把腿|含深|再叫|奶子|干你|求我|进来|把衣服|腿分开|别装|欠操)/;
  const femaleLines = /(放开|求你|不要|你……|太大|太深|好满|去了|嗯|啊|慢|好舒服|我快|别摸|停下|还要|会坏|安全词|抱一会|没有|疼|别插|轻点)/;
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
  const out = raw.replace(/(?:\(S[12]\)\s*[:：]\s*)?<d>([\s\S]*?)<\/d>/g, (whole, inner, offset, full) => {
    const { text, speaker: labeled } = cleanInner(String(inner));
    if (!text) return whole;
    let speaker = labeled;
    if (!speaker) {
      const prefix = String(full).slice(Math.max(0, Number(offset) - 140), Number(offset));
      // 优先读紧邻的语气标签，避免“痛才对/脱了”等短命令被误判成女声。
      if (/(?:^|[.!?]\s*)(?:she|her|woman)\b[^.!?]{0,60}(?:whisper|moan|sob|whimper|breathe|cry|plead|gasp|says|asks)/i.test(prefix)) speaker = 'S1';
      else if (/(?:^|[.!?]\s*)(?:he|his|man)\b[^.!?]{0,60}(?:growl|order|command|snarl|laugh|grunt|says|ask|mutter|roar|pant)/i.test(prefix)) speaker = 'S2';
      else if (maleLines.test(text) && !femaleLines.test(text)) speaker = 'S2';
      else if (femaleLines.test(text)) speaker = 'S1';
      else speaker = /(他|男|马库斯|MARCUS)/i.test(String(inner)) ? 'S2' : 'S1';
    }
    return `(S${speaker === 'S2' ? 2 : 1}): <d>[Chinese] ${text}</d>`;
  });
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
}

export function normalizeH3PromptStructure(raw: string, opts: H3StructureOptions = {}): string {
  if (!raw || !/(?:\[Shot\s+\d+\]|SHOT\s+\d+\s*:)/i.test(raw)) return raw;
  const coercive = opts.coercive ?? /(?:choke|throat|forearm|drags?|stalking|stalk|coerc|CNC|胁迫|锁喉|拖|尾随|强上|强迫)/i.test(raw);
  const hasMan = opts.hasMan ?? /<Subject\s*2>|@Man|\bman\b|\bmale\b|男人|男性/i.test(raw);
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
  if (coercive && shots.length >= 7 && !/(?:drops?|shoves?|pulls?|kicks?)\s+(?:his|the)\s+(?:jeans|pants|trousers|boxers)|fully nude now|he is fully nude/i.test(shots[6])) {
    shots[6] = `He shoves his trousers and boxers down and is fully nude now. ${shots[6]}`;
  }

  // 纯对白镜头补可见画面，避免 H3 只生成音频/空镜。
  const visualFallback = coercive ? [
    'Camera medium tracking shot; same location; she walks ahead, he follows behind.',
    'Camera handheld two-shot; he closes the distance, grabs her waist, and locks a forearm around her throat.',
    'Camera low angle following the drag; he pulls her through the dark doorway into the room.',
    'Camera tight two-shot against the wall; he pins her, tears the blouse open, and gropes her bare breasts.',
    'Camera close-up on hands and bodies; he strips the remaining clothes and fingers her.',
    'Camera low angle; he pushes her to her knees and feeds her his cock.',
    'Camera side profile; he lifts her and thrusts into her against the wall.',
    'Camera handheld close-up; he chokes her and fucks her harder.',
    'Camera rear three-quarter; he bends her over the surface and drives in from behind.',
    'Camera overhead; he folds her legs back and pounds her on the mattress.',
    'Camera extreme close-up on the join; he finishes deep inside her, then pulls back.',
    'Camera slow pull-back; afterglow, both bodies still, sweat cooling, no reset.',
  ] : [
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

  // 12 镜开场：只有胁迫/尾随主题才强制“走路→锁喉→拖入”；其他主题保持原剧情。
  if (coercive && shots.length <= 12) {
    // Shot 1 只保留走路/尾随；模型经常把“锁喉+拖入”追加在末尾，整段截断，避免 H3 把第一段压缩成控制动作。
    const firstCut = shots[0].search(/(?:In this one continuous shot|In the same continuous shot|she gasps and claws|He is still fully clothed|he closes the distance behind her)/i);
    shots[0] = (firstCut > 0 ? shots[0].slice(0, firstCut) : shots[0])
      .replace(/(?:In the same continuous shot,\s*)?he closes[^.;]*(?:throat|choke|chest)[^.;]*[.;]?/gi, '')
      .replace(/\b(?:forearm|choke|throat)\b[^.;]*[.;]?/gi, '')
      .trim();
    if (!/walks?|walking|follows?|following/i.test(shots[0])) {
      shots[0] = `She walks ahead through the location, unaware; he follows several steps behind. ${shots[0]}`;
    }
    if (!/(choke|throat|forearm)/i.test(shots[1] || '')) {
      shots[1] = `He closes the distance, grabs her waist, locks a forearm around her throat, and pulls her back against his chest; both still fully clothed. ${shots[1] || ''}`;
    }
    if (!/(drags? her|drag her|through the (?:dark )?doorway)/i.test(shots[2] || '')) {
      shots[2] = `He drags her through the dark doorway in one continuous pull; both still fully clothed, no nudity yet. ${shots[2] || ''}`;
    }
  }

  shots = shots.filter(Boolean);
  while (shots.length < 12) shots.push('Afterglow in the exact same location and position: both bodies still, breathing slowing, sweat cooling on skin; no new act, no reset.');
  shots = shots.slice(0, 12);

  const overallMatch = raw.match(/overall_soundscape\s*:\s*([\s\S]*?)(?=\n\s*non_diegetic_music\s*:|\n\s*speaker_mapping\s*:|$)/i);
  const overall = (overallMatch ? overallMatch[1] : 'Location ambience, wet skin contact, breathing, one climax cry, then after-breaths.').trim();
  const speaker = 'speaker_mapping: {"S1":"Chinese (Mandarin)_Adult_Female_Soft","S2":"Chinese (Mandarin)_Adult_Male_Low"}';
  const body = shots.map((s, i) => `[Shot ${i + 1}] ${s}`).join('\n');
  return `${head}\n\ndetailed_description:\n${body}\n\noverall_soundscape: ${overall}\nnon_diegetic_music: None\n${speaker}`;
}
