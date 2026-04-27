/**
 * Generate a pure Chinese video prompt from an image prompt using the Wan 2.2 template:
 * [人物身份/外观] + [动作序列（时间副词+强动词）] + [环境/氛围] + [运镜/镜头] + [风格/画质] + [负向提示]
 *
 * Design principles:
 * - Output pure Chinese, no English words
 * - Deduplicate tags before output
 * - Action is the primary focus (NOT subject/outfit repetition)
 * - Each tag appears at most once
 *
 * Example output:
 * "一位20多岁的年轻女孩，穿着白色连衣裙，在公园樱花树下缓缓行走，右手轻轻拂过花瓣，嘴角带着微笑，阳光透过树叶洒下斑驳光影，中景镜头，暖色调，4K，超高清，流畅自然，60fps，无变形，无模糊。"
 */

export function extractVideoPromptFromImagePrompt(imagePrompt: string, r18Mode = false): string {
  const p = imagePrompt.toLowerCase();
  const used = new Set<string>();
  const push = (tag: string) => {
    if (tag && !used.has(tag)) {
      used.add(tag);
      return tag;
    }
    return null;
  };

  const parts: string[] = [];

  // ── 1. 人物身份/外观 ───────────────────────────────────────────────
  const identityTags: string[] = [];

  // Subject type
  if (push('一位年轻女孩')) identityTags.push('一位年轻女孩');
  else if (/1girl|solo.*girl|one.*girl|one.*woman/i.test(p)) identityTags.push('一位年轻女孩');
  else if (/1boy|solo.*boy|one.*man|one.*boy/i.test(p)) identityTags.push('一位年轻男性');
  else if (/2girl|two.*girl|two.*woman/i.test(p)) identityTags.push('两位年轻女孩');
  else if (/couple|lovers|情侣/i.test(p)) identityTags.push('一对情侣');
  else if (/girl|woman|female|女性|女孩/i.test(p)) identityTags.push('一位年轻女性');
  else if (/boy|man|male|男性|男孩/i.test(p)) identityTags.push('一位年轻男性');
  else identityTags.push('一位人物');

  // Age
  if (/teen|young.*girl|young.*woman|20.*岁|二十/i.test(p)) identityTags.push('20多岁');
  else if (/middle.*aged|中年/i.test(p)) identityTags.push('中年');
  else if (/elderly|old.*man|old.*woman|老爷爷|老奶奶/i.test(p)) identityTags.push('老年');

  // Body type
  if (/slim|skinny|苗条|纤细/i.test(p)) identityTags.push('身材苗条');
  else if (/curvy|voluptuous|丰满/i.test(p)) identityTags.push('身材丰满');
  else if (/muscular|肌肉/i.test(p)) identityTags.push('肌肉健硕');
  else if (/petite|娇小/i.test(p)) identityTags.push('身材娇小');

  // Outfit — extract at most 2 outfit tags
  const outfitTags: string[] = [];
  if (/white.*dress|白色连衣裙|白色裙子/i.test(p)) outfitTags.push('穿着白色连衣裙');
  else if (/red.*dress|红色连衣裙|红色裙子/i.test(p)) outfitTags.push('穿着红色连衣裙');
  else if (/black.*dress|黑色连衣裙|黑色裙子/i.test(p)) outfitTags.push('穿着黑色连衣裙');
  else if (/wedding.*dress|婚纱/i.test(p)) outfitTags.push('穿着婚纱');
  else if (/jeans|牛仔裤/i.test(p)) outfitTags.push('穿着牛仔裤');
  else if (/nurse|护士/i.test(p)) outfitTags.push('穿着护士服');
  else if (/schoolgirl|校服/i.test(p)) outfitTags.push('穿着校服');
  else if (/maid|女仆/i.test(p)) outfitTags.push('穿着女仆装');
  else if (/lingerie|蕾丝.*内|内.*蕾丝/i.test(p)) outfitTags.push('穿着蕾丝内衣');
  else if (/bikini|比基尼/i.test(p)) outfitTags.push('穿着比基尼');
  else if (/naked|nude|全裸|赤裸/i.test(p)) outfitTags.push('全裸');
  else if (/swimsuit|泳装/i.test(p)) outfitTags.push('穿着泳装');
  else if (/latex|乳胶/i.test(p)) outfitTags.push('穿着乳胶紧身衣');
  else if (/leather.*cor|皮革.*紧|皮装/i.test(p)) outfitTags.push('穿着皮革紧身装');
  else if (/bunny|兔.*女|兔.*装/i.test(p)) outfitTags.push('穿着兔女郎装');
  else if (/casual|休闲/i.test(p)) outfitTags.push('穿着休闲装');
  else if (/business.*suit|西装/i.test(p)) outfitTags.push('穿着正装');
  else if (/hoodie|卫衣/i.test(p)) outfitTags.push('穿着卫衣');
  else if (/t-shirt|T恤/i.test(p)) outfitTags.push('穿着T恤');
  else if (/silk|丝绸/i.test(p)) outfitTags.push('穿着丝绸服饰');
  else if (/dress|连衣裙|裙子/i.test(p)) outfitTags.push('穿着连衣裙');
  else identityTags.push('穿着休闲装'); // default

  parts.push(...identityTags, ...outfitTags.slice(0, 2));

  // ── 2. 动作序列（时间副词 + 强动词）────────────────────────────────
  const actionTags: string[] = [];

  // Detect time adverb
  const hasSlow = /slow|缓|轻柔|舒缓|温柔|轻轻/i.test(p);
  const hasFast = /fast|快速|剧烈|猛/i.test(p);
  const hasSudden = /sudden|突然|忽然/i.test(p);
  const hasGentle = /gentle|温柔|柔和/i.test(p);
  const timeAdverb = hasFast ? '快速' : hasSudden ? '突然' : hasGentle ? '轻柔' : '缓缓';

  // R18 / intimate actions
  const r18Actions: Array<[RegExp, string]> = [
    [/doggy|doggystyle|back.*view|rear.*entry|后入/i, '后入式'],
    [/missionary|传教士|正面仰卧/i, '正面仰卧'],
    [/cowgirl|骑乘|女上位/i, '女上位'],
    [/bent.*over|弯腰|趴在|俯趴/i, '弯腰俯趴'],
    [/all.*four|四足|爬行/i, '四肢着地'],
    [/kneeling|knee|跪/i, '跪姿'],
    [/lying.*down|躺下|仰卧/i, '仰卧'],
    [/side.*position|侧卧|侧身/i, '侧身'],
    [/spooning|侧抱/i, '侧抱'],
    [/standing.*sex|站立.*性|站立.*交/i, '站立'],
    [/twerking|twerk|扭胯/i, '扭胯'],
    [/69/i, '69式'],
    [/69-style/i, '69式'],
  ];

  for (const [pattern, label] of r18Actions) {
    if (pattern.test(p)) { actionTags.push(`${timeAdverb}${label}`); break; }
  }

  // General actions
  if (actionTags.length === 0) {
    const generalActions: Array<[RegExp, string]> = [
      // Intimate / sensual
      [/kiss|亲吻|吻/i, '亲吻'],
      [/sucking|口交|blowjob|deepthroat|舔舐/i, '口交'],
      [/fuck|抽插|性交|性爱/i, '性交'],
      [/squirting|squirt|潮喷|喷水/i, '潮喷'],
      [/moan|呻吟/i, '轻声呻吟'],
      [/strip|脱衣/i, '缓缓脱衣'],
      [/bathing|bath|沐浴|洗澡/i, '沐浴'],
      [/shower|淋浴/i, '淋浴'],

      // Body / face
      [/sweat|流汗|出汗/i, '微微出汗'],
      [/breath|呼吸/i, '自然呼吸'],
      [/trembl|颤抖/i, '身体颤抖'],
      [/shake|抖动/i, '身体抖动'],

      // Hands / gestures
      [/raise.*hand|举手|抬手|挥.*手/i, '抬手'],
      [/brush.*hair|拂.*发|撩.*发|玩弄发丝/i, '轻撩发丝'],
      [/brush.*flower|拂.*花瓣|轻触花瓣/i, '轻触花瓣'],
      [/look.*back|回眸|回头/i, '回眸'],
      [/look.*camera|凝视镜头|看向镜头/i, '凝视镜头'],
      [/gaze|gazing|凝视|注视/i, '凝视'],
      [/smile|微笑|嘴角.*笑/i, '微笑'],
      [/laugh|大笑/i, '开怀大笑'],
      [/cry|crying|tear|流泪|哭泣/i, '含泪'],
      [/head.*tilt|歪头|侧头/i, '轻轻侧头'],

      // Movement / dance
      [/walk|行走|走路|步履/i, '行走'],
      [/slow.*walk|缓步|缓行|慢慢走/i, '缓步行走'],
      [/run|奔跑|跑步/i, '奔跑'],
      [/sprint|冲刺/i, '全力冲刺'],
      [/jump|跃起|跳跃/i, '跳跃'],
      [/dance|dancing|舞蹈|跳舞/i, '翩翩起舞'],
      [/turn|旋转|转身/i, '旋转'],
      [/sway|swing|摇摆|晃动/i, '身体轻摆'],
      [/lean|倚靠|倾斜/i, '倚靠'],
      [/stretch|舒展/i, '舒展身体'],
      [/twerk|扭臀/i, '扭胯舞动'],
      [/breast|酥胸|乳房/i, '酥胸微露'],

      // Pose / gesture
      [/pose|摆.*姿势|造型/i, '摆出姿势'],
      [/tease|挑逗|勾引/i, '挑逗'],
      [/seduce|勾引|诱惑/i, '勾引'],
      [/touch|touching|抚摸|触碰|抚摸/i, '抚摸'],
      [/caress|抚摸.*身|轻抚/i, '轻抚身体'],
      [/hug|拥抱/i, '拥抱'],
      [/hold|握住/i, '握住'],

      // Daily
      [/sit|坐/i, '坐下'],
      [/stand.*up|站起|站起来/i, '站起来'],
      [/drink|喝水|饮/i, '喝水'],
      [/eat|吃/i, '进食'],
      [/clap|鼓掌/i, '鼓掌'],
      [/wink|眨眼/i, '眨眼'],
      [/blow.*kiss|飞吻/i, '飞吻'],
    ];

    for (const [pattern, label] of generalActions) {
      if (pattern.test(p)) {
        actionTags.push(`${timeAdverb}${label}`);
        break;
      }
    }
  }

  // Expression tag (separate from action)
  if (/tease|挑逗|勾引|挑逗|sexy|性感/i.test(p) && !actionTags.some(t => t.includes('挑逗') || t.includes('勾引'))) {
    actionTags.push('眼神勾人');
  }
  if (/shy|害羞|羞涩/i.test(p)) actionTags.push('神情羞涩');
  if (/intoxicated|迷醉|迷离/i.test(p)) actionTags.push('神情迷离');

  if (actionTags.length > 0) {
    parts.push('，' + actionTags.join('，'));
  } else {
    parts.push('，自然动作');
  }

  // ── 3. 环境/氛围 ────────────────────────────────────────────────────
  const envTags: string[] = [];

  const sceneMap: Array<[RegExp, string]> = [
    [/park|garden|樱花|树下|花园|公园/i, '公园樱花树下'],
    [/beach|沙滩|海滨|海边/i, '海边沙滩'],
    [/bedroom|bed.*room|床|卧室/i, '卧室'],
    [/bathroom|shower|浴室|淋浴|卫生间/i, '浴室'],
    [/kitchen|厨房/i, '厨房'],
    [/office|办公室|职场/i, '办公室'],
    [/hotel|酒店|旅馆|宾馆/i, '酒店房间'],
    [/car|车内|车里|汽车/i, '车内'],
    [/pool|swimming.*pool|泳池|游泳池/i, '游泳池边'],
    [/forest|tree|森林|树林/i, '森林中'],
    [/rooftop|天台|楼顶/i, '天台'],
    [/balcony|阳台/i, '阳台上'],
    [/street|街道|街头/i, '街头'],
    [/yacht|deck|甲板|游艇/i, '游艇甲板上'],
    [/studio|影棚|摄影棚/i, '摄影棚'],
    [/classroom|教室|课堂/i, '教室'],
    [/gym|健身房/i, '健身房'],
    [/corridor|走廊|过道/i, '走廊'],
    [/outdoor|户外|野外/i, '户外'],
    [/mountain|山|山顶/i, '山顶'],
    [/cafe|咖啡厅|咖啡馆/i, '咖啡厅'],
  ];

  for (const [pattern, label] of sceneMap) {
    if (pattern.test(p)) { envTags.push(label); break; }
  }

  const atmoMap: Array<[RegExp, string]> = [
    [/warm.*tone|warm|暖色|暖调|温馨|暖/i, '暖色调'],
    [/cool.*tone|cool|冷色|冷调/i, '冷色调'],
    [/dark|darkness|暗调|暗色/i, '暗调氛围'],
    [/romantic|浪漫/i, '浪漫氛围'],
    [/sensual|erotic|暧昧|情欲/i, '暧昧情欲'],
    [/dreamy|dream|梦幻|梦境/i, '梦幻氛围'],
    [/golden.*hour|golden|夕阳|黄昏|dusk/i, '夕阳余晖'],
    [/morning|dawn|清晨|黎明/i, '清晨光线'],
    [/sunlight|sun.*light|阳光|日光|阳光.*洒/i, '阳光明媚'],
    [/soft.*light|soft|柔和|柔光/i, '柔和光线'],
    [/backlit|back.*light|逆光|背光|轮廓光/i, '逆光轮廓'],
    [/neon|霓虹/i, '霓虹灯光'],
    [/candlelight|蜡烛|烛光/i, '烛光氛围'],
    [/rain|雨滴|雨天|雨.*氛/i, '雨滴氛围'],
    [/fog|haze|雾|薄雾/i, '薄雾氛围'],
    [/fire|火焰|火光/i, '火光氛围'],
    [/moonlight|月光/i, '月光氛围'],
    [/intimate|私密|亲密/i, '亲密氛围'],
    [/dramatic|戏剧.*效/i, '戏剧光效'],
    [/night|夜晚|夜间|夜景/i, '夜晚氛围'],
  ];

  for (const [pattern, label] of atmoMap) {
    if (pattern.test(p)) { envTags.push(label); break; }
  }

  if (envTags.length > 0) {
    parts.push('，' + envTags.join('，'));
  }

  // ── 4. 运镜/镜头 ────────────────────────────────────────────────────
  const shotMap: Array<[RegExp, string]> = [
    [/close.*up|特写|closeup/i, '特写镜头'],
    [/medium.*shot|中景|中镜头/i, '中景镜头'],
    [/long.*shot|远景|全景|全身/i, '全景镜头'],
    [/pov|first.*person|主观|第一视角/i, '主观视角镜头'],
    [/tracking|跟随|跟拍/i, '跟随镜头'],
    [/overhead|俯拍|俯视|top.*view/i, '俯拍镜头'],
    [/low.*angle|仰拍|仰视/i, '仰拍镜头'],
    [/cinematic|电影感/i, '电影感镜头'],
    [/profile|侧拍|侧面/i, '侧拍镜头'],
    [/wide.*shot|wide|广角/i, '广角镜头'],
    [/three.*quarter|四分之三/i, '四分之三视角镜头'],
    [/slow.*motion|slowmo|慢动作/i, '慢动作镜头'],
    [/panoramic|全景/i, '全景镜头'],
    [/dolly|轨道/i, '轨道推进镜头'],
  ];

  for (const [pattern, label] of shotMap) {
    if (pattern.test(p)) { parts.push(`，${label}`); break; }
  } // if no shot found, don't add anything

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
