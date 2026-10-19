import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Image as ImageIcon, Sparkles, Upload, X, Layers, Ratio } from 'lucide-react';
import type { TaskManagerReturn } from '../hooks/useTaskManager';
import { MAX_TASKS } from '../hooks/useTaskManager';

// ─── 导演台 Krea2 / Krea2-muse 生图面板 ─────────────────────────────────────
// 复用 8765 导演台 IMG_WF_REGISTRY（krea2 文生图 / krea2-muse 角色参考写真，自杀式免扣分），
// 提交走 nsfwxo 后端 /api/daotai/image，任务统一进 taskManager 全局列表：
// - 顶部 TaskList 自动加载/轮询/显示图片
// - 刷新页面后 localStorage 持久化恢复任务继续轮询
// - 默认 batch=2，Krea2-muse 最多 3 张参考图（每个槽位独立选择/预览/删除）
// UI：顶部"生成引擎"切换（导演台 Krea2 文生图 / 导演台 Krea2-muse 图生图 / 官方直连）。

type EngineMode = 'krea2' | 'krea2-muse' | 'official';

interface DaotaiImageModel {
  wfid: string;
  name: string;
  key: string;
  t2i_only: boolean;
}

interface DaotaiImagePanelProps {
  apiKey: string;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  /** 页面默认引擎（文生图页=krea2，图生图页=krea2-muse） */
  defaultMode?: EngineMode;
  /** 图生图页从外部带入的参考图 URL */
  initialRefs?: string[];
  /** 任务管理：提交后任务进入 taskManager.tasks，由顶部 TaskList 统一显示。 */
  taskManager: TaskManagerReturn;
}

const RATIO_OPTIONS = [
  { value: '16:9', label: '16:9 横屏' },
  { value: '9:16', label: '9:16 竖屏' },
  { value: '1:1', label: '1:1 方形' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '21:9', label: '21:9 宽屏' },
];

const MAX_REFS = 3;
// 默认一次性生成 2 张（用户多次反馈"默认 1 张太少"）
const DEFAULT_BATCH = 2;

/** 三个独立参考图槽位（每槽一个本地文件或 URL） */
interface RefSlot {
  id: string;
  preview: string; // data:URL 或 http(s) URL，用于 <img> 预览
  isFile: boolean; // true=本地文件（要 base64 传给后端），false=URL
}

function newRefSlot(): RefSlot {
  return { id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, preview: '', isFile: false };
}

export function DaotaiImagePanel({
  apiKey,
  onError,
  onSuccess,
  defaultMode = 'krea2',
  initialRefs,
  taskManager,
}: DaotaiImagePanelProps) {
  const [engine, setEngine] = useState<EngineMode>(defaultMode);
  const [models, setModels] = useState<DaotaiImageModel[]>([]);
  const [modelKey, setModelKey] = useState<string>(defaultMode);
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState('16:9');
  const [batch, setBatch] = useState(DEFAULT_BATCH);
  // 三槽位参考图（i2i 模式下显示）
  const [refSlots, setRefSlots] = useState<RefSlot[]>(() => {
    if (initialRefs && initialRefs.length > 0) {
      return initialRefs.map(u => ({ id: `init-${Math.random().toString(36).slice(2, 7)}`, preview: u, isFile: false }));
    }
    return [newRefSlot(), newRefSlot(), newRefSlot()];
  });
  const [submitting, setSubmitting] = useState(false);

  // refs（防闭包过期）
  const modelKeyRef = useRef(modelKey);
  modelKeyRef.current = modelKey;
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;
  const batchRef = useRef(batch);
  batchRef.current = batch;
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  const refSlotsRef = useRef(refSlots);
  refSlotsRef.current = refSlots;
  const modelsRef = useRef(models);
  modelsRef.current = models;

  // 拉取导演台图片模型列表
  const loadModels = useCallback(async () => {
    try {
      const resp = await fetch('/api/daotai/image/models');
      const data = await resp.json();
      if (Array.isArray(data.models)) {
        setModels(data.models);
      }
    } catch {
      // 后端未就绪时用默认
      setModels([
        { wfid: '2101119999196127233', name: 'Krea2 最强N版（文生图）', key: 'krea2', t2i_only: true },
        { wfid: '2101585569259577346', name: 'Krea2-muse 角色参考写真（图生图）', key: 'krea2-muse', t2i_only: false },
        { wfid: '2104862502025711618', name: 'Qwen-Image-2.1（文生图+图生图）', key: 'qwen-image-2.1', t2i_only: false },
      ]);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  // 引擎切换时同步默认模型
  useEffect(() => {
    if (engine === 'krea2') setModelKey('krea2');
    else if (engine === 'krea2-muse') setModelKey('krea2-muse');
  }, [engine]);

  /** 槽位选择本地文件 → 转 data URL 写入预览 */
  const handleRefFile = useCallback((idx: number, file: File) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const url = reader.result as string;
      if (!url) return;
      setRefSlots(prev => {
        const next = [...prev];
        next[idx] = { id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, preview: url, isFile: true };
        return next;
      });
    };
    reader.readAsDataURL(file);
  }, []);

  /** 槽位填入 URL（不覆盖已有内容） */
  const setSlotUrl = useCallback((idx: number, url: string) => {
    setRefSlots(prev => {
      const next = [...prev];
      next[idx] = { id: `url-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, preview: url, isFile: false };
      return next;
    });
  }, []);

  const clearSlot = useCallback((idx: number) => {
    setRefSlots(prev => {
      const next = [...prev];
      next[idx] = newRefSlot();
      return next;
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!promptRef.current.trim()) {
      onError('请输入提示词');
      return;
    }
    if (taskManager.isFull) {
      onError(`任务队列已满（最多 ${MAX_TASKS} 个任务），请等待当前任务完成`);
      return;
    }

    const isI2i = modelKeyRef.current === 'krea2-muse' || (!modelsRef.current.find(m => m.key === modelKeyRef.current)?.t2i_only && refSlotsRef.current.some(s => s.preview));
    const finalModel = isI2i ? 'krea2-muse' : modelKeyRef.current === 'qwen-image-2.1' ? 'qwen-image-2.1' : 'krea2';

    // 只把"有图"的槽位提交（krea2 t2i 不传 refs；krea2-muse i2i 传所有非空 ref）
    const refs = isI2i
      ? refSlotsRef.current.map(s => s.preview).filter(Boolean)
      : [];

    setSubmitting(true);
    try {
      const taskId = await taskManager.addDaotaiImgTask(
        { model: finalModel, ratio: ratioRef.current, batch: batchRef.current, refs },
        promptRef.current,
      );
      onSuccess(`已提交导演台 ${finalModel === 'krea2-muse' ? 'Krea2-muse' : finalModel === 'qwen-image-2.1' ? 'Qwen-Image-2.1' : 'Krea2'} 生成，任务 ${taskId}`);
      // 提交后清空提示词（避免误重提）
      setPrompt('');
    } catch (err) {
      onError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  }, [taskManager, onError, onSuccess]);

  const selModel = models.find(m => m.key === modelKey);
  const isI2iEngine = modelKey === 'krea2-muse' || (!selModel?.t2i_only && refSlots.some(s => s.preview));

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-card p-4 space-y-3">
      {/* ── 生成引擎切换 ── */}
      <div>
        <div className="text-xs text-text-tertiary font-medium mb-2 flex items-center gap-1.5">
          <Sparkles size={12} /> 生成引擎
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setEngine('krea2')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              engine === 'krea2'
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border-subtle bg-surface-raised text-text-secondary hover:border-accent/50'
            }`}
          >
            导演台 Krea2 文生图<span className="ml-1 text-[10px] text-accent">免扣费</span>
          </button>
          <button
            type="button"
            onClick={() => setEngine('krea2-muse')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              engine === 'krea2-muse'
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border-subtle bg-surface-raised text-text-secondary hover:border-accent/50'
            }`}
          >
            导演台 Krea2-muse 图生图<span className="ml-1 text-[10px] text-accent">免扣费</span>
          </button>
          <button
            type="button"
            onClick={() => setEngine('official')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              engine === 'official'
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border-subtle bg-surface-raised text-text-secondary hover:border-accent/50'
            }`}
          >
            官方直连（下方原表单）
          </button>
        </div>
      </div>

      {engine === 'official' ? (
        <div className="text-sm text-text-tertiary rounded-lg bg-surface-raised px-3 py-2.5">
          已切换到官方直连引擎，请使用下方原有表单提交（按官方 RunningHub 扣费）。
        </div>
      ) : (
        <>
          {/* ── 模型 / 比例 / 张数 ── */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="text-xs text-text-tertiary font-medium mb-1">模型</div>
              <select
                value={modelKey}
                onChange={(e) => setModelKey(e.target.value)}
                className="w-full rounded-lg border border-border-subtle bg-surface-raised px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
              >
                {models.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-xs text-text-tertiary font-medium mb-1 flex items-center gap-1"><Ratio size={10} /> 比例</div>
              <select
                value={ratio}
                onChange={(e) => setRatio(e.target.value)}
                className="w-full rounded-lg border border-border-subtle bg-surface-raised px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
              >
                {RATIO_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-xs text-text-tertiary font-medium mb-1 flex items-center gap-1"><Layers size={10} /> 张数</div>
              <select
                value={batch}
                onChange={(e) => setBatch(Number(e.target.value))}
                className="w-full rounded-lg border border-border-subtle bg-surface-raised px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>{n} 张</option>
                ))}
              </select>
            </div>
          </div>

          {/* ── 参考图（图生图，3 个独立槽位） ── */}
          {isI2iEngine && (
            <div>
              <div className="text-xs text-text-tertiary font-medium mb-1.5 flex items-center gap-1">
                <ImageIcon size={12} /> 参考图（图生图，最多 {MAX_REFS} 张）
              </div>
              <div className="grid grid-cols-3 gap-2">
                {refSlots.map((slot, idx) => (
                  <RefSlotPicker
                    key={slot.id}
                    slot={slot}
                    index={idx}
                    onPickFile={(file) => handleRefFile(idx, file)}
                    onSetUrl={(url) => setSlotUrl(idx, url)}
                    onClear={() => clearSlot(idx)}
                    disabled={taskManager.isFull}
                  />
                ))}
              </div>
              <p className="text-[10px] text-text-tertiary mt-1.5">
                提示：3 个槽位独立选择/删除；可同时传本地文件或粘贴 URL；至少 1 张才能用图生图引擎。
              </p>
            </div>
          )}

          {/* ── 提示词 ── */}
          <div>
            <div className="text-xs text-text-tertiary font-medium mb-1">提示词</div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="输入图片描述，例如：cinematic portrait of a woman, soft warm light, 35mm film..."
              className="w-full rounded-lg border border-border-subtle bg-surface-raised px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent resize-y"
            />
          </div>

          {/* ── 提交 ── */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {submitting
              ? '提交中…'
              : `开始生成（导演台 ${
                  modelKey === 'krea2-muse' ? 'Krea2-muse' :
                  modelKey === 'qwen-image-2.1' ? 'Qwen-Image-2.1' : 'Krea2'
                }·免扣费）`}
          </button>

          <p className="text-[10px] text-text-tertiary text-center">
            任务提交后会在上方"任务列表"中显示，生成完成后图片会出现在列表缩略图条上。
          </p>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 单个参考图槽位组件：本地文件上传 / URL 粘贴 / 删除
// ─────────────────────────────────────────────────────────────────────
function RefSlotPicker({
  slot,
  index,
  onPickFile,
  onSetUrl,
  onClear,
  disabled,
}: {
  slot: RefSlot;
  index: number;
  onPickFile: (file: File) => void;
  onSetUrl: (url: string) => void;
  onClear: () => void;
  disabled: boolean;
}) {
  const [urlInput, setUrlInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (slot.preview) {
    return (
      <div className="relative aspect-square rounded-lg overflow-hidden border border-border-subtle group">
        <img src={slot.preview} alt={`ref${index + 1}`} className="w-full h-full object-cover" />
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 hover:bg-black/80 disabled:opacity-50"
          title="删除该参考图"
        >
          <X size={12} />
        </button>
        <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] px-1 py-0.5 text-center">
          图{index + 1}
        </div>
      </div>
    );
  }

  return (
    <div className="aspect-square rounded-lg border border-dashed border-border-subtle flex flex-col gap-1 p-1.5 text-text-tertiary">
      <div className="flex-1 flex items-center justify-center cursor-pointer hover:border-accent/50 hover:text-accent"
           onClick={() => fileInputRef.current?.click()}>
        <div className="flex flex-col items-center gap-0.5">
          <Upload size={16} />
          <span className="text-[10px]">图{index + 1} 上传</span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          disabled={disabled}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPickFile(f);
            e.target.value = '';
          }}
        />
      </div>
      <div className="flex gap-1">
        <input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="URL"
          disabled={disabled}
          className="flex-1 min-w-0 rounded border border-border-subtle bg-surface-raised px-1 py-0.5 text-[10px] text-text-primary focus:outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => {
            const u = urlInput.trim();
            if (u) {
              onSetUrl(u);
              setUrlInput('');
            }
          }}
          disabled={disabled || !urlInput.trim()}
          className="px-1.5 py-0.5 rounded border border-border-subtle bg-surface-raised text-[10px] text-text-secondary hover:border-accent/50 disabled:opacity-40"
          title="使用 URL"
        >
          填入
        </button>
      </div>
    </div>
  );
}
