"""Gacha Randomizer Service - 多维随机抽卡生成器 (冲突优化版)"""

import json
import random
import re
from pathlib import Path
from typing import Optional, List, Dict, Any, Set

from app.services.tag_conflict import resolve_conflicts, detect_conflicts

_TAGS_DB: Optional[dict] = None

# ── 绝对禁止的关键词正则 (编译一次) ──
# Mirror the aesthetic guards from safety_filter.BLOCK_PATTERNS so that bad
# tags are NEVER even selected into the candidate pool. This is the first
# line of defense — even if the caller forgets to sanitize the output, the
# tag list itself is already clean.
_BLOCK_PATTERNS: List[re.Pattern] = [
    # 未成年人/儿童 (must never appear)
    re.compile(r'\b(infant|baby|child|children|teenage|teenager)\b', re.I),
    re.compile(r'\b(toddler|preteen|pre-teen|underage|minor)\b', re.I),
    re.compile(r'\b(pubescen|puberty|lolicon|shotacon|loli\b|shota\b|lolita)\b', re.I),
    re.compile(r'\b(young adult|young looking)\b', re.I),
    re.compile(r'\b(little boy|little girl)\b', re.I),
    re.compile(r'\b(small breasts)\b', re.I),
    # 老年人 / 中年 (用户报告的"老人"违反美感)
    re.compile(r'\b(elderly|geriatric|withered|aged prematurely|gracefully aged|senior|middle.?aged|mature)\b', re.I),
    re.compile(r'\b(grandmother|grandfather|granny)\b', re.I),
    # 衰老皮肤
    re.compile(r'\b(wrinkled|wrinkly|sagging skin|loose skin|flabby|cellulite|stretch marks|varicose veins|liver spots|age spots|sun spots)\b', re.I),
    # 伤疤/毁容/血腥
    re.compile(r'\b(burn scar(s)?|fresh burn(s)?|burn mark(s)?|burn victim(s)?|scarred face|disfigured|keloid(s)?|mangled|knife scar(s)?|razor scar(s)?|cut scar(s)?|bullet wound scar(s)?|surgical scar(s)?|tribal scarification|ritual scarification|scarred body|large scar(s)?|small scar(s)?|scar on [a-z]+|stretch mark(s)?|sun spots?|liver spots?|varicose veins?)\b', re.I),
    re.compile(r'\b(amputee|prosthetic|cybernetic|mechanical limb|missing limb|wheelchair|crutches)\b', re.I),
    re.compile(r'\b(blood play|smeared blood|dripping blood|blood-soaked|bloodstained|gory|gore|mangled flesh|exposed bone|rotting)\b', re.I),
    re.compile(r'\b(hobo|homeless|beggar|ragged clothing|tattered clothing|torn clothing|stained clothing|dirty clothing)\b', re.I),
    re.compile(r'\b(demon horns|devil horns|tentacle|触手|monster horns|furry|beast transformation)\b', re.I),
    re.compile(r'tentacles?(?:\b|[^a-z])', re.I),  # catches plural AND compound like tentacle_toy
    re.compile(r'\b(passed out|unconscious|vomiting|crying uncontrollably|beaten down|broken)\b', re.I),
    # 病态体型
    re.compile(r'\b(morbidly obese|anorexic|too skinny|tubby|rotund|chubby|stocky|stout|portly|hefty|beefy|big.boned)\b', re.I),
]


# ── Category-level allowlists ─────────────────────────────────────────────────────
# Some tag categories have so many bad entries that a denylist isn't enough
# (e.g. `age_group` contains 'elderly', 'geriatric', 'wrinkled', 'senior',
# 'aged prematurely', 'mature', 'middle-aged' alongside the only safe
# values 'adult' and 'youthful'). For those categories we maintain an
# explicit ALLOWLIST and reject everything else. This is the most robust
# defense against a future tag-db update silently re-introducing a banned
# entry.
_CATEGORY_ALLOWLISTS: Dict[str, Optional[Set[str]]] = {
    # age_group: only 'adult' and 'youthful' are aesthetic. Everything else
    # (elderly/geriatric/wrinkled/senior/middle-aged/mature) is banned.
    "age_group": {"adult", "youthful"},
    # body: allow athletic/aesthetic builds; drop obese/anorexic/sickly ones.
    # We use a denylist approach here since the legitimate list is long.
    "body": None,
    # body_markings: drop burn/keloid/knife/razor/surgical scars; keep
    # birthmarks/freckles/moles/piercings/tattoos (these are aesthetic).
    "body_markings": None,
    # tattoos_scars: drop burn/keloid/knife/razor/bullet/surgical scars;
    # keep tattoo/freckles/mole/birthmark.
    "tattoos_scars": None,
    # character: drop religious desecration roles.
    "character": None,
}


# Category-specific denylists applied AFTER the universal _BLOCK_PATTERNS
# filter. Any tag in these categories matching one of these regexes is
# rejected at pick time.
_CATEGORY_DENY: Dict[str, List[re.Pattern]] = {
    "body_markings": [
        re.compile(r'\bburn mark\b', re.I),
        re.compile(r'\bburn scar\b', re.I),
        re.compile(r'\bhealed burn\b', re.I),
        re.compile(r'\bkeloid scar\b', re.I),
        re.compile(r'\bknife scar\b', re.I),
        re.compile(r'\brazor scar\b', re.I),
        re.compile(r'\bbullet wound\b', re.I),
        re.compile(r'\bsurgical scar\b', re.I),
        re.compile(r'\bstretch mark\b', re.I),
        re.compile(r'\bsun spots?\b', re.I),
        re.compile(r'\bliver spots?\b', re.I),
        re.compile(r'\bvaricose\b', re.I),
        # 通用 "scar on" / "large scar" / "small scar" 也是丑陋疤痕
        re.compile(r'\bscar on\b', re.I),
        re.compile(r'\blarge scar\b', re.I),
        re.compile(r'\bsmall scar\b', re.I),
        # 不符合美感的身体装饰
        re.compile(r'\bacne scars?\b', re.I),
    ],
    "tattoos_scars": [
        re.compile(r'\bburn scar\b', re.I),
        re.compile(r'\bkeloid scar\b', re.I),
        re.compile(r'\bknife scar\b', re.I),
        re.compile(r'\brazor scar\b', re.I),
        re.compile(r'\bbullet wound\b', re.I),
        re.compile(r'\bsurgical scar\b', re.I),
        re.compile(r'\bc[ut]+ scar\b', re.I),
        re.compile(r'\blarge scar\b', re.I),
        re.compile(r'\bscar on\b', re.I),
        re.compile(r'\bstretch mark\b', re.I),
        re.compile(r'\bsmall scar\b', re.I),
        re.compile(r'\bacne scars?\b', re.I),
        re.compile(r'\btribal tattoo\b', re.I),  # 用户原报告 "bold dragon tattoo"
    ],
    "body": [
        # 病态/不美观的体型
        re.compile(r'\b(morbidly obese|anorexic|too skinny|tubby|rotund|chubby|stocky|stout|portly|hefty|beefy|big.boned|big-boned)\b', re.I),
        re.compile(r'\b(flabby|hanging breasts|portly)\b', re.I),
        re.compile(r'\b(bouncing breasts|breasts apart)\b', re.I),  # 机械感
        re.compile(r'\b(alternate breast size|not skinny)\b', re.I),  # 描述混乱
        re.compile(r'\b(flyweight|midweight|well-built)\b', re.I),  # 拳击/健身术语，不符合美感
        # 男性化/粗野体型（不适合女性角色；muscular/buff保留作为athletic的同义词）
        re.compile(r'\b(burly|brawny|hulking|rugged|well-built)\b', re.I),
    ],
    "character": [
        # 宗教/神圣角色（亵渎/崇拜禁忌）
        re.compile(r'\b(jesus|christ|crucifixion|nun|saint|angel of death|god|pope|priestess of lust|deity)\b', re.I),
        re.compile(r'\(dressed as a (king|jesus|pope)\)', re.I),
        re.compile(r'\(dressed as jesus\)', re.I),
    ],
}


# ── Tag Cleaning ─────────────────────────────────────────────────────────────────

def _is_clean_tag(tag: str) -> bool:
    """检查标签是否为干净的关键词（而非冗长描述）。"""
    if not tag or len(tag.strip()) < 2:
        return False
    t = tag.strip()
    # 超过约4个词 = 描述性句子
    if len(t.split()) > 4:
        return False
    # 多个逗号 = 描述，不是标签
    if t.count(',') >= 2:
        return False
    # 剩余括号
    if '(' in t or ')' in t or '（' in t or '）' in t:
        return False
    # 以 "a/an/the/with" 开头且后面有2+词 = 句子
    if re.match(r'^(a|an|the|with)\s+\w+\s+\w', t, re.I):
        return False
    # 完整句子以句号结尾且有多个词
    if re.match(r'^[A-Z].+\.$', t) and len(t.split()) > 3:
        return False
    return True


def _clean_tag(tag: str) -> Optional[str]:
    """清理单个标签：去除前缀、括号、尾部修饰词等。"""
    t = tag.strip()
    if not t:
        return None

    # 去除前缀
    for prefix in [
        "with ", "adorned with a ", "adorned with ", "as a ", "as an ",
        "as (", "dressed as a ", "dressed as an ", "dressed as ",
        "character from the ", "character from ",
    ]:
        if t.lower().startswith(prefix):
            t = t[len(prefix):]
            break

    # 提取括号内容: "something (blue)" -> "something"
    paren_match = re.match(r'^(.+?)\s*\([^)]+\)$', t)
    if paren_match:
        inner = paren_match.group(1).strip()
        if inner:
            t = inner

    # 去除剩余括号和引号
    t = re.sub(r'[\(\)\[\]【】（）"\'`『』]', '', t).strip()

    # 去除冒号
    t = re.sub(r'[:：]', ' ', t).strip()

    # 去除尾部修饰词
    for suffix in [' hair', ' body', ' skin']:
        if t.lower().endswith(suffix):
            t = t[:-len(suffix)].strip()

    # 去除前后破折号
    t = re.sub(r'^[-–—\s]+|[-–—\s]+$', '', t).strip()

    # 折叠空格
    t = re.sub(r'\s+', ' ', t).strip()

    if len(t) < 2:
        return None

    if not _is_clean_tag(t):
        return None

    return t

# ── 种族优先级权重 (East Asian 优先，其他降低) ──
_ETHNICITY_WEIGHTS: Dict[str, float] = {
    "east asian": 8.0,
    "asian": 6.0,
    "southeast asian": 5.0,
    "chinese": 5.0,
    "japanese": 5.0,
    "korean": 5.0,
    "thai": 4.0,
    "vietnamese": 4.0,
    "filipino": 3.0,
    "caucasian": 2.0,
    "european": 2.0,
    "mediterranean": 1.5,
    "nordic": 1.5,
    "mixed race": 2.0,
    "multiracial": 1.5,
    "biracial": 1.5,
    "middle eastern": 1.0,
    "south asian": 2.0,
    "indian": 2.0,
    "pacific islander": 1.0,
    "polynesian": 1.0,
    "native american": 1.0,
    "aboriginal": 0.5,
    "indigenous": 0.5,
    "african": 0.5,
    "african american": 0.5,
    "afro-caribbean": 0.5,
    "hispanic": 0.5,
    "hispanic and latino": 0.5,
    "latino": 0.5,
    "mestizo": 0.5,
    "inuit": 0.5,
    "caucasian and asian": 1.5,
}


def _weighted_ethnicity_pick(items: List[str]) -> Optional[str]:
    """基于权重的种族选择，优先东方面孔"""
    if not items:
        return None
    safe_items = [i for i in items if _is_safe(str(i))]
    if not safe_items:
        return None

    weights = []
    for item in safe_items:
        name_lower = str(item).lower()
        weight = _ETHNICITY_WEIGHTS.get(name_lower, 1.0)
        weights.append(weight)

    total = sum(weights)
    rand = random.random() * total
    cumulative = 0.0
    for i, w in enumerate(weights):
        cumulative += w
        if rand <= cumulative:
            cleaned = _clean_tag(str(safe_items[i]))
            return cleaned if cleaned else safe_items[i]
    last = safe_items[-1]
    cleaned = _clean_tag(str(last))
    return cleaned if cleaned else last


def _load_tags_db() -> Optional[dict]:
    global _TAGS_DB
    if _TAGS_DB is not None:
        return _TAGS_DB
    db_path = Path(__file__).parent.parent.parent / "data" / "tags_db.json"
    if db_path.exists():
        with open(db_path, "r", encoding="utf-8") as f:
            _TAGS_DB = json.load(f)
    else:
        _TAGS_DB = {}
    return _TAGS_DB


def _is_safe(item: str, category: Optional[str] = None) -> bool:
    """Three-layer safety filter applied at TAG PICK time.

    Layer 1: universal _BLOCK_PATTERNS (minors / aesthetic / body horror / etc.)
    Layer 2: category-specific denylist (_CATEGORY_DENY) — more aggressive
             patterns that only matter for specific categories
             (e.g. 'stretch marks' banned in body_markings but allowed as a
             general concept elsewhere).
    Layer 3: category-specific ALLOWLIST — for categories where the bad
             entries outnumber the good ones (e.g. age_group: only 'adult'
             and 'youthful' are aesthetic), explicitly accept only those.

    All checks are case-insensitive. If ANY layer rejects the tag, it's
    silently dropped from the candidate pool so it can never be selected.
    """
    s = str(item).lower().strip()
    if not s:
        return False

    # Layer 1: universal patterns
    for pat in _BLOCK_PATTERNS:
        if pat.search(s):
            return False

    # Layer 2: category-specific denylist
    if category:
        deny_patterns = _CATEGORY_DENY.get(category, [])
        for pat in deny_patterns:
            if pat.search(s):
                return False

    # Layer 3: category-specific allowlist
    if category:
        allow = _CATEGORY_ALLOWLISTS.get(category)
        if allow is not None:
            # Allowlist is strict: must be in set (case-insensitive)
            return s in allow

    return True


def _pick(items: List[Any], count: int) -> List[Any]:
    if not items:
        return []
    return random.sample(items, min(count, len(items)))


def generate_random_tags(
    prompt_type: str = "image",
    r18_mode: bool = False,
    img2img_mode: bool = False,
) -> List[Dict[str, str]]:
    """
    从 tags_db.json 中随机抽取多维度标签组合。
    返回标签列表，每项包含 _category 和 _name。
    r18_mode=True 时增加 R18 标签权重。
    img2img_mode=True 时过滤所有外貌/体态标签（图生图模式保留参考图人物特征）。
    所有标签经过安全过滤 + 冲突解决。
    """
    db = _load_tags_db()
    if not db:
        return []

    result: List[Dict[str, str]] = []

    def add(cat_key: str, count: int):
        items = db.get(cat_key, [])
        safe_items = [i for i in items if _is_safe(str(i), category=cat_key)]
        chosen = _pick(safe_items, count)
        for name in chosen:
            cleaned = _clean_tag(str(name))
            if cleaned and _is_safe(cleaned, category=cat_key):
                result.append({"_category": cat_key, "_name": cleaned})

    # ── 图生图模式：过滤所有外貌/体态/人物特征标签 ──
    _IMG2IMG_EXCLUDE_CATS = {
        "character", "hair", "hairstyles", "skin_tone",
        "ethnicity", "face", "face_features", "eyes",
        "makeup_styles", "body", "body_markings",
        "tattoos_scars", "age_group",
    }

    def _should_add(cat_key: str) -> bool:
        if not img2img_mode:
            return True
        return cat_key not in _IMG2IMG_EXCLUDE_CATS

    # ── 基础质量标签 ──
    add("quality", 3)

    # ── 角色/外貌（img2img 模式下跳过）──
    if _should_add("character"):
        add("character", 1)
    if _should_add("hair"):
        add("hair", 1)
    if _should_add("hairstyles"):
        add("hairstyles", 1)
    if _should_add("skin_tone"):
        add("skin_tone", 1)

    # 种族使用权重抽样，优先东方面孔（img2img 模式下跳过）
    if _should_add("ethnicity"):
        ethnicity_tag = _weighted_ethnicity_pick(db.get("ethnicity", []))
        if ethnicity_tag:
            result.append({"_category": "ethnicity", "_name": ethnicity_tag})

    # ── 面部/妆容（img2img 模式下跳过）──
    if _should_add("face"):
        add("face", 1)
    if _should_add("face_features"):
        add("face_features", 1)
    if _should_add("eyes"):
        add("eyes", 1)
    if _should_add("makeup_styles"):
        add("makeup_styles", 1)

    # ── 身体（img2img 模式下跳过）──
    if _should_add("body"):
        add("body", 1)
    if _should_add("body_markings"):
        add("body_markings", 1)
    if _should_add("tattoos_scars"):
        add("tattoos_scars", 1)

    # ── 服装（合理数量，2-3件）──
    add("clothes", 2 if r18_mode else 2)

    # ── 袜子/鞋/配饰（精简）──
    add("socks", 1)
    add("shoes", 1)
    add("accessories", 1)

    # ── 环境/背景 ──
    add("environment", 2)

    # ── 艺术风格/光照 ──
    add("style", 1)
    add("photography_styles", 1)
    add("artform", 1)

    # ── 镜头/设备 ──
    add("camera_shot", 1)
    add("photo_type", 1)
    add("device", 1)
    add("composition", 1)

    # ── 动作（精简，1-2个）──
    add("action", 2 if r18_mode else 1)

    # ── 艺术家风格 ──
    add("artist", 1)

    # ── 年龄组 ──
    add("age_group", 1)

    # ── R18 核心（适度增加）──
    if r18_mode:
        add("r18", 8)
        add("nsfw_details", 6)
        add("action", 2)
        add("body", 1)
    else:
        add("r18", 1)
        add("nsfw_details", 1)

    # ── 视频专用 ──
    if prompt_type == "video":
        add("video_motion", 3 if r18_mode else 2)
        add("camera_movement", 1)

    # ── 去重 ──
    seen: set = set()
    deduped: List[Dict[str, str]] = []
    for item in result:
        key = (item["_category"], item["_name"].lower())
        if key not in seen:
            seen.add(key)
            deduped.append(item)

    # ── 冲突检测与解决 ──
    deduped = resolve_conflicts(deduped)

    return deduped
