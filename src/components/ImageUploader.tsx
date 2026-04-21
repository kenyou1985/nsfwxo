import React, { useRef, useState } from 'react';
import { Upload, X, AlertCircle } from 'lucide-react';

interface ImageUploaderProps {
  value: string;
  previewUrl?: string;
  onChange: (path: string, previewUrl: string) => void;
  onUpload: (file: File) => Promise<void>;
  disabled?: boolean;
  error?: string;
  label?: string;
  uploadLabel?: string;
}

const MAX_SIZE_MB = 10;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export function ImageUploader({
  value,
  previewUrl,
  onChange,
  onUpload,
  disabled = false,
  error,
  label,
  uploadLabel,
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const displayPreview = previewUrl || value;

  const validateFile = (file: File): string | null => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return '请上传 JPG、PNG、WebP 或 GIF 格式图片';
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return `图片大小不能超过 ${MAX_SIZE_MB}MB`;
    }
    return null;
  };

  const handleFile = async (file: File) => {
    const err = validateFile(file);
    if (err) {
      setUploadError(err);
      return;
    }
    setUploadError(null);
    setIsUploading(true);
    try {
      await onUpload(file);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : '上传失败');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled || isUploading) return;
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('', '');
    setUploadError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const displayError = uploadError || error;

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-text-primary">{label || '参考图片'}</label>

      <div
        onClick={() => !disabled && !isUploading && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !isUploading) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`
          relative rounded-xl border-2 border-dashed transition-all overflow-hidden
          ${
            displayError
              ? 'border-red-500/50 bg-red-500/5'
              : isDragging
              ? 'border-primary bg-primary/5'
              : displayPreview
              ? 'border-border bg-bg-elevated'
              : 'border-border hover:border-primary/50 hover:bg-bg-elevated cursor-pointer'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          onChange={handleInputChange}
          className="hidden"
          disabled={disabled || isUploading}
        />

        {isUploading ? (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="mt-3 text-sm text-text-secondary">上传中...</p>
          </div>
        ) : displayPreview ? (
          <div className="relative">
            <img
              src={displayPreview}
              alt="Preview"
              className="w-full h-48 object-contain"
            />
            <button
              onClick={handleClear}
              className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <div className="w-12 h-12 rounded-full bg-bg-elevated flex items-center justify-center mb-3">
              {displayError ? (
                <AlertCircle size={24} className="text-red-400" />
              ) : (
                <Upload size={24} className="text-text-secondary" />
              )}
            </div>
            <p className="text-sm text-text-secondary font-medium">
              {displayError ? displayError : (displayPreview ? uploadLabel || '点击或拖拽更换图片' : '点击或拖拽上传图片')}
            </p>
            <p className="mt-1 text-xs text-text-tertiary">
              支持 JPG、PNG、WebP，最大 {MAX_SIZE_MB}MB
            </p>
          </div>
        )}
      </div>

      {displayError && <p className="text-xs text-red-400 mt-1">{displayError}</p>}
    </div>
  );
}
