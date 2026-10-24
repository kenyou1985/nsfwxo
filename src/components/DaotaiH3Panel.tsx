import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Loader2, Upload, X, Clapperboard, Layers, Clock, Image as ImageIcon } from 'lucide-react';
import { uploadImage } from '../services/runninghub';
import { GirlfriendSelector } from './GirlfriendSelector';
import { PosePresetSelector } from './PosePresetSelector';
import { EroticCreationPanel, EroticImageRef, EroticDuration, EroticLevel, SupplementaryMode } from './EroticCreationPanel';
import ThemeLibraryPanel from './ThemeLibraryPanel';
import { 主题转视频提示词 } from '../data/themeLibrary';
import { extractImageDna, ImageDnaResult } from '../services/promptApi';
import { compressDataUrlIfNeeded, isHeicDataUrl } from '../utils/imagePreprocess';
import type { GirlfriendPreset } from '../data/girlfriendPresets';
import type { ThemeEntry } from '../data/themeLibrary';

// ─── 导演台 H3 (det16) — 生视频面板 ─────────────────────────────────────────
// 复用导演台工作流 2110330160000516098（det16 全局自动切分，自杀式免扣分）的
// 生视频能力。提交走 nsfwxo 后端 /api/daotai 同源代理（8765 停用也能独立运行），
// 任务挂载到页面顶部 VideoTaskList（localStorage 持久化，刷新后继续轮询），
// 产物为本地视频 URL。
const DAOTAI_WORKFLOW_ID = '2110330160000516098';

interface DaotaiRefImage {
  path: string; // RunningHub 平台文件引用
  url: string;  // 公网可下载 URL（工作流拉取参考图用）
}

interface DaotaiTaskListHandle {
  submitDaotaiTask: (prompt: string, body: Record<string, unknown>, preview?: string) => void;
}

interface DaotaiH3PanelProps {
  apiKey: string;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  /** 页面顶部 VideoTaskList 的句柄：H3 任务挂载到全局任务列表，刷新后恢复轮询 */
  taskListRef?: React.RefObject<DaotaiTaskListHandle | null>;
  /** 从 GPT Image2 / 历史记录导入的图片，自动填入 ref_image_0 */
  initialImage?: { path: string; url?: string } | null;
}

const DURATION_OPTIONS = [
  { value: 13, label: '13 秒/段' },
  { value: 15, label: '15 秒/段' },
  { value: 20, label: '20 秒/段' },
  { value: 30, label: '30 秒/段' },
];

const RESOLUTION_OPTIONS = [
  { value: 0.1, label: '0.1（快速探测）' },
  { value: 0.2, label: '0.2（默认）' },
  { value: 0.3, label: '0.3' },
  { value: 0.4, label: '0.4' },
  { value: 0.5, label: '0.5（720p）' },
  { value: 0.7, label: '0.7' },
  { value: 1.0, label: '1.0（1080p）' },
];

const ASPECT_RATIO_OPTIONS = [
  { value: '9:16', label: '9:16 竖屏' },
  { value: '16:9', label: '16:9 横屏' },
  { value: '1:1', label: '1:1 方形' },
  { value: '4:3', label: '4:3' },
  { value: 'match', label: '跟随参考图' },
];

const MAX_REFS = 5; // det16 ref_nodes = 5

export function DaotaiH3Panel({ apiKey, onError, onSuccess, taskListRef, initialImage }: DaotaiH3PanelProps) {
  // 5 固定槽参考图（与导演台一致；槽位索引与数字人锚定对齐）
  const [refs, setRefs] = useState<(DaotaiRefImage | null)[]>(Array(MAX_REFS).fill(null));
  useEffect(() => {
    if (!initialImage?.path) return;
    setRefs(prev => {
      const next = [...prev];
      next[0] = { path: initialImage.path, url: initialImage.url || initialImage.path };
      return next;
    });
  }, [initialImage?.path, initialImage?.url]);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(15);
  const [shotsPerSeg, setShotsPerSeg] = useState(1);
  const [targetSegs, setTargetSegs] = useState('4');
  const [loopRoutes, setLoopRoutes] = useState(1);
  const [resolution, setResolution] = useState(0.2);
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [submitting, setSubmitting] = useState(false);
  // ── 数字人锚定 ──────────────────────────────────────────────────────────
  const [selectedGirlfriends, setSelectedGirlfriends] = useState<(GirlfriendPreset | undefined)[]>([]);
  const [girlfriendUploading, setGirlfriendUploading] = useState(false);

  // ── 情色创作模式（复用 V2 面板组件：方向/时长/条数/Skill 触发/姿势道具场景补充）─
  const [eroticMode, setEroticMode] = useState(false);
  const [eroticLevel, setEroticLevel] = useState<EroticLevel>('normal');
  const [eroticDuration, setEroticDuration] = useState<EroticDuration>(60);
  const [eroticCount, setEroticCount] = useState(1);
  const [eroticSupplementary, setEroticSupplementary] = useState('');
  const [eroticSupplementaryMode, setEroticSupplementaryMode] = useState<SupplementaryMode>('unified');
  const [eroticSupplementaryItems, setEroticSupplementaryItems] = useState<string[]>([]);
  // DNA 提取状态
  const [imageDna, setImageDna] = useState<ImageDnaResult | null>(null);
  const [dnaLoading, setDnaLoading] = useState(false);
  const [dnaError, setDnaError] = useState<string | null>(null);

  // ── 参考图上传（按槽位） ────────────────────────────────────────────────
  const handleUpload = useCallback(
    async (file: File, slotIdx: number) => {
      if (refs[slotIdx]) {
        onError(`第 ${slotIdx + 1} 个槽位已有图片，请先移除`);
        return;
      }
      setUploadingSlot(slotIdx);
      try {
        const { imagePath, downloadUrl } = await uploadImage(apiKey, file);
        if (!downloadUrl) {
          throw new Error('上传成功但未返回可下载 URL');
        }
        setRefs((prev) => {
          const next = [...prev];
          next[slotIdx] = { path: imagePath, url: downloadUrl };
          return next;
        });
        onSuccess(`参考图已上传（${slotIdx + 1}/${MAX_REFS}）`);
      } catch (err) {
        onError(`参考图上传失败: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setUploadingSlot(null);
      }
    },
    [apiKey, refs, onError, onSuccess],
  );

  const removeRef = useCallback((idx: number) => {
    setRefs((prev) => {
      const next = [...prev];
      next[idx] = null;
      return next;
    });
    // 同步清空该槽位的数字人锚定
    setSelectedGirlfriends((prev) => {
      if (idx >= prev.length || !prev[idx]) return prev;
      const next = [...prev];
      next[idx] = undefined;
      return next;
    });
  }, []);

  // ── 数字人锚定（复刻 V2 面板：选预设 → 下载头像上传平台 → 填入空槽） ────
  const handleGirlfriendSelect = useCallback(async (gf: GirlfriendPreset) => {
    const gfKey = gf.isCustom ? `custom_${gf.id}` : gf.id;
    const existingIdx = selectedGirlfriends.findIndex(
      (g) => g && (g.isCustom ? `custom_${g.id}` : g.id) === gfKey,
    );

    if (existingIdx >= 0) {
      setSelectedGirlfriends((prev) => {
        const next = [...prev];
        next[existingIdx] = undefined;
        return next;
      });
      setRefs((prev) => {
        const next = [...prev];
        next[existingIdx] = null;
        return next;
      });
      onSuccess(`已取消锚定「${gf.nameZh || gf.name}」（参考图 ${existingIdx + 1} 已清空）`);
      return;
    }

    const emptyIdx = refs.findIndex((r) => !r);
    if (emptyIdx < 0) {
      onError(`参考图已满（${MAX_REFS}/${MAX_REFS}），请先移除一张图片后再添加新的数字人`);
      return;
    }

    const slotIdx = emptyIdx;
    setSelectedGirlfriends((prev) => {
      const next = [...prev];
      while (next.length <= slotIdx) next.push(undefined);
      next[slotIdx] = gf;
      return next;
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
      const { imagePath, downloadUrl } = await uploadImage(apiKey, uploadFile);
      setRefs((prev) => {
        const next = [...prev];
        next[slotIdx] = { path: imagePath, url: downloadUrl || dataUrl };
        return next;
      });
      onSuccess(`已锚定「${gf.nameZh || gf.name}」到参考图 ${slotIdx + 1}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '上传失败';
      onError(`锚定「${gf.nameZh || gf.name}」失败: ${msg}`);
    } finally {
      setGirlfriendUploading(false);
    }
  }, [apiKey, refs, selectedGirlfriends, onSuccess, onError]);

  // ── 姿势预设：追加到提示词 ───────────────────────────────────────────────
  const handlePoseSelect = useCallback((posePrompt: string, poseName: string) => {
    setPrompt((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return posePrompt;
      return `${trimmed}, ${posePrompt}`;
    });
    onSuccess(`已应用姿势: ${poseName}`);
  }, [onSuccess]);

  // ── 图片 DNA 自动提取（情色创作模式开启 + 已上传图片时） ────────────────
  const refsKey = refs.map((r) => r?.path || '').join(',');
  useEffect(() => {
    if (!eroticMode) return;
    const uploaded = refs.filter((r): r is DaotaiRefImage => !!r);
    if (uploaded.length === 0) return;

    let cancelled = false;
    const doExtract = async () => {
      const firstImage = uploaded[0];
      setDnaLoading(true);
      setDnaError(null);
      setImageDna(null);
      try {
        let imageDataUrl = firstImage.url;
        if (imageDataUrl.startsWith('blob:') || imageDataUrl.startsWith('http')) {
          try {
            const resp = await fetch(imageDataUrl);
            const blob = await resp.blob();
            imageDataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          } catch { /* use original path */ }
        }
        if (cancelled) return;
        imageDataUrl = await compressDataUrlIfNeeded(imageDataUrl);
        if (isHeicDataUrl(imageDataUrl)) {
          throw new Error('检测到 HEIC/HEIF 格式图片，请转换为 JPEG 后重新上传');
        }
        if (cancelled) return;
        const result = await extractImageDna(imageDataUrl);
        if (cancelled) return;
        setImageDna(result);
      } catch (err) {
        if (cancelled) return;
        setDnaError(err instanceof Error ? err.message : 'DNA 提取失败');
      } finally {
        if (!cancelled) setDnaLoading(false);
      }
    };

    doExtract();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eroticMode, refsKey]);

  // ── 服装参考图插入（DNA 面板回调：插到槽位 1） ───────────────────────────
  const handleInsertClothingAsReference = useCallback(async (dataUrl: string, clothingName: string) => {
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const mime = blob.type || 'image/png';
      const ext = mime.split('/')[1] || 'png';
      const safeName = clothingName.replace(/[^\w一-龥]+/g, '_').slice(0, 32) || 'clothing';
      const file = new File([blob], `${safeName}_${Date.now()}.${ext}`, { type: mime });
      await handleUpload(file, 0);
      if (eroticMode) setEroticMode(false);
      setImageDna(null);
      setDnaError(null);
      onSuccess(`已替换参考图为「${clothingName}」`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误';
      onError(`插入参考图失败: ${msg}`);
    }
  }, [handleUpload, eroticMode, onError, onSuccess]);

  // ── 资产生成/上传成功：自动填入参考图槽（首个空槽，不触发 DNA 重提取） ──
  const handleInsertAssetAsReference = useCallback(async (dataUrl: string, assetName: string) => {
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const mime = blob.type || 'image/png';
      const ext = mime.split('/')[1] || 'png';
      const safeName = (assetName || 'asset').replace(/[^\w一-龥]+/g, '_').slice(0, 32) || 'asset';
      const file = new File([blob], `${safeName}_${Date.now()}.${ext}`, { type: mime });
      // 填入第一个空槽，避免覆盖用户已上传的参考图
      const firstEmpty = refs.findIndex(r => !r);
      const slot = firstEmpty >= 0 ? firstEmpty : 0;
      await handleUpload(file, slot);
      // 插入资产参考图时自动关闭情色创作模式（避免 useEffect 再次触发 DNA 提取）
      if (eroticMode) setEroticMode(false);
      setImageDna(null);
      setDnaError(null);
      onSuccess(`资产「${assetName}」已自动填入参考图 ${slot + 1}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误';
      onError(`资产参考图填入失败: ${msg}`);
    }
  }, [refs, handleUpload, eroticMode, onError, onSuccess]);

  // ── 提交（det16）：挂载到顶部 VideoTaskList，由全局任务列表轮询 ──────────
  const runSubmit = useCallback(
    async (trimmedPrompt: string, refList: DaotaiRefImage[]) => {
      const segs = targetSegs.trim();
      if (segs && (Number(segs) < 1 || Number(segs) > 16)) {
        onError('目标段数需在 1-16 之间（det16 工作流）');
        return;
      }
      if (!taskListRef?.current?.submitDaotaiTask) {
        onError('任务列表尚未就绪，请稍后重试');
        return;
      }
      setSubmitting(true);
      try {
        const body: Record<string, unknown> = {
          prompt: trimmedPrompt,
          media: refList.map((r) => ({ type: 'reference_image', url: r.url })),
          workflow_id: DAOTAI_WORKFLOW_ID,
          duration,
          resolution,
          aspect_ratio: aspectRatio,
          shots_per_seg: shotsPerSeg,
          loop_routes: loopRoutes,
          instance: 'plus',
        };
        if (segs) body.target_segs = Number(segs);

        // 第一张参考图作为任务卡片缩略图预览
        const preview = refList[0]?.url ?? '';
        taskListRef.current.submitDaotaiTask(trimmedPrompt, body, preview);
      } finally {
        setSubmitting(false);
      }
    },
    [targetSegs, duration, resolution, aspectRatio, shotsPerSeg, loopRoutes, taskListRef, onError],
  );

  const handleSubmit = useCallback(() => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      onError('请填写视频提示词（支持 H3 格式，含 [Shot N] 分镜标记）');
      return;
    }
    const refList = refs.filter((r): r is DaotaiRefImage => !!r);
    if (refList.length === 0) {
      onError('请至少上传一张参考图');
      return;
    }
    if (submitting) return;
    runSubmit(trimmedPrompt, refList);
  }, [prompt, refs, submitting, runSubmit, onError]);

  // 创作面板「一键生成」：提示词组装完成 → 写入当前提示词并直接提交
  const handlePanelGenerate = useCallback(
    (promptText: string) => {
      setPrompt(promptText);
      const refList = refs.filter((r): r is DaotaiRefImage => !!r);
      if (refList.length === 0) {
        onError('请至少上传一张参考图');
        return;
      }
      if (submitting) return;
      runSubmit(promptText, refList);
    },
    [refs, submitting, runSubmit, onError],
  );

  // ── 主题库（470 个预设主题）批量生成：依次提交 det16 ─────────────────────
  const handleThemeGenerate = useCallback(
    async (themes: ThemeEntry[], themeDuration: 15 | 30 | 60 | 120 | 180) => {
      const refList = refs.filter((r): r is DaotaiRefImage => !!r);
      if (refList.length === 0) {
        onError('请至少上传一张参考图');
        return;
      }
      if (submitting) return;
      // 主题库支持 15/30/60/120/180s，det16 按段数（≤16）自动切分，时长仅用于提示词节奏
      const d: 15 | 30 | 60 | 120 | 180 = themeDuration;
      for (let i = 0; i < themes.length; i++) {
        const promptText = 主题转视频提示词(themes[i], d);
        onSuccess(`主题「${themes[i].title}」开始生成（${i + 1}/${themes.length}）`);
        await runSubmit(promptText, refList);
        // det16 任务逐个提交，避免同一时刻并发过多
        if (i < themes.length - 1) await new Promise((r) => setTimeout(r, 600));
      }
    },
    [refs, submitting, runSubmit, onError, onSuccess],
  );

  const uploadedCount = refs.filter(Boolean).length;

  return (
    <div className="space-y-4">
      {/* 数字人锚定 */}
      <GirlfriendSelector
        selectedIds={selectedGirlfriends
          .filter(Boolean)
          .map((g) => (g!.isCustom ? `custom_${g!.id}` : g!.id))}
        onSelect={handleGirlfriendSelect}
        disabled={submitting || girlfriendUploading}
      />

      {/* 参考图上传（det16 固定 5 槽） */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
            <ImageIcon size={16} className="text-primary" />
            参考图（det16 上限 5 张）
          </h3>
          <span className="text-[10px] text-text-tertiary">
            已选 {uploadedCount}/{MAX_REFS}
          </span>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: MAX_REFS }).map((_, idx) => {
            const r = refs[idx];
            return r ? (
              <div key={idx} className="relative aspect-square rounded-xl overflow-hidden border border-border bg-bg-elevated group">
                <img src={r.url} alt={`参考图${idx + 1}`} className="w-full h-full object-cover" />
                <button
                  onClick={() => removeRef(idx)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  title="移除"
                >
                  <X size={11} />
                </button>
                <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[9px]">
                  {idx + 1}
                </span>
              </div>
            ) : (
              <label
                key={idx}
                className={`relative aspect-square rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors ${
                  uploadingSlot === idx ? 'opacity-60 pointer-events-none' : 'hover:border-primary/50'
                }`}
                title={`上传第 ${idx + 1} 张参考图`}
              >
                {uploadingSlot === idx ? (
                  <Loader2 size={16} className="animate-spin text-text-tertiary" />
                ) : (
                  <>
                    <Upload size={16} className="text-text-tertiary" />
                    <span className="text-[10px] text-text-tertiary">上传</span>
                  </>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploadingSlot !== null}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(file, idx);
                    e.target.value = '';
                  }}
                />
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-text-tertiary">
          参考图会先上传至 RunningHub 平台 CDN，再交给本地导演台工作流拉取，保证 refs 正常传递（8765 停用也能独立运行）。
        </p>
      </div>

      {/* 情色创作模式 + Skill 一键触发（复用 V2 面板组件） */}
      <EroticCreationPanel
        images={refs
          .filter((r): r is DaotaiRefImage => !!r)
          .map((r) => ({ path: r.path, preview: r.url }) as EroticImageRef)}
        prompt={prompt}
        disabled={submitting}
        eroticMode={eroticMode}
        setEroticMode={setEroticMode}
        eroticLevel={eroticLevel}
        setEroticLevel={setEroticLevel}
        duration={eroticDuration}
        setDuration={setEroticDuration}
        eroticCount={eroticCount}
        setEroticCount={setEroticCount}
        supplementary={eroticSupplementary}
        setSupplementary={setEroticSupplementary}
        supplementaryMode={eroticSupplementaryMode}
        setSupplementaryMode={setEroticSupplementaryMode}
        supplementaryItems={eroticSupplementaryItems}
        setSupplementaryItems={setEroticSupplementaryItems}
        imageDna={imageDna}
        dnaLoading={dnaLoading}
        dnaError={dnaError}
        onReExtract={() => { setImageDna(null); setDnaError(null); }}
        onInsertClothingAsReference={handleInsertClothingAsReference}
        onUsePrompt={(promptText: string) => { setPrompt(promptText); }}
        onGenerateVideo={handlePanelGenerate}
        onAssetToRef={handleInsertAssetAsReference}
        onSetPrompt={(p: string) => { setPrompt(p); }}
        onError={onError}
        onSuccess={onSuccess}
        panelName="DaotaiH3"
        durationLimitHint="导演台 H3（det16）每段时长请在下方「生成参数」中设置"
      />

      {/* 姿势预设 */}
      <PosePresetSelector
        type="video"
        onSelect={handlePoseSelect}
        disabled={submitting}
        selectedGirlfriend={selectedGirlfriends[0] ?? null}
      />

      {/* 提示词 */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
            <Clapperboard size={16} className="text-primary" />
            视频提示词
          </h3>
          <span className="text-[10px] text-text-tertiary">H3 格式 · 支持多分镜</span>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={16}
          placeholder={'支持 Minimax H3 提示词格式，例如：\n[Shot 1] subject_definitions: <Subject 1> is <Picture 1>…\nsummary: …\ndetailed_description with numbered [Shot N] entries…'}
          className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-xs text-text-primary placeholder-slate-600 focus:outline-none focus:border-primary/50 resize-y font-mono"
        />
        <p className="mt-2 text-[11px] text-text-tertiary">
          提示词中的 [Shot N] 分镜数量决定段内切分；无 [Shot N] 时会自动包裹为单个分镜。
        </p>
      </div>

      {/* 生成参数 */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <h3 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
          <Clock size={16} className="text-primary" />
          生成参数
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-text-secondary mb-1.5 block">每段时长</label>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-xs text-text-primary focus:outline-none focus:border-primary/50"
            >
              {DURATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1.5 block">清晰度</label>
            <select
              value={resolution}
              onChange={(e) => setResolution(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-xs text-text-primary focus:outline-none focus:border-primary/50"
            >
              {RESOLUTION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1.5 block">画幅比例</label>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-xs text-text-primary focus:outline-none focus:border-primary/50"
            >
              {ASPECT_RATIO_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1.5 block">每段分镜数 shots_per_seg</label>
            <select
              value={shotsPerSeg}
              onChange={(e) => setShotsPerSeg(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-xs text-text-primary focus:outline-none focus:border-primary/50"
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>{n} 个分镜/段</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1.5 block">
              目标段数 target_segs（1-16）
            </label>
            <input
              type="number"
              min={1}
              max={16}
              value={targetSegs}
              onChange={(e) => setTargetSegs(e.target.value)}
              placeholder="默认 16 段"
              className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-xs text-text-primary placeholder-slate-600 focus:outline-none focus:border-primary/50"
            />
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1.5 block">
              并发路数 loop_routes（1-16）
            </label>
            <input
              type="number"
              min={1}
              max={16}
              value={loopRoutes}
              onChange={(e) => setLoopRoutes(Math.max(1, Math.min(16, Number(e.target.value) || 1)))}
              title="det16：R 路并行跑完整工作流，每路段数 = ceil(总段数/路数)（如 16 段 ÷ 4 路 = 每路 4 段）"
              className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-xs text-text-primary placeholder-slate-600 focus:outline-none focus:border-primary/50"
            />
            <p className="mt-1 text-[10px] text-text-tertiary">
              每路段数 = ceil(总段数/路数)，如 16 段 ÷ 4 路 = 每路 4 段
            </p>
          </div>
        </div>
        <button
          onClick={handleSubmit}
          disabled={submitting || !prompt.trim() || uploadedCount === 0}
          className={`mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
            submitting
              ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
              : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:opacity-90 shadow-sm'
          } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {submitting ? (
            <><Loader2 size={15} className="animate-spin" /> 提交中...</>
          ) : (
            <><Clapperboard size={15} /> 生成视频（导演台 det16）</>
          )}
        </button>
      </div>

      {/* 主题库（470 个预设主题，复用 V2 面板组件） */}
      <div className="rounded-xl bg-bg-surface border border-border p-4 space-y-3">
        <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
          <Layers size={16} className="text-primary" />
          主题预设库
          <span className="text-[11px] font-normal text-text-tertiary">
            从主题生成 H3 提示词 → 应用填词 / 生成直接提交 det16
          </span>
        </h3>
        <ThemeLibraryPanel
          on应用提示词={(p) => setPrompt(p)}
          on批量生成={handleThemeGenerate}
          multiRefMode={false}
        />
      </div>
    </div>
  );
}
