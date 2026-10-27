/**
 * 导演台 (daotai) 后端 API 封装
 *
 * 与 RunningHub 不同，导演台任务走 nsfwxo 后端 /api/daotai/* 路由：
 * - 提交图片：POST {backendUrl}/api/daotai/image
 * - 提交视频：POST {backendUrl}/api/daotai/video
 * - 轮询：     POST {backendUrl}/api/daotai/query
 * - 静态服务： GET  {backendUrl}/api/daotai/image/media/...
 *
 * 与 useTaskManager 的集成点：
 * 1. submitDaotaiImage / submitDaotaiVideo 走自定义 fetch，不调用 RunningHub
 * 2. pollDaotaiTask 返回的 `images` 数组直接落到 QueuedTask.images
 *    （不需要 ZIP 解压环节）
 */
import type { DaotaiImgConfig } from '../types';
import { getBackendUrl } from './storage';

export interface DaotaiSubmitResponse {
  taskId: string;
  task_id?: string;
  localDir?: string;
  logs?: string;
}

export type DaotaiStatus = 'PROCESSING' | 'SUCCESS' | 'FAILED';

export interface DaotaiPollResponse {
  status: DaotaiStatus;
  message?: string;
  images?: string[];
  thumbs?: string[];
  video_url?: string;
  final_url?: string;
  url?: string;
  videos?: string[];
  segments?: Array<{ index: number | string; url: string; file?: string; status?: string }>;
  taskId?: string;
  output?: {
    images?: string[];
    thumbs?: string[];
    video_url?: string;
    final_url?: string;
    videos?: string[];
    segments?: Array<{ index: number | string; url: string; file?: string; status?: string }>;
  };
}

function authHeaders(apiKey: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

/** 把相对路径 /api/daotai/... 解析为绝对 URL，避免前端在 Vercel 部署时打到
 *  Vercel 自己的边缘（那里没有 serverless function，会返回 405）。 */
function api(path: string): string {
  const base = getBackendUrl().replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : '/' + path}`;
}

export async function submitDaotaiImage(
  apiKey: string,
  prompt: string,
  config: DaotaiImgConfig,
): Promise<DaotaiSubmitResponse> {
  const resp = await fetch(api('/api/daotai/image'), {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      model: config.model,
      prompt,
      ratio: config.ratio,
      batch: config.batch,
      refs: config.refs || [],
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error || data?.message || `HTTP ${resp.status}`);
  }
  const tid = String(data.taskId || data.task_id || '');
  if (!tid) {
    throw new Error('提交成功但未返回 taskId');
  }
  return {
    taskId: tid,
    task_id: data.task_id,
    localDir: data.localDir,
    logs: data.logs,
  };
}

export async function pollDaotaiTask(
  apiKey: string,
  taskId: string,
): Promise<DaotaiPollResponse> {
  const resp = await fetch(api('/api/daotai/query'), {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ taskId }),
  });
  // 后端在任务失败 / 未知时仍返回 200 + JSON；只有连接错误才 throw
  const data: DaotaiPollResponse = await resp.json().catch(() => ({
    status: 'FAILED' as DaotaiStatus,
    message: 'invalid JSON from /api/daotai/query',
  }));
  return data;
}

export async function submitDaotaiVideo(
  apiKey: string,
  prompt: string,
  body: Record<string, unknown>,
): Promise<DaotaiSubmitResponse> {
  const resp = await fetch(api('/api/daotai/video'), {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ prompt, ...body }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error || data?.message || `HTTP ${resp.status}`);
  const tid = String(data.taskId || data.task_id || '');
  if (!tid) throw new Error('提交成功但未返回 taskId');
  return { taskId: tid, task_id: data.task_id, logs: data.logs };
}

export async function concatDaotaiVideos(
  apiKey: string,
  videos: string[],
): Promise<{ video_url: string; count: number }> {
  const resp = await fetch(api('/api/daotai/concat'), {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ videos }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
  if (!data.video_url) throw new Error('合成成功但未返回 video_url');
  return { video_url: data.video_url, count: data.count || videos.length };
}
