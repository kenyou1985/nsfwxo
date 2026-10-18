import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Sparkles, Loader2, Copy, Check, RefreshCw, Upload, Image as ImageIcon,
  Clapperboard, MapPin, Package, Play, ChevronDown, ChevronUp, Layers, Zap, GitMerge,
} from 'lucide-react';
import {
  streamGenerateH3DnaPrompt,
  streamGenerateSeriesOutline,
  type ImageDnaResult,
  type SeriesEpisodeOutline,
  type SeriesBlueprints,
  type SeriesAssets,
  type SeriesAssetItem,
} from '../services/promptApi';
import { generateImage, DEFAULT_IMAGE_MODEL } from '../services/gptImage2Api';
import { getYunwuKey } from '../services/storage';

// ──────────────────────────────────────────────────────────────────────────────
// 系列工作台：并行/硬承接模式切换 + 大纲卡片 + 逐集脚本 + 角色/场景/道具资产
// ──────────────────────────────────────────────────────────────────────────────

export type SeriesGenMode = 'parallel' | 'sequential';

interface SeriesWorkbenchProps {
  /** 已上传的参考图（取首张作为系列主角锚定） */
  images: { path: string; preview: string }[];
  imageDna: ImageDnaResult | null;
  eroticLevel: 'soft' | 'normal' | 'sm';
  duration: 15 | 30 | 60 | 120 | 180 | 240;
  /** 系列集数（来自 preset 的 count） */
  count: number;
  /** 系列 userHint（主题/剧情要求） */
  userHint: string;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  /** 脚本「使用」：写入父页面 prompt */
  onUsePrompt: (prompt: string, idx: number) => void;
  /** 脚本「生成视频」：提交 det16 */
  onGenerateVideo: (prompt: string, idx: number) => void;
  /** 资产生成/上传成功：自动填入父页面参考图槽（不触发 DNA 重提取） */
  onAssetToRef?: (dataUrl: string, name: string) => void;
}

/** 生成模式切换 pill */
function ModeSwitch({ value, onChange, disabled }: {
  value: SeriesGenMode;
  onChange: (v: SeriesGenMode) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-black/10 p-0.5">
      <button
        onClick={() => onChange('parallel')}
        disabled={disabled}
        className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all flex items-center gap-1 ${
          value === 'parallel' ? 'bg-rose-500 text-white shadow' : 'text-text-tertiary hover:text-text-primary'
        }`}
      >
        <Zap size={9} />
        并行（逻辑承接）
      </button>
      <button
        onClick={() => onChange('sequential')}
        disabled={disabled}
        className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all flex items-center gap-1 ${
          value === 'sequential' ? 'bg-rose-500 text-white shadow' : 'text-text-tertiary hover:text-text-primary'
        }`}
      >
        <GitMerge size={9} />
        硬承接（引用上集结尾）
      </button>
    </div>
  );
}

/** 资产卡：图片 + 名称 + 提示词 + 生成/重绘/上传 */
function AssetCard({ item, image, loading, onGenerate, onUpload, onPreview, disabled }: {
  item: SeriesAssetItem;
  image?: string;
  loading?: boolean;
  onGenerate: () => void;
  onUpload: (file: File) => void;
  onPreview?: (src: string) => void;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const showPrompt = expanded ? item.prompt : item.prompt.slice(0, 120);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(item.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="rounded-lg border border-border bg-bg-surface/80 overflow-hidden flex flex-col">
      {/* 缩略图（点击放大预览） */}
      <div className="relative aspect-square bg-black/20 flex items-center justify-center overflow-hidden">
        {image ? (
          <img
            src={image}
            alt={item.name}
            className="w-full h-full object-cover cursor-zoom-in hover:opacity-90 transition-opacity"
            onClick={() => onPreview?.(image)}
          />
        ) : loading ? (
          <Loader2 size={20} className="text-rose-400 animate-spin" />
        ) : (
          <ImageIcon size={20} className="text-text-tertiary/60" />
        )}
        <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/60 text-[8px] font-bold text-emerald-300">
          {image ? '形象已生成' : loading ? '生成中' : '待生成'}
        </span>
      </div>
      {/* 信息 */}
      <div className="p-2 space-y-1.5 flex flex-col flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] font-bold text-text-primary truncate">{item.name}</span>
          {item.role && (
            <span className="px-1 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[8px] font-bold flex-shrink-0">
              {item.role}
            </span>
          )}
        </div>
        <p className="text-[9px] text-text-tertiary leading-relaxed font-mono break-words">
          {showPrompt}
          {item.prompt.length > 120 && (
            <button onClick={() => setExpanded(!expanded)} className="text-rose-400 hover:text-rose-300 ml-1">
              {expanded ? '收起' : '展开'}
            </button>
          )}
        </p>
        {/* 操作行 */}
        <div className="flex items-center gap-1 pt-1 mt-auto">
          <button
            onClick={onGenerate}
            disabled={disabled || loading}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold bg-gradient-to-r from-pink-500 to-rose-500 text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {loading ? <Loader2 size={9} className="animate-spin" /> : <Sparkles size={9} />}
            {image ? '重绘' : '生成图片'}
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
            className="px-1.5 py-1 rounded-md bg-bg-surface border border-border text-[9px] text-text-secondary hover:text-text-primary transition-colors"
            title="上传本地图替换"
          >
            <Upload size={9} />
          </button>
          <button
            onClick={copy}
            className="px-1.5 py-1 rounded-md bg-bg-surface border border-border text-[9px] text-text-secondary hover:text-text-primary transition-colors"
            title="复制提示词"
          >
            {copied ? <Check size={9} className="text-emerald-400" /> : <Copy size={9} />}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>
    </div>
  );
}

/** 单集脚本卡片 */
function EpisodeScriptCard({ ep, outline, script, loading, onGenerate, onUse, onVideo, disabled }: {
  ep: number;
  outline?: SeriesEpisodeOutline;
  script?: string;
  loading?: boolean;
  onGenerate: () => void;
  onUse: () => void;
  onVideo: () => void;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!script) return;
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className="rounded-lg border border-border bg-bg-surface/80 overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-2 bg-black/10">
        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-bold flex items-center justify-center">
          {ep}
        </span>
        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-bold text-text-primary block leading-snug break-words">
            {outline?.title || `第 ${ep} 集`}
          </span>
          {outline?.hook_out && (
            <span className="text-[8px] text-text-tertiary block leading-snug break-words mt-0.5">
              承接↓ {outline.hook_out}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {script ? (
            <>
              <button onClick={onUse} className="px-1.5 py-1 rounded-md bg-bg-surface border border-border text-[9px] text-text-secondary hover:text-text-primary transition-colors" title="使用（填入 prompt）">
                <Clapperboard size={9} />
              </button>
              <button onClick={onVideo} className="px-1.5 py-1 rounded-md bg-bg-surface border border-border text-[9px] text-text-secondary hover:text-text-primary transition-colors" title="生成视频">
                <Play size={9} />
              </button>
              <button onClick={copy} className="px-1.5 py-1 rounded-md bg-bg-surface border border-border text-[9px] text-text-secondary hover:text-text-primary transition-colors" title="复制脚本">
                {copied ? <Check size={9} className="text-emerald-400" /> : <Copy size={9} />}
              </button>
              <button onClick={() => setExpanded(!expanded)} className="px-1.5 py-1 rounded-md bg-bg-surface border border-border text-[9px] text-text-secondary hover:text-text-primary transition-colors" title={expanded ? '收起' : '展开脚本'}>
                {expanded ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
              </button>
            </>
          ) : (
            <button
              onClick={onGenerate}
              disabled={disabled || loading}
              className="px-2 py-1 rounded-md text-[9px] font-bold bg-gradient-to-r from-pink-500 to-rose-500 text-white hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center gap-1"
            >
              {loading ? <Loader2 size={9} className="animate-spin" /> : <Sparkles size={9} />}
              {loading ? '生成中' : '生成本集脚本'}
            </button>
          )}
        </div>
      </div>
      {script && expanded && (
        <pre className="px-2.5 py-2 text-[9px] text-text-secondary leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto font-mono">
          {script}
        </pre>
      )}
    </div>
  );
}

export function SeriesWorkbench({
  images, imageDna, eroticLevel, duration, count, userHint,
  onError, onSuccess, onUsePrompt, onGenerateVideo, onAssetToRef,
}: SeriesWorkbenchProps) {
  const [mode, setMode] = useState<SeriesGenMode>('parallel');
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outline, setOutline] = useState<SeriesEpisodeOutline[]>([]);
  const [blueprints, setBlueprints] = useState<SeriesBlueprints | null>(null);
  const [assets, setAssets] = useState<SeriesAssets | null>(null);
  const [scripts, setScripts] = useState<Record<number, string>>({});
  const [scriptLoadingAll, setScriptLoadingAll] = useState(false);
  const [scriptLoading, setScriptLoading] = useState<Record<number, boolean>>({});
  const [assetImages, setAssetImages] = useState<Record<string, string>>({});
  const [assetGenLoading, setAssetGenLoading] = useState<Record<string, boolean>>({});
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const firstImage = images.find(img => img.path && img.path !== 'None');

  // ── 生成系列大纲（outline + assets 流式） ──────────────────────────────────
  const handleGenerateOutline = useCallback(async () => {
    if (!firstImage?.path || firstImage.path === 'None') {
      onError('请先上传至少一张参考图');
      return;
    }
    if (!imageDna) {
      onError('请等待 DNA 提取完成');
      return;
    }
    setOutlineLoading(true);
    setOutline([]);
    setAssets(null);
    setBlueprints(null);
    setScripts({});
    try {
      await streamGenerateSeriesOutline(
        {
          imageUrl: firstImage.path,
          dna: imageDna,
          eroticLevel,
          duration,
          userHint: userHint || undefined,
          count,
        },
        {
          onOutline: ({ episodes, blueprints: bp }) => {
            setOutline(episodes);
            setBlueprints(bp);
          },
          onAssets: (data) => setAssets(data),
          onError: (m) => onError(`大纲生成失败: ${m}`),
          onDone: (ok) => {
            setOutlineLoading(false);
            if (ok) onSuccess(`系列大纲已生成（${count} 集）`);
          },
        },
      );
    } catch (e) {
      setOutlineLoading(false);
      onError(`大纲生成失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [firstImage, imageDna, eroticLevel, duration, count, userHint, onError, onSuccess]);

  // ── 一键生成全部脚本（count=N + mode 一次流式） ───────────────────────────
  const handleGenerateAllScripts = useCallback(async () => {
    if (!firstImage?.path || firstImage.path === 'None') {
      onError('请先上传至少一张参考图');
      return;
    }
    if (!imageDna) {
      onError('请等待 DNA 提取完成');
      return;
    }
    if (outline.length === 0) {
      onError('请先生成系列大纲');
      return;
    }
    setScriptLoadingAll(true);
    setScripts({});
    const total = outline.length;
    try {
      await streamGenerateH3DnaPrompt(
        {
          imageUrl: firstImage.path,
          dna: imageDna,
          eroticLevel,
          duration,
          userHint: userHint || undefined,
          count: total,
          mode,
        },
        {
          onStart: ({ index }) => {
            setScriptLoading(prev => ({ ...prev, [index + 1]: true }));
          },
          onDelta: ({ index, text }) => {
            setScripts(prev => ({ ...prev, [index + 1]: (prev[index + 1] ?? '') + text }));
          },
          onEnd: ({ index, prompt: p }) => {
            setScripts(prev => ({ ...prev, [index + 1]: p }));
            setScriptLoading(prev => ({ ...prev, [index + 1]: false }));
          },
          onError: ({ index, message }) => {
            onError(`第 ${index + 1} 集脚本失败: ${message}`);
            setScriptLoading(prev => ({ ...prev, [index + 1]: false }));
          },
          onDone: ({ successful, total: t }) => {
            setScriptLoadingAll(false);
            if (successful > 0) onSuccess(`已生成 ${successful}/${t} 集脚本`);
          },
        },
      );
    } catch (e) {
      setScriptLoadingAll(false);
      onError(`脚本生成失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [firstImage, imageDna, eroticLevel, duration, mode, outline.length, userHint, onError, onSuccess]);

  // ── 单集脚本 ──────────────────────────────────────────────────────────────
  const handleGenerateScript = useCallback(async (ep: number) => {
    if (!firstImage?.path || firstImage.path === 'None') {
      onError('请先上传至少一张参考图');
      return;
    }
    if (!imageDna) {
      onError('请等待 DNA 提取完成');
      return;
    }
    setScriptLoading(prev => ({ ...prev, [ep]: true }));
    try {
      await streamGenerateH3DnaPrompt(
        {
          imageUrl: firstImage.path,
          dna: imageDna,
          eroticLevel,
          duration,
          userHint: userHint || undefined,
          count: 1,
          mode,
        },
        {
          onStart: () => {},
          onDelta: ({ index, text }) => {
            setScripts(prev => ({ ...prev, [ep]: (prev[ep] ?? '') + text }));
          },
          onEnd: ({ prompt: p }) => {
            setScripts(prev => ({ ...prev, [ep]: p }));
            setScriptLoading(prev => ({ ...prev, [ep]: false }));
          },
          onError: ({ message }) => {
            onError(`第 ${ep} 集脚本失败: ${message}`);
            setScriptLoading(prev => ({ ...prev, [ep]: false }));
          },
          onDone: ({ successful }) => {
            if (successful > 0) onSuccess(`第 ${ep} 集脚本已生成`);
          },
        },
      );
    } catch (e) {
      setScriptLoading(prev => ({ ...prev, [ep]: false }));
      onError(`第 ${ep} 集脚本失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [firstImage, imageDna, eroticLevel, duration, mode, userHint, onError, onSuccess]);

  // ── 资产生图（gpt-image-2.5-sunburst-c，默认模型） ────────────────────────
  const handleGenAssetImage = useCallback(async (item: SeriesAssetItem) => {
    const key = getYunwuKey();
    if (!key) {
      onError('OpenLux API Key 未设置');
      return;
    }
    setAssetGenLoading(prev => ({ ...prev, [item.name]: true }));
    try {
      const results = await generateImage(key, item.prompt, {
        size: '1024x1024',
        quality: 'medium',
        model: DEFAULT_IMAGE_MODEL,
      });
      if (results.length > 0) {
        setAssetImages(prev => ({ ...prev, [item.name]: results[0].url }));
        onAssetToRef?.(results[0].url, item.name);
        onSuccess(`已生成资产图片：${item.name}，已自动填入参考图`);
      } else {
        onError(`资产图片生成无结果：${item.name}`);
      }
    } catch (e) {
      onError(`资产图片生成失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAssetGenLoading(prev => ({ ...prev, [item.name]: false }));
    }
  }, [onError, onSuccess, onAssetToRef]);

  const handleAssetUpload = useCallback((name: string, file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      setAssetImages(prev => ({ ...prev, [name]: url }));
      onAssetToRef?.(url, name);
      onSuccess(`已上传资产图片：${name}，已自动填入参考图`);
    };
    reader.readAsDataURL(file);
  }, [onSuccess, onAssetToRef]);

  const allScriptsDone = outline.length > 0 && outline.every(ep => scripts[(ep.ep ?? 0)]);

  return (
    <div className="mt-3 rounded-xl border border-rose-300/40 bg-gradient-to-b from-rose-500/5 to-pink-500/5 p-2.5 space-y-2.5">
      {/* 头部：标题 + 模式切换 */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Layers size={12} className="text-rose-500" />
          <span className="text-[10px] font-bold text-text-primary">系列工作台</span>
          <span className="text-[9px] text-text-tertiary">大纲 · 脚本 · 资产（gpt-image-2.5-sunburst-c）</span>
        </div>
        <ModeSwitch value={mode} onChange={setMode} disabled={outlineLoading || scriptLoadingAll} />
      </div>

      {/* 操作：生成大纲 */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleGenerateOutline}
          disabled={outlineLoading || !firstImage || !imageDna}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold bg-gradient-to-r from-pink-500 to-rose-500 text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          {outlineLoading ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
          {outlineLoading ? `正在生成 ${count} 集大纲与资产蓝图...` : `生成系列大纲（${count} 集）`}
        </button>
        {outline.length > 0 && (
          <button
            onClick={handleGenerateAllScripts}
            disabled={scriptLoadingAll || outlineLoading}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold bg-black/20 text-text-primary hover:bg-black/30 disabled:opacity-40 transition-colors"
          >
            {scriptLoadingAll ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
            {scriptLoadingAll ? '生成中...' : '一键生成全部脚本'}
          </button>
        )}
      </div>

      {/* 大纲卡片列表 */}
      {outline.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {outline.map((ep, i) => (
            <EpisodeScriptCard
              key={ep.ep ?? i}
              ep={ep.ep ?? i + 1}
              outline={ep}
              script={scripts[ep.ep ?? i + 1]}
              loading={scriptLoading[ep.ep ?? i + 1]}
              onGenerate={() => handleGenerateScript(ep.ep ?? i + 1)}
              onUse={() => onUsePrompt(scripts[ep.ep ?? i + 1] ?? '', ep.ep ?? i + 1)}
              onVideo={() => onGenerateVideo(scripts[ep.ep ?? i + 1] ?? '', ep.ep ?? i + 1)}
              disabled={outlineLoading || scriptLoadingAll}
            />
          ))}
        </div>
      )}
      {outline.length > 0 && !allScriptsDone && (
        <p className="text-[8px] text-text-tertiary text-center">
          {mode === 'sequential'
            ? '硬承接模式：逐集串行生成，第 N 集脚本会自动引用第 N-1 集结尾，耗时会随集数增加'
            : '并行模式：各集并行生成，通过集数+承接约束保持剧情连贯，速度快'}
        </p>
      )}

      {/* 资产面板：角色 / 场景 / 道具 三栏 */}
      {assets && (assets.characters.length > 0 || assets.scenes.length > 0 || assets.props.length > 0) && (
        <div className="space-y-2">
          {assets.characters.length > 0 && (
            <div>
              <div className="flex items-center gap-1 mb-1.5">
                <span className="text-[10px] font-bold text-text-primary flex items-center gap-1">
                  <Clapperboard size={10} className="text-rose-500" />
                  角色
                </span>
                <span className="text-[8px] text-text-tertiary">三视图参考 · 纯白背景</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {assets.characters.map(item => (
                  <AssetCard
                    key={item.name}
                    item={item}
                    image={assetImages[item.name]}
                    loading={assetGenLoading[item.name]}
                    onGenerate={() => handleGenAssetImage(item)}
                    onUpload={(f) => handleAssetUpload(item.name, f)}
                    onPreview={setPreviewImage}
                    disabled={outlineLoading || scriptLoadingAll}
                  />
                ))}
              </div>
            </div>
          )}
          {assets.scenes.length > 0 && (
            <div>
              <div className="flex items-center gap-1 mb-1.5">
                <span className="text-[10px] font-bold text-text-primary flex items-center gap-1">
                  <MapPin size={10} className="text-rose-500" />
                  场景
                </span>
                <span className="text-[8px] text-text-tertiary">固定视角空景 · 电影质感</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {assets.scenes.map(item => (
                  <AssetCard
                    key={item.name}
                    item={item}
                    image={assetImages[item.name]}
                    loading={assetGenLoading[item.name]}
                    onGenerate={() => handleGenAssetImage(item)}
                    onUpload={(f) => handleAssetUpload(item.name, f)}
                    onPreview={setPreviewImage}
                    disabled={outlineLoading || scriptLoadingAll}
                  />
                ))}
              </div>
            </div>
          )}
          {assets.props.length > 0 && (
            <div>
              <div className="flex items-center gap-1 mb-1.5">
                <span className="text-[10px] font-bold text-text-primary flex items-center gap-1">
                  <Package size={10} className="text-rose-500" />
                  道具
                </span>
                <span className="text-[8px] text-text-tertiary">单品产品图 · 纯白背景</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {assets.props.map(item => (
                  <AssetCard
                    key={item.name}
                    item={item}
                    image={assetImages[item.name]}
                    loading={assetGenLoading[item.name]}
                    onGenerate={() => handleGenAssetImage(item)}
                    onUpload={(f) => handleAssetUpload(item.name, f)}
                    onPreview={setPreviewImage}
                    disabled={outlineLoading || scriptLoadingAll}
                  />
                ))}
              </div>
            </div>
          )}
          {blueprints && (blueprints.characters?.length || blueprints.scenes?.length) && (
            <p className="text-[8px] text-text-tertiary text-center">
              资产提示词由后端按固定模板（cinematic photorealistic 公共前缀 + 三视图/空景/单品结构）确定性拼接，可直接用于生图或复用进导演台 H3
            </p>
          )}
        </div>
      )}

      {/* 图片放大预览（点击遮罩或右上角关闭） */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="relative max-w-[92vw] max-h-[88vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={previewImage}
              alt="资产预览"
              className="max-w-[92vw] max-h-[88vh] object-contain rounded-lg shadow-2xl"
            />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white text-black flex items-center justify-center shadow-lg hover:bg-gray-200 transition-colors text-sm font-bold"
              title="关闭预览"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
