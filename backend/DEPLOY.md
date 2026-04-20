# Railway Deployment Guide

## 1. 创建 Railway 项目

### 方式 A: 通过 Railway CLI
```bash
npm install -g @railway/cli
railway login
cd backend
railway init
railway up
```

### 方式 B: 通过 Railway Dashboard
1. 访问 https://railway.app
2. New Project → Deploy from GitHub repo
3. 选择 `nsfwxo/backend` 目录作为 Root Directory

## 2. 配置环境变量

在 Railway 项目设置中添加以下环境变量（可选，后端从请求头获取 Key）：

| 变量名 | 说明 |
|--------|------|
| `PORT` | Railway 自动注入，值为分配的端口 |
| `YUNWU_BASE_URL` | `https://api.yunwu.ai/v1` |
| `MODEL_NAME` | `grok-4-20-reasoning` |

## 3. Railway 会自动识别 Dockerfile 并构建

构建日志可在 Railway Dashboard → Deployments 查看。

## 4. 获取部署后的 URL

部署完成后，Railway 会分配一个类似：
```
https://nsfwxo-prompt-engine.up.railway.app
```

复制该 URL，粘贴到前端设置 → 后端服务地址中。

## 5. 更新前端配置

前端打开设置面板，在「后端服务地址」填入 Railway 分配的 URL：
```
https://nsfwxo-prompt-engine.up.railway.app
```

保存后，AI 提示词功能即可在线使用。

## 6. 注意事项

- Railway 免费额度：每月 500 小时，100GB 流量
- 冷启动可能需要 30-60 秒
- 建议配置健康检查：`/health` 端点已实现
