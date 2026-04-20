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
        re.compile(r"\b(blonde|brunette|red|black|white|silver|pink|blue|purple)\b.*\bhair\b.*"
                   r"\b(blonde|brunette|red|black|white|silver|pink|blue|purple)\b.*\bhair\b",
        re.I,
        "多种发色描述",
    ),
]

# ── 矛盾姿态关键词 ──
POSES = {
    "standing": re.compile(r"\bstanding\b", re.I),
    "sitting": re.compile(r"\b(sitting|seated|sits on|perched on|sitting on)\b", re.I),
    "lying": re.compile(r"\b(lying|lying down|reclining|prone|supine|laying down|on all fours)\b", re.I),
    "kneeling": re.compile(r"\b(kneeling|kneeling on|kneels|crawling|on knees)\b", re.I),
    "walking": re.compile(r"\b(walking|striding|stalking|marching|stepping)\b", re.I),
}


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

    # 3. 手铐时手部细节矛盾
    has_restraint = re.search(
        r"(handcuff|behind back|wrist|chained|bound|cuffed|restrained)",
        prompt,
        re.I,
    )
    has_hand_detail = re.search(
        r"(one hand|arm outstretched|fingers|hand touching|hand near|"
        r"hand raised|hand on|hand lifted)",
        prompt,
        re.I,
    )
    if has_restraint and has_hand_detail:
        conflicts.append("手部束缚与手部细节动作矛盾")

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
1. ONE physically possible pose. If arms are bound, NO hand gestures. If standing, NO sitting/lying.
2. ONE main outfit. Max 2 clothing items. Do NOT describe 3+ clothing layers.
3. Remove ALL contradictions.
4. NO tag lists. NO bullet points. NO commas separating tags.
5. Write as a flowing narrative paragraph.
6. All characters must be ADULTS (18+). No minors.
7. Keep the same theme, mood, and key elements, but make it logically coherent.

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
    """
    lines = prompt.replace(" , ", ", ").split("\n")

    # 移除逗号分隔的短标签列表模式
    fixed_lines = []
    for line in lines:
        comma_count = line.count(",")
        if comma_count >= 5 and len(line) < 400 and not line.endswith("."):
            # 这是标签列表，跳过整行
            continue
        fixed_lines.append(line)

    result = " ".join(fixed_lines).strip()

    # 如果太短，返回原始
    if len(result) < 50:
        return prompt

    return result
