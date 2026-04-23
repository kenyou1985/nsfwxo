import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { X, Copy, Wand2, Trash2, ChevronUp, ChevronDown, Check, Plus, Sparkles, Shuffle } from 'lucide-react';
import { getTagDisplayName, type DisplayLang } from '../data/tags';
import { QUALITY_BOOST_PROMPT } from '../constants';

export type WeightMode = 'none' | 'positive' | 'negative';

interface SelectedTag {
  tag: string;
  weight: WeightMode;
  order: number;
}

interface PromptEditorProps {
  positiveTags: SelectedTag[];
  negativeTags: SelectedTag[];
  customPrompt: string;
  enableRandomPrompt: boolean;
  onCustomPromptChange: (v: string) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onUpdateTagWeight: (tag: string, weight: WeightMode) => void;
  onMoveTagUp: (tag: string) => void;
  onMoveTagDown: (tag: string) => void;
  onClearAll: () => void;
  onEnableRandomPrompt: (v: boolean) => void;
  onOptimizePrompt?: () => void;
  disabled?: boolean;
  isR18Enabled?: boolean;
  onEnableR18?: () => void;
  displayLang: DisplayLang;
  isOptimizing?: boolean;
  onGenerateFromPrompt?: () => void;
  isGeneratingFromPrompt?: boolean;
  expandedPrompt?: string;
  onExpandedPromptChange?: (v: string) => void;
  onGacha?: () => void;
  isGachaLoading?: boolean;
  gachaPrompt?: string;
  onGachaPromptChange?: (v: string) => void;
}

export function PromptEditor({
  positiveTags,
  negativeTags,
  customPrompt,
  enableRandomPrompt,
  onCustomPromptChange,
  onAddTag,
  onRemoveTag,
  onUpdateTagWeight,
  onMoveTagUp,
  onMoveTagDown,
  onClearAll,
  onEnableRandomPrompt,
  onOptimizePrompt,
  disabled = false,
  isR18Enabled = false,
  onEnableR18,
  displayLang,
  isOptimizing = false,
  onGenerateFromPrompt,
  isGeneratingFromPrompt = false,
  expandedPrompt,
  onExpandedPromptChange,
  onGacha,
  isGachaLoading = false,
  gachaPrompt,
  onGachaPromptChange,
}: PromptEditorProps) {
  const [showNegative, setShowNegative] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAllTags, setShowAllTags] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const expandedTextareaRef = useRef<HTMLTextAreaElement>(null);
  const gachaTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    }
  }, []);

  // Auto-resize expanded prompt textarea
  const autoResizeExpanded = useCallback(() => {
    const ta = expandedTextareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    }
  }, []);

  useEffect(() => {
    autoResize();
  }, [customPrompt, autoResize]);

  useEffect(() => {
    autoResizeExpanded();
  }, [expandedPrompt, autoResizeExpanded]);

  useEffect(() => {
    autoResize();
    autoResizeExpanded();
    if (gachaTextareaRef.current) {
      gachaTextareaRef.current.style.height = 'auto';
      gachaTextareaRef.current.style.height = `${gachaTextareaRef.current.scrollHeight}px`;
    }
  }, [gachaPrompt, autoResize, autoResizeExpanded]);

  const allSelectedTags = useMemo(() => [...positiveTags, ...negativeTags], [positiveTags, negativeTags]);

  // Build the tag-based prompt string (what appears in the textarea from tags)
  const buildTagPrompt = useCallback(() => {
    const parts: string[] = [];
    positiveTags.forEach((item) => {
      if (item.weight === 'positive') {
        parts.push(`(${item.tag}:1.3)`);
      } else if (item.weight === 'negative') {
        parts.push(`[${item.tag}:0.7]`);
      } else {
        parts.push(item.tag);
      }
    });
    if (enableRandomPrompt) {
      parts.push(QUALITY_BOOST_PROMPT);
    }
    return parts.join(', ');
  }, [positiveTags, enableRandomPrompt]);

  // Sync textarea: show tag prompt + user custom text
  // Only update automatically when the user hasn't manually edited (no cursor movement)

  const generatePrompt = useCallback(() => {
    const parts: string[] = [];

    positiveTags.forEach((item) => {
      if (item.weight === 'positive') {
        parts.push(`(${item.tag}:1.3)`);
      } else if (item.weight === 'negative') {
        parts.push(`[${item.tag}:0.7]`);
      } else {
        parts.push(item.tag);
      }
    });

    if (customPrompt.trim()) {
      parts.push(customPrompt.trim());
    }

    if (enableRandomPrompt) {
      parts.push(QUALITY_BOOST_PROMPT);
    }

    return parts.join(', ');
  }, [positiveTags, customPrompt, enableRandomPrompt]);

  const generateNegativePrompt = useCallback(() => {
    return negativeTags.map((item) => item.tag).join(', ') || 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, bad feet';
  }, [negativeTags]);

  // Tag prompt for display (readonly, generated from selected tags)
  const tagPromptText = buildTagPrompt();

  const finalPrompt = useMemo(() => generatePrompt(), [generatePrompt]);
  const negativePrompt = useMemo(() => generateNegativePrompt(), [generateNegativePrompt]);

  const handleCopy = async () => {
    const text = `Prompt:\n${finalPrompt}\n\nNegative:\n${negativePrompt}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClear = () => {
    if (confirm('确定清空所有标签和提示词？')) {
      onClearAll();
    }
  };

  const totalTags = allSelectedTags.length;
  const hasContent = totalTags > 0 || customPrompt.trim().length > 0;

  const renderTagChip = (item: SelectedTag, isNegative: boolean) => {
    const weightBtn = item.weight === 'positive'
      ? <span className="text-green-600 font-bold text-xs">+</span>
      : item.weight === 'negative'
      ? <span className="text-red-500 font-bold text-xs">-</span>
      : <span className="text-text-tertiary font-bold text-xs">-</span>;

    return (
      <div
        key={item.tag}
        className={`
          group relative flex items-center gap-1 px-2 py-1 rounded-md border text-xs transition-all
          ${isNegative
            ? 'bg-red-50 border-red-200 text-red-700'
            : item.weight === 'positive'
            ? 'bg-green-50 border-green-200 text-green-700'
            : item.weight === 'negative'
            ? 'bg-red-50 border-red-200 text-red-700'
            : 'bg-bg-elevated border-border text-text-primary'
          }
        `}
      >
        {/* Weight toggle */}
        <button
          onClick={() => {
            if (item.weight === 'none') onUpdateTagWeight(item.tag, 'positive');
            else if (item.weight === 'positive') onUpdateTagWeight(item.tag, 'negative');
            else onUpdateTagWeight(item.tag, 'none');
          }}
          disabled={disabled}
          className="flex items-center justify-center w-4 h-4 rounded hover:bg-black/5 transition-colors"
          title="切换权重 (+ 加权 / - 降权)"
        >
          {weightBtn}
        </button>

        {/* Tag text */}
        <span className="max-w-[80px] truncate">{getTagDisplayName(item.tag, displayLang)}</span>

        {/* Up/Down controls */}
        {!isNegative && (
          <div className="hidden group-hover:flex items-center gap-0.5 ml-1">
            <button
              onClick={() => onMoveTagUp(item.tag)}
              disabled={disabled}
              className="p-0.5 rounded hover:bg-black/5 text-text-secondary hover:text-text-primary disabled:opacity-30"
              title="上移"
            >
              <ChevronUp size={10} />
            </button>
            <button
              onClick={() => onMoveTagDown(item.tag)}
              disabled={disabled}
              className="p-0.5 rounded hover:bg-black/5 text-text-secondary hover:text-text-primary disabled:opacity-30"
              title="下移"
            >
              <ChevronDown size={10} />
            </button>
          </div>
        )}

        {/* Remove */}
        <button
          onClick={() => onRemoveTag(item.tag)}
          disabled={disabled}
          className="ml-0.5 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/30 text-text-secondary hover:text-red-400 disabled:opacity-30 transition-all"
        >
          <X size={10} />
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full space-y-2">
      {/* Header bar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-secondary">
            {hasContent
              ? displayLang === 'zh' ? `已选 ${totalTags} 个标签${customPrompt.trim() ? ' + 文本' : ''}` : `Selected ${totalTags} tags${customPrompt.trim() ? ' + text' : ''}`
              : displayLang === 'zh' ? '点击标签添加' : 'Click tags to add'
            }
          </span>
        </div>
        <div className="flex items-center gap-1">
          {hasContent && (
            <button
              onClick={handleCopy}
              disabled={disabled}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors disabled:opacity-50"
            >
              {copied
                ? <><Check size={12} className="text-green-400" /> {displayLang === 'zh' ? '已复制' : 'Copied'}</>
                : <><Copy size={12} /> {displayLang === 'zh' ? '复制' : 'Copy'}</>
              }
            </button>
          )}
          <button
            onClick={handleClear}
            disabled={disabled || !hasContent}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-text-secondary hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30"
          >
            <Trash2 size={12} /> {displayLang === 'zh' ? '清空' : 'Clear'}
          </button>
        </div>
      </div>

      {/* User description input + Expanded prompt output */}
      <div className="space-y-2">
        {/* Tag prompt preview (readonly, generated from selected tags) */}
        {tagPromptText && (
          <div className="bg-bg-surface border border-border/40 rounded-xl px-3 py-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-medium text-text-tertiary uppercase tracking-wide">标签生成</span>
              <span className="text-[9px] text-text-tertiary/50">{positiveTags.length} 标签</span>
            </div>
            <p className="text-[10px] text-text-secondary font-mono leading-relaxed break-all line-clamp-3">
              {tagPromptText}
            </p>
          </div>
        )}

        {/* User description input */}
        <div className="relative">
          <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
            {onGacha && (
              <button
                onClick={onGacha}
                disabled={disabled || isGachaLoading}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                title="随机抽卡生成提示词"
              >
                {isGachaLoading ? (
                  <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Shuffle size={11} />
                )}
                <span>抽卡</span>
              </button>
            )}
            {onOptimizePrompt && (
              <button
                onClick={onOptimizePrompt}
                disabled={disabled || isOptimizing}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                title="AI 一键扩写"
              >
                {isOptimizing ? (
                  <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Wand2 size={11} />
                )}
                <span>扩写</span>
              </button>
            )}
          </div>
          <textarea
            ref={textareaRef}
            value={customPrompt}
            onChange={(e) => { onCustomPromptChange(e.target.value); }}
            placeholder={displayLang === 'zh' ? '输入你的描述想法（可选），或直接点击下方标签添加...' : 'Your description (optional)...'}
            disabled={disabled}
            className="w-full bg-bg-elevated border border-border rounded-xl px-4 py-2.5 pr-20 text-xs text-text-primary placeholder:text-text-tertiary/50 focus:outline-none focus:border-primary/60 transition-colors resize-none overflow-hidden leading-relaxed"
          />
        </div>

        {/* Gacha prompt output — only show when gacha result exists */}
        {gachaPrompt && (
          <div className="bg-gradient-to-br from-amber-50/60 to-orange-50/40 border border-amber-200/60 rounded-xl p-3">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <Shuffle size={10} className="text-amber-500" />
                <span className="text-[10px] font-medium text-amber-600 uppercase tracking-wide">
                  {displayLang === 'zh' ? '抽卡结果' : 'Gacha Result'}
                </span>
              </div>
              {onGachaPromptChange && (
                <button
                  onClick={() => onGachaPromptChange('')}
                  className="text-[10px] text-text-tertiary hover:text-red-400 transition-colors"
                >
                  清空
                </button>
              )}
            </div>
            <textarea
              ref={gachaTextareaRef}
              value={gachaPrompt}
              onChange={(e) => { onGachaPromptChange?.(e.target.value); }}
              className="w-full bg-white/70 border border-amber-200/50 rounded-lg px-3 py-2 text-xs text-text-primary font-mono leading-relaxed placeholder:text-text-tertiary/40 focus:outline-none focus:border-amber-400/60 transition-colors resize-none overflow-hidden"
              placeholder="抽卡生成的提示词将显示在这里..."
            />
            {onGenerateFromPrompt && (
              <div className="flex justify-end mt-2">
                <button
                  onClick={onGenerateFromPrompt}
                  disabled={disabled || isGeneratingFromPrompt || !gachaPrompt.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                  {isGeneratingFromPrompt ? (
                    <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Sparkles size={11} />
                  )}
                  <span>基于抽卡生图</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Expanded prompt output — only show when expand result exists */}
        {expandedPrompt && (
          <div className="bg-gradient-to-br from-purple-50/60 to-pink-50/40 border border-purple-200/60 rounded-xl p-3">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <Wand2 size={10} className="text-purple-500" />
                <span className="text-[10px] font-medium text-purple-600 uppercase tracking-wide">
                  {displayLang === 'zh' ? 'AI 扩写结果' : 'Expanded Prompt'}
                </span>
              </div>
              {onExpandedPromptChange && (
                <button
                  onClick={() => onExpandedPromptChange('')}
                  className="text-[10px] text-text-tertiary hover:text-red-400 transition-colors"
                >
                  清空
                </button>
              )}
            </div>
            <textarea
              ref={expandedTextareaRef}
              value={expandedPrompt}
              onChange={(e) => { onExpandedPromptChange?.(e.target.value); }}
              className="w-full bg-white/70 border border-purple-200/50 rounded-lg px-3 py-2 text-xs text-text-primary font-mono leading-relaxed placeholder:text-text-tertiary/40 focus:outline-none focus:border-purple-400/60 transition-colors resize-none overflow-hidden"
              placeholder="扩写后的提示词将显示在这里..."
            />
            {/* 生图 button — uses expanded prompt */}
            {onGenerateFromPrompt && (
              <div className="flex justify-end mt-2">
                <button
                  onClick={onGenerateFromPrompt}
                  disabled={disabled || isGeneratingFromPrompt || !expandedPrompt.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                  {isGeneratingFromPrompt ? (
                    <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Sparkles size={11} />
                  )}
                  <span>基于提示词生图</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Selected tags display */}
      {allSelectedTags.length > 0 && (
        <div className="bg-bg-surface border border-border/50 rounded-xl p-3">
          {/* Positive tags */}
          {positiveTags.length > 0 && (
              <div className="mb-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">
                  {displayLang === 'zh' ? '正向标签' : 'Positive Tags'}
                </span>
                <span className="text-[10px] text-text-tertiary">{positiveTags.length}个</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {showAllTags ? positiveTags.map((item) => renderTagChip(item, false)) : (
                  <span className="text-xs text-text-secondary">
                    {displayLang === 'zh' ? `点击展开查看全部 ${positiveTags.length} 个标签` : `Click to expand all ${positiveTags.length} tags`}
                  </span>
                )}
              </div>
              {positiveTags.length > 10 && (
                <button
                  onClick={() => setShowAllTags(!showAllTags)}
                  className="mt-1.5 text-[10px] text-text-secondary hover:text-primary transition-colors"
                >
                  {showAllTags ? (displayLang === 'zh' ? '收起' : 'Collapse') : (displayLang === 'zh' ? `展开全部 ${positiveTags.length} 个` : `Expand all ${positiveTags.length}`)}
                </button>
              )}
            </div>
          )}

          {/* Negative tags */}
          {negativeTags.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-medium text-red-400/70 uppercase tracking-wide">
                  {displayLang === 'zh' ? '反向标签' : 'Negative Tags'}
                </span>
                <span className="text-[10px] text-text-tertiary">{negativeTags.length}个</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {negativeTags.map((item) => renderTagChip(item, true))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Options row */}
      <div className="flex items-center gap-3 px-1">
          <label className="flex items-center gap-2 cursor-pointer">
          <div
            className={`
              relative w-9 h-5 rounded-full transition-colors
              ${enableRandomPrompt ? 'bg-primary/60' : 'bg-bg-elevated border border-border'}
            `}
            onClick={() => onEnableRandomPrompt(!enableRandomPrompt)}
          >
            <div
              className={`
                absolute top-0.5 w-4 h-4 rounded-full transition-all shadow
                ${enableRandomPrompt ? 'left-[18px] bg-primary' : 'left-0.5 bg-slate-500'}
              `}
            />
          </div>
          <span className="text-xs text-text-secondary">{displayLang === 'zh' ? '质量增强' : 'Quality Boost'}</span>
        </label>

        {onEnableR18 && (
          <label className="flex items-center gap-2 cursor-pointer">
            <div
              className={`
                relative w-9 h-5 rounded-full transition-colors
                ${isR18Enabled ? 'bg-red-500/60' : 'bg-bg-elevated border border-border'}
              `}
              onClick={onEnableR18}
            >
              <div
                className={`
                  absolute top-0.5 w-4 h-4 rounded-full transition-all shadow
                  ${isR18Enabled ? 'left-[18px] bg-red-500' : 'left-0.5 bg-slate-500'}
                `}
              />
            </div>
            <span className="text-xs text-text-secondary">R18</span>
          </label>
        )}

        <button
          onClick={() => setShowNegative(!showNegative)}
          className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md text-xs text-text-secondary hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          {showNegative ? (displayLang === 'zh' ? '收起反向' : 'Hide Negative') : (displayLang === 'zh' ? '添加反向' : 'Add Negative')}
        </button>
      </div>

      {/* Negative prompt section */}
      {showNegative && (
        <div className="bg-bg-surface border border-red-500/20 rounded-xl p-3 animate-fade-in">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-red-400/70">{displayLang === 'zh' ? '反向提示词' : 'Negative Prompt'}</span>
            <span className="text-[10px] text-text-tertiary">{displayLang === 'zh' ? '点击标签可直接添加至反向' : 'Click tags to add to negative'}</span>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => onUpdateTagWeight('', 'negative')}
              disabled={disabled}
              className="px-2 py-1 rounded-md text-xs bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
            >
              <Plus size={10} className="inline mr-1" />{displayLang === 'zh' ? '从上方添加反向' : 'Move above to negative'}
            </button>
          </div>
        </div>
      )}

      {/* Prompt preview */}
      <div className="bg-bg-surface border border-border/30 rounded-xl p-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">Prompt {displayLang === 'zh' ? '预览' : 'Preview'}</span>
        </div>
        <p className="text-xs text-text-primary font-mono leading-relaxed break-all whitespace-pre-wrap">
          {finalPrompt || <span className="text-text-tertiary italic">{displayLang === 'zh' ? '点击标签生成提示词...' : 'Click tags to generate prompt...'}</span>}
        </p>
      </div>

      <div className="bg-bg-surface border border-border/30 rounded-xl p-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-medium text-red-400/50 uppercase tracking-wide">Negative Prompt</span>
        </div>
        <p className="text-xs text-text-secondary font-mono leading-relaxed break-all whitespace-pre-wrap">
          {negativePrompt || <span className="text-text-tertiary italic">{displayLang === 'zh' ? '无反向标签' : 'No negative tags'}</span>}
        </p>
      </div>
    </div>
  );
}
