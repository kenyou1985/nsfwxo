import { PRODUCTS, COLLECTIONS } from '../data/catalog';
import { GUIDES } from '../data/guides';
import { POLICIES } from '../data/policies';
import { SIZE_CHARTS } from '../data/size-charts';
import { SITE, NAV } from '../data/site';
import { esc, jsonLd, markdown, money, paragraphs, attr } from './html';
import type { Collection, Guide, Policy, Product, SizeChart } from '../data/types';

/**
 * 站点渲染。
 *
 * SEO/GEO 关键点：
 * - 每个商品页输出 Product + Offer + AggregateRating(可空) + BreadcrumbList + FAQPage
 * - 集合页输出 ItemList
 * - 全站输出 Organization（带 sameAs），让 AI 代理能识别品牌实体
 * - 结构化数据与页面可见内容必须一致 —— AI 引用时会交叉验证
 */

const YEAR = new Date().getFullYear();

/** 生成 Product 的 JSON-LD */
function productSchema(p: Product): Record<string, unknown> {
  const images = p.shots.map((s) => `${SITE.baseUrl}${SITE.imageBase}/${p.slug}-${s.id}.jpg`);
  const url = `${SITE.baseUrl}/products/${p.slug}`;

  const schema: Record<string, unknown> = {
    '@type': 'Product',
    '@id': `${url}#product`,
    name: p.title,
    description: p.seo.description,
    sku: p.sku,
    mpn: p.sku,
    url,
    image: images,
    brand: { '@type': 'Brand', name: SITE.brand },
    manufacturer: { '@type': 'Organization', name: SITE.legalEntity },
    material: p.attributes.material,
    color: p.attributes.color,
    pattern: p.attributes.pattern,
    category: 'Women\'s Lingerie',
    audience: { '@type': 'PeopleAudience', suggestedMinAge: 18, suggestedGender: 'female' },
    inLanguage: 'en-US',
    offers: {
      '@type': 'Offer',
      '@id': `${url}#offer`,
      url,
      priceCurrency: 'USD',
      price: p.price.toFixed(2),
      availability: 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@id': `${SITE.baseUrl}/#organization` },
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingRate: {
          '@type': 'MonetaryAmount',
          value: SITE.flatShippingRate.toFixed(2),
          currency: 'USD',
        },
        shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'US' },
        deliveryTime: {
          '@type': 'ShippingDeliveryTime',
          handlingTime: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 2, unitCode: 'DAY' },
          transitTime: { '@type': 'QuantitativeValue', minValue: 2, maxValue: 4, unitCode: 'DAY' },
        },
      },
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'US',
        returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
        merchantReturnDays: SITE.returnWindowDays,
        returnMethod: 'https://schema.org/ReturnByMail',
        returnFees: 'https://schema.org/FreeReturn',
      },
    },
  };

  // 尺码作为变体
  if (p.sizes.length > 0) {
    schema.hasVariant = p.sizes.map((s) => ({
      '@type': 'ProductVariant',
      name: s,
      sku: `${p.sku}-${s}`,
      size: s,
      inStock: true,
    }));
  }

  return schema;
}

function faqSchema(items: { q: string; a: string }[]): Record<string, unknown> {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

function breadcrumbSchema(trail: { name: string; url: string }[]): Record<string, unknown> {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.name,
      item: `${SITE.baseUrl}${t.url}`,
    })),
  };
}

function organizationSchema(): Record<string, unknown> {
  return {
    '@type': 'Organization',
    '@id': `${SITE.baseUrl}/#organization`,
    name: SITE.brand,
    legalName: SITE.legalEntity,
    url: `${SITE.baseUrl}/`,
    logo: `${SITE.baseUrl}${SITE.imageBase}/logo.png`,
    description: SITE.about,
    email: SITE.supportEmail,
    slogan: SITE.tagline,
    address: {
      '@type': 'PostalAddress',
      addressCountry: 'US',
      addressRegion: SITE.operatingState,
    },
    contactPoint: [
      {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: SITE.supportEmail,
        availableLanguage: ['English'],
        areaServed: 'US',
      },
    ],
  };
}

function websiteSchema(): Record<string, unknown> {
  return {
    '@type': 'WebSite',
    '@id': `${SITE.baseUrl}/#website`,
    url: `${SITE.baseUrl}/`,
    name: SITE.brand,
    publisher: { '@id': `${SITE.baseUrl}/#organization` },
    inLanguage: 'en-US',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE.baseUrl}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

/** 页面骨架 */
function layout(opts: {
  title: string;
  description: string;
  url: string;
  schema?: Record<string, unknown>[];
  body: string;
  ogImage?: string;
  noindex?: boolean;
}): string {
  const fullTitle = opts.title === SITE.brand ? opts.title : `${opts.title} | ${SITE.brand}`;
  const og = opts.ogImage || `${SITE.imageBase}/og-default.jpg`;

  return `<!DOCTYPE html>
<html lang="en-US">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${attr(opts.description)}">
<link rel="canonical" href="${SITE.baseUrl}${opts.url}">
${opts.noindex ? '<meta name="robots" content="noindex,follow">' : '<meta name="robots" content="index,follow,max-image-preview:large">'}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE.brand)}">
<meta property="og:title" content="${attr(fullTitle)}">
<meta property="og:description" content="${attr(opts.description)}">
<meta property="og:url" content="${SITE.baseUrl}${opts.url}">
<meta property="og:image" content="${attr(og.startsWith('http') ? og : SITE.baseUrl + og)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${attr(fullTitle)}">
<meta name="twitter:description" content="${attr(opts.description)}">
<meta name="twitter:image" content="${attr(og.startsWith('http') ? og : SITE.baseUrl + og)}">
<meta name="rating" content="adult">
<meta name="googlebot" content="index,follow">
<link rel="alternate" type="text/plain" href="${SITE.baseUrl}/llms.txt" title="LLM-readable catalog">
<link rel="stylesheet" href="/assets/site.css">
${(opts.schema || []).map((s) => `<script type="application/ld+json">${jsonLd(s)}</script>`).join('\n')}
</head>
<body>
${ageGateScript()}
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/">${esc(SITE.brand)}</a>
    <nav class="nav" aria-label="Main">
      ${NAV.map((n) => `<a href="${n.href}">${esc(n.label)}</a>`).join('')}
    </nav>
    <form class="search" action="/search" method="get" role="search">
      <input type="search" name="q" placeholder="Search" aria-label="Search products">
    </form>
  </div>
</header>
<main>
${opts.body}
</main>
<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <h3>${esc(SITE.brand)}</h3>
      <p class="muted">${esc(SITE.tagline)}</p>
      <p class="muted">${esc(SITE.supportHours)}<br><a href="mailto:${SITE.supportEmail}">${esc(SITE.supportEmail)}</a></p>
    </div>
    <div>
      <h4>Shop</h4>
      ${COLLECTIONS.map((c) => `<a href="/collections/${c.slug}">${esc(c.title)}</a>`).join('\n      ')}
    </div>
    <div>
      <h4>Help</h4>
      <a href="/guides/size-guide">Size Guide</a>
      <a href="/guides/gift-guide">Gift Guide</a>
      <a href="/policies/shipping">Shipping</a>
      <a href="/policies/returns">Returns</a>
    </div>
    <div>
      <h4>Legal</h4>
      <a href="/policies/privacy">Privacy</a>
      <a href="/policies/terms">Terms</a>
      <a href="/policies/age-verification">Age Verification</a>
    </div>
  </div>
  <div class="wrap footer-bottom">
    <p class="muted">&copy; ${YEAR} ${esc(SITE.legalEntity)}. All rights reserved.</p>
    <p class="muted">Ships from ${esc(SITE.fulfillmentState)} to the United States only.</p>
  </div>
</footer>
</body>
</html>`;
}

/**
 * 年龄验证脚本。
 *
 * 用 localStorage 而非 cookie：cookie 会被部分州级法律要求做更严格的
 * 处理，localStorage 足够完成"不重复打扰"的目的，且不产生可用于跨站
 * 追踪的标识符。刻意不采集 ID 或任何可识别信息。
 */
function ageGateScript(): string {
  return `<script>
(function(){
  var KEY='lumencie_age_ok';
  var d=document.createElement('div');
  d.id='age-gate';
  d.setAttribute('role','dialog');
  d.setAttribute('aria-modal','true');
  d.setAttribute('aria-labelledby','age-gate-title');
  d.innerHTML='<div class="age-gate-box">'+
    '<h2 id="age-gate-title">18+ only</h2>'+
    '<p>This site sells intimate apparel intended for adults. You must be 18 or older to enter.</p>'+
    '<div class="age-gate-actions">'+
      '<button type="button" data-age="yes" class="btn-primary">I am 18 or older</button>'+
      '<a href="https://www.google.com" class="btn-secondary" rel="nofollow">Exit</a>'+
    '</div>'+
    '<p class="age-gate-note">See our <a href="/policies/age-verification">age verification policy</a>.</p>'+
  '</div>';
  document.body.appendChild(d);
  function show(){d.classList.add('is-open');}
  function hide(){d.classList.remove('is-open');try{localStorage.setItem(KEY,'1');}catch(e){}}
  try{ if(localStorage.getItem(KEY)==='1'){d.remove();return;} }catch(e){}
  show();
  d.addEventListener('click',function(e){
    var t=e.target.closest('[data-age]');
    if(!t)return;
    if(t.getAttribute('data-age')==='yes'){hide();}
  });
})();
</script>`;
}

function productCard(p: Product): string {
  return `<article class="card">
  <a class="card-media" href="/products/${p.slug}">
    <img src="${SITE.imageBase}/${p.slug}-01.jpg" alt="${attr(p.title)}" loading="lazy" width="600" height="750">
  </a>
  <div class="card-body">
    <h3><a href="/products/${p.slug}">${esc(p.title)}</a></h3>
    <p class="card-sub">${esc(p.subtitle)}</p>
    <p class="price">${money(p.price)}${p.compareAtPrice ? ` <s>${money(p.compareAtPrice)}</s>` : ''}</p>
  </div>
</article>`;
}

function sizeTable(chart: SizeChart): string {
  const head = chart.columns
    .map((c) => `<th scope="col">${esc(c.label)}</th>`)
    .join('');
  const body = chart.rows
    .map(
      (r) =>
        `<tr><th scope="row">${esc(r.label)}</th>${chart.columns
          .slice(1)
          .map((c) => `<td>${esc((r as Record<string, unknown>)[c.key] ?? '—')}</td>`)
          .join('')}</tr>`,
    )
    .join('\n');
  return `<div class="table-wrap">
<table class="size-table">
<caption>${esc(chart.title)} — body measurements</caption>
<thead><tr>${head}</tr></thead>
<tbody>${body}</tbody>
</table>
</div>`;
}

function sizeChartBlock(chart: SizeChart): string {
  return `<section class="size-block" id="size">
<h2>Size &amp; fit</h2>
<p>${esc(chart.intro)}</p>
${sizeTable(chart)}
<h3>How to choose</h3>
<ul>${chart.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
</section>`;
}

/** 商品页 */
export function renderProduct(p: Product): string {
  const chart = SIZE_CHARTS.find((c) => c.id === p.sizeChartId)!;
  const collection = COLLECTIONS.find((c) => c.id === p.collection)!;

  const body = `
<div class="wrap product-layout">
  <div class="product-media">
    <div class="product-hero">
      <img src="${SITE.imageBase}/${p.slug}-01.jpg" alt="${attr(p.title)}" width="800" height="1000">
    </div>
    <div class="gallery">
      ${p.shots
        .slice(1)
        .map(
          (s) =>
            `<img src="${SITE.imageBase}/${p.slug}-${s.id}.jpg" alt="${attr(p.title)} — ${attr(s.brief)}" loading="lazy" width="600" height="750">`,
        )
        .join('\n      ')}
    </div>
  </div>
  <div class="product-info">
    <p class="eyebrow"><a href="/collections/${collection.slug}">${esc(collection.title)}</a></p>
    <h1>${esc(p.title)}</h1>
    <p class="subtitle">${esc(p.subtitle)}</p>
    <p class="price price-lg">${money(p.price)}${p.compareAtPrice ? ` <s>${money(p.compareAtPrice)}</s>` : ''}</p>
    <p class="stock">In stock — ships from ${esc(SITE.fulfillmentState)} in ${esc(SITE.processingTime)}</p>

    <form class="buy-form" action="/cart/add" method="post">
      <label for="size">Size</label>
    <select id="size" name="size" required>
      <option value="">Select a size</option>
      ${p.sizes.map((s) => `<option value="${attr(s)}">${esc(s)}</option>`).join('')}
    </select>
    <button type="submit" class="btn-primary">Add to bag</button>
    </form>

    <p class="fit-note"><strong>Fit note:</strong> ${esc(p.fitNote)}</p>
    <p class="fit-note"><strong>Model:</strong> ${esc(p.modelTryOn)}</p>

    <h2>Details</h2>
    <dl class="specs">
      <dt>Material</dt><dd>${esc(p.attributes.material)}</dd>
      <dt>Color</dt><dd>${esc(p.attributes.color)}</dd>
      <dt>Closure</dt><dd>${esc(p.attributes.closure)}</dd>
      <dt>Pattern</dt><dd>${esc(p.attributes.pattern)}</dd>
      <dt>Country of origin</dt><dd>${esc(p.compliance.countryOfOrigin)}</dd>
      <dt>Care</dt><dd>${esc(p.compliance.careInstructions)}</dd>
    </dl>

    <h2>Why we made it this way</h2>
    <ul class="highlights">${p.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
    ${paragraphs(p.description)}
  </div>
</div>

<div class="wrap">
  ${sizeChartBlock(chart)}
  <section class="faq-block">
    <h2>Questions about ${esc(p.title)}</h2>
    ${p.faqs.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('\n    ')}
  </section>
</div>`;

  return layout({
    title: p.title,
    description: p.seo.description,
    url: `/products/${p.slug}`,
    ogImage: `${SITE.imageBase}/${p.slug}-01.jpg`,
    schema: [
      productSchema(p),
      faqSchema(p.faqs),
      breadcrumbSchema([
        { name: 'Home', url: '/' },
        { name: collection.title, url: `/collections/${collection.slug}` },
        { name: p.title, url: `/products/${p.slug}` },
      ]),
    ],
    body,
  });
}

/** 集合页 */
export function renderCollection(c: Collection, items: Product[]): string {
  const body = `
<div class="wrap">
  <nav class="breadcrumb" aria-label="Breadcrumb">
    <a href="/">Home</a> / <span>${esc(c.title)}</span>
  </nav>
  <header class="collection-head">
    <h1>${esc(c.title)}</h1>
    <p class="lede">${esc(c.description)}</p>
  </header>
  <div class="grid">
    ${items.map(productCard).join('\n    ')}
  </div>
</div>`;

  const itemList = {
    '@type': 'ItemList',
    numberOfItems: items.length,
    itemListElement: items.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE.baseUrl}/products/${p.slug}`,
      name: p.title,
    })),
  };

  return layout({
    title: c.title,
    description: c.seoDescription,
    url: `/collections/${c.slug}`,
    ogImage: c.heroImage,
    schema: [
      itemList,
      breadcrumbSchema([
        { name: 'Home', url: '/' },
        { name: c.title, url: `/collections/${c.slug}` },
      ]),
    ],
    body,
  });
}

/** 指南页 */
export function renderGuide(g: Guide): string {
  const body = `
<div class="wrap article-wrap">
  <nav class="breadcrumb" aria-label="Breadcrumb">
    <a href="/">Home</a> / <span>${esc(g.title)}</span>
  </nav>
  <article class="article">
    <h1>${esc(g.title)}</h1>
    ${markdown(g.body)}
    <section class="faq-block">
      <h2>Common questions</h2>
      ${g.faqs.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('\n      ')}
    </section>
  </article>
</div>`;

  return layout({
    title: g.title,
    description: g.description,
    url: `/guides/${g.slug}`,
    schema: [
      faqSchema(g.faqs),
      breadcrumbSchema([
        { name: 'Home', url: '/' },
        { name: 'Guides', url: '/guides/size-guide' },
        { name: g.title, url: `/guides/${g.slug}` },
      ]),
    ],
    body,
  });
}

/** 政策页 */
export function renderPolicy(pol: Policy): string {
  const body = `
<div class="wrap article-wrap">
  <nav class="breadcrumb" aria-label="Breadcrumb">
    <a href="/">Home</a> / <span>${esc(pol.title)}</span>
  </nav>
  <article class="article">
    <h1>${esc(pol.title)}</h1>
    <p class="muted">Last updated ${esc(pol.updated)}</p>
    ${pol.sections
      .map((s) => `<h2>${esc(s.heading)}</h2>${paragraphs(s.body)}`)
      .join('\n    ')}
  </article>
</div>`;

  return layout({
    title: pol.title,
    description: pol.description,
    url: `/policies/${pol.slug}`,
    schema: [
      breadcrumbSchema([
        { name: 'Home', url: '/' },
        { name: pol.title, url: `/policies/${pol.slug}` },
      ]),
    ],
    body,
  });
}

/** 首页 */
export function renderHome(): string {
  const featured = PRODUCTS.slice(0, 4);
  const body = `
<section class="hero">
  <div class="wrap">
    <h1>${esc(SITE.tagline)}</h1>
    <p class="lede">Intimates with real coverage, soft fabric, and details that work outside of the bedroom — Halloween, wedding season, and every ordinary day in between.</p>
    <p><a class="btn-primary" href="/collections/lounge-sleepwear">Shop the collection</a></p>
  </div>
</section>

<div class="wrap">
  <section class="home-section">
    <h2>Featured</h2>
    <div class="grid">
      ${featured.map(productCard).join('\n      ')}
    </div>
  </section>

  <section class="home-section">
    <h2>Shop by occasion</h2>
    <div class="grid grid-collections">
      ${COLLECTIONS.map(
        (c) => `<a class="collection-tile" href="/collections/${c.slug}">
        <h3>${esc(c.title)}</h3>
        <p class="muted">${esc(c.description)}</p>
      </a>`,
      ).join('\n      ')}
    </div>
  </section>

  <section class="home-section newsletter" id="newsletter">
    <h2>${esc(SITE.brand)} newsletter</h2>
    <p class="muted">${esc(SITE.newsletterPitch)}</p>
    <form action="/api/subscribe" method="post" class="subscribe-form">
      <label class="sr-only" for="email">Email address</label>
      <input id="email" type="email" name="email" required placeholder="you@example.com" autocomplete="email">
      <button type="submit" class="btn-primary">Subscribe</button>
    </form>
    <p class="muted small">Use code <strong>${esc(SITE.welcomeDiscount)}</strong> for 15% off your first order. Unsubscribe anytime.</p>
  </section>
</div>`;

  return layout({
    title: SITE.brand,
    description: SITE.metaDescription,
    url: '/',
    schema: [
      organizationSchema(),
      websiteSchema(),
      breadcrumbSchema([{ name: 'Home', url: '/' }]),
    ],
    body,
  });
}

/** 搜索结果页（静态骨架；真实搜索由前端或后端接入） */
export function renderSearch(query: string): string {
  const q = query.trim();
  const hits = q
    ? PRODUCTS.filter((p) =>
        [p.title, p.subtitle, p.summary, ...p.seo.keywords, p.collection]
          .join(' ')
          .toLowerCase()
          .includes(q.toLowerCase()),
      )
    : [];

  const body = `
<div class="wrap">
  <h1>Search</h1>
  ${q ? `<p class="muted">${hits.length} result${hits.length === 1 ? '' : 's'} for "${esc(q)}"</p>` : '<p class="muted">Enter a term to search.</p>'}
  ${hits.length ? `<div class="grid">${hits.map(productCard).join('\n    ')}</div>` : ''}
</div>`;

  return layout({
    title: q ? `Search: ${q}` : 'Search',
    description: 'Search the LUMENCIE catalog.',
    url: '/search',
    noindex: true,
    body,
  });
}

/** 404 */
export function renderNotFound(): string {
  return layout({
    title: 'Page not found',
    description: 'The page you were looking for does not exist.',
    url: '/404',
    noindex: true,
    body: `<div class="wrap"><h1>Page not found</h1><p class="muted">The page you were looking for does not exist or has moved.</p><p><a class="btn-primary" href="/">Back to the shop</a></p></div>`,
  });
}

/**
 * llms.txt —— 面向 AI 购物代理的机器可读目录。
 *
 * 这是 GEO 的核心资产：把品牌、分类、商品、尺码、FAQ 用最容易被
 * LLM 解析的 markdown 摘要形式暴露出来，比让它抓取 HTML 页面更可靠。
 */
export function renderLlmsTxt(): string {
  const lines: string[] = [];
  lines.push(`# ${SITE.brand}`);
  lines.push('');
  lines.push(`> ${SITE.tagline}. ${SITE.about}`);
  lines.push('');
  lines.push(`${SITE.domain} is an independent US retailer of women's intimates, sleepwear, and bridal shapewear. Sizes XS-3X. Ships from ${SITE.fulfillmentState} to the United States only. All items are intended for adults aged 18+.`);
  lines.push('');
  lines.push('## Collections');
  lines.push('');
  for (const c of COLLECTIONS) {
    const n = PRODUCTS.filter((p) => p.collection === c.id).length;
    lines.push(`- [${c.title}](${SITE.baseUrl}/collections/${c.slug}): ${c.description} (${n} products)`);
  }
  lines.push('');
  lines.push('## Products');
  lines.push('');
  for (const p of PRODUCTS) {
    lines.push(`### ${p.title}`);
    lines.push('');
    lines.push(`- SKU: ${p.sku}`);
    lines.push(`- URL: ${SITE.baseUrl}/products/${p.slug}`);
    lines.push(`- Price: ${money(p.price)} USD`);
    lines.push(`- Collection: ${COLLECTIONS.find((c) => c.id === p.collection)!.title}`);
    lines.push(`- Material: ${p.attributes.material}`);
    lines.push(`- Color: ${p.attributes.color}`);
    lines.push(`- Sizes: ${p.sizes.join(', ')}`);
    lines.push(`- Fit: ${p.fitNote}`);
    lines.push(`- Summary: ${p.summary}`);
    lines.push('');
    lines.push('Key facts:');
    for (const h of p.highlights) lines.push(`- ${h}`);
    lines.push('');
    lines.push('FAQs:');
    for (const f of p.faqs) {
      lines.push(`- Q: ${f.q}`);
      lines.push(`  A: ${f.a}`);
    }
    lines.push('');
  }
  lines.push('## Size guides');
  lines.push('');
  for (const chart of SIZE_CHARTS) {
    lines.push(`### ${chart.title}`);
    lines.push('');
    lines.push('| ' + chart.columns.map((c) => c.label).join(' | ') + ' |');
    lines.push('| ' + chart.columns.map(() => '---').join(' | ') + ' |');
    for (const r of chart.rows) {
      lines.push(
        '| ' +
          chart.columns
            .map((c) => String((r as Record<string, unknown>)[c.key] ?? '—'))
            .join(' | ') +
          ' |',
      );
    }
    lines.push('');
    for (const t of chart.tips) lines.push(`- ${t}`);
    lines.push('');
  }
  lines.push('## Guides');
  lines.push('');
  for (const g of GUIDES) {
    lines.push(`- [${g.title}](${SITE.baseUrl}/guides/${g.slug}): ${g.description}`);
  }
  lines.push('');
  lines.push('## Policies');
  lines.push('');
  for (const pol of POLICIES) {
    lines.push(`- [${pol.title}](${SITE.baseUrl}/policies/${pol.slug}): ${pol.description}`);
  }
  lines.push('');
  lines.push('## Contact');
  lines.push('');
  lines.push(`- Support: ${SITE.supportEmail}`);
  lines.push(`- ${SITE.supportHours}`);
  lines.push(`- Legal entity: ${SITE.legalEntity}, ${SITE.operatingState}`);
  lines.push('');
  return lines.join('\n');
}

/** sitemap.xml */
export function renderSitemap(): string {
  const urls: { loc: string; priority: string; changefreq: string }[] = [];
  urls.push({ loc: '/', priority: '1.0', changefreq: 'daily' });
  for (const c of COLLECTIONS) {
    urls.push({ loc: `/collections/${c.slug}`, priority: '0.9', changefreq: 'weekly' });
  }
  for (const p of PRODUCTS) {
    urls.push({ loc: `/products/${p.slug}`, priority: '0.9', changefreq: 'weekly' });
  }
  for (const g of GUIDES) {
    urls.push({ loc: `/guides/${g.slug}`, priority: '0.7', changefreq: 'monthly' });
  }
  for (const pol of POLICIES) {
    urls.push({ loc: `/policies/${pol.slug}`, priority: '0.3', changefreq: 'yearly' });
  }
  const body = urls
    .map(
      (u) =>
        `  <url>\n    <loc>${SITE.baseUrl}${u.loc}</loc>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

/** robots.txt */
export function renderRobots(): string {
  return `User-agent: *
Allow: /

# 购物代理与 AI 爬虫：明确允许，避免因默认判断被误拦
User-agent: GPTBot
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: Google-Extended
Allow: /

Disallow: /cart
Disallow: /checkout
Disallow: /api/

Sitemap: ${SITE.baseUrl}/sitemap.xml
`;
}
