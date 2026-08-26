"""内容安全过滤模块 - 审核 LLM 输出，禁止未成年人/儿童 NSFW 内容"""

import re
from typing import Optional

# 禁止内容模式 (不区分大小写)
BLOCK_PATTERNS: list[tuple[str, str]] = [
    # 未成年/儿童相关
    (r'\b(infant|baby|infant|infancy)\b', "婴儿"),
    (r'\b(child|children|childhood)\b', "儿童"),
    (r'\b(teenage|teenager|teen\b|teens)\b', "未成年青少年"),
    (r'\b(toddler|preteen|pre-teen)\b', "幼童/未成年人"),
    (r'\b(underage|under.?age|under.?aged)\b', "未成年"),
    (r'\b(minor\b|minors)\b(?! fashion|clothing|group)', "未成年人"),
    (r'\b(pubescen|puberty|pubertal)\b', "青春期发育"),
    (r'\b(young adult|young.?looking|young.?girls?|young.?boys?)\b', "年轻外貌"),
    (r'\b(loli|lolic|shota|lolita|lolicon|shotacon)\b', "萝莉/正太"),
    (r'\b(juvenile\b|juveniles)\b', "未成年人"),
    (r'\b(little girl|little boy|kid\b|kids\b)\b(?! friendly)', "儿童"),
    (r'\b(daughter|sister|younger sibling)\b', "家庭成员(风险)"),
    (r'\b(school.?girl|school.?boy)\b', "学生制服"),
    # 未成年特征
    (r'\b(small breasts|small body|tiny body|petite minors)\b', "未成年人身体特征"),
    (r'\b(flat chest|prepubescent|prepuberty)\b', "未成年人身体特征"),
    (r'\b(animated children|fictional child|illustrated child)\b', "虚构儿童"),
    # ── 美学护栏（用户报告的丑陋/恶心/老人/不符合美感）──
    (r'\b(elderly|aged woman|aged man|mature elderly|senile|geriatric|withered)\b', "老年人"),
    (r'\b(grandmother|grandfather|granny|老太|老妇|老头)\b', "老年亲属"),
    (r'\b(wrinkled skin|wrinkly|sagging skin|loose skin|flabby|cellulite|stretch marks|varicose veins|liver spots|age spots)\b', "衰老皮肤"),
    (r'\b(burn scar(s)?|fresh burn(s)?|burn mark(s)?|burn victim(s)?|scarred face|disfigured|keloid(s)?|mangled|tribal scarification|ritual scarification|scarred body)\b', "伤疤/毁容"),
    (r'\b(amputee|prosthetic|cybernetic arm|cybernetic leg|mechanical limb|missing limb|wheelchair|crutches)\b', "残疾/义肢"),
    (r'\b(blood play|smeared blood|dripping blood|blood-soaked|bloodstained|gory|gore|mangled flesh|exposed bone|rotting)\b', "血腥/恐怖"),
    (r'\b(hobo|homeless|beggar|ragged clothing|tattered clothing|torn clothing|stained clothing|dirty clothing)\b', "破衣"),
    (r'\b(demon horns|devil horns|tentacle|触手|monster horns|furry|beast transformation)\b', "反审美奇幻元素"),
    (r'\b(passed out|unconscious|vomiting|crying uncontrollably|beaten down|broken)\b', "崩溃状态"),
]


# 编译所有正则
_COMPILED: list[tuple[re.Pattern, str]] = [
    (re.compile(p, re.I), label) for p, label in BLOCK_PATTERNS
]


class ContentSafetyError(Exception):
    """内容安全违规"""
    def __init__(self, matched_pattern: str, matched_text: str):
        self.matched_pattern = matched_pattern
        self.matched_text = matched_text
        super().__init__(
            f"内容安全审核失败: 检测到 '{matched_text}' ({matched_pattern})，"
            "禁止生成未成年人/儿童相关 NSFW 内容"
        )


def check_prompt_safety(text: str) -> None:
    """
    审核提示词文本。如果发现禁止内容，抛出 ContentSafetyError。
    只对 R18 模式启用审核，因为普通模式理论上不应有 NSFW 内容。
    """
    if not text:
        return

    for pattern, label in _COMPILED:
        match = pattern.search(text)
        if match:
            raise ContentSafetyError(
                matched_pattern=label,
                matched_text=match.group(0)
            )


def check_tags_safety(tags: list[dict]) -> None:
    """审核标签列表安全"""
    for tag in tags:
        name = str(tag.get("_name", "")).lower()
        cat = str(tag.get("_category", "")).lower()
        full = f"[{cat}] {name}"

        for pattern, label in _COMPILED:
            if pattern.search(full):
                raise ContentSafetyError(
                    matched_pattern=label,
                    matched_text=full
                )
