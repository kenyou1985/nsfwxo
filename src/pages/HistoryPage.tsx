import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Trash2, Image as ImageIcon, Clock, X, RotateCcw, Loader2, Video, Heart, Download, AlertTriangle, HardDrive } from 'lucide-react';
import { getRecords, deleteRecord, clearAllHistory, type HistoryRecord } from '../services/historyService';
import { loadCachedOrExtractedImages } from '../services/imageCacheService';
import { extractImagesFromZipAsDataUrls } from '../services/runninghub';
import { getFavorites, addFavorite, removeFavorite, clearFavorites, type FavoriteItem } from '../services/storage';
import { getStorageStats, getLocalStorageStats, getUnifiedCacheStats } from '../services/storageQuota';

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
  onSuccess?: (msg: string) => void;
  onError?: (msg: string) => void;
}

export function HistoryPage({ onRegenerate, onSuccess, onError }: HistoryPageProps) {
  const [activeTab, setActiveTab] = useState<'image' | 'video' | 'favorites'>('image');
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [videoRecords, setVideoRecords] = useState<VideoHistoryRecord[]>([]);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [loadedImages, setLoadedImages] = useState<Record<string, string[]>>({});
  const loadedImagesRef = useRef<Record<string, string[]>>({});
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const loadingKeysRef = useRef<Set<string>>(new Set());

  const [lightboxRecordIndex, setLightboxRecordIndex] = useState<number | null>(null);
  const [lightboxImageIndex, setLightboxImageIndex] = useState<number>(0);
  const [lightboxFavoriteIndex, setLightboxFavoriteIndex] = useState<number | null>(null);

  const [storageStats, setStorageStats] = useState<{
    localStorageMB: number; cacheMB: number; itemCount: number;
  } | null>(null);

  // Load storage stats — always active since the bar is visible for all tabs
  useEffect(() => {
    getStorageStats().then((stats) => {
      const MB = 1024 * 1024;
      setStorageStats({
        localStorageMB: Math.round(stats.localStorageBytes / MB * 10) / 10,
        cacheMB: Math.round(stats.cacheBytes / MB * 10) / 10,
        itemCount: Math.round((stats.localStorageBytes + stats.cacheBytes) / MB),
      });
    });
  }, []);

  const loadImagesForRecord = useCallback(async (record: HistoryRecord) => {
    if (!record.zipUrl) return;
    // Don't retry records we've already finished — either successfully or
    // unsuccessfully. Re-trying a 404 zip URL every render floods the console.
    if (loadedImagesRef.current[record.id] !== undefined) return;
    if (loadingKeysRef.current.has(record.id)) return;

    loadingKeysRef.current.add(record.id);
    setLoadingKeys((prev) => new Set(prev).add(record.id));
    loadedImagesRef.current[record.id] = [];
    setLoadedImages((prev) => ({ ...prev, [record.id]: [] }));

    try {
      const dataUrls = await loadCachedOrExtractedImages(record.zipUrl, () => extractImagesFromZipAsDataUrls(record.zipUrl ?? ''));
      loadedImagesRef.current[record.id] = dataUrls;
      setLoadedImages((prev) => ({ ...prev, [record.id]: dataUrls }));
    } catch (err) {
      // Don't re-attempt this record on later renders. The zip URL may be
      // permanently gone (e.g. RunningHub evicted the file), and we'd
      // otherwise re-fetch and re-log the 404 on every render.
      loadedImagesRef.current[record.id] = [];
      setLoadedImages((prev) => ({ ...prev, [record.id]: [] }));
    } finally {
      loadingKeysRef.current.delete(record.id);
      setLoadingKeys((prev) => {
        const next = new Set(prev);
        next.delete(record.id);
        return next;
      });
    }
  }, []); // Intentionally empty deps — refs track current state without re-creating this callback

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
    setFavorites(getFavorites());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load images for any new records added after mount
  useEffect(() => {
    records.forEach((record) => {
      loadImagesForRecord(record);
    });
  }, [records, loadImagesForRecord]);

  const refreshRecords = useCallback(() => {
    const recs = getRecords();
    setRecords(recs);
    loadVideoHistory();
  }, []);

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
      setLoadingKeys(new Set());
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
    setLightboxFavoriteIndex(null);
  };

  const getRecordImages = (record: HistoryRecord): string[] => {
    const loaded = loadedImages[record.id];
    if (loaded && loaded.length > 0) return loaded;
    // Fallback to images stored directly in the record (data URLs already extracted)
    return record.images || [];
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

  const handleToggleFavorite = (imageUrl: string, prompt?: string) => {
    // Use imageRef for lookup since addFavorite stores the URL in imageRef field
    const existing = favorites.find((f) => f.imageRef === imageUrl);
    if (existing) {
      removeFavorite(existing.id);
      setFavorites(getFavorites());
      onSuccess?.('已取消收藏');
    } else {
      const added = addFavorite({ imageUrl, prompt, source: 'history', r18: false });
      if (!added) {
        onError?.('收藏失败，请重试');
        return;
      }
      setFavorites(getFavorites());
      onSuccess?.('已收藏');
    }
  };

  const handleClearFavorites = () => {
    if (confirm('确定清除所有收藏？')) {
      clearFavorites();
      setFavorites([]);
    }
  };

  // Use imageRef for lookup since addFavorite stores the URL in imageRef field
  const isFav = (url: string) => favorites.some((f) => f.imageRef === url);

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
                : 'text-text-secondary hover:text-text-primary'
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
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <Video size={14} />
            视频历史 ({videoRecords.length})
          </button>
          <button
            onClick={() => setActiveTab('favorites')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'favorites'
                ? 'bg-primary text-white'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <Heart size={14} />
            收藏 ({favorites.length})
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

      {/* Storage stats bar — always visible in history page */}
      {storageStats && (
        <div className="mb-2 rounded-lg px-3 py-2 text-xs flex items-center gap-3 bg-gray-50 border border-gray-200 text-text-secondary">
          <HardDrive size={12} className="flex-shrink-0" />
          <span>本地存储</span>
          <span className="font-medium whitespace-nowrap">
            {storageStats.localStorageMB} MB
          </span>
          <span className="text-gray-300">|</span>
          <span>图片缓存</span>
          <span className="font-medium whitespace-nowrap">
            {storageStats.cacheMB} MB
          </span>
        </div>
      )}

      {/* Empty state */}
      {!hasAnyRecords && (
        <div className="flex flex-col items-center justify-center py-20 text-text-secondary">
          <ImageIcon size={48} className="mb-4 opacity-30" />
          <p className="text-sm">暂无历史记录</p>
        </div>
      )}

      {/* Image history */}
      {activeTab === 'image' && records.length > 0 && (
        <div className="space-y-3">
          {records.map((record, recordIndex) => {
            const images = getRecordImages(record);
            const isLoading = loadingKeys.has(record.id);
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
                      <span className="text-xs text-text-secondary flex items-center gap-1">
                        <Clock size={11} />
                        {formatDate(record.createdAt)}
                      </span>
                    </div>
                    {record.prompt && (
                      <p className="text-sm text-text-primary line-clamp-2 mt-1">
                        {record.prompt}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleRegenerate(record)}
                      className="w-7 h-7 rounded-lg hover:bg-primary/20 flex items-center justify-center text-text-secondary hover:text-primary transition-colors"
                      title="重新生成"
                    >
                      <RotateCcw size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(record.id)}
                      className="w-7 h-7 rounded-lg hover:bg-red-500/20 flex items-center justify-center text-text-secondary hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {isLoading ? (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    <div className="flex-shrink-0 w-16 h-16 rounded-lg bg-bg-elevated flex items-center justify-center">
                      <Loader2 size={16} className="text-text-secondary animate-spin" />
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
                        <button
                          onClick={(e) => { e.stopPropagation(); handleToggleFavorite(url, record.prompt); }}
                          className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/50 flex items-center justify-center transition-opacity hover:bg-black/70"
                          style={{ opacity: isFav(url) ? 1 : undefined }}
                        >
                          <Heart size={11} className={isFav(url) ? 'fill-red-500 text-red-500' : 'text-white opacity-0 group-hover:opacity-100 transition-opacity'} />
                        </button>
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                          <ImageIcon size={14} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
                  <span className="text-xs text-text-secondary">
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
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-500 text-[10px]">
                      图生视频
                    </span>
                    <span className="text-xs text-text-secondary flex items-center gap-1">
                      <Clock size={11} />
                      {formatDate(record.createdAt)}
                    </span>
                  </div>
                  {record.prompt && (
                    <p className="text-sm text-text-primary line-clamp-2 mt-1">
                      {record.prompt}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleDeleteVideo(record.id)}
                  className="w-7 h-7 rounded-lg hover:bg-red-500/20 flex items-center justify-center text-text-secondary hover:text-red-400 transition-colors"
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
                <span className="text-xs text-text-secondary">
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

      {/* Favorites tab */}
      {activeTab === 'favorites' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">{favorites.length} 张收藏</span>
            {favorites.length > 0 && (
              <button
                onClick={handleClearFavorites}
                className="text-xs text-red-400 hover:text-red-300 transition-colors flex items-center gap-1"
              >
                <Trash2 size={12} />
                清空全部
              </button>
            )}
          </div>

          {favorites.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-text-secondary">
              <Heart size={48} className="mb-4 opacity-30" />
              <p className="text-sm">暂无收藏</p>
              <p className="text-xs text-text-tertiary mt-1">在图片历史中点击红心按钮添加收藏</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {favorites.map((item) => (
                <div
                  key={item.id}
                  className="relative aspect-square rounded-lg overflow-hidden bg-bg-elevated group cursor-pointer"
                  onClick={() => setLightboxFavoriteIndex(item.id === favorites[0]?.id ? 0 : favorites.findIndex((f) => f.id === item.id))}
                >
                  <img
                    src={item.imageUrl}
                    alt="收藏"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); handleToggleFavorite(item.imageUrl ?? ""); }}
                    className="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 transition-colors"
                  >
                    <Heart size={14} className="fill-red-500 text-red-500" />
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                    {item.prompt && (
                      <p className="text-[10px] text-white/80 line-clamp-1">{item.prompt}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Lightbox for images */}
      {activeTab === 'image' && lightboxRecordIndex !== null && currentUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/95"
          onClick={closeLightbox}
        >
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 z-10" onClick={(e) => e.stopPropagation()}>
            <span className="text-sm text-text-secondary">
              {globalIndex} / {globalTotal}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); handleToggleFavorite(currentUrl, records[lightboxRecordIndex]?.prompt); }}
                className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
              >
                <Heart size={18} className={isFav(currentUrl) ? 'fill-red-500 text-red-500' : 'text-white'} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleDownload(currentUrl); }}
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

      {/* Lightbox for favorites */}
      {activeTab === 'favorites' && lightboxFavoriteIndex !== null && favorites[lightboxFavoriteIndex] && (
        <div
          className="fixed inset-0 z-50 bg-black/95"
          onClick={closeLightbox}
        >
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 z-10" onClick={(e) => e.stopPropagation()}>
            <span className="text-sm text-text-secondary">
              {lightboxFavoriteIndex + 1} / {favorites.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); handleToggleFavorite(favorites[lightboxFavoriteIndex].imageUrl ?? ""); }}
                className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
              >
                <Heart size={18} className={isFav(favorites[lightboxFavoriteIndex].imageUrl ?? "") ? 'fill-red-500 text-red-500' : 'text-white'} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleDownload(favorites[lightboxFavoriteIndex].imageUrl ?? ""); }}
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

          <img
            src={favorites[lightboxFavoriteIndex].imageUrl}
            alt="Preview"
            className="absolute inset-0 w-full h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />

          {lightboxFavoriteIndex > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxFavoriteIndex(lightboxFavoriteIndex - 1); }}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-black/40 flex items-center justify-center text-white hover:bg-black/60 transition-colors text-2xl z-10"
            >
              ‹
            </button>
          )}
          {lightboxFavoriteIndex < favorites.length - 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxFavoriteIndex(lightboxFavoriteIndex + 1); }}
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
