import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  runTask,
  getTaskStatus,
  getTaskResults,
  extractImagesFromZip,
  extractImagesFromZipAsDataUrls,
  WORKFLOW,
} from '../services/runninghub';
import { cacheImages } from '../services/imageCacheService';
import type {
  QueuedTask,
  TaskStatus,
  NodeInfo,
} from '../types';

const POLL_INTERVAL = 10000;
const MAX_TASKS = 20;
export const TASK_PERSIST_KEY = 'ai_task_persist';

// Persisted task entry (without ephemeral fields)
export interface PersistedTaskEntry {
  id: string;
  taskId: string | null;
  prompt: string;
  workflowType: 'txt2img' | 'img2img' | 'img2vid';
  workflowIdOverride?: string;
  nodeInfoList: NodeInfo[];
  resultId?: string; // UI result identifier for matching restored tasks to UI state
  timestamp: number;
}

export function loadPersistedTasks(): PersistedTaskEntry[] {
  try {
    const raw = localStorage.getItem(TASK_PERSIST_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PersistedTaskEntry[];
  } catch {
    return [];
  }
}

function savePersistedTasks(tasks: PersistedTaskEntry[]): void {
  try {
    localStorage.setItem(TASK_PERSIST_KEY, JSON.stringify(tasks));
  } catch {}
}

function persistTask(entry: PersistedTaskEntry): void {
  const tasks = loadPersistedTasks();
  const idx = tasks.findIndex((t) => t.id === entry.id);
  if (idx >= 0) tasks[idx] = entry;
  else tasks.push(entry);
  if (tasks.length > 100) tasks.splice(0, tasks.length - 100);
  savePersistedTasks(tasks);
}

export function unpersistTask(id: string): void {
  const tasks = loadPersistedTasks().filter((t) => t.id !== id);
  savePersistedTasks(tasks);
}

export function clearPersistedTasks(): void {
  try { localStorage.removeItem(TASK_PERSIST_KEY); } catch {}
}

interface TaskManagerOptions {
  apiKey: string | null;
  onError?: (taskId: string, message: string) => void;
  onTaskComplete?: (task: QueuedTask, elapsed: number) => void;
  onTaskStatusChange?: (taskId: string, status: TaskStatus) => void;
}

export interface TaskManagerReturn {
  tasks: QueuedTask[];
  isFull: boolean;
  addTask: (
    workflowType: 'txt2img' | 'img2img' | 'img2vid',
    nodeInfoList: NodeInfo[],
    prompt: string,
    workflowIdOverride?: string,
    resultId?: string
  ) => Promise<string>;
  addTaskWithNodeList: (
    workflowType: 'txt2img' | 'img2img' | 'img2vid',
    nodeInfoList: NodeInfo[],
    prompt: string,
    workflowIdOverride?: string,
    resultId?: string
  ) => Promise<string>;
  cancelTask: (id: string) => void;
  clearCompleted: () => void;
  regenerateTask: (id: string) => void;
  restoreTasks: (entries: PersistedTaskEntry[]) => void;
}

function mapTaskStatus(status: string): TaskStatus {
  switch (status) {
    case 'SUCCESS':
    case 'FINISHED':
      return 'FINISHED';
    case 'FAILED':
    case 'FAIL':
      return 'FAILED';
    case 'RUNNING':
    case 'PROCESSING':
      return 'RUNNING';
    case 'QUEUEING':
    case 'QUEUED':
    case 'PENDING':
      return 'QUEUEING';
    default:
      return 'QUEUEING';
  }
}

export function useTaskManager({
  apiKey,
  onError,
  onTaskComplete,
  onTaskStatusChange,
}: TaskManagerOptions): TaskManagerReturn {
  const [tasks, setTasks] = useState<QueuedTask[]>([]);

  // All refs are always created (no conditional hooks)
  const apiKeyRef = useRef(apiKey);
  const pollingRef = useRef<Record<string, boolean>>({});
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onErrorRef = useRef(onError);
  const onTaskCompleteRef = useRef(onTaskComplete);
  const onTaskStatusChangeRef = useRef(onTaskStatusChange);
  const imagesExtractedRef = useRef<Record<string, boolean>>({});

  // All effects are always called (no conditional hooks)
  useEffect(() => { apiKeyRef.current = apiKey; }, [apiKey]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { onTaskCompleteRef.current = onTaskComplete; }, [onTaskComplete]);
  useEffect(() => { onTaskStatusChangeRef.current = onTaskStatusChange; }, [onTaskStatusChange]);

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

  const pollTask = useCallback(async (task: QueuedTask) => {
    const currentApiKey = apiKeyRef.current;
    if (!currentApiKey || !task.taskId) return;

    if (pollingRef.current[task.id]) return;
    pollingRef.current[task.id] = true;

    try {
      const statusResponse = await getTaskStatus(currentApiKey, task.taskId);
      const newStatus = mapTaskStatus(statusResponse.status);

      if (newStatus !== 'FINISHED' && newStatus !== 'FAILED') {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id ? { ...t, status: newStatus } : t
          )
        );
        onTaskStatusChangeRef.current?.(task.id, newStatus);
        delete pollingRef.current[task.id];
        return;
      }

      let zipUrl = task.zipUrl;
      let directImageUrls: string[] = task.images.length > 0 ? task.images : [];
      let coins = task.coins;
      let elapsed = task.elapsedSeconds;

      if (newStatus === 'FINISHED') {
        try {
          const resultsResponse = await getTaskResults(currentApiKey, task.taskId);
          if (resultsResponse.results && resultsResponse.results.length > 0) {
            const zipResult = resultsResponse.results.find((r) => r.outputType === 'zip');
            if (zipResult?.url) {
              zipUrl = zipResult.url;
            } else {
              const pngResults = resultsResponse.results.filter((r) =>
                r.outputType === 'png' || r.outputType === 'webp' ||
                r.fileType === 'png' || r.fileType === 'webp' ||
                r.url?.match(/\.(png|webp)(\?|$)/i)
              );
              if (pngResults.length > 0) {
                directImageUrls = pngResults.map((r) => r.url).filter(Boolean) as string[];
              }
            }
          }
          if (resultsResponse.usage?.consumeCoins) {
            coins = resultsResponse.usage.consumeCoins;
          }
          if (resultsResponse.usage?.taskCostTime) {
            elapsed = parseInt(resultsResponse.usage.taskCostTime, 10);
          }
        } catch {
          // If results fetch fails, use what we have
        }
      }

      const hasImages = (zipUrl && !imagesExtractedRef.current[task.id]) || (directImageUrls.length > 0 && !imagesExtractedRef.current[task.id]);
      const displayStatus = newStatus === 'FINISHED' && hasImages ? 'RUNNING' : newStatus;
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, status: displayStatus, zipUrl, coins, elapsedSeconds: elapsed } : t
        )
      );
      onTaskStatusChangeRef.current?.(task.id, displayStatus);

      if (newStatus === 'FINISHED') {
        unpersistTask(task.id);
        if (zipUrl) {
          if (imagesExtractedRef.current[task.id]) { delete pollingRef.current[task.id]; return; }
          imagesExtractedRef.current[task.id] = true;

          try {
            const [blobUrls, dataUrls] = await Promise.all([
              extractImagesFromZip(zipUrl),
              extractImagesFromZipAsDataUrls(zipUrl),
            ]);
            setTasks((prev) =>
              prev.map((t) =>
                t.id === task.id ? { ...t, status: 'FINISHED', images: blobUrls } : t
              )
            );
            cacheImages(zipUrl, dataUrls).catch(() => {});
            const updatedTask: QueuedTask = { ...task, status: 'FINISHED', zipUrl, coins, elapsedSeconds: elapsed, images: blobUrls };
            onTaskCompleteRef.current?.(updatedTask, elapsed);
          } catch (err) {
            console.error('[pollTask] Failed to extract images:', err);
            setTasks((prev) =>
              prev.map((t) =>
                t.id === task.id ? { ...t, status: 'FINISHED' } : t
              )
            );
            const updatedTask: QueuedTask = { ...task, status: 'FINISHED', zipUrl, coins, elapsedSeconds: elapsed };
            onTaskCompleteRef.current?.(updatedTask, elapsed);
          }
        } else if (directImageUrls.length > 0) {
          if (imagesExtractedRef.current[task.id]) { delete pollingRef.current[task.id]; return; }
          imagesExtractedRef.current[task.id] = true;
          setTasks((prev) =>
            prev.map((t) =>
              t.id === task.id ? { ...t, status: 'FINISHED', images: directImageUrls } : t
            )
          );
          cacheImages('', directImageUrls).catch(() => {});
          const updatedTask: QueuedTask = { ...task, status: 'FINISHED', zipUrl, coins, elapsedSeconds: elapsed, images: directImageUrls };
          onTaskCompleteRef.current?.(updatedTask, elapsed);
        } else {
          console.warn('[pollTask] No zipUrl or direct image URLs for finished task');
          const updatedTask: QueuedTask = { ...task, status: newStatus, zipUrl, coins, elapsedSeconds: elapsed };
          onTaskCompleteRef.current?.(updatedTask, elapsed);
        }
      } else if (newStatus === 'FAILED') {
        unpersistTask(task.id);
        let errorMsg = '任务失败';
        try {
          const resultsResponse = await getTaskResults(currentApiKey, task.taskId);
          if (resultsResponse.errorMessage) {
            errorMsg = resultsResponse.errorMessage;
          }
        } catch { /* ignore */ }
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id ? { ...t, error: errorMsg } : t
          )
        );
        onErrorRef.current?.(task.id, errorMsg);
      }
    } catch (err) {
      console.warn('Poll error for task', task.id, err);
    } finally {
      delete pollingRef.current[task.id];
    }
  }, []);

  // Polling loop
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setTasks((currentTasks) => {
        const activeTasks = currentTasks.filter(
          (t) => (t.status === 'QUEUEING' || t.status === 'RUNNING') && t.taskId
        );
        activeTasks.forEach((t) => pollTask(t));
        return currentTasks;
      });
    }, POLL_INTERVAL);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [pollTask]);

  const addTask = useCallback(
    async (
      workflowType: 'txt2img' | 'img2img' | 'img2vid',
      nodeInfoList: NodeInfo[],
      prompt: string,
      workflowIdOverride?: string,
      resultId?: string
    ): Promise<string> => {
      const currentApiKey = apiKeyRef.current;
      if (!currentApiKey) throw new Error('API Key not configured');

      const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const newTask: QueuedTask = {
        id,
        taskId: null,
        workflowType,
        status: 'QUEUEING',
        prompt,
        zipUrl: null,
        images: [],
        error: null,
        startTime: Date.now(),
        elapsedSeconds: 0,
        coins: null,
        nodeInfoList,
      };

      setTasks((prev) => {
        if (prev.length >= MAX_TASKS) return prev;
        return [...prev, newTask];
      });

      // Persist task so it can be restored after page refresh
      persistTask({ id, taskId: null, prompt, workflowType, workflowIdOverride, nodeInfoList, resultId, timestamp: Date.now() });

      try {
        const resolvedWorkflowId = workflowIdOverride
          || (workflowType === 'txt2img' ? WORKFLOW.TEXT_TO_IMAGE
            : workflowType === 'img2img' ? WORKFLOW.IMAGE_TO_IMAGE
            : WORKFLOW.IMAGE_TO_VIDEO);

        const data = await runTask(currentApiKey, resolvedWorkflowId, nodeInfoList);
        const taskId = data.taskId || '';
        if (!taskId) throw new Error('未获取到 taskId');

        const initialZipUrl = data.results?.find((r) => r.outputType === 'zip')?.url || null;
        let initialDirectImages: string[] = [];
        if (!initialZipUrl && data.results && data.results.length > 0) {
          const pngResults = data.results.filter((r) =>
            r.outputType === 'png' || r.outputType === 'webp' ||
            r.fileType === 'png' || r.fileType === 'webp' ||
            r.url?.match(/\.(png|webp)(\?|$)/i)
          );
          if (pngResults.length > 0) {
            initialDirectImages = pngResults.map((r) => r.url).filter(Boolean) as string[];
          }
        }
        const initialStatus = mapTaskStatus(data.status);
        const initialCoins = data.usage?.consumeCoins || null;
        const initialElapsed = data.usage?.taskCostTime ? parseInt(data.usage.taskCostTime, 10) : 0;

        setTasks((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, taskId, zipUrl: initialZipUrl, status: initialStatus, coins: initialCoins, elapsedSeconds: initialElapsed, images: initialDirectImages } : t
          )
        );
        // Update persisted entry with taskId so it can be restored after refresh
        persistTask({ id, taskId, prompt, workflowType, workflowIdOverride, nodeInfoList, resultId, timestamp: Date.now() });
        onTaskStatusChangeRef.current?.(id, initialStatus);

        if (initialStatus === 'FINISHED' && initialZipUrl) {
          unpersistTask(id);
          try {
            const [blobUrls, dataUrls] = await Promise.all([
              extractImagesFromZip(initialZipUrl),
              extractImagesFromZipAsDataUrls(initialZipUrl),
            ]);
            setTasks((prev) =>
              prev.map((t) => t.id === id ? { ...t, images: blobUrls } : t)
            );
            cacheImages(initialZipUrl, dataUrls).catch(() => {});
            onTaskCompleteRef.current?.({ ...newTask, taskId, images: blobUrls, zipUrl: initialZipUrl, coins: initialCoins, elapsedSeconds: initialElapsed }, initialElapsed);
          } catch {
            onTaskCompleteRef.current?.({ ...newTask, taskId, zipUrl: initialZipUrl, coins: initialCoins, elapsedSeconds: initialElapsed }, initialElapsed);
          }
        } else if (initialStatus === 'FINISHED' && initialDirectImages.length > 0) {
          unpersistTask(id);
          setTasks((prev) =>
            prev.map((t) => t.id === id ? { ...t, images: initialDirectImages } : t)
          );
          cacheImages('', initialDirectImages).catch(() => {});
          onTaskCompleteRef.current?.({ ...newTask, taskId, images: initialDirectImages, zipUrl: initialZipUrl, coins: initialCoins, elapsedSeconds: initialElapsed }, initialElapsed);
        } else if (initialStatus === 'FAILED') {
          unpersistTask(id);
          const errorMsg = data.errorMessage || '任务失败';
          setTasks((prev) => prev.map((t) => t.id === id ? { ...t, error: errorMsg } : t));
          onErrorRef.current?.(id, errorMsg);
        }
        return id;
      } catch (err) {
        unpersistTask(id);
        setTasks((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, status: 'FAILED' as TaskStatus, error: err instanceof Error ? err.message : '提交失败' } : t
          )
        );
        onErrorRef.current?.(id, err instanceof Error ? err.message : '提交失败');
        throw err;
      }
    },
    []
  );

  const cancelTask = useCallback((id: string) => {
    delete pollingRef.current[id];
    unpersistTask(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const regenerateTask = useCallback((id: string) => {
    setTasks((prev) => {
      const task = prev.find((t) => t.id === id);
      if (!task || task.status === 'QUEUEING' || task.status === 'RUNNING') return prev;
      if (prev.length >= MAX_TASKS) return prev;

      const newId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const newTask: QueuedTask = {
        ...task,
        id: newId,
        taskId: null,
        status: 'QUEUEING',
        zipUrl: null,
        images: [],
        error: null,
        startTime: Date.now(),
        elapsedSeconds: 0,
        coins: null,
      };

      const currentApiKey = apiKeyRef.current;
      if (currentApiKey) {
        const resolvedWorkflowId = task.workflowIdOverride
          || (task.workflowType === 'txt2img' ? WORKFLOW.TEXT_TO_IMAGE
            : task.workflowType === 'img2img' ? WORKFLOW.IMAGE_TO_IMAGE
            : WORKFLOW.IMAGE_TO_VIDEO);
        runTask(currentApiKey, resolvedWorkflowId, task.nodeInfoList)
          .then((data) => {
            const taskId = data.taskId || '';
            const initialStatus = mapTaskStatus(data.status);
            const initialCoins = data.usage?.consumeCoins || null;
            const initialZipUrl = data.results?.find((r) => r.outputType === 'zip')?.url || null;
            let initialDirectImages: string[] = [];
            if (!initialZipUrl && data.results && data.results.length > 0) {
              const pngResults = data.results.filter((r) =>
                r.outputType === 'png' || r.outputType === 'webp' ||
                r.fileType === 'png' || r.fileType === 'webp' ||
                r.url?.match(/\.(png|webp)(\?|$)/i)
              );
              if (pngResults.length > 0) {
                initialDirectImages = pngResults.map((r) => r.url).filter(Boolean) as string[];
              }
            }
            const initialElapsed = data.usage?.taskCostTime ? parseInt(data.usage.taskCostTime, 10) : 0;

            setTasks((current) =>
              current.map((t) =>
                t.id === newId ? { ...t, taskId, status: initialStatus, coins: initialCoins, zipUrl: initialZipUrl, elapsedSeconds: initialElapsed, images: initialDirectImages } : t
              )
            );
            onTaskStatusChangeRef.current?.(newId, initialStatus);

            if (initialStatus === 'FINISHED' && initialZipUrl) {
              Promise.all([extractImagesFromZip(initialZipUrl), extractImagesFromZipAsDataUrls(initialZipUrl)])
                .then(([blobUrls, dataUrls]) => {
                  setTasks((current) =>
                    current.map((t) => t.id === newId ? { ...t, images: blobUrls } : t)
                  );
                  cacheImages(initialZipUrl, dataUrls).catch(() => {});
                  onTaskCompleteRef.current?.({ ...newTask, taskId, images: blobUrls, zipUrl: initialZipUrl, coins: initialCoins, elapsedSeconds: initialElapsed }, initialElapsed);
                }).catch(() => {
                  onTaskCompleteRef.current?.({ ...newTask, taskId, zipUrl: initialZipUrl, coins: initialCoins, elapsedSeconds: initialElapsed }, initialElapsed);
                });
            } else if (initialStatus === 'FINISHED' && initialDirectImages.length > 0) {
              setTasks((current) =>
                current.map((t) => t.id === newId ? { ...t, images: initialDirectImages } : t)
              );
              cacheImages('', initialDirectImages).catch(() => {});
              onTaskCompleteRef.current?.({ ...newTask, taskId, images: initialDirectImages, zipUrl: initialZipUrl, coins: initialCoins, elapsedSeconds: initialElapsed }, initialElapsed);
            } else if (initialStatus === 'FAILED') {
              const errorMsg = data.errorMessage || '任务失败';
              setTasks((current) => current.map((t) => t.id === newId ? { ...t, error: errorMsg } : t));
              onErrorRef.current?.(newId, errorMsg);
            }
          }).catch((err) => {
            setTasks((current) =>
              current.map((t) =>
                t.id === newId ? { ...t, status: 'FAILED' as TaskStatus, error: err instanceof Error ? err.message : '提交失败' } : t
              )
            );
            onErrorRef.current?.(newId, err instanceof Error ? err.message : '提交失败');
          });
      }

      return [...prev, newTask];
    });
  }, []);

  const clearCompleted = useCallback(() => {
    setTasks((prev) =>
      prev.filter((t) => t.status !== 'FINISHED' && t.status !== 'FAILED')
    );
  }, []);

  const restoreTasks = useCallback(
    (entries: PersistedTaskEntry[]) => {
      if (entries.length === 0) return;
      const validEntries = entries.filter((e) => e.taskId);
      if (validEntries.length === 0) return;
      const restoredTasks: QueuedTask[] = validEntries.map((e) => ({
        id: e.id,
        taskId: e.taskId,
        workflowType: e.workflowType,
        status: 'RUNNING' as const,
        prompt: e.prompt,
        zipUrl: null,
        images: [],
        error: null,
        startTime: Date.now(),
        elapsedSeconds: 0,
        coins: null,
        nodeInfoList: e.nodeInfoList,
        workflowIdOverride: e.workflowIdOverride,
      }));
      setTasks((prev) => {
        const filtered = prev.filter((t) => !validEntries.some((e) => e.id === t.id));
        return [...filtered, ...restoredTasks];
      });
      restoredTasks.forEach((t) => {
        if (t.taskId) {
          pollingRef.current[t.id] = true;
          pollTask(t);
        }
      });
    },
    [pollTask]
  );

  return {
    tasks,
    isFull: tasks.length >= MAX_TASKS,
    addTask,
    addTaskWithNodeList: addTask,
    cancelTask,
    clearCompleted,
    regenerateTask,
    restoreTasks,
  };
}
