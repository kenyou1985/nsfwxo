import React, { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { X, Download, Clock, Coins, CheckCircle, XCircle, Loader2, ZoomIn } from 'lucide-react';
import type { NodeInfo } from '../types';
import { runTask, getTaskStatus, getTaskResults, extractImagesFromZipAsDataUrls } from '../services/runninghub';

interface VideoTask {
  id: string;
  taskId: string | null;
  status: 'QUEUEING' | 'RUNNING' | 'FINISHED' | 'FAILED';
  prompt: string;
  imagePreview: string;
  images: string[];
  coins: string | null;
  elapsedSeconds: number;
  error: string | null;
  startTime: number;
  nodeInfoList: NodeInfo[];
}

// ─── localStorage 配额保护 ─────────────────────────────────────────────────────
// localStorage 默认上限 ~5MB；保留在内存里的大对象（例如从 ZIP 解出的 data:image/jpeg;base64,...，
// 单帧常常 1~3 MB，几张合起来轻松破限额）一旦序列化进去就会触发 QuotaExceededError。
// 这里把"重的字段"集中处理：data URL 一律剥掉，只保留 CDN/直链/小文本。
type StrippedVideoTask = Omit<VideoTask, 'images' | 'imagePreview'> & {
  imagePreview: string;
  images: string[];
};

function stripHeavyMedia(task: VideoTask): StrippedVideoTask {
  return {
    ...task,
    // images[] 里 data: URL 直接丢掉（恢复出来时失去的图不影响任务元数据，
    // 用户可以从历史记录或重新查询时再拉）
    images: task.images.filter((u) => !!u && !u.startsWith('data:')),
    // imagePreview 是上传时给的缩略图 (blob: URL)，刷新后必然失效，留空即可
    imagePreview: '',
  };
}

/**
 * 把数组按限额逐级降级写入 localStorage；任何一次成功立刻返回。
 * 失败的极端情况下退化为"清空 key"，避免抛错影响主流程。
 */
function tryPersistWithFallback(
  storageKey: string,
  buildPayload: (cap: number) => unknown,
  caps: number[],
  onSuccess: (label: string) => void,
): void {
  let lastError: unknown = null;
  for (const cap of caps) {
    try {
      const payload = buildPayload(cap);
      const json = JSON.stringify(payload);
      localStorage.setItem(storageKey, json);
      onSuccess(`cap=${cap}, ${(json.length / 1024).toFixed(1)} KB`);
      return;
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      // QuotaExceededError 是 storage 满了，其他错误应当抛上去给上层 try/catch
      if (!/quota/i.test(msg) && !(e instanceof DOMException && e.name === 'QuotaExceededError')) {
        // 非配额错误直接吞掉，避免页面崩溃；记录日志供排查
        console.warn(`[VideoTaskList] persist ${storageKey} failed at cap=${cap}:`, e);
        return;
      }
      console.warn(`[VideoTaskList] persist ${storageKey} cap=${cap} exceeded quota, retrying smaller:`, e);
    }
  }
  // 所有 cap 都装不下 → 清空以避免下一次刷新继续炸
  console.warn(`[VideoTaskList] persist ${storageKey} all caps failed, clearing. lastError:`, lastError);
  try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
}

interface VideoTaskListProps {
  apiKey: string;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  maxTasks?: number;
  workflowId?: string;  // 默认工作流 ID，可被外部覆盖
  onTaskComplete?: (result: VideoTaskCompleteResult) => void; // 任务完成时回调，暴露完整结果
}

export interface VideoTaskListHandle {
  submitTask: (prompt: string, imagePath: string, imagePreview: string, nodeInfoList: NodeInfo[], workflowId?: string) => void;
}

interface VideoTaskCompleteResult {
  task: VideoTask;
  results: {
    url: string;
    nodeId: string;
    outputType: string;
    text: string | null;
  }[];
}

/** 检查 data URL 或普通 URL 是否是视频 */
function isVideoUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.startsWith('data:video/')) return true;
  if (lower.startsWith('data:image/')) return false;
  // 通过文件扩展名判断
  return /\.(mp4|webm|mov|avi|mkv)(\?|#|$)/i.test(lower);
}

/** 检查 data URL 或普通 URL 是否是图片 */
function isImageUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.startsWith('data:image/')) return true;
  if (lower.startsWith('data:video/')) return false;
  return /\.(png|jpg|jpeg|webp|gif)(\?|#|$)/i.test(lower);
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function getStatusIcon(status: VideoTask['status']) {
  switch (status) {
    case 'QUEUEING':
      return <Loader2 size={14} className="text-yellow-500 animate-spin" />;
    case 'RUNNING':
      return <Loader2 size={14} className="text-blue-500 animate-spin" />;
    case 'FINISHED':
      return <CheckCircle size={14} className="text-green-600" />;
    case 'FAILED':
      return <XCircle size={14} className="text-red-500" />;
    default:
      return <Clock size={14} className="text-text-tertiary" />;
  }
}

function getStatusText(status: VideoTask['status']): string {
  switch (status) {
    case 'QUEUEING': return '排队中';
    case 'RUNNING': return '生成中';
    case 'FINISHED': return '已完成';
    case 'FAILED': return '失败';
    default: return '等待中';
  }
}

function getStatusColor(status: VideoTask['status']): string {
  switch (status) {
    case 'QUEUEING': return 'bg-yellow-500/20 border-yellow-500/30';
    case 'RUNNING': return 'bg-blue-500/20 border-blue-500/30';
    case 'FINISHED': return 'bg-green-500/20 border-green-500/30';
    case 'FAILED': return 'bg-red-500/20 border-red-500/30';
    default: return 'bg-bg-elevated border-border';
  }
}

interface VideoTaskCardProps {
  task: VideoTask;
  onCancel: () => void;
  onRegenerate: (task: VideoTask) => void;
  onSelectForRegenerate: (task: VideoTask) => void;
}

function VideoTaskCard({ task, onCancel, onRegenerate, onSelectForRegenerate }: VideoTaskCardProps) {
  const isActive = task.status === 'QUEUEING' || task.status === 'RUNNING';
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  const openPreview = (index: number) => {
    setPreviewIndex(index);
    setIsLightboxOpen(true);
  };
  const closePreview = () => {
    setIsLightboxOpen(false);
    setPreviewIndex(null);
  };

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (!isLightboxOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setPreviewIndex((i) => (i !== null ? (i + 1) % task.images.length : 0));
      else if (e.key === 'ArrowLeft') setPreviewIndex((i) => (i !== null ? (i - 1 + task.images.length) % task.images.length : 0));
      else if (e.key === 'Escape') closePreview();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isLightboxOpen, task.images.length]);

  return (
    <>
      <div className={`rounded-xl border p-4 transition-all ${getStatusColor(task.status)}`}>
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            {getStatusIcon(task.status)}
            <span className="text-xs font-medium text-text-primary">
              {getStatusText(task.status)}
            </span>
            {task.status === 'RUNNING' && (
              <div className="flex-1 h-1 bg-blue-500/30 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 animate-pulse" style={{ width: '60%' }} />
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {isActive && (
              <span className="text-xs text-text-secondary flex items-center gap-1">
                <Clock size={12} />
                {formatElapsed(task.elapsedSeconds)}
              </span>
            )}
            {task.coins && (
              <span className="text-xs text-amber-400 flex items-center gap-1">
                <Coins size={12} />
                {task.coins}
              </span>
            )}
            <button
              onClick={onCancel}
              className="w-6 h-6 rounded-lg hover:bg-black/5 flex items-center justify-center transition-colors"
              title="取消任务"
            >
              <X size={12} className="text-text-tertiary" />
            </button>
          </div>
        </div>

        {/* Source image and prompt */}
        <div className="flex items-center gap-3 mb-2">
          {task.imagePreview && (
            <div className="relative flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-bg-elevated">
              <img src={task.imagePreview} alt="Source" className="w-full h-full object-cover" />
            </div>
          )}
          {task.prompt && (
            <p className="text-xs text-text-secondary line-clamp-2 flex-1">{task.prompt}</p>
          )}
        </div>

        {/* Generated image/video preview */}
        {task.status === 'FINISHED' && task.images.length > 0 && (
          <div className="mb-2">
            <div
              className="w-full rounded-lg overflow-hidden bg-bg-elevated cursor-pointer group"
              onClick={() => openPreview(0)}
            >
              {isVideoUrl(task.images[0]) ? (
                <video
                  src={task.images[0]}
                  controls
                  playsInline
                  className="w-full object-contain max-h-[300px] mx-auto"
                  style={{ maxHeight: '300px' }}
                />
              ) : (
                <img
                  src={task.images[0]}
                  alt="Generated"
                  className="w-full object-contain max-h-[300px] mx-auto group-hover:opacity-90 transition-opacity"
                  style={{ maxHeight: '300px' }}
                />
              )}
            </div>
            {task.images.length > 1 && (
              <div className="flex gap-1.5 mt-1.5 overflow-x-auto">
                {task.images.slice(1, 5).map((img, i) => (
                  <div
                    key={i}
                    className="relative flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-bg-elevated hover:ring-2 hover:ring-primary/50 transition-all cursor-pointer"
                    onClick={() => openPreview(i + 1)}
                  >
                    {isVideoUrl(img) ? (
                      <div className="w-full h-full bg-black flex items-center justify-center">
                        <video src={img} className="w-full h-full object-cover" muted />
                        <span className="absolute inset-0 flex items-center justify-center text-white text-[8px] font-bold pointer-events-none">▶</span>
                      </div>
                    ) : (
                      <img src={img} alt={`Result ${i + 2}`} className="w-full h-full object-cover" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        {task.status === 'FINISHED' && (
          <div className="flex gap-2">
            {task.images[0] && (
              <a
                href={task.images[0]}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-bg-elevated hover:bg-black/5 text-text-primary text-xs font-medium transition-colors"
              >
                <Download size={13} />
                {isVideoUrl(task.images[0]) ? '下载视频' : '下载图片'}
              </a>
            )}
            <button
              onClick={() => onSelectForRegenerate(task)}
              className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-xs font-medium transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 4v6h6M23 20v-6h-6" />
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
              </svg>
              重新生成
            </button>
          </div>
        )}

        {/* Failed state */}
        {task.status === 'FAILED' && task.error && (
          <p className="text-xs text-red-400 mt-1">{task.error}</p>
        )}

        {task.status === 'QUEUEING' && (
          <p className="text-xs text-text-tertiary mt-1">等待 RunningHub 处理...</p>
        )}
      </div>

      {/* Lightbox for images/videos */}
      {isLightboxOpen && previewIndex !== null && (
        <div className="fixed inset-0 z-50 bg-black/95" onClick={closePreview}>
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 z-10" onClick={(e) => e.stopPropagation()}>
            <span className="text-sm text-text-secondary">{previewIndex + 1} / {task.images.length}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); window.open(task.images[previewIndex], '_blank'); }}
                className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
              >
                <Download size={18} />
              </button>
              <button
                onClick={closePreview}
                className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>
          {isVideoUrl(task.images[previewIndex]) ? (
            <video
              src={task.images[previewIndex]}
              controls
              autoPlay
              playsInline
              className="absolute inset-0 w-full h-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={task.images[previewIndex]}
              alt="Full size"
              className="absolute inset-0 w-full h-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          )}
          {task.images.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setPreviewIndex((i) => (i !== null ? (i - 1 + task.images.length) % task.images.length : 0)); }}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-black/40 flex items-center justify-center text-white hover:bg-black/60 transition-colors text-2xl z-10"
              >
                ‹
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setPreviewIndex((i) => (i !== null ? (i + 1) % task.images.length : 0)); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-black/40 flex items-center justify-center text-white hover:bg-black/60 transition-colors text-2xl z-10"
              >
                ›
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}

export const VideoTaskList = forwardRef<VideoTaskListHandle, VideoTaskListProps>(({ apiKey, onError, onSuccess, maxTasks = 10, workflowId: defaultWorkflowId, onTaskComplete }, ref) => {
  // Restore ALL tasks from localStorage, including completed ones (within 24h).
  // Previously only QUEUEING/RUNNING tasks were restored, causing completed tasks
  // submitted from other pages (e.g. smart storyboard) to disappear on return.
  // 兼容两种持久化格式：
  //   - v2: { v: 2, tasks: VideoTask[] }
  //   - v1 (旧): 直接是 VideoTask[]
  const [tasks, setTasks] = useState<VideoTask[]>(() => {
    try {
      const saved = localStorage.getItem('nsfwxo_video_tasks');
      if (!saved) return [];
      const raw = JSON.parse(saved);
      const parsed: VideoTask[] = Array.isArray(raw)
        ? (raw as VideoTask[])
        : (raw && Array.isArray(raw.tasks) ? (raw.tasks as VideoTask[]) : []);
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;
      const filtered = parsed.filter((t) => {
        if (t.status === 'FINISHED' || t.status === 'FAILED') {
          return t.startTime > Date.now() - ONE_DAY_MS;
        }
        return true;
      });
      console.log(`[VideoTaskList] Restored ${filtered.length}/${parsed.length} tasks from localStorage:`, filtered.map((t) => ({ id: t.id, status: t.status, taskId: t.taskId })));
      return filtered;
    } catch {
      // ignore
    }
    return [];
  });
  const pollingRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const onErrorRef = useRef(onError);
  const onSuccessRef = useRef(onSuccess);
  const imagesExtractedRef = useRef<Record<string, boolean>>(
    Object.fromEntries(tasks.filter((t) => t.status === 'FINISHED').map((t) => [t.id, true]))
  );
  const saveToHistoryRef = useRef<(task: VideoTask) => void>(() => {});

  useEffect(() => {
    // 持久化任务到 localStorage。
    //
    // localStorage 默认配额只有 ~5MB；不收敛的话：
    //   - images[] 里的 data: URL（ZIP 解压产物）单帧可达几 MB；
    //   - 多条已完成任务叠加后 setItem 直接 QuotaExceeded，
    //     React useEffect 会把组件抛进 commit error，把整个页面卡住。
    //
    // 因此这里做了三层收紧：
    //   1. 序列化前用 stripHeavyMedia 剥掉 data URL；
    //   2. 用 tryPersistWithFallback 按 cap 阶梯 (30 → 10 → 5) 尝试；
    //   3. 全部失败就清掉这个 key，下一轮重新累积，避免持续抛 quota 阻塞 commit。
    tryPersistWithFallback(
      'nsfwxo_video_tasks',
      (cap) => ({
        v: 2, // schema 版本号，跟读取端配套
        tasks: tasks.slice(0, cap).map(stripHeavyMedia),
      }),
      [30, 10, 5],
      (label) => {
        console.debug(
          `[VideoTaskList] Persisted ${Math.min(tasks.length, 30)} tasks (${label}) to localStorage`,
          tasks.slice(0, Math.min(tasks.length, 30)).map((t) => ({ id: t.id, status: t.status })),
        );
      },
    );
  }, [tasks]);

  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);

  // Save to history when task completes
  const saveToHistory = useCallback((task: VideoTask) => {
    try {
      const records = JSON.parse(localStorage.getItem('nsfwxo_video_history') || '[]');
      const record = {
        id: `${task.id}-${Date.now()}`,
        prompt: task.prompt,
        // 同样剥掉 data URL，避免历史记录持续放大触发 QuotaExceededError
        images: task.images.filter((u) => !!u && !u.startsWith('data:')),
        coins: task.coins,
        taskId: task.taskId,
        nodeInfoList: task.nodeInfoList,
        createdAt: Date.now(),
      };
      records.unshift(record);
      if (records.length > 50) records.splice(50);
      // 按 50 → 20 → 5 阶梯写入，仍失败则清掉历史记录
      tryPersistWithFallback(
        'nsfwxo_video_history',
        (cap) => records.slice(0, cap),
        [50, 20, 5],
        (label) => {
          console.debug(`[VideoTaskList] saveToHistory: kept ${Math.min(records.length, 50)} records (${label})`);
        },
      );
    } catch (e) {
      console.warn('Failed to save video to history:', e);
    }
  }, []);

  useEffect(() => {
    saveToHistoryRef.current = saveToHistory;
  }, [saveToHistory]);

  // Timer effect - update elapsed time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setTasks((prev) =>
        prev.map((t) => {
          if (t.status === 'QUEUEING' || t.status === 'RUNNING') {
            return { ...t, elapsedSeconds: Math.floor((Date.now() - t.startTime) / 1000) };
          }
          return t;
        })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Resume polling for active tasks restored from localStorage, and re-extract images
  // for completed tasks that were restored without their result images.
  useEffect(() => {
    tasks.forEach((t) => {
      if ((t.status === 'QUEUEING' || t.status === 'RUNNING') && t.taskId && !pollingRef.current[t.id]) {
        console.log('[VideoTaskList] Resuming poll for task:', t.id);
        pollTask(t);
      }
      // If a FINISHED task was restored from localStorage but has no images, try to
      // extract them from the task result (blob URLs expire after page refresh).
      if (t.status === 'FINISHED' && t.images.length === 0 && t.taskId) {
        console.log('[VideoTaskList] Restoring images for completed task:', t.id);
        extractImagesForTask(t).catch(() => {});
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const extractImagesForTask = useCallback(async (task: VideoTask) => {
    if (!task.taskId || imagesExtractedRef.current[task.id]) return;
    imagesExtractedRef.current[task.id] = true;
    try {
      const resp = await getTaskResults(apiKey, task.taskId);
      const results = resp.results;
      if (!results || results.length === 0) return;

      let images: string[] = [];
      const pngResults = results.filter((r) =>
        r.outputType === 'png' || r.fileType === 'png' || r.url?.endsWith('.png')
      );
      if (pngResults.length > 0) {
        images = pngResults.map((r) => r.url).filter(Boolean) as string[];
      }

      // Handle MP4 directly (video generation returns mp4 URL)
      if (images.length === 0) {
        const mp4Results = results.filter((r) =>
          r.outputType === 'mp4' || r.fileType === 'mp4' || r.url?.toLowerCase().endsWith('.mp4')
        );
        if (mp4Results.length > 0) {
          images = mp4Results.map((r) => r.url).filter(Boolean) as string[];
        }
      }

      if (images.length === 0) {
        const zipResult = results.find((r) =>
          r.outputType === 'zip' || r.fileType === 'zip' || r.url?.endsWith('.zip')
        );
        if (zipResult?.url) {
          images = await extractImagesFromZipAsDataUrls(zipResult.url);
        }
      }

      if (images.length > 0) {
        setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, images } : t));
        console.log(`[VideoTaskList] Restored ${images.length} images for task ${task.id}`);
      }
    } catch (err) {
      console.warn('[VideoTaskList] Failed to extract images for task', task.id, err);
    }
  }, [apiKey]);

  const pollTask = useCallback(async (task: VideoTask) => {
    if (!apiKey || !task.taskId) return;
    if (pollingRef.current[task.id]) return;

    const poll = async () => {
      try {
        const statusResp = await getTaskStatus(apiKey, task.taskId!);
        const newStatus =
          statusResp.status === 'SUCCESS' || statusResp.status === 'FINISHED'
            ? 'FINISHED'
            : statusResp.status === 'FAILED' || statusResp.status === 'FAIL'
            ? 'FAILED'
            : statusResp.status === 'RUNNING' || statusResp.status === 'PROCESSING'
            ? 'RUNNING'
            : 'QUEUEING';

        // Keep as RUNNING while extracting, to avoid flash of "no images" state
        const displayStatus = newStatus === 'FINISHED' && !imagesExtractedRef.current[task.id] ? 'RUNNING' : newStatus;
        setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: displayStatus } : t));

        // Log status transitions so a future 551/SaveStringKJ failure can be
        // correlated with the submission payload, prompt text, image nodes,
        // and upload responses (all already logged by runninghub.ts).
        if (newStatus === 'FINISHED' || newStatus === 'FAILED') {
          console.log(`[VideoTaskList] taskId=${task.taskId} status=${newStatus}`);
        }

        if (newStatus === 'FINISHED') {
          // Skip if already extracting
          if (imagesExtractedRef.current[task.id]) return;
          imagesExtractedRef.current[task.id] = true;

          const outputs = await getTaskResults(apiKey, task.taskId!);
          let images: string[] = [];
          let coins: string | null = null;

          if (outputs.results && outputs.results.length > 0) {
            coins = outputs.usage?.consumeCoins || null;

            // Handle PNG images directly
            const pngResults = outputs.results.filter((r) =>
              r.outputType === 'png' || r.fileType === 'png' || r.url?.endsWith('.png')
            );
            if (pngResults.length > 0) {
              images = pngResults.map((r) => r.url).filter(Boolean) as string[];
            }

            // Handle MP4 directly (video generation returns mp4 URL)
            if (images.length === 0) {
              const mp4Results = outputs.results.filter((r) =>
                r.outputType === 'mp4' || r.fileType === 'mp4' || r.url?.toLowerCase().endsWith('.mp4')
              );
              if (mp4Results.length > 0) {
                images = mp4Results.map((r) => r.url).filter(Boolean) as string[];
              }
            }

            // Handle ZIP files - extract images
            if (images.length === 0) {
              const zipResult = outputs.results.find((r) =>
                r.outputType === 'zip' || r.fileType === 'zip' || r.url?.endsWith('.zip')
              );
              if (zipResult?.url) {
                try {
                  images = await extractImagesFromZipAsDataUrls(zipResult.url);
                } catch (err) {
                  console.warn('[pollTask] Failed to extract ZIP images:', err);
                }
              }
            }
          }

          const updatedTask: VideoTask = {
            ...task,
            status: 'FINISHED',
            images,
            coins,
          };

          setTasks((prev) => prev.map((t) => t.id === task.id ? updatedTask : t));
          // Always save to history when task completes
          saveToHistoryRef.current(updatedTask);
          if (images.length > 0) {
            onSuccessRef.current?.(`生成完成！${coins ? `消耗 ${coins} 币` : ''}`);
          }
          // Fire onTaskComplete callback with full results (for enhanced prompt, etc.)
          onTaskComplete?.({ task: updatedTask, results: outputs.results ?? [] });
        } else if (newStatus === 'FAILED') {
          // Pull the actual failure detail (failedReason) from getTaskResults so
          // the user can see *why* the workflow failed (e.g. node 551 / SaveStringKJ
          // rejecting a .zip filename). Without this we'd only ever show a
          // generic "任务失败" message regardless of the real cause.
          let detail = '';
          try {
            const failedOutputs = await getTaskResults(apiKey, task.taskId!);
            const fr = failedOutputs.failedReason as Record<string, unknown> | undefined;
            if (fr && Object.keys(fr).length > 0) {
              const nodeName = (fr.node_name as string) || '';
              const nodeId = (fr.node_id as string) || '';
              const excMsg = (fr.exception_message as string) || '';
              const errMsg = failedOutputs.errorMessage || '';
              detail = [errMsg, nodeName && `node ${nodeId || '?'} (${nodeName})`, excMsg]
                .filter(Boolean)
                .join(' — ');
            }
          } catch {
            // ignore — fall back to generic message below
          }
          const errorText = detail ? `任务失败：${detail}` : '任务失败';
          setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: 'FAILED', error: errorText } : t));
          onErrorRef.current?.(errorText);
        } else {
          pollingRef.current[task.id] = setTimeout(poll, 10000);
        }
      } catch {
        setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: 'FAILED', error: '查询失败' } : t));
      }
    };

    pollingRef.current[task.id] = setTimeout(poll, 5000);
  }, [apiKey]);

  const handleSubmit = useCallback(async (
    prompt: string,
    imagePath: string,
    imagePreview: string,
    nodeInfoList: NodeInfo[],
    workflowId: string = defaultWorkflowId ?? '2018678819216953345' // 默认 Wan 2.2，可被 prop 覆盖
  ) => {
    if (tasks.length >= maxTasks) {
      onError('任务队列已满');
      return;
    }

    const id = `vt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newTask: VideoTask = {
      id,
      taskId: null,
      status: 'QUEUEING',
      prompt,
      imagePreview,
      images: [],
      coins: null,
      elapsedSeconds: 0,
      error: null,
      startTime: Date.now(),
      nodeInfoList,
    };

    setTasks((prev) => [newTask, ...prev].slice(0, maxTasks));
    console.log(`[VideoTaskList] handleSubmit: task ${id} added, QUEUEING. Calling runTask with workflow ${workflowId}...`);

    // Run task via VideoTaskList's own API (for normal img2vid page flow)
    try {
      const result = await runTask(apiKey, workflowId, nodeInfoList);
      console.log(`[VideoTaskList] handleSubmit: task ${id} got taskId=${result.taskId}, status=${result.status}`);
      if (!result.taskId) {
        // runTask returned a server-side rejection (e.g. errorCode 803
        // NODE_INFO_MISMATCH, or 421 concurrency limit). Mark the task as
        // failed so the user sees the real error message instead of having
        // it sit in "RUNNING" forever.
        const msg = result.errorMessage || result.errorCode
          ? `提交失败：${result.errorCode || ''} ${result.errorMessage}`.trim()
          : '提交失败，未返回 taskId';
        setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: 'FAILED', error: msg } : t));
        onError(msg);
        return;
      }
      const taskWithId = { ...newTask, taskId: result.taskId, status: 'RUNNING' as const };
      setTasks((prev) => prev.map((t) => t.id === id ? taskWithId : t));
      onSuccess('任务已提交');
      pollTask(taskWithId);
    } catch (err) {
      setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: 'FAILED', error: err instanceof Error ? err.message : '提交失败' } : t));
      onError(err instanceof Error ? err.message : '提交失败');
    }
  }, [apiKey, tasks.length, maxTasks, onError, onSuccess, pollTask]);

  const cancelTask = useCallback((id: string) => {
    if (pollingRef.current[id]) {
      clearTimeout(pollingRef.current[id]);
      delete pollingRef.current[id];
    }
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearCompleted = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status !== 'FINISHED' && t.status !== 'FAILED'));
  }, []);

  useImperativeHandle(ref, () => ({
    submitTask: (prompt: string, imagePath: string, imagePreview: string, nodeInfoList: NodeInfo[], workflowId?: string) => {
      handleSubmit(prompt, imagePath, imagePreview, nodeInfoList, workflowId);
    },
  }), [handleSubmit]);

  // Use ref to always call the latest handleSubmit
  const handleSubmitWrapper = useCallback((...args: Parameters<typeof handleSubmit>) => {
    handleSubmit(...args);
  }, [handleSubmit]);

  // Poll for pending video tasks from other pages (same-tab via localStorage)
  useEffect(() => {
    const STORAGE_KEY = 'nsfwxo_video_task_submit';
    const BATCH_KEY = 'nsfwxo_video_task_batch';

    const processSubmitTask = () => {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        try {
          const parsed = JSON.parse(data);
          if (parsed.processed) return;
          if (parsed.nodeInfoList && parsed.prompt) {
            const imagePath = parsed.nodeInfoList.find((n: NodeInfo) => n.fieldName === 'image')?.fieldValue || '';
            handleSubmitWrapper(parsed.prompt, imagePath, parsed.imagePreview || '', parsed.nodeInfoList);
          }
          // Mark as processed
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...parsed, processed: true }));
        } catch { /* ignore */ }
      }
    };

    const processBatchTask = () => {
      const data = localStorage.getItem(BATCH_KEY);
      if (data) {
        try {
          const parsed = JSON.parse(data);
          if (parsed.processed) return;
          if (parsed.tasks && Array.isArray(parsed.tasks)) {
            parsed.tasks.forEach((task: { prompt: string; imagePreview: string; nodeInfoList: NodeInfo[] }) => {
              if (task.nodeInfoList && task.prompt) {
                const imagePath = task.nodeInfoList.find((n: NodeInfo) => n.fieldName === 'image')?.fieldValue || '';
                handleSubmitWrapper(task.prompt, imagePath, task.imagePreview || '', task.nodeInfoList);
              }
            });
          }
          // Mark as processed
          localStorage.setItem(BATCH_KEY, JSON.stringify({ ...parsed, processed: true }));
        } catch { /* ignore */ }
      }
    };

    // Initial check
    processSubmitTask();
    processBatchTask();

    // Poll every 500ms for new tasks (same-tab compatible)
    const pollInterval = setInterval(() => {
      processSubmitTask();
      processBatchTask();
    }, 500);

    return () => clearInterval(pollInterval);
  }, [handleSubmitWrapper]);

  const hasCompleted = tasks.some((t) => t.status === 'FINISHED' || t.status === 'FAILED');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">
          任务列表 ({tasks.length}/{maxTasks})
        </h3>
        {hasCompleted && (
          <button
            onClick={clearCompleted}
            className="text-xs text-text-tertiary hover:text-text-primary transition-colors"
          >
            清除已完成
          </button>
        )}
      </div>

      <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
        {tasks.map((task) => (
          <VideoTaskCard
            key={task.id}
            task={task}
            onCancel={() => cancelTask(task.id)}
            onRegenerate={() => {}}
            onSelectForRegenerate={() => {}}
          />
        ))}
      </div>
    </div>
  );
});

// Export for use in parent component
export type { VideoTask };
