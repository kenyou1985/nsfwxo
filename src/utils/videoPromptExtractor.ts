/**
 * Generate a pure Chinese video prompt from the panel's剧情 + image prompt using the Wan 2.2 template:
 * [人物身份/外观] + [激情/性爱动作序列（时间副词+强动词）] + [环境/氛围] + [运镜/镜头] + [风格/画质] + [负向提示]
 *
 * 设计原则：
 * - 双重输入：同时消费 image_prompt（图像首帧描述） + scene_description（剧情文字），
 *   视频提示词必须围绕"剧情"展开，再配合"图像"提供视觉细节，从而与剧情一一对应。
 * - 输出纯中文，无英文单词
 * - Action 是核心重点（不是 subject/outfit 重复）
 * - 每个 tag 最多出现一次
 *
 * Example output:
 * "一位20多岁的年轻女孩，穿着白色连衣裙，在卧室中缓缓脱下肩带，肌肤微露，神情羞涩含情，
 *  卧室暖光氛围，中景镜头，4K，超高清，流畅60fps，无变形，无模糊。"
 */

interface VideoPromptInput {
  /** 图片提示词（首帧画面描述，英文/中文混杂均可） */
  imagePrompt: string;
  /** 剧情文字（每个分镜的具体场景描述，中文） */
  sceneDescription?: string;
  /** R18 模式：是否启用激情/性爱相关动作词库 */
  r18Mode?: boolean;
}

export function extractVideoPromptFromImagePrompt(
  imagePromptOrInput: string | VideoPromptInput,
  r18ModeArg: boolean = false,
): string {
  // 兼容旧调用：extractVideoPromptFromImagePrompt(imagePrompt, r18Mode)
  // 新调用：    extractVideoPromptFromImagePrompt({ imagePrompt, sceneDescription, r18Mode })
  let imagePrompt = '';
  let sceneDescription = '';
  let r18Mode = false;
  if (typeof imagePromptOrInput === 'string') {
    imagePrompt = imagePromptOrInput;
    r18Mode = !!r18ModeArg;
  } else {
    imagePrompt = imagePromptOrInput.imagePrompt || '';
    sceneDescription = imagePromptOrInput.sceneDescription || '';
    r18Mode = !!imagePromptOrInput.r18Mode;
  }

  // 剧情词权重大于图片词（图片只是首帧，剧情才是"接下来要发生什么"）
  const scene = sceneDescription.toLowerCase();
  const p = imagePrompt.toLowerCase();
  const combined = `${scene}\n${p}`;
  const used = new Set<string>();
  const push = (tag: string) => {
    if (tag && !used.has(tag)) {
      used.add(tag);
      return tag;
    }
    return null;
  };

  const parts: string[] = [];

  // ── 1. 人物身份/外观（从图片提示词里抓） ─────────────────────────
  const identityTags: string[] = [];

  // Subject type
  if (/2girl|two.*girl|two.*woman/i.test(combined)) identityTags.push('两位年轻女孩');
  else if (/couple|lovers|情侣/i.test(combined)) identityTags.push('一对情侣');
  else if (/1boy|solo.*boy|one.*man|one.*boy/i.test(combined)) identityTags.push('一位年轻男性');
  else if (/1girl|solo.*girl|one.*girl|one.*woman/i.test(combined)) identityTags.push('一位年轻女孩');
  else if (/girl|woman|female|女性|女孩/i.test(combined)) identityTags.push('一位年轻女性');
  else if (/boy|man|male|男性|男孩/i.test(combined)) identityTags.push('一位年轻男性');
  else identityTags.push('一位人物');

  // Age
  if (/teen|young.*girl|young.*woman|20.*岁|二十/i.test(combined)) identityTags.push('20多岁');
  else if (/middle.*aged|中年/i.test(combined)) identityTags.push('中年');
  else if (/elderly|old.*man|old.*woman|老爷爷|老奶奶/i.test(combined)) identityTags.push('老年');

  // Body type
  if (/slim|skinny|苗条|纤细/i.test(combined)) identityTags.push('身材苗条');
  else if (/curvy|voluptuous|丰满|凹凸有致/i.test(combined)) identityTags.push('身材丰满');
  else if (/muscular|肌肉/i.test(combined)) identityTags.push('肌肉健硕');
  else if (/petite|娇小/i.test(combined)) identityTags.push('身材娇小');

  // Outfit — extract at most 2 outfit tags
  const outfitTags: string[] = [];
  if (/white.*dress|白色连衣裙|白色裙子/i.test(combined)) outfitTags.push('穿着白色连衣裙');
  else if (/red.*dress|红色连衣裙|红色裙子/i.test(combined)) outfitTags.push('穿着红色连衣裙');
  else if (/black.*dress|黑色连衣裙|黑色裙子/i.test(combined)) outfitTags.push('穿着黑色连衣裙');
  else if (/wedding.*dress|婚纱/i.test(combined)) outfitTags.push('穿着婚纱');
  else if (/jeans|牛仔裤/i.test(combined)) outfitTags.push('穿着牛仔裤');
  else if (/nurse|护士/i.test(combined)) outfitTags.push('穿着护士服');
  else if (/schoolgirl|校服/i.test(combined)) outfitTags.push('穿着校服');
  else if (/maid|女仆/i.test(combined)) outfitTags.push('穿着女仆装');
  else if (/lingerie|蕾丝.*内|内.*蕾丝/i.test(combined)) outfitTags.push('穿着蕾丝内衣');
  else if (/bikini|比基尼/i.test(combined)) outfitTags.push('穿着比基尼');
  else if (/naked|nude|全裸|赤裸/i.test(combined)) outfitTags.push('一丝不挂');
  else if (/swimsuit|泳装/i.test(combined)) outfitTags.push('穿着泳装');
  else if (/latex|乳胶/i.test(combined)) outfitTags.push('穿着乳胶紧身衣');
  else if (/leather.*cor|皮革.*紧|皮装/i.test(combined)) outfitTags.push('穿着皮革紧身装');
  else if (/bunny|兔.*女|兔.*装/i.test(combined)) outfitTags.push('穿着兔女郎装');
  else if (/kimono|和服|浴衣/i.test(combined)) outfitTags.push('穿着和服');
  else if (/yukata|浴衣/i.test(combined)) outfitTags.push('穿着浴衣');
  else if (/business.*suit|西装|ol/i.test(combined)) outfitTags.push('穿着职业套装');
  else if (/hoodie|卫衣/i.test(combined)) outfitTags.push('穿着卫衣');
  else if (/t-shirt|T恤/i.test(combined)) outfitTags.push('穿着T恤');
  else if (/silk|丝绸/i.test(combined)) outfitTags.push('穿着丝绸服饰');
  else if (/dress|连衣裙|裙子/i.test(combined)) outfitTags.push('穿着连衣裙');
  else if (outfitTags.length === 0) identityTags.push('穿着休闲装');

  // 合并身份（多镜头只输出一次）
  parts.push(...identityTags, ...outfitTags.slice(0, 2));

  // ── 2. 动作序列：先从【剧情】里抓激情/性爱动作，再回退到【图片】抓基础动作 ───
  // 关键：以剧情为优先，让动作与剧情强相关
  const actionTags: string[] = [];

  // 时间副词
  const hasSlow = /slow|缓|轻柔|舒缓|温柔|轻轻/i.test(combined);
  const hasFast = /fast|快速|剧烈|猛|激情|激烈|狂野|疯狂/i.test(combined);
  const hasSudden = /sudden|突然|忽然/i.test(combined);
  const hasGentle = /gentle|温柔|柔和|缠绵/i.test(combined);
  const timeAdverb = hasFast ? '激情地' : hasSudden ? '突然' : hasGentle ? '缠绵地' : '缓缓';

  // ── 2.1 日式激情/性爱动作词库（R18 模式，且剧情里有相关关键词时优先使用） ──
  // 这些都是"日式"AV/动漫里常见的中文表达，Wan2.2 中文模型对它们有良好的遵循度
  if (r18Mode) {
    const r18ActionMap: Array<[RegExp, string]> = [
      // 体位类
      [/doggy|doggystyle|back.*view|rear.*entry|后入|背後|バック/i, '从背后缓缓进入，后入式'],
      [/missionary|传教士|正常位|正面/i, '面对面缠绵，正面体位'],
      [/cowgirl|骑乘|女上位|逆骑/i, '女上位主动起伏'],
      [/reverse.*cowgirl|逆骑|反向骑乘/i, '反向骑乘'],
      [/bent.*over|弯腰|俯趴|趴伏/i, '弯腰俯趴，身姿曲线尽显'],
      [/all.*four|四肢着地|爬/i, '四肢着地承欢'],
      [/side.*position|侧卧|侧身/i, '侧身纠缠'],
      [/spooning|侧抱|从后面抱/i, '从背后温柔侧抱'],
      [/standing.*sex|站立/i, '站立缠绵'],
      [/twerk|扭胯|扭臀/i, '扭胯律动'],
      [/69|六九/i, '69式相互取悦'],
      // 前戏/口
      [/blowjob|口交|oral|舔|深喉|フェラ|口/i, '低头深情口交'],
      [/deepthroat|深喉/i, '深深含入'],
      [/handjob|手交|握手/i, '纤手温柔套弄'],
      [/kiss|深吻|舌吻|接吻|キス/i, '深情相拥热吻'],
      [/foreplay|前戏|愛撫|挑逗/i, '温柔爱抚前戏'],
      // 高潮/过程
      [/climax|高潮|绝顶|いく/i, '高潮瞬间身体紧绷痉挛'],
      [/orgasm|绝顶|高潮/i, '绝顶高潮失神'],
      [/squirt|潮喷|喷水|潮/i, '潮喷失神'],
      [/penetrate|插入|贯穿|突刺/i, '缓缓插入贯穿'],
      [/thrust|抽插|律动|活塞|突进/i, '激烈抽插律动'],
      [/grind|研磨|顶弄/i, '腰部缓缓研磨'],
      [/moan|呻吟|娇喘/i, '低声娇喘呻吟'],
      // 脱衣/暴露
      [/strip|脱衣|脱下|脱掉|脱ぐ/i, '缓缓褪去衣衫'],
      [/undress|脱去/i, '缓缓褪去衣衫'],
      [/expose|露出|裸露/i, '肌肤若隐若现'],
      // 体液
      [/wet|湿润|潮|濡れ/i, '肌肤微汗泛光'],
      [/saliva|唾液|口水/i, '舌尖缠绕银丝'],
      [/sweat|流汗|汗/i, '额角汗珠滑落'],
      // 表情/心理
      [/aroused|动情|情动|欲火/i, '欲火焚身'],
      [/lust|情欲|欲望|欲/i, '眼中情欲翻涌'],
      [/ecstasy|忘我|陶醉|恍惚|陶酔/i, '神情忘我陶醉'],
      [/shy|羞涩|害羞|恥/i, '面带羞涩含情'],
      [/tease|挑逗|勾引|誘惑/i, '眼神勾人挑逗'],
      [/pleasure|快感|愉悦|快楽/i, '快感连连'],
      [/embrace|紧拥|拥抱|抱きしめ/i, '紧紧相拥'],
      // SM/束缚（剧情需要时）
      [/bdsm|sm|捆绑|束缚|缚/i, '被丝带轻缚双手'],
      [/blindfold|蒙眼|目隠/i, '双眼被轻柔蒙住'],
      // 自慰
      [/masturbat|自慰|手淫|オナ/i, '自慰挑弄'],
    ];
    for (const [pattern, label] of r18ActionMap) {
      if (pattern.test(scene) || pattern.test(p)) {
        actionTags.push(`${timeAdverb}${label}`);
        // 不要 break，多抓 2-3 个更丰富的动作
        if (actionTags.length >= 3) break;
      }
    }
  }

  // ── 2.2 通用动作（图片/剧情里都能抓） ──────────────────────────────
  if (actionTags.length < 3) {
    const generalActions: Array<[RegExp, string]> = [
      // 头颈/面部表情（剧情里常见）
      [/look.*back|回眸|回头|振り向き/i, '缓缓回眸'],
      [/look.*camera|凝视镜头|看向镜头|目线/i, '凝视镜头'],
      [/gaze|gazing|凝视|注视|見つめ/i, '含情凝视'],
      [/smile|微笑|微笑み/i, '嘴角微扬'],
      [/laugh|大笑|笑/i, '开怀轻笑'],
      [/cry|crying|tear|流泪|哭泣|涙/i, '眼眶含泪'],
      [/head.*tilt|歪头|侧头|首.*傾/i, '轻轻侧头'],
      // 走/跑/跳
      [/walk|行走|走路|步履|歩く/i, '缓步行走'],
      [/slow.*walk|缓步|缓行|慢慢走|のんびり/i, '缓步徐行'],
      [/run|奔跑|跑步|走る/i, '轻轻奔跑'],
      [/sprint|冲刺/i, '全力冲刺'],
      [/jump|跃起|跳跃|跳ぶ/i, '轻轻跃起'],
      [/dance|dancing|舞蹈|跳舞|踊る/i, '翩翩起舞'],
      [/turn|旋转|转身|振り向く/i, '优雅转身'],
      [/sway|swing|摇摆|晃动|揺れる/i, '身体轻摆'],
      [/lean|倚靠|倾斜|もたれ/i, '轻轻倚靠'],
      [/stretch|舒展|伸び/i, '舒展身体'],
      // 手势
      [/raise.*hand|举手|抬手|挥手|手を/i, '抬手轻拂'],
      [/brush.*hair|拂.*发|撩.*发|玩弄发丝|髪.*撫/i, '轻撩发丝'],
      [/brush.*flower|拂.*花瓣|轻触花瓣|花びら/i, '轻触花瓣'],
      [/pose|摆.*姿势|造型|ポーズ/i, '摆出姿势'],
      [/touch|touching|抚摸|触碰|触れる/i, '轻轻抚摸'],
      [/caress|轻抚|撫で/i, '温柔轻抚身体'],
      [/hug|拥抱|抱きしめ/i, '温柔拥抱'],
      [/hold|握住|握り/i, '轻轻握住'],
      // 姿态
      [/sit|坐|座る/i, '缓缓坐下'],
      [/stand.*up|站起|站起来|立ち上がる/i, '缓缓站起'],
      [/kneel|跪|膝立ち/i, '缓缓跪下'],
      [/lie|躺|横たわ/i, '缓缓躺下'],
      // 日常
      [/drink|喝水|饮|飲む/i, '拿起水杯'],
      [/eat|吃|食べる/i, '轻启朱唇'],
      [/blow.*kiss|飞吻|投げキッス/i, '轻轻飞吻'],
    ];

    for (const [pattern, label] of generalActions) {
      if (pattern.test(combined)) {
        actionTags.push(`${timeAdverb}${label}`);
        if (actionTags.length >= 3) break;
      }
    }
  }

  // 表情（独立于动作）
  if (/tease|挑逗|勾引|sexy|性感|誘惑/i.test(combined) && !actionTags.some(t => t.includes('挑逗') || t.includes('勾引'))) {
    actionTags.push('眼神勾人');
  }
  if (/shy|害羞|羞涩|恥ずかしい/i.test(combined) && !actionTags.some(t => t.includes('羞涩'))) {
    actionTags.push('神情羞涩');
  }
  if (/intoxicated|迷醉|迷离|陶酔/i.test(combined) && !actionTags.some(t => t.includes('陶醉') || t.includes('忘我'))) {
    actionTags.push('神情迷离');
  }

  if (actionTags.length > 0) {
    parts.push('，' + actionTags.join('，'));
  } else {
    // 兜底：根据剧情/图片的内容给一个合理动作
    if (r18Mode) {
      parts.push('，缓缓靠近，含情凝视');
    } else {
      parts.push('，自然动作');
    }
  }

  // ── 3. 环境/氛围（优先从剧情里抓） ───────────────────────────────
  const envTags: string[] = [];

  const sceneMap: Array<[RegExp, string]> = [
    [/park|garden|樱花|树下|花园|公园|花見/i, '公园樱花树下'],
    [/beach|沙滩|海滨|海边|海滩/i, '海边沙滩'],
    [/bedroom|bed.*room|床|卧室|寝室|ベッド/i, '卧室'],
    [/bathroom|shower|浴室|淋浴|卫生间|風呂/i, '浴室'],
    [/kitchen|厨房|台所/i, '厨房'],
    [/office|办公室|职场|事務所/i, '办公室'],
    [/hotel|酒店|旅馆|宾馆|ホテル/i, '酒店房间'],
    [/car|车内|车里|汽车|車/i, '车内'],
    [/pool|swimming.*pool|泳池|游泳池|プール/i, '游泳池边'],
    [/forest|tree|森林|树林|森/i, '森林中'],
    [/rooftop|天台|楼顶|屋上/i, '天台'],
    [/balcony|阳台|ベランダ/i, '阳台上'],
    [/street|街道|街头|街/i, '街头'],
    [/yacht|deck|甲板|游艇|クルーザー/i, '游艇甲板上'],
    [/studio|影棚|摄影棚|スタジオ/i, '摄影棚'],
    [/classroom|教室|课堂|教室/i, '教室'],
    [/gym|健身房|ジム/i, '健身房'],
    [/corridor|走廊|过道|廊下/i, '走廊'],
    [/outdoor|户外|野外|屋外/i, '户外'],
    [/mountain|山|山顶|山頂/i, '山顶'],
    [/cafe|咖啡厅|咖啡馆|カフェ/i, '咖啡厅'],
    [/onsen|温泉|hot.*spring/i, '温泉汤池'],
    [/tatami|榻榻米|和室/i, '和室榻榻米'],
    [/futon|被褥|蒲团/i, '铺着被褥的和室'],
  ];

  for (const [pattern, label] of sceneMap) {
    if (pattern.test(combined)) { envTags.push(label); break; }
  }

  const atmoMap: Array<[RegExp, string]> = [
    [/warm.*tone|warm|暖色|暖调|温馨|暖/i, '暖色调'],
    [/cool.*tone|cool|冷色|冷调/i, '冷色调'],
    [/dark|darkness|暗调|暗色|暗い/i, '暗调氛围'],
    [/romantic|浪漫|ロマンチック/i, '浪漫氛围'],
    [/sensual|erotic|暧昧|情欲|官能/i, '暧昧情欲'],
    [/dreamy|dream|梦幻|梦境|夢/i, '梦幻氛围'],
    [/golden.*hour|golden|夕阳|黄昏|dusk|夕暮/i, '夕阳余晖'],
    [/morning|dawn|清晨|黎明|朝/i, '清晨光线'],
    [/sunlight|sun.*light|阳光|日光|阳光.*洒|陽射/i, '阳光明媚'],
    [/soft.*light|soft|柔和|柔光|柔らかい/i, '柔和光线'],
    [/backlit|back.*light|逆光|背光|轮廓光|逆光/i, '逆光轮廓'],
    [/neon|霓虹|ネオン/i, '霓虹灯光'],
    [/candlelight|蜡烛|烛光|ローソク/i, '烛光氛围'],
    [/rain|雨滴|雨天|雨.*氛|雨/i, '雨滴氛围'],
    [/fog|haze|雾|薄雾|霧/i, '薄雾氛围'],
    [/fire|火焰|火光|炎/i, '火光氛围'],
    [/moonlight|月光|月明かり/i, '月光氛围'],
    [/intimate|私密|亲密|親密/i, '亲密氛围'],
    [/dramatic|戏剧.*效|ドラマ/i, '戏剧光效'],
    [/night|夜晚|夜间|夜景|夜/i, '夜晚氛围'],
    [/moody|沉郁|陰/i, '沉郁氛围'],
  ];

  for (const [pattern, label] of atmoMap) {
    if (pattern.test(combined)) { envTags.push(label); break; }
  }

  if (envTags.length > 0) {
    parts.push('，' + envTags.join('，'));
  }

  // ── 4. 运镜/镜头 ────────────────────────────────────────────────────
  const shotMap: Array<[RegExp, string]> = [
    [/close.*up|特写|closeup|接写/i, '特写镜头'],
    [/medium.*shot|中景|中镜头|ミドル/i, '中景镜头'],
    [/long.*shot|远景|全景|全身|ロング/i, '全景镜头'],
    [/pov|first.*person|主观|第一视角|POV/i, '主观视角镜头'],
    [/tracking|跟随|跟拍|追従/i, '跟随镜头'],
    [/overhead|俯拍|俯视|top.*view|俯瞰/i, '俯拍镜头'],
    [/low.*angle|仰拍|仰视|ローアングル/i, '仰拍镜头'],
    [/cinematic|电影感|シネマ/i, '电影感镜头'],
    [/profile|侧拍|侧面|横顔/i, '侧拍镜头'],
    [/wide.*shot|wide|广角|ワイド/i, '广角镜头'],
    [/three.*quarter|四分之三|三クォーター/i, '四分之三视角镜头'],
    [/slow.*motion|slowmo|慢动作|スロー/i, '慢动作镜头'],
    [/panoramic|全景|パノラマ/i, '全景镜头'],
    [/dolly|轨道|ドリー/i, '轨道推进镜头'],
  ];

  for (const [pattern, label] of shotMap) {
    if (pattern.test(combined)) { parts.push(`，${label}`); break; }
  }

  // ── 5. 风格/画质 ────────────────────────────────────────────────────
  parts.push('，4K');
  parts.push('，超高清');

  if (r18Mode) {
    parts.push('，超详细皮肤纹理');
    parts.push('，流畅60fps真实物理运动');
    parts.push('，电影感人像');
  } else {
    parts.push('，流畅自然');
    parts.push('，60fps');
    parts.push('，电影感');
  }

  // ── 6. 负向提示 ────────────────────────────────────────────────────
  parts.push('，无变形');
  if (r18Mode) {
    parts.push('，无畸变');
  } else {
    parts.push('，无模糊');
  }

  // ── Final assembly ─────────────────────────────────────────────────
  let result = parts.join('');

  // Fix double/triple commas
  result = result.replace(/，{2,}/g, '，');

  // Ensure it ends with Chinese period
  if (!/[。！？]$/.test(result)) result += '。';

  return result;
}
