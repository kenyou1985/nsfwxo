"""
主题服装 → 规范化「颜色 + 款式 + 服装名」全称（覆盖全部 542 个主题）

背景
----
542 个主题的 ``costumes`` 字段里，**519/544 条是光秃秃的名词**
（「紧身连衣裙」「OL通勤装」「情趣内衣」）。LLM 拿到这种输入只能自己现编颜色，
于是同一套衣服在 9 个分镜里被写成白色 / 黑色 / 红色三种，图像模型随之把
同一角色画成三套衣服 —— 这就是「前后款式/颜色不一致」的**根因**。

后处理层（``outfit_consistency``）只能在 LLM 输出之后做修正，但 LLM 每次
现编的颜色都不同，逐镜兜底只能勉强拉齐；而**跨主题串味**还会误删正文。

本模块把每条 costume 解析成规范全称，并同时给出：

* ``zh``     —— 中文全称（颜色 + 款式 + 服装名）。直接写进 THEME CONTRACT，
                LLM 照抄即可，跨分镜自然一致。
* ``en``     —— 英文全称，供 ``image_prompt`` 使用。
* ``nouns``  —— 该服装包含的服装名词（中文），供锁定与串味过滤使用。
* ``anchors``—— 服装名词 → 规范全称的映射。后处理层据此把每一镜里的
                「浴袍」补成「白色宽松浴袍」，把「黑色浴袍」拉回「白色宽松浴袍」。

三类 costume
------------
* **服装**（GARMENT）：给全称 + anchors。
* **状态**（STATE）：裸体 / 脱衣 / 湿身这类**身体状态**，不是服装，
  不产生 anchors，也不参与串味过滤（否则会把「全裸」主题的衣服全删掉）。
* **道具**（PROP）：刀、椅子、灯这类场景物件，不穿在身上，原样透传。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Mapping, Optional, Sequence, Set, Tuple

from app.services.outfit_consistency import (
    _zh_color_of,
    _zh_modifier_span,
    _zh_style_of,
    en_garment_nouns,
    register_garment_nouns,
    zh_garment_nouns,
)

# ═══════════════════════════════════════════════════════════════════════════
# 1) 服装名词总表
# ═══════════════════════════════════════════════════════════════════════════
# outfit_consistency 原有词表只覆盖了 ~110 个常用服装词；主题库里的
# 「舞衣」「队服」「演出服」「职业套装」等 390 条 costume 落不进词表 →
# 既锁不住，也会被串味过滤误删。这里补齐。
EXTRA_GARMENT_NOUNS: Tuple[str, ...] = (
    "职业套装", "紧身职业套装", "职业套裙", "紧身职业装", "西装校服", "白衬衫",
    "商务衬衫", "丝绸衬衫", "紧身衬衫", "湿身衬衫", "湿透的衬衫", "衬衫短裙",
    "蕾丝内衣", "棉质内衣", "丝绸内衣", "简单内衣", "部分内衣", "保暖内衣",
    "情趣内衣", "运动内衣", "舞蹈内衣", "紧身包臀裙", "紧身连衣裙",
    "性感连衣裙", "田园连衣裙", "夜归连衣裙", "轻薄连衣裙", "湿身连衣裙",
    "蕾丝长裙", "丝绸长裙", "哥特长裙", "铅笔裙", "碎花裙", "长袖牛仔裤",
    "蕾丝睡裙", "蕾丝睡衣", "蕾丝丁字裤", "蕾丝裙", "蕾丝装",
    "紧身裙", "紧身上衣", "紧身上装", "紧身装", "紧身吊带", "紧身法袍",
    "紧身潜入服", "紧身VR服", "紧身职业套装", "紧身皮衣", "紧身连体衣",
    "乳胶连体衣", "乳胶紧身衣", "乳胶全身服", "乳胶手套", "乳胶靴", "乳胶装",
    "运动装", "运动服", "运动内衣", "运动背心", "运动短裤", "运动绷带",
    "健身服", "健身短裤", "瑜伽服", "瑜伽裤", "瑜伽短裤", "舞蹈服",
    "舞蹈内衣", "钢管舞服", "脱衣舞服", "舞衣", "排练服", "演出服",
    "表演服", "舞台装", "乐队服装", "主播装", "网红装", "直播服装",
    "电竞队服", "电竞椅装", "队服", "赛车连体服", "赛车宝贝装",
    "赛车宝贝背心", "赛车手套", "赛车靴", "赛车头盔", "赛车服",
    "队服", "球衣", "球袜", "球童服", "啦啦队服", "高尔夫装", "高尔夫球装",
    "工作服", "工作装", "工作裤", "工作短裤", "工装裤", "工坊服",
    "厨师服", "厨师装", "园丁服", "农夫装", "渔夫装", "牧人装",
    "医疗服", "医疗装", "医疗制服", "医疗紧身衣", "治疗服", "治疗袍",
    "理疗服", "按摩师服装", "按摩师制服", "美容师制服", "义工服",
    "关怀服", "探视服", "实验服", "白大褂", "医生白大褂", "护士服",
    "护士装", "护士制服", "护士长制服", "护士帽", "牙医制服", "牙科制服",
    "警察制服", "警帽", "监狱制服", "囚服", "病号服", "检察官制服",
    "法官袍", "律师袍", "乘务制服", "空乘制服", "空姐制服", "机长制服",
    "船长制服", "船长服", "海员服", "海军制服", "消防服", "消防员制服",
    "军装", "军帽", "教师套装", "学生制服", "校服", "校园制服",
    "实验服", "船员服", "侍者服", "服务生制服", "乘务员", "便利店制服",
    "司机制服", "品酒师制服", "美容师制服", "设计师装", "摄影师装",
    "理发师装", "纹身师装", "助手装", "私人助理装", "秘书装", "管家制服",
    "导游服", "策展装", "策划师装", "裁缝装", "调香师装", "宠物装",
    "吉祥物装", "圣诞老人装", "圣诞袜", "足球服", "橄榄球服",
    "登山服", "攀岩服", "滑雪服", "冲浪服", "潜水服", "水肺装",
    "探险服", "探险装", "科考服", "户外装", "户外服装", "户外运动装",
    "防寒服", "防护服", "防火衣", "消防服", "防水服", "防水外套",
    "防晒衫", "速干衣", "骑行服", "骑装", "骑手上衣", "马裤",
    "蹦极服", "瑜伽服", "冥想服", "禅服", "道袍", "道服", "中医服",
    "武术服", "练功服", "柔道服", "摔角服", "格斗服", "拳击服",
    "赛车服", "战术紧身衣", "战术背心", "救援背心", "防暴服",
    "和服", "浴衣", "日式浴衣", "旗袍", "汉服", "肚兜", "古装肚兜",
    "薄纱汉服", "唐装", "中山装", "波西米亚", "洋装", "燕尾",
    "婚纱", "哥特婚纱", "晚礼服", "晚装", "礼服", "魔术礼服",
    "女王礼服", "公主礼服", "中世纪礼服", "机械礼服",
    "女仆装", "标准女仆装", "兔耳连体衣", "猫耳装", "魅魔装", "妖精装",
    "精灵装", "精灵服装", "天使装", "天使服装", "恶魔服装", "魅魔服装",
    "吸血鬼服装", "女巫袍", "魔法袍", "炼金袍", "战袍", "道袍",
    "斗篷", "吸血鬼斗篷", "披肩", "骑士服装", "女武神盔甲", "武士盔甲",
    "皮甲", "盔甲", "盔甲碎片", "甲胄碎片", "护具",
    "赛博装", "未来装", "未来服装", "未来感服装", "机械装", "机器人装",
    "太空装", "航天服", "宇航服", "飞行服", "飞行员制服", "飞船制服",
    "蒸汽朋克服", "水下服装",
    "角色扮演服", "角色服装", "角色扮演", "主人服装", "仆从服装",
    "SM服装", "不同人格服装", "精灵服装",
    "舞蹈内衣", "连体衣", "紧身衣", "紧身装", "吊带装", "吊带",
    "低胸装", "露背装", "露脐装", "透明装", "透明罩衫", "透明服装",
    "半透明", "薄纱", "撕裂服装", "暴露服装", "羞耻服装",
    "保守服装", "日常装", "日常服装", "休闲装", "休闲服", "便装",
    "正装", "商务装", "商务西装", "西装", "西装裙", "职业装",
    "OL通勤装", "OL套装", "OL装", "OL下班装", "下班装", "OL装",
    "高校风格", "学院风", "学生便装", "夜归便装", "旅行便装",
    "休闲旅行装", "旅行休闲装", "户外装",
    "浴袍", "酒店浴袍", "浴巾", "桑拿巾", "毛巾", "毛巾装", "睡袋",
    "睡袋服", "睡衣", "睡袍", "丝绸睡袍", "睡衣睡袍", "睡衣外套",
    "居家服", "家居服", "睡裙", "紧身包臀裙",
    "包臀裙", "百褶裙", "A字裙", "迷你裙", "短裙", "夜店短裙",
    "吊带裙", "丝裙", "长裙", "裙子",
    "连衣裙", "紧身T恤", "T恤", "polo衫", "背心", "吊带背心",
    "毛衣", "宽松毛衣", "紧身裤", "工装裤", "牛仔裤", "短裤",
    "运动短裤", "拳击短裤", "格斗短裤", "摔角短裤", "热裤", "沙滩短裤",
    "海滩短裤", "瑜伽短裤", "长裙",
    "围裙", "丝巾", "围巾", "腰带", "领带", "领结", "耳环", "耳坠",
    "耳饰", "手镯", "胸针", "腰链", "脚链", "珠宝", "珍珠项链",
    "项圈", "颈圈", "手铐", "镣铐", "脚铐", "乳贴", "乳环",
    "丝袜", "连裤袜", "连裤丝袜", "吊带袜", "网袜", "黑丝", "白色丝袜",
    "高跟鞋", "运动鞋", "皮鞋", "皮靴", "马靴", "工装靴", "高筒靴",
    "芭蕾舞鞋", "修女鞋", "木屐", "凉鞋", "鞋",
    "帽子", "礼帽", "棒球帽", "草帽", "飞行帽", "尖帽", "巫师帽",
    "头饰", "兔耳头饰", "兔耳", "兔耳朵", "猫耳", "狐耳", "头巾",
    "假发", "面具", "面罩", "口罩", "眼罩", "独眼罩", "潜水面罩",
    "潜水眼镜", "头盔", "飞行头盔", "头灯装", "耳塞", "耳机",
    "手套", "长手套", "摔角手套", "拳击手套", "格斗手套",
    "翅膀", "尾巴", "鹿角", "尖牙", "红鼻子", "血唇", "珍珠",
    "皇冠", "花环", "花瓣", "树叶", "海草", "羽毛",
    "绷带", "运动绷带", "绑带", "绑腿", "绳索", "绳缚", "链条", "锁链",
    "魔法杖", "魔术杖", "弯刀", "手里剑", "皮鞭", "马鞭", "念珠",
    "铃铛", "法槌", "补光灯", "电竞椅", "氧气瓶", "旗帜", "队旗",
    "举牌", "道具", "魔法道具", "玩具", "电动玩具",
    "眼罩", "独眼罩", "口塞", "肛塞穿戴", "跳蛋穿戴", "贞操带",
    "全裸", "全裸服从", "全裸身上有文字", "全裸戴项圈", "全裸戴乳夹",
    "全裸戴项圈口塞", "全裸戴项圈乳夹尾巴", "湿身", "温泉湿身",
    "脱去外衣", "部分脱去", "被脱去部分衣物", "只留项圈", "人体彩绘",
    "奶夹", "人偶服装", "绷带装",
)

# ═══════════════════════════════════════════════════════════════════════════
# 2) 状态类（身体状态，不是服装）
# ═══════════════════════════════════════════════════════════════════════════
STATE_COSTUMES: Set[str] = {
    "全裸", "全裸服从", "全裸身上有文字", "全裸戴项圈", "全裸戴乳夹",
    "全裸戴项圈口塞", "全裸戴项圈乳夹尾巴", "湿身", "温泉湿身",
    "脱去外衣", "部分脱去", "被脱去部分衣物", "只留项圈", "人体彩绘",
    "角色扮演", "奶夹", "口塞", "肛塞穿戴", "跳蛋穿戴", "贞操带",
}

# ═══════════════════════════════════════════════════════════════════════════
# 3) 道具类（场景物件，不穿在身上）
# ═══════════════════════════════════════════════════════════════════════════
PROP_COSTUMES: Set[str] = {
    "道具", "魔法道具", "玩具", "电动玩具", "旗帜", "队旗", "举牌",
    "补光灯", "电竞椅", "电竞椅装", "氧气瓶", "耳塞", "耳机", "法槌",
    "魔法杖", "魔术杖", "弯刀", "手里剑", "皮鞭", "马鞭", "念珠",
    "铃铛", "皇冠", "珍珠", "珍珠项链", "珠宝", "花环", "花瓣",
    "树叶", "海草", "羽毛", "鹿角", "尖牙", "红鼻子", "血唇",
    "假发", "面具", "眼罩", "独眼罩", "潜水面罩", "潜水眼镜",
    "盔甲碎片", "甲胄碎片", "链条", "锁链", "绳索", "绳缚", "绑带",
    "绑腿", "绷带", "运动绷带", "面具", "多面人",
}

# ═══════════════════════════════════════════════════════════════════════════
# 4) 显式规范表（语义明确、必须精确的服装）
#    source → (中文全称, 英文全称)
#    多件服装用「配」连接，anchors 会自动按名词拆分。
# ═══════════════════════════════════════════════════════════════════════════
EXPLICIT: Dict[str, Tuple[str, str]] = {
    # ── 职业制服 ──
    "护士制服": ("白色修身护士制服", "white fitted nurse uniform"),
    "护士服": ("白色修身护士服", "white fitted nurse uniform"),
    "护士装": ("白色修身护士装", "white fitted nurse uniform"),
    "护士长制服": ("白色修身护士长制服", "white fitted head nurse uniform"),
    "护士帽": ("白色护士帽", "white nurse cap"),
    "白大褂": ("白色白大褂", "white lab coat"),
    "医生白大褂": ("白色白大褂", "white lab coat"),
    "医疗制服": ("白色修身医疗制服", "white fitted medical uniform"),
    "医疗服": ("白色修身医疗服", "white fitted medical scrubs"),
    "医疗装": ("白色修身医疗装", "white fitted medical outfit"),
    "医疗紧身衣": ("白色紧身医疗紧身衣", "white tight medical bodysuit"),
    "实验服": ("白色实验服", "white lab coat"),
    "治疗服": ("浅蓝色宽松治疗服", "light blue loose therapy gown"),
    "治疗袍": ("浅蓝色宽松治疗袍", "light blue loose therapy robe"),
    "理疗服": ("浅蓝色宽松理疗服", "light blue loose physiotherapy gown"),
    "按摩师服装": ("黑色修身按摩师制服", "black fitted massage therapist uniform"),
    "按摩师制服": ("黑色修身按摩师制服", "black fitted massage therapist uniform"),
    "美容师制服": ("黑色修身美容师制服", "black fitted beautician uniform"),
    "牙医制服": ("浅蓝色修身牙医制服", "light blue fitted dentist scrubs"),
    "牙科制服": ("浅蓝色修身牙科制服", "light blue fitted dental scrubs"),
    "义工服": ("浅蓝色宽松义工服", "light blue loose volunteer vest"),
    "关怀服": ("浅蓝色宽松关怀服", "light blue loose care gown"),
    "探视服": ("浅蓝色宽松探视服", "light blue loose visitor gown"),
    "警察制服": ("深蓝色修身警察制服", "navy blue fitted police uniform"),
    "警帽": ("深蓝色警帽", "navy blue police cap"),
    "监狱制服": ("橙色条纹囚服", "orange striped prison uniform"),
    "囚服": ("橙色条纹囚服", "orange striped prison uniform"),
    "检察官制服": ("藏青色修身检察官制服", "navy blue fitted prosecutor suit"),
    "法官袍": ("黑色法官袍", "black judge's robe"),
    "律师袍": ("黑色律师袍", "black lawyer robe"),
    "乘务制服": ("深蓝色修身乘务制服", "navy blue fitted flight attendant uniform"),
    "空乘制服": ("深蓝色修身空乘制服", "navy blue fitted flight attendant uniform"),
    "空姐制服": ("深蓝色修身空姐制服", "navy blue fitted flight attendant uniform"),
    "机长制服": ("藏青色修身机长制服", "navy blue fitted captain uniform"),
    "船长制服": ("藏青色修身船长制服", "navy blue fitted captain uniform"),
    "船长服": ("藏青色修身船长服", "navy blue fitted captain uniform"),
    "海员服": ("藏蓝色修身海员服", "navy blue fitted sailor uniform"),
    "海军制服": ("藏蓝色水手领海军制服", "navy blue sailor-collar naval uniform"),
    "消防服": ("深红色消防服", "dark red firefighter turnout gear"),
    "消防员制服": ("深红色消防服", "dark red firefighter turnout gear"),
    "军装": ("墨绿色收紧身军装", "olive green fitted military uniform"),
    "军人制服": ("墨绿色收紧身军装", "olive green fitted military uniform"),
    "军帽": ("墨绿色军帽", "olive green military cap"),
    "教师套装": ("米色修身教师套装", "beige fitted teacher suit"),
    "学生制服": ("藏青色水手领学生制服", "navy blue sailor-collar school uniform"),
    "校服": ("藏青色水手领校服", "navy blue sailor-collar school uniform"),
    "校园制服": ("藏青色水手领校园制服", "navy blue sailor-collar school uniform"),
    "病号服": ("浅蓝色条纹病号服", "light blue striped hospital gown"),
    "侍者服": ("黑色修身侍者服", "black fitted waiter uniform"),
    "服务生制服": ("黑色修身服务生制服", "black fitted server uniform"),
    "乘务员": ("深蓝色修身乘务制服", "navy blue fitted flight attendant uniform"),
    "便利店制服": ("蓝白条纹便利店制服", "blue and white striped convenience store uniform"),
    "司机制服": ("黑色修身司机制服", "black fitted chauffeur uniform"),
    "品酒师制服": ("黑色修身的品酒师制服", "black fitted sommelier uniform"),
    "导游服": ("卡其色修身导游服", "khaki fitted tour guide uniform"),
    "球童服": ("红色修身球童服", "red fitted caddie uniform"),
    "厨师服": ("白色双排扣厨师服", "white double-breasted chef coat"),
    "厨师装": ("白色双排扣厨师服", "white double-breasted chef coat"),
    "园丁服": ("卡其色帆布园丁服", "khaki canvas gardener overalls"),
    "农夫装": ("卡其色帆布农夫装", "khaki canvas farmer clothes"),
    "渔夫装": ("藏青色防水渔夫装", "navy blue waterproof fisherman gear"),
    "骑装": ("深棕色皮质马术骑装", "dark brown leather riding outfit"),
    "骑手上衣": ("深棕色皮质骑手上衣", "dark brown leather riding jacket"),
    "马裤": ("深棕色皮质马裤", "dark brown leather riding breeches"),
    # ── 职场 / 日常 ──
    "OL通勤装": ("白色衬衫配黑色包臀裙", "white blouse with black pencil skirt"),
    "OL套装": ("白色衬衫配黑色包臀裙", "white blouse with black pencil skirt"),
    "OL装": ("白色衬衫配黑色包臀裙", "white blouse with black pencil skirt"),
    "OL下班装": ("浅灰色针织衫配黑色包臀裙", "light grey knit top with black pencil skirt"),
    "下班装": ("浅灰色针织衫配黑色包臀裙", "light grey knit top with black pencil skirt"),
    "职业套装": ("深灰色修身职业套装", "dark grey fitted professional suit"),
    "紧身职业套装": ("深灰色修身职业套装", "dark grey fitted professional suit"),
    "紧身职业装": ("深灰色修身职业套装", "dark grey fitted professional suit"),
    "职业套裙": ("深灰色修身职业套裙", "dark grey fitted professional skirt suit"),
    "职业装": ("深灰色修身职业套装", "dark grey fitted professional suit"),
    "正装": ("深灰色修身正装", "dark grey fitted formal suit"),
    "商务装": ("深灰色修身商务西装", "dark grey fitted business suit"),
    "商务西装": ("深灰色修身商务西装", "dark grey fitted business suit"),
    "西装": ("深灰色修身西装", "dark grey fitted suit jacket"),
    "西装裙": ("深灰色修身西装裙", "dark grey fitted suit skirt"),
    "西装校服": ("藏青色水手领校服", "navy blue sailor-collar school uniform"),
    "秘书装": ("深灰色修身秘书套装", "dark grey fitted secretary suit"),
    "私人助理装": ("深灰色修身私人助理套装", "dark grey fitted assistant suit"),
    "管家制服": ("黑色修身管家制服", "black fitted butler uniform"),
    "便装": ("米色针织衫配浅蓝色牛仔裤", "beige knit top with light blue jeans"),
    "休闲装": ("米色针织衫配浅蓝色牛仔裤", "beige knit top with light blue jeans"),
    "休闲服": ("米色针织衫配浅蓝色牛仔裤", "beige knit top with light blue jeans"),
    "日常装": ("米色针织衫配浅蓝色牛仔裤", "beige knit top with light blue jeans"),
    "日常服装": ("米色针织衫配浅蓝色牛仔裤", "beige knit top with light blue jeans"),
    "旅行便装": ("米色针织衫配浅蓝色牛仔裤", "beige knit top with light blue jeans"),
    "旅行休闲装": ("米色针织衫配浅蓝色牛仔裤", "beige knit top with light blue jeans"),
    "休闲旅行装": ("米色针织衫配浅蓝色牛仔裤", "beige knit top with light blue jeans"),
    "学生便装": ("藏青色水手领学生制服", "navy blue sailor-collar school uniform"),
    "夜归便装": ("米色针织衫配浅蓝色牛仔裤", "beige knit top with light blue jeans"),
    "高校风格": ("白色衬衫配藏青色百褶裙", "white blouse with navy pleated skirt"),
    "学院风": ("白色衬衫配藏青色百褶裙", "white blouse with navy pleated skirt"),
    "工作服": ("卡其色帆布工作服", "khaki canvas workwear"),
    "工作装": ("卡其色帆布工作服", "khaki canvas workwear"),
    "工作裤": ("卡其色帆布工作裤", "khaki canvas work trousers"),
    "工作短裤": ("卡其色帆布工作短裤", "khaki canvas work shorts"),
    "工装裤": ("卡其色帆布工装裤", "khaki canvas cargo pants"),
    "工坊服": ("深灰色帆布工坊围裙装", "dark grey canvas workshop apron outfit"),
    "秘书制服": ("深灰色修身秘书套装", "dark grey fitted secretary suit"),
    "主播装": ("黑色修身主播装", "black fitted streamer outfit"),
    "网红装": ("粉色修身网红装", "pink fitted influencer outfit"),
    "直播服装": ("黑色修身直播服装", "black fitted livestream outfit"),
    "设计师装": ("黑色宽松设计师装", "black loose designer outfit"),
    "摄影师装": ("黑色宽松摄影师装", "black loose photographer outfit"),
    "纹身师装": ("黑色修身纹身师装", "black fitted tattoo artist outfit"),
    "理发师装": ("黑色修身理发师装", "black fitted barber outfit"),
    "助手装": ("浅灰色修身助手装", "light grey fitted assistant outfit"),
    "私人助理": ("深灰色修身私人助理套装", "dark grey fitted assistant suit"),
    "策展装": ("黑色修身策展装", "black fitted curator outfit"),
    "策划师装": ("黑色修身策划师装", "black fitted planner outfit"),
    "裁缝装": ("深灰色帆布裁缝装", "dark grey canvas tailor outfit"),
    "调香师装": ("白色修身调香师装", "white fitted perfumer outfit"),
    "宠物装": ("粉色蕾丝宠物装", "pink lace pet outfit"),
    "吉祥物装": ("彩色毛绒吉祥物装", "colourful plush mascot costume"),
    # ── 内衣 / 睡衣 ──
    "情趣内衣": ("黑色蕾丝情趣内衣", "black lace sexy lingerie"),
    "蕾丝内衣": ("黑色蕾丝内衣", "black lace lingerie"),
    "棉质内衣": ("白色纯棉内衣", "white cotton underwear"),
    "丝绸内衣": ("香槟色丝质内衣", "champagne silk lingerie"),
    "简单内衣": ("黑色丝质内衣", "black silk lingerie"),
    "部分内衣": ("黑色蕾丝内衣", "black lace lingerie"),
    "保暖内衣": ("米色纯棉保暖内衣", "beige cotton thermal underwear"),
    "运动内衣": ("黑色运动内衣", "black sports bra"),
    "舞蹈内衣": ("黑色蕾丝舞蹈内衣", "black lace dance leotard"),
    "内衣": ("黑色蕾丝内衣", "black lace lingerie"),
    "文胸": ("黑色蕾丝文胸", "black lace bra"),
    "胸罩": ("黑色蕾丝文胸", "black lace bra"),
    "胸衣": ("黑色蕾丝文胸", "black lace bra"),
    "贝壳胸罩": ("白色贝壳胸罩", "white shell bikini top"),
    "皮革胸衣": ("黑色皮质胸衣", "black leather corset"),
    "紧身衣": ("黑色紧身连体衣", "black tight bodysuit"),
    "紧身连体衣": ("黑色紧身连体衣", "black tight bodysuit"),
    "乳胶连体衣": ("黑色乳胶连体衣", "black latex catsuit"),
    "乳胶紧身衣": ("黑色乳胶紧身衣", "black latex catsuit"),
    "乳胶全身服": ("黑色乳胶全身连体衣", "black full-body latex suit"),
    "连体衣": ("黑色紧身连体衣", "black tight bodysuit"),
    "紧身装": ("黑色紧身连体衣", "black tight bodysuit"),
    "紧身上衣": ("黑色紧身上衣", "black tight top"),
    "紧身上装": ("黑色紧身上衣", "black tight top"),
    "紧身吊带": ("黑色丝质紧身吊带", "black silk tight camisole"),
    "吊带": ("黑色丝质吊带", "black silk camisole"),
    "吊带装": ("黑色丝质吊带装", "black silk camisole outfit"),
    "吊带背心": ("白色罗纹吊带背心", "white ribbed tank top"),
    "低胸装": ("黑色丝质低胸装", "black silk low-cut top"),
    "露背装": ("黑色丝质露背装", "black silk backless top"),
    "透明装": ("半透明薄纱上衣", "sheer tulle top"),
    "透明罩衫": ("半透明薄纱罩衫", "sheer tulle cover-up"),
    "透明服装": ("半透明薄纱连衣裙", "sheer tulle dress"),
    "半透明": ("半透明薄纱连衣裙", "sheer tulle dress"),
    "薄纱": ("半透明黑色薄纱", "sheer black tulle"),
    "撕裂服装": ("撕裂的白色棉质T恤", "torn white cotton t-shirt"),
    "暴露服装": ("黑色深V领紧身连衣裙", "black deep-V tight dress"),
    "羞耻服装": ("黑色蕾丝女仆装", "black lace maid outfit"),
    "睡衣": ("白色丝质睡衣", "white silk pajamas"),
    "睡袍": ("白色丝质睡袍", "white silk robe"),
    "丝绸睡袍": ("香槟色丝质睡袍", "champagne silk robe"),
    "睡衣睡袍": ("白色丝质睡衣配睡袍", "white silk pajamas with robe"),
    "睡衣外套": ("白色丝质睡衣外套", "white silk pajama jacket"),
    "蕾丝睡衣": ("白色蕾丝睡衣", "white lace pajamas"),
    "睡裙": ("白色丝质睡裙", "white silk nightgown"),
    "蕾丝睡裙": ("白色蕾丝睡裙", "white lace nightgown"),
    "居家服": ("浅灰色宽松居家服", "light grey loose loungewear"),
    "家居服": ("浅灰色宽松居家服", "light grey loose loungewear"),
    "浴袍": ("白色宽松浴袍", "white loose bathrobe"),
    "酒店浴袍": ("白色宽松浴袍", "white loose bathrobe"),
    "浴巾": ("白色纯棉浴巾", "white cotton bath towel"),
    "桑拿巾": ("白色纯棉桑拿巾", "white cotton sauna towel"),
    "毛巾": ("白色纯棉毛巾", "white cotton towel"),
    "毛巾装": ("白色纯棉毛巾裹身", "white cotton towel wrap"),
    "裹身袋": ("米色亚麻裹身袋", "beige linen wrap"),
    "睡袋": ("军绿色棉质睡袋", "olive green cotton sleeping bag"),
    "睡袋服": ("军绿色棉质睡袋服", "olive green cotton sleeping bag suit"),
    "婚纱": ("白色丝质婚纱", "white silk wedding gown"),
    "哥特婚纱": ("黑色蕾丝哥特婚纱", "black lace gothic wedding gown"),
    "晚礼服": ("黑色丝质晚礼服", "black silk evening gown"),
    "晚装": ("黑色丝质晚礼服", "black silk evening gown"),
    "礼服": ("黑色丝质晚礼服", "black silk evening gown"),
    "魔术礼服": ("深紫色丝质魔术礼服", "deep purple silk magician gown"),
    "女王礼服": ("深红色丝质女王礼服", "deep red silk queen gown"),
    "公主礼服": ("浅粉色丝质公主礼服", "light pink silk princess gown"),
    "中世纪礼服": ("深紫色丝质中世纪礼服", "deep purple silk medieval gown"),
    "机械礼服": ("银色金属机械礼服", "silver metallic mechanical gown"),
    "燕尾": ("黑色丝质燕尾服", "black silk tailcoat"),
    # ── 裙装 / 裤装 ──
    "连衣裙": ("黑色丝质连衣裙", "black silk dress"),
    "紧身连衣裙": ("黑色丝质紧身连衣裙", "black silk tight dress"),
    "性感连衣裙": ("黑色丝质紧身连衣裙", "black silk tight dress"),
    "田园连衣裙": ("白色碎花连衣裙", "white floral dress"),
    "夜归连衣裙": ("黑色丝质连衣裙", "black silk dress"),
    "轻薄连衣裙": ("白色雪纺轻薄连衣裙", "white chiffon light dress"),
    "湿身连衣裙": ("白色湿身丝质连衣裙", "white wet silk dress"),
    "长裙": ("黑色丝质长裙", "black silk long dress"),
    "蕾丝长裙": ("黑色蕾丝长裙", "black lace long dress"),
    "丝绸长裙": ("香槟色丝质长裙", "champagne silk long dress"),
    "哥特长裙": ("黑色哥特蕾丝长裙", "black gothic lace long dress"),
    "丝裙": ("黑色丝质长裙", "black silk long dress"),
    "包臀裙": ("黑色修身包臀裙", "black fitted pencil skirt"),
    "紧身包臀裙": ("黑色修身包臀裙", "black fitted pencil skirt"),
    "被雨淋湿的紧身包臀裙": ("湿透的黑色修身包臀裙", "soaked black fitted pencil skirt"),
    "被酒浸湿的紧身包臀裙": ("沾酒的黑色修身包臀裙", "wine-soaked black fitted pencil skirt"),
    "百褶裙": ("黑色百褶裙", "black pleated skirt"),
    "A字裙": ("黑色A字短裙", "black A-line short skirt"),
    "迷你裙": ("黑色迷你裙", "black mini skirt"),
    "短裙": ("黑色短裙", "black short skirt"),
    "夜店短裙": ("黑色亮片短裙", "black sequin short skirt"),
    "吊带裙": ("黑色丝质吊带裙", "black silk slip dress"),
    "铅笔裙": ("深灰色修身铅笔裙", "dark grey fitted pencil skirt"),
    "碎花裙": ("白色碎花短裙", "white floral short skirt"),
    "红裙": ("红色丝质长裙", "red silk long dress"),
    "衬衫短裙": ("白色衬衫配黑色短裙", "white blouse with black short skirt"),
    "夜归连衣裙": ("黑色丝质连衣裙", "black silk dress"),
    "裙子": ("黑色丝质连衣裙", "black silk dress"),
    "牛仔裤": ("蓝色牛仔裤", "blue jeans"),
    "长袖牛仔裤": ("蓝色牛仔裤", "blue jeans"),
    "紧身裤": ("黑色紧身裤", "black leggings"),
    "瑜伽裤": ("黑色紧身瑜伽裤", "black tight yoga leggings"),
    "短裤": ("黑色棉质短裤", "black cotton shorts"),
    "运动短裤": ("黑色运动短裤", "black sports shorts"),
    "健身短裤": ("黑色健身短裤", "black gym shorts"),
    "瑜伽短裤": ("黑色瑜伽短裤", "black yoga shorts"),
    "拳击短裤": ("黑色拳击短裤", "black boxing trunks"),
    "格斗短裤": ("黑色格斗短裤", "black fight shorts"),
    "摔角短裤": ("黑色摔角短裤", "black wrestling trunks"),
    "沙滩短裤": ("米色亚麻沙滩短裤", "beige linen beach shorts"),
    "海滩短裤": ("米色亚麻沙滩短裤", "beige linen beach shorts"),
    "热裤": ("黑色丝质热裤", "black silk hot pants"),
    # ── 上衣 ──
    "衬衫": ("白色棉质衬衫", "white cotton shirt"),
    "白衬衫": ("白色棉质衬衫", "white cotton shirt"),
    "丝绸衬衫": ("香槟色丝质衬衫", "champagne silk shirt"),
    "商务衬衫": ("白色棉质衬衫", "white cotton shirt"),
    "湿身衬衫": ("湿透的白色棉质衬衫", "soaked white cotton shirt"),
    "湿透的衬衫": ("湿透的白色棉质衬衫", "soaked white cotton shirt"),
    "T恤": ("白色纯棉T恤", "white cotton t-shirt"),
    "紧身T恤": ("白色纯棉紧身T恤", "white tight cotton t-shirt"),
    "湿透的T恤": ("湿透的白色纯棉T恤", "soaked white cotton t-shirt"),
    "polo衫": ("白色棉质polo衫", "white cotton polo shirt"),
    "保龄球polo衫": ("白色棉质polo衫", "white cotton polo shirt"),
    "毛衣": ("米色宽松针织毛衣", "beige loose knit sweater"),
    "宽松毛衣": ("米色宽松针织毛衣", "beige loose knit sweater"),
    "背心": ("黑色针织背心", "black knit tank top"),
    "运动背心": ("黑色运动背心", "black sports tank top"),
    "闪亮上衣": ("金色亮片上衣", "gold sequin top"),
    "泳装": ("黑色连体泳装", "black one-piece swimsuit"),
    "泳衣": ("黑色连体泳装", "black one-piece swimsuit"),
    "一件式泳衣": ("黑色连体泳装", "black one-piece swimsuit"),
    "鳞片泳衣": ("银色鳞片连体泳衣", "silver scaled one-piece swimsuit"),
    "比基尼": ("黑色比基尼", "black bikini"),
    "比基尼泳衣": ("黑色比基尼", "black bikini"),
    "比基尼泳装": ("黑色比基尼", "black bikini"),
    "三点式": ("黑色比基尼", "black bikini"),
    # ── 运动 / 户外 ──
    "运动装": ("灰色运动套装", "grey tracksuit"),
    "运动服": ("灰色运动套装", "grey tracksuit"),
    "健身服": ("黑色紧身健身服", "black tight gym outfit"),
    "瑜伽服": ("黑色紧身瑜伽服", "black tight yoga outfit"),
    "舞蹈服": ("黑色紧身舞蹈服", "black tight dance outfit"),
    "钢管舞服": ("黑色高腰钢管舞服", "black high-waisted pole dance outfit"),
    "脱衣舞服": ("黑色高腰脱衣舞服", "black high-waisted stripper outfit"),
    "舞衣": ("黑色亮片舞衣", "black sequin dance dress"),
    "排练服": ("黑色紧身排练服", "black tight rehearsal outfit"),
    "演出服": ("黑色亮片演出服", "black sequin performance outfit"),
    "表演服": ("黑色亮片表演服", "black sequin performance outfit"),
    "舞台装": ("黑色亮片舞台装", "black sequin stage outfit"),
    "乐队服装": ("黑色皮质乐队服装", "black leather band outfit"),
    "啦啦队服": ("红白拼色啦啦队服", "red and white cheerleader uniform"),
    "球衣": ("白色球衣", "white sports jersey"),
    "球袜": ("白色球袜", "white sports socks"),
    "足球服": ("红色足球服", "red football jersey"),
    "橄榄球服": ("橄榄绿橄榄球服", "olive green football jersey"),
    "高尔夫装": ("浅绿色高尔夫球装", "light green golf outfit"),
    "高尔夫球装": ("浅绿色高尔夫球装", "light green golf outfit"),
    "电竞队服": ("黑红拼色电竞队服", "black and red esports team jersey"),
    "队服": ("黑红拼色电竞队服", "black and red esports team jersey"),
    "赛车连体服": ("红白拼色赛车连体服", "red and white racing suit"),
    "赛车宝贝装": ("白色比基尼配红色赛车服", "white bikini with red racing jacket"),
    "赛车宝贝背心": ("白色赛车背心", "white racing vest"),
    "赛车手套": ("黑色皮质赛车手套", "black leather racing gloves"),
    "赛车靴": ("黑色皮质赛车靴", "black leather racing boots"),
    "赛车头盔": ("白色赛车头盔", "white racing helmet"),
    "赛车头盔装": ("白色赛车头盔", "white racing helmet"),
    "骑装": ("深棕色皮质马术骑装", "dark brown leather riding outfit"),
    "登山服": ("橘红色防风登山服", "orange red windproof hiking jacket"),
    "攀岩服": ("红色紧身攀岩服", "red tight climbing outfit"),
    "滑雪服": ("红色滑雪服", "red ski jacket and pants"),
    "冲浪服": ("黑色紧身冲浪服", "black tight wetsuit"),
    "潜水服": ("黑色紧身潜水服", "black tight diving suit"),
    "水肺装": ("黑色紧身水肺潜水服", "black tight scuba diving suit"),
    "紧身潜入服": ("黑色紧身潜入服", "black tight stealth suit"),
    "探险服": ("卡其色防风探险服", "khaki windproof expedition jacket"),
    "探险装": ("卡其色防风探险装", "khaki windproof expedition outfit"),
    "科考服": ("卡其色防风科考服", "khaki windproof field research jacket"),
    "户外装": ("橘红色防风户外装", "orange red windproof outdoor jacket"),
    "户外服装": ("橘红色防风户外装", "orange red windproof outdoor jacket"),
    "户外运动装": ("橘红色防风户外装", "orange red windproof outdoor jacket"),
    "防寒服": ("军绿色棉质防寒服", "olive green padded winter jacket"),
    "防护服": ("白色连体防护服", "white full-body protective suit"),
    "防火衣": ("银色反光防火衣", "silver reflective flame-retardant coat"),
    "防水服": ("黄色防水服", "yellow waterproof jacket"),
    "防水外套": ("黄色防水外套", "yellow waterproof jacket"),
    "防晒衫": ("浅灰色轻薄防晒衫", "light grey thin sun-protection shirt"),
    "速干衣": ("深灰色速干T恤", "dark grey quick-dry t-shirt"),
    "蹦极服": ("黑色紧身蹦极服", "black tight bungee jumping suit"),
    "冥想服": ("米色宽松冥想服", "beige loose meditation wear"),
    "禅服": ("米色宽松禅服", "beige loose zen wear"),
    "道袍": ("灰色宽松道袍", "grey loose taoist robe"),
    "道服": ("灰色宽松道袍", "grey loose taoist robe"),
    "中医服": ("白色宽松中医服", "white loose traditional chinese medicine robe"),
    "武术服": ("红色宽松武术服", "red loose martial arts uniform"),
    "练功服": ("白色宽松练功服", "white loose kung fu uniform"),
    "柔道服": ("白色宽松柔道服", "white loose judogi"),
    "摔角服": ("红色紧身摔角服", "red tight wrestling singlet"),
    "格斗服": ("黑色紧身格斗服", "black tight fight shorts and top"),
    "拳击服": ("红色宽松拳击服", "red loose boxing kit"),
    "战术紧身衣": ("黑色紧身战术衣", "black tight tactical top"),
    "战术背心": ("黑色尼龙战术背心", "black nylon tactical vest"),
    "救援背心": ("橙色反光救援背心", "orange reflective rescue vest"),
    # ── 和风 / 古典 ──
    "和服": ("红色丝质和服", "red silk kimono"),
    "浴衣": ("白色棉质浴衣", "white cotton yukata"),
    "日式浴衣": ("白色棉质浴衣", "white cotton yukata"),
    "旗袍": ("红色丝质旗袍", "red silk qipao"),
    "汉服": ("红色丝质汉服", "red silk hanfu"),
    "肚兜": ("红色丝质肚兜", "red silk dudou"),
    "古装肚兜": ("红色丝质肚兜", "red silk dudou"),
    "薄纱汉服": ("红色丝质汉服", "red silk hanfu"),
    "唐装": ("红色丝质唐装", "red silk tang jacket"),
    "中山装": ("深灰色中山装", "dark grey zhongshan suit"),
    "波西米亚": ("彩色波西米亚长裙", "colourful bohemian maxi dress"),
    "洋装": ("浅粉色碎花洋装", "light pink floral dress"),
    # ── 幻想 / 魔幻 ──
    "女仆装": ("黑色荷叶边女仆装", "black ruffled french maid outfit"),
    "标准女仆装": ("黑色荷叶边女仆装", "black ruffled french maid outfit"),
    "兔耳连体衣": ("黑色乳胶兔耳连体衣", "black latex bunny bodysuit"),
    "兔耳": ("白色蕾丝兔耳", "white lace bunny ears"),
    "兔耳朵": ("白色蕾丝兔耳", "white lace bunny ears"),
    "兔耳头饰": ("白色蕾丝兔耳头饰", "white lace bunny ear headband"),
    "猫耳": ("黑色蕾丝猫耳", "black lace cat ears"),
    "猫耳装": ("黑色紧身猫耳装", "black tight cat-ear outfit"),
    "狐耳": ("红色绒面狐耳", "red velvet fox ears"),
    "魅魔装": ("黑色丝质魅魔装", "black silk succubus outfit"),
    "魅魔服装": ("黑色丝质魅魔装", "black silk succubus outfit"),
    "妖精装": ("浅绿色丝质妖精装", "light green silk fairy outfit"),
    "妖精": ("浅绿色丝质妖精装", "light green silk fairy outfit"),
    "精灵装": ("浅绿色丝质精灵装", "light green silk elf outfit"),
    "精灵服装": ("浅绿色丝质精灵装", "light green silk elf outfit"),
    "天使装": ("白色丝质天使装", "white silk angel outfit"),
    "天使服装": ("白色丝质天使装", "white silk angel outfit"),
    "恶魔服装": ("黑色丝质恶魔服装", "black silk devil outfit"),
    "吸血鬼服装": ("黑色丝质吸血鬼服装", "black silk vampire outfit"),
    "女巫袍": ("黑色丝质女巫袍", "black silk witch robe"),
    "魔法袍": ("深紫色丝质魔法袍", "deep purple silk mage robe"),
    "炼金袍": ("墨绿色丝质炼金袍", "olive green silk alchemy robe"),
    "战袍": ("深棕色皮质战袍", "dark brown leather battle robe"),
    "斗篷": ("深棕色皮质斗篷", "dark brown leather cloak"),
    "吸血鬼斗篷": ("黑色丝质吸血鬼斗篷", "black silk vampire cloak"),
    "披肩": ("米色针织披肩", "beige knitted shawl"),
    "骑士服装": ("银色金属骑士铠甲", "silver metal knight armour"),
    "女武神盔甲": ("银色金属女武神盔甲", "silver metal valkyrie armour"),
    "武士盔甲": ("黑色铁质武士盔甲", "black iron samurai armour"),
    "皮甲": ("棕色皮质皮甲", "brown leather armour"),
    "盔甲": ("银色金属盔甲", "silver metal armour"),
    "护具": ("黑色皮质护具", "black leather protective gear"),
    "赛博装": ("银灰色赛博紧身连体衣", "silver grey cyberpunk catsuit"),
    "未来装": ("银灰色未来紧身连体衣", "silver grey futuristic catsuit"),
    "未来服装": ("银灰色未来紧身连体衣", "silver grey futuristic catsuit"),
    "未来感服装": ("银灰色未来紧身连体衣", "silver grey futuristic catsuit"),
    "机械装": ("银灰色金属机械装甲", "silver grey metallic mech armour"),
    "机器人装": ("银灰色金属机械装甲", "silver grey metallic mech armour"),
    "太空装": ("白色加厚太空服", "white padded spacesuit"),
    "航天服": ("白色加厚太空服", "white padded spacesuit"),
    "宇航服": ("白色加厚太空服", "white padded spacesuit"),
    "飞行服": ("藏蓝色皮质飞行夹克", "navy blue leather flight jacket"),
    "飞行员制服": ("藏蓝色修身飞行员制服", "navy blue fitted pilot uniform"),
    "飞船制服": ("藏蓝色修身飞船制服", "navy blue fitted spaceship uniform"),
    "蒸汽朋克服": ("棕色皮质蒸汽朋克服", "brown leather steampunk outfit"),
    "骑装": ("深棕色皮质马术骑装", "dark brown leather riding outfit"),
    "水手服": ("藏蓝色水手领水手服", "navy blue sailor-collar sailor uniform"),
    "修女服": ("黑色修女袍配白色头巾", "black nun habit with white wimple"),
    "角色扮演服": ("黑色丝质角色扮演服", "black silk cosplay outfit"),
    "角色服装": ("黑色丝质角色扮演服", "black silk cosplay outfit"),
    "主人服装": ("黑色皮质主人服装", "black leather dominant outfit"),
    "仆从服装": ("黑色丝质仆从服装", "black silk servant outfit"),
    "SM服装": ("黑色皮革SM服装", "black leather BDSM outfit"),
    "不同人格服装": ("黑色丝质人格切换服装", "black silk personality-shift outfit"),
    "圣诞老人装": ("红色丝质圣诞老人装", "red silk santa claus outfit"),
    "圣诞袜": ("红色丝质圣诞袜", "red silk christmas stocking"),
    "欢愉服装": ("黑色蕾丝欢愉服装", "black lace pleasure outfit"),
    # ── 配饰 ──
    "围裙": ("白色纯棉围裙", "white cotton apron"),
    "丝巾": ("红色丝质丝巾", "red silk scarf"),
    "围巾": ("米色针织围巾", "beige knitted scarf"),
    "腰带": ("黑色皮质腰带", "black leather belt"),
    "领带": ("深红色丝质领带", "deep red silk necktie"),
    "领结": ("黑色丝质领结", "black silk bow tie"),
    "耳环": ("金色金属耳环", "gold metal earrings"),
    "耳坠": ("金色金属耳坠", "gold metal drop earrings"),
    "耳饰": ("金色金属耳饰", "gold metal ear accessories"),
    "手镯": ("银色金属手镯", "silver metal bracelet"),
    "胸针": ("银色金属胸针", "silver metal brooch"),
    "腰链": ("金色金属腰链", "gold metal waist chain"),
    "脚链": ("银色金属脚链", "silver metal ankle chain"),
    "珠宝": ("金色镶嵌珠宝", "gold gem-set jewellery"),
    "珍珠项链": ("白色珍珠项链", "white pearl necklace"),
    "项圈": ("黑色皮革项圈", "black leather choker"),
    "颈圈": ("黑色皮革颈圈", "black leather collar"),
    "手铐": ("银色金属手铐", "silver metal handcuffs"),
    "镣铐": ("银色金属镣铐", "silver metal shackles"),
    "脚铐": ("银色金属脚铐", "silver metal ankle shackles"),
    "乳贴": ("黑色圆形乳贴", "black round nipple covers"),
    "乳环": ("银色金属乳环", "silver metal nipple rings"),
    "丝袜": ("黑色丝质丝袜", "black silk stockings"),
    "白色丝袜": ("白色丝质丝袜", "white silk stockings"),
    "黑丝": ("黑色丝质丝袜", "black silk stockings"),
    "连裤袜": ("黑色丝质连裤袜", "black silk pantyhose"),
    "连裤丝袜": ("黑色丝质连裤袜", "black silk pantyhose"),
    "吊带袜": ("黑色丝质吊带袜", "black silk thigh-highs"),
    "网袜": ("黑色网纱吊带袜", "black mesh thigh-highs"),
    "高跟鞋": ("黑色漆皮高跟鞋", "black patent high heels"),
    "运动鞋": ("白色运动鞋", "white sneakers"),
    "皮鞋": ("黑色皮质皮鞋", "black leather shoes"),
    "皮靴": ("黑色皮质皮靴", "black leather boots"),
    "马靴": ("棕色皮质马靴", "brown leather riding boots"),
    "工装靴": ("棕色皮质工装靴", "brown leather work boots"),
    "高筒靴": ("黑色皮质高筒靴", "black leather knee-high boots"),
    "芭蕾舞鞋": ("粉色丝质芭蕾舞鞋", "pink silk ballet shoes"),
    "修女鞋": ("黑色皮质修女鞋", "black leather nun shoes"),
    "木屐": ("黑色漆木木屐", "black lacquered wooden geta"),
    "凉鞋": ("白色皮质凉鞋", "white leather sandals"),
    "礼帽": ("黑色宽檐礼帽", "black wide-brim fedora"),
    "棒球帽": ("白色棒球帽", "white baseball cap"),
    "草帽": ("米色草帽", "beige straw hat"),
    "飞行帽": ("棕色皮质飞行帽", "brown leather flight cap"),
    "尖帽": ("黑色尖顶巫师帽", "black pointed witch hat"),
    "巫师帽": ("黑色尖顶巫师帽", "black pointed witch hat"),
    "头饰": ("白色蕾丝头饰", "white lace headpiece"),
    "头巾": ("红色丝质头巾", "red silk headscarf"),
    "面罩": ("黑色半截面罩", "black half-face mask"),
    "潜水面罩": ("透明玻璃潜水面罩", "clear glass diving mask"),
    "潜水眼镜": ("透明玻璃潜水镜", "clear glass diving goggles"),
    "口罩": ("白色一次性口罩", "white disposable face mask"),
    "头盔": ("黑色战术头盔", "black tactical helmet"),
    "飞行头盔": ("黑色皮质飞行头盔", "black leather flight helmet"),
    "头灯装": ("黑色头灯装", "black headlamp outfit"),
    "耳机": ("黑色无线耳机", "black wireless headphones"),
    "手套": ("黑色长皮手套", "black long leather gloves"),
    "长手套": ("黑色长皮手套", "black long leather gloves"),
    "摔角手套": ("红色摔角手套", "red wrestling gloves"),
    "拳击手套": ("红色拳击手套", "red boxing gloves"),
    "格斗手套": ("黑色格斗手套", "black fight gloves"),
    "乳胶手套": ("黑色乳胶手套", "black latex gloves"),
    "翅膀": ("白色丝质翅膀", "white silk wings"),
    "尾巴": ("黑色毛绒尾巴", "black furry tail"),
    "绑带": ("黑色皮质绑带", "black leather straps"),
    "绑腿": ("黑色皮质绑腿", "black leather leg wraps"),
    "绷带": ("白色棉质绷带", "white cotton bandages"),
    "运动绷带": ("白色棉质运动绷带", "white cotton athletic tape"),
}

# ═══════════════════════════════════════════════════════════════════════════
# 5) 规则表：核心服装词 → (中文颜色, 中文款式, 英文颜色, 英文款式)
# ═══════════════════════════════════════════════════════════════════════════
CORE_RULES: Dict[str, Tuple[str, str, str, str]] = {
    "连衣裙": ("黑色", "丝质", "black", "silk"),
    "紧身连衣裙": ("黑色", "丝质紧身", "black", "silk tight"),
    "吊带裙": ("黑色", "丝质", "black", "silk"),
    "包臀裙": ("黑色", "修身", "black", "fitted"),
    "百褶裙": ("黑色", "百褶", "black", "pleated"),
    "迷你裙": ("黑色", "迷你", "black", "mini"),
    "短裙": ("黑色", "短款", "black", "short"),
    "长裙": ("黑色", "丝质长款", "black", "silk longline"),
    "裙子": ("黑色", "丝质", "black", "silk"),
    "裙装": ("黑色", "丝质", "black", "silk"),
    "包臀": ("黑色", "修身", "black", "fitted"),
    "内衣": ("黑色", "蕾丝", "black", "lace"),
    "文胸": ("黑色", "蕾丝", "black", "lace"),
    "胸罩": ("黑色", "蕾丝", "black", "lace"),
    "胸衣": ("黑色", "蕾丝", "black", "lace"),
    "内裤": ("黑色", "蕾丝", "black", "lace"),
    "丁字裤": ("黑色", "蕾丝", "black", "lace"),
    "紧身衣": ("黑色", "紧身", "black", "tight"),
    "连体衣": ("黑色", "紧身", "black", "tight"),
    "紧身装": ("黑色", "紧身", "black", "tight"),
    "紧身上衣": ("黑色", "紧身", "black", "tight"),
    "紧身上装": ("黑色", "紧身", "black", "tight"),
    "紧身包臀裙": ("黑色", "修身", "black", "fitted"),
    "紧身裙": ("黑色", "修身", "black", "fitted"),
    "紧身吊带": ("黑色", "丝质紧身", "black", "silk tight"),
    "紧身裤": ("黑色", "紧身", "black", "tight"),
    "紧身职业套装": ("深灰色", "修身", "dark grey", "fitted"),
    "紧身职业装": ("深灰色", "修身", "dark grey", "fitted"),
    "紧身职业套装": ("深灰色", "修身", "dark grey", "fitted"),
    "职业套装": ("深灰色", "修身", "dark grey", "fitted"),
    "职业套裙": ("深灰色", "修身", "dark grey", "fitted"),
    "职业装": ("深灰色", "修身", "dark grey", "fitted"),
    "衬衫": ("白色", "棉质", "white", "cotton"),
    "T恤": ("白色", "纯棉", "white", "cotton"),
    "polo衫": ("白色", "棉质", "white", "cotton"),
    "毛衣": ("米色", "宽松针织", "beige", "loose knit"),
    "背心": ("黑色", "针织", "black", "knit"),
    "吊带": ("黑色", "丝质", "black", "silk"),
    "西服": ("深灰色", "修身", "dark grey", "fitted"),
    "西装": ("深灰色", "修身", "dark grey", "fitted"),
    "西装裙": ("深灰色", "修身", "dark grey", "fitted"),
    "正装": ("深灰色", "修身", "dark grey", "fitted"),
    "休闲装": ("米色", "棉质", "beige", "cotton"),
    "便装": ("米色", "棉质", "beige", "cotton"),
    "睡衣": ("白色", "丝质", "white", "silk"),
    "睡裙": ("白色", "丝质", "white", "silk"),
    "睡袍": ("白色", "丝质", "white", "silk"),
    "居家服": ("浅灰色", "宽松", "light grey", "loose"),
    "家居服": ("浅灰色", "宽松", "light grey", "loose"),
    "浴袍": ("白色", "宽松", "white", "loose"),
    "浴衣": ("白色", "棉质", "white", "cotton"),
    "和服": ("红色", "丝质", "red", "silk"),
    "旗袍": ("红色", "丝质", "red", "silk"),
    "汉服": ("红色", "丝质", "red", "silk"),
    "制服": ("深蓝色", "修身", "navy blue", "fitted"),
    "护士服": ("白色", "修身", "white", "fitted"),
    "护士装": ("白色", "修身", "white", "fitted"),
    "护士制服": ("白色", "修身", "white", "fitted"),
    "警察制服": ("深蓝色", "修身", "navy blue", "fitted"),
    "空姐制服": ("深蓝色", "修身", "navy blue", "fitted"),
    "空乘制服": ("深蓝色", "修身", "navy blue", "fitted"),
    "乘务制服": ("深蓝色", "修身", "navy blue", "fitted"),
    "水手服": ("藏蓝色", "水手领", "navy blue", "sailor-collar"),
    "军装": ("墨绿色", "修身", "olive green", "fitted"),
    "迷彩服": ("墨绿色", "尼龙", "olive green", "nylon"),
    "工作服": ("卡其色", "帆布", "khaki", "canvas"),
    "工坊服": ("深灰色", "帆布", "dark grey", "canvas"),
    "实验服": ("白色", "棉质", "white", "cotton"),
    "白大褂": ("白色", "棉质", "white", "cotton"),
    "医生白大褂": ("白色", "棉质", "white", "cotton"),
    "医疗服": ("浅蓝色", "宽松", "light blue", "loose"),
    "治疗服": ("浅蓝色", "宽松", "light blue", "loose"),
    "病号服": ("浅蓝色", "条纹", "light blue", "striped"),
    "囚服": ("橙色", "条纹", "orange", "striped"),
    "囚": ("橙色", "条纹", "orange", "striped"),
    "修女服": ("黑色", "修女袍", "black", "nun habit"),
    "女仆装": ("黑色", "荷叶边", "black", "ruffled"),
    "礼帽": ("黑色", "宽檐", "black", "wide-brim"),
    "帽子": ("黑色", "宽檐", "black", "wide-brim"),
    "头饰": ("白色", "蕾丝", "white", "lace"),
    "丝巾": ("红色", "丝质", "red", "silk"),
    "围巾": ("米色", "针织", "beige", "knit"),
    "腰带": ("黑色", "皮质", "black", "leather"),
    "领带": ("深红色", "丝质", "deep red", "silk"),
    "领结": ("黑色", "丝质", "black", "silk"),
    "耳环": ("金色", "金属", "gold", "metal"),
    "耳坠": ("金色", "金属", "gold", "metal"),
    "耳饰": ("金色", "金属", "gold", "metal"),
    "手镯": ("银色", "金属", "silver", "metal"),
    "胸针": ("银色", "金属", "silver", "metal"),
    "腰链": ("金色", "金属", "gold", "metal"),
    "脚链": ("银色", "金属", "silver", "metal"),
    "珠宝": ("金色", "镶嵌", "gold", "gem-set"),
    "珍珠项链": ("白色", "珍珠", "white", "pearl"),
    "项圈": ("黑色", "皮革", "black", "leather"),
    "颈圈": ("黑色", "皮革", "black", "leather"),
    "手铐": ("银色", "金属", "silver", "metal"),
    "镣铐": ("银色", "金属", "silver", "metal"),
    "脚铐": ("银色", "金属", "silver", "metal"),
    "乳贴": ("黑色", "圆形", "black", "round"),
    "乳环": ("银色", "金属", "silver", "metal"),
    "丝袜": ("黑色", "丝质", "black", "silk"),
    "连裤袜": ("黑色", "丝质", "black", "silk"),
    "吊带袜": ("黑色", "丝质", "black", "silk"),
    "网袜": ("黑色", "网纱", "black", "mesh"),
    "高跟鞋": ("黑色", "漆皮", "black", "patent"),
    "运动鞋": ("白色", "运动", "white", "sporty"),
    "皮鞋": ("黑色", "皮质", "black", "leather"),
    "皮靴": ("黑色", "皮质", "black", "leather"),
    "马靴": ("棕色", "皮质", "brown", "leather"),
    "工装靴": ("棕色", "皮质", "brown", "leather"),
    "高筒靴": ("黑色", "皮质", "black", "leather"),
    "芭蕾舞鞋": ("粉色", "丝质", "pink", "silk"),
    "修女鞋": ("黑色", "皮质", "black", "leather"),
    "木屐": ("黑色", "漆木", "black", "lacquered wood"),
    "凉鞋": ("白色", "皮质", "white", "leather"),
    "丝袜高跟": ("黑色", "丝质", "black", "silk"),
    "运动装": ("灰色", "运动", "grey", "sporty"),
    "运动服": ("灰色", "运动", "grey", "sporty"),
    "健身服": ("黑色", "紧身", "black", "tight"),
    "瑜伽服": ("黑色", "紧身", "black", "tight"),
    "瑜伽裤": ("黑色", "紧身", "black", "tight"),
    "舞蹈服": ("黑色", "紧身", "black", "tight"),
    "舞衣": ("黑色", "亮片", "black", "sequin"),
    "钢管舞服": ("黑色", "高腰", "black", "high-waisted"),
    "脱衣舞服": ("黑色", "高腰", "black", "high-waisted"),
    "排练服": ("黑色", "紧身", "black", "tight"),
    "演出服": ("黑色", "亮片", "black", "sequin"),
    "表演服": ("黑色", "亮片", "black", "sequin"),
    "舞台装": ("黑色", "亮片", "black", "sequin"),
    "啦啦队服": ("红白拼色", "运动", "red and white", "sporty"),
    "球衣": ("白色", "运动", "white", "sporty"),
    "队服": ("黑红拼色", "运动", "black and red", "sporty"),
    "电竞队服": ("黑红拼色", "运动", "black and red", "sporty"),
    "围裙": ("白色", "纯棉", "white", "cotton"),
    "泳装": ("黑色", "连体", "black", "one-piece"),
    "泳衣": ("黑色", "连体", "black", "one-piece"),
    "比基尼": ("黑色", "三角", "black", "bikini"),
    "紧身T恤": ("白色", "纯棉紧身", "white", "tight cotton"),
    "皮衣": ("黑色", "皮质", "black", "leather"),
    "皮甲": ("棕色", "皮质", "brown", "leather"),
    "护具": ("黑色", "皮质", "black", "leather"),
    "翅膀": ("白色", "丝质", "white", "silk"),
    "尾巴": ("黑色", "毛绒", "black", "furry"),
    "猫耳": ("黑色", "蕾丝", "black", "lace"),
    "狐耳": ("红色", "绒面", "red", "velvet"),
    "面具": ("黑色", "半截面", "black", "half-face"),
    "面罩": ("黑色", "半截面", "black", "half-face"),
    "口罩": ("白色", "一次性", "white", "disposable"),
    "眼罩": ("黑色", "皮质", "black", "leather"),
    "独眼罩": ("黑色", "皮质", "black", "leather"),
    "头盔": ("黑色", "战术", "black", "tactical"),
    "手铐手套": ("黑色", "皮质", "black", "leather"),
    "手套": ("黑色", "皮质", "black", "leather"),
    "长手套": ("黑色", "皮质", "black", "leather"),
    "泳装配件": ("黑色", "丝质", "black", "silk"),
    "角色扮演服": ("黑色", "丝质", "black", "silk"),
    "角色服装": ("黑色", "丝质", "black", "silk"),
    "撕裂服装": ("撕裂的白色", "纯棉", "torn white", "cotton"),
    "暴露服装": ("黑色", "深V领紧身", "black", "deep-V tight"),
    "羞耻服装": ("黑色", "蕾丝", "black", "lace"),
    "透明服装": ("半透明", "薄纱", "sheer", "tulle"),
    "半透明": ("半透明", "薄纱", "sheer", "tulle"),
    "薄纱": ("半透明", "薄纱", "sheer", "tulle"),
    "紧身VR服": ("黑色", "紧身", "black", "tight"),
    "紧身潜入服": ("黑色", "紧身", "black", "tight"),
    "紧身法袍": ("深紫色", "丝质紧身", "deep purple", "silk tight"),
    "法袍": ("深紫色", "丝质", "deep purple", "silk"),
    "泳衣配件": ("黑色", "丝质", "black", "silk"),
    "机械装": ("银灰色", "金属", "silver grey", "metallic"),
    "机器人装": ("银灰色", "金属", "silver grey", "metallic"),
    "赛博装": ("银灰色", "金属", "silver grey", "metallic"),
    "未来装": ("银灰色", "金属", "silver grey", "metallic"),
    "未来服装": ("银灰色", "金属", "silver grey", "metallic"),
    "太空装": ("白色", "加厚", "white", "padded"),
    "航天服": ("白色", "加厚", "white", "padded"),
    "宇航服": ("白色", "加厚", "white", "padded"),
    "飞行服": ("藏蓝色", "皮质", "navy blue", "leather"),
    "飞行员制服": ("藏蓝色", "修身", "navy blue", "fitted"),
    "船长制服": ("藏蓝色", "修身", "navy blue", "fitted"),
    "海员服": ("藏蓝色", "修身", "navy blue", "fitted"),
    "海军制服": ("藏蓝色", "水手领", "navy blue", "sailor-collar"),
    "消防服": ("深红色", "防护", "dark red", "protective"),
    "军装": ("墨绿色", "修身", "olive green", "fitted"),
    "军帽": ("墨绿色", "棉质", "olive green", "cotton"),
    "警帽": ("深蓝色", "棉质", "navy blue", "cotton"),
    "护士帽": ("白色", "棉质", "white", "cotton"),
    "礼帽": ("黑色", "宽檐", "black", "wide-brim"),
    "棒球帽": ("白色", "运动", "white", "sporty"),
    "草帽": ("米色", "编织", "beige", "woven"),
    "巫师帽": ("黑色", "尖顶", "black", "pointed"),
    "尖帽": ("黑色", "尖顶", "black", "pointed"),
    "头巾": ("红色", "丝质", "red", "silk"),
    "发箍": ("黑色", "缎面", "black", "satin"),
    "发夹": ("银色", "金属", "silver", "metal"),
    "丝带": ("红色", "丝质", "red", "silk"),
    "胸衣": ("黑色", "蕾丝", "black", "lace"),
    "吊带袜": ("黑色", "丝质", "black", "silk"),
}

# 关键词 → (颜色, 款式) 兜底（当 costume 名里没有可识别的核心服装词时）
COLOR_KEYWORDS: Tuple[Tuple[str, str], ...] = (
    ("白", "白色"), ("黑", "黑色"), ("红", "红色"), ("蓝", "蓝色"),
    ("绿", "绿色"), ("黄", "黄色"), ("紫", "紫色"), ("粉", "粉色"),
    ("金", "金色"), ("银", "银色"), ("灰", "灰色"), ("棕", "棕色"),
    ("米", "米色"), ("裸", "裸色"), ("透明", "半透明"),
)

STYLE_KEYWORDS: Tuple[Tuple[str, str], ...] = (
    ("紧身", "紧身"), ("修身", "修身"), ("贴身", "贴身"), ("宽松", "宽松"),
    ("超短", "超短"), ("短", "短款"), ("长", "长款"), ("迷你", "迷你"),
    ("蕾丝", "蕾丝"), ("丝", "丝质"), ("绸", "丝质"), ("棉", "纯棉"),
    ("乳胶", "乳胶"), ("皮", "皮质"), ("皮革", "皮质"), ("网", "网纱"),
    ("丝绒", "丝绒"), ("毛绒", "毛绒"), ("毛", "毛绒"), ("纱", "薄纱"),
    ("透明", "半透明"), ("薄", "薄款"), ("厚", "厚实"), ("透视", "透视"),
    ("针织", "针织"), ("雪纺", "雪纺"), ("缎", "缎面"), ("牛仔", "牛仔"),
    ("水洗", "水洗"), ("高腰", "高腰"), ("低腰", "低腰"), ("露背", "露背"),
    ("无袖", "无袖"), ("深V", "深V领"), ("挂脖", "挂脖"), ("抹胸", "抹胸"),
    ("开叉", "开叉"), ("收腰", "收腰"), ("褶皱", "褶皱"), ("吊带", "吊带"),
    ("露肩", "露肩"), ("一字肩", "一字肩"), ("连体", "连体"), ("露脐", "露脐"),
)

# ═══════════════════════════════════════════════════════════════════════════
# 6) 英文服装名词表（用于生成 en 全称）
# ═══════════════════════════════════════════════════════════════════════════
EN_GARMENT: Dict[str, str] = {
    "连衣裙": "dress", "紧身连衣裙": "tight dress", "吊带裙": "slip dress",
    "包臀裙": "pencil skirt", "百褶裙": "pleated skirt", "迷你裙": "mini skirt",
    "短裙": "short skirt", "长裙": "long dress", "裙子": "dress", "裙装": "skirt",
    "包臀": "pencil skirt", "内衣": "lingerie", "文胸": "bra", "胸罩": "bra",
    "胸衣": "corset", "内裤": "panties", "丁字裤": "thong",
    "紧身衣": "tight bodysuit", "连体衣": "bodysuit", "紧身装": "tight bodysuit",
    "紧身上衣": "tight top", "紧身上装": "tight top", "紧身包臀裙": "tight pencil skirt",
    "紧身裙": "tight skirt", "紧身吊带": "tight camisole", "紧身裤": "leggings",
    "职业套装": "professional suit", "职业套裙": "skirt suit", "职业装": "professional suit",
    "衬衫": "shirt", "T恤": "t-shirt", "polo衫": "polo shirt", "毛衣": "sweater",
    "背心": "tank top", "吊带": "camisole", "西服": "suit", "西装": "suit jacket",
    "西装裙": "suit skirt", "正装": "formal suit", "休闲装": "casual outfit",
    "便装": "casual outfit", "睡衣": "pajamas", "睡裙": "nightgown", "睡袍": "robe",
    "居家服": "loungewear", "家居服": "loungewear", "浴袍": "bathrobe",
    "浴衣": "yukata", "和服": "kimono", "旗袍": "qipao", "汉服": "hanfu",
    "制服": "uniform", "护士服": "nurse uniform", "护士装": "nurse uniform",
    "护士制服": "nurse uniform", "警察制服": "police uniform",
    "空姐制服": "flight attendant uniform", "空乘制服": "flight attendant uniform",
    "乘务制服": "flight attendant uniform", "水手服": "sailor uniform",
    "军装": "military uniform", "迷彩服": "camouflage uniform", "工作服": "workwear",
    "工坊服": "workshop apron outfit", "实验服": "lab coat", "白大褂": "lab coat",
    "医生白大褂": "lab coat", "医疗服": "medical scrubs", "治疗服": "therapy gown",
    "病号服": "hospital gown", "囚服": "prison uniform", "囚": "prison uniform",
    "修女服": "nun habit", "女仆装": "maid outfit", "礼帽": "fedora",
    "帽子": "hat", "头饰": "headpiece", "丝巾": "silk scarf", "围巾": "scarf",
    "腰带": "belt", "领带": "necktie", "领结": "bow tie", "耳环": "earrings",
    "耳坠": "drop earrings", "耳饰": "ear accessories", "手镯": "bracelet",
    "胸针": "brooch", "腰链": "waist chain", "脚链": "anklet", "珠宝": "jewellery",
    "珍珠项链": "pearl necklace", "项圈": "choker", "颈圈": "collar",
    "手铐": "handcuffs", "镣铐": "shackles", "脚铐": "ankle shackles",
    "乳贴": "nipple covers", "乳环": "nipple rings", "丝袜": "stockings",
    "连裤袜": "pantyhose", "吊带袜": "thigh-highs", "网袜": "mesh thigh-highs",
    "高跟鞋": "high heels", "运动鞋": "sneakers", "皮鞋": "leather shoes",
    "皮靴": "leather boots", "马靴": "riding boots", "工装靴": "work boots",
    "高筒靴": "knee-high boots", "芭蕾舞鞋": "ballet shoes", "修女鞋": "nun shoes",
    "木屐": "wooden geta", "凉鞋": "sandals", "运动装": "tracksuit",
    "运动服": "tracksuit", "健身服": "gym outfit", "瑜伽服": "yoga outfit",
    "瑜伽裤": "yoga leggings", "舞蹈服": "dance outfit", "舞衣": "sequin dance dress",
    "钢管舞服": "pole dance outfit", "脱衣舞服": "stripper outfit",
    "排练服": "rehearsal outfit", "演出服": "performance outfit",
    "表演服": "performance outfit", "舞台装": "stage outfit",
    "啦啦队服": "cheerleader uniform", "球衣": "sports jersey", "队服": "team jersey",
    "电竞队服": "esports team jersey", "围裙": "apron", "泳装": "one-piece swimsuit",
    "泳衣": "one-piece swimsuit", "比基尼": "bikini", "紧身T恤": "tight t-shirt",
    "皮衣": "leather jacket", "皮甲": "leather armour", "护具": "protective gear",
    "翅膀": "wings", "尾巴": "tail", "猫耳": "cat ears", "狐耳": "fox ears",
    "面具": "half-face mask", "面罩": "face mask", "口罩": "face mask",
    "眼罩": "eye patch", "独眼罩": "eyepatch", "头盔": "tactical helmet",
    "手套": "gloves", "长手套": "long gloves", "泳装配件": "swimwear accessories",
    "角色扮演服": "cosplay outfit", "角色服装": "cosplay outfit",
    "撕裂服装": "torn t-shirt", "暴露服装": "deep-V tight dress",
    "羞耻服装": "lace maid outfit", "透明服装": "sheer tulle dress",
    "半透明": "sheer tulle", "薄纱": "sheer tulle", "紧身VR服": "tight VR suit",
    "紧身潜入服": "tight stealth suit", "紧身法袍": "tight silk mage robe",
    "法袍": "mage robe", "机械装": "mech armour", "机器人装": "mech armour",
    "赛博装": "cyberpunk catsuit", "未来装": "futuristic catsuit",
    "未来服装": "futuristic catsuit", "太空装": "spacesuit", "航天服": "spacesuit",
    "宇航服": "spacesuit", "飞行服": "flight jacket", "飞行员制服": "pilot uniform",
    "船长制服": "captain uniform", "海员服": "sailor uniform",
    "海军制服": "naval uniform", "消防服": "firefighter turnout gear",
    "军装": "military uniform", "军帽": "military cap", "警帽": "police cap",
    "护士帽": "nurse cap", "礼帽": "fedora", "棒球帽": "baseball cap",
    "草帽": "straw hat", "巫师帽": "pointed witch hat", "尖帽": "pointed witch hat",
    "头巾": "headscarf", "发箍": "headband", "发夹": "hair clip",
    "丝带": "ribbon", "发饰": "hair accessory", "内衣": "lingerie",
    "情趣内衣": "sexy lingerie", "连体泳衣": "one-piece swimsuit",
}

# ═══════════════════════════════════════════════════════════════════════════
# 7) 数据结构与解析
# ═══════════════════════════════════════════════════════════════════════════
@dataclass(frozen=True)
class CostumeSpec:
    """一条 costume 的规范化结果。"""

    source: str                    # 原始 costume 字符串
    zh: str                        # 规范中文全称（颜色 + 款式 + 服装名）
    en: str                        # 英文全称
    kind: str                      # 'garment' | 'state' | 'prop'
    nouns: Tuple[str, ...] = ()    # 服装名词（中文）
    anchors: Mapping[str, str] = field(default_factory=dict)  # 名词 → 规范全称

    @property
    def is_garment(self) -> bool:
        return self.kind == "garment"


# 把补充的服装名词注册进 outfit_consistency 的词表。
# 英文侧同步注册 EN_GARMENT 里的所有英文服装名，否则 image_prompt 里的
# "cheerleader uniform" / "pole dance outfit" 这些词锁不住。
register_garment_nouns(
    EXTRA_GARMENT_NOUNS,
    english=set(EN_GARMENT.values()),
)

# 词表与 outfit_consistency 完全同源 —— 这样「规范全称里的名词」和
# 「正文里被识别出的名词」永远是同一批字符串，anchors 才能对得上。
_ALL_NOUNS: Tuple[str, ...] = zh_garment_nouns()


def _noun_regex() -> re.Pattern:
    return re.compile(
        r"(?P<noun>" + "|".join(re.escape(n) for n in _ALL_NOUNS) + r")"
    )


_NOUN_RE = _noun_regex()


def _split_parts(zh: str) -> List[str]:
    """
    把「白色衬衫配黑色包臀裙」拆成 ['白色衬衫', '黑色包臀裙']。

    注意不能用「和」做分隔符 —— 「和服」会被切成「丝质」+「服」。
    多件服装在规范表里统一用「配」连接。
    """
    parts = [p for p in re.split(r"配|搭配|加上", zh) if p.strip()]
    return parts or [zh]


def _anchors_from_zh(zh: str) -> Dict[str, str]:
    """
    从规范全称里抽出「名词 → 该名词的完整修饰语」。

    「白色衬衫配黑色包臀裙」→ {"衬衫": "白色衬衫", "包臀裙": "黑色包臀裙"}
    「红白拼色啦啦队服」      → {"啦啦队服": "红白拼色啦啦队服"}

    每个片段按「名词出现位置」切分：名词之前的内容就是它的修饰语。
    这样「红白拼色」这种非标准颜色词也能被完整保留（靠颜色词表识别会丢掉它）。
    """
    anchors: Dict[str, str] = {}
    for part in _split_parts(zh):
        part = part.strip()
        if not part:
            continue
        matches = list(_NOUN_RE.finditer(part))
        if not matches:
            continue
        if len(matches) == 1:
            m = matches[0]
            noun = m.group("noun")
            phrase = part[: m.end()].strip()
            if phrase and noun not in anchors:
                anchors[noun] = phrase
            continue
        # 片段里有多个名词 → 按位置切片，每个名词拿它前面那一段修饰语
        prev_end = 0
        for m in matches:
            noun = m.group("noun")
            head = part[prev_end:m.start()].strip()
            phrase = (head + noun).strip()
            if phrase and noun not in anchors:
                anchors[noun] = phrase
            prev_end = m.end()
    return anchors


def _detect_style(text: str) -> str:
    for kw, style in STYLE_KEYWORDS:
        if kw in text:
            return style
    return ""


def _detect_color(text: str) -> str:
    for kw, color in COLOR_KEYWORDS:
        if kw in text:
            return color
    return ""


def _match_core(text: str) -> Optional[Tuple[str, Tuple[str, str, str, str]]]:
    """
    找出 costume 名里最长的、可在 CORE_RULES 命中的核心服装词。

    返回 (核心词, (zh色, zh款, en色, en款))。
    """
    best: Optional[Tuple[str, Tuple[str, str, str, str]]] = None
    for core in sorted(CORE_RULES, key=len, reverse=True):
        if core in text:
            rule = CORE_RULES[core]
            if best is None or len(core) > len(best[0]):
                best = (core, rule)
            # 长度相同则取先出现的位置更靠前者（排序已保证稳定）
            break
    return best


def _en_phrase(color: str, style: str, noun: str) -> str:
    en_noun = EN_GARMENT.get(noun, "")
    if not en_noun:
        return ""
    parts = []
    if color:
        parts.append(color)
    if style:
        parts.append(style)
    parts.append(en_noun)
    return " ".join(parts)


def _rule_zh_en(source: str) -> Tuple[str, str]:
    """
    规则兜底：给任意 costume 名生成一个「颜色 + 款式 + 原名」的全称。

    例：「舞蹈服」→ core 命中「舞蹈服」→ 黑色紧身舞蹈服。
        「异星服装」→ 无 core 命中 → 黑色紧身异星服装。
    """
    matched = _match_core(source)
    if matched:
        core, (zh_color, zh_style, en_color, en_style) = matched
        zh = f"{zh_color}{zh_style}{core}"
        en = _en_phrase(en_color, en_style, core)
        return zh, en

    # 无核心命中 → 用关键词推断颜色 / 款式，保留原名
    zh_color = _detect_color(source) or "黑色"
    zh_style = _detect_style(source) or "紧身"
    zh = f"{zh_color}{zh_style}{source}"
    en = ""
    return zh, en


def canonical_costume(source: str) -> CostumeSpec:
    """把一条 costume 解析成规范全称。"""
    raw = (source or "").strip()
    if not raw:
        return CostumeSpec(source=raw, zh="", en="", kind="prop")

    # ── 状态类 ──
    if raw in STATE_COSTUMES:
        return CostumeSpec(source=raw, zh=raw, en=_state_en(raw), kind="state")

    # ── 道具类 ──
    if raw in PROP_COSTUMES:
        return CostumeSpec(source=raw, zh=raw, en=raw, kind="prop")

    # ── 显式表 ──
    if raw in EXPLICIT:
        zh, en = EXPLICIT[raw]
        anchors = _anchors_from_zh(zh)
        nouns = tuple(sorted(anchors, key=len, reverse=True))
        return CostumeSpec(
            source=raw, zh=zh, en=en, kind="garment", nouns=nouns, anchors=anchors,
        )

    # ── 规则兜底 ──
    zh, en = _rule_zh_en(raw)
    anchors = _anchors_from_zh(zh)
    nouns = tuple(sorted(anchors, key=len, reverse=True))
    if not anchors:
        # 兜底再兜底：把原名本身当名词，锚成「颜色款式 + 原名」
        anchors = {raw: zh}
        nouns = (raw,)
    return CostumeSpec(
        source=raw, zh=zh, en=en, kind="garment", nouns=nouns, anchors=anchors,
    )


_STATE_EN: Dict[str, str] = {
    "全裸": "completely nude", "全裸服从": "completely nude, submissive",
    "全裸身上有文字": "completely nude with writing on the body",
    "全裸戴项圈": "completely nude wearing a collar",
    "全裸戴乳夹": "completely nude wearing nipple clamps",
    "全裸戴项圈口塞": "completely nude wearing a collar and gag",
    "全裸戴项圈乳夹尾巴": "completely nude wearing a collar, nipple clamps and a tail",
    "湿身": "wet skin, soaked clothing clinging to the body",
    "温泉湿身": "wet from a hot spring, soaked skin",
    "脱去外衣": "outer clothing removed", "部分脱去": "partially undressed",
    "被脱去部分衣物": "part of the clothing has been removed",
    "只留项圈": "wearing only a collar", "人体彩绘": "body painting",
    "角色扮演": "cosplay", "奶夹": "nipple clamps",
    "口塞": "gag", "肛塞穿戴": "wearing an anal plug",
    "跳蛋穿戴": "wearing a vibrating egg", "贞操带": "chastity belt",
}


def _state_en(raw: str) -> str:
    return _STATE_EN.get(raw, raw)


def theme_costume_specs(costumes: Sequence[str]) -> List[CostumeSpec]:
    """把一个主题的 costumes 列表解析成规范列表。"""
    out: List[CostumeSpec] = []
    for c in costumes or []:
        if not isinstance(c, str) or not c.strip():
            continue
        out.append(canonical_costume(c))
    return out


def theme_canonical_costume_names(costumes: Sequence[str]) -> List[str]:
    """主题 costumes 的规范中文全称列表（供 prompt 使用）。"""
    return [s.zh for s in theme_costume_specs(costumes) if s.zh]


def theme_canonical_costume_names_en(costumes: Sequence[str]) -> List[str]:
    """主题 costumes 的规范英文全称列表（供 image_prompt 使用）。"""
    return [s.en for s in theme_costume_specs(costumes) if s.en]


def theme_outfit_anchors(costumes: Sequence[str]) -> Dict[str, str]:
    """
    主题所有服装的「名词 → 规范全称」合并表。

    后处理层据此把每一镜里的「浴袍」补成「白色宽松浴袍」，
    把「黑色浴袍」拉回「白色宽松浴袍」—— 这就是「前后款式/颜色一致」的执行点。
    """
    anchors: Dict[str, str] = {}
    for spec in theme_costume_specs(costumes):
        if not spec.is_garment:
            continue
        for noun, phrase in spec.anchors.items():
            # 同一名词出现多次 → 取先出现（主题 costumes 顺序即优先级）。
            anchors.setdefault(noun, phrase)
    return anchors


def theme_allowed_garments(costumes: Sequence[str]) -> Set[str]:
    """
    主题允许出现的服装名词集合（供「跨主题串味」过滤使用）。

    注意：这里返回的是**名词**而不是 costume 字符串。之前的实现直接拿
    「OL通勤装」这种裸名词做白名单，导致过滤层把正文里合法的
    「白色衬衫」当成串味整句删掉 —— 现在白名单与词表同源，删除行为消失。
    """
    allowed: Set[str] = set()
    for spec in theme_costume_specs(costumes):
        if not spec.is_garment:
            continue
        allowed.update(spec.nouns)
    return allowed


def theme_primary_outfit(costumes: Sequence[str]) -> str:
    """主题的主服装全称（第一个真正的服装；没有则返回空）。"""
    for spec in theme_costume_specs(costumes):
        if spec.is_garment and spec.zh:
            return spec.zh
    return ""


def is_state_costume(source: str) -> bool:
    return (source or "").strip() in STATE_COSTUMES


def is_prop_costume(source: str) -> bool:
    return (source or "").strip() in PROP_COSTUMES
