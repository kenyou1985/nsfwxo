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


class ExpandResult(BaseModel):
    original: str
    type: str
    r18: bool
    prompt: str


class ExpandResponse(BaseModel):
    results: List[ExpandResult]


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


# ─── Storyboard Themes ───────────────────────────────────────────────────

class StoryboardThemesRequest(BaseModel):
    """Request to generate video theme options (step 1 of 2-step storyboard)"""
    r18: bool = Field(default=False, description="是否启用 R18 模式")
    count: int = Field(default=10, ge=5, le=20, description="生成主题数量 5-20，默认 10")
    custom_description: Optional[str] = Field(default=None, description="用户自定义描述，根据此描述生成主题，优先于随机生成")


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
    themes: List[StoryboardThemeOption]


# ─── Storyboard Outline ──────────────────────────────────────────────────

class StoryboardOutlineRequest(BaseModel):
    """Request to generate outline and panels after user selects a theme (step 2 of 2-step storyboard)"""
    theme_id: int = Field(..., description="Selected theme ID (1-5)")
    theme_title: str = Field(..., description="Selected theme title")
    panel_count: int = Field(default=5, ge=2, le=10, description="分镜数量 2-10")
    r18: bool = Field(default=False, description="是否启用 R18 模式")


class StoryboardOutline(BaseModel):
    """The narrative arc/outline of the short video"""
    arc: str = Field(..., description="Narrative arc description (e.g. '开场前戏 → 冲突 → 发展 → 高潮 → 结尾')")
    scenes: List[str] = Field(..., description="List of scene descriptions matching the arc stages")


class StoryboardOutlineResponse(BaseModel):
    """Response containing the narrative outline and storyboard panels"""
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
    theme_title: str
    script_title: str
    duration: str = Field(default="15-30秒")
    panels: List[VideoScriptPanel]
