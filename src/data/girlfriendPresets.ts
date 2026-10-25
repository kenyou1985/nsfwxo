export interface GirlfriendPreset {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  characterPrompt: string;
  tags: string[];
  portraitUrl: string;
  thumbnailUrl: string;
  aspectRatio: string;
  isCustom: boolean;
  /** 数字人性别，用于按男/女分类 */
  gender: 'female' | 'male';
}

export const DEFAULT_GIRLFRIEND_PRESETS: GirlfriendPreset[] = [
  {
    id: 'yuki',
    name: 'Yuki',
    nameZh: '雪子',
    description: '日式甜美少女，粉色长发，圆润可爱',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['Japanese', 'pink hair', 'cute', 'anime style', 'soft'],
    portraitUrl:  'https://i.ibb.co/VpwBx5y7/image-20260420233214-d532d393ed650475be16d302f72f5aba.jpg',
    thumbnailUrl: 'https://i.ibb.co/VpwBx5y7/image-20260420233214-d532d393ed650475be16d302f72f5aba.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'female',
  },
  {
    id: 'zara',
    name: 'Zara',
    nameZh: '扎拉',
    description: '非洲裔超模，健康肤色，野性魅力',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['African American', 'dark skin', 'model', 'wavy hair', 'confident'],
    portraitUrl:  'https://i.ibb.co/twdKmxgk/image-20260420232851-d93bf2731e0a8bf25eb7ed216141864c.jpg',
    thumbnailUrl: 'https://i.ibb.co/twdKmxgk/image-20260420232851-d93bf2731e0a8bf25eb7ed216141864c.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'female',
  },
  {
    id: 'elena',
    name: 'Elena',
    nameZh: '艾莲娜',
    description: '东欧金发超模，碧蓝眼眸，冷艳高贵',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['European', 'blonde', 'blue eyes', 'elegant', 'pale skin'],
    portraitUrl:  'https://i.ibb.co/Q387XHHJ/IMG-8425.jpg',
    thumbnailUrl: 'https://i.ibb.co/Q387XHHJ/IMG-8425.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'female',
  },
  {
    id: 'priya',
    name: 'Priya',
    nameZh: '普莉娅',
    description: '印度混血女神，棕色肌肤，热情似火',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['Indian', 'mixed race', 'warm skin', 'exotic', 'expressive'],
    portraitUrl:  'https://i.ibb.co/sJknZK98/IMG-8424.jpg',
    thumbnailUrl: 'https://i.ibb.co/sJknZK98/IMG-8424.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'female',
  },
  {
    id: 'ling',
    name: 'Ling',
    nameZh: '灵珊',
    description: '东方古典美女，黑发如瀑，温婉知性',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['Chinese', 'black hair', 'fair skin', 'elegant', 'traditional'],
    portraitUrl:  'https://i.ibb.co/Dgzvj2vt/IMG-8281-2.jpg',
    thumbnailUrl: 'https://i.ibb.co/Dgzvj2vt/IMG-8281-2.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'female',
  },

  {
    id: 'marcus',
    name: 'Marcus',
    nameZh: '马库斯',
    description: '非裔青年男模，短寸头，白色亨利衫，阳光健气',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['Black', 'male', 'short hair', 'athletic', 'young'],
    portraitUrl: 'https://img1.baidu.com/it/u=5226118,4180468993&fm=253&fmt=auto&app=138&f=JPEG?w=500&h=752',
    thumbnailUrl: 'https://img1.baidu.com/it/u=5226118,4180468993&fm=253&fmt=auto&app=138&f=JPEG?w=500&h=752',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'male',
  },
  {
    id: 'andre',
    name: 'Andre',
    nameZh: '安德烈',
    description: '非裔成熟男模，短胡须，深色针织衫，沉稳可靠',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['Black', 'male', 'beard', 'mature', 'calm'],
    portraitUrl: 'https://img1.baidu.com/it/u=3564804728,3334345292&fm=253&fmt=auto&app=138&f=JPEG?w=500&h=750',
    thumbnailUrl: 'https://img1.baidu.com/it/u=3564804728,3334345292&fm=253&fmt=auto&app=138&f=JPEG?w=500&h=750',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'male',
  },
  {
    id: 'alexander',
    name: 'Alexander',
    nameZh: '亚历山大',
    description: '白人西装男模，深棕背头，灰绿眼，禁欲系',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['White', 'male', 'suit', 'sharp', 'elegant'],
    portraitUrl: 'https://i.loli.net/2018/09/01/5b8a1017a5212.jpg',
    thumbnailUrl: 'https://i.loli.net/2018/09/01/5b8a1017a5212.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'male',
  },
  {
    id: 'yoonjin',
    name: 'Yoonjin',
    nameZh: '允真',
    description: '韩系网红脸，黑长直，条纹针织衫，甜辣反差',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['Korean', 'Asian', 'influencer', 'black hair', 'sweet-hot'],
    portraitUrl: '/presets/yoonjin.jpg',
    thumbnailUrl: '/presets/yoonjin.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'female',
  },
  {
    id: 'haeun',
    name: 'Haeun',
    nameZh: '夏恩',
    description: '韩系清纯网红，碎花一字肩，温柔干净',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['Korean', 'Asian', 'influencer', 'floral', 'pure'],
    portraitUrl: '/presets/haeun.jpg',
    thumbnailUrl: '/presets/haeun.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'female',
  },
  {
    id: 'sua',
    name: 'Sua',
    nameZh: '秀雅',
    description: '韩系冷艳网红，黑发，黑色短上衣，精致疏离',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['Korean', 'Asian', 'influencer', 'cold', 'chic'],
    portraitUrl: '/presets/sua.jpg',
    thumbnailUrl: '/presets/sua.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'female',
  },
  {
    id: 'sofia',
    name: 'Sofia',
    nameZh: '索菲娅',
    description: '白人阳光甜心，红唇大笑，亲和力强',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['White', 'smile', 'red lips', 'sunny', 'friendly'],
    portraitUrl: '/presets/sofia.jpg',
    thumbnailUrl: '/presets/sofia.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'female',
  },
  {
    id: 'anastasia',
    name: 'Anastasia',
    nameZh: '安娜斯塔西娅',
    description: '白人冷艳系，皮草帽，浓妆，距离感',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['White', 'cold', 'fur hat', 'glam', 'distant'],
    portraitUrl: '/presets/anastasia.jpg',
    thumbnailUrl: '/presets/anastasia.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'female',
  },
  {
    id: 'claire',
    name: 'Claire',
    nameZh: '克莱尔',
    description: '白人邻家系，浅蓝上衣，素颜感，温柔',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['White', 'girl next door', 'natural', 'soft', 'gentle'],
    portraitUrl: '/presets/claire.jpg',
    thumbnailUrl: '/presets/claire.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'female',
  },

  {
    id: 'mikami',
    name: 'Mikami',
    nameZh: '三上悠亚',
    description: '日系人气女优，甜美圆脸，白色衬衫，短发感',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['Japanese', 'AV actress', 'Mikami Yua', 'sweet', 'pretty'],
    portraitUrl: '/presets/mikami.jpg',
    thumbnailUrl: '/presets/mikami.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'female',
  },
  {
    id: 'kawakita',
    name: 'Kawakita',
    nameZh: '河北彩花',
    description: '日系人气女优，清纯白衬衫，黑长直，透明感',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['Japanese', 'AV actress', 'Kawakita Saika', 'pure', 'natural'],
    portraitUrl: '/presets/kawakita.jpg',
    thumbnailUrl: '/presets/kawakita.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'female',
  },
  {
    id: 'fukada',
    name: 'Fukada',
    nameZh: '深田咏美',
    description: '日系人气女优，短发，白衬衫，冷感又魅惑',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['Japanese', 'AV actress', 'Fukada Eimi', 'short hair', 'chic'],
    portraitUrl: '/presets/fukada.jpg',
    thumbnailUrl: '/presets/fukada.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'female',
  },
  {
    id: 'hashimoto',
    name: 'Hashimoto',
    nameZh: '桥本有菜',
    description: '日系人气女优，白衬衫领带，乖巧甜美',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['Japanese', 'AV actress', 'Hashimoto Arina', 'cute', 'idol'],
    portraitUrl: '/presets/hashimoto.jpg',
    thumbnailUrl: '/presets/hashimoto.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'female',
  },
  {
    id: 'aizawa',
    name: 'Aizawa',
    nameZh: '相泽南',
    description: '日系人气女优，黑发盘发，黑色吊带，冷艳',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['Japanese', 'AV actress', 'Aizawa Minami', 'elegant', 'cold'],
    portraitUrl: '/presets/aizawa.jpg',
    thumbnailUrl: '/presets/aizawa.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'female',
  },
  {
    id: 'amatsuka',
    name: 'Amatsuka',
    nameZh: '天使萌',
    description: '日系人气女优，黑发，黑色背心，甜辣反差',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['Japanese', 'AV actress', 'Amatsuka Moe', 'sweet-hot', 'petite'],
    portraitUrl: '/presets/amatsuka.jpg',
    thumbnailUrl: '/presets/amatsuka.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'female',
  },
  {
    id: 'junho',
    name: 'Junho',
    nameZh: '俊昊',
    description: '韩国男模，黑发，白色T恤配银链，干净少年感',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['Korean', 'male model', 'young', 'clean', 'handsome'],
    portraitUrl: '/presets/junho.jpg',
    thumbnailUrl: '/presets/junho.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'male',
  },
  {
    id: 'taehyun',
    name: 'Taehyun',
    nameZh: '泰勋',
    description: '韩国男模，白色西装，手持相机，贵公子气质',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['Korean', 'male model', 'suit', 'elegant', 'handsome'],
    portraitUrl: '/presets/taehyun.jpg',
    thumbnailUrl: '/presets/taehyun.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'male',
  },
  {
    id: 'haruto',
    name: 'Haruto',
    nameZh: '阳斗',
    description: '日本男模，蓝绿针织开衫，碎花衬衫，清冷',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['Japanese', 'male model', 'fashion', 'cool', 'handsome'],
    portraitUrl: '/presets/haruto.jpg',
    thumbnailUrl: '/presets/haruto.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'male',
  },
  {
    id: 'ren',
    name: 'Ren',
    nameZh: '莲',
    description: '日本男模，白T恤，黑发，干净利落',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['Japanese', 'male model', 'white tee', 'clean', 'handsome'],
    portraitUrl: '/presets/ren.jpg',
    thumbnailUrl: '/presets/ren.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'male',
  },
  {
    id: 'momonogi',
    name: 'Momonogi',
    nameZh: '桃乃木香奈',
    description: '日系人气女优，娃娃脸，粉紫上衣，甜软',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['Japanese', 'AV actress', 'Momonogi Kana', 'doll face', 'sweet'],
    portraitUrl: '/presets/momonogi.jpg',
    thumbnailUrl: '/presets/momonogi.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'female',
  },
  {
    id: 'nanasawa',
    name: 'Nanasawa',
    nameZh: '七泽米亚',
    description: '日系人气女优，连帽特写，幼态圆眼，软萌',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['Japanese', 'AV actress', 'Nanasawa Mia', 'doll face', 'cute'],
    portraitUrl: '/presets/nanasawa.jpg',
    thumbnailUrl: '/presets/nanasawa.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'female',
  },
  {
    id: 'sakura',
    name: 'Sakura',
    nameZh: '樱空桃',
    description: '日系人气女优，甜美笑容，齐刘海，元气',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['Japanese', 'AV actress', 'Sakura Momo', 'smile', 'youthful'],
    portraitUrl: '/presets/sakura.jpg',
    thumbnailUrl: '/presets/sakura.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'female',
  },
  {
    id: 'kaede',
    name: 'Kaede',
    nameZh: '枫可怜',
    description: '日系人气女优，黑长直，冷白皮，清冷御姐',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['Japanese', 'AV actress', 'Kaede Karen', 'cool', 'elegant'],
    portraitUrl: '/presets/kaede.jpg',
    thumbnailUrl: '/presets/kaede.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'female',
  },
  {
    id: 'ogura',
    name: 'Ogura',
    nameZh: '小仓由菜',
    description: '日系人气女优，白T恤，娃娃脸，邻家感',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['Japanese', 'AV actress', 'Ogura Yuna', 'doll face', 'girl next door'],
    portraitUrl: '/presets/ogura.jpg',
    thumbnailUrl: '/presets/ogura.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'female',
  },
  {
    id: 'suzumori',
    name: 'Suzumori',
    nameZh: '凉森玲梦',
    description: '日系人气女优，蓝底特写，圆眼娃娃脸，清透',
    characterPrompt:
      'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter any defining traits.',
    tags: ['Japanese', 'AV actress', 'Suzumori Remu', 'doll face', 'clear'],
    portraitUrl: '/presets/suzumori.jpg',
    thumbnailUrl: '/presets/suzumori.jpg',
    aspectRatio: '9:16',
    isCustom: false,
    gender: 'female',
  },
];

// ─── Default anchor selection ────────────────────────────────────────────────
const DEFAULT_ANCHOR_KEY = 'nsfwxo_default_anchor_ids_v1';

export function getDefaultAnchorId(gender: 'female' | 'male'): string {
  try {
    const saved = JSON.parse(localStorage.getItem(DEFAULT_ANCHOR_KEY) || '{}');
    if (saved[gender]) return saved[gender];
  } catch {}
  return gender === 'female' ? 'kawakita' : 'marcus';
}

export function setDefaultAnchorId(gender: 'female' | 'male', id: string): void {
  try {
    const saved = JSON.parse(localStorage.getItem(DEFAULT_ANCHOR_KEY) || '{}');
    saved[gender] = id;
    localStorage.setItem(DEFAULT_ANCHOR_KEY, JSON.stringify(saved));
  } catch {}
}

export function getDefaultAnchor(gender: 'female' | 'male'): GirlfriendPreset | null {
  const id = getDefaultAnchorId(gender);
  return DEFAULT_GIRLFRIEND_PRESETS.find((p) => p.id === id)
    || DEFAULT_GIRLFRIEND_PRESETS.find((p) => p.gender === gender)
    || null;
}

export function clearDefaultAnchor(gender: 'female' | 'male'): void {
  try {
    const saved = JSON.parse(localStorage.getItem(DEFAULT_ANCHOR_KEY) || '{}');
    delete saved[gender];
    localStorage.setItem(DEFAULT_ANCHOR_KEY, JSON.stringify(saved));
  } catch {}
}
