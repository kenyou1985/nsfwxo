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
