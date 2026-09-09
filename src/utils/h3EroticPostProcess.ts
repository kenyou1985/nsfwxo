/**
 * H3 R18 提示词后处理工具
 *
 * 解决后端 LLM 生成的 H3 提示词中常见的结构性问题：
 *   1. 最后一个镜头是「事后展示」而非「射精收尾」
 *   2. 射精方式单一（只出现口爆/内射）
 *   3. 多个提示词姿势雷同（都围绕同一道具）
 *   4. 缺少后入射臀部的变体
 *
 * 设计目标：
 *   - 轻量级：只做关键字段替换，不重写整段提示词
 *   - 不破坏语义：尽量保留 LLM 生成的描述细节，只强制关键约束
 *   - 与后端约束提示词配合：作为兜底
 */

// ─── 5 种射精方式模板 ─────────────────────────────────────────────────────

export const EJACULATION_METHODS = {
  /** 口爆：精液射入口腔 */
  oral: {
    name: '口爆',
    keywords: ['口爆', '口腔', '嘴里', '舔食', 'facial'], // 避免被误判
    replacement: '面部特写转胸部特写，她阴道剧烈收缩夹紧男性阴茎全身颤抖张嘴高亢尖叫达到高潮，男性从她体内抽出仍在搏动的阴茎，她立刻滑跪到他身前张开嘴伸出舌头，男性低吼着将浓稠精液射入她口腔完成唯一一次口爆，白浊精液充满口腔溢出到下巴、锁骨与裸露乳房，她用舌头舔食龟头与柱身上残留的精液并吞下大部分，剩余精液从嘴角拉丝滴落，眼神餍足潮红',
  },
  /** 内射 creampie */
  creampie: {
    name: '内射 creampie',
    keywords: ['内射', 'creampie', '阴道最深处', '体内射精'],
    replacement: '面部特写转交合处特写，男性持续猛烈抽插她阴道剧烈收缩夹紧阴茎达到高潮全身颤抖张嘴高亢尖叫，男性低吼着将浓稠精液射入她阴道最深处形成体内射精creampie，白浊精液从交合处被挤出沿大腿内侧缓缓流下，她眼神迷离潮红脸颊达到性高潮顶点',
  },
  /** 后入射臀部：背部深弓臀部高举时精液溢出 */
  backEntry: {
    name: '后入射臀部',
    keywords: ['后入', '背入', '背部', '臀部', '犬式'],
    replacement: '后方低角度镜头特写，她双手撑住靠背椅身体前倾臀部后翘呈后入姿势，男性从身后扶住她腰胯猛烈抽插，她阴道剧烈收缩夹紧阴茎全身颤抖背部深弓臀部高举张嘴高亢尖叫达到高潮，男性低吼着将浓稠精液直接射在她高举的臀部与腰窝上完成唯一一次外射，白浊精液从臀部沿大腿内侧缓缓流下与交合处溢出液混合，她眼神迷离潮红脸颊达到性高潮顶点',
  },
  /** 射胸部 */
  breast: {
    name: '射胸部',
    keywords: ['射胸', '胸部', '乳房', '乳沟'],
    replacement: '胸部特写转面部特写，男性将她翻倒在椅面上她仰躺双腿大开，男性从上方加速抽插她阴道剧烈收缩夹紧阴茎全身颤抖张嘴高亢尖叫达到高潮，男性抽出阴茎对准她裸露的乳房与胸部低吼着射出浓稠精液完成唯一一次射胸，白浊精液溅满乳房覆盖乳头沿乳沟流到腹部，她眼神迷离潮红脸颊达到性高潮顶点',
  },
  /** 颜射 facial */
  facial: {
    name: '颜射 facial',
    keywords: ['颜射', 'facial', '面部', '脸上', '脸颊'],
    replacement: '面部特写，男性将她压在椅背上从正面猛烈抽插她阴道剧烈收缩夹紧阴茎全身颤抖张嘴高亢尖叫达到高潮，男性抽出阴茎对准她张开的脸低吼着射出浓稠精液完成唯一一次颜射，白浊精液直接溅在她脸颊、额头、鼻梁与张开的舌头上，部分精液顺下巴流到锁骨与裸露乳房，她眯眼喘息舌尖舔舐嘴角精液眼神迷离潮红',
  },
};

/** 事后展示特征词（用于识别需要被替换的 last shot） */
const POST_CLIMAX_DISPLAY_KEYWORDS = [
  '事后状态', '衣衫不整', '半裸', '眼神餍足', '餍足', '靠背椅', '靠着椅',
  '额头相抵', '满足地侧眸', '动作流畅', '60fps', '无抖动', '无跳帧',
  '精液残留', '残留精液', '精液从阴道口', '滴落地板', '整理衣物',
  '整理开衫', '盖好', '擦拭', '倚靠', '事后', '余韵',
];

/** 射精关键词 */
const EJACULATION_KEYWORDS = [
  '射精', '射入', '射出', '浓稠精液', '口爆', '颜射', '内射',
  'creampie', '射胸', '射臀', '射大腿', '外射', 'facial',
  '射满', '喷洒', '白浊精液', '精液覆盖', '精液溅', '精液射',
];

/**
 * 在 H3 提示词文本中查找所有 [Shot N] 段落的位置和内容。
 * 返回 [{ index, timestamp, raw, rangeStart, rangeEnd }, ...]，按顺序排列。
 */
export function extractShots(text: string): Array<{
  index: number;
  timestamp?: string;
  raw: string;
  rangeStart: number;
  rangeEnd: number;
}> {
  const shotRegex = /\[(?:Shot|镜头)\s*(\d+)(?:\]\s*(?:At\s+[\d:.]+)?)?[^\n]*?\n([\s\S]*?)(?=\n\[(?:Shot|镜头)\s*\d+|\n*$|\n\s*overall_soundscape|\n\s*non_diegetic_music|$)/g;
  // 简单版本：按行处理
  const lines = text.split('\n');
  const shots: Array<{ index: number; timestamp?: string; raw: string; rangeStart: number; rangeEnd: number }> = [];

  let currentShot: { index: number; timestamp?: string; raw: string; rangeStart: number; rangeEnd: number } | null = null;
  let charPos = 0;

  for (const line of lines) {
    const lineStart = charPos;
    const lineEnd = charPos + line.length;
    charPos = lineEnd + 1; // +1 for \n

    const m = line.match(/^\s*\[(?:Shot|镜头)\s*(\d+)\]/);
    if (m) {
      if (currentShot) {
        shots.push(currentShot);
      }
      // Extract timestamp
      const tsMatch = line.match(/At\s+(\d+:\d+\.\d+)/);
      currentShot = {
        index: parseInt(m[1], 10),
        timestamp: tsMatch?.[1],
        raw: line,
        rangeStart: lineStart,
        rangeEnd: lineEnd,
      };
    } else if (currentShot) {
      currentShot.raw += '\n' + line;
      currentShot.rangeEnd = lineEnd;
    }
  }
  if (currentShot) shots.push(currentShot);

  return shots;
}

/**
 * 判断一段文字是否属于"事后展示"而非"射精收尾"。
 * 事后展示特征：衣衫不整、半裸靠椅背、餍足表情、精液残留事后整理等。
 */
export function isPostClimaxDisplay(text: string): boolean {
  const hasPostClimax = POST_CLIMAX_DISPLAY_KEYWORDS.some(kw => text.includes(kw));
  const hasEjaculation = EJACULATION_KEYWORDS.some(kw => text.includes(kw));
  // 有事后展示关键词但没有射精关键词 → 事后展示
  return hasPostClimax && !hasEjaculation;
}

/**
 * 判断一段文字是否包含射精描述。
 */
export function hasEjaculationContent(text: string): boolean {
  return EJACULATION_KEYWORDS.some(kw => text.includes(kw));
}

/**
 * 检测一段射精描述属于哪种射精方式。
 */
export function detectEjaculationMethod(text: string): keyof typeof EJACULATION_METHODS | null {
  // 按权重顺序检测
  if (text.includes('后入') || text.includes('犬式') || (text.includes('背部') && text.includes('臀部') && text.includes('射出'))) {
    return 'backEntry';
  }
  if (text.includes('口爆') || (text.includes('口腔') && hasEjaculationContent(text))) {
    return 'oral';
  }
  if (text.includes('内射') || text.includes('creampie') || text.includes('阴道最深处')) {
    return 'creampie';
  }
  if (text.includes('颜射') || text.includes('facial') || (text.includes('脸上') && hasEjaculationContent(text))) {
    return 'facial';
  }
  if ((text.includes('胸部') || text.includes('乳房')) && hasEjaculationContent(text)) {
    return 'breast';
  }
  return null;
}

/**
 * 为一批 H3 提示词强制分配不同的射精方式（5 种轮换 + 后入射臀部加权）。
 * 每条提示词的最后一个射精镜头会被替换为对应的方式。
 *
 * @param prompts 生成的 H3 提示词数组
 * @param seed 随机种子（保证可重现）
 * @returns 处理后的提示词数组
 */
export function diversifyEjaculationMethods(prompts: string[], seed: number = Date.now()): string[] {
  if (prompts.length === 0) return prompts;

  // 5 种射精方式的权重分布
  // 后入射臀部提到 35%（与口爆、内射并列最高）
  // 颜射 facial 20%
  // 射胸部 10%
  // 总权重 100%
  const weightedMethods: Array<{ key: keyof typeof EJACULATION_METHODS; weight: number }> = [
    { key: 'oral', weight: 22 },       // 口爆 22%
    { key: 'creampie', weight: 22 },   // 内射 22%
    { key: 'backEntry', weight: 35 },  // 后入射臀部 35%（最高权重）
    { key: 'facial', weight: 12 },     // 颜射 12%
    { key: 'breast', weight: 9 },      // 射胸部 9%
  ];

  const totalWeight = weightedMethods.reduce((s, m) => s + m.weight, 0);

  // 使用 seed-based 简单随机（保证可重现但批次间不同）
  let rngState = seed | 0;
  const nextRandom = () => {
    rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
    return rngState / 0x7fffffff;
  };

  // 为每条提示词抽取一种方式
  const assignedMethods: Array<keyof typeof EJACULATION_METHODS> = prompts.map(() => {
    let r = nextRandom() * totalWeight;
    for (const m of weightedMethods) {
      r -= m.weight;
      if (r <= 0) return m.key;
    }
    return 'oral';
  });

  // 强制约束：N>=2 时，至少出现 3 种不同的方式
  if (prompts.length >= 2) {
    const uniqueMethods = new Set(assignedMethods);
    if (uniqueMethods.size < 3) {
      // 重新分配：确保至少有 3 种
      const allKeys = weightedMethods.map(m => m.key);
      // 用顺序填充：第 0 个选 oral，第 1 个选 creampie，第 2 个选 backEntry，第 3 个选 facial，第 4 个选 breast
      for (let i = 0; i < assignedMethods.length; i++) {
        assignedMethods[i] = allKeys[i % allKeys.length];
      }
    }
  }

  // 应用到每条提示词
  return prompts.map((prompt, idx) => {
    return replaceLastShotEjaculation(prompt, assignedMethods[idx]);
  });
}

/**
 * 把 H3 提示词中最后一个 [Shot N] 段落替换为指定的射精收尾镜头。
 *
 * 行为：
 *   - 如果最后一个 shot 是事后展示 → 完全替换为指定方式的射精收尾
 *   - 如果最后一个 shot 已是射精 → 检查方式是否匹配，不匹配则替换
 *   - 如果最后一个 shot 是其他动作 → 替换为指定方式的射精收尾
 */
export function replaceLastShotEjaculation(prompt: string, methodKey: keyof typeof EJACULATION_METHODS): string {
  const method = EJACULATION_METHODS[methodKey];
  const shots = extractShots(prompt);

  if (shots.length === 0) return prompt;

  const lastShot = shots[shots.length - 1];
  const lastShotText = lastShot.raw;

  // 检查最后一段是否已是该方式的射精
  const currentMethod = detectEjaculationMethod(lastShotText);
  if (currentMethod === methodKey && hasEjaculationContent(lastShotText)) {
    // 已经是该方式的射精收尾，且不是事后展示
    if (!isPostClimaxDisplay(lastShotText)) {
      return prompt;
    }
  }

  // 提取最后一个镜头的"镜头标签"（如 `[Shot 9] At 00:26.400`）
  const headerMatch = lastShotText.match(/^\s*\[(?:Shot|镜头)\s*\d+\][^\n]*/);
  const header = headerMatch ? headerMatch[0] : `[镜头 ${lastShot.index}]`;

  // 替换最后一段为指定方式的射精收尾
  const newLastShot = `${header}\n${method.replacement}`;

  return prompt.slice(0, lastShot.rangeStart) + newLastShot + prompt.slice(lastShot.rangeEnd);
}

/**
 * 主入口：对一组 H3 R18 提示词进行强化后处理
 *
 * 处理流程：
 *   1. 强制最后一段为射精收尾（消除事后展示）
 *   2. 多条提示词分配不同的射精方式（5 种轮换）
 *
 * @param prompts 后端 LLM 生成的 H3 提示词数组
 * @returns 后处理后的提示词数组
 */
export function enforceEroticDiversity(prompts: string[]): string[] {
  if (prompts.length === 0) return prompts;

  // Step 1: 多样化射精方式（5 种轮换 + 后入射臀部加权）
  const withDiverseMethods = diversifyEjaculationMethods(prompts, Date.now());

  return withDiverseMethods;
}
