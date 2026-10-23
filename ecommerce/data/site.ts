/**
 * 站点级配置。
 *
 * 主体、域名、收款通道落地后，需要改动的地方都集中在这里，
 * 避免散落在各个页面模板里。
 */
export const SITE = {
  /** 生产域名（占位，上线前替换） */
  domain: 'lumencie.com',
  /**
   * 带协议的站点根 URL。
   * 必须与 domain 分开：canonical / og:url / sitemap 的 <loc> 都要求
   * 绝对 URL，缺少协议会导致搜索引擎整站忽略。
   */
  baseUrl: 'https://lumencie.com',
  /** 品牌名 */
  brand: 'LUMENCIE',
  /** 品牌的一句话定位 */
  tagline: 'Elevated intimates, made to be worn out',
  /** 首页 meta description（需 ≤160 字符，SERP 会截断） */
  metaDescription:
    'Lingerie with real coverage, soft fabric, and details that work outside the bedroom. Halloween intimates, couples gifts, sleepwear, plus size, and bridal.',
  /** 面向买家的品牌介绍（出现在 About 与 footer） */
  about:
    'LUMENCIE makes lingerie that works in real life. Every piece is designed with coverage you can trust, fabric you can sleep in, and details you can wear out — whether that is a Halloween party, a wedding day, or an ordinary Tuesday.',
  /** 客服邮箱 */
  supportEmail: 'care@lumencie.com',
  /** 客服时区标注，24 小时内回复 */
  supportHours: 'Support replies within 24 hours, every day of the week',
  /** 运营所在州（用于退货地址与条款） */
  operatingState: 'Delaware',
  /** 运营主体占位，上线前替换 */
  legalEntity: 'LUMENCIE LLC',
  /** 发货仓所在州（海外仓所在地） */
  fulfillmentState: 'New Jersey',
  /** 运费策略：满额免运费门槛（美元），null 表示不提供免邮 */
  freeShippingThreshold: 59,
  /** 平邮基础运费（美元） */
  flatShippingRate: 5.99,
  /** 订单处理时效 */
  processingTime: '1-2 business days',
  /** 配送时效 */
  deliveryTime: '2-4 business days after dispatch',
  /** 退换货窗口（天） */
  returnWindowDays: 30,
  /** 是否允许换货 */
  allowExchanges: true,
  /** 首单折扣码（用于邮件捕获） */
  welcomeDiscount: 'WELCOME15',
  /** 邮件捕获表单文案 */
  newsletterPitch:
    'Join the list for first access to new styles, restock alerts, and 15% off your first order.',
  /** 主要投放州（geo-targeting 用，US 州代码） */
  targetStates: ['CA', 'NY', 'TX', 'FL', 'IL'],
  /**
   * 不开通配送的市场（ISO 国家代码）。
   * 注意：这里的 CA 指加拿大，与上面的 CA（加利福尼亚州）是两回事，
   * 因此用 ISO 代码以避免歧义。
   */
  excludedCountries: ['CA', 'GB', 'AU'],
  /** 商品图根路径 */
  imageBase: '/img/products',
} as const;

/** 商品图输出目录（相对 public/） */
export const IMAGE_DIR = '/img/products';

/** 站点导航 */
export const NAV = [
  { href: '/collections/halloween-costumes', label: 'Halloween' },
  { href: '/collections/couples-gifts', label: 'Couples Gifts' },
  { href: '/collections/lounge-sleepwear', label: 'Lounge' },
  { href: '/collections/plus-size', label: 'Plus Size' },
  { href: '/collections/bridal', label: 'Bridal' },
  { href: '/guides/size-guide', label: 'Size Guide' },
  { href: '/guides/gift-guide', label: 'Gift Guide' },
] as const;
