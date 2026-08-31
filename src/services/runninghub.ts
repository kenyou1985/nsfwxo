import JSZip from 'jszip';
import type { NodeInfo, RunTaskRequest, TaskResponse, UploadResponse, TaskStatus } from '../types';
import { openDB, idbGet, idbPut, idbDelete } from './idb';

const BASE_URL = 'https://www.runninghub.ai/openapi/v2';

// ─── Local ZIP pack/unpack for img2img workflows that return direct image URLs ───
// Some RunningHub workflows (notably IMAGE_TO_IMAGE = '2083569010550423553') return
// direct image URLs (png/jpg) instead of a zip package. To keep history caching logic
// unified with zip-based workflows (txt2img, storyboard, etc.), we pack the downloaded
// image bytes into a zip Blob and persist it in IndexedDB. The history record stores a
// `packed:<taskId>` key in `zipUrl`; history page reads the zip back from IndexedDB and
// extracts images on demand, exactly like a remote-zip workflow.

const LOCAL_ZIP_DB_NAME = 'nsfwxo_local_zips';
const LOCAL_ZIP_DB_VERSION = 1;
const LOCAL_ZIP_STORE = 'zips';

interface LocalZipEntry {
  key: string;
  blob: Blob;
  cachedAt: number;
  sizeBytes: number;
}

let _localZipDb: IDBDatabase | null = null;

async function getLocalZipDB(): Promise<IDBDatabase> {
  if (_localZipDb) return _localZipDb;
  _localZipDb = await openDB(LOCAL_ZIP_DB_NAME, LOCAL_ZIP_DB_VERSION, (db) => {
    if (!db.objectStoreNames.contains(LOCAL_ZIP_STORE)) {
      db.createObjectStore(LOCAL_ZIP_STORE, { keyPath: 'key' });
    }
  });
  return _localZipDb;
}

/**
 * Pack a list of image data URLs into a zip Blob and persist it in IndexedDB.
 * Returns a `packed:<taskId>` key suitable for storing in a history record's
 * `zipUrl` field. The actual zip Blob lives in IndexedDB so it survives page
 * refreshes — unlike a `URL.createObjectURL` blob URL, which is invalidated
 * when the document unloads.
 */
export async function packImagesAsZip(taskId: string, images: string[]): Promise<string> {
  if (!taskId || images.length === 0) return '';
  const db = await getLocalZipDB();
  const zip = new JSZip();
  for (let i = 0; i < images.length; i++) {
    const url = images[i];
    if (!url) continue;
    let ext = 'png';
    if (url.startsWith('data:')) {
      const mt = url.slice(5, url.indexOf(';'));
      const sub = mt.split('/')[1] || 'png';
      ext = sub === 'jpeg' ? 'jpg' : sub;
    }
    if (url.startsWith('blob:')) ext = 'png';
    const filename = `${String(i + 1).padStart(3, '0')}.${ext}`;
    if (url.startsWith('data:')) {
      const base64 = url.slice(url.indexOf(',') + 1);
      zip.file(filename, base64, { base64: true });
    } else {
      // For http(s) URLs the caller should have already converted to data URLs.
      // Fall back to fetching the bytes.
      try {
        const resp = await fetch(url);
        const blob = await resp.blob();
        zip.file(filename, blob);
      } catch {
        // Skip this file if we can't fetch it
      }
    }
  }
  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const key = `packed:${taskId}`;
  const entry: LocalZipEntry = { key, blob: zipBlob, cachedAt: Date.now(), sizeBytes: zipBlob.size };
  await idbPut(db, LOCAL_ZIP_STORE, entry);
  return key;
}

/**
 * Read a previously packed zip from IndexedDB and return the contained image
 * data URLs. Mirrors extractImagesFromZipAsDataUrls but reads from a local
 * source instead of fetching from a remote URL.
 */
export async function extractImagesFromLocalZip(packedKey: string): Promise<string[]> {
  if (!packedKey || !packedKey.startsWith('packed:')) return [];
  try {
    const db = await getLocalZipDB();
    const entry = (await idbGet(db, LOCAL_ZIP_STORE, packedKey)) as LocalZipEntry | undefined;
    if (!entry || !entry.blob) return [];
    const zip = await JSZip.loadAsync(entry.blob);
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
    const dataUrls: string[] = [];
    const nonDirFiles = Object.entries(zip.files).filter(([, f]) => !f.dir);
    // Sort by filename so order matches the original image order
    nonDirFiles.sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
    for (const [, file] of nonDirFiles) {
      const filename = file.name.toLowerCase();
      if (!imageExtensions.some((e) => filename.endsWith(e))) continue;
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
    return dataUrls;
  } catch (err) {
    console.warn('[extractImagesFromLocalZip] Failed:', err);
    return [];
  }
}

/** Delete a packed zip entry. Used when a history record is removed. */
export async function deleteLocalZip(packedKey: string): Promise<void> {
  if (!packedKey || !packedKey.startsWith('packed:')) return;
  try {
    const db = await getLocalZipDB();
    await idbDelete(db, LOCAL_ZIP_STORE, packedKey);
  } catch {
    /* ignore */
  }
}

export const WORKFLOW = {
  TEXT_TO_IMAGE: '2016821668009742337',
  IMAGE_TO_IMAGE: '2083569010550423553',
  IMAGE_TO_VIDEO: '2018678819216953345',
  /** 真实系批量文生图 — 默认 */
  REALISTIC_BATCH: '2016821668009742337',
  /** 3LoRA 模型 */
  THREE_LORA: '2018668091206537217',
  /** 真实 V3 模型 */
  REALISTIC_V3: '2018672045172723713',
  /** Krea2 文生图模型 */
  KREA2: '2082140662178611201',
  /** MiniMax H3 图生视频模型 */
  MINIMAX_H3: '2084661265636839425',
  /** MiniMax 长视频（0.4像素）模型 */
  MINIMAX_LONG: '2091369701523136514',
  /** MiniMax H3 文生视频模型 */
  MINIMAX_H3_T2V: '2086701195858923521',
} as const;

export interface WorkflowNode {
  nodeId: string;
  nodeName?: string;
  fields?: Record<string, {
    name?: string;
    type?: string;
    options?: Array<{ label?: string; value?: string }>;
    defaultValue?: unknown;
  }>;
}

export async function getWorkflowAvailableLoRAs(
  apiKey: string,
  workflowId: string,
  forceRefresh = false
): Promise<Set<string>> {
  const cacheKey = `lora_cache_${workflowId}`;
  if (!forceRefresh) {
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const { loras, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < 5 * 60 * 1000) {
          return new Set(loras);
        }
      }
    } catch {}
  }

  try {
    const format = await getWorkflowFormat(apiKey, workflowId);
    const loras = new Set<string>();

    // Parse workflow format - look for LoraLoader nodes
    const parseNode = (node: Record<string, unknown>) => {
      const nodeName = (node.nodeName || node.title || '') as string;
      if (typeof nodeName === 'string' &&
          (nodeName.includes('LoraLoader') || nodeName.includes('Lora'))) {
        const fields = node.fields as Record<string, unknown> | undefined;
        if (fields) {
          const loraField = fields.lora_name || fields.loraName || fields.Lora_Name;
          if (loraField && typeof loraField === 'object') {
            const opts = (loraField as { options?: Array<{ label?: string; value?: string }> }).options;
            if (Array.isArray(opts)) {
              for (const opt of opts) {
                const val = opt.value || opt.label;
                if (val && typeof val === 'string' && val.endsWith('.safetensors')) {
                  loras.add(val);
                }
              }
            }
          }
        }
      }
    };

    if (Array.isArray(format.nodes)) {
      for (const node of format.nodes as unknown[]) {
        if (node && typeof node === 'object') {
          parseNode(node as Record<string, unknown>);
        }
      }
    }

    if (Array.isArray(format.nodeList)) {
      for (const node of format.nodeList as unknown[]) {
        if (node && typeof node === 'object') {
          parseNode(node as Record<string, unknown>);
        }
      }
    }

    // Also check the raw format for any array of lora options
    const findLoraArrays = (obj: unknown, depth = 0) => {
      if (depth > 5 || !obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        const allStrings = obj.every((v) => typeof v === 'string');
        if (allStrings && obj.length > 10) {
          for (const item of obj) {
            if (item.endsWith('.safetensors')) {
              loras.add(item);
            }
          }
        }
        obj.forEach(findLoraArrays);
      } else {
        for (const val of Object.values(obj as Record<string, unknown>)) {
          findLoraArrays(val, depth + 1);
        }
      }
    };
    findLoraArrays(format);

    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({
        loras: [...loras],
        timestamp: Date.now(),
      }));
    } catch {}

    return loras;
  } catch (err) {
    console.warn('[getWorkflowAvailableLoRAs] Failed to fetch LoRA list:', err);
    return new Set();
  }
}

export function validateLoRANames(
  loras: Array<{ name: string; nodeId: string }>,
  availableLoRAs: Set<string>
): Array<{ nodeId: string; name: string; suggestion: string }> {
  const invalid: Array<{ nodeId: string; name: string; suggestion: string }> = [];
  for (const { name, nodeId } of loras) {
    if (!name.trim()) continue;
    if (!availableLoRAs.has(name.trim())) {
      // Find closest match
      let closest = '';
      let bestScore = 0;
      for (const avail of availableLoRAs) {
        const lName = name.toLowerCase();
        const aName = avail.toLowerCase();
        if (aName.includes(lName) || lName.includes(aName)) {
          if (aName.length > bestScore) {
            bestScore = aName.length;
            closest = avail;
          }
        }
      }
      invalid.push({
        nodeId,
        name,
        suggestion: closest || 'LoRA 名称不在工作流可用列表中',
      });
    }
  }
  return invalid;
}

export async function getWorkflowFormat(
  apiKey: string,
  workflowId: string
): Promise<Record<string, unknown>> {
  const url = `${BASE_URL}/workflow/format/${workflowId}`;
  const response = await apiRequest<Record<string, unknown>>(url, {
    method: 'GET',
  }, apiKey, true);
  return response;
}

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

  console.log(`[runTask] POST ${url}`);
  console.log(`[runTask] body =`, JSON.stringify(body, null, 2));

  const data = await apiRequest<Record<string, unknown>>(url, {
    method: 'POST',
    body: JSON.stringify(body),
  }, apiKey) as Record<string, unknown>;

  const taskId = (data.taskId as string) || ((data.data as Record<string, unknown> | null)?.taskId as string) || '';
  const errorCode = (data.errorCode as string) || '';

  // Server-side concurrency limit (errorCode 421). The task never made it
  // to RunningHub; return a normal TaskResponse with an empty taskId so
  // the caller can detect it and decide whether to retry. We deliberately
  // do NOT throw here so the caller's retry logic can run without being
  // caught by a generic .catch() that would mark the task as failed.
  if (!taskId) {
    console.warn(`[runTask] No taskId in response (errorCode=${errorCode}, msg=${data.msg || data.errorMessage || ''})`);
    return {
      taskId: '',
      status: '',
      errorCode,
      errorMessage: (data.errorMessage as string) || (data.msg as string) || '未获取到 taskId',
      results: null,
      clientId: (data.clientId as string) || '',
      promptTips: (data.promptTips as string) || '',
      failedReason: (data.failedReason as Record<string, unknown>) || {},
      usage: null,
      parentTaskId: null,
      taskUsageList: null,
    };
  }

  // 构建为 TaskResponse 格式
  return {
    taskId,
    status: (data.status as string) || 'RUNNING',
    errorCode,
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
  const statusUrl = 'https://www.runninghub.ai/task/openapi/status';

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
  const outputsUrl = 'https://www.runninghub.ai/task/openapi/outputs';

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
      url?: string;
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
        url: item.url || item.fileUrl || '',
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

  // code=0 but no data or non-array data — task finished but has no downloadable output yet (edge case)
  if (code === 0) {
    console.log('[getTaskResults] code=0 but no data array for task:', taskId, 'data:', outputsData.data);
    return {
      taskId,
      status: 'SUCCESS',
      errorCode: '',
      errorMessage: '',
      results: [],
      clientId: '',
      promptTips: '',
      failedReason: {},
      usage: null,
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

  // /outputs can also return code=0 with data="FAILED" string for failed tasks
  if (outputsData.data === 'FAILED') {
    return {
      taskId,
      status: 'FAILED',
      errorCode: '',
      errorMessage: '任务执行失败，请检查图片和提示词参数',
      results: null,
      clientId: '',
      promptTips: '',
      failedReason: {},
      usage: null,
      parentTaskId: null,
      taskUsageList: null,
    };
  }

  // For FAILED status from /status endpoint, try to get error detail from a separate inquiry endpoint
  // Fallback: return FAILED with whatever msg is available
  if (code !== 0) {
    return {
      taskId,
      status: 'FAILED',
      errorCode: String(code),
      errorMessage: outputsData.msg || '任务失败，请检查参数是否正确',
      results: null,
      clientId: '',
      promptTips: '',
      failedReason: {},
      usage: null,
      parentTaskId: null,
      taskUsageList: null,
    };
  }

  // code=804: RUNNING / code=813: QUEUED / other: still in progress
  return {
    taskId,
    status: 'RUNNING',
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

// In-flight de-duplication for the blob-URL variant. Shares the same
// underlying network fetch with extractImagesFromZipAsDataUrls so callers
// requesting both forms for the same URL don't double-hit the CDN.
const _zipBlobInflight = new Map<string, Promise<string[]>>();

export async function extractImagesFromZip(zipUrl: string, retries = 2): Promise<string[]> {
  const pending = _zipBlobInflight.get(zipUrl);
  if (pending) {
    return pending;
  }

  const promise = (async () => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }

      try {
        console.log('[extractImagesFromZip] Fetching zip from:', zipUrl, 'attempt:', attempt);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 180000);

        const response = await fetch(zipUrl, {
          signal: controller.signal,
          cache: 'force-cache',
          // @ts-ignore — keepalive is widely supported but not in older lib defs
          keepalive: true,
        });
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

        for (const [, file] of nonDirFiles) {
          const filename = file.name;
          const ext = filename.toLowerCase();
          if (!imageExtensions.some((e) => ext.endsWith(e))) continue;
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
  })();

  _zipBlobInflight.set(zipUrl, promise);
  promise.finally(() => {
    if (_zipBlobInflight.get(zipUrl) === promise) {
      _zipBlobInflight.delete(zipUrl);
    }
  });

  return promise;
}

export async function fetchImageAsDataUrl(url: string, timeoutMs = 30000): Promise<string | null> {
  // data URL already contains the full content — return as-is
  if (url.startsWith('data:')) return url;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      if (timer) clearTimeout(timer);
      return null;
    }
    const blob = await response.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    // Clear timeout AFTER FileReader completes
    if (timer) clearTimeout(timer);
    return dataUrl;
  } catch (err) {
    if (timer) clearTimeout(timer);
    console.warn('[fetchImageAsDataUrl] failed:', url, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function ensureDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  if (url.startsWith('blob:') || url.startsWith('http://') || url.startsWith('https://')) {
    const dataUrl = await fetchImageAsDataUrl(url);
    return dataUrl || url;
  }
  return url;
}

// In-flight de-duplication for concurrent callers requesting the same zip URL.
// When several tasks (or the same task being restored + polled) need to extract
// the same zip, share a single network fetch + data-URL conversion to avoid
// hammering the CDN with redundant downloads (which manifests as
// "Failed to fetch" / "Corrupted zip" / "signal is aborted without reason").
const _zipDataUrlInflight = new Map<string, Promise<string[]>>();

export async function extractImagesFromZipAsDataUrls(zipUrl: string, retries = 2): Promise<string[]> {
  // If a fetch is already in progress for this URL, share it.
  const pending = _zipDataUrlInflight.get(zipUrl);
  if (pending) {
    return pending;
  }

  const promise = (async () => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        // 3s, 6s, 9s — give the CDN time to recover and the browser time
        // to free up a connection slot from the previous cancelled request.
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }

      let timeout: ReturnType<typeof setTimeout> | null = null;
      try {
        const controller = new AbortController();
        // Data-URL conversion (FileReader.readAsDataURL on multi-MB blobs) is
        // CPU-bound. 180s gives plenty of headroom for slow machines under load.
        timeout = setTimeout(() => controller.abort(), 180000);

        const response = await fetch(zipUrl, {
          signal: controller.signal,
          // Hint to the browser that this response may be used for a long-lived
          // download. Some CDNs need this to avoid premature connection drops.
          cache: 'force-cache',
          // @ts-ignore — keepalive is widely supported but not in older lib defs
          keepalive: true,
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch zip: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength === 0) {
          throw new Error('ZIP 文件为空');
        }

        let zip: JSZip;
        try {
          zip = await JSZip.loadAsync(arrayBuffer);
        } catch (err) {
          throw new Error('解析 ZIP 文件失败: ' + (err instanceof Error ? err.message : String(err)));
        }

        const mediaExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.mov', '.webm', '.avi', '.mkv'];
        const dataUrls: string[] = [];

        const nonDirFiles = Object.entries(zip.files).filter(([, f]) => !f.dir);
        console.log('[extractImagesFromZipAsDataUrls] Files:', nonDirFiles.map(([name]) => name).join(', '));

        for (const [, file] of nonDirFiles) {
          const filename = file.name;
          const ext = filename.toLowerCase();
          if (!mediaExtensions.some((e) => ext.endsWith(e))) continue;
          try {
            const blob = await file.async('blob');
            // 确保视频文件的 MIME 类型正确
            let finalBlob = blob;
            if (ext.endsWith('.mp4') && !blob.type) {
              finalBlob = new Blob([blob], { type: 'video/mp4' });
            } else if (ext.endsWith('.mov') && !blob.type) {
              finalBlob = new Blob([blob], { type: 'video/quicktime' });
            } else if (ext.endsWith('.webm') && !blob.type) {
              finalBlob = new Blob([blob], { type: 'video/webm' });
            } else if (ext.endsWith('.avi') && !blob.type) {
              finalBlob = new Blob([blob], { type: 'video/x-msvideo' });
            } else if (ext.endsWith('.mkv') && !blob.type) {
              finalBlob = new Blob([blob], { type: 'video/x-matroska' });
            }
            console.log(`[extractImagesFromZipAsDataUrls] Extracted blob for ${filename}: ${finalBlob.size} bytes, type=${finalBlob.type}`);
            if (finalBlob.size === 0) {
              console.warn(`[extractImagesFromZipAsDataUrls] Skipping empty blob: ${filename}`);
              continue;
            }
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                const result = reader.result as string;
                console.log(`[extractImagesFromZipAsDataUrls] Converted ${filename} to data URL: ${result.substring(0, 50)}...`);
                resolve(result);
              };
              reader.onerror = (e) => {
                console.error(`[extractImagesFromZipAsDataUrls] FileReader error for ${filename}:`, e);
                reject(new Error(`FileReader failed for ${filename}`));
              };
              reader.readAsDataURL(finalBlob);
            });
            dataUrls.push(dataUrl);
          } catch (err) {
            console.warn('[extractImagesFromZipAsDataUrls] Failed to convert', filename, err);
          }
        }

        console.log(`[extractImagesFromZipAsDataUrls] Total media converted: ${dataUrls.length}`);

        if (dataUrls.length === 0) {
          throw new Error('ZIP 中未找到图片或视频文件');
        }
        
        // Clear timeout AFTER all processing is done
        if (timeout) clearTimeout(timeout);
        return dataUrls;
      } catch (err) {
        if (timeout) clearTimeout(timeout);
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn('[extractImagesFromZipAsDataUrls] Attempt', attempt, 'failed:', lastError.message);
      }
    }

    throw lastError || new Error('解压 ZIP 文件失败');
  })();

  // Track in-flight; remove on settle (success or failure).
  _zipDataUrlInflight.set(zipUrl, promise);
  promise.finally(() => {
    // Only delete if still pointing to us (defensive — same promise is cached).
    if (_zipDataUrlInflight.get(zipUrl) === promise) {
      _zipDataUrlInflight.delete(zipUrl);
    }
  });

  return promise;
}

export async function uploadImage(
  apiKey: string,
  file: File,
  retries = 3
): Promise<{ imagePath: string; downloadUrl: string }> {
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
      const downloadUrl = data.data?.download_url || '';
      if (!fileName) {
        throw new Error('Upload response missing fileName');
      }

      return { imagePath: fileName, downloadUrl };
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
