/**
 * H3 提示词「参考图锚定 + 首帧约束」统一口径
 *
 * 【为什么需要这个模块】
 * H3 是图生视频模型：参考图天然就是成片第 1 帧。如果提示词里再写
 *   「以参考图为首帧」「场景沿用参考图」，
 * 模型会把这段时间当成"参考图展示 / 参考图场景动画"来做 —— 开头几秒退化成静止贴图，
 * 剧情迟迟不进入（用户反馈的"第一段无意义"）。
 *
 * 【正确口径】（与主题库 470 主题、后端 det16 兜底注入完全一致）
 *   - 参考图只锚定「外观」：面部五官特征 + 发型 + 发色
 *   - 参考图「不作为开场画面内容」：成片第 1 帧直接呈现 [Shot 1] 描述的剧情场景
 *   - 背景 / 服装 / 姿势 / 构图 一律按提示词执行，不沿用参考图
 *
 * 【共用位置】
 *   1. src/components/EroticCreationPanel.tsx —— 情色创作模式 → LLM 生成 H3 提示词
 *   2. src/data/themeLibrary.ts                 —— 470 个内置主题 → 主题转视频提示词
 *   3. src/components/SeriesWorkbench.tsx       —— 系列短剧大纲 / 分集脚本
 */

/**
 * subject_definitions 里 <Picture 1> 的描述行（主题库使用）。
 * 只锁面部五官与发型发色，明确不锁背景 / 服装 / 姿势 / 构图。
 */
export const H3_REF_FACE_ONLY_LINE =
  '<Picture 1> 是视频主角的面部参考图，由用户上传。仅保留该女性的面部五官特征（脸型、眼睛、鼻子、嘴巴、痣的位置）与发型发色一致；不要保留参考图的背景、服装、姿势、构图，所有场景、服装、动作、镜头均按本提示词详细描述生成。';

/**
 * 统一的首帧约束块（注入到 userHint 最前面，作为最高优先级指令）。
 * 情色创作模式 / 系列工作台 / 主题库 detailed_description 共用同一语义。
 *
 * ⚠ 文案里绝不能出现字面量 "[Shot 1]"：
 *   后端 det16 用正则 \[\s*Shot\s*\d+\s*\] 切分 detailed_description 区，
 *   约束文字里出现 "[Shot 1]" 会被当成一个分镜边界 → 凭空多出一段
 *   "只有约束文字、没有画面内容"的假分镜（第 1 段无意义 / 末尾镜头被挤掉）。
 *   统一改用「第一个分镜」这类自然语言表述。
 */
export const H3_FIRST_FRAME_CONSTRAINT = `【首帧约束 - 最高优先级】
1. 参考图仅为角色外观一致性锚定（面部五官特征、发型、发色），不作为开场画面内容；视频第一帧必须直接呈现本提示词第一个分镜所描述的剧情场景画面。
2. 禁止以参考图人物单独特写、静止贴图或唱歌/说话作为开场；所有场景、服装、动作、镜头均按提示词详细描述生成，不得沿用参考图的背景、服装、姿势或构图。
3. 角色外观一致性：全程复用参考图的面部五官特征与发型发色；除外观锚定之外，背景、服装、姿势、构图一律按提示词执行。`;

/**
 * 主题库 detailed_description 用的「开场硬约束」块（与上面的首帧约束同义，主题库口径）。
 * 同样不含字面量 "[Shot N]"（见上）。
 */
export const H3_OPENING_HARD_CONSTRAINT = `【开场硬约束 - 必须严格遵守】
- 参考图仅用于角色面部五官与发型发色的外观锚定，不作为开场画面内容
- 视频第一帧必须直接呈现第一个分镜所描述的剧情场景画面，禁止以参考图人物单独特写、静止贴图或唱歌/说话作为开场
- 场景、服装、动作、镜头全部按下方分镜执行，不得沿用参考图的背景、服装、姿势或构图`;

/**
 * 用户明确要求「参考图本身作为开场 / 沿用参考图场景」时的正向锚点。
 * 只有用户主动这样说才启用，默认一律走 H3_FIRST_FRAME_CONSTRAINT。
 */
export const H3_REFERENCE_AS_FIRST_FRAME_ANCHOR = `【首帧锚点 - 最高优先级】
1. 第一个分镜必须以参考图作为首帧视觉起点，画面构图、角色站位/姿势/朝向、背景环境、服装必须紧贴参考图。
2. 角色一致性：全程必须严格复用参考图的角色外观（面部、发型、妆容、身材、肤色、服装）。
3. 场景沿用参考图：参考图所在的场景即首帧场景；提示词中如果仅指定姿势/道具/动作，仍在参考图场景内执行。`;

/** 负向约束关键词：用户表达"只参考脸 / 不要参考图背景" */
const FACE_ONLY_PATTERNS = [
  '仅保留面部', '仅面部参考', '只保留面部', '仅保留该女性', '不要保留参考图的背景',
  '不要保留参考图', '不保留参考图', '面部参考图', '参考图仅用于', '不作为开场画面',
  'face only', 'facial reference only', 'face reference only',
];

/** 正向覆盖关键词：用户明确要求"用参考图当开场 / 沿用参考图场景" */
const REFERENCE_AS_FIRST_FRAME_PATTERNS = [
  '以参考图为首帧', '参考图作为首帧', '参考图为首帧', '首帧用参考图', '首帧为参考图',
  '沿用参考图场景', '沿用参考图的场景', '参考图场景继续', '保持参考图场景',
  'ref as first frame', 'use the reference image as the first frame',
];

/**
 * 检测用户是否显式表达「参考图仅用于面部 / 不要保留参考图背景」。
 * 命中时必须使用防首帧约束（现在已是默认行为，此函数保留给 UI 提示与后端兜底判断）。
 */
export function 检测仅面部参考意图(文本: string | undefined | null): boolean {
  if (!文本) return false;
  return (
    FACE_ONLY_PATTERNS.some(kw => 文本.includes(kw)) ||
    /不要保留参考图的?(背景|服装|姿势|构图)/.test(文本)
  );
}

/**
 * 检测用户是否显式要求「参考图本身作为开场画面 / 沿用参考图场景」。
 * 命中才启用正向锚点，否则一律用 H3_FIRST_FRAME_CONSTRAINT。
 */
export function 检测要求参考图作首帧(文本: string | undefined | null): boolean {
  if (!文本) return false;
  return REFERENCE_AS_FIRST_FRAME_PATTERNS.some(kw => 文本.includes(kw));
}

/**
 * 统一入口：给定用户补充文本，返回应当注入到提示词最前面的首帧约束块。
 *
 * @param userHint        用户主提示词
 * @param supplementary   统一补充信息
 * @param supplementaryItems 逐条补充信息
 */
export function 构建首帧约束块(
  userHint?: string | null,
  supplementary?: string | null,
  supplementaryItems?: (string | null | undefined)[],
): string {
  const all = [userHint || '', supplementary || '', ...(supplementaryItems || []).filter(Boolean)].join('\n');
  if (检测要求参考图作首帧(all)) return H3_REFERENCE_AS_FIRST_FRAME_ANCHOR;
  return H3_FIRST_FRAME_CONSTRAINT;
}
