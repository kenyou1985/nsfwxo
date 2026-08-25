import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search, Star, X, Loader2, Heart, Send, ChevronDown,
  Filter, Trash2, Pencil, Check, Library, SlidersHorizontal,
  Info, Layers, Calendar, User, Tag, Zap, ChevronRight,
} from 'lucide-react';
import {
  type RunningHubModelEntry, type ModelKind, type BaseModelFilter, type SortField,
  getAllModels, searchModels, getModelAccent, getModelInitial,
  filterByKindAndCategory, sortModels, formatDate,
  CATEGORIES, BASE_MODEL_OPTIONS, SORT_OPTIONS,
  MODEL_KIND_META,
} from '../services/runninghubModelsService';
import {
  getModelFavorites, isModelFavorited,
  addModelFavoriteNotify, removeModelFavoriteNotify,
  subscribeModelFavorites,
  type ModelFavorite,
} from '../services/modelFavoritesService';
import type { TabType } from '../types';

type FilterMode = 'all' | 'checkpoint' | 'lora' | 'unet' | 'favorites';

const FAVORITE_CATEGORY_PRESETS = ['默认', '人物', '风格', 'IP', '辅助', '其他'];

interface ModelLibraryPageProps {
  onNavigate?: (tab: TabType) => void;
  onSuccess?: (msg: string) => void;
  onError?: (msg: string) => void;
}

// Unique custom categories from favorites (for the favorites view), deduplicated by label
const getFavoriteCategories = (favs: ModelFavorite[]): { id: string; label: string }[] => {
  const cats = new Set<string>();
  const result: { id: string; label: string }[] = [{ id: 'all', label: '全部' }];
  for (const f of favs) {
    const c = f.customCategory || '默认';
    if (!cats.has(c)) { cats.add(c); result.push({ id: c, label: c }); }
  }
  return result;
};

// ─── Detail Modal ───────────────────────────────────────────────────────────

function ModelDetailModal({
  entry,
  kind,
  onClose,
  onFavorite,
  onSend,
}: {
  entry: RunningHubModelEntry;
  kind: ModelKind;
  onClose: () => void;
  onFavorite: () => void;
  onSend: () => void;
}) {
  const [tab, setTab] = useState<'basic' | 'model'>('basic');
  const meta = MODEL_KIND_META[kind];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="bg-bg-elevated rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-5 border-b border-border-default">
          {/* Cover */}
          <div className="relative w-20 h-20 rounded-xl overflow-hidden flex-shrink-0 bg-bg-base">
            {entry.cover ? (
              <img src={entry.cover} alt={entry.label} className="w-full h-full object-cover" />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center text-white font-bold text-2xl"
                style={{ background: `linear-gradient(135deg, ${getModelAccent(entry.name).from}, ${getModelAccent(entry.name).to})` }}
              >
                {getModelInitial(entry.name)}
              </div>
            )}
            <span className={`absolute top-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${meta.badgeClass}`}>
              {meta.badge}
            </span>
          </div>
          {/* Title */}
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-text-primary line-clamp-1">{entry.label || entry.name}</h2>
            <div className="text-[11px] text-text-tertiary mt-0.5 font-mono line-clamp-1">{entry.name}</div>
            {entry.baseModel && (
              <div className="flex items-center gap-1 mt-1">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-base border border-border-default text-text-secondary">
                  {entry.baseModel}
                </span>
                {entry.baseModelSubtype && (
                  <span className="text-[10px] text-text-tertiary">{entry.baseModelSubtype}</span>
                )}
              </div>
            )}
          </div>
          {/* Close */}
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary p-1 rounded-lg hover:bg-bg-base">
            <X size={18} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-border-default">
          {([
            { id: 'basic', label: '基础信息', icon: Info },
            { id: 'model', label: '模型信息', icon: Layers },
          ] as const).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={[
                'flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-colors',
                tab === t.id
                  ? 'text-primary border-b-2 border-primary -mb-px'
                  : 'text-text-tertiary hover:text-text-secondary',
              ].join(' ')}
            >
              <t.icon size={13} />{t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {tab === 'basic' ? (
            <>
              <InfoRow icon={<Info size={12} />} label="版本">{entry.version || entry.versionName || '—'}</InfoRow>
              <InfoRow icon={<Calendar size={12} />} label="上传时间">{formatDate(entry.createTime || '')}</InfoRow>
              <InfoRow icon={<Calendar size={12} />} label="更新日期">{formatDate(entry.updateTime || entry.createTime || '')}</InfoRow>
              {entry.owner && <InfoRow icon={<User size={12} />} label="作者">{entry.owner}</InfoRow>}
              {entry.baseModel && <InfoRow icon={<Layers size={12} />} label="基础模型">{entry.baseModel}</InfoRow>}
              {entry.baseModelSubtype && <InfoRow icon={<Layers size={12} />} label="底模子类型">{entry.baseModelSubtype}</InfoRow>}
{entry.tags && entry.tags.length > 0 && (
                <InfoRow icon={<Tag size={12} />} label="标签">
                  <div className="flex flex-wrap gap-1">
                    {Array.from(new Set(entry.tags)).map((t, ti) => (
                      <span key={`tag-${ti}-${t}`} className="px-1.5 py-0.5 rounded text-[10px] bg-bg-base border border-border-default text-text-secondary">
                        {t}
                      </span>
                    ))}
                  </div>
                </InfoRow>
              )}
              {entry.triggerWords && (
                <InfoRow icon={<Zap size={12} />} label="触发词">
                  <code className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded break-all">{entry.triggerWords}</code>
                </InfoRow>
              )}
              {entry.description && (
                <InfoRow icon={<Info size={12} />} label="介绍">
                  <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">{entry.description}</p>
                </InfoRow>
              )}
            </>
          ) : (
            <>
              <div className="bg-bg-base rounded-lg p-3 border border-border-default">
                <div className="text-[10px] text-text-tertiary mb-1.5 uppercase tracking-wide">基础信息</div>
                <div className="text-xs text-text-secondary space-y-1.5">
                  {entry.baseModel && <div><span className="text-text-tertiary">基础模型：</span>{entry.baseModel}</div>}
                  {entry.version && <div><span className="text-text-tertiary">版本：</span>{entry.version}</div>}
                  {entry.owner && <div><span className="text-text-tertiary">作者：</span>{entry.owner}</div>}
                  {entry.createTime && <div><span className="text-text-tertiary">上传时间：</span>{formatDate(entry.createTime)}</div>}
                  {entry.updateTime && <div><span className="text-text-tertiary">更新日期：</span>{formatDate(entry.updateTime)}</div>}
                  {entry.baseModelSubtype && <div><span className="text-text-tertiary">底模子类型：</span>{entry.baseModelSubtype}</div>}
                </div>
              </div>
              {entry.description && (
                <div className="bg-bg-base rounded-lg p-3 border border-border-default">
                  <div className="text-[10px] text-text-tertiary mb-1.5 uppercase tracking-wide">模型介绍</div>
                  <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">{entry.description}</p>
                </div>
              )}
              {entry.triggerWords && (
                <div className="bg-bg-base rounded-lg p-3 border border-border-default">
                  <div className="text-[10px] text-text-tertiary mb-1.5 uppercase tracking-wide">触发词</div>
                  <code className="text-[11px] text-primary bg-primary/10 px-2 py-1 rounded block break-all">{entry.triggerWords}</code>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 p-4 border-t border-border-default">
          <button
            onClick={onFavorite}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium bg-bg-base border border-border-default rounded-lg hover:border-primary hover:text-primary transition-colors"
          >
            <Heart size={13} />{isModelFavorited(kind, entry.name) ? '已收藏' : '收藏'}
          </button>
          <button
            onClick={onSend}
            className="flex-[2] flex items-center justify-center gap-1.5 py-2 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Send size={13} />发送到文生图
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex items-center gap-1.5 w-20 flex-shrink-0 text-text-tertiary pt-0.5">
        {icon}
        <span className="text-[11px]">{label}</span>
      </div>
      <div className="flex-1 text-xs text-text-secondary">{children}</div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export function ModelLibraryPage({ onNavigate, onSuccess }: ModelLibraryPageProps) {
  const [filter, setFilter] = useState<FilterMode>('all');
  const [category, setCategory] = useState<string>('all');
  const [baseModelFilter, setBaseModelFilter] = useState<BaseModelFilter>('all');
  const [sortField, setSortField] = useState<SortField>('default');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [checkpoints, setCheckpoints] = useState<RunningHubModelEntry[]>([]);
  const [loras, setLoras] = useState<RunningHubModelEntry[]>([]);
  const [unets, setUnets] = useState<RunningHubModelEntry[]>([]);
  const [favorites, setFavorites] = useState<ModelFavorite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [detailEntry, setDetailEntry] = useState<(RunningHubModelEntry & { __kind?: ModelKind }) | null>(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

  // 编辑收藏（重命名 / 改分类）
  const [editingFav, setEditingFav] = useState<ModelFavorite | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('默认');

  // 防抖搜索
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  // 初次加载 + 订阅收藏变更
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const [cp, lr, un] = await Promise.all([
          getAllModels('checkpoint'),
          getAllModels('lora'),
          getAllModels('unet'),
        ]);
        if (!mounted) return;
        setCheckpoints(cp);
        setLoras(lr);
        setUnets(un);
      } catch (e) {
        if (!mounted) return;
        setLoadError((e as Error).message || '加载失败');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    setFavorites(getModelFavorites());
    const unsub = subscribeModelFavorites(() => setFavorites(getModelFavorites()));
    return () => { mounted = false; unsub(); };
  }, []);

  const refreshFavorites = useCallback(() => setFavorites(getModelFavorites()), []);

  // 过滤后的列表
  const list = useMemo<RunningHubModelEntry[]>(() => {
    let src: RunningHubModelEntry[] = [];
    if (filter === 'favorites') {
      let favs = favorites;
      if (category !== 'all') favs = favs.filter((f) => (f.customCategory || '默认') === category);
      return favs.map((f) => ({
        name: f.name,
        label: f.customName || f.snapshot.label,
        category: f.snapshot.tags || [],
        defaultWeight: f.snapshot.defaultWeight,
        description: f.snapshot.description || '',
        baseModel: f.snapshot.baseModel,
        tags: f.snapshot.tags,
        triggerWords: f.snapshot.triggerWords,
        cover: f.snapshot.cover,
        createTime: f.snapshot.createTime,
        updateTime: f.snapshot.updateTime,
        owner: f.snapshot.owner,
        version: f.snapshot.version,
        __kind: f.kind,
        __customCategory: f.customCategory,
      } as RunningHubModelEntry & { __kind?: ModelKind; __customCategory?: string }));
    }
    if (filter === 'checkpoint') src = checkpoints;
    else if (filter === 'lora') src = loras;
    else if (filter === 'unet') src = unets;
    else src = [...checkpoints, ...loras, ...unets];

    // 分类
    let out = src;
    if (category !== 'all') out = out.filter((m) => (m.category || []).includes(category));

    // 底模筛选（仅 UNET）
    if (filter === 'unet' && baseModelFilter !== 'all') {
      const bm = baseModelFilter === 'il-xl' ? 'IL-XL' : 'krea2';
      out = out.filter((m) => (m.baseModel || '').toLowerCase().includes(bm.toLowerCase()));
    }

    // 搜索
    if (debouncedQuery) out = searchModels(out, debouncedQuery);

    // 排序
    return sortModels(out, sortField);
  }, [filter, checkpoints, loras, unets, favorites, category, baseModelFilter, sortField, debouncedQuery]);

  const handleToggleFavorite = (entry: RunningHubModelEntry, kind: ModelKind) => {
    const id = `${kind}:${entry.name}`;
    if (isModelFavorited(kind, entry.name)) {
      removeModelFavoriteNotify(kind, entry.name);
      onSuccess?.('已取消收藏');
    } else {
      addModelFavoriteNotify(entry, kind);
      onSuccess?.('已加入收藏');
    }
    setOpenMenuId((cur) => (cur === id ? null : cur));
  };

  const handleSendToTxt2Img = (entry: RunningHubModelEntry, kind: ModelKind) => {
    onSuccess?.(`已发送 "${entry.label || entry.name}" 到文生图`);
    window.dispatchEvent(new CustomEvent('rh:sendModelToTxt2Img', {
      detail: { name: entry.name, label: entry.label, kind, ts: Date.now() },
    }));
    setOpenMenuId(null);
  };

  const openEditModal = (fav: ModelFavorite) => {
    setEditingFav(fav);
    setEditName(fav.customName);
    setEditCategory(fav.customCategory || '默认');
    setOpenMenuId(null);
  };

  const handleSaveEdit = () => {
    if (!editingFav) return;
    import('../services/modelFavoritesService').then(({ updateModelFavoriteNotify }) => {
      updateModelFavoriteNotify(editingFav.id, {
        customName: editName.trim() || editingFav.snapshot.label,
        customCategory: editCategory,
      });
      refreshFavorites();
      onSuccess?.('已更新');
      setEditingFav(null);
    });
  };

  // 计数
  const counts = useMemo(() => ({
    all: checkpoints.length + loras.length + unets.length,
    checkpoint: checkpoints.length,
    lora: loras.length,
    unet: unets.length,
    favorites: favorites.length,
  }), [checkpoints, loras, unets, favorites]);

  const showBaseModelFilter = filter === 'unet';
  const currentSort = SORT_OPTIONS.find(s => s.id === sortField) || SORT_OPTIONS[0];

  return (
    <div className="min-h-full bg-bg-base">
      {/* Header */}
      <div className="bg-bg-elevated border-b border-border-default sticky top-[88px] z-20">
        <div className="max-w-7xl mx-auto px-4 lg:px-6 py-4 space-y-3">
          {/* Title row */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Library size={18} className="text-primary" />
              <h1 className="text-base font-semibold text-text-primary">模型库</h1>
              <span className="text-xs text-text-tertiary">
                · 收藏 <span className="text-yellow-500 font-medium">{counts.favorites}</span> 个模型可在文生图直接选用
              </span>
            </div>
            {filter === 'favorites' && favorites.length > 0 && (
              <button
                onClick={() => {
                  if (confirm(`确定清空全部 ${favorites.length} 个收藏？此操作不可撤销。`)) {
                    import('../services/modelFavoritesService').then(({ clearAllModelFavorites }) => {
                      clearAllModelFavorites();
                      onSuccess?.('已清空收藏');
                    });
                  }
                }}
                className="flex items-center gap-1 text-xs text-text-tertiary hover:text-red-500 transition-colors px-2 py-1 rounded hover:bg-red-500/10"
              >
                <Trash2 size={12} /> 清空收藏
              </button>
            )}
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索模型名 / label / tags / trigger words..."
              className="w-full pl-9 pr-9 py-2 text-sm bg-bg-base border border-border-default rounded-lg
                         focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20
                         placeholder:text-text-tertiary"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-tertiary hover:text-text-primary"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Filter tabs (kind) */}
          <div className="flex items-center justify-between gap-1.5 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              {([
                { id: 'all', label: '全部', n: counts.all },
                { id: 'checkpoint', label: 'Checkpoint', n: counts.checkpoint },
                { id: 'lora', label: 'LoRA', n: counts.lora },
                { id: 'unet', label: 'UNET', n: counts.unet },
                { id: 'favorites', label: '★ 我的收藏', n: counts.favorites },
              ] as { id: FilterMode; label: string; n: number }[]).map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setFilter(t.id); setCategory('all'); setBaseModelFilter('all'); setSortField('default'); }}
                  className={[
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    filter === t.id
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-bg-base text-text-secondary hover:bg-primary-light hover:text-primary border border-border-default',
                  ].join(' ')}
                >
                  {t.label}
                  <span className={[
                    'px-1.5 rounded text-[10px]',
                    filter === t.id ? 'bg-white/20' : 'bg-bg-elevated text-text-tertiary',
                  ].join(' ')}>{t.n}</span>
                </button>
              ))}
            </div>
            {/* Sort */}
            <div className="relative">
              <button
                onClick={() => setSortMenuOpen(o => !o)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-text-secondary bg-bg-base border border-border-default hover:border-primary hover:text-primary transition-colors"
              >
                <SlidersHorizontal size={12} />
                {currentSort.label}
                <ChevronDown size={11} className={sortMenuOpen ? 'rotate-180' : ''} />
              </button>
              {sortMenuOpen && (
                <div className="absolute right-0 top-full mt-1 z-30 bg-bg-elevated border border-border-default rounded-lg shadow-xl py-1 min-w-[100px]">
                  {SORT_OPTIONS.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => { setSortField(s.id); setSortMenuOpen(false); }}
                      className={[
                        'w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 transition-colors',
                        sortField === s.id ? 'text-primary font-medium' : 'text-text-secondary hover:text-primary',
                      ].join(' ')}
                    >
                      {sortField === s.id && <Check size={11} />}
                      <span className={sortField === s.id ? 'ml-0' : 'ml-4'}>{s.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Base model filter — only for UNET */}
          {showBaseModelFilter && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-text-tertiary flex-shrink-0">底模:</span>
              {BASE_MODEL_OPTIONS.map((bm) => (
                <button
                  key={bm.id}
                  onClick={() => setBaseModelFilter(bm.id)}
                  className={[
                    'flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] transition-colors',
                    baseModelFilter === bm.id
                      ? 'bg-primary text-white'
                      : 'bg-bg-base text-text-secondary hover:bg-primary-light hover:text-primary border border-border-default',
                  ].join(' ')}
                >
                  {bm.label}
                </button>
              ))}
            </div>
          )}

          {/* Category chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'thin' }}>
            <Filter size={12} className="text-text-tertiary flex-shrink-0" />
            {filter === 'favorites'
              ? getFavoriteCategories(favorites).map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCategory(c.id)}
                  className={[
                    'flex-shrink-0 px-2.5 py-0.5 rounded-full text-[11px] transition-colors',
                    category === c.id
                      ? 'bg-primary text-white'
                      : 'bg-bg-base text-text-secondary hover:bg-primary-light hover:text-primary border border-border-default',
                  ].join(' ')}
                >
                  {c.label}
                </button>
              ))
              : CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCategory(c.id)}
                  className={[
                    'flex-shrink-0 px-2.5 py-0.5 rounded-full text-[11px] transition-colors',
                    category === c.id
                      ? 'bg-primary text-white'
                      : 'bg-bg-base text-text-secondary hover:bg-primary-light hover:text-primary border border-border-default',
                  ].join(' ')}
                >
                  {c.label}
                </button>
              ))
            }
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 lg:px-6 py-5">
        {loading && (
          <div className="flex items-center justify-center py-20 text-text-tertiary">
            <Loader2 size={20} className="animate-spin mr-2" />
            <span className="text-sm">正在加载模型数据库...</span>
          </div>
        )}
        {loadError && (
          <div className="flex flex-col items-center justify-center py-20 text-red-500 text-sm">
            <span>加载失败：{loadError}</span>
            <span className="text-xs text-text-tertiary mt-2">检查 public/data/runninghubModels.json 是否存在</span>
          </div>
        )}
        {!loading && !loadError && list.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-text-tertiary">
            {filter === 'favorites' ? (
              <>
                <Star size={36} className="mb-3 opacity-30" />
                <span className="text-sm">还没有收藏的模型</span>
                <span className="text-xs mt-1">在模型列表里点击卡片右上角的 ☆ 即可加入收藏</span>
              </>
            ) : (
              <>
                <Search size={36} className="mb-3 opacity-30" />
                <span className="text-sm">没有匹配的模型</span>
              </>
            )}
          </div>
        )}
        {!loading && !loadError && list.length > 0 && (
          <>
            <div className="text-xs text-text-tertiary mb-3">
              共 <span className="text-text-primary font-medium">{list.length}</span> 个模型
              {debouncedQuery && <>，搜索 "<span className="text-primary">{debouncedQuery}</span>"</>}
              {category !== 'all' && <>，分类 "<span className="text-primary">{CATEGORIES.find((c) => c.id === category)?.label}</span>"</>}
              {showBaseModelFilter && baseModelFilter !== 'all' && <>，底模 "<span className="text-primary">{BASE_MODEL_OPTIONS.find(b => b.id === baseModelFilter)?.label}</span>"</>}
              {sortField !== 'default' && <>，排序 "<span className="text-primary">{currentSort.label}</span>"</>}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {list.map((entry) => {
                const extra = entry as RunningHubModelEntry & { __kind?: ModelKind; __customCategory?: string };
                const kind: ModelKind = extra.__kind || (loras.some((l) => l.name === entry.name) ? 'lora' : checkpoints.some((c) => c.name === entry.name) ? 'checkpoint' : 'unet');
                const cardId = `${kind}:${entry.name}`;
                const fav = isModelFavorited(kind, entry.name);
                const menuOpen = openMenuId === cardId;
                const accent = getModelAccent(entry.name);
                const initial = getModelInitial(entry.name);
                const customCategory = extra.__customCategory;
                const meta = MODEL_KIND_META[kind];
                const displayDate = formatDate(entry.updateTime || entry.createTime || '');
                return (
                  <div
                    key={cardId}
                    className="group relative bg-bg-elevated border border-border-default rounded-xl overflow-hidden
                               hover:border-primary/50 hover:shadow-lg transition-all flex flex-col cursor-pointer"
                    onClick={() => setDetailEntry({ ...entry, __kind: kind })}
                  >
                    {/* Cover */}
                    <div className="relative aspect-square w-full overflow-hidden bg-bg-base">
                      {entry.cover ? (
                        <img
                          src={entry.cover}
                          alt={entry.label}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div
                          className="w-full h-full flex items-center justify-center text-white font-bold text-3xl"
                          style={{ background: `linear-gradient(135deg, ${accent.from}, ${accent.to})` }}
                        >
                          {initial}
                        </div>
                      )}
                      {/* Kind badge */}
                      <div className="absolute top-1.5 left-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium backdrop-blur-sm ${meta.badgeClass}`}>
                          {meta.badge}
                        </span>
                      </div>
                      {/* Favorite heart */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggleFavorite(entry, kind); }}
                        className={[
                          'absolute top-1.5 right-1.5 w-7 h-7 rounded-full flex items-center justify-center backdrop-blur-sm transition-all',
                          fav
                            ? 'bg-yellow-400 text-white shadow-md'
                            : 'bg-black/30 text-white/80 hover:bg-black/50 hover:text-white',
                        ].join(' ')}
                        title={fav ? '取消收藏' : '加入收藏'}
                      >
                        <Heart size={13} fill={fav ? 'currentColor' : 'none'} />
                      </button>
                      {/* Custom category tag */}
                      {customCategory && customCategory !== '默认' && (
                        <div className="absolute bottom-1.5 left-1.5">
                          <span className="px-1.5 py-0.5 rounded text-[9px] bg-black/60 text-white backdrop-blur-sm">
                            {customCategory}
                          </span>
                        </div>
                      )}
                      {/* Date badge */}
                      {displayDate && (
                        <div className="absolute bottom-1.5 right-1.5">
                          <span className="px-1.5 py-0.5 rounded text-[9px] bg-black/60 text-white/80 backdrop-blur-sm">
                            {displayDate}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Body */}
                    <div className="p-2.5 flex flex-col gap-1.5 flex-1">
                      <div className="text-xs font-semibold text-text-primary line-clamp-1" title={entry.label}>
                        {entry.label || entry.name}
                      </div>
                      {entry.description && (
                        <div className="text-[10px] text-text-tertiary line-clamp-2 leading-tight">
                          {entry.description}
                        </div>
                      )}
                      {/* Tags */}
                      {entry.tags && entry.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-auto">
                          {Array.from(new Set(entry.tags)).slice(0, 3).map((t, ti) => (
                            <span key={`tag-${ti}-${t}`} className="px-1.5 py-0 rounded text-[9px] bg-bg-base text-text-secondary border border-border-default">
                              {t}
                            </span>
                          ))}
                          {entry.tags.length > 3 && (
                            <span className="text-[9px] text-text-tertiary">+{entry.tags.length - 3}</span>
                          )}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-1 pt-1.5 border-t border-border-default mt-1">
                        {filter === 'favorites' ? (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSendToTxt2Img(entry, kind); }}
                              className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] font-medium
                                         bg-primary text-white rounded hover:bg-primary/90 transition-colors"
                            >
                              <Send size={10} /> 文生图
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); openEditModal(favorites.find((f) => f.id === cardId)!); }}
                              className="px-1.5 py-1 text-text-tertiary hover:text-primary hover:bg-primary-light rounded transition-colors"
                              title="编辑"
                            >
                              <Pencil size={11} />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleToggleFavorite(entry, kind); }}
                              className="px-1.5 py-1 text-red-500 hover:bg-red-500/10 rounded transition-colors"
                              title="移除收藏"
                            >
                              <Trash2 size={11} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSendToTxt2Img(entry, kind); }}
                              disabled={!fav}
                              className={[
                                'flex-1 flex items-center justify-center gap-1 py-1 text-[10px] font-medium rounded transition-colors',
                                fav
                                  ? 'bg-primary text-white hover:bg-primary/90'
                                  : 'bg-bg-base text-text-tertiary cursor-not-allowed border border-border-default',
                              ].join(' ')}
                              title={fav ? '发送到文生图' : '收藏后可发送'}
                            >
                              <Send size={10} /> 文生图
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setOpenMenuId(menuOpen ? null : cardId); }}
                              className="px-1.5 py-1 text-text-tertiary hover:text-primary hover:bg-primary-light rounded transition-colors"
                              title="更多"
                            >
                              <ChevronRight size={11} className={menuOpen ? 'rotate-90' : ''} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Dropdown menu */}
                    {menuOpen && filter !== 'favorites' && (
                      <div
                        className="absolute right-1.5 bottom-12 z-10 bg-bg-elevated border border-border-default rounded-lg shadow-xl py-1 min-w-[140px]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => handleSendToTxt2Img(entry, kind)}
                          className="w-full px-2.5 py-1.5 text-left text-xs hover:bg-primary-light hover:text-primary flex items-center gap-1.5"
                        >
                          <Send size={11} /> 发送到文生图
                        </button>
                        {fav && (
                          <button
                            onClick={() => {
                              const f = favorites.find((x) => x.id === cardId);
                              if (f) openEditModal(f);
                            }}
                            className="w-full px-2.5 py-1.5 text-left text-xs hover:bg-primary-light hover:text-primary flex items-center gap-1.5"
                          >
                            <Pencil size={11} /> 编辑收藏
                          </button>
                        )}
                        <button
                          onClick={() => handleToggleFavorite(entry, kind)}
                          className="w-full px-2.5 py-1.5 text-left text-xs hover:bg-red-500/10 hover:text-red-500 flex items-center gap-1.5"
                        >
                          <Heart size={11} fill={fav ? 'currentColor' : 'none'} />
                          {fav ? '取消收藏' : '加入收藏'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Click-outside handler for menu & sort */}
      {(openMenuId || sortMenuOpen) && (
        <div className="fixed inset-0 z-0" onClick={() => { setOpenMenuId(null); setSortMenuOpen(false); }} />
      )}

      {/* Detail modal */}
      {detailEntry && (
        <ModelDetailModal
          entry={detailEntry}
          kind={detailEntry.__kind || 'checkpoint'}
          onClose={() => setDetailEntry(null)}
          onFavorite={() => handleToggleFavorite(detailEntry, detailEntry.__kind || 'checkpoint')}
          onSend={() => handleSendToTxt2Img(detailEntry, detailEntry.__kind || 'checkpoint')}
        />
      )}

      {/* Edit favorite modal */}
      {editingFav && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditingFav(null)}>
          <div
            className="bg-bg-elevated rounded-xl p-5 max-w-sm w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
                <Pencil size={14} className="text-primary" />
                编辑收藏
              </h3>
              <button onClick={() => setEditingFav(null)} className="text-text-tertiary hover:text-text-primary">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-text-tertiary mb-1 block">显示名称</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder={editingFav.snapshot.label}
                  className="w-full px-3 py-2 text-sm bg-bg-base border border-border-default rounded-lg
                             focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                <div className="text-[10px] text-text-tertiary mt-1">原名：{editingFav.snapshot.label}</div>
              </div>
              <div>
                <label className="text-[11px] text-text-tertiary mb-1 block">分类标签</label>
                <div className="flex flex-wrap gap-1.5">
                  {FAVORITE_CATEGORY_PRESETS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setEditCategory(c)}
                      className={[
                        'px-2.5 py-1 rounded-full text-xs transition-colors',
                        editCategory === c
                          ? 'bg-primary text-white'
                          : 'bg-bg-base text-text-secondary border border-border-default hover:border-primary',
                      ].join(' ')}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div className="text-[10px] text-text-tertiary bg-bg-base p-2 rounded border border-border-default">
                <div>模型：<span className="text-text-primary font-mono">{editingFav.name}</span></div>
                {editingFav.snapshot.baseModel && (
                  <div className="mt-0.5">底模：<span className="text-text-primary">{editingFav.snapshot.baseModel}</span></div>
                )}
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setEditingFav(null)}
                  className="flex-1 py-2 text-sm bg-bg-base border border-border-default rounded-lg hover:bg-bg-elevated text-text-secondary"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="flex-1 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 flex items-center justify-center gap-1"
                >
                  <Check size={14} /> 保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
