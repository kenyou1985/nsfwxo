import type { Policy } from './types';

/**
 * 政策页内容。
 *
 * 情趣品类比普通服饰多两个要求：
 * 1. 年龄验证声明（美国 27 州已立法要求成人内容网站做年龄验证）
 * 2. 更严格的隐私承诺（品类天然涉及隐私顾虑，站点不应过度收集）
 *
 * 上线前请由律师复核以下条款，尤其是退货条款与州级消费者保护法的兼容性。
 */

export const POLICIES: Policy[] = [
  {
    slug: 'shipping',
    title: 'Shipping Policy',
    description: 'Processing times, delivery estimates, and shipping costs for all US orders.',
    updated: '2026-10-23',
    sections: [
      {
        heading: 'Processing time',
        body: 'Orders are processed within 1-2 business days. Orders placed after 1pm EST are processed the next business day. We do not ship on Sundays or US federal holidays.\n\nOrders over $59 ship free within the United States. Standard shipping is $5.99.',
      },
      {
        heading: 'Delivery estimates',
        body: 'Standard delivery takes 2-4 business days after dispatch within the contiguous United States. Delivery to Alaska, Hawaii, Puerto Rico, and other US territories takes 4-8 business days.\n\nWe ship from New Jersey. We do not ship to Canada, the United Kingdom, or Australia at this time.',
      },
      {
        heading: 'Tracking',
        body: 'A tracking number is emailed as soon as your order ships. Please allow up to 24 hours for the first scan to appear — if a label has been created but not yet scanned, your package is still in our warehouse.',
      },
      {
        heading: 'Undeliverable packages',
        body: 'If a package is returned to us as undeliverable, we will refund the full order amount less any original shipping charges. Please make sure your address is complete, including apartment and unit numbers.',
      },
    ],
  },
  {
    slug: 'returns',
    title: 'Returns & Exchanges',
    description: '30-day returns on unworn items, free return shipping, and our exchange process.',
    updated: '2026-10-23',
    sections: [
      {
        heading: 'Return window',
        body: 'You have 30 days from delivery to return any unworn item with its tags attached. Returns are accepted in original condition, unworn and unwashed. This applies to all items including sale items and gift sets.',
      },
      {
        heading: 'Return shipping',
        body: 'Return shipping is on us within the United States. We include a prepaid label in every order. If you have used your label and need a new one, contact us and we will send another.',
      },
      {
        heading: 'How to return',
        body: 'Contact care@lumencie.com with your order number and we will send a prepaid return label and the closest drop-off location. Pack the item in the original packaging if you have it, include the completed form inside the box, and drop the package off.\n\nRefunds are issued to the original payment method within 5-7 business days of the return being received and inspected at our warehouse.',
      },
      {
        heading: 'Exchanges',
        body: 'We offer free exchanges for a different size of the same item. If you need a different size, contact us with your order number and your measurements and we will reserve the replacement for you while your return is in transit. If the size you need is sold out, we will issue a full refund instead.',
      },
      {
        heading: 'Final sale items',
        body: 'For hygiene reasons, the following cannot be returned once the hygiene seal has been broken: opened bodysuits with the gusset seal removed, opened underwear, and items marked Final Sale at the time of purchase. If an item arrives damaged or faulty, contact us and we will resolve it regardless of seal status.',
      },
      {
        heading: 'Faulty or incorrect items',
        body: 'If you received a damaged item or the wrong item, contact us within 7 days of delivery with a photo. We will ship a replacement immediately at no cost, and you do not need to return the incorrect item until the replacement arrives.',
      },
    ],
  },
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    description: 'What data we collect, why, and the controls you have over it.',
    updated: '2026-10-23',
    sections: [
      {
        heading: 'What we collect',
        body: 'We collect the information needed to fulfil an order: your name, shipping address, email address, and order contents. If you create an account, we store your saved addresses and order history. If you subscribe to our list, we store your email address and subscription preferences.\n\nWe do not collect or store full payment card details. Payments are processed entirely by our payment processor.',
      },
      {
        heading: 'Why we collect it',
        body: 'Order information is used to process, ship, and support your order and to handle returns. Email address is used for order notifications and, if you opted in, for marketing. We do not sell your personal information.',
      },
      {
        heading: 'Cookies and tracking',
        body: 'We use cookies that are necessary for the site to function, such as keeping items in your cart and remembering your age verification. If you have marketing cookies enabled, we may use them to measure which campaigns bring customers in. You can disable marketing cookies in your browser settings and the site will still work fully.',
      },
      {
        heading: 'Your choices',
        body: 'You can unsubscribe from marketing email at any time using the link at the bottom of any email, and we will stop sending promotional messages within ten business days. You can request a copy of your data or ask us to delete your account by emailing care@lumencie.com.\n\nDeleting your account removes your saved addresses and marketing preferences. We are required to retain order records for tax purposes, so order history is kept in a limited form even after account deletion.',
      },
      {
        heading: 'Sharing',
        body: 'We share order information with our payment processor and our fulfillment warehouse, each of whom needs the shipping address to deliver your order. We do not share your information with advertisers or data brokers.',
      },
      {
        heading: 'Children',
        body: 'This site is intended for adults aged 18 and over and is not directed to children. We do not knowingly collect information from anyone under 18. If you believe a minor has provided us information, contact us and we will delete it.',
      },
      {
        heading: 'Contact',
        body: 'Questions about your data can be sent to care@lumencie.com. We respond to all privacy requests within 30 days.',
      },
    ],
  },
  {
    slug: 'terms',
    title: 'Terms of Service',
    description: 'The terms that apply when you buy from LUMENCIE.',
    updated: '2026-10-23',
    sections: [
      {
        heading: 'Agreement to terms',
        body: 'By using this site or placing an order, you agree to these terms. If you do not agree with them, please do not use the site. These terms are governed by the laws of the State of Delaware.',
      },
      {
        heading: 'Age requirement',
        body: 'You must be at least 18 years old to purchase from this site. By placing an order you confirm that you are 18 or older. We may cancel any order where we have reasonable grounds to believe the purchaser is not of legal age.',
      },
      {
        heading: 'Product information',
        body: 'We work to represent our products accurately, including colour, fabric, and sizing. Because our pieces are photographed in controlled lighting and screens vary, actual colour may differ slightly from the photographs. Sizing is provided as body measurements; if you are between sizes, follow the guidance on the product page rather than the size label you usually wear.',
      },
      {
        heading: 'Pricing and payment',
        body: 'Prices are shown in US dollars and exclude sales tax, which is calculated at checkout based on your shipping address. We accept the payment methods listed at checkout. If a payment is declined, your order is not placed and any authorisation hold is released by your bank.',
      },
      {
        heading: 'Intellectual property',
        body: 'All text, images, designs, and code on this site belong to LUMENCIE or its licensors. You may view the site for your own shopping purposes. You may not copy images or product photography for your own commercial use without written permission.',
      },
      {
        heading: 'Limitation of liability',
        body: 'To the fullest extent permitted by law, our total liability for any claim relating to a product or this site is limited to the amount you paid for the product in question. We are not liable for indirect or consequential damages. Nothing in these terms limits liability that cannot be limited by law, including your statutory consumer rights.',
      },
      {
        heading: 'Changes to these terms',
        body: 'We may update these terms as our business or the law changes. The date at the top of this page shows when they were last revised. Continued use of the site after a change means you accept the updated terms.',
      },
    ],
  },
  {
    slug: 'age-verification',
    title: 'Age Verification',
    description: 'This site is intended for adults aged 18 and over.',
    updated: '2026-10-23',
    sections: [
      {
        heading: '18+ only',
        body: 'This website sells intimate apparel intended for adults. By entering this site, you confirm that you are at least 18 years old and that you are legally permitted to purchase such products in your jurisdiction.',
      },
      {
        heading: 'Why we ask',
        body: 'A number of US states have enacted age verification requirements for websites that offer adult content or products intended for adults. We verify age so that we comply with those laws and so that our site is not accessible to minors.',
      },
      {
        heading: 'How verification works',
        body: 'When you first visit, we ask you to confirm your age and store that confirmation in your browser so you are not asked on every page. Our verification is designed to be as privacy-preserving as possible — we do not ask for a government ID and we do not retain a copy of one.',
      },
      {
        heading: 'If verification does not work',
        body: 'If your browser is blocking cookies or the verification page does not appear, email care@lumencie.com from an address you can receive mail at and we will help you place an order directly.',
      },
    ],
  },
];

export const getPolicy = (slug: string): Policy | undefined => POLICIES.find((p) => p.slug === slug);