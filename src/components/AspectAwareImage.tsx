import React, { useState, useEffect, useRef } from 'react';

interface AspectAwareImageProps {
  src: string;
  alt: string;
  className?: string;
  /** Maximum height in pixels (default: 120) */
  maxHeight?: number;
  /** Object fit mode (default: 'cover') */
  objectFit?: 'cover' | 'contain';
  /** Callback when image loads */
  onLoad?: () => void;
  /** Callback when image errors */
  onError?: () => void;
  /** Callback when clicked */
  onClick?: () => void;
  /** Additional styles */
  style?: React.CSSProperties;
}

/**
 * 按照图片实际比例显示的图片组件
 * 会自动检测图片的宽高比，并按照实际比例渲染
 */
export function AspectAwareImage({
  src,
  alt,
  className = '',
  maxHeight = 120,
  objectFit = 'cover',
  onLoad,
  onError,
  onClick,
  style = {},
}: AspectAwareImageProps) {
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!src) {
      setHasError(true);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setHasError(false);

    const img = new Image();
    img.onload = () => {
      const ratio = img.naturalWidth / img.naturalHeight;
      setAspectRatio(ratio);
      setIsLoading(false);
      onLoad?.();
    };
    img.onerror = () => {
      setHasError(true);
      setIsLoading(false);
      onError?.();
    };
    img.src = src;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [src, onLoad, onError]);

  if (hasError) {
    return (
      <div
        className={`flex items-center justify-center bg-bg-elevated text-text-tertiary ${className}`}
        style={{ height: maxHeight, ...style }}
      >
        <span className="text-xs">加载失败</span>
      </div>
    );
  }

  if (isLoading || aspectRatio === null) {
    return (
      <div
        className={`flex items-center justify-center bg-bg-elevated animate-pulse ${className}`}
        style={{ height: maxHeight, ...style }}
      />
    );
  }

  // 根据实际比例计算宽度
  const width = maxHeight * aspectRatio;

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{
        width,
        height: maxHeight,
        ...style,
      }}
      onClick={onClick}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={`w-full h-full object-${objectFit}`}
        loading="lazy"
      />
    </div>
  );
}
