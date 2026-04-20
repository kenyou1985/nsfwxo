"""Pydantic Request/Response Models"""

from pydantic import BaseModel, Field
from typing import Literal, Dict, List


# ─── Expand ───────────────────────────────────────────────────────────────────

class ExpandRequest(BaseModel):
    user_input: str = Field(..., min_length=1, max_length=2000, description="用户简短描述")
    type: Literal["image", "video"] = Field(..., description="生成类型: image 或 video")
    r18: bool = Field(default=False, description="是否启用 R18 模式")


class ExpandResponse(BaseModel):
    original: str
    type: str
    r18: bool
    prompt: str


# ─── Random ───────────────────────────────────────────────────────────────────

class RandomRequest(BaseModel):
    type: Literal["image", "video"] = Field(..., description="生成类型")
    r18: bool = Field(default=False, description="是否启用 R18 模式")


class RandomResponse(BaseModel):
    tags_used: Dict[str, List[str]]
    prompt: str


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
