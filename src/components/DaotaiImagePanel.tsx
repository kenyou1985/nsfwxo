import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Image as ImageIcon, Sparkles, Ratio, Tag as TagIcon, User, X } from 'lucide-react';
import type { TaskManagerReturn } from '../hooks/useTaskManager';
import { MAX_TASKS } from '../hooks/useTaskManager';
import { TagSelector } from './TagSelector';
import { PosePresetSelector } from './PosePresetSelector';
import { GirlfriendSelector } from './GirlfriendSelector';
import { QUALITY_BOOST_PROMPT } from '../constants';
import type { GirlfriendPreset } from '../data/girlfriendPresets';
import type { WeightMode } from './PromptEditor';

// ─── 导演台 Krea2 文生图面板 ────────────────────────────────────────────────────
// 复用 8765 导演台 IMG_WF_REGISTRY 中的 Krea2 文生图工作流（自杀式免扣分），
// 提交走 nsfwxo 后端 /api/daotai/image，任务统一进 taskManager 全局列表：
// - 顶部 TaskList 自动加载/轮询/显示图片
// - 刷新页面后 localStorage 持久化恢复任务继续轮询
// - 默认 batch=1（导演台后端固定返回 2 张图，前端全量显示）
//
// 内嵌复用：
// - 数字人女友 GirlfriendSelector（characterPrompt + 多女友身份锚点）
// - 图片姿势预设 PosePresetSelector（pose prompt 注入）
// - 标签库 TagSelector + 选中 tag 列表（tag 拼接到最终 prompt）
// 这些组件各自维护独立的 state，独立于 TextToImagePage 官方工作流的同名组件。

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

// 导演台后端固定返回 2 张图（不管前端传 batch 多少），所以默认 1 即可
const DEFAULT_BATCH = 1;

interface SelectedTag {
  tag: string;
  weight: WeightMode;
  order: number;
}

export function DaotaiImagePanel({
  apiKey,
  onError,
  onSuccess,
  taskManager,
}: DaotaiImagePanelProps) {
  // ── 模型 / 比例 / 张数 ──
  const [models, setModels] = useState<DaotaiImageModel[]>([]);
  const [modelKey, setModelKey] = useState<string>('krea2');
  const [ratio, setRatio] = useState('16:9');
  const [batch, setBatch] = useState(DEFAULT_BATCH);

  // ── 提示词 ──
  const [prompt, setPrompt] = useState('');
  // 数字人锚点（多选 → 多女友身份锚点）
  const [selectedGirlfriends, setSelectedGirlfriends] = useState<GirlfriendPreset[]>([]);
  // 选中姿势预设（注入到最终 prompt）
  const [posePrompt, setPosePrompt] = useState<string>('');
  const [poseName, setPoseName] = useState<string>('');
  // 标签库：正/反 tag + 自定义 prompt + 显示语言
  const [positiveTags, setPositiveTags] = useState<SelectedTag[]>([]);
  const [negativeTags, setNegativeTags] = useState<SelectedTag[]>([]);
  const [tagCounter, setTagCounter] = useState(0);
  const [tagDisplayLang, setTagDisplayLang] = useState<'en' | 'zh'>('zh');
  const [tagRandomPrompt, setTagRandomPrompt] = useState(true);

  // ── 折叠状态 ──
  const [girlfriendOpen, setGirlfriendOpen] = useState(false);
  const [poseOpen, setPoseOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);

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
  const modelsRef = useRef(models);
  modelsRef.current = models;
  const girlfriendsRef = useRef(selectedGirlfriends);
  girlfriendsRef.current = selectedGirlfriends;
  const posePromptRef = useRef(posePrompt);
  posePromptRef.current = posePrompt;
  const positiveTagsRef = useRef(positiveTags);
  positiveTagsRef.current = positiveTags;
  const negativeTagsRef = useRef(negativeTags);
  negativeTagsRef.current = negativeTags;
  const tagRandomPromptRef = useRef(tagRandomPrompt);
  tagRandomPromptRef.current = tagRandomPrompt;

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

  // ── Tag handlers（独立 state） ──
  const handleAddTag = useCallback((tag: string) => {
    const exists = [...positiveTags, ...negativeTags].some((t) => t.tag === tag);
    if (exists) return;
    setTagCounter((c) => c + 1);
    setPositiveTags((prev) => [...prev, { tag, weight: 'none', order: tagCounter }]);
  }, [positiveTags, negativeTags, tagCounter]);

  const handleRemoveTag = useCallback((tag: string) => {
    setPositiveTags((prev) => prev.filter((t) => t.tag !== tag));
    setNegativeTags((prev) => prev.filter((t) => t.tag !== tag));
  }, []);

  const handleUpdateTagWeight = useCallback((tag: string, weight: WeightMode) => {
    if (weight === 'negative') {
      const inPositive = positiveTagsRef.current.some((t) => t.tag === tag);
      const inNegative = negativeTagsRef.current.some((t) => t.tag === tag);
      if (inPositive) {
        setPositiveTags((prev) => prev.filter((t) => t.tag !== tag));
        setTagCounter((c) => c + 1);
        setNegativeTags((prev) => [...prev, { tag, weight: 'negative', order: tagCounter }]);
      } else if (!inNegative) {
        setTagCounter((c) => c + 1);
        setNegativeTags((prev) => [...prev, { tag, weight: 'negative', order: tagCounter }]);
      }
    } else if (weight === 'positive') {
      const inPositive = positiveTagsRef.current.some((t) => t.tag === tag);
      const inNegative = negativeTagsRef.current.some((t) => t.tag === tag);
      if (inNegative) {
        setNegativeTags((prev) => prev.filter((t) => t.tag !== tag));
        setTagCounter((c) => c + 1);
        setPositiveTags((prev) => [...prev, { tag, weight: 'positive', order: tagCounter }]);
      } else if (!inPositive) {
        setTagCounter((c) => c + 1);
        setPositiveTags((prev) => [...prev, { tag, weight: 'positive', order: tagCounter }]);
      }
    } else {
      setPositiveTags((prev) => prev.map((t) => t.tag === tag ? { ...t, weight } : t));
      setNegativeTags((prev) => prev.map((t) => t.tag === tag ? { ...t, weight } : t));
    }
  }, [tagCounter]);

  const handleClearAllTags = useCallback(() => {
    setPositiveTags([]);
    setNegativeTags([]);
    setTagCounter(0);
  }, []);

  // ── 姿势预设选择 ──
  const handlePoseSelect = useCallback((pose: string, name: string) => {
    setPosePrompt(pose);
    setPoseName(name);
    onSuccess(`已切换姿势: ${name}`);
  }, [onSuccess]);

  // ── 数字人选择（多选 + 单选统一处理） ──
  const handleGirlfriendSelect = useCallback((gf: GirlfriendPreset) => {
    const gfId = gf.isCustom ? `custom_${gf.id}` : gf.id;
    // 已选 → 取消；未选 → 加入
    setSelectedGirlfriends((prev) => {
      const idx = prev.findIndex((g) => (g.isCustom ? `custom_${g.id}` : g.id) === gfId);
      if (idx >= 0) {
        const next = prev.filter((_, i) => i !== idx);
        onSuccess?.(`已取消数字人「${gf.nameZh || gf.name}」`);
        return next;
      }
      const next = [...prev, gf];
      onSuccess?.(`已选择数字人「${gf.nameZh || gf.name}」`);
      return next;
    });
  }, [onSuccess]);

  // ── 构建最终 prompt（多女友身份锚点 + tag + 姿势 + 用户输入 + 质量增强） ──
  const buildFinalPrompt = useCallback((): string => {
    const parts: string[] = [];
    // 1) 数字人 characterPrompt
    girlfriendsRef.current.forEach((gf) => {
      if (gf.characterPrompt) parts.push(gf.characterPrompt);
    });
    // 2) 正向 tag（带权重）
    positiveTagsRef.current.forEach((t) => {
      if (t.weight === 'positive') parts.push(`(${t.tag}:1.3)`);
      else parts.push(t.tag);
    });
    // 3) 用户输入的 prompt
    const userText = promptRef.current.trim();
    if (userText) parts.push(userText);
    // 4) 姿势预设
    if (posePromptRef.current) parts.push(posePromptRef.current);
    // 5) 质量增强
    if (tagRandomPromptRef.current) parts.push(QUALITY_BOOST_PROMPT);
    return parts.join(', ');
  }, []);

  const handleSubmit = useCallback(async () => {
    const finalPrompt = buildFinalPrompt();
    if (!finalPrompt.trim()) {
      onError('请输入提示词或选择至少一个标签');
      return;
    }
    if (taskManager.isFull) {
      onError(`任务队列已满（最多 ${MAX_TASKS} 个任务），请等待当前任务完成`);
      return;
    }

    const finalModel = modelKeyRef.current === 'qwen-image-2.1' ? 'qwen-image-2.1' : 'krea2';

    setSubmitting(true);
    try {
      const taskId = await taskManager.addDaotaiImgTask(
        { model: finalModel, ratio: ratioRef.current, batch: batchRef.current, refs: [] },
        finalPrompt,
      );
      onSuccess(`已提交导演台 ${finalModel === 'qwen-image-2.1' ? 'Qwen-Image-2.1' : 'Krea2'} 生成，任务 ${taskId}`);
      // 提交后清空提示词（避免误重提）
      setPrompt('');
    } catch (err) {
      onError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  }, [buildFinalPrompt, taskManager, onError, onSuccess]);

  const selModel = models.find((m) => m.key === modelKey);

  // 总选中的标签数量（用于折叠面板角标）
  const totalSelected = useMemo(
    () => positiveTags.length + negativeTags.length + selectedGirlfriends.length + (posePrompt ? 1 : 0),
    [positiveTags, negativeTags, selectedGirlfriends, posePrompt],
  );

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-card p-4 space-y-3">
      {/* ── 头部说明 ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Sparkles size={14} className="text-accent" />
          <span className="text-sm font-medium text-text-primary">导演台 Krea2 文生图</span>
          <span className="text-[10px] text-accent font-medium">免扣费</span>
        </div>
        <span className="text-[10px] text-text-tertiary">
          {totalSelected > 0 ? `已配 ${totalSelected} 项` : '未配置'}
        </span>
      </div>

      {/* ── 模型 / 比例 / 张数 ── */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <div className="text-xs text-text-tertiary font-medium mb-1">模型</div>
          <select
            value={modelKey}
            onChange={(e) => setModelKey(e.target.value)}
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
        <div>
          <div className="text-xs text-text-tertiary font-medium mb-1 flex items-center gap-1"><Ratio size={10} /> 比例</div>
          <select
            value={ratio}
            onChange={(e) => setRatio(e.target.value)}
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
            onChange={(e) => setBatch(Number(e.target.value))}
            className="w-full rounded-lg border border-border-subtle bg-surface-raised px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
            disabled={taskManager.isFull}
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>{n} 张</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── 数字人女友（折叠面板）── */}
      <div className="border border-border-subtle rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setGirlfriendOpen((v) => !v)}
          disabled={taskManager.isFull}
          className="w-full px-3 py-2 flex items-center justify-between bg-surface-elevated hover:bg-surface-hover transition-colors text-xs disabled:opacity-50"
        >
          <div className="flex items-center gap-1.5">
            <User size={12} className="text-text-tertiary" />
            <span className="font-medium text-text-secondary">数字人女友</span>
            {selectedGirlfriends.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium">
                已选 {selectedGirlfriends.length}
              </span>
            )}
          </div>
          <svg
            className={`w-3.5 h-3.5 text-text-tertiary transition-transform ${girlfriendOpen ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {girlfriendOpen && (
          <div className="p-2 border-t border-border-subtle">
            <GirlfriendSelector
              selectedIds={selectedGirlfriends.map((g) => g.isCustom ? `custom_${g.id}` : g.id)}
              onSelect={handleGirlfriendSelect}
              disabled={taskManager.isFull}
            />
          </div>
        )}
      </div>

      {/* ── 图片姿势预设（折叠面板）── */}
      <div className="border border-border-subtle rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setPoseOpen((v) => !v)}
          disabled={taskManager.isFull}
          className="w-full px-3 py-2 flex items-center justify-between bg-surface-elevated hover:bg-surface-hover transition-colors text-xs disabled:opacity-50"
        >
          <div className="flex items-center gap-1.5">
            <ImageIcon size={12} className="text-text-tertiary" />
            <span className="font-medium text-text-secondary">图片姿势预设</span>
            {poseName && (
              <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium">
                {poseName}
              </span>
            )}
          </div>
          <svg
            className={`w-3.5 h-3.5 text-text-tertiary transition-transform ${poseOpen ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {poseOpen && (
          <div className="border-t border-border-subtle">
            <PosePresetSelector
              type="image"
              onSelect={handlePoseSelect}
              disabled={taskManager.isFull}
              selectedGirlfriends={selectedGirlfriends}
              forceUnlock={selectedGirlfriends.length > 0}
            />
          </div>
        )}
      </div>

      {/* ── 标签库（折叠面板）── */}
      <div className="border border-border-subtle rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setTagsOpen((v) => !v)}
          disabled={taskManager.isFull}
          className="w-full px-3 py-2 flex items-center justify-between bg-surface-elevated hover:bg-surface-hover transition-colors text-xs disabled:opacity-50"
        >
          <div className="flex items-center gap-1.5">
            <TagIcon size={12} className="text-text-tertiary" />
            <span className="font-medium text-text-secondary">标签库</span>
            {(positiveTags.length + negativeTags.length) > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium">
                {positiveTags.length + negativeTags.length}
              </span>
            )}
          </div>
          <svg
            className={`w-3.5 h-3.5 text-text-tertiary transition-transform ${tagsOpen ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {tagsOpen && (
          <div className="border-t border-border-subtle">
            <div className="flex items-center justify-between px-2 pt-2">
              <span className="text-[10px] text-text-tertiary">
                已选 {positiveTags.length + negativeTags.length} 个标签
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setTagRandomPrompt((v) => !v)}
                  className={`text-[10px] px-2 py-0.5 rounded-lg border transition-colors ${
                    tagRandomPrompt
                      ? 'bg-primary/10 border-primary/30 text-primary'
                      : 'bg-surface-elevated border-border-subtle text-text-tertiary'
                  }`}
                  title="选中时把质量增强词附加到末尾"
                >
                  质量增强
                </button>
                <button
                  type="button"
                  onClick={() => setTagDisplayLang(tagDisplayLang === 'zh' ? 'en' : 'zh')}
                  className="text-[10px] px-2 py-0.5 rounded-lg border border-border-subtle bg-surface-elevated text-text-secondary hover:border-accent/50"
                >
                  {tagDisplayLang === 'zh' ? 'EN' : '中文'}
                </button>
                {(positiveTags.length + negativeTags.length) > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAllTags}
                    className="text-[10px] px-2 py-0.5 rounded-lg border border-border-subtle bg-surface-elevated text-text-tertiary hover:border-red-400 hover:text-red-500"
                  >
                    清空
                  </button>
                )}
              </div>
            </div>
            <div className="h-[300px]">
              <TagSelector
                onTagClick={handleAddTag}
                selectedTags={[...positiveTags, ...negativeTags].map((t) => t.tag)}
                disabled={taskManager.isFull}
                displayLang={tagDisplayLang}
                compactMode
              />
            </div>
            {/* 已选 tag 列表（可删除） */}
            {(positiveTags.length > 0 || negativeTags.length > 0) && (
              <div className="px-2 py-2 border-t border-border-subtle bg-surface-elevated/50">
                <div className="flex flex-wrap gap-1.5">
                  {positiveTags.map((t) => (
                    <span
                      key={`p-${t.tag}`}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-medium"
                    >
                      {t.tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(t.tag)}
                        className="hover:text-red-500"
                        title="删除"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  {negativeTags.map((t) => (
                    <span
                      key={`n-${t.tag}`}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-500/10 text-red-500 text-[10px] font-medium"
                    >
                      {t.tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(t.tag)}
                        className="hover:text-red-700"
                        title="删除"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 提示词 ── */}
      <div>
        <div className="text-xs text-text-tertiary font-medium mb-1">提示词</div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder={selectedGirlfriends.length > 0
            ? `输入图片描述（已选 ${selectedGirlfriends.length} 位数字人，将自动注入角色身份）`
            : '输入图片描述，例如：cinematic portrait of a woman, soft warm light, 35mm film...'}
          className="w-full rounded-lg border border-border-subtle bg-surface-raised px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent resize-y"
          disabled={taskManager.isFull}
        />
      </div>

      {/* ── 提交 ── */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting || taskManager.isFull}
        className="w-full py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
      >
        {submitting
          ? '提交中…'
          : taskManager.isFull
          ? '队列已满'
          : `开始生成（导演台 ${
              modelKey === 'qwen-image-2.1' ? 'Qwen-Image-2.1' : 'Krea2'
            } · 免扣费）`}
      </button>

      <p className="text-[10px] text-text-tertiary text-center">
        {selModel?.name && <>当前模型: {selModel.name} · </>}
        任务提交后会在上方"任务列表"中显示，生成完成后图片会出现在列表缩略图条上。
      </p>
    </div>
  );
}