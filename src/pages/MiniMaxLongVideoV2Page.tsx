import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Video, Image as ImageIcon, Loader2, X, Sparkles, Copy, Check } from 'lucide-react';
import { uploadImage, WORKFLOW } from '../services/runninghub';
import { expandVideoFromImage } from '../services/promptApi';
import { GenerateButton } from '../components/GenerateButton';
import { VideoTaskList } from '../components/VideoTaskList';
import type { NodeInfo } from '../types';
import type { GirlfriendPreset } from '../data/girlfriendPresets';
import { GirlfriendSelector } from '../components/GirlfriendSelector';
import { PosePresetSelector } from '../components/PosePresetSelector';
import ThemeLibraryPanel from '../components/ThemeLibraryPanel';
import { THEME_LIBRARY, 主题转视频提示词 } from '../data/themeLibrary';
import type { ThemeEntry } from '../data/themeLibrary';
import { RunningHubModelPicker } from '../components/RunningHubModelPicker';
import { H3_VIDEO_TEMPLATES } from './ImageToVideoPage';

// ────────────────────────────────────────────────────────────────────────────────
// MiniMax 长视频 V2 — workflowId 2092046754606030850
// API 文档: https://www.runninghub.ai/zh-cn/call-api/api-detail/2092046754606030850
// 特性: 最多3张参考图 / 像素设置 / 视频数量 / 时长 / N开关(随机种子)
// ───────────────────────────────────────────────────────────────────────────────

const WORKFLOW_ID = WORKFLOW.MINIMAX_LONG_V2;

// 节点 ID (与 API curl 示例完全对齐)
// ┌─────────────┬──────────────┬───────────┬──────────────────────────┐
// │ Node ID     │ 字段         │ 默认值   │ 说明                     │
// ├─────────────┼──────────────┼───────────┼──────────────────────────┤
// │ 159         │ value        │ 15        │ 时长 (秒)               │
// │ 291         │ value        │ 2         │ 视频数量                 │
// │ 25          │ value        │ 0.2       │ 像素 (Min/Max比例)      │
// │ 393         │ value        │ true      │ N/NO N                  │
// │ 272         │ value        │ false     │ 直出/zip                │
// │ 28          │ image        │ -         │ 参考图1                 │
// │ 273         │ image        │ -         │ 参考图2                 │
// │ 285         │ image        │ -         │ 参考图3                 │
// │ 59          │ prompt       │ -         │ 提示词                  │
// │ 11          │ unet_name    │ -         │ 视频模型                │
// │ 355         │ lora_name    │ -         │ LoRA1                   │
// │ 355         │ strength_model│ 0.4      │ LoRA1 强度              │
// │ 57          │ lora_name    │ -         │ LoRA2                   │
// │ 57          │ strength_model│ 0         │ LoRA2 强度              │
// └─────────────┴──────────────┴───────────┴──────────────────────────┘
const NODE = {
  duration:       '159', // value, 秒数 (默认 15)
  videoCount:     '291', // value, 视频数量 (默认 2)
  pixel:          '25',  // value, 像素 (Min/Max比例，默认 0.2)
  nSwitch:        '393', // value, N/NO N (默认 true=NO N, false=N)
  directOutput:   '272', // value, 直出/zip (默认 false=ZIP)
  refImage1:      '28',  // image, 参考图1 (首帧)
  refImage2:      '273', // image, 参考图2 (动作参考)
  refImage3:      '285', // image, 参考图3 (动作参考)
  prompt:         '59',  // prompt, 提示词
  unetName:       '11',  // unet_name, 视频模型
  lora1Name:      '355', // lora_name, LoRA1
  lora1Strength:  '355', // strength_model, LoRA1 权重
  lora2Name:      '57',  // lora_name, LoRA2
  lora2Strength:  '57',  // strength_model, LoRA2 权重
} as const;

// 固定模型 / LoRA (V2 API 专用)
const V2_UNET = 'DasiwaMinimaxH3_dasiwaREF2VAHybridV1_0.safetensors';
const V2_LORA1 = 'MysticXXX_MMH3-V4.safetensors';
const V2_LORA1_STRENGTH = 0.4;
const V2_LORA2 = 'PLORA_H3_V2-step00006300.safetensors';
const V2_LORA2_STRENGTH = 0;

// ── UI 选项 ──────────────────────────────────────────────────────────────────

/** 时长选项 (nodeId 159) */
const DURATION_OPTIONS = [
  { value: '5',  label: '5秒' },
  { value: '10', label: '10秒' },
  { value: '15', label: '15秒' },
  { value: '20', label: '20秒' },
  { value: '30', label: '30秒' },
  { value: '60', label: '60秒' },
];

// ── 类型 ────────────────────────────────────────────────────────────────────

interface ReferenceImage {
  path: string;
  preview: string;
}

interface MiniMaxLongVideoV2PageProps {
  apiKey: string;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  /** 初始参考图 (用于历史记录跳转场景) */
  initialImage?: { path: string; preview: string } | null;
  /** 初始提示词 (用于 H3 提示词引擎跳转场景) */
  initialPrompt?: string | null;
}

export function MiniMaxLongVideoV2Page({
  apiKey, onError, onSuccess,
  initialImage, initialPrompt,
}: MiniMaxLongVideoV2PageProps) {
  // ── 表单状态 (默认值全部对齐 API curl 示例) ──────────────────────────────
  const [images, setImages] = useState<ReferenceImage[]>(() => {
    // 从历史记录跳转过来时，初值就是已上传好的图；否则三个空 slot
    if (initialImage && initialImage.path) {
      return [
        { path: initialImage.path, preview: initialImage.preview || initialImage.path },
        { path: '', preview: '' },
        { path: '', preview: '' },
      ];
    }
    return [
      { path: '', preview: '' },
      { path: '', preview: '' },
      { path: '', preview: '' },
    ];
  });

  // ── 一次性注入初始数据 (历史记录 → 长视频 V2 场景) ──────────────────────────
  // 用 ref 跟踪已应用的值，避免 React StrictMode 双调用 / 重复跳转时反复 setState
  const appliedImageRef = useRef<string | null>(initialImage?.path ?? null);
  const appliedPromptRef = useRef<string | null>(initialPrompt ?? null);
  useEffect(() => {
    // 注入初始参考图（来自历史记录，写入 slot 0）
    if (initialImage?.path && initialImage.path !== appliedImageRef.current) {
      setImages((prev) => {
        const next = [...prev];
        next[0] = { path: initialImage.path, preview: initialImage.preview || initialImage.path };
        return next;
      });
      appliedImageRef.current = initialImage.path;
      if (!initialPrompt) {
        onSuccess('已从历史记录导入图片到长视频 V2（参考图 1）');
      }
    }

    // 注入初始提示词（来自 H3 提示词引擎等）
    if (initialPrompt && initialPrompt !== appliedPromptRef.current) {
      setPrompt(initialPrompt);
      appliedPromptRef.current = initialPrompt;
      if (!initialImage?.path) {
        onSuccess('已填入初始提示词');
      }
    }
  }, [initialImage, initialPrompt, onSuccess]);

  const [prompt, setPrompt] = useState<string>(initialPrompt ?? '');
  const [videoCount, setVideoCount] = useState<number>(2);
  const [duration, setDuration] = useState<string>('15');
  const [pixel, setPixel] = useState<string>('0.2'); // node 25, Min/Max 比例
  const [nNoN, setNNoN] = useState<boolean>(true);  // node 393, N/NO N: true=NO N, false=N
  const [directOutput, setDirectOutput] = useState<boolean>(false); // node 272, 直出/zip: true=直出MP4, false=ZIP

  // 数字人锚定状态
  const [selectedGirlfriends, setSelectedGirlfriends] = useState<GirlfriendPreset[]>([]);
  const [girlfriendUploading, setGirlfriendUploading] = useState<boolean>(false);

  // 模型选择状态
  const [selectedUnet, setSelectedUnet] = useState<string>(V2_UNET);
  const [selectedLora1, setSelectedLora1] = useState<string>(V2_LORA1);
  const [selectedLora1Weight, setSelectedLora1Weight] = useState<number>(V2_LORA1_STRENGTH);
  const [selectedLora2, setSelectedLora2] = useState<string>(V2_LORA2);
  const [selectedLora2Weight, setSelectedLora2Weight] = useState<number>(V2_LORA2_STRENGTH);

  // 主题库批量生成状态
  const [themeBatchProgress, setThemeBatchProgress] = useState<{ current: number; total: number } | null>(null);

  // 上传状态 (per-slot)
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadingSlots, setUploadingSlots] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState<boolean>(false);
  // 情色创作模式
  const [eroticMode, setEroticMode] = useState(false);
  const [eroticLevel, setEroticLevel] = useState<'soft' | 'normal' | 'sm'>('normal');
  const [eroticAnalyzing, setEroticAnalyzing] = useState(false);

  const taskListRef = useRef<{
    submitTask: (prompt: string, imagePath: string, imagePreview: string, nodeInfoList: NodeInfo[], workflowId?: string) => void;
  } | null>(null);

  // ── 安全释放 blob URL ───────────────────────────────────────────────────
  const revokeIfBlob = (url: string) => {
    if (typeof url === 'string' && url.startsWith('blob:')) {
      try { URL.revokeObjectURL(url); } catch { /* noop */ }
    }
  };

  /** 情色创作模式：调用 Grok-4.6 分析参考图，生成提示词 */
  const handleEroticAnalyze = useCallback(async () => {
    const uploadedImages = images.filter(img => img.path && img.path !== 'None');
    if (uploadedImages.length === 0) {
      onError('请先上传至少一张参考图');
      return;
    }
    setEroticAnalyzing(true);
    try {
      const firstImage = uploadedImages[0];
      const levelMap = {
        soft: '浪漫唯美氛围（唯美暧昧镜头，无直接身体接触）',
        normal: '亲密互动（含身体互动动作、情感氛围与亲密神态）',
        sm: '戏剧化场景（角色扮演、强情感张力、戏剧化叙事）',
      };
      const levelHint = levelMap[eroticLevel];
      // 过滤触发词的同时也用中性表达，避免 xAI 内容审核误判
      const hintRaw = `请生成一段适合MiniMax H3图生视频的英文动作提示词。创作方向：${levelHint}。要求输出纯英文提示词句子，不要解释。`;
      const sceneHint2 = hintRaw
        .replace(/未成年[人人]?/g, 'adult')
        .replace(/未满18[岁]?/g, '18+')
        .replace(/纯情色|情色|色情|色性/g, 'romantic')
        .replace(/带性爱|性爱|性行为/g, 'intimate')
        .replace(/SM重口味|重口味|SM/g, 'dramatic')
        .replace(/[少青]年/g, 'adult')
        .replace(/萝莉|正太|幼女|正幼/g, '')
        .replace(/teenager|underage|minor|child\b/g, 'adult');

      let imageDataUrl = firstImage.path;
      if (firstImage.path.startsWith('blob:') || firstImage.path.startsWith('http')) {
        try {
          const resp = await fetch(firstImage.path);
          const blob = await resp.blob();
          const reader = new FileReader();
          imageDataUrl = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch { /* use original path */ }
      }

      const res = await expandVideoFromImage(imageDataUrl, sceneHint2, true, 1, ['grok-4.6'], 150000);
      const generated = res.prompts?.[0];
      if (generated) {
        setPrompt(generated);
        onSuccess('情色创作提示词已生成，请根据需要编辑');
      } else {
        onError('生成失败，未返回提示词');
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : '分析失败，请重试');
    } finally {
      setEroticAnalyzing(false);
    }
  }, [images, eroticLevel, onError, onSuccess]);

  // ── 参考图上传 ─────────────────────────────────────────────────────────
  const handleImageUpload = useCallback(async (file: File, index: number) => {
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.readAsDataURL(file);
    });
    setImages(prev => {
      const next = [...prev];
      revokeIfBlob(next[index]?.preview);
      next[index] = { path: '', preview: dataUrl };
      return next;
    });
    setUploadingSlots(prev => { const n = new Set(prev); n.add(index); return n; });
    setUploading(true);
    try {
      const { imagePath } = await uploadImage(apiKey, file);
      setImages(prev => {
        const next = [...prev];
        next[index] = { path: imagePath, preview: dataUrl };
        return next;
      });
      onSuccess(`参考图 ${index + 1} 上传成功`);
    } catch (err) {
      setImages(prev => {
        const next = [...prev];
        revokeIfBlob(next[index]?.preview);
        next[index] = { path: '', preview: '' };
        return next;
      });
      onError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploadingSlots(prev => {
        const n = new Set(prev);
        n.delete(index);
        if (n.size === 0) setUploading(false);
        return n;
      });
    }
  }, [apiKey, onSuccess, onError]);

  const handleImageRemove = useCallback((index: number) => {
    setImages(prev => {
      const next = [...prev];
      revokeIfBlob(next[index]?.preview);
      next[index] = { path: '', preview: '' };
      return next;
    });
  }, []);

  // ── 寻找空槽位 ─────────────────────────────────────────────────────────
  const findNextEmptySlot = useCallback((): number => {
    for (let i = 0; i < images.length; i++) {
      if (!images[i].path) return i;
    }
    return images.length;
  }, [images]);

  // ── 数字人锚定 ─────────────────────────────────────────────────────────
  const handleGirlfriendSelect = useCallback(async (gf: GirlfriendPreset) => {
    const gfKey = gf.isCustom ? `custom_${gf.id}` : gf.id;
    const existingIdx = selectedGirlfriends.findIndex(
      (g) => (g.isCustom ? `custom_${g.id}` : g.id) === gfKey
    );

    if (existingIdx >= 0) {
      setSelectedGirlfriends(prev => prev.filter((_, i) => i !== existingIdx));
      setImages(imgs => {
        const updated = [...imgs];
        revokeIfBlob(updated[existingIdx]?.preview);
        updated[existingIdx] = { path: '', preview: '' };
        return updated;
      });
      onSuccess(`已取消锚定「${gf.nameZh || gf.name}」（参考图 ${existingIdx + 1} 已清空）`);
      return;
    }

    const emptyIdx = findNextEmptySlot();
    if (emptyIdx >= images.length) {
      onError('参考图已满（3/3），请先移除一张图片后再添加新的数字人');
      return;
    }

    const slotIdx = emptyIdx;
    setSelectedGirlfriends(prev => {
      const next = [...prev];
      while (next.length <= slotIdx) next.push(undefined as unknown as GirlfriendPreset);
      next[slotIdx] = gf;
      return next;
    });
    setImages(imgs => {
      const updated = [...imgs];
      revokeIfBlob(updated[slotIdx]?.preview);
      updated[slotIdx] = { path: '', preview: gf.portraitUrl };
      return updated;
    });

    setGirlfriendUploading(true);
    try {
      const res = await fetch(gf.portraitUrl);
      if (!res.ok) throw new Error(`下载头像失败: HTTP ${res.status}`);
      const blob = await res.blob();
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(blob);
      });
      const cleanBlob = await (await fetch(dataUrl)).blob();
      const mime = cleanBlob.type || 'image/jpeg';
      const uploadFile = new File([cleanBlob], `${gf.id}.jpg`, { type: mime });
      const { imagePath } = await uploadImage(apiKey, uploadFile);
      setImages(imgsPrev => {
        const updated = [...imgsPrev];
        updated[slotIdx] = { path: imagePath, preview: dataUrl };
        return updated;
      });
      onSuccess(`已锚定「${gf.nameZh || gf.name}」到参考图 ${slotIdx + 1}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '上传失败';
      onError(`锚定「${gf.nameZh || gf.name}」失败: ${msg}`);
    } finally {
      setGirlfriendUploading(false);
    }
  }, [apiKey, images, selectedGirlfriends, findNextEmptySlot, onSuccess, onError]);

  // ── 姿势预设 ────────────────────────────────────────────────────────────
  const handlePoseSelect = useCallback((posePrompt: string, poseName: string) => {
    setPrompt(prev => {
      const trimmed = prev.trim();
      if (!trimmed) return posePrompt;
      return `${trimmed}, ${posePrompt}`;
    });
    onSuccess(`已应用姿势: ${poseName}`);
  }, [onSuccess]);

  // ── 构建 Node List ──────────────────────────────────────────────────────
  const buildNodeList = useCallback((): NodeInfo[] => {
    const nodeList: NodeInfo[] = [
      { nodeId: NODE.duration,     fieldName: 'value',      fieldValue: duration,         description: '时长 (node 159)' },
      { nodeId: NODE.videoCount,   fieldName: 'value',      fieldValue: String(videoCount), description: '视频数量 (node 291)' },
      { nodeId: NODE.pixel,        fieldName: 'value',      fieldValue: pixel,            description: '像素/MinMax (node 25)' },
      { nodeId: NODE.nSwitch,      fieldName: 'value',      fieldValue: String(nNoN),     description: 'N/NO N (node 393)' },
      { nodeId: NODE.directOutput, fieldName: 'value',      fieldValue: String(directOutput), description: '直出/zip (node 272)' },
      { nodeId: NODE.unetName,     fieldName: 'unet_name',  fieldValue: selectedUnet,     description: '视频模型 (node 11)' },
      { nodeId: NODE.lora1Name,    fieldName: 'lora_name',  fieldValue: selectedLora1,    description: 'LoRA1 (node 355)' },
      { nodeId: NODE.lora1Strength, fieldName: 'strength_model', fieldValue: String(selectedLora1Weight), description: 'LoRA1强度 (node 355)' },
      { nodeId: NODE.lora2Name,    fieldName: 'lora_name',  fieldValue: selectedLora2,    description: 'LoRA2 (node 57)' },
      { nodeId: NODE.lora2Strength, fieldName: 'strength_model', fieldValue: String(selectedLora2Weight), description: 'LoRA2强度 (node 57)' },
      { nodeId: NODE.prompt,       fieldName: 'prompt',     fieldValue: prompt,           description: '提示词 (node 59)' },
    ];

    // 参考图: 最多 3 张 (nodes 28, 273, 285)
    const imageNodeIds = [NODE.refImage1, NODE.refImage2, NODE.refImage3];
    images.forEach((img, idx) => {
      if (img.path) {
        nodeList.push({
          nodeId: imageNodeIds[idx],
          fieldName: 'image',
          fieldValue: img.path,
          description: `参考图${idx + 1} (node ${imageNodeIds[idx]})`,
        });
      }
    });

    return nodeList;
  }, [duration, videoCount, pixel, nNoN, directOutput, prompt, images, selectedUnet, selectedLora1, selectedLora1Weight, selectedLora2, selectedLora2Weight]);

  // ── 模板应用（替换 <Picture N> 为实际图片引用）───────────────────────────
  const handleTemplateApply = useCallback((template: typeof H3_VIDEO_TEMPLATES[0]) => {
    let resolvedPrompt = template.prompt;
    // 遍历已上传的参考图，替换 <Picture N>
    const uploadedImages = images.filter(img => img.path);
    uploadedImages.forEach((img, idx) => {
      const regex = new RegExp(`<Picture\\s+${idx + 1}>`, 'g');
      resolvedPrompt = resolvedPrompt.replace(regex, img.preview || img.path);
    });
    setPrompt(resolvedPrompt);
    onSuccess(`已应用模板：${template.name}`);
  }, [images, onSuccess]);

  // ── 插入参考图引用到提示词 ─────────────────────────────────────────────
  const handleInsertPictureRef = useCallback((idx: number) => {
    setPrompt(prev => {
      const ref = `<Picture ${idx + 1}>`;
      if (!prev.trim()) return ref;
      return `${prev} ${ref}`;
    });
    onSuccess(`已插入 ${`<Picture ${idx + 1}>`} 到提示词`);
  }, [onSuccess]);

  // ── 提交 ───────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(() => {
    if (!prompt.trim()) {
      onError('请输入提示词');
      return;
    }
    if (!images.some(img => img.path)) {
      onError('请至少上传一张参考图');
      return;
    }
    if (submitting) return;
    setSubmitting(true);

    const nodeList = buildNodeList();
    const firstImage = images.find(img => img.path) ?? images[0];
    taskListRef.current?.submitTask(
      prompt,
      firstImage.path,
      firstImage.preview,
      nodeList,
      WORKFLOW_ID
    );
    onSuccess('任务已提交');
    setSubmitting(false);
  }, [prompt, images, submitting, buildNodeList, onError, onSuccess]);

  // ── 主题库批量生成 ────────────────────────────────────────────────────
  const handleThemeBatchGenerate = useCallback(async (themes: ThemeEntry[], dur: 15 | 30 | 60) => {
    if (!images.some(img => img.path)) {
      onError('请先上传或选择一张参考图片');
      return;
    }
    if (themes.length === 0) return;
    setThemeBatchProgress({ current: 0, total: themes.length });
    for (let i = 0; i < themes.length; i++) {
      const theme = themes[i];
      const themePrompt = 主题转视频提示词(theme, dur);
      const nodeList = buildNodeList();
      // Override duration and prompt in nodeList
      const nodeListClone = nodeList.map(n => {
        if (n.nodeId === NODE.duration) return { ...n, fieldValue: String(dur) };
        if (n.nodeId === NODE.prompt) return { ...n, fieldValue: themePrompt };
        return n;
      });
      const firstImage = images.find(img => img.path) ?? images[0];
      taskListRef.current?.submitTask(themePrompt, firstImage.path, firstImage.preview, nodeListClone, WORKFLOW_ID);
      setThemeBatchProgress({ current: i + 1, total: themes.length });
      await new Promise(r => setTimeout(r, 200));
    }
    setThemeBatchProgress(null);
    onSuccess(`已提交 ${themes.length} 个主题到 MiniMax 长视频 V2 生成队列`);
  }, [images, buildNodeList, onError, onSuccess]);

  const uploadedCount = images.filter(img => img.path).length;

  // ── UI ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* 标题卡片 */}
      <div className="rounded-xl bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-200/30 p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
            <Video size={20} className="text-white" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-text-primary">MiniMax 长视频 V2</h2>
            <p className="text-[11px] text-text-tertiary">workflowId: {WORKFLOW_ID}</p>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-text-tertiary">已上传</div>
            <div className="text-sm font-bold text-cyan-600">{uploadedCount}/3</div>
          </div>
        </div>
      </div>

      {/* 任务列表 */}
      <VideoTaskList
        ref={taskListRef}
        apiKey={apiKey}
        workflowId={WORKFLOW_ID}
        onError={onError}
        onSuccess={onSuccess}
      />

      {/* 数字人锚定 */}
      <GirlfriendSelector
        selectedIds={selectedGirlfriends
          .filter(Boolean)
          .map(g => (g.isCustom ? `custom_${g.id}` : g.id))}
        onSelect={handleGirlfriendSelect}
        disabled={submitting}
      />

      {/* 参考图上传 (3张) */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
            <ImageIcon size={16} className="text-cyan-500" />
            参考图（最多3张）
          </h3>
          <span className="text-xs text-text-tertiary">{uploadedCount}/3</span>
        </div>

        {/* 情色创作模式开关 + 方向选择 */}
        <div className="mb-3 p-3 rounded-xl bg-gradient-to-r from-pink-500/5 via-rose-500/5 to-red-500/5 border border-pink-200/50">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-pink-500" />
              <span className="text-xs font-medium text-text-primary">情色创作模式</span>
              <span className="text-[10px] text-text-tertiary hidden sm:inline">· Grok-4.6 AI 分析</span>
            </div>
            <button
              onClick={() => setEroticMode(!eroticMode)}
              className={`w-10 h-5 rounded-full transition-colors relative ${eroticMode ? 'bg-pink-500' : 'bg-text-tertiary'}`}
              disabled={submitting || eroticAnalyzing}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${eroticMode ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>
          {eroticMode && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-text-tertiary flex-shrink-0">创作方向：</span>
                {([
                  { value: 'soft', label: '纯情色', color: 'from-pink-400 to-rose-400' },
                  { value: 'normal', label: '带性爱', color: 'from-rose-400 to-red-400' },
                  { value: 'sm', label: 'SM重口味', color: 'from-red-400 to-orange-400' },
                ] as const).map(({ value, label, color }) => (
                  <button
                    key={value}
                    onClick={() => setEroticLevel(value)}
                    disabled={submitting || eroticAnalyzing}
                    className={`px-3 py-1 rounded-lg text-[10px] font-bold bg-gradient-to-r ${color} text-white transition-all hover:opacity-90 disabled:opacity-50 ${
                      eroticLevel === value ? 'ring-2 ring-yellow-300 shadow-md scale-105' : 'opacity-60'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                onClick={handleEroticAnalyze}
                disabled={submitting || eroticAnalyzing || images.filter(img => img.path).length === 0}
                className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  eroticAnalyzing
                    ? 'bg-pink-500/50 text-white/70 cursor-not-allowed'
                    : images.filter(img => img.path).length === 0
                    ? 'bg-pink-500/30 text-white/50 cursor-not-allowed'
                    : 'bg-gradient-to-r from-pink-500 to-rose-500 text-white hover:opacity-90 shadow-sm'
                }`}
              >
                {eroticAnalyzing ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>分析中，请稍候...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    <span>分析参考图生成提示词</span>
                  </>
                )}
              </button>
              <p className="text-[10px] text-pink-400/80">
                将分析第一张参考图，结合选定方向生成适合该场景的视频提示词
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map(idx => {
            const slot = images[idx];
            const isUploading = uploadingSlots.has(idx);
            return (
              <div key={idx} className="relative">
                {slot?.preview ? (
                  <div className="relative aspect-square rounded-xl overflow-hidden border-2 border-cyan-200 bg-bg-elevated">
                    <img src={slot.preview} alt={`参考图${idx + 1}`} className="w-full h-full object-cover" />
                    {isUploading && (
                      <div className="absolute inset-0 bg-black/45 flex flex-col items-center justify-center gap-1">
                        <Loader2 size={20} className="text-white animate-spin" />
                        <span className="text-[10px] text-white/90">上传中...</span>
                      </div>
                    )}
                    {!isUploading && (
                      <button
                        onClick={() => handleImageRemove(idx)}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                        disabled={submitting}
                      >
                        <X size={12} />
                      </button>
                    )}
                    {images[idx]?.path && (
                      <button
                        onClick={() => handleInsertPictureRef(idx)}
                        className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-cyan-500/90 text-white text-[9px] font-medium hover:bg-cyan-600 transition-colors"
                        disabled={submitting}
                        title="插入 <Picture N> 到提示词"
                      >
                        &lt;Picture {idx + 1}&gt;
                      </button>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1">
                      <span className="text-[10px] text-white/90">
                        {isUploading ? '上传中...' : `参考图 ${idx + 1} (node ${[NODE.refImage1, NODE.refImage2, NODE.refImage3][idx]})`}
                      </span>
                    </div>
                  </div>
                ) : (
                  <label className={`relative flex flex-col items-center justify-center aspect-square rounded-xl border-2 border-dashed transition-colors ${submitting ? 'border-border opacity-50 cursor-not-allowed' : 'border-border hover:border-cyan-400 cursor-pointer'}`}>
                    <ImageIcon size={20} className="text-text-tertiary" />
                    <span className="text-[10px] text-text-tertiary mt-1">上传</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) handleImageUpload(file, idx);
                      }}
                      disabled={submitting}
                    />
                  </label>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-text-tertiary mt-2">
          第一张图将作为视频首帧，后续图片作为动作参考
        </p>
      </div>

      {/* 快速引用：上传/锚定图片后显示可点击的图片引用 */}
      {uploadedCount > 0 && (
        <div className="rounded-xl bg-bg-surface border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-medium text-text-primary">快速引用</h3>
            <span className="text-[10px] text-text-tertiary">点击插入 &lt;Picture N&gt;</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {images.map((img, idx) => {
              if (!img.preview) return null;
              return (
                <button
                  key={idx}
                  onClick={() => handleInsertPictureRef(idx)}
                  className="relative group flex flex-col items-center gap-1"
                  title={`插入 <Picture ${idx + 1}> 到提示词`}
                  disabled={submitting}
                >
                  <div className="w-14 h-14 rounded-xl overflow-hidden border-2 border-cyan-200 group-hover:border-cyan-400 transition-colors">
                    <img src={img.preview} alt={`图片${idx + 1}`} className="w-full h-full object-cover" />
                  </div>
                  <span className="text-[10px] text-text-tertiary group-hover:text-cyan-600 transition-colors">
                    图片{idx + 1}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 视频参数设置 */}
      <div className="rounded-xl bg-bg-surface border border-border p-4 space-y-3">
        <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
          <Sparkles size={16} className="text-cyan-500" />
          视频参数
        </h3>

        {/* 第一行: 时长 + 视频数量 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-text-tertiary mb-1.5">时长 <span className="text-[9px] text-cyan-500">(node 159)</span></label>
            <select
              value={duration}
              onChange={e => setDuration(e.target.value)}
              className="w-full h-9 px-3 rounded-lg text-xs border border-border bg-bg-elevated text-text-primary focus:outline-none focus:border-cyan-400 appearance-none cursor-pointer"
            >
              {DURATION_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-text-tertiary mb-1.5">视频数量 <span className="text-[9px] text-cyan-500">(node 291)</span></label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setVideoCount(v => Math.max(1, v - 1))}
                className="w-8 h-8 rounded-lg bg-bg-elevated border border-border text-text-primary hover:bg-bg-hover flex items-center justify-center text-sm font-bold"
                disabled={videoCount <= 1}
              >
                −
              </button>
              <div className="flex-1 h-9 px-3 rounded-lg border border-border bg-bg-elevated flex items-center justify-center text-sm font-medium text-text-primary">
                {videoCount}
              </div>
              <button
                onClick={() => setVideoCount(v => Math.min(10, v + 1))}
                className="w-8 h-8 rounded-lg bg-bg-elevated border border-border text-text-primary hover:bg-bg-hover flex items-center justify-center text-sm font-bold"
                disabled={videoCount >= 10}
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* 第二行: 像素 + N/NO N */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-text-tertiary mb-1.5">像素 (Min/Max) <span className="text-[9px] text-cyan-500">(node 25)</span></label>
            <input
              type="number"
              value={pixel}
              onChange={e => setPixel(e.target.value)}
              min="0.05"
              max="1"
              step="0.05"
              className="w-full h-9 px-3 rounded-lg text-xs border border-border bg-bg-elevated text-text-primary focus:outline-none focus:border-cyan-400"
            />
          </div>
          <div>
            <label className="block text-xs text-text-tertiary mb-1.5">N/NO N <span className="text-[9px] text-cyan-500">(node 393)</span></label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setNNoN(true)}
                className={`flex-1 h-9 px-3 rounded-lg text-xs font-medium border transition-colors ${
                  nNoN ? 'bg-cyan-500 text-white border-cyan-500' : 'bg-bg-elevated text-text-secondary border-border hover:border-cyan-300'
                }`}
                disabled={submitting}
              >
                NO N
              </button>
              <button
                onClick={() => setNNoN(false)}
                className={`flex-1 h-9 px-3 rounded-lg text-xs font-medium border transition-colors ${
                  !nNoN ? 'bg-cyan-500 text-white border-cyan-500' : 'bg-bg-elevated text-text-secondary border-border hover:border-cyan-300'
                }`}
                disabled={submitting}
              >
                N
              </button>
            </div>
          </div>
        </div>

        {/* 第三行: 直出/zip */}
        <div className="flex items-center justify-between py-1">
          <div>
            <div className="text-xs text-text-primary font-medium">直出/zip <span className="text-[9px] text-cyan-500">(node 272)</span></div>
            <div className="text-[10px] text-text-tertiary mt-0.5">
              {directOutput ? '直出：输出MP4视频文件' : 'ZIP：输出压缩包（含帧图）'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDirectOutput(false)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                !directOutput ? 'bg-cyan-500 text-white border-cyan-500' : 'bg-bg-elevated text-text-secondary border-border hover:border-cyan-300'
              }`}
              disabled={submitting}
            >
              ZIP
            </button>
            <button
              onClick={() => setDirectOutput(true)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                directOutput ? 'bg-cyan-500 text-white border-cyan-500' : 'bg-bg-elevated text-text-secondary border-border hover:border-cyan-300'
              }`}
              disabled={submitting}
            >
              直出
            </button>
          </div>
        </div>

        {/* 固定模型/LoRA 显示 → 改为模型选择器 */}
        <div className="rounded-lg bg-bg-elevated border border-border p-3 space-y-3">
          <div className="text-xs text-text-tertiary font-medium mb-1">模型配置 <span className="text-[9px] text-cyan-500">(可从模型库选择替换)</span></div>
          {/* UNet 视频模型 */}
          <RunningHubModelPicker
            label="视频模型"
            kind="unet"
            value={selectedUnet}
            onChange={setSelectedUnet}
            placeholder="选择视频模型"
            disabled={submitting}
            baseModelFilter="minimax-h3"
          />
          {/* LoRA 1 */}
          <RunningHubModelPicker
            label="LoRA 1"
            kind="lora"
            value={selectedLora1}
            onChange={setSelectedLora1}
            placeholder="不使用"
            disabled={submitting}
            baseModelFilter="minimax-h3"
            loraSlot="lora1"
          />
          {/* LoRA 1 强度 */}
          {selectedLora1 && (
            <div className="px-1">
              <label className="text-[10px] text-text-tertiary mb-1 block">LoRA 1 强度 <span className="text-[9px] text-cyan-500">(node 355)</span></label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={selectedLora1Weight}
                  onChange={e => setSelectedLora1Weight(parseFloat(e.target.value))}
                  className="flex-1 h-1.5 rounded-full appearance-none bg-border cursor-pointer"
                  disabled={submitting}
                />
                <span className="text-[11px] text-text-secondary w-10 text-right tabular-nums">{selectedLora1Weight.toFixed(2)}</span>
              </div>
            </div>
          )}
          {/* LoRA 2 */}
          <RunningHubModelPicker
            label="LoRA 2"
            kind="lora"
            value={selectedLora2}
            onChange={setSelectedLora2}
            placeholder="不使用"
            disabled={submitting}
            baseModelFilter="minimax-h3"
            loraSlot="lora2"
          />
          {/* LoRA 2 强度 */}
          {selectedLora2 && (
            <div className="px-1">
              <label className="text-[10px] text-text-tertiary mb-1 block">LoRA 2 强度 <span className="text-[9px] text-cyan-500">(node 57)</span></label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={selectedLora2Weight}
                  onChange={e => setSelectedLora2Weight(parseFloat(e.target.value))}
                  className="flex-1 h-1.5 rounded-full appearance-none bg-border cursor-pointer"
                  disabled={submitting}
                />
                <span className="text-[11px] text-text-secondary w-10 text-right tabular-nums">{selectedLora2Weight.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* PosePresetSelector */}
      <PosePresetSelector
        type="video"
        onSelect={handlePoseSelect}
        disabled={submitting}
        selectedGirlfriend={selectedGirlfriends[0] ?? null}
      />

      {/* 提示词 */}
      <div className="rounded-xl bg-bg-surface border border-border p-4 space-y-3">
        <h3 className="text-sm font-medium text-text-primary">提示词 <span className="text-[9px] text-cyan-500">(node 59)</span></h3>
        {/* 模版预设 */}
        {H3_VIDEO_TEMPLATES.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-text-tertiary flex-shrink-0">模版：</span>
            <div className="flex flex-wrap gap-1.5">
              {H3_VIDEO_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.name}
                  onClick={() => handleTemplateApply(tpl)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium bg-gradient-to-r ${tpl.color} text-white hover:opacity-90 transition-opacity`}
                  disabled={submitting}
                >
                  {tpl.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="输入视频描述... 可用 &lt;Picture 1&gt;, &lt;Picture 2&gt; 等引用参考图"
          rows={10}
          style={{ maxHeight: '600px', minHeight: '120px' }}
          className="w-full border border-border rounded-xl px-4 py-3 text-sm placeholder:text-text-secondary focus:outline-none focus:border-cyan-400 bg-bg-elevated resize-y overflow-y-auto"
        />
        <p className="text-[11px] text-text-tertiary">
          提示词将发送给 AI 模型生成视频内容，建议描述场景、动作、氛围。可用 <code className="text-primary">&lt;Picture 1&gt;</code>、<code className="text-primary">&lt;Picture 2&gt;</code> 等引用已上传的参考图。
        </p>

        {/* 生成按钮 - 放在提示词下方 */}
        <GenerateButton
          onClick={handleSubmit}
          isLoading={submitting || uploading || girlfriendUploading}
          disabled={!prompt.trim() || !images.some(img => img.path) || submitting || uploading || girlfriendUploading}
          label={girlfriendUploading ? '锚定上传中...' : uploading ? '上传中...' : submitting ? '提交中...' : '生成视频'}
        />
      </div>

      {/* 主题库批量生成 */}
      <ThemeLibraryPanel
        on应用提示词={(提示词) => {
          // 去掉 subject_definitions / overall_soundscape / non_diegetic_music 段落
          // （技术元数据标签，不适合显示在提示词框中）
          const cleaned = 提示词
            .replace(/^subject_definitions:.*?(?=\n\n)/s, '')
            .replace(/^overall_soundscape:.*?(?=\n\n)/s, '')
            .replace(/^non_diegetic_music:.*?(?=\n\n)/s, '')
            .replace(/^\n+/, '');
          setPrompt(cleaned);
          onSuccess('已应用主题提示词');
        }}
        on批量生成={handleThemeBatchGenerate}
      />
    </div>
  );
}
