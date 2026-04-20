"""Gacha Randomizer Service - 多维随机抽卡生成器 (冲突优化版)"""

import json
import random
import re
from pathlib import Path
from typing import Optional, List, Dict, Any

from app.services.tag_conflict import resolve_conflicts, detect_conflicts

_TAGS_DB: Optional[dict] = None

# ── 绝对禁止的关键词正则 (编译一次) ──
_BLOCK_PATTERNS: List[re.Pattern] = [
    re.compile(r'\b(infant|baby|child|children|teenage|teenager)\b', re.I),
    re.compile(r'\b(toddler|preteen|pre-teen|underage|minor)\b', re.I),
    re.compile(r'\b(pubescen|puberty|lolicon|shotacon|loli\b|shota\b|lolita)\b', re.I),
    re.compile(r'\b(young adult|young looking)\b', re.I),
    re.compile(r'\b(little boy|little girl)\b', re.I),
    re.compile(r'\b(small breasts)\b', re.I),
]


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


def _is_safe(item: str) -> bool:
    s = str(item).lower()
    for pat in _BLOCK_PATTERNS:
        if pat.search(s):
            return False
    return True


def _pick(items: List[Any], count: int) -> List[Any]:
    if not items:
        return []
    return random.sample(items, min(count, len(items)))


def generate_random_tags(
    prompt_type: str = "image",
    r18_mode: bool = False,
) -> List[Dict[str, str]]:
    """
    从 tags_db.json 中随机抽取多维度标签组合。
    返回标签列表，每项包含 _category 和 _name。
    r18_mode=True 时增加 R18 标签权重。
    所有标签经过安全过滤 + 冲突解决。
    """
    db = _load_tags_db()
    if not db:
        return []

    result: List[Dict[str, str]] = []

    def add(cat_key: str, count: int):
        items = db.get(cat_key, [])
        safe_items = [i for i in items if _is_safe(str(i))]
        chosen = _pick(safe_items, count)
        for name in chosen:
            if isinstance(name, str) and _is_safe(name):
                result.append({"_category": cat_key, "_name": name})

    # ── 基础质量标签 ──
    add("quality", 3)

    # ── 角色/外貌 ──
    add("character", 1)
    add("hair", 1)
    add("hairstyles", 1)
    add("skin_tone", 1)
    add("ethnicity", 1)

    # ── 面部/妆容 ──
    add("face", 1)
    add("face_features", 1)
    add("eyes", 1)
    add("makeup_styles", 1)

    # ── 身体 ──
    add("body", 1)
    add("body_markings", 1)
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
        add("r18", 5)
        add("nsfw_details", 4)
        add("action", 1)
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
