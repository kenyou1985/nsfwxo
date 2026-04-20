import React, { useState, useCallback } from 'react';
import {
  Wand2, Shuffle, LayoutList, Copy, Check, Loader2,
  ChevronDown, ChevronUp, Sparkles, RotateCcw, Send, CopyCheck,
  AlertCircle, Settings, Eye,
} from 'lucide-react';
import {
  expandPrompt,
  randomPrompt,
  generateStoryboard,
} from '../services/promptApi';
import { getYunwuKey } from '../services/storage';

type PromptMode = 'expand' | 'random' | 'storyboard';

interface AIPromptPageProps {
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  onOpenSettings?: () => void;
}

export function AIPromptPage({ onError, onSuccess, onOpenSettings }: AIPromptPageProps) {
  const [activeMode, setActiveMode] = useState<PromptMode>('expand');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [yunwuConfigured] = useState(() => !!getYunwuKey());
  const [r18Mode, setR18Mode] = useState(false);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Mode Tabs */}
      <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
        <div className="flex">
          <ModeTab
            id="expand"
            label="智能扩写"
            icon={<Wand2 size={14} />}
            active={activeMode === 'expand'}
            onClick={() => setActiveMode('expand')}
          />
          <ModeTab
            id="random"
            label="随机抽卡"
            icon={<Shuffle size={14} />}
            active={activeMode === 'random'}
            onClick={() => setActiveMode('random')}
          />
          <ModeTab
            id="storyboard"
            label="剧情分镜"
            icon={<LayoutList size={14} />}
            active={activeMode === 'storyboard'}
            onClick={() => setActiveMode('storyboard')}
          />
        </div>
      </div>

      {/* Yunwu Key not configured warning */}
      {!yunwuConfigured && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3">
          <AlertCircle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800">请先配置 Yunwu AI API Key</p>
            <p className="text-xs text-amber-600 mt-0.5">
              AI 提示词功能需要 Yunwu AI Key 才能使用，请在右上角设置中填入。
            </p>
          </div>
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-medium hover:bg-amber-600 transition-colors flex-shrink-0"
            >
              <Settings size={12} />
              去设置
            </button>
          )}
        </div>
      )}

      {/* R18 Toggle */}
      <div className="rounded-2xl bg-white border border-border shadow-card px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Eye size={15} className={r18Mode ? 'text-red-500' : 'text-text-tertiary'} />
            <div>
              <span className="text-sm font-medium text-text-primary">R18 模式</span>
              <p className="text-xs text-text-tertiary -mt-0.5">
                {r18Mode
                  ? '已启用：将优先抽取 NSFW 标签，生成成人内容提示词'
                  : '关闭：生成普通风格提示词'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setR18Mode(!r18Mode)}
            className={`
              relative w-12 h-6 rounded-full transition-all duration-300 flex-shrink-0
              ${r18Mode ? 'bg-red-500' : 'bg-gray-300'}
            `}
          >
            <span
              className={`
                absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all duration-300
                ${r18Mode ? 'left-[26px]' : 'left-0.5'}
              `}
            />
          </button>
        </div>
      </div>

      {/* Content */}
      {activeMode === 'expand' && (
        <ExpandMode
          onError={onError} onSuccess={onSuccess}
          loading={loading} setLoading={setLoading}
          copied={copied} setCopied={setCopied}
          r18Mode={r18Mode}
        />
      )}
      {activeMode === 'random' && (
        <RandomMode
          onError={onError} onSuccess={onSuccess}
          loading={loading} setLoading={setLoading}
          copied={copied} setCopied={setCopied}
          r18Mode={r18Mode}
        />
      )}
      {activeMode === 'storyboard' && (
        <StoryboardMode
          onError={onError} onSuccess={onSuccess}
          loading={loading} setLoading={setLoading}
          copied={copied} setCopied={setCopied}
          r18Mode={r18Mode}
        />
      )}
    </div>
  );
}

function ModeTab({
  id, label, icon, active, onClick,
}: {
  id: string; label: string; icon: React.ReactNode;
  active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-all
        ${active
          ? 'text-primary bg-primary/5 border-b-2 border-primary'
          : 'text-text-tertiary hover:text-text-primary hover:bg-bg-hover'
        }
      `}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ─── Expand Mode ─────────────────────────────────────────────────────────────

function ExpandMode({
  onError, onSuccess, loading, setLoading, copied, setCopied, r18Mode,
}: {
  onError: (msg: string) => void; onSuccess: (msg: string) => void;
  loading: boolean; setLoading: (v: boolean) => void;
  copied: boolean; setCopied: (v: boolean) => void;
  r18Mode: boolean;
}) {
  const [input, setInput] = useState('');
  const [type, setType] = useState<'image' | 'video'>('image');
  const [result, setResult] = useState('');
  const [original, setOriginal] = useState('');
  const [wasR18, setWasR18] = useState(false);

  const handleGenerate = async () => {
    if (!input.trim()) {
      onError('请输入描述内容');
      return;
    }
    setLoading(true);
    try {
      const res = await expandPrompt(input.trim(), type, r18Mode);
      setResult(res.prompt);
      setOriginal(res.original);
      setWasR18(res.r18);
      onSuccess(r18Mode ? 'R18 提示词生成成功' : '提示词生成成功');
    } catch (err) {
      onError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = useCallback(() => {
    if (!result) return;
    navigator.clipboard.writeText(result).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [result, setCopied]);

  const handleReset = () => {
    setInput('');
    setResult('');
    setOriginal('');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white border border-border shadow-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className={r18Mode ? 'text-red-500' : 'text-primary'} />
            <span className="text-sm font-medium text-text-primary">
              输入简单描述
              {r18Mode && <span className="ml-2 text-xs text-red-500 font-medium">(R18)</span>}
            </span>
          </div>
          <div className="flex gap-1">
            {(['image', 'video'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                  type === t
                    ? 'bg-primary text-white'
                    : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'
                }`}
              >
                {t === 'image' ? '生图' : '生视频'}
              </button>
            ))}
          </div>
        </div>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            r18Mode
              ? '输入你的成人内容想法... 例如: 一个性感的护士...'
              : `输入你的 ${type === 'image' ? '图片' : '视频'} 想法... 例如: 一个女仆在酒吧里...`
          }
          rows={4}
          className={`w-full border rounded-xl px-4 py-3 text-sm placeholder:text-text-secondary focus:outline-none transition-colors resize-none ${
            r18Mode
              ? 'bg-red-50/50 border-red-200 focus:border-red-400'
              : 'bg-bg-elevated border-border focus:border-primary'
          }`}
        />

        <div className="flex gap-2 mt-3">
          <button
            onClick={handleGenerate}
            disabled={loading || !input.trim()}
            className={`
              flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all
              ${loading || !input.trim()
                ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                : r18Mode
                  ? 'bg-gradient-to-r from-red-500 to-red-600 text-white hover:opacity-90 active:scale-[0.98]'
                  : 'bg-gradient-to-r from-primary to-primary/80 text-white hover:opacity-90 active:scale-[0.98]'
              }
            `}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Send size={16} />
                {r18Mode ? '生成 R18 提示词' : '开始生成'}
              </>
            )}
          </button>
          {result && (
            <button
              onClick={handleReset}
              className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl font-medium text-sm bg-bg-elevated text-text-tertiary hover:bg-bg-hover transition-colors"
            >
              <RotateCcw size={14} />
              重置
            </button>
          )}
        </div>
      </div>

      {result && (
        <ResultCard
          title={wasR18 ? 'R18 图片提示词' : `${type === 'image' ? '图片' : '视频'} 提示词`}
          subtitle={original ? `原文: ${original}` : undefined}
          content={result}
          copied={copied}
          onCopy={handleCopy}
          isR18={wasR18}
        />
      )}
    </div>
  );
}

// ─── Random Mode ─────────────────────────────────────────────────────────────

function RandomMode({
  onError, onSuccess, loading, setLoading, copied, setCopied, r18Mode,
}: {
  onError: (msg: string) => void; onSuccess: (msg: string) => void;
  loading: boolean; setLoading: (v: boolean) => void;
  copied: boolean; setCopied: (v: boolean) => void;
  r18Mode: boolean;
}) {
  const [type, setType] = useState<'image' | 'video'>('image');
  const [result, setResult] = useState<{
    prompt: string;
    tags: Record<string, string[]>;
    totalCount: number;
  } | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const res = await randomPrompt(type, r18Mode);
      const total = Object.values(res.tags_used).flat().length;
      setResult({ prompt: res.prompt, tags: res.tags_used, totalCount: total });
      onSuccess(r18Mode ? `R18 抽卡成功，${total} 个标签，${Object.keys(res.tags_used).length} 个分类` : `抽卡成功，${total} 个标签，${Object.keys(res.tags_used).length} 个分类`);
    } catch (err) {
      onError(err instanceof Error ? err.message : '抽卡失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = useCallback(() => {
    if (!result) return;
    navigator.clipboard.writeText(result.prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [result, setCopied]);

  const handleReset = () => setResult(null);

  const totalCategories = result ? Object.keys(result.tags).length : 0;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white border border-border shadow-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Shuffle size={14} className={r18Mode ? 'text-red-500' : 'text-primary'} />
            <span className="text-sm font-medium text-text-primary">
              多维随机抽卡
              {r18Mode && <span className="ml-2 text-xs text-red-500 font-medium">(R18)</span>}
            </span>
          </div>
          {result && (
            <div className="flex items-center gap-2 text-xs text-text-tertiary">
              <span className="px-2 py-0.5 rounded-full bg-bg-elevated">
                {result.totalCount} 个标签
              </span>
              <span className="px-2 py-0.5 rounded-full bg-bg-elevated">
                {totalCategories} 个分类
              </span>
            </div>
          )}
        </div>

        <div className="flex gap-1 mb-3">
          {(['image', 'video'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                type === t
                  ? 'bg-primary text-white'
                  : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'
              }`}
            >
              {t === 'image' ? '生图' : '生视频'}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleGenerate}
            disabled={loading}
            className={`
              flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all
              ${loading
                ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                : r18Mode
                  ? 'bg-gradient-to-r from-red-500 to-red-600 text-white hover:opacity-90 active:scale-[0.98]'
                  : 'bg-gradient-to-r from-primary to-primary/80 text-white hover:opacity-90 active:scale-[0.98]'
              }
            `}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                抽卡中...
              </>
            ) : (
              <>
                <Sparkles size={16} />
                {r18Mode ? 'R18 抽卡' : '抽卡生成'}
              </>
            )}
          </button>
          {result && (
            <button
              onClick={handleReset}
              className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl font-medium text-sm bg-bg-elevated text-text-tertiary hover:bg-bg-hover transition-colors"
            >
              <RotateCcw size={14} />
              再抽
            </button>
          )}
        </div>
      </div>

      {result && (
        <>
          {/* Tags by category display */}
          <div className="rounded-2xl bg-white border border-border shadow-card p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-text-tertiary font-medium">抽中标签 · 按分类</span>
              <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
                <span className="w-2 h-2 rounded-full bg-primary/60" />
                <span>点击分类展开</span>
              </div>
            </div>
            <TagCategoryList tags={result.tags} r18Mode={r18Mode} />
          </div>

          <ResultCard
            title={r18Mode ? 'R18 生成的提示词' : '生成的提示词'}
            content={result.prompt}
            copied={copied}
            onCopy={handleCopy}
            isR18={r18Mode}
          />
        </>
      )}
    </div>
  );
}

function TagCategoryList({
  tags,
  r18Mode,
}: {
  tags: Record<string, string[]>;
  r18Mode: boolean;
}) {
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set(Object.keys(tags)));

  const toggleCat = (cat: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  };

  const expandAll = () => setExpandedCats(new Set(Object.keys(tags)));
  const collapseAll = () => setExpandedCats(new Set());

  const catColors: Record<string, string> = {
    quality: 'from-amber-400 to-orange-500',
    r18: 'from-red-500 to-rose-700',
    nsfw_details: 'from-red-400 to-pink-600',
    character: 'from-blue-400 to-indigo-500',
    hair: 'from-purple-400 to-pink-500',
    hairstyles: 'from-purple-400 to-pink-500',
    face: 'from-yellow-400 to-orange-500',
    face_features: 'from-yellow-400 to-orange-500',
    eyes: 'from-teal-400 to-cyan-500',
    expression: 'from-pink-400 to-rose-500',
    body: 'from-orange-400 to-red-500',
    body_markings: 'from-orange-400 to-red-500',
    tattoos_scars: 'from-indigo-400 to-purple-600',
    clothes: 'from-pink-400 to-rose-500',
    socks: 'from-gray-400 to-gray-600',
    shoes: 'from-gray-400 to-gray-600',
    accessories: 'from-yellow-400 to-amber-600',
    environment: 'from-green-400 to-emerald-500',
    style: 'from-violet-400 to-purple-600',
    lighting: 'from-yellow-300 to-amber-500',
    photography_styles: 'from-cyan-400 to-blue-500',
    camera_shot: 'from-sky-400 to-blue-500',
    photo_type: 'from-sky-400 to-blue-500',
    device: 'from-gray-400 to-gray-700',
    photographer: 'from-teal-400 to-teal-600',
    composition: 'from-lime-400 to-green-500',
    action: 'from-orange-400 to-red-500',
    artist: 'from-pink-400 to-purple-600',
    age_group: 'from-blue-300 to-indigo-400',
    ethnicity: 'from-brown-400 to-orange-500',
    skin_tone: 'from-yellow-200 to-amber-400',
    facial_hair: 'from-gray-400 to-gray-600',
    makeup_styles: 'from-pink-400 to-rose-500',
    artform: 'from-cyan-400 to-blue-500',
    digital_artform: 'from-violet-400 to-purple-600',
    emoji: 'from-yellow-400 to-amber-500',
    camera_movement: 'from-sky-400 to-blue-500',
    video_motion: 'from-orange-400 to-red-500',
  };

  const catLabels: Record<string, string> = {
    quality: '质量标签',
    r18: '🔞 R18 标签',
    nsfw_details: '🔞 NSFW 细节',
    character: '角色设定',
    hair: '发色',
    hairstyles: '发型',
    face: '面部特征',
    face_features: '面部属性',
    eyes: '眼睛',
    expression: '表情',
    body: '身材',
    body_markings: '身体标记',
    tattoos_scars: '纹身/疤痕',
    clothes: '服装',
    socks: '袜子',
    shoes: '鞋子',
    accessories: '配饰',
    environment: '环境背景',
    style: '艺术风格',
    lighting: '光照',
    photography_styles: '摄影风格',
    camera_shot: '镜头角度',
    photo_type: '照片类型',
    device: '拍摄设备',
    photographer: '摄影师风格',
    composition: '构图',
    action: '动作',
    artist: '艺术家风格',
    age_group: '年龄组',
    ethnicity: '种族',
    skin_tone: '肤色',
    facial_hair: '面部毛发',
    makeup_styles: '妆容风格',
    artform: '艺术形式',
    digital_artform: '数字艺术',
    emoji: '表情符号',
    camera_movement: '镜头运动',
    video_motion: '视频动作',
  };

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <button
          onClick={expandAll}
          className="px-2.5 py-1 rounded-lg text-xs bg-bg-elevated text-text-tertiary hover:bg-bg-hover transition-colors"
        >
          全部展开
        </button>
        <button
          onClick={collapseAll}
          className="px-2.5 py-1 rounded-lg text-xs bg-bg-elevated text-text-tertiary hover:bg-bg-hover transition-colors"
        >
          全部收起
        </button>
      </div>
      <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
        {Object.entries(tags)
          .filter(([, v]) => v.length > 0)
          .sort(([a], [b]) => {
            const order = ['r18', 'nsfw_details', 'quality', 'character', 'body', 'clothes', 'face', 'hair', 'expression', 'action', 'environment', 'style'];
            const ai = order.indexOf(a);
            const bi = order.indexOf(b);
            if (ai === -1 && bi === -1) return a.localeCompare(b);
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
          })
          .map(([cat, names]) => {
            const isExpanded = expandedCats.has(cat);
            const color = catColors[cat] || 'from-gray-400 to-gray-500';
            const label = catLabels[cat] || cat;
            const isNsfwCat = cat === 'r18' || cat === 'nsfw_details';

            return (
              <div key={cat}>
                <button
                  onClick={() => toggleCat(cat)}
                  className={`
                    w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all
                    ${isNsfwCat && r18Mode
                      ? 'bg-red-50/70 border border-red-200 hover:bg-red-100'
                      : 'bg-bg-elevated hover:bg-bg-hover'
                    }
                  `}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full bg-gradient-to-r ${color}`} />
                    <span className={isNsfwCat && r18Mode ? 'text-red-600' : 'text-text-primary'}>
                      {label}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${isNsfwCat && r18Mode ? 'bg-red-100 text-red-500' : 'bg-bg-hover text-text-tertiary'}`}>
                      {names.length}
                    </span>
                  </div>
                  {isExpanded ? (
                    <ChevronUp size={12} className="text-text-tertiary" />
                  ) : (
                    <ChevronDown size={12} className="text-text-tertiary" />
                  )}
                </button>
                {isExpanded && (
                  <div className="flex flex-wrap gap-1.5 mt-2 pl-1">
                    {names.map((name, i) => (
                      <span
                        key={i}
                        className={`
                          px-2 py-0.5 rounded-full text-[11px] border
                          ${isNsfwCat && r18Mode
                            ? 'bg-gradient-to-r from-red-500/10 to-pink-500/10 text-red-600 border-red-200/50'
                            : 'bg-gradient-to-r from-primary/10 to-primary/5 text-primary border-primary/20'
                          }
                        `}
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

// ─── Storyboard Mode ────────────────────────────────────────────────────────

function StoryboardMode({
  onError, onSuccess, loading, setLoading, copied, setCopied, r18Mode,
}: {
  onError: (msg: string) => void; onSuccess: (msg: string) => void;
  loading: boolean; setLoading: (v: boolean) => void;
  copied: boolean; setCopied: (v: boolean) => void;
  r18Mode: boolean;
}) {
  const [plot, setPlot] = useState('');
  const [panelCount, setPanelCount] = useState(4);
  const [panels, setPanels] = useState<{ panel_number: number; scene_description: string; image_prompt: string }[]>([]);
  const [expandedPanel, setExpandedPanel] = useState<number | null>(null);
  const [copiedPanel, setCopiedPanel] = useState<number | null>(null);

  const handleGenerate = async () => {
    if (!plot.trim()) {
      onError('请输入剧情描述');
      return;
    }
    setLoading(true);
    try {
      const res = await generateStoryboard(plot.trim(), panelCount, r18Mode);
      setPanels(res.storyboard);
      onSuccess(r18Mode ? `R18 分镜生成成功，${res.storyboard.length} 个分镜` : `生成了 ${res.storyboard.length} 个分镜`);
    } catch (err) {
      onError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyPanel = (panel: { image_prompt: string }, idx: number) => {
    navigator.clipboard.writeText(panel.image_prompt).then(() => {
      setCopiedPanel(idx);
      setTimeout(() => setCopiedPanel(null), 2000);
    });
  };

  const handleCopyAll = () => {
    const allPrompts = panels.map((p) => `[Panel ${p.panel_number}]\n${p.image_prompt}`).join('\n\n');
    navigator.clipboard.writeText(allPrompts).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleReset = () => {
    setPlot('');
    setPanels([]);
    setExpandedPanel(null);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white border border-border shadow-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <LayoutList size={14} className={r18Mode ? 'text-red-500' : 'text-primary'} />
            <span className="text-sm font-medium text-text-primary">
              剧情连续分镜
              {r18Mode && <span className="ml-2 text-xs text-red-500 font-medium">(R18)</span>}
            </span>
          </div>
        </div>

        <textarea
          value={plot}
          onChange={(e) => setPlot(e.target.value)}
          placeholder={
            r18Mode
              ? '输入成人剧情描述... 例如: 女主角在酒店房间醒来...'
              : '输入一段短剧情... 例如: 女主角在酒店房间醒来，发现自己被捆绑...'
          }
          rows={5}
          className={`w-full border rounded-xl px-4 py-3 text-sm placeholder:text-text-secondary focus:outline-none transition-colors resize-none mb-3 ${
            r18Mode
              ? 'bg-red-50/50 border-red-200 focus:border-red-400'
              : 'bg-bg-elevated border-border focus:border-primary'
          }`}
        />

        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs text-text-tertiary">分镜数量:</span>
          <div className="flex gap-1">
            {[2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                onClick={() => setPanelCount(n)}
                className={`w-8 h-8 rounded-lg text-xs font-medium transition-all ${
                  panelCount === n
                    ? 'bg-primary text-white'
                    : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleGenerate}
            disabled={loading || !plot.trim()}
            className={`
              flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all
              ${loading || !plot.trim()
                ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                : r18Mode
                  ? 'bg-gradient-to-r from-red-500 to-red-600 text-white hover:opacity-90 active:scale-[0.98]'
                  : 'bg-gradient-to-r from-primary to-primary/80 text-white hover:opacity-90 active:scale-[0.98]'
              }
            `}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                生成分镜中...
              </>
            ) : (
              <>
                <Wand2 size={16} />
                {r18Mode ? '生成 R18 分镜' : '生成分镜'}
              </>
            )}
          </button>
          {panels.length > 0 && (
            <button
              onClick={handleCopyAll}
              className="flex items-center justify-center gap-1.5 px-3 py-3 rounded-xl font-medium text-sm bg-bg-elevated text-text-tertiary hover:bg-bg-hover transition-colors"
              title="复制全部提示词"
            >
              {copied ? <Check size={14} className="text-green-500" /> : <CopyCheck size={14} />}
            </button>
          )}
          {panels.length > 0 && (
            <button
              onClick={handleReset}
              className="flex items-center justify-center gap-1.5 px-3 py-3 rounded-xl font-medium text-sm bg-bg-elevated text-text-tertiary hover:bg-bg-hover transition-colors"
            >
              <RotateCcw size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Storyboard Panels */}
      {panels.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-text-tertiary font-medium">分镜列表</span>
            <span className={`text-xs font-medium ${r18Mode ? 'text-red-500' : 'text-primary'}`}>
              {panels.length} 个分镜 {r18Mode && '🔞'}
            </span>
          </div>

          {panels.map((panel, idx) => (
            <div key={idx} className={`rounded-2xl overflow-hidden shadow-card ${r18Mode ? 'border border-red-200 bg-white' : 'bg-white border border-border'}`}>
              <button
                onClick={() => setExpandedPanel(expandedPanel === idx ? null : idx)}
                className={`w-full flex items-center justify-between px-4 py-3 hover:bg-bg-hover transition-colors ${r18Mode ? 'bg-red-50/30' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <span className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${
                    r18Mode
                      ? 'bg-gradient-to-br from-red-500 to-red-700 text-white'
                      : 'bg-gradient-to-br from-primary to-primary/60 text-white'
                  }`}>
                    {panel.panel_number}
                  </span>
                  <span className="text-sm text-text-primary font-medium line-clamp-1">
                    {panel.scene_description}
                  </span>
                </div>
                {expandedPanel === idx ? (
                  <ChevronUp size={14} className="text-text-tertiary flex-shrink-0" />
                ) : (
                  <ChevronDown size={14} className="text-text-tertiary flex-shrink-0" />
                )}
              </button>

              {expandedPanel === idx && (
                <div className={`px-4 pb-4 border-t ${r18Mode ? 'border-red-100' : 'border-border/50'}`}>
                  <div className="pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-xs font-medium ${r18Mode ? 'text-red-500' : 'text-text-tertiary'}`}>Image Prompt</span>
                      <button
                        onClick={() => handleCopyPanel(panel, idx)}
                        className={`flex items-center gap-1 text-xs transition-colors ${
                          copiedPanel === idx ? 'text-green-500' : r18Mode ? 'text-red-500 hover:text-red-600' : 'text-primary hover:text-primary/80'
                        }`}
                      >
                        {copiedPanel === idx ? (
                          <>
                            <Check size={12} />
                            已复制
                          </>
                        ) : (
                          <>
                            <Copy size={12} />
                            复制
                          </>
                        )}
                      </button>
                    </div>
                    <div className={`rounded-xl px-4 py-3 text-xs leading-relaxed whitespace-pre-wrap font-mono ${
                      r18Mode ? 'bg-red-50 text-red-700' : 'bg-bg-elevated text-text-secondary'
                    }`}>
                      {panel.image_prompt}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Result Card ─────────────────────────────────────────────────────────────

function ResultCard({
  title,
  subtitle,
  content,
  copied,
  onCopy,
  isR18 = false,
}: {
  title: string;
  subtitle?: string;
  content: string;
  copied: boolean;
  onCopy: () => void;
  isR18?: boolean;
}) {
  return (
    <div className={`rounded-2xl shadow-card overflow-hidden ${isR18 ? 'border border-red-200 bg-white' : 'bg-white border border-border'}`}>
      <div className={`flex items-center justify-between px-4 py-3 border-b ${isR18 ? 'border-red-100' : 'border-border/50'}`}>
        <div>
          <h3 className={`text-sm font-medium ${isR18 ? 'text-red-600' : 'text-text-primary'}`}>{title}</h3>
          {subtitle && <p className="text-xs text-text-tertiary mt-0.5">{subtitle}</p>}
        </div>
        <button
          onClick={onCopy}
          className={`
            flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all
            ${copied
              ? 'bg-green-500/10 text-green-500'
              : isR18
                ? 'bg-red-50 text-red-500 hover:bg-red-100'
                : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover hover:text-text-primary'
            }
          `}
        >
          {copied ? (
            <>
              <Check size={12} />
              已复制
            </>
          ) : (
            <>
              <Copy size={12} />
              复制
            </>
          )}
        </button>
      </div>
      <div className="px-4 py-4">
        <div className={`text-sm leading-relaxed whitespace-pre-wrap ${isR18 ? 'text-red-700' : 'text-text-secondary'}`}>
          {content}
        </div>
      </div>
    </div>
  );
}
