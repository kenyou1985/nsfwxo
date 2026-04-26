import React, { useState, useEffect } from 'react';
import { Download, X, ZoomIn, Heart, Check } from 'lucide-react';
import { downloadImage } from '../services/runninghub';
import { isFavorited as checkIsFavorited } from '../services/storage';

interface ImageGridProps {
  images: string[];
  isLoading?: boolean;
  onToggleFavorite?: (url: string) => void;
  selectedIndex?: number | null;
  onSelectImage?: (index: number) => void;
}

export function ImageGrid({ images, isLoading, onToggleFavorite, selectedIndex, onSelectImage }: ImageGridProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const openLightbox = (index: number) => setLightboxIndex(index);
  const closeLightbox = () => setLightboxIndex(null);

  const handleDownload = (url: string, index: number) => {
    downloadImage(url, `generated-${index + 1}.png`);
  };

  const handleNext = () => {
    if (lightboxIndex !== null) {
      setLightboxIndex((lightboxIndex + 1) % images.length);
    }
  };

  const handlePrev = () => {
    if (lightboxIndex !== null) {
      setLightboxIndex((lightboxIndex - 1 + images.length) % images.length);
    }
  };

  const handleToggleFavorite = (url: string) => {
    onToggleFavorite?.(url);
  };

  const isFav = (url: string) => checkIsFavorited(url);

  const handleImageClick = (index: number) => {
    if (onSelectImage) {
      onSelectImage(index);
    }
    openLightbox(index);
  };

  // Keyboard navigation
  useEffect(() => {
    if (lightboxIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') handleNext();
      else if (e.key === 'ArrowLeft') handlePrev();
      else if (e.key === 'Escape') closeLightbox();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxIndex]);

  return (
    <>
      {isLoading ? (
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="aspect-video rounded-lg bg-bg-elevated animate-pulse"
            />
          ))}
        </div>
      ) : images.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {images.map((url, i) => (
            <div
              key={i}
              className="group relative rounded-lg overflow-hidden bg-bg-elevated cursor-pointer"
              onClick={() => handleImageClick(i)}
            >
              <img
                src={url}
                alt={`Generated ${i + 1}`}
                className="w-full aspect-video object-cover transition-transform group-hover:scale-105"
              />
              {/* Selected highlight */}
              {selectedIndex === i && (
                <div className="absolute inset-0 ring-2 ring-purple-500 ring-offset-1 bg-purple-500/20">
                  <div className="absolute top-1 left-1 w-5 h-5 rounded-full bg-purple-500 flex items-center justify-center">
                    <Check size={10} className="text-white" />
                  </div>
                </div>
              )}
              {onToggleFavorite && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleToggleFavorite(url); }}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 transition-colors"
                >
                  <Heart
                    size={11}
                    className={isFav(url) ? 'fill-red-500 text-red-500' : 'text-white'}
                  />
                </button>
              )}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDownload(url, i); }}
                    className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/30 transition-colors"
                  >
                    <Download size={13} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); openLightbox(i); }}
                    className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/30 transition-colors"
                  >
                    <ZoomIn size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {lightboxIndex !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/95"
          onClick={closeLightbox}
        >
          {/* Top bar */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 z-10" onClick={(e) => e.stopPropagation()}>
            <span className="text-sm text-text-secondary">
              {lightboxIndex + 1} / {images.length}
            </span>
            <div className="flex items-center gap-2">
              {onSelectImage && (
                <button
                  onClick={(e) => { e.stopPropagation(); onSelectImage(lightboxIndex); }}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${selectedIndex === lightboxIndex ? 'bg-purple-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}
                  title={selectedIndex === lightboxIndex ? '已选中' : '选中此图'}
                >
                  <Check size={18} />
                </button>
              )}
              {onToggleFavorite && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleToggleFavorite(images[lightboxIndex]); }}
                  className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
                >
                  <Heart size={18} className={isFav(images[lightboxIndex]) ? 'fill-red-500 text-red-500' : 'text-white'} />
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); handleDownload(images[lightboxIndex], lightboxIndex); }}
                className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
              >
                <Download size={18} />
              </button>
              <button
                onClick={closeLightbox}
                className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Image fills the entire screen */}
          <img
            src={images[lightboxIndex]}
            alt="Full size"
            className="absolute inset-0 w-full h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Prev/Next arrows */}
          {images.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); handlePrev(); }}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-black/40 flex items-center justify-center text-white hover:bg-black/60 transition-colors text-2xl z-10"
              >
                ‹
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleNext(); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-black/40 flex items-center justify-center text-white hover:bg-black/60 transition-colors text-2xl z-10"
              >
                ›
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
