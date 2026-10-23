/**
 * 成本看板 CLI。
 *
 * 用法：
 *   npx tsx ecommerce/economics/report.ts               # Etsy
 *   npx tsx ecommerce/economics/report.ts --channel=ebay
 *   npx tsx ecommerce/economics/report.ts --channel=direct
 *   npx tsx ecommerce/economics/report.ts --channel=all  # 三渠道对比
 */
import { PRODUCTS } from '../data/catalog';
import { SITE } from '../data/site';
import { ASSUMPTIONS, costTable, initialBudget, type Channel } from './model';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
}

const usd = (n: number): string => `$${n.toFixed(2)}`;
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

const CHANNEL_LABEL: Record<Channel, string> = {
  etsy: 'Etsy（含 Offsite Ads 15%）',
  ebay: 'eBay',
  direct: '独立站直客',
};

function printTable(channel: Channel): void {
  const rows = costTable(PRODUCTS, channel);
  console.log(`\n  ── ${CHANNEL_LABEL[channel]} ${'─'.repeat(72)}`);
  console.log(
    'SKU'.padEnd(14) +
      '售价'.padStart(8) +
      '采购'.padStart(8) +
      '关税'.padStart(8) +
      '头程'.padStart(8) +
      '清关'.padStart(8) +
      '到岸'.padStart(8) +
      '到岸毛利'.padStart(10) +
      '尾程'.padStart(8) +
      '平台'.padStart(8) +
      '毛利'.padStart(9) +
      '率'.padStart(8),
  );
  console.log('  ' + '─'.repeat(108));

  for (const r of rows) {
    const line =
      r.sku.padEnd(14) +
      usd(r.priceUsd).padStart(8) +
      usd(r.purchaseUsd).padStart(8) +
      usd(r.dutyUsd).padStart(8) +
      usd(r.freightUsd).padStart(8) +
      usd(r.clearanceUsd).padStart(8) +
      usd(r.landedUsd).padStart(8) +
      usd(r.landedMarginUsd).padStart(10) +
      usd(r.outboundUsd).padStart(8) +
      usd(r.platformFeeUsd).padStart(8) +
      usd(r.contributionUsd).padStart(9) +
      pct(r.contributionMargin).padStart(8);
    console.log('  ' + (r.passes ? line : `✗ ${line.slice(2)}`));
  }

  const failing = rows.filter((r) => !r.passes);
  const avgContribution = rows.reduce((s, r) => s + r.contributionUsd, 0) / rows.length;
  const avgMargin = rows.reduce((s, r) => s + r.contributionMargin, 0) / rows.length;
  console.log('  ' + '─'.repeat(108));
  console.log(
    `  平均单件贡献毛利 ${usd(avgContribution)}（${pct(avgMargin)}）` +
      `  门槛 ${usd(ASSUMPTIONS.minContributionUsd)}` +
      `  未达标 ${failing.length}/${rows.length}`,
  );
  return failing.length;
}

function main(): void {
  const channel = arg('channel', 'etsy') as Channel | 'all';

  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  单件经济模型 — 情趣内衣跨境（美国）');
  console.log('══════════════════════════════════════════════════════════════════');

  if (channel === 'all') {
    console.log('\n  三渠道对比：平台抽成与广告成本是差异来源，\n  独立站单件贡献毛利显著高于平台 —— 这正是"平台获客、独立站变现"的量化依据。');
    printTable('etsy');
    printTable('ebay');
    printTable('direct');
  } else {
    printTable(channel);
  }

  // ── 首单预算 ──────────────────────────────────────────
  const b = initialBudget(PRODUCTS);
  console.log('\n  首单采购预算');
  console.log('  ' + '─'.repeat(56));
  console.log(`  SKU 数量            ${PRODUCTS.length} 个`);
  console.log(`  总件数              ${b.units} 件`);
  console.log(`  发运票数            ${b.shipments} 票（每票约 ${ASSUMPTIONS.unitsPerShipment} 件）`);
  console.log(`  采购（1688）        ¥${b.purchaseCny.toLocaleString()}  ≈ ${usd(b.purchaseUsd)}`);
  console.log(`  关税 33.5%          ${usd(b.dutyUsd)}`);
  console.log(`  头程空运            ${usd(b.freightUsd)}`);
  console.log(`  清关 + MPF          ${usd(b.clearanceUsd)}`);
  console.log(`  ${'─'.repeat(52)}`);
  const landed = b.purchaseUsd + b.dutyUsd + b.freightUsd + b.clearanceUsd;
  console.log(`  到岸合计            ${usd(landed)}  ≈ ¥${(landed * ASSUMPTIONS.fxRate).toLocaleString()}`);

  // ── 关键假设 ──────────────────────────────────────────
  console.log('\n  关键假设（上线前用真实报价替换）');
  console.log('  ' + '─'.repeat(56));
  console.log(`  汇率                ${ASSUMPTIONS.fxRate}`);
  console.log(
    `  关税                MFN ${pct(ASSUMPTIONS.mfnDutyRate)} + Section 301 ${pct(ASSUMPTIONS.section301Rate)} = ${pct(ASSUMPTIONS.mfnDutyRate + ASSUMPTIONS.section301Rate)}`,
  );
  console.log(`  头程                ${usd(ASSUMPTIONS.freightPerKgUsd)}/kg 空运`);
  console.log(`  尾程                ${usd(ASSUMPTIONS.outboundShippingUsd)}/件（售价 ≥ $${SITE.freeShippingThreshold} 时由卖家承担）`);
  console.log(`  独立站支付费率      ${pct(ASSUMPTIONS.directPaymentRate)} + ${usd(ASSUMPTIONS.directPaymentFixedUsd)}（第三方网关口径）`);
  console.log(`  退货率              ${pct(ASSUMPTIONS.returnRate)}`);
  console.log(`  免邮门槛            $${SITE.freeShippingThreshold}`);
  console.log('');
  console.log('  两个能立刻改善毛利的杠杆：');
  console.log('  1) 拿到 Stripe 通道 → 独立站支付费率降到 2.9% + $0.30，单件多赚 $4-5');
  console.log('  2) 售价上调 $5-8 → 直接等比例增厚贡献毛利（先验证转化率能否接受）');
  console.log('');
}

main();
