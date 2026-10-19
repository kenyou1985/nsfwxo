FROM python:3.11-slim

# 强制 stdout/stderr 无缓冲，Railway 部署日志能即时看到 uvicorn/print 输出
# （否则 Python 默认块缓冲，崩溃/启动信息会被吞掉，看起来像"沉默失败"）
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # 导演台 (daotai) 核心模块路径：容器内默认指向内置副本
    RH_H3_DIR=/app/rh_h3_web

WORKDIR /app

# 安装 ffmpeg（多段视频合成 / 参考图裁头检测 / 缩略图抽取）
# - python:3.11-slim (Debian bookworm) 仓库自带 ffmpeg，无需额外源
# - 多段视频合成（_concat_videos）需要它，否则只能走"单段快速通道"兜底
# - 安装包增量约 ~25MB（压缩层），可接受
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && ffmpeg -version | head -1

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app code
COPY app/ ./app/
COPY data/ ./data/
COPY run.py .

# Copy 内置导演台模块（rh_h3_web.py + 初始状态文件）
# - 体积：~262KB（4443 行纯 Python，仅用标准库）
# - 容器启动后会自动读写同目录下的 rh_state.json
COPY rh_h3_web/ ./rh_h3_web/

# Expose port
EXPOSE 9000

# Run (python -u 冗余但更明确，避免某些 base image 不读 ENV)
CMD ["python", "-u", "run.py"]
