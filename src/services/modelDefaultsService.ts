import { WORKFLOW } from './runninghub';

const STORAGE_KEY = 'nsfwxo_model_defaults_v1';

export type DefaultScope = 'txt2img';

export interface ModelDefaultEntry {
  /** 模型文件名（带 .safetensors 后缀） */
  name: string;
  /** 展示标签（picker 里的 label），用于 UI 提示 */
  label?: string;
  /** LoRA 专用：默认权重；checkpoint 不存 */
  weight?: number;
}

export interface ModelDefaults {
  /** LoRA 1/2/3 的默认（仅 txt2img 模型用到） */
  lora1?: ModelDefaultEntry;
  lora2?: ModelDefaultEntry;
  lora3?: ModelDefaultEntry;
  /** Checkpoint 默认（按工作流分别存） */
  checkpoints: Partial<Record<string, ModelDefaultEntry>>;
}

const EMPTY_DEFAULTS: ModelDefaults = { checkpoints: {} };

function readAll(): ModelDefaults {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { checkpoints: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { checkpoints: {} };
    return {
      lora1: sanitizeEntry(parsed.lora1),
      lora2: sanitizeEntry(parsed.lora2),
      lora3: sanitizeEntry(parsed.lora3),
      checkpoints: parsed.checkpoints && typeof parsed.checkpoints === 'object' ? parsed.checkpoints : {},
    };
  } catch {
    return { checkpoints: {} };
  }
}

function sanitizeEntry(v: unknown): ModelDefaultEntry | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const e = v as Record<string, unknown>;
  if (typeof e.name !== 'string' || !e.name) return undefined;
  return {
    name: e.name,
    label: typeof e.label === 'string' ? e.label : undefined,
    weight: typeof e.weight === 'number' && Number.isFinite(e.weight) ? e.weight : undefined,
  };
}

function writeAll(d: ModelDefaults): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch (e) {
    console.warn('[modelDefaults] write failed', e);
  }
}

// 跨组件订阅
type Listener = () => void;
const listeners = new Set<Listener>();
function notify() {
  listeners.forEach((l) => l());
}
export function subscribeModelDefaults(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getModelDefaults(): ModelDefaults {
  return readAll();
}

export function getLoraDefault(slot: 'lora1' | 'lora2' | 'lora3'): ModelDefaultEntry | undefined {
  return readAll()[slot];
}

export function getCheckpointDefault(workflowId: string | undefined): ModelDefaultEntry | undefined {
  if (!workflowId) workflowId = WORKFLOW.THREE_LORA;
  return readAll().checkpoints[workflowId];
}

export function setLoraDefault(slot: 'lora1' | 'lora2' | 'lora3', entry: ModelDefaultEntry | null): void {
  const all = readAll();
  if (entry === null) {
    delete all[slot];
  } else {
    all[slot] = entry;
  }
  writeAll(all);
  notify();
}

export function setCheckpointDefault(workflowId: string, entry: ModelDefaultEntry | null): void {
  const all = readAll();
  if (entry === null) {
    delete all.checkpoints[workflowId];
  } else {
    all.checkpoints[workflowId] = entry;
  }
  writeAll(all);
  notify();
}

export function isLoraDefault(slot: 'lora1' | 'lora2' | 'lora3', name: string | undefined | null): boolean {
  if (!name) return false;
  const cur = readAll()[slot];
  return !!cur && cur.name === name;
}

export function isCheckpointDefault(workflowId: string | undefined, name: string | undefined | null): boolean {
  if (!name) return false;
  return readAll().checkpoints[workflowId || WORKFLOW.THREE_LORA]?.name === name;
}

export function clearAllModelDefaults(): void {
  writeAll(EMPTY_DEFAULTS);
  notify();
}
