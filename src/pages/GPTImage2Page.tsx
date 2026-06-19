import React, { useState, useCallback, useRef } from 'react';
import {
  Sparkles,
  Upload,
  Image as ImageIcon,
  Wand2,
  RotateCcw,
  X,
  Loader2,
  Download,
  Palette,
  ImagePlus,
  Loader,
} from 'lucide-react';
import { GirlfriendSelector } from '../components/GirlfriendSelector';
import { generateImage, editImage, girlfriendToFile, type GptImageQuality, type GptImageSize } from '../services/gptImage2Api';
import { expandPrompt } from '../services/promptApi';
import type { GirlfriendPreset } from '../data/girlfriendPresets';
import { downloadImage } from '../services/runninghub';

interface GPTImage2PageProps {
  yunwuKey: string | null;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

type SubMode = 'txt2img' | 'edit';

const QUALITY_OPTIONS: { value: GptImageQuality; label: string; desc: string }[] = [
  { value: 'low', label: '快速', desc: '草稿预览' },
  { value: 'medium', label: '标准', desc: '平衡速度与质量' },
  { value: 'high', label: '高清', desc: '最高质量' },
];

const SIZE_OPTIONS: { value: GptImageSize; label: string; ratio: string }[] = [
  { value: '1024x1024', label: '1:1', ratio: '正方形' },
  { value: '1536x1024', label: '3:2', ratio: '横版' },
  { value: '1024x1536', label: '2:3', ratio: '竖版' },
  { value: 'auto', label: '自动', ratio: '由模型决定' },
];

const STYLE_PRESETS = [
  'photorealistic',
  'anime',
  'digital art',
  'oil painting',
  'watercolor',
  '3d render',
  'concept art',
  'cinematic',
];

export function GPTImage2Page({ yunwuKey, onError, onSuccess }: GPTImage2PageProps) {
  const [mode, setMode] = useState<SubMode>('txt2img');

  // ── Shared params ─────────────────────────────────────────────────────────
  const [prompt, setPrompt] = useState('');
  const [quality, setQuality] = useState<GptImageQuality>('medium');
  const [size, setSize] = useState<GptImageSize>('1024x1024');
  const [n, setN] = useState(1);
  const [style, setStyle] = useState('');

  // ── Reference / edit image ────────────────────────────────────────────────
  const [refImageFile, setRefImageFile] = useState<File | null>(null);
  const [refImagePreview, setRefImagePreview] = useState('');
  const [maskFile, setMaskFile] = useState<File | null>(null);
  const [maskPreview, setMaskPreview] = useState('');
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [editImagePreview, setEditImagePreview] = useState('');
  const refInputRef = useRef<HTMLInputElement>(null);
  const maskInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // ── Girlfriend ────────────────────────────────────────────────────────────
  const [selectedGirlfriend, setSelectedGirlfriend] = useState<GirlfriendPreset | null>(null);
  const [gfImageFile, setGfImageFile] = useState<File | null>(null);

  // ── Smart expand ──────────────────────────────────────────────────────────
  const [isExpanding, setIsExpanding] = useState(false);

  // ── Results ───────────────────────────────────────────────────────────────
  const [results, setResults] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  // ── Reference image handlers ───────────────────────────────────────────────
  const handleRefImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRefImageFile(file);
    setRefImagePreview(URL.createObjectURL(file));
  }, []);

  const handleMaskChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMaskFile(file);
    setMaskPreview(URL.createObjectURL(file));
  }, []);

  const handleEditImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEditImageFile(file);
    setEditImagePreview(URL.createObjectURL(file));
  }, []);

  const handleGirlfriendSelect = useCallback(async (gf: GirlfriendPreset) => {
    setSelectedGirlfriend(gf);
    try {
      const file = await girlfriendToFile(gf);
      setGfImageFile(file);
      onSuccess(`已选择「${gf.nameZh || gf.name}」作为参考角色`);
    } catch {
      onError('加载女友图片失败');
    }
  }, [onSuccess, onError]);

  // ── Smart expand ──────────────────────────────────────────────────────────
  const handleExpand = useCallback(async () => {
    if (!prompt.trim()) {
      onError('请先输入提示词内容');
      return;
    }

    setIsExpanding(true);
    try {
      const res = await expandPrompt(
        prompt.trim(),
        'image',
        false,
        1,
        0,
        selectedGirlfriend?.portraitUrl,
        mode === 'edit',
        selectedGirlfriend?.characterPrompt,
      );

      if (res.results.length === 0 || !res.results[0].prompt) {
        onError('智能扩写返回为空，请重试');
        return;
      }

      setPrompt(res.results[0].prompt.trim());
      onSuccess('智能扩写完成');
    } catch (err) {
      onError(err instanceof Error ? err.message : '智能扩写失败');
    } finally {
      setIsExpanding(false);
    }
  }, [prompt, selectedGirlfriend, mode, onError, onSuccess]);

  const buildPrompt = useCallback((): string => {
    const parts: string[] = [prompt.trim()];
    if (style) {
      parts.push(style);
    }
    if (selectedGirlfriend?.characterPrompt) {
      parts.push(selectedGirlfriend.characterPrompt);
    }
    return parts.join(', ');
  }, [prompt, style, selectedGirlfriend]);

  const handleGenerate = useCallback(async () => {
    const finalPrompt = buildPrompt();
    if (!finalPrompt) {
      onError('请输入提示词');
      return;
    }
    if (!yunwuKey) {
      onError('请先在设置中配置 Yunwu AI API Key');
      return;
    }

    setIsGenerating(true);
    setResults([]);

    try {
      if (mode === 'txt2img') {
        const imgs = await generateImage(yunwuKey, finalPrompt, { n, size, quality });
        setResults(imgs.map((i) => i.url));
        if (imgs.length > 0) {
          onSuccess(`生成成功，获得 ${imgs.length} 张图片`);
        }
      } else {
        const imageToEdit = editImageFile || gfImageFile;
        if (!imageToEdit) {
          onError('请上传要编辑的图片，或选择一个数字人女友作为参考');
          setIsGenerating(false);
          return;
        }
        const imgs = await editImage(yunwuKey, finalPrompt, imageToEdit, {
          n,
          size,
          quality,
          maskFile: maskFile || undefined,
        });
        setResults(imgs.map((i) => i.url));
        if (imgs.length > 0) {
          onSuccess(`编辑成功，获得 ${imgs.length} 张图片`);
        }
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setIsGenerating(false);
    }
  }, [mode, yunwuKey, buildPrompt, n, size, quality, editImageFile, gfImageFile, maskFile, onError, onSuccess]);

  const handleReset = () => {
    setPrompt('');
    setRefImageFile(null);
    setRefImagePreview('');
    setMaskFile(null);
    setMaskPreview('');
    setEditImageFile(null);
    setEditImagePreview('');
    setSelectedGirlfriend(null);
    setGfImageFile(null);
    setResults([]);
  };

  const handleDownload = (url: string, idx: number) => {
    const ext = url.startsWith('data:') ? 'png' : 'jpg';
    downloadImage(url, `gpt-image-2-${Date.now()}-${idx + 1}.${ext}`);
  };

  return (
    <div className="space-y-4">
      {/* ── Mode tabs ── */}
      <div className="flex items-center gap-1 p-1 bg-bg-elevated rounded-xl border border-border">
        <button
          onClick={() => setMode('txt2img')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
            mode === 'txt2img'
              ? 'bg-white text-primary shadow-sm'
              : 'text-text-tertiary hover:text-text-primary'
          }`}
        >
          <Wand2 size={14} />
          文生图
        </button>
        <button
          onClick={() => setMode('edit')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
            mode === 'edit'
              ? 'bg-white text-primary shadow-sm'
              : 'text-text-tertiary hover:text-text-primary'
          }`}
        >
          <Palette size={14} />
          图片编辑
        </button>
      </div>

      {/* ── Prompt area ── */}
      <div className="rounded-xl bg-white border border-border overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-bg-elevated flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={12} className="text-primary" />
            <span className="text-xs font-medium text-text-primary">提示词</span>
          </div>
          <div className="flex items-center gap-2">
            {style && (
              <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium">
                {style}
              </span>
            )}
            {selectedGirlfriend && (
              <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 text-[10px] font-medium">
                {selectedGirlfriend.nameZh || selectedGirlfriend.name}
              </span>
            )}
            <button
              onClick={handleExpand}
              disabled={isExpanding || !prompt.trim()}
              title="智能扩写：先用 grok-4.2，失败自动用 grok-4-1-fast"
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                isExpanding || !prompt.trim()
                  ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                  : 'bg-gradient-to-r from-primary to-pink-500 text-white hover:opacity-90 active:scale-[0.97]'
              }`}
            >
              {isExpanding ? (
                <>
                  <Loader size={11} className="animate-spin" />
                  扩写中...
                </>
              ) : (
                <>
                  <Wand2 size={11} />
                  智能扩写
                </>
              )}
            </button>
          </div>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={mode === 'txt2img'
            ? '描述你想生成的图片内容...'
            : '描述你想对图片做的修改...'}
          rows={4}
          className="w-full px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary resize-none focus:outline-none"
        />
      </div>

      {/* ── Reference image (txt2img mode) ── */}
      {mode === 'txt2img' && (
        <div className="rounded-xl bg-white border border-border overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-bg-elevated">
            <div className="flex items-center gap-2">
              <ImagePlus size={12} className="text-text-tertiary" />
              <span className="text-xs font-medium text-text-primary">参考图片（可选）</span>
              <span className="text-[10px] text-text-tertiary">用作角色/风格参考</span>
            </div>
          </div>
          <div className="p-4">
            {refImagePreview ? (
              <div className="relative rounded-xl overflow-hidden">
                <img src={refImagePreview} alt="参考" className="w-full object-contain max-h-48" />
                <button
                  onClick={() => { setRefImageFile(null); setRefImagePreview(''); }}
                  className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 transition-colors"
                >
                  <X size={12} className="text-white" />
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-2 py-8 rounded-xl border-2 border-dashed border-border hover:border-primary transition-colors cursor-pointer">
                <Upload size={20} className="text-text-tertiary" />
                <span className="text-xs text-text-tertiary">点击上传参考图片</span>
                <input
                  ref={refInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleRefImageChange}
                />
              </label>
            )}
          </div>
        </div>
      )}

      {/* ── Edit image (edit mode) ── */}
      {mode === 'edit' && (
        <div className="rounded-xl bg-white border border-border overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-bg-elevated">
            <div className="flex items-center gap-2">
              <ImageIcon size={12} className="text-text-tertiary" />
              <span className="text-xs font-medium text-text-primary">待编辑图片</span>
              {editImageFile && (
                <button
                  onClick={() => { setEditImageFile(null); setEditImagePreview(''); }}
                  className="ml-auto text-[10px] text-red-400 hover:text-red-500"
                >
                  清除
                </button>
              )}
            </div>
          </div>
          <div className="p-4">
            {editImagePreview || selectedGirlfriend ? (
              <div className="relative rounded-xl overflow-hidden">
                <img
                  src={editImagePreview || selectedGirlfriend!.portraitUrl}
                  alt="编辑"
                  className="w-full object-contain max-h-64"
                />
                <button
                  onClick={() => {
                    setEditImageFile(null);
                    setEditImagePreview('');
                    setSelectedGirlfriend(null);
                    setGfImageFile(null);
                  }}
                  className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 transition-colors"
                >
                  <X size={12} className="text-white" />
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-2 py-8 rounded-xl border-2 border-dashed border-border hover:border-primary transition-colors cursor-pointer">
                <Upload size={20} className="text-text-tertiary" />
                <span className="text-xs text-text-tertiary">点击上传要编辑的图片</span>
                <input
                  ref={editInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleEditImageChange}
                />
              </label>
            )}
          </div>

          {/* Mask upload */}
          <div className="px-4 pb-4">
            {maskPreview ? (
              <div className="relative rounded-xl overflow-hidden border border-border">
                <img src={maskPreview} alt="蒙版" className="w-full object-contain max-h-32 opacity-70" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="px-2 py-1 rounded-lg bg-black/50 text-white text-[10px] font-medium">蒙版</span>
                </div>
                <button
                  onClick={() => { setMaskFile(null); setMaskPreview(''); }}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70"
                >
                  <X size={10} className="text-white" />
                </button>
              </div>
            ) : (
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:border-primary transition-colors cursor-pointer">
                <input
                  ref={maskInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleMaskChange}
                />
                <span className="text-[10px] text-text-tertiary">+ 添加蒙版（可选，用于局部重绘）</span>
              </label>
            )}
          </div>
        </div>
      )}

      {/* ── Girlfriend selector ── */}
      <GirlfriendSelector
        selectedId={selectedGirlfriend ? (selectedGirlfriend.isCustom ? `custom_${selectedGirlfriend.id}` : selectedGirlfriend.id) : null}
        onSelect={handleGirlfriendSelect}
      />

      {/* ── Style presets ── */}
      <div className="rounded-xl bg-white border border-border overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-bg-elevated">
          <div className="flex items-center gap-2">
            <Palette size={12} className="text-text-tertiary" />
            <span className="text-xs font-medium text-text-primary">风格预设（可选）</span>
          </div>
        </div>
        <div className="p-3 flex flex-wrap gap-2">
          <button
            onClick={() => setStyle('')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              !style
                ? 'bg-primary text-white'
                : 'bg-bg-elevated text-text-tertiary hover:text-text-primary'
            }`}
          >
            无
          </button>
          {STYLE_PRESETS.map((s) => (
            <button
              key={s}
              onClick={() => setStyle(s === style ? '' : s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                s === style
                  ? 'bg-primary text-white'
                  : 'bg-bg-elevated text-text-tertiary hover:text-text-primary'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* ── Params row ── */}
      <div className="flex items-stretch gap-3">
        {/* Quality */}
        <div className="flex-1 rounded-xl bg-white border border-border overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-bg-elevated">
            <span className="text-[10px] font-medium text-text-primary">质量</span>
          </div>
          <div className="p-2 space-y-1">
            {QUALITY_OPTIONS.map((q) => (
              <button
                key={q.value}
                onClick={() => setQuality(q.value)}
                className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-all ${
                  quality === q.value
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-text-tertiary hover:bg-bg-elevated'
                }`}
              >
                <span>{q.label}</span>
                <span className="text-[10px] opacity-60">{q.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Size */}
        <div className="flex-1 rounded-xl bg-white border border-border overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-bg-elevated">
            <span className="text-[10px] font-medium text-text-primary">尺寸</span>
          </div>
          <div className="p-2 grid grid-cols-2 gap-1">
            {SIZE_OPTIONS.map((s) => (
              <button
                key={s.value}
                onClick={() => setSize(s.value)}
                className={`flex flex-col items-center justify-center px-2 py-2 rounded-lg text-xs transition-all ${
                  size === s.value
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-text-tertiary hover:bg-bg-elevated'
                }`}
              >
                <span>{s.label}</span>
                <span className="text-[9px] opacity-60">{s.ratio}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Count */}
        <div className="flex-1 rounded-xl bg-white border border-border overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-bg-elevated">
            <span className="text-[10px] font-medium text-text-primary">数量</span>
          </div>
          <div className="p-2 flex items-center justify-center gap-3">
            <button
              onClick={() => setN((v) => Math.max(1, v - 1))}
              disabled={n <= 1}
              className="w-7 h-7 rounded-lg bg-bg-elevated text-text-secondary hover:bg-border disabled:opacity-30 transition-colors flex items-center justify-center"
            >
              <span className="text-sm">−</span>
            </button>
            <span className="text-sm font-semibold text-text-primary w-4 text-center">{n}</span>
            <button
              onClick={() => setN((v) => Math.min(10, v + 1))}
              disabled={n >= 10}
              className="w-7 h-7 rounded-lg bg-bg-elevated text-text-secondary hover:bg-border disabled:opacity-30 transition-colors flex items-center justify-center"
            >
              <span className="text-sm">+</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Action buttons ── */}
      <div className="flex gap-3">
        <button
          onClick={handleReset}
          className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-medium bg-bg-elevated text-text-tertiary hover:bg-border transition-colors"
        >
          <RotateCcw size={13} />
          重置
        </button>
        <button
          onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim()}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all ${
            isGenerating || !prompt.trim()
              ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
              : 'bg-gradient-to-r from-primary to-pink-500 text-white hover:opacity-90 active:scale-[0.98]'
          }`}
        >
          {isGenerating ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              生成中...
            </>
          ) : (
            <>
              <Sparkles size={15} />
              {mode === 'txt2img' ? '生成图片' : '编辑图片'}
            </>
          )}
        </button>
      </div>

      {/* ── Results ── */}
      {results.length > 0 && (
        <div className="rounded-xl bg-white border border-border overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-bg-elevated flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ImageIcon size={12} className="text-green-500" />
              <span className="text-xs font-medium text-text-primary">生成结果</span>
            </div>
            <span className="text-[10px] text-text-tertiary">{results.length} 张</span>
          </div>
          <div className="p-4 grid grid-cols-2 gap-3">
            {results.map((url, idx) => (
              <div key={idx} className="relative group rounded-xl overflow-hidden border border-border">
                <img
                  src={url}
                  alt={`生成结果 ${idx + 1}`}
                  className="w-full object-cover"
                  style={{ aspectRatio: size === 'auto' ? '1' : size.replace('x', '/') }}
                />
                {/* Overlay */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-end justify-center pb-3 opacity-0 group-hover:opacity-100">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDownload(url, idx)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/90 text-text-primary text-xs font-medium hover:bg-white transition-colors"
                    >
                      <Download size={11} />
                      下载
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
