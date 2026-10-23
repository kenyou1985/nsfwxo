/**
 * 静态站点生成器。
 *
 * 用法：
 *   npx tsx ecommerce/build/build-site.ts            # 输出到 ecommerce/dist
 *   npx tsx ecommerce/build/build-site.ts --out=public/storefront
 *
 * 设计取舍：不引入框架。产物是纯静态 HTML + CSS + 图片，
 * 可直接部署到任意静态托管（Cloudflare Pages / Netlify / S3+CDN / Vercel），
 * 且没有客户端 JS 运行时 —— 这对 SEO 与 GEO 都更友好。
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PRODUCTS, COLLECTIONS } from '../data/catalog';
import { GUIDES } from '../data/guides';
import { POLICIES } from '../data/policies';
import { renderCollection, renderGuide, renderHome, renderLlmsTxt, renderNotFound, renderPolicy, renderProduct, renderRobots, renderSearch, renderSitemap } from './render';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
}

const OUT = join(ROOT, arg('out', 'dist'));

function write(relPath: string, content: string): void {
  const full = join(OUT, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

function main(): void {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  let count = 0;

  // 首页
  write('index.html', renderHome());
  count++;

  // 集合页
  for (const c of COLLECTIONS) {
    const items = PRODUCTS.filter((p) => p.collection === c.id);
    write(`collections/${c.slug}/index.html`, renderCollection(c, items));
    count++;
  }

  // 商品页
  for (const p of PRODUCTS) {
    write(`products/${p.slug}/index.html`, renderProduct(p));
    count++;
  }

  // 指南页
  for (const g of GUIDES) {
    write(`guides/${g.slug}/index.html`, renderGuide(g));
    count++;
  }

  // 政策页
  for (const pol of POLICIES) {
    write(`policies/${pol.slug}/index.html`, renderPolicy(pol));
    count++;
  }

  // 搜索页（静态骨架，query 由服务端填充；此处输出无 query 版本）
  write('search/index.html', renderSearch(''));
  count++;

  // 404
  write('404.html', renderNotFound());
  count++;

  // 机器可读资产
  write('llms.txt', renderLlmsTxt());
  write('sitemap.xml', renderSitemap());
  write('robots.txt', renderRobots());

  // 静态资源
  const assets = join(ROOT, 'public');
  if (existsSync(assets)) {
    cpSync(assets, join(OUT, 'assets'), { recursive: true });
  }

  console.log(`[build-site] 生成 ${count} 个页面 → ${OUT}`);
  console.log(`[build-site] 商品 ${PRODUCTS.length} / 集合 ${COLLECTIONS.length} / 指南 ${GUIDES.length} / 政策 ${POLICIES.length}`);
}

main();
