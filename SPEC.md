# AI Generator - RunningHub 图像生成平台

## 1. Concept & Vision

一个专为移动端优化的 AI 图像生成平台，整合 RunningHub 的文生图和图生图能力。界面简洁高效，背景采用深色赛博朋克风格，让用户专注于创作本身。整体体验如同一款专业级移动创作工具——响应迅速、操作流畅、视觉愉悦。

## 2. Design Language

### Aesthetic Direction
赛博朋克暗色风格 —— 深邃的暗色背景配合霓虹渐变点缀，营造专业 AI 工具的科技感，同时保持界面的可读性和易用性。

### Color Palette
- **Background**: `#0a0a0f` (深黑)
- **Surface**: `#13131a` (卡片背景)
- **Surface Elevated**: `#1a1a24` (输入框等)
- **Border**: `#2a2a3a` (边框)
- **Primary**: `#a855f7` (紫色 - 主色调)
- **Primary Glow**: `#c084fc` (高亮)
- **Secondary**: `#06b6d4` (青色 - 次要)
- **Accent**: `#f472b6` (粉色 - 强调)
- **Success**: `#22c55e` (成功)
- **Error**: `#ef4444` (错误)
- **Warning**: `#f59e0b` (警告)
- **Text Primary**: `#f1f5f9` (主文字)
- **Text Secondary**: `#94a3b8` (次要文字)
- **Text Muted**: `#475569` (占位符)

### Typography
- **Primary Font**: "Inter", -apple-system, BlinkMacSystemFont, sans-serif
- **Heading Weight**: 600-700
- **Body Weight**: 400
- **Base Size**: 15px (移动端优化)
- **Line Height**: 1.5

### Spatial System
- **Base unit**: 4px
- **Spacing scale**: 4, 8, 12, 16, 20, 24, 32, 48px
- **Border radius**: 8px (inputs), 12px (cards), 16px (modals), 9999px (pills)
- **Container max-width**: 480px (mobile-first, centered on larger screens)

### Motion Philosophy
- **Transitions**: 200ms ease for interactive elements
- **Page transitions**: fade + slight translateY, 300ms
- **Loading states**: pulsing glow animation on primary color
- **Feedback**: subtle scale (0.98) on button press
- **Polling indicator**: rotating ring animation

### Visual Assets
- **Icons**: Lucide React (consistent, clean line icons)
- **Decorative**: Subtle gradient overlays, glow effects on active states
- **No images needed**: Pure UI application

## 3. Layout & Structure

### App Shell
```
┌─────────────────────────────┐
│  Header (固定顶部)            │
│  Logo + API Key设置按钮       │
├─────────────────────────────┤
│                             │
│  Tab Navigation (粘性)       │
│  [文生图] [图生图] [图生视频]   │
│                             │
├─────────────────────────────┤
│                             │
│  Content Area (可滚动)       │
│  - 各功能页面内容             │
│                             │
│                             │
└─────────────────────────────┘
```

### Responsive Strategy
- **Mobile (< 640px)**: 单列布局，全宽卡片
- **Tablet/Desktop (≥ 640px)**: 居中容器，最大 480px 宽，模拟移动端体验
- 所有 touch targets 最小 44x44px

## 4. Features & Interactions

### 全局设置 - API Key 管理
- 点击右上角设置图标打开侧滑抽屉
- 输入框用于输入 RunningHub API Key
- Key 存储在 localStorage
- 首次使用时会显示引导提示
- 验证格式（非空，显示前4位和后4位脱敏）

### 文生图页面
**核心参数:**
- 宽度: 512-2048, 默认 1024, slider + input
- 高度: 512-2048, 默认 1536, slider + input
- 图片数量: 1-6, 默认 3, slider + input
- 负面提示词开关: toggle, 默认关闭
- Prompt: 多行文本框，必填

**LoRA 参数 (3组):**
- LoRA 名称: text input
- LoRA 权重: 0-2, slider

**角色参数:**
- 所有选项显示为"英文名（中国翻译）"格式，例如 "Curvy (曲线型)"
- 体型 (body_type): select 下拉，从预置选项中选择
- 表情 (facial_expression): select
- 发色 (hair_color): select
- 头发长度 (hair_length): select
- 发型 (hair_style): select (超长选项列表)
- 镜头类型 (shot): select
- 服装 (clothes): select
- 内搭 (female_lingerie): select (超长列表)
- 灯光方向 (light_direction): select
- 灯光类型 (light_type): select
- 姿势 (model_pose): select (超长列表)

**高级选项:**
- 追加随机提示词: toggle, 默认开启
- Checkpoint 模型: text input

**交互流程:**
1. 用户填写参数
2. 点击"开始生成"按钮
3. 按钮变为 loading 状态，显示旋转图标
4. 调用 RunningHub API 提交任务
5. 开始轮询任务状态 (每 3 秒)
6. 任务完成: 显示生成的图片网格
7. 点击图片可全屏查看
8. 错误: 显示 toast 提示

### 图生图页面
**核心参数:**
- 参考图片上传: drag & drop / 点击上传区域
- 支持 jpg, png, webp, 最大 10MB
- 上传后显示缩略图预览
- 提示词: 多行文本框，描述想要的变换

**可选参数:**
- batch_size: 1-8, 默认 4

**交互流程:**
1. 上传参考图片 (调用 /task/openapi/upload)
2. 填写提示词
3. 点击"开始生成"
4. 轮询任务状态
5. 显示结果图片网格

### 图生视频页面 (预留)
- 显示"即将上线"占位页面
- 优雅的 coming soon 展示
- 邮件订阅输入框（可选功能预留）

### 任务队列系统 (TaskManager)
- 支持最多 20 个并行任务槽位
- 每个任务独立轮询，互不干扰
- 实时显示每个任务的：
  - 状态（排队中/生成中/已完成/失败）
  - 运行时间（每秒更新）
  - 消耗币数（任务完成后显示）
  - 提示词预览
  - 生成图片缩略图（完成后）
  - ZIP 下载按钮（完成后）
- 任务卡片支持取消和批量清除已完成任务
- 任务完成后自动从 ZIP 解压图片并显示

### 轮询机制
- 提交任务后立即开始轮询
- 轮询间隔: 3000ms
- 最大轮询时间: 无限制（由 RunningHub 决定）
- 任务状态映射: SUCCESS→FINISHED, FAILED→FAILED, RUNNING→RUNNING, QUEUEING/QUEUED→QUEUEING
- 完成后自动从 API 返回的 results 数组中提取 ZIP URL
- 使用 JSZip 库自动解压 ZIP 文件中的图片

### 错误处理
- API Key 未设置: 引导用户去设置
- 网络错误: toast 提示，可重试
- 任务失败: 显示错误信息
- 图片上传失败: 显示具体错误

## 5. Component Inventory

### Header
- Logo: "AI Generator" 文字 logo，带渐变色
- Settings button: gear icon, 右上角
- States: default

### TabNavigation
- 3 tabs: 文生图, 图生图, 图生视频
- Active tab: 底部高亮线 + 文字颜色变化
- Inactive: 灰色文字
- Sticky below header

### SettingDrawer
- 侧滑抽屉，从右侧滑入
- 半透明遮罩背景
- API Key 输入框 + 保存按钮
- 显示已保存 key 的脱敏信息

### ParameterSlider
- Label + 当前值显示
- Range slider (自定义样式)
- 数字输入框 (可选)
- States: default, dragging, disabled

### ParameterSelect
- Label
- Select dropdown (native 或自定义)
- States: default, open, selected

### ParameterToggle
- Label
- Toggle switch
- States: off, on, disabled

### ParameterTextArea
- Label
- Multi-line textarea
- Character count (可选)
- States: default, focused, error

### ParameterInput
- Label
- Single line input
- States: default, focused, error, disabled

### ImageUploader
- Drop zone with dashed border
- Click to upload instruction text
- File type/size restrictions shown
- Preview thumbnail after upload
- States: empty, dragging, uploading, uploaded, error

### GenerateButton
- Full-width primary button
- States: default (gradient bg), loading (spinner), disabled (grayed)
- Press feedback: slight scale down

### ImageGrid
- Responsive grid of image cards
- Each card: image + download button
- Click to open lightbox
- States: loading (skeleton), loaded, empty

### TaskList
- Displays up to 20 concurrent tasks
- Each task card shows: status icon, status text, elapsed time, coins, prompt preview
- Active tasks show progress bar animation
- Completed tasks show image thumbnails (clickable to download)
- Download ZIP button for completed tasks
- Cancel button for individual tasks
- "Clear completed" batch action

### ImageLightbox
- Full-screen overlay
- Image centered and scaled to fit
- Close button
- Download button
- Swipe to navigate (mobile)

### Toast
- Fixed position (top or bottom)
- Types: success (green), error (red), warning (yellow), info (blue)
- Auto-dismiss after 4s
- Slide-in animation

### LoadingOverlay
- Full-screen semi-transparent overlay
- Centered spinner with status text
- Used during initial load

## 6. Technical Approach

### Stack
- **Framework**: React 18 + TypeScript
- **Build**: Vite
- **Styling**: Tailwind CSS v4 (with custom theme)
- **Icons**: Lucide React
- **State**: React hooks (useState, useRef, useCallback)
- **HTTP**: Native fetch API
- **Zip Extraction**: JSZip (client-side unzip for task results)
- **No router needed**: Tab-based navigation with conditional rendering

### Project Structure
```
nsfwxo/
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── tsconfig.json
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css
│   ├── types/
│   │   └── index.ts
│   ├── services/
│   │   ├── runninghub.ts
│   │   └── storage.ts
│   ├── hooks/
│   │   ├── useApiKey.ts
│   │   ├── useToast.ts
│   │   └── useTaskManager.ts
│   ├── components/
│   │   ├── Header.tsx
│   │   ├── TabNavigation.tsx
│   │   ├── SettingDrawer.tsx
│   │   ├── ParameterSlider.tsx
│   │   ├── ParameterSelect.tsx
│   │   ├── ParameterToggle.tsx
│   │   ├── ParameterTextArea.tsx
│   │   ├── ParameterInput.tsx
│   │   ├── ImageUploader.tsx
│   │   ├── GenerateButton.tsx
│   │   ├── ImageGrid.tsx
│   │   ├── ImageLightbox.tsx
│   │   ├── Toast.tsx
│   │   └── ComingSoon.tsx
│   └── pages/
│       ├── TextToImagePage.tsx
│       ├── ImageToImagePage.tsx
│       └── ImageToVideoPage.tsx
└── public/
```

### API Integration

#### RunningHub Endpoints
- **Base URL**: `https://www.runninghub.cn/openapi/v2`
- **Auth Header**: `Authorization: Bearer ${API_KEY}`
- **Content-Type**: `application/json`

#### Endpoints Used
1. **Run Task**: `POST /run/ai-app/{workflow_id}`
   - Text-to-Image Workflow ID: `2018668091206537217`
   - Image-to-Image Workflow ID: `2016833201292976129`
   - Body: `{ nodeInfoList, instanceType: "default", usePersonalQueue: "false" }`
   - Returns: `{ code, msg, data: { taskId } }`

2. **Upload Image**: `POST /task/openapi/upload`
   - For img2img reference images
   - Returns: `{ code, msg, data: { image: "path.png" } }`

3. **Query Task Status**: `GET /run/ai-app/{workflow_id}/{task_id}/status`
   - Returns full task response with results array
   - Results contain `{ url, nodeId, outputType: "zip", text }`
   - ZIP files are auto-extracted client-side using JSZip

### Data Model

```typescript
// Task submission
interface RunTaskRequest {
  nodeInfoList: NodeInfo[];
  instanceType: string;
  usePersonalQueue: string;
}

interface NodeInfo {
  nodeId: string;
  fieldName: string;
  fieldValue: string;
  fieldData?: string;
  description: string;
}

// Full Task Response from RunningHub API
interface TaskResponse {
  taskId: string;
  status: 'SUCCESS' | 'FAILED' | 'RUNNING' | string;
  errorCode: string;
  errorMessage: string;
  results: Array<{
    url: string;
    nodeId: string;
    outputType: 'zip' | 'image' | string;
    text: string | null;
  }>;
  usage: {
    consumeMoney: number | null;
    consumeCoins: string | null;
    taskCostTime: string | null;
  };
}

// Queued task in app
interface QueuedTask {
  id: string;
  taskId: string | null;
  workflowType: 'txt2img' | 'img2img';
  status: 'QUEUEING' | 'RUNNING' | 'FINISHED' | 'FAILED';
  prompt: string;
  zipUrl: string | null;
  images: string[];
  error: string | null;
  startTime: number;
  elapsedSeconds: number;
  coins: string | null;
}
```

### localStorage Schema
```json
{
  "rh_api_key": "your-32-char-api-key"
}
```
