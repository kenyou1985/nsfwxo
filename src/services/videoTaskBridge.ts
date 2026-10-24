export type ExternalVideoTask = {
  id: string;
  taskId: string;
  status: 'QUEUEING' | 'RUNNING' | 'FINISHED' | 'FAILED';
  prompt: string;
  imagePreview: string;
  images: string[];
  coins: string | null;
  elapsedSeconds: number;
  error: string | null;
  startTime: number;
  nodeInfoList: never[];
  engine: 'daotai';
  workflowId?: string;
};

const KEY = 'nsfwxo_external_video_tasks_v3';

export function publishExternalVideoTask(task: ExternalVideoTask): void {
  try {
    const list: ExternalVideoTask[] = JSON.parse(localStorage.getItem(KEY) || '[]');
    const next = [task, ...list.filter(t => t.id !== task.id)].slice(0, 30);
    localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('nsfwxo:external-video-task', { detail: task }));
  } catch {}
}

export function getExternalVideoTasks(): ExternalVideoTask[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
