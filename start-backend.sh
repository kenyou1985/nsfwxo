#!/bin/bash

# 一键启动后端服务脚本
# 使用方法: ./start-backend.sh

cd "$(dirname "$0")/backend"

echo "🚀 启动后端服务..."
echo "📍 工作目录: $(pwd)"
echo "🔧 端口: 8000"
echo ""

# 检查是否已有服务运行
if lsof -i :8000 >/dev/null 2>&1; then
    echo "⚠️  端口 8000 已被占用，正在停止旧服务..."
    pkill -f "uvicorn app.main" 2>/dev/null
    sleep 2
fi

# 清理 Python 缓存
echo "🧹 清理 Python 缓存..."
find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null
find . -name "*.pyc" -delete 2>/dev/null

# 启动服务
echo "✅ 启动 uvicorn 服务..."
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 如果脚本被 Ctrl+C 中断，清理进程
trap "echo ''; echo '🛑 停止服务...'; pkill -f 'uvicorn app.main'; exit 0" INT TERM
