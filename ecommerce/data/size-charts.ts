import type { SizeChart } from './types';

/**
 * 尺码表。
 *
 * 情趣内衣是本类目退货率的第一杀手（行业普遍 20%+），尺码数据是压到 10% 以内
 * 最有效的手段。原则：
 * 1. 给英制 + 公制双标注（美国买家只认英寸，但国际买家需要换算）
 * 2. 给"等同于普通服装尺码"的对照，避免买家在 XS 与 0 之间纠结
 * 3. 给明确的选码规则，而不是丢一张表格让买家自己猜
 */

export const SIZE_CHARTS: SizeChart[] = [
  {
    id: 'standard-apparel',
    title: 'Standard Sizing (XS–XL)',
    intro:
      'Measurements are body measurements, not garment measurements. Measure over your underwear, keeping the tape level and snug but not tight. If you are between two measurements, follow the hip measurement for bottoms and the bust measurement for tops.',
    columns: [
      { key: 'label', label: 'Size' },
      { key: 'bust', label: 'Bust' },
      { key: 'underbust', label: 'Underbust' },
      { key: 'waist', label: 'Waist' },
      { key: 'hip', label: 'Hip' },
      { key: 'weightLbs', label: 'Weight (lb)' },
      { key: 'equivalent', label: 'Equivalent to' },
    ],
    rows: [
      { label: 'XS', bust: '30–31 in', underbust: '26–27 in', waist: '23–24 in', hip: '33–34 in', weightLbs: '90–115 lb', equivalent: 'US 0–2' },
      { label: 'S', bust: '32–33 in', underbust: '28–29 in', waist: '25–26 in', hip: '35–36 in', weightLbs: '115–140 lb', equivalent: 'US 4–6' },
      { label: 'M', bust: '34–35 in', underbust: '30–31 in', waist: '27–28 in', hip: '37–38 in', weightLbs: '140–165 lb', equivalent: 'US 8–10' },
      { label: 'L', bust: '36–38 in', underbust: '32–34 in', waist: '29–31 in', hip: '39–41 in', weightLbs: '165–190 lb', equivalent: 'US 12–14' },
      { label: 'XL', bust: '39–41 in', underbust: '35–37 in', waist: '32–34 in', hip: '42–44 in', weightLbs: '190–215 lb', equivalent: 'US 16–18' },
    ],
    tips: [
      'Measure your underbust — the band directly under the bust, snug but not tight. This matters more than the bust measurement for anything with a bodysuit fit.',
      'Measure your hip at the widest point, roughly 8 inches below the waist. This is the number most people underestimate.',
      'If you are between sizes, size up for sleepwear and lounge pieces, and size down for fitted bodysuits where you want a close fit.',
      'Fabric stretch varies by style. Each product page lists how much give the fabric has — styles listed as "about 2 inches of stretch" will size down more easily.',
      'Between a standard size and an extended size? Take the standard size. The jump to extended sizing changes torso length and gusset volume, not just the measurements.',
    ],
    measures: [
      { key: 'bust', label: 'Bust', unit: 'in' },
      { key: 'underbust', label: 'Underbust', unit: 'in' },
      { key: 'waist', label: 'Waist', unit: 'in' },
      { key: 'hip', label: 'Hip', unit: 'in' },
    ],
  },
  {
    id: 'extended-apparel',
    title: 'Extended Sizing (1X–3X)',
    intro:
      'Extended sizing here is developed on its own patterns rather than scaled up from the standard range — longer torso, larger gusset, extended strap adjustment. Measure the same way as the standard chart: body measurements, snug but not tight.',
    columns: [
      { key: 'label', label: 'Size' },
      { key: 'bust', label: 'Bust' },
      { key: 'underbust', label: 'Underbust' },
      { key: 'waist', label: 'Waist' },
      { key: 'hip', label: 'Hip' },
      { key: 'weightLbs', label: 'Weight (lb)' },
      { key: 'equivalent', label: 'Equivalent to' },
    ],
    rows: [
      { label: '1X', bust: '40–42 in', underbust: '36–38 in', waist: '34–36 in', hip: '45–47 in', weightLbs: '215–245 lb', equivalent: 'US 18–20' },
      { label: '2X', bust: '43–45 in', underbust: '39–41 in', waist: '37–39 in', hip: '48–50 in', weightLbs: '245–275 lb', equivalent: 'US 20–22' },
      { label: '3X', bust: '46–48 in', underbust: '42–44 in', waist: '40–42 in', hip: '51–53 in', weightLbs: '275–305 lb', equivalent: 'US 24–26' },
    ],
    tips: [
      'Extended sizes are cut longer through the torso, not just wider. Most standard sleepwear rides up on a longer torso — these do not.',
      'The gusset is sized up in both dimensions. Gussets cut from a larger panel of standard fabric stay uncomfortable; ours are drafted larger.',
      'Straps have an extended adjustment range. If you have been shortening straps by sewing them in previous purchases, you will not need to here.',
      'Between 1X and 2X? Go by hip. If you are roughly equal between the two, 2X gives a more relaxed fit through the seat.',
      'Between a standard XL and a 1X? Take the standard XL. The step up to extended sizing changes more than the measurements suggest.',
    ],
    measures: [
      { key: 'bust', label: 'Bust', unit: 'in' },
      { key: 'underbust', label: 'Underbust', unit: 'in' },
      { key: 'waist', label: 'Waist', unit: 'in' },
      { key: 'hip', label: 'Hip', unit: 'in' },
    ],
  },
];

export const getSizeChart = (id: string): SizeChart | undefined =>
  SIZE_CHARTS.find((c) => c.id === id);