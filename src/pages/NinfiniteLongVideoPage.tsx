import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Video, Image as ImageIcon, Loader2, X, Upload, Sparkles } from 'lucide-react';
import { uploadImage } from '../services/runninghub';
import { ImageUploader } from '../components/ImageUploader';
import { GenerateButton } from '../components/GenerateButton';
import { VideoTaskList } from '../components/VideoTaskList';
import type { NodeInfo } from '../types';
import type { GirlfriendPreset } from '../data/girlfriendPresets';
import { GirlfriendSelector } from '../components/GirlfriendSelector';
import { H3_VIDEO_TEMPLATES } from './ImageToVideoPage';

// ────────────────────────────────────────────────────────────────────────────────
// N无限X一键长视频 v1.1 — workflowId 2094226327238135810 (Minimax H3)
// 参考文档: https://www.runninghub.ai/zh-cn/call-api/api-detail/2094226327238135810?apiType=4
// ────────────────────────────────────────────────────────────────────────────────

const WORKFLOW_ID = '2094226327238135810';

// 节点 ID 与官方 curl 示例完全对齐 (description: null)
const NODE = {
  videoDuration:  '217',          // value, 秒数
  unetModelIndex: '417',         // index, UNet 模型序号
  aspectRatioIndex: '435',       // index, 画幅比例序号
  modeSelect:     '533',         // select, 模式选择
  refImageResolution: '520',     // select, 参考图分辨率
  randomSeed:     '500',         // value, 随机种子
  enableUpscale:  '315',        // value, 打开二采放大
  promptEnhance:  '494',        // value, 提示词增强
  prompt:         '205',         // value, 提示词
  // node 465: 官方 curl 存在，文档未说明用途（待确认）
  node465:        '465',
  refImage1:      '368',        // image, 参考图1
  refImage2:      '361',        // image, 参考图2
  refImage3:      '362',        // image, 参考图3
  refImage4:      '363',        // image, 参考图4
  refImage5:      '364',        // image, 参考图5
  refImage6:      '365',        // image, 参考图6
  refImage7:      '366',        // image, 参考图7
  refImage8:      '367',        // image, 参考图8
  refImage9:      '356',        // image, 参考图9
} as const;

// ── 参数选项 ──────────────────────────────────────────────────────────────────

const DURATION_PRESETS = [
  { value: 5, label: '5秒' },
  { value: 8, label: '8秒' },
  { value: 15, label: '15秒' },
  { value: 30, label: '30秒' },
  { value: 60, label: '60秒' },
];

const UNET_MODEL_OPTIONS = [
  { value: '0', label: '0 - 默认 UNet 模型' },
];

const ASPECT_RATIO_OPTIONS = [
  { value: '0', label: '16:9 (横版)' },
  { value: '1', label: '1:1 (方形)' },
  { value: '2', label: '2:3 (竖向照片)' },
  { value: '3', label: '3:4 (竖向标准)' },
  { value: '4', label: '4:3 (横向标准)' },
  { value: '5', label: '9:16 (竖屏)' },
  { value: '6', label: '21:9 (超宽)' },
  { value: '7', label: '原生比例' },
];

const MODE_OPTIONS = [
  { value: '1', label: '4步快速 (文戏)' },
  { value: '2', label: '20步质量 (高动态武戏)' },
];

const REF_RES_OPTIONS = [
  { value: '0', label: 'match (匹配)' },
  { value: '1', label: '544P' },
  { value: '2', label: '736P' },
  { value: '3', label: '1024P' },
  { value: '4', label: '2048P' },
];

const REFERENCE_IMAGE_NODE_IDS = [
  NODE.refImage1, NODE.refImage2, NODE.refImage3, NODE.refImage4,
  NODE.refImage5, NODE.refImage6, NODE.refImage7, NODE.refImage8,
  NODE.refImage9,
] as const;

interface ReferenceImage {
  path: string;       // RunningHub 上传后的路径 (openapi/xxx.png) 或 'None'
  preview: string;    // 本地 object URL / dataURL 用于 UI 预览
}

interface NinfiniteLongVideoPageProps {
  apiKey: string;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  /** 初始参考图 (用于历史记录 → 长视频 v1.1 的场景，会被写入 slot 0) */
  initialImage?: { path: string; preview: string } | null;
}

export function NinfiniteLongVideoPage({ apiKey, onError, onSuccess, initialImage }: NinfiniteLongVideoPageProps) {
  // ── 表单状态 (默认值全部对齐官方 curl 示例) ────────────────────────────────
  const [images, setImages] = useState<ReferenceImage[]>(
    Array.from({ length: 9 }, () => ({ path: 'None', preview: '' }))
  );

  // ── 一次性注入初始参考图 (从历史记录跳转过来时) ────────────────────────────────
  // 用 ref 防止后续 initialImage 变化再次覆盖用户已上传的图片
  const appliedInitialRef = useRef(false);
  useEffect(() => {
    if (appliedInitialRef.current) return;
    if (!initialImage?.path) return;
    appliedInitialRef.current = true;
    setImages((prev) => {
      const next = [...prev];
      next[0] = { path: initialImage.path, preview: initialImage.preview };
      return next;
    });
    onSuccess('已从历史记录导入图片到长视频 v1.1（参考图 1）');
  }, [initialImage, onSuccess]);
  const [prompt, setPrompt] = useState<string>('图片1为男主，图片2为女主，生成两人约会的视频提示词');
  const [duration, setDuration] = useState<number>(60);
  const [customDuration, setCustomDuration] = useState<string>('');
  const [unetModelIndex, setUnetModelIndex] = useState<string>('0');
  const [aspectRatioIndex, setAspectRatioIndex] = useState<string>('5');
  const [mode, setMode] = useState<string>('1');
  const [refResolution, setRefResolution] = useState<string>('3');
  const [seed, setSeed] = useState<string>('111');
  const [randomizeSeed, setRandomizeSeed] = useState<boolean>(true);
  const [enableUpscale, setEnableUpscale] = useState<boolean>(false);
  const [promptEnhance, setPromptEnhance] = useState<boolean>(true);
  const [node465, setNode465] = useState<boolean>(false); // 官方 curl 中存在，文档未说明用途

  const [uploading, setUploading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [selectedGirlfriend, setSelectedGirlfriend] = useState<GirlfriendPreset | null>(null);
  const [girlfriendUploading, setGirlfriendUploading] = useState<boolean>(false);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  const taskListRef = useRef<{
    submitTask: (prompt: string, imagePath: string, imagePreview: string, nodeInfoList: NodeInfo[], workflowId?: string) => void;
  } | null>(null);

  // ── 图片上传 ────────────────────────────────────────────────────────────────
  const handleImageUpload = useCallback(async (file: File, index: number) => {
    setUploading(true);
    try {
      const objectUrl = URL.createObjectURL(file);
      const { imagePath } = await uploadImage(apiKey, file);
      setImages((prev) => {
        const next = [...prev];
        next[index] = { path: imagePath, preview: objectUrl };
        return next;
      });
      onSuccess(`参考图 ${index + 1} 上传成功`);
    } catch (err) {
      onError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
    }
  }, [apiKey, onSuccess, onError]);

  const handleImageRemove = useCallback((index: number) => {
    setImages((prev) => {
      const next = [...prev];
      next[index] = { path: 'None', preview: '' };
      return next;
    });
  }, []);

  // ── 女友锚定 (自动上传到 slot 0) ────────────────────────────────────────────
  const handleGirlfriendSelect = useCallback(async (gf: GirlfriendPreset) => {
    setSelectedGirlfriend(gf);
    setGirlfriendUploading(true);
    try {
      const res = await fetch(gf.portraitUrl);
      const blob = await res.blob();
      const file = new File([blob], `${gf.id}.jpg`, { type: blob.type || 'image/jpeg' });
      const objectUrl = URL.createObjectURL(blob);
      const { imagePath } = await uploadImage(apiKey, file);
      setImages((prev) => {
        const next = [...prev];
        next[0] = { path: imagePath, preview: objectUrl };
        return next;
      });
      onSuccess(`已选择「${gf.nameZh || gf.name}」并设为参考图 1`);
    } catch (err) {
      onError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setGirlfriendUploading(false);
    }
  }, [apiKey, onSuccess, onError]);

  // ── 构建节点列表 — 100% 对齐官方 curl 示例 (description: null) ─────────────
  // 注意：node 483 (upscaleLoraIndex) 所有选项均为 16:9 分辨率，
  // 上传后处理 upscale 会强制将输出转为 16:9，覆盖 node 435 的画幅设置，
  // 故不提交 node 483，保持原始生成画幅。
  const buildNodeList = useCallback((): NodeInfo[] => {
    const finalDuration = customDuration ? parseInt(customDuration, 10) || duration : duration;
    const finalSeed = randomizeSeed ? Math.floor(Math.random() * 1_000_000_000).toString() : seed;

    const nodeInfoList: NodeInfo[] = [
      { nodeId: NODE.videoDuration,      fieldName: 'value',  fieldValue: String(finalDuration), description: null },
      { nodeId: NODE.unetModelIndex,    fieldName: 'index',  fieldValue: unetModelIndex,        description: null },
      { nodeId: NODE.aspectRatioIndex,   fieldName: 'index',  fieldValue: aspectRatioIndex,      description: null },
      { nodeId: NODE.modeSelect,        fieldName: 'select', fieldValue: mode,                  description: null },
      { nodeId: NODE.refImageResolution,fieldName: 'select', fieldValue: refResolution,         description: null },
      { nodeId: NODE.randomSeed,        fieldName: 'value',  fieldValue: finalSeed,             description: null },
      { nodeId: NODE.enableUpscale,     fieldName: 'value',  fieldValue: String(enableUpscale), description: null },
      { nodeId: NODE.promptEnhance,     fieldName: 'value',  fieldValue: String(promptEnhance), description: null },
      { nodeId: NODE.node465,           fieldName: 'value',  fieldValue: String(node465),        description: null },
      { nodeId: NODE.prompt,            fieldName: 'value',  fieldValue: prompt,                description: null },
    ];

    // 9 个图片节点, 未上传的填 'None' (与官方文档一致)
    REFERENCE_IMAGE_NODE_IDS.forEach((nodeId, idx) => {
      nodeInfoList.push({
        nodeId,
        fieldName: 'image',
        fieldValue: images[idx].path || 'None',
        description: null,
      });
    });

    return nodeInfoList;
  }, [customDuration, duration, unetModelIndex, aspectRatioIndex,
      mode, refResolution, randomizeSeed, seed, enableUpscale, promptEnhance,
      node465, prompt, images]);

  // ── 提交 ────────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(() => {
    if (!prompt.trim()) {
      onError('请输入提示词');
      return;
    }
    if (!images.some((img) => img.path && img.path !== 'None')) {
      onError('请至少上传一张参考图');
      return;
    }
    if (submitting) return;
    setSubmitting(true);

    const nodeList = buildNodeList();
    const firstImage = images.find((img) => img.path && img.path !== 'None') ?? images[0];
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

  const uploadedCount = images.filter((img) => img.path && img.path !== 'None').length;
  const finalDuration = customDuration ? parseInt(customDuration, 10) || duration : duration;

  // ── 模板预设 ──────────────────────────────────────────────────────────────────
  const handleTemplateApply = useCallback((template: typeof H3_VIDEO_TEMPLATES[0]) => {
    setPrompt(template.prompt);
    onSuccess(`已应用模板：${template.name}`);
  }, [onSuccess]);

  return (
    <div className="space-y-4 pb-24">
      {/* 标题 */}
      <div className="rounded-xl bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-200/30 p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <Video size={20} className="text-white" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-text-primary">N无限X一键长视频 v1.1</h2>
            <p className="text-[11px] text-text-tertiary">workflowId: {WORKFLOW_ID}</p>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-text-tertiary">已上传</div>
            <div className="text-sm font-bold text-primary">{uploadedCount}/9</div>
          </div>
        </div>
      </div>

      {/* 数字人锚定 */}
      <GirlfriendSelector
        selectedId={selectedGirlfriend ? (selectedGirlfriend.isCustom ? `custom_${selectedGirlfriend.id}` : selectedGirlfriend.id) : null}
        onSelect={handleGirlfriendSelect}
        disabled={girlfriendUploading || submitting}
      />

      {/* 参考图 (9 宫格) */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <h3 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
          <ImageIcon size={15} className="text-purple-500" />
          参考图 (最多 9 张)
          {selectedGirlfriend && (
            <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 text-[10px] font-medium">
              AI 女友模式
            </span>
          )}
        </h3>
        <div className="grid grid-cols-5 gap-2">
          {images.map((img, idx) => (
            <div key={idx} className="relative">
              {img.preview ? (
                <div className="relative aspect-square rounded-xl overflow-hidden border-2 border-purple-200 bg-bg-elevated">
                  <img src={img.preview} alt={`参考图 ${idx + 1}`} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => handleImageRemove(idx)}
                    disabled={submitting}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                  >
                    <X size={12} />
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1">
                    <span className="text-[10px] text-white/90">参考图 {idx + 1}</span>
                  </div>
                </div>
              ) : (
                <label className={`relative flex flex-col items-center justify-center aspect-square rounded-xl border-2 border-dashed bg-bg-elevated cursor-pointer transition-colors ${uploading || submitting ? 'border-border opacity-50 cursor-not-allowed' : 'border-border hover:border-purple-400'}`}>
                  {uploading ? (
                    <Loader2 size={20} className="text-purple-400 animate-spin" />
                  ) : (
                    <>
                      <Upload size={18} className="text-text-tertiary" />
                      <span className="text-[10px] text-text-tertiary mt-1">图 {idx + 1}</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImageUpload(file, idx);
                    }}
                    disabled={uploading || submitting}
                  />
                </label>
              )}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-text-tertiary mt-2">
          未上传的参考图将自动使用 'None' 填充 (与官方 API 一致)
        </p>
      </div>

      {/* 提示词 */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
            <Sparkles size={15} className="text-primary" />
            提示词 (node 205)
          </h3>
        </div>
        {/* 模版预设 */}
        {H3_VIDEO_TEMPLATES.length > 0 && (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-text-tertiary flex-shrink-0">模版：</span>
            <div className="flex flex-wrap gap-1.5">
              {H3_VIDEO_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.name}
                  type="button"
                  onClick={() => handleTemplateApply(tpl)}
                  disabled={submitting}
                  className={`px-3 py-1 rounded-lg text-xs font-medium bg-gradient-to-r ${tpl.color} text-white hover:opacity-90 transition-opacity disabled:opacity-50`}
                >
                  {tpl.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="例如: 图片1为男主，图片2为女主，生成两人约会的视频提示词"
          disabled={submitting}
          className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-sm text-text-primary placeholder-slate-500 focus:outline-none focus:border-primary/50 resize-none"
        />
        {selectedGirlfriend && (
          <div className="mt-2 px-2 py-1 rounded bg-red-50 border border-red-200 text-[10px] text-red-600">
            已锚定数字人: {selectedGirlfriend.nameZh || selectedGirlfriend.name}
          </div>
        )}
      </div>

      {/* 时长 (核心参数) */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <h3 className="text-sm font-medium text-text-primary mb-3">
          视频时长 (node 217) — 当前: <span className="text-primary">{finalDuration} 秒</span>
        </h3>
        <div className="flex flex-wrap gap-2 mb-3">
          {DURATION_PRESETS.map((d) => (
            <button
              key={d.value}
              type="button"
              onClick={() => { setDuration(d.value); setCustomDuration(''); }}
              disabled={submitting}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                duration === d.value && !customDuration
                  ? 'bg-primary text-white'
                  : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover'
              }`}
            >
              {d.label}
            </button>
          ))}
          <input
            type="number"
            value={customDuration}
            onChange={(e) => setCustomDuration(e.target.value)}
            placeholder="自定义"
            min={1}
            max={300}
            disabled={submitting}
            className="w-20 px-2 py-1.5 rounded-lg bg-bg-elevated border border-border text-xs text-text-primary focus:outline-none focus:border-primary"
          />
        </div>
      </div>

      {/* 高级设置 */}
      <div className="rounded-xl bg-bg-surface border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-bg-elevated transition-colors"
        >
          <span className="text-sm font-medium text-text-primary">高级设置</span>
          <span className="text-xs text-text-tertiary">{showAdvanced ? '收起' : '展开'}</span>
        </button>
        {showAdvanced && (
          <div className="px-4 pb-4 space-y-3 border-t border-border/50">
            {/* 模式选择 (node 533) */}
            <div>
              <label className="text-xs text-text-secondary block mb-1.5">模式选择 (node 533)</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                disabled={submitting}
                className="w-full h-9 px-3 rounded-lg text-xs border border-border bg-bg-elevated text-text-primary focus:outline-none focus:border-primary appearance-none cursor-pointer"
              >
                {MODE_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
            </div>

            {/* UNet 模型 (node 417) */}
            <div>
              <label className="text-xs text-text-secondary block mb-1.5">UNet 模型 (node 417)</label>
              <select
                value={unetModelIndex}
                onChange={(e) => setUnetModelIndex(e.target.value)}
                disabled={submitting}
                className="w-full h-9 px-3 rounded-lg text-xs border border-border bg-bg-elevated text-text-primary focus:outline-none focus:border-primary appearance-none cursor-pointer"
              >
                {UNET_MODEL_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
            </div>

            {/* 画幅比例 (node 435) */}
            <div>
              <label className="text-xs text-text-secondary block mb-1.5">画幅比例 (node 435)</label>
              <select
                value={aspectRatioIndex}
                onChange={(e) => setAspectRatioIndex(e.target.value)}
                disabled={submitting}
                className="w-full h-9 px-3 rounded-lg text-xs border border-border bg-bg-elevated text-text-primary focus:outline-none focus:border-primary appearance-none cursor-pointer"
              >
                {ASPECT_RATIO_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
            </div>

            {/* 参考图分辨率 (node 520) */}
            <div>
              <label className="text-xs text-text-secondary block mb-1.5">参考图分辨率 (node 520)</label>
              <select
                value={refResolution}
                onChange={(e) => setRefResolution(e.target.value)}
                disabled={submitting}
                className="w-full h-9 px-3 rounded-lg text-xs border border-border bg-bg-elevated text-text-primary focus:outline-none focus:border-primary appearance-none cursor-pointer"
              >
                {REF_RES_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
            </div>

            {/* 随机种子 */}
            <div className="grid grid-cols-2 gap-3 items-end">
              <div>
                <label className="text-xs text-text-secondary block mb-1.5">随机种子 (node 500)</label>
                <input
                  type="text"
                  value={randomizeSeed ? '(每次随机)' : seed}
                  onChange={(e) => { setRandomizeSeed(false); setSeed(e.target.value); }}
                  disabled={randomizeSeed || submitting}
                  className="w-full h-9 px-3 rounded-lg text-xs border border-border bg-bg-elevated text-text-primary focus:outline-none focus:border-primary disabled:opacity-50"
                />
              </div>
              <button
                type="button"
                onClick={() => setRandomizeSeed(!randomizeSeed)}
                disabled={submitting}
                className={`h-9 px-3 rounded-lg text-xs font-medium transition-all ${
                  randomizeSeed ? 'bg-primary text-white' : 'bg-bg-elevated text-text-secondary'
                }`}
              >
                随机 {randomizeSeed ? '✓' : ''}
              </button>
            </div>

            {/* 二采放大 */}
            <label className="flex items-center justify-between px-3 py-2 rounded-lg bg-bg-elevated cursor-pointer">
              <span className="text-xs text-text-secondary">二采放大 (node 315) — 开启后画质更好但耗时翻倍</span>
              <button
                type="button"
                onClick={() => setEnableUpscale(!enableUpscale)}
                disabled={submitting}
                className={`w-10 h-6 rounded-full transition-colors relative ${enableUpscale ? 'bg-primary' : 'bg-text-tertiary'}`}
              >
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${enableUpscale ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
            </label>

            {/* 提示词增强 */}
            <label className="flex items-center justify-between px-3 py-2 rounded-lg bg-bg-elevated cursor-pointer">
              <span className="text-xs text-text-secondary">提示词增强 (node 494) — 自动补全细节</span>
              <button
                type="button"
                onClick={() => setPromptEnhance(!promptEnhance)}
                disabled={submitting}
                className={`w-10 h-6 rounded-full transition-colors relative ${promptEnhance ? 'bg-primary' : 'bg-text-tertiary'}`}
              >
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${promptEnhance ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
            </label>

            {/* node 465 — 官方 curl 存在，文档未说明用途 */}
            <label className="flex items-center justify-between px-3 py-2 rounded-lg bg-bg-elevated cursor-pointer">
              <span className="text-xs text-text-secondary">额外开关 (node 465) — 用途待确认</span>
              <button
                type="button"
                onClick={() => setNode465(!node465)}
                disabled={submitting}
                className={`w-10 h-6 rounded-full transition-colors relative ${node465 ? 'bg-primary' : 'bg-text-tertiary'}`}
              >
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${node465 ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
            </label>
          </div>
        )}
      </div>

      {/* 生成按钮 */}
      <div className="sticky bottom-0 bg-gradient-to-t from-white via-white to-transparent pt-4 pb-2">
        <GenerateButton
          onClick={handleSubmit}
          isLoading={submitting}
          disabled={!prompt.trim() || uploadedCount === 0 || submitting || uploading || girlfriendUploading}
          label={uploading ? '上传中...' : submitting ? '提交中...' : `生成 ${finalDuration} 秒视频`}
        />
      </div>

      {/* 任务列表 */}
      <VideoTaskList
        ref={taskListRef}
        apiKey={apiKey}
        workflowId={WORKFLOW_ID}
        onError={onError}
        onSuccess={onSuccess}
      />
    </div>
  );
}

export default NinfiniteLongVideoPage;
