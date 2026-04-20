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
}

export interface ExpandResponse {
  original: string;
  type: string;
  r18: boolean;
  prompt: string;
}

export interface RandomRequest {
  type: 'image' | 'video';
  r18: boolean;
}

export interface RandomResponse {
  tags_used: Record<string, string[]>;
  prompt: string;
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

async function apiRequest<T>(
  url: string,
  options: RequestInit,
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

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '(no body)');
    throw new Error(`HTTP ${response.status}: ${response.statusText} - ${bodyText}`);
  }

  const data = await response.json() as T;
  return data;
}

export async function expandPrompt(
  userInput: string,
  type: 'image' | 'video',
  r18: boolean = false,
): Promise<ExpandResponse> {
  const base = getBackendUrl();
  const response = await apiRequest<ExpandResponse>(
    `${base}/api/prompt/expand`,
    {
      method: 'POST',
      body: JSON.stringify({ user_input: userInput, type, r18 } satisfies ExpandRequest),
    },
  );
  return response;
}

export async function randomPrompt(
  type: 'image' | 'video',
  r18: boolean = false,
): Promise<RandomResponse> {
  const base = getBackendUrl();
  const response = await apiRequest<RandomResponse>(
    `${base}/api/prompt/random`,
    {
      method: 'POST',
      body: JSON.stringify({ type, r18 } satisfies RandomRequest),
    },
  );
  return response;
}

export async function generateStoryboard(
  plot: string,
  panelCount: number,
  r18: boolean = false,
): Promise<StoryboardResponse> {
  const base = getBackendUrl();
  const response = await apiRequest<StoryboardResponse>(
    `${base}/api/prompt/storyboard`,
    {
      method: 'POST',
      body: JSON.stringify({ plot, panel_count: panelCount, r18 } satisfies StoryboardRequest),
    },
  );
  return response;
}
