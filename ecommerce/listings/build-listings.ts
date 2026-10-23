import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PRODUCTS, COLLECTIONS } from '../data/catalog';
import { SIZE_CHARTS } from '../data/size-charts';
import { SITE } from '../data/site';
import type { Product } from '../data/types';
import { EBAY_LIMITS, ETSY_LIMITS, checkText, clamp, clampTag, materialTag, type PolicyHit } from './limits';

/**
 * 上架包生成器。
 *
 * 从同一份商品目录生成 Etsy 与 eBay 的上架物料，保证两个平台的
 * 信息一致（同一件衣服在两个平台说不同的材质或尺码 = 买家信任崩塌，
 * 也可能触发平台的一致性审核）。
 *
 * 用法：npx tsx ecommerce/listings/build-listings.ts
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'out');

/** 所有命中的敏感词（policy 级为阻断，risk 级为警告） */
const allHits = new Map<string, PolicyHit[]>();

function recordHits(key: string, text: string): void {
  const hits = checkText(text);
  if (hits.length) {
    const merged = allHits.get(key) ?? [];
    allHits.set(key, [...merged, ...hits]);
  }
}

// ── 尺码表文本（两个平台都要用） ────────────────────────
function sizeTableText(chartId: string): string {
  const chart = SIZE_CHARTS.find((c) => c.id === chartId);
  if (!chart) return '';
  const head = chart.columns.map((c) => c.label).join(' | ');
  const rows = chart.rows.map((r) =>
    chart.columns.map((c) => String((r as Record<string, unknown>)[c.key] ?? '—')).join(' | '),
  );
  return [`SIZING (body measurements)`, head, ...rows].join('\n');
}

// ── 描述正文（平台无关的母版） ──────────────────────────
function buildDescription(p: Product): string {
  const chart = SIZE_CHARTS.find((c) => c.id === p.sizeChartId)!;

  const parts: string[] = [];

  parts.push(p.description);
  parts.push('');
  parts.push('WHAT MAKES IT WORK');
  parts.push(p.highlights.map((h) => `• ${h}`).join('\n'));
  parts.push('');
  parts.push('DETAILS');
  parts.push(`• Material: ${p.attributes.material}`);
  parts.push(`• Color: ${p.attributes.color}`);
  parts.push(`• Closure: ${p.attributes.closure}`);
  parts.push(`• Pattern: ${p.attributes.pattern}`);
  parts.push(`• Origin: ${p.compliance.countryOfOrigin}`);
  parts.push(`• Care: ${p.compliance.careInstructions}`);
  parts.push('');
  parts.push('FIT & SIZING');
  parts.push(p.fitNote);
  parts.push(p.modelTryOn);
  parts.push('');
  parts.push(sizeTableText(chart.id));
  parts.push('');
  parts.push('Sizing tips:');
  parts.push(chart.tips.map((t) => `• ${t}`).join('\n'));
  parts.push('');
  parts.push('QUESTIONS WE GET A LOT');
  parts.push(p.faqs.map((f) => `Q: ${f.q}\nA: ${f.a}`).join('\n\n'));
  parts.push('');
  parts.push(
    `Shipping: We ship from ${SITE.fulfillmentState}. Orders are processed in ${SITE.processingTime} and typically arrive within ${SITE.deliveryTime}. Orders over $${SITE.freeShippingThreshold} ship free within the US.`,
  );
  parts.push('');
  parts.push(
    `Returns: We accept returns within ${SITE.returnWindowDays} days, unworn with tags attached, and return shipping is on us. If you need a different size, message us with your measurements and we will help.`,
  );
  parts.push('');
  parts.push(`${SITE.supportHours}. ${SITE.supportEmail}`);

  return parts.join('\n');
}

// ── Etsy ────────────────────────────────────────────────
interface EtsyListing {
  sku: string;
  title: string;
  description: string;
  price: number;
  quantity: number;
  whoItsFor: string;
  whenItsNeeded: string;
  occasion: string;
  style: string;
  department: string;
  tags: string[];
  materials: string;
  /** Etsy 的 collection 归属建议 */
  shopSection: string;
  /** 图片文件名（相对图片目录） */
  images: string[];
  primaryImage: string;
}

function buildEtsy(p: Product): EtsyListing {
  const collection = COLLECTIONS.find((c) => c.id === p.collection)!;

  // 标题：集合关键词 + 核心属性 + 场景 + 材质，控制在 140 字符内。
  // 前 40 字符是 Etsy 搜索结果里唯一可见的部分，所以最关键的信息必须前置。
  const title = clamp(
    [
      p.title,
      p.attributes.color,
      p.attributes.pattern,
      collection.title,
      p.attributes.material.split(';')[0].split(' with ')[0],
      p.attributes.closure.split(';')[0],
    ].join(' | '),
    ETSY_LIMITS.title,
  );

  // tag 去重 + 按词边界截断 + 数量限制
  const rawTags = [
    ...p.etsyAttributes.tags,
    ...p.seo.keywords,
    collection.title.toLowerCase(),
    p.attributes.color.toLowerCase(),
    materialTag(p.attributes.material),
    p.attributes.pattern.toLowerCase(),
  ];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const t of rawTags) {
    const cleaned = clampTag(t.toLowerCase().replace(/[^\w\s&-]/g, '').trim(), ETSY_LIMITS.tagLength);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    tags.push(cleaned);
    if (tags.length >= ETSY_LIMITS.tagCount) break;
  }

  const description = clamp(buildDescription(p), ETSY_LIMITS.description);
  const images = p.shots.map((s) => `${p.slug}-${s.id}.jpg`);

  recordHits(`Etsy/${p.sku}/title`, title);
  recordHits(`Etsy/${p.sku}/description`, description);
  recordHits(`Etsy/${p.sku}/tags`, tags.join(' '));

  return {
    sku: p.sku,
    title,
    description,
    price: p.price,
    quantity: p.economics.initialQty,
    whoItsFor: p.etsyAttributes.whoItsFor,
    whenItsNeeded: p.etsyAttributes.whenItsNeeded,
    occasion: p.etsyAttributes.occasion,
    style: p.etsyAttributes.style,
    department: p.etsyAttributes.department,
    tags,
    materials: p.attributes.material,
    shopSection: collection.title,
    images,
    primaryImage: images[0],
  };
}

// ── eBay ────────────────────────────────────────────────
interface EbayListing {
  sku: string;
  title: string;
  description: string;
  price: number;
  quantity: number;
  condition: string;
  itemSpecifics: Record<string, string>;
  /** 商品详情（eBay specifics 的固定结构） */
  details: { title: string; description: string }[];
  images: string[];
  primaryImage: string;
  shipping: {
    service: string;
    cost: number;
    handlingDays: number;
    shipsFrom: string;
  };
}

function buildEbay(p: Product): EbayListing {
  const collection = COLLECTIONS.find((c) => c.id === p.collection)!;

  // eBay 标题 80 字符，比 Etsy 紧得多 —— 只保留最高价值的信息
  const title = clamp(
    [p.title, p.attributes.color, collection.title].join(' | '),
    EBAY_LIMITS.title,
  );

  const description = clamp(buildDescription(p), EBAY_LIMITS.description);
  const images = p.shots.map((s) => `${p.slug}-${s.id}.jpg`);

  recordHits(`eBay/${p.sku}/title`, title);
  recordHits(`eBay/${p.sku}/description`, description);

  return {
    sku: p.sku,
    title,
    description,
    price: p.price,
    quantity: p.economics.initialQty,
    condition: 'New with tags',
    itemSpecifics: { ...p.ebaySpecifics, 'Country/Region of Manufacture': p.compliance.countryOfOrigin },
    details: [
      { title: 'Material', description: p.attributes.material },
      { title: 'Color', description: p.attributes.color },
      { title: 'Closure', description: p.attributes.closure },
      { title: 'Pattern', description: p.attributes.pattern },
      { title: 'Fit note', description: p.fitNote },
      { title: 'Model details', description: p.modelTryOn },
      { title: 'Care instructions', description: p.compliance.careInstructions },
    ],
    images,
    primaryImage: images[0],
    shipping: {
      service: 'USPS Ground Advantage',
      cost: p.price >= SITE.freeShippingThreshold ? 0 : SITE.flatShippingRate,
      handlingDays: 2,
      shipsFrom: SITE.fulfillmentState,
    },
  };
}

// ── 输出 ────────────────────────────────────────────────
function csvEscape(v: string): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Record<string, string | number | string[]>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(
      headers.map((h) => {
        const v = r[h];
        return csvEscape(Array.isArray(v) ? v.join(', ') : v);
      }).join(','),
    );
  }
  return lines.join('\n');
}

function main(): void {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(join(OUT, 'etsy'), { recursive: true });
  mkdirSync(join(OUT, 'ebay'), { recursive: true });

  const etsyListings = PRODUCTS.map(buildEtsy);
  const ebayListings = PRODUCTS.map(buildEbay);

  // 单品 JSON（便于人工微调后回灌）
  for (const l of etsyListings) {
    writeFileSync(join(OUT, 'etsy', `${l.sku}.json`), JSON.stringify(l, null, 2), 'utf8');
  }
  for (const l of ebayListings) {
    writeFileSync(join(OUT, 'ebay', `${l.sku}.json`), JSON.stringify(l, null, 2), 'utf8');
  }

  // 批量 CSV
  writeFileSync(
    join(OUT, 'etsy', 'bulk-listings.csv'),
    toCsv(
      etsyListings.map((l) => ({
        SKU: l.sku,
        Title: l.title,
        Description: l.description,
        Price: l.price,
        Quantity: l.quantity,
        'Who it is for': l.whoItsFor,
        'When it is needed': l.whenItsNeeded,
        Occasion: l.occasion,
        Style: l.style,
        Department: l.department,
        Tags: l.tags,
        Materials: l.materials,
        'Shop section': l.shopSection,
        'Primary image': l.primaryImage,
        'Additional images': l.images.slice(1),
      })),
    ),
    'utf8',
  );

  writeFileSync(
    join(OUT, 'ebay', 'bulk-listings.csv'),
    toCsv(
      ebayListings.map((l) => ({
        SKU: l.sku,
        Title: l.title,
        Description: l.description,
        Price: l.price,
        Quantity: l.quantity,
        Condition: l.condition,
        'Item specifics': l.itemSpecifics,
        'Primary image': l.primaryImage,
        'Additional images': l.images.slice(1),
        'Shipping service': l.shipping.service,
        'Shipping cost': l.shipping.cost,
        'Handling days': l.shipping.handlingDays,
        'Ships from': l.shipping.shipsFrom,
      })),
    ),
    'utf8',
  );

  // ── 报告 ────────────────────────────────────────────
  console.log('\n[标题长度检查]');
  for (const l of etsyListings) {
    const okLen = l.title.length <= ETSY_LIMITS.title;
    console.log(`  ${okLen ? '✓' : '✗'} Etsy ${l.sku}: ${l.title.length}/${ETSY_LIMITS.title}`);
  }
  for (const l of ebayListings) {
    const okLen = l.title.length <= EBAY_LIMITS.title;
    console.log(`  ${okLen ? '✓' : '✗'} eBay ${l.sku}: ${l.title.length}/${EBAY_LIMITS.title}`);
  }

  console.log('\n[Tag 检查]');
  for (const l of etsyListings) {
    const countOk = l.tags.length === ETSY_LIMITS.tagCount;
    const lenOk = l.tags.every((t) => t.length <= ETSY_LIMITS.tagLength);
    console.log(`  ${countOk && lenOk ? '✓' : '✗'} ${l.sku}: ${l.tags.length} tags, 最长 ${Math.max(...l.tags.map((t) => t.length))} 字符`);
  }

  console.log('\n[敏感词检查]');
  let policyCount = 0;
  let riskCount = 0;
  for (const [key, hits] of allHits) {
    const policy = hits.filter((h) => h.severity === 'policy');
    const risk = hits.filter((h) => h.severity === 'risk');
    policyCount += policy.length;
    riskCount += risk.length;
    for (const h of hits) {
      console.log(`  ${h.severity === 'policy' ? '✗' : '!'} ${key}: "${h.word}" — ${h.reason}`);
    }
  }
  if (!allHits.size) console.log('  ✓ 未命中任何敏感词');

  console.log(`\n${'─'.repeat(52)}`);
  console.log(`Etsy ${etsyListings.length} 个 / eBay ${ebayListings.length} 个上架包 → ${OUT}`);
  console.log(`阻断级命中 ${policyCount} 个，风险级 ${riskCount} 个`);
  console.log(`${'─'.repeat(52)}\n`);

  if (policyCount > 0) process.exit(1);
}

main();
