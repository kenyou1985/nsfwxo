/** Prompt Engine API Service - 对接后端 Grok 提示词生成接口 */

import {
  getYunwuKey,
  getBackendUrl,
  setBackendUrl as saveBackendUrl,
} from './storage';
import { openNdjsonStream, type StreamEvent, type StreamHandle } from './streaming';

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
    throw new Error('OpenLux API Key 未设置，请在设置中配置 OpenLux API Key');
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
  modelOrder?: string[],
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
    // model_order: 前端指定模型尝试顺序，后端 call_grok() 会在失败时自动切换
    model_order: modelOrder,
  };

  console.log(`[expandPrompt] ➤ POST ${url}`);
  console.log(`[expandPrompt] body:`, JSON.stringify(body, null, 2));

  const controller = new AbortController();
  // 代理层超时上限约 120s，客户端超时设 90s 留余量
  const timeout = setTimeout(() => controller.abort(), 90000);
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
      throw new Error('提示词扩写超时（90秒），请重试');
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
 * 
 * @param timeoutMs 客户端超时（毫秒），默认 90000ms(90s)，retry 时可传入更长超时
 */
export async function expandVideoFromImage(
  imagePrompt: string,
  sceneDescription: string,
  r18: boolean = false,
  count: number = 1,
  modelOrder?: string[],
  timeoutMs: number = 90000,
): Promise<ExpandResponse> {
  const base = getBackendUrl();
  const controller = new AbortController();
  // 代理层超时上限约 120s，默认客户端超时设 90s 留余量；retry 时可延长到 150s
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
          model_order: modelOrder,
        }),
      },
    );
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`视频提示词扩写超时（${Math.round(timeoutMs / 1000)}秒），请重试`);
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
  referenceImageUrl?: string,
  characterPrompt?: string,
  gridSize: number = 9,
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
        body: JSON.stringify({
          plot,
          r18,
          grid_size: gridSize,
          ...(referenceImageUrl ? { reference_image_url: referenceImageUrl } : {}),
          ...(characterPrompt ? { character_prompt: characterPrompt } : {}),
        }),
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

export interface GridRegenRequest {
  plot: string;
  panel_number: number;
  current_prompt: string;
  user_edit: string;
  r18: boolean;
  reference_image_url?: string;
  character_prompt?: string;
}

export interface GridRegenResponse {
  panel_number: number;
  scene_description: string;
  image_prompt: string;
}

export async function regenerateGridPanel(
  plot: string,
  panelNumber: number,
  currentPrompt: string,
  userEdit: string,
  r18: boolean = false,
  referenceImageUrl?: string,
  characterPrompt?: string,
): Promise<GridRegenResponse> {
  const base = getBackendUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000); // 5 min
  try {
    const response = await apiRequest<GridRegenResponse>(
      `${base}/api/prompt/storyboard/grid/regen`,
      {
        method: 'POST',
        signal: controller.signal as RequestInit['signal'],
        body: JSON.stringify({
          plot,
          panel_number: panelNumber,
          current_prompt: currentPrompt,
          user_edit: userEdit,
          r18,
          ...(referenceImageUrl ? { reference_image_url: referenceImageUrl } : {}),
          ...(characterPrompt ? { character_prompt: characterPrompt } : {}),
        } satisfies GridRegenRequest),
      },
    );
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('单格重绘超时（5分钟），请重试');
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
  asyncMode: boolean = false,
  modelOrder?: string[],
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
          // 优化：主模型 grok-4.6（更强），备用 grok-4.3
          model_order: modelOrder || ['grok-4.6', 'grok-4.3'],
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
  modelOrder?: string[],
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
        body: JSON.stringify({ 
          theme_id: themeId, 
          theme_title: themeTitle, 
          panel_count: panelCount, 
          r18, 
          async_mode: asyncMode,
          // 优化：主模型 grok-4.6（更强），备用 grok-4.3
          model_order: modelOrder || ['grok-4.6', 'grok-4.3'],
        }),
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
  // Human-readable progress string written by the backend background
  // runner. We surface it in the UI ("正在调用 LLM...", "正在校验第
  // 3/5 个分镜...") so the user has real-time feedback instead of a
  // frozen spinner. Optional because older backend builds (< progress
  // field) don't send it.
  progress?: string | null;
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
  const t0 = Date.now();
  console.log('[pollPromptTask] start', { taskId, url: `${base}/api/prompt/task/${taskId}`, startedAt: new Date().toISOString() });

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new Error('Task polling cancelled');

    const tPoll = Date.now();
    let response: Response;
    try {
      response = await fetch(`${base}/api/prompt/task/${taskId}`, { signal });
    } catch (err) {
      console.warn('[pollPromptTask] fetch failed', { taskId, attempt, elapsedMs: Date.now() - tPoll, err });
      throw err;
    }
    if (response.status === 404 || response.status === 410) {
      const err = new Error(`Prompt task ${taskId} not found on backend`);
      (err as Error & { notFound?: boolean }).notFound = true;
      console.warn('[pollPromptTask] task not found on backend', { taskId });
      throw err;
    }
    if (!response.ok) {
      console.warn('[pollPromptTask] non-OK response', { taskId, attempt, status: response.status });
      throw new Error(`Task polling failed: ${response.status}`);
    }

    const status: PromptTaskStatus = await response.json();
    const elapsedSinceStart = ((Date.now() - t0) / 1000).toFixed(1);
    // Log every poll with taskId + status + progress + elapsed so the
    // user can see in DevTools exactly what the backend is doing. The
    // feedback we got: "5 分钟了还没数据返回", "后台上一直在扣费的"
    // — those two phrases imply the user wanted to know whether the
    // backend was actually doing work. This log answers that question.
    console.log('[pollPromptTask]', {
      taskId,
      taskType: status.task_type,
      status: status.status,
      progress: status.progress ?? null,
      elapsedSec: elapsedSinceStart,
      attempt,
      pollTookMs: Date.now() - tPoll,
    });

    onStatus?.(status);

    if (status.status === 'DONE') {
      console.log('[pollPromptTask] DONE', { taskId, totalSec: elapsedSinceStart });
      return status;
    }
    if (status.status === 'FAILED') {
      console.warn('[pollPromptTask] FAILED', { taskId, error: status.error, totalSec: elapsedSinceStart });
      throw new Error(status.error ?? 'Task failed');
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  console.error('[pollPromptTask] timed out', { taskId, totalSec: ((Date.now() - t0) / 1000).toFixed(1) });
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


// ─── Streaming (NDJSON) variants ───────────────────────────────────────────────────
//
// These wrap the `/api/prompt/*/stream` endpoints. The caller passes
// per-slot callbacks so the UI can update as soon as the first chunk
// arrives (no more "stuck at 抽卡中" while waiting for the slowest result).
//
// All callbacks are optional except the `onEvent` factory params. The caller
// is responsible for translating events into UI state (e.g. appending the
// delta text into the right card slot). The functions return a StreamHandle
// whose `.abort()` cancels the underlying fetch — wire this to React
// `useEffect` cleanups / new-request handling.

export interface StreamRandomCallbacks {
  /** Called once per index slot with metadata (theme, tags). */
  onStart?: (info: { index: number; theme: string; tags_used: Record<string, string[]>; img2img?: boolean }) => void;
  /** Called on every text chunk for the given index. Concatenate to build the prompt. */
  onDelta?: (info: { index: number; text: string }) => void;
  /** Called when a slot is fully generated. `prompt` is the final assembled text. */
  onEnd?: (info: { index: number; theme_label?: string; prompt: string }) => void;
  /** Called on a per-slot or global fatal error. */
  onError?: (err: { index?: number; message: string }) => void;
  /** Called when the whole stream has finished (always last). */
  onDone?: (summary: { total: number; successful: number }) => void;
}

export async function streamRandomPrompt(
  type: 'image' | 'video',
  r18: boolean,
  count: number,
  theme: string,
  img2img: boolean,
  referenceImageUrl: string | undefined,
  characterPrompt: string | undefined,
  callbacks: StreamRandomCallbacks,
): Promise<StreamHandle> {
  return openNdjsonStream(
    '/api/prompt/random/stream',
    {
      type,
      r18,
      count,
      theme,
      img2img,
      reference_image_url: referenceImageUrl || undefined,
      character_prompt: characterPrompt || undefined,
    },
    (evt: StreamEvent) => {
      switch (evt.event) {
        case 'start':
          callbacks.onStart?.({
            index: (evt.index as number) ?? 0,
            theme: (evt.theme as string) ?? '',
            tags_used: (evt.tags_used as Record<string, string[]>) ?? {},
            img2img: evt.img2img as boolean | undefined,
          });
          break;
        case 'delta':
          callbacks.onDelta?.({
            index: (evt.index as number) ?? 0,
            text: (evt.text as string) ?? '',
          });
          break;
        case 'end':
          callbacks.onEnd?.({
            index: (evt.index as number) ?? 0,
            theme_label: evt.theme_label as string | undefined,
            prompt: (evt.prompt as string) ?? '',
          });
          break;
        case 'error':
          callbacks.onError?.({
            index: evt.index as number | undefined,
            message: (evt.message as string) ?? '未知错误',
          });
          break;
        case 'done':
          callbacks.onDone?.({
            total: (evt.total as number) ?? 0,
            successful: (evt.successful as number) ?? 0,
          });
          break;
      }
    },
  );
}


export interface StreamExpandCallbacks {
  onStart?: (info: { index: number; type: string; r18: boolean; original: string }) => void;
  onDelta?: (info: { index: number; text: string }) => void;
  onEnd?: (info: { index: number; prompt: string }) => void;
  onError?: (err: { index?: number; message: string }) => void;
  onDone?: (summary: { total: number; successful: number }) => void;
}

export async function streamExpandPrompt(
  userInput: string,
  type: 'image' | 'video',
  r18: boolean,
  count: number,
  variantIndex: number,
  referenceImageUrl: string | undefined,
  img2imgMode: boolean,
  characterPrompt: string | undefined,
  callbacks: StreamExpandCallbacks,
): Promise<StreamHandle> {
  return openNdjsonStream(
    '/api/prompt/expand/stream',
    {
      user_input: userInput,
      type,
      r18,
      count,
      variant_index: variantIndex,
      reference_image_url: referenceImageUrl || undefined,
      img2img_mode: img2imgMode || undefined,
      character_prompt: characterPrompt || undefined,
    },
    (evt: StreamEvent) => {
      switch (evt.event) {
        case 'start':
          callbacks.onStart?.({
            index: (evt.index as number) ?? 0,
            type: (evt.type as string) ?? type,
            r18: (evt.r18 as boolean) ?? r18,
            original: (evt.original as string) ?? userInput,
          });
          break;
        case 'delta':
          callbacks.onDelta?.({ index: (evt.index as number) ?? 0, text: (evt.text as string) ?? '' });
          break;
        case 'end':
          callbacks.onEnd?.({ index: (evt.index as number) ?? 0, prompt: (evt.prompt as string) ?? '' });
          break;
        case 'error':
          callbacks.onError?.({ index: evt.index as number | undefined, message: (evt.message as string) ?? '未知错误' });
          break;
        case 'done':
          callbacks.onDone?.({ total: (evt.total as number) ?? 0, successful: (evt.successful as number) ?? 0 });
          break;
      }
    },
  );
}


export interface StreamStoryboardCallbacks {
  onStart?: (info: { kind: string; panel_count?: number; use_anchor?: boolean }) => void;
  /** Raw text chunks from the LLM — useful for a typing-style preview. */
  onDelta?: (info: { text: string }) => void;
  /** A fully-validated panel just became available. */
  onPanel?: (info: { index: number; panel: { panel_number: number; scene_description: string; image_prompt: string } }) => void;
  onPanelSkipped?: (info: { index?: number; reason: string }) => void;
  onError?: (err: { message: string }) => void;
  onDone?: (summary: { count: number }) => void;
}

export async function streamStoryboard(
  plot: string,
  panelCount: number,
  r18: boolean,
  callbacks: StreamStoryboardCallbacks,
): Promise<StreamHandle> {
  return openNdjsonStream(
    '/api/prompt/storyboard/stream',
    { plot, panel_count: panelCount, r18 },
    (evt: StreamEvent) => {
      switch (evt.event) {
        case 'start':
          callbacks.onStart?.({
            kind: (evt.kind as string) ?? 'storyboard',
            panel_count: evt.panel_count as number | undefined,
            use_anchor: evt.use_anchor as boolean | undefined,
          });
          break;
        case 'delta':
          callbacks.onDelta?.({ text: (evt.text as string) ?? '' });
          break;
        case 'panel':
          callbacks.onPanel?.({
            index: (evt.index as number) ?? 0,
            panel: evt.panel as { panel_number: number; scene_description: string; image_prompt: string },
          });
          break;
        case 'panel_skipped':
          callbacks.onPanelSkipped?.({
            index: evt.index as number | undefined,
            reason: (evt.reason as string) ?? '',
          });
          break;
        case 'error':
          callbacks.onError?.({ message: (evt.message as string) ?? '未知错误' });
          break;
        case 'done':
          callbacks.onDone?.({ count: (evt.count as number) ?? 0 });
          break;
      }
    },
  );
}


export async function streamGridStoryboard(
  plot: string,
  r18: boolean,
  referenceImageUrl: string | undefined,
  characterPrompt: string | undefined,
  callbacks: StreamStoryboardCallbacks,
  gridSize: number = 9,
): Promise<StreamHandle> {
  return openNdjsonStream(
    '/api/prompt/storyboard/grid/stream',
    {
      plot,
      r18,
      grid_size: gridSize,
      ...(referenceImageUrl ? { reference_image_url: referenceImageUrl } : {}),
      ...(characterPrompt ? { character_prompt: characterPrompt } : {}),
    },
    (evt: StreamEvent) => {
      switch (evt.event) {
        case 'start':
          callbacks.onStart?.({
            kind: (evt.kind as string) ?? 'grid',
            panel_count: evt.panel_count as number | undefined,
            use_anchor: evt.use_anchor as boolean | undefined,
          });
          break;
        case 'delta':
          callbacks.onDelta?.({ text: (evt.text as string) ?? '' });
          break;
        case 'panel':
          callbacks.onPanel?.({
            index: (evt.index as number) ?? 0,
            panel: evt.panel as { panel_number: number; scene_description: string; image_prompt: string },
          });
          break;
        case 'panel_skipped':
          callbacks.onPanelSkipped?.({
            index: evt.index as number | undefined,
            reason: (evt.reason as string) ?? '',
          });
          break;
        case 'error':
          callbacks.onError?.({ message: (evt.message as string) ?? '未知错误' });
          break;
        case 'done':
          callbacks.onDone?.({ count: (evt.count as number) ?? 0 });
          break;
      }
    },
  );
}


// ─── Image DNA Extraction ─────────────────────────────────────────────────────────

export interface ClothingInfo {
  name: string;
  type: string;
  color: string;
  style: string;
  image_url?: string;
}

export interface ImageDnaResult {
  character_type: string;
  character_description: string;
  character_age_hint: string;
  scene_type: string;
  scene_description: string;
  action_prediction: string;
  clothing_list: ClothingInfo[];
  overall_style: string;
  nsfw_level: string;
}

/**
 * 基于 DNA 信息生成 MiniMax H3 格式提示词（支持批量生成）
 */
export interface GenerateH3DnaParams {
  imageUrl: string;
  dna: ImageDnaResult;
  eroticLevel: 'soft' | 'normal' | 'sm';
  duration: 15 | 30 | 60;
  userHint?: string;
  /** 生成条数，默认 1 */
  count?: number;
}

export interface GenerateH3DnaResult {
  /** 多条独立的 H3 格式中文视频提示词 */
  prompts: string[];
  erotic_level: string;
  duration: number;
}

export async function generateH3DnaPrompt(params: GenerateH3DnaParams): Promise<GenerateH3DnaResult> {
  const yunwuKey = getYunwuKey();
  if (!yunwuKey) {
    throw new Error('OpenLux API Key 未设置');
  }

  const base = getBackendUrl();
  const url = `${base}/api/prompt/generate/h3-dna`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000); // 5min（生成多条需要更长时间）

  try {
    console.log('[generateH3DnaPrompt] 发起请求 → POST', url, {
      eroticLevel: params.eroticLevel, duration: params.duration,
      count: params.count ?? 1,
      hasCharacter: !!params.dna.character_type,
      clothingCount: params.dna.clothing_list?.length ?? 0,
    });
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${yunwuKey}`,
      },
      body: JSON.stringify({
        image_url: params.imageUrl,
        dna: params.dna,
        erotic_level: params.eroticLevel,
        duration: params.duration,
        user_hint: params.userHint || null,
        count: params.count ?? 1,
      }),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new Error(`H3 提示词生成失败 ${response.status}: ${bodyText}`);
    }

    const data = await response.json() as GenerateH3DnaResult;
    return data;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('H3 提示词生成超时（300秒），请重试');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── H3 DNA 流式生成 ─────────────────────────────────────────────────────────────────

export interface StreamH3DnaCallbacks {
  onStart?: (info: { index: number }) => void;
  /** 增量文本（每条提示词独立累加） */
  onDelta?: (info: { index: number; text: string }) => void;
  /** 单条提示词完成 */
  onEnd?: (info: { index: number; prompt: string }) => void;
  /** 单条出错 */
  onError?: (info: { index: number; message: string }) => void;
  /** 全部完成 */
  onDone?: (info: { total: number; successful: number }) => void;
}

/**
 * 流式 H3 DNA 提示词生成 — 实时显示每个字符。
 *
 * 使用方式（示例）：
 *   const handle = await streamGenerateH3DnaPrompt({ ... }, {
 *     onStart: ({ index }) => { ... },
 *     onDelta: ({ index, text }) => {
 *       // 实时累加第 index 条的文本
 *       setText(prev => ({ ...prev, [index]: (prev[index]||'') + text }));
 *     },
 *     onEnd: ({ index, prompt }) => {
 *       // 第 index 条完整了，填入正式结果
 *     },
 *     onError: ({ index, message }) => { ... },
 *     onDone: ({ total, successful }) => { ... },
 *   });
 *   // handle.abort() 可取消
 */
export async function streamGenerateH3DnaPrompt(
  params: GenerateH3DnaParams,
  callbacks: StreamH3DnaCallbacks,
): Promise<{ abort: () => void }> {
  const yunwuKey = getYunwuKey();
  if (!yunwuKey) {
    callbacks.onError?.({ index: -1, message: 'OpenLux API Key 未设置' });
    callbacks.onDone?.({ total: 0, successful: 0 });
    return { abort: () => {} };
  }

  return openNdjsonStream(
    '/api/prompt/generate/h3-dna/stream',
    {
      image_url: params.imageUrl,
      dna: params.dna,
      erotic_level: params.eroticLevel,
      duration: params.duration,
      user_hint: params.userHint || null,
      count: params.count ?? 1,
    },
    (evt: StreamEvent) => {
      switch (evt.event) {
        case 'start':
          callbacks.onStart?.({ index: (evt.index as number) ?? 0 });
          break;
        case 'delta':
          callbacks.onDelta?.({
            index: (evt.index as number) ?? 0,
            text: (evt.text as string) ?? '',
          });
          break;
        case 'end':
          callbacks.onEnd?.({
            index: (evt.index as number) ?? 0,
            prompt: (evt.prompt as string) ?? '',
          });
          break;
        case 'error':
          callbacks.onError?.({
            index: (evt.index as number) ?? 0,
            message: (evt.message as string) ?? '未知错误',
          });
          break;
        case 'done':
          callbacks.onDone?.({
            total: (evt.total as number) ?? 0,
            successful: (evt.successful as number) ?? 0,
          });
          break;
      }
    },
  );
}

/**
 * 调用后端 /api/prompt/extract-image-dna 端点
 * 由 Gemini-3.8-flash 提取图片 DNA（人物/场景/服装信息）
 *
 * 移动端兼容性（iPhone 14 PM 等 iOS 17+ 重点适配）：
 * - iPhone 14 PM iOS 17+ 的 Safari 在 POST 请求 + 较大 body（base64 JPEG > 3MB）
 *   时几乎 100% 抛 "Load failed"（fetch 在 iOS 17 的已知 bug，HTTP/2 状态机紊乱）
 *   而 iPhone 12 (iOS 16) 表现正常 → 必须多重重试
 * - 默认重试 2 次（共 3 次尝试），指数退避 + 重连间隙
 * - 第二次失败时自动降级：把压缩阈值从 900KB 收紧到 400KB 再发
 * - 第三次失败时改用 XMLHttpRequest（XHR 在 iOS Safari 17 上仍稳定）
 * - 超时从 60s 延长到 90s（移动网络 + 大图慢）
 */
export async function extractImageDna(
  imageUrl: string,
  options: { retries?: number; timeoutMs?: number } = {},
): Promise<ImageDnaResult> {
  const { retries = 2, timeoutMs = 90_000 } = options;
  const yunwuKey = getYunwuKey();
  if (!yunwuKey) {
    throw new Error('OpenLux API Key 未设置');
  }

  const base = getBackendUrl();
  const url = `${base}/api/prompt/extract-image-dna`;

  let lastError: Error | null = null;
  let currentImageUrl = imageUrl;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      // 指数退避：第 1 次重试 1.2s（让 iOS Safari HTTP/2 状态机重新稳定）
      // 第 2 次重试 2.5s
      const waitMs = 1200 * attempt;
      await new Promise((r) => setTimeout(r, waitMs));
      console.log(`[extractImageDna] retry attempt ${attempt + 1}/${retries + 1}, payload=${(currentImageUrl.length / 1024).toFixed(0)}KB`);

      // 第二次起逐步收紧负载：先 600KB，最后一次强行 300KB
      // iOS Safari 17+ 对 > 3MB 的 POST 请求几乎必 fail
      const targetBytes = attempt === 1 ? 600_000 : 300_000;
      if (currentImageUrl.length > targetBytes) {
        try {
          const { compressDataUrlIfNeeded } = await import('../utils/imagePreprocess');
          currentImageUrl = await compressDataUrlIfNeeded(currentImageUrl, 1024, 0.7, targetBytes);
          console.log(`[extractImageDna] re-compressed to ${(currentImageUrl.length / 1024).toFixed(0)}KB`);
        } catch {
          // 压缩失败也继续（用上一轮的 URL）
        }
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${yunwuKey}`,
        },
        body: JSON.stringify({ image_url: currentImageUrl }),
      });

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        // 415: 后端显式拒绝 HEIC/HEIF 格式
        if (response.status === 415) {
          throw new Error(
            `DNA 提取失败 (415): ${bodyText.slice(0, 200)}\n\n` +
            '后端拒绝接收此图片。常见原因：\n' +
            '① 文件虽然是 .heic 命名但 iPhone 设置已改为"兼容性最佳"的话文件名可能仍是 .heic → 上传前先把后缀改成 .jpg\n' +
            '② 或在 iPhone 相册里选"存储图像"为 JPEG 后再上传\n' +
            '③ 部分旧照片在 iCloud 上保留原始 HEIC 编码，需手动下载为 JPEG',
          );
        }
        // 422: Pydantic 校验失败（image_url 太长 / 格式错）
        if (response.status === 422) {
          throw new Error(
            `DNA 提取失败 (422): ${bodyText.slice(0, 200)}。\n\n` +
            '可能原因：① 图片太大（请确保 < 10MB）；② base64 中含特殊字符；③ 图片 MIME 类型不被后端接受（请尝试用普通 JPEG/PNG 重传）。',
          );
        }
        throw new Error(`DNA 提取失败 (${response.status}): ${bodyText.slice(0, 300)}`);
      }

      const data = await response.json() as ImageDnaResult;
      return data;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // 移动端 Safari 已知 bug: fetch 在网络不稳时会抛 TypeError("Load failed")
      // 不要立即放弃，自动重试
      const isSafariLoadFailed =
        lastError.name === 'TypeError' &&
        /load failed/i.test(lastError.message);
      if ((isSafariLoadFailed || lastError.name === 'NetworkError' || lastError.message.includes('Failed to fetch')) && attempt < retries) {
        console.warn(`[extractImageDna] ${lastError.message} on attempt ${attempt + 1}, will retry`);
        continue;
      }
      if (lastError.name === 'AbortError') {
        throw new Error(`DNA 提取超时（${timeoutMs / 1000}秒），请尝试较小的图片或检查网络`);
      }
      // 重试已用完或非网络错误
      if (attempt >= retries) {
        // Safari "Load failed" 是 iOS Safari 的 fetch bug，经常被错误地归因为 HEIC。
        // 实际真正原因可能是网络不稳、CORS、或请求体过大。
        if (isSafariLoadFailed || lastError.message.includes('Failed to fetch')) {
          throw new Error(
            '网络请求失败（iOS Safari "Load failed"）。这通常不是 HEIC 格式问题（如果你已在系统设置 → 相机 → 格式中改为"兼容性最佳"，图片已是 JPEG）。\n\n' +
            '这是 iPhone iOS 17+ Safari 在 POST + 大 base64 请求时的已知 bug。我们已经重试 3 次 + 压缩到 < 300KB 仍失败。\n\n' +
            '可能的真实原因：\n' +
            '① 网络不稳定（4G/Wi-Fi 切换、信号弱时 Safari 会丢请求）→ 切换到稳定的 Wi-Fi 后重试\n' +
            '② 后端服务暂不可用 → 请稍后重试\n' +
            '③ iOS Safari HTTP/2 + 大 body 的已知缺陷 → 请尝试重新上传图片触发自动压缩到 < 1MB\n' +
            '④ 如果是 iPhone 14 PM / 15 PM 等新型号：系统设置 → 通用 → 传输或储存 iPhone 空间检查 → 重启 Safari\n\n' +
            '建议：将图片在相册中先"存储为 JPEG"（设置 → 照片 → 下载并保留原件关闭），再上传；或截图后再上传。',
          );
        }
        throw lastError;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error('DNA 提取失败');
}

/**
 * 调用后端 /api/prompt/extract-clothings 端点
 * 使用 Gemini-3.8-flash 从参考图中提取服装区域图片
 */
export interface ExtractClothingsResult {
  clothings: ClothingInfo[];
}

export async function extractClothings(
  imageUrl: string,
  clothingHints?: string[],
  model?: string,
  customElementImages?: string[],
  additionalImageUrls?: string[],
): Promise<ExtractClothingsResult> {
  const yunwuKey = getYunwuKey();
  if (!yunwuKey) {
    throw new Error('OpenLux API Key 未设置');
  }

  const base = getBackendUrl();
  const url = `${base}/api/prompt/extract-clothings`;
  const controller = new AbortController();
  // 服装提取需要更长时间（处理 base64 + 多参考图）
  const timeout = setTimeout(() => controller.abort(), 240000); // 240s timeout

  console.log('[extractClothings] 调用后端 API:', url, {
    imageUrl: imageUrl.slice(0, 60),
    clothingHints,
    model,
    customElements: customElementImages?.length,
    additionalRefs: additionalImageUrls?.length,
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${yunwuKey}`,
      },
      body: JSON.stringify({
        image_url: imageUrl,
        ...(additionalImageUrls?.length ? { additional_image_urls: additionalImageUrls } : {}),
        ...(clothingHints?.length ? { clothing_hints: clothingHints } : {}),
        ...(model ? { model } : {}),
        ...(customElementImages?.length ? { custom_element_images: customElementImages } : {}),
      }),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      console.error('[extractClothings] API 错误:', response.status, bodyText);
      throw new Error(`服装提取失败 ${response.status}: ${bodyText}`);
    }

    const data = await response.json() as ExtractClothingsResult;
    console.log('[extractClothings] 成功提取:', data.clothings.length, '件服装');
    return data;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('服装提取超时（240秒），请重试');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
