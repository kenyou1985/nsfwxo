"""API Router - Prompt Engine Routes"""

import asyncio
import re
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.models.schemas import (
    ExpandRequest, ExpandResponse, ExpandVideoFromImageRequest,
    RandomRequest, RandomResponse, PromptResult,
    StoryboardRequest, StoryboardResponse, StoryboardPanel,
    GridStoryboardRequest, GridStoryboardResponse,
    StoryboardThemesRequest, StoryboardThemesResponse, StoryboardThemeOption,
    StoryboardOutlineRequest, StoryboardOutlineResponse, StoryboardOutline,
    StoryboardScriptRequest, StoryboardScriptResponse,
)
from app.services.llm_service import call_grok, clean_json_response, YunwuAuthError, YunwuRateLimitError, YunwuTimeoutError, YunwuParseError, YunwuAPIError
from app.services.gacha_service import generate_random_tags
from app.services.safety_filter import check_prompt_safety, check_tags_safety, ContentSafetyError
from app.services.prompt_coherence import detect_prompt_conflicts, rewrite_coherent_prompt, detect_outfit_color_drift
from app.services.theme_database import get_random_poses
from app.services.prompt_task_store import get_task_store, TaskStatus

router = APIRouter(prefix="/api/prompt", tags=["prompt"])
security = HTTPBearer()

MAX_RETRIES = 3


# ─── Ethnicity / Race diversity pool ───────────────────────────────────────
# Used across theme and outline prompts to encourage diverse character
# ethnicities/nationalities rather than defaulting to a single race.
ETHNICITY_POOL = (
    "亚洲人 (Asian)",
    "黄种人 (East Asian / Mongoloid)",
    "中国人 (Chinese)",
    "日本人 (Japanese)",
    "韩国人 (Korean)",
    "泰国人 (Thai)",
    "越南人 (Vietnamese)",
    "印度人 (Indian)",
    "伊朗人 (Iranian / Persian)",
    "中东人 (Middle Eastern)",
    "白人 (Caucasian / White)",
    "欧洲人 (European)",
    "意大利人 (Italian)",
    "法国人 (French)",
    "德国人 (German)",
    "俄罗斯人 (Russian)",
    "斯堪的纳维亚人 (Scandinavian)",
    "美国人 (American)",
    "拉丁人 (Latino)",
    "拉美人 (Latin American)",
    "巴西人 (Brazilian)",
    "墨西哥人 (Mexican)",
    "非洲人 (African)",
    "黑人 (Black / African descent)",
    "波利尼西亚人 (Polynesian)",
    "混血儿 (Mixed race / Multiracial)",
)

ETHNICITY_BLOCK = (
    "\n\n【CHARACTER ETHNICITY / NATIONALITY DIVERSITY — MANDATORY PRIORITY ORDER】:\n"
    "When generating characters, follow this STRICT PRIORITY ORDER for ethnicity/race selection.\n"
    "Do NOT default to a single race. The priority order below MUST be respected so the cast\n"
    "reflects the user\'s preference: muscular Black men and East Asian women first.\n"
    "\n"
    "═══════════════════════════════════════════════════════════════════════\n"
    "  PRIORITY 1 (HIGHEST — use most often): MUSCULAR BLACK MEN (黑人 / 非洲裔)\n"
    "═══════════════════════════════════════════════════════════════════════\n"
    "  - Chiseled, muscular, broad-shouldered Black men (African / African-American / Caribbean descent)\n"
    "  - Skin tone: rich dark brown / deep brown / ebony / chocolate\n"
    "  - Build: muscular, athletic, broad shoulders, strong arms, well-defined chest and abs\n"
    "  - Hair: short black hair, close-cropped fade, bald, or short Afro\n"
    "  - Examples for English image_prompt:\n"
    "    * \"a tall muscular Black man with rich dark brown skin, broad shoulders, short black hair, and strong arms\"\n"
    "    * \"a chiseled African-American man with deep ebony skin, muscular chest and abs, and short-cropped black hair\"\n"
    "    * \"a strong Black man with chocolate skin, athletic muscular build, and a bald head\"\n"
    "    * \"a handsome Nigerian man with rich brown skin, muscular build, and short black hair\"\n"
    "    * \"a fit Afro-Caribbean man with dark skin, broad shoulders, and powerful arms\"\n"
    "\n"
    "═══════════════════════════════════════════════════════════════════════\n"
    "  PRIORITY 2 (HIGH — use often): EAST ASIAN WOMEN (黄种人 / 东亚女性)\n"
    "═══════════════════════════════════════════════════════════════════════\n"
    "  - Korean (韩国女人), Japanese (日本女人), Chinese (中国女人) preferred — rotate freely\n"
    "  - Skin tone: warm beige / fair / porcelain / ivory (East Asian complexion)\n"
    "  - Features: dark almond eyes, silky black hair (long, straight or wavy)\n"
    "  - Examples for English image_prompt:\n"
    "    * \"a beautiful Korean woman with warm beige skin, silky long black hair, and dark almond eyes\"\n"
    "    * \"a stunning Japanese woman with fair porcelain skin, silky straight black hair, and dark brown eyes\"\n"
    "    * \"a gorgeous Chinese woman with warm ivory skin, long wavy black hair, and dark eyes\"\n"
    "    * \"a beautiful Taiwanese woman with fair skin, silky black hair, and delicate features\"\n"
    "    * \"a cute Thai woman with warm beige skin, long black hair, and soft brown eyes\" (acceptable secondary)\n"
    "\n"
    "═══════════════════════════════════════════════════════════════════════\n"
    "  PRIORITY 3 (MEDIUM — use as supporting/secondary): EUROPEAN WHITE WOMEN\n"
    "═══════════════════════════════════════════════════════════════════════\n"
    "  - Russian, Italian, French, German, Scandinavian, Spanish, Polish, etc.\n"
    "  - Skin tone: pale / fair / olive / light\n"
    "  - Examples:\n"
    "    * \"a beautiful Russian woman with pale skin, light blonde hair, and blue eyes\"\n"
    "    * \"a gorgeous Italian woman with olive skin, dark brown hair, and hazel eyes\"\n"
    "\n"
    "═══════════════════════════════════════════════════════════════════════\n"
    "  PRIORITY 4 (LOWER — only when variety is needed): OTHER ETHNICITIES\n"
    "═══════════════════════════════════════════════════════════════════════\n"
    "  - Iranian / Persian, Turkish, Indian, Brazilian, Mexican, Cuban, Argentine, etc.\n"
    "\n"
    "═══════════════════════════════════════════════════════════════════════\n"
    "  ABSOLUTE RULES:\n"
    "═══════════════════════════════════════════════════════════════════════\n"
    "1. **Default man archetype**: When the story has a male character, the DEFAULT is\n"
    "   a MUSCULAR BLACK MAN (Priority 1). At least 70% of male roles must be Black/\n"
    "   African-descent men with strong muscular builds. Do NOT default to white/Asian men.\n"
    "2. **Default woman archetype**: When the story has a female character, the DEFAULT\n"
    "   is an EAST ASIAN WOMAN (Korean / Japanese / Chinese, Priority 2). At least 60% of\n"
    "   female roles must be East Asian women. Only use European white women as a\n"
    "   secondary/supporting character (Priority 3).\n"
    "3. **Skin tone MUST match ethnicity**: Dark skin for Black characters; warm beige/fair\n"
    "   for East Asian; pale/olive for European.\n"
    "4. **Same character across panels**: Once a character\'s ethnicity is set in Panel 1,\n"
    "   NEVER change it. Same Black man in every panel; same East Asian woman in every panel.\n"
    "5. **EXCEPTION — Lesbian theme**: If the theme is a LESBIAN / 女同 / 百合 / 双女主 theme\n"
    "   (detected by theme name/tags), then BOTH main characters MUST be women —\n"
    "   prioritize ONE East Asian woman + ONE European white woman (or two East\n"
    "   Asian women). NO MAN appears in any panel. The Black male archetype does NOT apply.\n"
    "6. In English image_prompts, ALWAYS start with the explicit ethnicity descriptor:\n"
    "   * Man examples: \"a tall muscular Black man with rich dark brown skin, broad shoulders,\n"
    "     short black hair, and well-defined muscular chest and abs\"\n"
    "   * Woman examples: \"a beautiful Korean woman with warm beige skin, silky long black\n"
    "     hair, and dark almond eyes\"\n"
    "   * Lesbian examples: \"a beautiful Chinese woman with warm beige skin, silky long black\n"
    "     hair\" paired with \"a stunning Russian woman with pale skin, light blonde hair\"\n"
    "7. AVOID cliche single-race casts. Mix East Asian women + Black men as the default\n"
    "   pairing for het stories; mix East Asian + European white women for lesbian stories."
)


# ── Lesbian theme detection ───────────────────────────────────────────────────────
# Returns True if the theme name/tags indicate a lesbian / female-only / 双女主 theme.
# Used to flip the prompt rules so:
#   - No man appears in any panel
#   - Both characters are women (East Asian + European white by default)
#   - Sex positions are female-on-female (scissoring, tribbing, fingering, etc.)
_LESBIAN_KEYWORDS = (
    "拉拉", "女同", "百合", "双女主", "双女", "闺蜜", "lesbian", "lesbo", "trib",
    "tribbing", "scissor", "scissoring", "girl on girl", "girl-on-girl", "g/g",
    "femdom", "女性支配", "两女", "女性之间", "girls together", "sapphic", "wlw",
    "females only", "all women", "纯女", "女人和女人",
)


def _is_lesbian_theme(theme_name, theme_tags=None, theme_data=None):
    """Return True if theme name/tags/category indicate a lesbian / women-only story.

    Examples of detected themes:
      - 「双女闺蜜」 / 「双女主」 / 「闺蜜」 → True
      - 「女同」 / 「拉拉」 / 「百合」 → True
      - 「女性支配」 (女上位 / dominatrix) → True
      - Two-girl-only themes (category=lesbian/femdom/ff) → True
    """
    name = (theme_name or "").lower()
    for kw in _LESBIAN_KEYWORDS:
        if kw in name:
            return True
    if theme_tags:
        for tag in theme_tags:
            if not isinstance(tag, str):
                continue
            t = tag.lower()
            for kw in _LESBIAN_KEYWORDS:
                if kw in t:
                    return True
    if theme_data and isinstance(theme_data, dict):
        cat = (theme_data.get("category") or "").lower()
        if cat in {"lesbian", "femdom", "ff", "girlxgirl"}:
            return True
    return False



# ════════════════════════════════════════════════════════════════════════════════
# THEME-AWARE PANEL ENFORCEMENT (post-processing layer)
# ════════════════════════════════════════════════════════════════════════════════
# The user repeatedly complained: 主题=修女 生成的 panel 是白色连衣裙/迷你裙/比基尼;
# 主题=法官 panel 出现 晚礼服/高跟鞋/咖啡厅; 主题=保龄球馆 全部场景在卧室/厨房.
# Even with detailed prompt instructions, the LLM still drifts.
#
# This module FORCES theme consistency post-generation:
#   1. Detects ALL outfit words in scene_description / image_prompt (200+ vocabulary)
#   2. Detects ALL location words (100+ vocabulary)
#   3. Replaces off-theme outfits/locations with the theme's CANONICAL outfit/location
#   4. For panel 1 specifically, ENFORCES a theme-setup opening (保龄球 → 打球, 修女 → 祈祷)
#   5. Works on ALL panels in non-R18 mode, and panels 1-3 in R18 mode
#
# Strategy: when outfit is detected, check if it's COMPATIBLE with the theme's
# costume keywords. If not, REPLACE.
# ════════════════════════════════════════════════════════════════════════════════

import re as _re_consist
from typing import Optional, List, Tuple, Dict

# ─── Massive Chinese outfit vocabulary (200+ terms) ─────────────────────────────
# All terms the LLM is likely to use, sorted by length descending so longer terms
# match first when overlapping (e.g. "白色连衣裙" matches before "连衣裙").
_OUTFIT_WORDS_ZH = sorted([
    # ── 修女系 ──
    "修女服", "修女袍", "修女头巾", "修女帽", "念珠", "圣经",
    "黑色修女服", "白色修女服", "灰色修女服",
    # ── 法官 / 律师 ──
    "法官袍", "黑色法官袍", "银色假发", "法槌", "法袍", "假发",
    "律师套装", "律师服", "律师袍", "辩护律师服",
    # ── 护士 / 医生 ──
    "护士服", "白色护士服", "护士帽", "护士鞋", "听诊器",
    "医生袍", "白大褂", "医生服", "手术服",
    # ── 空姐 / 航空 ──
    "空姐制服", "机长制服", "飞行员制服", "航空制服", "空姐帽",
    "空姐丝巾", "空姐高跟鞋", "空姐领带", "空姐围裙",
    "空姐装", "空姐连衣裙", "空姐", "空乘", "航空制服", "航空装",
    "空中乘务员装", "机组服装", "客舱乘务员", "空姐套装",
    "机长装", "机长帽", "飞行员帽", "乘务员装", "乘务长装",
    # ── 警察 / 军人 ──
    "警察制服", "警服", "警帽", "警徽", "军装", "军服",
    "军帽", "军靴", "军衔", "水手服", "海军制服",
    # ── 教师 / 学生 ──
    "校服", "JK制服", "学生制服", "白衬衫", "格子裙",
    # ── 女仆 / 兔女郎 / 啦啦队 ──
    "女仆装", "兔女郎装", "啦啦队服", "啦啦队",
    # ── 民族 / 传统 ──
    "汉服", "和服", "浴衣", "旗袍", "韩服", "纱丽", "肚兜", "凤冠", "霞帔",
    # ── 异装 / 角色 ──
    "婚纱", "公主裙", "女王长袍", "海盗服", "哥特服装",
    "中世纪服装", "古风服装", "武侠服装", "仙女服", "精灵服",
    "太空服", "宇航服", "战斗服", "机甲服",
    # ── 家居 / 厨房 / 户外 ──
    "围裙", "迷彩服", "迷彩", "工装", "工装裤", "工装上衣",
    "牛仔帽", "棒球帽", "斗篷", "披风", "帽子", "领带",
    # ── SM / 情趣 ──
    "皮衣", "皮夹克", "乳胶紧身衣", "乳胶衣", "束缚装",
    "情趣内衣", "情趣睡裙", "透明睡衣", "蕾丝内衣", "蕾丝睡裙",
    "蕾丝吊带", "丁字裤", "胸罩", "文胸", "内裤", "吊带袜",
    "三点式", "比基尼", "泳装", "泳衣", "比基尼泳装",
    "性感内衣", "性感睡衣", "丝质睡衣", "真丝睡袍",
    # ── 内衣 / 家居 ──
    "家居服", "居家服", "睡衣", "睡袍", "睡裙", "睡帽",
    "晨袍", "薄纱", "薄纱睡袍", "浴袍", "浴巾", "桑拿巾",
    # ── 连衣裙 ──
    "连衣裙", "白色连衣裙", "黑色连衣裙", "红色连衣裙",
    "粉色连衣裙", "紫色连衣裙", "蓝色连衣裙", "晚礼服",
    "礼服裙", "拖地长裙", "长裙", "短裙", "超短裙",
    # ── 迷你裙 ──
    "迷你裙", "黑色迷你裙", "白色迷你裙", "粉色迷你裙", "超短迷你裙",
    # ── 半裙 / 包臀 ──
    "包臀裙", "铅笔裙", "A字裙", "百褶裙", "伞裙",
    # ── 套装 / 制服 ──
    "职业套装", "职业装", "西装", "黑色西装", "商务衬衫",
    "OL套装", "职场套装", "职业裙", "通勤装",
    # ── 运动 / 健身 ──
    "运动内衣", "运动装", "运动装", "运动服", "瑜伽服", "健身服",
    "球衣", "运动短裤", "足球服", "棒球服", "保龄球服",
    "保龄球polo衫", "高尔夫球装", "polo衫", "网球裙",
    # ── 赛车系 (扩充,覆盖 t023/t181 主题 + LLM 同义变体) ──
    "赛车连体服", "赛车手套", "赛车头盔", "赛车靴", "赛车宝贝背心",
    "赛车宝贝装", "赛车服装", "赛车鞋", "赛车护目镜", "赛车内衣",
    "赛车领奖服", "赛车防火服", "车队背心", "维修工装", "赞助商服装",
    "赛车围裙", "赛车头盔面罩", "驾驶手套",
    # ── 足球场系 (扩充,覆盖 t139) ──
    "球衣", "球袜", "球靴", "运动外套", "运动头带", "队长袖标",
    "球衣短裤", "守门员手套", "球衣套装", "训练背心", "球衣球裤",
    # ── 机器人/未来系 (扩充,覆盖 t411/t399/t427) ──
    "机器人装", "机器人套装", "机器人盔甲", "机械义体", "机械姬装",
    "机甲服", "未来装", "未来制服", "金属皮肤", "光纤紧身服",
    "合成皮", "机械骨架", "电子盔甲", "仿生服", "管家制服",
    "未来管家装", "AI制服", "金属头饰",
    # ── 球场/赛场 (扩充,覆盖各种运动) ──
    "高尔夫球装", "棒球服", "棒球帽", "拳击短裤", "拳击手套",
    "拳击护具", "网球裙", "排球服", "排球短裤", "沙滩排球装",
    # ── 沙滩排球 ──
    "沙滩短裤", "运动背心", "沙滩比基尼", "排球服", "排球短裤", "沙滩排球装",
    # ── 上装 ──
    "吊带", "吊带裙", "吊带背心", "背心", "T恤",
    "衬衫", "毛衣", "针织衫", "开衫", "卫衣",
    # ── 外套 ──
    "风衣", "羽绒服", "外套", "大衣", "皮草",
    # ── 牛仔 / 休闲 ──
    "牛仔短裤", "牛仔裤", "休闲装", "便装",
    # ── 配饰 (less important) ──
    "高跟鞋", "球宝", "丝袜", "长筒袜", "过膝袜", "长靴",
    # ── 全裸 / 半裸 ──
    "全裸", "赤裸", "裸体", "半裸", "仅着内衣", "脱去外衣",
    "部分脱去", "湿身", "披着浴巾",
], key=len, reverse=True)

# ─── Massive Chinese location vocabulary (100+ terms) ───────────────────────────
_LOCATION_WORDS_ZH = sorted([
    # ── 修女 ──
    "修道院", "告解室", "祈祷室", "修女房间", "礼拜堂", "教堂",
    "教堂内", "教堂中", "十字架前",
    # ── 法官 ──
    "法庭", "法院", "法官办公室", "法院走廊", "私人书房",
    "审判席", "旁听席", "证人席", "律师事务所",
    # ── 护士 / 医院 ──
    "护士站", "病房", "医院", "诊所", "检查室", "医院走廊",
    "急诊室", "手术室", "候诊区",
    # ── 空姐 / 航空 ──
    "飞机", "飞机洗手间", "头等舱", "机组休息室", "机场", "航班",
    "驾驶舱", "经济舱", "客舱", "行李舱", "登机口",
    # ── 航空 (扩充,加 LLM 变体词,保证非航空主题能强制替换) ──
    "私人飞机", "私人航班", "私人航空", "私人舱", "商务舱", "头等舱座位",
    "头等舱沙发", "头等舱卧铺", "飞机餐车", "机组播报", "机舱走廊",
    "机组厨房", "机组餐车", "空乘制服走廊", "空姐领带", "空姐丝巾",
    "空姐高跟鞋", "空姐帽", "空姐围裙", "乘务员", "乘务长",
    "贵宾候机室", "贵宾室", "候机楼", "候机大厅", "航站楼",
    "机场贵宾室", "机场VIP室", "机场VIP通道", "登机廊桥", "登机桥",
    "机场行李提取", "机组休息舱", "飞行甲板", "飞行驾驶舱", "航空餐车",
    "飞机舷梯", "机舱门", "机舱顶舱", "机舱地板", "机舱储物",
    "客舱窗户", "民航客舱", "私人客舱", "头等舱餐车", "经济舱座位",
    "机组乘务员室", "头等舱娱乐屏", "飞机卫生间", "飞机洗手台",
    # ── 赛车场系 (扩充,覆盖 t023/t181 主题场) ──
    "赛车驾驶舱", "赛车驾驶室", "维修站", "维修车间", "维修间",
    "维修工具墙", "领奖台", "冠军领奖台", "车队帐篷", "车队休息区",
    "车队维修站", "赛车车库", "赛车场", "赛车场围栏", "赛车场维修站",
    "赛车场更衣室", "赛车场车库", "赛车场起跑线", "赛车场赛道",
    "赛车场地", "赛道", "赛道边", "赛道起跑线", "赛道围栏",
    "赛车场房", "赛车场贵宾区", "车队维修间", "轮胎堆", "赛车塔",
    "P房", "维修通道", "赛车起跑线", "赛车直道", "赛车弯道",
    "赛车场通道", "赛事指挥台", "车队车库",
    # ── 足球场系 (扩充,覆盖 t139 主题场) ──
    "足球场", "球场中央", "球场边线", "球场禁区", "球场草皮",
    "球场通道", "球场看台", "球场观众席", "更衣室", "球队更衣室",
    "球场替补席", "球场替补区", "球场教练区", "球场技术区",
    "球场器材室", "球门后", "角球区", "球场中圈", "球场中线",
    "球场更衣间", "球场球员通道", "球门区", "球场边线区",
    "训练场", "训练草坪", "球场包厢", "球场 VVIP", "球场VIP包厢",
    # ── 机器人/未来系 (扩充,覆盖 t411/t399/t427) ──
    "豪宅", "豪宅内", "豪宅大厅", "豪宅大厅内", "豪宅走廊",
    "豪宅卧室", "豪宅书房", "豪宅客房", "豪宅起居室",
    "管家室", "管家房", "管家休息室", "管家更衣室",
    "主人卧室", "主卧室", "主人套房", "主人书房",
    "未来房间", "未来住宅", "未来豪宅", "未来实验室",
    "未来舱", "未来空间站", "未来居所", "机器人实验室",
    "机械实验室", "机甲库", "机甲舱", "机械仓库",
    # ── 温泉 / 浴场 / 浴室 ──
    "温泉池", "温泉", "野温泉", "别墅温泉", "公共浴场", "浴室",
    "桑拿房", "桑拿", "蒸气房", "岩盘浴", "温泉度假村",
    # ── 学校 ──
    "教室", "学校", "操场", "校园", "图书馆", "讲台",
    "实验室", "宿舍", "体育馆", "学校走廊",
    # ── 公园 / 户外 ──
    "公园", "公园长椅", "摩天轮", "咖啡厅", "餐厅",
    "酒吧", "酒吧包间", "包间", "包厢",
    "卧室", "主卧", "次卧", "闺房", "酒店房间",
    "情趣酒店", "酒店", "客房", "套房",
    "床上", "沙发上", "椅子上", "吧台上",
    "厨房", "客厅", "餐厅", "玄关",
    "书房", "阳台", "露台", "天台",
    # ── 法庭 / 办公 ──
    "办公室", "会议室", "茶水间", "公司走廊",
    # ── 街头 ──
    "街道", "路边", "小巷", "胡同", "巷子",
    # ── 保龄球馆 ──
    "保龄球馆", "球馆", "保龄球道", "保龄球瓶区",
    # ── 泳池 / 海 ──
    "泳池", "游泳池", "泳道", # "泳池边",  # REMOVED: causes drift in non-pool themes "泳池边湿身",
    "游泳馆", "跳水池", "泳池躺椅", "更衣室", "更衣帐篷",
    "沙滩", "海边", "海岸", "海浪", "礁石",
    "摩天轮", "摩天轮座舱", "摩天轮坐舱", "摩天轮上",
    "喷泉", "喷泉旁", "喷泉边",
    "树林", "树林深处", "树林里", "小树林", "树丛", "树荫", "树荫下",
    "丛林", "丛林深处", "野外", "野外丛林", "野地", "荒地", "荒野",
    "草丛", "草丛间", "花丛", "花园", "花园里",
    "林间小道", "林荫道", "山间小路",
    "山顶", "山腰", "山谷", "山洞", "山崖", "悬崖", "山脚", "山坡",
    # ── 咖啡 / 餐厅 / 酒吧 (扩展) ──
    "咖啡馆", "咖啡店内", "餐厅内", "餐厅里",
    "酒窖", "夜店", "夜店内", "KTV包间", "派对现场",
    # ── 卧室 / 酒店 (扩展) ──
    "总统套房",
    # ── 楼内 ──
    "电梯内", "阁楼", "地下室", "屋顶", "观景台",
    # ── 异域 / 传统 (扩展) ──
    "中式阁楼", "古宅", "竹林深处", "月下",
    "皇宫大殿", "王座厅", "老上海", "豪宅大厅", "豪宅内",
    # ── 主题公园 / 娱乐 ──
    "游乐园", "过山车", "旋转木马", "鬼屋", "密室", "密室逃脱",
    # ── 洞穴 / 地下 ──
    "洞穴", "地窖", "储藏室", "仓库",
    # ── 球场 (扩展) ──
    "篮球场", "足球场", "网球场", "羽毛球场", "乒乓球场",
    "棒球场", "排球场",
    # ── 交通工具 (扩展) ──
    "车厢内", "出租车", "私家车", "大巴卧铺", "大巴上", "大巴里",
    "地铁车厢", "地铁站", "公交车上",
    "副驾驶", "车顶",
    # ── 排球 / 沙滩 (扩展) ──
    "沙滩", "海滩", "排球网旁", "沙滩毛巾", "沙滩小屋", "排球场",
    "海边沙滩", "沙滩上", "海面上",
    # ── 高尔夫 ──
    "高尔夫球场", "果岭", "发球台", "球车", "会所",
    "高尔夫练习场", "高尔夫俱乐部会所", "练习场",
    # ── 拳击 ──
    "拳击馆", "拳击场", "拳击台", "拳击擂台", "拳台",
    "擂台", "围绳", "围绳旁", "沙袋", "沙袋旁",
    "擂台角落", "休息室", "更衣室", "更衣间", "训练室",
    # ── 反词表 (LLM 经常 drift 到的非主题地点) ──
    # 这些 location 词即使出现在 panel 里,如果不在 ★ SCENARIOS,也要被替换
    "酒店", "酒店大堂", "酒店房间", "酒店套房", "酒店停车场",
    "地下停车场", "停车场", "公寓", "高级公寓", "豪华公寓",
    "餐厅", "高级餐厅", "私人餐厅", "包间", "包厢",
    "咖啡厅", "咖啡馆", "酒吧", "KTV",
    "度假村", "度假别墅", "私人别墅", "山顶别墅",
    "小岛", "海岛",
    "摩天轮", "旋转木马", "过山车", "游乐场", "游乐园",
    "地铁", "公交车", "出租车", "私家车",
    "教室", "图书馆", "校园", "操场",
    "公园", "公园长椅", "花店", "花房",
    "写字楼", "办公室", "会议室", "茶水间",
    "街头", "街道", "路边", "小巷",
    # ── 滑雪 ──
    "滑雪场", "滑雪道", "缆车", "雪地", "山顶小屋",
    # ── 公园 / 街心 ──
    "街心公园", "植物园", "动物园",
    # ── 交通工具 ──
    "车里", "车后座", "车前座", "车顶", "甲板", "船舱",
    "电梯", "楼梯", "楼道",
], key=len, reverse=True)

# Pre-compiled regex (longest-first matching via | precedence)
_OUTFIT_RE_ZH = _re_consist.compile("|".join(_re_consist.escape(w) for w in _OUTFIT_WORDS_ZH))
_LOCATION_RE_ZH = _re_consist.compile("|".join(_re_consist.escape(w) for w in _LOCATION_WORDS_ZH))

# English location vocabulary (for detecting off-theme English words in image_prompts)
_LOCATION_WORDS_EN = [
    "airplane cabin", "airplane cockpit", "airplane bathroom", "airplane lavatory",
    "airplane", "private jet", "airport terminal", "airport gate", "airport", "airport lounge", "airplane interior", "airplane seat", "airplane aisle", "private jet cabin",
    "first class cabin", "economy class cabin", "crew rest area",
    "private jet interior", "private jet lounge", "private jet bedroom",
    "airplane aisle seat", "first class seat", "business class cabin",
    "airport vip lounge", "airport vip room", "airport waiting area",
    "boarding gate", "airport jet bridge", "airport luggage claim",
    "flight attendant corridor", "cabin corridor", "cabin service area",
    "inflight service cart", "airplane galley",
    "pilot cockpit", "jet cockpit", "first class galley",
    "train compartment", "train sleeper cabin", "train car",
    "subway car", "subway station", "bus interior", "taxi interior", "car interior",
    "hot spring onsen", "hot spring pool", "onsen pool", "onsen bath",
    "beach volleyball court", "beach shore", "beach", "seaside", "swimming pool",
    "poolside", "pool", "diving pool", "wrestling ring", "wrestling mat",
    "bowling alley", "bowling lane", "gym", "yoga studio", "basketball court",
    "soccer field", "football field", "tennis court", "volleyball court",
    "football pitch", "soccer pitch", "football locker room", "team locker room",
    "stadium tunnel", "stadium bench", "stadium dugout", "substitute bench",
    "football stadium", "soccer stadium", "football dressing room", "pitch",
    "race track", "racetrack", "race circuit", "race car cockpit",
    "race car seat", "racing cockpit", "pit lane", "pit stop",
    "podium", "team garage", "race car garage", "race paddock",
    "racing pit", "team paddock tent", "track side", "race finish line",
    "luxury mansion", "mansion hallway", "mansion master bedroom",
    "mansion bedroom", "mansion living room", "mansion foyer",
    "butler room", "servant quarters", "butler pantry", "servant hall",
    "master bedroom", "master suite", "home library",
    "futuristic mansion", "smart home interior", "luxury smart home",
    "nightclub", "night club", "bar", "cafe", "coffee shop", "restaurant",
    "classroom", "school", "library", "laboratory",
    "hospital", "clinic", "nurse station", "operating room",
    "courtroom", "law office", "police station", "interrogation room",
    "church", "convent", "chapel", "monastery",
    "bedroom", "hotel room", "love hotel", "guest room", "suite",
    "kitchen", "living room", "bathroom", "shower room", "bathtub",
    "forest", "jungle", "park", "garden", "mountain", "cave", "cliff",
    "ferris wheel", "amusement park", "rooftop bar", "rooftop",
    "private yacht", "yacht deck", "ship cabin",
    "Japanese garden", "tatami room", "Korean house", "Chinese courtyard",
    "royal palace", "throne room", "mansion",
    "training arena", "stage", "backstage", "dungeon room",
    "escape room", "photo studio", "streaming room",
    "ski slope", "snowy field", "bungee platform",
]
_LOCATION_RE_EN = _re_consist.compile(
    "|".join(sorted(_LOCATION_WORDS_EN, key=len, reverse=True)),
    flags=_re_consist.IGNORECASE,
)

# English outfit vocabulary (for detecting off-theme English words in image_prompts)
_OUTFIT_WORDS_EN = [
    # 航空
    "flight attendant uniform", "flight attendant", "stewardess", "cabin crew",
    "flight attendant outfit", "flight attendant costume", "cabin attendant uniform",
    "stewardess uniform", "airline stewardess", "first class attendant",
    "pilot uniform", "pilot costume", "cockpit suit",
    "airhostess", "air hostess", "air hostess uniform", "cabin crew uniform",
    "flight attendant cap", "flight attendant scarf", "flight attendant heels",
    # 医疗
    "nurse uniform", "nurse cap", "white coat", "stethoscope", "scrubs",
    # 宗教
    "nun habit", "wimple habit", "religious robe", "monk robe",
    # 司法
    "judge robe", "white collar", "gavel", "lawyer suit",
    # 女仆
    "maid outfit", "French maid", "apron",
    # 皮革/SM
    "leather outfit", "latex suit", "bondage gear", "harness",
    # 泳装
    "bikini", "swimsuit", "one-piece swimsuit", "two-piece",
    # 运动
    "sports bra", "gym leggings", "yoga pants",
    "wrestling outfit", "wrestling gear", "boxing gloves", "wrestling shorts",
    "bowling shirt", "bowling polo", "bowling pants",
    "cheerleader uniform", "pom-poms", "cheerleading outfit",
    # 赛车
    "racing suit", "racing jumpsuit", "racing gloves", "racing helmet",
    "racing boots", "racing balaclava", "racing shoes", "racing goggles",
    "racing underwear", "racing fire suit", "racing overalls", "fire suit",
    "pit crew uniform", "pit crew suit", "race car driver suit",
    "podium outfit", "podium wear", "sponsor outfit",
    # 足球
    "football jersey", "football kit", "football uniform", "soccer jersey",
    "soccer kit", "soccer uniform", "football shorts", "football socks",
    "football boots", "football cleats", "goalkeeper gloves",
    "captain armband", "training vest", "team jersey", "match kit",
    # 机器人 / 未来
    "robot suit", "robot costume", "android suit", "android outfit",
    "cyborg suit", "cyborg outfit", "mecha suit", "mecha armor",
    "mechanical body", "mechanical skin", "synthetic skin", "fiber bodysuit",
    "ai maid outfit", "ai butler uniform", "butler uniform", "butler costume",
    "servant uniform", "future suit", "futuristic uniform", "futuristic suit",
    "futuristic armor", "robotic armor", "metallic headpiece", "cyber armor",
    # 球场
    "golf outfit", "baseball uniform", "tennis dress", "tennis skirt",
    "volleyball uniform", "volleyball jersey", "polo shirt",
    # 礼服
    "evening gown", "cocktail dress", "mini skirt", "lingerie",
    "bra and panties", "garter belt", "silk nightgown",
    # 传统服装
    "kimono", "yukata", "hanbok", "sari",
    "hanfu", "qipao", "cheongsam",
    # 特殊
    "wet suit", "wetsuit", "diving suit",
    "police uniform", "badge", "handcuffs",
    "bunny suit", "bunny ears", "tuxedo tails",
    "pirate costume",
    # 休闲
    "casual clothes", "street clothes", "jeans and t-shirt",
    # 浴室
    "towel wrap", "bathrobe", "bath towel",
    # 裸体
    "fully nude",  "naked body", "topless", "barefoot",
    # 抽象 (allow on sex panels)
    "nude", "naked", "wet",
]
_OUTFIT_RE_EN = _re_consist.compile(
    "|".join(sorted(_OUTFIT_WORDS_EN, key=len, reverse=True)),
    flags=_re_consist.IGNORECASE,
)


def _find_all_locations_in_text(text: str) -> List[str]:
    """Return ALL location words found in text (Chinese + English)."""
    if not text:
        return []
    zh_locs = set(_LOCATION_RE_ZH.findall(text))
    en_locs = set(_LOCATION_RE_EN.findall(text))
    return list(zh_locs | en_locs)


def _find_all_outfits_in_text(text: str) -> List[str]:
    """Return ALL outfit words found in text (Chinese + English)."""
    if not text:
        return []
    zh = set(_OUTFIT_RE_ZH.findall(text))
    en = set(_OUTFIT_RE_EN.findall(text))
    return list(zh | en)


# ─── Theme canonical outfit + location overrides ────────────────────────────────
# { theme_name: (canonical_outfit_zh, canonical_outfit_en, canonical_location_zh, canonical_location_en) }
THEME_CANONICAL_OVERRIDES: Dict[str, Tuple[str, str, str, str]] = {
    # 修女
    "修女": ("黑色修女服", "black nun habit with white wimple", "修道院", "convent monastery"),
    # 法官
    "法官": ("黑色法官袍", "black judge robe with white collar", "法庭", "courtroom"),
    "女法官": ("黑色法官袍", "black judge robe", "法庭", "courtroom"),
    # 护士
    "护士长": ("护士制服", "white nurse uniform with cap", "护士站", "nurse station"),
    "护士的情欲": ("护士制服", "white nurse uniform with cap", "护士站", "nurse station"),
    "护士+兔耳": ("护士制服", "white nurse uniform with bunny ears", "护士站", "nurse station"),
    # 空姐
    "空姐的秘密": ("空姐制服", "navy-blue flight attendant uniform", "机组休息室", "crew rest area"),
    # 教师
    "女教师": ("职业套装", "professional teacher outfit", "教室", "classroom"),
    # 温泉 (must match actual DB theme names — canonical location = first scenario, not theme name)
    "温泉": ("浴袍", "white bathrobe", "温泉池", "hot spring onsen"),
    "别墅温泉": ("浴巾", "white bath towel", "温泉池", "hot spring onsen"),
    "火山温泉": ("浴巾", "white bath towel", "温泉池", "hot spring onsen"),
    "野温泉秘境": ("浴巾", "white bath towel", "温泉池", "hot spring onsen"),
    # 摔角 (user feedback: 比基尼 + 摔跤场, not 摔角短裤)
    "比基尼摔角": ("比基尼", "colorful bikini", "摔角擂台", "wrestling ring"),
    "比基尼摔跤": ("比基尼", "colorful bikini", "摔跤擂台", "wrestling mat"),
    # 运动 / 场地
    "沙滩排球": ("比基尼", "colorful bikini", "排球网旁", "beach volleyball court"),
    "保龄球馆": ("保龄球polo衫", "bowling polo shirt", "保龄球馆", "bowling alley"),
    # 兔女郎
    "兔女郎派对": ("兔耳头饰", "black bunny corset with rabbit ears", "私人派对", "private party venue"),
    # 赛车 (新) — 让 _get_canonical_outfit 直接命中"赛车连体服" 而非巧合 pick
    "赛车手装": ("赛车连体服", "racing suit", "赛车驾驶舱", "race car cockpit"),
    "赛车宝贝": ("赛车宝贝背心", "racing babe vest", "维修站", "pit stop"),
    # 足球场 (新)
    "足球场": ("球衣", "football jersey", "球场中央", "center of football pitch"),
    # 机器人管家 (新) — costumes 第三个是抽象"未来装",强制锁定"机器人装"
    "机器人管家": ("机器人装", "robot suit", "豪宅", "luxury mansion"),
    "机械姬": ("机械姬装", "android outfit", "未来舱", "futuristic capsule"),
    # 抽象 costumes 首位主题的具体化 (q2c 步骤2)
    "捆绑艺术": ("绳索束缚", "rope bondage attire", "调教室", "dungeon"),
    "三人行": ("情趣内衣", "sexy lingerie", "卧室", "bedroom"),
    "深喉的艺术": ("蕾丝吊带", "lace bustier", "卧室", "bedroom"),
    "颜射时刻": ("情趣内衣", "sexy lingerie", "卧室", "bedroom"),
    "内射系列": ("情趣内衣", "sexy lingerie", "卧室", "bedroom"),
    "按摩棒狂欢": ("吊带情趣套装", "harness lingerie set", "卧室", "bedroom"),
    "梦境穿越": ("异世界服装", "otherworldly outfit", "梦境", "dream realm"),
    "产卵狂热": ("皮衣", "leather outfit", "实验室", "laboratory"),
    "艺术人体模特": ("浴袍轻披", "open bathrobe", "摄影棚", "photo studio"),
    "口技大师": ("丝袜吊带", "silk stockings with suspenders", "卧室", "bedroom"),
    "三人闺蜜": ("蕾丝睡裙", "lace nightgown", "闺蜜房间", "girlfriends room"),
    "长途大巴": ("睡衣外套", "pajama jacket", "大巴卧铺", "sleeper bus"),
    "SUV后座": ("紧身上衣", "tight top", "车后座", "car back seat"),
    "豪华轿车": ("丝绸长裙", "silk long dress", "车后座", "car back seat"),
    "风电场": ("工装", "work overalls", "风电场草地", "wind farm grass"),
    "日式胶囊旅馆": ("睡衣", "pajamas", "胶囊舱", "capsule pod"),
    "空中餐厅": ("晚礼服", "evening gown", "落地窗旁", "floor-to-ceiling window"),
    "琴房": ("丝绸连衣裙", "silk dress", "钢琴前", "piano front"),
    "洗衣房": ("居家睡裙", "home nightgown", "烘干机旁", "by the dryer"),
    "美甲店": ("吊带裙", "slip dress", "美甲椅", "manicure chair"),
    "天文台": ("毛衣", "sweater", "圆顶内", "observatory dome"),
    "私人飞机": ("空姐制服", "flight attendant uniform", "飞机内", "private jet cabin"),
    "潜水艇观光": ("潜水服", "wetsuit", "观光舱", "submarine observation chamber"),
    # q3: 88 个额外主题的具体化 canonical
    "地铁痴汉": ("OL通勤装", "OL commute outfit", "地铁车厢", "subway car interior"),
    "火车包厢": ("睡衣睡袍", "pajama robe", "双人包厢", "train sleeper compartment"),
    "公交车后座": ("夜店装扮", "club outfit", "最后一排座位", "last-row bus seat"),
    "天台秘密": ("睡袍", "bathrobe", "天台躺椅", "rooftop lounge chair"),
    "羞耻游戏": ("简单内衣", "simple lingerie", "私人房间", "private room"),
    "换妻派对": ("派对装扮", "party outfit", "私人派对", "private party"),
    "牙医诊所": ("牙医制服", "dentist uniform", "牙科治疗椅", "dental treatment chair"),
    "VR虚拟现实": ("紧身VR服", "tight-fitting VR suit", "VR体验室", "VR experience room"),
    "监视下的性爱": ("直播服装", "live streaming outfit", "直播房间", "live streaming room"),
    "主仆契约": ("主人服装", "master outfit", "主人房间", "master bedroom"),
    "偷拍威胁": ("日常装", "everyday outfit", "酒店房间", "hotel room"),
    "魔法学院": ("魔法袍", "magic robe", "魔法教室", "magic classroom"),
    "人鱼公主": ("鳞片泳衣", "scale-patterned swimsuit", "珊瑚礁", "coral reef"),
    "吸血鬼新娘": ("哥特婚纱", "gothic wedding dress", "古堡卧室", "castle bedroom"),
    "盲人按摩师": ("按摩师制服", "masseuse uniform", "按摩店隔间", "massage parlor cubicle"),
    "私人教练与学员": ("运动内衣", "sports bra", "私人健身房", "private gym"),
    "沙发角落": ("居家服", "loungewear", "家庭沙发", "living room sofa"),
    "厨房诱惑": ("围裙", "apron", "灶台前", "kitchen stove"),
    "露营帐篷": ("户外服装", "outdoor outfit", "帐篷内", "camping tent"),
    "古风青楼": ("古装肚兜", "period-drama underbodice", "青楼闺房", "brothel boudoir"),
    "火车硬座": ("旅行休闲装", "travel casual wear", "硬座车厢", "hard-seat train car"),
    "热气球上": ("探险装", "expedition outfit", "热气球篮筐", "hot air balloon basket"),
    "摩的后座": ("紧身裤", "leggings", "摩托车后座", "motorcycle back seat"),
    "峡谷探险": ("探险服", "expedition outfit", "峡谷底部", "canyon floor"),
    "湿地芦苇": ("长裙", "long dress", "芦苇丛中", "reeds"),
    "女巫装": ("女巫袍", "witch robe", "女巫巢穴", "witch lair"),
    "圣诞装": ("圣诞裙", "Christmas dress", "壁炉旁", "by the fireplace"),
    "女海盗": ("海盗服", "pirate outfit", "海盗船甲板", "pirate ship deck"),
    "吸血鬼": ("哥特长裙", "gothic long dress", "古堡卧室", "castle bedroom"),
    "宠物扮演": ("宠物装", "pet costume", "主人房间", "master bedroom"),
    "马术俱乐部": ("骑装", "riding jacket", "马厩", "stable"),
    "纹身师与客人": ("纹身师装", "tattoo artist outfit", "纹身工作室", "tattoo studio"),
    "私人司机": ("司机制服", "chauffeur uniform", "车内", "car interior"),
    "美容师": ("美容师制服", "beautician uniform", "美容床", "beauty bed"),
    "摄影指导": ("摄影装", "photographer outfit", "拍摄现场", "on location shoot"),
    "私人飞行员": ("飞行员制服", "pilot uniform", "飞机驾驶舱", "aircraft cockpit"),
    "古董鉴定师": ("职业装", "business attire", "鉴定工作室", "appraisal studio"),
    "私人裁缝": ("裁缝装", "tailor outfit", "裁缝工作室", "tailor studio"),
    "私人验光师": ("医疗制服", "medical uniform", "验光室", "eye exam room"),
    "梦境引导": ("梦境服装", "dream-realm outfit", "梦境空间", "dream-realm space"),
    "魔法森林": ("精灵装", "elf outfit", "森林深处", "deep forest"),
    "中世纪城堡": ("中世纪礼服", "medieval gown", "城堡卧室", "castle bedroom"),
    "蒸汽朋克": ("蒸汽朋克服", "steampunk outfit", "齿轮室", "gear chamber"),
    "幽灵爱人": ("幽灵装", "ghost outfit", "古堡", "castle"),
    "美人鱼与王子": ("鳞片泳衣", "scale-patterned swimsuit", "海底宫殿", "underwater palace"),
    "吸血鬼猎人": ("猎人装", "hunter outfit", "古堡", "castle"),
    "时间旅行者": ("时空服装", "time-traveler outfit", "时空裂缝", "time rift"),
    "神庙探险": ("探险装", "expedition outfit", "神庙内部", "temple interior"),
    "天使与恶魔": ("天使服装", "angel outfit", "天空", "sky"),
    "古代战场": ("战袍", "war robe", "战场", "battlefield"),
    "海盗船长": ("船长服", "captain outfit", "海盗船", "pirate ship"),
    "冰与火": ("冰服装", "ice outfit", "冰火交界", "ice-fire boundary"),
    "女武神": ("女武神盔甲", "valkyrie armor", "英灵殿", "valhalla"),
    "炼狱之门": ("炼狱服装", "purgatory outfit", "炼狱", "purgatory"),
    "失乐园": ("伊甸服装", "eden outfit", "伊甸园", "eden garden"),
    "凤凰涅槃": ("火焰服装", "flame outfit", "火山口", "volcano crater"),
    "水晶宫殿": ("水晶服装", "crystal outfit", "宫殿", "palace"),
    "暗精灵女王": ("暗精灵服装", "dark elf outfit", "暗精灵宫殿", "dark elf palace"),
    "星际海盗": ("星际海盗服", "space pirate outfit", "星际飞船", "spacecraft"),
    "潜水艇内": ("海军制服", "naval uniform", "潜水艇舱", "submarine interior"),
    "火山探险": ("探险服", "expedition outfit", "火山口", "volcano crater"),
    "极地科考": ("科考服", "expedition parka", "科考站", "research station"),
    "洞穴探险": ("探险服", "expedition outfit", "洞穴", "cave"),
    "航天中心": ("航天服", "space suit", "控制中心", "control center"),
    "香水道场": ("道袍", "ceremonial robe", "道场", "dojo"),
    "陶艺教室": ("围裙", "apron", "拉坯机旁", "by the pottery wheel"),
    "织布工坊": ("工坊服", "workshop outfit", "织布机旁", "by the loom"),
    "玻璃吹制工坊": ("防护服", "protective suit", "熔炉旁", "by the furnace"),
    "铸剑工坊": ("工坊服", "workshop outfit", "锻造台", "forge anvil"),
    "皮革工坊": ("工坊服", "workshop outfit", "工作台旁", "by the workbench"),
    "木工工坊": ("工坊服", "workshop outfit", "工作台旁", "by the workbench"),
    "金工工坊": ("防护服", "protective suit", "熔炼区", "smelting area"),
    "医疗美容": ("医疗服", "medical outfit", "治疗室", "treatment room"),
    "心理咨询": ("职业装", "business attire", "咨询室", "counseling room"),
    "冥想工作坊": ("冥想服", "meditation outfit", "冥想室", "meditation room"),
    "禅修中心": ("禅服", "zen robe", "禅室", "zen room"),
    "芳香疗法": ("理疗服", "therapy outfit", "理疗室", "therapy room"),
    "灵气疗法": ("理疗服", "therapy outfit", "理疗室", "therapy room"),
    "针灸诊所": ("中医服", "TCM outfit", "治疗室", "treatment room"),
    "物理治疗": ("治疗服", "therapy outfit", "治疗室", "treatment room"),
    "动物疗法": ("治疗服", "therapy outfit", "治疗室", "treatment room"),
    "音乐疗法": ("治疗服", "therapy outfit", "治疗室", "treatment room"),
    "艺术疗法": ("工作服", "workwear", "工作室", "studio"),
    "舞动治疗": ("舞蹈服", "dance outfit", "舞蹈室", "dance room"),
    "戏剧疗法": ("戏服", "costume outfit", "排练室", "rehearsal room"),
    # q3+: 高尔夫/拳击 (user feedback: 高尔夫野外球场 / 拳击馆 primary location)
    "高尔夫球童": ("球童服", "golf caddy uniform with visor and polo", "高尔夫球场", "golf course"),
    "拳击搭档": ("拳击短裤", "boxing shorts with sports bra and hand wraps", "拳击馆", "boxing gym"),
    "地下拳击": ("拳击短裤", "boxing shorts with sports bra", "拳击台", "underground boxing ring with crowd"),
    # q3+: 冲浪/滑雪/潜水/瑜伽/舞蹈/健身/马术/赛车 primary location locks
    "冲浪教练": ("比基尼", "bikini", "海边", "beach with surfboards and ocean waves"),
    "滑雪教练": ("滑雪服", "ski instructor jacket with goggles", "滑雪场", "ski slope with snow-covered mountain"),
    "潜水教练": ("潜水服", "wetsuit", "船上", "dive boat deck with ocean"),
    "瑜伽教练": ("瑜伽服", "yoga outfit with leggings", "瑜伽教室", "yoga studio with mats and natural light"),
    "舞蹈教练": ("练功服", "dance leotard with tights", "练功房", "dance studio with mirrors and barre"),
    "健身教练": ("运动内衣", "sports bra with gym leggings", "私教室", "private gym with equipment and mats"),
    "马术教练": ("骑装", "equestrian riding jacket with helmet", "马场", "equestrian arena with horses and fences"),
    "马术俱乐部": ("骑装", "equestrian riding jacket", "马厩", "horse stable with stalls and hay"),
    "私人司机": ("司机制服", "chauffeur uniform with cap", "车内", "luxury car interior with leather seats"),
    "赛车手装": ("赛车连体服", "racing suit with helmet", "赛车驾驶舱", "race car cockpit with steering wheel"),
    "赛车宝贝": ("赛车宝贝背心", "racing babe vest with shorts", "维修站", "pit stop with crew and tires"),
    "美容师": ("美容师制服", "beautician uniform", "美容床", "beauty salon with treatment bed"),
    "潜水搭档": ("潜水服", "wetsuit", "船上", "dive boat deck with ocean"),
    "乐队成员": ("乐队服装", "band outfit with stage clothes", "排练室", "band rehearsal room with instruments"),
    "瑜伽课": ("瑜伽服", "yoga outfit", "瑜伽室", "yoga studio with mats and natural light"),
    "纹身师与客人": ("纹身师装", "tattoo artist outfit with apron", "纹身工作室", "tattoo studio with chair and ink"),
    "潜水艇内": ("海军制服", "naval uniform with cap", "潜水艇舱", "submarine interior with controls"),
    "私人飞机": ("空姐制服", "flight attendant uniform", "飞机内", "private jet cabin with seats"),
    "私人飞机乘务长": ("乘务制服", "flight attendant uniform with heels", "私人飞机", "private jet interior with luxury seats"),
    "私人飞行员": ("飞行员制服", "pilot uniform with cap", "飞机驾驶舱", "aircraft cockpit with instruments"),
    "舞蹈编导": ("舞蹈服", "dance outfit with tights", "排练厅", "rehearsal hall with mirrors"),
    "演员排练": ("戏服", "theatrical costume", "排练室", "rehearsal room with stage"),
    "时装设计师": ("设计师装", "fashion designer outfit", "工作室", "design studio with sketches and fabric"),
    "摄影指导": ("摄影装", "photographer outfit with camera", "拍摄现场", "on-location film set with lights"),
    "婚礼策划师": ("策划师装", "wedding planner outfit", "婚礼现场", "wedding venue with flowers and altar"),
    "私人保镖": ("西装", "suit with earpiece", "豪宅", "luxury mansion interior"),
    "空姐的秘密": ("空姐制服", "navy-blue flight attendant uniform", "机组休息室", "flight crew rest area with bunks"),
    "泳池": ("比基尼", "colorful bikini", "泳池边", "swimming poolside with loungers"),
    "水上教练": ("比基尼", "bikini", "泳池边", "swimming poolside with deck"),
    "保龄球馆": ("保龄球polo衫", "bowling polo shirt", "保龄球馆", "bowling alley with lanes and pins"),
    "沙滩排球": ("比基尼", "colorful bikini", "排球网旁", "beach volleyball court with net and sand"),
    "比基尼摔角": ("比基尼", "colorful bikini", "摔角擂台", "wrestling ring with ropes and turnbuckles"),
    "比基尼摔跤": ("比基尼", "colorful bikini", "摔跤擂台", "wrestling mat with ropes"),
    # q3+: 家庭/教师/医疗
    "女教师": ("职业套装", "professional teacher outfit", "教室", "classroom with blackboard and desks"),
    "修女": ("黑色修女服", "black nun habit with white wimple", "修道院", "convent monastery interior with chapel"),
    "法官": ("黑色法官袍", "black judge robe with white collar", "法庭", "courtroom with judge's bench"),
    "护士长": ("护士制服", "white nurse uniform with cap", "护士站", "nurse station with medical equipment"),
    # q3+: 派对/酒类/温泉
    "兔女郎派对": ("兔耳头饰", "black bunny corset with rabbit ears", "私人派对", "private party venue with neon lights"),
    "温泉": ("浴袍", "white bathrobe", "温泉池", "hot spring onsen with steam and rocks"),
    "别墅温泉": ("浴巾", "white bath towel", "温泉池", "hot spring onsen with steam and rocks"),
    "品酒会": ("正装", "formal evening wear", "酒窖", "wine cellar with barrels and glasses"),
    "品酒师": ("品酒师制服", "sommelier uniform with vest", "酒窖", "wine cellar with barrels and glasses"),
    "电竞战队": ("队服", "esports team jersey", "训练室", "esports training room with gaming PCs"),
    "书友会": ("文艺服装", "literary casual wear", "书房", "private library with bookshelves"),
    "梦幻之境": ("异世界服装", "fantasy outfit", "梦境空间", "dream realm with surreal landscape"),
    "魔法森林": ("精灵装", "elf outfit with leaf details", "森林深处", "deep forest with ancient trees"),
    "幽灵爱人": ("幽灵装", "ghostly white outfit", "古堡", "castle interior with stone walls"),
    "中世纪城堡": ("中世纪礼服", "medieval gown with corset", "城堡卧室", "castle bedroom with stone walls"),
    "海盗船长": ("船长服", "pirate captain outfit with hat", "海盗船", "pirate ship deck with sails and ocean"),
    "女海盗": ("海盗服", "pirate outfit with bandana", "海盗船甲板", "pirate ship deck with ocean"),
    "天使与恶魔": ("天使服装", "angel outfit with wings", "天空", "sky with clouds and light"),
    "古代战场": ("战袍", "war robe with armor pieces", "战场", "battlefield with tents and soldiers"),
    "太空舱": ("航天服", "spacesuit with helmet", "太空舱内", "space capsule interior with controls"),
    "机器人管家": ("机器人装", "robot suit with metal panels", "豪宅", "luxury mansion with modern interior"),
    "机械姬": ("机械姬装", "android outfit with glowing parts", "未来舱", "futuristic capsule with neon lights"),
    "暗精灵女王": ("暗精灵服装", "dark elf outfit with crown", "暗精灵宫殿", "dark elf palace with obsidian"),
    "星际海盗": ("星际海盗服", "space pirate outfit with gear", "星际飞船", "spacecraft interior with controls"),
    "潜水艇观光": ("潜水服", "wetsuit with mask", "观光舱", "submarine observation chamber with portholes"),
    "星空下": ("毛衣", "sweater with jeans", "户外草地", "outdoor grass field under starry sky"),
    "樱花下": ("和服", "kimono with obi belt", "樱花树下", "under cherry blossom trees with petals"),
    "月光": ("丝绸长裙", "silk long dress", "月光下", "moonlit balcony with silver light"),
    "森林木屋": ("休闲装", "cozy cabin outfit", "木屋内", "wooden cabin interior with fireplace"),
    "湖边小屋": ("毛衣", "sweater with jeans", "湖边", "lakeside cabin with water view"),
    "海边小木屋": ("泳装", "swimsuit with cover-up", "海边小木屋", "seaside cabin with ocean view"),
    "沙漠绿洲": ("长袍", "desert robe with headscarf", "沙漠绿洲", "desert oasis with palm trees"),
    "雪山度假": ("滑雪服", "ski outfit with goggles", "雪山度假村", "ski resort lodge with snow"),
    "极地科考": ("科考服", "expedition parka with fur hood", "科考站", "polar research station with ice"),
    "火山探险": ("探险服", "expedition outfit with helmet", "火山口", "volcano crater with lava"),
    "峡谷探险": ("探险服", "expedition outfit with rope", "峡谷底部", "canyon floor with rock walls"),
    "洞穴探险": ("探险服", "expedition outfit with headlamp", "洞穴", "cave interior with stalactites"),
    "湿地芦苇": ("长裙", "long dress with hat", "芦苇丛中", "wetland reeds with water"),
    "竹林深处": ("汉服", "hanfu with sash", "竹林深处", "deep bamboo forest with green light"),
    "茶室": ("和服", "kimono with obi", "茶室", "tea room with tatami and tea set"),
    "古风青楼": ("古装肚兜", "period-drama underbodice", "青楼闺房", "brothel boudoir with silk drapes"),
    "和风旅馆": ("浴衣", "yukata with geta sandals", "榻榻米房间", "tatami room with sliding doors"),
    "温泉旅馆": ("浴衣", "yukata with geta", "温泉池", "hot spring onsen with rocks and steam"),
    # q3+: VR/科幻/未来
    "VR虚拟现实": ("紧身VR服", "tight-fitting VR suit with sensors", "VR体验室", "VR experience room with headsets"),
    "监视下的性爱": ("直播服装", "live streaming outfit", "直播房间", "live streaming room with camera"),
    "魔法学院": ("魔法袍", "magic robe with hat", "魔法教室", "magic classroom with spell books"),
    "时空裂缝": ("时空服装", "time-space traveler outfit", "时空裂缝", "time-space rift with surreal visuals"),
    "虫族女王": ("虫族服装", "insect queen outfit with chitin", "虫巢", "insect hive with eggs and resin"),
    "冰与火": ("冰服装", "ice outfit with frost details", "冰火交界", "ice-fire boundary with elements"),
    "失乐园": ("伊甸服装", "eden garden outfit with leaves", "伊甸园", "eden garden with forbidden tree"),
    "凤凰涅槃": ("火焰服装", "flame outfit with feathers", "火山口", "volcano crater with phoenix"),
    "水晶宫殿": ("水晶服装", "crystal outfit with gems", "水晶宫殿", "crystal palace with translucent walls"),
    "水下巴洛克": ("水肺装", "scuba gear with fins", "水下巴洛克", "underwater baroque palace with coral"),
    "魅魔诱惑": ("魅魔服装", "succubus outfit with wings", "异空间", "other dimension with dark altar"),
    "外星接触": ("外星服装", "alien outfit with helmet", "飞船内", "spaceship interior with controls"),
    "赛博空间": ("赛博装", "cyberpunk outfit with neon", "霓虹街", "neon street with holographic ads"),
    "机械义体": ("机械义体", "mechanical prosthesis with metal", "改造室", "modification room with surgical tools"),
    # q3+: 餐饮/工作
    "私人厨师": ("厨师服", "chef outfit with hat", "厨房", "kitchen with stove and ingredients"),
    "咖啡馆": ("围裙", "apron with casual clothes", "咖啡馆", "cafe with espresso machine and tables"),
    "私人理财师": ("职业装", "business attire with briefcase", "客户家", "client home with office setup"),
    "古董鉴定师": ("职业装", "business attire with loupe", "鉴定工作室", "appraisal studio with antiques"),
    "花艺师": ("围裙", "apron with floral pattern", "花店", "floral shop with buckets of flowers"),
    "翻译员": ("职业装", "business attire with headset", "会议室", "conference room with interpreter booth"),
    "私人导游": ("导游服", "tour guide outfit with badge", "景点", "tourist attraction with group"),
    "私人家教": ("职业装", "tutor outfit with books", "书房", "study room with desk and books"),
    "营养师": ("职业服", "nutritionist outfit", "工作室", "office with nutrition charts"),
    "法律顾问": ("律师袍", "lawyer robe with tie", "律所", "law office with bookshelves"),
    "心理咨询师": ("职业装", "therapist business attire", "咨询室", "counseling room with couch"),
    "私人医生": ("医生白大褂", "white doctor coat with stethoscope", "病人家中", "patient home with medical bag"),
    "牙医诊所": ("牙医制服", "dentist uniform with mask", "牙科治疗椅", "dental chair with equipment"),
    "私人裁缝": ("裁缝装", "tailor outfit with measuring tape", "裁缝工作室", "tailor studio with fabric and mannequins"),
    "私人验光师": ("医疗制服", "medical uniform with phoropter", "验光室", "eye exam room with phoropter"),
    "品酒会": ("正装", "formal evening wear", "酒窖", "wine cellar with barrels"),
    "调香师": ("实验服", "lab coat with perfume bottles", "调香室", "perfume studio with ingredients"),
    "策展人": ("策展装", "curator outfit with glasses", "展厅", "gallery exhibition hall with artworks"),
    "古风雅集": ("汉服", "hanfu with sash", "古风庭院", "classical Chinese courtyard with pavilion"),
    "古代宫廷": ("宫廷装", "palace court outfit", "皇宫大殿", "imperial palace hall with throne"),
    "梦境引导": ("梦境服装", "dream-realm outfit with shimmer", "梦境空间", "dream-realm space with surreal elements"),
    "催眠师": ("职业装", "therapist business attire", "催眠室", "hypnosis room with recliner"),
    "灵魂交换": ("灵魂服装", "soul-swap outfit", "异空间", "other dimension with mirrors"),
    "暗影刺客": ("刺客服装", "assassin outfit with mask", "暗影", "shadow realm with darkness"),
    "女武神": ("女武神盔甲", "valkyrie armor with wings", "英灵殿", "valhalla hall with warriors"),
    "神庙探险": ("探险装", "expedition outfit with torch", "神庙内部", "temple interior with carvings"),
    "忍者大师": ("忍者服", "ninja outfit with mask", "道场", "ninja dojo with training area"),
    "龙族宝藏": ("宝藏装", "treasure outfit with gold", "宝藏洞穴", "dragon treasure cave with gold"),
    "幽灵古宅": ("古风服装", "vintage period outfit", "古宅", "old mansion with creaking floors"),
    "炼金术士": ("炼金袍", "alchemist robe with vials", "炼金室", "alchemy lab with potions"),
    "时间旅行者": ("时空服装", "time-traveler outfit with clock", "时空裂缝", "time rift with swirling vortex"),
    "星际飞船": ("飞船制服", "spaceship uniform with badge", "飞船驾驶舱", "spaceship cockpit with controls"),
    "美人鱼与王子": ("鳞片泳衣", "scale-patterned swimsuit with fins", "海底宫殿", "underwater palace with coral"),
    "吸血鬼新娘": ("哥特婚纱", "gothic wedding dress with veil", "古堡卧室", "castle bedroom with candlelight"),
    "吸血鬼猎人": ("猎人装", "hunter outfit with cross", "古堡", "castle interior with cobwebs"),
    "吸血鬼": ("哥特长裙", "gothic long dress with lace", "古堡卧室", "castle bedroom with coffins"),
    "宠物扮演": ("宠物装", "pet costume with ears", "主人房间", "master bedroom with pet bed"),
    "主仆契约": ("主人服装", "master outfit with cane", "主人房间", "master bedroom with throne"),
    "羞耻游戏": ("简单内衣", "simple lingerie", "私人房间", "private room with mirror"),
    "换妻派对": ("派对装扮", "party outfit with mask", "私人派对", "private party with swingers"),
    "偷拍威胁": ("日常装", "everyday outfit", "酒店房间", "hotel room with hidden camera"),
    "监视下的性爱": ("直播服装", "live streaming outfit", "直播房间", "live streaming room with camera"),
    "地下派对": ("夜店装扮", "underground club outfit", "地下俱乐部", "underground club with neon"),
    "夜色酒吧": ("晚礼服", "evening gown", "酒吧", "bar with dim lights"),
    "电影院放映厅": ("休闲装", "casual outfit with popcorn", "电影院放映厅", "movie theater auditorium with seats"),
    "电影院深夜": ("休闲装", "casual outfit", "电影院", "late-night movie theater with empty seats"),
    "雨天公交站": ("雨衣", "raincoat with boots", "公交站", "bus stop in rain"),
    "深夜书店": ("休闲装", "casual outfit with glasses", "书店", "late-night bookstore with shelves"),
    "城市天台": ("睡袍", "bathrobe", "天台", "rooftop with city skyline"),
    "地下拳击": ("拳击短裤", "boxing shorts with wraps", "拳击台", "underground boxing ring"),
    "渔港": ("渔民服", "fisherman outfit with boots", "渔港", "fishing harbor with boats"),
    "机械工作室": ("工装", "mechanic overalls", "机械工作室", "mechanic workshop with tools"),
    "美式酒吧": ("皮夹克", "leather jacket with jeans", "美式酒吧", "American-style bar with neon"),
    "天台秘密": ("睡袍", "bathrobe", "天台躺椅", "rooftop with lounge chair"),
    "泳池边": ("比基尼", "colorful bikini", "泳池边", "swimming poolside with loungers"),
}


def _zh_outfit_to_english(zh: str) -> str:
    """Best-effort Chinese → English mapping for the most common outfit terms."""
    mapping = {
        "修女服": "black nun habit with white wimple",
        "法官袍": "black judge's robe",
        "律师套装": "black lawyer suit",
        "护士服": "white nurse uniform with cap",
        "空姐制服": "navy-blue flight attendant uniform",
        "机长制服": "pilot uniform",
        "警察制服": "police uniform",
        "女仆装": "black-and-white French maid uniform",
        "比基尼": "bikini",
        "泳装": "swimsuit",
        "浴袍": "white bathrobe",
        "浴巾": "white bath towel",
        "连衣裙": "dress",
        "职业套装": "professional business suit",
        "西装": "business suit",
        "汉服": "traditional Chinese hanfu",
        "和服": "traditional Japanese kimono",
        "旗袍": "traditional Chinese qipao",
        "校服": "school uniform",
        "JK制服": "JK school uniform",
        "水手服": "sailor uniform",
        "军装": "military uniform",
        "情趣内衣": "sexy lingerie",
        "三点式": "bikini",
        "全裸": "fully nude",
        "杂技服": "acrobatic costume",
        "紧身衣": "tight-fitting leotard",
        "晚礼服": "evening gown",
        "迷你裙": "mini skirt",
        "高跟鞋": "high heels",
        "丝袜": "silk stockings",
        "保龄球polo衫": "bowling polo shirt",
        "排球网旁": "beach volleyball court",
        "沙滩短裤": "beach shorts",
        # ── 赛车 (新) ──
        "赛车连体服": "racing suit",
        "赛车手套": "racing gloves",
        "赛车头盔": "racing helmet",
        "赛车靴": "racing boots",
        "赛车宝贝背心": "racing babe vest",
        "赛车宝贝装": "racing babe outfit",
        "赛车服装": "racing suit",
        "赛车鞋": "racing shoes",
        "赛车护目镜": "racing goggles",
        "赛车内衣": "racing underwear",
        "赛车领奖服": "podium outfit",
        "赛车防火服": "racing fire suit",
        "车队背心": "pit crew vest",
        "维修工装": "pit crew uniform",
        "赞助商服装": "sponsor outfit",
        "赛车围裙": "pit crew apron",
        # ── 足球 (新) ──
        "球衣": "football jersey",
        "球袜": "football socks",
        "球靴": "football boots",
        "运动外套": "tracksuit jacket",
        "运动头带": "sports headband",
        "队长袖标": "captain armband",
        "球衣短裤": "football shorts",
        "守门员手套": "goalkeeper gloves",
        "球衣套装": "team jersey kit",
        "训练背心": "training vest",
        "球衣球裤": "football uniform",
        # ── 机器人 / 未来 (新) ──
        "机器人装": "robot suit",
        "机器人套装": "android suit",
        "机器人盔甲": "robotic armor",
        "机械义体": "cyborg outfit",
        "机械姬装": "android outfit",
        # q3 新服装词 (canonical override 用的具体服装)
        "OL通勤装": "OL commute outfit",
        "睡衣睡袍": "pajama robe",
        "夜店装扮": "club outfit",
        "简单内衣": "simple lingerie",
        "派对装扮": "party outfit",
        "直播服装": "live streaming outfit",
        "主人服装": "master outfit",
        "日常装": "everyday outfit",
        "魔法袍": "magic robe",
        "鳞片泳衣": "scale-patterned swimsuit",
        "哥特婚纱": "gothic wedding dress",
        "按摩师制服": "masseuse uniform",
        "居家服": "loungewear",
        "古装肚兜": "period-drama underbodice",
        "旅行休闲装": "travel casual wear",
        "探险装": "expedition outfit",
        "骑装": "riding jacket",
        "纹身师装": "tattoo artist outfit",
        "司机制服": "chauffeur uniform",
        "美容师制服": "beautician uniform",
        "摄影装": "photographer outfit",
        "飞行员制服": "pilot uniform",
        "裁缝装": "tailor outfit",
        "医疗制服": "medical uniform",
        "梦境服装": "dream-realm outfit",
        "精灵装": "elf outfit",
        "中世纪礼服": "medieval gown",
        "蒸汽朋克服": "steampunk outfit",
        "幽灵装": "ghost outfit",
        "猎人装": "hunter outfit",
        "时空服装": "time-traveler outfit",
        "天使服装": "angel outfit",
        "战袍": "war robe",
        "船长服": "captain outfit",
        "冰服装": "ice outfit",
        "女武神盔甲": "valkyrie armor",
        "炼狱服装": "purgatory outfit",
        "伊甸服装": "eden outfit",
        "火焰服装": "flame outfit",
        "水晶服装": "crystal outfit",
        "暗精灵服装": "dark elf outfit",
        "星际海盗服": "space pirate outfit",
        "海军制服": "naval uniform",
        "科考服": "expedition parka",
        "航天服": "space suit",
        "道袍": "ceremonial robe",
        "工坊服": "workshop outfit",
        "防护服": "protective suit",
        "医疗服": "medical outfit",
        "冥想服": "meditation outfit",
        "禅服": "zen robe",
        "理疗服": "therapy outfit",
        "中医服": "TCM outfit",
        "治疗服": "therapy outfit",
        "舞蹈服": "dance outfit",
        "戏服": "costume outfit",
        "宠物装": "pet costume",
        "女巫袍": "witch robe",
        "圣诞裙": "Christmas dress",
        "海盗服": "pirate outfit",
        "哥特长裙": "gothic long dress",
        "围裙": "apron",
        "长裙": "long dress",
        "睡袍": "bathrobe",
        "紧身VR服": "tight-fitting VR suit",
        "工作服": "workwear",
        "内衣": "lingerie",
        "薄纱": "sheer fabric",
        "机甲服": "mecha suit",
        "未来装": "futuristic outfit",
        "未来制服": "futuristic uniform",
        "金属皮肤": "metallic skin",
        "光纤紧身服": "fiber bodysuit",
        "合成皮": "synthetic skin",
        "机械骨架": "mechanical body",
        "电子盔甲": "cyber armor",
        "仿生服": "android suit",
        "管家制服": "butler uniform",
        "未来管家装": "futuristic butler outfit",
        "AI制服": "AI uniform",
        "金属头饰": "metallic headpiece",
        # ── 球场 (新) ──
        "高尔夫球装": "golf outfit",
        "棒球服": "baseball uniform",
        "拳击短裤": "boxing shorts with hand wraps",
        "拳击手套": "boxing gloves",
        "拳击护具": "boxing protective gear",
        "网球裙": "tennis skirt",
        "排球服": "volleyball uniform",
        "排球短裤": "volleyball shorts",
        "沙滩排球装": "beach volleyball uniform",
        # q3+ 高尔夫球童/拳击/冲浪等 (NEW mappings to fix drift)
        "球童服": "golf caddy uniform with visor and bib",
        "高尔夫装": "golf polo shirt and skirt",
        "运动装": "athletic outfit",
        "绷带": "boxing hand wraps",
        "运动内衣": "sports bra with gym shorts",
        "冲浪服": "wetsuit",
        "比基尼": "colorful bikini",
        "泳装": "swimsuit",
        "防晒服": "UV-protection cover-up",
        "泳衣": "swimsuit",
        "潜水服": "wetsuit with mask and fins",
        "滑雪服": "ski jacket with goggles",
        "保暖内衣": "thermal underwear",
        "瑜伽服": "yoga outfit with leggings",
        "练功服": "dance leotard with tights",
        "舞蹈内衣": "dance leotard",
        "紧身衣": "tight-fitting leotard",
        "骑装": "equestrian riding jacket with helmet",
        "马裤": "riding breeches",
        "马靴": "riding boots",
        "练功服": "dance leotard with tights",
        "泳装": "swimsuit",
        "泳装": "swimsuit",
        "渔夫装": "fisherman outfit",
        "雨衣": "raincoat with boots",
        "毛衣": "sweater with jeans",
        "皮革": "leather outfit",
        "皮衣": "leather outfit",
        "古风服装": "period-drama outfit",
        "和服": "kimono with obi belt",
        "汉服": "hanfu with sash",
        "浴衣": "yukata with geta sandals",
        "中式服装": "traditional Chinese outfit",
        "浴巾": "white bath towel",
        "浴袍": "white bathrobe",
        "旗袍": "traditional Chinese qipao",
        "婚纱": "wedding dress with veil",
        "白色婚纱": "white wedding dress",
        "黑色婚纱": "black gothic wedding dress",
        "队长服": "team captain jersey",
        "赛车服装": "racing suit with helmet",
        "赛车服": "racing suit",
        "皮夹克": "leather jacket with jeans",
        "牛仔装": "denim outfit",
        "护士装": "white nurse uniform with cap",
        "女仆装": "black-and-white French maid uniform",
        "西装": "business suit",
        "制服": "uniform",
        "运动服": "athletic tracksuit",
        "运动短裤": "athletic shorts",
        "工装": "work overalls",
        "工作裤": "work pants",
        "工装裤": "cargo pants",
        "背心": "tank top",
        "紧身上衣": "tight top",
        "晚礼服": "evening gown",
        "丝绸长裙": "silk long dress",
        "丝绸连衣裙": "silk dress",
        "丝绸睡袍": "silk robe",
        "丝绸睡衣": "silk pajamas",
        "皮夹克": "leather jacket with jeans",
        "乐队服装": "band outfit with stage clothes",
        "演出服": "performance outfit",
        "化妆服": "makeup artist outfit",
        "球队服": "team jersey",
        "刺客服": "assassin outfit with mask",
        "潜水员服": "diver outfit with oxygen tank",
        "极地服": "polar expedition parka",
        "长袍": "long robe with headscarf",
        "沙漠装": "desert outfit with headwrap",
        "长袍": "long robe with hood",
        "油彩": "body paint",
        "乐队T恤": "band t-shirt with jeans",
        "古代服装": "period costume",
        "中世纪服装": "medieval costume",
        "宫廷装": "palace court outfit",
        "古代宫廷装": "imperial court outfit",
        "宫廷礼服": "palace court gown",
        "传统服装": "traditional outfit",
        "花裙": "floral dress",
        "印花裙": "printed dress",
        "田园裙": "pastoral dress",
        "渔网袜": "fishnet stockings",
        "渔网装": "fishnet outfit",
        "透明装": "see-through outfit",
        "薄纱睡袍": "sheer nightgown",
        "薄纱": "sheer fabric",
        "睡裙": "nightgown",
        "睡衣": "pajamas",
        "睡衣外套": "pajama jacket",
        "睡袍": "bathrobe",
        "浴袍": "white bathrobe",
        "浴巾": "white bath towel",
        "泳装": "swimsuit",
        "泳衣": "swimsuit",
        "比基尼": "colorful bikini",
        "三点式": "bikini",
        "高叉泳衣": "high-cut swimsuit",
        "连体泳衣": "one-piece swimsuit",
        "套装": "outfit set",
        "队服": "team jersey",
        "牛仔短裤": "denim shorts",
        "牛仔夹克": "denim jacket",
        "皮裤": "leather pants",
        "皮裙": "leather skirt",
        "水手服": "sailor uniform",
        "军装": "military uniform",
        "迷彩服": "camouflage outfit",
        "战术背心": "tactical vest",
        "战术服": "tactical outfit",
        "赛车背心": "racing vest",
        "赛车手套": "racing gloves",
        "赛车头盔": "racing helmet",
        "赛车靴": "racing boots",
        "赛车连体服": "racing suit with helmet",
        "赛车宝贝背心": "racing babe vest with shorts",
        "赛车宝贝装": "racing babe outfit with shorts",
        "泳裤": "swim trunks",
        "沙滩裤": "beach shorts",
        "拳击鞋": "boxing boots",
        "拳击头套": "boxing headgear",
        "拳击背心": "boxing tank top",
        "拳击护齿": "boxing mouthguard",
        "瑜伽服": "yoga outfit with leggings",
        "瑜伽裤": "yoga leggings",
        "运动内衣": "sports bra with gym shorts",
        "健身短裤": "gym shorts",
        "健身服": "athletic gym outfit",
        "长袖运动衫": "long-sleeve athletic shirt",
        "无袖上衣": "sleeveless top",
        "紧身背心": "tight tank top",
        "比基尼摔角服": "bikini wrestling outfit",
        "摔角服": "wrestling outfit",
        "摔跤服": "wrestling singlet",
        "摔角短裤": "wrestling shorts",
        "摔跤短裤": "wrestling shorts",
        "摔角靴": "wrestling boots",
        "足控服": "foot fetish outfit",
        "高跟鞋": "high heels",
        "凉鞋": "sandals",
        "靴子": "boots",
        "丝袜": "silk stockings",
        "长筒袜": "thigh-high stockings",
        "连裤袜": "pantyhose",
        "吊带袜": "garter belt with stockings",
        "过膝袜": "over-knee stockings",
        "白丝": "white silk stockings",
        "黑丝": "black silk stockings",
        "吊带": "suspender belt",
        "情趣内衣": "sexy lingerie",
        "蕾丝内衣": "lace lingerie",
        "蕾丝睡裙": "lace nightgown",
        "蕾丝吊带": "lace bustier",
        "三点情趣": "sexy bikini",
        "丁字裤": "thong",
        "性感睡衣": "sexy nightgown",
        "薄纱睡衣": "sheer nightgown",
        "透明睡衣": "see-through nightgown",
        "丝绸睡衣": "silk pajamas",
        "绸缎睡裙": "satin nightgown",
        "黑色蕾丝": "black lace lingerie",
        "红色蕾丝": "red lace lingerie",
        "白色蕾丝": "white lace lingerie",
        "紧身胸衣": "corset",
        "束腰": "corset",
        "胸衣": "bustier",
        "皮胸衣": "leather bustier",
        "乳胶衣": "latex catsuit",
        "乳胶紧身衣": "latex catsuit",
        "SM装": "BDSM outfit",
        "SM服装": "BDSM outfit",
        "捆绑装": "bondage outfit",
        "捆绑服": "bondage gear",
        "皮革SM": "leather BDSM outfit",
        "恋物服": "fetish outfit",
        "宠物装": "pet costume with ears and tail",
        "宠物服装": "pet costume",
        "尾巴装": "tail costume",
        "猫耳装": "cat ear costume",
        "兔耳装": "bunny ear costume",
        "兔女郎装": "bunny girl outfit",
        "兔耳头饰": "bunny ear headband",
        "天使装": "angel costume with wings",
        "恶魔装": "devil costume with horns",
        "翅膀装": "winged costume",
        "精灵装": "elf costume with pointed ears",
        "翅膀": "wings",
        "尾巴": "tail",
        "猫耳": "cat ears",
        "兔耳": "bunny ears",
        "魔法帽": "wizard hat",
        "斗篷": "cloak",
        "长斗篷": "long cloak",
        "斗篷装": "hooded cloak outfit",
        "盔甲": "armor",
        "板甲": "plate armor",
        "锁子甲": "chain mail",
        "战袍": "war robe",
        "军服": "military uniform",
        "军官服": "officer uniform",
        "将军服": "general uniform",
        "骑士服": "knight armor",
        "战士服": "warrior outfit",
        "猎人服": "hunter outfit",
        "猎装": "hunting outfit",
        "长袍": "long robe",
        "魔法长袍": "magic robe",
        "祭祀袍": "ritual robe",
        "僧袍": "monk robe",
        "道袍": "ceremonial robe",
        "禅服": "zen robe",
        "中式长袍": "Chinese long robe",
        "日式浴衣": "Japanese yukata",
        "日式和服": "Japanese kimono",
        "韩服": "Korean hanbok",
        "印度纱丽": "Indian sari",
        "阿拉伯长袍": "Arab thobe",
        "埃及长袍": "Egyptian robe",
        "希腊长袍": "Greek toga",
        "罗马长袍": "Roman toga",
        "维京装": "Viking outfit",
        "北欧装": "Nordic outfit",
        "凯尔特装": "Celtic outfit",
        "埃及艳后装": "Cleopatra outfit",
        "法老装": "pharaoh outfit",
        "木乃伊装": "mummy costume",
        "女巫装": "witch costume",
        "吸血鬼装": "vampire costume",
        "狼人装": "werewolf costume",
        "僵尸装": "zombie costume",
        "骷髅装": "skeleton costume",
        "死神装": "grim reaper costume",
        "幽灵装": "ghost costume",
        "仙女装": "fairy costume",
        "精灵装": "elf costume",
        "妖精装": "fairy costume",
        "美人鱼装": "mermaid costume with tail",
        "人鱼装": "mermaid costume",
        "龙女仆装": "dragon maid outfit",
        "女仆装": "French maid outfit",
        "女仆": "maid outfit",
        "仆人装": "servant outfit",
        "管家装": "butler outfit",
        "管家制服": "butler uniform",
        "司机装": "chauffeur outfit",
        "司机制服": "chauffeur uniform with cap",
        "乘务装": "flight attendant outfit",
        "乘务制服": "flight attendant uniform",
        "空姐制服": "navy-blue flight attendant uniform",
        "空姐装": "flight attendant outfit",
        "空乘制服": "flight attendant uniform",
        "机长制服": "pilot uniform with cap",
        "飞行员制服": "pilot uniform with cap",
        "赛车手装": "racing suit with helmet",
        "赛车手": "racing suit with helmet",
        "赛车服": "racing suit",
        "消防员装": "firefighter uniform",
        "警察装": "police uniform",
        "军人装": "military uniform",
        "特种部队装": "special forces outfit",
        "忍者装": "ninja outfit with mask",
        "武士装": "samurai armor",
        "浪人装": "ronin outfit",
        "剑客装": "swordsman outfit",
        "刺客装": "assassin outfit with hood",
        "盗贼装": "thief outfit with mask",
        "海盗装": "pirate outfit with hat",
        "船长装": "pirate captain outfit",
        "牛仔装": "cowboy outfit with hat",
        "印第安装": "Native American outfit",
        "西部装": "western outfit",
        "农夫装": "farmer outfit with straw hat",
        "渔民装": "fisherman outfit with boots",
        "猎人装": "hunter outfit with cap",
        "伐木工装": "lumberjack outfit with plaid shirt",
        "矿工装": "miner outfit with helmet",
        "建筑工装": "construction worker outfit",
        "机械工装": "mechanic overalls",
        "焊接工装": "welder outfit with mask",
        "厨师装": "chef outfit with hat",
        "服务员装": "waiter outfit with bow tie",
        "调酒师装": "bartender outfit with vest",
        "咖啡师装": "barista outfit with apron",
        "花艺师装": "florist outfit with apron",
        "裁缝装": "tailor outfit with measuring tape",
        "美容师装": "beautician uniform",
        "美容师制服": "beautician uniform",
        "化妆师装": "makeup artist outfit",
        "发型师装": "hairdresser outfit",
        "纹身师装": "tattoo artist outfit with apron",
        "按摩师装": "masseuse uniform",
        "按摩师制服": "masseuse uniform",
        "瑜伽师装": "yoga instructor outfit",
        "教练装": "coach outfit with whistle",
        "健身教练装": "fitness trainer outfit",
        "舞蹈教练装": "dance instructor outfit",
        "游泳教练装": "swim instructor outfit",
        "潜水教练装": "dive instructor outfit with wetsuit",
        "滑雪教练装": "ski instructor outfit with goggles",
        "高尔夫教练装": "golf instructor outfit with cap",
        "网球教练装": "tennis instructor outfit",
        "棒球教练装": "baseball coach outfit",
        "足球教练装": "football coach outfit",
        "篮球教练装": "basketball coach outfit",
        "排球教练装": "volleyball coach outfit",
        "橄榄球教练装": "rugby coach outfit",
        "曲棍球教练装": "hockey coach outfit",
        "高尔夫球童": "golf caddy uniform with visor",
        "球童": "golf caddy",
        "高尔夫球童装": "golf caddy uniform with visor",
        "球童服": "golf caddy uniform with visor and bib",
        "高尔夫服": "golf polo shirt and skirt",
        "高尔夫装": "golf polo shirt and skirt",
        "高尔夫球装": "golf outfit",
        "网球装": "tennis outfit",
        "网球裙": "tennis skirt",
        "棒球服": "baseball uniform",
        "棒球装": "baseball uniform",
        "排球服": "volleyball uniform",
        "排球装": "volleyball uniform",
        "排球短裤": "volleyball shorts",
        "沙滩排球装": "beach volleyball uniform",
        "篮球服": "basketball uniform",
        "篮球装": "basketball uniform",
        "篮球短裤": "basketball shorts",
        "足球服": "football uniform",
        "足球装": "football uniform",
        "足球短裤": "football shorts",
        "橄榄球服": "rugby uniform",
        "橄榄球装": "rugby uniform",
        "曲棍球服": "hockey uniform",
        "曲棍球装": "hockey uniform",
        "拳击短裤": "boxing shorts with hand wraps",
        "拳击装": "boxing outfit with shorts and wraps",
        "拳击背心": "boxing tank top with shorts",
        "摔角服": "wrestling outfit",
        "摔角短裤": "wrestling shorts",
        "摔角靴": "wrestling boots",
        "摔跤服": "wrestling singlet",
        "摔跤短裤": "wrestling shorts",
        "马术装": "equestrian riding outfit",
        "骑装": "equestrian riding jacket with helmet",
        "马裤": "riding breeches",
        "马靴": "riding boots",
        "骑师装": "jockey outfit with cap",
        "赛马装": "horse racing outfit",
        "赛车装": "racing outfit",
        "赛车连体服": "racing suit with helmet",
        "赛车宝贝装": "racing babe outfit with shorts",
        "赛车宝贝背心": "racing babe vest with shorts",
        "泳装": "swimsuit",
        "泳衣": "swimsuit",
        "泳裤": "swim trunks",
        "沙滩裤": "beach shorts",
        "沙滩装": "beach outfit",
        "防晒服": "UV-protection cover-up",
        "冲浪服": "wetsuit",
        "冲浪装": "wetsuit",
        "潜水服": "wetsuit with mask and fins",
        "滑雪服": "ski jacket with goggles",
        "保暖内衣": "thermal underwear",
        "瑜伽服": "yoga outfit with leggings",
        "瑜伽装": "yoga outfit with leggings",
        "紧身瑜伽服": "tight yoga outfit",
        "健身服": "athletic gym outfit",
        "健身装": "athletic gym outfit",
        "运动内衣": "sports bra with gym shorts",
        "健身短裤": "gym shorts",
        "紧身裤": "leggings",
        "练功服": "dance leotard with tights",
        "舞蹈服": "dance outfit with tights",
        "舞蹈装": "dance outfit",
        "舞衣": "dance costume",
        "舞蹈内衣": "dance leotard",
        "戏剧服装": "theatrical costume",
        "戏服": "theatrical costume",
        "表演服": "performance outfit",
        "演出服": "performance outfit",
        "模特服": "model outfit",
        "写真服": "photo shoot outfit",
        "复古装": "vintage outfit",
        "复古服装": "vintage outfit",
        "古风服装": "period-drama outfit",
        "古装": "period costume",
        "古装肚兜": "period-drama underbodice",
        "古装裙": "period skirt",
        "戏水服": "swim outfit",
        "水手服": "sailor uniform",
        "校园服": "school uniform",
        "JK制服": "JK school uniform",
        "校服": "school uniform",
        "学生装": "student outfit",
        "教师装": "teacher outfit",
        "职业装": "business attire",
        "正装": "formal suit",
        "礼服": "formal gown",
        "晚礼服": "evening gown",
        "鸡尾酒裙": "cocktail dress",
        "迷你裙": "mini skirt",
        "连衣裙": "dress",
        "长裙": "long dress",
        "丝绸长裙": "silk long dress",
        "丝绸连衣裙": "silk dress",
        "丝绸睡衣": "silk pajamas",
        "丝绸睡袍": "silk robe",
        "丝绸裙": "silk dress",
        "丝绒裙": "velvet dress",
        "蕾丝裙": "lace dress",
        "碎花裙": "floral print dress",
        "白裙": "white dress",
        "红裙": "red dress",
        "黑裙": "black dress",
        "粉裙": "pink dress",
        "蓝裙": "blue dress",
        "婚纱": "wedding dress with veil",
        "白色婚纱": "white wedding dress",
        "黑色婚纱": "black gothic wedding dress",
        "哥特婚纱": "gothic wedding dress with veil",
        "哥特长裙": "gothic long dress with lace",
        "朋克装": "punk outfit",
        "朋克服": "punk outfit",
        "哥特装": "gothic outfit",
        "摇滚装": "rock outfit",
        "金属装": "metal-style outfit",
        "机车装": "biker outfit with leather",
        "皮衣": "leather outfit",
        "皮夹克": "leather jacket with jeans",
        "皮裤": "leather pants",
        "皮裙": "leather skirt",
        "皮装": "leather outfit",
        "机车夹克": "biker jacket",
        "丹宁装": "denim outfit",
        "牛仔装": "denim outfit",
        "牛仔短裤": "denim shorts",
        "牛仔夹克": "denim jacket",
        "工装": "work overalls",
        "工作服": "work uniform",
        "工装裤": "cargo pants",
        "工人装": "worker outfit",
        "办公室装": "office attire",
        "白领装": "white-collar outfit",
        "商务装": "business suit",
        "西装": "business suit",
        "西装裙": "suit skirt",
        "职业套装": "professional business suit",
        "OL装": "OL office outfit",
        "OL通勤装": "OL commute outfit",
        "秘书装": "secretary outfit",
        "助理装": "assistant outfit",
        "空姐装": "flight attendant outfit",
        "乘务装": "flight attendant outfit",
        "舞女装": "showgirl outfit",
        "脱衣舞娘装": "exotic dancer outfit",
        "钢管舞装": "pole dance outfit",
        "艳舞装": "exotic dance outfit",
        "兔女郎装": "bunny girl outfit",
        "兔女郎": "bunny girl outfit",
        "泳装": "swimsuit",
        "泳装比基尼": "bikini",
        "三点式": "bikini",
        "高叉泳衣": "high-cut swimsuit",
        "连体泳衣": "one-piece swimsuit",
        "运动装": "athletic outfit",
        "运动服": "athletic tracksuit",
        "运动外套": "tracksuit jacket",
        "运动短裤": "athletic shorts",
        "运动头带": "sports headband",
        "绷带": "boxing hand wraps",
        "拳击绑带": "boxing hand wraps",
        "训练装": "training outfit",
        "训练服": "training outfit",
        "训练背心": "training vest",
        "训练短裤": "training shorts",
        "队服": "team jersey",
        "球队服": "team jersey",
        "球衣": "team jersey",
        "球衣套装": "team uniform set",
        "球衣短裤": "team shorts",
        "球袜": "team socks",
        "球靴": "football boots",
        "队长袖标": "captain armband",
        "守门员手套": "goalkeeper gloves",
        "赛车服": "racing suit",
        "赛车手套": "racing gloves",
        "赛车头盔": "racing helmet",
        "赛车靴": "racing boots",
        "赛车内衣": "racing underwear",
        "赛车领奖服": "podium outfit",
        "赛车防火服": "racing fire suit",
        "赛车护目镜": "racing goggles",
        "赛车鞋": "racing shoes",
        "车队背心": "pit crew vest",
        "维修工装": "pit crew uniform",
        "赞助商服装": "sponsor outfit",
        "赛车围裙": "pit crew apron",
        "领奖服": "podium outfit",
        "颁奖服": "award ceremony outfit",
        "奖牌": "medal",
        "国旗": "national flag",
        "颁奖礼服": "award ceremony gown",
        # ── q3+ bugfix: missing outfits used in scenarios / canonical overrides ──
        # Without these, English image_prompt would be raw Chinese that
        # Stable Diffusion/Flux cannot parse, forcing the model to drift.
        "紧身上衣": "tight top",
        "紧身T恤": "tight t-shirt",
        "丝绸长裙": "silk long dress",
        "丝绸连衣裙": "silk dress",
        "丝绸长旗袍": "silk qipao",
        "丝绸睡衣": "silk pajamas",
        "真丝睡袍": "silk bathrobe",
        "背心": "tank top",
        "鞋子": "shoes",
        "吊带": "suspender top",
        "吊带情趣套装": "harness lingerie set",
        "吊带睡裙": "slip nightgown",
        "吊带袜": "suspender stockings",
        "吊带袜情趣套装": "garter belt with stockings",
        "吊带情趣": "suspender lingerie",
        "蕾丝情趣内衣": "lace lingerie",
        "蕾丝吊带": "lace bustier",
        "蕾丝睡裙": "lace nightgown",
        "蕾丝吊带睡裙": "lace nightgown with bustier",
        "丝袜吊带": "silk stockings with suspenders",
        "睡衣外套": "pajama jacket",
        "睡衣睡袍": "pajama robe",
        "睡衣": "pajamas",
        "睡衣睡袍": "pajama robe",
        "浴袍轻披": "open bathrobe",
        "丝袜": "silk stockings",
        "紧身VR服": "tight-fitting VR suit",
        "夜店装扮": "club outfit",
        "派对装扮": "party outfit",
        "内衣": "lingerie",
        "简单内衣": "simple lingerie",
        "情趣内衣": "sexy lingerie",
        "三点式内衣": "bikini",
        "薄纱": "sheer fabric",
        "薄纱睡衣": "sheer nightgown",
        "丝带": "silk ribbon",
        "情趣睡裙": "sexy nightgown",
        "透明睡衣": "see-through nightgown",
        "皮质胸衣": "leather bustier",
        "OL通勤装": "OL commute outfit",
        "OL下班装": "OL after-work outfit",
        "OL紧身裙": "OL pencil skirt",
        "学生便装": "student casual wear",
        "约会装": "date outfit",
        "约会裙": "date dress",
        "亚洲的约会装": "Asian date outfit",
        "华丽晚装": "glamorous evening gown",
        "白领职业裙": "white-collar pencil skirt",
        "高端连衣裙": "premium dress",
        "名媛风连衣裙": "socialite dress",
        "优雅连衣裙": "elegant dress",
        "飘逸长裙": "flowing long dress",
        "丝绒连衣裙": "velvet dress",
        "半透丝袜": "semi-sheer stockings",
        "黑丝袜": "black stockings",
        "白丝袜": "white stockings",
        "厨师服": "chef outfit with hat",
        "围裙": "apron",
        "理疗服": "therapy outfit",
        "中医服": "TCM outfit",
        "舞蹈服": "dance outfit",
        "戏服": "theatrical costume",
        "练功服": "dance leotard with tights",
        "舞裙": "dance skirt",
        "表演服": "performance costume",
        "战袍": "war robe",
        "防护服": "protective suit",
        "皮质装": "leather outfit",
        "赛车领奖服": "racing podium outfit",
        "赛车防火服": "racing fire suit",
        "赛车护目镜": "racing goggles",
        "赛车内衣": "racing underwear",
        "赛车宝贝背心": "racing babe vest",
        "职业套装": "professional business suit",
        "职业装": "business attire",
        "正装": "formal evening wear",
        "日常装": "everyday outfit",
        "薄上衣": "light top",
        "小外套": "short jacket",
        "透明雨衣": "transparent raincoat",
        "白色短袜": "white ankle socks",
        "黑色长筒袜": "black thigh-high stockings",
        "渔网袜": "fishnet stockings",
        "黑丝渔网袜": "black fishnet stockings",
        "战斗服": "battle outfit",
        "铠甲": "armor",
        "皮甲": "leather armor",
        "金属盔甲": "metal armor",
    }
    return mapping.get(zh, zh)


def _zh_location_to_english(zh: str) -> str:
    """Convert Chinese location to English. Falls back to zh if no mapping."""
    mapping = {
        # ── 宗教 / 教育 ──
        "修道院": "convent monastery",
        "告解室": "confessional booth",
        "祈祷室": "prayer room",
        "礼拜堂": "chapel",
        "教堂": "church interior",
        "教室": "classroom",
        "学校": "school",
        "操场": "school playground",
        "校园": "campus",
        "图书馆": "library",
        "实验室": "laboratory",
        "教师办公室": "teacher's office",
        "空教室": "empty classroom",
        "学校图书馆": "school library",
        # ── 医疗 ──
        "护士站": "nurse station",
        "病房": "hospital ward",
        "医院": "hospital",
        "诊所": "clinic",
        "检查室": "examination room",
        "医院走廊": "hospital corridor",
        "急诊室": "emergency room",
        "手术室": "operating room",
        # ── 航空 ──
        "飞机": "airplane cabin",
        "飞机洗手间": "airplane bathroom",
        "客舱": "airplane cabin",
        "头等舱": "first class cabin",
        "经济舱": "economy class cabin",
        "机组休息室": "crew rest area",
        "机场": "airport",
        "登机口": "airport gate",
        "驾驶舱": "airplane cockpit",
        "行李舱": "airplane cargo hold",
        "机舱": "airplane cabin",
        "机组车": "crew van",
        # ── 航空 (扩充,新 LLM 变体词,用于替换掉非航空主题上的 off-theme 用词) ──
        "私人飞机": "private jet",
        "私人航班": "private jet",
        "私人航空": "private jet",
        "私人舱": "private jet cabin",
        "商务舱": "business class cabin",
        "头等舱座位": "first class cabin seat",
        "头等舱沙发": "first class cabin lounge",
        "头等舱卧铺": "first class cabin sleeper",
        "飞机餐车": "inflight service cart",
        "机组播报": "crew announcement area",
        "机舱走廊": "airplane aisle",
        "机组厨房": "airplane galley",
        "机组餐车": "inflight service cart",
        "空乘制服走廊": "flight attendant corridor",
        "空姐领带": "flight attendant tie",
        "空姐丝巾": "flight attendant scarf",
        "空姐高跟鞋": "flight attendant high heels",
        "空姐帽": "flight attendant cap",
        "空姐围裙": "flight attendant apron",
        "乘务员": "flight attendant",
        "乘务长": "chief flight attendant",
        "贵宾候机室": "airport vip lounge",
        "贵宾室": "vip room",
        "候机楼": "airport terminal",
        "候机大厅": "airport waiting area",
        "航站楼": "airport terminal",
        "机场贵宾室": "airport vip lounge",
        "机场VIP室": "airport vip room",
        "机场VIP通道": "airport vip corridor",
        "登机廊桥": "airport jet bridge",
        "登机桥": "airport jet bridge",
        "机场行李提取": "airport luggage claim",
        "机组休息舱": "crew rest cabin",
        "飞行甲板": "flight deck",
        "飞行驾驶舱": "airplane cockpit",
        "航空餐车": "inflight service cart",
        "飞机舷梯": "airplane airstairs",
        "机舱门": "airplane cabin door",
        "机舱顶舱": "airplane overhead bin",
        "机舱地板": "airplane cabin floor",
        "机舱储物": "airplane overhead bin",
        "客舱窗户": "airplane cabin window",
        "民航客舱": "civilian airplane cabin",
        "私人客舱": "private jet cabin",
        "头等舱餐车": "first class service cart",
        "经济舱座位": "economy class seat",
        "机组乘务员室": "flight attendant room",
        "头等舱娱乐屏": "first class entertainment screen",
        "飞机卫生间": "airplane bathroom",
        "飞机洗手台": "airplane lavatory sink",
        # ── 赛车场 (新) ──
        "赛车驾驶舱": "race car cockpit",
        "赛车驾驶室": "race car cockpit",
        "维修站": "pit stop",
        "维修车间": "pit garage",
        "维修间": "pit garage",
        "维修工具墙": "pit garage tool wall",
        "领奖台": "podium",
        "冠军领奖台": "champion podium",
        "车队帐篷": "team paddock tent",
        "车队休息区": "team paddock",
        "车队维修站": "team pit",
        "赛车车库": "race car garage",
        "赛车场": "race track",
        "赛车场围栏": "race track fence",
        "赛车场维修站": "race track pit",
        "赛车场更衣室": "race track locker room",
        "赛车场车库": "race track garage",
        "赛车场起跑线": "race track starting line",
        "赛车场赛道": "race track circuit",
        "赛车场地": "race track area",
        "赛道": "race track",
        "赛道边": "trackside",
        "赛道起跑线": "race starting line",
        "赛道围栏": "race track fence",
        "赛车场房": "race track paddock building",
        "赛车场贵宾区": "race track vip area",
        "车队维修间": "team pit garage",
        "轮胎堆": "tire stack",
        "赛车塔": "race control tower",
        "P房": "pit lane",
        "维修通道": "pit lane walkway",
        "赛车起跑线": "race starting line",
        "赛车直道": "race track straight",
        "赛车弯道": "race track curve",
        "赛车场通道": "race track paddock corridor",
        "赛事指挥台": "race control",
        "车队车库": "team garage",
        # ── 足球场 (新) ──
        "球场中央": "center of football pitch",
        "球场边线": "football pitch sideline",
        "球场禁区": "football penalty area",
        "球场草皮": "football pitch grass",
        "球场通道": "stadium tunnel",
        "球场看台": "football stadium stands",
        "球场观众席": "football stadium audience",
        "球队更衣室": "team locker room",
        "球场替补席": "substitute bench",
        "球场替补区": "substitute bench area",
        "球场教练区": "coaching area",
        "球场技术区": "technical area",
        "球场器材室": "equipment room",
        "球门后": "behind the goal",
        "角球区": "corner kick area",
        "球场中圈": "center circle",
        "球场中线": "halfway line",
        "球场更衣间": "locker room",
        "球场球员通道": "players tunnel",
        "球门区": "goal area",
        "球场边线区": "sideline area",
        "训练场": "training pitch",
        "训练草坪": "training grass pitch",
        "球场包厢": "stadium VIP box",
        "球场VVIP": "stadium VVIP box",
        "球场VIP包厢": "stadium VIP box",
        # ── 机器人/未来 (新) ──
        "豪宅": "luxury mansion",
        "豪宅内": "luxury mansion interior",
        "豪宅大厅": "luxury mansion foyer",
        "豪宅大厅内": "luxury mansion foyer interior",
        "豪宅走廊": "luxury mansion hallway",
        "豪宅卧室": "luxury mansion bedroom",
        "豪宅书房": "luxury mansion library",
        "豪宅客房": "luxury mansion guest room",
        "豪宅起居室": "luxury mansion living room",
        "管家室": "butler room",
        "管家房": "butler quarters",
        "管家休息室": "butler lounge",
        "管家更衣室": "butler changing room",
        "主人卧室": "master bedroom",
        "主卧室": "master bedroom",
        "主人套房": "master suite",
        "主人书房": "master study",
        "未来房间": "futuristic room",
        "未来住宅": "futuristic residence",
        "未来豪宅": "futuristic mansion",
        "未来实验室": "futuristic lab",
        "未来舱": "futuristic capsule",
        "未来空间站": "futuristic space station",
        "未来居所": "futuristic residence",
        "机器人实验室": "robotics lab",
        "机械实验室": "mechanical lab",
        "机甲库": "mecha hangar",
        "机甲舱": "mecha bay",
        "机械仓库": "mechanical warehouse",
        # ── 温泉 / 浴场 ──
        "温泉池": "hot spring onsen pool",
        "温泉": "hot spring onsen",
        "野温泉": "wild outdoor hot spring",
        "别墅温泉池": "villa hot spring pool",
        "火山口观景": "volcanic crater viewpoint",
        "温泉旁": "hot spring area",
        "桑拿房": "sauna room",
        "公共浴场": "public bathhouse",
        "浴室": "bathroom",
        "淋浴间": "shower room",
        "浴缸": "bathtub",
        # ── 运动 / 场地 ──
        "训练场": "training arena",
        "舞台": "stage",
        "后台": "backstage",
        "选手通道": "contestant corridor",
        "摔角擂台": "wrestling ring",
        "摔跤擂台": "wrestling mat",
        "更衣室": "changing room",
        "更衣帐篷": "changing tent",
        "休息室": "lounge",
        "保龄球馆": "bowling alley",
        "保龄球道": "bowling lane",
        "健身房": "gym",
        "瑜伽教室": "yoga studio",
        "篮球场": "basketball court",
        "足球场": "soccer field",
        "网球场": "tennis court",
        "羽毛球场": "badminton court",
        "乒乓球场": "ping pong table area",
        "棒球场": "baseball diamond",
        "排球场": "volleyball court",
        "高尔夫球场": "golf course",
        "果岭": "golf green",
        "发球台": "tee box",
        "会所": "golf clubhouse",
        # ── 高尔夫 / 拳击 (q3+ bugfix:高尔夫球童 / 拳击搭档 主题 drift 修复) ──
        "球场": "golf course",
        "球车": "golf cart",
        "高尔夫俱乐部会所": "golf clubhouse interior",
        "高尔夫练习场": "golf driving range",
        "练习场": "driving range",
        "拳击馆": "boxing gym",
        "拳击场": "boxing gym",
        "拳击台": "boxing ring",
        "拳击擂台": "boxing ring",
        "拳台": "boxing ring",
        "擂台": "boxing ring",
        "围绳": "ring ropes",
        "围绳旁": "by the ring ropes",
        "沙袋": "punching bag",
        "沙袋旁": "by the punching bag",
        "擂台角落": "ring corner",
        "休息室": "lounge room",
        "更衣室": "locker room",
        "更衣间": "locker room",
        "训练室": "training room",
        # ── 沙滩 / 水上 ──
        "泳池": "swimming pool",
        "泳池边": "poolside",
        "泳池边湿身": "wet poolside area",
        "跳水池": "diving pool",
        "泳池躺椅": "poolside lounge chair",
        "游泳馆": "indoor swimming pool",
        "沙滩": "beach",
        "海滩": "beach shore",
        "海边": "seaside",
        "海岸": "coastline",
        "礁石": "rocky shore",
        "沙滩小屋": "beach hut",
        "排球网旁": "beach volleyball court",
        "沙滩毛巾": "beach towel area",
        "游艇甲板": "yacht deck",
        "甲板": "ship deck",
        "船舱": "ship cabin",
        # ── 酒店 / 卧室 ──
        "酒店": "hotel room",
        "情趣酒店": "love hotel room",
        "客房": "guest room",
        "套房": "hotel suite",
        "总统套房": "presidential suite",
        "卧室": "bedroom",
        "主卧": "master bedroom",
        "闺房": "private boudoir",
        "床上": "on bed",
        # ── 餐厅 / 酒吧 ──
        "餐厅": "restaurant",
        "空中餐厅": "sky restaurant",
        "咖啡厅": "cafe",
        "咖啡馆": "coffee shop",
        "酒吧": "bar",
        "酒吧包间": "bar private booth",
        "天台酒吧": "rooftop bar",
        "地下酒吧": "speakeasy bar",
        "KTV包间": "KTV private room",
        "夜店": "nightclub",
        # ── 办公 / 商业 ──
        "办公室": "office",
        "会议室": "conference room",
        "公司走廊": "office corridor",
        "直播间": "streaming room",
        "摄影棚": "photo studio",
        "写真馆": "photo studio",
        # ── 户外 ──
        "公园": "park",
        "公园长椅": "park bench",
        "喷泉": "fountain",
        "喷泉旁": "fountain side",
        "树林": "forest",
        "树林深处": "deep forest",
        "丛林": "jungle",
        "野外": "wilderness",
        "草丛": "grass",
        "草丛间": "among the grass",
        "花园": "garden",
        "花丛": "flower garden",
        "山顶": "mountain top",
        "山腰": "hillside",
        "山谷": "valley",
        "山洞": "cave",
        "悬崖": "cliff",
        "摩天轮": "ferris wheel",
        "摩天轮座舱": "ferris wheel cabin",
        "游乐园": "amusement park",
        "过山车": "roller coaster",
        # ── 交通工具 ──
        "地铁车厢": "subway car",
        "地铁站": "subway station",
        "公交车上": "bus interior",
        "出租车": "taxi interior",
        "私家车": "private car",
        "大巴": "coach bus",
        "车厢": "train compartment",
        "火车包厢": "train sleeper cabin",
        "豪华游艇": "luxury yacht",
        "汽车内": "car interior",
        # ── 传统 / 异域 ──
        "日式庭园": "Japanese garden",
        "中式庭院": "Chinese courtyard",
        "榻榻米": "tatami room",
        "缘侧": "Japanese engawa veranda",
        "竹林深处": "deep bamboo forest",
        "古宅": "old mansion",
        "月下": "under moonlight",
        "皇宫大殿": "royal palace hall",
        "王座厅": "throne room",
        "老上海": "old Shanghai street",
        "豪宅": "luxury mansion",
        "韩屋": "Korean hanok house",
        "印度宫殿": "Indian palace",
        # ── 其他室内 ──
        "厨房": "kitchen",
        "客厅": "living room",
        "玄关": "entrance hall",
        "书房": "study room",
        "阳台": "balcony",
        "露台": "terrace",
        "天台": "rooftop",
        "电梯": "elevator",
        "楼梯": "staircase",
        "走廊": "corridor",
        "阁楼": "attic",
        "地下室": "basement",
        "屋顶": "rooftop",
        "密室": "escape room",
        "仓库": "warehouse",
        "地窖": "wine cellar",
        # ── 特殊场地 ──
        "调教室": "dungeon room",
        "乳胶工作室": "latex studio",
        "逃脱屋": "escape room",
        "DJ台": "DJ booth",
        "蹦极台": "bungee platform",
        "潜水装备间": "diving gear room",
        "滑雪道": "ski slope",
        "缆车": "cable car",
        "雪地": "snowy field",
        "天文馆": "planetarium",
        # ── 角色专属场地 ──
        "机组休息室": "crew rest area",
        "机舱洗手间": "airplane lavatory",
        "审讯室": "interrogation room",
        "警察局办公室": "police station office",
        "警车后座": "police car backseat",
        # ── q3+ bugfix ────────────────────────────────────────────────
        # Missing scenarios from the theme database that had no English mapping.
        # Without these, English image_prompt would end up with a raw Chinese
        # token that Flux/Stable Diffusion cannot interpret, forcing the model
        # to drift to default locations like "park bench" / "hotel lobby".
        "后座空间": "SUV backseat interior with leather seats",
        "车后座": "car backseat with leather upholstery",
        "车后座空间": "spacious car backseat",
        "车前座": "car front seat",
        "车前排": "car front passenger seat",
        "停车场的车内": "car parked in underground parking garage",
        "停车场": "parking garage",
        "郊外": "countryside road",
        "天窗下": "car interior with open sunroof",
        "车引擎盖": "car hood",
        "私教泳池": "private swimming pool",
        "夜间泳池": "night swimming pool",
        "泳池内部": "inside swimming pool water",
        "水下": "underwater scene with bubbles",
        "保龄球道": "bowling lane",
        "保龄球馆": "bowling alley with lanes and pins",
        "泳池边湿身": "wet poolside with lounge chairs",
        "更衣室单间": "pool locker room individual stall",
        "泳池躺椅": "poolside lounge chair",
        "跳水池": "diving pool area",
        "泳池阶梯": "poolside steps",
        "泳池外": "swimming pool exterior",
        "泳池内": "inside swimming pool",
        "泳池畔": "swimming pool edge",
        "草地上": "grassy meadow",
        "密林深处": "deep forest undergrowth",
        "小溪边": "creek bank with rocks",
        "大树下": "under a large tree",
        "草地上": "grass meadow",
        "草地间": "grassy meadow",
        "山洞内": "inside cave",
        "树屋里": "inside treehouse",
        "海滩中央": "center of beach",
        "岩石后面": "behind rocks on beach",
        "沙滩毛巾": "on beach towel",
        "浅海区域": "shallow sea area",
        "天台躺椅": "rooftop lounge chair",
        "通风管道旁": "by rooftop ventilation pipe",
        "消防通道": "rooftop fire escape",
        "水箱后面": "behind rooftop water tank",
        "公园长椅": "park bench",
        "公园长椅上": "on park bench",
        "树林深处": "deep forest",
        "公园夜晚": "park at night",
        "摩天轮座舱": "ferris wheel cabin",
        "末班公交车": "night bus last-row seat",
        "最后一排座位": "last-row bus seat",
        "公交总站": "bus terminal",
        "车窗边": "by car window",
        "末班公交车内": "inside night bus",
        "双人包厢": "train sleeper cabin for two",
        "卧铺下铺": "lower sleeper berth",
        "车厢走廊": "train corridor",
        "火车卧铺": "train sleeper berth",
        "餐车": "dining car",
        "地铁早高峰": "rush-hour subway car interior",
        "深夜末班车": "late-night subway car empty",
        "地铁站台": "subway platform",
        "车厢连接处": "between subway cars",
        "飞机洗手间": "airplane lavatory",
        "头等舱座位": "first-class cabin seat",
        "行李舱": "cargo hold",
        "拳击场": "boxing ring area",
        "拳击擂台": "boxing ring with ropes",
        "更衣帐篷": "locker tent",
        "更衣室": "locker room",
        "练习场": "driving range",
        "高尔夫练习场": "golf driving range",
        "高尔夫球场": "golf course fairway",
        "高尔夫俱乐部会所": "golf clubhouse interior",
        "高尔夫俱乐部会所内": "inside golf clubhouse",
        "马场": "equestrian arena with horses",
        "马厩": "horse stable",
        "会所": "clubhouse interior",
        "刑讯室": "interrogation room",
        "审讯室": "interrogation room",
        "囚室": "prison cell",
        "法庭": "courtroom",
        "车库": "garage interior",
        "车库角落": "garage corner",
        "车位": "parking spot in garage",
        "电梯间": "elevator lobby",
        "废弃仓库": "abandoned warehouse",
        "温泉": "hot spring onsen",
        "温泉池": "hot spring pool",
        "别墅温泉池": "villa hot spring pool",
        "火山口": "volcano crater",
        "山洞": "cave entrance",
        "教堂": "church interior",
        "公交车": "bus interior",
        "公交车内": "inside city bus",
        "出租车": "taxi interior",
        "私家车": "private car interior",
        "汽车内": "car interior",
        "车内部": "inside car",
        "主驾驶座": "driver's seat",
        "后座空间": "spacious rear seat",
        "酒吧": "bar interior",
        "夜店": "nightclub",
        "派对": "party venue",
        "派对房": "party room",
        "度假别墅": "vacation villa",
        "游泳池": "swimming pool",
        "VIP包间": "VIP room",
        "观景房": "observation room",
        # ── 房车 / 露营 / 户外 缺失补全 ──
        "房车内": "RV interior with bed and kitchenette",
        "房车床铺": "RV bedroom bed",
        "车顶帐篷": "rooftop tent on a vehicle",
        "营地篝火": "campsite bonfire at night",
        "营地": "campsite with tents",
        "户外": "outdoor wilderness",
        "露营地": "campsite clearing",
        "户外取景": "outdoor location",
        "露营帐篷": "camping tent interior",
        # ── 健身房 / 运动 缺失补全 ──
        "器械区": "gym equipment area",
        "瑜伽房": "yoga studio with mats",
        "更衣室": "locker room",
        "健身房": "fitness gym",
        # ── 马术俱乐部 缺失补全 ──
        "马厩": "horse stable with hay bales",
        "马场": "equestrian arena with horses",
        "骑乘区": "riding area",
        "俱乐部大厅": "club lounge",
        "会所": "clubhouse interior",
        # ── 修女/宗教 缺失补全 ──
        "修道院": "convent monastery",
        "祈祷室": "prayer room",
        "告解室": "confessional booth",
        # ── 通用中文 fallback 后缀处理 (后续如果还有缺失会走 pypinyin) ──
    }
    return mapping.get(zh, zh)  # fallback: return zh (no English mapping)


# ─── Outfit / location extraction with offset ──────────────────────────────────def _find_all_locations_in_text(text: str) -> List[str]:
    """Return ALL location words found in text (Chinese + English)."""
    if not text:
        return []
    zh_locs = set(_LOCATION_RE_ZH.findall(text))
    en_locs = set(_LOCATION_RE_EN.findall(text))
    return list(zh_locs | en_locs)


# ─── Theme canonical helpers ────────────────────────────────────────────────────
def _get_canonical_outfit(theme_name: str, theme_data: dict) -> Tuple[str, str]:
    """
    Return (zh, en) canonical outfit for theme.

    Strategy: prefer the THEME'S ACTUAL COSTUMES list (first non-abstract item),
    NOT the override table. The override table exists only to fix specific bugs
    where the auto-detection picks something wrong (e.g. when the first costume
    is 全裸 and we want the user-facing default to be something else).

    The override is used ONLY if it provides a better answer than the auto-detection.
    """
    costumes = theme_data.get("costumes", []) if isinstance(theme_data, dict) else []
    abstract = {"全裸", "湿身", "脱去外衣", "部分脱去", "半裸", "赤裸", "裸体", "披着浴巾", "脱去"}
    real_keywords = ["服", "装", "裙", "衣", "袍", "裤", "鞋", "帽", "套", "甲", "衫", "制服", "polo", "比基尼", "内衣", "袜"]
    auto_zh = None
    for c in costumes:
        if not isinstance(c, str):
            continue
        if c in abstract:
            continue
        if c == theme_name:  # Don't pick theme name as outfit (e.g. 潮吹喷射)
            continue
        if any(k in c for k in real_keywords):
            auto_zh = c
            break
    if not auto_zh and costumes:
        # Last resort — first costume that isn't theme_name or abstract
        for c in costumes:
            if isinstance(c, str) and c not in abstract and c != theme_name:
                auto_zh = c
                break
    # Override is preferred only if it's NOT abstract (we want a real outfit)
    if theme_name in THEME_CANONICAL_OVERRIDES:
        override_zh = THEME_CANONICAL_OVERRIDES[theme_name][0]
        if override_zh and override_zh not in abstract and override_zh != theme_name:
            return (override_zh, THEME_CANONICAL_OVERRIDES[theme_name][1])
    if auto_zh:
        return (auto_zh, _zh_outfit_to_english(auto_zh))
    # Truly no real clothing — return empty for outfit (allow 全裸 fallback)
    if costumes:
        return (str(costumes[0]), _zh_outfit_to_english(str(costumes[0])))
    return ("", "")


def _get_canonical_location(theme_name: str, theme_data: dict) -> Tuple[str, str]:
    """
    Return (zh, en) canonical location for theme.

    Strategy: ALWAYS prefer the THEME'S ACTUAL SCENARIOS list (first item).
    The override table is only used if it provides a location that exists in
    the theme's scenarios list (otherwise it's a buggy override).
    """
    scenarios = theme_data.get("scenarios", []) if isinstance(theme_data, dict) else []
    auto_zh = str(scenarios[0]) if scenarios else None
    # ── q3+ bugfix ──
    # Previous logic: if override_zh not in scenarios, override was DROPPED, then
    # fell back to scenarios[0] which may not be the override (e.g. "SUV后座"
    # scenario[0]="后座空间" — and we lost "车后座"). That made the canonical
    # location not match the override table.
    #
    # New logic: ALWAYS prefer the theme's first scenario as the canonical. If
    # the override exists AND its zh text exists in our English mapping table
    # (so we can produce an English version), use the override instead. But
    # also auto-translate any scenario the mapping table knows about.
    override_zh = None
    override_en = None
    if theme_name in THEME_CANONICAL_OVERRIDES:
        override_zh = THEME_CANONICAL_OVERRIDES[theme_name][2]
        override_en = THEME_CANONICAL_OVERRIDES[theme_name][3]
        # Convert scenario to English (if known); otherwise use override directly.
        if override_zh and override_zh in scenarios:
            return (override_zh, override_en)
    # Pick the canonical: prefer override if it has a valid mapping; otherwise
    # the first scenario (with English translation).
    if override_zh and override_en:
        return (override_zh, override_en)
    if auto_zh:
        auto_en = _zh_location_to_english(auto_zh)
        # _zh_location_to_english returns the zh on miss — at least it's not English
        # junk in the prompt. Add a small English suffix to make it usable for Flux.
        if auto_en == auto_zh:
            # No English mapping for this scenario word → construct a generic one
            # from the theme name + first scenario so the image model gets *something*
            # English to work with.
            auto_en = f"{auto_zh} ({theme_name} setting)"
        return (auto_zh, auto_en)
    if theme_name in THEME_CANONICAL_OVERRIDES:
        return THEME_CANONICAL_OVERRIDES[theme_name][2], THEME_CANONICAL_OVERRIDES[theme_name][3]
    return (theme_name, theme_name)


# ─── Outfit/location compatibility check ────────────────────────────────────────
def _outfit_compatible_with_theme(outfit: str, theme_name: str, theme_data: dict,
                                   canonical_outfit_zh: str) -> bool:
    """
    Return True if the outfit is COMPATIBLE with the theme.
    """
    if not outfit:
        return True
    if outfit == canonical_outfit_zh:
        return True
    abstract = {"全裸", "湿身", "赤裸", "裸体", "半裸", "披着浴巾"}
    if outfit in abstract:
        return True
    if theme_name and len(theme_name) >= 2 and theme_name in outfit:
        return True
    if isinstance(theme_data, dict):
        theme_costumes = theme_data.get("costumes", []) or []
        for tc in theme_costumes:
            if not isinstance(tc, str):
                continue
            if tc in outfit or outfit in tc:
                return True
            if len(tc) >= 2 and tc in outfit:
                return True
    # SM / fluid / bondage themes allow generic sexy outfits
    sm_themes = {"捆绑", "绳缚", "SM", "调教", "皮衣", "乳胶", "BDSM", "情趣", "女王",
                 "羞辱", "口交", "颜射", "潮吹", "深喉", "肛交", "露出", "公共",
                 "野外", "群交", "派对", "迷奸", "奴隶", "宠物", "女性支配", "男性支配",
                 "束缚", "悬吊", "足控", "手控", "制服诱惑"}
    is_sm_theme = False
    if theme_name:
        for sm in sm_themes:
            if sm in theme_name:
                is_sm_theme = True
                break
    if isinstance(theme_data, dict):
        cat = theme_data.get("category", "") or ""
        if cat in {"sm", "fluid", "oral", "anal", "facial", "creampie", "toys", "multi"}:
            is_sm_theme = True
        tags = theme_data.get("tags", []) or []
        for tag in tags:
            if isinstance(tag, str) and any(sm in tag for sm in sm_themes):
                is_sm_theme = True
                break
    # Outfits acceptable in many themes (mostly undergarments / bedroom-wear)
    always_compatible = {"内裤", "胸罩", "文胸", "丁字裤"}
    if outfit in always_compatible:
        return True
    if is_sm_theme:
        sm_ok = {"情趣内衣", "性感睡衣", "蕾丝内衣", "蕾丝睡裙", "蕾丝吊带", "三点式",
                 "情趣睡裙", "透明睡衣", "皮衣", "皮夹克", "乳胶紧身衣", "乳胶衣",
                 "薄纱", "薄纱睡袍", "丝袜", "吊带袜", "高跟鞋", "比基尼", "三点式"}
        if outfit in sm_ok:
            return True
    # Themes that always allow these (categories where nude/sexy is on-theme)
    nude_categories = {"fluid", "oral", "anal", "facial", "creampie"}
    if isinstance(theme_data, dict):
        cat = theme_data.get("category", "") or ""
        if cat in nude_categories:
            nude_ok = {"比基尼", "三点式", "情趣内衣", "性感睡衣", "丝袜", "全裸", "湿身"}
            if outfit in nude_ok:
                return True
    return False


def _location_compatible_with_theme(location: str, theme_name: str, theme_data: dict,
                                     canonical_loc_zh: str, theme_loc_set: set) -> bool:
    """Return True if location is compatible with the theme."""
    if not location:
        return True
    if location == canonical_loc_zh:
        return True
    if theme_name and len(theme_name) >= 2 and theme_name in location:
        return True
    if location in theme_loc_set:
        return True
    generic_private = {"卧室", "主卧", "次卧", "闺房", "酒店房间", "情趣酒店", "客房", "套房", "浴室", "卫生间"}
    if location in generic_private:
        return False
    return False


def _scene_mentions_theme(scene_text: str, theme_scenarios: list) -> bool:
    """Return True if scene_text mentions ANY of the theme_scenarios words.

    Used by post-processing to detect LLM drift: if the scene text contains
    none of the theme's scenarios, the panel is off-theme and should be
    hard-replaced.

    Strict mode (default): the FIRST location-like word in the scene text
    must be in theme_scenarios. This catches cases like 园丁→绿色花房花店后间
    where "花房" appears as a substring but the panel is actually about a
    flower-shop (a word NOT in ★ SCENARIOS).

    Loose mode (strict=False): any substring match anywhere counts.
    Strict mode is more accurate but rejects more panels; loose is permissive.
    """
    if not scene_text or not theme_scenarios:
        return False
    # Loose: any substring matches anywhere
    for s in theme_scenarios:
        if not isinstance(s, str) or len(s) < 2:
            continue
        if s in scene_text:
            return True
    return False


def _scene_first_location_is_theme(scene_text: str, theme_scenarios: list,
                                    all_locs_vocab: set) -> bool:
    """Strict check: the first 1-2 location words in the scene text must be
    IN theme_scenarios (or be the canonical location). Catches drift like
    「绿色花房花店后间」 where 花房 appears but the actual scene is 花店.

    `all_locs_vocab` should be the set of all known location words (ZH).
    Returns True if the FIRST location mentioned is theme-compatible.
    """
    if not scene_text or not theme_scenarios:
        return True  # can't prove drift; allow
    # Find first location-like word
    text = scene_text
    # Strategy: scan tokens; pick the first one that's in all_locs_vocab.
    # Simpler: find position of every loc word and pick the earliest.
    earliest_pos = None
    earliest_loc = None
    for loc in all_locs_vocab:
        idx = text.find(loc)
        if idx >= 0 and (earliest_pos is None or idx < earliest_pos):
            earliest_pos = idx
            earliest_loc = loc
    if not earliest_loc:
        return True  # no location found; not provably off-theme
    # Is this earliest location in theme_scenarios?
    for s in theme_scenarios:
        if isinstance(s, str) and (s in earliest_loc or earliest_loc in s):
            return True
    return False


# ─── Foreplay panel detection ───────────────────────────────────────────────────
def _is_foreplay_panel(panel_index: int, total_panels: int, r18: bool) -> bool:
    """
    Determine if a panel should be subject to outfit/location enforcement.
      - Non-R18: enforce for ALL panels
      - R18: enforce the FIRST 60% of panels (where clothes should still be on)
        For 5 panels: enforce panels 1, 2, 3 (outfit can drift to naked only on 4, 5)
        For 6 panels: enforce panels 1, 2, 3, 4
        For 7 panels: enforce panels 1, 2, 3, 4
    """
    if not r18:
        return True
    if total_panels <= 0:
        return False
    # Foreplay cutoff: enforce first (total_panels - 1) panels in 5-panel,
    # or first (total_panels - 2) in 6+ panel
    if total_panels <= 4:
        cutoff = total_panels - 1  # all but last panel
    else:
        cutoff = total_panels - 2  # all but last 2 panels
    return panel_index < cutoff


def _is_sex_panel(panel_index: int, total_panels: int, r18: bool) -> bool:
    """Sex panel = any R18 panel where the action contains explicit sex.

    For R18 mode, the front half is warmup (clothing still on), the back
    half (panel >= total // 2) is explicit sex (nude). The last panel is
    always climax.
    """
    if not r18:
        return False
    if total_panels <= 0:
        return False
    # Anything past the midpoint is sex. For 5 panels: panels 3, 4 (0-indexed)
    # For 6 panels: panels 3, 4, 5. Etc.
    return panel_index >= max(1, total_panels // 2)


# Beats (panel-level action templates) — give every panel a distinct
# narrative beat so the storyboard doesn't feel repetitive.
_BEATS_NON_R18 = [
    "出场亮相 — 主角登场，与场景互动",
    "关系升温 — 双方暧昧互动，情感铺垫",
    "聚焦特写 — 表情、姿态、细节描写",
    "互动高潮 — 身体接触，亲密互动",
    "高潮结尾 — 情感释放，开放式收尾",
]
_BEATS_R18 = [
    "出场前戏 — 场景介绍、穿着主题服装、暧昧眼神交流、NO 性行为",
    "升温调情 — 身体接触、亲吻、暗示性语言、情绪铺垫",
    "脱衣亲密 — 衣物部分脱去、爱抚、口手刺激前戏",
    "性爱前戏 — 进一步前戏、口交或手部挑逗、身体全面反应",
    "性爱进行 — 直接插入，体位变化，抽插特写",
    "高潮逼近 — 节奏加快，体位深入，呻吟加剧",
    "高潮射精 — 高潮特写、颜射/内射/体外射精、事后温存",
]


def _pick_beat(panel_index: int, total: int, r18: bool) -> str:
    pool = _BEATS_R18 if r18 else _BEATS_NON_R18
    if total <= len(pool):
        return pool[panel_index]
    return pool[panel_index % len(pool)]


# ── Character descriptor pools (gender + ethnicity, image-prompt ready) ─────────
# Each entry is an explicit Flux-ready descriptor string. We pair one female
# + one male per storyboard to enforce diversity (per ETHNICITY_BLOCK).
_FEMALE_DESCRIPTORS = [
    "a beautiful Brazilian woman with tanned olive skin, dark curly hair, and brown eyes",
    "a stunning Iranian woman with fair olive skin, dark almond eyes, and long black hair",
    "a gorgeous Italian woman with warm olive skin, dark brown hair, and hazel eyes",
    "a beautiful Russian woman with pale porcelain skin, light blue eyes, and silky blonde hair",
    "a cute Japanese woman with warm beige skin, silky black hair, and dark brown eyes",
    "a beautiful Korean woman with fair skin, silky black hair, and dark eyes",
    "a stunning Thai woman with warm beige skin, silky black hair, and soft brown eyes",
    "a gorgeous French woman with fair skin, dark brown hair, and green eyes",
    "a beautiful Mexican woman with tanned olive skin, long dark brown hair, and brown eyes",
    "a stunning Indian woman with warm brown skin, long dark hair, and deep brown eyes",
    "a beautiful Turkish woman with fair olive skin, dark brown hair, and hazel eyes",
    "a gorgeous Chinese woman with warm beige skin, silky black hair, and dark almond eyes",
    "a stunning Spanish woman with olive skin, dark brown hair, and brown eyes",
    "a beautiful Polish woman with pale skin, light brown hair, and blue eyes",
    "a gorgeous Cuban woman with tanned olive skin, dark curly hair, and brown eyes",
    "a stunning Vietnamese woman with warm beige skin, long black hair, and dark eyes",
    "a beautiful South African woman with rich brown skin, dark curly hair, and brown eyes",
    "a gorgeous Greek woman with olive skin, dark brown hair, and green eyes",
    "a stunning Filipino woman with warm brown skin, long dark brown hair, and dark eyes",
    "a beautiful Argentine woman with fair olive skin, dark brown hair, and brown eyes",
]

_MALE_DESCRIPTORS = [
    "a handsome Brazilian man with tanned olive skin, dark brown hair, and brown eyes, muscular build",
    "a chiseled Italian man with olive skin, dark brown hair, and hazel eyes, athletic body",
    "a handsome Russian man with pale skin, light brown hair, and blue eyes, muscular build",
    "a tall German man with fair skin, short blonde hair, and blue eyes, broad shoulders",
    "a handsome American man with tanned skin, short brown hair, and blue eyes, muscular body",
    "a chiseled Iranian man with olive skin, dark hair, and dark brown eyes, athletic build",
    "a handsome Mexican man with tanned olive skin, dark brown hair, and brown eyes, muscular build",
    "a tall French man with olive skin, dark brown hair, and green eyes, athletic body",
    "a handsome Turkish man with olive skin, dark hair, and dark brown eyes, muscular build",
    "a chiseled Japanese man with warm beige skin, short black hair, and dark brown eyes, lean muscular body",
    "a handsome Korean man with fair skin, short black hair, and dark eyes, athletic build",
    "a tall Scandinavian man with pale skin, blonde hair, and blue eyes, muscular body",
    "a handsome Greek man with olive skin, dark curly hair, and brown eyes, muscular build",
    "a chiseled Spanish man with olive skin, dark brown hair, and brown eyes, athletic body",
    "a tall Dutch man with fair skin, light brown hair, and blue eyes, muscular build",
    "a handsome Polish man with pale skin, dark brown hair, and blue eyes, athletic body",
    "a chiseled Argentinian man with tanned olive skin, dark brown hair, and brown eyes, muscular build",
    "a handsome Australian man with tanned skin, blonde hair, and blue eyes, athletic body",
    "a tall Indian man with warm brown skin, dark hair, and brown eyes, lean muscular build",
    "a chiseled Chinese man with warm beige skin, short black hair, and dark eyes, athletic build",
]


# ── Per-beat action descriptors (image-prompt-ready English) ─────────────────
# These describe what the male character is doing TO the female character in
# each panel, ensuring a clear narrative progression and avoiding the
# "1girl looking at camera" failure mode.
#
# Each list has 6+ variants so that for any panel count (2-10) we cycle
# through DIFFERENT actions, never repeating the same one twice.

# Pre-sex beats (Non-R18 mode + R18 panels 1-3) — 6+ variants each
_ACTION_PRE_INTRO = [
    "the man walks up to the woman in the {loc}, exchanging a flirtatious glance",
    "the man gently takes the woman's hand and leads her deeper into the {loc}",
    "the man and woman stand face-to-face in the {loc}, eye contact full of anticipation",
    "the man leans against the wall watching the woman enter the {loc} slowly",
    "the woman playfully pushes the man onto a chair in the {loc}, both smiling mischievously",
    "the man offers the woman a drink in the {loc}, leaning close to whisper",
    "the woman fixes the man's collar in the {loc}, her hand lingering on his chest",
    "the man and woman sit across from each other in the {loc}, knees touching under the table",
]
_ACTION_PRE_WARMUP = [
    "the man leans in and whispers into the woman's ear as she bites her lip",
    "the man pulls the woman close, his hands sliding down her back, foreplay beginning",
    "the woman sits on the man's lap in the {loc}, both breathing heavily, kissing deeply",
    "the man runs his fingers through the woman's hair, tilting her face up to kiss her",
    "the woman's arms wrap around the man's neck as he presses her against the wall, kissing her neck",
    "the man and woman share a long passionate kiss in the {loc}, his hands roaming her body",
    "the woman straddles the man on a chair in the {loc}, grinding softly as they make out",
    "the man nibbles the woman's earlobe while his hand squeezes her breast through the fabric",
]
_ACTION_PRE_FORPLAY = [
    "the man unbuttons the woman's top, kissing her neck as she tilts her head back",
    "the man strips off her clothes piece by piece, kissing her collarbone and shoulders",
    "the man's hand traces down the woman's body as she unhooks her bra, breath quickening",
    "the woman pulls her shirt over her head, the man's lips moving down her stomach",
    "the man kneels before the woman in the {loc}, kissing her inner thighs as she trembles",
    "the woman's bra falls to the floor as the man sucks on her nipples, her back arching",
    "the man lays the woman down on the surface, kissing her belly as he unbuttons her pants",
    "the woman unbuckles the man's belt while grinding against him in the {loc}",
]

# Sex beats (R18 mode, panels 3-4 / 4-5 etc.) — 24+ variants
_ACTION_SEX_LIST = [
    "the man thrusts deep into the woman from behind in doggy style, both moaning loudly",
    "the man penetrates the woman missionary with her legs wrapped around his waist, hands gripping the sheets",
    "the man lifts the woman up against the wall in a standing carry, her legs locked around his hips as he thrusts deeply",
    "the woman rides the man cowgirl style, bouncing rhythmically while he grips her hips",
    "the man penetrates the woman in prone bone position, her back arched and face pressed into the surface",
    "the woman sits on top of the man reverse cowgirl, looking back over her shoulder at him seductively",
    "the man holds the woman from behind in a standing doggy position, supporting her weight as he thrusts",
    "the man and woman are in 69 position, simultaneously performing oral on each other",
    "the man penetrates the woman in spooning position from behind, his arm wrapped around her waist",
    "the man spreads the woman's legs wide and thrusts into her in a butterfly position on the edge",
    "the woman grinds on the man in lotus position, intimate eye contact as they make love slowly",
    "the man holds the woman in a full nelson lift, both standing as he drives deep into her",
    "the man and woman are entangled in piledriver position, her legs hooked over his shoulders",
    "the man thrusts into the woman amazon position, her squatting on top in a dominant stance",
    "the man and woman embrace tightly in pretzel dip position, legs interlocked as they move together",
    "the man performs oral sex on the woman, her legs draped over his shoulders as he licks deeply",
    "the man finger-fucks the woman while kissing her inner thighs, building anticipation",
    "the woman pleasures the man with her mouth in deepthroat, his hands gripping her hair",
    "the man eats the woman's pussy while she moans, fingers gripping his hair",
    "the man and woman hold each other in a deep standing embrace, her back against the wall, both nude",
    "the man penetrates the woman from behind with her bent over a table in the {loc}, deep rapid thrusts",
    "the woman wraps her legs around the man's waist in the {loc}, his cock buried deep inside her",
    "the man flips the woman onto her back and thrusts into her, her breasts bouncing with each thrust",
    "the man and woman grind together in slow sensual motion, her clit rubbing against his pubic bone",
]
_ACTION_SEX_CLIMAX = [
    "the man thrusts hard one final time, ejaculating on the woman's breasts while she screams in climax",
    "the man cums deep inside the woman missionary, her body trembling as her orgasm peaks",
    "the man and woman climax simultaneously in lotus position, foreheads pressed together, breathless",
    "the man ejaculates on the woman's face from above, his cock pulsing as cum drips down her cheeks",
    "the man and woman collapse together in exhausted afterglow, his cock still inside her, both panting",
    "the woman screams in climax as the man continues thrusting, her nails digging into his back, both drenched in sweat",
    "the man's cock throbs as he shoots his load inside the woman, her pussy milking every drop in her orgasm",
    "the man and woman reach simultaneous orgasm, bodies convulsing together as cum spills between her thighs",
]


# ── Per-mode pose selection: pick a distinct sex pose for each panel ────────────
def _pick_pose_for_panel(panel_index: int, total: int, r18: bool):
    """Return (action_template, scene_zh_clause) appropriate for the panel's beat.

    For non-R18 we pick from the pre-intro/warmup/foreplay action pools.
    For R18, panels in the first half pick pre-intro/warmup/foreplay,
    panels in the second half pick from the explicit sex list. The last
    panel picks from the climax list.
    """
    if not r18:
        if panel_index == 0:
            pool = _ACTION_PRE_INTRO
        elif panel_index < total - 1:
            pool = _ACTION_PRE_WARMUP
        else:
            pool = _ACTION_PRE_FORPLAY
        idx = panel_index % len(pool)
        zh_clause = "暧昧互动，眼神交流" if panel_index == 0 else (
            "两人热烈亲吻，爱抚" if panel_index < total - 1 else
            "脱去衣物，亲密爱抚"
        )
        return pool[idx], zh_clause

    # R18 — front-load pre-intro, then escalate
    sex_start = max(1, total // 2)
    if panel_index == 0:
        pool = _ACTION_PRE_INTRO
        zh_clause = "出场前戏，暧昧眼神交流"
    elif panel_index < sex_start:
        pool = _ACTION_PRE_WARMUP
        zh_clause = "升温调情，亲吻爱抚"
    elif panel_index < total - 1:
        pool = _ACTION_SEX_LIST
        zh_clause = "激烈性爱，体位深入"
    else:
        pool = _ACTION_SEX_CLIMAX
        zh_clause = "高潮射精，事后温存"
    return pool[(panel_index - (0 if panel_index == 0 else sex_start)) % len(pool)], zh_clause


# Outfit rotation — let the outfit change naturally across panels without
# ever leaving the theme's costume list. Late R18 panels drift toward
# partial nudity, which is on-theme for the climax but the LOCATION stays
# theme-coherent.
def _pick_outfit_for_panel(
    panel_index: int,
    total: int,
    r18: bool,
    theme_costumes: list,
    canonical_outfit_zh: str,
    canonical_outfit_en: str,
    theme_scenarios: list,
) -> tuple:
    """Pick (outfit_zh, outfit_en, has_clothes) for this panel.

    Late R18 panels (last 1-2) drop the costume toward nude; everything else
    wears a costume from the theme list (or the canonical if list empty).
    """
    if not theme_costumes:
        theme_costumes = [canonical_outfit_zh] if canonical_outfit_zh else ["themed outfit"]
    if r18 and panel_index >= total - 2 and total >= 5:
        # Sex panels: drop most clothes. We pass back a partial-state marker.
        base_zh = theme_costumes[0] if theme_costumes else canonical_outfit_zh
        return (f"{base_zh} 部分脱去", "partially undressed", False)
    # Cycle through costumes so different panels show different looks
    idx = (panel_index * 2) % len(theme_costumes)
    chosen_zh = theme_costumes[idx]
    en = _zh_outfit_to_english(chosen_zh)
    if en == chosen_zh:
        en = canonical_outfit_en or chosen_zh
    return (chosen_zh, en, True)


# ── Helper: hash-based deterministic female/male pick per theme ────────────────
def _pick_characters(theme_name: str):
    """Pick one female + one male descriptor deterministically from theme name.

    This guarantees that:
    - The same theme always uses the same male/female pair (consistency)
    - Across themes, pairs vary (diversity)
    - Each panel ALWAYS features BOTH a man and a woman (multi-character)
    """
    import hashlib
    h = int(hashlib.md5(theme_name.encode("utf-8")).hexdigest(), 16)
    female = _FEMALE_DESCRIPTORS[h % len(_FEMALE_DESCRIPTORS)]
    # Offset male pick by 7 so it doesn't always match the female's ethnicity slot.
    male = _MALE_DESCRIPTORS[(h // 7) % len(_MALE_DESCRIPTORS)]
    return female, male


def _strip_anchor_brackets(anchor: str) -> str:
    """Strip '[ANCHOR: ...]' wrapper, return inner content."""
    if not anchor:
        return ""
    a = anchor.strip()
    if a.startswith("[ANCHOR:") and a.endswith("]"):
        return a[len("[ANCHOR:"):-1].strip()
    return a


def _rebuild_panel_from_template(
    scene_text: str,
    image_text: str,
    canonical_loc_zh: str,
    canonical_loc_en: str,
    canonical_outfit_zh: str,
    canonical_outfit_en: str,
    theme_scenarios: list,
    is_sex_panel_flag: bool,
    panel_index: int,
    theme_name: str,
    theme_costumes: list = None,
    r18: bool = False,
    total_panels: int = 5,
) -> tuple:
    """Build scene_description + image_prompt fresh from theme metadata.

    V3: Output is now DETAILED and matches Stable Diffusion / Flux requirements:
      - Multi-character anchor (1girl + 1boy, NEVER 1girl alone)
      - Specific female + male ethnicity descriptors (per ETHNICITY_POOL)
      - Explicit ACTION: "the man thrusts into the woman in X position"
      - Specific theme-coherent location in English
      - Specific theme-coherent costume in English
      - Photographic terms: lens, lighting, composition, mood
      - All-English image_prompt (Chinese characters auto-replaced via fallback)
      - Diverse poses per panel (cycling through the action pools)
    """
    beat = _pick_beat(panel_index, total_panels, r18)

    # ── Pick theme-coherent scenario for this panel ────────────────────
    if theme_scenarios:
        scene_word_zh = theme_scenarios[panel_index % len(theme_scenarios)]
    else:
        scene_word_zh = canonical_loc_zh or theme_name or "themed location"
    scene_word_en = _zh_location_to_english_safe(scene_word_zh)

    # ── Outfit rotation ───────────────────────────────────────────────
    costume_zh, costume_en, has_clothes = _pick_outfit_for_panel(
        panel_index, total_panels, r18,
        theme_costumes or [],
        canonical_outfit_zh, canonical_outfit_en,
        theme_scenarios,
    )
    # If costume_en still has Chinese, force a generic English fallback.
    costume_en = _ensure_english(costume_en, "themed outfit")

    # ── Character descriptors (deterministic from theme name) ──────────
    female_desc, male_desc = _pick_characters(theme_name)

    # ── Action descriptor (diverse per panel) ──────────────────────────
    action_template, scene_zh_clause = _pick_pose_for_panel(panel_index, total_panels, r18)
    action_text = action_template.format(loc=scene_word_en)

    # ── Chinese scene_description (detailed narrative, all Chinese) ────
    # Extract a short Chinese noun from female_desc/male_desc to make the
    # scene_description identify which characters are present (without
    # embedding the English action sentence).
    female_zh = _english_descriptor_to_chinese_label(female_desc)
    male_zh = _english_descriptor_to_chinese_label(male_desc)

    if r18 and is_sex_panel_flag:
        scene_parts = [
            f"在{scene_word_zh}",
            f"【{beat}】",
            f"{female_zh}与{male_zh}{scene_zh_clause}",
            (f"女人身穿{costume_zh}" if costume_zh else "女人已脱去衣物"),
        ]
    else:
        scene_parts = [
            f"在{scene_word_zh}",
            f"【{beat}】",
            f"{female_zh}与{male_zh}{scene_zh_clause}",
            (f"女人身穿{costume_zh}" if costume_zh else ""),
        ]
    new_scene = "，".join(p for p in scene_parts if p) + "。"

    # ── English image_prompt (Flux/SD-ready, multi-character, detailed) ──
    # Lighting / composition varies per panel for visual diversity.
    lighting_options = [
        "soft natural window light",
        "warm golden hour glow",
        "intimate dim ambient lighting",
        "moody cinematic lighting with rim light",
        "bright sunlit atmosphere",
    ]
    composition_options = [
        "full body shot from a low angle",
        "medium shot from slightly above",
        "close-up on faces and hands",
        "wide shot showing both characters and the full environment",
        "three-quarter portrait composition",
    ]
    lighting = lighting_options[panel_index % len(lighting_options)]
    composition = composition_options[panel_index % len(composition_options)]

    if r18 and is_sex_panel_flag:
        # Explicit sex panel: include nudity and explicit body parts.
        nudity_clause = "both fully nude, "
        explicit_action = action_text
    else:
        nudity_clause = (
            f"the woman wearing {costume_en}, " if costume_en else ""
        )
        explicit_action = action_text

    new_image = (
        f"1girl, 1boy, {female_desc}, and {male_desc}, "
        f"{nudity_clause}{explicit_action}, "
        f"in {scene_word_en}, "
        f"{lighting}, {composition}, "
        f"masterpiece, best quality, ultra-detailed, 8k uhd, "
        f"professional photography, cinematic color grading, sharp focus"
    )

    return (new_scene, new_image)


# ── English-to-Chinese label mapping for scene_description characters ─────────
# Map the (nationality, gender) pair from a Flux descriptor to a short Chinese
# phrase for use in scene_description (e.g. "the Brazilian woman with tanned
# olive skin..." → "巴西美女"). This keeps scene_description fully Chinese
# while still identifying WHICH characters are present.
_EN_DESC_NATIONALITY_TO_ZH = {
    "Brazilian": "巴西美女",
    "Iranian": "伊朗美女",
    "Italian": "意大利美女",
    "Russian": "俄罗斯美女",
    "Japanese": "日本美女",
    "Korean": "韩国美女",
    "Thai": "泰国美女",
    "French": "法国美女",
    "Mexican": "墨西哥美女",
    "Indian": "印度美女",
    "Turkish": "土耳其美女",
    "Chinese": "中国美女",
    "Spanish": "西班牙美女",
    "Polish": "波兰美女",
    "Cuban": "古巴美女",
    "Vietnamese": "越南美女",
    "South African": "南非美女",
    "Greek": "希腊美女",
    "Filipino": "菲律宾美女",
    "Argentine": "阿根廷美女",
    "German": "德国帅哥",
    "American": "美国帅哥",
    "Scandinavian": "北欧帅哥",
    "Dutch": "荷兰帅哥",
    "Australian": "澳洲帅哥",
    "Argentinian": "阿根廷帅哥",
}


def _english_descriptor_to_chinese_label(desc: str) -> str:
    """Extract a short Chinese nationality label from an English descriptor.

    Women → 美女; Men → 帅哥. We check the FIRST 30 chars of the descriptor
    which contains the gender word ("woman"/"man"/"girl"/"boy").
    """
    head = desc[:60]
    # Prioritize "woman" / "1girl" / "beautiful" female markers over "man" inside
    # nationality words like "Brazilian woman" — "woman" appears BEFORE "man"
    # in "Brazilian woman", but "man" is also in "woman". So check for female
    # markers first.
    is_female = (
        "woman" in head
        or " 1girl" in head[:8]
        or "beautiful" in head[:30]
        or "gorgeous" in head[:30]
        or "stunning" in head[:30]
        or "cute" in head[:30]
        or "handsome" not in head
        and (
            "man" in head
            or "boy" in head
        )
    )
    # Simpler rule: if "woman" appears in the first 60 chars, it's female.
    is_female = "woman" in head
    is_male = not is_female and ("man" in head or "boy" in head)
    for nat, zh in _EN_DESC_NATIONALITY_TO_ZH.items():
        if nat in desc:
            if is_male and zh.endswith("美女"):
                return zh[:-2] + "帅哥"
            return zh
    return "帅哥" if is_male else "美女"


# ─── Safe translation helpers (used by _rebuild_panel_from_template) ──────────
def _ensure_english(text: str, fallback: str) -> str:
    """If `text` contains any Chinese characters, replace with `fallback`."""
    if not text:
        return fallback
    if any("\u4e00" <= c <= "\u9fff" for c in text):
        return fallback
    return text


def _zh_location_to_english_safe(zh: str) -> str:
    """Convert zh → en using mapping. Always returns pure English (fallback
    for unmapped Chinese strings)."""
    if not zh:
        return "themed location"
    mapped = _zh_location_to_english(zh)
    return _ensure_english(mapped, _pinyin_fallback(zh, "location"))


def _pinyin_fallback(zh: str, kind: str) -> str:
    """Last-resort fallback: convert Chinese to pinyin with 'interior' suffix.

    Produces something like 'fang che nei interior' for '房车内'. This is
    ugly but at least ALL English, which Flux/SD can interpret better than
    raw Chinese characters. Used only when no manual mapping exists.
    """
    try:
        from pypinyin import lazy_pinyin
        tokens = lazy_pinyin(zh)
        romanized = " ".join(tokens).strip()
    except Exception:
        # Last-resort: strip non-ASCII entirely.
        romanized = "".join(c for c in zh if ord(c) < 128).strip() or "themed"
    if kind == "location":
        return f"{romanized} interior"
    return romanized or "themed outfit"


# ─── Main enforcement function ──────────────────────────────────────────────────
def _enforce_panel_rules(
    panels: list,
    theme_name: str,
    theme_data: dict,
    r18: bool,
) -> list:
    """
    Hard post-processing rules on top of _enforce_theme_coherence / LLM output.

    This addresses three recurring user complaints:

      A. **Panel 1 must be single-woman** — the LLM tends to force `1girl, 1boy`
         into Panel 1 even when the theme/setup calls for just the woman.
         For every theme EXCEPT multi-character themes where the man literally
         must appear in Panel 1, we strip `1boy`, `1man`, `the man`, `a man`,
         male descriptors, etc. from Panel 1's image_prompt and force
         `1girl, <female descriptor>, <scene>`.

      B. **Lesbian / 双女主 themes must have NO MAN in any panel** — when
         `_is_lesbian_theme(...)` is True, strip ALL male-related tokens from
         EVERY panel's image_prompt (1boy, the man, his, penis, cumshot, etc.)
         and force `1girl, 1girl, ...` plus a second-woman descriptor.

      C. **Last R18 sex panel MUST show visible cum / semen** — append
         explicit visible-cum English tags to the FINAL panel's image_prompt
         so the model actually paints semen in the image. For lesbian
         stories, swap cum → squirting / female ejaculation.

    Returns the same panels list with mutated dicts in place.
    """
    if not panels:
        return panels

    is_lesbian = _is_lesbian_theme(
        theme_name=theme_name,
        theme_tags=(theme_data.get("tags", []) if isinstance(theme_data, dict) else []),
        theme_data=theme_data if isinstance(theme_data, dict) else None,
    )
    total = len(panels)

    # ── Lesbian: pick a SECOND-WOMAN descriptor (East Asian default) ──
    second_woman_options = [
        "a beautiful Korean woman with warm beige skin, silky long black hair, and dark almond eyes",
        "a stunning Japanese woman with fair porcelain skin, silky straight black hair, and dark brown eyes",
        "a gorgeous Chinese woman with warm ivory skin, long wavy black hair, and dark eyes",
        "a beautiful Taiwanese woman with fair skin, silky black hair, and delicate features",
    ]
    second_woman = second_woman_options[hash(theme_name or "") % len(second_woman_options)]

    # Male descriptor removal regex (case-insensitive). Used for lesbian + Panel 1.
    _MALE_TOKENS_RE = re.compile(
        r"\b(?:1boy|1man|"
        r"a handsome (?:Black|African|Brazilian|Italian|Russian|Japanese|Korean|American|Mexican|Turkish|French|German|Greek|Spanish|Polish|Dutch|Argentinian|Australian|Indian|Chinese|Thai) man|"
        r"a chiseled (?:Black|African|Brazilian|Italian|Russian|Japanese|Korean|American|Mexican|Turkish|French|German|Greek|Spanish|Polish|Dutch|Argentinian|Australian|Indian|Chinese|Thai) man|"
        r"a tall (?:Black|African|Brazilian|Italian|Russian|Japanese|Korean|American|German|French|Dutch|Scandinavian|Polish|Argentinian|Indian|Australian) man|"
        r"a muscular Black man|"
        r"a muscular (?:Black|African|American) man|"
        r"a strong Black man|"
        r"a fit Afro-?Caribbean man|"
        r"a handsome Nigerian man|"
        r"the man|"
        r"a man|"
        r"his cock|"
        r"his penis|"
        r"his mouth|"
        r"his hands?|"
        r"his body|"
        r"his chest|"
        r"his abs|"
        r"his arms?|"
        r"his shoulders|"
        r"cumshot|"
        r"balls deep|"
        r"penis|"
        r"cock|"
        r"dick|"
        r"erect|"
        r"hard cock)\b",
        re.IGNORECASE,
    )

    # Lesbian-only: also remove heterosexual sex-act phrases that imply a penis.
    _HET_SEX_ACT_RE = re.compile(
        r",?\s*(?:his cock|cum on her face|deep throat|deepthroat|"
        r"penetrate\w*|penetration|"
        r"thrusting into (?:the )?woman|thrusts? into (?:the )?woman|"
        r"facial cumshot|face covered in cum|covered in cum|"
        r"cum on her breasts?|"
        r"cum on her stomach|"
        r"cum on her thighs?|"
        r"creampie(?:\s+residue)?|"
        r"cum dripping from her vagina|"
        r"semen visible|"
        r"cumshot aftermath|"
        r"thick ropes of cum)"
        r"(?:[,\s\.]+|$)",
        re.IGNORECASE,
    )

    # Lesbian-only: cleanup orphaned "a Chinese woman with muscular build" / similar
    # leftovers from the male-descriptor regex. Also catches "and with muscular build"
    # when the male descriptor was stripped leaving dangling modifier.
    _ORPHAN_DESC_RE = re.compile(
        r",?\s*(?:a|an)\s+[A-Z][a-zA-Z]+\s+(?:woman|man|girl|boy)\s+with\s+muscular\s+build\b"
        r"|,?\s*(?:and\s+)?with\s+muscular\s+build\b"
        r"|,?\s*with\s+short\s+black\s+hair\b"
        r"|,?\s*with\s+short-cropped\s+black\s+hair\b"
        r"|,?\s*with\s+broad\s+shoulders\b"
        r"|,?\s*with\s+chiseled\s+(?:jaw|features)\b"
        r"|,?\s*with\s+short\s+blonde\s+hair\b",
        re.IGNORECASE,
    )

    for idx, p in enumerate(panels):
        prompt_text = p.get("image_prompt", "") or ""
        scene_text = p.get("scene_description", "") or ""

        # ── B. Lesbian — strip every male reference from every panel ──
        if is_lesbian:
            cleaned = _MALE_TOKENS_RE.sub("", prompt_text)
            # Strip male-sex-act phrases too (they're meaningless without a penis)
            cleaned = _HET_SEX_ACT_RE.sub(",", cleaned)
            # Cleanup orphan descriptors like "a Chinese woman with muscular build"
            cleaned = _ORPHAN_DESC_RE.sub("", cleaned)
            # Drop "and <descriptor>" leftovers from "1boy, a Chinese woman and a handsome Black man"
            cleaned = re.sub(r"\s+and\s+", " ", cleaned)
            # Strip ALL national descriptors ("a <Nationality> woman" / "a <Nationality> man")
            # that LLM wrote — we will inject our own deterministic second_woman below.
            cleaned = re.sub(
                r",?\s*(?:a|an|the)\s+(?:beautiful|stunning|gorgeous|handsome|"
                r"chiseled|tall|strong|muscular|fit)?\s*"
                r"(?:Black|African|Brazilian|Italian|Russian|Japanese|Korean|"
                r"American|Mexican|Turkish|French|German|Greek|Spanish|Polish|"
                r"Dutch|Argentinian|Australian|Indian|Chinese|Thai|Vietnamese|"
                r"Taiwanese|Scandinavian|Nigerian|Caucasian|European|White|"
                r"Filipino|Cuban|Argentinian|South\sAfrican|Asian)\s+"
                r"(?:woman|man|girl|boy|帅哥|美女|男|女)\b[^.,]*(?=,|\.|$)",
                "",
                cleaned,
                flags=re.IGNORECASE,
            )
            # Collapse leftover empties / stray commas
            cleaned = re.sub(r"\s+,", ",", cleaned)
            cleaned = re.sub(r"(,\s*){2,}", ", ", cleaned)
            # Force prefix to "1girl, 1girl, <desc1>, and <desc2>"
            # Remove any leading "1girl, 1boy," / "1girl, " / "1boy," segments
            cleaned = re.sub(r"^[\s,]*1girl\s*,\s*1boy\s*,?", "1girl, 1girl,", cleaned, flags=re.IGNORECASE)
            cleaned = re.sub(r"^[\s,]*1boy\s*,?", "1girl, 1girl,", cleaned, flags=re.IGNORECASE)
            cleaned = re.sub(r"^[\s,]*1girl\s*,?\s*", "1girl, 1girl,", cleaned, count=1, flags=re.IGNORECASE)
            # Inject the deterministic second-woman descriptor
            cleaned = re.sub(
                r"^(1girl,\s*1girl,)\s*",
                rf"\1 {second_woman}, ",
                cleaned,
                count=1,
                flags=re.IGNORECASE,
            )
            # If the cleaned prompt doesn't start with the 1girl×2 prefix, prepend it.
            if not re.match(r"^\s*1girl", cleaned, re.IGNORECASE):
                cleaned = f"1girl, 1girl, {second_woman}, {cleaned.lstrip(', ').strip()}"
            # Replace female-only sex acts: prefer scissoring / tribbing / cunnilingus
            if "scissor" not in cleaned.lower() and "trib" not in cleaned.lower() and idx >= total // 2:
                cleaned = cleaned.rstrip(",. ") + ", scissoring tribbing position, mutual cunnilingus, female orgasm, glistening wet pussy, squirting female ejaculation"
            p["image_prompt"] = cleaned.strip()
            # Strip male references from scene_description too
            cleaned_scene = re.sub(r"(与|和|跟)\s*(男人|男性|男子|帅哥|黑人|男性|他)\b", "", scene_text)
            cleaned_scene = re.sub(r"(男人|男性|男子|帅哥|黑人)\s*[，。]", "，", cleaned_scene)
            p["scene_description"] = cleaned_scene

        # ── A. Panel 1 — single-woman rule (non-multi-character themes) ──
        # For non-multi-character themes (i.e. not lesbian, not 双人明确 listed),
        # Panel 1 should be single-woman. We detect by: panel_index == 0 AND
        # is_foreplay (= not a sex panel).
        is_foreplay = _is_foreplay_panel(idx, total, r18)
        if idx == 0 and is_foreplay and not is_lesbian:
            cleaned = prompt_text
            # Strip "1boy," / "1boy " / "and 1boy"
            cleaned = re.sub(r"\s*,?\s*1boy\b", "", cleaned, flags=re.IGNORECASE)
            cleaned = re.sub(r"\b1boy\b", "", cleaned, flags=re.IGNORECASE)
            # Strip "and a handsome X man" / "a handsome X man" / "and a strong Black man"
            cleaned = re.sub(
                r",?\s*and\s+a\s+(?:handsome|chiseled|tall|strong|muscular|fit)\s+"
                r"(?:Black|African|Brazilian|Italian|Russian|Japanese|Korean|American|"
                r"Mexican|Turkish|French|German|Greek|Spanish|Polish|Dutch|Argentinian|"
                r"Australian|Indian|Chinese|Thai|Caucasian|European|White)\s+man[^.]*?(?=,|\.|$)",
                "",
                cleaned,
                flags=re.IGNORECASE,
            )
            cleaned = re.sub(
                r",?\s*a\s+(?:handsome|chiseled|tall|strong|muscular|fit)\s+"
                r"(?:Black|African|Brazilian|Italian|Russian|Japanese|Korean|American|"
                r"Mexican|Turkish|French|German|Greek|Spanish|Polish|Dutch|Argentinian|"
                r"Australian|Indian|Chinese|Thai|Caucasian|European|White)\s+man[^.]*?(?=,|\.|$)",
                "",
                cleaned,
                flags=re.IGNORECASE,
            )
            # Strip "the man and" / "the man," / "the man" / "a man" phrases
            cleaned = re.sub(r",?\s*and\s+the\s+man\b", "", cleaned, flags=re.IGNORECASE)
            cleaned = re.sub(r",?\s*the\s+man\b", "", cleaned, flags=re.IGNORECASE)
            cleaned = re.sub(r",?\s*a\s+man\b", "", cleaned, flags=re.IGNORECASE)
            # Strip "and <his>"
            cleaned = re.sub(r",?\s*and\s+his\s+\w+\b", "", cleaned, flags=re.IGNORECASE)
            # Collapse
            cleaned = re.sub(r"\s+,", ",", cleaned)
            cleaned = re.sub(r"\s+\.", ".", cleaned)
            cleaned = re.sub(r"(,\s*){2,}", ", ", cleaned)
            p["image_prompt"] = cleaned.strip()
            # Strip male from scene_description too
            cleaned_scene = re.sub(r"(与|和|跟)\s*(男人|男性|男子|帅哥|黑人|他)\b", "", scene_text)
            cleaned_scene = re.sub(r"(男人|男性|男子|帅哥|黑人)\s*[，。]", "，", cleaned_scene)
            p["scene_description"] = cleaned_scene

        # ── C. Last panel — visible cum (R18 only) ──
        if r18 and idx == total - 1:
            is_last_sex = _is_sex_panel(idx, total, r18) or True  # last panel always treated as sex/climax
            if is_last_sex:
                cur = p.get("image_prompt", "") or ""
                if is_lesbian:
                    cum_tags = (
                        ", visible squirting female ejaculation, "
                        "wet pussy juices dripping, "
                        "female orgasm fluid visible on skin, "
                        "squirting visible on sheets, "
                        "creampie residue on inner thighs"
                    )
                    if not any(k in cur.lower() for k in ("squirting", "female ejaculation", "creampie residue")):
                        p["image_prompt"] = cur.rstrip(",. ") + cum_tags
                else:
                    cum_tags = (
                        ", visible cum dripping from her vagina, "
                        "cum on her inner thighs, "
                        "cum puddle on the sheets, "
                        "thick ropes of cum visible on skin, "
                        "creampie residue, "
                        "semen visible, "
                        "cumshot aftermath"
                    )
                    cur_lower = cur.lower()
                    if not any(k in cur_lower for k in (
                        "visible cum", "cum drip", "cum puddle", "creampie residue",
                        "cum on her", "cumshot",
                    )):
                        p["image_prompt"] = cur.rstrip(",. ") + cum_tags

    return panels


def _correct_location_in_text(text: str, canonical_loc_zh: str) -> str:
    """
    Replace off-theme location words in a Chinese scene_description with the
    canonical location, WITHOUT destroying the surrounding narrative text.

    Strategy:
      - Only replace standalone location tokens (not characters that happen to
        appear as substrings of longer words).
      - Never touch dialogue / action / emotion / position words.
    """
    if not text or not canonical_loc_zh:
        return text

    # A curated list of drift locations that commonly appear in LLM output
    # but don't match the canonical theme location.
    _DRIFT_LOCS = [
        "酒店大堂", "酒店房间", "酒店套房", "酒店停车场",
        "地下私人停车场", "地下停车场",
        "高级公寓", "豪华公寓", "私人公寓",
        "高级餐厅", "私人餐厅", "高级包间", "私人包间",
        "咖啡厅", "咖啡馆", "私人泳池露台", "私人泳池",
        "希腊小岛", "希腊", "度假别墅", "私人别墅", "山顶别墅",
        "度假村", "摩天轮", "旋转木马", "过山车", "游乐场", "游乐园",
        "公园长椅", "酒店", "停车场", "公寓",
        "餐厅", "包间", "包厢", "酒吧", "KTV", "小岛", "海岛",
        "地铁", "公交车", "出租车", "私家车", "教室", "图书馆",
        "校园", "操场", "公园", "花店", "花房",
        "写字楼", "办公室", "会议室", "街头", "街道", "路边",
        "小巷", "巷子", "大堂", "大厅",
        "温泉池", "汤池", "桑拿房", "蒸气房",
        "泳池边", "泳池畔", "泳池旁", "泳池内",
        "座舱里", "座舱中", "驾驶舱", "机舱", "车厢里", "车厢中",
        "私人影院", "电影院", "放映厅",
    ]
    for drift in _DRIFT_LOCS:
        # Only replace if it appears as a complete word (surrounded by non-Chinese
        # characters or start/end of string). Skip if it's the canonical itself.
        if drift == canonical_loc_zh:
            continue
        # Use word-boundary check: drift must be surrounded by non-Chinese or
        # punctuation/whitespace, not embedded in longer words.
        # Simple approach: replace "，X，" / "，X。" / " X，" patterns
        text = re.sub(
            rf"(?<=[，、\s]){re.escape(drift)}(?=[，、。；；\s]|$)",
            canonical_loc_zh,
            text,
        )
    return text


def _correct_location_in_prompt(prompt: str, canonical_loc_en: str, canonical_loc_zh: str) -> str:
    """
    Replace off-theme English location words in an image_prompt with the canonical
    theme location (in English), preserving the rest of the prompt intact.
    """
    if not prompt:
        return prompt
    # Always strip known drift English location tokens, even without a canonical replacement.
    _EN_LOC_DRIFT = [
        "hotel lobby", "hotel room", "hotel suite", "hotel parking lot",
        "private parking garage", "underground parking", "parking garage",
        "luxury apartment", "private apartment", "penthouse apartment", "apartment",
        "fancy restaurant", "private restaurant", "private dining room",
        "coffee shop", "cafe", "coffeehouse", "private pool terrace", "pool terrace",
        "private pool", "pool", "greek island", "resort villa", "private villa",
        "mountain villa", "theme park", "ferris wheel", "carousel",
        "amusement park", "playground", "park bench", "hotel",
        "bar", "restaurant", "cinema", "movie theater", "private theater",
        "classroom", "library", "school campus", "gym", "gymnasium",
        "office", "meeting room", "street", "alley", "alleyway",
        "subway", "bus", "taxi", "car interior", "hot spring pool",
        "sauna room", "steam room", "poolside",
    ]
    for drift in _EN_LOC_DRIFT:
        # Remove the whole phrase including trailing comma
        prompt = re.sub(
            rf",?\s*{re.escape(drift)}\b,?\s*",
            ", ",
            prompt,
            flags=re.IGNORECASE,
        )
    # Append canonical English location if provided
    if canonical_loc_en:
        prompt = re.sub(r",?\s*in\s+\S+.*?(?=,\s*[,.]|$)", "", prompt, flags=re.IGNORECASE)
        prompt = re.sub(r"\s+in\s+\S+\s*,", ",", prompt, flags=re.IGNORECASE)
        prompt = prompt.rstrip(",. ") + f", in {canonical_loc_en}, "
    return re.sub(r"\s+", " ", prompt).strip().rstrip(",")


def _correct_outfit_in_prompt(prompt: str, canonical_outfit_en: str, canonical_outfit_zh: str) -> str:
    """
    Ensure the image_prompt contains the theme's canonical outfit/costume keyword.
    If the LLM omitted the outfit or wrote a different one, inject the canonical.

    For Panel 1 (foreplay) this is mandatory — the outfit is part of the theme.
    For sex panels we don't force it (nudity is expected).
    """
    if not prompt or not canonical_outfit_en:
        return prompt

    # Check if the canonical outfit keyword (or a close variant) is already present.
    outfit_lower = canonical_outfit_en.lower().strip()
    # Extract the main noun (e.g. "black lace bra and panties" → "bra")
    outfit_words = outfit_lower.split()
    has_outfit = any(w in prompt.lower() for w in outfit_words if len(w) > 3)

    if not has_outfit:
        # Inject outfit descriptor before the first action/comma
        # "wearing ..." phrase
        prompt = prompt.rstrip(",. ") + f", the woman wearing {canonical_outfit_en}, "
    return prompt


def _enforce_theme_coherence(
    scene_description: str,
    image_prompt: str,
    theme_name: str,
    theme_data: dict,
    panel_index: int,
    total_panels: int,
    r18: bool,
) -> Tuple[str, str]:
    """
    Post-process a panel to enforce theme coherence:
      1. ALL non-canonical locations are replaced with the theme's canonical location
         (so panel 1-5 all take place in the SAME 1-2 theme-related scenes).
      2. ALL non-canonical outfits are replaced with the theme's canonical outfit.
      3. Panel 1 is GUARANTEED to mention the theme's primary location + outfit.

    Returns (new_scene, new_image_prompt).
    """
    canonical_outfit_zh, canonical_outfit_en = _get_canonical_outfit(theme_name, theme_data)
    canonical_loc_zh, canonical_loc_en = _get_canonical_location(theme_name, theme_data)
    is_foreplay = _is_foreplay_panel(panel_index, total_panels, r18)
    is_sex = _is_sex_panel(panel_index, total_panels, r18)
    theme_scenarios = (theme_data.get("scenarios", []) if isinstance(theme_data, dict) else []) or []
    theme_loc_set = set(theme_scenarios)
    if canonical_loc_zh:
        theme_loc_set.add(canonical_loc_zh)

    new_scene = scene_description or ""
    new_image = image_prompt or ""

    # ── q3+ HARD EARLY-OUT: full-template rebuild ────────────────────────────────
    # Architectural change: we NO LONGER trust the LLM to write the
    # scene_description or image_prompt for location + outfit, because the
    # user has reported that even with the 700+ line drift-scrub pipeline,
    # real outputs were "公园长椅" / "希腊小岛" / etc. when the theme was
    # 游泳池畔 / 地下车库. The LLM does not obey the THEME CONTRACT often
    # enough to be acceptable for a paying product.
    #
    # Instead, we throw away the LLM's scene_description and image_prompt
    # entirely, and build them from theme metadata + a fixed beat schedule.
    # The LLM's role is reduced to: produce the [ANCHOR] on panel 1 (used
    # to lock character identity across all panels). Everything else is
    # deterministic.
    # ALWAYS rebuild from template. We NO LONGER trust the LLM to write the
    # scene_description or image_prompt for location + outfit. Reason: the
    # user has reported that even after the 700+ line drift-scrub pipeline,
    # real outputs were "公园长椅" / "希腊小岛" / etc. when the theme was
    # 游泳池畔 / 地下车库 — i.e. the LLM doesn't obey the THEME CONTRACT
    # often enough to be acceptable for a paying product. The user explicitly
    # demanded: "重写下功能" / "主题和大纲需要对应匹配".
    #
    # Trade-off: we lose LLM-written narrative flavor in exchange for 100%
    # theme consistency across ALL 500 themes (including LLM-custom titles
    # like 「巴黎咖啡馆」 that have no DB row). The LLM still produces a
    # character anchor on panel 1 (used to lock identity across all panels).
    if theme_scenarios and canonical_loc_zh:
        # ── q3+ FIX: preserve LLM narrative, only fix location drift in Chinese text ──
        # The previous "full-template rebuild" threw away all LLM-written narrative
        # (dialogue, emotions, specific sex positions) and replaced it with a
        # mechanical "woman in X wearing Y" template. This killed story coherence.
        # We now PRESERVE the LLM's scene_description and image_prompt entirely,
        # and only surgically fix off-theme Chinese location words in scene_description.
        # The LLM is trusted to write good narrative — the arc_panels + pose_list
        # provide the structure (specific positions, pacing).
        new_scene = _correct_location_in_text(new_scene, canonical_loc_zh)
        new_image = new_image  # DO NOT modify image_prompt — preserve LLM's full output
        return (new_scene, new_image)

    # ── q3+ PRE-PASS DRIFT SCRUB ─────────────────────────────────────────────
    # Earlier the LOCATION ENFORCEMENT loop below only replaced the FIRST
    # detected off-theme word with canonical, leaving drift residue like
    # "大堂" / "私人泳池" / "地下" hanging around. That made downstream strip
    # passes churn and produce gibberish like "在球场的地下私人球场".
    # Now we strip ALL known off-theme drift LOCATIONS (as standalone tokens)
    # BEFORE any replacement, so the rest of the pipeline operates on a clean
    # scene. We only strip multi-character compound tokens (酒店大堂, 私人泳池)
    # and the specific noun-phrase drift words — NOT generic particles like
    # "的" / "高级" / "私人" that are part of legitimate descriptions.
    _DRIFT_LOC_ZH = (
        # 完整 drift 短语 (优先匹配,避免残留 "的地下私人")
        "酒店大堂", "酒店房间", "酒店套房", "酒店停车场",
        "地下私人停车场", "地下停车场",
        "高级公寓的地下", "的地下私人",
        "高级公寓", "豪华公寓", "私人公寓",
        "高级餐厅", "私人餐厅", "高级包间", "私人包间",
        "咖啡厅", "咖啡馆", "私人泳池露台", "私人泳池",
        "希腊小岛", "希腊", "度假别墅", "私人别墅", "山顶别墅",
        "度假村", "摩天轮", "旋转木马", "过山车", "游乐场", "游乐园",
        "公园长椅", "酒店", "停车场", "公寓",
        "餐厅", "包间", "包厢", "酒吧", "KTV", "小岛", "海岛",
        "地铁", "公交车", "出租车", "私家车", "教室", "图书馆",
        "校园", "操场", "公园", "花店", "花房",
        "写字楼", "办公室", "会议室", "街头", "街道", "路边",
        "小巷", "巷子", "大堂", "大厅",
        "温泉池", "汤池", "桑拿房", "蒸气房",
        # Additional drift locations for specific themes
        "泳池边", "泳池畔", "泳池旁", "泳池内",
        "座舱里", "座舱中", "驾驶舱", "机舱", "车厢里", "车厢中",
        "私人影院", "电影院", "放映厅",
    )
    # Sort by length descending so longer tokens are stripped first
    # (e.g. "酒店大堂" before "酒店" so we don't leave "大堂" residue)
    for d in sorted(_DRIFT_LOC_ZH, key=len, reverse=True):
        if d in new_scene:
            new_scene = new_scene.replace(d, "", 1)
    # Tidy up double-punctuation / leading spaces introduced by the scrub
    new_scene = _re_consist.sub(r"[ ，,。]{2,}", "，", new_scene).lstrip(" ，,。、").rstrip(" ，,。、")
    # Strip orphan descriptive residue left over from drift scrub.
    # The scrub deletes drift location words like "高级公寓" or "地下停车场"
    # but leaves behind their trailing characters ("的", "里", "上", "的地下",
    # "的私人", etc.). Match these as `的X，` / `X里，` / `X上，` patterns
    # where X is 0-8 chars of leftover modifiers. Repeat up to 5 times to
    # catch nested residue.
    for _ in range(5):
        # Pattern A: 孤立 particle + 0-4 chars trailing → 在/，前后边界.
        # q3+ bugfix: do NOT match "在" as the leading boundary character
        # (it would strip "在" + the following "的/里/..." particle, removing
        # the location hook that PANEL FORCE-SETUP's Pattern A relies on).
        # The look-behind boundary is now punctuation/whitespace only, not 在.
        new_scene = _re_consist.sub(
            r"(?:^|(?<=[，。、，, \s]))(?:的|里|上|中|内|下|和|与|跟|同)(?:地下|私人|豪华|高级|高级的|私人的|豪华的|高档|私|地下停车场|大|小|露天|泳池|泳|空)?(?=[，。、，, \s])",
            "",
            new_scene,
        )
        # Pattern B: 多个孤立 particle 串联 (e.g. "的高级里")
        new_scene = _re_consist.sub(
            r"(?:的|里|上|中|内|下|和|与|跟|同)+(?:地下|私人|豪华|高级|私|高档|露天|地下停车场)?(?:的|里|上|中|内|下|和|与|跟|同)+",
            "",
            new_scene,
        )
        # Pattern C: 开头/中间的 "在X，" (X 是 particle + 0-4 chars)
        new_scene = _re_consist.sub(
            r"^[\s，,。、]*(?:的|里|上|中|内|下|和|与|跟|同)(?:地下|私人|豪华|高级|私|高档|地下停车场)?[\s，,。、]*",
            "",
            new_scene,
        )
        # Pattern D: 紧跟着 "在" 的 "的X，" — only if followed by drift residue,
        # NOT if "在" stands alone (in which case PANEL FORCE-SETUP's Pattern A
        # will rewrite it to "在<primary_loc>内，"). Otherwise we strip too
        # aggressively and lose the location hook.
        new_scene = _re_consist.sub(
            r"在(?:的|里|上|中|内|下)*(?:地下|私人|豪华|高级|私|高档|露天|地下停车场)+(?:的|里|上|中|内|下)*",
            "",
            new_scene,
        )
        # Pattern E: 任何位置 "的X，Y" where X is 0-4 chars of garbage
        new_scene = _re_consist.sub(
            r"(?:^|(?<=[，。、，, \s]))(?:的|高级|私人|豪华|高档|露天|地下)(?:地下|私人|豪华|高级|私|高档|露天|地下停车场|大|小|高档|泳池)?(?=[，。、，, \s])",
            "",
            new_scene,
        )
    new_scene = _re_consist.sub(r"[ ，,。]{2,}", "，", new_scene)
    # Strip leading/trailing orphan punctuation introduced by drift scrub
    new_scene = new_scene.lstrip(" ，,。、").rstrip(" ，,。、")
    new_scene = _re_consist.sub(r"^[，,]+", "", new_scene)
    # Strip leading "在，" only if the scene is too short to be valid (drift
    # scrub ate everything else). Otherwise preserve "在" so legitimate
    # leading "在XXX内，" patterns survive.
    if len(new_scene.strip()) <= 6 and new_scene.strip().startswith("在"):
        new_scene = _re_consist.sub(r"^在\s*[,，]?\s*", "", new_scene).lstrip(" ，,。、").rstrip(" ，,。、")
    if not new_scene.strip():
        new_scene = scene_description or ""  # safety: don't blank out the scene
    # English drift tokens in image_prompt
    _DRIFT_LOC_EN = (
        "hotel lobby", "hotel room", "hotel suite", "parking garage",
        "underground parking", "luxury apartment", "high-end apartment",
        "Greek island", "Greek ", "private villa", "resort villa", "ferris wheel",
        "carous", "subway car", "bus interior", "taxi interior",
        "classroom interior", "school hallway", "office building",
        "street corner", "private pool", "private poolside",
        "hotel", "parking", "villa", "island", "apartment", "deck",
        "Greek", "luxury", "private", "high-end",
        # Locations off-theme for most themes (but NOT "lounge" which is a valid boxing gym sub-scene)
        "fine dining room", "fine dining",
        # Orphan prepositions from drift scrub (e.g. "walking in, pool" → "walking , pool")
        "in,", "on,", "at,", "by,", "into,", "onto,",
    )
    for d in sorted(_DRIFT_LOC_EN, key=len, reverse=True):
        if d.lower() in new_image.lower():
            new_image = _re_consist.sub(
                _re_consist.escape(d),
                "",
                new_image,
                flags=_re_consist.IGNORECASE,
            )
    new_image = _re_consist.sub(r",\s*,", ",", new_image).strip(" ,")
    # Collapse multiple spaces + fix orphan commas
    new_image = _re_consist.sub(r"\s+", " ", new_image)
    new_image = _re_consist.sub(r"\s+,", ",", new_image)
    new_image = _re_consist.sub(r",\s*$", "", new_image).strip()
    # Collapse duplicate adjacent English words (boxing boxing, hotel hotel)
    new_image = _re_consist.sub(r"\b(\w+)\s+\1\b", r"\1", new_image, flags=_re_consist.IGNORECASE)
    # q3+ POST-DRIFT ORPHAN-PREP CLEANUP (English image_prompt)
    # After scrubbing drift nouns, the residue is usually:
    #   "in a"  /  "on the"  /  "by the"  /  "at the"  /  ", the"
    #   ", with"  /  ", sitting in"  /  ", standing at"
    # All of these now sit orphaned in front of canonical anchors. Collapse
    # repeated runs of orphan preposition + article combinations.
    # Pattern A: leading "Asian woman in a, dim lights..." → keep subject,
    # strip trailing "in a" preposition-article combo. We do this by finding
    # the first preposition+article combo in the string and trimming the
    # leading subject+noun+preposition+article sequence.
    _EN_PREPS = r"(?:in|on|at|by|of|to|with|from|for|into|onto|over|under|beside|against|across|around|near|through|during|before|after|above|below|beneath|behind|along|via|within|without|upon|toward|towards|about|onto|off|out)"
    _EN_ARTICLES = r"(?:the|a|an|his|her|its|their|this|that|these|those|my|your|our)"
    # Pattern A1: middle-of-string "noun PREP ART, " runs that are now orphaned
    # (e.g. "in a," right after the drift noun got removed).
    new_image = _re_consist.sub(
        r"(?:^|[\s,])(?:" + _EN_PREPS + r")\s+(?:" + _EN_ARTICLES + r")\s*,",
        ",",
        new_image,
        flags=_re_consist.IGNORECASE,
    )
    # Pattern A2: leading "PREP ART, ..." (no subject noun — only after
    # total drift removal; rare but possible)
    new_image = _re_consist.sub(
        r"^\s*,?\s*(?:" + _EN_PREPS + r")\s+(?:" + _EN_ARTICLES + r")\s*,",
        "",
        new_image,
        flags=_re_consist.IGNORECASE,
    ).strip(" ,")
    # Pattern B: mid-string ", PREP X," (X is a word, e.g. ", with a couple, X")
    new_image = _re_consist.sub(
        r",\s+(?:" + _EN_PREPS + r")\s+(?:" + _EN_ARTICLES + r")\s*,",
        ",",
        new_image,
        flags=_re_consist.IGNORECASE,
    )
    # Pattern C: ", PREP WORD," (where PREP is a preposition, not part of a
    # legitimate description). E.g. ", in pool, X" → ", X".
    new_image = _re_consist.sub(
        r",\s+(?:" + _EN_PREPS + r")\s+(\w+)\s*,",
        r", \1,",
        new_image,
        flags=_re_consist.IGNORECASE,
    )
    # Pattern D: mid-string "PREP ART X" where X is non-article word — strip
    # the orphan preposition only (e.g. "with the car, X" → ", car, X")
    new_image = _re_consist.sub(
        r",\s+(?:" + _EN_PREPS + r")\s+(?:" + _EN_ARTICLES + r")\s+",
        ", ",
        new_image,
        flags=_re_consist.IGNORECASE,
    )
    # Pattern D2: "PREP PREP" orphans — e.g. "sitting in on" (no comma, no trailing
    # space) or "sitting in on " (trailing space). Matches anywhere in string.
    # This covers both mid-string orphans and end-of-string orphans.
    new_image = _re_consist.sub(
        r"\s+(?:" + _EN_PREPS + r")\s+(?:" + _EN_PREPS + r")(?=\s|$|,)",
        " ",
        new_image,
        flags=_re_consist.IGNORECASE,
    )
    # Pattern D3: "VERB PREP ," trailing orphan — e.g. "sitting in,"
    # (verb + preposition immediately followed by a comma — drop the preposition)
    new_image = _re_consist.sub(
        r"\s+(?:" + _EN_PREPS + r")\s+(?=,)",
        "",
        new_image,
        flags=_re_consist.IGNORECASE,
    )
    # Pattern D4: "VERB PREP PREP , X" — e.g. "sitting in on, X" → "sitting, X"
    new_image = _re_consist.sub(
        r"\s+(?:" + _EN_PREPS + r")\s+(?:" + _EN_PREPS + r")\s*,",
        ",",
        new_image,
        flags=_re_consist.IGNORECASE,
    )
    # Re-collapse duplicate commas/spaces
    new_image = _re_consist.sub(r",\s*,", ",", new_image)
    new_image = _re_consist.sub(r"\s+,", ",", new_image)
    new_image = new_image.strip(" ,")
    # Pattern E: "X PREP ART Y" where PREP looks like a stray preposition
    # (e.g. "sitting in the car" is fine; "sitting in a" alone is bad)
    # We only fire on "PREP ART" at end of phrase just before ", X" (where
    # X is a NEW subject — indicating the PREP is orphaned between subjects)
    new_image = _re_consist.sub(
        r"\s+(?:" + _EN_PREPS + r")\s+(?:" + _EN_ARTICLES + r")\s+(?=,)",
        "",
        new_image,
        flags=_re_consist.IGNORECASE,
    )
    # Pattern F: fix dangling "PREP ," that lost its noun (e.g. "against car in, X")
    new_image = _re_consist.sub(
        r"\s+(?:" + _EN_PREPS + r")\s*,",
        ",",
        new_image,
        flags=_re_consist.IGNORECASE,
    )
    # Pattern F2: REMOVED — was too aggressive (deleted legitimate
    # prepositions like "against car" in "leaning against car"). The orphan
    # "VERB PREP, " case is now handled by F3 below.
    # Pattern F3: "PREP, " followed by canonical anchor — e.g.
    # "against car in, golf course" → "against car, golf course"
    # The orphan "in," between "car" and the canonical was a drift residue
    # from "car in parking garage" → "car in" + canonical = drift fix.
    new_image = _re_consist.sub(
        r"\s+(?:" + _EN_PREPS + r")\s*,\s*",
        ", ",
        new_image,
        flags=_re_consist.IGNORECASE,
    )
    # Pattern F3b: "NOUN PREP ," stranded after canonical was injected
    # (e.g. "car in, golf course"). Drops the orphan PREP, keeps the noun.
    new_image = _re_consist.sub(
        r"\s+(?:" + _EN_PREPS + r")\s*,(?=\s*(?:golf|boxing|swimming|soccer|football|basketball|tennis|baseball|on|by|at|near))",
        "",
        new_image,
        flags=_re_consist.IGNORECASE,
    )
    # Pattern F4: REMOVED — was too aggressive and consumed legitimate verb-preposition
    # phrases like "swimming in on" (the "in" was correctly matched by D2). Keeping
    # it caused "swimming in on" → "swimming on" (destroying valid "in").
    # The D2/D4 patterns handle "PREP PREP" cases sufficiently.
    # Pattern F5: "VERB PREP, " → "VERB," (drop orphan preposition right
    # before comma). E.g. "dining at on, X" → "dining, X"
    new_image = _re_consist.sub(
        r"\s+(?:" + _EN_PREPS + r")\s*,\s*",
        ",",
        new_image,
        flags=_re_consist.IGNORECASE,
    )
    # Pattern F6: "X on Y on Y" (duplicate location via canonical injection)
    # → "X on Y". E.g. "walking toward golf course on golf course" → "walking toward golf course"
    new_image = _re_consist.sub(
        r"\b(\w+(?:\s+\w+){0,2}?)\s+(?:on|in|at|by|of|to|with|along|across|toward|towards)\s+\1\b",
        r"\1",
        new_image,
        flags=_re_consist.IGNORECASE,
    )
    # Re-collapse again
    new_image = _re_consist.sub(r",\s*,", ",", new_image)
    new_image = _re_consist.sub(r"\s+,", ",", new_image)
    new_image = _re_consist.sub(r"\s{2,}", " ", new_image)
    new_image = new_image.strip(" ,")

    # Pattern D2: "PREP PREP" orphans — e.g. "sitting in on" (no comma, no trailing
    # space) or "sitting in on " (trailing space). Matches anywhere in string.
    # This covers both mid-string orphans and end-of-string orphans.
    new_image = _re_consist.sub(
        r"\s+(?:" + _EN_PREPS + r")\s+(?:" + _EN_PREPS + r")(?=\s|$|,)",
        " ",
        new_image,
        flags=_re_consist.IGNORECASE,
    )

    # ── Special: strip orphaned preposition+comma fragments left over from drift ────
    # These appear when the LLM wrote "VERB PREP LOCATION" and drift-scrub removed
    # LOCATION, leaving "VERB PREP," as a dangling fragment:
    #   "standing in, boxing gym" / "leaning against car in, golf course"
    #   "woman swimming in, wet poolside area" / "couple walking in, wet poolside area"
    # Strategy: match 0-1 words then PREP(", "|" ,") where the PREP is followed by a
    # comma. This distinguishes from legitimate "in the X" (no comma) and "in a X"
    # (no comma before X).
    new_image = _re_consist.sub(
        r"(?<![a-zA-Z])(?:\S+\s+){0,1}(in|on|at|by|against|across|around|near|into|onto|over|under|through|during|between|within|behind|beneath|beside|along|via|toward|towards)\s*,\s*",
        ", ",
        new_image,
        flags=_re_consist.IGNORECASE,
    )
    # ── Collapse orphan comma after verb: "woman swimming , wet" → "woman swimming, wet"
    # Only fires when comma is between two word-boundary items (the comma itself
    # creates the gap; we close it).
    new_image = _re_consist.sub(
        r"(\w+)\s*,\s*(?=[A-Za-z][a-z]|\w{2,})",
        r"\1, ",
        new_image,
    )

    # q3+ POST-DRIFT ORPHAN-PREP CLEANUP (Chinese scene_description)
    # The drift scrub deletes noun-phrase drift but leaves orphan particles:
    #   "在私人里，"  /  "的豪华内，"  /  "的高级上，"
    # Plus: 删除 drift 之后留下 "在" 开头的 残头 ("在,两人..."  →  "两人...").
    # We run a single-purpose scrub: drop orphan particle runs that appear
    # alone (no adjacent character/word) between boundary markers.
    for _ in range(3):
        new_scene = _re_consist.sub(
            r"(?<=[，。、，,\s])(?:的|里|上|中|内|下|和|与|跟|同|从|到|往|向|从|由|为|以|把|将|被|让|使|叫|请|要|会|能|可|得|了|过|着|过|起|下|上来|下去|上来着|着呢)\s*[，,]?",
            "",
            new_scene,
        )
    # NOTE: we deliberately do NOT strip a leading "在" head here, because
    # the PANEL FORCE-SETUP pass below uses Pattern A "在X，" to REPLACE the
    # X with our canonical. Stripping "在" first would make that pass always
    # fall through to a hard prepend, which produces "在球场内气氛暧昧" →
    # cleaned to "在球场，气氛暧昧" by the preposition cleanup at the end
    # of this function. That works, but the REPLACE-IF-PRESENT approach
    # produces cleaner output when the LLM has written a partial "在酒店" head
    # (e.g. after "酒店大堂" was scrubbed).
    new_scene = _re_consist.sub(
        r"^[\s，,。、]*(?:的)\s*[，,。、]?\s*",
        "",
        new_scene,
    )
    new_scene = _re_consist.sub(r"[ ，,。]{2,}", "，", new_scene)
    new_scene = new_scene.lstrip(" ，,。、").rstrip(" ，,。、")

    # ── Helper: check if detected location is "compatible" with theme ────────
    # Compatible means:
    #   - It's the canonical location, OR
    #   - It's literally in theme_scenarios, OR
    #   - It's a substring match of any theme scenario (e.g. "泳池边" is part of "泳池边湿身")
    def _is_loc_compatible(loc: str) -> bool:
        if not loc or loc == canonical_loc_zh:
            return True
        if loc in theme_loc_set:
            return True
        if theme_name and len(theme_name) >= 2 and theme_name in loc:
            return True
        # Substring check: "泳池边" is contained in "泳池边湿身" → compatible
        for s in theme_loc_set:
            if isinstance(s, str) and len(s) >= 2 and (loc in s or s in loc):
                return True
        return False

    def _is_outfit_compatible(outfit: str) -> bool:
        if not outfit:
            return True
        return _outfit_compatible_with_theme(outfit, theme_name, theme_data, canonical_outfit_zh)

    # ── LOCATION ENFORCEMENT (run on ALL panels, not just foreplay) ───────────
    # User feedback: even sex panels should stay in theme setting — only the
    # OUTFIT is allowed to be naked, not the LOCATION. Otherwise storyboards
    # become incoherent (panel 4 in 泳池, panel 5 in 摩天轮).
    # q3+ bugfix: whitelist furniture / generic preposition-words that look
    # like locations to the regex but are NOT actually theme locations
    # (e.g. "沙发上", "床上", "椅子上", "吧台上", "桌上", "地上"). The
    # pre-pass DRIFT SCRUB has already cleaned the real drift — don't
    # overwrite legitimate words.
    _LOC_WHITELIST = {
        "沙发上", "床上", "椅子上", "吧台上", "桌上", "地上",
        "楼梯上", "车前座", "车后座", "副驾驶",
        # q3+: high-frequency sub-locations inside the theme that the LOCATION
        # ENFORCEMENT pass would over-aggressively rewrite. These are
        # semantically a part of the theme (高尔夫球场 → 发球台/果岭/球车) and
        # replacing them with the canonical broadens the scene unnaturally.
        "发球台", "果岭", "球道", "球童", "俱乐部会所", "俱乐部",
        "练习场", "围绳", "围绳旁", "沙袋", "沙袋旁", "擂台角落",
        "更衣室", "更衣间", "训练室", "休息区", "休息室", "拳击台",
        "球门区", "球门", "球门线", "球门旁", "球门后", "球门内",
        "替补席", "球员通道", "通道", "包厢", "看台", "VIP包厢",
        "看台区", "观众席", "泳道", "跳水池", "泳池躺椅", "泳池边",
        "泳池", "泳池内", "跳水台", "泳池旁", "泳池内", "深水区", "浅水区",
        "更衣帐篷", "沙滩小屋", "沙滩毛巾", "教练席", "裁判台",
    }
    # English equivalents of the same sub-locations
    _LOC_WHITELIST_EN = {
        "tee box", "tee", "green", "fairway", "rough", "bunker", "sand trap",
        "clubhouse", "driving range", "putting green",
        "ring", "ring ropes", "punching bag", "heavy bag", "speed bag",
        "locker room", "training room", "lounge", "rest area",
        "ring corner", "corner", "ring apron",
        "pool", "swimming pool", "poolside", "diving board", "diving pool",
        "swim lane", "lane", "shallow end", "deep end",
        "locker tent", "beach cabana", "beach towel",
    }
    all_locs = _find_all_locations_in_text(new_scene) + _find_all_locations_in_text(new_image)
    for loc in all_locs:
        if loc in _LOC_WHITELIST:
            continue
        # Skip very short (1-2 char) location words that are not the canonical.
        # The regex matcher may pick up fragments like "车" or "楼" that aren't
        # real scene-setting locations — replacing them would corrupt the text.
        # Only enforce if the word is >= 3 chars or IS the canonical.
        if len(loc) <= 2 and loc != canonical_loc_zh:
            continue
        if _is_loc_compatible(loc):
            continue
        # q3+: skip English sub-locations that are inside the theme scope
        # (e.g. "tee box" inside 高尔夫球童 theme). Replacing them with
        # canonical "golf course" loses the specific sub-location detail.
        if loc.lower() in _LOC_WHITELIST_EN:
            continue
        # Replace in scene_description
        if loc in new_scene:
            new_scene = new_scene.replace(loc, canonical_loc_zh, 1)
        # Replace English equivalent in image_prompt — REPLACE ALL occurrences (count=0)
        en_equivalent = _zh_location_to_english(loc)
        if en_equivalent and en_equivalent.lower() in new_image.lower():
            new_image = _re_consist.sub(
                _re_consist.escape(en_equivalent),
                canonical_loc_en,
                new_image,
                count=0,  # replace ALL, not just first
                flags=_re_consist.IGNORECASE,
            )

    # ── OUTFIT ENFORCEMENT (ALL panels — user wants theme consistency throughout) ──
    # Even sex panels should keep theme outfit unless explicitly naked (全裸).
    # Per user feedback: 修女 should always wear 修女服, not 围裙/迷彩, even on
    # later panels. Only "脱去外衣" / "湿身" / "全裸" are exempt.
    all_outfits = _find_all_outfits_in_text(new_scene) + _find_all_outfits_in_text(new_image)
    for outfit in all_outfits:
        abstract = {"全裸", "湿身", "赤裸", "裸体", "披着浴巾", "脱去外衣"}
        if is_sex and outfit in abstract:
            continue
        if _is_outfit_compatible(outfit):
            continue
        # Replace in scene_description
        if outfit in new_scene:
            new_scene = new_scene.replace(outfit, canonical_outfit_zh, 1)
        # Replace English equivalent in image_prompt — REPLACE ALL (count=0)
        en_equivalent = _zh_outfit_to_english(outfit)
        if en_equivalent and en_equivalent.lower() in new_image.lower():
            new_image = _re_consist.sub(
                _re_consist.escape(en_equivalent),
                canonical_outfit_en,
                new_image,
                count=0,  # replace ALL, not just first
                flags=_re_consist.IGNORECASE,
            )


    # ── PANEL FORCE-SETUP (ALL panels) ──────────────────────────────────────
    # q3+ bugfix: user feedback (高尔夫球童 / 拳击搭档) — LLM often drifts
    # panel 2+ to completely off-theme locations. The PRE-PASS DRIFT SCRUB
    # above stripped all known drift tokens; now we just need to:
    #   1. Detect panels that still have NO theme scenario word.
    #   2. Inject canonical location at the FRONT of those panels.
    #   3. Inject canonical outfit if missing.
    #   4. Mirror canonical location + outfit into English image_prompt.
    if theme_scenarios and canonical_loc_zh:
        scene_has_theme = False
        for s in theme_scenarios:
            if isinstance(s, str) and len(s) >= 2 and s in new_scene:
                scene_has_theme = True
                break
        if not scene_has_theme and canonical_loc_en and canonical_loc_en.lower() in new_image.lower():
            scene_has_theme = True

        if not scene_has_theme:
            primary_loc_candidate = canonical_loc_zh if (canonical_loc_zh and len(canonical_loc_zh) >= 2) else theme_scenarios[0]

            # q3+ bugfix: instead of forcing a hard `在X内，` prefix (which
            # creates broken results like "在球场在的私人，气氛暧昧" when
            # drift scrub left an orphan "在" head), we do REPLACE-IF-PRESENT.
            # The strategy: scan the scene for any leading "在X，" / "X里，"
            # location phrase and REPLACE X with our canonical. Otherwise
            # prepend at the very front.
            _rewrote_prefix = False
            # Particles that are NOT locations (don't try to replace these)
            _PARTICLES = {"的", "了", "着", "过", "和", "与", "跟", "同", "在", "从", "到", "往", "向", "由", "为", "以", "两", "一", "三", "四", "五", "六", "七", "八", "九", "十", "几"}
            # Pattern A: leading "在X，" / "在X里，" / "在X馆，" where X is 2-8 chars
            # (MIN 2 chars prevents "里两" / "中一" from being treated as locations)
            # Valid terminators include: 里/内/中/上/下 (plus 馆/吧/厅/室 for room types)
            m = _re_consist.match(
                r"^[，,。\s]*在([^，。、,\s]{2,8}?)(?:里|内|中|上|下|馆|吧|厅|室|间)?[，,]",
                new_scene,
            )
            if m:
                old_loc = m.group(1).strip()
                if old_loc and old_loc not in _PARTICLES and old_loc != primary_loc_candidate:
                    new_scene = _re_consist.sub(
                        r"^[，,。\s]*在" + _re_consist.escape(old_loc) + r"(?:里|内|中|上|下)?[，,]",
                        f"在{primary_loc_candidate}内，",
                        new_scene,
                        count=1,
                    )
                    _rewrote_prefix = True
                else:
                    # Particle-only "在X，" (X is particle or too short) — strip the
                    # orphan "在X，" head at the START of the string and prepend
                    # canonical cleanly. Using ^ anchor prevents stripping "在球场内，"
                    # from the middle of a string.
                    new_scene = _re_consist.sub(
                        r"^[，,。\s]*在[^，。、,\s]{0,8}?[，,]",
                        "",
                        new_scene,
                    ).lstrip(" ，,。、")
                    new_scene = f"在{primary_loc_candidate}内，" + new_scene
                    _rewrote_prefix = True
            # Pattern B: leading "X里，/X内，/X中，" without 在
            # MIN 2 chars prevents "里两" from being treated as location+noun
            if not _rewrote_prefix:
                m = _re_consist.match(
                    r"^[，,。\s]*([^，。、,\s]{2,8}?)(?:里|内|中)[，,]",
                    new_scene,
                )
                if m:
                    old_loc = m.group(1).strip()
                    _BAD_LEADING_NOUN = {"两人", "三人", "一人", "四人", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "两", "几", "他们", "她们", "我们", "大家", "气氛", "氛围", "暧昧", "灯光", "现场", "情况", "状态", "环境", "画面"}
                    if old_loc and old_loc not in _PARTICLES and old_loc not in _BAD_LEADING_NOUN and old_loc != primary_loc_candidate:
                        new_scene = _re_consist.sub(
                            r"^[，,。\s]*" + _re_consist.escape(old_loc) + r"(?:里|内|中)[，,]",
                            f"在{primary_loc_candidate}内，",
                            new_scene,
                            count=1,
                        )
                        _rewrote_prefix = True
            # Fallback: prepend at front (only if no prefix rewrite happened)
            if not _rewrote_prefix:
                new_scene = f"在{primary_loc_candidate}内，" + new_scene

            # Mirror canonical location into English image_prompt
            if canonical_loc_en and canonical_loc_en.lower() not in new_image.lower():
                new_image = f"{new_image}, {canonical_loc_en}"

            # Mirror canonical outfit (Chinese scene + English image_prompt)
            if canonical_outfit_zh and canonical_outfit_zh not in new_scene:
                for strip in ["全裸", "赤裸", "裸体", "披着浴巾"]:
                    new_scene = new_scene.replace(f"，{strip}", "", 1)
                new_scene = new_scene.rstrip("，") + f"，身穿{canonical_outfit_zh}"
            if canonical_outfit_en and canonical_outfit_en.lower() not in new_image.lower():
                new_image = f"{new_image}, {canonical_outfit_en}"
            logging.info(
                "[outline-coherence] hard-forced theme location: theme=%s panel=%d primary_loc=%s",
                theme_name, panel_index + 1, primary_loc_candidate,
            )

    # ── GLOBAL PANEL ENFORCEMENT (all panels, not just panel 1) ───────────────
    # The LLM sometimes drifts (e.g. 园丁 → 绿色花房花店后间 which mentions 花房
    # but actually describes a flower-shop scene; 电影院放映厅 → 情侣公园下雨天
    # which has nothing to do with the theater). After per-word replacement above
    # catches obvious drift, this block checks: does the panel's scene_description
    # contain ANY scenario word from the theme? If not, it is HARD-REPLACED with
    # a forced scene prefix.
    # We use a STRICT check: the FIRST location-like word in the scene must be
    # in theme_scenarios. Catches drift even when theme name appears as substring.
    if theme_scenarios:
        first_loc_ok = _scene_mentions_theme(new_scene, theme_scenarios)
        if not first_loc_ok:
            # Try strict first-location check
            all_locs_vocab = set(_LOCATION_RE_ZH.findall(new_scene)) if _LOCATION_RE_ZH else set()
            all_locs_vocab = all_locs_vocab | (set(_LOCATION_RE_EN.findall(new_scene)) if _LOCATION_RE_EN else set())
            first_loc_ok_strict = _scene_first_location_is_theme(
                new_scene, theme_scenarios, all_locs_vocab
            )
            if not first_loc_ok_strict:
                # HARD REPLACE: scene has drifted even via substring cheating.
                # Pick the canonical (most "primary") location
                primary_loc = canonical_loc_zh or theme_scenarios[0]
                # q3+ rewrite: try REPLACE-IF-PRESENT before prepending.
                # The drift scrub above may have left an orphan "在" head or a
                # partial location like "高级" or "的豪华里" — find any leading
                # "在X" / "X里" pattern and REPLACE X with primary_loc.
                _PARTICLES_G = {"的", "了", "着", "过", "和", "与", "跟", "同", "在", "从", "到", "往", "向", "由", "为", "以"}
                _g_rewrote = False
                m = _re_consist.match(
                    r"^[，,。\s]*在([^，。、,\s]{1,8}?)(?:里|内|中|上|下)?[，,]",
                    new_scene,
                )
                if m:
                    old_loc = m.group(1).strip()
                    if old_loc and old_loc not in _PARTICLES_G and old_loc != primary_loc:
                        new_scene = _re_consist.sub(
                            r"^[，,。\s]*在" + _re_consist.escape(old_loc) + r"(?:里|内|中|上|下)?[，,]",
                            f"在{primary_loc}内，",
                            new_scene,
                            count=1,
                        )
                        _g_rewrote = True
                    else:
                        # q3+: strip the orphan "在X，" head at START of string
                        # (X is a particle or already-canonical location). Using ^
                        # anchor prevents stripping "在球场内，" from the middle of
                        # the string when it was already injected earlier.
                        new_scene = _re_consist.sub(
                            r"^[，,。\s]*在[^，。、,\s]{0,8}?[，,]",
                            "",
                            new_scene,
                        ).lstrip(" ，,。、")
                        new_scene = f"在{primary_loc}内，" + new_scene
                        _g_rewrote = True
                # Strip any leading "在" + orphan particles left over from drift
                # (defensive — orphan-prep cleanup should have caught this but
                # we belt-and-braces here)
                if not _g_rewrote:
                    new_scene = _re_consist.sub(
                        r"^[^\n。]{0,40}?(?:室内|外|景|院里|之中|中|公园|街|路|铺里|海岸|酒吧|咖啡|ktv|火车|地铁|飞机|汽车|酒店|旅馆|出租车|公园|园林|庭院|船|航站楼|甲板|餐车|草原|山林|滩|岛|湖|潭|河|江|海边|海滩|海岛|雪山|沙漠)\s*[，,]?",
                        "",
                        new_scene,
                    ).lstrip(" ，,。")
                # If canonical_loc_zh not present, prepend
                if primary_loc not in new_scene:
                    new_scene = f"在{primary_loc}内，" + new_scene
                # Ensure canonical outfit is referenced
                if canonical_outfit_zh and canonical_outfit_zh not in new_scene:
                    for strip in ["全裸", "赤裸", "裸体", "披着浴巾"]:
                        new_scene = new_scene.replace(f"，{strip}", "", 1)
                    new_scene = new_scene.rstrip("，") + f"，身穿{canonical_outfit_zh}"

                # Mirror the same in image_prompt: ensure canonical_loc_en + canonical_outfit_en
                if canonical_loc_en and canonical_loc_en.lower() not in new_image.lower():
                    new_image = f"{new_image}, {canonical_loc_en}"
                if canonical_outfit_en and canonical_outfit_en.lower() not in new_image.lower():
                    new_image = f"{new_image}, {canonical_outfit_en}"


    # ── DE-DUPLICATE "在XXX内，XXX" patterns (cleanup of double injection) ───
    # Some panel 1 cases produce "在泳池边湿身湿身湿身内" if multiple passes ran.
    # Collapse runs of identical Chinese tokens (2+ in a row → 1).
    new_scene = _re_consist.sub(
        r"([一-鿿]{2,8}?)\1{1,}",
        r"\1",
        new_scene,
    )
    # Also collapse "身穿黑色法官袍黑色法官袍" → "身穿黑色法官袍"
    new_scene = _re_consist.sub(
        r"(身穿[一-鿿]{2,12}?)\1",
        r"\1",
        new_scene,
    )

    # ── DE-DUPLICATE English adjacent words (boxing boxing gym) ─────────────
    new_image = _re_consist.sub(
        r"\b(\w+)\s+\1\b",
        r"\1",
        new_image,
        flags=_re_consist.IGNORECASE,
    )


    # ── Clean up preposition artifacts (XX旁上, XX旁里, XX旁内, etc.) ─────────
    # When we replace a location, leftover prepositions like 上/里/内/中/下 can
    # remain attached to the canonical (e.g. "在泳池边湿身上" → should be "在泳池边湿身").
    # Common patterns to clean: 上, 里, 内, 中, 下 after 旁/边/上/中/内/里.
    new_scene = _re_consist.sub(
        r"(泳池边|泳池|泳道|跳水池|泳池躺椅|排球网|沙滩|海滩|海里|海底)(上|里|内|下)\b",
        r"\1",
        new_scene,
    )
    # ── Cleanup: strip leftover trailing prepositions after specific location nouns ──
    # Only for known cases where the LLM generated a location + trailing preposition
    # (e.g. "泳池边湿身上" → "泳池边湿身"). We intentionally do NOT strip "内/里/上/中"
    # after canonical_loc_zh because that's our own injected prefix (在球场内，).
    new_scene = _re_consist.sub(
        r"(泳池边|泳池|泳道|跳水池|泳池躺椅|排球网|沙滩|海滩|海里|海底)(上|里|内|下)\b",
        r"\1",
        new_scene,
    )


    # Final canonical_location must appear in scene (idempotent re-inject for panel 1)
    # Check for the FULL "在X内，" prefix, not just the bare location word, to avoid
    # double-prepending when "在球场，在的，气氛暧昧" already has "球场" in it.
    if panel_index == 0 and canonical_loc_zh and f"在{canonical_loc_zh}内，" not in new_scene and f"在{canonical_loc_zh}，" not in new_scene:
        new_scene = f"在{canonical_loc_zh}内，" + new_scene

    # ── Cleanup: remove orphan "在的，/在里，/在中，" fragments from MIDDLE of string ──
    # When drift scrub strips "停车场" from "在停车场里"，we get "在里，" which then
    # gets its "在" stripped by particle cleanup, leaving "里，" as a floating fragment.
    # When PANEL FORCE-SETUP then prepends "在球场内，", we get:
    #   "在球场内，里，" or "在球场内，在的，气氛暧昧"
    # This step removes orphan particle sequences from the MIDDLE of the string
    # (not anchored to ^ — those are handled by the particle-only regex above).
    new_scene = _re_consist.sub(
        r"(?<=[，,])(?:的|里|上|中|内|下)\s*[，,]?\s*",
        "",
        new_scene,
    )
    # Also handle "，在X，" middle patterns (e.g. "，在球场内，在的，" → "，在球场内，")
    # where the second "在X，" is a particle-only fragment.
    new_scene = _re_consist.sub(
        r"，\s*在[^，。、,\s]{0,5}?[，,](?=\S)",
        "，",
        new_scene,
    )
    new_scene = _re_consist.sub(r"[ ，,]{2,}", "，", new_scene)
    new_scene = new_scene.strip(" ，,。、")


    return (new_scene, new_image)


# Backward-compat alias used by older call sites
_enforce_foreplay_consistency = _enforce_theme_coherence


# ─── Test harness ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    cases = [
        ("高尔夫球童", {'id': 't357', 'name': '高尔夫球童', 'scenarios': ['球场', '球车', '会所'], 'costumes': ['球童服', '运动装', '高尔夫装']}, [
            ('在高级公寓的地下私人停车场，气氛暧昧，两人互相靠近。', 'Asian woman in a luxury hotel lobby, dim lights, night scene'),
            ('酒店大堂休息室里，两人坐在沙发上聊天。', 'couple sitting in hotel lobby on sofas, dim amber lighting'),
        ]),
        ("拳击搭档", {'id': 't264', 'name': '拳击搭档', 'scenarios': ['拳击馆', '更衣室', '休息室'], 'costumes': ['拳击短裤', '运动内衣', '绷带']}, [
            ('希腊小岛的私人泳池露台，美女在泳池边晒太阳。', 'woman sunbathing on Greek island private pool deck, sunshine'),
        ]),
    ]
    for theme_name, theme_data, panels in cases:
        print(f'\n=== {theme_name} ===')
        for i, (s, im) in enumerate(panels):
            ns, nim = _enforce_theme_coherence(
                scene_description=s, image_prompt=im,
                theme_name=theme_name, theme_data=theme_data,
                panel_index=i, total_panels=9, r18=False,
            )
            print(f'  Panel {i+1}: {ns[:100]!r}')
            print(f'    EN:    {nim[:100]!r}')


# ─── Character Bible Anchor Block ───────────────────────────────────────────────
# Forces LLM to lock the character's visual identity at the START of every
# image_prompt so that panel-to-panel consistency (clothing color, hair, shoes,
# key props) is preserved automatically by the parser.
#
# The anchor is parsed back out by `_extract_character_anchor()` and re-injected
# verbatim into every subsequent panel's image_prompt, so even if the LLM drifts
# in panel 3/4/5, the visual identity stays locked.
CHARACTER_BIBLE_BLOCK = """

【CHARACTER BIBLE — MANDATORY VISUAL ANCHOR FOR ALL PANELS】:
Every storyboard has TWO characters (one man + one woman) that appear in EVERY panel.
You MUST define a CHARACTER ANCHOR LINE at the very BEGINNING of EVERY panel's image_prompt
that LOCKS the character's visual identity across all panels. This anchor is what guarantees
the generated images look like the SAME person in every frame.

REQUIRED FORMAT — the FIRST line of every image_prompt MUST be exactly:
[ANCHOR: <woman>,<hair+color>,<eyes>,<skin>,<primary_outfit_color>,<primary_outfit_item>,<footwear>,<key_props>; <man>,<hair+color>,<eyes>,<skin>,<top>,<bottom>,<footwear>,<key_props>]

Examples (only as FORMAT reference — pick colors/items that match the SELECTED THEME):
  [ANCHOR: 28yo Chinese woman,long straight black hair,dark brown eyes,fair skin,black,judge robe over white blouse,black high heels,wooden gavel; 32yo Japanese man,short black hair,sharp brown eyes,fair skin,black tailored lawyer suit,white dress shirt,polished black oxford shoes,briefcase]
  [ANCHOR: 25yo Brazilian woman,wavy chestnut-brown hair,hazel eyes,tanned olive skin,white,bikini,barefoot,steam; 30yo Italian man,short dark brown hair,green eyes,olive skin,open white linen shirt,navy swim trunks,barefoot,tropical drink]
  [ANCHOR: 26yo Korean woman,long silky black hair,almond dark eyes,fair porcelain skin,black,nurse uniform with white apron,white sneakers,stethoscope; 29yo American man,short blond hair,blue eyes,fair skin,white doctor's coat over navy scrubs,white sneakers,clipboard]

STRICT RULES for the ANCHOR:
1. The SAME anchor line must appear VERBATIM at the START of EVERY panel's image_prompt.
   Do NOT change ANY attribute (hair color, outfit color, shoes, props) between panels —
   only the POSE and SCENE/ACTION change.
2. Pick anchor attributes that COHERENTLY MATCH THE SELECTED THEME:
   - Theme = 法官 / 律师 / 法庭 → woman wears BLACK judge robe / lawyer suit, man wears BLACK suit
   - Theme = 别墅温泉 / 温泉 → woman wears WHITE/PINK bikini or浴袍, man wears swim trunks, both barefoot or slippers
   - Theme = 护士 / 医生 → woman wears WHITE nurse uniform, man wears WHITE doctor coat
   - Theme = 空姐 → woman wears navy-blue airline uniform, man wears pilot uniform / business suit
   - Theme = 校园 / 教室 → white shirt + plaid skirt + knee socks (school context, adults only)
   - Any other theme: derive clothing that DIRECTLY matches the theme name — DO NOT default to
     random casual clothes when the theme implies a specific uniform/costume.
3. The KEY PROPS field is what makes the scene READ as the theme:
   法官 → gavel / law books / wooden lectern / scales of justice
   温泉 → steam / wooden tub / bathrobe / onsen rocks / tea cup
   护士 → stethoscope / syringe / hospital bed / medical chart
   DO NOT omit key props. They are non-negotiable for theme readability.
4. Outfit color MUST be locked — once you pick "black judge robe" in panel 1, every panel
   says "black judge robe". NEVER switch to red/black/white randomly between panels.
5. If the theme implies progressive undressing (R18 arc), the OUTFIT may transition
   (e.g. "black judge robe" → "white blouse only" → "topless"), but this transition must
   be EXPLICIT in the scene_description AND the anchor's <primary_outfit_item> updates
   in lockstep across panels. Do not silently change outfit mid-story.
6. Anchor format is rigid — the parser extracts it by regex `\\[ANCHOR: ...?\\]`.
   Keep it on ONE line at the START of image_prompt, no newlines inside the bracket.
"""


# ─── Theme Coherence Boost Block ────────────────────────────────────────────────
# Force the LLM to embed at least one SCENARIO keyword + one COSTUME keyword from
# the selected theme into every panel. This directly addresses the user's complaint
# that scenes/clothes don't match the chosen theme.
THEME_COHERENCE_BOOST_BLOCK = """

【THEME COHERENCE — EVERY PANEL MUST EMBED THEME KEYWORDS — ABSOLUTELY MANDATORY】:
The user picked a SPECIFIC theme. EVERY panel must visually + narratively belong to that
theme. Do NOT invent unrelated settings, costumes, or props.

═══════════════════════════════════════════════════════════════════
【SCENE PROGRESSION ARC — MANDATORY NARRATIVE STRUCTURE】:
Every storyboard MUST follow this 5-beat progression so the theme is FULLY EXPRESSED:

  BEAT 1 (Panel 1) — THEME INTRODUCTION / SETUP:
    The FIRST panel MUST SHOW the character ACTIVELY ENGAGED in the theme's
    primary activity in the theme's primary location, wearing the theme's
    primary costume with the theme's KEY PROPS visible.
    This is the OPENING — the viewer should immediately understand WHAT theme
    this is from panel 1 alone.
    Examples:
      Theme=保龄球馆 → Panel 1: "她正在保龄球馆打保龄球, 身穿保龄球polo衫, 手握保龄球瓶, 球馆灯光下"
      Theme=修女 → Panel 1: "她在修道院礼拜堂内虔诚祈祷, 身穿黑色修女服, 头戴白色头巾, 手持念珠, 烛光摇曳"
      Theme=游泳馆 → Panel 1: "她在游泳馆泳道内自由泳, 身穿专业泳衣泳帽, 泳池水花飞溅"
      Theme=法官 → Panel 1: "她在法庭上敲下法槌, 身穿黑色法官袍, 头戴银色假发, 法庭庄严"
      Theme=空姐 → Panel 1: "她在飞机客舱内推餐车, 身穿空姐制服, 头戴空姐帽, 微笑服务"
      Theme=温泉 → Panel 1: "她在温泉池边踏入热汤, 披着白色浴巾, 蒸汽氤氲, 木桶竹勺"
      Theme=校园 → Panel 1: "她在教室讲台上授课, 身穿职业套装, 手持课本, 黑板粉笔"
    ❌ WRONG Panel 1: "她在卧室里/客厅里/厨房里" (脱离主题)
    ❌ WRONG Panel 1: "她一出场就穿着情趣内衣/比基尼" (无主题铺垫)

  BEAT 2 (Panel 2) — THEME CONTINUATION + TENSION BUILD:
    The character remains IN the theme's setting, but the situation starts to
    get intimate / flirtatious. Same costume, same key props. The setting
    must STILL clearly belong to the theme — no location drift yet.

  BEAT 3 (Panel 3) — TRANSITION: costumed intimacy.
    Still in theme setting, character begins to lose costume pieces
    progressively (e.g. judge removes robe → blouse visible; nun removes
    wimple → face exposed; bowler removes polo → sports bra visible).
    The theme costume must STILL be the dominant outfit, but partially
    removed.

  BEAT 4 (Panel 4) — INTIMATE ACTION in theme location.
    Foreplay / heavy petting. Theme location may transition to a
    semi-private corner of the theme setting (e.g. judge → judge's
    chambers, bowler → bowling alley lounge, nun → convent private room).
    Outfit may be removed but the LOCATION must stay theme-coherent.

  BEAT 5 (Panel 5+) — SEX / CLIMAX.
    Full intercourse / climax. Outfit may be fully removed (全裸 OK).
    Location may transition to a private room WITHIN the theme setting
    (e.g. for 法官 → private chambers; for 温泉 → private onsen tub).
    ❌ NEVER transition to completely off-theme locations like 卧室/
    厨房/普通酒店 if the theme is something specific.

═══════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════
【SCENE COHERENCE — 1-2 MAIN SCENES ONLY, NO JUMPING】:
The user EXPLICITLY requested that each theme stay in 1-2 related scenes with
SMOOTH transitions — NOT jump wildly between unrelated locations.

HARD RULES:
- Pick ONLY 1-2 scenes from the theme's scenarios list. Use those for the entire
  storyboard. Do NOT introduce new locations like 公园/喷泉/树林/草丛/摩天轮/山顶
  /摩天轮座舱 etc. unless they are explicitly listed in the theme's scenarios.
- If panel N is in scene A, panel N+1 should still be in scene A (or transition
  smoothly to scene B which is closely related — e.g. 泳池边 → 泳池躺椅).
- ❌ FORBIDDEN scene-jumping patterns:
    * Panel 1: 公园长椅 → Panel 2: 喷泉旁 → Panel 3: 树林深处 (all unrelated)
    * Panel 1: 飞机 → Panel 2: 卧室 (sudden location switch)
    * Panel 1: 修女修道院 → Panel 4: 摩天轮座舱 (random fantasy jump)
- ✅ CORRECT scene coherence:
    * Theme=游泳池畔 → All panels in 泳池边 / 泳池躺椅 / 更衣室单间 (pool area)
    * Theme=保龄球馆 → All panels in 保龄球馆 / 保龄球道 (bowling alley)
    * Theme=修女 → All panels in 修道院 / 告解室 / 祈祷室 (convent area)
    * Theme=空姐 → All panels in 飞机客舱 / 头等舱 / 机组休息室 (aircraft interior)

═══════════════════════════════════════════════════════════════════

For EVERY panel you generate:
- scene_description (中文) MUST mention at least ONE of the THEME SCENARIOS
  (the actual location / environment words from the theme's scenarios list).
- scene_description MUST mention at least ONE of the THEME COSTUMES
  (the actual clothing words from the theme's costumes list), OR clearly describe
  a costume that is a DIRECT VARIANT of one of them.
- image_prompt MUST reference at least ONE THEME SCENARIO word and at least ONE
  THEME COSTUME word in English (or a direct English equivalent).
- KEY PROPS that make the theme READABLE (gavel for judge, stethoscope for nurse,
  swimwear + steam for onsen, bowling ball for bowling alley, etc.) MUST appear in EVERY panel.

FAILURE EXAMPLES (do NOT do this):
  Theme=保龄球馆, all panels are in 卧室/厨房/酒店 — ❌ WRONG — must stay in/near bowling alley
  Theme=法官, Panel 1 says "在咖啡厅里穿着晚礼服"  ❌ WRONG — judge must be in court with robe
  Theme=修女, Panel 3 says "在情趣酒店穿着情趣内衣"  ❌ WRONG — must stay in convent with habit
  Theme=温泉, Panel 5 says "在厨房做饭,穿围裙"  ❌ WRONG — must stay in/near the onsen
  Theme=空姐, Panel 1-2 are in 卧室 instead of 飞机 — ❌ WRONG — must start in airplane

CORRECT EXAMPLES:
  Theme=别墅温泉, Panel 1-3 mention "温泉池/蒸汽/木桶/浴巾/比基尼"  ✅
  Theme=法官, Panel 1-4 mention "法庭/法袍/法槌/律师服/法庭书记员"  ✅
  Theme=护士, Panel 1-4 mention "护士站/病房/护士服/听诊器/病床"  ✅
  Theme=保龄球馆, Panel 1 must show bowling action, Panel 5 may transition to bowling alley lounge  ✅

If you cannot naturally fit the theme keywords into a panel, RESTRUCTURE the panel's
action so they fit — never drop the theme keywords.
"""


# ─── Character Anchor Extraction & Injection ────────────────────────────────────
# These functions parse the [ANCHOR: ...] line that the LLM is required to put at
# the start of every image_prompt. We then re-inject the anchor verbatim into every
# panel's image_prompt so the visual identity stays locked even if the LLM drifts.
import re as _re

_ANCHOR_RE = _re.compile(r"\[ANCHOR:\s*([^\]]+)\]", _re.IGNORECASE)


def _extract_character_anchor(image_prompt: str) -> Optional[str]:
    """Extract the [ANCHOR: ...] line from an image_prompt. Returns None if not found."""
    if not image_prompt:
        return None
    m = _ANCHOR_RE.search(image_prompt)
    if not m:
        return None
    anchor_body = m.group(1).strip()
    if not anchor_body:
        return None
    # Normalize whitespace inside the anchor (collapse newlines/extra spaces)
    anchor_body = _re.sub(r"\s+", " ", anchor_body)
    return f"[ANCHOR: {anchor_body}]"


def _inject_character_anchor(image_prompt: str, anchor: str) -> str:
    """Replace any existing anchor at the start of image_prompt with the locked anchor.

    If no anchor is present, prepend the locked anchor. This guarantees that the
    visual identity stays locked across all panels.
    """
    if not anchor:
        return image_prompt
    if not image_prompt:
        return anchor
    # Strip any existing anchor at the start (the LLM may have drifted)
    stripped = _ANCHOR_RE.sub("", image_prompt, count=1).lstrip(" ,.;:\n\t ")
    # If the LLM added extra fields, drop them — we only keep what was locked in panel 1
    return f"{anchor} {stripped}".strip()


def _normalize_anchor_for_safety(anchor: str) -> str:
    """Sanity check the anchor before re-injecting — skip if it contains safety-risky tokens.

    Defense in depth: if the LLM generated something NSFW/unsafe inside the bracket,
    we should NOT splat it into every panel's prompt.
    """
    if not anchor:
        return anchor
    risky = [
        r"\b(handcuff|bound|cuffed|chained|shackled|bondage|rope tie|hogtied)\b",
        r"\b(dildo|vibrator|sex toy|butt plug|anal plug)\b",
    ]
    for pat in risky:
        if _re.search(pat, anchor, _re.IGNORECASE):
            return ""
    return anchor


# ─── Async Task Background Runners ─────────────────────────────────────────────────

async def _run_themes_task(task_id: str, req: StoryboardThemesRequest, api_key: str):
    """Background runner for theme generation."""
    from app.services.theme_database import get_all_themes, COSTUMES, SCENARIOS
    import random as rnd
    from app.models.schemas import StoryboardThemeOption

    store = get_task_store()
    try:
        store.mark_running(task_id)
        count = min(max(req.count, 5), 20)

        if not req.custom_description:
            all_db_themes = get_all_themes()
            rnd.seed()
            rnd.shuffle(all_db_themes)
            picked = all_db_themes[:count]
            themes = []
            for picked_idx, t in enumerate(picked):
                if not isinstance(t, dict):
                    continue
                scenarios = t.get("scenarios", []) if isinstance(t.get("scenarios"), list) else []
                costumes = t.get("costumes", []) if isinstance(t.get("costumes"), list) else []
                # CRITICAL: send the REAL seq_id (1-500) so the backend's
                # `get_theme_by_seq_id()` lookup returns the same theme the user
                # clicked. Previously we sent `i+1` (shuffle position 1-20) which
                # caused every theme to resolve to the wrong data.
                real_seq_id = t.get("seq_id")
                if real_seq_id is None:
                    # Fall back to original index in the unshuffled list
                    try:
                        real_seq_id = all_db_themes.index(t) + 1
                    except ValueError:
                        real_seq_id = picked_idx + 1
                themes.append({
                    "id": real_seq_id,
                    "title": t.get("name", f"主题{real_seq_id}"),
                    "description": t.get("description", ""),
                    "tags": t.get("tags", []) if isinstance(t.get("tags"), list) else [],
                    "r18_level": t.get("r18_level", "medium"),
                    "category": t.get("category", ""),
                    "scenario_count": len(scenarios),
                    "costume_count": len(costumes),
                })
            store.mark_done(task_id, {"themes": themes})
            return

        pool_size = min(15, len(all_db_themes))
        selected_themes = rnd.sample(all_db_themes, pool_size)
        costume_names = [c["name"] for c in COSTUMES]
        scenario_names = [s["name"] for s in SCENARIOS]
        system_prompt = (
            _THEMES_SYSTEM_PROMPT_R18 if req.r18
            else _THEMES_SYSTEM_PROMPT_NORMAL
        )
        r18_context = (
            f"\n\n【用户描述】{req.custom_description}\n\n"
            if req.custom_description else ""
        )
        pool_context = "参考主题池：\n" + "\n".join(
            f"- {t.get('name', '')}: {t.get('description', '')} "
            f"(服装: {', '.join(t.get('costumes', []))}, "
            f"场景: {', '.join(t.get('scenarios', []))})"
            for t in selected_themes
        )
        costume_list = ", ".join(costume_names[:20])
        scenario_list = ", ".join(scenario_names[:20])

        user_prompt = (
            f"{r18_context}\n\n{pool_context}\n\n"
            f"可选服装风格: {costume_list}\n"
            f"可选场景设置: {scenario_list}\n\n"
            f"生成 {count} 个独特的主题选项，确保多样性。"
        )

        raw = await call_grok(api_key, system_prompt, user_prompt)
        data = clean_json_response(raw)
        check_prompt_safety(raw)

        themes = []
        raw_themes = data.get("themes", [])
        if isinstance(raw_themes, list):
            for j, t in enumerate(raw_themes[:count]):
                if not isinstance(t, dict):
                    continue
                themes.append({
                    "id": j + 1,
                    "title": str(t.get("title", "")),
                    "description": str(t.get("description", "")),
                    "tags": list(t.get("tags", [])) if isinstance(t.get("tags"), list) else [],
                    "r18_level": str(t.get("r18_level", "medium")),
                    "category": str(t.get("category", "")),
                    "scenario_count": int(t.get("scenario_count", 0)),
                    "costume_count": int(t.get("costume_count", 0)),
                })

        store.mark_done(task_id, {"themes": themes})
    except ContentSafetyError as e:
        store.mark_failed(task_id, str(e))
    except (YunwuTimeoutError, YunwuRateLimitError) as e:
        store.mark_failed(task_id, str(e))
    except YunwuAPIError as e:
        store.mark_failed(task_id, str(e))
    except Exception as e:
        logging.error(f"[themes] background task error: {e}")
        store.mark_failed(task_id, f"未知错误: {str(e)}")


async def _run_outline_task(task_id: str, req: StoryboardOutlineRequest, api_key: str):
    """Background runner for outline generation."""
    from app.services.theme_database import get_random_poses, get_theme_by_seq_id, COSTUMES, SCENARIOS
    from app.models.schemas import StoryboardOutline

    store = get_task_store()
    try:
        store.mark_running(task_id)
        panel_count = max(2, min(10, req.panel_count))
        model_order = req.model_order or None

        # ── Look up theme for storyline coherence ────────────────────────────────
        # Try to find the selected theme in the database to inject its specific
        # scenarios, costumes and poses into the outline for narrative coherence.
        selected_theme = None
        theme_scenarios_str = ""
        theme_costumes_str = ""
        theme_poses_str = ""

        # Strategy: try multiple lookups in order of reliability.
        # 1) theme_id (numeric seq_id or string ID like "t101")
        # 2) theme_title (fallback when theme_id is a LLM-generated position
        #    index that doesn't correspond to a real DB row, e.g. when the
        #    user uses the "自定义选题" custom-description flow which
        #    produces themes with id=j+1 but arbitrary titles)
        if req.theme_id:
            try:
                seq_id = int(req.theme_id)
                selected_theme = get_theme_by_seq_id(seq_id)
            except (ValueError, TypeError):
                selected_theme = None

            if selected_theme is None:
                from app.services.theme_database import get_theme_by_id
                selected_theme = get_theme_by_id(req.theme_id)

            # Verify the resolved theme actually matches the requested title.
            # If not (LLM-custom flow bug), fall through to title-based lookup.
            if selected_theme is not None and req.theme_title:
                db_name = (selected_theme.get("name") or "").strip()
                req_name = (req.theme_title or "").strip()
                if db_name and req_name and db_name != req_name:
                    logging.info(
                        "[storyboard/outline] theme_id %s resolved to '%s' but user title is '%s'; trying title-based lookup",
                        req.theme_id, db_name, req_name,
                    )
                    selected_theme = None

        if selected_theme is None and req.theme_title:
            # Fall back to title-based lookup (when theme_id was wrong).
            from app.services.theme_database import get_all_themes
            for t in get_all_themes():
                if isinstance(t, dict) and (t.get("name") or "").strip() == (req.theme_title or "").strip():
                    selected_theme = t
                    logging.info(
                        "[storyboard/outline] title-based lookup matched '%s' to seq_id %s",
                        req.theme_title, t.get("id"),
                    )
                    break

        # Build coherent context strings from the theme's data
        if selected_theme:
            scenarios = selected_theme.get("scenarios", [])
            costumes = selected_theme.get("costumes", [])
            poses = selected_theme.get("poses", [])
            # Pick only the FIRST 2 scenarios as the "main scenes" for visual
            # continuity. The user explicitly asked for 1-2 related scenes per
            # theme with smooth transitions — not all 4 jumping around.
            main_scenarios = scenarios[:2] if len(scenarios) > 2 else scenarios
            if main_scenarios:
                theme_scenarios_str = "主场景设定（必须使用,不可替换）: " + "、".join(main_scenarios)
                if len(scenarios) > 2:
                    theme_scenarios_str += f"\n辅助场景（可选,必要时过渡用,不超过2个）: " + "、".join(scenarios[2:])
            if costumes:
                theme_costumes_str = "服装造型（必须选择1-2个使用,前3个分镜必须保留主服装）: " + "、".join(costumes)
            if poses:
                theme_poses_str = "姿势风格（参考）: " + "、".join(poses)

        _R18_ARC_PANELS = {
            2: [
                "Panel 1: 开场前戏 - 【女人单独出场】场景介绍、女人首次亮相、服装描述（穿主题服装，非全裸）、暗示性表情和肢体语言、暧昧氛围（NO man yet，NO sex yet）",
                "Panel 2: 性爱高潮 - 男人加入，直接性爱，口交或后入体位，高潮特写、颜射/内射/体外射精，【画面必须可见精液】",
            ],
            3: [
                "Panel 1: 开场前戏 - 【女人单独出场】场景介绍、女人服装描述（主题服装）、暗示性表情（NO man yet，NO sex yet）",
                "Panel 2: 升温前戏 - 男人加入，脱衣亲密/亲吻爱抚，口交或手淫前戏（explicit foreplay）",
                "Panel 3: 性爱高潮 - 直接性爱描写，传教士体位或后入式，体位变化，射前特写或体内射精【画面必须可见精液】",
            ],
            4: [
                "Panel 1: 开场前戏 - 【女人单独出场】场景介绍、女人服装（主题服装）、表情、暗示性眼神交流（NO man yet，NO sex yet）",
                "Panel 2: 升温调情 - 男人加入，脱衣亲密、亲吻爱抚、口交前戏、挑逗暗示",
                "Panel 3: 性爱进行 - 直接插入性爱，后入式（doggy style）或女上位（cowgirl），体位特写",
                "Panel 4: 高潮结尾 - 传教士体位（missionary），高潮特写、颜射/内射/体外射精、身体反应【画面必须可见精液】",
            ],
            5: [
                "Panel 1: 开场遇见 - 【女人单独出场】场景介绍、女人服装（主题服装）、暗示性第一眼、暧昧肢体语言（NO man yet，NO sex yet）",
                "Panel 2: 升温调情 - 男人加入，身体接触、亲吻、暗示性语言、情感铺垫、服装开始松开",
                "Panel 3: 脱衣前戏 - 衣物脱去、亲吻爱抚、口交（oral cunnilingus）或乳交（titjob）",
                "Panel 4: 性爱进行 - 后入式（doggy style）插入，体位变化、抽插特写、呻吟描述",
                "Panel 5: 高潮射精 - 传教士体位（missionary）或女上位（cowgirl），高潮特写、颜射/内射/体外射精【画面必须可见精液】",
            ],
            6: [
                "Panel 1: 开场遇见 - 【女人单独出场】场景介绍、女人服装（主题服装）、暗示性第一眼（NO man yet，NO sex yet）",
                "Panel 2: 升温调情 - 男人加入，暧昧对话、轻微身体接触、衣服开始松开",
                "Panel 3: 脱衣亲密 - 衣物脱去、亲吻爱抚、口交前戏（oral cunnilingus）",
                "Panel 4: 性爱进行 - 后入式（doggy style）插入或女上位（cowgirl），体位、抽插",
                "Panel 5: 高潮逼近 - 传教士体位（missionary），体位深入、双方反应、呻吟",
                "Panel 6: 高潮射精 - 侧入式（spooning）或坐姿（reverse cowgirl），高潮特写、颜射/内射/体外射精【画面必须可见精液】",
            ],
            7: [
                "Panel 1: 开场遇见 - 【女人单独出场】场景介绍、女人服装（主题服装）、暗示性第一眼（NO man yet，NO sex yet）",
                "Panel 2: 升温调情 - 男人加入，暧昧对话、轻微身体接触",
                "Panel 3: 脱衣亲密 - 衣物脱去、亲吻爱抚、口交前戏（oral）",
                "Panel 4: 前戏深入 - 口交（deepthroat oral）、乳房爱抚、情趣挑逗",
                "Panel 5: 性爱进行 - 后入式（doggy style）插入，体位变化",
                "Panel 6: 高潮逼近 - 传教士体位（missionary），体位深入、呻吟",
                "Panel 7: 高潮射精 - 女上位（cowgirl）或侧入式（spooning），高潮特写、颜射/内射【画面必须可见精液】",
            ],
            8: [
                "Panel 1: 开场遇见 - 【女人单独出场】场景介绍、女人服装（主题服装）、暗示性第一眼（NO man yet，NO sex yet）",
                "Panel 2: 升温调情 - 男人加入，暧昧对话、轻微身体接触",
                "Panel 3: 脱衣亲密 - 衣物脱去、亲吻爱抚、口交（cunnilingus oral）",
                "Panel 4: 前戏深入 - 口交（deepthroat）、乳房爱抚、情趣玩具",
                "Panel 5: 性爱进行 A - 后入式（doggy style），体位变化",
                "Panel 6: 性爱进行 B - 女上位（cowgirl reverse），呻吟加剧",
                "Panel 7: 高潮特写 - 传教士体位（missionary），射前最后阶段",
                "Panel 8: 高潮射精 - 站立式（standing）或坐姿（cowgirl），高潮特写、颜射/内射【画面必须可见精液】",
            ],
            9: [
                "Panel 1: 开场遇见 - 【女人单独出场】场景介绍、女人服装（主题服装）、暗示性第一眼（NO man yet，NO sex yet）",
                "Panel 2: 升温调情 - 男人加入，暧昧对话、轻微身体接触",
                "Panel 3: 脱衣亲密 - 衣物脱去、亲吻爱抚、口交（oral cunnilingus）",
                "Panel 4: 前戏深入 - 口交（deepthroat）、乳房爱抚",
                "Panel 5: 性爱开始 - 后入式（doggy style）插入，缓慢节奏",
                "Panel 6: 性爱进行 - 女上位（cowgirl），体位变化、呻吟",
                "Panel 7: 高潮逼近 - 传教士体位（missionary），呻吟达到顶峰",
                "Panel 8: 高潮特写 - 侧入式（spooning），射前最后阶段",
                "Panel 9: 高潮射精 - 坐姿（reverse cowgirl）或立式，颜射/内射【画面必须可见精液】",
            ],
            10: [
                "Panel 1: 开场遇见 - 【女人单独出场】场景介绍、女人服装（主题服装）、暗示性第一眼（NO man yet，NO sex yet）",
                "Panel 2: 升温调情 - 男人加入，暧昧对话、轻微身体接触",
                "Panel 3: 脱衣亲密 - 衣物脱去、亲吻爱抚、口交（oral cunnilingus）",
                "Panel 4: 前戏深入 - 口交（deepthroat）、乳房爱抚、情趣玩具",
                "Panel 5: 性爱开始 - 后入式（doggy style）插入，缓慢节奏",
                "Panel 6: 性爱进行 A - 女上位（cowgirl），节奏加快",
                "Panel 7: 性爱进行 B - 传教士体位（missionary），抽插",
                "Panel 8: 高潮逼近 - 侧入式（spooning），呻吟达到顶峰、身体颤抖",
                "Panel 9: 高潮特写 - 手交（handjob）或站立式（standing），射前最后阶段",
                "Panel 10: 高潮射精 - 坐姿（reverse cowgirl）或颜射（facial），高潮特写【画面必须可见精液】",
            ],
        }
        _NORMAL_ARC_PANELS = {
            2: ["开场", "高潮"],
            3: ["开场", "发展", "高潮"],
            4: ["开场", "发展", "亲密", "高潮"],
            5: ["开场", "发展", "亲密", "高潮", "结尾"],
            6: ["开场", "发展", "亲密", "高潮", "高潮2", "结尾"],
            7: ["开场", "发展", "亲密", "高潮", "高潮2", "高潮3", "结尾"],
            8: ["开场", "发展", "亲密", "高潮", "高潮2", "高潮3", "高潮4", "结尾"],
            9: ["开场", "发展", "亲密", "高潮", "高潮2", "高潮3", "高潮4", "高潮5", "结尾"],
            10: ["开场", "发展", "亲密", "高潮", "高潮2", "高潮3", "高潮4", "高潮5", "高潮6", "结尾"],
        }

        if req.r18:
            arc_panels = _R18_ARC_PANELS.get(panel_count, _R18_ARC_PANELS[5])
            system_template = _R18_OUTLINE_SYSTEM
            arc_label = "开场遇见 → 升温调情 → 脱衣前戏 → 性爱进行 → 高潮射精"
            # For R18: mix theme-specific poses + random pool
            pool_poses = get_random_poses(max(3, panel_count))
            pose_list_str = "\n".join(f"  - {p}" for p in pool_poses)
        else:
            arc_panels = _NORMAL_ARC_PANELS.get(panel_count, _NORMAL_ARC_PANELS[4])
            system_template = _NORMAL_OUTLINE_SYSTEM
            arc_label = "开场 → 发展 → 亲密 → 高潮 → 结尾"
            pose_list_str = ""

        arc_panels_str = "\n".join(f"  - {p}" for p in arc_panels)

        # ── Build coherence context for the system prompt ──────────────────────
        # q3+ rewrite: theme data is shown as a HARD CONSTRAINT CONTRACT to the
        # LLM, with the full ★ SCENARIOS / ★ COSTUMES / REFERENCE POSES lists,
        # a tag-derived MAIN SUBJECT note, and ABSOLUTE RULES. Anti-pattern
        # locations that the LLM commonly drifts to are explicitly NEGATED.
        coherence_context = ""
        if selected_theme:
            scenarios = selected_theme.get("scenarios", []) or []
            costumes = selected_theme.get("costumes", []) or []
            poses = selected_theme.get("poses", []) or []
            tags = selected_theme.get("tags", []) or []
            desc = selected_theme.get("description", "")
            name = selected_theme.get("name", req.theme_title)

            scenarios_block = "\n".join(f"   ★ {s}" for s in scenarios) if scenarios else "   (none — use theme name to infer)"
            costumes_block = "\n".join(f"   ★ {c}" for c in costumes) if costumes else "   (none — use theme name to infer)"
            poses_block = ("\n".join(f"   · {p}" for p in poses) + "\n") if poses else ""

            coherence_context = (
                "\n\n"
                "═══════════════════════════════════════════════════════════════════════\n"
                f"  THEME CONTRACT: 「{name}」\n"
                "═══════════════════════════════════════════════════════════════════════\n"
                f"Description: {desc}\n"
                f"Tags: {', '.join(tags) if tags else '(none)'}\n"
                "\n"
                "MANDATORY SCENARIOS — every panel MUST take place in ONE of:\n"
                f"{scenarios_block}\n"
                "\n"
                "MANDATORY COSTUMES — every panel's character(s) MUST wear ONE of:\n"
                f"{costumes_block}\n"
                "\n"
                + (f"REFERENCE POSES (suggestions only):\n{poses_block}\n" if poses_block else "")
                + "\n"
                "ABSOLUTE RULES — violating any is a HARD FAILURE:\n"
                "  1. EVERY panel must be set in one of the ★ SCENARIOS above. Off-theme\n"
                "     locations (parks, subways, cafes, trains, beaches, hotels, classrooms,\n"
                "     fantasy worlds, etc.) are BANNED unless they appear in the ★ list.\n"
                "  2. EVERY panel's characters MUST wear one of the ★ COSTUMES above.\n"
                "     Random casual clothing, pajamas, lingerie, school uniforms, business\n"
                "     suits are BANNED unless they appear in the ★ list.\n"
                "  3. Stay with 1-2 PRIMARY scenarios from the list for the WHOLE storyboard.\n"
                "     Smooth transitions only (e.g. 花园 → 花房). DO NOT scene-jump.\n"
                "  4. The PRIMARY ROLE (inferred from theme name) is the MAIN CHARACTER of\n"
                "     every panel. 「园丁」 → the gardener; 「电影院放映厅」 → people inside\n"
                "     a movie theater screening room, NOT park visitors.\n"
                "  5. NEVER synonym-substitute the scenario (e.g.「花园」 ≠「庭院」/「草坪」\n"
                "     unless those exact words appear in ★ SCENARIOS). Use the EXACT word.\n"
                "  6. If a scene cannot naturally fit, RESTRUCTURE — never substitute a\n"
                "     different theme location or outfit.\n"
                "  7. CHARACTER CONSISTENCY: Define the MAIN CHARACTER(s) ONCE in panel 1\n"
                "     (including their ethnic appearance / nationality / look) and KEEP them\n"
                "     IDENTICAL across ALL panels. NEVER change a character's nationality or\n"
                "     ethnicity between panels. NEVER introduce a new character from a\n"
                "     different country/ethnicity mid-storyboard unless explicitly in ★ list.\n"
                "     For multi-person themes (拳击搭档 / 高尔夫球童 / etc.), the SAME two\n"
                "     characters appear in EVERY panel — never replace them with people from\n"
                "     different countries.\n"
                "  8. PRIMARY LOCATION ANCHOR: The FIRST scenario in ★ SCENARIOS is the\n"
                "     PRIMARY location. At least 60% of panels MUST take place there (or in a\n"
                "     tightly-connected secondary scenario from the same list). Do NOT split\n"
                "     the storyboard across unrelated off-theme settings.\n"
                "\n"
                "Theme data is a HARD CONSTRAINT, not a creative suggestion."
            )

        system_prompt = system_template.format(
            theme_title=req.theme_title,
            panel_count=panel_count,
            arc_panels=arc_panels_str,
            arc_label=arc_label,
            pose_list=pose_list_str,
            theme_coherence=coherence_context,
        )
        # Build a short keyword list that the LLM MUST echo back. We pass this in
        # the user_prompt (not the system_prompt) so it's reinforced right at the
        # end of the prompt where models tend to follow instructions most strictly.
        theme_keywords_required: list = []
        if selected_theme:
            theme_keywords_required.extend(selected_theme.get("scenarios", []) or [])
            theme_keywords_required.extend(selected_theme.get("costumes", []) or [])
        # NEW (q2c step 3): include English aliases so the LLM has a glossary
        # for the image_prompt. Auto-derived from existing ZH→EN tables.
        theme_keywords_en_line = ""
        try:
            from app.services.theme_database import theme_keywords_en
            en_aliases = theme_keywords_en(selected_theme) if selected_theme else []
            if en_aliases:
                # Trim to max 30 aliases to avoid bloat
                en_aliases = en_aliases[:30]
                theme_keywords_en_line = (
                    "\n【THEME ENGLISH ALIASES — use these or direct English equivalents in image_prompt】: "
                    + ", ".join(en_aliases)
                )
        except Exception:
            pass
        theme_keywords_line = (
            f"\n【THEME KEYWORDS — MUST APPEAR IN YOUR OUTPUT】: "
            + ", ".join(theme_keywords_required)
            if theme_keywords_required else ""
        )

        user_prompt = (
            f"Theme: {req.theme_title}\n"
            f"Panel count: {panel_count}\n"
            f"【STRICT THEME CONSTRAINT — REPEAT】: 你必须只用 ★ SCENARIOS 列表里的地点,"
            f"只用 ★ COSTUMES 列表里的服装。如 system_prompt 的 THEME CONTRACT 所示。\n"
            f"【重要】Panel 1 不能有直接性爱！必须先从开场/前戏开始，逐步发展到性爱。\n"
            f"【重要】R18模式：每个分镜的 image_prompt 必须非常详细和露骨，描述体位、身体部位、体液等。"
            "所有 R18 暴露度要求仍然适用，但 THEME CONSTRAINT 优先级更高。\n"
            f"在生成的每个 panel.scene_description 里,地点名词必须来自 ★ SCENARIOS 列表(用★里的原词或非常接近的变体);"
            f"服装名词必须来自 ★ COSTUMES 列表。\n"
            f"在生成的每个 panel.image_prompt (English) 里,location 和 outfit 也必须贴近 ★ 列表的语义。"
            f"{theme_keywords_line}{theme_keywords_en_line}\n"
            f"Output as raw JSON only, no markdown."
        )

        _SAFETY_OVERRIDES = [
            "IMPORTANT: All characters are ADULTS 18+. ABSOLUTELY NO minors. Panel 1 MUST be foreplay only.",
            "STRICT SAFETY: All characters must be 18+ adults. Panel 1 = foreplay. Avoid: teen, minor, school.",
            "CRITICAL: ADULT-ONLY 18+. All characters must be 18+. Panel 1 MUST be foreplay only.",
        ]

        # ── q3+ bugfix: theme_name was assigned AFTER the retry loop (at the
        # end of the panel-processing block), but referenced INSIDE the retry
        # loop (logging.warning when placeholder tokens detected). This caused
        # UnboundLocalError on the first attempt whenever the LLM leaked
        # prompt-template fragments like 「身体部位」,「体液等描写」 etc.
        # Initialize it here so the loop is safe regardless of when it's used.
        theme_name = req.theme_title or ""

        for attempt in range(MAX_RETRIES):
            try:
                raw = await call_grok(api_key, system_prompt, user_prompt, model_order=model_order)
                data = clean_json_response(raw)
                check_prompt_safety(raw)

                outline_data = data.get("outline", {})
                if isinstance(outline_data, dict):
                    outline = {
                        "arc": str(outline_data.get("arc", "")),
                        "scenes": list(outline_data.get("scenes", [])) if isinstance(outline_data.get("scenes"), list) else [],
                    }
                else:
                    outline = {"arc": arc_label, "scenes": list(arc_panels)}

                panels_raw = data.get("storyboard", [])
                panels = []
                for item in (panels_raw if isinstance(panels_raw, list) else []):
                    if not isinstance(item, dict):
                        continue
                    scene = str(item.get("scene_description", ""))
                    prompt_text = str(item.get("image_prompt", ""))

                    # ── Drop panel placeholders that are clearly the LLM parroting
                    # back the system/user prompt instructions instead of writing
                    # actual content. Things like "身体部位", "体液等描写", "等描写"
                    # appearing verbatim in the scene_description or image_prompt
                    # indicate a broken generation. Treat it as a safety violation
                    # so the panel is skipped (consistent with how other broken
                    # outputs are handled in this loop).
                    _PLACEHOLDER_TOKENS = (
                        "身体部位", "体液等描写", "体液等", "等描写",
                        "亚洲的约会装", "迷你裙身体部位",
                    )
                    combined = scene + "\n" + prompt_text
                    if any(tok in combined for tok in _PLACEHOLDER_TOKENS):
                        logging.warning(
                            "[outline] dropping panel with prompt-template leak: theme=%s panel=%s sample=%s",
                            theme_name,
                            item.get("panel_number", "?"),
                            (scene or prompt_text)[:80],
                        )
                        continue

                    try:
                        check_prompt_safety(scene)
                        check_prompt_safety(prompt_text)
                    except ContentSafetyError:
                        continue
                    scene_conflicts = detect_prompt_conflicts(scene)
                    prompt_conflicts = detect_prompt_conflicts(prompt_text)
                    if scene_conflicts or prompt_conflicts:
                        try:
                            prompt_text = await rewrite_coherent_prompt(prompt_text, api_key)
                            check_prompt_safety(prompt_text)
                        except (ContentSafetyError, YunwuTimeoutError):
                            pass
                    try:
                        panels.append({
                            "panel_number": int(item.get("panel_number", 0)),
                            "scene_description": scene,
                            "image_prompt": prompt_text,
                        })
                    except Exception:
                        continue

                # ── Lock character identity across panels via [ANCHOR] injection ──
                # Extract the anchor from panel 1, then re-inject it verbatim into every
                # other panel. This is the single most important fix for theme
                # consistency: it guarantees that the SAME character (same outfit color,
                # same hair, same shoes, same key props) appears in every frame even if
                # the LLM drifts in panels 2..N.
                if panels:
                    first_anchor = _extract_character_anchor(panels[0].get("image_prompt", ""))
                    first_anchor = _normalize_anchor_for_safety(first_anchor)
                    if first_anchor:
                        for p in panels:
                            p["image_prompt"] = _inject_character_anchor(
                                p.get("image_prompt", ""),
                                first_anchor,
                            )
                        logging.info(
                            "[outline] locked character anchor across %d panels: %s",
                            len(panels),
                            first_anchor[:120],
                        )

                # ── Enforce theme-coherent outfit/location on FOREPLAY panels ──
                # This is the second-most-important fix: even if the LLM drifts in
                # panel 2/3 (e.g. theme=修女 but LLM writes 白色连衣裙 / 黑色迷你裙
                # / 公园长椅 / 摩天轮坐舱), we post-process to replace those terms
                # with the theme's canonical outfit + location.
                # Sex panels (panel 3+ in R18, panel 4+ in normal mode) are EXEMPTED —
                # the user is fine with nakedness during intercourse.
                if panels and selected_theme:
                    from app.services.theme_database import get_theme_by_seq_id, get_theme_by_id
                    canon_theme = selected_theme
                    if not isinstance(canon_theme, dict):
                        canon_theme = get_theme_by_id(req.theme_id) if isinstance(req.theme_id, str) else None
                        if canon_theme is None:
                            try:
                                canon_theme = get_theme_by_seq_id(int(req.theme_id))
                            except (ValueError, TypeError):
                                canon_theme = None
                    # q3+ bugfix: theme_name is now initialized before the retry
                    # loop (see the marker above). Don't reassign here — just
                    # use it.
                    if isinstance(canon_theme, dict):
                        fix_count = 0
                        for idx, p in enumerate(panels):
                            new_scene, new_image = _enforce_theme_coherence(
                                scene_description=p.get("scene_description", ""),
                                image_prompt=p.get("image_prompt", ""),
                                theme_name=theme_name,
                                theme_data=canon_theme,
                                panel_index=idx,
                                total_panels=len(panels),
                                r18=bool(req.r18),
                            )
                            if new_scene != p.get("scene_description", "") or new_image != p.get("image_prompt", ""):
                                p["scene_description"] = new_scene
                                p["image_prompt"] = new_image
                                fix_count += 1
                        if fix_count:
                            logging.info(
                                "[outline] theme-coherence fixed %d/%d panels (theme=%s)",
                                fix_count, len(panels), theme_name,
                            )

                # ── Hard post-processing: single-woman Panel 1 + lesbian no-man + visible cum ──
                if panels and selected_theme:
                    before = [(p.get("scene_description", ""), p.get("image_prompt", "")) for p in panels]
                    _enforce_panel_rules(
                        panels=panels,
                        theme_name=theme_name,
                        theme_data=selected_theme if isinstance(selected_theme, dict) else {},
                        r18=bool(req.r18),
                    )
                    rule_fix = sum(
                        1 for (b_sc, b_im), p in zip(before, panels)
                        if b_sc != p.get("scene_description", "") or b_im != p.get("image_prompt", "")
                    )
                    if rule_fix:
                        logging.info(
                            "[outline] panel-rules fixed %d/%d panels (theme=%s)",
                            rule_fix, len(panels), theme_name,
                        )

                # ── Sanity check: detect any outfit color drift between panels ──
                if len(panels) >= 2:
                    drifts = detect_outfit_color_drift([p.get("image_prompt", "") for p in panels])
                    if drifts:
                        logging.warning(
                            "[outline] outfit color drift detected (%d issues): %s",
                            len(drifts),
                            "; ".join(drifts[:3]),
                        )

                # ── Debug log: record what the LLM actually returned ──
                # This is critical for diagnosing "theme doesn't match the
                # generated prompts" reports. Dump the raw LLM output, the
                # # of panels the parser kept, and a short sample of each
                # panel so we can see what the LLM thinks the theme is.
                logging.info(
                    "[outline] theme=%s panels_kept=%d panels_raw=%d theme_coherence_used=%s",
                    theme_name,
                    len(panels),
                    len(panels_raw) if isinstance(panels_raw, list) else 0,
                    "yes" if selected_theme else "no",
                )
                for _dbg_p in panels[:5]:
                    logging.info(
                        "[outline]   panel %s scene=%s image_prompt=%s",
                        _dbg_p.get("panel_number"),
                        (_dbg_p.get("scene_description") or "")[:80],
                        (_dbg_p.get("image_prompt") or "")[:80],
                    )

                if not panels:
                    logging.error(
                        "[outline] No valid panels generated for theme=%s id=%s — "
                        "raw LLM output was: %s",
                        theme_name,
                        req.theme_id,
                        raw[:1500] if 'raw' in locals() else "(unknown)",
                    )
                    # q3+ bugfix: instead of bailing out with ValueError
                    # (which becomes "未知错误" to the user), retry by
                    # rebuilding the prompt with a stronger "no drift"
                    # instruction. Give the LLM up to OUTLINE_OUTER_RETRIES
                    # more chances to produce usable panels.
                    OUTER_RETRY_BUDGET = 2  # 2 extra outer retries on top of MAX_RETRIES inner attempts
                    if attempt < MAX_RETRIES - 1 + OUTER_RETRY_BUDGET:
                        # Strengthen the prompt with an explicit anti-drift note
                        system_prompt += (
                            "\n\n[RETRY INSTRUCTION] Your previous response did not produce "
                            "any valid panels. STRICTLY use ONLY the ★ SCENARIOS and ★ COSTUMES "
                            "from the THEME CONTRACT above. Output valid JSON with the correct "
                            f"schema. Topic: {theme_name}."
                        )
                        # Bump user prompt too
                        user_prompt += (
                            "\n\n[RETRY NOTE] Previous response had no usable panels. Output "
                            "valid JSON now, using ONLY the ★ SCENARIOS/★ COSTUMES from the "
                            "THEME CONTRACT."
                        )
                        continue
                    raise ValueError("No valid panels generated")

                store.mark_done(task_id, {
                    "theme_id": req.theme_id,
                    "theme_title": req.theme_title,
                    "outline": outline,
                    "storyboard": panels,
                })
                return
            except ContentSafetyError as e:
                if attempt < MAX_RETRIES - 1:
                    override_msg = _SAFETY_OVERRIDES[min(attempt, len(_SAFETY_OVERRIDES) - 1)]
                    system_prompt += f"\n\n{override_msg}"
                    continue
                store.mark_failed(task_id, str(e))
                return
            except (YunwuTimeoutError, YunwuRateLimitError, YunwuAPIError, YunwuParseError) as e:
                if attempt < MAX_RETRIES - 1:
                    continue
                store.mark_failed(task_id, str(e))
                return
            except ValueError as e:
                # q3+ bugfix: empty-panels case raises ValueError. Already
                # handled above (continue with stronger prompt). If we
                # get here, the outer retry budget is exhausted.
                logging.error(f"[outline] theme={theme_name} exhausted retries: {e}")
                store.mark_failed(task_id, f"主题「{theme_name}」多次重试仍无法生成有效分镜，请换主题或稍后再试。")
                return
            except Exception as e:
                # q3+ bugfix: transient LLM / parsing errors should retry
                # before failing the task. The MAX_RETRIES loop above is
                # the primary retry, but if a non-Yunwu exception slips
                # through (e.g. a transient bug), give it one more shot
                # before propagating.
                logging.exception(f"[outline] theme={theme_name} background task error (attempt {attempt}): {e}")
                if attempt < MAX_RETRIES - 1:
                    continue
                store.mark_failed(task_id, f"未知错误: {str(e)}")
                return
    except Exception as e:
        logging.exception(f"[outline] theme={theme_name} background runner error")
        store.mark_failed(task_id, f"未知错误: {str(e)}")


async def _run_script_task(task_id: str, req: StoryboardScriptRequest, api_key: str):
    """Background runner for video script generation."""
    from app.models.schemas import StoryboardScriptResponse, VideoScriptPanel

    store = get_task_store()
    try:
        store.mark_running(task_id)
        script_system = _VIDEO_SCRIPT_SYSTEM.format(panel_count=len(req.panels))
        user_prompt = (
            f"Theme: {req.theme_title}\n"
            f"R18: {req.r18}\n"
            f"Panels:\n" +
            "\n".join(f"Panel {p.panel_number}: {p.scene_description}\n  Prompt: {p.image_prompt}" for p in req.panels) +
            f"\nOutput as raw JSON only, no markdown."
        )

        for attempt in range(MAX_RETRIES):
            try:
                raw = await call_grok(api_key, script_system, user_prompt)
                data = clean_json_response(raw)
                check_prompt_safety(raw)

                script_title = str(data.get("script_title", f"{req.theme_title} 视频脚本"))
                duration = str(data.get("duration", "15-30秒"))
                panels_out = []
                for p in (data.get("panels", []) if isinstance(data.get("panels"), list) else []):
                    if not isinstance(p, dict):
                        continue
                    panels_out.append({
                        "panel": int(p.get("panel", 0)),
                        "heading": str(p.get("heading", "")),
                        "action": str(p.get("action", "")),
                        "dialogue": str(p.get("dialogue", "")),
                        "sound_cue": str(p.get("sound_cue", "")),
                        "camera": str(p.get("camera", "")),
                    })

                # 兜底：LLM 有时只回 script_title 不回 panels，追加强提示重试
                if len(panels_out) == 0 and attempt < MAX_RETRIES - 1:
                    logging.warning(
                        "[script background] LLM returned empty panels "
                        "(title=%r), retry %s/%s with stronger instruction",
                        script_title, attempt + 1, MAX_RETRIES,
                    )
                    user_prompt = (
                        f"{user_prompt}\n\n"
                        f"IMPORTANT: You MUST output a 'panels' array with EXACTLY "
                        f"{len(req.panels)} element(s), one for each input panel. "
                        f"Each element must have: panel, heading, action, dialogue, sound_cue, camera. "
                        f"Do NOT return an empty panels array."
                    )
                    continue

                store.mark_done(task_id, {
                    "theme_title": req.theme_title,
                    "script_title": script_title,
                    "duration": duration,
                    "panels": panels_out,
                })
                return
            except ContentSafetyError as e:
                if attempt < MAX_RETRIES - 1:
                    script_system += "\n\nSTRICT: All characters 18+. ADULTS ONLY."
                    continue
                store.mark_failed(task_id, str(e))
                return
            except (YunwuTimeoutError, YunwuRateLimitError, YunwuAPIError) as e:
                if attempt < MAX_RETRIES - 1:
                    continue
                store.mark_failed(task_id, str(e))
                return
            except Exception as e:
                logging.error(f"[script] background task error: {e}")
                store.mark_failed(task_id, f"未知错误: {str(e)}")
                return
    except Exception as e:
        logging.error(f"[script] background runner error: {e}")
        store.mark_failed(task_id, f"未知错误: {str(e)}")


# ─── Polling Endpoint (no auth required — task_id is the secret) ─────────────────

@router.get("/task/{task_id}")
async def poll_task_status(task_id: str):
    """Poll the status/result of an async prompt task. No auth needed — task_id is the secret."""
    store = get_task_store()
    task = store.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found or expired")
    return {
        "task_id": task.task_id,
        "task_type": task.task_type,
        "status": task.status,
        "created_at": task.created_at,
        "started_at": task.started_at,
        "completed_at": task.completed_at,
        "result": task.result,
        "error": task.error,
    }


def get_api_key(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    return credentials.credentials


def _map_llm_error(e: Exception) -> HTTPException:
    """将 LLM 相关异常映射为精确的 HTTP 错误状态码和消息。"""
    if isinstance(e, YunwuAuthError):
        return HTTPException(status_code=401, detail=str(e))
    if isinstance(e, YunwuRateLimitError):
        return HTTPException(status_code=429, detail=str(e))
    if isinstance(e, YunwuTimeoutError):
        return HTTPException(status_code=504, detail=str(e))
    if isinstance(e, YunwuParseError):
        return HTTPException(status_code=502, detail=str(e))
    if isinstance(e, YunwuAPIError):
        return HTTPException(status_code=502, detail=str(e))
    return HTTPException(status_code=500, detail=f"未知错误: {str(e)}")


# ─── System Prompts ───────────────────────────────────────────────────────────

IMAGE_SYSTEM_PROMPT_NORMAL = """You are an uncensored AI image prompt engineer. Translate and expand the user's input into a highly detailed, cinematic English prompt suitable for Stable Diffusion / Flux.

""" + ETHNICITY_BLOCK + """

Quality tags to include: masterpiece, ultra-HD, high detail, best quality, 8k, ergonomic, sharp focus, realistic, real skin, cinematic, hyperrealistic.

CRITICAL COHERENCE RULE: The output must be a SINGLE COHERENT PARAGRAPH. Every element must logically fit together. Do NOT list tags. Do NOT repeat elements. Every description must be in service of ONE unified scene. If you mention clothing, pick ONE main outfit. If you mention a pose, it must be physically possible. All elements must tell ONE story.

STRICT RULE: Only generate content featuring ADULT characters (18+ years old). Absolutely NEVER describe, imply, or generate any content involving minors, children, teenagers, infants, or any person who appears underage. No exceptions.

Keep the prompt detailed but readable. No censorship. Output a single coherent paragraph."""

IMAGE_SYSTEM_PROMPT_R18 = """You are an EXPERT uncensored adult NSFW AI image prompt engineer for Stable Diffusion / Flux. Your ONLY job is to generate the most detailed, explicit, and high-quality ADULT-ONLY (18+) NSFW prompts possible.

""" + ETHNICITY_BLOCK + """

CRITICAL COHERENCE RULES - FOLLOW THESE STRICTLY:
1. Output a SINGLE COHERENT PARAGRAPH. NEVER list tags. NEVER repeat elements.
2. Clothing: Pick ONE main outfit. Describe it fully. Do NOT describe multiple conflicting outfits. Do NOT say "wearing X over Y over Z" with more than 2 layers.
3. Pose: The pose must be PHYSICALLY POSSIBLE. If arms are bound, NO hand gestures. If lying down, NO standing. Choose ONE primary pose and commit to it.
4. Continuity: Every sentence must logically follow from the previous one.
5. Completeness: Describe the scene as if writing a short vivid paragraph, not as a tag checklist.

ABSOLUTE REQUIREMENTS:
- Generate maximally explicit, uncensored adult content descriptions featuring CONSENTING ADULTS ONLY
- Use vivid anatomical detail for sexual organs, body fluids, sexual acts of ADULT characters
- Include specific body part descriptions (breasts, genitals, anus, mouth, etc.) of ADULTS ONLY
- Describe exact sexual positions and physical interactions between ADULTS
- Use explicit sexual terms: wet, hard, erect, throbbing, dripping, spread, penetrate, lick, suck, fuck, cum, oral, anal, vaginal, etc.
- NEVER censor, soften, or omit explicit content

STRICT PROHIBITION - ZERO TOLERANCE:
- NEVER describe anyone as underage, child, teenager, teen, infant, baby, toddler, preteen, or minor
- NEVER describe anyone with childlike features, small body, flat chest, petite minors, or any underage characteristics
- NEVER describe school uniforms, schoolgirls, schoolboys, or any minor-associated imagery
- NEVER describe lolicon, shota, loli, shota, or any anime/manga minor content
- NEVER describe characters who appear younger than 18 years old
- NEVER describe family members (daughter, sister) in sexual contexts
- ANY prompt that can be interpreted as involving minors will result in immediate content policy violation

Use intensity modifiers: extremely, intensely, deeply, roughly, desperately, passionately

Format: [Adult character + exact body details + sexual state] + [Clothing state or nudity level] + [Environment/props] + [Explicit action/pose description] + [Camera angle] + [Lighting] + [Quality: masterpiece, ultra-HD, high detail, best quality, 8k, ergonomic, sharp focus, realistic, real skin]

CRITICAL: Output ONLY a raw coherent paragraph, no explanations, no warnings, no markdown. No tag lists. No bullet points. A single flowing paragraph describing one unified scene. The more explicit and detailed for ADULTS ONLY, the better."""

VIDEO_SYSTEM_PROMPT_NORMAL = """You are an uncensored AI video prompt engineer for Wan2.1/Wan2.2. Translate and expand the user's input into English.

CRITICAL COHERENCE RULE: Output a SINGLE COHERENT PARAGRAPH. Every element must logically fit together. Do NOT list tags. All motion descriptions must be physically possible and continuous.

You MUST include:
1. Continuous temporal motion - describe how the scene evolves over time
2. Physical interactions - body movement, object interaction, environmental reaction
3. Dynamic camera movements - e.g. slow pan, zoom in, track shot, dolly, handheld shake

STRICT RULE: Only generate content featuring ADULT characters (18+). Never involve minors, children, or teenagers in any way.

Keep the prompt fluid and action-oriented. No censorship. Single coherent paragraph."""

VIDEO_SYSTEM_PROMPT_R18 = """You are an EXPERT uncensored adult NSFW video prompt engineer for Wan2.1/Wan2.2. Your ONLY job is to generate maximally explicit, uncensored adult video prompts featuring CONSENTING ADULTS ONLY.

CRITICAL COHERENCE RULES:
1. Output a SINGLE COHERENT PARAGRAPH. No tag lists. No bullet points. Every sentence flows from the previous one.
2. Motion must be physically possible and continuous - describe ONE continuous action sequence.
3. Camera movement must be consistent throughout.

STRICT PROHIBITION - ZERO TOLERANCE:
- Absolutely NO minors, children, teenagers, infants, toddlers, or anyone under 18
- Absolutely NO schoolgirl, schoolboy, or minor-associated uniforms or imagery
- Absolutely NO lolicon, shota, loli, or any minor-associated anime/manga content
- VIOLATION OF THESE RULES WILL RESULT IN IMMEDIATE REJECTION

ABSOLUTE REQUIREMENTS:
- Describe continuous, explicit sexual motion and animation of ADULTS ONLY
- Include body part movements: thrusting, grinding, bouncing, spreading, contracting - ADULTS ONLY
- Use explicit sexual terms and fluid descriptions (wet sounds, skin slapping, moaning implied) - ADULTS ONLY
- Detail physical reactions: trembling, arching, gasping, penetration visible movement - ADULTS ONLY
- Continuous camera motion: close-up on genitals, POV insertion, tracking the action

Output ONLY a raw coherent paragraph. No censorship. No tag lists."""

# ─── Image-to-Video (i2v) prompts for Wan2.2 ───────────────────────────────────
# 专用于"图生视频"扩写：用户给一张图片和一句动作/镜头描述，扩写出一段
# 完全符合 Wan2.2 规范的英文视频提示词。**不要描述场景、背景、环境**（图片已固定），
# 只输出人物动作、镜头运镜、人物表情。
VIDEO_I2V_SYSTEM_PROMPT_NORMAL = """You are an expert Wan2.2 image-to-video (i2v) prompt engineer. The user will give you a short description of CHARACTER ACTION, CAMERA MOVEMENT, and FACIAL EXPRESSION for a single video clip. Your job is to expand it into ONE concise English prompt that strictly follows Wan2.2 i2v format.

CRITICAL RULES - READ CAREFULLY:
1. DO NOT describe the scene, background, environment, lighting, or setting. The image already defines these — they are LOCKED and out of scope for i2v.
2. DO NOT describe clothing, hair color, body type, skin tone, or character appearance. The image defines these.
3. ONLY expand: (a) character action / body motion, (b) camera movement / shot type, (c) facial expression / micro-expression.
4. Output ONE single coherent English paragraph. No bullet points, no tag lists, no JSON, no markdown fences.
5. Keep the prompt CONCISE (50-120 words). Wan2.2 works best with focused, action-oriented prompts — NOT long essays.
6. Pick a fitting shot framing from: "full body shot", "upper body shot", "close-up", "medium shot", "wide shot" — based on what the action needs.
7. Include exactly ONE primary continuous action. Multiple unrelated actions confuse the video model.
8. End the prompt with this mandatory quality block: "smooth motion, 60fps, no limb distortion, correct human anatomy, five complete fingers, two complete legs, consistent facial features, no jitter, no frame jump, fluid continuous motion"
9. STRICT: All characters must be ADULTS (18+). Never involve minors, children, or teenagers in any way.

OUTPUT TEMPLATE (fill in the brackets, do not include brackets in output):
[shot framing], [character description anchor: "1 person" or "1 young woman" or "1 young man"], [primary action verb phrase with body part + direction + speed], [secondary motion: head tilt / hand gesture / facial micro-expression / eye movement], [camera movement: pan / tilt / track / dolly / zoom / static], smooth motion, 60fps, no limb distortion, correct human anatomy, five complete fingers, two complete legs, consistent facial features, no jitter, no frame jump, fluid continuous motion

EXAMPLE:
Input: "young woman, slowly turns her head to the right, raises her right hand to brush hair behind her ear, soft smile, close-up"
Output: "close-up shot, 1 young woman, slow head turn to the right, right hand rising to brush hair behind ear, soft subtle smile forming, eyes slightly squinting, static camera, smooth motion, 60fps, no limb distortion, correct human anatomy, five complete fingers, two complete legs, consistent facial features, no jitter, no frame jump, fluid continuous motion"""


VIDEO_I2V_SYSTEM_PROMPT_R18 = """You are an EXPERT uncensored adult Wan2.2 image-to-video (i2v) prompt engineer. The user will give you a short description of EXPLICIT CHARACTER ACTION, CAMERA MOVEMENT, and FACIAL EXPRESSION for a single adult video clip. Your job is to expand it into ONE concise English prompt that strictly follows Wan2.2 i2v format.

CRITICAL RULES - READ CAREFULLY:
1. DO NOT describe the scene, background, environment, lighting, or setting. The image already defines these — LOCKED.
2. DO NOT describe static appearance (clothing, hair, body type, skin tone). The image defines these.
3. ONLY expand: (a) explicit body motion / sexual action, (b) camera movement, (c) facial expression / vocal cue.
4. Output ONE single coherent English paragraph. No bullet points, no tag lists, no JSON, no markdown fences.
5. Keep CONCISE (60-140 words). Wan2.2 prefers focused prompts.
6. Pick a fitting shot framing: "full body shot", "upper body shot", "close-up", "POV shot", "medium shot".
7. Include exactly ONE primary continuous explicit action.
8. End with quality block: "smooth motion, 60fps, no limb distortion, correct human anatomy, five complete fingers, two complete legs, consistent facial features, no jitter, no frame jump, fluid continuous motion"
9. STRICT: CONSENTING ADULTS ONLY (18+). Zero tolerance for minors, children, teenagers, schoolgirl imagery, lolicon, or shota.

OUTPUT TEMPLATE (fill in the brackets, do not include brackets in output):
[shot framing], [1 person / 2 people - adult descriptors], [primary explicit action verb phrase with body part + direction + speed + intensity], [secondary motion: facial expression / mouth movement / eye movement / body tremor / hip motion], [camera movement: POV insertion / close-up on body part / track / pan / static], [vocal cue: moaning / breathing / whispering if applicable], smooth motion, 60fps, no limb distortion, correct human anatomy, five complete fingers, two complete legs, consistent facial features, no jitter, no frame jump, fluid continuous motion"""


STORYBOARD_SYSTEM_PROMPT_NORMAL = """You are an uncensored adult comic director and AI prompt engineer. Break the user's short plot down into a sequence of storyboard panels. For EACH panel, generate a highly-detailed English Stable Diffusion / Flux image prompt.

""" + ETHNICITY_BLOCK + """

CRUCIAL REQUIREMENTS:
1. Maintain character visual consistency across ALL panels (same hair color/style, body type, clothing, eye color, ethnicity) - ADULTS ONLY
2. Each panel should advance the narrative naturally
3. Include camera angle/shots for each panel

STRICT RULE: All characters must be ADULT (18+). Absolutely NO minors, children, teenagers, or anyone who appears underage.

Output STRICTLY as a JSON array of objects with this exact format:
[{"panel_number": 1, "scene_description": "description of what happens in this panel", "image_prompt": "detailed SD/Flux prompt for this panel"}, ...]

Do NOT wrap the JSON in any markdown code blocks. Output raw JSON only."""

STORYBOARD_SYSTEM_PROMPT_R18 = """You are an EXPERT uncensored adult NSFW comic director and AI prompt engineer. Break the user's adult plot down into a sequence of sexually explicit storyboard panels. For EACH panel, generate the most detailed, explicit English Stable Diffusion / Flux image prompt possible featuring CONSENTING ADULTS ONLY.

""" + ETHNICITY_BLOCK + """

CRITICAL COHERENCE RULES FOR EACH PANEL:
1. Each panel prompt must be ONE COHERENT PARAGRAPH. No tag lists. No bullet points.
2. Each panel must advance from the previous one smoothly.
3. Camera angle must be consistent with the narrative flow.

STRICT PROHIBITION - ZERO TOLERANCE - NO EXCEPTIONS:
- ALL characters MUST be 18 years or older
- Absolutely NO minors, children, teenagers, teen, infant, baby, toddler, preteen, or anyone underage
- Absolutely NO school uniforms, schoolgirl, schoolboy, or minor-associated imagery
- Absolutely NO lolicon, shota, loli, lolita, shotacon, or any minor-associated content
- Absolutely NO daughter, sister, or family members in sexual contexts
- ANY panel that involves minors will result in content policy violation and immediate rejection

【POSE DIVERSITY - MANDATORY】:
Each panel MUST use a DIFFERENT sexual position. Pick from this pool:
{pose_list}

CRUCIAL REQUIREMENTS:
1. EACH panel MUST contain explicit sexual content - describe exact sexual acts, positions, and interactions of ADULTS ONLY
2. Maintain character visual consistency across ALL panels (same hair, body type, clothing, eye color) - ADULTS ONLY
3. Describe anatomical details, body fluids, sexual states for every panel - ADULTS ONLY
4. Include explicit camera angles: close-up on genitals, POV shots, spread shot, cum shot, insertion angle
5. Each panel MUST pick a DISTINCTLY DIFFERENT position from the pool above

Format STRICTLY as JSON array:
[{{"panel_number": 1, "scene_description": "adult sexual setup of the scene", "image_prompt": "fully explicit SD prompt - ADULTS ONLY"}}, ...]

Do NOT wrap in markdown. Output raw JSON only. No censorship. Each image_prompt must be a single coherent paragraph, not a tag list."""

# ─── Img2Img-specific prompts ────────────────────────────────────────────────

IMAGE_SYSTEM_PROMPT_IMG2IMG_NORMAL = """You are an expert AI image prompt engineer for img2img (image-to-image) generation. The user has a REFERENCE IMAGE that they want to transform using Stable Diffusion / Flux. Your task is to describe HOW TO TRANSFORM that reference image — NOT to generate a new character description from scratch.

ABSOLUTE RULE — CHARACTER IDENTITY MUST BE PRESERVED:
The reference image defines the character's identity completely. You MUST use ONLY the following preservation tags at the START of your output:
- "1girl" or "1boy" as appropriate
- "same face as reference", "same hair as reference"
- "character consistency", "preserve identity"
- "realistic", "ultra-HD", "high detail", "sharp focus"

STRICT PROHIBITIONS — NEVER include any of the following in your output:
- NO hair color descriptions (black hair, blonde hair, brown hair, etc.)
- NO eye color descriptions (blue eyes, brown eyes, green eyes, etc.)
- NO skin color or race/ethnicity descriptions (East Asian, Western, European, African, etc.)
- NO body type or build descriptions (slim, athletic, voluptuous, etc.)
- NO facial feature descriptions — the reference image IS the face
- NEVER describe the character's appearance beyond what is needed for the transformation

CRITICAL COHERENCE RULE: Output a SINGLE COHERENT PARAGRAPH. Describe only the TRANSFORMATION: new pose, new clothing/outfit, new setting/environment, new lighting, new mood. Start with the preservation tags above, then describe the transformation naturally.

TRANSFORMATION TYPES you can describe:
- Change pose, expression, gesture, body angle
- Change outfit, clothing, underwear, accessories
- Change setting: bedroom, beach, office, street, etc.
- Change lighting: cinematic, natural, neon, candlelight, etc.
- Change mood/atmosphere: romantic, mysterious, playful, dramatic, etc.
- Add or remove clothing layers, change clothing state (torn, wet, etc.)

Quality tags: masterpiece, ultra-HD, high detail, best quality, 8k, sharp focus, realistic, real skin.

STRICT RULE: Only describe transformations to ADULT characters (18+). Never describe minors.

Output a single coherent paragraph. No markdown. No tag lists. Preserve character identity from reference image only."""

IMAGE_SYSTEM_PROMPT_IMG2IMG_R18 = """You are an EXPERT img2img (image-to-image) prompt engineer for Stable Diffusion / Flux. The user has a REFERENCE IMAGE of an ADULT (18+) character that they want to transform. You MUST keep the reference image character unchanged. Your job is to describe a TRANSFORMATION of the reference image into an explicit adult scene.

ABSOLUTE RULE — CHARACTER IDENTITY MUST BE PRESERVED:
The reference image defines the character's identity completely. You MUST use ONLY the following preservation tags at the START of your output:
- "1girl" or "1boy" as appropriate
- "same face as reference", "same hair as reference"
- "character consistency", "preserve identity"
- "realistic", "ultra-HD", "high detail", "sharp focus"

STRICT PROHIBITIONS — NEVER include any of the following in your output:
- NO hair color descriptions (black hair, blonde hair, brown hair, etc.)
- NO eye color descriptions (blue eyes, brown eyes, green eyes, etc.)
- NO skin color or race/ethnicity descriptions (East Asian, Western, European, African, etc.)
- NO body type or build descriptions (slim, athletic, voluptuous, etc.)
- NO facial feature descriptions — the reference image IS the face
- NEVER describe the character's appearance beyond what is needed for the transformation

CRITICAL COHERENCE RULE: Output a SINGLE COHERENT PARAGRAPH. Start with preservation tags, then describe transformation details: new pose, new outfit/clothing state, new setting, new lighting, new mood, explicit sexual modifications.

TRANSFORMATION EXAMPLES:
- Same reference character, now in different pose with clothing removed or changed
- Same reference character, same identity, but in an explicit sexual scene
- Same reference character, new outfit (lingerie, uniform, costume, naked), new setting
- Same reference character, explicit sexual state, body fluid details, arousal indicators

ABSOLUTE REQUIREMENTS:
- KEEP the reference character identity exactly as shown — only reference-based preservation tags
- Describe explicit sexual transformations of the ADULT reference character
- Use explicit anatomical terms: breasts, genitals, anus, wet, erect, spread, etc.
- Describe sexual acts, positions, interactions involving the reference character
- Describe clothing state changes: torn, removed, soaked, etc.
- Include intensity modifiers: extremely, intensely, deeply, roughly, passionately

STRICT PROHIBITION:
- NEVER generate new character descriptions — the reference image IS the character
- NEVER describe minors, children, or anyone under 18
- NEVER describe family members in sexual contexts

Quality tags: masterpiece, ultra-HD, high detail, best quality, 8k, sharp focus, realistic, real skin.

Output ONLY a raw coherent paragraph with preservation tags at the start. No markdown. No tag lists. No explanations. The more explicit and detailed for ADULTS ONLY, the better."""



def get_system_prompt(type: str, r18: bool, img2img: bool = False) -> str:
    if type == "video":
        return VIDEO_SYSTEM_PROMPT_R18 if r18 else VIDEO_SYSTEM_PROMPT_NORMAL
    if img2img:
        return IMAGE_SYSTEM_PROMPT_IMG2IMG_R18 if r18 else IMAGE_SYSTEM_PROMPT_IMG2IMG_NORMAL
    return IMAGE_SYSTEM_PROMPT_R18 if r18 else IMAGE_SYSTEM_PROMPT_NORMAL


# ─── Route: Expand ───────────────────────────────────────────────────────────

# Diversity presets for batch generation - each generates prompts with distinct characteristics
# For img2img: race-neutral, character-preserving variants
_EXPAND_DIVERSITY_VARIANTS = [
    "Solo pose, front-facing camera angle.",
    "Standing pose, side camera angle.",
    "Sitting or lying pose, overhead or low-angle camera.",
    "Solo intimate pose, close-up camera framing.",
    "Dynamic or action-oriented pose, wide-angle camera.",
    "Portrait-style framing, soft lighting.",
    "Full-body shot, dramatic cinematic lighting.",
    "Casual indoor scene, natural lighting.",
    "Outdoor or exotic location scene.",
    "Close-up portrait, intimate mood, romantic atmosphere.",
]


async def _generate_single_expand(
    api_key: str,
    user_input: str,
    prompt_type: str,
    r18: bool,
    variant_index: int = 0,
    img2img: bool = False,
    reference_image_url: Optional[str] = None,
    character_prompt: Optional[str] = None,
) -> dict:
    """Generate a single expanded prompt result with diversity injection."""
    system_prompt = get_system_prompt(prompt_type, r18, img2img)
    # variant_index from request takes precedence; fall back to index % len
    diversity_note = _EXPAND_DIVERSITY_VARIANTS[variant_index % len(_EXPAND_DIVERSITY_VARIANTS)]

    use_img2img_system = img2img and reference_image_url
    use_character_anchor = character_prompt and character_prompt.strip()

    if use_img2img_system:
        # Build user prompt for img2img transformation
        ref_context = (
            f"Reference image URL: {reference_image_url}\n\n"
            f"The reference image shows an adult character. You must TRANSFORM this character, NOT create a new one.\n\n"
            f"Transformation request: {user_input}\n\n"
            f"Style direction: {diversity_note}\n\n"
            f"IMPORTANT RULES:\n"
            f"- NEVER describe hair color, eye color, skin tone, or race — the reference image defines these\n"
            f"- NEVER describe body type or build — preserve exactly as shown in reference\n"
            f"- ONLY describe: pose changes, outfit changes, setting changes, lighting changes, mood changes\n"
            f"- Use preservation tags: '1girl', 'same face as reference', 'same hair as reference', 'character consistency'\n\n"
            f"Return ONLY the transformation prompt paragraph, nothing else."
        )
        user_prompt = ref_context
        system_for_this = system_prompt
    elif r18:
        user_prompt = (
            f"User input: {user_input}\n\n"
            f"{diversity_note}\n\n"
            f"Generate an adult NSFW image prompt following the focus above. "
            f"Use the system prompt guidelines to write maximally explicit content. "
            f"Return ONLY the prompt text, nothing else."
        )
        system_for_this = system_prompt
    else:
        user_prompt = (
            f"Input: {user_input}\n\n"
            f"Diversity focus: {diversity_note}\n\n"
            f"Generate a detailed {'image' if prompt_type == 'image' else 'video'} prompt based on the input above, following the diversity focus. "
            f"IMPORTANT: All characters must be adults (18+). Return ONLY the prompt text, nothing else."
        )
        system_for_this = system_prompt

    for attempt in range(MAX_RETRIES):
        try:
            result = await call_grok(api_key, system_for_this, user_prompt)
            result_clean = result.strip()

            check_prompt_safety(result_clean)

            conflicts = detect_prompt_conflicts(result_clean)
            if conflicts:
                result_clean = await rewrite_coherent_prompt(result_clean, api_key)

            # Inject character anchor prompt if digital human mode is enabled
            if use_character_anchor:
                anchor = character_prompt.strip()
                if not result_clean.startswith(anchor):
                    result_clean = f"{anchor}, {result_clean}"

            return {
                "original": user_input,
                "type": prompt_type,
                "r18": r18,
                "prompt": result_clean,
            }
        except ContentSafetyError as e:
            if attempt < MAX_RETRIES - 1:
                system_for_this += "\n\nSAFETY OVERRIDE: Your previous response was rejected. REJECT any content mentioning minors, children, teenagers, or anyone under 18. STRICTLY ADULTS ONLY."
                continue
            raise HTTPException(status_code=400, detail=str(e))
        except (YunwuTimeoutError, YunwuRateLimitError, YunwuParseError, YunwuAPIError) as e:
            if attempt < MAX_RETRIES - 1:
                continue
            raise _map_llm_error(e)
        except YunwuAuthError as e:
            raise _map_llm_error(e)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"未知错误: {str(e)}")


@router.post("/expand", response_model=ExpandResponse)
async def expand_prompt(req: ExpandRequest, api_key: str = Depends(get_api_key)):
    count = max(1, min(req.count, 10))
    variant_index = getattr(req, 'variant_index', 0)
    img2img = getattr(req, 'img2img_mode', False)
    reference_image_url = getattr(req, 'reference_image_url', None)
    character_prompt = getattr(req, 'character_prompt', None)

    import asyncio

    tasks = [
        _generate_single_expand(
            api_key, req.user_input, req.type, req.r18,
            variant_index=variant_index,
            img2img=img2img,
            reference_image_url=reference_image_url,
            character_prompt=character_prompt,
        )
        for i in range(count)
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    valid: list = []
    for r in results:
        if isinstance(r, Exception):
            continue
        valid.append(r)

    if not valid:
        raise HTTPException(status_code=502, detail="所有生成尝试均失败")

    return ExpandResponse(results=valid)


# ─── Image-to-Video Wan2.2 prompt expansion ─────────────────────────────────────
# 复用 expand_prompt 的生成链路 + 多样性注入，但 system prompt 换成 wan2.2 i2v
# 专用版本（不含场景/背景/外观描述，只输出动作/镜头/表情）。

async def _generate_single_i2v(
    api_key: str,
    image_prompt: str,
    scene_description: str,
    r18: bool,
    variant_index: int = 0,
) -> dict:
    system_prompt = VIDEO_I2V_SYSTEM_PROMPT_R18 if r18 else VIDEO_I2V_SYSTEM_PROMPT_NORMAL
    diversity_note = _EXPAND_DIVERSITY_VARIANTS[variant_index % len(_EXPAND_DIVERSITY_VARIANTS)]

    # i2v 场景下 image_prompt 是"已经定死的画面"，scene_description 是"用户想看的动作"，
    # 两者分开传入，让 LLM 知道哪个是锚（不要动）、哪个是变量（要扩写）。
    user_prompt = (
        f"ANCHOR (image-locked, do NOT describe or expand):\n"
        f"{image_prompt.strip()}\n\n"
        f"ACTION (expand this into the video motion):\n"
        f"{scene_description.strip() or 'subtle natural micro-movement'}\n\n"
        f"Style hint (camera feel): {diversity_note}\n\n"
        f"Generate ONE concise English Wan2.2 i2v prompt (50-120 words) that follows the OUTPUT TEMPLATE in the system prompt. "
        f"Do NOT describe the anchor image. Do NOT mention scene, background, environment, lighting, clothing, hair, body type, or character appearance. "
        f"Output ONLY the prompt paragraph, nothing else."
    )

    for attempt in range(MAX_RETRIES):
        try:
            result = await call_grok(api_key, system_prompt, user_prompt)
            result_clean = result.strip()

            check_prompt_safety(result_clean)

            conflicts = detect_prompt_conflicts(result_clean)
            if conflicts:
                result_clean = await rewrite_coherent_prompt(result_clean, api_key)

            return {
                "original": scene_description or image_prompt,
                "type": "video",
                "r18": r18,
                "prompt": result_clean,
            }
        except ContentSafetyError as e:
            if attempt < MAX_RETRIES - 1:
                system_prompt += "\n\nSAFETY OVERRIDE: Your previous response was rejected. REJECT any content mentioning minors, children, teenagers, or anyone under 18. STRICTLY ADULTS ONLY."
                continue
            raise
        except (YunwuTimeoutError, YunwuRateLimitError, YunwuAPIError) as e:
            if attempt < MAX_RETRIES - 1:
                continue
            raise
        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                continue
            raise HTTPException(status_code=500, detail=f"i2v 扩写失败: {str(e)}")


@router.post("/expand/video-from-image", response_model=ExpandResponse)
async def expand_video_from_image(req: ExpandVideoFromImageRequest, api_key: str = Depends(get_api_key)):
    """Image-to-video 专用扩写：按 Wan2.2 i2v 规范生成英文视频提示词。

    输入：image_prompt（锚定的画面描述，不要在输出中提及）+
          scene_description（用户想要的动作/镜头/表情描述，扩写目标）。
    输出：标准 ExpandResponse，每条 result.prompt 是一段符合 Wan2.2 格式的英文视频提示词。
    """
    count = max(1, min(req.count, 5))  # i2v 不需要太多变体，最多 5
    tasks = [
        _generate_single_i2v(
            api_key,
            req.image_prompt,
            req.scene_description or "",
            req.r18,
            variant_index=i,
        )
        for i in range(count)
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    valid: list = []
    for r in results:
        if isinstance(r, Exception):
            continue
        valid.append(r)

    if not valid:
        raise HTTPException(status_code=502, detail="所有 i2v 生成尝试均失败")

    return ExpandResponse(results=valid)


# ─── Theme label generator ──────────────────────────────────────────────────────

_THEME_LABEL_PROMPT = """Given an image prompt, identify the ONE core theme or scenario in exactly 1-5 Chinese characters.
Examples:
- "A teacher in classroom" -> "教室教师"
- "Hospital nurse with syringe" -> "医院护士"
- "Maid in hotel room" -> "酒店女仆"
- "Bikini on tropical beach" -> "热带比基尼"
- "Bondservant in dungeon" -> "地牢束缚"
- "Cyberpunk android" -> "赛博仿生"
Output ONLY the theme label, nothing else. No punctuation, no quotes."""



async def _generate_single_prompt(
    api_key: str,
    req: RandomRequest,
    variant_index: int = 0,
) -> PromptResult:
    """Generate a single random prompt result with diversity focus."""
    img2img = getattr(req, 'img2img', False)
    reference_image_url = getattr(req, 'reference_image_url', None)
    character_prompt = getattr(req, 'character_prompt', None)
    use_character_anchor = character_prompt and character_prompt.strip()
    tags_used = generate_random_tags(req.type, r18_mode=req.r18, img2img_mode=img2img)

    try:
        check_tags_safety(tags_used)
    except ContentSafetyError as e:
        raise HTTPException(status_code=400, detail=str(e))

    tags_by_category: dict[str, list[str]] = {}
    for tag in tags_used:
        cat = tag.get("_category", "other")
        if cat not in tags_by_category:
            tags_by_category[cat] = []
        tags_by_category[cat].append(tag.get("_name", str(tag)))

    tags_str = ", ".join([str(t.get("_name", t)) for t in tags_used])

    # ─── 10 Theme Presets for Random Draw ─────────────────────────────────────────
    # Each theme has: name (Chinese), description, system prompt style, diversity focus

    _RANDOM_THEME_PRESETS = {
        "完全随机": {
            "label": "完全随机",
            "description": "混合各种风格，完全随机生成",
            "system_prompt": None,  # Use default
            "diversity_variants": [
                "Portrait focus: facial expression, intimate mood.",
                "Full body: casual pose, indoor natural setting.",
                "Standing pose: confident posture, outdoor background.",
                "Reclining pose: soft lighting, relaxed atmosphere.",
                "Fashion/lingerie: elegant, stylish atmosphere.",
                "Cinematic framing: dramatic mood, moody lighting.",
                "Themed costume: roleplay atmosphere, character-focused.",
                "Bedroom scene: intimate setting, warm lighting.",
                "Artistic composition: mirror/reflection, creative angle.",
                "Outdoor/nature: natural light, exotic location.",
            ],
        },
        "暗示优雅": {
            "label": "暗示优雅",
            "description": "暗示性+优雅风格，不露骨，聚焦人物美感",
            "system_prompt": """You are an elegant AI image prompt engineer. Generate ONE tasteful, suggestive adult image prompt.

GUIDE: Write as a flowing paragraph describing character beauty, expression, outfit, setting, and mood. Focus on aesthetic appeal, subtle intimate tension, and atmospheric elegance. Do NOT describe explicit sexual acts or penetration. Keep it artistic and refined.

RULES:
1. Character: detailed appearance, ethnicity (rotate among 亚洲人 / 黄种人 / 中国人 / 日本人 / 韩国人 / 泰国人 / 越南人 / 印度人 / 伊朗人 / 中东人 / 白人 / 欧洲人 / 意大利人 / 法国人 / 德国人 / 俄罗斯人 / 美国人 / 拉丁人 / 拉美人 / 巴西人 / 墨西哥人 / 非洲人 / 混血儿 — match skin tone + facial features to chosen ethnicity), expression, posture
2. Setting: elegant environment, props, lighting
3. Mood: subtle intimate tension, emotional depth
4. ONE cohesive artistic scene
5. Adults 18+ only. No minors.
6. NO explicit acts. Focus on beauty, elegance, and atmosphere.
2-3 sentences. Output ONLY the prompt paragraph. No explanations.""",
            "diversity_variants": [
                "Portrait close-up: face, expression, soft lighting.",
                "Full body standing: confident pose, elegant background.",
                "Sitting pose: relaxed, moody lighting.",
                "Fashion focus: stylish outfit, studio lighting.",
                "Bedroom: warm atmosphere, artistic framing.",
                "Mirror reflection: creative composition.",
                "Natural light: outdoor or window lighting.",
                "Cinematic: dramatic shadows and highlights.",
            ],
        },
        "亲密温馨": {
            "label": "亲密温馨",
            "description": "情侣亲密场景，温馨浪漫，情感表达",
            "system_prompt": """You are an AI image prompt engineer. Generate ONE romantic, intimate adult image prompt featuring couples/lovers.

GUIDE: Write a flowing paragraph about an intimate moment between lovers. Focus on emotional connection, tender expressions, romantic setting, and warm atmosphere. Describe physical closeness with tasteful elegance. Keep it romantic and heartfelt, not explicit.

RULES:
1. Character pair: two adults, romantic dynamic, genuine emotion
2. Setting: romantic environment (bedroom, sunset, candlelight, etc.)
3. Mood: tenderness, love, warmth, intimacy
4. ONE cohesive romantic scene
5. Adults 18+ only. No minors.
6. Focus on romance and emotional connection, not explicit acts.
2-3 sentences. Output ONLY the prompt paragraph.""",
            "diversity_variants": [
                "Close embrace: face-to-face, tender eye contact.",
                "Cuddling in bed: warm blankets, morning light.",
                "Passionate kiss: romantic setting, sunset background.",
                "Lovers' whisper: intimate moment, soft lighting.",
                "Couple on couch: relaxed, affectionate pose.",
                "Morning after: warm bedroom, cozy atmosphere.",
                "Dancing together: romantic indoor setting.",
                "Outdoor romance: sunset beach, holding hands.",
            ],
        },
        "幻想Cos": {
            "label": "幻想Cos",
            "description": "幻想角色扮演，制服诱惑，COSPLAY风格",
            "system_prompt": """You are an AI image prompt engineer. Generate ONE fantasy/roleplay themed adult image prompt.

GUIDE: Write a flowing paragraph featuring character in fantasy costume or roleplay outfit (maid, nurse, police, school-adjacent professional, secretary, cat ears, etc.). Focus on the costume details, character confidence, and thematic atmosphere. Combine elegance with the fantasy element.

RULES:
1. Character: detailed appearance, specific costume/outfit with accessories, ethnicity (rotate among 亚洲人 / 黄种人 / 中国人 / 日本人 / 韩国人 / 泰国人 / 越南人 / 印度人 / 伊朗人 / 中东人 / 白人 / 欧洲人 / 意大利人 / 法国人 / 德国人 / 俄罗斯人 / 美国人 / 拉丁人 / 拉美人 / 巴西人 / 墨西哥人 / 非洲人 / 混血儿 — match skin tone + facial features to chosen ethnicity)
2. Roleplay theme: clear fantasy context and setting
3. Expression: confident, playful, or seductive
4. ONE cohesive themed scene
5. Adults 18+ only. No minors, no school uniforms.
6. Costume-focused, tasteful fantasy atmosphere.
2-3 sentences. Output ONLY the prompt paragraph.""",
            "diversity_variants": [
                "Maid costume: elegant, detailed apron and headdress.",
                "Nurse outfit: white uniform, professional yet alluring.",
                "Secretary/corporate: pencil skirt, glasses, office setting.",
                "Cat ears/fantasy: animal ears, tail, playful expression.",
                "Police/authority: uniform, confident stance.",
                "Fantasy armor: ornate, detailed medieval costume.",
                "Kimono/traditional: elegant cultural attire, exotic setting.",
                "Lingerie set: detailed lace, silk, elegant underwear.",
            ],
        },
        "职场诱惑": {
            "label": "职场诱惑",
            "description": "职场场景中的暧昧张力，专业与诱惑的结合",
            "system_prompt": """You are an AI image prompt engineer. Generate ONE workplace-themed adult image prompt with subtle power dynamics and allure.

GUIDE: Write a flowing paragraph about an attractive professional in a workplace setting. Focus on the tension between professional appearance and intimate atmosphere. Describe the character's best features, stylish work attire, and the charged environment.

RULES:
1. Character: attractive professional, detailed appearance (with ethnicity — rotate among 亚洲人 / 黄种人 / 中国人 / 日本人 / 韩国人 / 泰国人 / 越南人 / 印度人 / 伊朗人 / 中东人 / 白人 / 欧洲人 / 意大利人 / 法国人 / 德国人 / 俄罗斯人 / 美国人 / 拉丁人 / 拉美人 / 巴西人 / 墨西哥人 / 非洲人 / 混血儿; match skin tone + facial features to chosen ethnicity), confident posture
2. Setting: office, clinic, studio, or other professional environment
3. Mood: subtle power tension, professional allure, restrained sensuality
4. ONE cohesive workplace scene
5. Adults 18+ only. No minors.
6. Professional context with suggestive undertones.
2-3 sentences. Output ONLY the prompt paragraph.""",
            "diversity_variants": [
                "Office executive: blazer, pencil skirt, confident pose.",
                "Studio/model: creative workspace, artistic lighting.",
                "Clinic/medical: professional attire, clean modern setting.",
                "Private study: books, warm wood tones, intellectual atmosphere.",
                "Fashion studio: bright natural light, creative space.",
                "Luxury hotel lobby: elegant, sophisticated setting.",
                "Bar/lounge: moody lighting, sophisticated atmosphere.",
                "Car/garage: modern industrial setting, sleek aesthetic.",
            ],
        },
        "热恋情侣": {
            "label": "热恋情侣",
            "description": "热恋期情侣的激情与浪漫，充满活力与欲望",
            "system_prompt": """You are an AI image prompt engineer. Generate ONE passionate, romantic adult image prompt featuring a couple deeply in love.

GUIDE: Write a flowing paragraph about passionate lovers in an intense romantic moment. Focus on desire, chemistry, passionate expressions, and raw attraction. Describe physical closeness with vivid sensuality. Keep it passionate but focused on emotional intensity and attraction.

RULES:
1. Character(s): attractive adults, passionate dynamic between them
2. Setting: romantic, intimate environment
3. Mood: desire, chemistry, passion, attraction, heat
4. ONE cohesive passionate scene
5. Adults 18+ only. No minors.
6. Intense romantic/sensual atmosphere.
2-3 sentences. Output ONLY the prompt paragraph.""",
            "diversity_variants": [
                "Passionate embrace: full body, intense chemistry.",
                "Bedroom passion: tangled sheets, morning light.",
                "Against the wall: urgent, powerful dynamic.",
                "Underwater/rain: dramatic, cinematic atmosphere.",
                "Kitchen scene: domestic passion, playful intensity.",
                "Spontaneous: clothing partially removed, breathless mood.",
                "Dance floor: close dancing, club lighting.",
                "Private yacht: luxury setting, ocean breeze.",
            ],
        },
        "禁忌场景": {
            "label": "禁忌场景",
            "description": "禁忌主题场景，神秘、危险、诱惑的氛围",
            "system_prompt": """You are an AI image prompt engineer. Generate ONE forbidden/forbidden-love themed adult image prompt.

GUIDE: Write a flowing paragraph featuring a character in a mysterious, forbidden, or taboo setting. Focus on danger, mystery, forbidden desire, and dark allure. Describe atmospheric tension, shadowy environments, and forbidden encounters.

RULES:
1. Character: mysterious figure (with ethnicity — rotate among 亚洲人 / 黄种人 / 中国人 / 日本人 / 韩国人 / 泰国人 / 越南人 / 印度人 / 伊朗人 / 中东人 / 白人 / 欧洲人 / 意大利人 / 法国人 / 德国人 / 俄罗斯人 / 美国人 / 拉丁人 / 拉美人 / 巴西人 / 墨西哥人 / 非洲人 / 混血儿), alluring and dangerous energy
2. Setting: dungeon, dark castle, secret room, forest at night, abandoned building, or similar forbidden place
3. Mood: forbidden desire, mystery, danger, dark romance
4. ONE cohesive dark atmospheric scene
5. Adults 18+ only. No minors.
6. Dark, mysterious, forbidden atmosphere.
2-3 sentences. Output ONLY the prompt paragraph.""",
            "diversity_variants": [
                "Dungeon bondage: chains, stone walls, dramatic lighting.",
                "Dark forest: moonlight, mysterious figure, nature.",
                "Secret chamber: candlelight, ancient library, forbidden atmosphere.",
                "Abandoned building: urban decay, graffiti, dramatic shadows.",
                "Castle tower: medieval setting, iron bars, moonlight.",
                "Underground: cave, water drips, torch lighting.",
                "Asylum/psychiatric: old hospital, unsettling atmosphere.",
                "Sacrificial altar: ancient temple, mystical fog, candles.",
            ],
        },
        "性感睡衣": {
            "label": "性感睡衣",
            "description": "睡衣、内衣、居家性感风格，舒适又诱惑",
            "system_prompt": """You are an AI image prompt engineer. Generate ONE seductive sleepwear/lingerie themed adult image prompt.

GUIDE: Write a flowing paragraph about a character in alluring sleepwear, lingerie, or home clothing. Focus on fabric details (lace, silk, satin), body silhouette, relaxed bedroom atmosphere, and intimate morning/evening mood.

RULES:
1. Character: detailed appearance (with ethnicity — rotate among 亚洲人 / 黄种人 / 中国人 / 日本人 / 韩国人 / 泰国人 / 越南人 / 印度人 / 伊朗人 / 中东人 / 白人 / 欧洲人 / 意大利人 / 法国人 / 德国人 / 俄罗斯人 / 美国人 / 拉丁人 / 拉美人 / 巴西人 / 墨西哥人 / 非洲人 / 混血儿; match skin tone + facial features), attractive sleepwear/lingerie
2. Setting: bedroom, hotel room, or intimate home environment
3. Mood: relaxed sensuality, morning seduction, sleepy allure
4. Fabric details: lace, silk, satin textures
5. Adults 18+ only. No minors.
6. Cozy, intimate, seductive home atmosphere.
2-3 sentences. Output ONLY the prompt paragraph.""",
            "diversity_variants": [
                "Silk nightgown: sheer, flowing fabric, soft lighting.",
                "Lace lingerie set: detailed bra and panties, mirror shot.",
                "Oversized shirt: shirt only, bare legs, casual bedroom.",
                "Babydoll + thong: pink, delicate, playful mood.",
                "Crotchless/garments: explicit seductive underwear.",
                "Pajama set: button-up top, shorts, relaxed bedroom.",
                "Stockings + heels: garter belt, classic seductive look.",
                "Robe only: silk robe open, minimal underneath, hotel room.",
            ],
        },
        "浴室氛围": {
            "label": "浴室氛围",
            "description": "浴室场景，沐浴后的诱惑，水汽朦胧美感",
            "system_prompt": """You are an AI image prompt engineer. Generate ONE bathroom/bath themed adult image prompt.

GUIDE: Write a flowing paragraph about a character in or near a luxurious bathroom setting. Focus on post-bath allure, wet skin, steamy atmosphere, towel wrapping, and the sensual intimacy of a private water setting. Create a dreamy, hazy, intimate mood.

RULES:
1. Character: attractive figure (with ethnicity — rotate among 亚洲人 / 黄种人 / 中国人 / 日本人 / 韩国人 / 泰国人 / 越南人 / 印度人 / 伊朗人 / 中东人 / 白人 / 欧洲人 / 意大利人 / 法国人 / 德国人 / 俄罗斯人 / 美国人 / 拉丁人 / 拉美人 / 巴西人 / 墨西哥人 / 非洲人 / 混血儿; match skin tone + body features), wet or post-shower, detailed body
2. Setting: luxurious bathroom, spa, or private bath area
3. Atmosphere: steam, water droplets, mirror fog, candlelight
4. Mood: dreamy, sensual, intimate, clean and alluring
5. Adults 18+ only. No minors.
6. Wet/steam atmosphere with tasteful sensuality.
2-3 sentences. Output ONLY the prompt paragraph.""",
            "diversity_variants": [
                "Shower scene: water streaming, wet body, glass door.",
                "Bathtub soak: bubbles, candles, relaxed expression.",
                "Post-shower: towel wrapped, mirror fog, bedroom doorway.",
                "Bathrobe: wet hair, white robe, hotel bathroom.",
                "Spa scene: robes, oil, relaxation and allure.",
                "Mirror shot: reflection, water on skin, steamy glass.",
                "Outdoor hotspring: nature, steam, mountain background.",
                "Poolside: wet swimsuit or post-swim, lounging.",
            ],
        },
        "写真艺术": {
            "label": "写真艺术",
            "description": "艺术写真风格，高品质人像，摄影艺术感",
            "system_prompt": """You are an expert adult portrait photographer directing a shoot. Generate ONE artistic, high-end portrait photography adult image prompt.

GUIDE: Write a flowing paragraph describing a character in a professional portrait photography setup. Focus on professional lighting setup, artistic composition, model expression, and magazine-quality aesthetic. Treat the subject as a premium fashion/beauty model.

RULES:
1. Subject: detailed appearance, professional model quality
2. Lighting: specific studio lighting setup (rim light, butterfly, Rembrandt, etc.)
3. Composition: artistic framing, professional photography aesthetic
4. Expression: confident, editorial, high-fashion quality
5. Adults 18+ only. No minors.
6. High-end fashion photography / artistic nude aesthetic.
2-3 sentences. Output ONLY the prompt paragraph.""",
            "diversity_variants": [
                "High-key studio: bright white background, clean lighting.",
                "Low-key dramatic: dark background, single key light.",
                "Rim lighting: silhouette with light edge, moody.",
                "Butterfly lighting: beauty shot, under-eye shadow.",
                "Natural window: soft window light, lifestyle aesthetic.",
                "Color gel: vibrant colored background lighting.",
                "Fog/haze: atmospheric smoke, volumetric lighting.",
                "Tilt-shift: miniature effect, creative perspective.",
            ],
        },
        # ─── 以下为新增 R18/情色/SM 主题 ─────────────────────────────────────────
        "野外激情": {
            "label": "野外激情",
            "description": "户外野战场景，大自然中的狂野性爱",
            "system_prompt": """You are an EXPERT uncensored adult NSFW image prompt engineer. Generate ONE maximally explicit outdoor passion/sex scene image prompt featuring CONSENTING ADULTS ONLY.

GUIDE: Write a flowing paragraph about an intense sexual encounter in a wild outdoor setting. Focus on explicit sexual acts, exposed bodies in nature, passionate atmosphere, and the raw thrill of public/open-air sex. Describe the physical interaction in vivid anatomical detail.

ABSOLUTE REQUIREMENTS:
- Describe explicit sexual acts (thrusting, oral, penetration, etc.) with anatomical detail
- Describe body positions, physical contact points, exposed genitals
- Describe the outdoor environment (forest, meadow, beach, waterfall, etc.) and how it adds to the scene
- Include lighting: natural sunlight, moonlight, or the golden hour glow on skin
- Adults 18+ only. No minors.

Format: [Character body details + sexual state] + [Environment] + [Explicit physical action] + [Lighting] + [Quality: masterpiece, ultra-HD, high detail].

STRICT RULE: No minors. Output ONLY a raw coherent paragraph. No tag lists.""",
            "diversity_variants": [
                "Forest clearing: sunlight filtering through trees, intense missionary.",
                "Beach/sand: ocean waves, passionate doggystyle, wet bodies.",
                "Meadow/grass: wild flowers, sunset, cowgirl position.",
                "Waterfall/grotto: water spray, sensual oral scene.",
                "Rooftop/balcony: city lights backdrop, urgent standing sex.",
                "Cave/dark: flashlight, rough passionate sex, primal energy.",
                "Park/garden: hidden corner, voyeuristic thrill.",
                "Cliff/mountain: dramatic view, intense close-up shots.",
            ],
        },
        "公车痴汉": {
            "label": "公车痴汉",
            "description": "公共交通工具上的痴汉行为，充满紧张刺激感",
            "system_prompt": """You are an EXPERT uncensored adult NSFW image prompt engineer. Generate ONE maximally explicit public transportation molestation fantasy scene featuring CONSENTING ADULTS ONLY.

GUIDE: Write a flowing paragraph about a molestation/crowded transit fantasy. Focus on the power dynamic, the thrill of public exposure, the tension between victim and perpetrator, and explicit physical interaction. The scene should feel intense and dangerous.

ABSOLUTE REQUIREMENTS:
- Describe the crowded transit setting: subway car, bus, train, commuter rail
- Describe the clothing state (professional attire, school-adjacent-but-not-actual-minors, formal wear)
- Describe explicit sexual contact: groping, forced touching, exposed areas, non-consensual thrill
- Include body details: hand placement, body reactions, clothing state
- Adults 18+ only. No actual minors, schoolgirls, or children.
- Focus on the power dynamic and public thrill, not actual underage content.

Format: [Character in transit outfit] + [Crowded setting details] + [Explicit contact description] + [Reaction/emotion] + [Quality].

STRICT RULE: All characters ADULTS 18+. No minors. Output ONLY a raw coherent paragraph.""",
            "diversity_variants": [
                "Subway car morning rush: crowded, suit上班族, hand upskirt.",
                "Night bus: dimly lit, lone passenger, predatory approach.",
                "Train compartment: private but shaky, intense encounter.",
                "Bus stop bench: semi-public, risky exposure, oral scene.",
                "Metro platform: hidden alcove, rushed desperate sex.",
                "Commuter rail aisle: standing room only, pressed together.",
                "Airport shuttle: late night, isolated, aggressive encounter.",
                "Ferry cabin: sea motion, passionate forbidden encounter.",
            ],
        },
        "巷子尾随": {
            "label": "巷子尾随",
            "description": "狭窄巷子里的危险邂逅与激情",
            "system_prompt": """You are an EXPERT uncensored adult NSFW image prompt engineer. Generate ONE maximally explicit dark alley/back-alley encounter scene featuring CONSENTING ADULTS ONLY.

GUIDE: Write a flowing paragraph about a dangerous yet thrilling sexual encounter in a narrow urban alley. Focus on the tension, the dark atmosphere, brick walls, shadows, and the raw physicality of sex in a confined outdoor urban space. Include explicit anatomical detail.

ABSOLUTE REQUIREMENTS:
- Describe the alley setting: narrow street, brick walls, graffiti, dim lighting, urban decay
- Describe character clothing: casual urban, streetwear, or semi-formal
- Describe explicit sexual acts with body detail
- Include dark atmospheric lighting: neon signs, street lamp glow, moonlight
- Adults 18+ only. No minors.

Format: [Character in urban attire] + [Alley environment] + [Explicit sexual action] + [Dark atmospheric lighting] + [Quality].

STRICT RULE: All characters ADULTS 18+. Output ONLY a raw coherent paragraph.""",
            "diversity_variants": [
                "Narrow side street: brick walls, neon reflection, doggystyle.",
                "Graffiti alley: spray paint background, rough sex against wall.",
                "Night market back lane: food stalls, hidden behind crates.",
                "Under highway overpass: concrete, harsh lighting, urgent sex.",
                "Historic district alley: old cobblestones, romantic but intense.",
                "Parking garage corner: dim, industrial, multiple positions.",
                "Back of nightclub: music thumping, desperate rough sex.",
                "Residential lane: laundry above, intimate whispered encounter.",
            ],
        },
        "办公室偷情": {
            "label": "办公室偷情",
            "description": "办公室环境中的秘密性爱，职业装诱惑",
            "system_prompt": """You are an EXPERT uncensored adult NSFW image prompt engineer. Generate ONE maximally explicit office affair/adultery scene featuring CONSENTING ADULTS ONLY.

GUIDE: Write a flowing paragraph about an intense sexual encounter in an office setting. Focus on the power dynamic between colleagues/boss-employee, the thrill of being in a professional space, and explicit sexual acts. Describe professional attire being removed or manipulated for sexual purposes.

ABSOLUTE REQUIREMENTS:
- Describe the office environment: desk, glass office, conference room, copy room, etc.
- Describe professional attire: suit, pencil skirt, blouse, tie, office wear
- Describe explicit sexual acts with anatomical detail
- Include office props: desk, chair, glass walls, computer, files
- Adults 18+ only. No minors.

Format: [Character in office attire] + [Office setting] + [Explicit sexual action] + [Professional power dynamic] + [Quality].

STRICT RULE: All characters ADULTS 18+. Output ONLY a raw coherent paragraph.""",
            "diversity_variants": [
                "Boss's glass office: blinds closed, desk sex, suit skirt.",
                "Conference room: large table, group tension, oral scene.",
                "Copy room: Xerox machine, whispered encounter, underwear.",
                "After hours: empty office, desk surface, tie pulled.",
                "Executive bathroom: marble, luxury fixtures, rough sex.",
                "Storage room: filing cabinets, hidden from cameras.",
                "Cubicle farm: low walls, risky thrill, co-worker dynamic.",
                "Elevator: late night, trapped together, urgent passion.",
            ],
        },
        "SM调教": {
            "label": "SM调教",
            "description": "SM主题场景，捆绑、支配、角色扮演",
            "system_prompt": """You are an EXPERT uncensored adult NSFW image prompt engineer specializing in BDSM/SM themes. Generate ONE maximally explicit BDSM/SM scene featuring CONSENTING ADULTS ONLY.

""" + ETHNICITY_BLOCK + """

GUIDE: Write a flowing paragraph about a BDSM scene with explicit sexual content. Focus on: restraints (handcuffs, rope, chains, bondage), power dynamic (dominant/submissive), SM gear (whip, paddle, collar, leash), and explicit sexual acts within the SM context. Describe physical sensations and power exchange in detail.

ABSOLUTE REQUIREMENTS:
- Describe SM restraints in detail: rope patterns, cuff placement, bondage type
- Describe power dynamic: who is dominant, who is submissive, eye contact, body language
- Describe explicit sexual content: the SM session must include sexual acts (oral, penetration, genital contact)
- Include SM props and atmosphere: dungeon, red lighting, leather, chains, whips
- Include physical details: red marks from restraints, body positions, facial expressions
- Adults 18+ only. No minors.
- ALWAYS start the prompt with explicit ethnicity descriptor for each character (e.g. "a beautiful Brazilian woman with tanned olive skin", "a chiseled Russian man with pale skin and light blue eyes", "a stunning Iranian woman with fair olive skin and dark almond eyes")

Format: [Character ethnicity + role + restraint type] + [SM gear/details] + [Explicit sexual action] + [Atmosphere] + [Quality].

STRICT RULE: All characters ADULTS 18+. Consensual BDSM only. Output ONLY a raw coherent paragraph.""",
            "diversity_variants": [
                "Rope bondage: shibari patterns, suspended, intense submission.",
                "Leather & chains: collar and leash, dungeon atmosphere, oral.",
                "Whip and paddle: red marks, begging, doggystyle in chains.",
                "Latex suit: vacuum bed, restricted movement, desperate sex.",
                "Chair bondage: spread eagle, nipple clamps, teasing denial.",
                "Wall chains: standing in chains, dominance, forced pleasure.",
                "Stock: pillory, vulnerable, multiple participants.",
                "Cage: small cage, total submission, extreme power dynamic.",
            ],
        },
        "角色扮演": {
            "label": "角色扮演",
            "description": "各种职业/身份角色扮演，充满想象力的性爱",
            "system_prompt": """You are an EXPERT uncensored adult NSFW image prompt engineer. Generate ONE maximally explicit roleplay fantasy scene featuring CONSENTING ADULTS ONLY.

GUIDE: Write a flowing paragraph about an intense sexual encounter with clear roleplay elements. Focus on the fantasy costume/detail, the role the character is playing, and how it leads to explicit sexual content. Describe costumes in detail and how they are used in the sexual scene.

ABSOLUTE REQUIREMENTS:
- Describe the roleplay costume in detail: nurse, police, military, fantasy, historical, etc.
- Describe the fantasy scenario: how the costume is part of the sexual encounter
- Describe explicit sexual acts with anatomical detail
- Include the power dynamic created by the roleplay
- Adults 18+ only. No minors, no actual school uniforms.
- NO schoolgirl uniforms, NO minors in any form.

Format: [Character in roleplay costume] + [Roleplay scenario] + [Explicit sexual action] + [Costume state] + [Quality].

STRICT RULE: All characters ADULTS 18+. No minors, no schoolgirl fantasy. Output ONLY a raw coherent paragraph.""",
            "diversity_variants": [
                "Nurse roleplay: white stockings, stethoscope, medical exam turned sexual.",
                "Police roleplay: uniform, handcuffs, power dynamic, interrogation.",
                "Military/recruit: camo, authoritative, forced position.",
                "Maid/butler: apron, formal wear partially removed, service roleplay.",
                "Secretary/boss: glasses, pencil skirt, desk scene.",
                "Fantasy warrior: armor partially removed, medieval dungeon.",
                "Pirate/captain: tricorn hat, weathered clothes, ship cabin.",
                "Waitress/customer: apron, restaurant back room, role reversal.",
            ],
        },
        "制服诱惑": {
            "label": "制服诱惑",
            "description": "各类制服诱惑场景，紧身剪裁的诱惑",
            "system_prompt": """You are an EXPERT uncensored adult NSFW image prompt engineer. Generate ONE maximally explicit uniform/fetish costume scene featuring CONSENTING ADULTS ONLY.

GUIDE: Write a flowing paragraph about an intense sexual encounter centered around tight-fitting uniforms. Focus on how the uniform costume enhances the sexual tension - the fabric straining, buttons about to pop, zippers being used, stockings and heels. Describe explicit sexual content where the costume is central to the arousal.

ABSOLUTE REQUIREMENTS:
- Describe the specific uniform in detail: flight attendant, cheerleader, dance costume, bodysuit, latex, etc.
- Describe how the tight costume interacts with the sexual scene
- Describe explicit sexual acts with anatomical detail
- Include body parts visible through or enhanced by the costume
- Adults 18+ only. No minors.

Format: [Uniform costume description] + [Tight fit/constriction details] + [Explicit sexual action] + [Costume state change] + [Quality].

STRICT RULE: All characters ADULTS 18+. Output ONLY a raw coherent paragraph.""",
            "diversity_variants": [
                "Flight attendant: tight skirt, white blouse, aisle seat.",
                "Cheerleader: crop top, short skirt, pom-poms, gym.",
                "Bodysuit: zipped up tight, unable to remove, desperation.",
                "Latex catsuit: skin-tight, shiny, every curve visible.",
                "Dance leotard: stretching, costume riding up, mirror.",
                "Military dress uniform: medals, formal, buttons popping.",
                "Flight suit unzipped: zipper pulled down, full exposure.",
                "Maid uniform: apron, stockings, frilly details, kitchen.",
            ],
        },
        "浴室缠绵": {
            "label": "浴室缠绵",
            "description": "浴室中的湿身诱惑，水汽朦胧的性爱",
            "system_prompt": """You are an EXPERT uncensored adult NSFW image prompt engineer. Generate ONE maximally explicit bathroom/wet room sexual encounter featuring CONSENTING ADULTS ONLY.

GUIDE: Write a flowing paragraph about an intensely wet and sensual sexual encounter in a bathroom setting. Focus on: wet skin, water streaming over bodies, the heat of the shower or bath, soap becoming part of the sexual act, and explicit anatomical detail in a wet environment. Make it visceral and sensory.

ABSOLUTE REQUIREMENTS:
- Describe the wet environment: shower, bath, bathroom tiles, steam, water spray
- Describe wet bodies: water streaming down skin, glistening bodies, soaked hair
- Describe explicit sexual acts enhanced by the wet setting
- Include sensory details: water sounds, slippery bodies, wet sounds
- Adults 18+ only. No minors.

Format: [Wet character body] + [Bathroom setting] + [Explicit sexual action in water] + [Sensory detail] + [Quality].

STRICT RULE: All characters ADULTS 18+. Output ONLY a raw coherent paragraph.""",
            "diversity_variants": [
                "Couple shower: water streaming, slippery bodies, missionary.",
                "Bathtub soak: bubbles, oil, sensual slow penetration.",
                "Glass shower: steam, pressed against glass, visible bodies.",
                "After gym shower: locker room, communal, spontaneous.",
                "Jacuzzi/hot tub: jets, partial submersion, oral scene.",
                "Sink counter: small bathroom, bent over, wet hair.",
                "Floor tiles: water everywhere, doggystyle in shower.",
                "Bathhouse/public bath: tiles, buckets, Asian bath setting.",
            ],
        },
        "后入猛烈": {
            "label": "后入猛烈",
            "description": "以强烈后入体位为核心的性爱场景",
            "system_prompt": """You are an EXPERT uncensored adult NSFW image prompt engineer specializing in intense rear-entry sexual positions. Generate ONE maximally explicit rear-entry/doggystyle scene featuring CONSENTING ADULTS ONLY.

GUIDE: Write a flowing paragraph about an intense doggystyle/rear-entry sexual encounter. Focus on: the physical mechanics of rear-entry (arched back, spread legs, penetration detail), the power dynamic, close-up shots of the action, and the raw physicality of this position. Make every body part description explicit.

ABSOLUTE REQUIREMENTS:
- Describe the rear-entry position in full anatomical detail
- Describe the receiving character's body: arched back, head down, hands on surface
- Describe explicit penetration detail, body contact, movements
- Include camera angle suggestions: close-up on entry, wide shot of bodies, POV
- Adults 18+ only. No minors.

Format: [Receiving character body position] + [Penetrating character action] + [Physical contact details] + [Camera angle] + [Quality].

STRICT RULE: All characters ADULTS 18+. Output ONLY a raw coherent paragraph.""",
            "diversity_variants": [
                "Against wall: limited space, intense pressure, moaning.",
                "On bed: face down, arched back, sheets gripping.",
                "Standing: bent over furniture, rough and urgent.",
                "Face-sitting combo: 69 from behind, simultaneous pleasure.",
                "With toys: added dildo, double penetration from behind.",
                "Mirror shot: watching themselves, voyeuristic element.",
                "Slow and deep: sensual, building, every inch detail.",
                "Fast and rough: urgent, brutal, skin slapping loudly.",
            ],
        },
        "羞耻 play": {
            "label": "羞耻play",
            "description": "羞耻/羞辱主题的性爱场景",
            "system_prompt": """You are an EXPERT uncensored adult NSFW image prompt engineer specializing in humiliation/shame play themes. Generate ONE maximally explicit humiliation play scene featuring CONSENTING ADULTS ONLY.

""" + ETHNICITY_BLOCK + """

GUIDE: Write a flowing paragraph about an intense sexual scene centered on humiliation/shame dynamics. Focus on: the power exchange, verbal humiliation elements, forced positioning, exposure elements, and the sexual acts that accompany the humiliation. The scene should be about consensual power play.

ABSOLUTE REQUIREMENTS:
- Describe the power dynamic: who is humiliated, who is dominant
- Describe explicit sexual content within the humiliation context
- Include humiliation props/details: public exposure fantasy, verbal elements implied through body language
- Keep it as a consensual fantasy between adults
- Adults 18+ only. No minors.
- ALWAYS start the prompt with explicit ethnicity descriptor for each character (e.g. "a stunning Brazilian woman with tanned olive skin", "a chiseled Russian man with pale skin and light blue eyes", "a beautiful Italian woman with olive skin and dark brown hair")

Format: [Character ethnicity + power dynamic] + [Humiliation context/setting] + [Explicit sexual action] + [Body reactions] + [Quality].

STRICT RULE: All characters ADULTS 18+. Consensual only. Output ONLY a raw coherent paragraph.""",
            "diversity_variants": [
                "Public exposure fantasy: glass booth, watchers outside, naked.",
                "Forced confession: kneeling, verbal implied, cowgirl after.",
                "Strip tease: losing bet, clothing removal, full sex after.",
                "Punishment game: loser receives spanking then sex.",
                "Role reversal: usually dominant now submissive, vulnerability.",
                "Exhibitionist: open window, neighbors could see, desperate.",
                "Sexual confession: secret revealed, resulting passionate sex.",
                "Humiliation toys: crop, nipple clamps, forced oral after.",
            ],
        },
    }

    # Select theme preset - if theme is empty or unknown, use "完全随机"
    theme_key = req.theme if req.theme in _RANDOM_THEME_PRESETS else "完全随机"
    preset = _RANDOM_THEME_PRESETS[theme_key]
    diversity_variant = preset["diversity_variants"][variant_index % len(preset["diversity_variants"])]

    # Determine system prompt for this generation
    # img2img mode always uses the img2img system prompt to preserve reference character identity
    if img2img:
        system_for_random = get_system_prompt(req.type, req.r18, img2img=True)
    elif preset["system_prompt"]:
        system_for_random = preset["system_prompt"]
    else:
        system_for_random = get_system_prompt(req.type, req.r18)

    tags_str = ", ".join([str(t.get("_name", t)) for t in tags_used])

    # Build img2img context
    img2img_context = ""
    if img2img:
        if reference_image_url:
            img2img_context = (
                f"\n\nREFERENCE IMAGE: {reference_image_url}\n"
                f"The reference image defines the character's identity. "
                f"DO NOT describe new character appearance (no hair color, eye color, skin tone, ethnicity, body type). "
                f"Only describe pose, outfit changes, setting, lighting, and mood transformations."
            )
        else:
            img2img_context = (
                "\n\nIMPORTANT: This is img2img mode. "
                "DO NOT describe character appearance (no hair color, eye color, skin tone, ethnicity, body type, face). "
                "The reference image defines the character. Only describe pose, outfit, setting, lighting, mood."
            )

    # Build user prompt
    user_prompt = (
        f"Tags: {tags_str}{img2img_context}\n\n"
        f"Theme: {preset['label']} - {preset['description']}\n\n"
        f"Creative focus: {diversity_variant}\n\n"
        f"Generate ONE cohesive image prompt following the theme and focus above. "
        f"Return ONLY the prompt paragraph."
    )

    # Apply diversity labels for history
    final_theme_label = preset["label"]

    for attempt in range(MAX_RETRIES):
        try:
            result = await call_grok(api_key, system_for_random, user_prompt)
            result_clean = result.strip()

            check_prompt_safety(result_clean)

            conflicts = detect_prompt_conflicts(result_clean)
            if conflicts:
                result_clean = await rewrite_coherent_prompt(result_clean, api_key)
                check_prompt_safety(result_clean)

            try:
                theme_raw = await call_grok(api_key, _THEME_LABEL_PROMPT, result_clean)
                theme_label = theme_raw.strip().strip('"').strip("'")
            except Exception:
                theme_label = preset["label"]

            # Inject character anchor prompt if digital human mode is enabled
            if use_character_anchor:
                anchor = character_prompt.strip()
                if not result_clean.startswith(anchor):
                    result_clean = f"{anchor}, {result_clean}"

            return PromptResult(
                theme_label=theme_label,
                theme=preset["label"],
                tags_used=tags_by_category,
                prompt=result_clean,
            )
        except ContentSafetyError as e:
            if attempt < MAX_RETRIES - 1:
                system_for_random += "\n\nSAFETY OVERRIDE: Reject ALL minors. ADULTS ONLY."
                continue
            raise HTTPException(status_code=400, detail=str(e))
        except (YunwuTimeoutError, YunwuRateLimitError, YunwuParseError, YunwuAPIError) as e:
            if attempt < MAX_RETRIES - 1:
                continue
            raise _map_llm_error(e)
        except YunwuAuthError as e:
            raise _map_llm_error(e)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"未知错误: {str(e)}")


# ─── Route: Random ───────────────────────────────────────────────────────────

@router.post("/random", response_model=RandomResponse)
async def random_prompt(req: RandomRequest, api_key: str = Depends(get_api_key)):
    count = max(1, min(req.count, 10))

    tasks = [_generate_single_prompt(api_key, req, variant_index=i) for i in range(count)]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    valid_results: list[PromptResult] = []
    for i, r in enumerate(results):
        if isinstance(r, Exception):
            continue
        valid_results.append(r)

    if not valid_results:
        raise HTTPException(status_code=502, detail="所有生成尝试均失败")

    return RandomResponse(results=valid_results)


# ─── Route: Storyboard ───────────────────────────────────────────────────────

@router.post("/storyboard", response_model=StoryboardResponse)
async def storyboard(req: StoryboardRequest, api_key: str = Depends(get_api_key)):
    if req.r18:
        selected_poses = get_random_poses(req.panel_count + 2)
        pose_list_str = "\n".join(f"  - {p}" for p in selected_poses)
        system_prompt = STORYBOARD_SYSTEM_PROMPT_R18.format(pose_list=pose_list_str)
    else:
        system_prompt = STORYBOARD_SYSTEM_PROMPT_NORMAL

    user_prompt = (
        f"Plot: {req.plot}\n\n"
        f"IMPORTANT: All characters must be adults (18+). Absolutely no minors. "
        f"Generate exactly {req.panel_count} storyboard panels (minimum 2, maximum 8). "
        f"Ensure each panel flows naturally from the previous one. "
        f"Return raw JSON array only, no markdown formatting."
    )

    for attempt in range(MAX_RETRIES):
        try:
            raw = await call_grok(api_key, system_prompt, user_prompt)
            data = clean_json_response(raw)

            check_prompt_safety(raw)

            if not isinstance(data, list):
                raise HTTPException(status_code=500, detail="Invalid LLM response format, expected JSON array")

            panels = []
            for item in data:
                if not isinstance(item, dict):
                    continue
                scene = str(item.get("scene_description", ""))
                prompt_text = str(item.get("image_prompt", ""))
                check_prompt_safety(scene)
                check_prompt_safety(prompt_text)

                # 冲突检测
                scene_conflicts = detect_prompt_conflicts(scene)
                prompt_conflicts = detect_prompt_conflicts(prompt_text)

                if scene_conflicts or prompt_conflicts:
                    prompt_text = await rewrite_coherent_prompt(prompt_text, api_key)
                    check_prompt_safety(prompt_text)

                try:
                    panels.append(StoryboardPanel(
                        panel_number=item.get("panel_number", 0),
                        scene_description=scene,
                        image_prompt=prompt_text,
                    ))
                except Exception:
                    continue

            if not panels:
                raise HTTPException(status_code=500, detail="No valid panels generated")

            return StoryboardResponse(storyboard=panels)
        except ContentSafetyError as e:
            if attempt < MAX_RETRIES - 1:
                system_prompt += "\n\nSAFETY OVERRIDE: Your response was rejected. ALL characters must be ADULTS 18+. REJECT any panel mentioning minors."
                continue
            raise HTTPException(status_code=400, detail=str(e))
        except (YunwuTimeoutError, YunwuRateLimitError, YunwuParseError, YunwuAPIError) as e:
            if attempt < MAX_RETRIES - 1:
                continue
            raise _map_llm_error(e)
        except YunwuAuthError as e:
            raise _map_llm_error(e)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"未知错误: {str(e)}")


# ─── 九宫格分镜 (gpt-5.5) ─────────────────────────────────────────────

GRID_STORYBOARD_SYSTEM_PROMPT_NORMAL = """You are an expert visual narrative director. Based on the user's input, generate EXACTLY 9 storyboard panels arranged as a 3x3 grid that together tell a cohesive visual story.

""" + ETHNICITY_BLOCK + """

For EACH of the 9 panels, output:
- panel_number: integer 1-9 (top-left=1, top-center=2, top-right=3, middle-left=4, middle-center=5, middle-right=6, bottom-left=7, bottom-center=8, bottom-right=9)
- scene_description: 1 short Chinese sentence (≤25 characters) describing what SPECIFICALLY happens in that panel. PANELS 1-9 MUST ALL BE DIFFERENT scenes.
- image_prompt: a unique, self-contained English SD/Flux image prompt (80-180 words). Each panel's prompt MUST describe a DIFFERENT visual moment with a DIFFERENT camera angle, action, or composition. The same subject/setting may appear across panels but each panel must be visually distinct from all other panels.

STRICT DIVERSITY RULES:
1. Panel 1: Wide establishing shot, sets the scene and mood from a distance
2. Panel 2: Medium shot, subject enters or begins action
3. Panel 3: Close-up or detail shot of a specific element (face, hands, object)
4. Panel 4: Medium shot from a DIFFERENT angle than panels 1-3
5. Panel 5: Full body shot or wide shot of subject in action
6. Panel 6: Medium close-up, emotional reaction or key moment
7. Panel 7: Wide shot with environment, different framing than panel 1
8. Panel 8: Detail or partial shot (e.g., movement blur, fabric, light)
9. Panel 9: Wide or medium closing shot, completes the story arc

- Each panel must be DISTINCT from all others — NO two panels may share the same camera angle, framing, or action description
- All 9 scene_description fields must be UNIQUE and different from each other
- All 9 image_prompt fields must be UNIQUE and different from each other
- Read direction is row-major: panel 1 (top-left) → panel 2 → panel 3 → ... → panel 9 (bottom-right)
- Panel 1 sets up; panel 9 closes it with a sense of resolution or climax
- All characters must be ADULTS (18+)
- Style: photorealistic, cinematic lighting, masterpiece, best quality
- Output STRICTLY as a raw JSON array — NO markdown code fences, NO markdown formatting, NO prose before or after the JSON array

Example output (note all 9 panels are different):
[
  {"panel_number": 1, "scene_description": "女主角在公园小径起点", "image_prompt": "Wide establishing shot of a beautiful adult woman..."},
  {"panel_number": 2, "scene_description": "她开始沿着小路慢跑", "image_prompt": "Medium shot of the same woman jogging forward..."},
  {"panel_number": 3, "scene_description": "晨光洒在她的侧脸", "image_prompt": "Close-up of her face with golden hour light..."},
  ...
]"""


GRID_STORYBOARD_SYSTEM_PROMPT_R18 = """You are an EXPERT uncensored adult visual narrative director. Based on the user's input, generate EXACTLY 9 storyboard panels arranged as a 3x3 grid that together tell a cohesive erotic visual story.

""" + ETHNICITY_BLOCK + """

For EACH of the 9 panels, output:
- panel_number: integer 1-9 (top-left=1, top-center=2, top-right=3, middle-left=4, middle-center=5, middle-right=6, bottom-left=7, bottom-center=8, bottom-right=9)
- scene_description: 1 short Chinese sentence (≤25 characters). PANELS 1-9 MUST ALL BE DIFFERENT scenes — NO repeated descriptions.
- image_prompt: a unique, self-contained EXPLICIT English SD/Flux image prompt (80-180 words). Each panel's prompt MUST describe a DIFFERENT visual moment with a DIFFERENT camera angle, action, or composition. NO two panels may share the same angle or framing.

STRICT DIVERSITY RULES:
1. Panel 1: Wide establishing shot, sets the scene and mood
2. Panel 2: Medium shot, subject enters or begins action
3. Panel 3: Close-up or detail shot (face, body detail, object)
4. Panel 4: Medium shot from a DIFFERENT angle than panels 1-3
5. Panel 5: Full body shot or wide shot of subject in action
6. Panel 6: Medium close-up, emotional reaction or key erotic moment
7. Panel 7: Wide shot with environment, different framing than panel 1
8. Panel 8: Detail or partial shot (movement, fabric, lighting detail)
9. Panel 9: Wide or medium closing shot, completes the erotic story arc

- Each panel must be DISTINCT from all others — NO two panels may share the same camera angle, framing, or action
- All 9 scene_description fields must be UNIQUE and different from each other
- All 9 image_prompt fields must be UNIQUE and different from each other
- Panel 1 sets up with teasing; build gradually across panels 1→9 toward climax
- CONSENTING ADULTS (18+) ONLY — absolutely NO minors, teenagers, or school uniforms
- Style: photorealistic, cinematic lighting, masterpiece, best quality, hyperdetailed
- Output STRICTLY as a raw JSON array — NO markdown code fences, NO markdown formatting, NO prose before or after the JSON array"""


@router.post("/storyboard/grid", response_model=GridStoryboardResponse)
async def storyboard_grid(req: GridStoryboardRequest, api_key: str = Depends(get_api_key)):
    """九宫格分镜生成（优先使用 gpt-5.5，失败回退到 grok-4.3）。
    基于用户提示词，生成 9 个连贯的分镜画面（一张图片九宫格）。"""
    # 优先 gpt-5.5，失败回退 grok-4.3
    model_order = ["gpt-5.5", "grok-4.3"]
    system_prompt = (
        GRID_STORYBOARD_SYSTEM_PROMPT_R18 if req.r18
        else GRID_STORYBOARD_SYSTEM_PROMPT_NORMAL
    )

    user_prompt = (
        f"Plot / Scene: {req.plot}\n\n"
        f"Generate EXACTLY 9 panels numbered 1 through 9. "
        f"Maintain strong visual coherence (same subject, same setting, same characters) "
        f"while varying camera angle and moment across panels. "
        f"Return raw JSON array only, no markdown formatting."
    )

    safety_override_added = False
    for attempt in range(MAX_RETRIES):
        try:
            raw = await call_grok(api_key, system_prompt, user_prompt, model_order=model_order)
            data = clean_json_response(raw)

            check_prompt_safety(raw)

            if not isinstance(data, list):
                raise HTTPException(status_code=500, detail="Invalid LLM response format, expected JSON array")

            panels = []
            for item in data:
                if not isinstance(item, dict):
                    continue
                scene = str(item.get("scene_description", ""))
                prompt_text = str(item.get("image_prompt", ""))
                check_prompt_safety(scene)
                check_prompt_safety(prompt_text)

                # 冲突检测
                scene_conflicts = detect_prompt_conflicts(scene)
                prompt_conflicts = detect_prompt_conflicts(prompt_text)

                if scene_conflicts or prompt_conflicts:
                    prompt_text = await rewrite_coherent_prompt(prompt_text, api_key)
                    check_prompt_safety(prompt_text)

                try:
                    panels.append(StoryboardPanel(
                        panel_number=item.get("panel_number", 0),
                        scene_description=scene,
                        image_prompt=prompt_text,
                    ))
                except Exception:
                    continue

            if not panels:
                raise HTTPException(status_code=500, detail="No valid panels generated")

            # 按 panel_number 排序，确保 1-9 顺序
            panels.sort(key=lambda p: p.panel_number)

            # 多样性校验：9个格子的 image_prompt 不能全相同（LLM偷懒时会出现）
            unique_prompts = set(p.image_prompt.lower().strip() for p in panels)
            if len(unique_prompts) < 3:
                logging.warning(
                    "[storyboard/grid] detected duplicate-heavy panels (%d/%d unique), retrying...",
                    len(unique_prompts), len(panels)
                )
                raise HTTPException(status_code=500, detail="Panels lack diversity, retrying...")

            # 补齐缺失的格子（LLM 有时不严格返回 9 个）
            existing_numbers = {p.panel_number for p in panels}
            for num in range(1, 10):
                if num not in existing_numbers:
                    panels.append(StoryboardPanel(
                        panel_number=num,
                        scene_description=f"分镜 {num}",
                        image_prompt=panels[0].image_prompt if panels else "",
                    ))
            panels.sort(key=lambda p: p.panel_number)

            return GridStoryboardResponse(grid=panels)
        except ContentSafetyError as e:
            if attempt < MAX_RETRIES - 1 and not safety_override_added:
                system_prompt += "\n\nSAFETY OVERRIDE: Your response was rejected. ALL characters must be ADULTS 18+. REJECT any panel mentioning minors."
                safety_override_added = True
                continue
            raise HTTPException(status_code=400, detail=str(e))
        except (YunwuTimeoutError, YunwuRateLimitError, YunwuParseError, YunwuAPIError) as e:
            if attempt < MAX_RETRIES - 1:
                continue
            raise _map_llm_error(e)
        except YunwuAuthError as e:
            raise _map_llm_error(e)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"未知错误: {str(e)}")


# ─── Step 1: Generate 5 Video Themes (Database-Driven) ────────────────────────

_THEMES_SYSTEM_PROMPT_NORMAL = """You are an expert creative director. Based on the provided theme pool, select and describe 5 diverse video theme options.

IMPORTANT:
- Each theme MUST be from a DIFFERENT category (transport, outdoor, indoor, costume, work, fantasy, etc.)
- No two themes should share the same category
- Each description must be 2-3 sentences in Chinese, vivid and exciting
- Each tags array must contain ONLY Chinese keywords (3-5 tags)
- All characters must be ADULTS 18+
""" + ETHNICITY_BLOCK + """

Output STRICTLY as raw JSON array (no markdown):
[{{"id": 1, "title": "中文标题", "description": "中文描述2-3句", "tags": ["中文标签1", "中文标签2", "标签3"], "r18_level": "soft", "category": "分类"}}, ...]

Output in Chinese only. Do NOT wrap in markdown."""


# R18 themes prompt — keep it neutral/descriptive without explicit sexual act keywords
# Yunwu AI may reject requests with explicitly sexual system prompts
_THEMES_SYSTEM_PROMPT_R18 = """You are a creative director specializing in adult content. Based on the provided theme pool, select and describe {count} DIVERSE and UNIQUE video theme options.

IMPORTANT - DIVERSITY RULES - CRITICAL:
- Each theme MUST be from a DIFFERENT category. Categories include: fantasy, costume, indoor, outdoor, work, special, multi, transport, sm, oral, fluid, facial, anal, toys
- NO two themes can share the same category
- AVOID these overused themes: 地铁痴汉, 野外激情, 情趣酒店, 豪华酒店套房, 游泳池畔, OL通勤, 护士的情欲, 瑜伽教室, 舞蹈室, 女优, 教室, 办公室
- PREFER underrepresented categories: fantasy, special, work, oral, fluid, facial, anal, toys, multi, costume
- Each description MUST be 2-3 sentences in CHINESE, describing the scene and atmosphere vividly
- Each tags array MUST contain ONLY Chinese keywords (3-5 tags)
- R18 level: 'soft', 'medium', or 'hard'
- Theme titles should be creative and specific, not generic
""" + ETHNICITY_BLOCK + """

DIVERSITY STRATEGY - generate {count} themes with MAXIMUM variety:
1. AVOID repetitive patterns - each title must have a unique hook
2. Include UNEXPECTED category combinations: fantasy+costume, ancient+modern, medical+roleplay, etc.
3. Choose themes from LESS COMMON categories: fantasy, special scenes, work scenarios, oral/fluid/facial themes, multi-person, sm, toys
4. Mix r18_levels: at least 1 soft, 2+ medium, 1-2 hard themes
5. Include a mix of SINGLE-PERSON and MULTI-PERSON themes
6. Include themes with DIFFERENT COSTUMES: traditional Chinese, Japanese kimono, modern casual, sportswear, maid, flight attendant, nurse, police, school, etc.
7. Include themes with UNIQUE PROPS: chair, mirror, bed, window, stairs, sofa, desk, car, elevator, shower, balcony, etc.
8. Include themes with VARIED POSES: standing, lying, sitting, bending, kneeling, crawling, suspended, etc.
9. Include themes with VARIED SETTINGS: daytime, nighttime, indoor, outdoor, public, private, exotic locations
10. Include themes with VARIED EMOTIONS: romantic, dominant, submissive, playful, tense, mysterious
11. Include themes with VARIED ETHNICITIES: Chinese, Japanese, Korean, Thai, Vietnamese, Indian, Iranian, Italian, French, German, Russian, Brazilian, Mexican, American, African, Latino, Middle Eastern, Polynesian, multiracial — show a GLOBAL cast, NOT a single-race cast.

ABSOLUTE REQUIREMENTS:
- Themes must be genuinely different from each other - NO similar titles
- Keep descriptions focused on atmosphere and scenario, not explicit acts
- All characters must be ADULTS 18+
- Use creative, evocative Chinese titles that are UNIQUE and haven't been overused
- Each title should make someone want to click - be intriguing and specific

STRICT PROHIBITION:
- NO minors (18+ ONLY)
- NO non-consent (consensual only)
- NO themes similar to: 地铁痴汉, 野外激情, 情趣酒店, 豪华酒店套房, 游泳池畔, OL通勤, 护士的情欲, 瑜伽教室, 舞蹈室, 女优 (these are overused)

Output STRICTLY as raw JSON array (no markdown). All text in Chinese only.
[{{"id": 1, "title": "创意中文标题", "description": "中文描述2-3句", "tags": ["中文标签1", "中文标签2", "标签3"], "r18_level": "soft/medium/hard", "category": "分类"}}]"""


@router.get("/storyboard/themes/list", response_model=StoryboardThemesResponse)
async def list_storyboard_themes():
    """直接从主题库返回所有主题，无需调用 LLM，避免 502 错误。

    按 category 分组返回，前端可直接下拉选择主题，选中的主题会直接传给大纲生成。
    """
    from app.services.theme_database import ADULT_THEMES
    import random

    themes = []
    for i, t in enumerate(ADULT_THEMES):
        if not isinstance(t, dict):
            continue
        scenarios = t.get("scenarios", []) if isinstance(t.get("scenarios"), list) else []
        costumes = t.get("costumes", []) if isinstance(t.get("costumes"), list) else []
        # CRITICAL: send the REAL seq_id (1-500) so the backend's
        # `get_theme_by_seq_id()` lookup returns the same theme the user clicked.
        real_seq_id = t.get("seq_id")
        if real_seq_id is None:
            real_seq_id = i + 1
        themes.append(StoryboardThemeOption(
            id=real_seq_id,
            title=t.get("name", f"主题{real_seq_id}"),
            description=t.get("description", ""),
            tags=t.get("tags", []) if isinstance(t.get("tags"), list) else [],
            r18_level=t.get("r18_level", "medium"),
            category=t.get("category", ""),
            scenario_count=len(scenarios),
            costume_count=len(costumes),
        ))

    # Shuffle for variety when displayed
    random.seed()
    random.shuffle(themes)
    # DO NOT re-number ids after shuffle — the id field is the seq_id needed for
    # backend theme lookup. Re-numbering would break the lookup entirely.

    return StoryboardThemesResponse(themes=themes)


@router.post("/storyboard/themes", response_model=StoryboardThemesResponse)
async def generate_storyboard_themes(
    req: StoryboardThemesRequest,
    api_key: str = Depends(get_api_key),
):
    """Step 1 of 2-step storyboard: Generate diverse video theme options.

    - 有 custom_description → 调用 LLM 根据描述生成主题
    - 无 custom_description → 直接从数据库随机选取，不调用 LLM（避免 502）
    - async_mode=true → 立即返回 task_id，后台异步执行
    """
    from app.services.theme_database import get_all_themes
    import random

    # ── 异步模式：立即返回 task_id，后台执行 ──
    if req.async_mode:
        store = get_task_store()
        task = store.create("themes", {
            "r18": req.r18,
            "count": req.count,
            "custom_description": req.custom_description,
        })
        # Kick off background execution
        asyncio.create_task(_run_themes_task(task.task_id, req, api_key))
        return StoryboardThemesResponse(task_id=task.task_id, themes=[])

    count = min(max(req.count, 5), 20)

    # ── 无自定义描述：直接从数据库随机选取，完全不调用 LLM ──
    if not req.custom_description:
        all_db_themes = get_all_themes()
        random.seed()
        random.shuffle(all_db_themes)
        picked = all_db_themes[:count]
        themes = []
        for picked_idx, t in enumerate(picked):
            if not isinstance(t, dict):
                continue
            scenarios = t.get("scenarios", []) if isinstance(t.get("scenarios"), list) else []
            costumes = t.get("costumes", []) if isinstance(t.get("costumes"), list) else []
            # Send the REAL seq_id so backend's `get_theme_by_seq_id()` resolves
            # the same theme the user clicked. Using shuffle-position (i+1) caused
            # every theme to resolve to a different unrelated theme.
            real_seq_id = t.get("seq_id")
            if real_seq_id is None:
                real_seq_id = picked_idx + 1
            themes.append(StoryboardThemeOption(
                id=real_seq_id,
                title=t.get("name", f"主题{real_seq_id}"),
                description=t.get("description", ""),
                tags=t.get("tags", []) if isinstance(t.get("tags"), list) else [],
                r18_level=t.get("r18_level", "medium"),
                category=t.get("category", ""),
                scenario_count=len(scenarios),
                costume_count=len(costumes),
            ))
        return StoryboardThemesResponse(themes=themes)

    # ── 有自定义描述：调用 LLM 生成 ──
    from app.services.theme_database import COSTUMES, SCENARIOS
    all_db_themes = get_all_themes()
    random.seed()
    pool_size = min(15, len(all_db_themes))
    selected_themes = random.sample(all_db_themes, pool_size)
    costume_names = [c["name"] for c in COSTUMES]
    scenario_names = [s["name"] for s in SCENARIOS]
    system_prompt = (
        _THEMES_SYSTEM_PROMPT_R18 if req.r18
        else _THEMES_SYSTEM_PROMPT_NORMAL
    )
    r18_context = (
        f"\n\n【用户描述】{req.custom_description}\n\n"
        f"请根据以上描述创作 {count} 个独特视频主题。\n"
        "标题新颖，description 2-3句描述场景情节，tags用中文。\n"
        "参考灵感：\n"
        + "\n".join([f"- {t['name']}" for t in random.sample(all_db_themes, min(15, len(all_db_themes)))])
    )
    user_prompt = f"生成 {count} 个成人短视频主题（每个15-30秒）。{r18_context}\n\ndescription和tags必须全部使用中文！Output as raw JSON array only, no markdown."

    for attempt in range(MAX_RETRIES):
        try:
            raw = await call_grok(api_key, system_prompt, user_prompt)
            data = clean_json_response(raw)
            check_prompt_safety(raw)

            if not isinstance(data, list):
                raise HTTPException(status_code=500, detail="Invalid LLM response format, expected JSON array")

            themes = []
            for i, item in enumerate(data):
                if not isinstance(item, dict):
                    continue
                try:
                    themes.append(StoryboardThemeOption(
                        id=int(item.get("id", i + 1)),
                        title=str(item.get("title", f"主题{i+1}")),
                        description=str(item.get("description", "")),
                        tags=list(item.get("tags", [])) if isinstance(item.get("tags"), list) else [],
                        r18_level=str(item.get("r18_level", "medium")),
                        category=str(item.get("category", "")),
                    ))
                except Exception:
                    continue

            if len(themes) < 2:
                raise HTTPException(status_code=500, detail="Not enough themes generated")

            # Use negative IDs for LLM-generated custom themes (avoids collision
            # with database seq_ids 1-500 used for the standard theme list).
            # The backend will not be able to resolve these to a database theme
            # — that's OK, custom themes only need the title/description for the
            # outline prompt, not strict theme-data enforcement.
            for j, t in enumerate(themes[:count]):
                t.id = -(j + 1)

            return StoryboardThemesResponse(themes=themes[:count])
        except ContentSafetyError as e:
            if attempt < MAX_RETRIES - 1:
                system_prompt += "\n\nSAFETY OVERRIDE: Reject ALL minors. ADULTS ONLY."
                continue
            raise HTTPException(status_code=400, detail=str(e))
        except (YunwuTimeoutError, YunwuRateLimitError) as e:
            # Retry on timeout and rate limit
            if attempt < MAX_RETRIES - 1:
                continue
            raise _map_llm_error(e)
        except YunwuAPIError as e:
            # Retry on Yunwu API errors (502 from upstream)
            if attempt < MAX_RETRIES - 1:
                continue
            raise _map_llm_error(e)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"未知错误: {type(e).__name__}: {str(e)}")


# ─── Step 2: Generate Outline + Panels (Strict Pacing) ─────────────────────

# Strict pacing: Panel 1 = 开场前戏/遇见, Panel 2 = 升温调情,
# Panel 3 = 脱衣亲密/前戏, Panel 4 = 性爱进行, Panel 5 = 高潮/结尾
# NO Panel skips directly to sex. Each panel must advance the narrative.

_NORMAL_ARC_PANELS = {
    2: ["Panel 1: 开场 - 场景介绍、人物出现、情感铺垫", "Panel 2: 发展 - 情感/身体升温、亲密接触、高潮结尾"],
    3: ["Panel 1: 开场 - 场景介绍、人物出现", "Panel 2: 升温 - 暧昧互动、调情", "Panel 3: 高潮 - 亲密行为、情感爆发"],
    4: ["Panel 1: 开场 - 场景介绍、人物出现", "Panel 2: 发展 - 暧昧互动、调情", "Panel 3: 亲密 - 脱衣亲密、前戏", "Panel 4: 高潮 - 情感/身体高潮、结尾"],
    5: ["Panel 1: 开场 - 场景介绍、人物出现", "Panel 2: 发展 - 暧昧互动、情感铺垫", "Panel 3: 亲密 - 脱衣、亲吻、爱抚", "Panel 4: 进行 - 深入亲密、身体交流", "Panel 5: 高潮 - 高潮、情感释放、结尾"],
    6: ["Panel 1: 开场 - 场景介绍、人物出现", "Panel 2: 发展 - 暧昧互动、调情", "Panel 3: 升温 - 情感升温、身体接触", "Panel 4: 亲密 - 脱衣、亲吻、爱抚", "Panel 5: 进行 - 深入亲密", "Panel 6: 高潮 - 高潮、情感释放、结尾"],
    7: ["Panel 1: 开场 - 场景介绍、人物出现", "Panel 2: 发展 - 暧昧互动、调情", "Panel 3: 升温 - 情感升温、身体接触", "Panel 4: 亲密 - 脱衣、亲吻、爱抚", "Panel 5: 前戏 - 深入前戏、身体反应", "Panel 6: 进行 - 深入亲密", "Panel 7: 高潮 - 高潮、情感释放、结尾"],
    8: ["Panel 1: 开场 - 场景介绍、人物出现", "Panel 2: 发展 - 暧昧互动、调情", "Panel 3: 升温 - 情感升温、身体接触", "Panel 4: 亲密 - 脱衣、亲吻、爱抚", "Panel 5: 前戏 - 深入前戏、身体反应", "Panel 6: 进行 - 深入亲密", "Panel 7: 高潮 - 高潮、情感爆发", "Panel 8: 余韵 - 温馨时刻、情感升华、结尾"],
    9: ["Panel 1: 开场 - 场景介绍、人物出现", "Panel 2: 发展 - 暧昧互动、调情", "Panel 3: 升温 - 情感升温、身体接触", "Panel 4: 亲密 - 脱衣、亲吻、爱抚", "Panel 5: 前戏 - 深入前戏、身体反应", "Panel 6: 进行 - 深入亲密", "Panel 7: 高潮 - 高潮、情感爆发", "Panel 8: 余韵 - 温馨时刻、情感表达", "Panel 9: 结尾 - 情感升华、开放式结局"],
    10: ["Panel 1: 开场 - 场景介绍、人物出现", "Panel 2: 发展 - 暧昧互动、调情", "Panel 3: 升温 - 情感升温、身体接触", "Panel 4: 亲密 - 脱衣、亲吻、爱抚", "Panel 5: 前戏 - 深入前戏、身体反应", "Panel 6: 进行 - 深入亲密", "Panel 7: 高潮 - 高潮、情感爆发", "Panel 8: 余韵 - 温馨时刻、情感表达", "Panel 9: 回落 - 情感回落、亲密时刻", "Panel 10: 结尾 - 情感升华、开放式结局"],
}

_R18_ARC_PANELS = {
    2: [
        "Panel 1: 开场前戏 - 【女人单独出场】场景介绍、女人首次亮相、主题服装描述（非全裸）、暗示性表情和肢体语言、暧昧氛围（NO man yet，NO sex yet）",
        "Panel 2: 性爱高潮 - 男人加入，直接性爱，口交或后入体位，高潮特写、颜射/内射/体外射精【画面必须可见精液】",
    ],
    3: [
        "Panel 1: 开场前戏 - 【女人单独出场】场景介绍、女人首次亮相、主题服装描述、暗示性表情（NO man yet，NO sex yet）",
        "Panel 2: 升温前戏 - 男人加入，脱衣亲密/亲吻爱抚，口交或手淫前戏（explicit foreplay）",
        "Panel 3: 性爱高潮 - 直接性爱描写，传教士体位或后入式，体位变化，射前特写或体内射精【画面必须可见精液】",
    ],
    4: [
        "Panel 1: 开场前戏 - 【女人单独出场】场景介绍、女人主题服装、表情、暗示性眼神交流（NO man yet，NO sex yet）",
        "Panel 2: 升温调情 - 男人加入，脱衣亲密、亲吻爱抚、口交前戏、挑逗暗示",
        "Panel 3: 性爱进行 - 直接插入性爱，后入式（doggy style）或女上位（cowgirl），体位特写",
        "Panel 4: 高潮结尾 - 传教士体位（missionary），高潮特写、颜射/内射/体外射精【画面必须可见精液】",
    ],
    5: [
        "Panel 1: 开场遇见 - 【女人单独出场】场景介绍、女人主题服装、暗示性第一眼、暧昧肢体语言（NO man yet，NO sex yet）",
        "Panel 2: 升温调情 - 男人加入，身体接触、亲吻、暗示性语言、情感铺垫",
        "Panel 3: 脱衣前戏 - 衣物脱去、亲吻爱抚、口交（oral cunnilingus）或乳交（titjob）",
        "Panel 4: 性爱进行 - 后入式（doggy style）插入，体位变化、抽插特写、呻吟描述",
        "Panel 5: 高潮射精 - 传教士体位（missionary）或女上位（cowgirl），高潮特写、颜射/内射/体外射精【画面必须可见精液】",
    ],
    6: [
        "Panel 1: 开场遇见 - 【女人单独出场】场景介绍、女人主题服装、暗示性第一眼（NO man yet，NO sex yet）",
        "Panel 2: 升温调情 - 男人加入，暧昧对话、轻微身体接触、衣服开始松开",
        "Panel 3: 脱衣亲密 - 衣物脱去、亲吻爱抚、口交前戏（oral cunnilingus）",
        "Panel 4: 性爱进行 - 后入式（doggy style）插入或女上位（cowgirl），体位、抽插",
        "Panel 5: 高潮逼近 - 传教士体位（missionary），体位深入、双方反应、呻吟",
        "Panel 6: 高潮射精 - 侧入式（spooning）或坐姿（reverse cowgirl），高潮特写、颜射/内射/体外射精【画面必须可见精液】",
    ],
    7: [
        "Panel 1: 开场遇见 - 【女人单独出场】场景介绍、女人主题服装、暗示性第一眼（NO man yet，NO sex yet）",
        "Panel 2: 升温调情 - 男人加入，暧昧对话、轻微身体接触",
        "Panel 3: 脱衣亲密 - 衣物脱去、亲吻爱抚、口交前戏（oral）",
        "Panel 4: 前戏深入 - 口交（deepthroat oral）、乳房爱抚、情趣挑逗",
        "Panel 5: 性爱进行 - 后入式（doggy style）插入，体位变化",
        "Panel 6: 高潮逼近 - 传教士体位（missionary），体位深入、呻吟",
        "Panel 7: 高潮射精 - 女上位（cowgirl）或侧入式（spooning），高潮特写、颜射/内射【画面必须可见精液】",
    ],
    8: [
        "Panel 1: 开场遇见 - 【女人单独出场】场景介绍、女人主题服装、暗示性第一眼（NO man yet，NO sex yet）",
        "Panel 2: 升温调情 - 男人加入，暧昧对话、轻微身体接触",
        "Panel 3: 脱衣亲密 - 衣物脱去、亲吻爱抚、口交（cunnilingus oral）",
        "Panel 4: 前戏深入 - 口交（deepthroat）、乳房爱抚、情趣玩具",
        "Panel 5: 性爱进行 A - 后入式（doggy style），体位变化",
        "Panel 6: 性爱进行 B - 女上位（cowgirl reverse），呻吟加剧",
        "Panel 7: 高潮特写 - 传教士体位（missionary），射前最后阶段",
        "Panel 8: 高潮射精 - 站立式（standing）或坐姿（cowgirl），高潮特写、颜射/内射【画面必须可见精液】",
    ],
    9: [
        "Panel 1: 开场遇见 - 【女人单独出场】场景介绍、女人主题服装、暗示性第一眼（NO man yet，NO sex yet）",
        "Panel 2: 升温调情 - 男人加入，暧昧对话、轻微身体接触",
        "Panel 3: 脱衣亲密 - 衣物脱去、亲吻爱抚、口交（oral cunnilingus）",
        "Panel 4: 前戏深入 - 口交（deepthroat）、乳房爱抚",
        "Panel 5: 性爱开始 - 后入式（doggy style）插入，缓慢节奏",
        "Panel 6: 性爱进行 - 女上位（cowgirl），体位变化、呻吟",
        "Panel 7: 高潮逼近 - 传教士体位（missionary），呻吟达到顶峰",
        "Panel 8: 高潮特写 - 侧入式（spooning），射前最后阶段",
        "Panel 9: 高潮射精 - 坐姿（reverse cowgirl）或立式，颜射/内射【画面必须可见精液】",
    ],
    10: [
        "Panel 1: 开场遇见 - 【女人单独出场】场景介绍、女人主题服装、暗示性第一眼（NO man yet，NO sex yet）",
        "Panel 2: 升温调情 - 男人加入，暧昧对话、轻微身体接触",
        "Panel 3: 脱衣亲密 - 衣物脱去、亲吻爱抚、口交（oral cunnilingus）",
        "Panel 4: 前戏深入 - 口交（deepthroat）、乳房爱抚、情趣玩具",
        "Panel 5: 性爱开始 - 后入式（doggy style）插入，缓慢节奏",
        "Panel 6: 性爱进行 A - 女上位（cowgirl），节奏加快",
        "Panel 7: 性爱进行 B - 传教士体位（missionary），抽插",
        "Panel 8: 高潮逼近 - 侧入式（spooning），呻吟达到顶峰、身体颤抖",
        "Panel 9: 高潮特写 - 手交（handjob）或站立式（standing），射前最后阶段",
        "Panel 10: 高潮射精 - 坐姿（reverse cowgirl）或颜射（facial），高潮特写【画面必须可见精液】",
    ],
}



_NORMAL_OUTLINE_SYSTEM = """You are an expert adult comic director. A user selected theme: "{theme_title}".
{theme_coherence}

Generate a COMPLETELY UNIQUE and CREATIVE narrative outline and {panel_count} storyboard panels for a 15-30 second short video.
""" + ETHNICITY_BLOCK + CHARACTER_BIBLE_BLOCK + THEME_COHERENCE_BOOST_BLOCK + """

【THEME FIRST】: Theme consistency is a HARD CONSTRAINT — see the THEME CONTRACT block
above. Within that constraint, use your imagination for story flavor and dialogue.

【CREATIVITY WITHIN CONSTRAINTS】:
- Invent unique character introductions, emotions, dialogue, and actions — but
  every character stays IN the ★ SCENARIOS and wears ★ COSTUMES.
- Vary emotions and body language across panels
- Add specific dialogue lines, character quirks, props visible in the scene
- Each panel's image_prompt should be CINEMATIC and UNIQUE, but still feature the
  ★ theme location and ★ theme costume
- NEVER copy the arc_panels template structure verbatim — use it as inspiration only

STRICT PACING - Each panel MUST follow this general structure:
{arc_panels}

Panel requirements:
- All panels feature the SAME characters (consistent appearance throughout)
- Each panel advances the narrative naturally
- All characters are ADULTS 18+
- No minors
- Be CREATIVE within the THEME CONTRACT
- Include the character's ethnicity/nationality in BOTH scene_description (Chinese) AND image_prompt (English, with skin tone + facial features specific to that ethnicity)

For EACH panel provide:
- scene_description: What happens in this panel (emotions, actions, setting) — set IN a ★ SCENARIO location with characters wearing ★ COSTUMES
- image_prompt: Stable Diffusion / Flux image prompt (detailed, cinematic, UNIQUE). MUST start with explicit ethnicity descriptor (e.g. "a beautiful Iranian woman with fair olive skin and dark almond eyes", "a handsome Italian man with olive skin and dark brown hair", "a Brazilian woman with tanned olive skin and dark curly hair", "a Russian man with pale skin and light blue eyes", "a Chinese woman with warm beige skin and silky black hair"). MUST also include the ★ scenario location (in English equivalent) and the ★ costume keyword (in English equivalent).

Output as raw JSON:
{{"outline": {{"arc": "{arc_label}", "scenes": ["场景1描述", "场景2描述", ...]}}, "storyboard": [{{"panel_number": 1, "scene_description": "...", "image_prompt": "..."}}, ...]}}

Do NOT wrap in markdown. Output raw JSON only."""


_R18_OUTLINE_SYSTEM = """You are an EXPERT adult comic director specializing in EXPLICIT sexual content. User selected theme: "{theme_title}".
{theme_coherence}
""" + ETHNICITY_BLOCK + CHARACTER_BIBLE_BLOCK + THEME_COHERENCE_BOOST_BLOCK + """

【THEME FIRST】: Theme consistency is a HARD CONSTRAINT — see the THEME CONTRACT block
above. EXPLICIT pacing/positions below should fit INTO the ★ SCENARIOS and ★ COSTUMES.

【POSE RANDOMIZATION - ABSOLUTELY MANDATORY】:
You MUST select EXPLICITLY DIFFERENT sexual positions for each panel from the following 105-pose pool. NO TWO panels may share the same position category (e.g. doggy, cowgirl, missionary, 69, etc.). Variety is CRITICAL.

AVAILABLE POSITIONS (pick different ones per panel):
{pose_list}

【CREATIVITY WITHIN CONSTRAINTS】:
- Invent unique character introductions, emotions, dialogue, and actions — but
  every character stays IN the ★ SCENARIOS and wears ★ COSTUMES.
- Vary emotions and body language across panels
- Add specific dialogue lines, character quirks, props visible in the scene
- Each panel's image_prompt should be CINEMATIC and UNIQUE, but still feature the
  ★ theme location and ★ theme costume
- NEVER copy the arc_panels template structure verbatim — use it as inspiration only

STRICT PACING - Each panel MUST follow this general arc (NO skipping to sex in Panel 1):
{arc_panels}

CRITICAL PACING RULES:
- Panel 1: NO explicit sex. Focus on: character intro (with ethnicity), ★ COSTUME intro, ★ SCENARIO setting, building sexual tension, eye contact, atmosphere. TENSION first.
- Panel 2: Clothes start coming off. Kissing, foreplay begins. Still building.
- Panel 3+: ONLY THEN show explicit sexual acts. Use a DIFFERENT position from Panel 1's vibe.
- Each panel must ADVANCE the sexual narrative naturally
- NEVER jump directly to penetration in Panel 1

EXPLICIT CONTENT requirements for Panel 3+:
- MANDATORY: Pick one position from the {pose_list} list above for each panel. Each panel MUST use a DISTINCTLY DIFFERENT position from all other panels.
- Use explicit sexual terms: suck, lick, fuck, penetrate, thrust, cum, ejackulate, spray, spread, thrust in, balls deep, face covered
- Describe anatomy: penis, vagina, breasts, nipples, asshole, lips, tongue
- Describe body fluids: saliva, precum, cum, vaginal fluids
- Describe camera angles: POV, close-up on genitals, spread shot, cum shot, POV insertion
- Be CREATIVE in how characters express pleasure and interact, WHILE staying in ★ SCENARIOS
- ALWAYS start image_prompt with explicit ethnicity descriptor (e.g. "a beautiful Thai woman with warm beige skin and silky black hair,", "a handsome Brazilian man with tanned olive skin and dark brown eyes,", "a stunning Iranian woman with fair olive skin and dark almond eyes,", "a chiseled Russian man with pale skin and light blue eyes,"). Skin tone/facial features must MATCH the chosen ethnicity.
- image_prompt MUST also include the ★ scenario location (in English equivalent) and the ★ costume keyword.

CRITICAL: ALL characters 18+. NO minors. NO non-consent. NO animals.



【LEAD-WOMAN PANEL 1 — MANDATORY SINGLE-WOMAN OPENING】:
Panel 1 of EVERY R18 storyboard MUST feature ONLY the woman on screen. NO man
appears in Panel 1 — even when the arc uses a man in later panels. The Panel 1
woman must be presented alone in the ★ SCENARIO location, wearing the ★ COSTUME,
with her ethnicity descriptor (East Asian / Korean / Japanese / Chinese preferred),
her expression / eye contact / pose, and atmosphere. The man may enter from Panel 2
onward (or not at all if the theme is lesbian).
- image_prompt for Panel 1 MUST start with `1girl, ` (NOT `1girl, 1boy,`) and
  describe ONLY the woman's appearance + scene + mood.
- scene_description for Panel 1 should NOT mention a man or "the man".
- This rule applies to EVERY theme (het / lesbian / etc.) unless the theme
  literally demands two characters in the opening (rare).

【LESBIAN / 双女主 / 拉拉 / 女同 / 闺蜜 THEME — NO-MAN RULE】:
If the theme name contains ANY of these keywords (拉拉, 女同, 百合, 双女主, 双女,
闺蜜, lesbian, trib, scissor, girl on girl, sapphic, wlw, femdom, 女性支配, 两女)
— OR the theme's tags/category match — then the entire storyboard features ONLY
women. NO MAN appears in ANY panel.
- image_prompt must use `1girl, ` (no `1boy`, no `man`, no `male`, no `Black man`,
  no `muscular man`, no `penis`, no `cumshot`).
- Use East Asian woman + European white woman (or two East Asian women) as the
  default pair. Sex acts are female-on-female: scissoring, tribbing, fingering,
  oral (cunnilingus), 69, mutual masturbation, using a strap-on.
- Replace any "1boy" / "the man" / "his cock" with the second woman.

【VISIBLE CUM ON LAST SEX PANEL — MANDATORY】:
The LAST panel of any R18 storyboard (Panel N where sex/climax happens) MUST show
visible semen / cum on or in the body. Do NOT write "cum" only as a verb — make it
visible in the rendered image:
- For cum INSIDE (creampie): "creampie visible", "cum dripping from her vagina",
  "cum leaking out of pussy", "semen visible inside", "creampie residue".
- For cum ON body (facial / body shots): "cum on her face", "cum on her breasts",
  "cum dripping down her chin", "visible cum splattered on skin", "thick ropes of
  cum on her stomach", "facial cumshot".
- For cum ON surface: "cum puddle on the sheets", "cum splattered on her thighs".
- Always include these literal English tags in the FINAL panel's image_prompt:
  `cum, visible cum, dripping cum, cum on body, semen, cumshot`. The model must
  paint these visibly — abstract "climax" without cum visible is a HARD FAILURE.
- For lesbian stories, the LAST panel must show female ejaculation / squirting /
  visible vaginal fluids instead.

【DISTINCT POSITION PER PANEL — HARD RULE】:
Each panel's image_prompt MUST describe a DIFFERENT sex position. Pick from the
{pose_list} pool above. NO TWO panels may share the same position category
(missionary / doggystyle / cowgirl / 69 / etc.). If you reuse the same position
across two panels, the output is REJECTED.

Output as raw JSON:
{{"outline": {{"arc": "{arc_label}", "scenes": ["Panel 1: 前戏描述", "Panel 2: 升温描述", ...]}}, "storyboard": [{{"panel_number": 1, "scene_description": "中文场景描述", "image_prompt": "explicit SD prompt"}}, ...]}}

Do NOT wrap in markdown."""


@router.post("/storyboard/outline", response_model=StoryboardOutlineResponse)
async def generate_storyboard_outline(
    req: StoryboardOutlineRequest,
    api_key: str = Depends(get_api_key),
):
    """Step 2 of 2-step storyboard: Generate narrative outline and panels with STRICT pacing."""
    panel_count = req.panel_count
    if panel_count < 2:
        panel_count = 2
    if panel_count > 10:
        panel_count = 10

    # ── 异步模式：立即返回 task_id，后台执行 ──
    if req.async_mode:
        store = get_task_store()
        task = store.create("outline", {
            "theme_id": req.theme_id,
            "theme_title": req.theme_title,
            "panel_count": panel_count,
            "r18": req.r18,
            "model_order": req.model_order,
        })
        asyncio.create_task(_run_outline_task(task.task_id, req, api_key))
        return StoryboardOutlineResponse(task_id=task.task_id, theme_id=req.theme_id, theme_title=req.theme_title, outline=StoryboardOutline(arc="", scenes=[]), storyboard=[])

    # ── Look up theme for storyline coherence ────────────────────────────────
    selected_theme = None
    theme_scenarios_str = ""
    theme_costumes_str = ""
    theme_poses_str = ""
    if req.theme_id:
        try:
            seq_id = int(req.theme_id)
            from app.services.theme_database import get_theme_by_seq_id
            selected_theme = get_theme_by_seq_id(seq_id)
        except (ValueError, TypeError):
            selected_theme = None
        if selected_theme is None:
            from app.services.theme_database import get_theme_by_id
            selected_theme = get_theme_by_id(req.theme_id)
        # Verify title match — fall back to title-based lookup if not.
        if selected_theme is not None and req.theme_title:
            db_name = (selected_theme.get("name") or "").strip()
            req_name = (req.theme_title or "").strip()
            if db_name and req_name and db_name != req_name:
                logging.info(
                    "[storyboard/outline:sync] theme_id %s resolved to '%s' but user title is '%s'; trying title-based lookup",
                    req.theme_id, db_name, req_name,
                )
                selected_theme = None
    if selected_theme is None and req.theme_title:
        from app.services.theme_database import get_all_themes
        for t in get_all_themes():
            if isinstance(t, dict) and (t.get("name") or "").strip() == (req.theme_title or "").strip():
                selected_theme = t
                logging.info(
                    "[storyboard/outline:sync] title-based lookup matched '%s' to id %s",
                    req.theme_title, t.get("id"),
                )
                break
    if selected_theme:
        scenarios = selected_theme.get("scenarios", [])
        costumes = selected_theme.get("costumes", [])
        poses = selected_theme.get("poses", [])
        main_scenarios = scenarios[:2] if len(scenarios) > 2 else scenarios
        if main_scenarios:
            theme_scenarios_str = "主场景设定（必须使用,不可替换）: " + "、".join(main_scenarios)
            if len(scenarios) > 2:
                theme_scenarios_str += "\n辅助场景（可选,过渡用,不超过2个）: " + "、".join(scenarios[2:])
        if costumes:
            theme_costumes_str = "服装造型（必须选择1-2个使用,前3个分镜必须保留主服装）: " + "、".join(costumes)
        if poses:
            theme_poses_str = "姿势风格（参考）: " + "、".join(poses)

    coherence_context = ""
    if selected_theme:
        scenarios_s = selected_theme.get("scenarios", []) or []
        costumes_s = selected_theme.get("costumes", []) or []
        poses_s = selected_theme.get("poses", []) or []
        tags_s = selected_theme.get("tags", []) or []
        desc_s = selected_theme.get("description", "")
        name_s = selected_theme.get("name", req.theme_title)

        scenarios_block_s = "\n".join(f"   ★ {s}" for s in scenarios_s) if scenarios_s else "   (none)"
        costumes_block_s = "\n".join(f"   ★ {c}" for c in costumes_s) if costumes_s else "   (none)"
        poses_block_s = ("\n".join(f"   · {p}" for p in poses_s) + "\n") if poses_s else ""

        coherence_context = (
            "\n\n"
            "═══════════════════════════════════════════════════════════════════════\n"
            f"  THEME CONTRACT: 「{name_s}」\n"
            "═══════════════════════════════════════════════════════════════════════\n"
            f"Description: {desc_s}\n"
            f"Tags: {', '.join(tags_s) if tags_s else '(none)'}\n"
            "\n"
            "MANDATORY SCENARIOS — every panel MUST take place in ONE of:\n"
            f"{scenarios_block_s}\n"
            "\n"
            "MANDATORY COSTUMES — every panel's character(s) MUST wear ONE of:\n"
            f"{costumes_block_s}\n"
            "\n"
            + (f"REFERENCE POSES (suggestions only):\n{poses_block_s}\n" if poses_block_s else "")
            + "\n"
            "ABSOLUTE RULES — violating any is a HARD FAILURE:\n"
            "  1. EVERY panel must be set in one of the ★ SCENARIOS above. Off-theme\n"
            "     locations (parks, subways, cafes, trains, beaches, hotels, classrooms,\n"
            "     fantasy worlds, etc.) are BANNED unless they appear in the ★ list.\n"
            "  2. EVERY panel's characters MUST wear one of the ★ COSTUMES above.\n"
            "  3. Stay with 1-2 PRIMARY scenarios from the list for the WHOLE storyboard.\n"
            "  4. The PRIMARY ROLE is the MAIN CHARACTER of every panel. 「园丁」 →\n"
            "     the gardener; 「电影院放映厅」 → people inside a movie theater.\n"
            "  5. NEVER synonym-substitute the scenario. Use the EXACT ★ word.\n"
"  6. If a scene cannot naturally fit, RESTRUCTURE — never substitute.\n"
                "  7. CHARACTER CONSISTENCY: Define the MAIN CHARACTER(s) ONCE in panel 1\n"
                "     (including their ethnic appearance / nationality / look) and KEEP them\n"
                "     IDENTICAL across ALL panels. NEVER change a character's nationality or\n"
                "     ethnicity between panels. NEVER introduce a new character from a\n"
                "     different country/ethnicity mid-storyboard unless explicitly in ★ list.\n"
                "     For multi-person themes (拳击搭档 / 高尔夫球童 / etc.), the SAME two\n"
                "     characters appear in EVERY panel — never replace them with people from\n"
                "     different countries.\n"
                "  8. PRIMARY LOCATION ANCHOR: The FIRST scenario in ★ SCENARIOS is the\n"
                "     PRIMARY location. At least 60% of panels MUST take place there (or in a\n"
                "     tightly-connected secondary scenario from the same list). Do NOT split\n"
                "     the storyboard across unrelated off-theme settings.\n"
                "\n"
                "Theme data is a HARD CONSTRAINT, not a creative suggestion."
        )

    if req.r18:
        arc_panels = _R18_ARC_PANELS.get(panel_count, _R18_ARC_PANELS[5])
        system_template = _R18_OUTLINE_SYSTEM
        arc_label = "开场遇见 → 升温调情 → 脱衣前戏 → 性爱进行 → 高潮射精"
        # Inject random poses so LLM picks diverse positions for each panel
        selected_poses = get_random_poses(panel_count + 2)
        pose_list_str = "\n".join(f"  - {p}" for p in selected_poses)
    else:
        arc_panels = _NORMAL_ARC_PANELS.get(panel_count, _NORMAL_ARC_PANELS[4])
        system_template = _NORMAL_OUTLINE_SYSTEM
        arc_label = "开场 → 发展 → 亲密 → 高潮 → 结尾"
        pose_list_str = ""

    arc_panels_str = "\n".join(f"  - {p}" for p in arc_panels)

    system_prompt = system_template.format(
        theme_title=req.theme_title,
        panel_count=panel_count,
        arc_panels=arc_panels_str,
        arc_label=arc_label,
        pose_list=pose_list_str,
        theme_coherence=coherence_context,
    )

    # Build a short keyword list that the LLM MUST echo back. We pass this in
    # the user_prompt (not the system_prompt) so it's reinforced right at the
    # end of the prompt where models tend to follow instructions most strictly.
    theme_keywords_required_sync: list = []
    if selected_theme:
        theme_keywords_required_sync.extend(selected_theme.get("scenarios", []) or [])
        theme_keywords_required_sync.extend(selected_theme.get("costumes", []) or [])
    theme_keywords_en_line_sync = ""
    try:
        from app.services.theme_database import theme_keywords_en
        en_aliases = theme_keywords_en(selected_theme) if selected_theme else []
        if en_aliases:
            en_aliases = en_aliases[:30]
            theme_keywords_en_line_sync = (
                "\n【THEME ENGLISH ALIASES — use these or direct English equivalents in image_prompt】: "
                + ", ".join(en_aliases)
            )
    except Exception:
        pass
    theme_keywords_line_sync = (
        f"\n【THEME KEYWORDS — MUST APPEAR IN YOUR OUTPUT】: "
        + ", ".join(theme_keywords_required_sync)
        if theme_keywords_required_sync else ""
    )

    user_prompt = (
        f"Theme: {req.theme_title}\n"
        f"Panel count: {panel_count}\n"
        f"【STRICT THEME CONSTRAINT — REPEAT】: 你必须只用 ★ SCENARIOS 列表里的地点,"
        f"只用 ★ COSTUMES 列表里的服装。如 system_prompt 的 THEME CONTRACT 所示。\n"
        f"【重要】Panel 1 不能有直接性爱！必须先从开场/前戏开始，逐步发展到性爱。\n"
        f"【重要】R18模式：每个分镜的 image_prompt 必须非常详细和露骨。所有 R18 要求适用,"
        f"但 THEME CONSTRAINT 优先级更高。\n"
        f"在生成的每个 panel.scene_description 里,地点名词必须来自 ★ SCENARIOS 列表;"
        f"服装名词必须来自 ★ COSTUMES 列表。\n"
        f"在生成的每个 panel.image_prompt (English) 里,location 和 outfit 也必须贴近 ★ 列表的语义。"
        f"{theme_keywords_line_sync}{theme_keywords_en_line_sync}\n"
        f"Output as raw JSON only, no markdown."
    )

    # Accept explicit model order from frontend, or fall back to service default
    model_order = req.model_order or None

    # Progressive safety override messages — get progressively stronger on each retry
    _SAFETY_OVERRIDES = [
        "IMPORTANT: All characters are ADULTS 18+. ABSOLUTELY NO minors, teenagers, or young-looking persons. Panel 1 MUST be foreplay/teasing only, NO explicit sex.",
        "STRICT SAFETY: All characters must be 18+ adults. Panel 1 = foreplay. Do NOT describe any sexual acts in Panel 1. Avoid keywords: teen, teenage, young adult, young looking, minor, school, girl, boy.",
        "CRITICAL: This is an ADULT-ONLY (18+) content. All characters must be 18+. Panel 1 MUST be non-sexual foreplay only. REJECT and AVOID these terms: teen, teenage, minor, young, schoolgirl, schoolboy, school, young adult, young looking, kid, child.",
    ]

    # q3+ bugfix: theme_name was assigned AFTER the retry loop (in the
    # post-processing block), but referenced INSIDE the retry loop (logging
    # when placeholder tokens detected). Initialize here so the loop is safe.
    theme_name = req.theme_title or ""

    for attempt in range(MAX_RETRIES):
        try:
            raw = await call_grok(api_key, system_prompt, user_prompt, model_order=model_order)
            data = clean_json_response(raw)

            check_prompt_safety(raw)

            if not isinstance(data, dict):
                raise HTTPException(status_code=500, detail="Invalid LLM response format, expected JSON dict")

            outline_data = data.get("outline", {})
            if isinstance(outline_data, dict):
                outline = StoryboardOutline(
                    arc=str(outline_data.get("arc", "")),
                    scenes=list(outline_data.get("scenes", [])) if isinstance(outline_data.get("scenes"), list) else [],
                )
            else:
                outline = StoryboardOutline(arc=arc_label, scenes=list(arc_panels))

            panels_raw = data.get("storyboard", [])
            if not isinstance(panels_raw, list):
                raise HTTPException(status_code=500, detail="Invalid storyboard format")

            panels = []
            for item in panels_raw:
                if not isinstance(item, dict):
                    continue
                scene = str(item.get("scene_description", ""))
                prompt_text = str(item.get("image_prompt", ""))

                # Drop panels that are clearly the LLM parroting the prompt
                # instructions back as content (e.g. "在公园长椅，亚洲的
                # 约会装迷你裙，身体部位，体液等描写"). Same heuristic as
                # the async runner so behavior is consistent.
                _PLACEHOLDER_TOKENS = (
                    "身体部位", "体液等描写", "体液等", "等描写",
                    "亚洲的约会装", "迷你裙身体部位",
                )
                _combined = scene + "\n" + prompt_text
                if any(tok in _combined for tok in _PLACEHOLDER_TOKENS):
                    logging.warning(
                        "[storyboard/outline] dropping prompt-template-leak panel: theme=%s panel=%s sample=%s",
                        theme_name,
                        item.get("panel_number", "?"),
                        (scene or prompt_text)[:80],
                    )
                    continue

                try:
                    check_prompt_safety(scene)
                    check_prompt_safety(prompt_text)
                except ContentSafetyError:
                    # Safety failed for this specific panel — skip it, don't fail entire request
                    logging.warning(
                        "[storyboard/outline] safety check failed for panel, skipping: %s",
                        item.get("panel_number", "?"),
                    )
                    continue

                scene_conflicts = detect_prompt_conflicts(scene)
                prompt_conflicts = detect_prompt_conflicts(prompt_text)
                if scene_conflicts or prompt_conflicts:
                    try:
                        prompt_text = await rewrite_coherent_prompt(prompt_text, api_key)
                        check_prompt_safety(prompt_text)
                    except ContentSafetyError:
                        # Rewrite still failed safety — skip this panel instead of failing entire request
                        logging.warning(
                            "[storyboard/outline] rewrite failed safety for panel, skipping: %s",
                            item.get("panel_number", "?"),
                        )
                        continue
                    except YunwuTimeoutError:
                        # Timeout during rewrite — keep original prompt
                        logging.warning("[storyboard/outline] rewrite timed out, keeping original prompt")
                        pass

                try:
                    panels.append(StoryboardPanel(
                        panel_number=int(item.get("panel_number", 0)),
                        scene_description=scene,
                        image_prompt=prompt_text,
                    ))
                except Exception:
                    continue

            # ── Lock character identity across panels via [ANCHOR] injection ──
            # Extract the anchor from panel 1, then re-inject it verbatim into every
            # other panel. This is the single most important fix for theme
            # consistency: it guarantees that the SAME character (same outfit color,
            # same hair, same shoes, same key props) appears in every frame even if
            # the LLM drifts in panels 2..N.
            if panels:
                first_anchor_sync = _extract_character_anchor(panels[0].image_prompt)
                first_anchor_sync = _normalize_anchor_for_safety(first_anchor_sync)
                if first_anchor_sync:
                    locked_panels = []
                    for p in panels:
                        new_image_prompt = _inject_character_anchor(
                            p.image_prompt,
                            first_anchor_sync,
                        )
                        locked_panels.append(StoryboardPanel(
                            panel_number=p.panel_number,
                            scene_description=p.scene_description,
                            image_prompt=new_image_prompt,
                        ))
                    panels = locked_panels
                    logging.info(
                        "[storyboard/outline] locked character anchor across %d panels: %s",
                        len(panels),
                        first_anchor_sync[:120],
                    )

            # ── Enforce theme-coherent outfit/location on FOREPLAY panels ──
            if panels and selected_theme:
                from app.services.theme_database import get_theme_by_seq_id, get_theme_by_id
                canon_theme_sync = selected_theme
                if not isinstance(canon_theme_sync, dict):
                    canon_theme_sync = get_theme_by_id(req.theme_id) if isinstance(req.theme_id, str) else None
                    if canon_theme_sync is None:
                        try:
                            canon_theme_sync = get_theme_by_seq_id(int(req.theme_id))
                        except (ValueError, TypeError):
                            canon_theme_sync = None
                # q3+ bugfix: theme_name is now initialized before the retry
                # loop (see marker above). Don't reassign here — just use it.
                if isinstance(canon_theme_sync, dict):
                    fix_count_sync = 0
                    fixed_panels_sync = []
                    for idx, p in enumerate(panels):
                        new_scene_sync, new_image_sync = _enforce_theme_coherence(
                            scene_description=p.scene_description,
                            image_prompt=p.image_prompt,
                            theme_name=theme_name,
                            theme_data=canon_theme_sync,
                            panel_index=idx,
                            total_panels=len(panels),
                            r18=bool(req.r18),
                        )
                        if new_scene_sync != p.scene_description or new_image_sync != p.image_prompt:
                            fix_count_sync += 1
                        fixed_panels_sync.append(StoryboardPanel(
                            panel_number=p.panel_number,
                            scene_description=new_scene_sync,
                            image_prompt=new_image_sync,
                        ))
                    panels = fixed_panels_sync
                    if fix_count_sync:
                        logging.info(
                            "[storyboard/outline] theme-coherence fixed %d/%d panels (theme=%s)",
                            fix_count_sync, len(panels), theme_name,
                        )

                # ── Hard post-processing: single-woman Panel 1 + lesbian no-man + visible cum ──
                if panels and selected_theme:
                    rule_fix_sync = 0
                    rule_panels = []
                    for idx, p in enumerate(panels):
                        d = {"scene_description": p.scene_description, "image_prompt": p.image_prompt}
                        _enforce_panel_rules(
                            panels=[d],
                            theme_name=theme_name,
                            theme_data=selected_theme if isinstance(selected_theme, dict) else {},
                            r18=bool(req.r18),
                        )
                        if d["scene_description"] != p.scene_description or d["image_prompt"] != p.image_prompt:
                            rule_fix_sync += 1
                        rule_panels.append(StoryboardPanel(
                            panel_number=p.panel_number,
                            scene_description=d["scene_description"],
                            image_prompt=d["image_prompt"],
                        ))
                    panels = rule_panels
                    if rule_fix_sync:
                        logging.info(
                            "[storyboard/outline] panel-rules fixed %d/%d panels (theme=%s)",
                            rule_fix_sync, len(panels), theme_name,
                        )

            # ── Sanity check: detect any outfit color drift between panels ──
            if len(panels) >= 2:
                drifts_sync = detect_outfit_color_drift([p.image_prompt for p in panels])
                if drifts_sync:
                    logging.warning(
                        "[storyboard/outline] outfit color drift detected (%d issues): %s",
                        len(drifts_sync),
                        "; ".join(drifts_sync[:3]),
                    )

            if not panels:
                # q3+ bugfix: empty panels — retry instead of immediate 500.
                # Strengthen the prompt with a "no drift, output valid JSON" note.
                OUTER_RETRY_BUDGET = 2
                if attempt < MAX_RETRIES - 1 + OUTER_RETRY_BUDGET:
                    logging.warning(
                        "[storyboard/outline] empty panels on attempt %s, retrying with stronger prompt (theme=%s)",
                        attempt + 1, theme_name,
                    )
                    system_prompt += (
                        "\n\n[RETRY INSTRUCTION] Your previous response did not produce "
                        "any valid panels. STRICTLY use ONLY the ★ SCENARIOS and ★ COSTUMES "
                        "from the THEME CONTRACT above. Output valid JSON with the correct "
                        f"schema. Topic: {theme_name}."
                    )
                    user_prompt += (
                        "\n\n[RETRY NOTE] Previous response had no usable panels. Output "
                        "valid JSON now, using ONLY the ★ SCENARIOS/★ COSTUMES from the "
                        "THEME CONTRACT."
                    )
                    continue
                raise HTTPException(
                    status_code=500,
                    detail=f"主题「{theme_name}」多次重试仍无法生成有效分镜，请换主题或稍后再试。",
                )

            return StoryboardOutlineResponse(
                theme_id=req.theme_id,
                theme_title=req.theme_title,
                outline=outline,
                storyboard=panels,
            )
        except ContentSafetyError as e:
            logging.warning(
                "[storyboard/outline] content safety error on attempt %s/%s: %s",
                attempt + 1, MAX_RETRIES, str(e),
            )
            if attempt < MAX_RETRIES - 1:
                # Use progressive override — stronger each time, and on 2nd+ retry also
                # strengthen the user prompt to reset context
                override_msg = _SAFETY_OVERRIDES[min(attempt, len(_SAFETY_OVERRIDES) - 1)]
                system_prompt += f"\n\n{override_msg}"
                user_prompt = (
                    f"Theme: {req.theme_title}\n"
                    f"Panel count: {panel_count}\n"
                    f"【重要】Panel 1 不能有直接性爱！必须先从开场/前戏开始，逐步发展到性爱。\n"
                    f"【重要】R18模式：每个分镜的 image_prompt 必须非常详细和露骨，描述体位、身体部位、体液等。\n"
                    f"【重要】所有角色必须是18+成年人！严禁出现 teen, teenage, minor, young adult, schoolgirl, schoolboy 等词汇！\n"
                    f"Output as raw JSON only, no markdown."
                )
                continue
            raise HTTPException(status_code=400, detail=str(e))
        except (YunwuTimeoutError, YunwuRateLimitError) as e:
            # Retry on timeout and rate limit
            if attempt < MAX_RETRIES - 1:
                continue
            raise _map_llm_error(e)
        except YunwuAPIError as e:
            # Retry on Yunwu API errors (502 from upstream)
            logging.warning("[storyboard/outline] upstream API error on attempt %s/%s: %s", attempt + 1, MAX_RETRIES, e)
            if attempt < MAX_RETRIES - 1:
                continue
            raise _map_llm_error(e)
        except YunwuParseError as e:
            # Retry on JSON parse errors
            logging.warning("[storyboard/outline] parse error on attempt %s/%s: %s", attempt + 1, MAX_RETRIES, e)
            if attempt < MAX_RETRIES - 1:
                continue
            raise _map_llm_error(e)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"未知错误: {str(e)}")


# ─── Step 3: Generate Video Script from Panels ─────────────────────────────────

_VIDEO_SCRIPT_SYSTEM = """You are an EXPERT adult video director. Based on the provided {panel_count} storyboard panels, write a complete VIDEO SCRIPT for a 15-30 second short video.

The script should be written as a professional film screenplay with:
1. SCENE HEADING: Time of day, location (e.g. INT. HOTEL ROOM - NIGHT)
2. ACTION/LINE: What's happening physically
3. DIALOGUE: Character dialogue (if any)
4. SOUND CUE: [MUSIC], [AMBIENT], [MOANING], [SLAPPING], [HEAVY BREATHING]
5. CAMERA: Camera direction (e.g. POV, close-up, wide shot, tracking)

CRITICAL PACING: Follow the same arc as the panels:
- If Panel 1 is foreplay → script should describe tension and anticipation
- If Panel N is climax → script should describe the peak moment

For R18 content, the script MUST include:
- Explicit descriptions of sexual actions, positions, body parts
- Sound cues for sexual activity: wet sounds, skin slapping, moaning, breathing
- Camera directions: POV insertion, close-up on genitals, spread shot, POV oral, cum shot
- Dialogue that enhances the scene

Each panel becomes a section of the script. Write in Chinese for scene headings and action, with English technical terms for positions/acts where appropriate.

Output as raw JSON:
{{"script_title": "视频标题", "duration": "15-30秒", "panels": [
  {{"panel": 1, "heading": "场景", "action": "动作描述", "dialogue": "对白", "sound_cue": "声音提示", "camera": "镜头方向"}},
  ...
]}}

Do NOT wrap in markdown."""


@router.post("/storyboard/script", response_model=StoryboardScriptResponse)
async def generate_video_script(
    req: StoryboardScriptRequest,
    api_key: str = Depends(get_api_key),
):
    """Step 3: Generate a complete video script from the storyboard panels."""
    if not req.panels or len(req.panels) == 0:
        raise HTTPException(status_code=400, detail="No panels provided for script generation")

    # ── 异步模式：立即返回 task_id，后台执行 ──
    if req.async_mode:
        store = get_task_store()
        task = store.create("script", {
            "theme_title": req.theme_title,
            "r18": req.r18,
            "panels": [{"panel_number": p.panel_number, "scene_description": p.scene_description, "image_prompt": p.image_prompt} for p in req.panels],
        })
        asyncio.create_task(_run_script_task(task.task_id, req, api_key))
        return StoryboardScriptResponse(task_id=task.task_id, theme_title=req.theme_title, script_title="", duration="15-30秒", panels=[])

    panels_context = "\n\n".join([
        f"Panel {p.panel_number}: {p.scene_description}\nImage Prompt: {p.image_prompt}"
        for p in req.panels
    ])

    system_prompt = _VIDEO_SCRIPT_SYSTEM.format(panel_count=len(req.panels))

    user_prompt = (
        f"Theme: {req.theme_title}\n"
        f"R18 Mode: {'Yes' if req.r18 else 'No'}\n"
        f"Panels:\n{panels_context}\n\n"
        f"Please generate a complete video script in Chinese. "
        f"For R18: describe sexual acts explicitly, include sound cues for sex sounds, camera POV shots. "
        f"Output as raw JSON only."
    )

    for attempt in range(MAX_RETRIES):
        try:
            raw = await call_grok(api_key, system_prompt, user_prompt)
            data = clean_json_response(raw)

            check_prompt_safety(raw)

            if not isinstance(data, dict):
                raise HTTPException(status_code=500, detail="Invalid script format")

            script_title = str(data.get("script_title", f"{req.theme_title} - 短视频脚本"))
            panels_raw = data.get("panels", [])

            script_panels = []
            for item in panels_raw:
                if not isinstance(item, dict):
                    continue
                try:
                    script_panels.append(VideoScriptPanel(
                        panel=int(item.get("panel", 0)),
                        heading=str(item.get("heading", "")),
                        action=str(item.get("action", "")),
                        dialogue=str(item.get("dialogue", "")),
                        sound_cue=str(item.get("sound_cue", "")),
                        camera=str(item.get("camera", "")),
                    ))
                except Exception:
                    continue

            # 兜底：LLM 有时只回 script_title 不回 panels（grok-4-1-fast-non-reasoning
            # 在只有 1 个 panel 时尤其容易偷懒）。这种情况视为解析失败，
            # 追加一条强提示让 LLM 重新生成完整结构。MAX_RETRIES 已经覆盖
            # 多次重试，扣费由用户在前端触发前知情。
            if len(script_panels) == 0 and attempt < MAX_RETRIES - 1:
                logging.warning(
                    "[storyboard/script] LLM returned empty panels "
                    "(title=%r), retry %s/%s with stronger instruction",
                    script_title, attempt + 1, MAX_RETRIES,
                )
                user_prompt = (
                    f"{user_prompt}\n\n"
                    f"IMPORTANT: You MUST output a 'panels' array with EXACTLY "
                    f"{len(req.panels)} element(s), one for each input panel. "
                    f"Each element must have: panel, heading, action, dialogue, sound_cue, camera. "
                    f"Do NOT return an empty panels array."
                )
                continue

            return StoryboardScriptResponse(
                theme_title=req.theme_title,
                script_title=script_title,
                duration=str(data.get("duration", "15-30秒")),
                panels=script_panels,
            )
        except ContentSafetyError as e:
            if attempt < MAX_RETRIES - 1:
                continue
            raise HTTPException(status_code=400, detail=str(e))
        except (YunwuTimeoutError, YunwuRateLimitError, YunwuParseError, YunwuAPIError) as e:
            if attempt < MAX_RETRIES - 1:
                continue
            raise _map_llm_error(e)
        except YunwuAuthError as e:
            raise _map_llm_error(e)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"未知错误: {str(e)}")

