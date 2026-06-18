import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  runTask,
  getTaskStatus,
  getTaskResults,
  extractImagesFromZip,
  extractImagesFromZipAsDataUrls,
  WORKFLOW,
} from '../services/runninghub';
import { cacheImages, getOrFetchTaskImages } from '../services/imageCacheService';
import type {
  QueuedTask,
  TaskStatus,
  NodeInfo,
} from '../types';

const POLL_INTERVAL = 10000;
export const MAX_TASKS = 100;
export const MAX_CONCURRENT = 5;
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
  zipUrl?: string | null; // Persisted for recovery after page refresh
  storyboardInfo?: { historyId: string; panelIdx: number }; // Storyboard panel association
  /** UI module that produced this task — used for history-page source tag. */
  source?: 'expand' | 'random' | 'smart-storyboard' | 'storyboard' | 'txt2img' | 'img2img' | 'img2vid';
  /** Storyboard / random theme title — also displayed on history cards. */
  themeTitle?: string;
  /** 1-based panel number for storyboard tasks. */
  panelNumber?: number;
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
  if (idx >= 0) {
    // Merge: keep existing zipUrl if not provided in new entry
    const existing = tasks[idx];
    tasks[idx] = {
      ...existing,
      ...entry,
      zipUrl: entry.zipUrl !== undefined ? entry.zipUrl : existing.zipUrl,
    };
  } else {
    tasks.push(entry);
  }
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
  /** Called when task images are fully extracted (data URLs available). */
  onTaskImagesReady?: (taskId: string, images: string[], storyboardInfo?: { historyId: string; panelIdx: number }, zipUrl?: string) => void;
}

export interface TaskManagerReturn {
  tasks: QueuedTask[];
  isFull: boolean;
  addTask: (
    workflowType: 'txt2img' | 'img2img' | 'img2vid',
    nodeInfoList: NodeInfo[],
    prompt: string,
    workflowIdOverride?: string,
    resultId?: string,
    storyboardInfo?: { historyId: string; panelIdx: number },
    source?: 'expand' | 'random' | 'smart-storyboard' | 'storyboard' | 'txt2img' | 'img2img' | 'img2vid',
    themeTitle?: string,
    panelNumber?: number
  ) => Promise<string>;
  addTaskWithNodeList: (
    workflowType: 'txt2img' | 'img2img' | 'img2vid',
    nodeInfoList: NodeInfo[],
    prompt: string,
    workflowIdOverride?: string,
    resultId?: string,
    storyboardInfo?: { historyId: string; panelIdx: number },
    source?: 'expand' | 'random' | 'smart-storyboard' | 'storyboard' | 'txt2img' | 'img2img' | 'img2vid',
    themeTitle?: string,
    panelNumber?: number
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
  onTaskImagesReady,
}: TaskManagerOptions): TaskManagerReturn {
  const [tasks, setTasks] = useState<QueuedTask[]>([]);

  // All refs are always created (no conditional hooks)
  const apiKeyRef = useRef(apiKey);
  const pollingRef = useRef<Record<string, boolean>>({});
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onErrorRef = useRef(onError);
  const onTaskCompleteRef = useRef(onTaskComplete);
  const onTaskStatusChangeRef = useRef(onTaskStatusChange);
  const onTaskImagesReadyRef = useRef(onTaskImagesReady);
  const imagesExtractedRef = useRef<Record<string, boolean>>({});
  const restoringRef = useRef<Record<string, boolean>>({});
  // Queue of task IDs waiting for a free concurrency slot.
  // Tasks in this queue are already shown in `tasks` with status QUEUEING,
  // but have no taskId yet (not yet submitted to RunningHub).
  const pendingQueueRef = useRef<string[]>([]);

  // All effects are always called (no conditional hooks)
  useEffect(() => { apiKeyRef.current = apiKey; }, [apiKey]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { onTaskCompleteRef.current = onTaskComplete; }, [onTaskComplete]);
  useEffect(() => { onTaskStatusChangeRef.current = onTaskStatusChange; }, [onTaskStatusChange]);
  useEffect(() => { onTaskImagesReadyRef.current = onTaskImagesReady; }, [onTaskImagesReady]);

  // 1. Timer effect - update elapsed time every second
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

  // 2. Helper: extract images for a finished task, update state, and call callbacks
  const extractFinishedTaskImages = useCallback(async (
    task: QueuedTask,
    currentApiKey: string,
    taskId: string
  ): Promise<{ updatedTask: QueuedTask }> => {
    let zipUrl: string | null = task.zipUrl;
    let directImageUrls: string[] = task.images.length > 0 ? task.images : [];
    let coins = task.coins;
    let elapsed = task.elapsedSeconds;

    try {
      const resultsResponse = await getTaskResults(currentApiKey, taskId);
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
      // Use defaults if results fetch fails
    }

    if (zipUrl) {
      try {
        const [blobUrls, dataUrls] = await Promise.all([
          extractImagesFromZip(zipUrl),
          extractImagesFromZipAsDataUrls(zipUrl),
        ]);
        // Use dataUrls as the source of truth — stored in cache and task.images
        const finalImages = dataUrls;
        await cacheImages(zipUrl, dataUrls);
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id ? { ...t, status: 'FINISHED', images: finalImages, zipUrl, coins, elapsedSeconds: elapsed } : t
          )
        );
        const updatedTask: QueuedTask = { ...task, status: 'FINISHED', zipUrl, coins, elapsedSeconds: elapsed, images: finalImages };
        onTaskCompleteRef.current?.(updatedTask, elapsed);
        onTaskImagesReadyRef.current?.(task.id, finalImages, task.storyboardInfo ?? undefined, task.zipUrl ?? undefined);
        return { updatedTask };
      } catch (err) {
        console.error('[extractFinishedTaskImages] Failed to extract images:', err);
        // Still try to recover blob URLs through cache
        const blobUrls = await extractImagesFromZip(zipUrl).catch(() => []);
        const finalImages = await getOrFetchTaskImages(zipUrl, blobUrls);
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id ? { ...t, status: 'FINISHED', images: finalImages, zipUrl, coins, elapsedSeconds: elapsed } : t
          )
        );
        const updatedTask: QueuedTask = { ...task, status: 'FINISHED', zipUrl, coins, elapsedSeconds: elapsed, images: finalImages };
        onTaskCompleteRef.current?.(updatedTask, elapsed);
        onTaskImagesReadyRef.current?.(task.id, finalImages, task.storyboardInfo ?? undefined, task.zipUrl ?? undefined);
        return { updatedTask };
      }
    } else if (directImageUrls.length > 0) {
      const finalImages = await getOrFetchTaskImages('', directImageUrls);
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, status: 'FINISHED', images: finalImages, zipUrl, coins, elapsedSeconds: elapsed } : t
        )
      );
      const updatedTask: QueuedTask = { ...task, status: 'FINISHED', zipUrl, coins, elapsedSeconds: elapsed, images: finalImages };
      onTaskCompleteRef.current?.(updatedTask, elapsed);
      onTaskImagesReadyRef.current?.(task.id, finalImages, task.storyboardInfo ?? undefined, task.zipUrl ?? undefined);
      return { updatedTask };
    } else {
      console.warn('[extractFinishedTaskImages] No zipUrl or direct image URLs for finished task');
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, status: 'FINISHED', zipUrl, coins, elapsedSeconds: elapsed } : t
        )
      );
      const updatedTask: QueuedTask = { ...task, status: 'FINISHED', zipUrl, coins, elapsedSeconds: elapsed };
      onTaskCompleteRef.current?.(updatedTask, elapsed);
      return { updatedTask };
    }
  }, []);

  // 3. Poll a single task
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

      if (newStatus === 'FAILED') {
        unpersistTask(task.id);
        inFlightRef.current.delete(task.id);
        drainPendingQueueRef.current();
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
        delete pollingRef.current[task.id];
        return;
      }

      // newStatus === 'FINISHED'
      unpersistTask(task.id);
      inFlightRef.current.delete(task.id);
      drainPendingQueueRef.current();

      // Skip extraction if restoreTasks is already handling this task
      if (restoringRef.current[task.id]) {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id ? { ...t, status: 'FINISHED' as TaskStatus, zipUrl, coins, elapsedSeconds: elapsed } : t
          )
        );
        delete pollingRef.current[task.id];
        return;
      }

      pollingRef.current[task.id] = true; // Re-set lock so extractFinishedTaskImages doesn't conflict with next poll cycle
      imagesExtractedRef.current[task.id] = true;

      extractFinishedTaskImages(
        { ...task, zipUrl, coins, elapsedSeconds: elapsed, images: directImageUrls },
        currentApiKey,
        task.taskId
      ).finally(() => {
        delete pollingRef.current[task.id];
      });
    } catch (err) {
      console.warn('Poll error for task', task.id, err);
      delete pollingRef.current[task.id];
    }
  }, [extractFinishedTaskImages]);

  // 4. Polling interval effect — depends on pollTask
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

  // Mirror of the latest tasks list, used by drainPendingQueue and addTask
  // to read state synchronously without relying on a stale closure or async
  // useEffect-driven ref sync. The ref is updated on every tasks change.
  const tasksRef = useRef<QueuedTask[]>([]);
  // Synchronous tracker of task IDs that have been submitted to RunningHub
  // and have not yet reached a terminal state (FINISHED/FAILED). Updated
  // immediately on submit and on completion, so the concurrency gate
  // always sees the correct in-flight count regardless of React batching.
  const inFlightRef = useRef<Set<string>>(new Set());
  // Per-task retry attempt count for server-side 421 backoff.
  const retryAttemptRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  // Use a ref to break the circular dependency between drainPendingQueue
  // (called by submitTask) and submitTask (called by drainPendingQueue).
  const drainPendingQueueRef = useRef<() => void>(() => {});

  // Internal: actually submit a task (already in `tasks` list) to RunningHub.
  // Used by both addTask (when slot is free) and drainPendingQueue.
  const submitTask = useCallback(
    (task: QueuedTask, attempt = 0) => {
      const currentApiKey = apiKeyRef.current;
      if (!currentApiKey) return;

      const { id, workflowType, nodeInfoList, prompt, storyboardInfo } = task;
      const workflowIdOverride = (task as QueuedTask & { workflowIdOverride?: string }).workflowIdOverride;
      const taskSource = task.source;

      const resolvedWorkflowId = workflowIdOverride
        || (workflowType === 'txt2img' ? WORKFLOW.TEXT_TO_IMAGE
          : workflowType === 'img2img' ? WORKFLOW.IMAGE_TO_IMAGE
          : WORKFLOW.IMAGE_TO_VIDEO);

      // Mark in-flight synchronously so concurrent addTask/drain calls see it.
      inFlightRef.current.add(id);

      runTask(currentApiKey, resolvedWorkflowId, nodeInfoList)
        .then((data) => {
          const taskId = data.taskId || '';

          // Server-side queue limit (HTTP 200 with errorCode 421). The task
          // never made it to RunningHub, so put it back at the head of the
          // pending queue and retry after a backoff delay. After MAX_RETRIES
          // attempts, give up and mark the task as failed so the user knows
          // to investigate (likely another device/tab is consuming the slot).
          const MAX_421_RETRIES = 8;
          if (!taskId && data.errorCode === '421') {
            inFlightRef.current.delete(id);
            const nextAttempt = attempt + 1;
            if (nextAttempt > MAX_421_RETRIES) {
              const finalMsg = '服务端并发数已满且多次重试仍被拒绝，请等待其他设备/页面的任务完成后再试';
              unpersistTask(id);
              setTasks((prev) =>
                prev.map((t) =>
                  t.id === id ? { ...t, status: 'FAILED' as TaskStatus, error: finalMsg } : t
                )
              );
              onErrorRef.current?.(id, finalMsg);
              drainPendingQueueRef.current();
              return;
            }
            const backoff = Math.min(15000, 2000 * Math.pow(1.5, attempt));
            console.warn(`[useTaskManager] Task ${id} hit server queue limit (421). Retrying in ${backoff}ms (attempt ${nextAttempt}/${MAX_421_RETRIES}).`);
            setTimeout(() => {
              // Re-insert at the head so it gets the next slot. Pass the
              // incremented attempt count so the next submitTask call also
              // has the updated retry count for its own backoff calculation.
              pendingQueueRef.current = [id, ...pendingQueueRef.current.filter((qid) => qid !== id)];
              // Stash the next attempt count on a per-id ref so we can pass it through.
              retryAttemptRef.current.set(id, nextAttempt);
              drainPendingQueueRef.current();
            }, backoff);
            return;
          }

          if (!taskId) {
            inFlightRef.current.delete(id);
            unpersistTask(id);
            setTasks((prev) =>
              prev.map((t) =>
                t.id === id ? { ...t, status: 'FAILED' as TaskStatus, error: data.errorMessage || '未获取到 taskId' } : t
              )
            );
            onErrorRef.current?.(id, data.errorMessage || '未获取到 taskId');
            drainPendingQueueRef.current();
            return;
          }

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
              t.id === id ? { ...t, taskId, zipUrl: initialZipUrl, status: 'QUEUEING', coins: initialCoins, elapsedSeconds: initialElapsed, images: initialDirectImages } : t
            )
          );
          persistTask({ id, taskId, prompt, workflowType, workflowIdOverride, nodeInfoList, resultId: undefined, timestamp: Date.now(), zipUrl: initialZipUrl, storyboardInfo, source: taskSource });
          onTaskStatusChangeRef.current?.(id, initialStatus);
          // Successfully submitted; clear any pending retry counter.
          retryAttemptRef.current.delete(id);

          if (initialStatus === 'FINISHED') {
            pollingRef.current[id] = true;
            const taskToExtract: QueuedTask = { ...task, taskId, zipUrl: initialZipUrl, coins: initialCoins, elapsedSeconds: initialElapsed, images: initialDirectImages };
            extractFinishedTaskImages(taskToExtract, currentApiKey, taskId)
              .then(({ updatedTask }) => {
                unpersistTask(updatedTask.id);
                delete pollingRef.current[updatedTask.id];
                inFlightRef.current.delete(id);
                drainPendingQueueRef.current();
              })
              .catch(() => {
                delete pollingRef.current[id];
                inFlightRef.current.delete(id);
                drainPendingQueueRef.current();
              });
          } else if (initialStatus === 'FAILED') {
            unpersistTask(id);
            const errorMsg = data.errorMessage || '任务失败';
            setTasks((prev) => prev.map((t) => t.id === id ? { ...t, error: errorMsg } : t));
            onErrorRef.current?.(id, errorMsg);
            inFlightRef.current.delete(id);
            retryAttemptRef.current.delete(id);
            drainPendingQueueRef.current();
          } else {
            // Task submitted successfully and is RUNNING/QUEUED server-side.
            // Keep it in the in-flight set; the polling loop will detect
            // completion and remove it.
            inFlightRef.current.add(id);
          }
        })
        .catch((err) => {
          inFlightRef.current.delete(id);
          retryAttemptRef.current.delete(id);
          unpersistTask(id);
          setTasks((prev) =>
            prev.map((t) =>
              t.id === id ? { ...t, status: 'FAILED' as TaskStatus, error: err instanceof Error ? err.message : '提交失败' } : t
            )
          );
          onErrorRef.current?.(id, err instanceof Error ? err.message : '提交失败');
          drainPendingQueueRef.current();
        });
    },
    [extractFinishedTaskImages]
  );

  // Pull the next pending task and submit it if a concurrency slot is free.
  // Defined after submitTask so we can capture it in closure; the function
  // body is exposed via drainPendingQueueRef so submitTask can call back into it.
  const drainPendingQueue = useCallback(() => {
    while (pendingQueueRef.current.length > 0 && inFlightRef.current.size < MAX_CONCURRENT) {
      const nextId = pendingQueueRef.current.shift();
      if (!nextId) break;
      if (inFlightRef.current.has(nextId)) continue;
      const taskToSubmit = tasksRef.current.find((t) => t.id === nextId && !t.taskId);
      if (!taskToSubmit) {
        // Task was cancelled while pending; skip it.
        continue;
      }
      const attempt = retryAttemptRef.current.get(nextId) ?? 0;
      submitTask(taskToSubmit, attempt);
    }
  }, [submitTask]);

  useEffect(() => {
    drainPendingQueueRef.current = drainPendingQueue;
  }, [drainPendingQueue]);

  const addTask = useCallback(
    async (
      workflowType: 'txt2img' | 'img2img' | 'img2vid',
      nodeInfoList: NodeInfo[],
      prompt: string,
      workflowIdOverride?: string,
      resultId?: string,
      storyboardInfo?: { historyId: string; panelIdx: number },
      source?: 'expand' | 'random' | 'smart-storyboard' | 'storyboard' | 'txt2img' | 'img2img' | 'img2vid',
      themeTitle?: string,
      panelNumber?: number,
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
        storyboardInfo,
        source,
        themeTitle,
        panelNumber,
      };

      setTasks((prev) => {
        if (prev.length >= MAX_TASKS) return prev;
        return [...prev, newTask];
      });

      persistTask({ id, taskId: null, prompt, workflowType, workflowIdOverride, nodeInfoList, resultId, timestamp: Date.now(), storyboardInfo: newTask.storyboardInfo, source, themeTitle, panelNumber });

      // Concurrency gate based on synchronous in-flight tracker.
      if (inFlightRef.current.size >= MAX_CONCURRENT) {
        pendingQueueRef.current.push(id);
        return id;
      }

      submitTask(newTask);
      return id;
    },
    [submitTask]
  );

  const cancelTask = useCallback((id: string) => {
    delete pollingRef.current[id];
    delete restoringRef.current[id];
    inFlightRef.current.delete(id);
    retryAttemptRef.current.delete(id);
    // If the task is still waiting in the pending queue, remove it from there
    // (no submission was ever made, so no slot is freed — but next drain
    // call will simply skip the missing id).
    pendingQueueRef.current = pendingQueueRef.current.filter((qid) => qid !== id);
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

            // Set QUEUEING initially so polling skips it while we extract images
            setTasks((current) =>
              current.map((t) =>
                t.id === newId ? { ...t, taskId, status: 'QUEUEING', coins: initialCoins, zipUrl: initialZipUrl, elapsedSeconds: initialElapsed, images: initialDirectImages } : t
              )
            );
            onTaskStatusChangeRef.current?.(newId, initialStatus);

            if (initialStatus === 'FINISHED') {
              pollingRef.current[newId] = true;
              const taskToExtract: QueuedTask = { ...newTask, taskId, zipUrl: initialZipUrl, coins: initialCoins, elapsedSeconds: initialElapsed, images: initialDirectImages };
              extractFinishedTaskImages(taskToExtract, currentApiKey, taskId)
                .then(({ updatedTask }) => {
                  unpersistTask(updatedTask.id);
                  delete pollingRef.current[updatedTask.id];
                })
                .catch(() => {
                  delete pollingRef.current[newId];
                });
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
  }, [extractFinishedTaskImages]);

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

      // Pre-fetch status for all tasks in parallel to determine which are already finished
      const currentApiKey = apiKeyRef.current;
      const statusPromises = validEntries.map(async (e) => {
        try {
          const statusResponse = await getTaskStatus(currentApiKey ?? '', e.taskId!);
          return { entry: e, status: statusResponse.status, results: null as Awaited<ReturnType<typeof getTaskResults>> | null };
        } catch {
          return { entry: e, status: 'UNKNOWN', results: null };
        }
      });

      Promise.all(statusPromises).then(async (statusResults) => {
        const currentApiKey = apiKeyRef.current;
        if (!currentApiKey) return;

        console.log('[restoreTasks] Status results:', statusResults.map(r => ({ id: r.entry.id, status: r.status })));
        const restoredTasks: QueuedTask[] = [];
        const immediatePollTasks: QueuedTask[] = [];

        for (const { entry, status } of statusResults) {
          const task: QueuedTask = {
            id: entry.id,
            taskId: entry.taskId!,
            workflowType: entry.workflowType,
            status: 'RUNNING' as const,
            prompt: entry.prompt,
            zipUrl: entry.zipUrl !== undefined ? entry.zipUrl : null, // Restore persisted zipUrl
            images: [],
            error: null,
            startTime: Date.now(),
            elapsedSeconds: 0,
            coins: null,
            nodeInfoList: entry.nodeInfoList,
            workflowIdOverride: entry.workflowIdOverride,
            storyboardInfo: entry.storyboardInfo,
            source: entry.source,
          };

          const mappedStatus = mapTaskStatus(status);
          console.log('[restoreTasks] Processing task:', task.id, 'status from API:', status, 'mapped:', mappedStatus, 'zipUrl:', task.zipUrl);

          if (mappedStatus === 'FINISHED') {
            // Set QUEUEING initially — polling interval will skip it while we extract images
            task.status = 'QUEUEING';
            restoredTasks.push(task);

            // Block pollTask from running during our async extraction (double safety)
            pollingRef.current[task.id] = true;
            restoringRef.current[task.id] = true;

            // Extract images without waiting for the polling loop
            if (!imagesExtractedRef.current[task.id]) {
              imagesExtractedRef.current[task.id] = true;
              extractFinishedTaskImages(task, currentApiKey, entry.taskId!)
                .then(({ updatedTask }) => {
                  unpersistTask(updatedTask.id);
                  delete pollingRef.current[updatedTask.id];
                  delete restoringRef.current[updatedTask.id];
                })
                .catch(() => {
                  delete pollingRef.current[task.id];
                  delete restoringRef.current[task.id];
                });
            } else {
              delete pollingRef.current[task.id];
              delete restoringRef.current[task.id];
            }
          } else if (mappedStatus === 'FAILED') {
            // Task failed - mark as failed
            task.status = 'FAILED';
            restoredTasks.push(task);
            unpersistTask(task.id);
          } else {
            // Task is still running/queuing server-side — track it in the
            // in-flight set so the concurrency gate accounts for it.
            task.status = mappedStatus;
            restoredTasks.push(task);
            immediatePollTasks.push(task);
            inFlightRef.current.add(task.id);
          }
        }

        if (restoredTasks.length === 0) return;

        setTasks((prev) => {
          const filtered = prev.filter((t) => !validEntries.some((e) => e.id === t.id));
          return [...filtered, ...restoredTasks];
        });

        // For tasks that are still running, poll immediately and then let the polling loop handle them
        for (const t of immediatePollTasks) {
          pollingRef.current[t.id] = true;
          pollTask(t).finally(() => {
            // Don't delete pollingRef.current[t.id] here - let the polling loop manage it
          });
        }
      });
    },
    [pollTask, extractFinishedTaskImages]
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
