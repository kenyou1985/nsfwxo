FROM python:3.11-slim

# 强制 stdout/stderr 无缓冲，Railway 部署日志能即时看到 uvicorn/print 输出
# （否则 Python 默认块缓冲，崩溃/启动信息会被吞掉，看起来像"沉默失败"）
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app code
COPY app/ ./app/
COPY data/ ./data/
COPY run.py .

# Expose port
EXPOSE 9000

# Run (python -u 冗余但更明确，避免某些 base image 不读 ENV)
CMD ["python", "-u", "run.py"]
