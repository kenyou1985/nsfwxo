import React, { useState, useCallback, useRef } from 'react';
import { ImagePlus, Sparkles } from 'lucide-react';
import { ImageUploader } from '../components/ImageUploader';
import { ParameterSlider } from '../components/ParameterSlider';
import { GenerateButton } from '../components/GenerateButton';
import { TaskList } from '../components/TaskList';
import { TagPanel } from '../components/TagPanel';
import { uploadImage } from '../services/runninghub';
import type { ImageToImageParams, QueuedTask } from '../types';
import type { TaskManagerReturn } from '../hooks/useTaskManager';
import type { WeightMode } from '../components/PromptEditor';

interface SelectedTag {
  tag: string;
  weight: WeightMode;
  order: number;
}

interface ImageToImagePageProps {
  apiKey: string;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  taskManager: TaskManagerReturn;
}

export function ImageToImagePage({
  apiKey,
  onError,
  onSuccess,
  taskManager,
}: ImageToImagePageProps) {
  const [params, setParams] = useState<ImageToImageParams>({
    prompt: '',
    batchSize: 4,
    uploadedImagePath: '',
  });
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Tag management
  const [positiveTags, setPositiveTags] = useState<SelectedTag[]>([]);
  const [negativeTags, setNegativeTags] = useState<SelectedTag[]>([]);
  const [tagCounter, setTagCounter] = useState(0);
  const [customPrompt, setCustomPrompt] = useState('');
  const [enableRandomPrompt, setEnableRandomPrompt] = useState(true);
  const [isR18Enabled, setIsR18Enabled] = useState(false);
  const [displayLang, setDisplayLang] = useState<'en' | 'zh'>('en');

  const updateParam = <K extends keyof ImageToImageParams>(
    key: K,
    value: ImageToImageParams[K]
  ) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  const handleUpload = useCallback(
    async (file: File) => {
      setUploadError(null);
      try {
        const objectUrl = URL.createObjectURL(file);
        setPreviewUrl(objectUrl);

        const { imagePath } = await uploadImage(apiKey, file);
        updateParam('uploadedImagePath', imagePath);
        onSuccess('图片上传成功');
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : '上传失败');
        throw err;
      }
    },
    [apiKey, onSuccess]
  );

  const handleImageChange = (path: string, url: string) => {
    updateParam('uploadedImagePath', path);
    if (!url && previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl('');
    }
  };

  // Build final prompt from tags
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
      parts.push('masterpiece, best quality, highly detailed, beautiful lighting, 8k, ultra sharp');
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
    if (isR18Enabled) {
      setNegativeTags((prev) => [...prev, { tag, weight: 'none', order: tagCounter }]);
    } else {
      setPositiveTags((prev) => [...prev, { tag, weight: 'none', order: tagCounter }]);
    }
  }, [positiveTags, negativeTags, isR18Enabled, tagCounter]);

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

  const buildNodeList = () => {
    const finalPrompt = buildFinalPrompt();

    return [
      {
        nodeId: '33',
        fieldName: 'text',
        fieldValue: finalPrompt || params.prompt,
        description: 'text',
      },
      {
        nodeId: '7',
        fieldName: 'image',
        fieldValue: params.uploadedImagePath,
        description: 'image',
      },
      {
        nodeId: '9',
        fieldName: 'batch_size',
        fieldValue: String(params.batchSize),
        description: 'batch_size',
      },
    ];
  };

  const handleGenerate = async () => {
    if (!params.uploadedImagePath) {
      onError('请先上传参考图片');
      return;
    }
    const finalPrompt = buildFinalPrompt();
    if (!finalPrompt.trim() && !params.prompt.trim()) {
      onError('请输入提示词或选择至少一个标签');
      return;
    }
    if (taskManager.isFull) {
      onError('任务队列已满（最多 20 个任务），请等待当前任务完成');
      return;
    }
    try {
      const nodeList = buildNodeList();
      const combinedPrompt = customPrompt || params.prompt || finalPrompt;
      await taskManager.addTask('img2img', nodeList, combinedPrompt);
      onSuccess('任务已提交');
    } catch (err) {
      onError(err instanceof Error ? err.message : '提交失败');
    }
  };

  const img2imgTasks = taskManager.tasks.filter((t: QueuedTask) => t.workflowType === 'img2img');
  const totalSelected = positiveTags.length + negativeTags.length;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Task list */}
      <TaskList
        tasks={img2imgTasks}
        onCancel={taskManager.cancelTask}
        onClearCompleted={taskManager.clearCompleted}
        onRegenerate={taskManager.regenerateTask}
      />

      {/* Image upload */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <ImageUploader
          value={params.uploadedImagePath}
          previewUrl={previewUrl}
          onChange={handleImageChange}
          onUpload={handleUpload}
          disabled={taskManager.isFull}
          error={uploadError || undefined}
        />
      </div>

      {/* Tag Panel - full width on desktop */}
      <div className="hidden lg:block">
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
        />
      </div>

      {/* Mobile: Tag selector with FAB */}
      <div className="lg:hidden">
        <div className="rounded-xl bg-bg-surface border border-border overflow-hidden" style={{ maxHeight: '500px' }}>
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
          />
        </div>
      </div>

      {/* Batch size */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <ParameterSlider
          label="生成数量"
          value={params.batchSize}
          min={1}
          max={8}
          onChange={(v) => updateParam('batchSize', v)}
          disabled={taskManager.isFull}
        />
      </div>

      {/* Generate */}
      <div className="pt-2 pb-4">
        <GenerateButton
          onClick={handleGenerate}
          isLoading={false}
          disabled={!params.uploadedImagePath || taskManager.isFull}
          label={taskManager.isFull ? '队列已满' : `开始生成${totalSelected > 0 ? ` (${totalSelected}标签)` : ''}`}
        />
      </div>
    </div>
  );
}
