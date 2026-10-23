import type { Guide } from './types';

/**
 * 指南文章（SEO + GEO 内容资产）。
 *
 * 写作原则（三条同时满足才发）：
 * 1. Google SafeSearch 不过滤 —— 用"高级感/送礼/婚礼/时尚内衣"语义，
 *    不用"情色"语义。这同时决定了广告能不能投、平台审核能不能过，
 *    所以 SEO 和投放是同一件事。
 * 2. 回答真实购买问题 —— 每篇文章对应一个买家搜索意图，
 *    而不是堆关键词。
 * 3. 带 FAQ —— 这是被 AI 购物代理引用的最短路径，
 *    FAQ 同时渲染成 FAQPage 结构化数据。
 */

export const GUIDES: Guide[] = [
  {
    slug: 'size-guide',
    title: 'Lingerie Size Guide — How to Measure and Choose',
    description:
      'Measure for lingerie in four places and match your numbers to our chart. Tables for standard and extended sizing, plus what to do when you fall between sizes.',
    body: `Getting the size right is the single biggest factor in whether you like a piece of lingerie. Sizing in this category is genuinely inconsistent across brands — a "medium" can mean anything from a 32 to a 36 band — so the most useful thing you can do is measure yourself and compare rather than going by the label size you usually wear.

## What to measure

You need four measurements. Use a soft measuring tape and keep it snug but not tight — you should be able to slip one finger underneath.

- **Bust** — around the fullest point, keeping the tape level across your back.
- **Underbust** — directly under the bust, snug. This is the number that decides a bodysuit fit and it is the one most people skip.
- **Waist** — at your natural waist, which is usually above the button of your jeans.
- **Hip** — around the widest point, roughly 8 inches below the waist.

Measure over your underwear, not bare skin. If you are measuring for a full-coverage style, a slightly thicker underwear layer will give you a more accurate result.

## How to read the chart

Our sizes run XS to XL, with extended sizing from 1X to 3X. Each row gives you the body measurement range for that size, plus the equivalent US clothing size so you can sanity-check against the label sizes you know.

The chart on our [size guide](/guides/size-guide) is the same one printed on every product page. If a product page says the fabric has about 2 inches of stretch across the bust, that means you can size down if you want a close fit. Styles listed as having less give are better taken true to size.

## When you fall between two sizes

This is where most sizing advice gets vague, so here is a specific rule for each case:

- **Between sizes on the bust but not the waist?** Follow the waist. A bodysuit that fits your waist will sit correctly on your body; a slightly roomy bust is far less noticeable than a waistband that cuts in.
- **Between sizes on the bust and waist equally?** Size up for sleepwear and lounge pieces. Size down for fitted bodysuits and shapewear, where the stretch is engineered to pull in.
- **Between a standard size and an extended size?** Take the standard size. The step up to extended sizing changes torso length, gusset volume, and strap adjustment range, not just the measurements.
- **Between 1X and 2X?** Go by hip. If you are genuinely equal between the two, 2X is the more relaxed fit through the seat.

## Why our extended sizing is cut differently

Plus size lingerie is often a smaller design scaled up, which puts the stress in the wrong places — straps end up too short, the gusset stays small, and the proportions sit wrong through the bust.

Our extended sizes are drafted as their own sizes from the first pattern. The torso is longer so the top does not ride up. The gusset is drafted larger in both dimensions rather than cut from a larger panel of standard fabric. The straps have an extended adjustment range.

If you have previously had to sew your straps shorter, you will not need to here.

## If you still get it wrong

We accept returns within 30 days, unworn with the tags attached, and the return shipping is on us. Sizing mistakes happen to everyone in this category — a photo of the item with a tape measure is fine to include with your return, but it is not required.

If you are on the fence between two sizes and want a second opinion, send us your four measurements to care@lumencie.com and we will tell you which one we would pick.`,
    faqs: [
      {
        q: 'How do I measure my underbust?',
        a: 'Run a soft tape directly under the bust, snug but not tight, keeping it level across your back. This is the measurement that decides a bodysuit fit and the one most people skip.',
      },
      {
        q: 'Should I size up or size down if I am between sizes?',
        a: 'Follow your waist if the bust is the only size you fall between. For sleepwear and lounge pieces size up; for fitted bodysuits and shapewear size down. If you are equal between sizes on both bust and waist, follow the product page note on fabric stretch.',
      },
      {
        q: 'What is the difference between your 1X and my usual US 18?',
        a: 'Our extended sizes are drafted as their own sizes rather than scaled up from the standard range, so they have a longer torso, a larger gusset, and extended strap adjustment. This is why we recommend the standard size if you fall between a standard and an extended size.',
      },
      {
        q: 'How do I return an item that does not fit?',
        a: 'Returns are accepted within 30 days, unworn with tags attached, and we cover the return shipping. A photo of the item with a tape measure is welcome but not required.',
      },
    ],
    related: ['gift-guide', 'bridal-underwear-guide'],
  },
  {
    slug: 'gift-guide',
    title: 'What to Buy as a Lingerie Gift (Without Guessing)',
    description:
      'How to choose lingerie as a gift: picking a size without asking, which styles suit which occasions, and making the packaging carry the presentation.',
    body: `Lingerie is one of the best gifts you can give someone and one of the hardest to buy for someone else. The difficulty is almost always the size. If you are buying for a partner and do not want to ask directly, this guide will tell you what to do.

## If you do not know the size

There are two honest options, and both are better than guessing.

**Look at what they already own.** Lingerie is usually kept, and underwear sizes are printed on the waistband of briefs. A quick look in a drawer tells you more than any amount of guessing. Note the size and convert: our S is roughly a US 4–6, M is 8–10, L is 12–14, and XL is 16–18.

**Buy a size you are confident about and a gift card for the rest.** This sounds like a cop-out and it is not. The gift card removes the risk entirely, and you can pair it with something that is size-flexible — a robe, a slip, or one of our gift sets, where the top and bottom are sized separately.

## Which style suits which occasion

**Anniversary or a general milestone** — a coordinated set in one color. The [matching couples set](/products/matching-couples-lingerie-set) is built for this because the two pieces are sized independently, so a size mismatch does not spoil the effect.

**A wedding or engagement** — something that works under a dress. Our [bridal bodysuit](/products/bridal-seamless-sculpting-bodysuit) has bonded seams and a low-cut back specifically so it stays hidden under a fitted gown. This is a more useful gift than something beautiful that cannot be worn on the day.

**Halloween** — costume-adjacent intimates are the easiest lingerie gift to get right, because the sizing tolerance is wider and nobody expects a costume to be their exact everyday size.

**"Something for her, no occasion"** — a slip or a lounge bodysuit in a neutral color. These are the hardest to wear and the easiest to buy wrong on fit, so we make the sizing charts unusually explicit.

## Colors and shades

Black and burgundy are the safe choices and rarely fail. If you know she likes a specific color, that is better information than anything else — but if you are inferring, note that champagne and ivory photograph very differently from how they look in a shop, and our product photos are shot to match.

Avoid white if you are buying for a wedding and want it worn under a white dress, and consider the fabric: matte satin reads as loungewear, shiny satin reads as costume.

## Packaging does most of the work

The presentation is doing more work than the garment when the recipient does not know what the gift is. Every set ships in a gift box with tissue paper. The [couples set](/products/matching-couples-lingerie-set) is packed to be handed over directly, and the [Halloween maid set](/products/halloween-french-maid-set) is boxed the same way.

## The one thing to check

Fabric content and care. A gift that cannot be washed easily becomes a gift that stays in a drawer. Everything we make is machine washable on a delicate cycle or hand washable, and the care instructions are printed on the label and on every product page — so if your recipient is not going to hand-wash something, check the note before you order.`,
    faqs: [
      {
        q: 'How do I buy lingerie as a gift without knowing the size?',
        a: 'Check the waistband of underwear they already own, or pair a gift card with a size-flexible piece such as a robe or slip. Avoid guessing between two sizes — that is the most common way a lingerie gift goes wrong.',
      },
      {
        q: 'What is a good lingerie gift for a wedding?',
        a: 'Something that can be worn under the dress. Our bridal bodysuit has bonded seams and a low-cut back so it stays hidden under a fitted gown, which makes it far more useful than a piece that cannot be worn on the day.',
      },
      {
        q: 'Are your gift sets ready to give without extra wrapping?',
        a: 'Yes. Sets ship in a gift box with tissue paper, so they can be handed over directly.',
      },
      {
        q: 'What colors are safest for a lingerie gift?',
        a: 'Black and burgundy are the reliable choices. If you are inferring rather than knowing, avoid white for a bride and note that matte satin reads as loungewear while shiny satin reads as costume.',
      },
    ],
    related: ['size-guide', 'bridal-underwear-guide'],
  },
  {
    slug: 'bridal-underwear-guide',
    title: 'Bridal Underwear Guide: What to Wear Under the Dress',
    description:
      'What to wear under a wedding dress: shapewear that will not show through, lingerie for after the ceremony, and how to handle the outfit change.',
    body: `The best bridal underwear is the set you barely think about during the ceremony and are glad to be wearing during the reception. This guide covers what to wear, what to avoid, and how to handle the outfit change.

## Shapewear that will not show through

Two details decide whether shapewear works under a wedding dress: the seams and the waist.

A stitched seam will show through a fitted or thin fabric, particularly under a skirt in daylight. Bonded seams lie flat and disappear. Our [bridal bodysuit](/products/bridal-seamless-sculpting-bodysuit) is knitted as a single piece with bonded edges, which is why it works under satin and under a smooth crepe.

The waist is the other problem. Almost all shapewear has a horizontal stitched band at the waist, and it is the first thing to roll when you sit down during a three-hour ceremony. A bonded waist has no band to roll. If you have had a waistband roll on you before, this is the specific detail to check.

## Matching the neckline

A shapewear neckline that shows above the dress edge is the most common bridal underwear mistake.

- **V-neck or scoop** — needs a low-cut back. Our bodysuit sits below the shoulder blade for exactly this reason.
- **Strapless** — needs a bodysuit or a bra with no back straps, and it needs to stay put without them. There is no shoulder to hold it in place, so the bodysuit format does more work.
- **Halter** — high or mid-back is fine; you have shoulder coverage to work with.
- **Boat neck or off-shoulder** — a full-coverage bodysuit works and shows nothing.

## Shaping: moderate is usually enough

There is a temptation to buy the firmest compression possible. It is usually a mistake. Firm compression on a day you are on your feet for eight hours gets uncomfortable, and you will spend the reception thinking about it rather than the photographs.

Moderate shaping smooths under a dress. Firm compression is only worth it if the dress itself has no stretch — a fully structured gown with no give. In that case, size down one for control. Otherwise take your normal size.

## Lingerie for after the ceremony

Most brides change into a reception outfit. If you are planning to change, a great set of underwear makes the change a lot more pleasant — and it is the single most thoughtful thing you can put in a bridal gift.

We build the [honeymoon satin slip](/products/honeymoon-satin-slip) for this. Bias-cut so it drapes rather than clings, fully opaque through the body with lace only at the hem, convertible straps so it works with a low-back dress.

A detail worth knowing: if you are changing into a second outfit, wear the same underwear underneath it. A second outfit with its own underwear means two layers at the waist, which is how the roll happens. Bring the shapewear off and put on a fresh layer instead.

## The bridal gift question

If someone else is buying for you, a bridal lingerie set is a genuinely good gift, and it is easier to get right than shapewear because the sizing tolerance is wider and the wear is a single occasion rather than every day. Our [French maid gift set](/products/halloween-french-maid-set) is the same box-set construction if you want something with more personality.

## What to avoid

- **Anything with a waistband seam under a fitted skirt.** It will roll, and it will do it in the photographs.
- **Shapewear in a colour that shows through.** Ivory and nude are the safe choices. White under a white dress will read as a line.
- **Novelty pieces with hard hardware under the dress.** A metal charm or a rigid buckle will mark the fabric and can scratch.`,
    faqs: [
      {
        q: 'How do I stop shapewear from showing under my wedding dress?',
        a: 'Choose bonded seams and a bonded waist. Stitched seams show through thin or fitted fabric, and a stitched waistband is the first thing to roll when you sit. A knitted bodysuit with bonded edges is the safest option.',
      },
      {
        q: 'Should I size down for bridal shapewear?',
        a: 'Only if your dress has no stretch at all. Moderate shaping smooths under a dress without being uncomfortable over eight hours. If the gown is fully structured, size down one for firmer control; otherwise take your normal size.',
      },
      {
        q: 'What underwear should I wear to change into a reception outfit?',
        a: 'Wear the same underwear underneath the second outfit rather than adding a second layer — two layers at the waist is how rolling happens. Bring the shapewear off and replace it with a fresh underwear layer instead.',
      },
      {
        q: 'Does the bridal bodysuit work under a strapless dress?',
        a: 'Yes. A bodysuit format works better under a strapless dress than a bra, because it has no straps to let down and stays in place without shoulder support. The low-cut back also keeps it hidden under V-neck and scoop styles.',
      },
    ],
    related: ['size-guide', 'gift-guide'],
  },
];

export const getGuide = (slug: string): Guide | undefined => GUIDES.find((g) => g.slug === slug);