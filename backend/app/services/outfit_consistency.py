"""
服装描述「前后一致性」强制层 —— 颜色 + 款式（中文 / 英文双语）

背景
----
LLM 生成的分镜里，服装描述会退化出三种典型问题：

1. **省略**：分镜 1 写「宽松的白色浴袍」，分镜 3/4 只写「浴袍」。
   图像模型每个分镜都会重新想象一套衣服 → 同一角色换装。
2. **颜色 / 款式漂移**：分镜 1「白色浴袍」，分镜 4「黑色浴袍」「紧身浴袍」。
3. **同句重复 / 跨主题串味**：「浴巾已经滑落到腰部，浴巾已经滑落到腰部」；
   浴袍主题里冒出一句「黑色丝质吊带裙在灯光下泛着光泽」。

本模块做四件事（纯确定性，不调用 LLM）：

- ``dedup_repeated_clauses``   去掉同一分镜里重复的小句；
- ``build_outfit_lock``        以「第一次出现的描述」为锚，锁定每件衣服的**颜色 + 款式全称**；
- ``enforce_outfit_lock``      把后续分镜里被省略 / 漂移的服装描述改写回锚定全称；
- ``enforce_outfit_consistency`` 对外入口：中文 + 英文同时处理，并可选剔除
  不属于本主题的「串味服装」。

设计原则
--------
- **不发明颜色**：LLM 已经在某个分镜给出颜色时以该颜色为准；全篇都没颜色时
  才用 ``DEFAULT_OUTFIT_PHRASE`` 兜底，保证最终一定是「具体颜色 + 具体款式」。
- **不越权**：只改服装相关词，不动剧情、动作、镜头与 NSFW 程度。
- **幂等**：同样的输入重复跑不会产生新的改动。
"""

from __future__ import annotations

import re
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Set, Tuple

# ── 颜色词 ────────────────────────────────────────────────────────────────────
ZH_COLORS: Tuple[str, ...] = (
    "白色", "黑色", "红色", "蓝色", "绿色", "粉色", "紫色", "金色", "银色", "灰色",
    "米色", "棕色", "咖啡色", "酒红色", "藏青色", "墨绿色", "浅蓝色", "深蓝色",
    "裸色", "透明", "米白色", "香槟色", "象牙白", "浅灰色", "深灰色", "浅粉色",
    "深红色", "天蓝色", "藏蓝色", "军绿色", "卡其色", "奶油色", "燕麦色", "深紫色",
    "浅紫色", "银白色", "暗红色", "正红色", "玫瑰色", "裸粉色", "蜜桃色", "海蓝色",
    "酒红", "深绿", "浅绿", "深蓝", "浅蓝", "黑色系",
)

EN_COLORS: Tuple[str, ...] = (
    "black", "white", "red", "blue", "green", "pink", "purple", "gold", "golden",
    "silver", "grey", "gray", "beige", "brown", "cream", "ivory", "navy", "teal",
    "burgundy", "crimson", "scarlet", "coral", "peach", "mint", "olive", "maroon",
    "champagne", "rose", "magenta", "violet", "indigo", "khaki", "tan", "emerald",
    "ruby", "sapphire", "charcoal", "azure",
)

# ── 款式 / 材质词 ────────────────────────────────────────────────────────────
ZH_STYLES: Tuple[str, ...] = (
    "宽松", "紧身", "修身", "贴身", "短款", "长款", "迷你", "及膝", "高腰", "低腰",
    "露背", "无袖", "短袖", "长袖", "一件式", "绑带", "荷叶边", "蕾丝边", "透视",
    "半透明", "丝质", "丝绸", "真丝", "雪纺", "蕾丝", "皮质", "皮革", "乳胶",
    "棉质", "纯棉", "亚麻", "针织", "网纱", "缎面", "水洗", "毛绒", "薄款", "厚实",
    "深V领", "深V", "挂脖", "抹胸", "开叉", "收腰", "褶皱", "镶边", "流苏", "露脐",
    "吊带", "系带", "暗扣", "拉链", "露肩", "圆领", "方领", "一字肩", "开衫",
    "连体", "两件式", "三层", "宽大", "纯棉",
)

EN_STYLES: Tuple[str, ...] = (
    "silk", "satin", "lace", "leather", "latex", "cotton", "linen", "knit",
    "sheer", "transparent", "see-through", "loose", "tight", "fitted", "slim",
    "cropped", "mini", "longline", "high-waisted", "low-waisted", "backless",
    "sleeveless", "strapless", "halter", "open", "mesh", "ribbed", "oversized",
    "tight-fitting", "figure-hugging", "seamless", "ruffled", "plunging",
)

# ── 服装 / 配饰名词（长词优先匹配）──────────────────────────────────────────
ZH_GARMENTS: Tuple[str, ...] = (
    "浴袍", "睡袍", "浴巾", "浴衣", "睡衣", "居家服", "家居服", "和服", "旗袍",
    "衬衫", "衬衣", "polo衫", "T恤", "背心", "胸衣", "文胸", "胸罩", "抹胸",
    "毛衣", "针织衫", "西装", "职业装", "女仆装", "白大褂", "护士服", "护士装",
    "警服", "警察制服", "空姐制服", "空姐装", "军装", "学生制服", "水手服",
    "运动服", "运动装", "运动内衣", "工装", "牛仔装", "皮衣", "风衣", "大衣",
    "外套", "夹克", "羽绒服", "礼服", "晚礼服", "婚纱", "泳装", "泳衣", "比基尼",
    "内衣", "内裤", "丁字裤", "三角裤", "连体衣", "连体泳衣", "紧身衣",
    "紧身连体衣", "乳胶连体衣", "胶衣", "连裤袜", "吊带袜", "丝袜", "长筒袜",
    "短袜", "连裤丝袜", "吊带裙", "包臀裙", "百褶裙", "A字裙", "连衣裙", "丝裙",
    "长裙", "短裙", "迷你裙", "热裤", "短裤", "长裤", "牛仔裤", "紧身裤",
    "高跟鞋", "凉鞋", "靴子", "运动鞋", "拖鞋", "球鞋", "鞋子",
    "兔耳朵", "兔耳", "头饰", "发箍", "发夹", "丝带", "围巾", "领结", "领带",
    "颈圈", "项圈", "耳环", "耳坠", "耳饰", "手镯", "手铐", "镣铐", "脚环",
    "脚铐", "眼镜", "墨镜", "口罩", "礼帽", "棒球帽", "帽子", "手套", "长手套",
    "胸针", "腰链", "脚链", "乳贴", "乳环",
)

EN_GARMENTS: Tuple[str, ...] = (
    "robe", "bathrobe", "kimono", "nightgown", "pajamas", "pyjamas", "sleepwear",
    "shirt", "blouse", "t-shirt", "tank top", "bra", "bikini top", "crop top",
    "sweater", "cardigan", "suit", "blazer", "uniform", "maid outfit",
    "lab coat", "nurse uniform", "police uniform", "flight attendant uniform",
    "military uniform", "sailor uniform", "sportswear", "tracksuit", "sports bra",
    "leather jacket", "trench coat", "coat", "jacket", "down jacket", "gown",
    "evening dress", "wedding dress", "swimsuit", "bikini", "lingerie", "panties",
    "thong", "bodysuit", "leotard", "latex catsuit", "pantyhose", "stockings",
    "thigh-highs", "socks", "dress", "skirt", "mini skirt", "pencil skirt",
    "shorts", "hot pants", "pants", "jeans", "leggings", "heels", "boots",
    "sneakers", "sandals", "slippers", "shoes", "bunny ears", "headband",
    "headpiece", "ribbon", "scarf", "bow tie", "collar", "choker", "earrings",
    "bracelet", "handcuffs", "shackles", "anklet", "glasses", "sunglasses",
    "hat", "gloves",
)

_ZH_GARMENT_REGISTRY: List[str] = list(ZH_GARMENTS)
_EN_GARMENT_REGISTRY: List[str] = list(EN_GARMENTS)


def register_garment_nouns(
    nouns: Iterable[str],
    *,
    english: Iterable[str] = (),
) -> None:
    """
    运行时扩充服装名词词表（幂等）。

    ``theme_costume_canon`` 在导入时把 542 个主题里的全部服装名词
    （舞衣 / 队服 / 演出服 / 职业套装 …）注册进来 —— 原来只有 ~110 个
    常用词，导致这些服装既锁不住、也会被串味过滤误判。

    注册后会重建 ``_ZH_NOUN_RE`` / ``_EN_NOUN_RE``，因此可以在模块导入后的
    任意时刻调用。
    """
    changed = False
    for noun in nouns:
        if noun and noun not in _ZH_GARMENT_REGISTRY:
            _ZH_GARMENT_REGISTRY.append(noun)
            changed = True
    for noun in english:
        if noun and noun not in _EN_GARMENT_REGISTRY:
            _EN_GARMENT_REGISTRY.append(noun)
            changed = True
    if not changed:
        return
    global _ZH_NOUN_RE, _EN_NOUN_RE
    _ZH_NOUN_RE = re.compile(
        r"(?P<noun>" + "|".join(
            re.escape(n) for n in sorted(_ZH_GARMENT_REGISTRY, key=len, reverse=True)
        ) + r")"
    )
    _EN_NOUN_RE = re.compile(
        r"(?P<noun>" + "|".join(
            re.escape(n) for n in sorted(_EN_GARMENT_REGISTRY, key=len, reverse=True)
        ) + r")",
        re.IGNORECASE,
    )


def zh_garment_nouns() -> Tuple[str, ...]:
    """当前生效的中文服装名词词表（长词优先）。"""
    return tuple(sorted(_ZH_GARMENT_REGISTRY, key=len, reverse=True))


def en_garment_nouns() -> Tuple[str, ...]:
    """当前生效的英文服装名词词表（长词优先）。"""
    return tuple(sorted(_EN_GARMENT_REGISTRY, key=len, reverse=True))


# ── 兜底全称 ────────────────────────────────────────────────────────────────
DEFAULT_OUTFIT_PHRASE: Dict[str, str] = {
    "浴袍": "白色宽松浴袍",
    "睡袍": "白色丝绸睡袍",
    "浴巾": "白色纯棉浴巾",
    "浴衣": "白色宽松浴衣",
    "睡衣": "白色丝绸睡衣",
    "居家服": "浅灰色宽松居家服",
    "家居服": "浅灰色宽松家居服",
    "和服": "红色丝质和服",
    "旗袍": "红色丝质旗袍",
    "衬衫": "白色衬衫",
    "衬衣": "白色衬衫",
    "T恤": "白色T恤",
    "polo衫": "白色polo衫",
    "背心": "黑色针织背心",
    "文胸": "黑色蕾丝文胸",
    "胸罩": "黑色蕾丝文胸",
    "胸衣": "黑色蕾丝文胸",
    "抹胸": "黑色丝质抹胸",
    "毛衣": "米色宽松毛衣",
    "针织衫": "米色宽松针织衫",
    "西装": "黑色修身西装",
    "职业装": "深灰色职业装",
    "女仆装": "黑色荷叶边女仆装",
    "白大褂": "白色白大褂",
    "护士服": "白色护士服",
    "警服": "深蓝色警察制服",
    "警察制服": "深蓝色警察制服",
    "空姐制服": "深蓝色空姐制服",
    "军装": "墨绿色军装",
    "水手服": "藏蓝色水手服",
    "运动装": "灰色运动装",
    "运动内衣": "黑色运动内衣",
    "皮衣": "黑色皮质皮衣",
    "风衣": "米色长款风衣",
    "大衣": "米色长款大衣",
    "外套": "米色长款外套",
    "夹克": "黑色皮质夹克",
    "晚礼服": "黑色丝质晚礼服",
    "婚纱": "白色婚纱",
    "泳装": "黑色连体泳装",
    "泳衣": "黑色连体泳衣",
    "比基尼": "黑色比基尼",
    "内衣": "黑色蕾丝内衣",
    "内裤": "黑色蕾丝内裤",
    "丁字裤": "黑色蕾丝丁字裤",
    "连体衣": "黑色乳胶连体衣",
    "紧身衣": "黑色紧身衣",
    "乳胶连体衣": "黑色乳胶连体衣",
    "胶衣": "黑色乳胶连体衣",
    "连裤袜": "黑色连裤袜",
    "吊带袜": "黑色吊带袜",
    "丝袜": "黑色丝袜",
    "长筒袜": "黑色丝质长筒袜",
    "连裤丝袜": "黑色连裤丝袜",
    "吊带裙": "黑色丝质吊带裙",
    "包臀裙": "黑色包臀裙",
    "百褶裙": "黑色百褶裙",
    "连衣裙": "黑色丝质连衣裙",
    "丝裙": "黑色丝质长裙",
    "长裙": "黑色丝质长裙",
    "短裙": "黑色短裙",
    "迷你裙": "黑色迷你裙",
    "热裤": "黑色热裤",
    "短裤": "黑色短裤",
    "牛仔裤": "蓝色牛仔裤",
    "紧身裤": "黑色紧身裤",
    "高跟鞋": "黑色高跟鞋",
    "靴子": "黑色皮质靴子",
    "运动鞋": "白色运动鞋",
    "兔耳朵": "白色兔耳朵",
    "兔耳": "白色兔耳朵",
    "头饰": "白色蕾丝头饰",
    "丝带": "红色丝带",
    "围巾": "红色丝质围巾",
    "领结": "黑色丝质领结",
    "领带": "深红色领带",
    "颈圈": "黑色皮革颈圈",
    "项圈": "黑色皮革项圈",
    "耳环": "金色耳环",
    "手镯": "银色手镯",
    "手铐": "银色金属手铐",
    "镣铐": "银色金属镣铐",
    "脚铐": "银色金属脚铐",
    "眼镜": "黑色细框眼镜",
    "墨镜": "黑色墨镜",
    "帽子": "黑色宽檐帽",
    "手套": "黑色长手套",
    "长手套": "黑色长手套",
}

EN_DEFAULT_OUTFIT_PHRASE: Dict[str, str] = {
    "robe": "white silk robe",
    "bathrobe": "white bathrobe",
    "kimono": "red silk kimono",
    "nightgown": "white silk nightgown",
    "pajamas": "white silk pajamas",
    "sleepwear": "white silk sleepwear",
    "shirt": "white shirt",
    "blouse": "white blouse",
    "tank top": "black tank top",
    "bra": "black lace bra",
    "crop top": "black crop top",
    "sweater": "cream loose sweater",
    "suit": "black fitted suit",
    "blazer": "black fitted blazer",
    "uniform": "navy blue uniform",
    "lab coat": "white lab coat",
    "nurse uniform": "white nurse uniform",
    "police uniform": "navy blue police uniform",
    "flight attendant uniform": "navy blue flight attendant uniform",
    "military uniform": "olive green military uniform",
    "leather jacket": "black leather jacket",
    "trench coat": "beige long trench coat",
    "coat": "beige long coat",
    "jacket": "black leather jacket",
    "gown": "black silk gown",
    "evening dress": "black silk evening dress",
    "wedding dress": "white wedding dress",
    "swimsuit": "black one-piece swimsuit",
    "bikini": "black bikini",
    "lingerie": "black lace lingerie",
    "panties": "black lace panties",
    "thong": "black lace thong",
    "bodysuit": "black latex bodysuit",
    "leotard": "black latex leotard",
    "pantyhose": "black pantyhose",
    "stockings": "black silk stockings",
    "thigh-highs": "black silk thigh-highs",
    "dress": "black silk dress",
    "skirt": "black skirt",
    "mini skirt": "black mini skirt",
    "shorts": "black shorts",
    "jeans": "blue jeans",
    "leggings": "black leggings",
    "heels": "black high heels",
    "boots": "black leather boots",
    "bunny ears": "white bunny ears",
    "headband": "white lace headband",
    "ribbon": "red silk ribbon",
    "choker": "black leather choker",
    "collar": "black leather collar",
    "earrings": "gold earrings",
    "handcuffs": "silver metal handcuffs",
    "glasses": "black thin-framed glasses",
    "hat": "black wide-brim hat",
    "gloves": "black long gloves",
}

# 同义服装词：主题 costume 名与 LLM 实际用词不同时，按同义组放行
ZH_GARMENT_SYNONYMS: Dict[str, Tuple[str, ...]] = {
    "睡袍": ("浴袍", "睡袍"),
    "浴袍": ("浴袍", "睡袍"),
    "衬衣": ("衬衣", "衬衫"),
    "衬衫": ("衬衫", "衬衣"),
    "吊带裙": ("吊带裙", "丝裙"),
    "丝裙": ("丝裙", "吊带裙"),
    "文胸": ("文胸", "胸罩", "胸衣", "内衣"),
    "胸罩": ("文胸", "胸罩", "胸衣"),
    "内衣": ("内衣", "文胸", "胸罩", "胸衣"),
    "连体衣": ("连体衣", "紧身连体衣", "乳胶连体衣", "胶衣"),
    "紧身连体衣": ("连体衣", "紧身连体衣", "乳胶连体衣"),
    "丝袜": ("丝袜", "连裤袜", "连裤丝袜", "长筒袜"),
    "长筒袜": ("长筒袜", "丝袜"),
    "外套": ("外套", "大衣", "风衣", "夹克"),
    "大衣": ("大衣", "外套", "风衣"),
    "风衣": ("风衣", "外套", "大衣"),
    "泳衣": ("泳衣", "泳装"),
    "泳装": ("泳装", "泳衣"),
    "兔耳": ("兔耳", "兔耳朵"),
    "兔耳朵": ("兔耳朵", "兔耳"),
    "手铐": ("手铐", "镣铐"),
    "镣铐": ("镣铐", "手铐"),
    "项圈": ("项圈", "颈圈"),
    "颈圈": ("颈圈", "项圈"),
    "帽子": ("帽子", "礼帽", "棒球帽"),
    "礼帽": ("礼帽", "帽子"),
    "棒球帽": ("棒球帽", "帽子"),
    "长手套": ("长手套", "手套"),
    "手套": ("手套", "长手套"),
}

_ZH_MODIFIERS: Tuple[str, ...] = tuple(sorted(
    set(ZH_COLORS) | set(ZH_STYLES), key=len, reverse=True,
))
_ZH_MODIFIER_SET = set(_ZH_MODIFIERS)
_ZH_CONNECTIVE = "的"

_ZH_NOUN_RE = re.compile(
    r"(?P<noun>" + "|".join(
        re.escape(n) for n in sorted(_ZH_GARMENT_REGISTRY, key=len, reverse=True)
    ) + r")"
)
_EN_NOUN_RE = re.compile(
    r"(?P<noun>" + "|".join(
        re.escape(n) for n in sorted(_EN_GARMENT_REGISTRY, key=len, reverse=True)
    ) + r")",
    re.IGNORECASE,
)
_HAS_CJK = re.compile(r"[\u4e00-\u9fff]")


# ─────────────────────────────────────────────────────────────────────────────
# 修饰语区间识别
# ─────────────────────────────────────────────────────────────────────────────
def _zh_modifier_span(text: str, noun_start: int) -> Tuple[int, str]:
    """
    找出紧贴 ``noun_start`` 之前的修饰语区间（颜色 / 款式 / 「的」）。

    返回 ``(start, run)``，``run`` 是 ``text[start:noun_start]``。
    没有修饰语时返回 ``(noun_start, "")``。

    例：
        "她穿着一件宽松的白色浴袍"  → run = "宽松的白色"
        "露出里面的黑色丝质吊带裙"  → run = "黑色丝质"
        "解衬衫的第一颗纽扣"        → run = ""
    """
    tokens: List[Tuple[int, int, str]] = []
    for w in _ZH_MODIFIERS:
        pos = text.find(w)
        while pos != -1 and pos < noun_start:
            tokens.append((pos, pos + len(w), w))
            pos = text.find(w, pos + 1)
    # 连接助词「的」也参与修饰语链的识别（例："宽松的白色浴袍"）
    pos = text.find(_ZH_CONNECTIVE)
    while pos != -1 and pos < noun_start:
        tokens.append((pos, pos + 1, _ZH_CONNECTIVE))
        pos = text.find(_ZH_CONNECTIVE, pos + 1)
    # 去掉被更长词覆盖的碎片（例如 "黑色" 里的 "色" 不会被单独收录，但 "黑色系" 会）
    tokens = [
        t for t in tokens
        if not any(
            o is not t and o[0] <= t[0] and o[1] >= t[1] and (o[1] - o[0]) > (t[1] - t[0])
            for o in tokens
        )
    ]
    tokens.sort(key=lambda t: t[0])

    cur = noun_start
    run_start = noun_start
    pending_de = False
    for (s, e, w) in reversed(tokens):
        if e != cur:
            continue
        if w == _ZH_CONNECTIVE:
            if pending_de:
                continue
            pending_de = True
            cur = s
            continue
        run_start = s
        pending_de = False
        cur = s

    run = text[run_start:noun_start]
    return run_start, run


def _zh_color_of(run: str) -> str:
    for color in ZH_COLORS:
        if color in run:
            return color
    return ""


def _zh_style_of(run: str) -> str:
    rest = run
    color = _zh_color_of(run)
    if color:
        rest = rest.replace(color, "", 1)
    for style in sorted(ZH_STYLES, key=len, reverse=True):
        if style in rest:
            return style
    return ""


def _zh_mentions(text: str) -> List[Tuple[str, int, int, int, str]]:
    """
    列出文本中所有服装词出现点。

    返回 [(noun, run_start, noun_start, noun_end, run)]，按位置升序。
    """
    out: List[Tuple[str, int, int, int, str]] = []
    for m in _ZH_NOUN_RE.finditer(text):
        run_start, run = _zh_modifier_span(text, m.start())
        out.append((m.group("noun"), run_start, m.start(), m.end(), run))
    return out


# ─────────────────────────────────────────────────────────────────────────────
# 1) 同句重复小句去重
# ─────────────────────────────────────────────────────────────────────────────
def _leading_outfit_phrase(clause: str) -> str:
    """
    取出小句开头处的「服装短语」（颜色/款式 + 服装名）。

    "黑色丝质吊带裙在灯光下泛着光泽" → "黑色丝质吊带裙"
    "浴巾已经滑落到腰部"              → "浴巾"
    "脱下外套"                        → ""（外套不是句首，且前面有动词）
    """
    m = _ZH_NOUN_RE.search(clause)
    if not m:
        return ""
    prefix = clause[: m.start()]
    if prefix:
        # 句首必须只有修饰语 / 连词，否则不是「以服装短语开头」
        stripped = prefix.replace(_ZH_CONNECTIVE, "")
        if any(ch not in _ZH_MODIFIER_SET for ch in stripped):
            return ""
    return clause[: m.end()]


def dedup_repeated_clauses(text: str) -> str:
    """
    去掉同一句里重复出现的小句 / 冗余的服装短语。

    典型输入 → 输出：
        "浴巾已经滑落到腰部，浴巾已经滑落到腰部"
        → "浴巾已经滑落到腰部"

        "脱下外套，露出里面的黑色丝质吊带裙，黑色丝质吊带裙在灯光下泛着光泽"
        → "脱下外套，露出里面的黑色丝质吊带裙，在灯光下泛着光泽"
    """
    if not text or not _HAS_CJK.search(text):
        return text

    parts = re.split(r"(，|,|；|;)", text)
    if len(parts) < 3:
        return text
    seps = parts[1::2]
    clauses = parts[0::2]
    if len(clauses) < 2:
        return text

    out: List[str] = [clauses[0]]
    out_seps: List[str] = []
    for i, part in enumerate(clauses[1:]):
        sep = seps[i] if i < len(seps) else "，"
        prev = out[-1]
        stripped = part.strip()
        if not stripped:
            out.append(part)
            out_seps.append(sep)
            continue
        # A. 完全重复的小句 → 丢弃（比较时忽略结尾标点）
        if stripped.rstrip("。.!！?？") == prev.strip().rstrip("。.!！?？"):
            # 被删掉的小句可能带着整句的结尾标点，转交给上一小句
            m_p = re.search(r"[。.!！?？]+$", stripped)
            if m_p:
                out[-1] = out[-1].rstrip("。.!！?？") + m_p.group(0)
            continue
        # B. 本小句以「上一小句已出现过的完整服装短语」开头 → 去掉冗余前缀
        #    只在短语带修饰语（颜色/款式，长度 ≥ 4）时才去重：
        #    「黑色丝质吊带裙，黑色丝质吊带裙在灯光下泛着光泽」是冗余；
        #    「松开裹在身上的浴巾，浴巾缓缓滑落到地板上」是合法的二次提及，去了名词会丢主语。
        head = _leading_outfit_phrase(stripped)
        if head and len(head) >= 4 and head in prev:
            tail = stripped[len(head):].lstrip("，,、 ")
            if tail:
                out.append(tail)
                out_seps.append(sep)
            continue
        out.append(part)
        out_seps.append(sep)

    result = ""
    for i, c in enumerate(out):
        result += c
        if i < len(out_seps):
            result += out_seps[i]
    return result


# ─────────────────────────────────────────────────────────────────────────────
# 2) 服装锚定
# ─────────────────────────────────────────────────────────────────────────────
class OutfitLock:
    """每件衣服的「颜色 + 款式」锚定结果。"""

    def __init__(self) -> None:
        self.full: Dict[str, str] = {}      # noun → 全称（含颜色 + 款式）
        self.color: Dict[str, str] = {}     # noun → 颜色
        self.style: Dict[str, str] = {}     # noun → 款式（不含颜色）
        self.seeded: Set[str] = set()       # 来自主题规范表（权威，不可漂移）

    def is_empty(self) -> bool:
        return not self.full


def build_outfit_lock(
    texts: Iterable[str],
    seed: Optional[Mapping[str, str]] = None,
) -> OutfitLock:
    """
    以「最先出现」为准，为每件服装锁定颜色 + 款式全称。

    - LLM 已给颜色 → 采用该颜色（尊重 LLM 的选择）；
    - LLM 已给款式 → 采用该款式；
    - 缺颜色 / 缺款式 → 用 ``DEFAULT_OUTFIT_PHRASE`` 补齐，
      保证最终输出里一定是「具体颜色 + 具体款式」。

    ``seed`` 是主题的规范全称表（``noun → 白色宽松浴袍``）。它**优先级最高**：
    主题契约已经告诉 LLM 该穿哪套衣服，后处理层必须以它为准，
    否则 LLM 在第一个分镜现编的颜色会污染全篇。
    """
    lock = OutfitLock()
    # ── 1) 先落主题规范全称（最高优先级）──
    for noun, phrase in (seed or {}).items():
        if not noun or not phrase:
            continue
        color = _zh_color_of(phrase)
        style = _zh_style_of(phrase)
        lock.full[noun] = phrase
        lock.color[noun] = color
        lock.style[noun] = style
        lock.seeded.add(noun)
    # ── 2) 再用正文里最先出现的描述补齐其余服装 ──
    for text in texts:
        if not text:
            continue
        for noun, _rs, _ns, _ne, run in _zh_mentions(text):
            if noun in lock.full:
                continue
            color = _zh_color_of(run)
            style = _zh_style_of(run)
            fallback = DEFAULT_OUTFIT_PHRASE.get(noun, "")
            fb_color = _zh_color_of(fallback)
            fb_style = _zh_style_of(fallback)
            if not color:
                color = fb_color
            if not style:
                style = fb_style
            if not color and not style:
                lock.full[noun] = noun
                lock.color[noun] = ""
                lock.style[noun] = ""
                continue
            parts = []
            if color:
                parts.append(color)
            if style and style != color:
                parts.append(style)
            lock.full[noun] = "".join(parts) + noun
            lock.color[noun] = color
            lock.style[noun] = style
    return lock


def enforce_outfit_lock(text: str, lock: OutfitLock) -> Tuple[str, List[str]]:
    """
    对单个文本执行「完整输出 + 颜色/款式对齐」。

    返回 (新文本, 冲突列表)。
    """
    if not text or lock.is_empty():
        return text, []

    conflicts: List[str] = []
    result = text
    mentions = _zh_mentions(result)
    # 从右往左替换，保证前面的下标不失效
    for noun, run_start, noun_start, noun_end, run in reversed(mentions):
        canonical = lock.full.get(noun)
        if not canonical:
            continue
        canonical_color = lock.color.get(noun, "")
        canonical_style = lock.style.get(noun, "")
        if not canonical_color and not canonical_style:
            continue

        local_color = _zh_color_of(run)
        local_style = _zh_style_of(run)

        # ── 主题规范全称（seeded）优先：整段修饰语直接换成规范写法 ──
        # 只替换颜色 / 款式两个维度会留下「宽松的白色浴袍」这种和
        # 规范写法「白色宽松浴袍」不一致的表述，跨分镜比对时仍算漂移。
        if noun in lock.seeded:
            modifier = canonical[: len(canonical) - len(noun)]
            if modifier == run:
                continue
            if run and local_color and canonical_color and local_color != canonical_color:
                conflicts.append(f"「{noun}」颜色漂移：{local_color} → {canonical_color}")
            if run and local_style and canonical_style and local_style != canonical_style:
                conflicts.append(f"「{noun}」款式漂移：{local_style} → {canonical_style}")
            result = result[:run_start] + modifier + result[noun_start:]
            continue

        if not run:
            # 省略了颜色/款式 → 补全为锚定全称
            modifier = canonical[: len(canonical) - len(noun)]
            result = result[:noun_start] + modifier + result[noun_start:]
            continue

        new_run = run
        if canonical_color:
            if local_color and local_color != canonical_color:
                conflicts.append(f"「{noun}」颜色漂移：{local_color} → {canonical_color}")
                new_run = new_run.replace(local_color, canonical_color, 1)
            elif not local_color:
                new_run = canonical_color + new_run
        if canonical_style:
            if local_style and local_style != canonical_style:
                conflicts.append(f"「{noun}」款式漂移：{local_style} → {canonical_style}")
                new_run = new_run.replace(local_style, canonical_style, 1)
            elif not local_style:
                if local_color and canonical_color and local_color == canonical_color:
                    new_run = new_run.replace(local_color, local_color + canonical_style, 1)
                else:
                    new_run = canonical_style + new_run
        if new_run != run:
            result = result[:run_start] + new_run + result[noun_start:]
    return result, conflicts


# ─────────────────────────────────────────────────────────────────────────────
# 3) 英文侧
# ─────────────────────────────────────────────────────────────────────────────
def _en_mentions(text: str) -> List[Tuple[str, int, int, str]]:
    """返回 [(noun, mod_start, noun_start, modifier)]。"""
    out: List[Tuple[str, int, int, str]] = []
    for m in _EN_NOUN_RE.finditer(text):
        noun = m.group("noun").lower()
        start = m.start()
        prefix = text[:start]
        window = prefix[-80:]
        tokens = list(re.finditer(
            r"\b(%s)\b(?:\s+(?:%s))?" % (
                "|".join(re.escape(c) for c in EN_COLORS),
                "|".join(re.escape(s) for s in EN_STYLES),
            ),
            window,
            flags=re.IGNORECASE,
        ))
        modifier = ""
        mod_start = start
        if tokens:
            last = tokens[-1]
            modifier = last.group(0)
            mod_start = start + last.start() - len(window)
            # 修饰语必须紧贴名词（中间最多一个空格）
            if start - (mod_start + len(modifier)) > 1:
                modifier = ""
                mod_start = start
        out.append((noun, mod_start, start, modifier))
    return out


def _en_color_of(modifier: str) -> str:
    low = modifier.lower()
    for color in EN_COLORS:
        if re.search(rf"\b{re.escape(color)}\b", low):
            return color
    return ""


def build_outfit_lock_en(texts: Iterable[str]) -> OutfitLock:
    lock = OutfitLock()
    for text in texts:
        if not text:
            continue
        for noun, _ms, _ns, modifier in _en_mentions(text):
            if noun in lock.full:
                continue
            fallback = EN_DEFAULT_OUTFIT_PHRASE.get(noun, "")
            color = _en_color_of(modifier) or _en_color_of(fallback)
            style = modifier.lower() or fallback
            lock.full[noun] = (modifier.lower() + " " + noun).strip() if modifier else noun
            lock.color[noun] = color
            lock.style[noun] = style
    return lock


def enforce_outfit_lock_en(text: str, lock: OutfitLock) -> Tuple[str, List[str]]:
    if not text or lock.is_empty():
        return text, []
    conflicts: List[str] = []
    result = text
    mentions = _en_mentions(result)
    for noun, mod_start, noun_start, modifier in reversed(mentions):
        canonical = lock.full.get(noun)
        if not canonical:
            continue
        canonical_color = lock.color.get(noun, "")
        if not canonical_color:
            continue
        canonical_modifier = canonical[: len(canonical) - len(noun)].strip()
        if not canonical_modifier:
            continue
        local_color = _en_color_of(modifier)
        if local_color and local_color.lower() == canonical_color.lower():
            continue
        if local_color:
            conflicts.append(f"[EN] '{noun}' color drift: {local_color} → {canonical_color}")
            new_mod = modifier.lower().replace(local_color.lower(), canonical_color.lower(), 1)
            # 保留修饰语与名词之间的空格
            gap = result[mod_start + len(modifier):noun_start]
            result = result[:mod_start] + new_mod + gap + result[noun_start:]
        else:
            result = result[:noun_start] + canonical_modifier + " " + result[noun_start:]
    return result, conflicts


# ─────────────────────────────────────────────────────────────────────────────
# 4) 跨主题串味服装剔除
# ─────────────────────────────────────────────────────────────────────────────
def _off_theme_clauses(
    text: str,
    allowed: Set[str],
) -> Tuple[str, List[str]]:
    """
    剔除只包含「本主题不允许的服装」的整句。

    例：浴袍主题里出现的 "黑色丝质吊带裙在灯光下泛着光泽" 会被整句删除。
    """
    if not allowed or not text or not _HAS_CJK.search(text):
        return text, []
    # 先记下整句的结尾标点 —— 它可能随最后一句一起被删掉
    m_end = re.search(r"[。.!！?？]+$", text)
    tail_punct = m_end.group(0) if m_end else ""
    parts = re.split(r"(，|,|；|;)", text)
    if len(parts) < 3:
        return text, []
    seps = parts[1::2]
    clauses = parts[0::2]

    removed: List[str] = []
    kept_clauses: List[str] = []
    kept_seps: List[str] = []
    for i, clause in enumerate(clauses):
        nouns = [m.group("noun") for m in _ZH_NOUN_RE.finditer(clause)]
        if nouns and not any(_noun_allowed(n, allowed) for n in nouns):
            removed.append(clause.strip())
            continue
        kept_clauses.append(clause)
        kept_seps.append(seps[i] if i < len(seps) else "，")

    if not removed:
        return text, []

    # 结尾标点已在函数开头从原文取过（tail_punct），这里不要覆盖它。

    result = ""
    for i, c in enumerate(kept_clauses):
        result += c
        if i < len(kept_seps):
            result += kept_seps[i]
    result = result.strip("，,；; ").rstrip("。.!！?？")
    return (result + tail_punct).strip(), removed


def _noun_allowed(noun: str, allowed: Set[str]) -> bool:
    """
    判断一个服装名词是否属于主题白名单。

    词表里既有「衬衫」也有「白衬衫」「紧身职业套装」这类更长的词，
    而正文里 LLM 写的是哪一种并不确定。所以只要**存在包含关系**就算命中：

    * 正文写「白衬衫」，白名单有「衬衫」 → 命中；
    * 正文写「衬衫」，白名单有「白衬衫」 → 命中；
    * 完全无关（「浴袍」vs「吊带裙」）→ 不命中。
    """
    if noun in allowed:
        return True
    for a in allowed:
        if not a:
            continue
        if noun in a or a in noun:
            return True
    return False


def _expand_allowed(allowed: Iterable[str]) -> Set[str]:
    """把主题 costume 名扩展成同义组。"""
    out: Set[str] = set()
    for item in allowed:
        if not item:
            continue
        if item in ZH_GARMENT_SYNONYMS:
            out.update(ZH_GARMENT_SYNONYMS[item])
            continue
        out.add(item)
        # 「XX睡袍」这类带修饰的 costume，取其中的服装名
        for g in _ZH_GARMENT_REGISTRY:
            if item.endswith(g):
                out.add(g)
                if g in ZH_GARMENT_SYNONYMS:
                    out.update(ZH_GARMENT_SYNONYMS[g])
    return out


# ─────────────────────────────────────────────────────────────────────────────
# 5) 对外入口
# ─────────────────────────────────────────────────────────────────────────────
def enforce_outfit_consistency(
    panels: List[dict],
    fields: Sequence[str] = ("scene_description", "image_prompt"),
    allowed_garments: Optional[Iterable[str]] = None,
    canonical_anchors: Optional[Mapping[str, str]] = None,
) -> Tuple[List[dict], List[str]]:
    """
    对整个分镜列表执行服装前后一致性强制。

    ``panels`` 是 dict 列表，键至少包含 ``fields`` 中的字段。函数会 **就地** 修改
    这些字段并返回同一个列表，同时返回冲突描述列表（用于日志）。

    ``allowed_garments`` 可选：主题允许的服装名列表。传入后会剔除「只包含主题外
    服装」的整句，避免跨主题串味（例如浴袍主题里冒出「黑色丝质吊带裙」）。

    ``canonical_anchors`` 可选：主题的规范全称表（``名词 → 白色宽松浴袍``），
    来自 ``theme_costume_canon.theme_outfit_anchors``。它的优先级高于正文里
    LLM 现编的颜色 —— 主题契约已经规定了穿什么，后处理层必须以它为准。
    """
    if not panels:
        return panels, []

    all_conflicts: List[str] = []
    allowed = _expand_allowed(allowed_garments) if allowed_garments else None

    for field in fields:
        texts = [str(p.get(field) or "") for p in panels]
        if not any(texts):
            continue

        zh_lock = build_outfit_lock(texts, seed=canonical_anchors)
        en_lock = build_outfit_lock_en(texts)

        for idx, p in enumerate(panels):
            original = str(p.get(field) or "")
            if not original:
                continue
            new_text = original

            if allowed:
                new_text, removed = _off_theme_clauses(new_text, allowed)
                for r in removed:
                    all_conflicts.append(
                        f"panel {idx + 1} / {field}: 剔除跨主题服装串味句「{r}」"
                    )

            new_text = dedup_repeated_clauses(new_text)
            new_text, c1 = enforce_outfit_lock(new_text, zh_lock)
            new_text, c2 = enforce_outfit_lock_en(new_text, en_lock)
            if c1 or c2:
                all_conflicts.extend(
                    f"panel {idx + 1} / {field}: {c}" for c in (c1 + c2)
                )
            if new_text != original:
                p[field] = new_text

    return panels, all_conflicts
