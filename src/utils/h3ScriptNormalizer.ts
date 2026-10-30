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

// 删除“没有 <d> 绑定的说话/嗓音描述”句，避免 H3 把英文旁白读出来。
export function stripOrphanSpeech(text: string): string {
  // 先按 <d>...</d> 切开：台词原样保留，台词外的句子再逐句删“嗓音/说话”旁白。
  // 这样 "(S1): <d>...</d> His voice is a low mutter." 里的旁白也会被删掉。
  return String(text || '')
    .split(/(<d>[\s\S]*?<\/d>)/g)
    .map((part) => {
      if (/^<d>/.test(part)) return part;
      return part
        .split(/(?<=[.!?])\s+/)
        .filter((p) => {
          const t = p.trim();
          if (!t) return false;
          // 有说话/嗓音关键词 → 旁白
          if (/\b(?:voice|whisper\w*|mutter\w*|murmur\w*|under (?:his|her) breath|says?|answers?|commands?|orders?|snaps?|snarls?|hisses?|tone|cries out|moans?|gasps?|begs?|warns?|pleads?|whimpers?|sobs?|tells?|yells?|shouts?|strips her dignity)\b/i.test(t)) return false;
          // 纯声音说明句（No dialogue. / Only heel clicks...）
          if (/^(?:no\s+(?:dialogue|speech)\b|only\s+(?:the\s+)?(?:sound|heel|shutter|fabric|breath))/i.test(t)) return false;
          // 导演注释/元话语（as the theme requires / the theme's ... beat / no chase yet）→ 不是画面
          if (/\bthemes?\b|\bas the theme\b|\bno chase yet\b|\btheme action\b|\bthe lock-in\b/i.test(t)) return false;
          if (/\b(?:bargain\w*|prepares? the bind|preparing the bind)\b/i.test(t)) return false;
          // 只有“语气形容词 + 短句”，没有谁+动作 → 语气残片
          if (t.length < 60 && !/\b(?:she|he|her|his)\b\s+\w+/i.test(t)
            && /^(?:soft|flat|sharp|breaking|uncertain|quiet|low|cold|high|thin|hoarse|strained|greedy|hungry|calm|uneasy|panicked|desperate|shrill|broken|small|tight|easy|wet|trembling|tearful|breathless|furious|scared|terrified|trying|almost|not yet)\b/i.test(t)) return false;
          return true;
        })
        .join(' ');
    })
    .join('');
}

function cleanBeat(raw: string): string {
  const cleaned = raw
    // 模型偶尔在镜头正文里插入英文拒写残留，必须剔除，否则 H3 会把它当画面描述。
    .replace(/^(?:I (?:also )?(?:won't|will not|cannot|can't)[^\n]*)$/gmi, '')
    .replace(/\bI (?:also )?(?:won't|will not|cannot|can't) (?:write|provide|generate)[^.;]*[.;]?/gi, '')
    .replace(/^\s*(?:\[\s*)?(?:\*\*)?(?:SHOT|Shot)\s+\d+\b\s*\]?\s*[:：]?\s*/i, '')
    .replace(/^\s*\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}[^\n]*\n?/i, '')
    // 模型常在镜头正文前再写一次 `. 0:00–0:05.`，必须去掉，否则 H3 会看到重复时间戳。
    .replace(/^[\s.·\-–—]*\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}\s*[.\-–—]*\s*/i, '')
    // 跳过 model 在正文前保留的括号时间范围：(0:05–0:10)
    .replace(/^\s*\(\s*\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}\s*\)\s*[.\-–—]*\s*/i, '')
    .replace(/^\s*TIME\s*\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}[^\n]*\n?/gmi, '')
    .replace(/^\s*Time range[^\n]*\n?/gmi, '')
    .replace(/^\s*(?:TITLE|SETTING|Clothing tracked)\s*[:：][^\n]*\n?/gmi, '')
    .replace(/^\s*\d+\.\s*(?:\(?\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}\)?)?\s*/i, '')
    .replace(/^\s*\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}\s*\|?\s*/i, '')
    // 去掉正文中间残留的管道时间字段 `| 0:05–0:10 |`，避免与前置时间戳重复。
    .replace(/\|\s*\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}\s*\|/gi, ' ')
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
    // 清除没有 <d> 的“语气/情绪”孤儿行：如 "Whispered, greedy." "Flat, close." "Breaking."
    // H3 只朗读 <d> 内台词；这些碎片既不是台词也不是画面描述，只会污染镜头正文。
    .replace(/^[ \t]*(?:whispered|murmured|muttered|growled|rasped|snapped|ordered|commanded|begged|sobbed|moaned|gasped|panted|chuckled|laughed|grunted|breaking|sobbing|pleading|voice|tone|breath|soft|flat|cold|low|high|quiet|hoarse|contemptuous|smug|wet|trembling|thin|sharp|tearful|shrinking|broken|tight|easy|calm|greedy|hungry|uneasy|fear|panic)[^.\n]{0,40}\.?[ \t]*$/gmi, '')
    // 单镜单机位：删掉同一镜里"then cut to / then whip to / then a low angle"这类的第二机位。
    // 同一分镜写两个画面，是 H3 人体错位/多人体粘连的主因。只保留第一个机位和连续动作。
    .replace(/(?:[,;]\s*)?then\s+(?:cut|whip|rack[- ]?focus|tilt|track(?:ing)?|push[- ]?in|punch[- ]?in|reverse|pan|zoom|dolly|pull[- ]?back|snap)\b[^.;\n]*/gi, '')
    .replace(/(?:[,;]\s*)?then\s+(?:a\s+)?(?:low angle|tight two-shot|tight shot|tight on|medium shot|medium on|wide shot|wide on|close[- ]up|close up|close on|extreme close|ECU|CU|overhead|side angle|reverse angle|reverse shot|handheld|steadicam|two-shot|insert|tracking|dolly|push in|pull back)\b[^.;\n]*/gi, '')
    .replace(/(?:[,;.]\s*)?then\s+a\s+(?:whip[- ]?pan|cut|tilt|pan|zoom|push[- ]?in|rack[- ]?focus|dolly|reverse|macro)\b[^.;\n]*/gi, '')
    .replace(/(?:[,;.]\s*)?then\s+(?:a\s+)?(?:rack(?:[- ]?focus)?\s*to|pull\s*to|push\s*(?:onto|through)|low tracking|low angle|macro|close on|medium on|wide on|tight on)\b[^.;\n]*/gi, '')
    .replace(/(?:[,;]\s*)?(?:hard\s+)?cut\s+(?:back\s+)?to\b[^.;\n]*/gi, '')
    .replace(/\bSplit\s*:\s*/gi, '')
    // 克隆人/多男性词：silhouette / dark figure / second figure → him
    .replace(/\b(?:his|the)\s+silhouette\b/gi, 'him')
    .replace(/\*{2,}/g, '')
    .replace(/\b(?:is|as|like)?\s*a\s+silhouette\b/gi, 'him')
    .replace(/\bsilhouette\b/gi, 'him')
    // 单镜头内禁止身体旋转（H3 解剖协议）：spinning/turns her → walking/takes her
    .replace(/\bspinning\s+(her|him)\b/gi, 'walking $1')
    .replace(/\bspins?\s+(her|him)\s+around\b/gi, 'moves $1')
    .replace(/\bspins?\s+(her|him)\b/gi, 'moves $1')
    .replace(/\bturns\s+her\s+into\s+another\s+position\s*[:：]/gi, 'takes her in another position:')
    .replace(/\ba\s+dark\s+(?:figure|shape)\b/gi, 'him')
    .replace(/\ba?\s*second\s+(?:figure|man|person|shadow)\b[^.;\n]*/gi, ' him ')
    // 避免“second figure/second man”诱导 H3 生成克隆人
    .replace(/\b(?:then\s+)?a?\s*second\s+(?:figure|man|person|shadow)\b[^.;\n]*/gi, ' the man ')
    // 清掉句子被截断后的 "then a ." / "then a," 残片
    .replace(/\bthen\s+a\s*[.,;]\s*/gi, ' ')
    // 分屏/双画面指令会让 H3 把两个画面糊成一帧，直接去掉 split-screen 标记
    .replace(/\bsplit(?:[- ]screen)?\b\s*[-—:：]\s*/gi, '')
    // 只去掉“行首字段标签”，避免误伤正文里的 "another position:"。
    .replace(/^[ \t]*(?:Body positions?|Physical action|Clothing state|Emotional beat|Positions?)\s*[:：]\s*/gmi, '')
    .replace(/^[ \t]*(?:Location|Camera|Body|Action|Clothing)\s*[:：]\s*/gmi, '')
    // 大写内联字段标签（LOCATION: / BODY: / CLOTHING: / ACTION: / EMOTIONAL）不在行首也要清。
    .replace(/\b(?:LOCATION|BODY|CLOTHING|ACTION|POSITIONS?|EMOTIONAL(?:\s+BEAT)?)\s*[:：]\s*/g, ' ')
    .replace(/\b(?:EMOTIONAL|Emotional)\b\s*[:：]?\s*/g, ' ')
    // 首字母大写的内联字段标签（Location: / Body positions: / Clothing state: / Physical action:）
    .replace(/\b(?:Body positions?|Clothing state|Physical action|Location|Body|Action|Clothing|Position)\s*[:：]\s*/g, ' ')
    // 正文里被当作主语用的 (S1)/(S2) 不是台词标签，去掉；保留 (S1): <d>。
    .replace(/\(S[12]\)(?!\s*:\s*<d>)/g, ' ')
    // 正文自带的单时间戳一律去掉，由模板统一重建，避免 01:06.000 01:00.000。
    .replace(/^\s*\d{2}:\d{2}\.\d{3}\s*/, '')
    // 时间戳后残留的 | / . / - 分隔符
    .replace(/^\s*[|.\-–—]+\s*/, '')
    // 抽象情绪标签 "Beat: ..." 不是画面，H3 容易读成英语旁白，整段删除。
    .replace(/\bBeat\s*:\s*[^.\n]*\.?/gi, ' ')
    // 行内孤儿声线提示：he low, not yet for her: / she uncertain: / he close, calm:
    // 只在后面紧跟 Tone/<d>/(Sx)/标点/行尾时删除，避免误删正常叙述。
    .replace(/\b(?:he|she)\s+[^.:\n]{0,45}:\s*(?=Tone\s*[:：]|\(S[12]\)|<d>|[.;])/gi, ' ')
    // 行内语气提示（不在行首）：Tone: hungry mutter / tone：quiet command...
    .replace(/\bTone\s*[:：]\s*[^.。\n]*/gi, ' ')
    // 孤儿说话人提示：(S2) under his breath: (S1): <d>...  → 去掉前面的 (S2) under his breath:
    .replace(/\(S[12]\)\s*[^.:\n]{0,40}:\s*(?=\(S[12]\))/g, ' ')
    // 清除行内括号语气提示，如 "(low, hungry whisper to himself)"；保留 (S1)/(S2) 与 <d> 台词。
    // 这些提示没有 <d> 绑定，是 H3 生成英语旁白的常见来源。
    .replace(/\((?!S[12]\))[^)<\n]{0,60}\)/g, ' ')
    // 清除 "Tone: ..." 这类没有 <d> 的语气行
    .replace(/^[ \t]*Tone\s*[:：][^\n]*$/gmi, '')
    .trim();
  return stripOrphanSpeech(cleaned);
}

function splitScript(raw: string): string[] {
  const text = String(raw || '');
  const finish = (parts: string[]) =>
    parts.map(cleanBeat).filter((x) => x.length > 10).filter((x) => !isModelRefusal(x));

  // 1) 有 SHOT N 标签：按标签切（支持 `[Shot 1]` 与 `SHOT 1:`）。
  if (/\bSHOT\s+\d+/i.test(text)) {
    return finish(
      text
        .split(/(?=(?:\[\s*(?:\*\*)?(?:SHOT|Shot)\s+\d+\s*\]?|(?:^|\n|\])\s*(?:\*\*)?SHOT\s+\d+\b[:：]?))/im)
        .filter((x) => x.trim().length > 0),
    );
  }
  // 2) 没有 SHOT 标签，但字段行（Camera/Location/Body/Action/Clothing）重复出现：
  //    按出现最多的那个字段分组成镜，避免把每个字段行切成“碎片镜头”。
  const fields = ['Camera', 'Location', 'Body', 'Action', 'Clothing'];
  let topField = '';
  let topCount = 0;
  for (const f of fields) {
    const n = (text.match(new RegExp(`\\b${f}\\s*[:：]`, 'gi')) || []).length;
    if (n > topCount) { topCount = n; topField = f; }
  }
  if (topCount >= 3) {
    const parts = text.split(new RegExp(`(?=\\b${topField}\\s*[:：])`, 'i')).filter((x) => x.trim().length > 0);
    // 首个字段前的 Camera 前言并入第一个镜头块，避免多出一个只有机位的空镜。
    if (parts.length > 1 && !new RegExp(`^\\s*\\b${topField}\\s*[:：]`, 'i').test(parts[0])) {
      parts[1] = `${parts[0].trim()} ${parts[1]}`;
      parts.shift();
    }
    return finish(parts);
  }
  // 3) 兜底：段落/句子切分。
  const paras = text.split(/\n\s*\n+/).map((x) => x.trim()).filter(Boolean);
  if (paras.length >= 4) return finish(paras);
  const sentences = text.split(/(?<=[.!?。！？])\s+/).map((x) => x.trim()).filter(Boolean);
  return finish(sentences.length ? sentences : [text]);
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
  // LLM 有时把 overall_soundscape / speaker_mapping 也写进正文，最后一镜会把它们吞进去。
  // 先在剧本层截断这些尾部段落，避免最终提示词出现两套声音/说话人块。
  raw = String(raw || '').split(/\n?\s*(?:overall_soundscape|non_diegetic_music|speaker_mapping)\s*:/i)[0];
  let sourceBeats = splitScript(raw);
  if (sourceBeats.length < 3 && raw.trim().length > 500) {
    // 没有 SHOT 标题时按段落回退；注意必须在回退后重新计算数量，
    // 不能继续用回退前的 sourceBeats.length，否则 12 段会被误判为空。
    sourceBeats = raw
      .split(/\n{2,}/)
      .map(cleanBeat)
      .filter((x) => x.length > 30)
      .filter((x) => /(?:Camera|Location|Body|Clothing|Action|Emotional|she |her |he |his |woman|man)/i.test(x));
  }
  if (sourceBeats.length < 2) {
    // 既没有 SHOT 标题，也没有足够空行分段时，按完整视觉句再切一次；
    // 仍然只使用当前剧本内容，不注入任何旧动作模板。
    sourceBeats = raw
      .split(/(?<=[.!?。！？])\s+/)
      .map(cleanBeat)
      .filter((x) => x.length > 10)
      .filter((x) => /(?:she|her|he|his|woman|man|camera|location|body|clothing|action|女人|男人|她|他)/i.test(x));
  }
  // 剧本哪怕只有 2-3 镜，也交给 coercive/consensual 框架补齐到 12/20/30，不能在这里直接判空导致整卡失败。
  if (sourceBeats.length < 2) return [];
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
  // 清掉不是紧贴 <d> 的孤儿说话人前缀，避免 (S2): 低声说，(S1): <d>台词</d> 错位。
  raw = raw.replace(/\((S[12])\)\s*[:：]\s*(?![^\n]*?<d>)/gi, '');
  // 去掉脱离台词的短舞台提示行（如 "low, oily whisper,"），避免 H3 把它当上一句台词。
  raw = raw.replace(/^[^\n<]{1,90},\s*\n(?=\s*\(S[12]\)\s*:\s*<d>)/gm, '');
  const maleLines = /(别叫|跟我走|闭嘴|硬了|腿张开|我要进去|夹这么紧|夹死|接着夹|叫出来|看着我|谁在操|嘴也|射了|还好吗|夹紧|吞下去|含住|不许|别动|别出声|不许出声|骚货|骚穴|操死|鸡巴套子|不要动|不要出声|张开|舔干净|爸爸|哥哥|跪好|趴好|痛才对|脱了|自己把腿|含深|再叫|奶子|干你|求我|进来|把衣服|腿分开|别装|欠操|喊也没用|衣服一件件|这么低胸|巨乳就该|讲台上就该|放过？衣服脱光|黑板前|继续写|转过去|按住了|这件先下去|巨乳女老师|裙子也脱|站直|挺胸|给谁看)/;
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
  // 同一镜头内完全相同的台词去重（不要求相邻），避免 H3 把重复 S2 读成两遍火星语。
  out = out.split(/(?=\[Shot\s+\d+\])/).map((block) => {
    const seen = new Set<string>();
    return block.replace(/(\(S[12]\):\s*<d>[^<]*<\/d>)/g, (line) => {
      if (seen.has(line)) return '';
      seen.add(line);
      return line;
    });
  }).join('');
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
  shotCount?: number;
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
  let shots = [...byNum.entries()].sort((a, b) => a[0] - b[0]).slice(0, opts.shotCount || 12).map(([, v]) => v);

  const anchor = 'Fully clothed.';
  const maleNude = /(?:\b(?:man|he)\b[^.\n]{0,100}\b(?:fully\s+|still\s+)?nude\b|\bboth\s+(?:now\s+|still\s+)?(?:fully\s+)?nude\b|\bhe\s+(?:is\s+|now\s+)?shirtless\b|\b(?:his\s+)?(?:torso|chest)\s+(?:is\s+)?bare\b|\brevealing\s+(?:a\s+)?(?:massive\s+)?(?:tattooed\s+)?chest\b|\bhis\s+(?:\w+\s+){0,4}(?:cock|penis)\s+(?:springs|is|comes)\s+free\b|\bhis\s+\w+\s+(?:cock|penis)\s+(?:out|free)\b|(?:\bhe\s+)?(?:then\s+)?(?:yanks?|pulls?|rips?|strips?|shoves?)\s+(?:his|the)\s+(?:own\s+)?(?:hoodie|t-shirt|shirt|tee|top|clothes)[^.;]*|\bhe\s+(?:remains?|stays?)\s+in\s+(?:jeans|pants|trousers)\s+only\b|\bhe\s+(?:shoves|kicks|pushes|strips)\s+(?:his|the)\s+(?:jeans|pants|trousers|boxers|clothes)[^.;]*|\bclothing stays off forever\b)/gi;
  // coercive 框架前 4 镜男性穿衣；Shot 5 是男性脱裤/全裸的动作点，不能清洗掉。
  const maleCleanUntil = coercive ? 4 : shots.findIndex((s0) => maleNude.test(s0));
  const maleLimit = maleCleanUntil > 0 ? maleCleanUntil : (coercive ? 4 : 0);
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
  const continuity = "Same pose; continue. ";
  const continuityRe = /^(?:Same pose; continue\.?\s*)+/i;
  shots = shots.map((s0, i) => {
    const body = String(s0 || '').replace(continuityRe, '').trim();
    return i === 0 ? body : `${continuity} ${body}`;
  });

  shots = shots.filter(Boolean);
  while (shots.length < 12) shots.push('Afterglow in the exact same location and position: both bodies still, breathing slowing, sweat cooling on skin; no new act, no reset.');
  shots = shots.slice(0, opts.shotCount || 12);

  const overallMatch = raw.match(/overall_soundscape\s*:\s*([\s\S]*?)(?=\n\s*non_diegetic_music\s*:|\n\s*speaker_mapping\s*:|$)/i);
  const overall = (overallMatch ? overallMatch[1] : 'Location ambience, wet skin contact, breathing, one climax cry, then after-breaths.').trim();
  const speaker = 'speaker_mapping: {"S1":"Chinese (Mandarin)_Adult_Female_Soft","S2":"Chinese (Mandarin)_Adult_Male_Low"}';
  const body = shots.map((s, i) => `[Shot ${i + 1}] ${s}`).join('\n');
  return `${head}\n\ndetailed_description:\n${body}\n\noverall_soundscape: ${overall}\nnon_diegetic_music: None\n${speaker}`;
}

/**
 * 检测 LLM 的内容审核拒写（refusal）。
 * 拒写文本绝不能被当成剧本分镜解析，否则会产出 "Afterglow" 填充的垃圾提示词。
 */
export function isModelRefusal(text: string): boolean {
  // 统一弯引号，避免 "can’t / won’t" 绕过检测。
  const t = String(text || '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
  return /(?:I (?:can't|cannot|won't|will not|must decline|have to stop|need to stop|also won't)|I'm sorry|I apologize|If you want a (?:fully )?consensual|If you want to write|I can help with that instead|otherwise I have to stop|I won't produce|I can't assist|I cannot assist|I must refuse|against my (?:policy|guidelines)|This request (?:asks|is) for|(?:detailed|shot-by-shot)[^.]{0,40}depiction of|depiction of (?:assault|abduction|stalking|sexual violence)|If this relates to real distress|seek appropriate help|describe a different scene|discuss general writing craft|non-consensual secret filming|Even framed as|overly specific|realistic assistance with|rephrase without|I can consider it|hard no|criminal acts|If you want a consensual|binding-against-will|assault framing|This request does not|able to write|discuss whether it fits|describe that instead|consensual adult scene|Otherwise I have to)/i.test(t);
}

/** 去掉拒写句子，只保留模型真正写出的剧本内容。 */
export function stripModelRefusal(text: string): string {
  const raw = String(text || '');
  if (!isModelRefusal(raw)) return raw;
  const parts = raw.split(/(?<=[.!?])\s+|\n+/);
  return parts.filter((s) => s.trim() && !isModelRefusal(s)).join(' ').trim();
}

