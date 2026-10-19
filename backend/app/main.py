"""FastAPI Application - 主入口"""

import os
import re
import traceback
import logging
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
# 优先级（从宽松到严格）：
#   1. 未设 ALLOWED_ORIGINS → 通配符 *（最宽松，Bearer token 走 header 不需要 credentials）
#   2. 设了 ALLOWED_ORIGINS → 放行该列表 + 永远附加常用开发/预览源
#      （localhost / 127.0.0.1 / vercel/netlify/railway 任意子域）
# 这样设了生产白名单也不会卡住本地调试或 Vercel 预览部署。Railway
# dashboard 里把 ALLOWED_ORIGINS 留空即可全开放。
#
# 通配符子域用 allow_origin_regex 实现，FastAPI 的 allow_origins
# 只支持精确匹配和「*」，不支持 https://*.vercel.app 这种 glob。
_DEV_EXACT_ORIGINS = [
    'http://localhost',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8080',
    'http://127.0.0.1',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:8080',
]
# 覆盖 Vercel 预览/生产、Netlify、Railway 自定义域、任意 https 子域开发预览
_DEV_ORIGIN_REGEX = re.compile(
    r'^https://([a-z0-9-]+\.)?(vercel\.app|netlify\.app|netlify\.com|'
    r'railway\.app|up\.railway\.app|render\.com|fly\.dev|herokuapp\.com)$',
    re.IGNORECASE,
)
_allowed = os.environ.get('ALLOWED_ORIGINS', '').strip()
if _allowed:
    _origins = [o.strip() for o in _allowed.split(',') if o.strip()]
    for _d in _DEV_EXACT_ORIGINS:
        if _d not in _origins:
            _origins.append(_d)
    _credentials = True
    _origin_regex = _DEV_ORIGIN_REGEX.pattern
else:
    _origins = ['*']
    _credentials = False
    _origin_regex = None  # 走 * 通配符，不需要 regex

logging.getLogger('uvicorn').info(
    '[cors] ALLOWED_ORIGINS env=%r, effective origins=%d, regex=%s',
    _allowed or None, len(_origins), _origin_regex or '(wildcard *)',
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_origin_regex=_origin_regex,
    allow_credentials=_credentials,
    allow_methods=['*'],
    allow_headers=['*'],
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
    logging.getLogger("uvicorn").info(
        "[startup] app ready — prompt=ok, daotai=%s", _daotai_available
    )
