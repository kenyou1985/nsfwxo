import type { Collection, Product } from './types';

/**
 * 首月商品目录（8 个 SKU）。
 *
 * 选品原则见方案第四节：定位是"高级感内衣 / 情侣礼物 / 婚礼内衣"，
 * 而不是"情色内衣"。这个定位同时解决三件事：
 * 1. Google SafeSearch 不过滤 → SEO 可索引
 * 2. Google/Meta 广告可投放 → 后面能放量
 * 3. 平台审核友好 → listing 不下架
 *
 * 成本口径：采购价为 1688 拿样后的目标成交价（人民币），
 * 上线前需用实际样品复核；weightKg 用于分摊头程与关税。
 */

/** 统一的主体占位符：主体注册完成后替换为真实 RN */
const RN_PLACEHOLDER = 'RN-PENDING';

export const COLLECTIONS: Collection[] = [
  {
    id: 'halloween-costumes',
    slug: 'halloween-costumes',
    title: 'Halloween Intimates',
    description:
      'Enchanting Halloween lingerie and costume intimates designed for the season — spooky details, soft fabrics, and a playful silhouette you can actually wear all night.',
    seoDescription:
      'Shop Halloween lingerie and costume intimates: witch, cat, and vampire themed sets in soft lace and satin. Ships from the US in 2-4 days.',
    heroImage: '/img/products/hero-halloween.jpg',
  },
  {
    id: 'couples-gifts',
    slug: 'couples-gifts',
    title: 'Couples Gifts',
    description:
      'Matching intimates gift sets for anniversaries, weddings, and the everyday moments worth marking.',
    seoDescription:
      'Matching couples lingerie gift sets for anniversary, wedding, and honeymoon. Coordinated styles packaged ready to gift.',
    heroImage: '/img/products/hero-couples.jpg',
  },
  {
    id: 'lounge-sleepwear',
    slug: 'lounge-sleepwear',
    title: 'Lounge & Sleepwear',
    description:
      'Everyday-intimates crosses the line into sleepwear — coverage, comfort, and a silhouette that reads as polished.',
    seoDescription:
      'Elevated lingerie bodysuits, camisoles, and chemises with real coverage. Soft everyday styles for sleep, lounge, and layering.',
    heroImage: '/img/products/hero-lounge.jpg',
  },
  {
    id: 'plus-size',
    slug: 'plus-size',
    title: 'Plus Size',
    description:
      'Extended sizing across our signature styles, built on the same patterns rather than graded up from a smaller base.',
    seoDescription:
      'Plus size lingerie and sleepwear in extended sizing. Same fabrics and construction as our standard range, sizes 1X-3X.',
    heroImage: '/img/products/hero-plus-size.jpg',
  },
  {
    id: 'bridal',
    slug: 'bridal',
    title: 'Bridal',
    description:
      'Bridal lingerie and honeymoon pieces chosen to sit beautifully under a wedding dress without showing through.',
    seoDescription:
      'Bridal lingerie and honeymoon intimates: seamless bodysuits, chemises, and matching sets made to layer under a wedding dress.',
    heroImage: '/img/products/hero-bridal.jpg',
  },
];

export const PRODUCTS: Product[] = [
  // ── 1. 万圣节：猫耳连体衣 ────────────────────────────────────────────
  {
    sku: 'HL-CAT-BOD',
    slug: 'halloween-cat-bodysuit',
    title: 'Cat-Ears Lace Bodysuit with Detachable Tail',
    subtitle: 'Playful Halloween bodysuit in soft stretch lace',
    price: 34.99,
    compareAtPrice: 44.99,
    collection: 'halloween-costumes',
    summary:
      'A lace bodysuit with detachable cat ears and tail — full coverage, a snap gusset, and enough stretch to move in all night.',
    description:
      'This cat bodysuit was designed to be worn for a full Halloween night out rather than as a costume that falls apart after one hour. The lace is a soft stretch blend that keeps its shape without digging in, and the bodysuit cuts high on the leg to stay smooth under a skirt or costume dress.\n\nThe ears and tail are both detachable with small silicone clips, so you can take them off before the rest of the evening. The gusset is a cotton-spandex snap closure rather than the usual synthetic lace, which matters if you are wearing it for a full day.\n\nIt reads as a costume without reading as a costume. Most Halloween lingerie is worn for about three hours in a dark room. This one is designed to survive dinner, a party, and the walk home.',
    highlights: [
      'Detachable ears and tail — remove them when the costume part is over',
      'Cotton-spandex snap gusset, no synthetic lace against the skin',
      'Stretch lace that holds shape and does not dig in at the waist',
      'High-cut leg line so it stays smooth under skirts and costume dresses',
      'Machine washable on a delicate cycle',
    ],
    attributes: {
      material: '82% Nylon, 18% Spandex lace; cotton-spandex gusset',
      color: 'Black',
      closure: 'Snap gusset; detachable ears and tail with silicone clips',
      pattern: 'Floral lace',
      features: ['Detachable costume pieces', 'Snap gusset', 'High-cut leg', 'Stretch fabric'],
    },
    sizeChartId: 'standard-apparel',
    sizes: ['XS', 'S', 'M', 'L'],
    fitNote:
      'True to size. If you are between sizes and want a firmer fit, size down. The lace has roughly 2 inches of stretch across the bust.',
    modelTryOn: 'Model is 5\'8" (173 cm) with a 34" bust, wearing size S.',
    seo: {
      title: 'Cat-Ears Lace Bodysuit with Detachable Tail | Halloween Lingerie',
      description:
        'Playful Halloween lace bodysuit with detachable cat ears and tail. Cotton snap gusset, high-cut leg, soft stretch lace. Ships from the US in 2-4 days.',
      keywords: [
        'halloween lingerie',
        'cat ears bodysuit',
        'costume bodysuit women',
        'halloween bodysuit',
        'detachable tail costume',
      ],
    },
    faqs: [
      {
        q: 'Do the cat ears and tail come off?',
        a: 'Yes. Both attach with small silicone clips and remove in seconds, so you can keep the bodysuit on after the costume portion of the evening is over.',
      },
      {
        q: 'Is this bodysuit comfortable to wear for a full night?',
        a: 'The lace is a soft stretch blend and the gusset is cotton-spandex with snaps, not synthetic lace. Most Halloween lingerie is built for a few hours; this one is designed to stay comfortable through dinner, a party, and the trip home.',
      },
      {
        q: 'Will it show under a skirt or costume dress?',
        a: 'The leg opening is cut high specifically to sit smooth under skirts and dresses without showing through the fabric.',
      },
      {
        q: 'How do I wash it?',
        a: 'Hand wash or machine wash on a delicate cycle in a mesh laundry bag. Hang to dry. Do not use fabric softener on the lace — it reduces elasticity over time.',
      },
    ],
    shots: [
      { id: '01', angle: 'hero-front', brief: 'Front view, neutral studio background, full body', useReference: true },
      { id: '02', angle: 'hero-three-quarter', brief: 'Three-quarter angle, slight turn, soft shadow', useReference: true },
      { id: '03', angle: 'detail-fabric', brief: 'Close-up of lace texture and the snap gusset closure', useReference: true },
      { id: '04', angle: 'detail-hardware', brief: 'Close-up of the detachable ear and tail silicone clips', useReference: false },
      { id: '05', angle: 'flat-lay', brief: 'Flat lay of the full set with accessories arranged neatly', useReference: false },
    ],
    garmentBrief:
      'a black floral lace full-coverage bodysuit with a high-cut leg line, worn with detachable black cat ears and a black cat tail',
    modelId: 'm1',
    economics: { costCny: 42, weightKg: 0.14, initialQty: 60 },
    compliance: {
      fiberContent: '82% Nylon, 18% Spandex',
      countryOfOrigin: 'Made in China',
      rnNumber: RN_PLACEHOLDER,
      prop65Warning: false,
      cpscLooseGarment: false,
      careInstructions: 'Hand wash cold. Line dry. Do not bleach.',
    },
    etsyAttributes: {
      whoItsFor: 'For her',
      whenItsNeeded: 'Any occasion',
      occasion: 'Halloween',
      style: 'Gothic',
      department: 'Women',
      tags: [
        'cat ears bodysuit',
        'halloween lingerie',
        'costume bodysuit',
        'cat tail costume',
        'lace bodysuit',
        'halloween costume',
        'halloween date night',
        'detachable costume',
      ],
    },
    ebaySpecifics: {
      Brand: 'LUMENCIE',
      'Material Type': 'Nylon Blend',
      'Department': 'Women',
      'Color': 'Black',
      'Size (US)': 'XS|L',
      Style: 'Bodysuit',
      Pattern: 'Floral',
      'Country/Region of Manufacture': 'China',
    },
  },

  // ── 2. 万圣节：女仆礼盒 ──────────────────────────────────────────────
  {
    sku: 'HL-MAID-SET',
    slug: 'halloween-french-maid-set',
    title: 'French Maid Lace Gift Set with Headband',
    subtitle: 'Halloween costume set in soft white lace',
    price: 39.99,
    compareAtPrice: 49.99,
    collection: 'halloween-costumes',
    summary:
      'A two-piece French maid set in white lace with a ruffled headband — sold as a ready-to-gift box set.',
    description:
      'The classic French maid silhouette, rebuilt as actual lingerie instead of a costume that falls apart. The apron panel is lined so it does not scratch, and the straps on the bodysuit are adjustable rather than fixed.\n\nIt ships as a box set: bodysuit, apron panel, and ruffled headband, packed together. That makes it straightforward to gift as well as to wear, which is where this style usually gets bought.\n\nWhite reads very differently on camera than in person — under warm light it picks up cream. We have shot it to reflect that, so what you see is close to what arrives.',
    highlights: [
      'Box set: bodysuit, apron panel, and headband together',
      'Lined apron panel — no scratchy raw edges against the skin',
      'Adjustable straps, not fixed-length',
      'White lace photographed under warm light to match real-world color',
      'Ships in gift-ready packaging',
    ],
    attributes: {
      material: '85% Nylon, 15% Spandex; polyester lining',
      color: 'White',
      closure: 'Adjustable straps; elasticated back',
      pattern: 'Lace with ruffle trim',
      features: ['Gift box set', 'Headband included', 'Lined apron panel', 'Adjustable straps'],
    },
    sizeChartId: 'standard-apparel',
    sizes: ['S', 'M', 'L', 'XL'],
    fitNote:
      'True to size. The bodysuit is fitted through the bust; size up if you are between sizes or prefer a looser feel.',
    modelTryOn: 'Model is 5\'9" (175 cm) with a 35" bust, wearing size S.',
    seo: {
      title: 'French Maid Lace Gift Set with Headband | Halloween Costume Lingerie',
      description:
        'White lace French maid bodysuit and apron set with ruffled headband. Gift-ready box set, lined apron panel, adjustable straps. Ships from the US.',
      keywords: [
        'french maid outfit',
        'halloween costume set women',
        'maid lingerie',
        'halloween gift set',
        'white lace bodysuit',
      ],
    },
    faqs: [
      {
        q: 'What comes in the box?',
        a: 'A lace bodysuit, an apron panel, and a ruffled headband, packed together in gift-ready packaging.',
      },
      {
        q: 'Is the apron scratchy?',
        a: 'The apron panel is lined, so the edges do not rub against skin the way costume aprons usually do.',
      },
      {
        q: 'Will white look different on camera?',
        a: 'White lace picks up warm tones under indoor lighting and reads slightly cream. We have shot it under warm light so the photos are close to how it looks in person.',
      },
      {
        q: 'Can I wear it without the apron and headband?',
        a: 'Yes. All three pieces are separate, so the bodysuit works as a standalone lace bodysuit too.',
      },
    ],
    shots: [
      { id: '01', angle: 'hero-front', brief: 'Front view in the full set, warm studio lighting', useReference: true },
      { id: '02', angle: 'hero-three-quarter', brief: 'Three-quarter turn, showing the apron panel layering', useReference: true },
      { id: '03', angle: 'detail-fabric', brief: 'Close-up of the lace and ruffle trim', useReference: true },
      { id: '04', angle: 'flat-lay', brief: 'Flat lay of all three pieces laid out with the box packaging', useReference: false },
      { id: '05', angle: 'detail-hardware', brief: 'Close-up of the adjustable strap hardware', useReference: true },
    ],
    garmentBrief:
      'a white lace full-coverage bodysuit with a lined white apron panel and a ruffled white headband, French maid inspired costume intimates',
    modelId: 'm2',
    economics: { costCny: 55, weightKg: 0.19, initialQty: 60 },
    compliance: {
      fiberContent: '85% Nylon, 15% Spandex (lining: 100% Polyester)',
      countryOfOrigin: 'Made in China',
      rnNumber: RN_PLACEHOLDER,
      prop65Warning: false,
      cpscLooseGarment: false,
      careInstructions: 'Hand wash cold. Line dry. Do not bleach.',
    },
    etsyAttributes: {
      whoItsFor: 'For her',
      whenItsNeeded: 'Any occasion',
      occasion: 'Halloween',
      style: 'Classic',
      department: 'Women',
      tags: [
        'french maid outfit',
        'halloween costume',
        'maid lingerie set',
        'white lace bodysuit',
        'halloween gift set',
        'costume gift for her',
        'apron lingerie',
        'halloween she wears',
        'maid costume set',
        'white lace sleepwear',
        'costume bodysuit women',
        'gift set for her',
        'halloween couple costume',
      ],
    },
    ebaySpecifics: {
      Brand: 'LUMENCIE',
      'Material Type': 'Nylon Blend',
      Department: 'Women',
      Color: 'White',
      'Size (US)': 'S|XL',
      Style: 'Bodysuit',
      Pattern: 'Lace',
      'Country/Region of Manufacture': 'China',
    },
  },

  // ── 3. 万圣节：吸血鬼斗篷睡衣 ────────────────────────────────────────
  {
    sku: 'HL-VAMP-CHEM',
    slug: 'halloween-vampire-chemise',
    title: 'Vampire-Inspired Lace Chemise with Winged Cape',
    subtitle: 'Longline chemise with a detachable cape',
    price: 46.99,
    compareAtPrice: 59.99,
    collection: 'halloween-costumes',
    summary:
      'A longline lace chemise with a detachable winged cape — full-length and coverage-forward, built for a cold night out.',
    description:
      'Most Halloween chemises are short, sheer, and warm to wear. This one is longline, fully lined through the body, and comes with a detachable cape that fastens at the shoulders.\n\nIt was built for October rather than for a costume party in a warm room — the fabric has enough weight to sit against a slight chill, and the cape is long enough to matter in a photo.\n\nThe chemise straps are convertible: worn as shoulder straps, or crossed at the back as a crisscross, which changes the neckline enough to work under a suit or a blazer if you want to wear it out for dinner.',
    highlights: [
      'Longline cut with a full body lining — coverage without bulk',
      'Detachable winged cape, fastens at the shoulders',
      'Convertible straps: straight or crisscross at the back',
      'Fabric weight chosen for an actual cold night out',
      'Long enough to layer under a coat or blazer',
    ],
    attributes: {
      material: '80% Viscose, 20% Lace with polyester lining',
      color: 'Black',
      closure: 'Convertible straps; concealed hook closure',
      pattern: 'Floral lace',
      features: ['Detachable cape', 'Convertible straps', 'Full lining', 'Longline cut'],
    },
    sizeChartId: 'standard-apparel',
    sizes: ['S', 'M', 'L', 'XL'],
    fitNote:
      'The chemise is cut to skim rather than cling, so the waist has extra room. Size down for a closer fit.',
    modelTryOn: 'Model is 5\'10" (178 cm) with a 36" bust, wearing size S.',
    seo: {
      title: 'Vampire Lace Chemise with Winged Cape | Halloween Costume Lingerie',
      description:
        'Longline lace chemise with detachable winged cape, convertible straps, and full body lining. Halloween costume lingerie that works out for dinner.',
      keywords: [
        'vampire costume women',
        'halloween chemise',
        'winged cape costume',
        'longline lingerie dress',
        'halloween outfit women',
      ],
    },
    faqs: [
      {
        q: 'Does the cape come off?',
        a: 'Yes. It fastens at the shoulders with small hooks and detaches, so the chemise can be worn on its own.',
      },
      {
        q: 'Is the chemise see-through?',
        a: 'The body of the chemise is fully lined. The lace overlay is semi-sheer as lace always is, but nothing shows through underneath it.',
      },
      {
        q: 'Can I wear this out to dinner, not just to a party?',
        a: 'That was the point of the design. The weight, lining, and length are meant for going out, and the convertible straps change the neckline enough to work under a blazer.',
      },
      {
        q: 'How long is the cape?',
        a: 'The cape falls to mid-calf. It is long enough to read clearly in a photograph but not so long that it drags on the ground.',
      },
    ],
    shots: [
      { id: '01', angle: 'hero-front', brief: 'Full-length front view with the cape attached', useReference: true },
      { id: '02', angle: 'hero-three-quarter', brief: 'Three-quarter turn, cape slightly lifted to show the straps', useReference: true },
      { id: '03', angle: 'detail-fabric', brief: 'Close-up of the lace overlay and lining edge', useReference: true },
      { id: '04', angle: 'detail-hardware', brief: 'Close-up of the cape fastening at the shoulder', useReference: true },
      { id: '05', angle: 'on-body-seated', brief: 'Seated on a stool, showing the longline drape', useReference: true },
    ],
    garmentBrief:
      'a floor-adjacent longline black floral lace chemise with a full body lining, worn with a detachable black winged cape',
    modelId: 'm1',
    economics: { costCny: 68, weightKg: 0.26, initialQty: 50 },
    compliance: {
      fiberContent: '80% Viscose, 20% Polyester (lining: 100% Polyester)',
      countryOfOrigin: 'Made in China',
      rnNumber: RN_PLACEHOLDER,
      prop65Warning: false,
      cpscLooseGarment: false,
      careInstructions: 'Hand wash cold. Line dry. Do not bleach.',
    },
    etsyAttributes: {
      whoItsFor: 'For her',
      whenItsNeeded: 'Any occasion',
      occasion: 'Halloween',
      style: 'Gothic',
      department: 'Women',
      tags: [
        'vampire costume',
        'halloween chemise',
        'winged cape women',
        'gothic lingerie dress',
        'halloween outfit',
        'longline chemise',
        'costume for women',
        'spooky bridal outfit',
      ],
    },
    ebaySpecifics: {
      Brand: 'LUMENCIE',
      'Material Type': 'Viscose Blend',
      Department: 'Women',
      Color: 'Black',
      'Size (US)': 'S|XL',
      Style: 'Chemise',
      Pattern: 'Floral',
      'Country/Region of Manufacture': 'China',
    },
  },

  // ── 4. 情侣礼物：配套套装 ────────────────────────────────────────────
  {
    sku: 'CG-MATCH-SET',
    slug: 'matching-couples-lingerie-set',
    title: 'Matching Couples Lingerie Set — Both Pieces Included',
    subtitle: 'Coordinated two-piece set, gift-ready',
    price: 68.99,
    compareAtPrice: 84.99,
    collection: 'couples-gifts',
    summary:
      'A coordinated two-piece set — a lace-trim cami top and matching boxer briefs — sized as separate items so you can pick both sizes.',
    description:
      'Most couples sets sell you a top in your size and bottoms in the same size, which means one of you ends up wearing something that does not fit. This set is sold as two independently sized pieces. Choose your size and your partner\'s size at checkout.\n\nThe set coordinates on color and trim rather than trying to look identical, which works better when the two of you do not have the same build. The camisole has adjustable straps and a relaxed fit; the briefs have an elasticated waistband that does not roll.\n\nShips in a gift box with tissue, so it can go out as a gift without any extra wrapping.',
    highlights: [
      'Two independently sized pieces — order both sizes at checkout',
      'Coordinates on color and trim, so mixed sizes still look intentional',
      'Elasticated waistband on the briefs that does not roll',
      'Adjustable straps on the cami',
      'Gift box with tissue included',
    ],
    attributes: {
      material: '90% Nylon, 10% Spandex with lace trim',
      color: 'Burgundy',
      closure: 'Pull-on cami; elasticated waistband on briefs',
      pattern: 'Solid with lace trim',
      features: ['Two-piece set', 'Independently sized', 'Gift box', 'Lace trim'],
    },
    sizeChartId: 'standard-apparel',
    sizes: ['S', 'M', 'L', 'XL', '1X', '2X'],
    fitNote:
      'The cami has a relaxed fit. If you want it closer, size down. Briefs run true to size.',
    modelTryOn:
      'Cami: model is 5\'8" (173 cm) with a 34" bust, wearing size S. Briefs: model is 5\'11" (180 cm) with a 32" waist, wearing size M.',
    seo: {
      title: 'Matching Couples Lingerie Set | Coordinated Gift Box, Two Sized Pieces',
      description:
        'Coordinated couples lingerie set with a lace-trim cami and matching briefs. Sold as two independently sized pieces in a gift box. Ships from the US.',
      keywords: [
        'matching couples underwear',
        'couples gift set',
        'his and hers lingerie',
        'anniversary gift for him and her',
        'matching set underwear',
      ],
    },
    faqs: [
      {
        q: 'How do I order if we are different sizes?',
        a: 'The set is two independently sized pieces. Choose your size and your partner\'s size separately at checkout — you do not have to buy two sets in the same size.',
      },
      {
        q: 'Will the set look mismatched if we are different sizes?',
        a: 'No. The two pieces coordinate on color and trim rather than by identical cut, so different sizes still read as a matched set.',
      },
      {
        q: 'Does this fit in a gift box?',
        a: 'It ships in a gift box with tissue paper, ready to hand over without extra wrapping.',
      },
      {
        q: 'What occasions does this work for?',
        a: 'Anniversaries, weddings, Valentine\'s Day, and birthdays. It is also popular as a groomsman or bridesmaid-adjacent gift because the box looks considered.',
      },
    ],
    shots: [
      { id: '01', angle: 'flat-lay', brief: 'Flat lay of both pieces side by side with the gift box open', useReference: false },
      { id: '02', angle: 'hero-front', brief: 'Two models side by side, full body, neutral background', useReference: true },
      { id: '03', angle: 'detail-fabric', brief: 'Close-up of the lace trim on both pieces', useReference: true },
      { id: '04', angle: 'gift-packaging', brief: 'Closed gift box with tissue, styled for a product photo', useReference: false },
      { id: '05', angle: 'detail-hardware', brief: 'Close-up of the elasticated waistband and strap adjuster', useReference: true },
    ],
    garmentBrief:
      'a burgundy lace-trim lingerie camisole top with matching burgundy boxer briefs, coordinated couples set',
    modelId: 'm3',
    economics: { costCny: 96, weightKg: 0.31, initialQty: 50 },
    compliance: {
      fiberContent: '90% Nylon, 10% Spandex',
      countryOfOrigin: 'Made in China',
      rnNumber: RN_PLACEHOLDER,
      prop65Warning: false,
      cpscLooseGarment: false,
      careInstructions: 'Machine wash cold on a delicate cycle. Tumble dry low. Do not bleach.',
    },
    etsyAttributes: {
      whoItsFor: 'For him and her',
      whenItsNeeded: 'Anniversary',
      occasion: 'Anniversary',
      style: 'Classic',
      department: 'Women & Men',
      tags: [
        'matching couples set',
        'couples gift set',
        'his and hers underwear',
        'anniversary gift him her',
        'matching underwear set',
        'couples underwear gift',
        'wife husband gift',
        'valentines gift set',
      ],
    },
    ebaySpecifics: {
      Brand: 'LUMENCIE',
      'Material Type': 'Nylon Blend',
      Department: 'Women & Men',
      Color: 'Burgundy',
      'Size (US)': 'S|2X',
      Style: 'Camisole & Briefs',
      Pattern: 'Solid',
      'Country/Region of Manufacture': 'China',
    },
  },

  // ── 5. 家居睡衣：缎面连体衣 ──────────────────────────────────────────
  {
    sku: 'LS-SAT-BOD',
    slug: 'satin-lounge-bodysuit',
    title: 'Satin Lounge Bodysuit — Everyday Coverage',
    subtitle: 'Coverage-first bodysuit in matte satin',
    price: 38.99,
    compareAtPrice: 48.99,
    collection: 'lounge-sleepwear',
    summary:
      'A matte satin bodysuit with a full butt coverage and a modesty lining — designed to wear under clothes, not just alone.',
    description:
      'This bodysuit is built around coverage. The bottom is fully lined in a double layer, so it is genuinely opaque, and the back coverage is full enough that it can be worn under a shirt or a sweater without anything showing.\n\nThe satin is matte rather than shiny. Shiny satin reads as costume; matte reads as something you could leave the house in. It has a slight sheen in direct light but stays quiet under indoor lighting.\n\nIt works three ways: on its own at home, under a blazer for an evening out, or as a sleepwear piece. The straps adjust, the gusset is cotton-spandex with snaps, and the leg opening sits high enough to stay smooth under trousers or a skirt.',
    highlights: [
      'Fully lined — genuinely opaque, not a lined-for-show version',
      'Full back coverage, so it works under a shirt or sweater',
      'Matte satin that reads as loungewear rather than costume',
      'Adjustable straps and a cotton snap gusset',
      'High-cut leg that stays smooth under trousers',
    ],
    attributes: {
      material: '76% Polyamide, 24% Spandex; matte satin outer, cotton gusset',
      color: 'Champagne',
      closure: 'Adjustable straps; snap gusset',
      pattern: 'Solid',
      features: ['Full lining', 'Full back coverage', 'Adjustable straps', 'Snap gusset'],
    },
    sizeChartId: 'standard-apparel',
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    fitNote:
      'True to size with a close fit. Size up if you want a looser feel. The fabric stretches about 1.5 inches across the bust.',
    modelTryOn: 'Model is 5\'9" (175 cm) with a 35" bust and 27" waist, wearing size S.',
    seo: {
      title: 'Satin Lounge Bodysuit with Full Lining | Coverage-First Everyday Lingerie',
      description:
        'Matte satin bodysuit with genuine full lining, full back coverage, adjustable straps, and a cotton snap gusset. Coverage-first everyday lingerie.',
      keywords: [
        'lounge bodysuit women',
        'satin bodysuit full coverage',
        'everyday lingerie bodysuit',
        'sleepwear bodysuit',
        'wear under clothes bodysuit',
      ],
    },
    faqs: [
      {
        q: 'Is this bodysuit actually opaque?',
        a: 'Yes. The bottom is fully lined in a double layer rather than partially lined, so it is opaque when worn without additional underwear.',
      },
      {
        q: 'Can I wear it under regular clothes?',
        a: 'That is what the full back coverage and matte satin are for. It sits smooth under a shirt, sweater, or blazer without showing through.',
      },
      {
        q: 'How is the satin different from costume satin?',
        a: 'It is matte rather than high-shine. Shiny satin photographs as costume; matte satin reads as something you would wear out. It has a slight sheen in direct light.',
      },
      {
        q: 'Does it work as sleepwear?',
        a: 'Yes. The fabric is soft and the gusset is cotton-spandex, so it is comfortable for sleeping as well as for an evening out.',
      },
    ],
    shots: [
      { id: '01', angle: 'hero-front', brief: 'Front view, indoor lighting, relaxed pose', useReference: true },
      { id: '02', angle: 'on-body-seated', brief: 'Seated, showing the back coverage and the matte sheen', useReference: true },
      { id: '03', angle: 'detail-fabric', brief: 'Close-up of the matte satin surface and the gusset', useReference: true },
      { id: '04', angle: 'hero-three-quarter', brief: 'Three-quarter angle wearing a blazer over it', useReference: true },
      { id: '05', angle: 'flat-lay', brief: 'Flat lay showing the full lining', useReference: false },
    ],
    garmentBrief:
      'a champagne matte satin full-coverage bodysuit with a double-layer lining and adjustable straps',
    modelId: 'm2',
    economics: { costCny: 47, weightKg: 0.15, initialQty: 70 },
    compliance: {
      fiberContent: '76% Polyamide, 24% Spandex (gusset: 92% Cotton, 8% Spandex)',
      countryOfOrigin: 'Made in China',
      rnNumber: RN_PLACEHOLDER,
      prop65Warning: false,
      cpscLooseGarment: false,
      careInstructions: 'Machine wash cold on a delicate cycle. Hang to dry.',
    },
    etsyAttributes: {
      whoItsFor: 'For her',
      whenItsNeeded: 'Any occasion',
      occasion: 'Everyday',
      style: 'Modern',
      department: 'Women',
      tags: [
        'lounge bodysuit',
        'satin bodysuit',
        'sleepwear for women',
        'full coverage lingerie',
        'everyday lingerie',
        'wear under clothes',
        'elegant bodysuit',
        'minimalist lingerie',
      ],
    },
    ebaySpecifics: {
      Brand: 'LUMENCIE',
      'Material Type': 'Polyamide Blend',
      Department: 'Women',
      Color: 'Champagne',
      'Size (US)': 'XS|XL',
      Style: 'Bodysuit',
      Pattern: 'Solid',
      'Country/Region of Manufacture': 'China',
    },
  },

  // ── 6. 加大码：蕾丝睡衣套装 ──────────────────────────────────────────
  {
    sku: 'PS-LACE-SET',
    slug: 'plus-size-lace-sleepwear-set',
    title: 'Plus Size Lace Sleepwear Set — 1X to 3X',
    subtitle: 'Extended sizing on our standard patterns',
    price: 52.99,
    compareAtPrice: 64.99,
    collection: 'plus-size',
    summary:
      'A cami and short set in extended sizing, built on the same patterns as our standard range rather than graded up.',
    description:
      'Plus size lingerie is usually a smaller design scaled up, which puts the stress in the wrong places — straps too short, gusset too small, proportions off at the bust. These are developed as their own sizes from the start, with the same fabric and construction as the standard range.\n\nThe cami has a slightly longer torso so it does not ride up, and the gusset is sized up in both dimensions rather than just being cut from a bigger panel.\n\nExtended sizing runs 1X to 3X. If you are between standard sizes and between extended sizes, the standard range tends to fit better — going up a size changes more than the label suggests.',
    highlights: [
      '1X-3X extended sizing, developed separately from standard sizes',
      'Longer torso length so the cami does not ride up',
      'Gusset sized up in both dimensions, not just cut from a larger panel',
      'Same fabric and construction as the standard range',
      'Adjustable straps with extra-long adjustment range',
    ],
    attributes: {
      material: '88% Nylon, 12% Spandex with lace trim; cotton gusset',
      color: 'Dusty Rose',
      closure: 'Adjustable straps; pull-on bottoms',
      pattern: 'Lace trim on solid',
      features: ['Extended sizing 1X-3X', 'Extended torso length', 'Oversized gusset', 'Extra-long strap adjustment'],
    },
    sizeChartId: 'extended-apparel',
    sizes: ['1X', '2X', '3X'],
    fitNote:
      'Extended sizing runs true. If you are between a standard size and an extended size, the standard range usually fits better.',
    modelTryOn: 'Model is 5\'9" (175 cm) with a 40" bust and 36" waist, wearing size 1X.',
    seo: {
      title: 'Plus Size Lace Sleepwear Set | Extended Sizing 1X-3X, Camisole and Shorts',
      description:
        'Plus size lace sleepwear set in extended sizing 1X-3X. Longer torso, oversized gusset, adjustable straps. Extended sizing developed on its own patterns.',
      keywords: [
        'plus size lingerie set',
        'plus size sleepwear women',
        'extended size lingerie 1x 2x',
        'plus size cami set',
        'curvy women sleepwear',
      ],
    },
    faqs: [
      {
        q: 'How are the plus sizes cut?',
        a: 'They are developed as their own sizes rather than scaled up from the standard range. The torso is longer and the gusset is bigger in both dimensions.',
      },
      {
        q: 'What if I am between a standard size and an extended size?',
        a: 'Take the standard size. The jump to extended sizing changes more than the label implies — torso length, gusset volume, and strap range all change.',
      },
      {
        q: 'Is the set see-through?',
        a: 'The body is opaque. Lace trim is used at the neckline and hem only, rather than as an all-over panel.',
      },
      {
        q: 'Do the straps run short on extended sizes?',
        a: 'No. The straps have an extended adjustment range specifically for the larger torso length.',
      },
    ],
    shots: [
      { id: '01', angle: 'hero-front', brief: 'Front view of the full set, full body, neutral background', useReference: true },
      { id: '02', angle: 'hero-three-quarter', brief: 'Three-quarter angle', useReference: true },
      { id: '03', angle: 'detail-fabric', brief: 'Close-up of the lace trim and the gusset stitching', useReference: true },
      { id: '04', angle: 'on-body-seated', brief: 'Seated, showing the torso length on the cami', useReference: true },
      { id: '05', angle: 'flat-lay', brief: 'Flat lay of both pieces with the size range shown', useReference: false },
    ],
    garmentBrief:
      'a dusty rose sleepwear set with a lace-trimmed camisole top and matching high-waisted shorts, full coverage',
    modelId: 'm4',
    economics: { costCny: 72, weightKg: 0.28, initialQty: 60 },
    compliance: {
      fiberContent: '88% Nylon, 12% Spandex (gusset: 90% Cotton, 10% Spandex)',
      countryOfOrigin: 'Made in China',
      rnNumber: RN_PLACEHOLDER,
      prop65Warning: false,
      cpscLooseGarment: false,
      careInstructions: 'Machine wash cold on a delicate cycle. Hang to dry.',
    },
    etsyAttributes: {
      whoItsFor: 'For her',
      whenItsNeeded: 'Any occasion',
      occasion: 'Everyday',
      style: 'Romantic',
      department: 'Women',
      tags: [
        'plus size lingerie',
        'plus size sleepwear',
        'extended size lingerie',
        'plus size cami set',
        'curvy women sleepwear',
        'plus size lace set',
        'sleepwear set women',
        'plus size gifts',
        'plus size bodysuit',
        'lounge set plus size',
        'size 2x lingerie',
        'plus size sleepwear set',
        'cami and shorts set',
      ],
    },
    ebaySpecifics: {
      Brand: 'LUMENCIE',
      'Material Type': 'Nylon Blend',
      Department: 'Women',
      Color: 'Dusty Rose',
      'Size (US)': '1X|3X',
      Style: 'Camisole & Shorts',
      Pattern: 'Lace Trim',
      'Country/Region of Manufacture': 'China',
    },
  },

  // ── 7. 婚礼：无缝连体衣 ──────────────────────────────────────────────
  {
    sku: 'BR-SEAMLESS',
    slug: 'bridal-seamless-sculpting-bodysuit',
    title: 'Bridal Seamless Sculpting Bodysuit',
    subtitle: 'Seamless shapewear built for under a wedding dress',
    price: 62.99,
    compareAtPrice: 74.99,
    collection: 'bridal',
    summary:
      'A seamless sculpting bodysuit with a low-cut back — designed to sit under a wedding dress without showing its edges.',
    description:
      'Bridal shapewear fails in two predictable ways: it shows at the neckline, and it rolls at the waist. This bodysuit addresses both. The neckline sits low enough to stay under a scooped or V-back dress, and the waist is bonded rather than stitched so there is no horizontal band to roll.\n\nThe seams are bonded flat and the body is knit as a single piece, so nothing sits under a thin fabric. It has moderate shaping — enough to smooth under a dress, not enough to feel like a compression garment.\n\nAlso useful outside the wedding context: it works under a fitted jumpsuit or a wrap dress if you want smoothing without visible edges.',
    highlights: [
      'Bonded seams — no stitching to show under thin fabric',
      'Low-cut back for V-back and scooped dresses',
      'Waist bonded rather than stitched, so it does not roll',
      'Moderate shaping, not a compression garment',
      'Knitted as a single piece for no visible join',
    ],
    attributes: {
      material: '78% Nylon, 22% Spandex bonded knit',
      color: 'Ivory',
      closure: 'Snap gusset; no back closure',
      pattern: 'Solid',
      features: ['Bonded seams', 'Low-cut back', 'Moderate shaping', 'Snap gusset'],
    },
    sizeChartId: 'standard-apparel',
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    fitNote:
      'True to size. The shaping is moderate — if you want firm compression for a dress with no stretch, size down one.',
    modelTryOn: 'Model is 5\'10" (178 cm) with a 36" bust and 28" waist, wearing size S.',
    seo: {
      title: 'Bridal Seamless Sculpting Bodysuit | No-Show Shapewear for Wedding Dresses',
      description:
        'Seamless bridal bodysuit with bonded seams, low-cut back for V-back dresses, and a bonded waist that will not roll. Moderate shaping, not compression.',
      keywords: [
        'bridal shapewear',
        'seamless bodysuit shapewear',
        'wedding underwear',
        'no show shapewear bodysuit',
        'bridal bodysuit',
        'wedding day underwear',
      ],
    },
    faqs: [
      {
        q: 'Will it show under my wedding dress?',
        a: 'That is what it is designed for. The seams are bonded flat, the body is knit as one piece, and the edges are finished thin enough to disappear under fitted fabric.',
      },
      {
        q: 'Why is the back cut low?',
        a: 'So it stays put under V-back, scooped, or strapless dresses. A high back line would show above the dress edge.',
      },
      {
        q: 'Does the waist roll like shapewear usually does?',
        a: 'No. The waist is bonded rather than stitched, so there is no horizontal band to roll when you sit or bend.',
      },
      {
        q: 'How much shaping does this give?',
        a: 'Moderate — enough to smooth under a dress, not enough to feel like a compression garment. For a dress with no stretch at all, size down one for firmer control.',
      },
    ],
    shots: [
      { id: '01', angle: 'hero-front', brief: 'Front view, studio lighting, full body', useReference: true },
      { id: '02', angle: 'detail-fabric', brief: 'Close-up of the bonded seam at the leg opening', useReference: true },
      { id: '03', angle: 'on-body-seated', brief: 'Seated to show the bonded waist does not roll', useReference: true },
      { id: '04', angle: 'hero-three-quarter', brief: 'Three-quarter angle in an ivory dress', useReference: true },
      { id: '05', angle: 'flat-lay', brief: 'Flat lay showing the low-cut back', useReference: false },
    ],
    garmentBrief:
      'an ivory seamless sculpting bodysuit with bonded seams and a low-cut back, full coverage',
    modelId: 'm1',
    economics: { costCny: 88, weightKg: 0.22, initialQty: 55 },
    compliance: {
      fiberContent: '78% Nylon, 22% Spandex (gusset: 93% Cotton, 7% Spandex)',
      countryOfOrigin: 'Made in China',
      rnNumber: RN_PLACEHOLDER,
      prop65Warning: false,
      cpscLooseGarment: false,
      careInstructions: 'Hand wash cold. Line dry. Do not use chlorine bleach.',
    },
    etsyAttributes: {
      whoItsFor: 'For her',
      whenItsNeeded: 'Wedding',
      occasion: 'Wedding',
      style: 'Elegant',
      department: 'Women',
      tags: [
        'bridal shapewear',
        'seamless bodysuit',
        'wedding underwear',
        'bridal bodysuit',
        'no show underwear',
        'wedding day shapewear',
        'v back shapewear',
        'bridal lingerie',
        'shapewear bodysuit women',
        'wedding underdress',
        'seamless shapewear',
        'bridal bodysuit white',
        'tummy control bodysuit',
      ],
    },
    ebaySpecifics: {
      Brand: 'LUMENCIE',
      'Material Type': 'Nylon Blend',
      Department: 'Women',
      Color: 'Ivory',
      'Size (US)': 'XS|XL',
      Style: 'Shapewear Bodysuit',
      Pattern: 'Solid',
      'Country/Region of Manufacture': 'China',
    },
  },

  // ── 8. 婚礼：蜜月吊带裙 ──────────────────────────────────────────────
  {
    sku: 'BR-HONEY-CHM',
    slug: 'honeymoon-satin-slip',
    title: 'Honeymoon Satin Slip with Lace Trim',
    subtitle: 'Bias-cut satin slip for the wedding night',
    price: 54.99,
    compareAtPrice: 66.99,
    collection: 'bridal',
    summary:
      'A bias-cut satin slip with a lace hem — drapes rather than clings, so it moves the way a slip is supposed to.',
    description:
      'A bias-cut slip drapes from the diagonal, which means it moves with you instead of clinging to a straight line across the body. That difference is the whole point of a slip: it should look like fabric falling rather than fabric stretched.\n\nThe lace trim at the hem has a light scattering layer, so it is semi-sheer at the edge without being see-through across the body. The straps are convertible between straight and crisscross.\n\nPairs naturally with the bridal bodysuit as a wedding-night set, or stands alone as an occasion piece.',
    highlights: [
      'Bias cut — drapes from the diagonal instead of clinging',
      'Lace hem with a light scattering layer, semi-sheer only at the edge',
      'Convertible straps: straight or crisscross',
      'Body is opaque; the lace is only at the hem',
      'Pairs with the bridal sculpting bodysuit as a set',
    ],
    attributes: {
      material: '95% Acetate satin, 5% Spandex; nylon lace hem',
      color: 'Champagne',
      closure: 'Convertible adjustable straps',
      pattern: 'Solid with lace hem',
      features: ['Bias cut', 'Convertible straps', 'Lace hem', 'Fully opaque body'],
    },
    sizeChartId: 'standard-apparel',
    sizes: ['XS', 'S', 'M', 'L'],
    fitNote:
      'Bias cut gives more give across the body than a straight cut. Take your usual size; size down only for a closer fit.',
    modelTryOn: 'Model is 5\'7" (170 cm) with a 33" bust and 26" waist, wearing size S.',
    seo: {
      title: 'Honeymoon Satin Slip with Lace Trim | Bias-Cut Bridal Nightgown',
      description:
        'Bias-cut satin slip with a lace hem and convertible straps. Drapes rather than clings. Fully opaque body with a semi-sheer lace edge. Pairs with bridal bodysuit.',
      keywords: [
        'honeymoon slip dress',
        'satin nightgown',
        'bias cut slip',
        'bridal nightgown',
        'wedding night lingerie',
        'lace trim slip',
      ],
    },
    faqs: [
      {
        q: 'What does bias cut mean here?',
        a: 'The fabric is cut on the diagonal. It drapes from the diagonal and moves with you rather than clinging along a straight line, which is what makes a slip look like a slip.',
      },
      {
        q: 'Is the lace see-through?',
        a: 'The body of the slip is fully opaque. Only the lace hem is semi-sheer, and it has a light scattering layer so it does not read as transparent.',
      },
      {
        q: 'Can I wear the straps crossed?',
        a: 'Yes. They are convertible — straight over the shoulders or crossed at the back, which changes the neckline and back line.',
      },
      {
        q: 'Does it match the bridal bodysuit?',
        a: 'Yes, the fabric and colour are matched. Buy them together as a wedding-night set, or buy the slip on its own as an occasion piece.',
      },
    ],
    shots: [
      { id: '01', angle: 'hero-front', brief: 'Full-length front view, showing the bias drape', useReference: true },
      { id: '02', angle: 'on-body-standing', brief: 'Standing, showing how the fabric moves in motion', useReference: true },
      { id: '03', angle: 'detail-fabric', brief: 'Close-up of the lace hem and the satin surface', useReference: true },
      { id: '04', angle: 'detail-hardware', brief: 'Close-up of the convertible strap adjuster', useReference: true },
      { id: '05', angle: 'hero-three-quarter', brief: 'Three-quarter angle with the straps crossed', useReference: true },
    ],
    garmentBrief:
      'a champagne bias-cut satin slip dress with a semi-sheer lace hem, full length, fully opaque body',
    modelId: 'm2',
    economics: { costCny: 74, weightKg: 0.24, initialQty: 55 },
    compliance: {
      fiberContent: '95% Acetate, 5% Spandex (lace: 88% Nylon, 12% Spandex)',
      countryOfOrigin: 'Made in China',
      rnNumber: RN_PLACEHOLDER,
      prop65Warning: false,
      cpscLooseGarment: false,
      careInstructions: 'Hand wash cold inside out. Line dry. Do not bleach.',
    },
    etsyAttributes: {
      whoItsFor: 'For her',
      whenItsNeeded: 'Wedding',
      occasion: 'Wedding',
      style: 'Elegant',
      department: 'Women',
      tags: [
        'honeymoon slip',
        'satin nightgown',
        'bridal nightgown',
        'bias cut slip dress',
        'lace trim slip',
        'wedding night lingerie',
        'bride sleepwear',
        'elegant slip dress',
      ],
    },
    ebaySpecifics: {
      Brand: 'LUMENCIE',
      'Material Type': 'Acetate Blend',
      Department: 'Women',
      Color: 'Champagne',
      'Size (US)': 'XS|L',
      Style: 'Slip Dress',
      Pattern: 'Lace Trim',
      'Country/Region of Manufacture': 'China',
    },
  },
];

export const getProduct = (slug: string): Product | undefined =>
  PRODUCTS.find((p) => p.slug === slug);

export const getCollection = (slug: string): Collection | undefined =>
  COLLECTIONS.find((c) => c.slug === slug);

export const productsInCollection = (id: string): Product[] =>
  PRODUCTS.filter((p) => p.collection === id);