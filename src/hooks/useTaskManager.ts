import { useState, useCallback, useRef, useEffect } from 'react';
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

const POLL_INTERVAL = 10000; // 10s - reduce API queue pressure
const MAX_TASKS = 20;

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
    workflowIdOverride?: string
  ) => Promise<string>;
  addTaskWithNodeList: (
    workflowType: 'txt2img' | 'img2img' | 'img2vid',
    nodeInfoList: NodeInfo[],
    prompt: string,
    workflowIdOverride?: string
  ) => Promise<string>;
  cancelTask: (id: string) => void;
  clearCompleted: () => void;
  regenerateTask: (id: string) => void;
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

  const apiKeyRef = useRef(apiKey);
  const pollingRef = useRef<Set<string>>(new Set()); // Prevent concurrent polls for same task
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onErrorRef = useRef(onError);
  const onTaskCompleteRef = useRef(onTaskComplete);
  const onTaskStatusChangeRef = useRef(onTaskStatusChange);
  const imagesExtractedRef = useRef<Record<string, boolean>>({}); // Track which tasks have completed image extraction

  useEffect(() => {
    apiKeyRef.current = apiKey;
  }, [apiKey]);
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

    // Prevent concurrent polls for the same task
    if (pollingRef.current.has(task.id)) return;
    pollingRef.current.add(task.id);

    try {
      // Step 1: Query simple status
      const statusResponse = await getTaskStatus(
        currentApiKey,
        task.taskId
      );

      const newStatus = mapTaskStatus(statusResponse.status);

      // If still running/queuing, just update status and done
      if (newStatus !== 'FINISHED' && newStatus !== 'FAILED') {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id ? { ...t, status: newStatus } : t
          )
        );
        onTaskStatusChangeRef.current?.(task.id, newStatus);
        return;
      }

      // Step 2: If finished, get full results with zip URL
      let zipUrl = task.zipUrl;
      let coins = task.coins;
      let elapsed = task.elapsedSeconds;

      if (newStatus === 'FINISHED') {
        try {
          const resultsResponse = await getTaskResults(currentApiKey, task.taskId);

          if (resultsResponse.results && resultsResponse.results.length > 0) {
            const zipResult = resultsResponse.results.find((r) => r.outputType === 'zip');
            if (zipResult?.url) {
              zipUrl = zipResult.url;
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

      // Keep as RUNNING until images are extracted, to avoid flash of "no images" state
      const displayStatus = newStatus === 'FINISHED' && zipUrl && !imagesExtractedRef.current[task.id] ? 'RUNNING' : newStatus;
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? { ...t, status: displayStatus, zipUrl, coins, elapsedSeconds: elapsed }
            : t
        )
      );
      onTaskStatusChangeRef.current?.(task.id, displayStatus);

      if (newStatus === 'FINISHED') {
        if (zipUrl) {
          // Skip if already extracting
          if (imagesExtractedRef.current[task.id]) return;
          imagesExtractedRef.current[task.id] = true;

          try {
            console.log('[pollTask] Extracting images from zip:', zipUrl);
            const [blobUrls, dataUrls] = await Promise.all([
              extractImagesFromZip(zipUrl),
              extractImagesFromZipAsDataUrls(zipUrl),
            ]);
            console.log('[pollTask] Extracted blobUrls:', blobUrls);
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
        } else {
          console.warn('[pollTask] No zipUrl available for finished task');
          const updatedTask: QueuedTask = { ...task, status: newStatus, zipUrl, coins, elapsedSeconds: elapsed };
          onTaskCompleteRef.current?.(updatedTask, elapsed);
        }
      } else if (newStatus === 'FAILED') {
        let errorMsg = '任务失败';
        try {
          const resultsResponse = await getTaskResults(currentApiKey, task.taskId);
          if (resultsResponse.errorMessage) {
            errorMsg = resultsResponse.errorMessage;
          }
        } catch {
          // ignore
        }
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id ? { ...t, error: errorMsg } : t
          )
        );
        onErrorRef.current?.(task.id, errorMsg);
      }
    } catch (err) {
      // Non-critical: don't propagate poll errors to UI
      console.warn('Poll error for task', task.id, err);
    } finally {
      pollingRef.current.delete(task.id);
    }
  }, []);

  // Polling loop - each active task gets polled once per interval
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(() => {
      setTasks((currentTasks) => {
        const activeTasks = currentTasks.filter(
          (t) => (t.status === 'QUEUEING' || t.status === 'RUNNING') && t.taskId
        );
        activeTasks.forEach((t) => pollTask(t));
        return currentTasks;
      });
    }, POLL_INTERVAL);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [pollTask]);

  const addTask = useCallback(
    async (
      workflowType: 'txt2img' | 'img2img' | 'img2vid',
      nodeInfoList: NodeInfo[],
      prompt: string,
      workflowIdOverride?: string
    ): Promise<string> => {
      const currentApiKey = apiKeyRef.current;
      if (!currentApiKey) {
        throw new Error('API Key not configured');
      }

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
        if (prev.length >= MAX_TASKS) {
          return prev;
        }
        return [...prev, newTask];
      });

      try {
        const resolvedWorkflowId = workflowIdOverride
          || (workflowType === 'txt2img' ? WORKFLOW.TEXT_TO_IMAGE
            : workflowType === 'img2img' ? WORKFLOW.IMAGE_TO_IMAGE
            : WORKFLOW.IMAGE_TO_VIDEO);

        const data = await runTask(
          currentApiKey,
          resolvedWorkflowId,
          nodeInfoList
        );

        const taskId = data.taskId || '';
        if (!taskId) {
          throw new Error('未获取到 taskId');
        }

        const initialZipUrl = data.results?.find((r) => r.outputType === 'zip')?.url || null;
        const initialStatus = mapTaskStatus(data.status);
        const initialCoins = data.usage?.consumeCoins || null;
        const initialElapsed = data.usage?.taskCostTime ? parseInt(data.usage.taskCostTime, 10) : 0;

        setTasks((prev) =>
          prev.map((t) =>
            t.id === id
              ? { ...t, taskId, zipUrl: initialZipUrl, status: initialStatus, coins: initialCoins, elapsedSeconds: initialElapsed }
              : t
          )
        );

        onTaskStatusChangeRef.current?.(id, initialStatus);

        if (initialStatus === 'FINISHED' && initialZipUrl) {
          let extractedImages: string[] = [];
          try {
            const [blobUrls, dataUrls] = await Promise.all([
              extractImagesFromZip(initialZipUrl),
              extractImagesFromZipAsDataUrls(initialZipUrl),
            ]);
            extractedImages = blobUrls;
            setTasks((prev) =>
              prev.map((t) => t.id === id ? { ...t, images: extractedImages } : t)
            );
            cacheImages(initialZipUrl, dataUrls).catch(() => {});
            // Call callback with images from the zip
            onTaskCompleteRef.current?.({ ...newTask, taskId, images: extractedImages, zipUrl: initialZipUrl, coins: initialCoins, elapsedSeconds: initialElapsed }, initialElapsed);
          } catch {
            // zip extraction failed, show zip URL anyway
            onTaskCompleteRef.current?.({ ...newTask, taskId, zipUrl: initialZipUrl, coins: initialCoins, elapsedSeconds: initialElapsed }, initialElapsed);
          }
        } else if (initialStatus === 'FAILED') {
          const errorMsg = data.errorMessage || '任务失败';
          setTasks((prev) => prev.map((t) => t.id === id ? { ...t, error: errorMsg } : t));
          onErrorRef.current?.(id, errorMsg);
        }
        // QUEUEING/RUNNING: polling loop will handle it

        return id;
      } catch (err) {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === id
              ? { ...t, status: 'FAILED' as TaskStatus, error: err instanceof Error ? err.message : '提交失败' }
              : t
          )
        );
        onErrorRef.current?.(id, err instanceof Error ? err.message : '提交失败');
        throw err;
      }
    },
    []
  );

  const cancelTask = useCallback((id: string) => {
    setTasks((prev) =>
      prev.filter((t) => t.id !== id)
    );
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

      // Submit API call outside of setState
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
            const initialElapsed = data.usage?.taskCostTime ? parseInt(data.usage.taskCostTime, 10) : 0;

            setTasks((current) =>
              current.map((t) =>
                t.id === newId
                  ? { ...t, taskId, status: initialStatus, coins: initialCoins, zipUrl: initialZipUrl, elapsedSeconds: initialElapsed }
                  : t
              )
            );
            onTaskStatusChangeRef.current?.(newId, initialStatus);

            if (initialStatus === 'FINISHED' && initialZipUrl) {
              Promise.all([
                extractImagesFromZip(initialZipUrl),
                extractImagesFromZipAsDataUrls(initialZipUrl),
              ]).then(([blobUrls, dataUrls]) => {
                setTasks((current) => {
                  return current.map((t) => t.id === newId ? { ...t, images: blobUrls } : t);
                });
                cacheImages(initialZipUrl, dataUrls).catch(() => {});
                onTaskCompleteRef.current?.({ ...newTask, taskId, images: blobUrls, zipUrl: initialZipUrl, coins: initialCoins, elapsedSeconds: initialElapsed }, initialElapsed);
              }).catch(() => {
                onTaskCompleteRef.current?.({ ...newTask, taskId, zipUrl: initialZipUrl, coins: initialCoins, elapsedSeconds: initialElapsed }, initialElapsed);
              });
            } else if (initialStatus === 'FAILED') {
              const errorMsg = data.errorMessage || '任务失败';
              setTasks((current) => current.map((t) => t.id === newId ? { ...t, error: errorMsg } : t));
              onErrorRef.current?.(newId, errorMsg);
            }
          }).catch((err) => {
            setTasks((current) =>
              current.map((t) =>
                t.id === newId
                  ? { ...t, status: 'FAILED' as TaskStatus, error: err instanceof Error ? err.message : '提交失败' }
                  : t
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

  return {
    tasks,
    isFull: tasks.length >= MAX_TASKS,
    addTask,
    addTaskWithNodeList: addTask,
    cancelTask,
    clearCompleted,
    regenerateTask,
  };
}
