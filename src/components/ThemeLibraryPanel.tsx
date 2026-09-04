import React, { useState, useMemo, useCallback } from 'react';
import {
  THEME_LIBRARY,
  THEME_CATEGORIES,
  INTENSITY_LABELS,
  按分类筛选主题,
  随机抽取主题,
  根据时长生成分镜,
  主题转视频提示词,
  type ThemeEntry,
  type ThemeCategory,
  type Intensity,
} from '../data/themeLibrary';
import { Shuffle, ChevronDown, Tag, Zap, Clock } from 'lucide-react';

interface ThemeLibraryPanelProps {
  on应用提示词: (提示词: string) => void;
  on上传图片?: (files: File[]) => void;
  multiRefMode?: boolean;
}

const 时长选项 = [
  { label: '15秒', value: 15 as 15 | 30 | 60, shots: 6, color: 'bg-emerald-100 text-emerald-700' },
  { label: '30秒', value: 30 as 15 | 30 | 60, shots: 9, color: 'bg-blue-100 text-blue-700' },
  { label: '60秒', value: 60 as 15 | 30 | 60, shots: 9, color: 'bg-violet-100 text-violet-700' },
];

export default function ThemeLibraryPanel({
  on应用提示词,
  on上传图片,
  multiRefMode = false,
}: ThemeLibraryPanelProps) {
  const [选中分类, set选中分类] = useState<ThemeCategory | '全部'>('全部');
  const [选中强度, set选中强度] = useState<Intensity | '全部'>('全部');
  const [时长, set时长] = useState<15 | 30 | 60>(30);
  const [展开分类, set展开分类] = useState(false);
  const [展开强度, set展开强度] = useState(false);
  const [随机抽取数量, set随机抽取数量] = useState(3);
  const [已选主题列表, set已选主题列表] = useState<ThemeEntry[]>([]);

  const 分类颜色: Record<string, string> = {
    '全部': 'bg-gray-100 text-gray-700 border-gray-300',
    '纯展示露出': 'bg-pink-100 text-pink-700 border-pink-300',
    '轻情色': 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-300',
    '运动健身': 'bg-emerald-100 text-emerald-700 border-emerald-300',
    '角色扮演': 'bg-purple-100 text-purple-700 border-purple-300',
    '户外野战': 'bg-lime-100 text-lime-700 border-lime-300',
    '多人派对': 'bg-orange-100 text-orange-700 border-orange-300',
    '女同情欲': 'bg-rose-100 text-rose-700 border-rose-300',
    '魔幻奇幻': 'bg-violet-100 text-violet-700 border-violet-300',
    '奇异猎奇': 'bg-slate-200 text-slate-700 border-slate-400',
    'SM重口': 'bg-red-100 text-red-700 border-red-300',
  };

  const 筛选后的主题 = useMemo(() => {
    let pool = THEME_LIBRARY;
    if (选中分类 !== '全部') pool = pool.filter((t) => t.category === 选中分类);
    if (选中强度 !== '全部') pool = pool.filter((t) => t.intensity === 选中强度);
    if (multiRefMode) pool = pool.filter((t) => t.multiRef);
    return pool;
  }, [选中分类, 选中强度, multiRefMode]);

  const 分类统计 = useMemo(() => {
    const counts: Record<string, number> = { 全部: THEME_LIBRARY.length };
    THEME_CATEGORIES.forEach((c) => {
      counts[c.key] = THEME_LIBRARY.filter((t) => t.category === c.key).length;
    });
    return counts;
  }, []);

  const 随机抽取 = useCallback(() => {
    const 结果 = 随机抽取主题(随机抽取数量, 选中分类 === '全部' ? undefined : 选中分类 as ThemeCategory, 选中强度 === '全部' ? undefined : 选中强度 as Intensity);
    set已选主题列表(结果);
  }, [随机抽取数量, 选中分类, 选中强度]);

  const 应用单个主题 = useCallback((主题: ThemeEntry) => {
    const 提示词 = 主题转视频提示词(主题, 时长);
    on应用提示词(提示词);
  }, [时长, on应用提示词]);

  const 应用全部已选 = useCallback(() => {
    if (已选主题列表.length === 0) return;
    const 合并提示词 = 已选主题列表.map((t) => 主题转视频提示词(t, 时长)).join('\n\n---\n\n');
    on应用提示词(合并提示词);
  }, [已选主题列表, 时长, on应用提示词]);

  const 时长Info = 时长选项.find((o) => o.value === 时长)!;

  return (
    <div className="space-y-4">
      {/* 顶部工具栏 */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* 时长选择 */}
        <div className="flex items-center gap-1.5 bg-bg-elevated rounded-lg p-1">
          <Clock size={14} className="text-text-tertiary ml-1" />
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
          <Zap size={14} className="text-text-tertiary" />
          <span className="text-xs text-text-secondary">抽取</span>
          {[1, 3, 5].map((n) => (
            <button
              key={n}
              onClick={() => set随机抽取数量(n)}
              className={`w-6 h-6 rounded text-xs font-medium transition-all ${随机抽取数量 === n ? 'bg-primary text-white' : 'text-text-secondary hover:bg-bg-hover'}`}
            >
              {n}
            </button>
          ))}
          <span className="text-xs text-text-secondary">个主题</span>
        </div>

        {/* 随机抽取按钮 */}
        <button
          onClick={随机抽取}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-primary to-primary/80 text-white rounded-lg text-xs font-medium hover:opacity-90 transition-all"
        >
          <Shuffle size={14} />
          随机抽取
        </button>

        {/* 应用已选按钮 */}
        {已选主题列表.length > 0 && (
          <button
            onClick={应用全部已选}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg text-xs font-medium hover:opacity-90 transition-all"
          >
            <Tag size={14} />
            应用已选({已选主题列表.length})
          </button>
        )}

        {/* 主题总数 */}
        <div className="ml-auto text-xs text-text-tertiary">
          共 {筛选后的主题.length} 个主题
        </div>
      </div>

      {/* 分类标签行 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => set选中分类('全部')}
          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${选中分类 === '全部' ? 'bg-primary text-white border-primary' : 'bg-bg-elevated text-text-secondary border-border hover:border-primary'}`}
        >
          全部 ({分类统计.全部})
        </button>
        {THEME_CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => set选中分类(cat.key)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${选中分类 === cat.key ? `${cat.color} border-current` : 'bg-bg-elevated text-text-secondary border-border hover:border-primary'}`}
          >
            {cat.label} ({分类统计[cat.key] || 0})
          </button>
        ))}
      </div>

      {/* 强度筛选行 */}
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
            className={`px-2 py-0.5 rounded text-xs font-medium transition-all ${选中强度 === opt.key ? (opt.key === '全部' ? 'bg-primary text-white' : INTENSITY_LABELS[opt.key as Intensity].color) : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover'}`}
          >
            {opt.label}
          </button>
        ))}
        <span className="ml-2 text-xs text-text-tertiary">| 时长 {时长Info.shots} 个镜头</span>
      </div>

      {/* 已选主题列表 */}
      {已选主题列表.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-amber-700">已抽取主题</span>
            <button onClick={() => set已选主题列表([])} className="text-xs text-amber-600 hover:underline">清除</button>
          </div>
          <div className="space-y-1.5">
            {已选主题列表.map((theme, idx) => (
              <div key={theme.id} className="flex items-center gap-2 bg-white rounded-lg p-2 border border-amber-100">
                <span className="w-5 h-5 rounded-full bg-primary text-white text-xs flex items-center justify-center font-bold flex-shrink-0">{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-text-primary truncate">{theme.title}</p>
                  <p className="text-[10px] text-text-tertiary truncate">{theme.description}</p>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${INTENSITY_LABELS[theme.intensity].color}`}>
                  {INTENSITY_LABELS[theme.intensity].label}
                </span>
                <button
                  onClick={() => 应用单个主题(theme)}
                  className="text-xs px-2 py-0.5 bg-primary text-white rounded-md hover:opacity-80 flex-shrink-0"
                >
                  应用
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 主题卡片网格 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[500px] overflow-y-auto pr-1">
        {筛选后的主题.length === 0 ? (
          <div className="col-span-full text-center py-8 text-text-tertiary text-sm">
            该分类下暂无主题
          </div>
        ) : (
          筛选后的主题.map((theme) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              时长={时长}
              on应用={() => 应用单个主题(theme)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── 主题卡片组件 ────────────────────────────────────────────────────────────
interface ThemeCardProps {
  theme: ThemeEntry;
  时长: 15 | 30 | 60;
  on应用: () => void;
}

function ThemeCard({ theme, 时长, on应用 }: ThemeCardProps) {
  const [展开, set展开] = useState(false);
  const beats = 根据时长生成分镜(theme, 时长);
  const intensityColor = INTENSITY_LABELS[theme.intensity];
  const categoryColor = `bg-gradient-to-r ${THEME_CATEGORIES.find((c) => c.key === theme.category)?.color || 'from-gray-400 to-gray-500'}`;

  return (
    <div className={`rounded-xl border transition-all hover:shadow-md ${theme.multiRef ? 'border-amber-300 bg-amber-50/30' : 'border-border bg-bg-elevated hover:border-primary'}`}>
      {/* 卡片头部 */}
      <div className="p-3">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-text-primary leading-tight">{theme.title}</h3>
            {theme.multiRef && (
              <span className="inline-block mt-0.5 text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                多参考图
              </span>
            )}
          </div>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${intensityColor.color}`}>
            {intensityColor.label}
          </span>
        </div>
        <p className="text-[11px] text-text-secondary leading-relaxed line-clamp-2">{theme.description}</p>

        {/* 分类标签 */}
        <div className="mt-2">
          <span className={`text-[10px] px-2 py-0.5 rounded-full text-white font-medium bg-gradient-to-r ${categoryColor}`}>
            {theme.category}
          </span>
        </div>
      </div>

      {/* 分镜预览 */}
      <div className="px-3 pb-2">
        <button
          onClick={() => set展开(!展开)}
          className="w-full flex items-center justify-between text-[11px] text-text-tertiary hover:text-primary py-1 border-t border-border/50"
        >
          <span>{beats.length} 个镜头 · {时长}秒</span>
          <ChevronDown size={12} className={`transition-transform ${展开 ? 'rotate-180' : ''}`} />
        </button>

        {展开 && (
          <div className="mt-2 space-y-1.5">
            {beats.map((beat) => (
              <div key={beat.shotNumber} className="flex gap-2 bg-bg-hover rounded-lg p-2">
                <span className="text-[10px] font-bold text-primary bg-primary/10 rounded px-1 py-0.5 flex-shrink-0">{beat.shotNumber}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-text-secondary font-medium">{beat.scene}</p>
                  <p className="text-[9px] text-text-tertiary leading-relaxed line-clamp-2">{beat.prompt}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="px-3 pb-3">
        <button
          onClick={on应用}
          className="w-full py-1.5 rounded-lg bg-gradient-to-r from-primary to-primary/80 text-white text-xs font-medium hover:opacity-90 transition-all"
        >
          应用此主题
        </button>
      </div>
    </div>
  );
}
