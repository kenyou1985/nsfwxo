import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Trash2, Image as ImageIcon, Clock, X, RotateCcw, Loader2, Video } from 'lucide-react';
import { getRecords, deleteRecord, clearAllHistory, type HistoryRecord } from '../services/historyService';
import { getCachedImages } from '../services/imageCacheService';
import { extractImagesFromZipAsDataUrls } from '../services/runninghub';

function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

interface VideoHistoryRecord {
  id: string;
  prompt: string;
  images: string[];
  coins: string | null;
  taskId: string | null;
  createdAt: number;
}

interface HistoryPageProps {
  onRegenerate?: (record: HistoryRecord) => void;
}

export function HistoryPage({ onRegenerate }: HistoryPageProps) {
  const [activeTab, setActiveTab] = useState<'image' | 'video'>('image');
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [videoRecords, setVideoRecords] = useState<VideoHistoryRecord[]>([]);
  const [loadedImages, setLoadedImages] = useState<Record<string, string[]>>({});
  const loadingKeysRef = useRef<Set<string>>(new Set());

  const [lightboxRecordIndex, setLightboxRecordIndex] = useState<number | null>(null);
  const [lightboxImageIndex, setLightboxImageIndex] = useState<number>(0);

  const loadImagesForRecord = useCallback(async (record: HistoryRecord) => {
    if (!record.zipUrl) return;
    if (loadedImages[record.id]) return;
    if (loadingKeysRef.current.has(record.id)) return;

    loadingKeysRef.current.add(record.id);
    setLoadedImages((prev) => ({ ...prev, [record.id]: [] }));

    try {
      const cached = await getCachedImages(record.zipUrl, 10);
      const cachedImages = cached.filter((url) => url);
      if (cachedImages.length > 0) {
        setLoadedImages((prev) => ({ ...prev, [record.id]: cachedImages }));
      } else {
        const dataUrls = await extractImagesFromZipAsDataUrls(record.zipUrl);
        setLoadedImages((prev) => ({ ...prev, [record.id]: dataUrls }));
      }
    } catch {
      setLoadedImages((prev) => ({ ...prev, [record.id]: [] }));
    } finally {
      loadingKeysRef.current.delete(record.id);
    }
  }, [loadedImages]);

  const loadVideoHistory = useCallback(() => {
    try {
      const videoRecs = JSON.parse(localStorage.getItem('nsfwxo_video_history') || '[]');
      setVideoRecords(videoRecs);
    } catch {
      setVideoRecords([]);
    }
  }, []);

  useEffect(() => {
    const recs = getRecords();
    setRecords(recs);
    recs.forEach((record) => {
      loadImagesForRecord(record);
    });
    loadVideoHistory();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshRecords = useCallback(() => {
    const recs = getRecords();
    setRecords(recs);
    recs.forEach((record) => {
      loadImagesForRecord(record);
    });
    loadVideoHistory();
  }, [loadImagesForRecord, loadVideoHistory]);

  const handleDelete = useCallback((id: string) => {
    deleteRecord(id);
    refreshRecords();
  }, [refreshRecords]);

  const handleDeleteVideo = useCallback((id: string) => {
    try {
      const videoRecs = JSON.parse(localStorage.getItem('nsfwxo_video_history') || '[]');
      const filtered = videoRecs.filter((r: VideoHistoryRecord) => r.id !== id);
      localStorage.setItem('nsfwxo_video_history', JSON.stringify(filtered));
      setVideoRecords(filtered);
    } catch {
      // ignore
    }
  }, []);

  const handleClearAll = useCallback(() => {
    if (confirm('确定清除所有历史记录？')) {
      clearAllHistory();
      setRecords([]);
      setLoadedImages({});
      loadingKeysRef.current.clear();
      localStorage.removeItem('nsfwxo_video_history');
      setVideoRecords([]);
    }
  }, []);

  const openLightbox = (recordIndex: number, imageIndex: number) => {
    setLightboxRecordIndex(recordIndex);
    setLightboxImageIndex(imageIndex);
  };

  const closeLightbox = () => {
    setLightboxRecordIndex(null);
    setLightboxImageIndex(0);
  };

  const getRecordImages = (record: HistoryRecord): string[] => {
    return loadedImages[record.id] || [];
  };

  const handleDownload = (url: string, isVideo = false) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = isVideo ? `video-${Date.now()}.mp4` : `generated-${Date.now()}.png`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.click();
  };

  const handleRegenerate = (record: HistoryRecord) => {
    onRegenerate?.(record);
  };

  // Image history
  const currentImages = lightboxRecordIndex !== null && activeTab === 'image'
    ? getRecordImages(records[lightboxRecordIndex])
    : [];
  const currentUrl = currentImages[lightboxImageIndex] || '';

  const globalIndex = lightboxRecordIndex !== null && activeTab === 'image'
    ? records.slice(0, lightboxRecordIndex).reduce(
        (sum, r) => sum + getRecordImages(r).length, 0
      ) + lightboxImageIndex + 1
    : 0;

  const globalTotal = activeTab === 'image'
    ? records.reduce((sum, r) => sum + getRecordImages(r).length, 0)
    : videoRecords.reduce((sum, r) => sum + (r.images?.length || 0), 0);

  const hasAnyRecords = records.length > 0 || videoRecords.length > 0;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Tab switcher */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-bg-elevated rounded-lg p-1">
          <button
            onClick={() => setActiveTab('image')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'image'
                ? 'bg-primary text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ImageIcon size={14} />
            图片历史 ({records.length})
          </button>
          <button
            onClick={() => setActiveTab('video')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'video'
                ? 'bg-primary text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Video size={14} />
            视频历史 ({videoRecords.length})
          </button>
        </div>
        {hasAnyRecords && (
          <button
            onClick={handleClearAll}
            className="text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            清除全部
          </button>
        )}
      </div>

      {/* Empty state */}
      {!hasAnyRecords && (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
          <ImageIcon size={48} className="mb-4 opacity-30" />
          <p className="text-sm">暂无历史记录</p>
        </div>
      )}

      {/* Image history */}
      {activeTab === 'image' && records.length > 0 && (
        <div className="space-y-3">
          {records.map((record, recordIndex) => {
            const images = getRecordImages(record);
            const isLoading = loadedImages[record.id] === undefined && !!record.zipUrl;
            return (
              <div
                key={record.id}
                className="rounded-xl bg-bg-surface border border-border p-4"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary text-[10px]">
                        {record.workflowType === 'txt2img' ? '文生图' : '图生图'}
                      </span>
                      <span className="text-xs text-slate-500 flex items-center gap-1">
                        <Clock size={11} />
                        {formatDate(record.createdAt)}
                      </span>
                    </div>
                    {record.prompt && (
                      <p className="text-sm text-slate-300 line-clamp-2 mt-1">
                        {record.prompt}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleRegenerate(record)}
                      className="w-7 h-7 rounded-lg hover:bg-primary/20 flex items-center justify-center text-slate-500 hover:text-primary transition-colors"
                      title="重新生成"
                    >
                      <RotateCcw size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(record.id)}
                      className="w-7 h-7 rounded-lg hover:bg-red-500/20 flex items-center justify-center text-slate-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {isLoading ? (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    <div className="flex-shrink-0 w-16 h-16 rounded-lg bg-bg-elevated flex items-center justify-center">
                      <Loader2 size={16} className="text-slate-500 animate-spin" />
                    </div>
                  </div>
                ) : images.length > 0 ? (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {images.map((url, imgIndex) => (
                      <div
                        key={imgIndex}
                        className="relative flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-bg-elevated cursor-pointer group"
                        onClick={() => openLightbox(recordIndex, imgIndex)}
                      >
                        <img
                          src={url}
                          alt={`图片 ${imgIndex + 1}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                          <ImageIcon size={14} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
                  <span className="text-xs text-slate-500">
                    {images.length > 0 ? `${images.length} 张图片` : '暂无图片'}
                    {record.coins && ` · ${record.coins} RH币`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Video history */}
      {activeTab === 'video' && videoRecords.length > 0 && (
        <div className="space-y-3">
          {videoRecords.map((record) => (
            <div
              key={record.id}
              className="rounded-xl bg-bg-surface border border-border p-4"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 text-[10px]">
                      图生视频
                    </span>
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                      <Clock size={11} />
                      {formatDate(record.createdAt)}
                    </span>
                  </div>
                  {record.prompt && (
                    <p className="text-sm text-slate-300 line-clamp-2 mt-1">
                      {record.prompt}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleDeleteVideo(record.id)}
                  className="w-7 h-7 rounded-lg hover:bg-red-500/20 flex items-center justify-center text-slate-500 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {/* Image previews */}
              {record.images && record.images.length > 0 && (
                <div className="mb-3">
                  <div className="w-full rounded-lg overflow-hidden bg-bg-elevated">
                    <img
                      src={record.images[0]}
                      alt="Generated"
                      className="w-full object-contain max-h-[240px] mx-auto"
                      style={{ maxHeight: '240px' }}
                    />
                  </div>
                  {record.images.length > 1 && (
                    <div className="flex gap-1.5 mt-1.5 overflow-x-auto">
                      {record.images.slice(1, 5).map((url, imgIndex) => (
                        <div
                          key={imgIndex}
                          className="relative flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-bg-elevated"
                        >
                          <img
                            src={url}
                            alt={`预览 ${imgIndex + 2}`}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
                <span className="text-xs text-slate-500">
                  {record.images.length} 张图片
                  {record.coins && ` · ${record.coins} RH币`}
                </span>
                {record.images[0] && (
                  <a
                    href={record.images[0]}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:text-primary/80 transition-colors flex items-center gap-1"
                  >
                    <ImageIcon size={12} />
                    下载图片
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox for images */}
      {activeTab === 'image' && lightboxRecordIndex !== null && currentUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/95"
          onClick={closeLightbox}
        >
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 z-10" onClick={(e) => e.stopPropagation()}>
            <span className="text-sm text-slate-400">
              {globalIndex} / {globalTotal}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); handleDownload(currentUrl); }}
                className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
              >
                <ImageIcon size={18} />
              </button>
              <button
                onClick={closeLightbox}
                className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <img
            src={currentUrl}
            alt="Preview"
            className="absolute inset-0 w-full h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />

          {(lightboxRecordIndex > 0 || lightboxImageIndex > 0) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (lightboxImageIndex > 0) {
                  setLightboxImageIndex(lightboxImageIndex - 1);
                } else if (lightboxRecordIndex > 0) {
                  setLightboxRecordIndex(lightboxRecordIndex - 1);
                  const prevImages = getRecordImages(records[lightboxRecordIndex - 1]);
                  setLightboxImageIndex(prevImages.length - 1);
                }
              }}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-black/40 flex items-center justify-center text-white hover:bg-black/60 transition-colors text-2xl z-10"
            >
              ‹
            </button>
          )}
          {globalIndex < globalTotal && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const currentImagesList = getRecordImages(records[lightboxRecordIndex]);
                if (lightboxImageIndex < currentImagesList.length - 1) {
                  setLightboxImageIndex(lightboxImageIndex + 1);
                } else if (lightboxRecordIndex < records.length - 1) {
                  setLightboxRecordIndex(lightboxRecordIndex + 1);
                  setLightboxImageIndex(0);
                }
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-black/40 flex items-center justify-center text-white hover:bg-black/60 transition-colors text-2xl z-10"
            >
              ›
            </button>
          )}
        </div>
      )}
    </div>
  );
}
