import type { GirlfriendPreset } from '../data/girlfriendPresets';

const YUNWU_BASE = 'https://yunwu.ai/v1';

export type GptImageQuality = 'low' | 'medium' | 'high';
/** gpt-image-2 支持任意尺寸（最大边 ≤ 3840px，两边 16 的倍数，比例 ≤ 3:1） */
export type GptImageSize = '1024x1024' | '1536x1024' | '1024x1536' | '1024x768' | '768x1024' | '1024x1792' | '1792x1024' | '1024x2048' | '2048x1024' | '2048x1152' | '1152x2048' | 'auto' | string;

export interface GptImageResult {
  url: string;
  revisedPrompt?: string;
  error?: string;
}

/** 解析 yunwu 返回的错误，映射为中文可读信息 */
function parseYunwuError(res: Response, bodyText: string): Error {
  let msg = bodyText;
  let code = '';

  try {
    const json = JSON.parse(bodyText);
    // OpenAI-compatible error shape
    if (json.error) {
      msg = json.error.message || json.error.msg || bodyText;
      code = json.error.type || json.error.code || '';
    } else if (json.message) {
      msg = json.message;
      code = json.code || '';
    } else {
      msg = bodyText;
    }
  } catch {
    // body is plain text, use as-is
  }

  // 通用 HTTP 状态映射
  if (res.status === 401) return new Error('API Key 无效或已过期，请检查设置中的 Yunwu AI Key');
  if (res.status === 403) return new Error('API Key 无权限，请确认账户状态');
  if (res.status === 429) return new Error('请求过于频繁，请稍后重试');

  // 关键词快速匹配
  const lower = msg.toLowerCase();
  if (lower.includes('quota') || lower.includes('insufficient') || lower.includes('余额') || lower.includes('credit') || lower.includes('配额') || lower.includes('limit'))
    return new Error('余额不足/配额耗尽，请前往 yunwu.ai 充值');
  if (lower.includes('timeout') || lower.includes('超时'))
    return new Error('请求超时，请稍后重试');
  if (lower.includes('rate limit') || lower.includes('速率限制') || lower.includes('too many request'))
    return new Error('触发了速率限制，请稍后重试');
  if (lower.includes('nsfw') || lower.includes('porn') || lower.includes('色情') || lower.includes('敏感') || lower.includes('prohibited') || lower.includes('禁止'))
    return new Error('内容被拦截（色情/暴力/敏感），请修改提示词后重试');
  if (lower.includes('safety') || lower.includes('安全'))
    return new Error('内容安全拦截，请修改提示词后重试');
  if (lower.includes('resource') || lower.includes('资源不足') || lower.includes('resource exhausted'))
    return new Error('服务器资源不足，请稍后重试');
  if (lower.includes('invalid image') || lower.includes('invalid file') || lower.includes('图片格式') || lower.includes('image format'))
    return new Error('图片格式无效，请上传 PNG/JPG/WEBP 格式图片');
  if (lower.includes('file too large') || lower.includes('文件过大'))
    return new Error('图片文件过大，请压缩后重试');
  if (lower.includes('model not found') || lower.includes('model unavailable') || lower.includes('模型不可用'))
    return new Error('GPT Image 2 模型暂时不可用，请稍后重试');
  if (lower.includes('network') || lower.includes('connection') || lower.includes('网络'))
    return new Error('网络连接失败，请检查网络后重试');
  if (lower.includes('empty') || lower.includes('no images') || lower.includes('no result'))
    return new Error('生成结果为空，请修改提示词后重试');

  // OpenAI error type 分类
  if (code === 'invalid_request_error' || code === 'invalid_api_key')
    return new Error('API Key 无效，请检查设置中的 Yunwu AI Key');
  if (code === 'rate_limit_exceeded')
    return new Error('触发了速率限制，请稍后重试');
  if (code === 'content_policy_violated')
    return new Error('内容违规（色情/暴力/敏感），请修改提示词后重试');
  if (code === 'billing_not_active' || code === 'billing_hard_limit_reached')
    return new Error('账户欠费或计费未激活，请前往 yunwu.ai 处理');

  return new Error(`生成失败：${msg}`);
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '(no body)');
    throw parseYunwuError(res, bodyText);
  }

  // 检查业务层 error（如 yunwu 在 200 body 里塞 error 字段）
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    if (json.error) {
      throw parseYunwuError(res, text);
    }
    return json as T;
  } catch (err) {
    if (err instanceof Error) throw err;
    throw parseYunwuError(res, text);
  }
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
  const CONCURRENCY = 3;
  const DELAY_MS = 800;

  const results: GptImageResult[] = [];
  const errors: string[] = [];

  const doOne = async (): Promise<void> => {
    const res = await fetch(`${YUNWU_BASE}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: 'gpt-image-2', prompt, n: 1, size, quality }),
    });
    const data = await parseResponse<{
      created: number;
      data: Array<{ url?: string; b64_json?: string }>;
    }>(res);
    for (const item of data.data) {
      if (item.b64_json) {
        results.push({ url: `data:image/png;base64,${item.b64_json}` });
      } else if (item.url) {
        results.push({ url: item.url });
      }
    }
  };

  for (let i = 0; i < n; i += CONCURRENCY) {
    const batchSize = Math.min(CONCURRENCY, n - i);
    const batch: Promise<void>[] = [];
    for (let j = 0; j < batchSize; j++) {
      batch.push(
        doOne().catch((err) => {
          errors.push(err instanceof Error ? err.message : String(err));
        })
      );
    }
    await Promise.all(batch);
    if (i + CONCURRENCY < n) {
      await new Promise<void>((r) => setTimeout(r, DELAY_MS));
    }
  }

  if (results.length === 0 && errors.length > 0) {
    const uniqueErrors = [...new Set(errors)];
    const msg = uniqueErrors.length === 1
      ? uniqueErrors[0]
      : `${uniqueErrors.length} 个请求全部失败：${uniqueErrors[0]}`;
    throw new Error(msg);
  }

  return results;
}

/** Image-to-image (edit) via GPT Image 2 — supports multiple reference images */
export async function editImage(
  apiKey: string,
  prompt: string,
  imageFiles: File | File[],
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
  const files = Array.isArray(imageFiles) ? imageFiles : [imageFiles];

  // 图片编辑接口同样可能只返回 1 张图片，改用逐张并发调用。
  const CONCURRENCY = 1;
  const DELAY_MS = 1500;
  const results: GptImageResult[] = [];

  const doOne = async (retries = 2): Promise<void> => {
    const form = new FormData();
    form.append('model', 'gpt-image-2');
    form.append('prompt', prompt);
    form.append('n', '1');
    form.append('size', size);
    form.append('quality', quality);
    // Append each image file — the API accepts multiple image files for multi-reference
    for (const file of files) {
      form.append('image', file);
    }
    if (maskFile) {
      form.append('mask', maskFile);
    }

    const res = await fetch(`${YUNWU_BASE}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      if ((res.status === 429 || res.status === 502 || res.status === 503) && retries > 0) {
        await new Promise(r => setTimeout(r, (3 - retries) * 3000 + 2000));
        return doOne(retries - 1);
      }
      throw parseYunwuError(res, bodyText);
    }

    const data = await parseResponse<{
      created: number;
      data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
    }>(res);
    for (const item of data.data) {
      if (item.b64_json) {
        results.push({ url: `data:image/png;base64,${item.b64_json}`, revisedPrompt: item.revised_prompt });
      } else if (item.url) {
        results.push({ url: item.url, revisedPrompt: item.revised_prompt });
      }
    }
  };

  const errors: string[] = [];
  for (let i = 0; i < n; i += CONCURRENCY) {
    const batchSize = Math.min(CONCURRENCY, n - i);
    const batch: Promise<void>[] = [];
    for (let j = 0; j < batchSize; j++) {
      batch.push(
        doOne().catch((err) => {
          errors.push(err instanceof Error ? err.message : String(err));
        })
      );
    }
    await Promise.all(batch);
    if (i + CONCURRENCY < n) {
      await new Promise<void>((r) => setTimeout(r, DELAY_MS));
    }
  }

  if (results.length === 0 && errors.length > 0) {
    const uniqueErrors = [...new Set(errors)];
    const msg = uniqueErrors.length === 1
      ? uniqueErrors[0]
      : `${uniqueErrors.length} 个请求全部失败：${uniqueErrors[0]}`;
    throw new Error(msg);
  }

  return results;
}

/** 将 GirlfriendPreset 的 portraitUrl 转成 File */
export async function girlfriendToFile(gf: GirlfriendPreset): Promise<File> {
  const res = await fetch(gf.portraitUrl);
  const blob = await res.blob();
  return new File([blob], `${gf.id}.jpg`, { type: blob.type || 'image/jpeg' });
}
