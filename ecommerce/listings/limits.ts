/**
 * 平台规则常量与敏感词检查。
 *
 * 这些数字来自各平台的公开上架规范，平台会调整 —— 上线前需复核。
 * 敏感词表是情趣品类的第一道护栏：平台审核与广告系统都会拒掉
 * 显式情色词，一旦触发就是 listing 下架甚至账号限制。
 */

export const ETSY_LIMITS = {
  /** 标题最大字符数 */
  title: 140,
  /** tag 数量 */
  tagCount: 13,
  /** 单个 tag 最大字符数 */
  tagLength: 20,
  /** 描述最大字符数 */
  description: 13000,
  /** 描述中最多可用的图片数 */
  maxImages: 10,
} as const;

export const EBAY_LIMITS = {
  /** 标题最大字符数 */
  title: 80,
  /** 描述最大字符数 */
  description: 4000,
} as const;

/**
 * 禁用词表。
 *
 * 分两类：
 * 1. policy —— 显式情色词，平台与广告系统直接拒审
 * 2. risk —— 不违规但会带来搜索降权或审核风险的词（医疗宣称、
 *    贬义用语等）
 *
 * 这个检查跑在生成阶段而不是上架阶段 —— 上架后再发现下架一个 listing
 * 要 24-48 小时，代价远高于生成时多跑一次检查。
 */
export const BLOCKED_WORDS: { word: string; reason: string; severity: 'policy' | 'risk' }[] = [
  { word: 'nude', reason: '裸露描述，平台与广告系统直接拒审', severity: 'policy' },
  { word: 'naked', reason: '裸露描述，平台与广告系统直接拒审', severity: 'policy' },
  { word: 'topless', reason: '裸露描述，平台与广告系统直接拒审', severity: 'policy' },
  { word: 'porn', reason: '色情内容，政策类禁用', severity: 'policy' },
  { word: 'pornography', reason: '色情内容，政策类禁用', severity: 'policy' },
  { word: 'sex toy', reason: '成人用品类目，多数平台需预审批', severity: 'policy' },
  { word: 'sex toys', reason: '成人用品类目，多数平台需预审批', severity: 'policy' },
  { word: 'explicit', reason: '暗示露骨内容', severity: 'policy' },
  { word: 'xxx', reason: '暗示露骨内容', severity: 'policy' },
  { word: 'nsfw', reason: '暗示露骨内容，广告系统一律拒审', severity: 'policy' },
  { word: 'pornographic', reason: '色情内容，政策类禁用', severity: 'policy' },
  { word: 'erotic', reason: '情色语义，会触发成人内容分类', severity: 'risk' },
  { word: 'sexy', reason: 'Meta 广告系统对 sexy 高度敏感，多数情况直接拒审', severity: 'risk' },
  { word: 'orgasm', reason: '情色语义，会触发成人内容分类', severity: 'risk' },
  { word: 'cum', reason: '情色语义，会触发成人内容分类', severity: 'risk' },
  { word: 'bdsm', reason: '情色语义，会触发成人内容分类', severity: 'risk' },
  { word: 'fetish', reason: '情色语义，会触发成人内容分类', severity: 'risk' },
  { word: 'latex', reason: '材料词但强关联成人品类，建议换用其他材质描述', severity: 'risk' },
  { word: 'cure', reason: '医疗宣称，FTC 视为虚假广告', severity: 'policy' },
  { word: 'treats', reason: '医疗宣称，FTC 视为虚假广告', severity: 'policy' },
  { word: 'diagnose', reason: '医疗宣称，FTC 视为虚假广告', severity: 'policy' },
  { word: 'therapeutic', reason: '医疗宣称，FTC 视为虚假广告', severity: 'policy' },
];

/** 命中检查 */
export interface PolicyHit {
  word: string;
  reason: string;
  severity: 'policy' | 'risk';
}

export function checkText(text: string): PolicyHit[] {
  const lower = ` ${String(text || '').toLowerCase()} `;
  const hits: PolicyHit[] = [];
  for (const b of BLOCKED_WORDS) {
    // 用词边界匹配，避免 "cum" 命中 "cumulative" 之类的误报
    const re = new RegExp(`(?<![a-z])${b.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`, 'i');
    if (re.test(lower)) {
      hits.push({ word: b.word, reason: b.reason, severity: b.severity });
    }
  }
  return hits;
}

/** 截断到指定长度并清理尾部 */
export function clamp(text: string, max: number): string {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * 从材质字符串里提取一个有检索价值的 tag 关键词。
 *
 * 直接把 "82% Nylon, 18% Spandex" 截断会得到 "82 nylon" 这种没有
 * 搜索量的碎片。这里按消费者实际搜索的材质词匹配，优先级从高到低。
 */
const MATERIAL_KEYWORDS: { pattern: RegExp; tag: string }[] = [
  { pattern: /\blace\b/i, tag: 'lace' },
  { pattern: /\bsatin\b/i, tag: 'satin' },
  { pattern: /\bchiffon\b/i, tag: 'chiffon' },
  { pattern: /\bmesh\b/i, tag: 'mesh' },
  { pattern: /\bmodal\b/i, tag: 'modal' },
  { pattern: /\bcotton\b/i, tag: 'cotton' },
  { pattern: /\bacetate\b/i, tag: 'acetate' },
  { pattern: /\bpolyamide\b/i, tag: 'polyamide' },
  { pattern: /\bnylon\b/i, tag: 'nylon' },
  { pattern: /\bspandex\b/i, tag: 'spandex' },
  { pattern: /\belastane\b/i, tag: 'elastane' },
];

export function materialTag(material: string): string {
  for (const m of MATERIAL_KEYWORDS) {
    if (m.pattern.test(material)) return m.tag;
  }
  return '';
}

/**
 * Tag 专用截断：在单词边界切断，不加省略号。
 *
 * Etsy 会原样展示 tag，加了省略号既难看也损失检索词。
 * 如果切完只剩一个没有意义的碎片词，返回空串让调用方丢弃。
 */
export function clampTag(text: string, max: number): string {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  const result = (sp > 0 ? cut.slice(0, sp) : cut).trim();
  // 结果太短或没有字母数字组合就没有检索价值
  if (result.length < 4 || !/[a-z0-9]/i.test(result)) return '';
  return result;
}
