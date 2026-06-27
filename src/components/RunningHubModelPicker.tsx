import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import {
  CATEGORIES, DB_META,
  filterByKindAndCategory, searchModels,
  getModelInitial, getModelAccent,
  type ModelKind, type RunningHubModelEntry,
} from '../services/runninghubModelsService';
import {
  getModelFavorites, isModelFavorited,
  getModelFavoriteCategories,
  addModelFavoriteNotify as addModelFavorite,
  removeModelFavoriteNotify as removeModelFavorite,
  updateModelFavoriteNotify as updateModelFavorite,
  subscribeModelFavorites,
  type ModelFavorite,
} from '../services/modelFavoritesService';
import {
  setLoraDefault, setCheckpointDefault,
  isLoraDefault, isCheckpointDefault,
  subscribeModelDefaults,
} from '../services/modelDefaultsService';
import { WORKFLOW } from '../services/runninghub';

interface RunningHubModelPickerProps {
  label: string;
  kind: ModelKind;
  value: string;
  onChange: (name: string) => void;
  onSelectWithDefaults?: (entry: RunningHubModelEntry) => void;
  placeholder?: string;
  disabled?: boolean;
  /** 设为默认：lora 槽位 */
  loraSlot?: 'lora1' | 'lora2' | 'lora3';
  /** 设为默认：当前工作流 id（仅 checkpoint） */
  workflowId?: string;
}

const ROW_HEIGHT = 56; // 48 cover + py-2
const BUFFER = 6;

/**
 * RunningHub 模型库选择器（紧凑版 + 虚拟滚动 + 收藏）
 * - 顶部：分类标签条（带数量徽标 + 实时搜索）
 * - 主体：虚拟滚动 — 仅渲染可视区域内的行（5000+ 模型流畅）
 * - 缩略图：CDN thumbnailUrl 懒加载；无 cover 时显示模型首字母 + 稳定色
 * - ⭐ 收藏：右上角心形按钮，弹出对话框可自定义名称 + 归类
 */
export function RunningHubModelPicker({
  label,
  kind,
  value,
  onChange,
  onSelectWithDefaults,
  placeholder = '不使用',
  disabled = false,
  loraSlot,
  workflowId,
}: RunningHubModelPickerProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [failedCovers, setFailedCovers] = useState<Record<string, boolean>>({});
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(256);
  const [allModels, setAllModels] = useState<RunningHubModelEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [favorites, setFavorites] = useState<ModelFavorite[]>([]);
  const [favDialogEntry, setFavDialogEntry] = useState<RunningHubModelEntry | null>(null);
  const [editFavDialog, setEditFavDialog] = useState<ModelFavorite | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [selectedFavCategory, setSelectedFavCategory] = useState('all');
  const [isDefault, setIsDefault] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 计算当前 picker 是否处于"默认"状态（用于 ⭐ 按钮的高亮）
  const recomputeIsDefault = useCallback(() => {
    if (kind === 'lora' && loraSlot) {
      setIsDefault(isLoraDefault(loraSlot, value));
    } else if (kind === 'checkpoint') {
      setIsDefault(isCheckpointDefault(workflowId, value));
    } else {
      setIsDefault(false);
    }
  }, [kind, loraSlot, workflowId, value]);

  useEffect(() => {
    recomputeIsDefault();
  }, [recomputeIsDefault]);

  useEffect(() => {
    const unsub = subscribeModelDefaults(() => recomputeIsDefault());
    return unsub;
  }, [recomputeIsDefault]);

  const handleToggleDefault = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    if (!value) return; // 未选中模型时无意义
    const labelText = selectedMeta?.label || selectedMeta?.name || value;
    if (kind === 'lora' && loraSlot) {
      if (isLoraDefault(loraSlot, value)) {
        setLoraDefault(loraSlot, null);
      } else {
        const w = onSelectWithDefaults ? selectedMeta?.defaultWeight : undefined;
        setLoraDefault(loraSlot, { name: value, label: labelText, weight: w });
      }
    } else if (kind === 'checkpoint') {
      const wf = workflowId || WORKFLOW.THREE_LORA;
      if (isCheckpointDefault(wf, value)) {
        setCheckpointDefault(wf, null);
      } else {
        setCheckpointDefault(wf, { name: value, label: labelText });
      }
    }
    recomputeIsDefault();
  };

  const showDefaultButton = (kind === 'lora' && !!loraSlot) || kind === 'checkpoint';

  // 懒加载数据库（首次展开时）
  useEffect(() => {
    if (!expanded || allModels.length > 0) return;
    let cancelled = false;
    setLoading(true);
    filterByKindAndCategory(kind, 'all').then((list) => {
      if (!cancelled) {
        setAllModels(list);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [expanded, kind, allModels.length]);

  // 收藏列表（每次展开或变动时刷新）
  const refreshFavorites = useCallback(() => {
    setFavorites(getModelFavorites());
  }, []);

  useEffect(() => {
    if (expanded) refreshFavorites();
  }, [expanded, refreshFavorites]);

  // 订阅跨页/跨组件的收藏变更
  useEffect(() => {
    const unsub = subscribeModelFavorites(() => {
      setFavorites(getModelFavorites());
    });
    return unsub;
  }, []);

  // 解析已选中的模型元数据
  const selectedMeta = useMemo(() => {
    if (!value || allModels.length === 0) return null;
    return allModels.find((m) => m.name === value) || null;
  }, [value, allModels]);

  // 分类桶
  const categoryBuckets = useMemo(() => {
    const map: Record<string, RunningHubModelEntry[]> = { all: allModels };
    for (const cat of CATEGORIES) {
      if (cat.id === 'all') continue;
      map[cat.id] = [];
    }
    for (const e of allModels) {
      for (const c of e.category) {
        if (!map[c]) map[c] = [];
        map[c].push(e);
      }
    }
    return map;
  }, [allModels]);

  // 收藏相关的 category
  const favCategories = useMemo(() => getModelFavoriteCategories(), [favorites]);
  const favCategoryCount = useMemo(() => {
    const m: Record<string, number> = { all: favorites.length };
    for (const f of favorites) {
      const k = f.customCategory || '默认';
      m[k] = (m[k] || 0) + 1;
    }
    return m;
  }, [favorites]);

  // 当前显示的模型列表
  const filteredModels = useMemo(() => {
    let base: RunningHubModelEntry[];
    if (showFavoritesOnly) {
      // 收藏视图
      let favList = favorites;
      if (selectedFavCategory !== 'all') {
        favList = favList.filter((f) => f.customCategory === selectedFavCategory);
      }
      if (search) {
        const q = search.toLowerCase();
        favList = favList.filter((f) =>
          f.name.toLowerCase().includes(q) ||
          f.customName.toLowerCase().includes(q) ||
          f.customCategory.toLowerCase().includes(q)
        );
      }
      // 还原成 RunningHubModelEntry（收藏可能包含已删的模型 — fallback 到 snapshot）
      base = favList.map((f) => ({
        name: f.name,
        label: f.customName || f.snapshot.label,
        category: f.snapshot.tags || [],
        defaultWeight: f.snapshot.defaultWeight,
        description: f.snapshot.description || '',
        baseModel: f.snapshot.baseModel,
        tags: f.snapshot.tags,
        triggerWords: f.snapshot.triggerWords,
        cover: f.snapshot.cover,
      }));
    } else {
      base = categoryBuckets[activeCategory] || [];
      if (search) base = searchModels(base, search);
    }
    return base;
  }, [showFavoritesOnly, favorites, selectedFavCategory, search, categoryBuckets, activeCategory]);

  // 虚拟滚动
  const totalRows = filteredModels.length;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
  const endIdx = Math.min(totalRows, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + BUFFER);
  const visibleRows = filteredModels.slice(startIdx, endIdx);
  const totalHeight = totalRows * ROW_HEIGHT;
  const offsetY = startIdx * ROW_HEIGHT;

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded]);

  // 切换分类或搜索时回到顶部
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
      setScrollTop(0);
    }
  }, [activeCategory, selectedFavCategory, search, showFavoritesOnly]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    setExpanded((v) => !v);
  };

  const handlePick = (entry: RunningHubModelEntry) => {
    if (disabled) return;
    onChange(entry.name);
    if (onSelectWithDefaults) onSelectWithDefaults(entry);
    setExpanded(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    onChange('');
  };

  const handleCoverError = (idKey: string) => {
    setFailedCovers((prev) => (prev[idKey] ? prev : { ...prev, [idKey]: true }));
  };

  const handleToggleFavorite = (e: React.MouseEvent, entry: RunningHubModelEntry) => {
    e.stopPropagation();
    if (disabled) return;
    if (isModelFavorited(kind, entry.name)) {
      // 已收藏 — 移除
      removeModelFavorite(kind, entry.name);
      refreshFavorites();
    } else {
      // 未收藏 — 弹出对话框让用户命名 + 归类
      setFavDialogEntry(entry);
    }
  };

  const headerText = selectedMeta?.label || selectedMeta?.name || placeholder;

  return (
    <div className="border border-border rounded-lg bg-white overflow-hidden">
      {/* Header */}
      <div
        onClick={handleToggle}
        className="w-full px-3 py-2 flex items-center justify-between bg-bg-elevated hover:bg-bg-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-[11px] font-medium text-text-tertiary flex-shrink-0">{label}</span>
          <span className={`text-xs font-medium truncate ${value ? 'text-text-primary' : 'text-text-secondary'}`} title={selectedMeta?.name}>
            {headerText}
          </span>
          {value && isModelFavorited(kind, value) && (
            <span className="text-yellow-500 flex-shrink-0" title="已收藏">★</span>
          )}
          {value && isDefault && (
            <span className="text-primary flex-shrink-0" title="已设为默认">📌</span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
          {value && showDefaultButton && (
            <button
              type="button"
              onClick={handleToggleDefault}
              disabled={disabled}
              className={`w-5 h-5 rounded flex items-center justify-center text-[11px] transition-colors ${
                isDefault
                  ? 'bg-primary/10 text-primary hover:bg-primary/20'
                  : 'text-text-tertiary hover:bg-bg-hover hover:text-primary'
              }`}
              title={isDefault ? '取消默认' : '设为默认'}
              aria-label={isDefault ? '取消默认' : '设为默认'}
            >
              📌
            </button>
          )}
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="w-4 h-4 rounded-full flex items-center justify-center text-text-tertiary hover:bg-bg-hover hover:text-text-primary transition-colors"
              aria-label="清除选择"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
              </svg>
            </button>
          )}
          <svg
            className={`w-3.5 h-3.5 text-text-tertiary transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border">
          {/* Search */}
          <div className="px-2 pt-2 pb-1.5">
            <div className="relative">
              <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索模型名 / 标签 / 触发词..."
                className="w-full pl-7 pr-2 py-1 text-[11px] bg-bg-elevated border border-border rounded text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* Tabs row 1: source (库 / 收藏) */}
          <div className="flex gap-1 px-2 pb-1">
            <button
              type="button"
              onClick={() => { setShowFavoritesOnly(false); setActiveCategory('all'); }}
              className={[
                'flex-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors flex items-center justify-center gap-1',
                !showFavoritesOnly ? 'bg-primary text-white' : 'bg-bg-elevated text-text-secondary hover:bg-primary-light hover:text-primary',
              ].join(' ')}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              模型库 · {DB_META.totalCheckpoints + DB_META.totalLoras}
            </button>
            <button
              type="button"
              onClick={() => setShowFavoritesOnly(true)}
              className={[
                'flex-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors flex items-center justify-center gap-1',
                showFavoritesOnly ? 'bg-primary text-white' : 'bg-bg-elevated text-text-secondary hover:bg-primary-light hover:text-primary',
              ].join(' ')}
            >
              <span className="text-yellow-500">★</span>
              我的收藏 · {favorites.length}
            </button>
          </div>

          {/* Favorites quick chips — always visible when not in favorites view */}
          {!showFavoritesOnly && favorites.length > 0 && (
            <div className="px-2 pb-1.5">
              <div className="flex items-center gap-1 overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
                <span className="text-[9px] text-text-tertiary flex-shrink-0">★ 快捷</span>
                {favorites.slice(0, 8).map((f) => {
                  const isSelected = f.name === value;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        const entry: RunningHubModelEntry = {
                          name: f.name,
                          label: f.snapshot.label,
                          category: f.snapshot.tags || [],
                          defaultWeight: f.snapshot.defaultWeight,
                          description: f.snapshot.description || '',
                          baseModel: f.snapshot.baseModel,
                          tags: f.snapshot.tags,
                          triggerWords: f.snapshot.triggerWords,
                          cover: f.snapshot.cover,
                        };
                        handlePick(entry);
                      }}
                      title={`${f.customName}${f.customCategory ? ' · ' + f.customCategory : ''}`}
                      className={[
                        'flex-shrink-0 w-7 h-7 rounded-md overflow-hidden transition-all flex items-center justify-center',
                        isSelected
                          ? 'ring-2 ring-primary scale-110'
                          : 'hover:ring-2 hover:ring-yellow-400 hover:scale-110 ring-1 ring-black/10',
                      ].join(' ')}
                    >
                      {f.snapshot.cover ? (
                        <img src={f.snapshot.cover} alt={f.customName} className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-yellow-300 to-orange-400 flex items-center justify-center text-[10px] text-white font-semibold">
                          {f.customName[0]}
                        </div>
                      )}
                    </button>
                  );
                })}
                {favorites.length > 8 && (
                  <button
                    type="button"
                    onClick={() => setShowFavoritesOnly(true)}
                    className="flex-shrink-0 w-7 h-7 rounded-md bg-bg-elevated text-text-tertiary text-[9px] hover:bg-primary-light hover:text-primary"
                    title="查看全部"
                  >
                    +{favorites.length - 8}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Tabs row 2: category (库或收藏的分类) */}
          <div
            className="flex gap-1 px-2 pb-1.5 overflow-x-auto"
            style={{ scrollbarWidth: 'thin' }}
          >
            {!showFavoritesOnly
              ? CATEGORIES.map((cat) => {
                  const count = categoryBuckets[cat.id]?.length || 0;
                  if (cat.id !== 'all' && count === 0) return null;
                  const active = activeCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setActiveCategory(cat.id)}
                      className={[
                        'flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors flex items-center gap-1',
                        active
                          ? 'bg-primary text-white'
                          : 'bg-bg-elevated text-text-secondary hover:bg-primary-light hover:text-primary',
                      ].join(' ')}
                    >
                      {cat.label}
                      <span className={`text-[9px] tabular-nums ${active ? 'text-white/80' : 'text-text-tertiary'}`}>{count}</span>
                    </button>
                  );
                })
              : favCategories.map((cat) => {
                  const count = favCategoryCount[cat.id] || 0;
                  if (cat.id !== 'all' && count === 0) return null;
                  const active = selectedFavCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedFavCategory(cat.id)}
                      className={[
                        'flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors flex items-center gap-1',
                        active
                          ? 'bg-yellow-500 text-white'
                          : 'bg-bg-elevated text-text-secondary hover:bg-yellow-100 hover:text-yellow-700',
                      ].join(' ')}
                    >
                      {cat.label}
                      <span className={`text-[9px] tabular-nums ${active ? 'text-white/80' : 'text-text-tertiary'}`}>{count}</span>
                    </button>
                  );
                })
            }
          </div>

          {/* Virtual scrolling list */}
          {loading ? (
            <div className="h-64 flex items-center justify-center text-[11px] text-text-tertiary">
              <svg className="animate-spin w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" className="opacity-75" />
              </svg>
              加载模型库…
            </div>
          ) : (
            <div
              ref={containerRef}
              className="overflow-y-auto"
              style={{ height: '320px', scrollbarWidth: 'thin' }}
              onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            >
              {totalRows === 0 ? (
                <div className="py-6 text-center text-[11px] text-text-tertiary">
                  {showFavoritesOnly
                    ? (favorites.length === 0
                        ? '还没有收藏任何模型，点击模型右侧的 ★ 收藏'
                        : '该分类下没有收藏')
                    : (search ? `没有匹配 "${search}" 的模型` : '该分类下暂无模型')}
                </div>
              ) : (
                <div style={{ height: totalHeight, position: 'relative' }}>
                  <div style={{ position: 'absolute', top: offsetY, left: 0, right: 0 }}>
                    {visibleRows.map((entry, idx) => {
                      const realIdx = startIdx + idx;
                      const isSelected = entry.name === value;
                      const idKey = entry.id || entry.name;
                      const showFallback = !entry.cover || failedCovers[idKey];
                      const favorited = isModelFavorited(kind, entry.name);
                      return (
                        <div
                          key={idKey}
                          className={[
                            'group w-full flex items-center gap-2 rounded-md px-1.5 text-left transition-colors cursor-pointer',
                            isSelected
                              ? 'bg-primary text-white'
                              : 'hover:bg-primary-light hover:text-primary',
                          ].join(' ')}
                          style={{ height: ROW_HEIGHT }}
                          onClick={() => handlePick(entry)}
                        >
                          {/* Cover thumbnail */}
                          <div className="relative w-12 h-12 flex-shrink-0 rounded-md overflow-hidden bg-bg-elevated ring-1 ring-black/5">
                            {showFallback ? (
                              <FallbackCover name={entry.name} />
                            ) : (
                              <img
                                src={entry.cover}
                                alt={entry.label}
                                loading="lazy"
                                onError={() => handleCoverError(idKey)}
                                className="w-full h-full object-cover"
                              />
                            )}
                            {isSelected && (
                              <div className="absolute inset-0 flex items-center justify-center bg-primary/80">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-white">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12l5 5L20 7" />
                                </svg>
                              </div>
                            )}
                          </div>
                          {/* Model name + meta */}
                          <div className="flex-1 min-w-0 flex flex-col gap-0.5 overflow-hidden">
                            <div className="flex items-baseline gap-1.5 overflow-hidden">
                              <span className={`text-[12px] truncate ${isSelected ? 'text-white font-medium' : 'text-text-primary font-medium'}`} title={entry.name}>
                                {showFavoritesOnly && favorites.find(f => f.name === entry.name)?.customName
                                  ? favorites.find(f => f.name === entry.name)!.customName
                                  : entry.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 overflow-hidden">
                              {entry.triggerWords ? (
                                <span className={`text-[10px] truncate ${isSelected ? 'text-white/80' : 'text-primary'}`} title={entry.triggerWords}>
                                  ✦ {entry.triggerWords}
                                </span>
                              ) : (
                                <span className={`text-[10px] truncate ${isSelected ? 'text-white/70' : 'text-text-tertiary'}`} title={entry.label}>
                                  {entry.label}
                                </span>
                              )}
                              {entry.tags?.slice(0, 2).map((t) => (
                                <span
                                  key={t}
                                  className={`text-[9px] px-1 rounded flex-shrink-0 ${isSelected ? 'bg-white/20 text-white' : 'bg-bg-elevated text-text-tertiary'}`}
                                >
                                  {t}
                                </span>
                              ))}
                            </div>
                          </div>
                          {/* Weight hint */}
                          <span className={`text-[10px] flex-shrink-0 tabular-nums ${isSelected ? 'text-white/80' : 'text-text-tertiary'}`}>
                            ×{entry.defaultWeight.toFixed(2)}
                          </span>
                          {/* Favorite button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (showFavoritesOnly && favorited) {
                                // 收藏视图 → 点击星 → 打开编辑对话框
                                const fav = favorites.find((f) => f.name === entry.name);
                                if (fav) setEditFavDialog(fav);
                              } else {
                                handleToggleFavorite(e, entry);
                              }
                            }}
                            className={[
                              'w-7 h-7 rounded flex-shrink-0 flex items-center justify-center text-base transition-all',
                              favorited
                                ? 'text-yellow-500 hover:bg-yellow-100'
                                : 'text-text-tertiary opacity-0 group-hover:opacity-100 hover:bg-bg-elevated',
                              isSelected && !favorited ? 'opacity-100 text-white/70 hover:bg-white/10' : '',
                            ].join(' ')}
                            title={favorited ? (showFavoritesOnly ? '编辑收藏' : '取消收藏') : '收藏到我的'}
                          >
                            {favorited ? '★' : '☆'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Footer meta */}
          <div className="px-2 py-1 border-t border-border/50 text-[9px] text-text-tertiary flex items-center justify-between">
            <span>
              {showFavoritesOnly
                ? `收藏 ${favorites.length} 项${search ? ` · 匹配 ${totalRows}` : ''}`
                : `共 ${DB_META.totalCheckpoints + DB_META.totalLoras} · ${kind === 'checkpoint' ? `CK ${DB_META.totalCheckpoints}` : `LoRA ${DB_META.totalLoras}`} · ${DB_META.baseModelFilter}${search ? ` · 匹配 ${totalRows}` : ''}`}
            </span>
            <a href={DB_META.source} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">
              来源
            </a>
          </div>
        </div>
      )}

      {/* 添加收藏对话框 */}
      {favDialogEntry && (
        <FavoriteDialog
          entry={favDialogEntry}
          kind={kind}
          existingCategories={Array.from(new Set(favorites.map((f) => f.customCategory || '默认')))}
          onClose={() => setFavDialogEntry(null)}
          onSave={(name, cat) => {
            addModelFavorite(favDialogEntry, kind, cat);
            refreshFavorites();
            setFavDialogEntry(null);
          }}
        />
      )}

      {/* 编辑收藏对话框 */}
      {editFavDialog && (
        <FavoriteEditDialog
          favorite={editFavDialog}
          existingCategories={Array.from(new Set(favorites.map((f) => f.customCategory || '默认')))}
          onClose={() => setEditFavDialog(null)}
          onSave={(name, cat) => {
            updateModelFavorite(editFavDialog.id, { customName: name, customCategory: cat });
            refreshFavorites();
            setEditFavDialog(null);
          }}
          onDelete={() => {
            removeModelFavorite(kind, editFavDialog.name);
            refreshFavorites();
            setEditFavDialog(null);
          }}
        />
      )}
    </div>
  );
}

function FallbackCover({ name }: { name: string }) {
  const initial = getModelInitial(name);
  const accent = getModelAccent(name);
  return (
    <div
      className="absolute inset-0 flex items-center justify-center text-white text-base font-semibold"
      style={{ background: `linear-gradient(135deg, ${accent.from}, ${accent.to})` }}
    >
      {initial}
    </div>
  );
}

interface FavoriteDialogProps {
  entry: RunningHubModelEntry;
  kind: ModelKind;
  existingCategories: string[];
  onClose: () => void;
  onSave: (customName: string, customCategory: string) => void;
}

function FavoriteDialog({ entry, kind, existingCategories, onClose, onSave }: FavoriteDialogProps) {
  const [customName, setCustomName] = useState(entry.label || entry.name.replace(/\.safetensors$/i, ''));
  const [customCategory, setCustomCategory] = useState(existingCategories[0] || '默认');
  const [newCategory, setNewCategory] = useState('');
  const [useNew, setUseNew] = useState(existingCategories.length === 0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  const finalCategory = useNew && newCategory.trim() ? newCategory.trim() : customCategory;
  const canSave = customName.trim().length > 0 && finalCategory.length > 0;

  return (
    <Modal onClose={onClose} title="收藏模型">
      <div className="flex gap-3">
        {/* Cover */}
        <div className="relative w-20 h-20 flex-shrink-0 rounded-md overflow-hidden bg-bg-elevated ring-1 ring-black/5">
          {entry.cover ? (
            <img src={entry.cover} alt={entry.label} className="w-full h-full object-cover" />
          ) : (
            <FallbackCover name={entry.name} />
          )}
        </div>
        {/* Info */}
        <div className="flex-1 min-w-0 flex flex-col gap-0.5 text-[11px] text-text-tertiary">
          <div className="text-text-primary font-medium truncate" title={entry.name}>{entry.name}</div>
          <div className="truncate">{entry.label}</div>
          {entry.triggerWords && <div className="text-primary truncate">✦ {entry.triggerWords}</div>}
          <div className="flex gap-1 mt-1 flex-wrap">
            {(entry.tags || []).slice(0, 3).map((t) => (
              <span key={t} className="text-[9px] px-1 rounded bg-bg-elevated">{t}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <label className="text-[11px] text-text-secondary block mb-1">自定义名称</label>
          <input
            ref={inputRef}
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="方便记忆的名字"
            className="w-full px-2 py-1.5 text-xs bg-bg-elevated border border-border rounded text-text-primary focus:outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="text-[11px] text-text-secondary block mb-1">收藏分类</label>
          {existingCategories.length > 0 && !useNew && (
            <div className="flex gap-1 flex-wrap mb-1.5">
              {existingCategories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCustomCategory(c)}
                  className={[
                    'px-2 py-0.5 text-[10px] rounded-full transition-colors',
                    customCategory === c ? 'bg-primary text-white' : 'bg-bg-elevated text-text-secondary hover:bg-primary-light',
                  ].join(' ')}
                >
                  {c}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setUseNew(true)}
                className="px-2 py-0.5 text-[10px] rounded-full bg-bg-elevated text-text-tertiary hover:bg-primary-light"
              >
                + 新分类
              </button>
            </div>
          )}
          {useNew && (
            <div className="flex gap-1">
              <input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="新分类名，如：摄影/角色/风格化..."
                className="flex-1 px-2 py-1.5 text-xs bg-bg-elevated border border-border rounded text-text-primary focus:outline-none focus:border-primary"
                autoFocus
              />
              {existingCategories.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setUseNew(false); setNewCategory(''); }}
                  className="px-2 py-1 text-[10px] text-text-tertiary hover:text-text-primary"
                >
                  取消
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => onSave(customName.trim(), finalCategory)}
          disabled={!canSave}
          className="px-3 py-1.5 text-xs bg-primary text-white rounded hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
        >
          <span>★</span>
          收藏
        </button>
      </div>
    </Modal>
  );
}

interface FavoriteEditDialogProps {
  favorite: ModelFavorite;
  existingCategories: string[];
  onClose: () => void;
  onSave: (customName: string, customCategory: string) => void;
  onDelete: () => void;
}

function FavoriteEditDialog({ favorite, existingCategories, onClose, onSave, onDelete }: FavoriteEditDialogProps) {
  const [customName, setCustomName] = useState(favorite.customName);
  const [customCategory, setCustomCategory] = useState(favorite.customCategory || '默认');
  const [newCategory, setNewCategory] = useState('');
  const [useNew, setUseNew] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  const finalCategory = useNew && newCategory.trim() ? newCategory.trim() : customCategory;
  const canSave = customName.trim().length > 0 && finalCategory.length > 0;

  return (
    <Modal onClose={onClose} title="编辑收藏">
      <div className="flex gap-3">
        <div className="relative w-20 h-20 flex-shrink-0 rounded-md overflow-hidden bg-bg-elevated ring-1 ring-black/5">
          {favorite.snapshot.cover ? (
            <img src={favorite.snapshot.cover} alt={favorite.customName} className="w-full h-full object-cover" />
          ) : (
            <FallbackCover name={favorite.name} />
          )}
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-0.5 text-[11px] text-text-tertiary">
          <div className="text-text-primary font-medium truncate" title={favorite.name}>{favorite.name}</div>
          {favorite.snapshot.triggerWords && (
            <div className="text-primary truncate">✦ {favorite.snapshot.triggerWords}</div>
          )}
          <div className="flex gap-1 mt-1 flex-wrap">
            {(favorite.snapshot.tags || []).slice(0, 3).map((t) => (
              <span key={t} className="text-[9px] px-1 rounded bg-bg-elevated">{t}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <label className="text-[11px] text-text-secondary block mb-1">自定义名称</label>
          <input
            ref={inputRef}
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            className="w-full px-2 py-1.5 text-xs bg-bg-elevated border border-border rounded text-text-primary focus:outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="text-[11px] text-text-secondary block mb-1">收藏分类</label>
          <div className="flex gap-1 flex-wrap mb-1.5">
            {existingCategories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => { setCustomCategory(c); setUseNew(false); }}
                className={[
                  'px-2 py-0.5 text-[10px] rounded-full transition-colors',
                  !useNew && customCategory === c ? 'bg-primary text-white' : 'bg-bg-elevated text-text-secondary hover:bg-primary-light',
                ].join(' ')}
              >
                {c}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setUseNew(true)}
              className={[
                'px-2 py-0.5 text-[10px] rounded-full transition-colors',
                useNew ? 'bg-primary text-white' : 'bg-bg-elevated text-text-tertiary hover:bg-primary-light',
              ].join(' ')}
            >
              + 新分类
            </button>
          </div>
          {useNew && (
            <input
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="新分类名"
              className="w-full px-2 py-1.5 text-xs bg-bg-elevated border border-border rounded text-text-primary focus:outline-none focus:border-primary"
              autoFocus
            />
          )}
        </div>
      </div>

      <div className="mt-5 flex justify-between gap-2">
        <button
          type="button"
          onClick={onDelete}
          className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded transition-colors"
        >
          删除收藏
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onSave(customName.trim(), finalCategory)}
            disabled={!canSave}
            className="px-3 py-1.5 text-xs bg-primary text-white rounded hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            保存
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-[420px] max-w-[90vw] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
            <span className="text-yellow-500">★</span>
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 rounded-full flex items-center justify-center text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
            aria-label="关闭"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}