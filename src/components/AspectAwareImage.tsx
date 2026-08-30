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

/** 检测 URL 是否是视频 */
function isVideoUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.startsWith('data:video/')) return true;
  if (lower.startsWith('data:image/')) return false;
  return /\.(mp4|webm|mov|avi|mkv)(\?|#|$)/i.test(lower);
}

/**
 * 按照媒体实际比例显示的图片/视频组件
 * 会自动检测宽高比，并按照实际比例渲染
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
  const videoRef = useRef<HTMLVideoElement>(null);

  const isVideo = isVideoUrl(src);

  useEffect(() => {
    if (!src) {
      setHasError(true);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setHasError(false);

    if (isVideo) {
      // 视频：使用 video 元素来检测元数据（宽高比）
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        const ratio = video.videoWidth / video.videoHeight;
        setAspectRatio(ratio > 0 ? ratio : 16 / 9);
        setIsLoading(false);
        onLoad?.();
      };
      video.onerror = () => {
        setHasError(true);
        setIsLoading(false);
        onError?.();
      };
      video.src = src;
      return () => {
        video.onloadedmetadata = null;
        video.onerror = null;
      };
    } else {
      // 图片：使用 Image 对象检测宽高比
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
    }
  }, [src, isVideo, onLoad, onError]);

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
      {isVideo ? (
        <video
          ref={videoRef}
          src={src}
          muted
          playsInline
          className={`w-full h-full object-${objectFit}`}
        />
      ) : (
        <img
          src={src}
          alt={alt}
          className={`w-full h-full object-${objectFit}`}
          loading="lazy"
        />
      )}
    </div>
  );
}
