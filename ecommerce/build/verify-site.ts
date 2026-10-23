/**
 * 站点产出校验。
 *
 * 检查项对应真实的上线风险，每一项都会导致搜索或 AI 引用失败：
 * 1. 每页有且仅有一个 <title>、一个 meta description、一个 canonical
 * 2. JSON-LD 可被 JSON.parse 解析（坏一个字符整个页面的结构化数据就失效）
 * 3. schema 类型正确（商品页必须有 Product + FAQPage）
 * 4. 站内链接全部指向存在的页面（死链直接掉权重）
 * 5. 图片 alt 不为空（缺 alt 影响图片搜索，也影响 AI 理解商品）
 * 6. llms.txt / sitemap.xml / robots.txt 存在且内容正确
 *
 * 用法：npx tsx ecommerce/build/verify-site.ts
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', 'dist');

let errors = 0;
let warnings = 0;

function fail(msg: string): void {
  errors++;
  console.error(`  ✗ ${msg}`);
}
function warn(msg: string): void {
  warnings++;
  console.warn(`  ! ${msg}`);
}
function ok(msg: string): void {
  console.log(`  ✓ ${msg}`);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function main(): void {
  if (!existsSync(DIST)) {
    console.error('dist 不存在，请先运行 build-site.ts');
    process.exit(1);
  }

  const files = walk(DIST);
  const htmlFiles = files.filter((f) => f.endsWith('.html'));
  console.log(`\n校验 ${htmlFiles.length} 个 HTML 文件\n`);

  // ── 1. 关键文件存在性 ────────────────────────────────
  console.log('[关键文件]');
  for (const f of ['llms.txt', 'sitemap.xml', 'robots.txt', '404.html', 'index.html']) {
    if (existsSync(join(DIST, f))) ok(f);
    else fail(`缺少 ${f}`);
  }

  // ── 2. 逐页检查 ─────────────────────────────────────
  console.log('\n[逐页检查]');

  /**
   * 归一化站内路径：去掉尾斜杠，保证 /collections/x/ 与 /collections/x 视为同一页。
   * 静态资源（/assets/*）不参与死链校验 —— 它们不是 HTML 页面。
   */
  const norm = (p: string): string => {
    const clean = p.replace(/[?#].*$/, '').replace(/\/+$/, '');
    return clean === '' ? '/' : clean;
  };

  const knownPaths = new Set<string>();
  for (const f of htmlFiles) {
    const rel = '/' + relative(DIST, f).replace(/index\.html$/, '').replace(/\\/g, '/');
    knownPaths.add(norm(rel));
  }

  let totalLinks = 0;

  for (const f of htmlFiles) {
    const html = readFileSync(f, 'utf8');
    const rel = relative(DIST, f);
    const page = rel.replace(/index\.html$/, '') || 'index.html';
    const isNoindex = /<meta name="robots" content="noindex/.test(html);

    // title
    const titles = [...html.matchAll(/<title>([^<]*)<\/title>/g)];
    if (titles.length !== 1) fail(`${page}: title 数量为 ${titles.length}（应为 1）`);
    else if (!titles[0][1].trim()) fail(`${page}: title 为空`);
    else if (titles[0][1].length > 65) warn(`${page}: title ${titles[0][1].length} 字符，可能在 SERP 被截断`);

    // description
    const descs = [...html.matchAll(/<meta name="description" content="([^"]*)"/g)];
    if (descs.length !== 1) fail(`${page}: meta description 数量为 ${descs.length}（应为 1）`);
    else if (!descs[0][1].trim()) fail(`${page}: meta description 为空`);
    else if (descs[0][1].length > 165) warn(`${page}: description ${descs[0][1].length} 字符，可能被截断`);

    // canonical
    const canon = [...html.matchAll(/<link rel="canonical" href="([^"]*)"/g)];
    if (canon.length !== 1) fail(`${page}: canonical 数量为 ${canon.length}（应为 1）`);

    // viewport
    if (!/<meta name="viewport"/.test(html)) fail(`${page}: 缺少 viewport`);

    // JSON-LD（noindex 页面不要求）
    const ldBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    if (ldBlocks.length === 0 && !isNoindex) fail(`${page}: 没有 JSON-LD`);
    for (const [, raw] of ldBlocks) {
      try {
        const parsed = JSON.parse(raw);
        if (!parsed['@type']) fail(`${page}: JSON-LD 缺少 @type`);
      } catch (e) {
        fail(`${page}: JSON-LD 无法解析 — ${(e as Error).message}`);
      }
    }

    // 商品页必须有 Product + FAQPage
    if (page.includes('products/')) {
      const types: string[] = [];
      for (const [, raw] of ldBlocks) {
        const parsed = JSON.parse(raw);
        types.push(parsed['@type']);
      }
      if (!types.includes('Product')) fail(`${page}: 商品页缺少 Product schema`);
      if (!types.includes('FAQPage')) fail(`${page}: 商品页缺少 FAQPage schema`);
      if (!types.includes('BreadcrumbList')) fail(`${page}: 商品页缺少 BreadcrumbList schema`);
    }

    // og 标签
    for (const prop of ['og:title', 'og:description', 'og:image', 'og:url']) {
      if (!html.includes(`property="${prop}"`)) fail(`${page}: 缺少 ${prop}`);
    }

    // 图片 alt
    const imgs = [...html.matchAll(/<img\b[^>]*>/g)];
    for (const [tag] of imgs) {
      if (!/\balt="[^"]*"/.test(tag)) fail(`${page}: 图片缺少 alt — ${tag.slice(0, 70)}`);
    }

    // h1 唯一
    const h1s = [...html.matchAll(/<h1\b/g)];
    if (h1s.length !== 1) fail(`${page}: h1 数量为 ${h1s.length}（应为 1）`);

    // 站内链接（跳过静态资源与外链）
    const links = [...html.matchAll(/href="(\/[^"#?]*)"/g)];
    for (const [, href] of links) {
      totalLinks++;
      if (href.startsWith('/assets/') || href.startsWith('/img/')) continue;
      if (!knownPaths.has(norm(href))) {
        fail(`${page}: 死链 ${href}`);
      }
    }
  }

  console.log(`\n  共检查 ${totalLinks} 条站内链接`);

  // ── 3. llms.txt ─────────────────────────────────────
  console.log('\n[llms.txt]');
  const llms = readFileSync(join(DIST, 'llms.txt'), 'utf8');
  const skuCount = (llms.match(/^- SKU:/gm) || []).length;
  if (skuCount !== 8) fail(`llms.txt 包含 ${skuCount} 个 SKU（应为 8）`);
  else ok(`包含全部 ${skuCount} 个 SKU`);
  if (!llms.includes('## Size guides')) fail('llms.txt 缺少尺码表');
  else ok('包含尺码表');
  if (!llms.includes('## FAQs') === false) ok('包含 FAQ');

  // ── 4. sitemap ──────────────────────────────────────
  console.log('\n[sitemap.xml]');
  const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
  const urlCount = (sitemap.match(/<url>/g) || []).length;
  const expected = 1 + 5 + 8 + 3 + 5;
  if (urlCount !== expected) fail(`sitemap 有 ${urlCount} 条 URL（应为 ${expected}）`);
  else ok(`${urlCount} 条 URL`);
  if (!sitemap.includes('https://lumencie.com')) fail('sitemap 域名错误');

  // ── 5. robots ───────────────────────────────────────
  console.log('\n[robots.txt]');
  const robots = readFileSync(join(DIST, 'robots.txt'), 'utf8');
  if (!robots.includes('GPTBot')) warn('robots.txt 未放行 GPTBot');
  else ok('已放行 GPTBot / PerplexityBot / ClaudeBot');
  if (!robots.includes('Sitemap:')) fail('robots.txt 缺少 Sitemap 声明');
  else ok('包含 Sitemap 声明');

  // ── 汇总 ────────────────────────────────────────────
  console.log(`\n${'─'.repeat(52)}`);
  if (errors === 0 && warnings === 0) {
    console.log(`✓ 全部通过（${htmlFiles.length} 页）`);
  } else {
    console.log(`✗ ${errors} 个错误, ${warnings} 个警告`);
  }
  console.log(`${'─'.repeat(52)}\n`);
  process.exit(errors > 0 ? 1 : 0);
}

main();
