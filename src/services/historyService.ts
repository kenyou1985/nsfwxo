import type { QueuedTask, NodeInfo } from '../types';

export interface HistoryRecord {
  id: string;
  name: string;
  taskId?: string;
  workflowType: 'txt2img' | 'img2img' | 'img2vid';
  prompt: string;
  params: Record<string, unknown>;
  nodeInfoList?: NodeInfo[];
  images: string[];
  zipUrl: string | null;
  coins: string | null;
  createdAt: number;
}

const STORAGE_KEY = 'nsfwxo_history';
const MAX_RECORDS = 100;

function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function generateId(): string {
  const dateStr = formatDate(Date.now());
  const random = Math.random().toString(36).slice(2, 6);
  return `${dateStr}_${random}`;
}

export function createRecord(
  workflowType: 'txt2img' | 'img2img',
  prompt: string,
  params: Record<string, unknown>,
  images: string[],
  zipUrl: string | null,
  coins: string | null
): HistoryRecord {
  return {
    id: generateId(),
    name: generateId(),
    workflowType,
    prompt,
    params,
    images,
    zipUrl,
    coins,
    createdAt: Date.now(),
  };
}

export function saveRecord(record: HistoryRecord): void {
  const records = getRecords();
  records.unshift(record);
  if (records.length > MAX_RECORDS) {
    records.splice(MAX_RECORDS);
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (e) {
    console.warn('Failed to save history:', e);
  }
}

export function getRecords(): HistoryRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HistoryRecord[];
  } catch {
    return [];
  }
}

export function deleteRecord(id: string): void {
  const records = getRecords().filter((r) => r.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export function clearAllHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function renameRecord(id: string, newName: string): void {
  const records = getRecords().map((r) =>
    r.id === id ? { ...r, name: newName } : r
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export function saveTaskToHistory(task: QueuedTask): void {
  if (task.status !== 'FINISHED') return;
  const records = getRecords();
  if (task.taskId && records.some((r) => r.taskId === task.taskId)) return;
  const record: HistoryRecord = {
    id: `${task.id}-${Date.now()}`,
    name: generateId(),
    taskId: task.taskId || undefined,
    workflowType: task.workflowType,
    prompt: task.prompt,
    params: {},
    nodeInfoList: task.nodeInfoList,
    // Store empty images — they will be restored from cache/zipUrl on load
    images: [],
    zipUrl: task.zipUrl,
    coins: task.coins,
    createdAt: Date.now(),
  };
  saveRecord(record);
}
