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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000); // 5 min
  try {
    const response = await apiRequest<ExpandResponse>(
      `${base}/api/prompt/expand`,
      {
        method: 'POST',
        signal: controller.signal as RequestInit['signal'],
        body: JSON.stringify({
          user_input: userInput,
          type,
          r18,
          count,
          variant_index: variantIndex,
          reference_image_url: referenceImageUrl || undefined,
          img2img_mode: img2imgMode || undefined,
          character_prompt: characterPrompt || undefined,
        } satisfies ExpandRequest),
      },
    );
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
): Promise<StoryboardScriptResponse> {
  const base = getBackendUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000);
  try {
    const response = await apiRequest<StoryboardScriptResponse>(
      `${base}/api/prompt/storyboard/script`,
      {
        method: 'POST',
        signal: controller.signal as RequestInit['signal'],
        body: JSON.stringify({
          theme_title: themeTitle,
          r18,
          panels: panels.map(p => ({
            panel_number: p.panel_number,
            scene_description: p.scene_description,
            image_prompt: p.image_prompt,
          })),
          async_mode: asyncMode,
        }),
      },
    );
    return response;
  } catch (err) {
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
