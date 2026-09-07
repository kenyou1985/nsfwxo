/**
 * poseSelector.ts — 智能性爱姿势选择器
 *
 * 解决问题：之前所有主题模板里硬编码"站立前入/站立后入/站立后入"等姿势，
 * 导致每次生成的分镜都是相同的几个姿势，重复无聊。
 *
 * 设计：
 *   - 内置 195 个姿势的分类映射 (POSE_CATEGORIES)
 *   - 提供 按主题上下文（室内/户外/站立）和 按shot序号 选择合适分类的姿势
 *   - 使用种子化的随机算法，保证同一主题每次调用 pickDiversePoses() 都
 *     得到不同的姿势组合，但同一主题 id 在同一 shot 内表现一致
 *   - 多样性约束：选过的分类和 id 不再重复
 *
 * 分类规则（按 nameZh 关键词匹配，匹配顺序决定主分类）：
 *   - oral       69 / 口交 / 深喉 / 颜射 / 吞精 / 舔阴 / 舔乳
 *   - cowgirl    女上位 / 骑乘 / 女蹲 / 后仰 / 反向女上 / 坐姿
 *   - missionary 传教士 / 压入 / 双腿大开 / V字腿
 *   - doggy      后入 / Doggy / 狗式 / 遛狗 / 抬腿后入
 *   - standing   站立 / 靠墙 / 楼梯扶手 / 扶墙
 *   - side       侧卧 / 扭结 / 螺旋 / 剪刀
 *   - creative   倒立 / 蝴蝶 / 莲花 / 桥式 / 尼尔森 / 手推车 / 车轮 / 悬空 / 超人 / 猴子 / 人肉 / 亚马逊 / 桌面 / 沙发 / 椅子 / 镜子 / 床沿
 *   - public     户外 / 森林 / 草地 / 公开 / 公园 / 楼梯 / 街头 / 商场 / 试衣间 / 图书馆 / 仓库 / 教堂 / 大堂
 *   - cumshot    颜射 / 内射 / 吞精 / 结束 / 高潮
 *   - anal       肛交 / 肛门
 *   - toy        假阴茎 / 假阳具 / 振动棒 / 自慰 / 玩具
 *   - multi      双男 / 双女 / 三人 / 双龙 / 多人 / 轮替 / 群
 */

export type PoseCategory =
  | 'oral'
  | 'cowgirl'
  | 'missionary'
  | 'doggy'
  | 'standing'
  | 'side'
  | 'creative'
  | 'public'
  | 'cumshot'
  | 'anal'
  | 'toy'
  | 'multi';

/** 按 nameZh 关键词给每个姿势打分类标签（一个姿势可多个分类） */
const KEYWORD_TO_CATEGORIES: Array<[RegExp, PoseCategory]> = [
  [/69|口交|深喉|颜射|吞精|舔阴|舔乳|吮吸|口腔/, 'oral'],
  [/女上位|骑乘|女蹲|后仰|反向女上|后入后仰|后入仰卧|坐姿/, 'cowgirl'],
  [/传教士|压入|双腿大开|V字腿|仰卧|平躺|压身/, 'missionary'],
  [/后入|Doggy|狗式|遛狗|抬腿后入|反向后入|狗棒/, 'doggy'],
  [/站立|靠墙|楼梯扶手|扶墙/, 'standing'],
  [/侧卧|扭结|螺旋|剪刀|交错/, 'side'],
  [/倒立|蝴蝶|莲花|桥式|尼尔森|手推车|车轮|悬空|超人|猴子|人肉|亚马逊|桌面|沙发|椅子|镜子|床沿|深弓|蛙跳|螃蟹|魔法山|骑马|旋转|高架|高抬|弓背|弓式|锁喉|骆驼|天鹅|伸缩|挖掘|钳式|吊起|吊机|绑架|蹬腿|鸽式|猫式|树式|秋千|秋千式|荡/, 'creative'],
  [/户外|森林|草地|野外|公开|公园|楼梯|街头|商场|试衣间|图书馆|仓库|教堂|大堂|泳池|浴池|浴缸|海边|沙滩|阳台|花园|沙漠|厨房|酒吧|教室|办公室|天台|天窗|酒店|桑拿|吊床|屋顶|汽车|后座|海边|电梯/, 'public'],
  [/肛交|肛门|后庭/, 'anal'],
  [/假阴茎|假阳具|振动棒|自慰|器具|玩具|手指插入|手淫/, 'toy'],
  [/双男|双女|三人|双龙|多人|轮替|群|双穴/, 'multi'],
  // cumshot 单独判：仅当 nameZh 同时含 "颜射/内射/吞精/高潮/结束"
  // 防止与 oral 重复，使用更具体的子集
  [/颜射|内射|吞精|高潮射精|射精/, 'cumshot'],
];

/** 给定一个姿势名，返回它所属的分类列表 */
export function categorizePose(nameZh: string): PoseCategory[] {
  const cats: PoseCategory[] = [];
  for (const [regex, cat] of KEYWORD_TO_CATEGORIES) {
    if (regex.test(nameZh) && !cats.includes(cat)) {
      cats.push(cat);
    }
  }
  // 兜底
  if (cats.length === 0) cats.push('creative');
  return cats;
}

/**
 * 内置姿势信息：nameZh + 描述。
 * 由于 VIDEO_POSE_PRESETS 文件超大（1919 行），不在此处 import，
 * 而是直接内联常用的名字列表，描述从 nameZh 推断。
 *
 * 该数组仅用作「姿势名 + 描述」的查找表 ——
 * LLM 实际看到的姿势名从这里读，但 image_prompt 的细节由 LLM 自行补充。
 */
export interface PoseInfo {
  /** 完整姿势名（中文，例如 "床上经典Doggy猛烈后入"） */
  nameZh: string;
  /** 简短的中文动作描述，用于嵌入 shot prompt */
  description: string;
  /** 分类 */
  categories: PoseCategory[];
  /** 推荐场景（bed/standing/outdoor/any） */
  context: 'bed' | 'standing' | 'outdoor' | 'any';
}

/**
 * 全部 195 个 VIDEO_POSE_PRESETS 的精简列表（仅含 nameZh + 自动分类 + 描述）。
 *
 * 描述规则：
 *   - 取 nameZh 末尾的"姿势名部分"作为动作短语
 *   - 补充上下文（主语 "男性" + 动作 + 受事者 "女性"）以便 LLM 理解
 *
 * 实际生成时调用 import VIDEO_POSE_PRESETS 来获取完整 prompt；
 * 这里只用 nameZh 做"姿势选择"。
 */

// 为保持代码精简，此处采用 lazy import：调用 getAllPoseInfos() 时才加载
let _cachedPoseInfos: PoseInfo[] | null = null;

/**
 * 从 VIDEO_POSE_PRESETS 加载所有姿势并补充描述 + 分类 + 上下文。
 * 避免循环依赖，使用动态 import。
 */
export async function getAllPoseInfos(): Promise<PoseInfo[]> {
  if (_cachedPoseInfos) return _cachedPoseInfos;
  const mod = await import('../data/presetPoses');
  const pool: Array<{ id: string; nameZh: string }> = (mod as any).VIDEO_POSE_PRESETS;
  _cachedPoseInfos = pool.map((p) => ({
    nameZh: p.nameZh,
    description: nameZhToDescription(p.nameZh),
    categories: categorizePose(p.nameZh),
    context: nameZhToContext(p.nameZh),
  }));
  return _cachedPoseInfos;
}

/** 同步版本：从已注入的 POSE_NAMES 列表（见下方 POSE_NAMES）生成 PoseInfo */
export function getAllPoseInfosSync(): PoseInfo[] {
  if (_cachedPoseInfos) return _cachedPoseInfos;
  _cachedPoseInfos = POSE_NAMES.map((nameZh) => ({
    nameZh,
    description: nameZhToDescription(nameZh),
    categories: categorizePose(nameZh),
    context: nameZhToContext(nameZh),
  }));
  return _cachedPoseInfos;
}

/**
 * 所有 195 个姿势的名字（同步可用版本）。
 * 与 src/data/presetPoses.ts 的 VIDEO_POSE_PRESETS 保持一一对应。
 * 添加新姿势时两边都要同步更新。
 */
export const POSE_NAMES: string[] = [
  '床上经典Doggy猛烈后入', '站立Doggy扶墙猛插', '趴式压入深插', '女上位疯狂骑乘', '反向女上位',
  '传教士深插抬腿', '侧卧后入缠绵', '靠墙抱起站立插入', '莲花坐姿亲密研磨', '69互舔口交动态',
  '倒立深插', '全尼尔森抱起固定猛插', '女蹲上位强势骑乘', '蝴蝶式抬腿深插', '站立面对面',
  '手推车式站立后入', '蛙跳式低后入', '扭结侧入式', '抬腿传教士变体', '平躺低后入',
  '魔法山后入', '坐姿剪刀式', '桌面式', '螃蟹行走式女上', '悬空后入',
  '弹球式快速浅插', '螺旋式侧入', '桥式抬臀', '后入抬腿变体', '跪姿口交转插入',
  '站立后入拉发', '反向倒立深插', '侧卧剪刀式', '床沿后入', '女上位后仰',
  '脚踝固定传教士', '靠墙坐姿女上', '椅子后入', '坐姿莲花研磨', '站立69抱起',
  '枕头垫臀趴式', '床上全尼尔森', '女上位双手撑胸', '脚踝搭肩蝴蝶式', '地面手推车',
  '深弓蛙跳式', '扭结侧入深插', 'G点抬腿专注', '弓背平躺后入', '沙发魔法山',
  '面对面坐姿剪刀', '桌面双腿锁定', '反向螃蟹女上', '悬空超人旋转感', '快速后入弹球',
  '站立螺旋侧入', '桥式强烈抽插', '镜子抬腿后入', '口交转后入动态', '靠墙反向女上',
  '全身压入趴式', '胸贴胸女上', '反向女上前倾', 'V字腿传教士', '侧卧抬腿后入',
  '靠墙单腿高抬', '莲花环绕研磨', '女上69', '床沿倒立深插', '跪姿全尼尔森',
  '反向亚马逊', '双腿大开蝴蝶', '站立面对面抱起', '行走式手推车', '缓慢低位蛙跳',
  '扭结深侧入', 'G点侧位变体', '弓背平躺后入', '弯腰魔法山', '坐姿剪刀慢磨',
  '桌面后入', '激烈螃蟹女上', '水平悬空超人', '站立弹球快速', '螺旋深侧入',
  '桥式强烈抬臀', '单腿高抬后入', '跪姿口交后插入', '站立深后入', '反向倒立固定',
  '侧卧交错剪刀', '床沿激烈后入', '女上后仰深插', '脚踝固定传教士', '靠墙坐姿弹跳',
  '椅子弯腰后入', '坐姿莲花深插', '站立69', '枕头垫臀趴入', '站立全尼尔森抽插',
  '双男一女前入双龙', '双男一女后入双龙', '三人69连锁口交', '双女夹男三明治', '双人车轮狗式',
  '双女骑乘切换', '群P四面夹击', '一前一后双龙', '双男两侧夹击侧卧', '双男一墙三明治',
  '双女反向骑乘', '双男一女深喉轮替', '双女互相舔阴', '双男跨坐腿间', '双男隔墙口交',
  '双男乳交颜射', '三人锁链共淫', '双男肛交双龙', '闺蜜旁观男友3P', '三人叠罗汉群交',
  '手铐后入SM', '日式绳缚捆绑', '蒙眼跪舔SM', '蒙眼女上骑乘', '皮鞭抽臀SM',
  '滴蜡胸部SM', '滴蜡大腿SM', '颈部窒息控制', '跪姿口交驯服', '锁链悬吊SM',
  '主奴跪拜仪式', '贞操带强制', '木马骑刑SM', '十字架缚吊', '笼中囚禁SM',
  '脚镣手铐全套SM', '项圈牵引遛狗', '调教室审判台', '钢铐吊起后入', '乳胶紧身SM',
  '强制颜射凌辱', '强制吞精凌辱', '踩踏脸部凌辱', '扯头发后入凌辱', '跪地言语羞辱',
  '强制舔鞋凌辱', '强制深喉凌辱', '抓发颜射凌辱', '掴脸后入凌辱', '掐颈传教士凌辱',
  '跪地舔地板凌辱', '锁链牵引凌辱', '公开场合凌辱', '强制展示凌辱', '全身精液涂抹',
  '假阳具自慰后入', '振动棒震动舔阴', '肛塞后入SM', '双振动棒同时刺激', '贞操锁穿戴',
  '情趣手铐缚手', '情趣绳缚缚身', '假阴茎深喉自慰', '振动环骑乘', '肛塞振动后入',
  '乳夹拉扯SM', '阴茎环束缚', '双假阴茎双龙', '情趣内衣SM全套', '充气娃娃三人',
  '户外森林草地野战', '海边沙滩性爱', '泳池水中后入', '浴缸泡澡做爱', '厨房料理台激情',
  '阳台清晨做爱', '楼梯扶手站立', '汽车后座激情', '电梯间镜子', '办公室办公桌',
  '教室讲台诱惑', '阁楼天窗', '镜子墙前做爱', '天台城市夜景', '公园长椅野战',
  '酒店窗前城市', '桑拿房蒸汽', '阁楼吊床', '屋顶花园', '大堂沙发公开',
  '试衣间镜子', '图书馆书架', '仓库铁架', '教堂忏悔室', '地下室铁链',
];

/** 从 nameZh 推断中文动作描述（用于嵌入 shot prompt） */
function nameZhToDescription(nameZh: string): string {
  // 移除冗余前缀（如"站立"、"床上经典"、"床上"等场景词），保留动作部分
  let desc = nameZh
    .replace(/^床上经典|^床上|^站立|^户外|^楼梯|^电梯|^公园|^镜子|^椅子|^桌子|^沙发|^车库|^野外|^瑜伽|^街头|^商场|^试衣间|^图书馆|^仓库|^教堂|^大堂|^公开|^泳池|^更衣室|^阳台|^花园|^沙漠|^卧室|^提臀|^拉发|^弓背|^桥式|^电梯|^桥式|^瑜伽|^泳池|^街头|^商场|^试衣间|^图书馆|^仓库|^教堂|^大堂|^公开|^泳池|^更衣室|^阳台|^花园|^沙漠|^卧室/, '')
    .trim();
  // 特殊处理：空描述时 fallback
  if (!desc) desc = nameZh;
  // 简化：把 "猛烈" / "疯狂" / "激情" 这类修饰词保留，使用完整 nameZh 作为最保险的描述
  // 因为 LLM 直接生成 image_prompt 时，看到完整 pose 名能更好地构建画面
  return nameZh;
}

/** 从 nameZh 推断推荐场景（bed / standing / outdoor / any） */
function nameZhToContext(nameZh: string): 'bed' | 'standing' | 'outdoor' | 'any' {
  if (/户外|森林|草地|野外|公园|街头|楼梯|泳池|阳台|花园|沙漠|商场|试衣间|图书馆|仓库|教堂|大堂|更衣室|公开/.test(nameZh)) {
    return 'outdoor';
  }
  if (/^站立|^靠墙|^楼梯扶手|^扶墙|^电梯|^桥式|^阳台|^花园|^沙漠|^卧室|^提臀|^拉发|^弓背|^电梯|^桥式|^瑜伽|^泳池|^街头|^商场|^试衣间|^图书馆|^仓库|^教堂|大堂|^公开|^泳池|^更衣室/.test(nameZh)) {
    return 'standing';
  }
  if (/床|桌面|沙发|椅子|镜子|床沿/.test(nameZh)) {
    return 'bed';
  }
  return 'any';
}

/**
 * 种子化哈希：从字符串生成一个稳定的非负 32-bit 整数。
 * 用于每次调用选姿势时生成确定的种子，保证同一 (themeId, shotIndex) 总是得到
 * 相同的姿势，但不同主题或不同 shot 互不相同。
 */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Mulberry32 PRNG: 从种子生成 [0, 1) 范围内的随机数 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 给定主题上下文和 shot 数，随机选 N 个分类多样、姿势 ID 不重复的姿势。
 *
 * @param themeId  主题 ID（如 'theme_504'），用于种子化
 * @param count    要选的姿势数
 * @param options
 *   - preferredCategories: 偏好分类，按优先级排列（如 ['cowgirl','doggy','oral']）
 *   - excludeCategories: 排除的分类（如 ['anal','toy','multi'] 用于标准主题）
 *   - context: 场景上下文（'bed'/'standing'/'outdoor'/'any'）
 *   - randomSalt: 随机盐（同主题不同生成时间得到不同结果；默认 Math.random()）
 *
 * @returns PoseInfo[] 按 shot 顺序排列，长度 = count
 */
export function pickDiversePoses(
  themeId: string,
  count: number,
  options: {
    preferredCategories?: PoseCategory[];
    excludeCategories?: PoseCategory[];
    context?: 'bed' | 'standing' | 'outdoor' | 'any';
    randomSalt?: number;
  } = {}
): PoseInfo[] {
  const all = getAllPoseInfosSync();
  const { preferredCategories = [], excludeCategories = [], context = 'any', randomSalt = Math.floor(Math.random() * 0xFFFFFFFF) } = options;

  // 1) 过滤：上下文 + 排除分类
  let pool = all.filter((p) => {
    if (context !== 'any' && p.context !== 'any' && p.context !== context) return false;
    if (excludeCategories.some((c) => p.categories.includes(c))) return false;
    return true;
  });
  if (pool.length === 0) pool = all;  // fallback

  // 2) 给每个候选打分（偏好分类权重高）
  const scored = pool.map((p) => {
    let score = 0;
    for (let i = 0; i < preferredCategories.length; i++) {
      if (p.categories.includes(preferredCategories[i])) {
        score += (preferredCategories.length - i) * 10;
      }
    }
    return { pose: p, score };
  });
  scored.sort((a, b) => b.score - a.score);

  // 3) 种子化随机选 count 个，同时保证分类多样性
  // 使用 (themeId + 偏好 + 上下文 + randomSalt) 作种子，确保同主题不同生成时间得到不同结果
  const seed = hashSeed(`${themeId}|${preferredCategories.join(',')}|${context}|${randomSalt}`);
  const rng = mulberry32(seed);
  const picked: PoseInfo[] = [];
  const usedNames = new Set<string>();
  const usedCategories = new Map<PoseCategory, number>();

  // 轮盘选：每次从 top-N 候选里随机挑一个未用过的
  const CANDIDATE_WINDOW = Math.max(5, Math.floor(scored.length * 0.4));

  for (let i = 0; i < count; i++) {
    let chosen: PoseInfo | null = null;
    // 优先从偏好分类里选；前 3 个 shot 尽量命中偏好
    if (i < preferredCategories.length) {
      const preferredCat = preferredCategories[i % preferredCategories.length];
      // 找该分类中尚未用过的姿势
      const candidates = scored.filter(
        (s) =>
          s.pose.categories.includes(preferredCat) &&
          !usedNames.has(s.pose.nameZh) &&
          (usedCategories.get(preferredCat) || 0) < 2  // 同分类最多 2 次
      );
      if (candidates.length > 0) {
        // 在前 K 个候选里随机选
        const window = candidates.slice(0, Math.min(CANDIDATE_WINDOW, candidates.length));
        chosen = window[Math.floor(rng() * window.length)].pose;
      }
    }

    // fallback: 从剩余未用过的池子里随机选（保持分类多样性）
    if (!chosen) {
      const candidates = scored.filter(
        (s) =>
          !usedNames.has(s.pose.nameZh) &&
          Array.from(usedCategories.entries()).every(([cat, cnt]) => {
            if (s.pose.categories.includes(cat)) return cnt < 2;
            return true;
          })
      );
      if (candidates.length === 0) {
        // 实在没候选了，跳过多样性约束
        const remains = scored.filter((s) => !usedNames.has(s.pose.nameZh));
        if (remains.length === 0) break;
        chosen = remains[Math.floor(rng() * remains.length)].pose;
      } else {
        const window = candidates.slice(0, Math.min(CANDIDATE_WINDOW, candidates.length));
        chosen = window[Math.floor(rng() * window.length)].pose;
      }
    }

    picked.push(chosen);
    usedNames.add(chosen.nameZh);
    for (const cat of chosen.categories) {
      usedCategories.set(cat, (usedCategories.get(cat) || 0) + 1);
    }
  }

  return picked;
}

/**
 * 为某个具体 shot（带 shotIndex）选一个姿势。
 * 同主题不同 shot 互不重复，分类尽量不同。
 *
 * @param themeId        主题 ID
 * @param shotIndex      shot 序号 (0-based)
 * @param shotCount      总 shot 数（用于分类分布规划）
 * @param usedPoseNames  已选过的姿势名（去重用）
 * @param options        同 pickDiversePoses
 */
export function pickPoseForShot(
  themeId: string,
  shotIndex: number,
  shotCount: number,
  usedPoseNames: Set<string>,
  options: {
    preferredCategories?: PoseCategory[];
    excludeCategories?: PoseCategory[];
    context?: 'bed' | 'standing' | 'outdoor' | 'any';
    /** 特殊标记：如果此 shot 是 cumshot/climax shot，强制从 cumshot 分类里挑 */
    forceCumshot?: boolean;
    /** 特殊标记：如果此 shot 是 oral shot，强制从 oral 分类里挑 */
    forceOral?: boolean;
    /** 特殊标记：如果此 shot 是前戏/抚摸 shot，可以挑前戏类姿势 */
    allowForeplay?: boolean;
    /**
     * 通用强制分类：若非空，则候选姿势必须至少命中其中一个分类
     * （如 ['multi'] 用于多人派对双龙/群 P，或 ['anal'] 用于肛交镜头）
     */
    forceCategories?: PoseCategory[];
    /** 随机盐：保证同一 (themeId, shotIndex) 在不同生成时间得到不同结果 */
    randomSalt?: number;
  } = {}
): PoseInfo | null {
  const all = getAllPoseInfosSync();
  const { preferredCategories = [], excludeCategories = [], context = 'any', randomSalt = Math.floor(Math.random() * 0xFFFFFFFF) } = options;
  const forceCats = options.forceCategories ?? [];

  let pool = all.filter((p) => {
    if (usedPoseNames.has(p.nameZh)) return false;
    if (context !== 'any' && p.context !== 'any' && p.context !== context) return false;
    if (excludeCategories.some((c) => p.categories.includes(c))) return false;
    if (options.forceCumshot && !p.categories.includes('cumshot')) return false;
    if (options.forceOral && !p.categories.includes('oral')) return false;
    if (forceCats.length > 0 && !forceCats.some((c) => p.categories.includes(c))) return false;
    return true;
  });

  if (pool.length === 0) {
    // 若强制分类过严导致池子为空，放宽约束（去掉强制）但保留上下文/排除
    pool = all.filter((p) => {
      if (usedPoseNames.has(p.nameZh)) return false;
      if (context !== 'any' && p.context !== 'any' && p.context !== context) return false;
      if (excludeCategories.some((c) => p.categories.includes(c))) return false;
      return true;
    });
    if (pool.length === 0) return null;
  }

  // 加分：偏好分类
  const scored = pool.map((p) => {
    let score = 0;
    for (let i = 0; i < preferredCategories.length; i++) {
      if (p.categories.includes(preferredCategories[i])) {
        score += (preferredCategories.length - i) * 10;
      }
    }
    // 强制分类有额外加分
    for (const fc of forceCats) {
      if (p.categories.includes(fc)) score += 50;
    }
    return { pose: p, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const rng = mulberry32(hashSeed(`${themeId}|shot:${shotIndex}|${context}|${randomSalt}`));
  const window = scored.slice(0, Math.min(15, scored.length));
  return window[Math.floor(rng() * window.length)].pose;
}

// ═══════════════════════════════════════════════════════════════════════════
// 统一姿势填充 API（所有分镜模板都可以调用）
// ═══════════════════════════════════════════════════════════════════════════

/** 姿势意图：模板里那个镜头到底想表达什么类型的动作 */
export type PoseIntent = 'sex' | 'oral' | 'cumshot' | 'anal' | 'multi' | 'foreplay';

/**
 * 从模板文本中检测姿势意图。
 * 通过扫描 "跪/颜射/肛交/双龙/精液/前戏抚摸" 等关键词来自动归类，
 * 让调用方不用关心 shot 序号也能拿到正确分类的姿势。
 */
export function detectPoseIntent(template: string): PoseIntent {
  // cumshot: 脸上+完成 / 颜射 / 精液覆盖 — 优先级最高
  // 注意：.{0,40} 是为了兼容 "<Picture 1>" 等长占位符替换后的模板
  if (/颜射|脸上.{0,40}完成|精液.{0,30}覆盖|精液.{0,30}溅|抽出.{0,20}喷射|脸上.{0,30}精液/.test(template)) return 'cumshot';
  // anal: 肛门/肛交/双穴（双穴归 anal 而非 multi，因为动作主体是肛交）
  if (/肛交|肛门|后庭|双穴|肛.{0,20}后入|后入.{0,20}肛/.test(template)) return 'anal';
  // oral: 跪+口、跪+深喉、深喉、舔(阴/乳/弄/全身)、口腔、69、喉部、吮吸
  if (/跪.{0,30}(口|深喉)|深喉|舔阴|舔乳|舔弄|舔.{0,10}阴蒂|吮吸|口腔内|咽部|喉部|69/.test(template)) return 'oral';
  // multi: 双龙/三人/群 P/多名.*同时
  if (/双龙|三人行|群P|多名.{0,20}同时|多人.{0,10}捆绑/.test(template)) return 'multi';
  // foreplay: 抚摸/爱抚/亲吻/调教
  if (/抚摸|爱抚|亲吻.{0,20}(乳头|胸)|调教|前戏/.test(template)) return 'foreplay';
  // 兜底：普通做爱
  return 'sex';
}

/** 意图 → 强制分类的映射 */
const INTENT_TO_FORCE_CATS: Record<PoseIntent, PoseCategory[]> = {
  sex: [],
  oral: ['oral'],
  cumshot: ['cumshot'],
  anal: ['anal'],
  multi: ['multi'],
  foreplay: ['creative', 'side', 'missionary', 'cowgirl'],
};

/** 意图 → 偏好分类（用于打分，不强制） */
const INTENT_TO_PREFERRED_CATS: Record<PoseIntent, PoseCategory[]> = {
  sex: ['cowgirl', 'doggy', 'missionary', 'side', 'standing', 'creative'],
  oral: ['oral', 'side', 'missionary'],
  cumshot: ['cumshot', 'oral'],
  anal: ['anal', 'doggy', 'side'],
  multi: ['multi', 'oral', 'cowgirl', 'doggy', 'side', 'standing'],
  foreplay: ['missionary', 'side', 'cowgirl', 'creative'],
};

/**
 * 把 nameZh 转成适合嵌入 prompt 的简短动作描述。
 * - 优先使用 nameZh 本身（LLM 能直接读出动作）
 * - 若包含 "床上/站立/户外" 等场景前缀且与模板 {场景} 重复，尝试去掉以避免啰嗦
 * - cumshot 类（颜射/内射）只保留 "颜射" 或 "内射"，去掉 "强制/凌辱/羞辱" 等修饰
 * - oral 类（口交/深喉/舔阴）只保留核心动作词
 */
export function nameZhToAction(nameZh: string, intent: PoseIntent = 'sex'): string {
  if (intent === 'cumshot') {
    if (/内射/.test(nameZh)) return '内射';
    if (/颜射/.test(nameZh)) return '颜射';
    if (/吞精/.test(nameZh)) return '吞精';
    if (/高潮射精/.test(nameZh)) return '颜射';
    return '颜射';
  }
  if (intent === 'oral') {
    if (/深喉/.test(nameZh)) return '深喉';
    if (/69/.test(nameZh)) return '69互舔口交';
    if (/舔乳|吮吸/.test(nameZh)) return '舔乳吮吸';
    if (/舔阴/.test(nameZh)) return '舔阴口交';
    if (/口交/.test(nameZh)) return '口交';
    return '口交';
  }
  if (intent === 'anal') {
    if (/肛交/.test(nameZh)) return '肛交';
    if (/后庭/.test(nameZh)) return '后庭肛交';
    return '肛交';
  }
  if (intent === 'multi') {
    if (/双龙/.test(nameZh)) return '双龙插入';
    if (/三人/.test(nameZh)) return '三人轮替';
    if (/群P|群/.test(nameZh)) return '群 P 轮替';
    if (/双男/.test(nameZh)) return '双男轮流';
    return '双龙/群 P';
  }
  // sex / foreplay: 去掉常见场景前缀，避免与模板里 {场景} 重复
  const scenePrefix = /^(床上经典|床上激烈|床上|站立|户外|海边|泳池|楼梯扶手|楼梯|电梯|公园|镜子墙|镜子|椅子|桌子|沙发|车库|野外|瑜伽|街头|商场|试衣间|图书馆|仓库|教堂|大堂|公开|更衣室|阳台|花园|沙漠|卧室|窗前|厨房|教室|办公室|天台|天窗|酒店|桑拿|屋顶|汽车|阁楼|后座|阁楼)/;
  let action = nameZh.replace(scenePrefix, '').trim();
  // 若剥得太短（如剩 "站立"），回退到原名
  if (action.length < 3 || action === nameZh) {
    return nameZh;
  }
  return action;
}

/**
 * 每个主题分类的姿势策略表。
 * 调用方只要传入 theme.category，就能自动获得一组合理的"偏好 + 排除 + 上下文"，
 * 不用关心底层的 195 姿势库细节。
 */
export interface PoseStrategy {
  /** 偏好分类（按优先级排列） */
  preferredCategories: PoseCategory[];
  /** 排除分类（基本不用动） */
  excludeCategories: PoseCategory[];
  /** 上下文过滤：'bed' = 室内床/沙发/桌面，'outdoor' = 户外公共场所，'any' = 不限 */
  context: 'bed' | 'standing' | 'outdoor' | 'any';
}

/**
 * 主题分类 → 姿势策略。
 * 集中在这里维护，新增/调整分类策略只需要改这张表。
 */
export const POSE_STRATEGIES: Record<string, PoseStrategy> = {
  纯展示露出: { preferredCategories: [], excludeCategories: [], context: 'any' },
  轻情色: { preferredCategories: [], excludeCategories: [], context: 'any' },
  运动健身: { preferredCategories: [], excludeCategories: [], context: 'any' },
  女同情欲: { preferredCategories: [], excludeCategories: [], context: 'any' },
  奇异猎奇: { preferredCategories: ['creative', 'side', 'standing', 'toy'], excludeCategories: [], context: 'any' },

  纯性爱: {
    preferredCategories: ['cowgirl', 'doggy', 'oral', 'missionary', 'side', 'standing', 'creative'],
    excludeCategories: ['multi', 'anal', 'toy'],
    context: 'any',
  },
  角色扮演: {
    preferredCategories: ['cowgirl', 'doggy', 'oral', 'missionary', 'side', 'standing', 'creative'],
    excludeCategories: ['multi', 'anal', 'toy'],
    context: 'any',
  },
  户外野战: {
    preferredCategories: ['standing', 'doggy', 'cowgirl', 'oral', 'side', 'missionary', 'creative'],
    excludeCategories: ['multi', 'anal', 'toy'],
    context: 'outdoor',
  },
  多人派对: {
    preferredCategories: ['multi', 'oral', 'cowgirl', 'doggy', 'side', 'standing', 'creative'],
    excludeCategories: ['anal', 'toy'],
    context: 'any',
  },
  魔幻奇幻: {
    preferredCategories: ['standing', 'creative', 'cowgirl', 'doggy', 'side', 'missionary', 'oral'],
    excludeCategories: ['multi', 'anal', 'toy'],
    context: 'any',
  },
  SM重口: {
    preferredCategories: ['side', 'doggy', 'missionary', 'oral', 'standing', 'creative'],
    excludeCategories: ['toy'],
    context: 'bed',
  },
};

/** 根据主题分类查策略；找不到就回退到 '纯性爱' 的策略（最通用的性爱策略） */
export function getPoseStrategy(category: string): PoseStrategy {
  return POSE_STRATEGIES[category] ?? POSE_STRATEGIES['纯性爱'];
}

/**
 * 统一姿势填充入口：所有分镜模板只要带 {姿势描述} 占位符，都可以调用此函数。
 *
 * 工作流程：
 *   1. 扫描模板里所有 {姿势描述} 占位符
 *   2. 根据模板文本自动检测本 shot 的姿势意图（oral/cumshot/anal/multi/sex/foreplay）
 *   3. 根据主题分类查 POSE_STRATEGIES 拿偏好/排除/上下文
 *   4. 为每个占位符依次随机抽一个不重复的姿势（用意图强制 + 偏好打分 + 上下文过滤）
 *   5. 用 nameZhToAction 转成简短动作描述替换占位符
 *
 * @param template       分镜模板字符串（含 {姿势描述} 占位符）
 * @param ctx            上下文（主题 id / 分类 / shotIndex / shotCount）
 * @param usedPoseNames  跨 shot 共享的已用姿势集合（保证不重复）
 * @param themeContext   场景上下文 'bed'/'standing'/'outdoor'/'any'（不传则用策略默认）
 * @returns 填充完毕的 prompt 字符串
 */
export function fillPosePlaceholders(
  template: string,
  ctx: {
    themeId: string;
    category: string;
    shotIndex: number;
    shotCount: number;
  },
  usedPoseNames: Set<string>,
  themeContext?: 'bed' | 'standing' | 'outdoor' | 'any'
): string {
  // 找出所有 {姿势描述} 占位符（含可选的 #N 后缀，如 {姿势描述#1}）
  const placeholders = template.match(/\{姿势描述(?:#\d+)?\}/g);
  if (!placeholders || placeholders.length === 0) return template;

  const strategy = getPoseStrategy(ctx.category);
  const context = themeContext ?? strategy.context;
  const intent = detectPoseIntent(template);

  // 把意图的偏好/强制分类合并到策略里
  const mergedPreferred = [...INTENT_TO_PREFERRED_CATS[intent], ...strategy.preferredCategories];
  const forceCats = INTENT_TO_FORCE_CATS[intent];

  let result = template;
  for (let i = 0; i < placeholders.length; i++) {
    const placeholder = placeholders[i];
    // 用 shotIndex*100 + i 作种子内偏移，保证同 shot 不同占位符拿到不同姿势
    const pose = pickPoseForShot(
      ctx.themeId,
      ctx.shotIndex * 100 + i,
      ctx.shotCount,
      usedPoseNames,
      {
        preferredCategories: mergedPreferred,
        excludeCategories: strategy.excludeCategories,
        context,
        forceCategories: forceCats.length > 0 ? forceCats : undefined,
        // 历史兼容：forceOral / forceCumshot 显式打开
        forceOral: intent === 'oral',
        forceCumshot: intent === 'cumshot',
      }
    );
    if (!pose) {
      // 极端情况下没候选：保留占位符（避免出现空字符串导致语法断裂）
      continue;
    }
    usedPoseNames.add(pose.nameZh);
    const action = nameZhToAction(pose.nameZh, intent);
    // 只替换第一次出现（避免 i+1 也匹配到同一个 {姿势描述}）
    result = result.replace(placeholder, action);
  }
  return result;
}
