#!/bin/bash
# nsfwxo 一键启动（macOS）
#
# 双击本文件即可启动全部服务并自动打开浏览器。
# 用法：
#   ./启动.command            启动（已在运行的端口自动复用）
#   ./启动.command --stop     停止本脚本启动的服务
#   ./启动.command --restart  先停后启
#
# 端口约定：后端 9000（Vite 的 /api 反代目标）、前端 5173

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT" || exit 1

BACKEND_PORT=9000
FRONTEND_PORT=5173
LOG_DIR="$ROOT/.runlogs"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
BACKEND_PID="$LOG_DIR/backend.pid"
FRONTEND_PID="$LOG_DIR/frontend.pid"
PY_BIN="$ROOT/backend/venv/bin/python"

mkdir -p "$LOG_DIR"
touch "$BACKEND_LOG" "$FRONTEND_LOG"

# ---------- 工具函数 ----------
port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

kill_pidfile() {
    local pf="$1" name="$2" pid
    [ -f "$pf" ] || return 0
    pid="$(cat "$pf" 2>/dev/null)"
    if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
        # 连同子进程一起收掉（npm run dev 会派生子进程）
        pkill -P "$pid" 2>/dev/null
        kill "$pid" 2>/dev/null
        echo "  已停止 $name (pid $pid)"
    fi
    rm -f "$pf"
}

stop_all() {
    echo "🛑 停止服务..."
    kill_pidfile "$FRONTEND_PID" "前端 5173"
    kill_pidfile "$BACKEND_PID" "后端 $BACKEND_PORT"
    # 兜底：按端口回收仍占用本项目端口的残留进程（如手动起的 uvicorn / vite）
    for p in "$FRONTEND_PORT" "$BACKEND_PORT"; do
        for pid in $(lsof -tiTCP:"$p" -sTCP:LISTEN 2>/dev/null); do
            if kill "$pid" 2>/dev/null; then
                echo "  已回收端口 $p 上的残留进程 (pid $pid)"
            fi
        done
    done
    sleep 0.5
    echo "  完成。"
}

# ---------- 后端 ----------
start_backend() {
    if port_busy "$BACKEND_PORT"; then
        echo "✅ 后端 $BACKEND_PORT 已在运行 → 复用"
        return 0
    fi
    if [ ! -x "$PY_BIN" ]; then
        if command -v python3 >/dev/null 2>&1; then
            PY_BIN="$(command -v python3)"
            echo "⚠️  未找到 backend/venv，改用系统 python3"
        else
            echo "❌ 找不到 python3，无法启动后端"
            return 1
        fi
    fi
    echo "🔧 启动后端 ($BACKEND_PORT)..."
    ( cd "$ROOT/backend" && PORT=$BACKEND_PORT exec "$PY_BIN" run.py ) >>"$BACKEND_LOG" 2>&1 &
    echo $! > "$BACKEND_PID"
    for _ in $(seq 1 40); do
        if curl -s -m 2 -o /dev/null "http://127.0.0.1:$BACKEND_PORT/health"; then
            echo "   后端就绪 http://127.0.0.1:$BACKEND_PORT"
            return 0
        fi
        sleep 0.5
    done
    echo "   ⚠️  后端 20 秒内未就绪，详见 $BACKEND_LOG"
    return 1
}

# ---------- 前端 ----------
start_frontend() {
    if port_busy "$FRONTEND_PORT"; then
        echo "✅ 前端 $FRONTEND_PORT 已在运行 → 复用"
        return 0
    fi
    if [ ! -d "$ROOT/node_modules" ]; then
        echo "📦 未检测到 node_modules，先安装依赖..."
        ( cd "$ROOT" && npm install ) >>"$FRONTEND_LOG" 2>&1 || {
            echo "❌ npm install 失败，详见 $FRONTEND_LOG"; return 1; }
    fi
    echo "⚡ 启动前端 ($FRONTEND_PORT)..."
    ( cd "$ROOT" && exec npm run dev ) >>"$FRONTEND_LOG" 2>&1 &
    echo $! > "$FRONTEND_PID"
    for _ in $(seq 1 60); do
        if curl -s -m 2 -o /dev/null "http://127.0.0.1:$FRONTEND_PORT/"; then
            echo "   前端就绪 http://127.0.0.1:$FRONTEND_PORT"
            return 0
        fi
        sleep 0.5
    done
    echo "   ⚠️  前端 30 秒内未就绪，详见 $FRONTEND_LOG"
    return 1
}

# ---------- 入口 ----------
case "${1:-}" in
    --stop)
        stop_all
        exit 0
        ;;
    --restart)
        stop_all
        sleep 1
        ;;
esac

echo "══════════════════════════════════════"
echo "  nsfwxo 一键启动"
echo "  项目目录: $ROOT"
echo "══════════════════════════════════════"
echo ""

start_backend
start_frontend

echo ""
echo "──────────────────────────────────────"
echo "  前端页面 : http://localhost:$FRONTEND_PORT"
echo "  后端接口 : http://127.0.0.1:$BACKEND_PORT"
echo "  日志     : $LOG_DIR"
echo "──────────────────────────────────────"
echo ""

sleep 1
open "http://localhost:$FRONTEND_PORT"

cleanup() {
    echo ""
    echo "🛑 收到退出信号，停止全部服务..."
    stop_all
    exit 0
}
trap cleanup INT TERM

echo "按 Ctrl+C 停止全部服务并退出。"
echo ""
tail -n 20 -f "$BACKEND_LOG" "$FRONTEND_LOG"
