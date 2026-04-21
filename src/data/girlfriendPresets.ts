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
}

export const DEFAULT_GIRLFRIEND_PRESETS: GirlfriendPreset[] = [
  {
    id: 'yuki',
    name: 'Yuki',
    nameZh: '雪子',
    description: '日式甜美少女，粉色长发，圆润可爱',
    characterPrompt:
      '1girl, same face as reference, same as reference, character consistency, preserve identity, high quality, detailed, portrait, 9:16 vertical composition',
    tags: ['Japanese', 'pink hair', 'cute', 'anime style', 'soft'],
    portraitUrl:  'https://i.ibb.co/VpwBx5y7/image-20260420233214-d532d393ed650475be16d302f72f5aba.jpg',
    thumbnailUrl: 'https://i.ibb.co/VpwBx5y7/image-20260420233214-d532d393ed650475be16d302f72f5aba.jpg',
    aspectRatio: '9:16',
    isCustom: false,
  },
  {
    id: 'zara',
    name: 'Zara',
    nameZh: '扎拉',
    description: '非洲裔超模，健康肤色，野性魅力',
    characterPrompt:
      '1girl, same face as reference, same as reference, character consistency, preserve identity, high quality, detailed, portrait, 9:16 vertical composition',
    tags: ['African American', 'dark skin', 'model', 'wavy hair', 'confident'],
    portraitUrl:  'https://i.ibb.co/twdKmxgk/image-20260420232851-d93bf2731e0a8bf25eb7ed216141864c.jpg',
    thumbnailUrl: 'https://i.ibb.co/twdKmxgk/image-20260420232851-d93bf2731e0a8bf25eb7ed216141864c.jpg',
    aspectRatio: '9:16',
    isCustom: false,
  },
  {
    id: 'elena',
    name: 'Elena',
    nameZh: '艾莲娜',
    description: '东欧金发超模，碧蓝眼眸，冷艳高贵',
    characterPrompt:
      '1girl, same face as reference, same as reference, character consistency, preserve identity, high quality, detailed, portrait, 9:16 vertical composition',
    tags: ['European', 'blonde', 'blue eyes', 'elegant', 'pale skin'],
    portraitUrl:  'https://i.ibb.co/Q387XHHJ/IMG-8425.jpg',
    thumbnailUrl: 'https://i.ibb.co/Q387XHHJ/IMG-8425.jpg',
    aspectRatio: '9:16',
    isCustom: false,
  },
  {
    id: 'priya',
    name: 'Priya',
    nameZh: '普莉娅',
    description: '印度混血女神，棕色肌肤，热情似火',
    characterPrompt:
      '1girl, same face as reference, same as reference, character consistency, preserve identity, high quality, detailed, portrait, 9:16 vertical composition',
    tags: ['Indian', 'mixed race', 'warm skin', 'exotic', 'expressive'],
    portraitUrl:  'https://i.ibb.co/sJknZK98/IMG-8424.jpg',
    thumbnailUrl: 'https://i.ibb.co/sJknZK98/IMG-8424.jpg',
    aspectRatio: '9:16',
    isCustom: false,
  },
  {
    id: 'ling',
    name: 'Ling',
    nameZh: '灵珊',
    description: '东方古典美女，黑发如瀑，温婉知性',
    characterPrompt:
      '1girl, same face as reference, same as reference, character consistency, preserve identity, high quality, detailed, portrait, 9:16 vertical composition',
    tags: ['Chinese', 'black hair', 'fair skin', 'elegant', 'traditional'],
    portraitUrl:  'https://i.ibb.co/Dgzvj2vt/IMG-8281-2.jpg',
    thumbnailUrl: 'https://i.ibb.co/Dgzvj2vt/IMG-8281-2.jpg',
    aspectRatio: '9:16',
    isCustom: false,
  },
];
