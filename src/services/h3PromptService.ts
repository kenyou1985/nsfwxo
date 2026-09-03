/**
 * MiniMax-H3 提示词引擎（中文版）
 *
 * 官方文档: https://github.com/MiniMax-AI/MiniMax-H3
 * Ref2VA Skill: https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/SKILL.md
 * Ref2VA 模板: https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/references/ref-en.txt
 *
 * Ref2VA 六段式结构:
 *   subject_definitions / summary / retention_analysis /
 *   detailed_description / overall_soundscape / non_diegetic_music
 *
 * 分镜结构（6段式）:
 *   1. 出场 (Entrance) - 角色登场，自然入场
 *   2. 前戏 (Foreplay) - 调情、抚摸、接吻等前戏动作
 *   3. 剧情发展 (Plot Development) - 场景描写、情感互动
 *   4. 激情开始 (Passion Begins) - 亲密动作升级
 *   5. 高潮性爱 (Peak/Sex) - 各种姿势、多种体验（口交、自慰、颜射等）
 *   6. 收尾 (Conclusion) - 激情收尾、情感余韵
 */

// ─── Theme detection & fallback ─────────────────────────────────────────────────

/** 6段式分镜模板：出场 → 前戏 → 剧情 → 激情开始 → 高潮性爱 → 收尾
 *
 * R18 6段式详细结构：
 * 1. 出场 (Entrance) - 角色入场、衣物开始褪去，自然展示身体
 * 2. 前戏 (Foreplay) - 调情、抚摸、接吻、口交开始、自慰
 * 3. 剧情发展 (Plot Development) - 深入口交、颜射前戏、姿势变换
 * 4. 激情开始 (Passion Begins) - 多种姿势性爱、激情互动
 * 5. 高潮性爱 (Peak/Sex) - 颜射、多姿势高潮、极限体验
 * 6. 收尾 (Conclusion) - 激情收尾、颜射后表情、情感余韵
 */
const R18_SIX_SEGMENT_TEMPLATES = [
  // Segment 1: 出场 - 角色入场、衣物开始褪去
  {
    segment: 'entrance',
    description: '镜头开场，角色以自信诱惑的姿态走入画面，身着精致蕾丝内衣或部分裸露。她以慵懒的步态移动，与镜头进行强烈的眼神接触，嘴唇亮泽微张。角色开始缓慢脱去剩余衣物，露出裸露肌肤，丰满坚挺的乳房，粉嫩乳头，光滑大腿，私密部位因性兴奋而湿润发亮。撩人的自信微笑转变为诱惑的神情。',
    framing: '全景建立镜头，展示衣物被褪去时的全身姿态',
    audio: '柔和的氛围音乐，衣服窸窣声，呼吸声渐起',
  },
  // Segment 2: 前戏 - 调情、口交开始、自慰
  {
    segment: 'foreplay',
    description: '角色开始亲密的前戏，自慰挑逗。手指沿着大腿内侧游走，接近私密部位，用缓慢的圆周动作按压阴蒂。一只手揉捏丰满的乳房，用拇指和食指拧弄坚挺的乳头。双眼紧闭沉浸在强烈的快感中，嘴巴张开发出轻柔的呻吟声，性玩具被引入。角色对自己进行口交动作或摆出与伴侣互动的姿势。',
    framing: '中景镜头捕捉亲密自慰和前戏细节',
    audio: '湿润的性兴奋声音，渐强的急促呼吸，隐约可闻的亲密接触声',
  },
  // Segment 3: 剧情发展 - 深入口交、颜射准备
  {
    segment: 'plot',
    description: '场景发展，角色处于亲密姿势，进行激情口交。头部有节奏地上下移动，嘴唇环绕阴茎拉伸，深喉动作使喉部明显鼓起。每次上抽时舌头绕着龟头打转。角色以顺从的眼神向上看，眼角泛起泪光。场景过渡到颜射准备——嘴巴大开，舌头伸出，摆好接收精液的姿势。',
    framing: '特写镜头追踪激烈的口交动作和颜射准备',
    audio: '湿润的吸吮声，混合呻吟的作呕时刻，激情感叹声',
  },
  // Segment 4: 激情开始 - 多种姿势性爱开始
  {
    segment: 'passion_begins',
    description: '动作升级为多种性交姿势。角色从站立口交过渡到后背式，背部深弓，臀部高举，镜头从后方捕捉插入。然后转为传教士式，双腿大开环抱伴侣，乳房随着每次抽插弹跳。继而是女上位，角色以向上臀部滚动配合向下冲击的节奏骑乘，大腿用力控制节奏和深度。每个姿势都展示全身动作和镜头角度变化。',
    framing: '动态特写镜头追踪姿势变换和激情性爱',
    audio: '达到峰值的响亮呻吟，有节奏的肉体拍打声，湿润的插入声，激情叫喊',
  },
  // Segment 5: 高潮性爱 - 颜射、多姿势高潮、极限体验
  {
    segment: 'peak_sex',
    description: '场景高潮展现强烈的高潮瞬间。角色接受颜射——白色精液射在脸上，部分溅入张开的嘴巴和伸出的舌头，部分顺着脸颊滴落到乳房上。双眼紧闭，脸被可见的白色精液覆盖，带着惊讶而愉悦的表情。极限特写展示精液覆盖的嘴唇，舌尖舔舐手指上的精液，吞咽时眼睛直视镜头。场景继续更多的激情性爱，额外的射精，多姿势变换，角色达到多次强烈高潮，身体痉挛。',
    framing: '亲密极限特写捕捉射精冲击、精液覆盖面容和高潮表情',
    audio: '达到最大音量的强烈呻吟，激情感叹声，湿润的声音，最终释放声',
  },
  // Segment 6: 收尾 - 激情收尾、颜射后表情、情感余韵
  {
    segment: 'conclusion',
    description: '场景收尾，角色全身被精液覆盖，脸上一片白色精液，疲惫而满足地深呼吸。角色的眼睛慢慢睁开，直视镜头带着满足幸福的表情。一只手擦去眼中的精液，另一只手舔舐手指上残留的精液。身体因完全满足而瘫倒，肌肉放松。最后的镜头展示精液覆盖的身体、私密部位、满足疲惫的面容——所有都以亲密细腻的镜头捕捉，展现完全满足的状态。',
    framing: '中景镜头捕捉精液覆盖后的状态和完全满足感',
    audio: '满足的深呼吸，渐弱的轻柔呻吟，氛围音恢复',
  },
];

/** Known theme keywords for detecting the user's original subject.
 *  Used as a safety net: if the LLM drifts off-theme (e.g., yoga input →
 *  adult content), we detect the mismatch and replace with theme-appropriate
 *  shot descriptions instead of propagating the drift downstream. */
const _THEME_KEYWORDS: Array<{ keywords: string[]; theme: string; safeSegments: string[] }> = [
  {
    keywords: ['yoga', '瑜伽', '瑜伽服', 'yoga mat', '瑜伽垫', 'downward dog', 'warrior', '瑜伽教室', 'yoga studio', '瑜伽动作', '瑜伽姿势'],
    theme: 'yoga',
    safeSegments: [
      '一位身穿紧身瑜伽运动内衣和黑色瑜伽leggings的女性，站在阳光充足的瑜伽教室里，落地镜前，缓慢流畅地从下犬式过渡到战士二式，双臂伸展，目光向前',
      '女性流畅过渡到战士三式，身体水平伸展，双臂向前向后伸展，核心肌群发力，一条腿抬起与地面平行',
      '她进入树式，单腿站立，另一只脚贴在大腿内侧，双臂举过头顶，手指张开，脊柱拉长，表情平静专注',
      '完成序列后，降低到婴儿式，膝盖折叠在身下，额头放在垫子上，双臂向前伸展，深深的呼气，身体完全放松进入伸展',
    ],
  },
  {
    keywords: ['massage', '按摩', 'spa', 'massage table', '按摩床', '按摩师', '按摩油', 'massage therapist', 'masseuse'],
    theme: 'massage',
    safeSegments: [
      '一位身穿白色制服的按摩师站在铺着新鲜白色亚麻布的木质按摩床旁，用长流手法将温热的按摩油涂抹在客户裸露的背部',
      '按摩师的手深入肩部肌肉，拇指以圆周运动按压和旋转，释放斜方肌和上背部的紧张感，温暖的氛围灯光',
      '长流手法继续沿背部向下，手掌平贴，压力渐缓进入腰部，客户呼吸缓慢放松，背景中有水疗氛围音乐',
      '疗程以轻柔的抚摸结束，抚过整个背部，温热的毛巾覆盖客户身体，按摩师的手以最后的放松动作顺滑地抚过织物',
    ],
  },
  {
    keywords: ['chef', 'cooking', '厨房', '厨师', 'cook', 'baking', 'oven', '炉子', '厨房', 'frying', '切菜'],
    theme: 'cooking',
    safeSegments: [
      '一位身穿白色双排扣厨师外套和高帽的主厨站在不锈钢厨房操作台旁，用锋利的厨师刀在砧板上精准地摇滚式切割新鲜蔬菜',
      '主厨的手将切好的蔬菜转入热锅中，橄榄油滋滋作响，另一只平底锅里搅拌酱汁，蒸汽升起，大蒜和香草的香气弥漫厨房',
      '主厨熟练地将成品装盘，将蛋白质和蔬菜艺术地摆放在白色陶瓷盘中，以酱汁和新鲜香草点缀收尾，手稳而自信',
      '主厨擦拭操作台，在水槽洗手，在温暖厨房的灯光下欣赏摆在出餐台的盘子，脸上露出满意的微笑',
    ],
  },
  {
    keywords: ['office', '办公室', 'desk', '电脑', 'computer', 'work', '打字', 'typing', '开会', 'meeting room', '写字楼'],
    theme: 'office',
    safeSegments: [
      '一位身穿专业西装外套和短裙的女性坐在现代玻璃台面办公桌前，手指在背光键盘上快速打字，多个显示器展示电子表格和文档，附近一杯咖啡冒着热气',
      '她靠在人体工学椅背上，用鼠标滚动画面，短暂瞥一眼手机，然后回到屏幕，表情专注，置身于明亮的办公室荧光灯下',
      '她站起来，走到俯瞰城市天际线的窗边，双臂举过头顶伸展身体，然后回到办公桌前加入视频会议，对着摄像头清晰专业地讲话，带着职业微笑',
      '她从抽屉里取出一叠文件，用回形针别好，放入皮革公文包，发出满意的咔哒声，然后关闭显示器，朝办公室门口走去',
    ],
  },
];

/** Detect the theme from imagePrompt text. Returns the matched theme entry or null. */
function _detectTheme(imagePrompt: string): { keywords: string[]; theme: string; safeSegments: string[] } | null {
  if (!imagePrompt) return null;
  const lower = imagePrompt.toLowerCase();
  for (const entry of _THEME_KEYWORDS) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        return entry;
      }
    }
  }
  return null;
}

/** Check whether sceneDescription is plausibly consistent with the detected theme.
 *  Returns false if the LLM has drifted to unrelated content. */
function _isThemeConsistent(sceneDescription: string, themeEntry: { keywords: string[] } | null): boolean {
  if (!themeEntry || !sceneDescription) return true;
  const lower = sceneDescription.toLowerCase();
  const hasMatch = themeEntry.keywords.some(kw =>
    lower.includes(kw.toLowerCase())
  );
  return hasMatch;
}

export interface H3Shot {
  /** 镜头序号，从 1 开始 */
  index: number;
  /** 镜头时间戳，如 "00:00.000"，第一个镜头不写时间戳 */
  timestamp?: string;
  /** 镜头描述 */
  description: string;
}

export interface H3PromptOptions {
  /** 参考图片 URL（最多 9 张） */
  imageUrls?: string[];
  /** 参考图片对应的角色/主体描述，顺序对应 <Picture 1>..<Picture N> */
  subjectDescriptions?: string[];
  /** 视频总时长（秒），默认 15 */
  duration?: number;
  /** 是否 R18 内容 */
  r18?: boolean;
  /** 场景/剧情描述，用于生成 summary 和 detailed_description */
  sceneDescription?: string;
  /** 用户原始图片提示词 */
  imagePrompt?: string;
  /** 镜头列表（可选，不提供则自动生成分镜） */
  shots?: H3Shot[];
  /** 附加整体声音描述 */
  soundscape?: string;
  /** 附加背景音乐描述 */
  music?: string;
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/** 计算分镜数量（基于时长和内容类型）
 * R18 内容固定使用 6 段式结构
 * 普通内容根据时长决定
 */
function computeShotCount(duration: number, r18: boolean): number {
  if (r18) {
    // R18 内容固定 6 段式：出场 → 前戏 → 剧情 → 激情开始 → 高潮性爱 → 收尾
    if (duration <= 5) return 4;  // 极短视频最少 4 段
    if (duration <= 8) return 5;  // 短视频用 5 段
    return 6; // 标准使用 6 段式
  }
  // 普通内容
  if (duration <= 8) return 2;
  if (duration <= 15) return 3;
  if (duration <= 30) return 5;
  if (duration <= 60) return 8;
  return Math.max(2, Math.round(duration / 7));
}

/** 计算每个镜头的大致时间戳 */
function computeTimestamps(duration: number, shotCount: number): string[] {
  const interval = duration / shotCount;
  const timestamps: string[] = [];
  for (let i = 0; i < shotCount; i++) {
    const seconds = Math.round(i * interval * 1000) / 1000;
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(3).padStart(6, '0');
    timestamps.push(`${String(mins).padStart(2, '0')}:${secs}`);
  }
  return timestamps;
}

/** 从图片提示词中提取主体描述。
 *  注意：不要在这里截断到 200 字符再追加 "..."——这会让最终提示词里
 *  出现明显的省略号标记。H3 模板需要完整的主体描述。 */
function extractSubjectFromPrompt(imagePrompt: string): string {
  if (!imagePrompt) return '主角';
  // 移除 @图1 等锚点标记和 [...] 噪声块，但保留完整主体描述
  const cleaned = imagePrompt
    .replace(/@图\d+/g, '')
    .replace(/@\d+/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || '主角';
}

/** 生成 subject_definitions 段落 */
function buildSubjectDefinitions(
  imageUrls: string[],
  subjectDescriptions: string[],
  r18: boolean
): string {
  if (imageUrls.length === 0) {
    return 'subject_definitions:\n<Subject 1> 是参考图中的主角，全程完整保留其外貌、服装和身份特征。';
  }

  const lines: string[] = ['subject_definitions:'];
  for (let i = 0; i < imageUrls.length; i++) {
    const n = i + 1;
    const desc = subjectDescriptions[i] || `<Picture ${n}> 中的角色`;
    if (r18) {
      lines.push(`<Subject ${n}> 是 ${desc}。全程完整保留其外貌特征、发型、妆容、身材比例、肤色和服装细节。`);
    } else {
      lines.push(`<Subject ${n}> 是 ${desc}。全程完整保留其外貌和特征。`);
    }
    lines.push(`<Picture ${n}> 是参考图，作为目标视频的角色和构图锚点。`);
  }

  return lines.join('\n');
}

/** 生成 summary 段落 */
function buildSummary(
  imageUrls: string[],
  r18: boolean,
  sceneDescription?: string
): string {
  const taskType = imageUrls.length > 0 ? '【参考图生成】' : '【文字生成】';
  const r18Prefix = r18 ? '目标视频呈现亲密成人场景。' : '';

  const scenePart = sceneDescription
    ? `目标视频展示 ${sceneDescription}。`
    : imageUrls.length > 0
    ? '目标视频以参考角色在自然环境中表演描述动作。'
    : '目标视频呈现描述场景，动作自然流畅，电影质感。';

  const refPart = imageUrls.length > 0
    ? ` 通过 <Picture ${imageUrls.length > 1 ? '1' : '1'}> 参考图保持角色外观和身份。`
    : '';

  return `summary:\n${taskType} ${r18Prefix}${scenePart}${refPart}`;
}

/** 生成 retention_analysis 段落 */
function buildRetentionAnalysis(
  imageUrls: string[],
  r18: boolean
): string {
  if (imageUrls.length === 0) {
    return 'retention_analysis:\n<Subject 1>: 完全保留 - 主角由文字生成，全程维持一致。';
  }

  const lines: string[] = ['retention_analysis:'];
  for (let i = 0; i < imageUrls.length; i++) {
    const n = i + 1;
    const role = r18
      ? '面部特征、发型、妆容、身材比例、肤色和服装细节全程完全保留。'
      : '外貌、身份和特征全程完全保留。';
    lines.push(`<Subject ${n}>（全程出现）：完全保留 - ${role}`);
    lines.push(`<Picture ${n}>（全程参考）：完全保留 - 参考图提供角色锚点。`);
  }

  return lines.join('\n');
}

/**
 * 把 LLM 扩写出来的 sceneDescription 切成若干镜头，每个镜头描述
 * 一段具体的、带有明确身体动作/表情/镜头变化的画面。优先使用模型
 * 实际生成的内容（sceneDescription），只有当 sceneDescription 为空
 * 时才退回到通用模板。
 *
 * R18 内容使用 6 段式结构：出场 → 前戏 → 剧情 → 激情开始 → 高潮性爱 → 收尾
 */
function buildShotsFromImagePrompt(
  imagePrompt: string,
  duration: number,
  r18: boolean,
  sceneDescription?: string
): H3Shot[] {
  const shotCount = computeShotCount(duration, r18);
  const timestamps = computeTimestamps(duration, shotCount);
  const subjectText = extractSubjectFromPrompt(imagePrompt);

  // ── Theme detection: prevent LLM drift from propagating downstream ──
  const themeEntry = _detectTheme(imagePrompt);
  const consistent = _isThemeConsistent(sceneDescription || '', themeEntry);

  // ── Build segments ──
  let segments: string[];

  // 优先使用 sceneDescription（由 expandVideoFromImage 模型生成的视频提示词）
  // 只有当 sceneDescription 为空或不一致时才使用预设模板
  if (sceneDescription && consistent) {
    // 有场景描述且与主题一致：使用场景描述
    segments = splitSceneIntoSegments(sceneDescription, shotCount);
  } else if (r18) {
    // R18 内容且无有效场景描述：使用 R18 预设模板
    segments = R18_SIX_SEGMENT_TEMPLATES.slice(0, shotCount).map(t => t.description);
    while (segments.length < shotCount) {
      segments.push(R18_SIX_SEGMENT_TEMPLATES[R18_SIX_SEGMENT_TEMPLATES.length - 1].description);
    }
  } else if (themeEntry) {
    // 主题检测到但 LLM 漂移 → 使用安全主题片段
    segments = themeEntry.safeSegments.slice(0, shotCount);
    while (segments.length < shotCount) {
      segments.push(themeEntry.safeSegments[themeEntry.safeSegments.length - 1]);
    }
  } else {
    // 无主题检测且无场景描述 → 通用回退
    segments = splitSceneIntoSegments(subjectText, shotCount);
  }

  const introCamera = r18
    ? '真人实拍，电影级成人片风格，暧昧氛围灯光，浅景深，自然颗粒感画质。'
    : '真人实拍，电影级风格，自然光照明，浅景深，自然画质。';

  const shots: H3Shot[] = [];

  for (let i = 0; i < shotCount; i++) {
    const timestamp = timestamps[i];
    const segment = segments[i];
    const framing = pickFraming(i, shotCount, r18);
    const cameraMovement = pickCameraMovement(i, shotCount, r18);
    const bodyDetail = pickBodyDetail(i, r18, shotCount);
    const audioCue = r18 ? pickR18AudioCue(i, shotCount) : pickAudioCue(i, r18);

    const description = i === 0
      ? `${introCamera}${framing}。${segment}${bodyDetail}镜头保持稳定，角色就位，${audioCue}。`
      : `${framing}。${segment}${bodyDetail}${cameraMovement}，${audioCue}。`;

    if (i === 0) {
      shots.push({ index: i + 1, description });
    } else {
      shots.push({ index: i + 1, timestamp: `At ${timestamp}`, description });
    }
  }

  return shots;
}

/** 把 sceneDescription 按镜头数切分成段。
 *  - 优先按句号 "。" / ". " 切分；
 *  - 段数不足时，把首段复制给后面的镜头以保留完整动作链；
 *  - 如果 sceneDescription 为空，返回 subjectText 作为兜底。 */
function splitSceneIntoSegments(sceneDescription: string, shotCount: number): string[] {
  const cleaned = sceneDescription.trim();
  if (!cleaned) return Array(shotCount).fill('角色以流畅、连贯的动作表演描述的亲密场景。');

  // 拆句，保留完整句子
  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length === 0) return Array(shotCount).fill(cleaned);

  const segments: string[] = [];
  if (sentences.length >= shotCount) {
    const perShot = Math.ceil(sentences.length / shotCount);
    for (let i = 0; i < shotCount; i++) {
      const chunk = sentences.slice(i * perShot, (i + 1) * perShot).join(' ');
      segments.push(chunk || sentences[sentences.length - 1]);
    }
  } else {
    const base = [...sentences];
    for (let i = 0; i < shotCount; i++) {
      const idx = Math.min(i, sentences.length - 1);
      segments.push(base[idx]);
    }
  }
  return segments;
}

/** 不同镜头使用不同景别，制造真实分镜的镜头变化
 * R18 6段式景别：出场(wide) → 前戏(medium) → 剧情(close) → 激情(mid-close) → 高潮(extreme close) → 收尾(medium)
 */
function pickFraming(shotIdx: number, totalShots: number, r18: boolean): string {
  if (totalShots <= 2) {
    return shotIdx === 0 ? '中景建立镜头' : '特写镜头';
  }

  // R18 6段式专用景别
  if (r18 && totalShots >= 5) {
    const r18Framing6 = [
      '全景镜头展示全身，衣物缓慢褪去，露出裸露肌肤和私密部位',                         // 出场
      '中景镜头捕捉自慰、乳房戏耍和渐强的情欲表情',                                    // 前戏
      '特写镜头聚焦口交细节、面部表情和颜射准备',                                      // 剧情
      '中近景追踪多种性交姿势、身体动作和激情互动',                                     // 激情开始
      '亲密极限特写捕捉射精冲击、精液覆盖面容和高峰高潮表情',                           // 高潮性爱
      '中景展示精液覆盖后的状态、满足疲惫的表情和完全满足的状态',                       // 收尾
    ];
    return r18Framing6[shotIdx % r18Framing6.length];
  }

  const ratio = shotIdx / Math.max(totalShots - 1, 1);
  if (ratio < 0.25) return '全景建立镜头';
  if (ratio < 0.5) return '中景镜头';
  if (ratio < 0.75) return '特写镜头追踪动作';
  return r18 ? '亲密极限特写' : '中近景';
}

/** 不同镜头的机位运动
 * R18 6段式机位运动
 */
function pickCameraMovement(shotIdx: number, totalShots: number, r18?: boolean): string {
  if (r18 && totalShots >= 5) {
    const r18Movement6 = [
      '镜头保持稳定，观察',                                              // 出场
      '镜头缓慢推进，捕捉亲密感',                                        // 前戏
      '镜头倾斜跟随浪漫互动',                                            // 剧情
      '镜头开始随节奏动态移动',                                          // 激情开始
      '镜头在最激烈时刻保持稳定',                                        // 高潮性爱
      '镜头缓慢拉远，捕捉事后状态',                                      // 收尾
    ];
    return r18Movement6[shotIdx % r18Movement6.length];
  }

  const ratio = shotIdx / Math.max(totalShots - 1, 1);
  if (ratio < 0.25) return '镜头缓慢推进';
  if (ratio < 0.5) return '镜头稳定，有轻微手持晃动感';
  if (ratio < 0.75) return '镜头缓慢倾斜跟随动作';
  return '镜头停留，关注最终表情';
}

/** 给每个镜头加一句具体身体细节，让画面有更多实质内容 */
function pickBodyDetail(shotIdx: number, r18: boolean, totalShots?: number): string {
  if (!r18) {
    const safe = [
      '肌肤因薄汗微光，肌肉明显发力',
      '呼吸明显加深，肩膀随动作滚动',
      '面部表情加剧，目光聚焦动作',
      '四肢流畅伸展全程幅度，姿态控制有力',
    ];
    return safe[shotIdx % safe.length];
  }

  // R18 6段式身体细节
  const r18Details6 = [
    // 1. 出场 - 衣物褪去、身体展示
    '角色缓慢脱去衣物，露出裸露肌肤，丰满坚挺的乳房，粉嫩乳头，光滑大腿，私密部位因初始兴奋而湿润，目光与镜头进行强烈接触',
    // 2. 前戏 - 自慰、口交开始
    '手指沿大腿内侧游走接近私密部位，以圆周动作按压阴蒂，另一只手揉捏乳房拧弄乳头，嘴巴渐强呻吟，双眼紧闭沉浸在强烈快感中',
    // 3. 剧情发展 - 深入口交、颜射准备
    '头部有节奏上下进行口交，嘴唇环绕阴茎拉伸，深喉动作明显，舌头上抽时打转，以顺从的眼神向上看，过渡到嘴巴大开舌头伸出为颜射摆好姿势',
    // 4. 激情开始 - 多种姿势开始
    '后背式臀部高举背部深弓，转为传教士双腿大开环抱，乳房弹跳，再转为女上位向上臀部滚动配合向下冲击，身体以急促节奏移动',
    // 5. 高潮性爱 - 颜射、高潮
    '白色精液射在脸上，溅入张开的嘴巴和伸出的舌头，顺着脸颊滴落到乳房，脸被可见精液覆盖，眼睛紧闭惊讶后睁开满足表情，身体痉挛高潮',
    // 6. 收尾 - 颜射后表情
    '脸上覆盖精液，疲惫满足地深呼吸，眼睛慢慢睁开直视镜头，一手擦去眼中的精液，另一手舔舐手指上的残留精液，身体因完全满足而瘫倒',
  ];

  // 保留原有的 4 段式作为回退
  const r18Details4 = [
    '大腿每动一下明显颤抖，臀部以稳定节奏滚动，肌肉在发红皮肤下收缩',
    '乳房随动作弹跳摇晃，腹肌明显发力，呼吸转为急促短促的喘息',
    '嘴巴持续张开发出呻吟，眼睛紧闭，手指抓紧垫子借力，腰部深深拱起',
    '身体动作越来越急促，脊椎拱起，脚趾蜷缩，胸部和面部皮肤泛红',
  ];

  if (totalShots && totalShots >= 5) {
    return r18Details6[shotIdx % r18Details6.length];
  }
  return r18Details4[shotIdx % r18Details4.length];
}

/** 每个镜头的音频线索 */
function pickAudioCue(shotIdx: number, r18: boolean): string {
  if (!r18) {
    const safe = [
      '音频：柔和的工作室环境音',
      '音频：可控的呼吸声',
      '音频：有节奏的垫子接触声',
      '音频：动作结束时单一的持久呼气',
    ];
    return safe[shotIdx % safe.length];
  }
  const cues = [
    '音频：轻柔呻吟混合深呼吸',
    '音频：湿润有节奏的皮肤接触声，渐强的呻吟',
    '音频：响亮持续的呻吟，喘息，急促呼吸',
    '音频：最终尖锐的叫喊然后长的颤抖呼气',
  ];
  return cues[shotIdx % cues.length];
}

/** R18 6段式音频线索 */
function pickR18AudioCue(shotIdx: number, totalShots: number): string {
  const r18Cues6 = [
    '音频：撩人的氛围音乐，衣服窸窣声，呼吸渐起，脚步声',
    '音频：湿润的兴奋声，手指接触皮肤声，乳头拧弄声，渐强的轻柔呻吟，隐约的自慰接触声',
    '音频：口交的湿润吸吮声，混合呻吟的作呕时刻，皮肤接触声，渐强',
    '音频：达到峰值的响亮呻吟，有节奏的肉体拍打声，湿润插入声，急促感叹',
    '音频：强烈尖叫呻吟，射精飞溅声，湿润高潮声，激情最终释放感叹',
    '音频：满足的深呼吸，最终渐弱的呻吟，氛围房间音恢复，疲惫满足的叹息',
  ];
  const cues = r18Cues6.slice(0, Math.min(totalShots, 6));
  return cues[shotIdx % cues.length];
}

/** 生成 detailed_description 段落 */
function buildDetailedDescription(
  shots: H3Shot[],
  imageUrls: string[],
  duration: number,
  r18: boolean
): string {
  const lines: string[] = ['detailed_description:'];

  // 风格开场
  const styleIntro = r18
    ? '目标视频采用真实感、电影级成人片风格，暧昧氛围灯光，自然音效。'
    : '目标视频采用真实感、电影级风格，自然光照明，氛围音效。';
  lines.push(styleIntro);

  // 生成镜头
  for (const shot of shots) {
    if (shot.index === 1) {
      lines.push(`[镜头 1] ${shot.description}`);
    } else {
      lines.push(`[镜头 ${shot.index}] ${shot.timestamp || ''} ${shot.description}`);
    }
  }

  return lines.join('\n');
}

/** 生成 overall_soundscape 段落 */
function buildSoundscape(r18: boolean): string {
  return r18
    ? 'overall_soundscape: 真实氛围音，自然呼吸声和身体动作声，亲密肢体接触声（亲吻、抚摸），以及角色的反应性发声。全程声音与画面动作一致。'
    : 'overall_soundscape: 适合场景的自然氛围音。背景环境音，细腻动作声，以及镜头中描述的任何对话或发声。';
}

/** 生成 non_diegetic_music 段落 */
function buildMusic(): string {
  return 'non_diegetic_music: N/A';
}

// ─── 主导出函数 ──────────────────────────────────────────────────────────────

/**
 * 生成完整的 MiniMax-H3 Ref2VA 六段式提示词
 *
 * @param options 生成参数
 * @returns 完整的 H3 提示词字符串
 */
export function generateH3Prompt(options: H3PromptOptions = {}): string {
  const {
    imageUrls = [],
    subjectDescriptions = [],
    duration = 15,
    r18 = false,
    sceneDescription,
    imagePrompt,
    shots,
    soundscape,
    music,
  } = options;

  // 优先使用传入的 shots，其次自动生成
  const effectiveShots = shots ?? buildShotsFromImagePrompt(
    imagePrompt || '',
    duration,
    r18,
    sceneDescription,
  );

  const parts = [
    buildSubjectDefinitions(imageUrls, subjectDescriptions, r18),
    buildSummary(imageUrls, r18, sceneDescription),
    buildRetentionAnalysis(imageUrls, r18),
    buildDetailedDescription(effectiveShots, imageUrls, duration, r18),
    soundscape ?? buildSoundscape(r18),
    music ?? buildMusic(),
  ];

  return parts.join('\n\n');
}

/**
 * 根据图片提示词列表批量生成 H3 提示词（用于分镜场景）
 *
 * @param imagePrompts 图片提示词数组，每个元素对应一个分镜
 * @param durationPerShot 每个分镜对应的视频时长（秒），默认 5
 * @param options 其他生成参数
 * @returns Map<分镜序号, H3提示词>
 */
export function generateH3PromptsForStoryboard(
  imagePrompts: string[],
  durationPerShot: number = 5,
  options: Partial<Omit<H3PromptOptions, 'imagePrompt' | 'shots'>> = {}
): Map<number, string> {
  const result = new Map<number, string>();

  imagePrompts.forEach((prompt, idx) => {
    const shotDuration = options.duration ?? durationPerShot;
    const h3Prompt = generateH3Prompt({
      ...options,
      imagePrompt: prompt,
      duration: shotDuration,
    });
    result.set(idx + 1, h3Prompt);
  });

  return result;
}

/**
 * 根据分镜数据批量生成 H3 提示词（用于剧情分镜场景）
 *
 * @param panels 分镜数组，每个包含 image_prompt 和 scene_description
 * @param durationPerShot 每个分镜的时长（秒），默认 5
 * @param options 其他生成参数
 * @returns Map<分镜序号, H3提示词>
 */
export function generateH3PromptsForPanels(
  panels: { image_prompt: string; scene_description?: string }[],
  durationPerShot: number = 5,
  options: Partial<Omit<H3PromptOptions, 'imagePrompt' | 'shots' | 'sceneDescription'>> = {}
): Map<number, string> {
  const result = new Map<number, string>();

  panels.forEach((panel, idx) => {
    const h3Prompt = generateH3Prompt({
      ...options,
      imagePrompt: panel.image_prompt,
      sceneDescription: panel.scene_description,
      duration: options.duration ?? durationPerShot,
    });
    result.set(idx + 1, h3Prompt);
  });

  return result;
}

// ════════════════════════════════════════════════════════════════════════════════
// ─── 分镜分片模式 (Per-Panel Shot Mode) ────────────────────────────────────
//
// 1 个图片分镜 ↔ 1 个视频提示词 (1:1 对应)。每个分镜的提示词只包含：
//   [Shot N] 对应<Picture N>，<运动/动作描述>
//
// 共享部分 (subject_definitions, summary, detailed_description 开场白,
// overall_soundscape, non_diegetic_music) 只生成一次，
// 在最终调用长视频 v1.1 时拼接成完整提示词。
//
// 工作流：
//   1. 调用 generateH3PromptsForPanelsV2 生成每个分镜的 [Shot N] 提示词
//   2. 调用 generateH3CommonParts 一次性生成共享部分
//   3. 用户点击"批量上传到长视频 v1.1"时：
//      - 上传所有分镜图到 slots 0..N-1
//      - 调用 assembleH3Prompt 拼接完整提示词
//      - 跳转到 NinfiniteLongVideoPage
// ════════════════════════════════════════════════════════════════════════════════

/** 单个分镜的 Shot 提示词结构 */
export interface H3PanelShot {
  /** 分镜序号 (从 1 开始) */
  panelIndex: number;
  /** 对应的图片引用编号 */
  pictureNumber: number;
  /** 时间戳 (第一个镜头为 undefined) */
  timestamp?: string;
  /** Shot 提示词完整字符串，例如：
   *   "[Shot 1] 对应<Picture 1>，中景，<Subject 1>端着咖啡站在店内，..."
   *   或
   *   "[Shot 2] At 00:01.800，对应<Picture 2>，<Subject 2>走入画面，..."
   */
  shotPrompt: string;
}

/** 共享部分结构 */
export interface H3CommonParts {
  subjectDefinitions: string;
  summary: string;
  retentionAnalysis: string;
  detailedDescriptionIntro: string;
  overallSoundscape: string;
  nonDiegeticMusic: string;
}

/**
 * 从图片提示词中提取运动/动作描述（用于 Shot 提示词）
 * 优先使用 scene_description (LLM 扩写后的视频提示词)，
 * 否则从 image_prompt 中提取静态描述并轻微调整使其偏向"动作"含义。
 */
function extractMotionFromPanel(panel: { image_prompt: string; scene_description?: string }, r18: boolean): string {
  if (panel.scene_description && panel.scene_description.trim()) {
    return panel.scene_description.trim();
  }
  // Fallback: 使用 image_prompt 作为描述基线
  const base = (panel.image_prompt || '').trim();
  if (!base) return '角色保持画面构图，动作自然流畅。';
  return base;
}

/**
 * 为单个分镜生成 Shot 提示词（[Shot N] 对应<Picture N>，<description>）
 *
 * 输出格式严格对齐官方 H3 模板：
 *   [Shot 1] 对应<Picture 1>，<motion description>
 *   [Shot 2] At 00:01.800，对应<Picture 2>，<motion description>
 *
 * @param panelIndex 分镜序号 (从 1 开始)
 * @param panelIndex 0-based index in panels array
 * @param panel { image_prompt, scene_description }
 * @param totalPanels 总分镜数
 * @param duration 总视频时长（秒）
 * @param r18 是否 R18
 * @returns H3PanelShot 对象
 */
export function generateH3ShotPrompt(
  panelIndex: number,  // 0-based
  panel: { image_prompt: string; scene_description?: string },
  totalPanels: number,
  duration: number = 15,
  r18: boolean = false,
): H3PanelShot {
  const pictureNumber = panelIndex + 1;
  const shotNumber = pictureNumber;
  const motion = extractMotionFromPanel(panel, r18);

  // 计算时间戳：每个 Shot 持续 duration/totalPanels 秒
  let timestamp: string | undefined;
  if (shotNumber > 1) {
    const interval = duration / totalPanels;
    const seconds = Math.round((shotNumber - 1) * interval * 1000) / 1000;
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(3).padStart(6, '0');
    timestamp = `${String(mins).padStart(2, '0')}:${secs}`;
  }

  let shotPrompt: string;
  if (shotNumber === 1) {
    shotPrompt = `[Shot ${shotNumber}] 对应<Picture ${pictureNumber}>，${motion}`;
  } else {
    shotPrompt = `[Shot ${shotNumber}] At ${timestamp}，对应<Picture ${pictureNumber}>，${motion}`;
  }

  return {
    panelIndex: pictureNumber,
    pictureNumber,
    timestamp,
    shotPrompt,
  };
}

/**
 * 批量为多个分镜生成 Shot 提示词
 */
export function generateH3ShotPromptsForPanels(
  panels: { image_prompt: string; scene_description?: string }[],
  duration: number = 15,
  r18: boolean = false,
): Map<number, H3PanelShot> {
  const result = new Map<number, H3PanelShot>();
  const total = panels.length;
  panels.forEach((panel, idx) => {
    const shot = generateH3ShotPrompt(idx, panel, total, duration, r18);
    result.set(shot.panelIndex, shot);
  });
  return result;
}

/**
 * 生成 H3 共享部分 (subject_definitions, summary, retention_analysis,
 * detailed_description intro, overall_soundscape, non_diegetic_music)。
 *
 * 这部分在一次生图中只生成一次，最终在调用长视频 v1.1 时
 * 与每个分镜的 Shot 提示词拼接成完整的 H3 提示词。
 */
export function generateH3CommonParts(
  panels: { image_prompt: string; scene_description?: string }[],
  options: {
    duration?: number;
    r18?: boolean;
    sceneDescription?: string;
    subjectDescriptions?: string[];
  } = {},
): H3CommonParts {
  const { duration = 15, r18 = false, sceneDescription, subjectDescriptions = [] } = options;

  // 用一个虚拟的 imageUrls 长度代表 Picture 数量
  const virtualImageUrls = Array(panels.length).fill('placeholder');
  const effectiveSubjectDescs = subjectDescriptions.length === panels.length
    ? subjectDescriptions
    : panels.map((p, i) => {
        // 从第一个图片提示词中提取简短主体描述
        const cleaned = (p.image_prompt || '').replace(/\[.*?\]/g, '').replace(/\s+/g, ' ').trim();
        if (cleaned.length > 80) {
          return cleaned.slice(0, 80).trim() + '…';
        }
        return cleaned || `<Picture ${i + 1}> 中的角色`;
      });

  return {
    subjectDefinitions: buildSubjectDefinitions(virtualImageUrls, effectiveSubjectDescs, r18),
    summary: buildSummary(virtualImageUrls, r18, sceneDescription),
    retentionAnalysis: buildRetentionAnalysis(virtualImageUrls, r18),
    detailedDescriptionIntro: r18
      ? '目标视频采用真实感、电影级成人片风格，暧昧氛围灯光，自然音效。'
      : '目标视频采用真实感、电影级风格，自然光照明，氛围音效。',
    overallSoundscape: buildSoundscape(r18),
    nonDiegeticMusic: buildMusic(),
  };
}

/**
 * 将共享部分和每个分镜的 Shot 提示词拼接成完整 H3 提示词。
 */
export function assembleH3Prompt(
  commonParts: H3CommonParts,
  shotPrompts: H3PanelShot[],
  duration: number = 15,
): string {
  const shotLines = shotPrompts.map((s) => s.shotPrompt);

  // detailed_description 由 intro + shots 拼接
  const detailedDescription = [
    'detailed_description:',
    commonParts.detailedDescriptionIntro,
    ...shotLines,
  ].join('\n');

  const parts = [
    commonParts.subjectDefinitions,
    commonParts.summary,
    commonParts.retentionAnalysis,
    detailedDescription,
    commonParts.overallSoundscape,
    commonParts.nonDiegeticMusic,
  ];

  return parts.join('\n\n');
}

/**
 * 一次性函数：批量生成分镜 Shot 提示词 + 共享部分。
 * 返回 { shotPrompts: Map, commonParts } 供 UI 层缓存，
 * 后续上传时调用 assembleH3Prompt 拼接完整提示词。
 */
export function generateH3PromptsForPanelsV2(
  panels: { image_prompt: string; scene_description?: string }[],
  options: {
    duration?: number;
    r18?: boolean;
    sceneDescription?: string;
    subjectDescriptions?: string[];
  } = {},
): { shotPrompts: Map<number, H3PanelShot>; commonParts: H3CommonParts } {
  const { duration = 15, r18 = false } = options;
  return {
    shotPrompts: generateH3ShotPromptsForPanels(panels, duration, r18),
    commonParts: generateH3CommonParts(panels, options),
  };
}
