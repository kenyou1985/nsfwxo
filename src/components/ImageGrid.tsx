import React, { useState, useEffect } from 'react';
import { Download, X, ZoomIn } from 'lucide-react';
import { downloadImage } from '../services/runninghub';

interface ImageGridProps {
  images: string[];
  isLoading?: boolean;
}

export function ImageGrid({ images, isLoading }: ImageGridProps) {
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
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="aspect-square rounded-xl bg-bg-elevated animate-pulse"
            />
          ))}
        </div>
      ) : images.length > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          {images.map((url, i) => (
            <div
              key={i}
              className="group relative aspect-square rounded-xl overflow-hidden bg-bg-elevated cursor-pointer"
              onClick={() => openLightbox(i)}
            >
              <img
                src={url}
                alt={`Generated ${i + 1}`}
                className="w-full h-full object-cover transition-transform group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                <div className="flex gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDownload(url, i); }}
                    className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/30 transition-colors"
                  >
                    <Download size={16} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); openLightbox(i); }}
                    className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/30 transition-colors"
                  >
                    <ZoomIn size={16} />
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
