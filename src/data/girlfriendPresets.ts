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
];
