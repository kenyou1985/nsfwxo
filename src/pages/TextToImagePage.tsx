import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Settings2, Sparkles, LayoutTemplate } from 'lucide-react';
import { TagPanel } from '../components/TagPanel';
import { ParameterSlider } from '../components/ParameterSlider';
import { ParameterSelect } from '../components/ParameterSelect';
import { RunningHubModelPicker } from '../components/RunningHubModelPicker';
import { GenerateButton } from '../components/GenerateButton';
import { ImageGrid } from '../components/ImageGrid';
import { TaskList } from '../components/TaskList';
import { ErrorBoundary } from '../components/ErrorBoundary';
import type { TextToImageParams, QueuedTask } from '../types';
import { MAX_TASKS, type TaskManagerReturn } from '../hooks/useTaskManager';
import { DEFAULT_TXT2IMG_PARAMS, QUALITY_BOOST_PROMPT } from '../constants';
import { WORKFLOW } from '../services/runninghub';
import type { WeightMode } from '../components/PromptEditor';
import { buildTxt2ImgNodeList } from '../utils/txt2imgNodeBuilder';
import { expandPrompt } from '../services/promptApi';
import { PosePresetSelector } from '../components/PosePresetSelector';
import { addFavorite, removeFavorite, getFavorites } from '../services/storage';
import { logger } from '../utils/clientLogger';

interface SelectedTag {
  tag: string;
  weight: WeightMode;
  order: number;
}

interface TextToImagePageProps {
  apiKey: string;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  taskManager: TaskManagerReturn;
  pendingModelPick?: { name: string; label: string; kind: 'checkpoint' | 'lora'; ts: number } | null;
  onPendingModelPickConsumed?: () => void;
}

export function TextToImagePage({
  apiKey,
  onError,
  onSuccess,
  taskManager,
  pendingModelPick,
  onPendingModelPickConsumed,
}: TextToImagePageProps) {
  const [params, setParams] = useState<TextToImageParams>({
    ...DEFAULT_TXT2IMG_PARAMS,
    enableRandomPrompt: true,
    threeLoraRandomPrompt: false,
    // 默认运行模式：3LoRA 模型
    workflowId: WORKFLOW.THREE_LORA,
  });

  // Tag management
  const [positiveTags, setPositiveTags] = useState<SelectedTag[]>([]);
  const [negativeTags, setNegativeTags] = useState<SelectedTag[]>([]);
  const [tagCounter, setTagCounter] = useState(0);
  const [customPrompt, setCustomPrompt] = useState('');
  const [enableRandomPrompt, setEnableRandomPrompt] = useState(true);
  const [isR18Enabled, setIsR18Enabled] = useState(false);
  const [displayLang, setDisplayLang] = useState<'en' | 'zh'>('en');

  // UI state
  const [basicOpen, setBasicOpen] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isGeneratingFromPrompt, setIsGeneratingFromPrompt] = useState(false);
  const [expandedPrompt, setExpandedPrompt] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const updateParam = <K extends keyof TextToImageParams>(
    key: K,
    value: TextToImageParams[K]
  ) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  // 模型库 → 文生图：收到 pendingModelPick 后写入对应的参数
  useEffect(() => {
    if (!pendingModelPick) return;
    if (pendingModelPick.kind === 'checkpoint') {
      updateParam('checkpoint', pendingModelPick.name);
    } else {
      // LoRA：填到第一个空位
      setParams((prev) => {
        if (!prev.lora1Name) return { ...prev, lora1Name: pendingModelPick.name };
        if (!prev.lora2Name) return { ...prev, lora2Name: pendingModelPick.name };
        if (!prev.lora3Name) return { ...prev, lora3Name: pendingModelPick.name };
        // 三个都占满了 → 替换 LoRA 3
        return { ...prev, lora3Name: pendingModelPick.name };
      });
    }
    onSuccess?.(`已应用模型：${pendingModelPick.label || pendingModelPick.name}`);
    onPendingModelPickConsumed?.();
    // 滚动到文生图面板（让用户看到应用结果）
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }, [pendingModelPick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build tag-only prompt (for expand API — excludes customPrompt to avoid duplication)
  const buildTagPrompt = useCallback((): string => {
    const parts: string[] = [];
    positiveTags.forEach((item) => {
      if (item.weight === 'positive') {
        parts.push(`(${item.tag}:1.3)`);
      } else if (item.weight === 'negative') {
        parts.push(`[${item.tag}:0.7]`);
      } else {
        parts.push(item.tag);
      }
    });
    if (enableRandomPrompt) {
      parts.push(QUALITY_BOOST_PROMPT);
    }
    return parts.join(', ');
  }, [positiveTags, enableRandomPrompt]);

  // Build final prompt from tags + custom text (for actual generation)
  const buildFinalPrompt = useCallback((): string => {
    const parts: string[] = [];

    positiveTags.forEach((item) => {
      if (item.weight === 'positive') {
        parts.push(`(${item.tag}:1.3)`);
      } else if (item.weight === 'negative') {
        parts.push(`[${item.tag}:0.7]`);
      } else {
        parts.push(item.tag);
      }
    });

    if (customPrompt.trim()) {
      parts.push(customPrompt.trim());
    }

    if (enableRandomPrompt) {
      parts.push(QUALITY_BOOST_PROMPT);
    }

    return parts.join(', ');
  }, [positiveTags, customPrompt, enableRandomPrompt]);

  const buildNegativePrompt = useCallback((): string => {
    const parts: string[] = [];
    negativeTags.forEach((item) => {
      parts.push(item.tag);
    });
    return parts.join(', ') || 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, bad feet';
  }, [negativeTags]);

  const handleAddTag = useCallback((tag: string) => {
    const exists = [...positiveTags, ...negativeTags].some((t) => t.tag === tag);
    if (exists) return;

    setTagCounter((c) => c + 1);
    // Tags should always go to positiveTags regardless of R18 mode
    // so that expand can properly use them for prompt generation
    setPositiveTags((prev) => [...prev, { tag, weight: 'none', order: tagCounter }]);
  }, [positiveTags, negativeTags, tagCounter]);

  const handleRemoveTag = useCallback((tag: string) => {
    setPositiveTags((prev) => prev.filter((t) => t.tag !== tag));
    setNegativeTags((prev) => prev.filter((t) => t.tag !== tag));
  }, []);

  // Refs to avoid stale closure issues in callbacks
  const positiveTagsRef = useRef(positiveTags);
  const negativeTagsRef = useRef(negativeTags);
  positiveTagsRef.current = positiveTags;
  negativeTagsRef.current = negativeTags;

  const handleUpdateTagWeight = useCallback((tag: string, weight: WeightMode) => {
    if (weight === 'negative') {
      // Check where the tag currently is
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
      // weight === 'none': update in place
      setPositiveTags((prev) => prev.map((t) => t.tag === tag ? { ...t, weight } : t));
      setNegativeTags((prev) => prev.map((t) => t.tag === tag ? { ...t, weight } : t));
    }
  }, [tagCounter]);

  const handleMoveTagUp = useCallback((tag: string) => {
    setPositiveTags((prev) => {
      const idx = prev.findIndex((t) => t.tag === tag);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }, []);

  const handleMoveTagDown = useCallback((tag: string) => {
    setPositiveTags((prev) => {
      const idx = prev.findIndex((t) => t.tag === tag);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }, []);

  const handleClearAll = useCallback(() => {
    setPositiveTags([]);
    setNegativeTags([]);
    setCustomPrompt('');
    setEnableRandomPrompt(true);
    setTagCounter(0);
  }, []);

  const handlePoseSelect = useCallback((posePrompt: string, poseName: string) => {
    const current = customPrompt.trim();
    const newPrompt = current ? `${current}, ${posePrompt}` : posePrompt;
    setCustomPrompt(newPrompt);
    onSuccess(`已添加姿势: ${poseName}`);
  }, [customPrompt, onSuccess]);

  const handleToggleFavorite = (imageUrl: string) => {
    // Use imageRef for lookup since addFavorite stores the URL in imageRef field
    const existing = getFavorites().find((f) => f.imageRef === imageUrl);
    if (existing) {
      removeFavorite(existing.id);
    } else {
      addFavorite({ imageUrl, source: 'history', r18: isR18Enabled });
    }
    setRefreshKey((k) => k + 1);
  };

  const handleOptimizePrompt = useCallback(async () => {
    // Use tags-only for expand (avoid duplicating customPrompt which is shown in textarea separately)
    const tagPart = buildTagPrompt();
    const userText = customPrompt.trim();
    // Send tags + user-typed text to expand API together
    const combined = userText
      ? `${tagPart}, ${userText}`
      : tagPart;

    if (!combined.trim()) return;

    // Extract ethnicity hint from input to pick the right diversity variant
    const lower = combined.toLowerCase();
    const isWestern = /\b(european|western|american|british|french|italian|german|blonde|blue eyes|pale|r18)\b/.test(lower);
    const isEastAsian = /\b(east asian|chinese|japanese|korean|black|african|dark skin|indian|south asian)\b/.test(lower);
    const variantIndex = isEastAsian ? 0 : isWestern ? 1 : 0;

    setIsOptimizing(true);
    try {
      const res = await expandPrompt(combined, 'image', isR18Enabled, 1, variantIndex);
      if (res.results.length > 0) {
        // Put expanded result in the separate output field, NOT the input field
        setExpandedPrompt(res.results[0].prompt);
      }
    } catch {
      // silently fail
    } finally {
      setIsOptimizing(false);
    }
  }, [buildTagPrompt, customPrompt, isR18Enabled]);

  const handleGenerateFromPrompt = useCallback(async () => {
    const textToUse = expandedPrompt.trim() || customPrompt.trim();
    if (!textToUse) return;
    if (taskManager.isFull) {
      onError(`任务队列已满（最多 ${MAX_TASKS} 个任务），请等待当前任务完成`);
      return;
    }
    setIsGeneratingFromPrompt(true);
    try {
      const negPrompt = buildNegativePrompt();
      const prompt = `${textToUse}, ${QUALITY_BOOST_PROMPT}`;
      const nodeList = buildTxt2ImgNodeList({
        workflowId: params.workflowId || WORKFLOW.THREE_LORA,
        width: params.width,
        height: params.height,
        imageCount: params.imageCount,
        prompt,
        negativePrompt: negPrompt,
        lora1Name: params.lora1Name || undefined,
        lora1Weight: params.lora1Weight,
        lora2Name: params.lora2Name || undefined,
        lora2Weight: params.lora2Weight,
        lora3Name: params.lora3Name || undefined,
        lora3Weight: params.lora3Weight,
        checkpoint: params.checkpoint || undefined,
        threeLoraRandomPrompt: params.threeLoraRandomPrompt,
      });
      await taskManager.addTask('txt2img', nodeList, textToUse, params.workflowId || undefined);
      onSuccess('任务已提交');
    } catch (err) {
      onError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setIsGeneratingFromPrompt(false);
    }
  }, [expandedPrompt, customPrompt, params, taskManager, buildNegativePrompt, onError, onSuccess]);

  const buildNodeList = useCallback(() => {
    const finalPrompt = buildFinalPrompt();
    const negPrompt = buildNegativePrompt();

    return buildTxt2ImgNodeList({
      workflowId: params.workflowId || WORKFLOW.THREE_LORA,
      width: params.width,
      height: params.height,
      imageCount: params.imageCount,
      prompt: finalPrompt,
      negativePrompt: negPrompt,
      lora1Name: params.lora1Name || undefined,
      lora1Weight: params.lora1Weight,
      lora2Name: params.lora2Name || undefined,
      lora2Weight: params.lora2Weight,
      lora3Name: params.lora3Name || undefined,
      lora3Weight: params.lora3Weight,
      checkpoint: params.checkpoint || undefined,
      threeLoraRandomPrompt: params.threeLoraRandomPrompt,
    });
  }, [params, buildFinalPrompt, buildNegativePrompt]);

  const handleGenerate = async () => {
    const finalPrompt = buildFinalPrompt();
    if (!finalPrompt.trim() && !params.prompt.trim()) {
      onError('请输入提示词或选择至少一个标签');
      return;
    }
    if (taskManager.isFull) {
      onError(`任务队列已满（最多 ${MAX_TASKS} 个任务），请等待当前任务完成`);
      return;
    }
    try {
      const nodeList = buildNodeList();
      const combinedPrompt = customPrompt || params.prompt || finalPrompt;
      await taskManager.addTask('txt2img', nodeList, combinedPrompt, params.workflowId || undefined);
      onSuccess('任务已提交');
    } catch (err) {
      onError(err instanceof Error ? err.message : '提交失败');
    }
  };

  const txt2imgTasks = taskManager.tasks.filter((t: QueuedTask) => t.workflowType === 'txt2img');
  const allImages = txt2imgTasks.flatMap((t: QueuedTask) => t.images);

  const totalSelected = positiveTags.length + negativeTags.length;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Task list */}
      <TaskList
        tasks={txt2imgTasks}
        onCancel={taskManager.cancelTask}
        onClearCompleted={taskManager.clearCompleted}
        onRegenerate={taskManager.regenerateTask}
      />

      {/* Desktop: Two-column layout */}
      <div className="hidden xl:block">
        {/* Top row: Size controls + Image count */}
        <div className="rounded-2xl bg-white border border-border shadow-card p-4 mb-4">
          <div className="grid grid-cols-3 gap-6">
            <ParameterSlider
              label="宽度"
              value={params.width}
              min={512}
              max={2048}
              step={64}
              onChange={(v) => updateParam('width', v)}
              unit="px"
              disabled={taskManager.isFull}
            />
            <ParameterSlider
              label="高度"
              value={params.height}
              min={512}
              max={2048}
              step={64}
              onChange={(v) => updateParam('height', v)}
              unit="px"
              disabled={taskManager.isFull}
            />
            <ParameterSlider
              label="图片数量"
              value={params.imageCount}
              min={1}
              max={6}
              onChange={(v) => updateParam('imageCount', v)}
              disabled={taskManager.isFull}
            />
          </div>
        </div>

        {/* Main content: Tag panel (full width on desktop) */}
        <TagPanel
          positiveTags={positiveTags}
          negativeTags={negativeTags}
          customPrompt={customPrompt}
          enableRandomPrompt={enableRandomPrompt}
          isR18Enabled={isR18Enabled}
          displayLang={displayLang}
          onCustomPromptChange={setCustomPrompt}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onUpdateTagWeight={handleUpdateTagWeight}
          onMoveTagUp={handleMoveTagUp}
          onMoveTagDown={handleMoveTagDown}
          onClearAll={handleClearAll}
          onEnableRandomPrompt={setEnableRandomPrompt}
          onEnableR18={() => setIsR18Enabled(!isR18Enabled)}
          onDisplayLangChange={setDisplayLang}
          disabled={taskManager.isFull}
          onOptimizePrompt={handleOptimizePrompt}
          isOptimizing={isOptimizing}
          onGenerateFromPrompt={handleGenerateFromPrompt}
          isGeneratingFromPrompt={isGeneratingFromPrompt}
          expandedPrompt={expandedPrompt}
          onExpandedPromptChange={setExpandedPrompt}
        />

        {/* 预设姿势 */}
        <PosePresetSelector type="image" onSelect={handlePoseSelect} disabled={taskManager.isFull} forceUnlock={true} />

        {/* LoRA & Advanced — 直接复用 PosePresetSelector 的折叠面板模式 */}
        <div className="border border-border rounded-xl bg-white overflow-hidden">
          <div
            onClick={() => { logger.logSectionToggle('LoRA 参数', !advancedOpen); setAdvancedOpen((v) => !v); }}
            className="w-full px-4 py-3 flex items-center justify-between bg-bg-elevated hover:bg-bg-hover transition-colors cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center gap-2">
              <Settings2 size={14} className="text-text-tertiary" />
              <span className="text-sm font-medium text-text-primary">LoRA 参数</span>
            </div>
            <svg
              className={`w-4 h-4 text-text-tertiary transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>

          {advancedOpen && (
            <div className="p-3 border-t border-border">
              <ErrorBoundary name="LoRA参数">
                <div className="grid grid-cols-1 gap-4">
                  {/* LoRA 1 */}
                  <div className="space-y-2">
                    <div className="text-xs text-text-tertiary font-medium">LoRA 1</div>
                    <RunningHubModelPicker
                      label="LoRA 1"
                      kind="lora"
                      value={params.lora1Name || ''}
                      onChange={(name) => updateParam('lora1Name', name)}
                      onSelectWithDefaults={(entry) => updateParam('lora1Weight', entry.defaultWeight)}
                      disabled={taskManager.isFull}
                    />
                    <div className="w-32">
                      <ParameterSlider
                        label="权重"
                        value={params.lora1Weight}
                        min={0}
                        max={2}
                        step={0.05}
                        onChange={(v) => updateParam('lora1Weight', v)}
                        disabled={taskManager.isFull}
                      />
                    </div>
                  </div>

                  {/* LoRA 2 */}
                  <div className="space-y-2">
                    <div className="text-xs text-text-tertiary font-medium">LoRA 2</div>
                    <RunningHubModelPicker
                      label="LoRA 2"
                      kind="lora"
                      value={params.lora2Name || ''}
                      onChange={(name) => updateParam('lora2Name', name)}
                      onSelectWithDefaults={(entry) => updateParam('lora2Weight', entry.defaultWeight)}
                      disabled={taskManager.isFull}
                    />
                    <div className="w-32">
                      <ParameterSlider
                        label="权重"
                        value={params.lora2Weight}
                        min={0}
                        max={2}
                        step={0.05}
                        onChange={(v) => updateParam('lora2Weight', v)}
                        disabled={taskManager.isFull}
                      />
                    </div>
                  </div>

                  {/* LoRA 3 */}
                  <div className="space-y-2">
                    <div className="text-xs text-text-tertiary font-medium">LoRA 3</div>
                    <RunningHubModelPicker
                      label="LoRA 3"
                      kind="lora"
                      value={params.lora3Name || ''}
                      onChange={(name) => updateParam('lora3Name', name)}
                      onSelectWithDefaults={(entry) => updateParam('lora3Weight', entry.defaultWeight)}
                      disabled={taskManager.isFull}
                    />
                    <div className="w-32">
                      <ParameterSlider
                        label="权重"
                        value={params.lora3Weight}
                        min={0}
                        max={2}
                        step={0.05}
                        onChange={(v) => updateParam('lora3Weight', v)}
                        disabled={taskManager.isFull}
                      />
                    </div>
                  </div>

                  {/* Checkpoint */}
                  <div>
                    <RunningHubModelPicker
                      label="Checkpoint 模型"
                      kind="checkpoint"
                      value={params.checkpoint || ''}
                      onChange={(name) => updateParam('checkpoint', name)}
                      placeholder={params.workflowId === WORKFLOW.THREE_LORA ? '默认 Illustrious NSFW v10' : '留空使用默认模型'}
                      disabled={taskManager.isFull}
                    />
                  </div>
                </div>
              </ErrorBoundary>
            </div>
          )}
        </div>

        {/* Desktop: Generate button at bottom */}
        <div className="pt-2 pb-4">
          <GenerateButton
            onClick={handleGenerate}
            isLoading={false}
            disabled={taskManager.isFull}
            label={taskManager.isFull ? '队列已满' : `开始生成${totalSelected > 0 ? ` (${totalSelected}标签)` : ''}`}
          />
        </div>
      </div>

      {/* Mobile/Tablet: Single column layout */}
      <div className="xl:hidden space-y-3">
        {/* Size controls — 直接复用 PosePresetSelector 的折叠面板模式 */}
        <div className="border border-border rounded-xl bg-white overflow-hidden">
          <div
            onClick={() => setBasicOpen((v) => !v)}
            className="w-full px-4 py-3 flex items-center justify-between bg-bg-elevated hover:bg-bg-hover transition-colors cursor-pointer select-none"
          >
            <div className="flex items-center gap-2">
              <LayoutTemplate size={14} className="text-text-tertiary" />
              <span className="text-sm font-medium text-text-primary">尺寸设置</span>
            </div>
            <svg
              className={`w-4 h-4 text-text-tertiary transition-transform ${basicOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>

          {basicOpen && (
            <div className="p-3 border-t border-border">
              <div className="space-y-4">
                <ParameterSlider
                  label="宽度"
                  value={params.width}
                  min={512}
                  max={2048}
                  step={64}
                  onChange={(v) => updateParam('width', v)}
                  unit="px"
                  disabled={taskManager.isFull}
                />
                <ParameterSlider
                  label="高度"
                  value={params.height}
                  min={512}
                  max={2048}
                  step={64}
                  onChange={(v) => updateParam('height', v)}
                  unit="px"
                  disabled={taskManager.isFull}
                />
                <ParameterSlider
                  label="图片数量"
                  value={params.imageCount}
                  min={1}
                  max={6}
                  onChange={(v) => updateParam('imageCount', v)}
                  disabled={taskManager.isFull}
                />
              </div>
            </div>
          )}
        </div>

        {/* Tag Panel — full width on mobile, stacked with editor inline */}
        <TagPanel
            positiveTags={positiveTags}
            negativeTags={negativeTags}
            customPrompt={customPrompt}
            enableRandomPrompt={enableRandomPrompt}
            isR18Enabled={isR18Enabled}
            displayLang={displayLang}
            onCustomPromptChange={setCustomPrompt}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
            onUpdateTagWeight={handleUpdateTagWeight}
            onMoveTagUp={handleMoveTagUp}
            onMoveTagDown={handleMoveTagDown}
            onClearAll={handleClearAll}
            onEnableRandomPrompt={setEnableRandomPrompt}
            onEnableR18={() => setIsR18Enabled(!isR18Enabled)}
            onDisplayLangChange={setDisplayLang}
            disabled={taskManager.isFull}
            onOptimizePrompt={handleOptimizePrompt}
            isOptimizing={isOptimizing}
            onGenerateFromPrompt={handleGenerateFromPrompt}
            isGeneratingFromPrompt={isGeneratingFromPrompt}
            expandedPrompt={expandedPrompt}
            onExpandedPromptChange={setExpandedPrompt}
          />

        {/* 预设姿势 */}
        <PosePresetSelector type="image" onSelect={handlePoseSelect} disabled={taskManager.isFull} forceUnlock={true} />

        {/* Advanced — 直接复用 PosePresetSelector 的折叠面板模式 */}
        <div className="border border-border rounded-xl bg-white overflow-hidden">
          <div
            onClick={() => { logger.logSectionToggle('高级选项', !advancedOpen); setAdvancedOpen((v) => !v); }}
            className="w-full px-4 py-3 flex items-center justify-between bg-bg-elevated hover:bg-bg-hover transition-colors cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center gap-2">
              <Settings2 size={14} className="text-text-tertiary" />
              <span className="text-sm font-medium text-text-primary">高级选项</span>
            </div>
            <svg
              className={`w-4 h-4 text-text-tertiary transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>

          {advancedOpen && (
            <div className="p-3 border-t border-border">
              <ErrorBoundary name="高级选项">
                <div className="space-y-4">
                  {/* LoRA 1 */}
                  <div className="space-y-2">
                    <div className="text-xs text-text-tertiary font-medium">LoRA 1</div>
                    <RunningHubModelPicker
                      label="LoRA 1"
                      kind="lora"
                      value={params.lora1Name || ''}
                      onChange={(name) => updateParam('lora1Name', name)}
                      onSelectWithDefaults={(entry) => updateParam('lora1Weight', entry.defaultWeight)}
                      disabled={taskManager.isFull}
                    />
                    <ParameterSlider label="权重" value={params.lora1Weight} min={0} max={2} step={0.05} onChange={(v) => updateParam('lora1Weight', v)} disabled={taskManager.isFull} />
                  </div>
                  {/* LoRA 2 */}
                  <div className="border-t border-border/50 pt-3 space-y-2">
                    <div className="text-xs text-text-tertiary font-medium">LoRA 2</div>
                    <RunningHubModelPicker
                      label="LoRA 2"
                      kind="lora"
                      value={params.lora2Name || ''}
                      onChange={(name) => updateParam('lora2Name', name)}
                      onSelectWithDefaults={(entry) => updateParam('lora2Weight', entry.defaultWeight)}
                      disabled={taskManager.isFull}
                    />
                    <ParameterSlider label="权重" value={params.lora2Weight} min={0} max={2} step={0.05} onChange={(v) => updateParam('lora2Weight', v)} disabled={taskManager.isFull} />
                  </div>
                  {/* LoRA 3 */}
                  <div className="border-t border-border/50 pt-3 space-y-2">
                    <div className="text-xs text-text-tertiary font-medium">LoRA 3</div>
                    <RunningHubModelPicker
                      label="LoRA 3"
                      kind="lora"
                      value={params.lora3Name || ''}
                      onChange={(name) => updateParam('lora3Name', name)}
                      onSelectWithDefaults={(entry) => updateParam('lora3Weight', entry.defaultWeight)}
                      disabled={taskManager.isFull}
                    />
                    <ParameterSlider label="权重" value={params.lora3Weight} min={0} max={2} step={0.05} onChange={(v) => updateParam('lora3Weight', v)} disabled={taskManager.isFull} />
                  </div>
                  {/* RunningHub 模型 */}
                  <div className="border-t border-border/50 pt-3 space-y-2">
                    <div className="text-xs text-text-tertiary font-medium">RunningHub 模型</div>
                    <ParameterSelect
                      label="RunningHub 模型"
                      value={params.workflowId || ''}
                      options={[
                        { value: '', label: '默认（3LoRA 模型）' },
                        { value: WORKFLOW.THREE_LORA, label: '3LoRA 模型' },
                        { value: WORKFLOW.REALISTIC_V3, label: '真实 V3 模型' },
                      ]}
                      onChange={(val) => {
                        updateParam('workflowId', val);
                      }}
                      disabled={taskManager.isFull}
                    />
                  </div>
                  {/* Checkpoint 模型 */}
                  <div className="border-t border-border/50 pt-3">
                    <RunningHubModelPicker
                      label="Checkpoint 模型"
                      kind="checkpoint"
                      value={params.checkpoint || ''}
                      onChange={(name) => updateParam('checkpoint', name)}
                      placeholder={params.workflowId === WORKFLOW.THREE_LORA ? '默认 Illustrious NSFW v10' : '留空使用默认模型'}
                      disabled={taskManager.isFull}
                    />
                  </div>
                  {/* 3LoRA 专用：随机提示词开关 */}
                  {params.workflowId === WORKFLOW.THREE_LORA && (
                    <div className="border-t border-border/50 pt-3">
                      <label className="flex items-center justify-between cursor-pointer">
                        <span className="text-xs text-text-secondary">随机提示词</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-text-tertiary">{params.threeLoraRandomPrompt ? '开启' : '关闭'}</span>
                          <div
                            onClick={() => updateParam('threeLoraRandomPrompt', !params.threeLoraRandomPrompt)}
                            className={`
                              relative w-9 h-5 rounded-full transition-colors
                              ${params.threeLoraRandomPrompt ? 'bg-primary/60' : 'bg-bg-elevated border border-border'}
                            `}
                          >
                            <div
                              className={`
                                absolute top-0.5 w-4 h-4 rounded-full transition-all shadow
                                ${params.threeLoraRandomPrompt ? 'left-[18px] bg-primary' : 'left-0.5 bg-slate-500'}
                              `}
                            />
                          </div>
                        </div>
                      </label>
                    </div>
                  )}
                </div>
              </ErrorBoundary>
            </div>
          )}
        </div>

        {/* Generate button at bottom of mobile */}
        <div className="pt-1 pb-2">
          <GenerateButton
            onClick={handleGenerate}
            isLoading={false}
            disabled={taskManager.isFull}
            label={taskManager.isFull ? '队列已满' : `开始生成${totalSelected > 0 ? ` (${totalSelected}标签)` : ''}`}
          />
        </div>
      </div>

      {/* Generated images gallery */}
      {allImages.length > 0 && (
        <div className="rounded-xl bg-bg-surface border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-text-primary">生成结果</h3>
            <span className="text-xs text-text-tertiary">{allImages.length} 张图片</span>
          </div>
          <ImageGrid key={refreshKey} images={allImages} onToggleFavorite={handleToggleFavorite} />
        </div>
      )}
    </div>
  );
}
