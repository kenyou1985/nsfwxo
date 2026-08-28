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
