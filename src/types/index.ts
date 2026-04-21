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

export type TabType = 'txt2img' | 'img2img' | 'img2vid' | 'aiprompt' | 'history';

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
}
