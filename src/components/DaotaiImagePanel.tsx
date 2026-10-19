import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Sparkles, Ratio, ArrowLeftRight } from 'lucide-react';
import type { TaskManagerReturn } from '../hooks/useTaskManager';
import { MAX_TASKS } from '../hooks/useTaskManager';
import { QUALITY_BOOST_PROMPT, KREA2_TXT2IMG_PARAMS } from '../constants';
import { WORKFLOW } from '../services/runninghub';
import { buildTxt2ImgNodeList } from '../utils/txt2imgNodeBuilder';

// ─── 导演台 / 原官方 Krea2 文生图 ───────────────────────────────────────────
// 导演台 + 原官方 双模式文生图面板（受控组件）。
// 状态（mode / prompt / modelKey / ratio / batch）由父组件 TextToImagePage 管理：
//   - 底部「开始生成」按钮需要根据 mode 走不同分派（daotai ↔ 原官方 txt2img）
//   - 标签库 / 图片姿势预设 点击后需要在 daotai 模式下同步到本面板的 prompt
//   - 父组件持有唯一真相源，DaotaiImagePanel 只负责 UI 渲染 + 提交回调
//
// 提交时由父组件传入的 handleSubmit 统一调度，组件本身只暴露触发入口。

interface DaotaiImageModel {
  wfid: string;
  name: string;
  key: string;
  t2i_only: boolean;
}

export type DaotaiGenerationMode = 'daotai' | 'official';

interface DaotaiImagePanelProps {
  apiKey: string;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  /** 任务管理：提交后任务进入 taskManager.tasks，由顶部 TaskList 统一显示。 */
  taskManager: TaskManagerReturn;

  // ── 受控状态（父组件持有） ──
  generationMode: DaotaiGenerationMode;
  onGenerationModeChange: (mode: DaotaiGenerationMode) => void;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  modelKey: string;
  onModelKeyChange: (key: string) => void;
  ratio: string;
  onRatioChange: (ratio: string) => void;
  batch: number;
  onBatchChange: (batch: number) => void;
}

const RATIO_OPTIONS = [
  { value: '16:9', label: '16:9 横屏' },
  { value: '9:16', label: '9:16 竖屏' },
  { value: '1:1', label: '1:1 方形' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '21:9', label: '21:9 宽屏' },
];

// 导演台后端固定返回 2 张图（不管前端传 batch 多少），所以默认 1 即可
const DEFAULT_BATCH = 1;
// 原官方 Krea2 默认：800x1200 竖屏（与 KREA2_TXT2IMG_PARAMS 默认对齐）
const OFFICIAL_DEFAULT_BATCH = KREA2_TXT2IMG_PARAMS.imageCount;

export function DaotaiImagePanel({
  apiKey: _apiKey,
  onError,
  onSuccess,
  taskManager,
  generationMode,
  onGenerationModeChange,
  prompt,
  onPromptChange,
  modelKey,
  onModelKeyChange,
  ratio,
  onRatioChange,
  batch,
  onBatchChange,
}: DaotaiImagePanelProps) {
  // ── 模型列表（用于下拉菜单显示） ──
  const [models, setModels] = useState<DaotaiImageModel[]>([]);

  // 提交状态：仅控制按钮 disabled，不持有 prompt/ratio 等业务状态
  const [submitting, setSubmitting] = useState(false);

  // refs（防闭包过期）—— 镜像 props，确保 handleSubmit 读到最新值
  const modelKeyRef = useRef(modelKey);
  modelKeyRef.current = modelKey;
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;
  const batchRef = useRef(batch);
  batchRef.current = batch;
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  const generationModeRef = useRef(generationMode);
  generationModeRef.current = generationMode;

  // 拉取导演台图片模型列表（用于下拉菜单显示）
  const loadModels = useCallback(async () => {
    try {
      const resp = await fetch('/api/daotai/image/models');
      const data = await resp.json();
      if (Array.isArray(data.models)) {
        // 文生图模式只显示 t2i_only 模型 + 双向模型（qwen-image-2.1 同时支持文生图/图生图）
        const t2iModels = data.models.filter((m: DaotaiImageModel) => m.t2i_only || m.key === 'qwen-image-2.1');
        setModels(t2iModels);
      }
    } catch {
      // 后端未就绪时用默认
      setModels([
        { wfid: '2101119999196127233', name: 'Krea2 最强N版（文生图）', key: 'krea2', t2i_only: true },
        { wfid: '2104862502025711618', name: 'Qwen-Image-2.1（文生图）', key: 'qwen-image-2.1', t2i_only: false },
      ]);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  // ── 提交生成 ──────────────────────────────────────────────────────────
  // DaotaiImagePanel 自身的「开始生成」按钮（顶部面板内的按钮）走这个逻辑。
  // 父组件底部那个「开始生成」按钮在 daotai 模式下会调同样的 handleSubmitCore。
  const handleSubmitCore = useCallback(async () => {
    const userText = promptRef.current.trim();
    if (!userText) {
      onError('请输入提示词');
      return;
    }
    if (taskManager.isFull) {
      onError(`任务队列已满（最多 ${MAX_TASKS} 个任务），请等待当前任务完成`);
      return;
    }

    const finalPrompt = `${QUALITY_BOOST_PROMPT}, ${userText}`;
    const mode = generationModeRef.current;

    setSubmitting(true);
    try {
      if (mode === 'daotai') {
        // 导演台：免扣费；后端固定返回 2 张图，前端全量显示
        const finalModel = modelKeyRef.current === 'qwen-image-2.1' ? 'qwen-image-2.1' : 'krea2';
        const taskId = await taskManager.addDaotaiImgTask(
          { model: finalModel, ratio: ratioRef.current, batch: 1, refs: [] },
          finalPrompt,
        );
        onSuccess(`已提交导演台 ${finalModel === 'qwen-image-2.1' ? 'Qwen-Image-2.1' : 'Krea2'}，任务 ${taskId}`);
        onPromptChange('');
      } else {
        // 原官方：走 RunningHub WORKFLOW.KREA2；使用 KREA2_TXT2IMG_PARAMS 默认宽高 800x1200
        const nodeList = buildTxt2ImgNodeList({
          workflowId: WORKFLOW.KREA2,
          width: KREA2_TXT2IMG_PARAMS.width,
          height: KREA2_TXT2IMG_PARAMS.height,
          imageCount: batchRef.current || OFFICIAL_DEFAULT_BATCH,
          prompt: finalPrompt,
          negativePrompt: '',
          lora1Name: KREA2_TXT2IMG_PARAMS.lora1Name,
          lora1Weight: KREA2_TXT2IMG_PARAMS.lora1Weight,
          lora2Name: KREA2_TXT2IMG_PARAMS.lora2Name,
          lora2Weight: KREA2_TXT2IMG_PARAMS.lora2Weight,
          lora3Name: KREA2_TXT2IMG_PARAMS.lora3Name,
          lora3Weight: KREA2_TXT2IMG_PARAMS.lora3Weight,
          unet: KREA2_TXT2IMG_PARAMS.unet,
        });
        await taskManager.addTask('txt2img', nodeList, finalPrompt, WORKFLOW.KREA2);
        onSuccess('已提交原官方 Krea2 生成');
        onPromptChange('');
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  }, [taskManager, onError, onSuccess, onPromptChange]);

  const selModel = models.find((m) => m.key === modelKey);
  const isDaotai = generationMode === 'daotai';

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-card p-4 space-y-3">
      {/* ── 头部说明 + 模式切换按钮 ── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles size={14} className={isDaotai ? 'text-accent' : 'text-text-tertiary'} />
          <span className="text-sm font-medium text-text-primary">
            {isDaotai ? '导演台 Krea2 文生图' : '原官方 Krea2 文生图'}
          </span>
          {isDaotai ? (
            <span className="text-[10px] text-accent font-medium">免扣费</span>
          ) : (
            <span className="text-[10px] text-text-tertiary font-medium">扣费</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => onGenerationModeChange(isDaotai ? 'official' : 'daotai')}
          disabled={taskManager.isFull}
          className="flex items-center gap-1 px-2 py-1 rounded-lg border border-border-subtle bg-surface-elevated text-[10px] text-text-secondary hover:border-accent hover:text-accent disabled:opacity-50 transition-colors"
          title="切换生图模式：导演台 Krea2（免扣费）↔ 原官方 Krea2"
        >
          <ArrowLeftRight size={10} />
          {isDaotai ? '切换：原官方 Krea2' : '切换：导演台 Krea2'}
        </button>
      </div>

      {/* ── 模型 / 比例 / 张数 ── */}
      <div className="grid grid-cols-3 gap-2">
        {isDaotai ? (
          <div>
            <div className="text-xs text-text-tertiary font-medium mb-1">模型</div>
            <select
              value={modelKey}
              onChange={(e) => onModelKeyChange(e.target.value)}
              className="w-full rounded-lg border border-border-subtle bg-surface-raised px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
              disabled={taskManager.isFull}
            >
              {models.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex items-end">
            <div className="text-xs text-text-secondary font-medium">
              <div className="text-text-tertiary text-[10px] mb-0.5">模型</div>
              Krea2 文生图
            </div>
          </div>
        )}
        <div>
          <div className="text-xs text-text-tertiary font-medium mb-1 flex items-center gap-1"><Ratio size={10} /> 比例</div>
          <select
            value={ratio}
            onChange={(e) => onRatioChange(e.target.value)}
            className="w-full rounded-lg border border-border-subtle bg-surface-raised px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
            disabled={taskManager.isFull}
          >
            {RATIO_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
        <div>
          <div className="text-xs text-text-tertiary font-medium mb-1">张数</div>
          <select
            value={batch}
            onChange={(e) => onBatchChange(Number(e.target.value))}
            className="w-full rounded-lg border border-border-subtle bg-surface-raised px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
            disabled={taskManager.isFull}
          >
            {isDaotai ? (
              <>
                <option value={1}>2 张（固定）</option>
              </>
            ) : (
              [1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>{n} 张</option>
              ))
            )}
          </select>
        </div>
      </div>

      {/* ── 提示词 ── */}
      <div>
        <div className="text-xs text-text-tertiary font-medium mb-1">提示词</div>
        <textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          rows={3}
          placeholder="输入图片描述，例如：cinematic portrait of a woman, soft warm light, 35mm film..."
          className="w-full rounded-lg border border-border-subtle bg-surface-raised px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent resize-y"
          disabled={taskManager.isFull}
        />
      </div>

      {/* ── 提交（顶部面板自己的「开始生成」按钮，父组件底部还有另一个） ── */}
      <button
        type="button"
        onClick={handleSubmitCore}
        disabled={submitting || taskManager.isFull}
        className="w-full py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
      >
        {submitting
          ? '提交中…'
          : taskManager.isFull
          ? '队列已满'
          : isDaotai
          ? '开始生成（导演台 Krea2 · 免扣费）'
          : '开始生成（原官方 Krea2）'}
      </button>

      <p className="text-[10px] text-text-tertiary text-center">
        {isDaotai
          ? <>
              {selModel?.name && <>当前模型: {selModel.name} · </>}
              任务提交后会在上方「任务列表」中显示，完成后图片会出现在列表缩略图条上（导演台后端固定 2 张图）。
            </>
          : <>
              原官方 Krea2 走 RunningHub WORKFLOW.KREA2，使用 KREA2 默认 LoRA/UNet 配置。
            </>
        }
      </p>
    </div>
  );
}
