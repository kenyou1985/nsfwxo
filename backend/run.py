#!/usr/bin/env python3
"""Production/Development server entry point — Railway compatible.

关键修复（2026-10-19 Railway 部署健康检查 503）：
- **禁用 reload=True**：uvicorn[standard] 会拉入 watchgod，reload 启动需要 fork
  子进程 + 重新 import 整个 app。容器里 watchgod 在加载大常量文件（prompt.py
  693KB）时容易 hang，导致主进程永远不 bind 端口 → /health 一直 503。
  生产环境必须 reload=False；本地开发可用 RELOAD=1 显式开启。
- **绑定失败快速失败**：`log_level="info"` 避免默认 warning 把启动错误吞掉。
- **保留 PORT 环境变量**：Railway 自动注入，兜底 9000 本地。
"""

import os

import uvicorn

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "9000"))
    # 仅当环境变量 RELOAD=1 显式开启 reload（本地开发用）
    reload_enabled = os.environ.get("RELOAD", "").lower() in ("1", "true", "yes")
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=reload_enabled,
        log_level=os.environ.get("LOG_LEVEL", "info"),
        # 生产环境超时保护：避免健康检查在启动慢时无限期等待
        timeout_keep_alive=65,
    )
