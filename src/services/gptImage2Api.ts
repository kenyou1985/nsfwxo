import type { GirlfriendPreset } from '../data/girlfriendPresets';

const YUNWU_BASE = 'https://yunwu.ai/v1';

export type GptImageQuality = 'low' | 'medium' | 'high';
export type GptImageSize = '1024x1024' | '1536x1024' | '1024x1536' | 'auto';

export interface GptImageResult {
  url: string;
  revisedPrompt?: string;
}

interface ImageGenResponse {
  created: number;
  data: Array<{ url?: string; b64_json?: string }>;
}

interface ImageEditResponse {
  created: number;
  data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
}

function buildHeaders(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => '(no body)');
    throw new Error(`HTTP ${res.status}: ${res.statusText} — ${body}`);
  }
  return res.json() as Promise<T>;
}

/** Text-to-image generation via GPT Image 2 */
export async function generateImage(
  apiKey: string,
  prompt: string,
  {
    n = 1,
    size = '1024x1024',
    quality = 'medium',
  }: { n?: number; size?: GptImageSize; quality?: GptImageQuality } = {}
): Promise<GptImageResult[]> {
  const res = await fetch(`${YUNWU_BASE}/images/generations`, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify({ model: 'gpt-image-2', prompt, n, size, quality }),
  });

  const data = await parseResponse<ImageGenResponse>(res);

  return data.data.map((item) => {
    if (item.b64_json) {
      return { url: `data:image/png;base64,${item.b64_json}` };
    }
    if (item.url) {
      return { url: item.url };
    }
    return { url: '' };
  });
}

/** Image-to-image (edit) via GPT Image 2 */
export async function editImage(
  apiKey: string,
  prompt: string,
  imageFile: File,
  {
    n = 1,
    size = '1024x1024',
    quality = 'medium',
    maskFile,
  }: {
    n?: number;
    size?: GptImageSize;
    quality?: GptImageQuality;
    maskFile?: File;
  } = {}
): Promise<GptImageResult[]> {
  const form = new FormData();
  form.append('model', 'gpt-image-2');
  form.append('prompt', prompt);
  form.append('n', String(n));
  form.append('size', size);
  form.append('quality', quality);
  form.append('image', imageFile);
  if (maskFile) {
    form.append('mask', maskFile);
  }

  const res = await fetch(`${YUNWU_BASE}/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  const data = await parseResponse<ImageEditResponse>(res);

  return data.data.map((item) => {
    if (item.b64_json) {
      return { url: `data:image/png;base64,${item.b64_json}`, revisedPrompt: item.revised_prompt };
    }
    if (item.url) {
      return { url: item.url, revisedPrompt: item.revised_prompt };
    }
    return { url: '', revisedPrompt: item.revised_prompt };
  });
}

/** 将 GirlfriendPreset 的 portraitUrl 转成 File */
export async function girlfriendToFile(gf: GirlfriendPreset): Promise<File> {
  const res = await fetch(gf.portraitUrl);
  const blob = await res.blob();
  return new File([blob], `${gf.id}.jpg`, { type: blob.type || 'image/jpeg' });
}
