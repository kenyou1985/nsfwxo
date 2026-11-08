#!/bin/bash
# NSFWXO 一键启动：后端 9000 + 前端 5173
# 用法：
#   ./start-all.sh          启动（已有进程会先停掉）
#   ./start-all.sh stop     停止
#   ./start-all.sh status   查看状态

set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT/backend"
LOG_DIR="$ROOT/.runlogs"
FRONTEND_PID="$LOG_DIR/frontend.pid"
BACKEND_PID="$LOG_DIR/backend.pid"
FRONTEND_PORT=5173
BACKEND_PORT=9000
PYTHON="$BACKEND_DIR/venv/bin/python"

mkdir -p "$LOG_DIR"

stop_port() {
  local port="$1"
  local pids
  pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "🛑 停止端口 $port: $pids"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
}

stop_all() {
  if [ -f "$FRONTEND_PID" ]; then
    kill -9 "$(cat "$FRONTEND_PID")" 2>/dev/null || true
    rm -f "$FRONTEND_PID"
  fi
  if [ -f "$BACKEND_PID" ]; then
    kill -9 "$(cat "$BACKEND_PID")" 2>/dev/null || true
    rm -f "$BACKEND_PID"
  fi
  stop_port "$FRONTEND_PORT"
  stop_port "$BACKEND_PORT"
  pkill -f "uvicorn app.main:app" 2>/dev/null || true
  echo "✅ 已停止 NSFWXO 服务"
}

status_all() {
  local b f
  b="$(lsof -nP -tiTCP:$BACKEND_PORT -sTCP:LISTEN 2>/dev/null | tr '\n' ' ')"
  f="$(lsof -nP -tiTCP:$FRONTEND_PORT -sTCP:LISTEN 2>/dev/null | tr '\n' ' ')"
  echo "后端 9000: ${b:-未运行}"
  echo "前端 5173: ${f:-未运行}"
  curl -s -m 2 -o /dev/null -w "后端健康: HTTP %{http_code}\n" "http://127.0.0.1:$BACKEND_PORT/docs" || true
  curl -s -m 2 -o /dev/null -w "前端访问: HTTP %{http_code}\n" "http://127.0.0.1:$FRONTEND_PORT/" || true
}

start_all() {
  echo "🚀 NSFWXO 一键启动"
  echo "📁 项目目录: $ROOT"
  echo ""

  stop_all

  # 清理 Python 缓存
  find "$BACKEND_DIR" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
  find "$BACKEND_DIR" -name "*.pyc" -delete 2>/dev/null || true

  echo "🧠 启动后端 9000..."
  (
    cd "$BACKEND_DIR" || exit 1
    nohup "$PYTHON" -m uvicorn app.main:app --host 0.0.0.0 --port "$BACKEND_PORT" \
      > "$LOG_DIR/backend.log" 2>&1 &
    echo $! > "$BACKEND_PID"
  )

  echo "🎨 启动前端 5173..."
  (
    cd "$ROOT" || exit 1
    nohup ./node_modules/.bin/vite --host 0.0.0.0 --port "$FRONTEND_PORT" \
      > "$LOG_DIR/frontend.log" 2>&1 &
    echo $! > "$FRONTEND_PID"
  )

  # 等待后端健康
  echo "⏳ 等待服务就绪..."
  for _ in $(seq 1 40); do
    if curl -s -m 1 -o /dev/null "http://127.0.0.1:$BACKEND_PORT/docs"; then
      break
    fi
    sleep 1
  done

  echo ""
  echo "✅ 启动完成"
  echo "   前端: http://127.0.0.1:$FRONTEND_PORT/"
  echo "   后端: http://127.0.0.1:$BACKEND_PORT/docs"
  echo "   日志: $LOG_DIR/frontend.log / $LOG_DIR/backend.log"
  echo ""
  status_all
}

case "${1:-start}" in
  start)  start_all ;;
  stop)   stop_all ;;
  restart) start_all ;;
  status) status_all ;;
  *)
    echo "用法: $0 {start|stop|restart|status}"
    exit 1
    ;;
esac
