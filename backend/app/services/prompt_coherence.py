"""Prompt Coherence Engine - 提示词冲突检测与修复

检测 LLM 输出的提示词中的逻辑矛盾，并调用 LLM 重写为连贯描述。
"""

import re
from typing import List, Tuple

from app.services.llm_service import call_grok


# ── 冲突模式定义 ──
CONFLICT_PATTERNS: List[Tuple[re.Pattern, str]] = [
    # 手铐/束缚 + 手抬起/伸展 矛盾
    (
        re.compile(
            r"(handcuff|binding her arms behind her back|arms behind back|wrist restraint|chained|bound|cuffed)",
            re.I,
        ),
        re.compile(
            r"(one hand (slightly )?raised|hand (slightly )?raised|arm outstretched|hand on hip|"
            r"hand on chest|hand in pocket|hand touching|one hand on)",
            re.I,
        ),
        "手部束缚与手抬起动作矛盾",
    ),
    # 站立 + 坐着 矛盾
    (
        re.compile(r"\bstanding\b", re.I),
        re.compile(r"\bsitting\b", re.I),
        "站立与坐姿矛盾",
    ),
    # 站立 + 躺卧 矛盾
    (
        re.compile(r"\bstanding\b", re.I),
        re.compile(r"\b(lying|lying down|reclining|prone|supine)\b", re.I),
        "站立与躺卧矛盾",
    ),
    # 坐着 + 躺卧 矛盾
    (
        re.compile(r"\bsitting\b", re.I),
        re.compile(r"\b(lying|lying down|reclining|prone|supine)\b", re.I),
        "坐姿与躺卧矛盾",
    ),
    # 过多上装层叠（3件以上）
    (
        re.compile(
            r"wearing.*\b(shirt|top|dress|blouse|sweater|jacket|crop|tank|camisole|hoodie|corset|bra)\b.*"
            r"over.*\b(shirt|top|dress|blouse|sweater|jacket|crop|tank|camisole|hoodie|corset|bra)\b.*"
            r"over.*\b(shirt|top|dress|blouse|sweater|jacket|crop|tank|camisole|hoodie|corset|bra)\b",
            re.I,
        ),
        None,
        "过多上装层叠（超过2层）",
    ),
    # 同时描述多个完全不同的服装组合
    (
        re.compile(
            r"(?:wearing|clad in|dressed in).*(?:shorts|skirt|pants|jeans).*(?:shorts|skirt|pants|jeans)",
            re.I,
        ),
        None,
        "多个下装描述冲突",
    ),
    # 重复的身体部位描述矛盾
    (
        re.compile(
            r"\b(blonde|brunette|red|black|white|silver|pink|blue|purple)\b.*\bhair\b.*"
            r"\b(blonde|brunette|red|black|white|silver|pink|blue|purple)\b.*\bhair\b",
            re.I,
        ),
        None,
        "多种发色描述",
    ),
    # 多种皮肤色调描述矛盾
    (
        re.compile(
            r"\b(pale|fair|light)\b.*\b(dark|tan|brown|olive)\b|\b(dark|tan|brown|olive)\b.*\b(pale|fair|light)\b",
            re.I,
        ),
        None,
        "多种肤色描述矛盾",
    ),
    # 多人物描述冲突（同一提示词中多个角色特征冲突）
    (
        re.compile(
            r"\b(Nordic|Scandinavian|Eastern European|Caucasian|European)\b.*"
            r"\b(Chinese|Japanese|Korean|East Asian|Asian)\b|\b(Chinese|Japanese|Korean|East Asian|Asian)\b.*"
            r"\b(Nordic|Scandinavian|Eastern European|Caucasian|European)\b",
            re.I,
        ),
        None,
        "多种种族/外貌描述冲突（北欧+亚洲特征同时出现）",
    ),
]

# ── 矛盾姿态关键词 ──
POSES = {
    "standing": re.compile(r"\bstanding\b", re.I),
    "sitting": re.compile(r"\b(sitting|seated|sits on|perched on|sitting on)\b", re.I),
    "lying": re.compile(r"\b(lying|lying down|reclining|prone|supine|laying down|on all fours)\b", re.I),
    "kneeling": re.compile(r"\b(kneeling|kneeling on|kneels|crawling|on knees)\b", re.I),
    "walking": re.compile(r"\b(walking|striding|stalking|marching|stepping)\b", re.I),
    "crouching": re.compile(r"\b(crouching|squatting|hunched)\b", re.I),
}

# ── 多种性爱体位关键词（互斥）──
R18_POSITIONS = re.compile(
    r"\b(cowgirl|reverse cowgirl|cowgirl position|doggystyle|doggystyle anal|doggystyle deep|"
    r"missionary|missionary anal|missionary variant|standing sex|standing missionary|standing doggystyle|"
    r"seated straddle|sitting position|sitting sex|sitting on|"
    r"prone bone|prone position|prone rape|lying prone|on all fours|all fours|on stomach|"
    r"crouching sex|squatting|squating|scissor position|scissoring|scissor|"
    r"wheelbarrow|bridging position|arched back|facing away|facing forward|"
    r"from behind|from side|on top|bottom position|top position|"
    r"legs spread|legs up|legs open|legs together|kneeling doggystyle|"
    r"standing doggystyle|standing missionary|in reverse|six-nine|69|sixty-nine|"
    r"pile driver|butterfly position|mating press|press|legs in air|leg hold|"
    r"missionary position|cowgirl position|anal cowgirl|anal missionary|anal doggystyle|anal standing)\b",
    re.I,
)

# ── 多种肤色关键词 ──
SKIN_TONES = re.compile(
    r"\b(pale|fair|light|fresh|creamy|albino)\s+(?:skin|complect|toned)|"
    r"\b(dark|tan|brown|deep|ebony|chocolate|mocha|caramel)\s+(?:skin|complect|toned)|"
    r"\b(olive|golden|bronze|bronzed)\s+(?:skin|complect|toned)|"
    r"\bskin\s+(?:tone|color|colou)?r?\s*(?:is\s+)?(pale|fair|light|dark|tan|olive|bronze|brown|ebony)\b|"
    r"\b(alabaster|ivory|porcelain|flesh)\s+skin\b",
    re.I,
)

# ── 多种种族/外貌特征关键词 ──
ETHNICITIES = re.compile(
    r"\b(east asian|chinese|japanese|korean|thai|vietnamese|southeast asian|"
    r"caucasian|european|western|mediterranean|nordic|scandinavian|eastern european|"
    r"african|african american|afro|black\b|"
    r"hispanic|latino|latina|mestizo|"
    r"middle eastern|arab|persian|"
    r"indian|south asian|pakistani|bangladeshi|"
    r"pacific islander|polynesian|melanesian|"
    r"native american|aboriginal|indigenous|inuit|"
    r"mixed race|multiracial|biracial|half)\b",
    re.I,
)

# ── 多种眼睛颜色关键词 ──
EYE_COLORS = re.compile(
    r"\b(blue|green|brown|hazel|grey|gray|amber|violet|purple|red|pink|gold|golden|black)\s+(?:eyes?|irises?|eye color)\b|"
    r"\beyes?\s+(?:are\s+)?(blue|green|brown|hazel|grey|gray|amber|violet|purple|red|pink|gold|golden|black)\b|"
    r"\b(blue-eyed|green-eyed|brown-eyed|hazel-eyed|grey-eyed|gray-eyed|amber-eyed|violet-eyed|purple-eyed|red-eyed|gold-eyed|golden-eyed)\b|"
    r"\bheter?ochromia\b",
    re.I,
)

# ── 全裸/衣物关键词 ──
NUDE_PATTERNS = re.compile(
    r"\b(completely naked|fully naked|totally nude|streaking|naked\b|in the nude|"
    r"bare naked|stripped naked|nude body|nude form|nude figure|stark naked|"
    r"without clothes|without clothing|devoid of clothing|all skin|skin exposed|"
    r"clothes off|clothing off|naked skin|fully exposed|in birthday suit|"
    r"stripped down|nude flesh|skin to skin|hardcore nude|full frontal|"
    r"sexually exposed| genitals visible|bare genitals|exposed breasts|"
    r"exposed nipples|exposed anus|bare butt|exposed body)\b",
    re.I,
)
CLOTHED_PATTERNS = re.compile(
    r"\b(wearing|clothed|clad|dressed|with\s+\w+\s+on|has\s+\w+\s+on|"
    r"outfit|dressed in|attired|garbed|robed|swimsuit|bikini|underwear|"
    r"panties|bra|lingerie|pajamas|uniform|costume|dressed up|"
    r"fully clothed|semi-clothed|partially clothed|intact clothing)\b",
    re.I,
)

# ── 制服/套装关键词 ──
UNIFORM_PATTERNS = re.compile(
    r"\b(flight attendant|airline uniform|police uniform|police officer uniform|"
    r"nurse uniform|scrubs|maid costume|maid outfit|cheerleader uniform|"
    r"cheerleader outfit|school-adjacent|school uniform adjacent|"
    r"military uniform|army uniform|naval uniform|business suit|"
    r"office suit|executive suit|formal uniform|waitress uniform|"
    r"waiter uniform|fantasy armor|medieval costume|maid apron|"
    r"latex catsuit|bodysuit|fetish costume|uniform fetish|"
    r"flight suit|chef uniform|barista apron|kimono|traditional costume)\b",
    re.I,
)

# ── SM/束缚关键词 ──
SM_PATTERNS = re.compile(
    r"\b(handcuff|handcuffs|behind back|wrist restraint|wrist restraints|chained|"
    r"bound\b|cuffed\b|restrained|shackled|manacled|bondage|strapped|leather cuff|"
    r"floor chain|head under|head between|spreader bar|pillory|stocks|hogtied|rope bind|"
    r"rope bondage|shibari|latex|ballgag|gag|bondage gag|rope tie|ankle cuff|"
    r"leg shackle|chained feet|leg chain|leather harness|leather collar|leash|"
    r"whip|paddle|flog|spank|dominant|dominatrix|submissive|bdsm|sm\b|"
    r"restraint|bondage gear|latex suit|rubber suit|straitjacket|nipple clamp|"
    r"clothespin|crotch rope|anal hook|sounding|extreme restraint|hanging chain)\b",
    re.I,
)

# ── 性玩具/道具关键词 ──
SEX_TOYS_PATTERNS = re.compile(
    r"\b(dildo|vibrator|massager|sex toy|sex toys|butt plug|anal plug|anal beads|"
    r"ben wa ball|love ball|steel ball|egg vibrator|prostate massager|"
    r"strap-on|dildonic|toy inserted|toy in|toys used|vibrating| vibrating |"
    r"electric toy|glass dildo|double-ended|silicone toy|rubber toy)\b",
    re.I,
)

# ── 多人/群P关键词 ──
MULTI_PERSON_PATTERNS = re.compile(
    r"\b(two people|three people|group sex|gangbang|threesome|foursome|"
    r"orgy|group scene|multiple partners|double penetration|triple penetration|"
    r"double|doubled|multiple men|multiple women|two men|three men|two women|"
    r"dp\b|dp scene|tp\b|gang bang|swap|partner swap|swinging)\b",
    re.I,
)

# ── 束缚关键词 ──
RESTRAINT_PATTERNS = re.compile(
    r"(handcuff|behind back|wrist restraint|wrist restraint|chained|bound|cuffed|"
    r"restrained|shackled|manacled|bondage|strapped|leather cuff|floor chain|"
    r"head under|head between|spreader bar|pillory|stocks|hogtied|rope bind)",
    re.I,
)

# ── 矛盾的手部动作关键词 ──
HAND_GESTURE_PATTERNS = re.compile(
    r"(one hand (slightly )?raised|hand (slightly )?raised|right hand raised|"
    r"left hand raised|both hands raised|fingers spread|fingers on|fingers against|"
    r"fingers touching|fingers near|fingers at|hand near face|hand on cheek|hand on chin|hand on "
    r"neck|hand on chest|hand on hip|hand in hair|hand grabbing|arm "
    r"outstretched|fingers splayed|finger in mouth|hand waving|arm raised|"
    r"fingernails|long fingernails)",
    re.I,
)

# ── 环境场景关键词 ──
INDOOR_ENVIRONMENTS = re.compile(
    r"\b(subway|metro|underground station|subway platform|subway car|train car|"
    r"bedroom|living room|bathroom|shower|bathtub|toilet|"
    r"office|classroom|studio|church|temple|shrine|"
    r"dungeon|prison|cell|cage|bar|nightclub|bar club|"
    r"kitchen|bathroom|hotel|lobby|gym|changing room|"
    r"indoor|inside|inside room|room|interior)\b",
    re.I,
)
OUTDOOR_ENVIRONMENTS = re.compile(
    r"\b(sky|open sky|under the sky|outdoor|outside|outdoors|street|alley|alleyway|"
    r"beach|ocean|sea|shore|sand|tropical|desert|mountain|forest|jungle|"
    r"garden|park|rooftop|rooftop terrace|balcony|balcony|window|"
    r"marina|harbor|dock|pier|port|river|lake|waterfront|"
    r"city street|urban|town square|marketplace|plaza|"
    r"bridge|tunnel entrance|countryside|meadow|field|valley|canyon|cliff|cave|"
    r"night sky|starry sky|cloudy sky|overcast sky|sunset|dawn|dusk|"
    r"rain|storm|lightning|thunder|weather)\b",
    re.I,
)

# ── 身体暴露/覆盖状态关键词 ──
BODY_EXPOSED = re.compile(
    r"\b(naked|nude|exposed|stripped|half-naked|semi-naked|topless|bare|"
    r"clothed|naked torso|bare skin|skin exposed|breasts exposed|cleavage exposed|"
    r"genitals exposed|nipples visible|areola visible|ass exposed)\b",
    re.I,
)
BODY_COVERED = re.compile(
    r"\b(wearing|clothed|dressed|fully covered|fully clothed|fully dressed|"
    r"fully dressed in|outfit|uniform|suit|armor|robe|gown|dress|blouse|shirt|"
    r"jacket|coat|hoodie|sweater|sweater vest|garments|attire|apparel)\b",
    re.I,
)

# ── 光照/天气关键词 ──
NATURAL_LIGHT = re.compile(
    r"\b(sunlight|sun light|natural light|natural daylight|daylight|"
    r"overcast sky|cloudy|cloud covered|sun|sunshine|bright daylight|"
    r"moonlight|moon light|starlight|starry|twilight|golden hour|"
    r"ambient light|ambient daylight|soft outdoor lighting|outdoor lighting)\b",
    re.I,
)
ARTIFICIAL_LIGHT = re.compile(
    r"\b(neon|neon light|neon lights|flickering neon|fluorescent|"
    r"candlelight|candle light|dim lighting|dim light|low light|"
    r"spotlight|stage light|backlighting|rim lighting|volumetric light|"
    r"red light|blue light|moody lighting|dramatic lighting|dark lighting|"
    r"studio light|studio lighting|lamp|lightbulb|LED|UV light|blacklight)\b",
    re.I,
)


def detect_prompt_conflicts(prompt: str) -> List[str]:
    """
    检测提示词中的逻辑冲突。
    返回冲突描述列表，空列表 = 无冲突。
    """
    conflicts: List[str] = []

    # 1. 正则模式匹配
    for pattern_a, pattern_b, description in CONFLICT_PATTERNS:
        if pattern_b is None:
            if pattern_a.search(prompt):
                conflicts.append(description)
        else:
            if pattern_a.search(prompt) and pattern_b.search(prompt):
                conflicts.append(description)

    # 2. 姿态冲突检测
    matched_poses = []
    for pose_name, pose_re in POSES.items():
        if pose_re.search(prompt):
            matched_poses.append(pose_name)

    # 站立和行走可以共存，但站立/坐姿/躺姿互斥
    exclusive_poses = [p for p in matched_poses if p in ("standing", "sitting", "lying")]
    if len(exclusive_poses) > 1:
        conflicts.append(f"姿态矛盾: {', '.join(exclusive_poses)}")

    # 3. 手铐时手部细节矛盾（大幅加强）
    has_restraint = RESTRAINT_PATTERNS.search(prompt)
    has_hand_detail = HAND_GESTURE_PATTERNS.search(prompt)
    if has_restraint and has_hand_detail:
        conflicts.append("手部束缚与手部细节动作矛盾（戴着手铐/被束缚时无法做出抬手等自由动作）")

    # 3b. 脚铐/站立矛盾
    has_ankle_restraint = re.search(
        r"(ankle cuff|leg shackle|shackled ankles|chained feet|leg chain|floor chain)",
        prompt, re.I,
    )
    has_standing = re.search(r"\bstanding\b", prompt, re.I)
    if has_ankle_restraint and has_standing:
        conflicts.append("脚部束缚与站立姿态矛盾")

    # 3c. 嘴被堵住时说话/呻吟矛盾
    has_gag = re.search(
        r"\b(gag|bondage gag|ballgag|bit gag|tape on mouth|mouth taped|"
        r"mouth covered|muffled|cloth in mouth|leash in mouth)\b",
        prompt, re.I,
    )
    has_speaking = re.search(
        r"\b(speaking|says|said|whispers|whispering|moaning|screaming|"
        r"crying out|gasping for breath|words|voice|speaking aloud)\b",
        prompt, re.I,
    )
    if has_gag and has_speaking:
        conflicts.append("口部封堵与说话/呻吟矛盾")

    # 3d. 悬空/漂浮与地面动作矛盾
    has_floating = re.search(
        r"\b(floating|hovering|levitating|suspended|in the air)\b", prompt, re.I,
    )
    has_ground_pose = re.search(
        r"\b(kneeling on|sitting on the floor|lying on the floor|crawling on|"
        r"standing on the ground|feet on the floor)\b",
        prompt, re.I,
    )
    if has_floating and has_ground_pose:
        conflicts.append("悬浮状态与地面动作矛盾")

    # 3e. 衣物状态矛盾：穿着一边说全裸
    has_naked = NUDE_PATTERNS.search(prompt)
    has_wearing = CLOTHED_PATTERNS.search(prompt)
    if has_naked and has_wearing:
        conflicts.append("衣物状态矛盾（一边穿衣服一边全裸）")

    # 3f. 过多眼睛颜色描述矛盾
    eye_colors = EYE_COLORS.findall(prompt)
    if len(eye_colors) > 2:
        conflicts.append(f"过多眼睛颜色描述矛盾（{len(eye_colors)}种颜色）")

    # 3g. 过多不同服装描述（>3件主要服装）
    clothing_items = re.findall(
        r"\b(shirt|blouse|top|dress|skirt|shorts|pants|jeans|leggings|"
        r"jacket|sweater|coat|hoodie|crop top|tank top|camisole|corset|bra|"
        r"underwear|panties|lingerie|bikini|swimsuit)\b",
        prompt, re.I,
    )
    if len(clothing_items) > 3:
        conflicts.append(f"过多服装描述（{len(clothing_items)}件），可能导致构图混乱")

    # 3h. 多人物描述（双阳具、群体等，需要明确多人场景）
    multi_person = re.findall(
        r"\b(two|double|triple|multiple|several|both|trio|group)\b.*\b(penis|cock|dick)\b",
        prompt, re.I,
    )
    if len(multi_person) >= 2:
        conflicts.append("多人物/多阳具描述与单人物特征可能冲突")

    # 3i. 身体部位物理矛盾：跪姿 + 站立同时描述
    kneeling = re.search(r"\b(kneeling|kneels?\b|kneeling on|on knees)\b", prompt, re.I)
    standing_with_body = re.search(
        r"\b(standing upright|standing tall|standing pose|standing firmly)\b", prompt, re.I
    )
    if kneeling and standing_with_body:
        conflicts.append("跪姿与站姿同时描述物理矛盾")

    kneeling_full = re.search(r"\bkneeling\b", prompt, re.I)
    standing_full = re.search(r"\bstanding\b", prompt, re.I)
    if kneeling_full and standing_full:
        conflicts.append("跪姿与站姿同时描述物理矛盾")

    # 3j. 多种性爱体位同时出现矛盾
    position_matches = R18_POSITIONS.findall(prompt)
    if len(position_matches) > 1:
        unique_positions = set(p.lower() for p in position_matches)
        if len(unique_positions) > 1:
            conflicts.append(f"多种性爱体位描述矛盾（{len(unique_positions)}种体位）")

    # 3k. 多种肤色/种族描述矛盾
    skin_tone_matches = SKIN_TONES.findall(prompt)
    if len(skin_tone_matches) > 1:
        conflicts.append(f"多种肤色描述矛盾（{len(skin_tone_matches)}种肤色）")

    # 3l. 多种种族/外貌特征描述矛盾
    ethnicity_matches = ETHNICITIES.findall(prompt)
    if len(ethnicity_matches) > 1:
        unique_eth = set(p.lower() for p in ethnicity_matches)
        if len(unique_eth) > 1:
            conflicts.append(f"多种种族/外貌描述矛盾（{len(unique_eth)}种种族特征）")

    # 3m. 环境场景矛盾：室内 + 室外同时出现
    indoor_matches = INDOOR_ENVIRONMENTS.findall(prompt)
    outdoor_matches = OUTDOOR_ENVIRONMENTS.findall(prompt)
    if indoor_matches and outdoor_matches:
        unique_indoor = set(i.lower() for i in indoor_matches)
        unique_outdoor = set(o.lower() for o in outdoor_matches)
        # 排除模糊词汇
        unique_indoor.discard("indoor")
        unique_indoor.discard("inside")
        unique_outdoor.discard("outdoor")
        unique_outdoor.discard("outside")
        unique_outdoor.discard("outdoors")
        if unique_indoor and unique_outdoor:
            conflicts.append(f"环境场景矛盾（室内+室外同时出现）")

    # 3n. 光照矛盾：自然光 + 人工光同时出现
    natural_matches = NATURAL_LIGHT.findall(prompt)
    artificial_matches = ARTIFICIAL_LIGHT.findall(prompt)
    if natural_matches and artificial_matches:
        conflicts.append(f"光照环境矛盾（自然光+人工光同时出现）")

    # 3o. 身体暴露状态矛盾：全裸/暴露 + 穿着/覆盖同时出现
    exposed_matches = BODY_EXPOSED.findall(prompt)
    covered_matches = BODY_COVERED.findall(prompt)
    if exposed_matches and covered_matches:
        conflicts.append("身体覆盖状态矛盾（暴露+穿着同时出现）")

    # 3p. 服装类别矛盾：比基尼/泳装 + 裙/裤/正装 同时出现
    swimwear_items = re.findall(
        r"\b(bikini|swimsuit|bathing suit|one-piece|monokini|tankini|swimwear)\b",
        prompt, re.I,
    )
    formal_items = re.findall(
        r"\b(dress|skirt|dress top|ball gown|evening gown|wedding dress|suit jacket|blazer)\b",
        prompt, re.I,
    )
    bottom_items = re.findall(
        r"\b(pants|jeans|leggings|shorts|trousers|jumpsuit|romper)\b",
        prompt, re.I,
    )
    if swimwear_items and formal_items:
        conflicts.append("服装类别矛盾（比基尼/泳装与裙/礼服同时出现）")
    if swimwear_items and bottom_items:
        conflicts.append("服装类别矛盾（比基尼/泳装与裤/下装同时出现）")

    # 3r. 服装搭配违和检测：比基尼/泳装 + 袜子/靴/运动鞋
    legwear_items = re.findall(
        r"\b(socks?|thighs?|thigh-high|thighhigh|pantyhose|stockings?|leggings?|"
        r"knee socks|over-knee|over knee|white socks?|black socks?|"
        r"boots?|ankle boots?|combat boots?|riding boots?|high heels?|stilettos?|pumps?|"
        r"sneakers?|running shoes?|athletic shoes?|sports shoes?|trainers?)\b",
        prompt, re.I,
    )
    if swimwear_items and legwear_items:
        conflicts.append("服装搭配违和（比基尼/泳装与袜子/靴/运动鞋同时出现不合理）")

    # 3s. 正式服装 + 运动鞋/袜子 违和
    formal_all = re.findall(
        r"\b(suit|dress|evening gown|ball gown|wedding dress|cocktail dress|tuxedo)\b",
        prompt, re.I,
    )
    athletic_items = re.findall(
        r"\b(sneakers?|running shoes?|athletic shoes?|sports shoes?|jersey|track suit|sweatshirt|sweatpants|sports bra|"
        r"hoodie|training pants|fitness|sportswear|activewear)\b",
        prompt, re.I,
    )
    if formal_all and athletic_items:
        conflicts.append("服装搭配违和（正式礼服/正装与运动装/休闲装同时出现）")

    # 3t. 睡衣/内衣 + 户外靴/正式鞋 违和
    sleepwear_items = re.findall(
        r"\b(pajamas?|pajama|babydoll|nightgown|night gown|lingerie|bra and panties|bra panties|"
        r"crop top|undershirt|bra|underwear|panties)\b",
        prompt, re.I,
    )
    formal_shoes = re.findall(
        r"\b(boots?|high heels?|stilettos?|oxford shoes?|loafers?|dress shoes?|suit shoes?)\b",
        prompt, re.I,
    )
    if sleepwear_items and formal_shoes:
        conflicts.append("服装搭配违和（睡衣/内衣与正式鞋/靴同时出现不合理）")

    # 3s. 制服/套装 + 不兼容的鞋类
    uniform_items = UNIFORM_PATTERNS.findall(prompt)
    if uniform_items and legwear_items:
        for ui in uniform_items:
            if any(w in ui.lower() for w in ['maid', 'nurse', 'cheerleader', 'costume', 'kimono', 'armor']):
                conflicts.append("制服/套装与特定鞋类搭配可能不合理")

    # 3t. SM/束缚 + 手部自由动作矛盾（增强）
    sm_items = SM_PATTERNS.search(prompt)
    has_free_hand = HAND_GESTURE_PATTERNS.search(prompt)
    if sm_items and has_free_hand:
        conflicts.append("SM/束缚状态与手部自由动作矛盾（戴着手铐/绳缚时无法自由抬手）")

    # 3u. SM + 多人场景冲突
    sm_count = len(SM_PATTERNS.findall(prompt))
    multi_person_count = len(MULTI_PERSON_PATTERNS.findall(prompt))
    if sm_count > 0 and multi_person_count > 0:
        conflicts.append("SM场景与多人场景同时出现，可能产生构图冲突")

    # 3v. 多人 + 站立姿势矛盾
    multi_matches = MULTI_PERSON_PATTERNS.findall(prompt)
    has_standing_full = re.search(r"\bstanding\b", prompt, re.I)
    if len(multi_matches) >= 2 and has_standing_full:
        conflicts.append("多人场景中同时描述站立姿势可能导致构图混乱")

    # 3w. 过多性玩具描述
    toy_matches = SEX_TOYS_PATTERNS.findall(prompt)
    if len(toy_matches) > 3:
        conflicts.append(f"过多性玩具描述（{len(toy_matches)}个），可能导致构图元素过多")

    # 3q. 提示词过长且包含过多标签（可能导致构图混乱）
    comma_count = prompt.count(",")
    if comma_count >= 8 and len(prompt) > 800:
        conflicts.append(f"提示词过长且包含过多标签（{comma_count}个逗号），可能导致构图混乱")

    # 4. 检查过多逗号分隔的标签列表（典型特征）
    comma_separated = re.findall(r"[^,]+,[^,]+,[^,]+,[^,]+,[^,]+", prompt)
    if comma_separated and len(prompt) < 300:
        # 短提示词且大量逗号分隔，可能是标签列表而非连贯描述
        conflicts.append("提示词过短且包含多个标签，疑似标签列表而非连贯段落")

    return conflicts


async def rewrite_coherent_prompt(prompt: str, api_key: str) -> str:
    """
    当检测到冲突时，调用 LLM 将提示词重写为连贯的段落描述。
    """
    rewrite_instruction = """You are a prompt coherence fixer. The following prompt has logical contradictions or is just a tag list.

Rewrite it as a SINGLE COHERENT PARAGRAPH following these STRICT rules:
1. ONE physically possible pose. If arms are bound/handcuffed, NO hand gestures or free arm movements. If standing with shackles, the character must be stationary. If gagged, NO speaking or whispering. If lying down, NO standing. If floating, NO ground contact. If kneeling, NO standing. If suspended/hanging, NO feet on ground.
2. ONE cohesive outfit (max 2 items). Follow these outfit compatibility rules:
   - Bikini/swimsuit: Do NOT add dress, skirt, pants, leggings, shorts, socks, stockings, boots, or sneakers. Leave body mostly exposed.
   - Formal dress/gown/suit: Do NOT add sneakers, athletic wear, sports shoes, or casual tops.
   - Pajamas/lingerie/underwear: Do NOT add formal shoes or boots. Wear barefoot or casual slippers.
   - Athletic wear/sports: Do NOT combine with formal dress, heels, or evening wear.
3. ONE sexual position only. Do NOT describe multiple sexual positions (e.g. cowgirl + doggystyle simultaneously).
4. ONE skin tone and ONE ethnicity only. Do NOT describe multiple skin tones or mixed ethnicities in the same character.
5. ONE environment setting. Do NOT mix indoor settings (subway, bedroom, office, hotel, dungeon) with outdoor settings (sky, beach, street, marina, outdoor). Pick ONE environment and stick to it.
6. ONE lighting style. Do NOT mix natural outdoor light with artificial indoor light. Either outdoor natural light (sunlight, overcast sky, moonlight) OR indoor artificial light (neon, candle, studio, dim).
7. ONE body coverage state. Do NOT describe body as both exposed/naked AND clothed/covered at the same time.
8. Remove ALL contradictions. Every body part described must be consistent with any restraints mentioned.
9. NO tag lists. NO bullet points. NO commas separating tags.
10. Write as a flowing narrative paragraph.
11. All characters must be ADULTS (18+). No minors.
12. Keep the same theme, mood, and key elements, but make it logically coherent.
13. IMPORTANT - DO NOT describe character appearance: Do NOT mention hair color, eye color, skin color, race, ethnicity, body type, face shape, cheekbones, lips, nose, skin tone, or any physical appearance details. The reference image defines the character.
14. Only describe: pose, body position, clothing state (wearing/removed), setting, lighting, mood, camera angle, and artistic style.

Output ONLY the rewritten coherent paragraph. Nothing else."""

    try:
        result = await call_grok(api_key, rewrite_instruction, f"Original: {prompt}")
        return result.strip()
    except Exception:
        # 如果重写失败，尝试简单修复
        return _fallback_fix(prompt)


def _fallback_fix(prompt: str) -> str:
    """
    简单的规则修复（不依赖 LLM）：
    1. 检测并移除矛盾的手部动作
    2. 保留主要姿态
    3. 清理重复标签
    4. 移除矛盾的环境/光照描述（保留第一个出现的）
    """
    lines = prompt.replace(" , ", ", ").split("\n")

    # 移除逗号分隔的短标签列表模式
    fixed_lines = []
    for line in lines:
        comma_count = line.count(",")
        if comma_count >= 5 and len(line) < 400 and not line.endswith("."):
            continue
        fixed_lines.append(line)

    result = " ".join(fixed_lines).strip()

    if len(result) < 50:
        return prompt

    # 简单环境清理：如果同时出现多个矛盾环境，保留第一个
    environments = INDOOR_ENVIRONMENTS.findall(result)
    outdoor_envs = OUTDOOR_ENVIRONMENTS.findall(result)
    if environments and outdoor_envs:
        for env_word in ["subway", "bedroom", "office", "hotel", "dungeon"]:
            for out_word in ["sky", "beach", "street", "marina", "outdoor"]:
                if env_word in result.lower() and out_word in result.lower():
                    # 移除第二个出现的矛盾词（简单策略：移除包含 out_word 的部分）
                    out_pattern = re.compile(
                        rf"[^.]*{re.escape(out_word)}[^.]*\.?|"
                        rf"[^,]*\b{re.escape(out_word)}\b[^,]*",
                        re.I,
                    )
                    cleaned = out_pattern.sub("", result)
                    if len(cleaned) > 50:
                        result = cleaned
                    break

    return result
