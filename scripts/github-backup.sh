#!/usr/bin/env bash
# GitHub 版本备份：提交当前工作区 + 打时间标签 + 推送 main 和标签
# 用法: ./scripts/github-backup.sh ["提交说明"]
set -euo pipefail
cd "$(dirname "$0")/.."

REMOTE="${GIT_REMOTE:-origin}"
BRANCH="${GIT_BRANCH:-main}"
MSG="${1:-backup: $(date '+%Y-%m-%d %H:%M:%S')}"

# 只提交受 git 管理/未被 .gitignore 排除的文件；运行数据/密钥不会进入版本库
git add -A

if git diff --cached --quiet; then
  echo "[backup] 没有需要提交的变更"
else
  git commit -m "$MSG"
fi

TAG="backup-$(date '+%Y%m%d-%H%M%S')"
git tag -a "$TAG" -m "$MSG"

echo "[backup] 推送 $BRANCH -> $REMOTE"
git push "$REMOTE" "HEAD:$BRANCH"
echo "[backup] 推送标签 $TAG"
git push "$REMOTE" "$TAG"

echo "[backup] 完成: $TAG"
