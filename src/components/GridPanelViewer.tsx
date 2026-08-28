import React from 'react';
import { Loader2, ZoomIn, RefreshCw, Download, Heart, Film } from 'lucide-react';
import type { GridPanel } from '../services/storage';

interface GridPanelViewerProps {
  panels: GridPanel[];
  gridSize: number;
  panelImages: Record<number, string[]>;
  loadingPanels: Set<number>;
  onPreviewPanel: (panelIdx: number) => void;
  onRegeneratePanel: (panelIdx: number) => void;
  isRegenerating: number | null;
  displayLang: 'en' | 'zh';
  onToggleFavorite?: (url: string, prompt?: string) => void;
  isFavorited?: (url: string) => boolean;
}

export function GridPanelViewer({
  panels,
  gridSize,
  panelImages,
  loadingPanels,
  onPreviewPanel,
  onRegeneratePanel,
  isRegenerating,
  displayLang,
  onToggleFavorite,
  isFavorited,
}: GridPanelViewerProps) {
  const getGridCols = () => {
    if (gridSize <= 4) return 'grid-cols-2';
    if (gridSize <= 9) return 'grid-cols-3';
    return 'grid-cols-4';
  };

  const handleDownload = (imageUrl: string) => {
    try {
      const a = document.createElement('a');
      a.href = imageUrl;
      const mimeMatch = imageUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);/);
      const ext = mimeMatch ? mimeMatch[1].split('/')[1] : 'png';
      a.download = `grid_panel_${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error('[GridPanelViewer] download failed:', err);
    }
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Film size={14} className="text-purple-500" />
        <span className="text-xs font-medium text-purple-700">
          {displayLang === 'zh' ? `分镜图片 (${gridSize}格)` : `Panel Images (${gridSize})`}
        </span>
        <span className="text-[10px] text-text-tertiary">
          {displayLang === 'zh' ? '点击放大查看' : 'Click to enlarge'}
        </span>
      </div>

      {/* Image Grid */}
      <div className={`grid ${getGridCols()} gap-3`}>
        {panels.map((panel, idx) => {
          const images = panelImages[idx] ?? [];
          const isLoading = loadingPanels.has(idx);
          const hasImages = images.length > 0;
          const isRegen = isRegenerating === idx;

          return (
            <div
              key={panel.panel_number}
              className="relative group rounded-lg overflow-hidden border border-purple-100/60 bg-white/70"
            >
              {/* Panel number badge */}
              <div className="absolute top-1.5 left-1.5 z-10">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-purple-500/90 text-white text-[9px] font-bold shadow-sm">
                  {panel.panel_number}
                </span>
              </div>

              {/* Image container - 9:16 aspect ratio */}
              <div
                className="relative aspect-[9/16] bg-bg-elevated cursor-pointer overflow-hidden"
                onClick={() => hasImages && onPreviewPanel(idx)}
              >
                {hasImages ? (
                  <>
                    <img
                      src={images[0]}
                      alt={`Panel ${panel.panel_number}`}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center gap-2">
                        <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                          <ZoomIn size={20} className="text-gray-700" />
                        </div>
                        <span className="text-[10px] text-white font-medium bg-black/50 px-2 py-0.5 rounded">
                          {displayLang === 'zh' ? '点击放大' : 'Click to enlarge'}
                        </span>
                      </div>
                    </div>
                    {/* Action buttons on hover */}
                    <div className="absolute top-1.5 right-1.5 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {onToggleFavorite && isFavorited && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onToggleFavorite(images[0], panel.image_prompt); }}
                          className={`w-7 h-7 rounded-full flex items-center justify-center transition-all shadow-sm ${isFavorited(images[0]) ? 'bg-red-500 text-white' : 'bg-white/90 text-gray-700 hover:bg-red-500 hover:text-white'}`}
                        >
                          <Heart size={13} className={isFavorited(images[0]) ? 'fill-white' : ''} />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDownload(images[0]); }}
                        className="w-7 h-7 rounded-full bg-white/90 text-gray-700 hover:bg-blue-500 hover:text-white flex items-center justify-center transition-all shadow-sm"
                      >
                        <Download size={13} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onRegeneratePanel(idx); }}
                        disabled={isRegen}
                        className="w-7 h-7 rounded-full bg-white/90 text-gray-700 hover:bg-purple-500 hover:text-white flex items-center justify-center transition-all shadow-sm disabled:opacity-50"
                      >
                        {isRegen ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                      </button>
                    </div>
                    {/* Image count badge */}
                    {images.length > 1 && (
                      <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/60 text-white text-[9px] font-medium">
                        {images.length}
                      </div>
                    )}
                  </>
                ) : (
                  /* Loading or empty state */
                  <div className="w-full h-full flex flex-col items-center justify-center">
                    {isLoading || isRegen ? (
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 size={20} className="animate-spin text-purple-400" />
                        <span className="text-[10px] text-text-tertiary">
                          {displayLang === 'zh' ? '生成中...' : 'Generating...'}
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <Film size={20} className="text-purple-200" />
                        <span className="text-[10px] text-text-tertiary">
                          {displayLang === 'zh' ? '等待生成' : 'Waiting'}
                        </span>
                        <button
                          onClick={() => onRegeneratePanel(idx)}
                          className="flex items-center gap-1 px-2 py-1 rounded text-[9px] bg-purple-500 text-white hover:bg-purple-600 transition-colors"
                        >
                          <RefreshCw size={9} />
                          {displayLang === 'zh' ? '生成' : 'Generate'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Scene description below image */}
              <div className="px-2 py-1.5">
                <p className="text-[9px] text-text-secondary leading-tight line-clamp-2">
                  {panel.scene_description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
