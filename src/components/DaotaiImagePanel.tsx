import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Image as ImageIcon, Sparkles, Upload, X, Layers, Ratio } from 'lucide-react';
import { ImageGrid } from './ImageGrid';

// ─── 导演台 Krea2 / Krea2-muse 生图面板 ─────────────────────────────────────
// 复用 8765 导演台 IMG_WF_REGISTRY（krea2 文生图 / krea2-muse 角色参考写真，自杀式免扣分），
// 提交走 nsfwxo 后端 /api/daotai/image（独立复用，8765 端口停用也能生成），
// 与图生视频 det16 同一套免扣费机制。
// UI：顶部"生成引擎"直观切换（导演台 Krea2 文生图 / 导演台 Krea2-muse 图生图 / 官方直连）。

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
}

const RATIO_OPTIONS = [
  { value: '16:9', label: '16:9 横屏' },
  { value: '9:16', label: '9:16 竖屏' },
  { value: '1:1', label: '1:1 方形' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '21:9', label: '21:9 宽屏' },
];

export function DaotaiImagePanel({
  apiKey,
  onError,
  onSuccess,
  defaultMode = 'krea2',
  initialRefs,
}: DaotaiImagePanelProps) {
  const [engine, setEngine] = useState<EngineMode>(defaultMode);
  const [models, setModels] = useState<DaotaiImageModel[]>([]);
  const [modelKey, setModelKey] = useState<string>(defaultMode);
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState('16:9');
  const [batch, setBatch] = useState(1);
  const [refs, setRefs] = useState<string[]>(initialRefs || []);
  const [refUrlInput, setRefUrlInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [polling, setPolling] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const modelKeyRef = useRef(modelKey);
  modelKeyRef.current = modelKey;
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;
  const batchRef = useRef(batch);
  batchRef.current = batch;
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  const refsRef = useRef(refs);
  refsRef.current = refs;

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

  // 清理轮询
  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  const stopPoll = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    setPolling(false);
  }, []);

  const pollTask = useCallback((tid: string) => {
    stopPoll();
    setPolling(true);
    pollTimer.current = setInterval(async () => {
      try {
        const resp = await fetch('/api/daotai/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ taskId: tid }),
        });
        const data = await resp.json();
        if (data.status === 'SUCCESS') {
          setImages(data.images || []);
          setThumbs(data.thumbs || []);
          stopPoll();
          onSuccess('图片生成完成');
        } else if (data.status === 'FAILED') {
          stopPoll();
          onError(data.message || '图片任务失败');
        }
      } catch {
        // 网络抖动忽略，继续轮询
      }
    }, 5000);
  }, [apiKey, onError, onSuccess, stopPoll]);

  // 参考图：本地文件 → data URL（后端支持 base64 直传）
  const handleRefFile = useCallback(async (file: File) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const url = reader.result as string;
      if (url) {
        setRefs((prev) => (prev.includes(url) ? prev : [...prev, url].slice(0, 3)));
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const addRefUrl = useCallback(() => {
    const u = refUrlInput.trim();
    if (!u) return;
    setRefs((prev) => (prev.includes(u) ? prev : [...prev, u].slice(0, 3)));
    setRefUrlInput('');
  }, [refUrlInput]);

  const handleSubmit = useCallback(async () => {
    if (!promptRef.current.trim()) {
      onError('请输入提示词');
      return;
    }
    const isI2i = modelKeyRef.current === 'krea2-muse' || (!models.find((m) => m.key === modelKeyRef.current)?.t2i_only && refsRef.current.length > 0);
    const finalModel = isI2i ? 'krea2-muse' : modelKeyRef.current === 'qwen-image-2.1' ? 'qwen-image-2.1' : 'krea2';
    setSubmitting(true);
    try {
      const resp = await fetch('/api/daotai/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: finalModel,
          prompt: promptRef.current,
          ratio: ratioRef.current,
          batch: batchRef.current,
          refs: isI2i ? refsRef.current : [],
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || `HTTP ${resp.status}`);
      }
      const tid = data.taskId || data.task_id;
      if (!tid) {
        throw new Error('提交成功但未返回 taskId');
      }
      setTaskId(tid);
      setImages([]);
      setThumbs([]);
      onSuccess(`已提交导演台 ${finalModel === 'krea2-muse' ? 'Krea2-muse' : 'Krea2'} 生成，任务 ${tid}`);
      pollTask(tid);
    } catch (err) {
      onError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  }, [apiKey, onError, onSuccess, pollTask, models]);

  const selModel = models.find((m) => m.key === modelKey);
  const isI2iEngine = modelKey === 'krea2-muse' || (!selModel?.t2i_only && refs.length > 0);

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

          {/* ── 参考图（图生图） ── */}
          {isI2iEngine && (
            <div>
              <div className="text-xs text-text-tertiary font-medium mb-1.5 flex items-center gap-1">
                <ImageIcon size={12} /> 参考图（图生图，最多 3 张）
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                {refs.map((r, i) => (
                  <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-border-subtle">
                    <img src={r} alt={`ref${i + 1}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setRefs((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
                {refs.length < 3 && (
                  <label className="w-16 h-16 rounded-lg border border-dashed border-border-subtle flex flex-col items-center justify-center cursor-pointer text-text-tertiary hover:border-accent/50">
                    <Upload size={14} />
                    <span className="text-[9px] mt-0.5">上传</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleRefFile(f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                )}
              </div>
              <div className="flex gap-2 mt-2">
                <input
                  value={refUrlInput}
                  onChange={(e) => setRefUrlInput(e.target.value)}
                  placeholder="或粘贴参考图 URL 后添加"
                  className="flex-1 rounded-lg border border-border-subtle bg-surface-raised px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={addRefUrl}
                  className="px-3 py-1.5 rounded-lg bg-surface-raised border border-border-subtle text-xs text-text-secondary hover:border-accent/50"
                >
                  添加
                </button>
              </div>
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
            disabled={submitting || polling}
            className="w-full py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {submitting ? '提交中…' : polling ? '生成中…' : `开始生成（导演台 ${modelKey === 'krea2-muse' ? 'Krea2-muse' : 'Krea2'}·免扣费）`}
          </button>

          {/* ── 结果 ── */}
          {(images.length > 0 || polling) && (
            <div>
              <div className="text-xs text-text-tertiary font-medium mb-2">
                生成结果{taskId ? `（任务 ${taskId}）` : ''}
              </div>
              <ImageGrid
                images={images.length > 0 ? thumbs.filter(Boolean).length > 0 ? thumbs : images : []}
                isLoading={polling && images.length === 0}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
