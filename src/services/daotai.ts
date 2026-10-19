/**
 * 导演台 (daotai) 后端 API 封装
 *
 * 与 RunningHub 不同，导演台任务走 nsfwxo 后端 /api/daotai/* 路由：
 * - 提交图片：POST /api/daotai/image
 * - 提交视频：POST /api/daotai/video
 * - 轮询：     POST /api/daotai/query
 * - 静态服务： GET  /api/daotai/image/media/...
 *
 * 与 useTaskManager 的集成点：
 * 1. submitDaotaiImage / submitDaotaiVideo 走自定义 fetch，不调用 RunningHub
 * 2. pollDaotaiTask 返回的 `images` 数组直接落到 QueuedTask.images
 *    （不需要 ZIP 解压环节）
 */
import type { DaotaiImgConfig } from '../types';

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
  url?: string;
  taskId?: string;
  output?: {
    images?: string[];
    thumbs?: string[];
    video_url?: string;
  };
}

function authHeaders(apiKey: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

export async function submitDaotaiImage(
  apiKey: string,
  prompt: string,
  config: DaotaiImgConfig,
): Promise<DaotaiSubmitResponse> {
  const resp = await fetch('/api/daotai/image', {
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
  const resp = await fetch('/api/daotai/query', {
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
