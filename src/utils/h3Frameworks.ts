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
    // 直接取 <d> 内容，去掉 [Chinese] 语言标签，再判断是男命令还是女求饶。
    const dm = line.match(/<d>([\s\S]*?)<\/d>/);
    const raw = (dm ? dm[1] : line).replace(/^\s*\[(?:Chinese|Mandarin|中文|汉语)\]\s*/i, '').trim();
    if (/^(?:他|男|马库斯|MARCUS)$/i.test(raw)) return line;
    if ((MALE_COMMAND.test(raw) && !FEMALE_PLEA.test(raw)) || /^(?:别动|别回头|别叫|别跑|站住|不许跑|别出声|别哭|闭嘴|安静|继续走|往前走|继续站着|站好|张嘴|接好|夹紧|站稳|转过来|腿抬好|自己动|含深点|脱掉|裙子|内裤|蹲下|用舌头|喷得)/.test(raw)) {
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
/**
 * 通用的“地点/支撑物”提取：不维护主题→场景的硬编码表。
 * 地点优先来自剧本每镜的 Location: 字段（LLM 已按主题写），其次来自主题正文里的地点短语。
 */
// 中文地点/支撑物 → 英文。仅做“翻译”，不做主题→场景映射，任何主题都走同一套。
const CN_PLACE_MAP: Record<string, string> = {
  废弃工地: 'abandoned construction site', 建筑工地: 'construction site', 工地: 'construction site',
  脚手架: 'scaffolding', 仓库: 'warehouse', 厂房: 'factory floor', 小黑屋: 'small dark room',
  小巷子: 'alley', 小巷: 'alley', 巷子: 'alley', 街道: 'street', 街头: 'street', 马路: 'road', 公路: 'road',
  卧室: 'bedroom', 客厅: 'living room', 房间: 'room', 厨房: 'kitchen', 浴室: 'bathroom', 卫生间: 'bathroom',
  办公室: 'office', 教室: 'classroom', 走廊: 'corridor', 楼道: 'stairwell', 电梯: 'elevator', 扶梯: 'escalator',
  地铁: 'subway', 车厢: 'subway car', 列车: 'train', 公交车: 'bus', 商场: 'mall', 超市: 'supermarket',
  酒店: 'hotel', 公寓: 'apartment', 别墅: 'villa', 房子: 'house', 公园: 'park', 花园: 'garden',
  树林: 'woods', 森林: 'forest', 海边: 'beach', 沙滩: 'beach', 游泳池: 'pool', 泳池: 'pool',
  屋顶: 'rooftop', 天台: 'rooftop', 操场: 'playground', 停车场: 'parking lot', 车库: 'garage',
  床: 'bed', 沙发: 'sofa', 桌子: 'desk', 柜台: 'counter', 吧台: 'bar counter', 地板: 'floor',
  地面: 'ground', 墙: 'wall', 栏杆: 'railing', 柱子: 'pillar', 浴缸: 'bathtub', 洗手台: 'sink',
};
const CN_ANCHOR_MAP: Record<string, string> = {
  脚手架: 'scaffolding', 栏杆: 'railing', 柱子: 'pillar', 墙: 'wall', 床垫: 'mattress', 床: 'bed',
  沙发: 'sofa', 桌子: 'desk', 柜台: 'counter', 长椅: 'bench', 椅子: 'chair', 树: 'tree', 石头: 'rock',
  吧台: 'bar counter', 箱子: 'crate', 托盘: 'pallet', 水槽: 'sink', 浴缸: 'bathtub', 地板: 'floor', 地面: 'ground',
};
function translateCn(text: string, map: Record<string, string>): string {
  const t = String(text || '');
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const k of keys) if (t.includes(k)) return map[k];
  return '';
}

// 地点的“中心名词”：只用于把 brick alley / alley bend / alley mouth 归成 alley，
// 不属于主题→场景映射，任何主题都走同一套。
const PLACE_HEAD_NOUNS = ['alley','street','road','lane','lot','yard','site','worksite','scaffold','scaffolding','bay','platform','room','bedroom','kitchen','bathroom','office','classroom','corridor','stairwell','elevator','escalator','subway','train','bus','mall','store','hotel','apartment','house','park','garden','woods','forest','beach','pool','rooftop','playground','garage','warehouse','factory','building','dock','pier','bridge','tunnel','cave','cell','basement','attic','fence','gate','doorway','hall','lobby','balcony'];
const SUBPART_WORDS = ['bay','platform','upright','tower','crossbar','cross','bar','bars','pole','poles','pipe','rail','level','midlevel','landing','corner','bend','mouth','edge','end','side','top','bottom','middle','foreground','background','passage','path','walkway','height','chest','gate','fence','yard','site','vertical','horizontal','mid','lower','upper'];
function placeHeadNoun(loc: string): string {
  const t = String(loc || '').toLowerCase();
  if (/scaffold/.test(t)) return 'scaffold';
  const words = t.replace(/-/g, ' ').split(/[^a-z]+/).filter(Boolean);
  for (const w of words) {
    const singular = w.endsWith('s') ? w.slice(0, -1) : w;
    const base = PLACE_HEAD_NOUNS.includes(w) ? w : (PLACE_HEAD_NOUNS.includes(singular) ? singular : '');
    if (base && !SUBPART_WORDS.includes(base)) return base === 'scaffolding' ? 'scaffold' : base;
  }
  return '';
}
function isSubpartOnly(loc: string): boolean {
  const words = String(loc || '').toLowerCase().replace(/-/g, ' ').split(/[^a-z]+/).filter(Boolean)
    .filter((w) => !['the','a','an','of','in','at','on','between','two','three','first','second','third','mid'].includes(w));
  // 没有主地点名词、但含子区域词（yard/site/pole/bar/vertical…）→ 视为子区域，丢弃。
  return words.length > 0 && words.some((w) => SUBPART_WORDS.includes(w)) && !placeHeadNoun(loc);
}

export function collapseLocations(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const v = String(raw || '').trim();
    if (!v) continue;
    if (/^(?:same(?:\s+(?:as above|location|place))?|同上|同一地点|原地)$/i.test(v)) continue;
    const head = placeHeadNoun(v);
    if (!head && isSubpartOnly(v)) continue;
    const display = head ? (head === 'scaffold' ? 'scaffolding' : head) : v;
    const key = (head || v).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(display);
  }
  return out;
}

export function translateChineseTerms(text: string): string {
  let out = String(text || '');
  for (const k of Object.keys(CN_PLACE_MAP).sort((a, b) => b.length - a.length)) {
    out = out.split(k).join(CN_PLACE_MAP[k]);
  }
  return out;
}

export function extractScriptLocations(text: string): string[] {
  const raw = String(text || '');
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (loc: string) => {
    let v = String(loc || '')
      .replace(/^\s*(?:same|the same)\s+/i, '')
      .replace(/^\s*(?:the|a|an)\s+/i, '')
      .replace(/\s*[,，].*$/, '')
      .replace(/[.;。；]+$/, '')
      .trim();
    if (!v) return;
    // "same / same location / 同上" 不是地点，直接丢弃。
    if (/^(?:same(?:\s+(?:as above|location|place))?|同上|同一地点|原地)$/i.test(v)) return;
    const key = v.toLowerCase();
    if (seen.has(key)) return;
    // 合并同一地点的变体：按中心名词归一（brick alley / alley bend → alley；scaffold bay / upright → scaffolding）。
    const head = placeHeadNoun(v);
    if (!head && isSubpartOnly(v)) return;
    if (head && out.some((e) => placeHeadNoun(e) === head)) return;
    if (out.some((e) => e.toLowerCase().includes(key) || key.includes(e.toLowerCase()) || (e.split(/\s+/).pop() === key.split(/\s+/).pop()))) return;
    seen.add(key);
    out.push(head ? (head === 'scaffold' ? 'scaffolding' : head) : v);
  };
  // 1) 剧本字段：Location: ...
  for (const line of raw.split(/\n+/)) {
    const m = line.match(/\bLocation\s*[:：]\s*([^.;\n]+)/i);
    if (m) push(m[1]);
  }
  if (out.length) {
    // Location 字段只写了一部分地点时，从正文补其它主地点（如 scaffolding），避免场景锚点漏地点。
    const words = raw.toLowerCase().replace(/-/g, ' ').split(/[^a-z]+/).filter(Boolean);
    const seenHeads = new Set(out.map((e) => placeHeadNoun(e) || e.toLowerCase()));
    for (const w of words) {
      if (!PLACE_HEAD_NOUNS.includes(w) || SUBPART_WORDS.includes(w)) continue;
      const head = w === 'scaffolding' ? 'scaffold' : w;
      if (seenHeads.has(head)) continue;
      seenHeads.add(head);
      push(head === 'scaffold' ? 'scaffolding' : head);
    }
    return out;
  }
  // 2) 中文地点短语：在/到/绑在/拖进 + 地点 + 方位词
  const cnRe = /(?:在|到|进入|走进|来到|退到|按在|绑在|趴在|靠在|坐在|躺在|拖进|拖到|拽进|拽到)([\u4e00-\u9fff]{2,10}?)(?:上|里|中|内|下|边|旁|前|后|处|着)/g;
  let cm: RegExpExecArray | null;
  while ((cm = cnRe.exec(raw))) {
    const en = translateCn(cm[1], CN_PLACE_MAP);
    if (en) push(en);
  }
  if (out.length) return out;
  // 2b) 没有介词的裸地点名词（如主题“小巷子 脚手架”）：按出现顺序扫描。
  const bare = Object.keys(CN_PLACE_MAP)
    .map((k) => ({ k, i: raw.indexOf(k) }))
    .filter((x) => x.i >= 0)
    .sort((a, b) => a.i - b.i);
  for (const { k } of bare) push(CN_PLACE_MAP[k]);
  if (out.length) return out;
  // 3) 英文地点介词短语：in/at/on/inside the X
  const re = /\b(?:in|at|on|inside|through|into)\s+the\s+([a-z][a-z\s-]{2,30})/gi;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(raw))) push(mm[1]);
  if (out.length) return out;
  // 4) 正文里的英文主地点名词（无介词，如 alley / scaffolding）：按出现顺序补全。
  const words = raw.toLowerCase().replace(/-/g, ' ').split(/[^a-z]+/).filter(Boolean);
  for (const w of words) {
    if (!PLACE_HEAD_NOUNS.includes(w) || SUBPART_WORDS.includes(w)) continue;
    push(w === 'scaffolding' ? 'scaffolding' : w);
  }
  return out;
}

/** 从地点短语里取一个可倚靠/可趴的支撑物名词；没有就返回空，由调用方用通用词。 */
function extractAnchor(location: string): string {
  const loc = String(location || '');
  const cn = translateCn(loc, CN_ANCHOR_MAP);
  if (cn) return cn;
  const m = loc.match(/\b(scaffolding|scaffold|pole|wall|railing|rail|bed|mattress|sofa|couch|desk|table|counter|bench|chair|tree|rock|car|hood|bar|column|pillar|frame|crate|pallet|dumpster|sink|tub|board|floor|ground)\b/i);
  return m ? m[1].toLowerCase() : '';
}

export function pickPenetrationPositions(context: string): PositionPlan {
  // 不再按主题名硬编码姿势：只从“剧本/主题最后一个地点”里取支撑物，生成通用姿势。
  const locs = extractScriptLocations(context);
  const anchor = extractAnchor(locs[locs.length - 1] || '') || extractAnchor(context) || 'nearest surface';
  const a = `the ${anchor}`;
  return {
    p1: `against ${a}, one leg lifted, taken from the front`,
    p2: `bent over ${a}, taken from behind`,
    p3: `down on the ground beside ${a} in missionary, legs held open`,
  };
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
  // 地点/动作衔接完全由“剧本 + 主题”决定，不锁定具体场景。
  // 若主题要求捆绑、但前戏还没写到捆绑，就在主题最后地点补一个捆绑转场；否则只在最后地点缺失时补一个移动镜头。
  const locs = extractScriptLocations(context);
  const finalLoc = locs.length ? locs[locs.length - 1] : '';
  const headText = head.join(' ');
  const esc = finalLoc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headHasLoc = finalLoc ? new RegExp(esc, 'i').test(headText) : true;
  const needsBind = /捆绑|绑住|绑|绳索|绳|rope|bind|tie/i.test(context);
  const headHasBind = /\bbind\w*\b|\btied\b|\btying\b|\brope\b|\bzip[- ]?tie\b|\bstrap\b|\bcuffs?\b|捆绑|绑住|绑在/i.test(headText);
  if (needsBind && !headHasBind) {
    const dest = finalLoc ? (/^(?:the|a|an)\s/i.test(finalLoc) ? finalLoc : `the ${finalLoc}`) : 'the nearest support';
    head.push(`He forces her against ${dest} and binds her wrists with rope; she is still clothed and struggling.`);
  } else if (finalLoc && !headHasLoc) {
    head.push(`He moves her into ${finalLoc ? (/^(?:the|a|an)\s/i.test(finalLoc) ? finalLoc : `the ${finalLoc}`) : 'the final location'}; she is still clothed and struggling.`);
  }
  const tail = [
    'He strips the last garment from her; she is completely nude. He then shoves his dark trousers and boxers down to his ankles, frees his cock, and kicks them aside; he is fully nude too; no clothing remains. She stops kicking and only shakes.',
    'He forces her to her knees, fists her hair, and pushes his cock into her mouth; she gags, saliva stringing, hands clawing at his thigh. (S2): <d>[Chinese] 张嘴。</d>',
    `He drags her up by the hair, positions her ${positions.p1}, and drives into her in one hard thrust; her body jolts and she cries out. (S2): <d>[Chinese] 夹紧。</d>`,
    `Without pulling out, he changes her position: ${positions.p2}; she gasps as he enters at the new angle. (S2): <d>[Chinese] 转过来。腿抬好。</d>`,
    'Extreme close-up on the join: his cock sliding in and out of her wet pussy, fluid stringing, her thighs trembling, his hand gripping her raised thigh. (S1): <d>[Chinese] 不要看那里…</d>',
    `He takes her ${positions.p3}, his hips between her legs, and drives deep; one hand in her hair, the other holding her hip; her resistance breaks into helpless noise. (S2): <d>[Chinese] 别躲。</d>`,
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


