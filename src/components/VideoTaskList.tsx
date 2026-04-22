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

interface VideoTaskListProps {
  apiKey: string;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  maxTasks?: number;
}

export interface VideoTaskListHandle {
  submitTask: (prompt: string, imagePath: string, imagePreview: string, nodeInfoList: NodeInfo[]) => void;
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

        {/* Generated image preview */}
        {task.status === 'FINISHED' && task.images.length > 0 && (
          <div className="mb-2">
            <div
              className="w-full rounded-lg overflow-hidden bg-bg-elevated cursor-pointer group"
              onClick={() => openPreview(0)}
            >
              <img
                src={task.images[0]}
                alt="Generated"
                className="w-full object-contain max-h-[300px] mx-auto group-hover:opacity-90 transition-opacity"
                style={{ maxHeight: '300px' }}
              />
            </div>
            {task.images.length > 1 && (
              <div className="flex gap-1.5 mt-1.5 overflow-x-auto">
                {task.images.slice(1, 5).map((img, i) => (
                  <div
                    key={i}
                    className="relative flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-bg-elevated hover:ring-2 hover:ring-primary/50 transition-all cursor-pointer"
                    onClick={() => openPreview(i + 1)}
                  >
                    <img src={img} alt={`Result ${i + 2}`} className="w-full h-full object-cover" />
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
                下载图片
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

      {/* Lightbox for images */}
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
          <img
            src={task.images[previewIndex]}
            alt="Full size"
            className="absolute inset-0 w-full h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
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

export const VideoTaskList = forwardRef<VideoTaskListHandle, VideoTaskListProps>(({ apiKey, onError, onSuccess, maxTasks = 10 }, ref) => {
  const [tasks, setTasks] = useState<VideoTask[]>(() => {
    try {
      const saved = localStorage.getItem('nsfwxo_video_tasks');
      if (saved) {
        const parsed = JSON.parse(saved) as VideoTask[];
        // Only keep non-finished tasks
        return parsed.filter((t) => t.status === 'QUEUEING' || t.status === 'RUNNING');
      }
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
    // Persist active tasks to localStorage
    try {
      localStorage.setItem('nsfwxo_video_tasks', JSON.stringify(tasks));
    } catch {
      // ignore
    }
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
        images: task.images,
        coins: task.coins,
        taskId: task.taskId,
        nodeInfoList: task.nodeInfoList,
        createdAt: Date.now(),
      };
      records.unshift(record);
      if (records.length > 50) records.splice(50);
      localStorage.setItem('nsfwxo_video_history', JSON.stringify(records));
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

  // Resume polling for tasks restored from localStorage
  useEffect(() => {
    tasks.forEach((t) => {
      if ((t.status === 'QUEUEING' || t.status === 'RUNNING') && t.taskId && !pollingRef.current[t.id]) {
        console.log('[VideoTaskList] Resuming poll for task:', t.id);
        pollTask(t);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        } else if (newStatus === 'FAILED') {
          setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: 'FAILED', error: '任务失败' } : t));
          onErrorRef.current?.('视频生成任务失败');
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
    nodeInfoList: NodeInfo[]
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

    // Run task via VideoTaskList's own API (for normal img2vid page flow)
    try {
      const result = await runTask(apiKey, '2018678819216953345', nodeInfoList);
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
    submitTask: (prompt: string, imagePath: string, imagePreview: string, nodeInfoList: NodeInfo[]) => {
      handleSubmit(prompt, imagePath, imagePreview, nodeInfoList);
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
