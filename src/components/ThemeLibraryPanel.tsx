import React, { useState, useMemo, useCallback } from 'react';
import {
  THEME_LIBRARY,
  THEME_CATEGORIES,
  INTENSITY_LABELS,
  随机抽取主题,
  根据时长生成分镜,
  主题转视频提示词,
  type ThemeEntry,
  type ThemeCategory,
  type Intensity,
} from '../data/themeLibrary';
import { Shuffle, ChevronDown, Check, X, Zap, Clock, Search, Layers, Loader2 } from 'lucide-react';

interface ThemeLibraryPanelProps {
  /** 单个主题应用：填入提示词文本框（原有功能） */
  on应用提示词: (提示词: string) => void;
  /** 批量生成：传入多个主题的完整数据，由父组件负责循环调用 submitTask */
  on批量生成?: (themes: ThemeEntry[], duration: 15 | 30 | 60) => void;
  on上传图片?: (files: File[]) => void;
  multiRefMode?: boolean;
  /** 外部强制设置已选主题（如从外部导入时） */
  externalSelected?: ThemeEntry[];
}

const 时长选项 = [
  { label: '15秒', value: 15 as 15 | 30 | 60, shots: 6, color: 'bg-emerald-100 text-emerald-700' },
  { label: '30秒', value: 30 as 15 | 30 | 60, shots: 9, color: 'bg-blue-100 text-blue-700' },
  { label: '60秒', value: 60 as 15 | 30 | 60, shots: 9, color: 'bg-violet-100 text-violet-700' },
];

export default function ThemeLibraryPanel({
  on应用提示词,
  on批量生成,
  on上传图片,
  multiRefMode = false,
  externalSelected,
}: ThemeLibraryPanelProps) {
  const [选中分类, set选中分类] = useState<ThemeCategory | '全部'>('全部');
  const [选中强度, set选中强度] = useState<Intensity | '全部'>('全部');
  const [时长, set时长] = useState<15 | 30 | 60>(30);
  const [随机抽取数量, set随机抽取数量] = useState(5);
  const [已选主题列表, set已选主题列表] = useState<ThemeEntry[]>(externalSelected ?? []);
  const [搜索词, set搜索词] = useState('');
  const [批量生成中, set批量生成中] = useState(false);
  const [批量进度, set批量进度] = useState(0);
  const [展开预览, set展开预览] = useState<Set<string>>(new Set());

  // 搜索结果时使用搜索词；否则按分类+强度筛选
  const 筛选后的主题 = useMemo(() => {
    let pool = THEME_LIBRARY;
    if (multiRefMode) pool = pool.filter((t) => t.multiRef);
    if (搜索词.trim()) {
      const q = 搜索词.toLowerCase();
      pool = pool.filter((t) =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.category.includes(q) ||
        t.scenario.toLowerCase().includes(q)
      );
    } else {
      if (选中分类 !== '全部') pool = pool.filter((t) => t.category === 选中分类);
      if (选中强度 !== '全部') pool = pool.filter((t) => t.intensity === 选中强度);
    }
    return pool;
  }, [选中分类, 选中强度, 搜索词, multiRefMode]);

  const 分类统计 = useMemo(() => {
    const counts: Record<string, number> = { 全部: THEME_LIBRARY.length };
    THEME_CATEGORIES.forEach((c) => {
      counts[c.key] = THEME_LIBRARY.filter((t) => t.category === c.key).length;
    });
    return counts;
  }, []);

  const 随机抽取 = useCallback(() => {
    const 结果 = 随机抽取主题(
      随机抽取数量,
      选中分类 === '全部' ? undefined : 选中分类 as ThemeCategory,
      选中强度 === '全部' ? undefined : 选中强度 as Intensity
    );
    set已选主题列表(结果);
  }, [随机抽取数量, 选中分类, 选中强度]);

  const 切换主题选中 = useCallback((theme: ThemeEntry) => {
    set已选主题列表((prev) => {
      const 已选 = prev.some((t) => t.id === theme.id);
      return 已选 ? prev.filter((t) => t.id !== theme.id) : [...prev, theme];
    });
  }, []);

  const 清除已选 = useCallback(() => set已选主题列表([]), []);

  const 应用单个主题 = useCallback((theme: ThemeEntry) => {
    const 提示词 = 主题转视频提示词(theme, 时长);
    on应用提示词(提示词);
  }, [时长, on应用提示词]);

  const 应用全部已选 = useCallback(() => {
    if (已选主题列表.length === 0) return;
    const 合并提示词 = 已选主题列表.map((t) => 主题转视频提示词(t, 时长)).join('\n\n---\n\n');
    on应用提示词(合并提示词);
  }, [已选主题列表, 时长, on应用提示词]);

  const 处理批量生成 = useCallback(async () => {
    if (已选主题列表.length === 0) return;
    if (!on批量生成) {
      // 无批量回调时降级为合并应用
      应用全部已选();
      return;
    }
    set批量生成中(true);
    set批量进度(0);
    try {
      await on批量生成(已选主题列表, 时长);
    } finally {
      set批量生成中(false);
      set批量进度(0);
    }
  }, [已选主题列表, 时长, on批量生成, 应用全部已选]);

  const 时长Info = 时长选项.find((o) => o.value === 时长)!;

  return (
    <div className="space-y-3">
      {/* ── 顶部工具栏 ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* 时长选择 */}
        <div className="flex items-center gap-1.5 bg-bg-elevated rounded-lg p-1">
          <Clock size={13} className="text-text-tertiary ml-1" />
          {时长选项.map((opt) => (
            <button
              key={opt.value}
              onClick={() => set时长(opt.value)}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${时长 === opt.value ? opt.color : 'text-text-secondary hover:bg-bg-hover'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* 随机抽取数量 */}
        <div className="flex items-center gap-1.5 bg-bg-elevated rounded-lg px-2 py-1">
          <Zap size={13} className="text-text-tertiary" />
          <span className="text-xs text-text-secondary">抽取</span>
          {[3, 5, 8].map((n) => (
            <button
              key={n}
              onClick={() => set随机抽取数量(n)}
              className={`w-6 h-6 rounded text-xs font-medium transition-all ${随机抽取数量 === n ? 'bg-primary text-white' : 'text-text-secondary hover:bg-bg-hover'}`}
            >
              {n}
            </button>
          ))}
          <span className="text-xs text-text-secondary">个</span>
        </div>

        {/* 随机抽取 */}
        <button
          onClick={随机抽取}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-violet-500 to-purple-500 text-white rounded-lg text-xs font-medium hover:opacity-90 transition-all"
        >
          <Shuffle size={13} />
          随机抽取
        </button>

        {/* 主题总数 */}
        <div className="ml-auto text-xs text-text-tertiary">
          {搜索词.trim() ? `搜索到 ${筛选后的主题.length} 个` : `共 ${分类统计[选中分类 !== '全部' ? 选中分类 : '全部']} 个主题`}
        </div>
      </div>

      {/* ── 搜索栏 ── */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
        <input
          type="text"
          value={搜索词}
          onChange={(e) => { set搜索词(e.target.value); set选中分类('全部'); }}
          placeholder="搜索主题名称、描述、场景..."
          className="w-full pl-9 pr-4 py-2 rounded-xl bg-bg-elevated border border-border text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        />
        {搜索词 && (
          <button
            onClick={() => { set搜索词(''); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* ── 分类标签行 ── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => { set选中分类('全部'); set搜索词(''); }}
          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${选中分类 === '全部' ? 'bg-primary text-white border-primary' : 'bg-bg-elevated text-text-secondary border-border hover:border-primary'}`}
        >
          全部 ({分类统计.全部})
        </button>
        {THEME_CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => { set选中分类(cat.key); set搜索词(''); }}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${选中分类 === cat.key ? `bg-primary text-white border-primary` : 'bg-bg-elevated text-text-secondary border-border hover:border-primary'}`}
          >
            {cat.label} ({分类统计[cat.key] || 0})
          </button>
        ))}
      </div>

      {/* ── 强度筛选 ── */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-tertiary">强度：</span>
        {[
          { key: '全部' as const, label: '全部' },
          { key: 'light' as const, label: '轻度' },
          { key: 'medium' as const, label: '中度' },
          { key: 'heavy' as const, label: '重度' },
        ].map((opt) => (
          <button
            key={opt.key}
            onClick={() => set选中强度(opt.key)}
            className={`px-2 py-0.5 rounded text-xs font-medium transition-all ${选中强度 === opt.key
              ? opt.key === '全部' ? 'bg-primary text-white' : INTENSITY_LABELS[opt.key as Intensity].color
              : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <span className="ml-2 text-xs text-text-tertiary">| {时长Info.shots} 镜头</span>
      </div>

      {/* ── 已选主题操作栏（选中时固定显示） ── */}
      {已选主题列表.length > 0 && (
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <Check size={13} className="text-violet-600" />
                <span className="text-xs font-semibold text-violet-700">已选 {已选主题列表.length} 个主题</span>
              </div>
              <div className="h-3 w-px bg-violet-200" />
              <span className="text-[11px] text-violet-600">{时长Info.label} · 预计 {已选主题列表.length * 时长Info.shots} 个镜头</span>
            </div>
            <div className="flex items-center gap-2">
              {/* 批量生成 */}
              {on批量生成 && (
                <button
                  onClick={处理批量生成}
                  disabled={批量生成中}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-lg text-xs font-medium hover:opacity-90 transition-all disabled:opacity-70"
                >
                  {批量生成中 ? (
                    <><Loader2 size={12} className="animate-spin" /> 生成中... ({批量进度}/{已选主题列表.length})</>
                  ) : (
                    <><Layers size={12} />批量生成 {已选主题列表.length} 个视频</>
                  )}
                </button>
              )}
              {/* 合并应用 */}
              <button
                onClick={应用全部已选}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-medium hover:bg-amber-600 transition-all"
              >
                合并填入
              </button>
              {/* 清除 */}
              <button
                onClick={清除已选}
                className="px-2 py-1.5 text-xs text-violet-600 hover:text-violet-800 transition-colors"
              >
                清除
              </button>
            </div>
          </div>

          {/* 缩略预览条 */}
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {已选主题列表.map((theme) => (
              <div
                key={theme.id}
                className="flex-shrink-0 flex items-center gap-1 px-2 py-1 bg-white rounded-lg border border-violet-100"
              >
                <span className="text-[10px] font-medium text-violet-700 whitespace-nowrap">{theme.title}</span>
                <span className={`text-[9px] px-1 rounded-full font-medium ${INTENSITY_LABELS[theme.intensity].color}`}>
                  {INTENSITY_LABELS[theme.intensity].label}
                </span>
                <button
                  onClick={() => 切换主题选中(theme)}
                  className="text-violet-400 hover:text-violet-700 ml-0.5"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 主题卡片网格 ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[480px] overflow-y-auto pr-1">
        {筛选后的主题.length === 0 ? (
          <div className="col-span-full text-center py-10 text-text-tertiary text-sm">
            <Layers size={28} className="mx-auto mb-2 opacity-40" />
            <p>该分类下暂无主题</p>
          </div>
        ) : (
          筛选后的主题.map((theme) => {
            const 已选 = 已选主题列表.some((t) => t.id === theme.id);
            const beats = 根据时长生成分镜(theme, 时长);
            const intensityColor = INTENSITY_LABELS[theme.intensity];
            const catDef = THEME_CATEGORIES.find((c) => c.key === theme.category);
            return (
              <div
                key={theme.id}
                className={`rounded-xl border transition-all cursor-pointer hover:shadow-sm ${
                  已选
                    ? 'border-violet-400 bg-violet-50 ring-2 ring-violet-200'
                    : theme.multiRef
                    ? 'border-amber-200 bg-amber-50/50 hover:border-amber-300'
                    : 'border-border bg-bg-elevated hover:border-primary hover:bg-bg-hover'
                }`}
                onClick={() => 切换主题选中(theme)}
              >
                {/* 卡片主体 */}
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    {/* 选中指示器 */}
                    <div className={`w-4.5 h-4.5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                      已选 ? 'border-violet-500 bg-violet-500' : 'border-gray-300 bg-white'
                    }`}>
                      {已选 && <Check size={9} className="text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-text-primary leading-tight">{theme.title}</h3>
                      {theme.multiRef && (
                        <span className="inline-block mt-0.5 text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">多参考图</span>
                      )}
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${intensityColor.color}`}>
                      {intensityColor.label}
                    </span>
                  </div>

                  <p className="text-[11px] text-text-secondary leading-relaxed line-clamp-2 ml-6">{theme.description}</p>

                  {/* 分类标签 */}
                  <div className="mt-1.5 ml-6">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full text-white font-medium bg-gradient-to-r ${catDef?.color ?? 'from-gray-400 to-gray-500'}`}>
                      {theme.category}
                    </span>
                  </div>
                </div>

                {/* 分镜预览折叠 */}
                <div className="px-3 pb-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      set展开预览((prev) => {
                        const next = new Set(prev);
                        if (next.has(theme.id)) next.delete(theme.id);
                        else next.add(theme.id);
                        return next;
                      });
                    }}
                    className="w-full flex items-center justify-between text-[11px] text-text-tertiary hover:text-primary py-1 border-t border-border/50"
                  >
                    <span>{beats.length} 镜头 · {时长}秒</span>
                    <ChevronDown
                      size={12}
                      className={`transition-transform ${展开预览.has(theme.id) ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {/* 展开预览 (rows=10) */}
                  {展开预览.has(theme.id) && (
                    <div
                      className="mt-2 rounded-lg bg-slate-50 border border-slate-200 overflow-y-auto"
                      style={{ maxHeight: 'calc(1.5em * 10 + 1rem)' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="p-2 space-y-1.5">
                        {beats.map((b) => (
                          <div
                            key={b.shotNumber}
                            className="text-[10px] leading-relaxed text-slate-700"
                          >
                            <span className="font-semibold text-primary">[{b.scene}]</span>{' '}
                            <span className="text-slate-500">镜头 {b.shotNumber}</span>
                            <div className="mt-0.5 text-slate-600">{b.prompt}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 操作按钮 */}
                <div className="px-3 pb-3 flex gap-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); 应用单个主题(theme); }}
                    className="flex-1 py-1.5 rounded-lg bg-gradient-to-r from-primary to-primary/80 text-white text-xs font-medium hover:opacity-90 transition-all"
                  >
                    应用
                  </button>
                  {on批量生成 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        on批量生成([theme], 时长);
                      }}
                      disabled={批量生成中}
                      className="flex-1 py-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white text-xs font-medium hover:opacity-90 transition-all disabled:opacity-60"
                    >
                      生成
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

