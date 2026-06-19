export interface NodeInfo {
  nodeId: string;
  fieldName: string;
  fieldValue: string;
  fieldData?: string;
  description: string;
}

export interface RunTaskRequest {
  nodeInfoList: NodeInfo[];
  instanceType: string;
  usePersonalQueue: string;
}

export type TaskStatus = 'PENDING' | 'QUEUEING' | 'RUNNING' | 'FINISHED' | 'FAILED';

export interface TaskResult {
  url: string;
  nodeId: string;
  outputType: 'zip' | 'image' | string;
  text: string | null;
  fileUrl?: string;
  fileType?: string;
}

export interface TaskUsage {
  consumeMoney: number | null;
  consumeCoins: string | null;
  taskCostTime: string | null;
  thirdPartyConsumeMoney: number | null;
}

export interface TaskResponse {
  taskId: string;
  status: 'SUCCESS' | 'FAILED' | 'RUNNING' | string;
  errorCode: string;
  errorMessage: string;
  results: TaskResult[] | null;
  clientId: string;
  promptTips: string;
  failedReason: Record<string, unknown>;
  usage: TaskUsage | null;
  parentTaskId: string | null;
  taskUsageList: Array<{
    taskId: string;
    parentTaskId: string | null;
    taskStatus: string;
    usage: TaskUsage;
  }> | null;
}

export interface UploadResponse {
  code: number;
  msg: string;
  data?: {
    image?: string;
    fileName?: string;
  };
}

export type TabType = 'txt2img' | 'img2img' | 'img2vid' | 'aiprompt' | 'gptimg2' | 'history';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
}

export interface TextToImageParams {
  width: number;
  height: number;
  imageCount: number;
  enableNegativePrompt: boolean;
  prompt: string;
  lora1Name: string;
  lora1Weight: number;
  lora2Name: string;
  lora2Weight: number;
  lora3Name: string;
  lora3Weight: number;
  enableRandomPrompt: boolean;
  checkpoint: string;
  bodyType: string;
  facialExpression: string;
  hairColor: string;
  hairLength: string;
  hairStyle: string;
  shot: string;
  clothes: string;
  femaleLingerie: string;
  lightDirection: string;
  lightType: string;
  modelPose: string;
  props: string[];
  cameraAngle: string;
}

export interface ImageToImageParams {
  prompt: string;
  batchSize: number;
  uploadedImagePath: string;
}

export interface QueuedTask {
  id: string;
  taskId: string | null;
  workflowType: 'txt2img' | 'img2img' | 'img2vid';
  workflowIdOverride?: string;
  status: TaskStatus;
  prompt: string;
  zipUrl: string | null;
  images: string[];
  error: string | null;
  startTime: number;
  elapsedSeconds: number;
  coins: string | null;
  nodeInfoList: NodeInfo[];
  /** Identifies which storyboard panel this task belongs to (if any). */
  storyboardInfo?: { historyId: string; panelIdx: number };
  /** Identifies which UI module produced this task — used to render a source
   * tag in the history page (e.g. "智能扩写", "随机抽卡", "剧情分镜").
   * Falls back to the workflowType-derived label when missing.
   * - expand          → 智能扩写
   * - random          → 随机抽卡
   * - smart-storyboard → 智能分镜 (StoryboardSection 在智能扩写页内触发的任务)
   * - storyboard      → 剧情分镜 (剧情分镜页面内的批量/单图任务) */
  source?: 'expand' | 'random' | 'smart-storyboard' | 'storyboard' | 'txt2img' | 'img2img' | 'img2vid';
  /** Storyboard / random theme title. Displayed alongside the source badge in
   * the history page so users can tell which story/theme a finished image
   * belongs to. Optional — only set for sources that have a theme context. */
  themeTitle?: string;
  /** 1-based panel number this task belongs to. Combined with themeTitle it
   * gives users a clear "剧情: 主题名 · 第N镜" annotation. Optional. */
  panelNumber?: number;
}
