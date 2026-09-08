"""Pydantic Request/Response Models"""

from pydantic import BaseModel, Field
from typing import Literal, Dict, List, Optional


# ─── Expand ───────────────────────────────────────────────────────────────────

class ExpandRequest(BaseModel):
    user_input: str = Field(..., min_length=1, max_length=2000, description="用户简短描述")
    type: Literal["image", "video"] = Field(..., description="生成类型: image 或 video")
    r18: bool = Field(default=False, description="是否启用 R18 模式")
    count: int = Field(default=5, ge=1, le=10, description="生成数量 1-10，默认 5")
    variant_index: int = Field(default=0, ge=0, description="Diversity variant index: 0=East Asian, 1=Western/European")
    reference_image_url: Optional[str] = Field(default=None, description="图生图参考图 URL，用于锚定参考图人物")
    img2img_mode: bool = Field(default=False, description="是否为图生图模式扩写")
    character_prompt: Optional[str] = Field(default=None, description="AI 数字人角色锚定提示词，启用数字人时传入")
    model_order: Optional[List[str]] = Field(default=None, description="模型顺序，优先用第一个，失败则尝试后续模型")


class ExpandResult(BaseModel):
    original: str
    type: str
    r18: bool
    prompt: str


class ExpandResponse(BaseModel):
    results: List[ExpandResult]


class ExpandVideoFromImageRequest(BaseModel):
    """Image-to-video (Wan2.2 i2v) prompt expansion.

    image_prompt is the LOCKED visual anchor (the static image) — the LLM
    must NOT re-describe it. scene_description is the variable to expand
    into motion / camera / expression in Wan2.2 i2v English format.
    """
    image_prompt: str = Field(..., min_length=1, max_length=4000, description="锚定的画面描述，模型不要在输出中复述")
    scene_description: Optional[str] = Field(default=None, max_length=1000, description="用户希望的视频动作/镜头/表情描述")
    r18: bool = Field(default=False, description="是否启用 R18 模式")
    count: int = Field(default=1, ge=1, le=5, description="生成候选数量 1-5，默认 1")
    model_order: Optional[List[str]] = Field(default=None, description="模型顺序，优先用第一个，失败则尝试后续模型")


# ─── Random ───────────────────────────────────────────────────────────────────

class PromptResult(BaseModel):
    theme_label: str = Field(default="", description="中文主题标签")
    theme: str = Field(default="", description="主题类型")
    tags_used: Dict[str, List[str]]
    prompt: str


class RandomRequest(BaseModel):
    type: Literal["image", "video"] = Field(..., description="生成类型")
    r18: bool = Field(default=False, description="是否启用 R18 模式")
    count: int = Field(default=5, ge=1, le=10, description="生成数量 1-10，默认 5")
    theme: str = Field(default="", description="主题类型: 完全随机/暗示优雅/亲密温馨/幻想cos/职场诱惑/热恋情侣/禁忌场景/性感睡衣/浴室氛围/写真艺术")
    img2img: bool = Field(default=False, description="是否为图生图模式，跳过外貌标签")
    reference_image_url: Optional[str] = Field(default=None, description="图生图参考图URL，用于锚定参考图人物")
    character_prompt: Optional[str] = Field(default=None, description="AI 数字人角色锚定提示词，启用数字人时传入")


class RandomResponse(BaseModel):
    results: List[PromptResult]


# ─── Storyboard ──────────────────────────────────────────────────────────────

class StoryboardRequest(BaseModel):
    plot: str = Field(..., min_length=1, max_length=3000, description="简短剧情描述")
    panel_count: int = Field(default=4, ge=2, le=8, description="分镜数量 2-8")
    r18: bool = Field(default=False, description="是否启用 R18 模式")


class StoryboardPanel(BaseModel):
    panel_number: int
    scene_description: str
    image_prompt: str


class StoryboardResponse(BaseModel):
    storyboard: List[StoryboardPanel]


class GridStoryboardRequest(BaseModel):
    """九宫格分镜生成（gpt-5.5）"""
    plot: str = Field(..., min_length=1, max_length=3000, description="提示词/场景描述")
    r18: bool = Field(default=False, description="是否启用 R18 模式")
    # 可选：数字人锚点参数——保持人物身份在所有 9 个分镜中一致
    reference_image_url: Optional[str] = Field(default=None, description="数字人参考图 URL（保持人物身份一致）")
    character_prompt: Optional[str] = Field(default=None, description="角色锚点提示词（如 '1girl, same face as image #1, ...'）")


class GridStoryboardResponse(BaseModel):
    grid: List[StoryboardPanel]


# ─── Storyboard Themes ───────────────────────────────────────────────────

class StoryboardThemesRequest(BaseModel):
    """Request to generate video theme options (step 1 of 2-step storyboard)"""
    r18: bool = Field(default=False, description="是否启用 R18 模式")
    count: int = Field(default=3, ge=1, le=20, description="生成主题数量 1-20，默认 3")
    custom_description: Optional[str] = Field(default=None, description="用户自定义描述，根据此描述生成主题，优先于随机生成")
    async_mode: bool = Field(default=False, description="设为 true 时立即返回 task_id，后台异步执行，前端轮询结果")


class StoryboardThemeOption(BaseModel):
    """A single video theme option"""
    id: int = Field(..., description="Theme option number")
    title: str = Field(..., description="Theme title in Chinese")
    description: str = Field(..., description="Brief description of the theme (1-2 sentences)")
    tags: List[str] = Field(..., description="List of theme keywords/tags")
    r18_level: str = Field(..., description="R18 level: 'soft' / 'medium' / 'hard'")
    category: str = Field(default="", description="Theme category: transport/outdoor/indoor/costume/sm/multi/oral/fluid/facial/anal/toys/work/fantasy/special")
    scenario_count: int = Field(default=0, description="Number of scenarios available for this theme")
    costume_count: int = Field(default=0, description="Number of costumes available for this theme")


class StoryboardThemesResponse(BaseModel):
    """Response containing theme options for user to select"""
    task_id: Optional[str] = Field(default=None, description="异步模式下的任务ID，前端轮询使用")
    themes: List[StoryboardThemeOption]


# ─── Storyboard Outline ──────────────────────────────────────────────────

class StoryboardOutlineRequest(BaseModel):
    """Request to generate outline and panels after user selects a theme (step 2 of 2-step storyboard)"""
    theme_id: int = Field(..., description="Selected theme ID (1-5)")
    theme_title: str = Field(..., description="Selected theme title")
    panel_count: int = Field(default=5, ge=2, le=10, description="分镜数量 2-10")
    r18: bool = Field(default=False, description="是否启用 R18 模式")
    model_order: Optional[List[str]] = Field(default=None, description="模型顺序，优先用第一个，失败则尝试后续模型")
    async_mode: bool = Field(default=False, description="设为 true 时立即返回 task_id，后台异步执行，前端轮询结果")


class StoryboardOutline(BaseModel):
    """The narrative arc/outline of the short video"""
    arc: str = Field(..., description="Narrative arc description (e.g. '开场前戏 → 冲突 → 发展 → 高潮 → 结尾')")
    scenes: List[str] = Field(..., description="List of scene descriptions matching the arc stages")


class StoryboardOutlineResponse(BaseModel):
    """Response containing the narrative outline and storyboard panels"""
    task_id: Optional[str] = Field(default=None, description="异步模式下的任务ID，前端轮询使用")
    theme_id: int
    theme_title: str
    outline: StoryboardOutline
    storyboard: List[StoryboardPanel]


# ─── Video Script ─────────────────────────────────────────────────────────

class StoryboardScriptRequest(BaseModel):
    """Request to generate video script from storyboard panels"""
    theme_title: str = Field(..., description="Selected theme title")
    r18: bool = Field(default=False, description="是否启用 R18 模式")
    panels: List[StoryboardPanel] = Field(..., description="已生成的分镜列表，用于生成视频脚本")
    async_mode: bool = Field(default=False, description="设为 true 时立即返回 task_id，后台异步执行，前端轮询结果")


class VideoScriptPanel(BaseModel):
    """A single panel/section in the video script"""
    panel: int = Field(..., description="分镜编号")
    heading: str = Field(..., description="场景标题 (e.g. INT. HOTEL ROOM - NIGHT)")
    action: str = Field(..., description="动作描述")
    dialogue: str = Field(default="", description="对白")
    sound_cue: str = Field(default="", description="声音提示 (e.g. [MUSIC], [MOANING])")
    camera: str = Field(default="", description="镜头方向 (e.g. POV, close-up, wide)")


class StoryboardScriptResponse(BaseModel):
    """Response containing the complete video script"""
    task_id: Optional[str] = Field(default=None, description="异步模式下的任务ID，前端轮询使用")
    theme_title: str
    script_title: str
    duration: str = Field(default="15-30秒")
    panels: List[VideoScriptPanel]


# ─── Extract Image DNA ────────────────────────────────────────────────────────

class ExtractImageDnaRequest(BaseModel):
    """从参考图提取"图片DNA"：人物类型、场景、服装信息

    由 Gemini-3.8-flash 完成视觉分析，不经过 Grok。
    提取结果供后续 Grok-4.6 生成 H3 提示词时作为锚点。
    """
    image_url: str = Field(..., min_length=1, max_length=4000, description="参考图 URL（支持 base64 data:image/... 或 http(s):// URL）")


class ClothingInfo(BaseModel):
    """单件服装信息"""
    name: str = Field(..., description="服装名称，如 '黑色蕾丝内衣'、'白色衬衫'")
    type: str = Field(..., description="服装类型: 上装/下装/连体/配饰/鞋子/袜子/其他")
    color: str = Field(default="", description="主色调")
    style: str = Field(default="", description="风格/特征，如 '蕾丝'、'透视'、'紧身'")
    image_url: Optional[str] = Field(default=None, description="扣图后的服装单独图片 URL（base64）")


class ExtractImageDnaResponse(BaseModel):
    """图片DNA提取结果"""
    character_type: str = Field(..., description="人物类型：萝莉(未满18禁止)/少女/御姐/熟女/少妇/OL/女仆/护士/教师/其他")
    character_description: str = Field(..., description="人物外貌描述（年龄段/发型/肤色/体型等）")
    character_age_hint: str = Field(..., description="年龄段提示：未成年/青年/中年（必须为成年）")
    scene_type: str = Field(..., description="场景类型：客厅/卧室/浴室/游泳池/办公室/教室/街头/海滩/餐厅/酒店/其他")
    scene_description: str = Field(..., description="场景详细描述（室内外/光线/道具等）")
    action_prediction: str = Field(..., description="人物动作和行为预判：基于图片推断人物接下来1-3秒最可能做的动作和正在发生的行为（中文，具体有想象力）")
    clothing_list: List[ClothingInfo] = Field(default_factory=list, description="服装列表（已扣图）")
    overall_style: str = Field(..., description="整体风格：浪漫唯美/亲密暧昧/激情热辣/戏剧化/SM风格")
    nsfw_level: str = Field(..., description="NSFW 程度：soft/normal/hard")


# ─── Extract Clothing Images ────────────────────────────────────────────────────

class ExtractClothingsRequest(BaseModel):
    """使用 Gemini-3.8-flash 从参考图中提取服装区域图片

    调用 AI 模型识别并裁剪出图片中人物所穿服装的独立区域图片。
    用于服装提取、下载、复制等场景。
    """
    image_url: str = Field(..., min_length=1, max_length=4000, description="参考图 URL（支持 base64 data:image/... 或 http(s):// URL）")
    additional_image_urls: Optional[List[str]] = Field(
        default=None,
        max_length=5,
        description="额外参考图 URL 列表（最多 5 张），与 image_url 一起作为多参考图参与服装识别与合成，重复或相似服装不会被合并",
    )
    clothing_hints: Optional[List[str]] = Field(default=None, description="可选的服装名称列表，用于辅助 AI 识别")
    model: Optional[str] = Field(
        default="gpt-image-2-c",
        description="服装抠图合成使用的图片模型: gpt-image-2-c | grok-imagine-image-2.0 | gemini-3.1-flash-image-preview",
    )
    custom_element_images: Optional[List[str]] = Field(
        default=None,
        max_length=3,
        description="用户上传的自定义服装元素图片（base64 data URL），最多3张，会在生成合成图时作为参考元素一并合成",
    )


class ExtractClothingsResponse(BaseModel):
    """服装提取结果"""
    clothings: List[ClothingInfo] = Field(default_factory=list, description="提取的服装列表，每件包含扣图后的 base64 图片 URL")


class GenerateH3DnaRequest(BaseModel):
    """基于 DNA 信息生成 MiniMax H3 格式提示词"""
    image_url: str = Field(..., description="参考图 URL（支持 base64 data:image/... 或 http(s):// URL）")
    dna: ExtractImageDnaResponse = Field(..., description="DNA 提取结果（包含人物/场景/服装/动作预判信息）")
    # erotic_level: soft=纯情色, normal=带性爱, sm=SM重口味
    erotic_level: Literal["soft", "normal", "sm"] = Field(default="normal", description="创作方向等级")
    # duration: 15/30/60 秒
    duration: Literal[15, 30, 60] = Field(default=15, description="视频时长（秒）")
    # 用户可选补充描述
    user_hint: Optional[str] = Field(default=None, description="用户补充的动作/镜头描述（可选）")
    # 批量生成条数（1/3/5/10/自定义），每条都是全新的不重复提示词
    count: int = Field(default=1, ge=1, le=20, description="生成条数（1-20 条），每条不重复")


class GenerateH3DnaResponse(BaseModel):
    """H3 提示词生成结果"""
    prompts: list[str] = Field(default_factory=list, description="生成的 H3 格式中文视频提示词列表（每条不重复）")
    erotic_level: str = Field(..., description="使用的创作方向")
    duration: int = Field(..., description="视频时长（秒）")
