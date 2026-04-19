import JSZip from 'jszip';
import type { NodeInfo, RunTaskRequest, TaskResponse, UploadResponse, TaskStatus } from '../types';

const BASE_URL = 'https://www.runninghub.cn/openapi/v2';

export const WORKFLOW = {
  TEXT_TO_IMAGE: '2016821668009742337',
  IMAGE_TO_IMAGE: '2016833201292976129',
  IMAGE_TO_VIDEO: '2018678819216953345',
} as const;

interface ApiResponse {
  code?: number;
  msg?: string;
  [key: string]: unknown;
}

async function apiRequest<T>(
  url: string,
  options: RequestInit,
  apiKey: string,
  ignoreNonZeroCode = false
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...(options.headers as Record<string, string>),
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  console.log(`[RunningHub API] ${options.method || 'GET'} ${url} => HTTP ${response.status}`);

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '(no body)');
    console.error(`[RunningHub API] Error body: ${bodyText}`);
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const text = await response.text();
  console.log(`[RunningHub API] Response body (${text.length} chars): ${text.slice(0, 500)}${text.length > 500 ? '...' : ''}`);

  const data = JSON.parse(text) as T & ApiResponse;

  // 对于 /task/openapi/outputs 等接口，code 804/813/805 是正常状态码，不是错误
  if ('code' in data && typeof data.code === 'number' && data.code !== 0 && !ignoreNonZeroCode) {
    throw new Error(data.msg || `API Error: code ${data.code}`);
  }

  return data as T;
}

export async function runTask(
  apiKey: string,
  workflowId: string,
  nodeInfoList: NodeInfo[]
): Promise<TaskResponse> {
  const body: RunTaskRequest = {
    nodeInfoList,
    instanceType: 'default',
    usePersonalQueue: 'false',
  };

  const url = `${BASE_URL}/run/ai-app/${workflowId}`;

  const data = await apiRequest<Record<string, unknown>>(url, {
    method: 'POST',
    body: JSON.stringify(body),
  }, apiKey) as Record<string, unknown>;

  const taskId = (data.taskId as string) || ((data.data as Record<string, unknown> | null)?.taskId as string) || '';

  if (!taskId) {
    console.error('API Response:', JSON.stringify(data, null, 2));
    throw new Error(`任务提交失败: ${(data.msg as string) || '未获取到 taskId'}`);
  }

  // 构建为 TaskResponse 格式
  return {
    taskId,
    status: (data.status as string) || 'RUNNING',
    errorCode: (data.errorCode as string) || '',
    errorMessage: (data.errorMessage as string) || '',
    results: (data.results as TaskResponse['results']) || null,
    clientId: (data.clientId as string) || '',
    promptTips: (data.promptTips as string) || '',
    failedReason: (data.failedReason as Record<string, unknown>) || {},
    usage: (data.usage as TaskResponse['usage']) || null,
    parentTaskId: (data.parentTaskId as string | null) || null,
    taskUsageList: (data.taskUsageList as TaskResponse['taskUsageList']) || null,
  };
}

export interface TaskOutputsResponse {
  code: number;
  msg: string;
  data: Array<{
    fileUrl: string;
    fileType: string;
    taskCostTime: number;
    nodeId: string;
  }>;
}

export async function getTaskStatus(
  apiKey: string,
  taskId: string
): Promise<TaskResponse> {
  // 查询任务状态：POST /task/openapi/status（无 /openapi/v2 前缀）
  // 只返回简单状态字符串：QUEUED, RUNNING, SUCCESS, FAILED
  const statusUrl = 'https://www.runninghub.cn/task/openapi/status';

  const statusData = await apiRequest<{
    code?: number;
    msg?: string;
    data?: string;
  }>(statusUrl, {
    method: 'POST',
    body: JSON.stringify({ apiKey, taskId }),
  }, apiKey, true);

  const status = statusData.data || 'RUNNING';

  return {
    taskId,
    status,
    errorCode: '',
    errorMessage: '',
    results: null,
    clientId: '',
    promptTips: '',
    failedReason: {},
    usage: null,
    parentTaskId: null,
    taskUsageList: null,
  };
}

export async function getTaskResults(
  apiKey: string,
  taskId: string
): Promise<TaskResponse> {
  const outputsUrl = 'https://www.runninghub.cn/task/openapi/outputs';

  const outputsData = await apiRequest<{
    code?: number;
    msg?: string;
    data?: unknown;
  }>(outputsUrl, {
    method: 'POST',
    body: JSON.stringify({ apiKey, taskId }),
  }, apiKey, true);

  console.log('[getTaskResults] Raw response:', outputsData);

  const code = outputsData.code ?? -1;

  // code=0: SUCCESS with file results
  if (code === 0 && outputsData.data && Array.isArray(outputsData.data)) {
    const data = outputsData.data as Array<{
      fileUrl?: string;
      fileType?: string;
      taskCostTime?: string | number;
      nodeId?: string;
      consumeCoins?: string;
    }>;

    console.log('[getTaskResults] Processing code=0, data items:', data.length);
    console.log('[getTaskResults] First item:', JSON.stringify(data[0]));

    return {
      taskId,
      status: 'SUCCESS',
      errorCode: '',
      errorMessage: '',
      results: data.map((item) => ({
        url: item.fileUrl || '',
        nodeId: item.nodeId || '',
        outputType: item.fileType || '',
        text: null,
      })),
      clientId: '',
      promptTips: '',
      failedReason: {},
      usage: data.length > 0 ? {
        consumeMoney: null,
        consumeCoins: data[0].consumeCoins || null,
        taskCostTime: String(data[0].taskCostTime || ''),
        thirdPartyConsumeMoney: null,
      } : null,
      parentTaskId: null,
      taskUsageList: null,
    };
  }

  // code=805: FAILED with failedReason
  if (code === 805) {
    const data = outputsData.data as Record<string, unknown> | null;
    const failedReason = (data?.failedReason as Record<string, unknown>) || {};
    const msg = (data?.exception_message as string) || outputsData.msg || '任务失败';

    return {
      taskId,
      status: 'FAILED',
      errorCode: '805',
      errorMessage: msg,
      results: null,
      clientId: '',
      promptTips: '',
      failedReason,
      usage: null,
      parentTaskId: null,
      taskUsageList: null,
    };
  }

  // code=804: RUNNING / code=813: QUEUED / other: still in progress
  return {
    taskId,
    status: code === 813 ? 'QUEUED' : 'RUNNING',
    errorCode: '',
    errorMessage: '',
    results: null,
    clientId: '',
    promptTips: '',
    failedReason: {},
    usage: null,
    parentTaskId: null,
    taskUsageList: null,
  };
}

export function mapTaskStatus(status: string): TaskStatus {
  switch (status) {
    case 'SUCCESS':
    case 'FINISHED':
      return 'FINISHED';
    case 'FAILED':
    case 'FAIL':
      return 'FAILED';
    case 'RUNNING':
    case 'PROCESSING':
      return 'RUNNING';
    case 'QUEUEING':
    case 'QUEUED':
    case 'PENDING':
      return 'QUEUEING';
    default:
      return 'PENDING';
  }
}

export async function extractImagesFromZip(zipUrl: string, retries = 3): Promise<string[]> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }

    try {
      console.log('[extractImagesFromZip] Fetching zip from:', zipUrl, 'attempt:', attempt);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      const response = await fetch(zipUrl, { signal: controller.signal });
      clearTimeout(timeout);

      console.log('[extractImagesFromZip] Response status:', response.status);

      if (!response.ok) {
        throw new Error(`Failed to fetch zip: ${response.status}`);
      }

      let arrayBuffer: ArrayBuffer;
      try {
        arrayBuffer = await response.arrayBuffer();
      } catch (err) {
        throw new Error('读取 ZIP 数据失败: ' + (err instanceof Error ? err.message : String(err)));
      }

      console.log('[extractImagesFromZip] Downloaded zip, size:', arrayBuffer.byteLength);

      if (arrayBuffer.byteLength === 0) {
        throw new Error('ZIP 文件为空');
      }

      let zip: JSZip;
      try {
        zip = await JSZip.loadAsync(arrayBuffer);
        console.log('[extractImagesFromZip] Zip loaded successfully');
      } catch (err) {
        throw new Error('解析 ZIP 文件失败: ' + (err instanceof Error ? err.message : String(err)));
      }

      const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
      const imageUrls: string[] = [];

      const fileEntries = Object.entries(zip.files);
      console.log('[extractImagesFromZip] Total files in zip:', fileEntries.length);

      const nonDirFiles = fileEntries.filter(([, f]) => !f.dir);
      console.log('[extractImagesFromZip] Non-directory files:', nonDirFiles.length);
      console.log('[extractImagesFromZip] File names:', nonDirFiles.map(([name]) => name).join(', '));

      for (const [filename, file] of nonDirFiles) {
        const ext = filename.toLowerCase();
        if (imageExtensions.some((e) => ext.endsWith(e))) {
          console.log('[extractImagesFromZip] Found image:', filename);
          try {
            const blob = await file.async('blob');
            console.log('[extractImagesFromZip] Blob size for', filename, ':', blob.size);
            if (blob.size === 0) {
              console.warn('[extractImagesFromZip] Skipping empty file:', filename);
              continue;
            }
            const url = URL.createObjectURL(blob);
            imageUrls.push(url);
          } catch (err) {
            console.error('[extractImagesFromZip] Failed to extract file:', filename, err);
          }
        }
      }

      console.log('[extractImagesFromZip] Extracted images count:', imageUrls.length);
      if (imageUrls.length === 0) {
        throw new Error('ZIP 中未找到图片文件');
      }
      return imageUrls;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn('[extractImagesFromZip] Attempt', attempt, 'failed:', lastError.message);
    }
  }

  throw lastError || new Error('解压 ZIP 文件失败');
}

export async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function extractImagesFromZipAsDataUrls(zipUrl: string, retries = 3): Promise<string[]> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      const response = await fetch(zipUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Failed to fetch zip: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength === 0) {
        throw new Error('ZIP 文件为空');
      }
      const zip = await JSZip.loadAsync(arrayBuffer);

      const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
      const dataUrls: string[] = [];

      const nonDirFiles = Object.entries(zip.files).filter(([, f]) => !f.dir);
      console.log('[extractImagesFromZipAsDataUrls] Files:', nonDirFiles.map(([name]) => name).join(', '));

      for (const [filename, file] of nonDirFiles) {
        const ext = filename.toLowerCase();
        if (imageExtensions.some((e) => ext.endsWith(e))) {
        const blob = await file.async('blob');
        if (blob.size === 0) continue;
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        dataUrls.push(dataUrl);
      }
    }

      return dataUrls;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn('[extractImagesFromZipAsDataUrls] Attempt', attempt, 'failed:', lastError.message);
    }
  }

  throw lastError || new Error('解压 ZIP 文件失败');
}

export async function uploadImage(
  apiKey: string,
  file: File,
  retries = 3
): Promise<{ imagePath: string }> {
  const formData = new FormData();
  formData.append('file', file);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${BASE_URL}/media/upload/binary`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Upload failed: HTTP ${response.status}`);
      }

      const data = await response.json() as {
        code: number;
        message: string;
        data?: {
          fileName?: string;
          download_url?: string;
          type?: string;
          size?: string;
        };
      };

      if (data.code !== 0) {
        throw new Error(data.message || 'Image upload failed');
      }

      const fileName = data.data?.fileName;
      if (!fileName) {
        throw new Error('Upload response missing fileName');
      }

      return { imagePath: fileName };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (lastError.name === 'AbortError') {
        lastError = new Error('图片上传超时，请重试');
      }
    }
  }

  throw lastError || new Error('图片上传失败');
}

export function downloadZip(zipUrl: string, taskId: string) {
  const link = document.createElement('a');
  link.href = zipUrl;
  link.download = `result-${taskId}.zip`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.click();
}

export function downloadImage(url: string, filename: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.click();
}
