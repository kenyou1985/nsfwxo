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
  count: number = 5,
  variantIndex: number = 0,
  referenceImageUrl?: string,
  img2imgMode: boolean = false,
  characterPrompt?: string,
): Promise<ExpandResponse> {
  const base = getBackendUrl();
  const response = await apiRequest<ExpandResponse>(
    `${base}/api/prompt/expand`,
    {
      method: 'POST',
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
  const response = await apiRequest<RandomResponse>(
    `${base}/api/prompt/random`,
    {
      method: 'POST',
      body: JSON.stringify({ type, r18, count, theme, img2img, reference_image_url: reference_image_url || undefined, character_prompt: characterPrompt || undefined } satisfies RandomRequest),
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
