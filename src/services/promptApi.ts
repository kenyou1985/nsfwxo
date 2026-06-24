/** Prompt Engine API Service - 对接后端 Grok 提示词生成接口 */

import {
  getYunwuKey,
  getBackendUrl,
  setBackendUrl as saveBackendUrl,
} from './storage';

export interface ExpandRequest {
  user_input: string;
  type: 'image' | 'video';
  r18: boolean;
  count: number;
  variant_index?: number;
  reference_image_url?: string;
  img2img_mode?: boolean;
  character_prompt?: string;
}

export interface ExpandResult {
  original: string;
  type: string;
  r18: boolean;
  prompt: string;
}

export interface ExpandResponse {
  results: ExpandResult[];
}

export interface PromptResult {
  theme_label: string;
  theme: string;
  tags_used: Record<string, string[]>;
  prompt: string;
}

export interface RandomRequest {
  type: 'image' | 'video';
  r18: boolean;
  count: number;
  theme: string;
  img2img?: boolean;
  reference_image_url?: string;
  character_prompt?: string;
}

export interface RandomResponse {
  results: PromptResult[];
}

export interface StoryboardRequest {
  plot: string;
  panel_count: number;
  r18: boolean;
}

export interface StoryboardPanel {
  panel_number: number;
  scene_description: string;
  image_prompt: string;
}

export interface StoryboardResponse {
  storyboard: StoryboardPanel[];
}

export interface StoryboardThemeOption {
  id: number;
  title: string;
  description: string;
  tags: string[];
  r18_level: string;
  category?: string;
  scenario_count?: number;
  costume_count?: number;
}

export interface StoryboardThemesResponse {
  task_id?: string;
  themes: StoryboardThemeOption[];
}

export interface StoryboardOutline {
  arc: string;
  scenes: string[];
}

export interface StoryboardOutlineResponse {
  task_id?: string;
  theme_id: number;
  theme_title: string;
  outline: StoryboardOutline;
  storyboard: StoryboardPanel[];
}

export interface VideoScriptPanel {
  panel: number;
  heading: string;
  action: string;
  dialogue: string;
  sound_cue: string;
  camera: string;
}

export interface StoryboardScriptResponse {
  task_id?: string;
  theme_title: string;
  script_title: string;
  duration: string;
  panels: VideoScriptPanel[];
}

export interface StoryboardScriptRequest {
  theme_title: string;
  r18: boolean;
  panels: StoryboardPanel[];
}

async function apiRequest<T>(
  url: string,
  options: RequestInit,
  _retries = 2,
): Promise<T> {
  const yunwuKey = getYunwuKey();
  if (!yunwuKey) {
    throw new Error('Yunwu AI API Key 未设置，请在设置中配置 Yunwu AI Key');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${yunwuKey}`,
    ...(options.headers as Record<string, string>),
  };

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= _retries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (response.ok) {
        const data = await response.json() as T;
        return data;
      }

      const bodyText = await response.text().catch(() => '(no body)');
      const status = response.status;

      // Retry on 429 (rate limit) and 502 (bad gateway)
      const isRetryable = status === 429 || status === 502 || status === 503 || status === 504;
      if (isRetryable && attempt < _retries) {
        lastError = new Error(`HTTP ${status}: ${response.statusText} - ${bodyText}`);
        continue;
      }

      throw new Error(`HTTP ${status}: ${response.statusText} - ${bodyText}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isNetworkRetry =
        lastError.message.includes('Failed to fetch') ||
        lastError.message.includes('network') ||
        lastError.message.includes('ERR_');
      if (isNetworkRetry && attempt < _retries) {
        continue;
      }
      if (attempt < _retries) {
        continue;
      }
    }
  }
  throw lastError ?? new Error('请求失败');
}

export async function expandPrompt(
  userInput: string,
  type: 'image' | 'video',
  r18: boolean = false,
  count: number = 5,
  variantIndex: number = 0,
  referenceImageUrl?: string,
  img2imgMode: boolean = false,
  characterPrompt?: string,
): Promise<ExpandResponse> {
  const base = getBackendUrl();
  const url = `${base}/api/prompt/expand`;
  const body = {
    user_input: userInput,
    type,
    r18,
    count,
    variant_index: variantIndex,
    reference_image_url: referenceImageUrl || undefined,
    img2img_mode: img2imgMode || undefined,
    character_prompt: characterPrompt || undefined,
  };

  console.log(`[expandPrompt] ➤ POST ${url}`);
  console.log(`[expandPrompt] body:`, JSON.stringify(body, null, 2));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000); // 5 min
  try {
    const response = await apiRequest<ExpandResponse>(
      url,
      {
        method: 'POST',
        signal: controller.signal as RequestInit['signal'],
        body: JSON.stringify(body satisfies ExpandRequest),
      },
    );
    console.log(`[expandPrompt] ✔ response:`, response);
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('提示词扩写超时（5分钟），请重试');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Image-to-video (Wan2.2) 专用扩写。后端用 wan2.2 i2v system prompt，
 * 强制只输出人物动作 / 镜头 / 表情，不输出场景、背景、外观。
 * image_prompt 是"画面锚"（不要在输出中复述），scene_description 是
 * 用户希望看到的动作/镜头描述（要被扩写）。
 */
export async function expandVideoFromImage(
  imagePrompt: string,
  sceneDescription: string,
  r18: boolean = false,
  count: number = 1,
): Promise<ExpandResponse> {
  const base = getBackendUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000); // 5 min
  try {
    const response = await apiRequest<ExpandResponse>(
      `${base}/api/prompt/expand/video-from-image`,
      {
        method: 'POST',
        signal: controller.signal as RequestInit['signal'],
        body: JSON.stringify({
          image_prompt: imagePrompt,
          scene_description: sceneDescription || undefined,
          r18,
          count,
        }),
      },
    );
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('动画提示词扩写超时（5分钟），请重试');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function randomPrompt(
  type: 'image' | 'video',
  r18: boolean = false,
  count: number = 5,
  theme: string = '',
  img2img: boolean = false,
  reference_image_url?: string,
  characterPrompt?: string,
): Promise<RandomResponse> {
  const base = getBackendUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000); // 5 min
  try {
    const response = await apiRequest<RandomResponse>(
      `${base}/api/prompt/random`,
      {
        method: 'POST',
        signal: controller.signal as RequestInit['signal'],
        body: JSON.stringify({ type, r18, count, theme, img2img, reference_image_url: reference_image_url || undefined, character_prompt: characterPrompt || undefined } satisfies RandomRequest),
      },
    );
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('随机提示词生成超时（5分钟），请重试');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateStoryboard(
  plot: string,
  panelCount: number,
  r18: boolean = false,
): Promise<StoryboardResponse> {
  const base = getBackendUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000); // 5 min
  try {
    const response = await apiRequest<StoryboardResponse>(
      `${base}/api/prompt/storyboard`,
      {
        method: 'POST',
        signal: controller.signal as RequestInit['signal'],
        body: JSON.stringify({ plot, panel_count: panelCount, r18 } satisfies StoryboardRequest),
      },
    );
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('剧情分镜生成超时（5分钟），请重试');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export interface GridPanel {
  panel_number: number;
  scene_description: string;
  image_prompt: string;
}

export interface GridStoryboardResponse {
  grid: GridPanel[];
}

export async function generateGridStoryboard(
  plot: string,
  r18: boolean = false,
): Promise<GridStoryboardResponse> {
  const base = getBackendUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000); // 5 min
  try {
    const response = await apiRequest<GridStoryboardResponse>(
      `${base}/api/prompt/storyboard/grid`,
      {
        method: 'POST',
        signal: controller.signal as RequestInit['signal'],
        body: JSON.stringify({ plot, r18 }),
      },
    );
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('九宫格分镜生成超时（5分钟），请重试');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateStoryboardThemes(
  r18: boolean = false,
  count: number = 10,
  customDescription?: string,
  asyncMode: boolean = false
): Promise<StoryboardThemesResponse> {
  const base = getBackendUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000);
  try {
    const response = await apiRequest<StoryboardThemesResponse>(
      `${base}/api/prompt/storyboard/themes`,
      {
        method: 'POST',
        signal: controller.signal as RequestInit['signal'],
        body: JSON.stringify({
          r18,
          count,
          ...(customDescription ? { custom_description: customDescription } : {}),
          async_mode: asyncMode,
        }),
      },
    );
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('主题生成超时（5分钟），请重试');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function listStoryboardThemes(): Promise<StoryboardThemesResponse> {
  const base = getBackendUrl();
  const response = await apiRequest<StoryboardThemesResponse>(
    `${base}/api/prompt/storyboard/themes/list`,
    { method: 'GET' },
  );
  return response;
}

export async function generateStoryboardOutline(
  themeId: number,
  themeTitle: string,
  panelCount: number,
  r18: boolean = false,
  asyncMode: boolean = false,
): Promise<StoryboardOutlineResponse> {
  const base = getBackendUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000);
  try {
    const response = await apiRequest<StoryboardOutlineResponse>(
      `${base}/api/prompt/storyboard/outline`,
      {
        method: 'POST',
        signal: controller.signal as RequestInit['signal'],
        body: JSON.stringify({ theme_id: themeId, theme_title: themeTitle, panel_count: panelCount, r18, async_mode: asyncMode }),
      },
    );
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('大纲生成超时（5分钟），请重试');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateVideoScript(
  themeTitle: string,
  r18: boolean,
  panels: { panel_number: number; scene_description: string; image_prompt: string }[],
  asyncMode: boolean = false,
  modelOrder?: string[],
): Promise<StoryboardScriptResponse> {
  const base = getBackendUrl();
  const url = `${base}/api/prompt/storyboard/script`;
  const requestBody = {
    theme_title: themeTitle,
    r18,
    panels: panels.map(p => ({
      panel_number: p.panel_number,
      scene_description: p.scene_description,
      image_prompt: p.image_prompt,
    })),
    async_mode: asyncMode,
    // model_order: frontend tells backend which LLM to try first,
    // and what to fall back to on failure. Backend's call_grok()
    // implements model-level fallback: any failure (timeout, 5xx,
    // content refusal) on the primary model automatically retries
    // with the next one in the list.
    model_order: modelOrder,
  };
  const startTs = Date.now();
  console.log('[generateVideoScript] → POST', url, {
    panelCount: panels.length,
    panelNumbers: panels.map(p => p.panel_number),
    asyncMode,
    modelOrder,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000);
  try {
    const response = await apiRequest<StoryboardScriptResponse>(
      url,
      {
        method: 'POST',
        signal: controller.signal as RequestInit['signal'],
        body: JSON.stringify(requestBody),
      },
    );
    console.log('[generateVideoScript] ← OK', {
      elapsedMs: Date.now() - startTs,
      taskId: response.task_id ?? null,
      panelsCount: response.panels?.length ?? 0,
      scriptTitle: response.script_title,
      duration: response.duration,
    });
    return response;
  } catch (err) {
    console.error('[generateVideoScript] ← FAIL', {
      elapsedMs: Date.now() - startTs,
      errorName: err instanceof Error ? err.name : String(err),
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('视频脚本生成超时（5分钟），请重试');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Async Task Polling ─────────────────────────────────────────────────────────

export interface PromptTaskStatus {
  task_id: string;
  task_type: 'themes' | 'outline' | 'script';
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  result: {
    theme_id?: number;
    themes?: Array<{ id: number; title: string; description: string; tags: string[]; r18_level: string; category: string; scenario_count: number; costume_count: number }>;
    outline?: { arc: string; scenes: string[] };
    storyboard?: Array<{ panel_number: number; scene_description: string; image_prompt: string }>;
    theme_title?: string;
    script_title?: string;
    duration?: string;
    panels?: Array<{ panel: number; heading: string; action: string; dialogue: string; sound_cue: string; camera: string }>;
  } | null;
  error: string | null;
}

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 150;

export async function pollPromptTask(
  taskId: string,
  onStatus?: (status: PromptTaskStatus) => void,
  signal?: AbortSignal,
): Promise<PromptTaskStatus> {
  const base = getBackendUrl();
  console.log('[pollPromptTask] polling task:', taskId, 'at:', `${base}/api/prompt/task/${taskId}`);

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new Error('Task polling cancelled');

    const response = await fetch(`${base}/api/prompt/task/${taskId}`, { signal });
    if (response.status === 404 || response.status === 410) {
      // Task no longer exists on the backend (e.g. server restart, cache
      // eviction). Signal this with a typed error so the caller can drop
      // the taskId from the pending queue rather than polling forever.
      const err = new Error(`Prompt task ${taskId} not found on backend`);
      (err as Error & { notFound?: boolean }).notFound = true;
      throw err;
    }
    if (!response.ok) {
      throw new Error(`Task polling failed: ${response.status}`);
    }

    const status: PromptTaskStatus = await response.json();
    onStatus?.(status);

    if (status.status === 'DONE') return status;
    if (status.status === 'FAILED') throw new Error(status.error ?? 'Task failed');

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error('Task polling timed out after 5 minutes');
}

// Non-blocking status check (used for parallel restore without incrementing poll attempts)
export async function getPromptTaskStatus(taskId: string): Promise<PromptTaskStatus> {
  const base = getBackendUrl();
  const response = await fetch(`${base}/api/prompt/task/${taskId}`);
  if (response.status === 404 || response.status === 410) {
    const err = new Error(`Prompt task ${taskId} not found on backend`);
    (err as Error & { notFound?: boolean }).notFound = true;
    throw err;
  }
  if (!response.ok) throw new Error(`Task status fetch failed: ${response.status}`);
  return response.json() as Promise<PromptTaskStatus>;
}
