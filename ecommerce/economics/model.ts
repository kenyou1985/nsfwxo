/**
 * 单件经济模型与选品决策工具。
 *
 * 这个工具是本方案的选品门槛。方案里写的是"低于门槛不上"，
 * 这里把那个数字算出来，并让它可复算 —— 任何一次调价、换供应商、
 * 改物流方案之后，重跑一次就知道哪些 SKU 掉出门槛了。
 *
 * 成本口径（重要）：
 * 2025-08-29 起美国对所有国家取消 $800 de minimis 免税额，
 * 中国原产商品还要叠加 Section 301 清单税。因此直发小包模式下
 * 每单都要单独缴税 + 报关，规模化之后必须走"批量头程 + 海外仓"。
 * 这个模型算的就是海外仓模式的到岸成本。
 *
 * 口径约定（避免重复计算，最容易出错的地方）：
 * - 支付费：在 Etsy/eBay 上，平台自带的支付（Etsy Payments / eBay
 *   Managed Payments）就是收单通道，不能再叠加第三方网关费率。
 *   只有独立站直客才需要单独的支付网关。
 * - 运费：Etsy 上买家通常单独付运费，只有超过免邮门槛的商品才需要
 *   卖家承担。模型按 SITE.freeShippingThreshold 处理。
 * - 清关与 MPF：按整批货物的票数分摊，不是每个 SKU 一票。
 */

import { PRODUCTS } from '../data/catalog';
import { SITE } from '../data/site';
import type { Product } from '../data/types';

/**
 * 成本假设。
 * 每一项都标注了依据与调整方法 —— 上线前用真实报价替换即可，
 * 模型会立刻反映变化。
 */
export const ASSUMPTIONS = {
  /** 人民币兑美元汇率 */
  fxRate: 7.2,

  /** 包装重量系数（内外包装 + 缓冲） */
  packagingFactor: 1.15,

  /**
   * 关税：
   * - MFN：HS 6208（女式针织内衣）最惠国税率，按 8.5% 计
   * - Section 301：中国原产叠加 25%（清单三/四 A）
   * 注意：美国关税以商品申报价值为基数，不含运费。
   */
  mfnDutyRate: 0.085,
  section301Rate: 0.25,

  /** 头程空运到美国，单位 USD/kg（按重货与泡货取均值） */
  freightPerKgUsd: 5.2,

  /** 每票覆盖件数（用于计算票数与分摊） */
  unitsPerShipment: 300,
  /** 目的港清关与分拨费（每票） */
  clearancePerShipmentUsd: 260,
  /** MPF 货物处理费（每票，按申报价值 0.3464%，最低 $31.71） */
  mpfRate: 0.003464,
  mpfMinUsd: 31.71,
  mpfMaxUsd: 614.35,

  /** 海外仓入库上架（每件） */
  receivingPerUnitUsd: 0.35,
  /** 拣货 + 打包 + 贴标（每单） */
  pickPackUsd: 1.45,
  /** 仓储费（每件每月） */
  storagePerUnitMonthUsd: 0.12,
  /** 按多少个月周转计仓储（首批备货的保守估计） */
  storageMonths: 3,

  /** 美国境内尾程派送（USPS Ground Advantage，按件均重估算） */
  outboundShippingUsd: 5.6,

  /**
   * 独立站直客的支付通道费率（本品类大概率用不了 Stripe，
   * 因为其政策把 sexually oriented items 列入禁售）。
   */
  directPaymentRate: 0.07,
  directPaymentFixedUsd: 0.3,

  /** 退货率（本类目行业普遍 20%+，压到 10% 是尺码表的目标） */
  returnRate: 0.1,
  /** 退回件的退货运费成本 */
  returnLabelUsd: 5.6,
  /** 已拆封退货中可二次销售的比例（其余按不可售处理） */
  restockRate: 0.7,
  /** 可二次销售商品的可回收价值比例 */
  recoverValueRate: 0.5,

  /** Etsy 平台费 */
  etsyTransactionRate: 0.065,
  etsyListingFeeUsd: 0.2,
  /** Etsy Payments —— 这就是 Etsy 上的收单通道，不再叠加第三方网关 */
  etsyPaymentRate: 0.03,
  etsyPaymentFixedUsd: 0.25,
  /** Offsite Ads 抽成（新卖家常被推荐加入，是流量成本的一部分） */
  etsyOffsiteAdsRate: 0.15,

  /** eBay 平台费 */
  ebayFinalValueRate: 0.136,
  ebayFixedUsd: 0.3,

  /**
   * 选品门槛：
   * - 到岸毛利门槛 $18：对应方案里"低于 $18 毛利的 SKU 直接不上"。
   *   口径 = 售价 - 到岸成本（采购 + 关税 + 头程 + 清关 + 入库），
   *   尚未扣除平台抽成与广告。方案里的 $20-24 毛利、45-50% 毛利率
   *   就是这个口径。
   * - 贡献毛利门槛 $8：扣完履约、支付、平台抽成、广告与退货损耗后的
   *   净贡献底线。这个数是"还值不值得继续投流量"的判断线。
   */
  minLandedMarginUsd: 18,
  minContributionUsd: 8,
} as const;

/** 销售渠道 */
export type Channel = 'etsy' | 'ebay' | 'direct';

export interface UnitCost {
  sku: string;
  title: string;
  priceUsd: number;
  /** 采购成本 */
  purchaseUsd: number;
  /** 关税 */
  dutyUsd: number;
  /** 头程分摊 */
  freightUsd: number;
  /** 清关 + MPF 分摊 */
  clearanceUsd: number;
  /** 海外仓入库 */
  receivingUsd: number;
  /** 到岸成本合计 */
  landedUsd: number;
  /** 到岸毛利 = 售价 - 到岸成本（未扣履约与平台费） */
  landedMarginUsd: number;
  /** 尾程派送（卖家承担部分） */
  outboundUsd: number;
  /** 拣货打包 */
  pickPackUsd: number;
  /** 仓储 */
  storageUsd: number;
  /** 支付费 */
  paymentUsd: number;
  /** 平台费（含广告） */
  platformFeeUsd: number;
  /** 退货损耗摊销 */
  returnCostUsd: number;
  /** 贡献毛利（全成本后） */
  contributionUsd: number;
  contributionMargin: number;
  passes: boolean;
}

/** 计算一件商品的计费重量 */
export function billableWeight(product: Product): number {
  return product.economics.weightKg * ASSUMPTIONS.packagingFactor;
}

/**
 * 整批货物的到岸成本分摊。
 *
 * 关键：清关与 MPF 是按票（shipment）发生的，不是按 SKU。
 * 首版模型按 SKU 单独算票，会把清关费放大到接近实际的两倍。
 */
export interface BatchPlan {
  totalUnits: number;
  shipments: number;
  totalWeightKg: number;
  totalFreightUsd: number;
  totalClearanceUsd: number;
  /** 每件摊到的清关费 */
  clearancePerUnitUsd: number;
  /** 每 kg 摊到的头程费 */
  freightPerKgUsd: number;
}

export function buildBatchPlan(products: Product[] = PRODUCTS): BatchPlan {
  const A = ASSUMPTIONS;
  const totalUnits = products.reduce((s, p) => s + p.economics.initialQty, 0);
  const shipments = Math.max(1, Math.ceil(totalUnits / A.unitsPerShipment));
  const totalWeightKg = products.reduce(
    (s, p) => s + billableWeight(p) * p.economics.initialQty,
    0,
  );
  const totalGoodsUsd = products.reduce(
    (s, p) => s + (p.economics.costCny / A.fxRate) * p.economics.initialQty,
    0,
  );

  const totalFreightUsd = totalWeightKg * A.freightPerKgUsd;

  // MPF 按票计：申报价值 = 该票货值
  const perShipmentValue = totalGoodsUsd / shipments;
  const mpfPerShipment = Math.min(
    A.mpfMaxUsd,
    Math.max(A.mpfMinUsd, perShipmentValue * A.mpfRate),
  );
  const totalClearanceUsd = shipments * (A.clearancePerShipmentUsd + mpfPerShipment);

  return {
    totalUnits,
    shipments,
    totalWeightKg,
    totalFreightUsd,
    totalClearanceUsd,
    clearancePerUnitUsd: totalClearanceUsd / totalUnits,
    freightPerKgUsd: A.freightPerKgUsd,
  };
}

/** 计算一个 SKU 的单件成本 */
export function unitCost(
  product: Product,
  plan: BatchPlan,
  channel: Channel = 'etsy',
): UnitCost {
  const A = ASSUMPTIONS;
  const purchaseUsd = product.economics.costCny / A.fxRate;
  const dutyUsd = purchaseUsd * (A.mfnDutyRate + A.section301Rate);

  const weightKg = billableWeight(product);
  const freightUsd = weightKg * plan.freightPerKgUsd;
  const clearanceUsd = plan.clearancePerUnitUsd;
  const receivingUsd = A.receivingPerUnitUsd;

  const landedUsd = purchaseUsd + dutyUsd + freightUsd + clearanceUsd + receivingUsd;
  const landedMarginUsd = product.price - landedUsd;

  // 尾程：超过免邮门槛由卖家承担，否则买家单独付运费
  const sellerPaysShipping = product.price >= SITE.freeShippingThreshold;
  const outboundUsd = sellerPaysShipping ? A.outboundShippingUsd : 0;

  const pickPackUsd = A.pickPackUsd;
  const storageUsd = A.storagePerUnitMonthUsd * A.storageMonths;

  // 支付与平台费：按渠道区分，避免重复计费
  let paymentUsd = 0;
  let platformFeeUsd = 0;
  if (channel === 'etsy') {
    // Etsy Payments 就是收单通道
    paymentUsd = product.price * A.etsyPaymentRate + A.etsyPaymentFixedUsd;
    platformFeeUsd =
      product.price * A.etsyTransactionRate +
      product.price * A.etsyOffsiteAdsRate +
      A.etsyListingFeeUsd;
  } else if (channel === 'ebay') {
    // eBay Managed Payments 包含在最终价值费里
    paymentUsd = 0;
    platformFeeUsd = product.price * A.ebayFinalValueRate + A.ebayFixedUsd;
  } else {
    // 独立站：需要第三方成人品类网关，无平台抽成
    paymentUsd = product.price * A.directPaymentRate + A.directPaymentFixedUsd;
    platformFeeUsd = 0;
  }

  // 退货损耗：退货运费全额损失 + 不可二次销售部分的货值损失
  const returnCostUsd =
    A.returnRate *
    (A.returnLabelUsd + (1 - A.restockRate) * (1 - A.recoverValueRate) * landedUsd);

  const contributionUsd =
    product.price -
    landedUsd -
    outboundUsd -
    pickPackUsd -
    storageUsd -
    paymentUsd -
    platformFeeUsd -
    returnCostUsd;

  return {
    sku: product.sku,
    title: product.title,
    priceUsd: product.price,
    purchaseUsd,
    dutyUsd,
    freightUsd,
    clearanceUsd,
    receivingUsd,
    landedUsd,
    landedMarginUsd,
    outboundUsd,
    pickPackUsd,
    storageUsd,
    paymentUsd,
    platformFeeUsd,
    returnCostUsd,
    contributionUsd,
    contributionMargin: product.price > 0 ? contributionUsd / product.price : 0,
    passes:
      landedMarginUsd >= A.minLandedMarginUsd && contributionUsd >= A.minContributionUsd,
  };
}

/** 批量计算 */
export function costTable(
  products: Product[] = PRODUCTS,
  channel: Channel = 'etsy',
): UnitCost[] {
  const plan = buildBatchPlan(products);
  return products.map((p) => unitCost(p, plan, channel));
}

/** 首单采购预算 */
export function initialBudget(products: Product[] = PRODUCTS): {
  purchaseCny: number;
  purchaseUsd: number;
  dutyUsd: number;
  freightUsd: number;
  clearanceUsd: number;
  units: number;
  shipments: number;
} {
  const A = ASSUMPTIONS;
  const plan = buildBatchPlan(products);
  const totals = purchaseTotals(products);

  return {
    purchaseCny: totals.totalCny,
    purchaseUsd: totals.totalUsd,
    dutyUsd: totals.totalUsd * (A.mfnDutyRate + A.section301Rate),
    freightUsd: plan.totalFreightUsd,
    clearanceUsd: plan.totalClearanceUsd,
    units: plan.totalUnits,
    shipments: plan.shipments,
  };
}

/** 采购汇总 */
export function purchaseTotals(products: Product[] = PRODUCTS): {
  totalCny: number;
  totalUsd: number;
  totalUnits: number;
} {
  let totalCny = 0;
  let totalUnits = 0;
  for (const p of products) {
    totalCny += p.economics.costCny * p.economics.initialQty;
    totalUnits += p.economics.initialQty;
  }
  return { totalCny, totalUsd: totalCny / ASSUMPTIONS.fxRate, totalUnits };
}
