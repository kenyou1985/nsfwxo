/**
 * 情趣内衣跨境业务的数据层类型定义。
 *
 * 这套类型是"单一事实来源"：独立站静态页、Etsy/eBay 上架包、AI 商品图提示词
 * 三者都从 catalog.ts 派生，避免三处维护导致 SKU 信息不一致。
 */

/** 集合（场景导向，对应 Etsy 的 collection 与独立站的 /collections/ 路径） */
export type CollectionId =
  | 'halloween-costumes'
  | 'couples-gifts'
  | 'lounge-sleepwear'
  | 'plus-size'
  | 'bridal';

/** 商品主图与场景图的拍摄角度定义 */
export type ShotAngle =
  | 'hero-front'
  | 'hero-three-quarter'
  | 'detail-fabric'
  | 'detail-hardware'
  | 'flat-lay'
  | 'on-body-seated'
  | 'on-body-standing'
  | 'gift-packaging';

/** 商品图片镜头定义 */
export interface ProductShot {
  /** 稳定标识，用于文件名与上架包引用 */
  id: string;
  angle: ShotAngle;
  /** 构图补充描述（姿态、镜头焦段、背景） */
  brief: string;
  /**
   * 是否以已生成的主图为参考做图生图。
   * true = 复用同一模特的参考图，保证多角度是同一个人、同一件衣服。
   */
  useReference: boolean;
}

/** 用于生成商品图的虚构模特设定（刻意不指向任何真实人物） */
export interface ModelDescriptor {
  id: string;
  /** 英文描述，直接拼进提示词 */
  brief: string;
}

/** FAQ：同时用于商品页渲染与 FAQPage 结构化数据 */
export interface FaqItem {
  q: string;
  a: string;
}

/** 单件商品的落地成本与成本结构（用于选品决策与毛利看板） */
export interface UnitEconomics {
  /** 1688 采购价（人民币） */
  costCny: number;
  /** 单件重量（kg），用于分摊头程与关税 */
  weightKg: number;
  /** 首批采购量 */
  initialQty: number;
}

/** 合规信息：生成 FTC 标签与各州警告所需的字段 */
export interface ComplianceInfo {
  /** 纤维成分标注（FTC 要求） */
  fiberContent: string;
  /** 原产国 */
  countryOfOrigin: string;
  /** RN 号码（美国责任方编号），待主体落地后回填 */
  rnNumber: string;
  /** 是否需要加州 Prop 65 警告 */
  prop65Warning: boolean;
  /** 是否属于 CPSC 16 CFR 1610 管控的宽松服装（薄睡衣） */
  cpscLooseGarment: boolean;
  /** 洗护标签文字 */
  careInstructions: string;
}

/** 商品 */
export interface Product {
  sku: string;
  slug: string;
  /** 面向买家的商品标题（不含敏感词，可直接用于平台） */
  title: string;
  /** 副标题：一句定位语，用于卡片与 SEO */
  subtitle: string;
  price: number;
  compareAtPrice?: number;
  collection: CollectionId;
  /** 简短描述（卡片、meta description 兜底） */
  summary: string;
  /** 详情页正文，纯文本，段落用 \n\n 分隔 */
  description: string;
  /** 卖点列表（详情页 bullet） */
  highlights: string[];
  /** 结构化属性 */
  attributes: {
    material: string;
    color: string;
    closure: string;
    pattern: string;
    features: string[];
  };
  /** 该商品使用的尺码表 id */
  sizeChartId: string;
  /** 实际可售尺码 */
  sizes: string[];
  /** 版型说明（详情页固定展示） */
  fitNote: string;
  /** 模特试穿信息（详情页固定展示，压退货率的关键） */
  modelTryOn: string;
  /** SEO 字段 */
  seo: {
    title: string;
    description: string;
    keywords: string[];
  };
  /** GEO 字段：AI 购物代理常问的问题 */
  faqs: FaqItem[];
  /** 图片镜头清单 */
  shots: ProductShot[];
  /** 商品图提示词所需的服装外观描述 */
  garmentBrief: string;
  /** 该商品默认使用的虚构模特 */
  modelId: string;
  economics: UnitEconomics;
  compliance: ComplianceInfo;
  /** Etsy 上架专用：人群 / 场合 / 风格等属性 */
  etsyAttributes: {
    whoItsFor: string;
    whenItsNeeded: string;
    occasion: string;
    style: string;
    department: string;
    /** 13 个 tag，每个不超过 20 字符 */
    tags: string[];
  };
  /** eBay 上架专用：item specifics */
  ebaySpecifics: Record<string, string>;
}

/** 集合定义 */
export interface Collection {
  id: CollectionId;
  slug: string;
  title: string;
  description: string;
  seoDescription: string;
  /** 集合页主图（相对路径，由图片流水线产出） */
  heroImage: string;
}

/** 尺码表 */
export interface SizeRow {
  label: string;
  /** 英制下胸围（英寸），仅文胸/有钢圈款使用 */
  underbust?: string;
  /** 英制胸围 */
  bust?: string;
  /** 英制腰围 */
  waist?: string;
  /** 英制臀围 */
  hip?: string;
  /** 建议体重区间（磅） */
  weightLbs?: string;
  /** 等同于普通服装尺码的说明，便于买家理解 */
  equivalent: string;
}

export interface SizeChart {
  id: string;
  title: string;
  intro: string;
  /** 表格列名，顺序即渲染顺序 */
  columns: { key: keyof SizeRow; label: string }[];
  rows: SizeRow[];
  /** 选码提示 */
  tips: string[];
  /** 尺码推荐算法用的测量项 */
  measures: { key: 'bust' | 'waist' | 'hip' | 'underbust'; label: string; unit: string }[];
}

/** 指南文章（SEO/GEO 内容资产） */
export interface Guide {
  slug: string;
  title: string;
  description: string;
  /** 正文段落，支持 ## 小标题与 - 列表行 */
  body: string;
  faqs: FaqItem[];
  /** 相关文章 */
  related: string[];
}

/** 站点级政策（退换、隐私、条款、年龄验证） */
export interface Policy {
  slug: string;
  title: string;
  description: string;
  updated: string;
  sections: { heading: string; body: string }[];
}
