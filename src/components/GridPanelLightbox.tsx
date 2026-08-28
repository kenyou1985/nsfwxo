import React, { useState, useEffect, useCallback } from 'react';
import {
  X, ChevronLeft, ChevronRight, Download, Heart, Copy, Check,
  Wand2, Loader2, RefreshCw, ZoomIn,
} from 'lucide-react';
import type { GridPanel } from '../services/storage';

interface GridPanelLightboxProps {
  panels: GridPanel[];
  panelImages: Record<number, string[]>;
  currentIndex: number;
  onClose: () => void;
  onRegeneratePanel: (panelIdx: number, newPrompt: string) => void;
  isRegenerating: boolean;
  displayLang: 'en' | 'zh';
  onToggleFavorite?: (url: string, prompt?: string) => void;
  isFavorited?: (url: string) => boolean;
}

export function GridPanelLightbox({
  panels,
  panelImages,
  currentIndex,
  onClose,
  onRegeneratePanel,
  isRegenerating,
  displayLang,
  onToggleFavorite,
  isFavorited,
}: GridPanelLightboxProps) {
  const [activeIndex, setActiveIndex] = useState(currentIndex);
  const [editedPrompt, setEditedPrompt] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const panel = panels[activeIndex];
  const images = panelImages[activeIndex] ?? [];
  const hasImages = images.length > 0;
  const currentImage = images[0] || '';

  // Sync edited prompt when panel changes
  useEffect(() => {
    if (panel) {
      setEditedPrompt(panel.image_prompt);
      setIsEditing(false);
    }
  }, [activeIndex, panel]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, panels.length]);

  const goPrev = useCallback(() => {
    setActiveIndex((i) => (i - 1 + panels.length) % panels.length);
  }, [panels.length]);

  const goNext = useCallback(() => {
    setActiveIndex((i) => (i + 1) % panels.length);
  }, [panels.length]);

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(editedPrompt);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = editedPrompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  const handleDownload = () => {
    if (!currentImage) return;
    try {
      const a = document.createElement('a');
      a.href = currentImage;
      const mimeMatch = currentImage.match(/^data:(image\/[a-zA-Z0-9+.-]+);/);
      const ext = mimeMatch ? mimeMatch[1].split('/')[1] : 'png';
      a.download = `grid_panel_${activeIndex + 1}_${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error('[GridPanelLightbox] download failed:', err);
    }
  };

  const handleRegenerate = () => {
    if (!editedPrompt.trim() || isRegenerating) return;
    onRegeneratePanel(activeIndex, editedPrompt.trim());
  };

  if (!panel) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/95 flex animate-fade-in"
      onClick={onClose}
    >
      <div className="flex flex-col lg:flex-row w-full h-full" onClick={(e) => e.stopPropagation()}>
        {/* Left: Image area */}
        <div className="flex-1 flex items-center justify-center relative min-h-0">
          {/* Top bar */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 z-10 bg-gradient-to-b from-black/60 to-transparent">
            <div className="flex items-center gap-3">
              <span className="text-white/80 text-sm font-medium">
                {panel.panel_number} / {panels.length}
              </span>
              <span className="text-white/50 text-xs truncate max-w-[200px]">
                {panel.scene_description.slice(0, 40)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {onToggleFavorite && isFavorited && currentImage && (
                <button
                  onClick={() => onToggleFavorite(currentImage, panel.image_prompt)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    isFavorited(currentImage)
                      ? 'bg-red-500 text-white'
                      : 'bg-white/90 text-gray-700 hover:bg-white'
                  }`}
                >
                  <Heart size={12} fill={isFavorited(currentImage) ? 'currentColor' : 'none'} />
                  {isFavorited(currentImage)
                    ? (displayLang === 'zh' ? '已收藏' : 'Favorited')
                    : (displayLang === 'zh' ? '收藏' : 'Favorite')}
                </button>
              )}
              {currentImage && (
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-white/90 text-gray-700 hover:bg-white transition-all"
                >
                  <Download size={12} />
                  {displayLang === 'zh' ? '下载' : 'Download'}
                </button>
              )}
            </div>
          </div>

          {/* Navigation arrows */}
          {panels.length > 1 && (
            <button
              onClick={goPrev}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
            >
              <ChevronLeft size={22} />
            </button>
          )}

          {/* Main image */}
          <div className="flex items-center justify-center w-full h-full px-16 py-16">
            {hasImages ? (
              <img
                src={currentImage}
                alt={`Panel ${panel.panel_number}`}
                className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
              />
            ) : (
              <div className="flex flex-col items-center gap-3 text-white/50">
                <ZoomIn size={40} />
                <span className="text-sm">
                  {displayLang === 'zh' ? '暂无图片' : 'No image'}
                </span>
              </div>
            )}
          </div>

          {panels.length > 1 && (
            <button
              onClick={goNext}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
            >
              <ChevronRight size={22} />
            </button>
          )}

          {/* Regenerating overlay */}
          {isRegenerating && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-20">
              <div className="flex flex-col items-center gap-3">
                <Loader2 size={32} className="animate-spin text-white" />
                <span className="text-white text-sm font-medium">
                  {displayLang === 'zh' ? '重新生成中...' : 'Regenerating...'}
                </span>
              </div>
            </div>
          )}

          {/* Thumbnail strip at bottom */}
          {panels.length > 1 && (
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-2 py-3 px-6 bg-gradient-to-t from-black/60 to-transparent overflow-x-auto">
              {panels.map((p, i) => {
                const thumbImg = panelImages[i]?.[0];
                return (
                  <button
                    key={p.panel_number}
                    onClick={() => setActiveIndex(i)}
                    className={`flex-shrink-0 rounded-md overflow-hidden border-2 transition-all ${
                      i === activeIndex
                        ? 'border-white opacity-100 w-14 h-19'
                        : 'border-transparent opacity-50 hover:opacity-80 w-10 h-14'
                    }`}
                    style={{ aspectRatio: '9/16' }}
                  >
                    {thumbImg ? (
                      <img src={thumbImg} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-white/10 flex items-center justify-center">
                        <span className="text-white/50 text-[9px] font-bold">{p.panel_number}</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Edit panel */}
        <div className="w-full lg:w-80 xl:w-96 bg-gray-900 border-l border-white/10 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-purple-500 text-white text-[10px] font-bold flex items-center justify-center">
                {panel.panel_number}
              </span>
              <span className="text-white text-sm font-medium">
                {displayLang === 'zh' ? `第${panel.panel_number}镜` : `Panel ${panel.panel_number}`}
              </span>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            {/* Scene description */}
            <div>
              <span className="text-[10px] text-white/40 font-medium uppercase tracking-wider">
                {displayLang === 'zh' ? '场景描述' : 'Scene Description'}
              </span>
              <p className="text-xs text-white/70 leading-relaxed mt-1">
                {panel.scene_description}
              </p>
            </div>

            {/* Prompt editor */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-white/40 font-medium uppercase tracking-wider">
                  {displayLang === 'zh' ? '图片提示词' : 'Image Prompt'}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleCopyPrompt}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-white/50 hover:text-white/80 transition-colors"
                  >
                    {copiedPrompt ? (
                      <><Check size={10} className="text-green-400" /> {displayLang === 'zh' ? '已复制' : 'Copied'}</>
                    ) : (
                      <><Copy size={10} /> {displayLang === 'zh' ? '复制' : 'Copy'}</>
                    )}
                  </button>
                  {!isEditing && (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-white/50 hover:text-white/80 transition-colors"
                    >
                      <Wand2 size={10} />
                      {displayLang === 'zh' ? '编辑' : 'Edit'}
                    </button>
                  )}
                </div>
              </div>
              {isEditing ? (
                <div className="space-y-2">
                  <textarea
                    value={editedPrompt}
                    onChange={(e) => setEditedPrompt(e.target.value)}
                    rows={6}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white/90 font-mono resize-none focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400/30"
                    placeholder={displayLang === 'zh' ? '输入生图提示词...' : 'Enter image prompt...'}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setIsEditing(false);
                        setEditedPrompt(panel.image_prompt);
                      }}
                      className="px-3 py-1.5 rounded-lg text-[11px] text-white/60 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
                    >
                      {displayLang === 'zh' ? '取消' : 'Cancel'}
                    </button>
                    <button
                      onClick={() => setIsEditing(false)}
                      className="px-3 py-1.5 rounded-lg text-[11px] text-white/60 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
                    >
                      {displayLang === 'zh' ? '保存' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => setIsEditing(true)}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white/70 font-mono leading-relaxed cursor-pointer hover:border-white/20 transition-colors min-h-[60px]"
                  title={displayLang === 'zh' ? '点击编辑' : 'Click to edit'}
                >
                  {editedPrompt}
                </div>
              )}
            </div>

            {/* Regenerate button */}
            <button
              onClick={handleRegenerate}
              disabled={isRegenerating || !editedPrompt.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-medium bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRegenerating ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              {displayLang === 'zh' ? '用新提示词重绘此格' : 'Regenerate This Panel'}
            </button>

            {/* Tips */}
            <div className="p-3 rounded-lg bg-white/5 border border-white/10">
              <p className="text-[10px] text-white/40 leading-relaxed">
                {displayLang === 'zh'
                  ? '💡 修改提示词后点击重绘，可单独重新生成这一格图片。使用左右方向键快速切换格子。'
                  : '💡 Edit the prompt and click regenerate to redraw this panel only. Use left/right arrow keys to navigate.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
