import React from 'react';
import { Heart, Download, X } from 'lucide-react';

interface LightboxViewerProps {
  images: string[];
  currentIndex: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleFavorite: (url: string) => void;
  onDownload: (url: string) => void;
  isFavorite: (url: string) => boolean;
  /** Total across all records (for global counter) */
  globalIndex?: number;
  /** Total across all records */
  globalTotal?: number;
}

export function LightboxViewer({
  images,
  currentIndex,
  onClose,
  onPrev,
  onNext,
  onToggleFavorite,
  onDownload,
  isFavorite,
  globalIndex,
  globalTotal,
}: LightboxViewerProps) {
  const currentUrl = images[currentIndex];
  if (!currentUrl) return null;

  const counterText = globalTotal !== undefined
    ? `${globalIndex} / ${globalTotal}`
    : `${currentIndex + 1} / ${images.length}`;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex flex-col"
      onClick={onClose}
    >
      {/* Top bar */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-sm text-white/70">{counterText}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(currentUrl); }}
            className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
            title="收藏"
          >
            <Heart
              size={18}
              className={isFavorite(currentUrl) ? 'fill-red-500 text-red-500' : 'text-white'}
            />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDownload(currentUrl); }}
            className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
            title="下载"
          >
            <Download size={18} className="text-white" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
            title="关闭"
          >
            <X size={18} className="text-white" />
          </button>
        </div>
      </div>

      {/* Image */}
      <div
        className="flex-1 flex items-center justify-center p-16"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={currentUrl}
          alt={`图片 ${currentIndex + 1}`}
          className="max-w-full max-h-full object-contain"
        />
      </div>

      {/* Prev arrow */}
      {currentIndex > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
          className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/40 flex items-center justify-center text-white hover:bg-black/60 transition-colors text-2xl z-10"
          title="上一张"
        >
          ‹
        </button>
      )}

      {/* Next arrow */}
      {currentIndex < images.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); onNext(); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/40 flex items-center justify-center text-white hover:bg-black/60 transition-colors text-2xl z-10"
          title="下一张"
        >
          ›
        </button>
      )}
    </div>
  );
}
