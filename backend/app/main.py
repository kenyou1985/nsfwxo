"""FastAPI Application - 主入口"""

import os
import traceback
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.routes.prompt import router as prompt_router

# rh_h3_web 依赖本机 Mac 路径 /Users/kenyou/Doubao/...，容器里不存在。
# 尝试导入，失败则跳过 daotai router（/api/daotai/* 不可用，但主服务正常）。
try:
    from app.routes.daotai import router as daotai_router
    _daotai_available = True
except ImportError as e:
    import logging
    logging.warning(
        "[main] daotai router 导入失败（RH_H3_DIR 未配置或路径不存在）: %s。"
        "如需导演台功能，请确保 RH_H3_DIR 环境变量指向 rh_h3_web 目录。", e
    )
    daotai_router = None
    _daotai_available = False

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
if daotai_router is not None:
    app.include_router(daotai_router)


@app.get("/health")
async def health():
    return {"status": "ok", "daotai": _daotai_available}


@app.get("/")
async def root():
    endpoints = {
        "expand": "POST /api/prompt/expand",
        "random": "POST /api/prompt/random",
        "storyboard": "POST /api/prompt/storyboard",
    }
    if _daotai_available:
        endpoints["daotai_video"] = "POST /api/daotai/video"
        endpoints["daotai_image"] = "POST /api/daotai/image"
    return {
        "name": "NSFW Multimodal Prompt Engine",
        "version": "1.0.0",
        "endpoints": endpoints,
    }


@app.on_event("startup")
async def _startup_log():
    """应用就绪日志：方便 Railway 部署日志确认启动成功。"""
    import logging
    logging.getLogger("uvicorn").info(
        "[startup] app ready — prompt=ok, daotai=%s", _daotai_available
    )
