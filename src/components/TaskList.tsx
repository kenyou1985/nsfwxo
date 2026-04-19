import React, { useState, useEffect } from 'react';
import { X, Download, Clock, Coins, CheckCircle, XCircle, Loader2, RotateCcw, ZoomIn } from 'lucide-react';
import JSZip from 'jszip';
import type { QueuedTask } from '../types';
import { downloadZip, downloadImage } from '../services/runninghub';

interface TaskListProps {
  tasks: QueuedTask[];
  onCancel: (id: string) => void;
  onClearCompleted: () => void;
  onRegenerate: (id: string) => void;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function getStatusIcon(status: QueuedTask['status']) {
  switch (status) {
    case 'QUEUEING':
      return <Loader2 size={16} className="text-yellow-400 animate-spin" />;
    case 'RUNNING':
      return <Loader2 size={16} className="text-blue-400 animate-spin" />;
    case 'FINISHED':
      return <CheckCircle size={16} className="text-green-400" />;
    case 'FAILED':
      return <XCircle size={16} className="text-red-400" />;
    default:
      return <Clock size={16} className="text-slate-500" />;
  }
}

function getStatusText(status: QueuedTask['status']): string {
  switch (status) {
    case 'QUEUEING': return '排队中';
    case 'RUNNING': return '生成中';
    case 'FINISHED': return '已完成';
    case 'FAILED': return '失败';
    default: return '等待中';
  }
}

function getStatusColor(status: QueuedTask['status']): string {
  switch (status) {
    case 'QUEUEING': return 'bg-yellow-500/20 border-yellow-500/30';
    case 'RUNNING': return 'bg-blue-500/20 border-blue-500/30';
    case 'FINISHED': return 'bg-green-500/20 border-green-500/30';
    case 'FAILED': return 'bg-red-500/20 border-red-500/30';
    default: return 'bg-bg-elevated border-border';
  }
}

export function TaskList({ tasks, onCancel, onClearCompleted, onRegenerate }: TaskListProps) {
  const hasCompleted = tasks.some((t) => t.status === 'FINISHED' || t.status === 'FAILED');

  if (tasks.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-300">
          任务列表 ({tasks.length}/20)
        </h3>
        {hasCompleted && (
          <button
            onClick={onClearCompleted}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            清除已完成
          </button>
        )}
      </div>

      <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onCancel={() => onCancel(task.id)}
            onRegenerate={() => onRegenerate(task.id)}
          />
        ))}
      </div>
    </div>
  );
}

function TaskCard({ task, onCancel, onRegenerate }: { task: QueuedTask; onCancel: () => void; onRegenerate: () => void }) {
  const isActive = task.status === 'QUEUEING' || task.status === 'RUNNING';
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const openPreview = (index: number) => setPreviewIndex(index);
  const closePreview = () => setPreviewIndex(null);

  const previewImages = task.images;

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (previewIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setPreviewIndex((previewIndex + 1) % previewImages.length);
      else if (e.key === 'ArrowLeft') setPreviewIndex((previewIndex - 1 + previewImages.length) % previewImages.length);
      else if (e.key === 'Escape') closePreview();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [previewIndex, previewImages.length]);

  const handleDownloadAll = async () => {
    if (!task.images.length) return;
    setIsDownloading(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder('images');
      if (!folder) return;

      await Promise.all(
        task.images.map(async (url, i) => {
          try {
            const response = await fetch(url);
            if (!response.ok) return;
            const blob = await response.blob();
            const ext = blob.type.split('/')[1] || 'png';
            folder.file(`image-${i + 1}.${ext}`, blob);
          } catch {
            // skip failed images
          }
        })
      );

      const content = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `images-${task.id || Date.now()}.zip`;
      link.click();
      URL.revokeObjectURL(link.href);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadSingle = (url: string, i: number) => {
    downloadImage(url, `image-${i + 1}.png`);
  };

  const handleNext = () => {
    if (previewIndex !== null) {
      setPreviewIndex((previewIndex + 1) % previewImages.length);
    }
  };

  const handlePrev = () => {
    if (previewIndex !== null) {
      setPreviewIndex((previewIndex - 1 + previewImages.length) % previewImages.length);
    }
  };

  return (
    <>
      <div className={`rounded-xl border p-3 transition-all ${getStatusColor(task.status)}`}>
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            {getStatusIcon(task.status)}
            <span className="text-xs font-medium text-slate-200">
              {getStatusText(task.status)}
            </span>
            {task.status === 'RUNNING' && (
              <div className="flex-1 h-1 bg-blue-500/30 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 animate-pulse" style={{ width: '60%' }} />
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {isActive && (
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <Clock size={12} />
                {formatElapsed(task.elapsedSeconds)}
              </span>
            )}
            {task.coins && (
              <span className="text-xs text-amber-400 flex items-center gap-1">
                <Coins size={12} />
                {task.coins}
              </span>
            )}
            {/* Cancel button */}
            <button
              onClick={onCancel}
              className="w-6 h-6 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors"
              title="取消任务"
            >
              <X size={14} className="text-slate-500" />
            </button>
          </div>
        </div>

        {/* Prompt preview */}
        {task.prompt && (
          <p className="text-xs text-slate-400 line-clamp-2 mb-2">
            {task.prompt}
          </p>
        )}

        {/* Images */}
        {task.status === 'FINISHED' && task.images.length > 0 && (
          <>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {task.images.slice(0, 6).map((img, i) => (
                <div
                  key={i}
                  className="group relative flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-bg-elevated hover:ring-2 hover:ring-primary/50 transition-all cursor-pointer"
                  onClick={() => openPreview(i)}
                >
                  <img
                    src={img}
                    alt={`Result ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                    <ZoomIn size={14} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              ))}
              {task.images.length > 6 && (
                <div className="flex-shrink-0 w-14 h-14 rounded-lg bg-bg-elevated flex items-center justify-center text-xs text-slate-500">
                  +{task.images.length - 6}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="mt-2 flex gap-2">
              <button
                onClick={handleDownloadAll}
                disabled={isDownloading}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-bg-elevated hover:bg-white/10 text-slate-300 text-xs font-medium transition-colors disabled:opacity-50"
              >
                <Download size={13} />
                {isDownloading ? '打包中...' : `下载全部 (${task.images.length})`}
              </button>
              <button
                onClick={onRegenerate}
                className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-xs font-medium transition-colors"
              >
                <RotateCcw size={13} />
                重新生成
              </button>
            </div>
          </>
        )}

        {/* ZIP download fallback - show when finished but no images extracted */}
        {task.status === 'FINISHED' && task.images.length === 0 && task.zipUrl && (
          <div className="mt-2">
            <p className="text-[10px] text-slate-500 mb-1.5">图片解压失败，请直接下载 ZIP 文件</p>
            <div className="flex gap-2">
              <a
                href={task.zipUrl}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-bg-elevated hover:bg-white/10 text-slate-300 text-xs font-medium transition-colors"
              >
                <Download size={13} />
                下载 ZIP 文件
              </a>
              <button
                onClick={onRegenerate}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-xs font-medium transition-colors"
              >
                <RotateCcw size={13} />
                重新生成
              </button>
            </div>
          </div>
        )}

        {/* Regenerate for failed tasks */}
        {task.status === 'FAILED' && (
          <button
            onClick={onRegenerate}
            className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-xs font-medium transition-colors"
          >
            <RotateCcw size={13} />
            重新生成
          </button>
        )}

        {task.status === 'FAILED' && task.error && (
          <p className="text-xs text-red-400 mt-1">{task.error}</p>
        )}

        {task.status === 'QUEUEING' && (
          <p className="text-xs text-slate-500 mt-1">等待 RunningHub 处理...</p>
        )}
      </div>

      {/* Lightbox */}
      {previewIndex !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/95"
          onClick={closePreview}
        >
          {/* Top bar */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 z-10" onClick={(e) => e.stopPropagation()}>
            <span className="text-sm text-slate-400">
              {previewIndex + 1} / {previewImages.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); handleDownloadSingle(previewImages[previewIndex], previewIndex); }}
                className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
              >
                <Download size={18} />
              </button>
              <button
                onClick={closePreview}
                className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Image fills the entire screen */}
          <img
            src={previewImages[previewIndex]}
            alt="Full size"
            className="absolute inset-0 w-full h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />

          {previewImages.length > 1 && (
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
