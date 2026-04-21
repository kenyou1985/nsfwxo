"""Tag Conflict Detection - 标签冲突检测模块

检测标签之间的逻辑冲突，防止生成矛盾描述（如"双手被铐"+"一只手抬起"）。
"""

import re
from typing import Dict, List, Set

# ── 标签互斥组：同组内标签只能出现一个 ──
MUTUAL_EXCLUSION: Dict[str, List[str]] = {
    # 上装冲突
    "upper_clothing": [
        "black satin plunging neckline dress",
        "black crop top",
        "white shirt",
        "t-shirt",
        "blouse",
        "sweater",
        "jacket",
        "tank top",
        "corset",
        "hoodie",
        "crop top",
        "camisole",
    ],
    # 下装冲突
    "lower_clothing": [
        "black denim shorts",
        "jeans",
        "skirt",
        "pants",
        "leggings",
        "shorts",
        "dress",
    ],
    # 手部状态冲突（最关键）
    "hand_state": [
        "handcuffs binding her arms behind her back",
        "handcuffs",
        "cuffed",
        "arms behind back",
        "wrist restraints",
        "chains",
        "one hand slightly raised",
        "one hand raised",
        "hand on hip",
        "hand on chest",
        "hand in pocket",
        "both hands free",
        "arms crossed",
        "arms outstretched",
    ],
    # 肤色冲突
    "skin_tone": [
        "alabaster skin",
        "olive skin",
        "dark skin",
        "tan skin",
        "pale skin",
        "freckled skin",
    ],
    # 发色冲突
    "hair_color": [
        "blonde hair",
        "brunette hair",
        "red hair",
        "black hair",
        "white hair",
        "grey hair",
        "silver hair",
        "pink hair",
        "blue hair",
        "purple hair",
        "wavy hair",
        "straight hair",
    ],
    # R18 体位互斥（同类型体位只能出现一个）
    "r18_position": [
        "cowgirl", "cowgirl_position", "reverse_cowgirl",
        "doggystyle", "doggystyle_anal", "doggystyle_deep",
        "missionary", "missionary_anal", "missionary_variant",
        "standing", "standing_sex", "standing_missionary", "standing_doggystyle",
        "sitting_position", "seated_straddle", "sitting",
        "lying", "prone_bone", "prone_position", "prone_rape",
        "all_fours", "on_all_fours", "on_stomach",
        "crouching", "crouching_position", "squating",
        "scissor_position", "scissoring",
        "wheelbarrow_position",
        "bridging", "arched_back",
    ],
}

# ── 需要同时满足的约束组 ──
REQUIRED_GROUP: Dict[str, List[str]] = {
    "hand_state": [
        "handcuffs binding her arms behind her back",
        "handcuffs",
        "cuffed",
        "arms behind back",
    ],
}

# ── 冲突关键词映射（哪些词出现时需要排除其他词）──
CONFLICT_MAP: Dict[str, List[str]] = {
    # 手铐/束缚 → 不能有手部抬起/伸展
    "handcuff": [
        "one hand slightly raised",
        "one hand raised",
        "hand on hip",
        "hand on chest",
        "hand in pocket",
        "arms outstretched",
        "arm outstretched",
        "hand slightly raised",
        "one hand on",
    ],
    "behind back": [
        "one hand slightly raised",
        "one hand raised",
        "hand on hip",
        "hand on chest",
        "hand in pocket",
        "arms outstretched",
        "arm outstretched",
        "hand slightly raised",
        "one hand on",
    ],
    "cuffed": [
        "one hand slightly raised",
        "one hand raised",
        "hand on hip",
        "hand outstretched",
    ],
    # 坐着 → 不能站着
    "sitting": [
        "standing pose",
        "standing",
        "standing pose with hip jutted",
        "standing with",
    ],
    "lying": [
        "standing pose",
        "standing",
        "standing pose with hip jutted",
    ],
    # 一件衣服内层外层组合（需逻辑判断，非互斥）
    "layered": [
        "black satin plunging neckline dress over black crop top",
        "dress over",
        "top over",
    ],
}

# ── 检测到的冲突描述 ──
def detect_conflicts(tags: List[Dict[str, str]]) -> List[str]:
    """
    检测标签列表中的逻辑冲突，返回冲突描述列表。
    空列表 = 无冲突。
    """
    conflicts: List[str] = []
    tag_names_lower = [str(t.get("_name", "")).lower() for t in tags]
    tag_names = [str(t.get("_name", "")) for t in tags]

    # 1. 检查互斥组
    for group_name, group_items in MUTUAL_EXCLUSION.items():
        matched: List[str] = []
        for tag in tag_names_lower:
            for item in group_items:
                if item in tag or tag in item:
                    matched.append(item)
        if len(matched) > 1:
            conflicts.append(
                f"[{group_name}] 互斥: {', '.join(set(matched))} - 只保留第一个"
            )

    # 2. 检查手部冲突（最核心）
    has_handcuff = any(
        re.search(r"(handcuff|behind back|cuffed|chains|wrist)", t)
        for t in tag_names_lower
    )
    if has_handcuff:
        raised_hand = any(
            re.search(
                r"(hand.*rais|arm.*outstretch|hand.*hip|hand.*chest|hand.*pocket)",
                t,
            )
            for t in tag_names_lower
        )
        if raised_hand:
            conflicts.append(
                "[hand_state] 冲突: 双手被束缚时不能有手部抬起/伸展动作"
            )

    # 3. 检查站立/坐姿/躺姿冲突
    has_standing = any("standing" in t for t in tag_names_lower)
    has_sitting = any("sitting" in t for t in tag_names_lower)
    has_lying = any("lying" in t or "lying down" in t for t in tag_names_lower)
    pose_count = sum([has_standing, has_sitting, has_lying])
    if pose_count > 1:
        conflicts.append(
            f"[pose] 冲突: 不能同时有 standing/sitting/lying 姿态"
        )

    # 3b. 跪姿 + 站立冲突
    has_kneeling = any("kneeling" in t or "kneels" in t for t in tag_names_lower)
    if has_kneeling and has_standing:
        conflicts.append("[pose] 冲突: 跪姿与站姿不能同时出现")

    # 4. 检查过多服装层叠（超过3层不同上装）
    upper_clothes = [t for t in tag_names_lower if any(
        c in t for c in ["shirt", "top", "dress", "blouse", "sweater", "jacket",
                         "crop", "tank", "camisole", "hoodie", "corset", "bra"]
    )]
    if len(upper_clothes) > 3:
        conflicts.append(
            f"[upper_clothing] 过多上装层叠 ({len(upper_clothes)}件): {', '.join(upper_clothes[:4])}"
        )

    # 4b. 服装类别矛盾：比基尼 + 裙/裤/正装
    swimwear = [t for t in tag_names_lower if any(
        s in t for s in ["bikini", "swimsuit", "bathing suit", "one-piece", "swimwear"]
    )]
    formal = [t for t in tag_names_lower if any(
        f in t for f in ["dress", "skirt", "ball gown", "evening gown", "wedding dress", "blazer"]
    )]
    bottoms = [t for t in tag_names_lower if any(
        b in t for b in ["pants", "jeans", "leggings", "shorts", "trousers", "jumpsuit"]
    )]
    if swimwear and formal:
        conflicts.append("[clothing] 冲突: 比基尼/泳装与裙/礼服不能同时出现")
    if swimwear and bottoms:
        conflicts.append("[clothing] 冲突: 比基尼/泳装与裤/下装不能同时出现")

    # 4c. 环境冲突：室内 + 室外
    indoor_cats = {"indoor", "bedroom", "office", "hotel", "bathroom", "kitchen", "dungeon", "church", "studio", "bar"}
    outdoor_cats = {"outdoor", "beach", "street", "city", "forest", "garden", "park", "rooftop", "balcony"}
    indoor_tags = [t for t in tag_names_lower if any(c in t for c in indoor_cats)]
    outdoor_tags = [t for t in tag_names_lower if any(c in t for c in outdoor_cats)]
    if indoor_tags and outdoor_tags:
        conflicts.append("[environment] 冲突: 室内与室外环境不能同时出现")

    # 4d. 光照冲突：自然光 + 人工光
    natural_cats = {"sunlight", "daylight", "natural light", "moonlight", "starlight"}
    artificial_cats = {"neon", "candlelight", "fluorescent", "spotlight", "studio light", "dim light", "moody lighting"}
    natural_tags = [t for t in tag_names_lower if any(c in t for c in natural_cats)]
    artificial_tags = [t for t in tag_names_lower if any(c in t for c in artificial_cats)]
    if natural_tags and artificial_tags:
        conflicts.append("[lighting] 冲突: 自然光与人工光不能同时出现")

    # 4e. 服装搭配违和：比基尼 + 袜子/靴/运动鞋
    swimwear = [t for t in tag_names_lower if any(
        s in t for s in ["bikini", "swimsuit", "bathing suit", "one-piece", "swimwear"]
    )]
    legwear = [t for t in tag_names_lower if any(
        l in t for l in ["socks", "thigh-high", "thighhigh", "pantyhose", "stockings",
                          "knee socks", "boots", "combat boots", "sneakers", "athletic shoes"]
    )]
    if swimwear and legwear:
        conflicts.append("[clothing] 冲突: 比基尼/泳装与袜子/靴/运动鞋搭配违和")

    # 4f. 正式服装 + 运动装违和
    formal = [t for t in tag_names_lower if any(
        f in t for f in ["suit", "dress", "evening gown", "ball gown", "wedding dress", "cocktail dress"]
    )]
    athletic = [t for t in tag_names_lower if any(
        a in t for a in ["sneakers", "running shoes", "athletic", "jersey", "track suit",
                          "sweatshirt", "sports bra", "hoodie", "sportswear", "activewear"]
    )]
    if formal and athletic:
        conflicts.append("[clothing] 冲突: 正式礼服与运动装搭配违和")

    return conflicts


def resolve_conflicts(tags: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """
    解决标签冲突，智能保留最合适的标签。
    策略：
    1. 手部束缚优先，移除所有手部抬起/伸展动作
    2. 姿态冲突：保留主要姿态（standing > sitting > lying）
    3. 服装层叠：只保留最重要的 2-3 件
    4. 互斥组：保留第一个
    5. R18 体位互斥：同类型体位只保留一个
    """
    result: List[Dict[str, str]] = []
    seen_groups: Dict[str, Set[str]] = {}

    def _is_handcuff(name_lower: str) -> bool:
        return bool(re.search(r"(handcuff|behind back|cuffed|wrist restraint)", name_lower))

    def _has_handcuff_in_result() -> bool:
        return any(
            _is_handcuff(str(t.get("_name", "")).lower())
            for t in result
        )

    def _is_raised_hand(name_lower: str) -> bool:
        return bool(re.search(
            r"(hand.*rais|arm.*outstretch|hand.*hip|hand.*chest|hand.*pocket)",
            name_lower,
        ))

    def _in_mutual_group(name_lower: str) -> bool:
        """检查是否属于互斥组中已出现的项"""
        for group_name, group_items in MUTUAL_EXCLUSION.items():
            for item in group_items:
                if item in name_lower or name_lower in item:
                    return True
        return False

    for tag in tags:
        cat = str(tag.get("_category", "")).lower()
        name = str(tag.get("_name", ""))
        name_lower = name.lower()

        # ── R18 体位互斥 ──
        is_position = False
        for group_name, group_items in MUTUAL_EXCLUSION.items():
            if group_name == "r18_position":
                for item in group_items:
                    if item in name_lower or name_lower in item:
                        is_position = True
                        # 检查是否已有同类体位
                        for seen_name in seen_groups.get("_r18_position", set()):
                            for seen_item in group_items:
                                if (seen_item in seen_name or seen_name in seen_item) and \
                                   (item in name_lower or name_lower in item):
                                    break
                            else:
                                continue
                            break
                        else:
                            # 同类体位，检查是否属于同一大类
                            position_categories = {
                                "cowgirl": ["cowgirl", "reverse_cowgirl"],
                                "doggystyle": ["doggystyle"],
                                "missionary": ["missionary"],
                                "standing": ["standing"],
                                "sitting": ["sitting", "seated", "squat"],
                                "lying": ["lying", "prone", "on_stomach"],
                                "all_fours": ["all_fours", "on_all_fours"],
                            }
                            matched_cat = None
                            for pc, keywords in position_categories.items():
                                if any(kw in name_lower for kw in keywords):
                                    matched_cat = pc
                                    break
                            if matched_cat:
                                seen = seen_groups.get("_r18_position_category", set())
                                if matched_cat in seen:
                                    break  # 跳过同类型体位
                                seen_groups.setdefault("_r18_position_category", set()).add(matched_cat)
                        break
                if is_position:
                    seen_groups.setdefault("_r18_position", set()).add(name_lower)
                    result.append(tag)
                    break
        if is_position:
            continue

        # ── 手部冲突解决：手铐优先 ──
        if _is_handcuff(name_lower) and _is_raised_hand(name_lower):
            continue
        if _is_handcuff(name_lower):
            if _has_handcuff_in_result():
                continue
        if _is_raised_hand(name_lower):
            if _has_handcuff_in_result():
                continue

        # ── 姿态冲突解决 ──
        is_standing = "standing" in name_lower
        is_sitting = "sitting" in name_lower or "seated" in name_lower or "squat" in name_lower
        is_lying = "lying" in name_lower or "prone" in name_lower
        if is_standing or is_sitting or is_lying:
            pose_key = f"_pose_{cat}"
            if pose_key not in seen_groups:
                seen_groups[pose_key] = set()
            if seen_groups[pose_key]:
                continue
            seen_groups[pose_key].add(name_lower)
        else:
            # ── 互斥组：只保留同类第一个 ──
            if _in_mutual_group(name_lower):
                if cat not in seen_groups:
                    seen_groups[cat] = set()
                if name_lower in seen_groups[cat]:
                    continue
                seen_groups[cat].add(name_lower)

        result.append(tag)

    return result
