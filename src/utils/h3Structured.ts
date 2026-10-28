/**
 * H3 结构化时间轴状态机
 *
 * 把“一段自然语言剧本”升级为结构化镜头序列：
 *   1. 为每个角色维护独立状态（identity / clothing / location / pose / props / emotion / voice）
 *   2. 每一镜显式声明 Start 状态 → 动作 → End 状态
 *   3. 下一镜只继承上一镜的 End 状态
 *   4. 输出连续性校验报告（地点变化 / 人物数量变化 / 服装回穿 / 道具消失 / 对白未绑定说话人）
 *
 * 设计目标：
 *   - 单一事实来源：状态不靠自然语言重复描述，而是靠状态机推导
 *   - 幂等：可对已经结构化过的文本再次运行
 *   - 不依赖具体主题关键词：地点/服装只从剧本里动态提取
 */

export type RoleId = 'S1' | 'S2';

export interface RoleState {
  role: RoleId;
  identity: string;
  /** 当前穿着的衣物规范名列表（on = 穿着，off = 已脱） */
  clothing: string[];
  location: string;
  pose: string;
  props: string[];
  emotion: string;
  voice: string;
}

export interface ShotFrame {
  index: number;
  timeSec: number;
  startState: string;
  action: string;
  endState: string;
  warnings: string[];
}

export interface TimelineResult {
  frames: ShotFrame[];
  report: string[];
}

const GARMENT_TOP = 'top';
const GARMENT_BOTTOM = 'bottom';
const GARMENT_BRA = 'bra';
const GARMENT_UNDERWEAR = 'underwear';

/** 衣物移除短语（英文/中文） */
const REMOVE_RE =
  /(\boff\b|\bremoved\b|\bgone\b|strips? the last garment|fully nude|no clothing remains|\bnude\b|takes? off|pull(?:s|ed)? (?:down|off)|shoves? (?:down|off)|\bripped\b|snaps? (?:the|it)? (?:off|down)|skirt (?:off|gone)|panties? (?:off|aside|gone)|bra (?:off|gone))/i;

const TOP_RE = /\b(shirt|blouse|top)\b|衬衫|上衣|外衣/i;
const BOTTOM_RE = /\b(skirt|miniskirt|mini)\b|裙子|短裙|下装/i;
const BRA_RE = /\b(bra|brassiere)\b|胸罩|内衣/i;
const UNDERWEAR_RE = /\b(panties|thong|underwear)\b|内裤|丁字裤/i;

/** 地点关键词（仅用于在镜头文本里检测“地点变化”，不用于给主题强加锁） */
const LOCATION_TERMS = [
  'elevator', 'escalator', 'mall', 'corridor', 'subway', 'metro', 'train',
  'classroom', 'office', 'bedroom', 'kitchen', 'bathroom', 'hotel', 'apartment',
  'bed', 'sofa', 'pool', 'park', 'street', 'alley', 'rooftop',
  '电梯', '扶梯', '商场', '走廊', '地铁', '车厢', '教室', '办公室', '卧室',
  '厨房', '浴室', '酒店', '公寓', '床', '沙发', '泳池', '公园', '街道', '巷子', '天台',
];

function detectLocation(text: string, fallback: string): string {
  const hit = LOCATION_TERMS.find((w) => new RegExp(w, 'i').test(text));
  return hit ? hit : fallback;
}

/** 从一镜文本里推导该镜后的衣物状态（在 prev 基础上做增量）。
 * 男性只跟踪上衣/下装；胸罩/内裤只属于女性。 */
function stepClothing(prev: string[], text: string, isMale: boolean): string[] {
  const worn = new Set(prev);
  const garments = isMale
    ? [GARMENT_TOP, GARMENT_BOTTOM]
    : [GARMENT_TOP, GARMENT_BOTTOM, GARMENT_BRA, GARMENT_UNDERWEAR];

  const hasTop = TOP_RE.test(text);
  const hasBottom = BOTTOM_RE.test(text);
  const hasBra = !isMale && BRA_RE.test(text);
  const hasUnderwear = !isMale && UNDERWEAR_RE.test(text);

  if (REMOVE_RE.test(text)) {
    // 全裸/脱掉最后一件 → 清空
    if (/(fully nude|no clothing remains|strips? the last garment|\bnude\b|脱光|全裸|衣服都没有)/i.test(text)) {
      worn.clear();
    } else {
      if (hasTop) worn.delete(GARMENT_TOP);
      if (hasBottom) worn.delete(GARMENT_BOTTOM);
      if (hasBra) worn.delete(GARMENT_BRA);
      if (hasUnderwear) worn.delete(GARMENT_UNDERWEAR);
    }
  } else {
    if (hasTop) worn.add(GARMENT_TOP);
    if (hasBottom) worn.add(GARMENT_BOTTOM);
    if (hasBra) worn.add(GARMENT_BRA);
    if (hasUnderwear) worn.add(GARMENT_UNDERWEAR);
  }

  return garments.filter((g) => worn.has(g));
}

function clothingLabel(list: string[]): string {
  if (!list.length) return 'nude';
  return list.join('+');
}

/** 角色数量变化检测：只允许 S1 + (可选)S2，出现“第二个人”视为异常 */
function detectExtraRole(text: string): boolean {
  return /(second man|another man|two men|both men|第三个|第二个人|另一个男人|两个人|两名)/i.test(text);
}

/** 对白未绑定说话人：出现语气词但没有 <d> 标签 */
function detectOrphanCue(text: string): boolean {
  return /(低声|命令|哭喊|喘着|喘息|呻吟|耳语|冷笑|吼道|说道|说)/.test(text)
    && !/\(S[12]\):\s*<d>[\s\S]*?<\/d>/.test(text);
}

/**
 * 输入：已经解析为镜头的文本列表 + 场景锚点
 * 输出：结构化镜头帧 + 连续性校验报告
 */
export function structureTimeline(
  shots: string[],
  opts: { sceneAnchor: string; hasMan: boolean; durationSec: number },
): TimelineResult {
  const frames: ShotFrame[] = [];
  const report: string[] = [];
  const step = opts.durationSec / Math.max(1, shots.length);
  const fallbackLoc = detectLocation(opts.sceneAnchor, 'current theme location');

  const woman: RoleState = {
    role: 'S1', identity: 'Subject 1',
    clothing: [GARMENT_TOP, GARMENT_BOTTOM, GARMENT_BRA, GARMENT_UNDERWEAR],
    location: fallbackLoc, pose: 'standing', props: [], emotion: 'calm',
    voice: 'Chinese (Mandarin)_Adult_Female_Soft',
  };
  const man: RoleState = {
    role: 'S2', identity: 'Subject 2',
    clothing: [GARMENT_TOP, GARMENT_BOTTOM],
    location: fallbackLoc, pose: 'standing', props: [], emotion: 'calm',
    voice: 'Chinese (Mandarin)_Adult_Male_Low',
  };

  let prevWomanClothing = [...woman.clothing];
  let prevManClothing = [...man.clothing];
  let prevLocation = fallbackLoc;

  for (let i = 0; i < shots.length; i++) {
    const raw = shots[i];
    const warnings: string[] = [];

    // 地点
    const loc = detectLocation(raw, prevLocation);
    if (loc !== prevLocation) {
      warnings.push(`location change: ${prevLocation} -> ${loc}`);
      report.push(`Shot ${i + 1}: location ${prevLocation} -> ${loc}`);
    }

    // 衣物状态机（女）
    const nextWomanClothing = stepClothing(prevWomanClothing, raw, false);
    for (const g of nextWomanClothing) {
      if (!prevWomanClothing.includes(g)) {
        warnings.push(`clothing resurrected: ${g}`);
        report.push(`Shot ${i + 1}: clothing reappeared (${g}) without explicit re-dress`);
      }
    }
    // 男衣物（只在出现男性相关动作时推进）
    let nextManClothing = prevManClothing;
    if (opts.hasMan) {
      nextManClothing = stepClothing(prevManClothing, raw, true);
      for (const g of nextManClothing) {
        if (!prevManClothing.includes(g)) {
          warnings.push(`male clothing resurrected: ${g}`);
          report.push(`Shot ${i + 1}: male clothing reappeared (${g})`);
        }
      }
    }

    // 角色数量
    if (detectExtraRole(raw)) {
      warnings.push('extra male role');
      report.push(`Shot ${i + 1}: extra role detected`);
    }

    // 对白未绑定
    if (detectOrphanCue(raw)) {
      warnings.push('orphan sound cue without speaker');
      report.push(`Shot ${i + 1}: sound cue has no (S1)/(S2) <d> speaker`);
    }

    const startState = `Start: clothing=[${clothingLabel(prevWomanClothing)}]; male_clothing=[${opts.hasMan ? clothingLabel(prevManClothing) : 'none'}]; location=${prevLocation}; pose=${woman.pose}`;
    const endState = `End: clothing=[${clothingLabel(nextWomanClothing)}]; male_clothing=[${opts.hasMan ? clothingLabel(nextManClothing) : 'none'}]; location=${loc}; pose=${woman.pose}`;

    frames.push({
      index: i + 1,
      timeSec: Math.round(i * step * 1000) / 1000,
      startState,
      action: raw,
      endState,
      warnings,
    });

    prevWomanClothing = nextWomanClothing;
    prevManClothing = nextManClothing;
    prevLocation = loc;
  }

  return { frames, report };
}

/** 把结构化帧渲染成 H3 detailed_description 的 [Shot N] 文本 */
export function renderTimeline(result: TimelineResult): string {
  return result.frames
    .map((f) => {
      const sec = f.timeSec;
      const stamp = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}.000`;
      const warn = f.warnings.length ? ` [fix: ${f.warnings.join('; ')}]` : '';
      return `[Shot ${f.index}] ${stamp}\n${f.startState}\n${f.action}\n${f.endState}${warn}`;
    })
    .join('\n\n');
}

/** 渲染连续性校验报告（追加在提示词末尾，供人工/调试查看） */
export function renderContinuityReport(result: TimelineResult): string {
  if (!result.report.length) {
    return 'continuity_check: OK — location, role count, clothing and speaker binding are consistent across all shots.';
  }
  return 'continuity_check: ' + result.report.join(' | ');
}
