"""FastAPI Application - 主入口"""

import os
import traceback
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.routes.prompt import router as prompt_router

app = FastAPI(
    title="NSFW Multimodal Prompt Engine",
    description="超能 NSFW 多模态提示词智能引擎 (Image/Video/Storyboard)",
    version="1.0.0",
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """捕获所有未处理的异常，避免 502 Bad Gateway"""
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": f"服务器内部错误: {type(exc).__name__}: {str(exc)}"},
    )

# CORS 配置
# 环境变量 ALLOWED_ORIGINS 逗号分隔，如: http://localhost:5173,https://yourdomain.com
# 本地开发和测试时使用通配符（无需 cookie/session 认证，Bearer token 在 header 中）
_allowed = os.environ.get("ALLOWED_ORIGINS", "").strip()
if _allowed:
    _origins = [o.strip() for o in _allowed.split(",") if o.strip()]
    _credentials = True
else:
    _origins = ["*"]
    _credentials = False

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(prompt_router)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/")
async def root():
    return {
        "name": "NSFW Multimodal Prompt Engine",
        "version": "1.0.0",
        "endpoints": {
            "expand": "POST /api/prompt/expand",
            "random": "POST /api/prompt/random",
            "storyboard": "POST /api/prompt/storyboard",
        },
    }
