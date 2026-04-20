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
        "tank top",
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

    # 4. 检查过多服装层叠（超过3层不同上装）
    upper_clothes = [t for t in tag_names_lower if any(
        c in t for c in ["shirt", "top", "dress", "blouse", "sweater", "jacket",
                         "crop", "tank", "camisole", "hoodie", "corset", "bra"]
    )]
    if len(upper_clothes) > 3:
        conflicts.append(
            f"[upper_clothing] 过多上装层叠 ({len(upper_clothes)}件): {', '.join(upper_clothes[:4])}"
        )

    return conflicts


def resolve_conflicts(tags: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """
    解决标签冲突，智能保留最合适的标签。
    策略：
    1. 手部束缚优先，移除所有手部抬起/伸展动作
    2. 姿态冲突：保留主要姿态（standing > sitting > lying）
    3. 服装层叠：只保留最重要的 2-3 件
    4. 互斥组：保留第一个
    """
    result: List[Dict[str, str]] = []
    seen_groups: Dict[str, Set[str]] = {}

    for tag in tags:
        cat = str(tag.get("_category", "")).lower()
        name = str(tag.get("_name", ""))
        name_lower = name.lower()

        # ── 手部冲突解决：手铐优先 ──
        is_handcuff = re.search(r"(handcuff|behind back|cuffed|wrist restraint)", name_lower)
        is_raised_hand = re.search(
            r"(hand.*rais|arm.*outstretch|hand.*hip|hand.*chest|hand.*pocket)",
            name_lower,
        )
        if is_handcuff and is_raised_hand:
            continue  # 同时满足两边，跳过
        if is_handcuff:
            # 之前已添加手铐，跳过这个矛盾的动作
            if any(
                re.search(r"(handcuff|behind back|cuffed)", str(t.get("_name", "")).lower())
                for t in result
            ):
                continue  # 已存在手铐，跳过
        if is_raised_hand:
            # 如果已有手铐，跳过抬手的动作
            if any(
                re.search(r"(handcuff|behind back|cuffed)", str(t.get("_name", "")).lower())
                for t in result
            ):
                continue

        # ── 姿态冲突解决 ──
        is_standing = "standing" in name_lower
        is_sitting = "sitting" in name_lower
        is_lying = "lying" in name_lower
        if is_standing or is_sitting or is_lying:
            pose_key = f"_pose_{cat}"
            if pose_key not in seen_groups:
                seen_groups[pose_key] = set()
            if seen_groups[pose_key]:
                continue  # 已有姿态，跳过
            seen_groups[pose_key].add(name_lower)
        else:
            # ── 互斥组：只保留同类第一个 ──
            if cat not in seen_groups:
                seen_groups[cat] = set()

            in_group = False
            for group_name, group_items in MUTUAL_EXCLUSION.items():
                for item in group_items:
                    if item in name_lower or name_lower in item:
                        if name_lower in seen_groups[cat]:
                            in_group = True
                            break
                        seen_groups[cat].add(name_lower)
                        break
                if in_group:
                    break

        result.append(tag)

    return result
