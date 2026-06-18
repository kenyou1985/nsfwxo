import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Film, Copy, Check, Wand2, Trash2, ChevronDown, ChevronUp,
  Loader2, Heart, Video,
} from 'lucide-react';
import { generateStoryboard, type GeneratedStoryboard } from '../services/storyboardGenerator';
import {
  getCachedStoryboardPanelImages,
  cacheStoryboardPanelImages,
  resolvePanelImages,
  getStoryboardHistory,
} from '../services/storage';
import { loadCachedOrExtractPanelImages } from '../services/imageCacheService';
import { extractVideoPromptFromImagePrompt } from '../utils/videoPromptExtractor';
import { useFinishedTaskImages } from '../contexts/FinishedTaskImagesContext';
import { ImageGrid } from './ImageGrid';
import type { GirlfriendPreset } from '../data/girlfriendPresets';

interface StoryboardSectionProps {
  r18Enabled: boolean;
  selectedGirlfriend: GirlfriendPreset | null;
  displayLang: 'en' | 'zh';
  disabled?: boolean;
  onGenerateStoryboard: (
    panels: GeneratedStoryboard['panels'],
    sceneName: string,
    isR18: boolean,
    onSuccess: (msg: string) => void,
    onError: (msg: string) => void
  ) => void;
  onGenerateSingleImage?: (panelIdx: number, prompt: string) => void;
  onGenerateVideo?: (imageUrl: string, prompt: string, panelKey: string) => void;
  onToggleFavorite?: (url: string, prompt?: string) => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export function StoryboardSection({
  r18Enabled,
  selectedGirlfriend,
  displayLang,
  disabled = false,
  onGenerateStoryboard,
  onGenerateSingleImage,
  onGenerateVideo,
  onToggleFavorite,
  onSuccess,
  onError,
}: StoryboardSectionProps) {
  const noopSingleImage = useCallback((panelIdx: number, prompt: string) => {
    console.log(`[StoryboardSection noopSingleImage] panelIdx=${panelIdx}, prompt length=${prompt.length}, prompt="${prompt.slice(0, 80)}"`);
    onError?.('请前往「剧情分镜」页面使用单图生成功能');
  }, [onError]);

  const noopVideo = useCallback((_imageUrl: string, _prompt: string, _panelKey: string) => {
    onError?.('智能分镜模式暂不支持图生视频，请切换到剧情分镜页面使用');
  }, [onError]);

  const actualSingleImage = onGenerateSingleImage ?? noopSingleImage;
  const actualVideo = onGenerateVideo ?? noopVideo;
  const [isOpen, setIsOpen] = useState(true);
  const [panelCount, setPanelCount] = useState<5 | 9 | 12 | 20>(9);
  const [poseMode, setPoseMode] = useState(false);
  const [smIntensity, setSmIntensity] = useState(1);
  const [result, setResult] = useState<GeneratedStoryboard | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Per-panel image state: which panel indices have been submitted
  const [submittedPanels, setSubmittedPanels] = useState<Set<number>>(new Set());

  // Per-panel image cache: { [panelIdx]: string[] }
  const [panelImages, setPanelImages] = useState<Record<number, string[]>>({});

  // Per-panel video generation loading state
  const [videoLoadingPanel, setVideoLoadingPanel] = useState<number | null>(null);

  // Per-panel image generation loading state
  const [generatingPanel, setGeneratingPanel] = useState<number | null>(null);
  const generatingPanelRef = useRef<number | null>(null);

  // Per-panel selected image index: { [panelIdx]: number }
  const [selectedPanelImages, setSelectedPanelImages] = useState<Record<number, number>>({});

  const panelsRef = useRef<GeneratedStoryboard['panels'] | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleGenerate = () => {
    setIsGenerating(true);
    try {
      const generated = generateStoryboard(panelCount, r18Enabled, selectedGirlfriend, poseMode, smIntensity);
      setResult(generated);
      panelsRef.current = generated.panels;
      setPanelImages({});
      setSubmittedPanels(new Set());
      setIsOpen(true);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyPrompt = async (prompt: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = prompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    }
  };

  const handleCopyAll = async () => {
    if (!result) return;
    const text = result.panels
      .map((p) => `【第${p.panel_number}镜】\n${p.scene_description}\n\nPrompt:\n${p.image_prompt}`)
      .join('\n\n---\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(-1);
      setTimeout(() => setCopiedIdx(null), 3000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedIdx(-1);
      setTimeout(() => setCopiedIdx(null), 3000);
    }
  };

  const handleClear = () => {
    setResult(null);
    setCopiedIdx(null);
    setPanelImages({});
    setSubmittedPanels(new Set());
    setGeneratingPanel(null);
    generatingPanelRef.current = null;
    panelsRef.current = null;
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const handleGenerateImages = () => {
    if (!result) return;
    setIsSubmitting(true);
    setSubmittedPanels(new Set(result.panels.map((_, i) => i)));
    panelsRef.current = result.panels;
    // Don't start polling — the finishedTasks effect handles all image updates
    onGenerateStoryboard(result.panels, result.scene.nameZh, result.is_r18, (msg) => {
      onSuccess(msg);
      setIsSubmitting(false);
    }, (msg) => {
      onError(msg);
      setIsSubmitting(false);
    });
  };

  const startPolling = (panels: GeneratedStoryboard['panels']) => {
    panelsRef.current = panels;
    // Read historyId directly from sessionStorage — this is set by handleGenerateStoryboard in AIPromptPage
    const historyId = sessionStorage.getItem('sb_latest_history_id');
    if (!historyId) {
      console.warn('[StoryboardSection] No sb_latest_history_id in sessionStorage, polling skipped');
      return;
    }
    if (pollRef.current) clearInterval(pollRef.current);
    // Pull panelImages once at poll start (it's a synchronous localStorage
    // read) so older history entries — which only have dataURLs inlined in
    // history.panelImages and never went through cacheStoryboardPanelImages
    // — show their previews on the first tick. Subsequent ticks still poll
    // the unified store, so live task completions continue to flow in.
    const historyItem = getStoryboardHistory().find((h) => h.id === historyId);
    const inlinePanelImages = historyItem?.panelImages
      ? resolvePanelImages(historyItem.panelImages)
      : {};
    if (Object.keys(inlinePanelImages).length > 0) {
      setPanelImages((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [idx, imgs] of Object.entries(inlinePanelImages)) {
          if (imgs.length > 0 && (!prev[Number(idx)] || prev[Number(idx)].length === 0)) {
            next[Number(idx)] = imgs;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
    pollRef.current = setInterval(() => {
      const currentPanels = panelsRef.current;
      if (!currentPanels) return;
      const newImages: Record<number, string[]> = {};
      let anyUpdated = false;
      currentPanels.forEach((_, idx) => {
        const imgs = getCachedStoryboardPanelImages(historyId, idx);
        newImages[idx] = imgs;
        const currentImgs = panelImages[idx] ?? [];
        if (JSON.stringify(imgs) !== JSON.stringify(currentImgs)) {
          anyUpdated = true;
        }
      });
      if (anyUpdated) {
        setPanelImages(prev => {
          const merged = { ...prev };
          currentPanels.forEach((_, idx) => {
            merged[idx] = newImages[idx];
          });
          return merged;
        });
        Object.entries(newImages).forEach(([k, v]) => {
          if (v.length > 0) {
            const idx = Number(k);
            if (generatingPanelRef.current === idx) setGeneratingPanel(null);
          }
        });
      }
    }, 2000);
  };

  // Generate video for a specific panel image — uses selected image if available
  const handleGenerateVideo = (panelIdx: number) => {
    const imgs = panelImages[panelIdx] ?? [];
    if (imgs.length === 0) return;
    // Use the selected image if available, otherwise fall back to first image
    const selectedIdx = selectedPanelImages[panelIdx] ?? 0;
    const imageUrl = imgs[selectedIdx] ?? imgs[0];
    setVideoLoadingPanel(panelIdx);
    try {
      actualVideo(imageUrl, result?.panels[panelIdx].image_prompt ?? '', `panel-${panelIdx}`);
      onSuccess('视频生成任务已提交');
    } catch (err) {
      onError(err instanceof Error ? err.message : '视频生成失败');
    } finally {
      setTimeout(() => setVideoLoadingPanel(null), 2000);
    }
  };

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Subscribe to finished task images — the same mechanism used by ExpandMode.
  // When a task completes, its images are registered via registerTaskImages and flow
  // into finishedTasks. We detect completed panels and update panelImages immediately.
  const { finishedTasks } = useFinishedTaskImages();
  useEffect(() => {
    if (!result) return;
    const historyId = sessionStorage.getItem('sb_latest_history_id');
    if (!historyId) return;

    console.debug('[StoryboardSection:finishedTasks] effect running, historyId=', historyId, 'finishedTasks keys=', Object.keys(finishedTasks), 'panelImages keys=', Object.keys(panelImages));

    let updated = false;
    const newImages: Record<number, string[]> = {};

    for (const [taskId, info] of Object.entries(finishedTasks)) {
      const { images, storyboardInfo } = info;
      if (!images || images.length === 0) continue;

      // Only process tasks that belong to this storyboard
      const hid = storyboardInfo?.historyId;
      if (!hid) {
        console.debug('[StoryboardSection:finishedTasks] skipping taskId=', taskId, 'no storyboardInfo.historyId');
        continue;
      }
      if (hid !== historyId) {
        console.debug('[StoryboardSection:finishedTasks] skipping taskId=', taskId, 'hid=', hid, '!== historyId=', historyId);
        continue;
      }

      const { panelIdx } = storyboardInfo;
      if (panelIdx === undefined) continue;

      // Update if we don't already have valid data URL images (avoid duplicate work)
      if (panelImages[panelIdx]?.length > 0 && panelImages[panelIdx][0]?.startsWith('data:')) {
        console.debug('[StoryboardSection:finishedTasks] skipping taskId=', taskId, 'panelIdx=', panelIdx, 'already has dataURL images');
        continue;
      }

      console.debug('[StoryboardSection:finishedTasks] applying taskId=', taskId, 'panelIdx=', panelIdx, 'images=', images.length);
      newImages[panelIdx] = images;
      cacheStoryboardPanelImages(hid, panelIdx, images).catch(() => {});
      updated = true;
    }

    if (updated && Object.keys(newImages).length > 0) {
      setPanelImages(prev => {
        const merged = { ...prev };
        Object.entries(newImages).forEach(([k, v]) => { merged[Number(k)] = v; });
        return merged;
      });

      // No-op: the live task path already caches each panel's
      // dataURLs via cacheStoryboardPanelImages. Writing the full
      // base64 back into history.panelImages multiplies the
      // localStorage usage by ~10x and trips QuotaExceededError
      // for the next saveHistory call (which then silently fails
      // for every subsequent operation). The preview list now
      // reads from the unified store directly.
    }

    if (updated) {
      Object.entries(newImages).forEach(([k, v]) => {
        if (v.length > 0) {
          const idx = Number(k);
          if (generatingPanelRef.current === idx) setGeneratingPanel(null);
          // Clear submitted state for this panel so loading indicator disappears
          setSubmittedPanels(prev => {
            if (!prev.has(idx)) return prev;
            const next = new Set(prev);
            next.delete(idx);
            return next;
          });
        }
      });
    }
  }, [finishedTasks, result]);

  // Load images for any history entry that was opened (or restored from
  // sessionStorage) before any live task completion. finishedTasks only
  // holds tasks that completed in *this* browser session, so restoring a
  // history entry from yesterday (or a sessionStorage draft) wouldn't get
  // any dataURL through the finishedTasks effect above — and the panel
  // cards would render empty. The fix is the same path HistoryPage uses:
  // read the unified store first, then the legacy img_cache_<fnv>_<i>
  // entries, and as a last resort hit the per-panel zip URL. Each step
  // is the exact same code HistoryPage runs for its image history tab,
  // so a thumbnail that shows up in the history page is guaranteed to
  // show up here too.
  useEffect(() => {
    if (!result) return;
    const historyId = sessionStorage.getItem('sb_latest_history_id');
    if (!historyId) return;
    let cancelled = false;

    (async () => {
      const historyItem = getStoryboardHistory().find((h) => h.id === historyId);
      // Tier 0: panelImages field on the history entry, which the live
      // path used to write directly (resolvePanelImages is a no-op for
      // data: URLs so this works as-is).
      const inline: Record<number, string[]> = historyItem?.panelImages
        ? resolvePanelImages(historyItem.panelImages)
        : {};

      // Tier 1 + tier 2 + tier 3: per-panel cache chain, parallel across
      // panels. We ask for each panel up to its declared count, but only
      // take the first 3 to keep the initial render light.
      const found: Record<number, string[]> = {};
      for (let i = 0; i < result.panels.length; i++) {
        if (inline[i] && inline[i].length > 0) {
          found[i] = inline[i];
          continue;
        }
        const cached = getCachedStoryboardPanelImages(historyId, i);
        if (cached.length > 0) {
          found[i] = cached;
          continue;
        }
        const panelZip = historyItem?.panelZipUrls?.[i] || historyItem?.zipUrl;
        if (!panelZip) continue;
        try {
          const images = await loadCachedOrExtractPanelImages(
            panelZip,
            historyItem?.panelImageCounts?.[i] || 3,
            historyId,
            i,
            panelZip,
          );
          if (cancelled) return;
          if (images.length > 0) found[i] = images;
        } catch (err) {
          console.debug('[StoryboardSection] panel image load failed for', historyId, i, err);
        }
      }

      if (cancelled) return;
      if (Object.keys(found).length > 0) {
        setPanelImages((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const [idx, imgs] of Object.entries(found)) {
            const k = Number(idx);
            if (imgs.length > 0 && (!prev[k] || prev[k].length === 0)) {
              next[k] = imgs;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }
    })();

    return () => { cancelled = true; };
  }, [result]);

  const displayImages = (idx: number) => panelImages[idx] ?? [];

  return (
    <div className="border border-purple-200/50 rounded-xl overflow-hidden bg-gradient-to-br from-purple-50/30 to-indigo-50/20">
      {/* Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-purple-50/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <div className="flex items-center gap-2">
          <Film size={14} className="text-purple-500" />
          <span className="text-xs font-medium text-purple-700">
            {displayLang === 'zh' ? '智能分镜' : 'Smart Storyboard'}
          </span>
          {selectedGirlfriend && (
            <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600 text-[10px] font-medium">
              {selectedGirlfriend.nameZh || selectedGirlfriend.name}
            </span>
          )}
          {smIntensity > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-500 text-[10px] font-medium flex items-center gap-0.5">
              SM:{smIntensity}
            </span>
          )}
          {r18Enabled && (
            <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-500 text-[10px] font-medium">R18</span>
          )}
          {poseMode && (
            <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-500 text-[10px] font-medium flex items-center gap-0.5">
              <Heart size={8} />姿势
            </span>
          )}
          {result && (
            <span className="px-1.5 py-0.5 rounded-full bg-green-100 text-green-600 text-[10px] font-medium">
              {result.panels.length}镜
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isOpen && result && (
            <span className="text-[10px] text-text-tertiary">{result.scene.nameZh}</span>
          )}
          {isOpen ? (
            <ChevronUp size={14} className="text-purple-400" />
          ) : (
            <ChevronDown size={14} className="text-purple-400" />
          )}
        </div>
      </button>

      {/* Content */}
      {isOpen && (
        <div className="px-4 pb-4 space-y-3">
          {/* Control row */}
          <div className="flex items-center gap-3 pt-1 flex-wrap">
            {/* Panel count selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-text-secondary">
                {displayLang === 'zh' ? '分镜数' : 'Panels'}:
              </span>
              <div className="flex rounded-lg border border-border overflow-hidden">
                {([5, 9, 12, 20] as const).map((n) => (
                  <button
                    key={n}
                    onClick={() => setPanelCount(n)}
                    disabled={disabled || isGenerating}
                    className={`px-3 py-1 text-[10px] font-medium transition-colors ${
                      panelCount === n
                        ? 'bg-purple-500 text-white'
                        : 'bg-white text-text-secondary hover:bg-purple-50'
                    } disabled:opacity-50`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Pose mode toggle */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-text-secondary">
                {displayLang === 'zh' ? '姿势分镜' : 'Pose'}:
              </span>
              <button
                onClick={() => setPoseMode(!poseMode)}
                disabled={disabled}
                className={`relative w-10 h-5 rounded-full transition-all duration-300 flex-shrink-0 ${
                  poseMode ? 'bg-red-500' : 'bg-gray-300'
                } disabled:opacity-50`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-300 ${
                  poseMode ? 'left-[22px]' : 'left-0.5'
                }`} />
              </button>
            </div>

            {/* SM intensity slider */}
            <div className="flex items-center gap-1.5">
              <span className={`text-[10px] font-medium ${smIntensity > 0 ? 'text-orange-500' : 'text-text-secondary'}`}>
                SM:
              </span>
              <input
                type="range"
                min={0}
                max={10}
                value={smIntensity}
                onChange={(e) => setSmIntensity(Number(e.target.value))}
                disabled={disabled}
                className={`w-20 h-1.5 rounded-full appearance-none cursor-pointer disabled:opacity-50`}
                style={{
                  background: `linear-gradient(to right, ${smIntensity > 0 ? '#f97316' : '#d1d5db'} 0%, ${smIntensity > 0 ? '#f97316' : '#d1d5db'} ${smIntensity * 10}%, #e5e7eb ${smIntensity * 10}%, #e5e7eb 100%)`,
                }}
              />
              <span className={`text-[10px] font-bold min-w-[16px] ${smIntensity > 0 ? 'text-orange-500' : 'text-text-tertiary'}`}>
                {smIntensity}
              </span>
            </div>

            {/* Generate button */}
            <button
              onClick={handleGenerate}
              disabled={disabled || isGenerating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-gradient-to-r from-purple-500 to-indigo-500 text-white hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {isGenerating ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Wand2 size={11} />
              )}
              <span>{displayLang === 'zh' ? '随机生成分镜' : 'Generate'}</span>
            </button>

            {result && (
              <>
                <button
                  onClick={handleCopyAll}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-white border border-border text-text-secondary hover:text-purple-600 hover:border-purple-300 transition-colors"
                >
                  {copiedIdx === -1 ? <Check size={10} /> : <Copy size={10} />}
                  <span>{displayLang === 'zh' ? '复制全部' : 'Copy All'}</span>
                </button>
                <button
                  onClick={handleClear}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium text-text-tertiary hover:text-red-400 transition-colors"
                >
                  <Trash2 size={10} />
                </button>
              </>
            )}
          </div>

          {/* Scene info */}
          {result && (
            <div className="bg-white/60 rounded-lg px-3 py-2 border border-purple-100">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-medium text-purple-600">
                  {displayLang === 'zh' ? '场景' : 'Scene'}:
                </span>
                <span className="text-[10px] text-text-primary font-medium">
                  {result.scene.nameZh}
                </span>
                <span className="text-[9px] text-text-tertiary">—</span>
                <span className="text-[10px] text-text-secondary">
                  {result.scene.locationZh}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {poseMode && (
                    <span className="text-[9px] text-red-400">姿势分镜</span>
                  )}
                  {smIntensity > 0 && (
                    <span className="text-[9px] text-orange-400">SM强度 {smIntensity}</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Panels list */}
          {result && (
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {result.panels.map((panel, idx) => {
                const imgs = displayImages(idx);
                const isSubmitted = submittedPanels.has(idx);
                // Keep loading while tasks are submitted but no images received yet, or per-panel generation is in progress
                const isLoading = (isSubmitted && imgs.length === 0) || (generatingPanel === idx);

                return (
                  <div
                    key={panel.panel_number}
                    className="bg-white/70 rounded-lg p-3 border border-purple-100/60 hover:border-purple-200 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-purple-500 text-white text-[9px] font-bold">
                          {panel.panel_number}
                        </span>
                        <span className="text-[10px] text-purple-600 font-medium">
                          {panel.shooting_angle}
                        </span>
                        <span className="text-[9px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                          {panel.pose}
                        </span>
                        {isLoading && (
                          <span className="flex items-center gap-0.5 text-[9px] text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
                            <Loader2 size={8} className="animate-spin" />
                            生成中
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {/* Per-panel generate button */}
                        {imgs.length === 0 && (
                          <button
                            onClick={() => {
                              console.log(`[StoryboardSection] per-panel Gen button clicked: idx=${idx}, panel.prompt length=${panel.image_prompt.length}, prompt preview=${panel.image_prompt.slice(0, 60)}`);
                              setGeneratingPanel(idx);
                              generatingPanelRef.current = idx;
                              if (result) panelsRef.current = result.panels;
                              // Don't start polling — finishedTasks effect handles image updates
                              actualSingleImage(idx, panel.image_prompt);
                            }}
                            disabled={disabled || generatingPanel === idx}
                            className="flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] bg-indigo-500 text-white hover:bg-indigo-600 transition-colors disabled:opacity-50"
                          >
                            {generatingPanel === idx ? (
                              <Loader2 size={8} className="animate-spin" />
                            ) : (
                              <Film size={9} />
                            )}
                            {displayLang === 'zh' ? '生成' : 'Gen'}
                          </button>
                        )}
                        <button
                          onClick={() => handleCopyPrompt(panel.image_prompt, idx)}
                          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-text-tertiary hover:text-purple-500 transition-colors"
                        >
                          {copiedIdx === idx ? (
                            <><Check size={10} className="text-green-400" /> {displayLang === 'zh' ? '已复制' : 'Copied'}</>
                          ) : (
                            <><Copy size={10} /> {displayLang === 'zh' ? '复制' : 'Copy'}</>
                          )}
                        </button>
                        {/* Video generation button */}
                        {imgs.length > 0 && (
                          <button
                            onClick={() => handleGenerateVideo(idx)}
                            disabled={videoLoadingPanel === idx}
                            className="flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] bg-purple-500 text-white hover:bg-purple-600 transition-colors disabled:opacity-60"
                          >
                            {videoLoadingPanel === idx ? (
                              <><Loader2 size={8} className="animate-spin" /></>
                            ) : (
                              <Video size={10} />
                            )}
                            {displayLang === 'zh' ? '图生视频' : 'Video'}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Scene description */}
                    <p className="text-[10px] text-text-secondary leading-relaxed mb-2">
                      {panel.scene_description}
                    </p>

                    {/* Prompt preview */}
                    <p className="text-[9px] text-text-tertiary font-mono leading-relaxed line-clamp-3 mb-1">
                      {panel.image_prompt}
                    </p>

                    {/* Video prompt — derived from image prompt */}
                    {imgs.length > 0 && (
                      <div className="mb-2">
                        <div className="flex items-center gap-1 mb-0.5">
                          <Video size={8} className="text-blue-400" />
                          <span className="text-[8px] text-blue-400 font-medium">动画提示词</span>
                        </div>
                        <p className="text-[8px] text-blue-500/80 font-mono leading-relaxed line-clamp-2 bg-blue-50 rounded px-1.5 py-1">
                          {extractVideoPromptFromImagePrompt(panel.image_prompt, r18Enabled)}
                        </p>
                      </div>
                    )}

                    {/* Image grid preview — card style with favorite + click to preview */}
                    {imgs.length > 0 ? (
                      <div className="mt-2 pt-2 border-t border-purple-100">
                        <ImageGrid
                          images={imgs}
                          selectedIndex={selectedPanelImages[idx] ?? null}
                          onSelectImage={(imgIdx) => setSelectedPanelImages(prev => ({ ...prev, [idx]: imgIdx }))}
                          onToggleFavorite={onToggleFavorite ? (url) => onToggleFavorite(url, panel.image_prompt) : undefined}
                        />
                      </div>
                    ) : (
                      <p className="text-[9px] text-text-tertiary italic mt-1">
                        {isLoading
                          ? (displayLang === 'zh' ? '图片生成中...' : 'Generating...')
                          : (displayLang === 'zh' ? '点击下方"一键生成"获取预览图' : 'Click "Generate All" below to get previews')}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Empty state */}
          {!result && (
            <div className="text-center py-6">
              <Film size={24} className="mx-auto mb-2 text-purple-300" />
              <p className="text-[11px] text-text-tertiary">
                {displayLang === 'zh'
                  ? '点击「随机生成分镜」，从场景库中随机生成连续分镜提示词'
                  : 'Click "Generate" to randomly create a coherent storyboard'}
              </p>
            </div>
          )}

          {/* Batch generate images */}
          {result && (
            <div className="pt-1">
              <button
                onClick={handleGenerateImages}
                disabled={disabled || isSubmitting}
                className="w-full py-2 rounded-lg text-[11px] font-medium bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                <span className="flex items-center justify-center gap-1.5">
                  {isSubmitting ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Film size={12} />
                  )}
                  {displayLang === 'zh'
                    ? `一键生成全部 ${result.panels.length} 张分镜图片`
                    : `Generate All ${result.panels.length} Panel Images`}
                </span>
              </button>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
