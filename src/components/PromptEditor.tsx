import React, { useState, useMemo, useCallback } from 'react';
import { X, Copy, Wand2, Trash2, ChevronUp, ChevronDown, Check, Plus } from 'lucide-react';
import { getTagDisplayName, type DisplayLang } from '../data/tags';

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
}: PromptEditorProps) {
  const [showNegative, setShowNegative] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAllTags, setShowAllTags] = useState(true);

  const allSelectedTags = useMemo(() => [...positiveTags, ...negativeTags], [positiveTags, negativeTags]);

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
      parts.push('masterpiece, best quality, highly detailed, beautiful lighting, 8k, ultra sharp');
    }

    return parts.join(', ');
  }, [positiveTags, customPrompt, enableRandomPrompt]);

  const generateNegativePrompt = useCallback(() => {
    return negativeTags.map((item) => item.tag).join(', ') || 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, bad feet';
  }, [negativeTags]);

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
            {totalTags > 0
              ? displayLang === 'zh' ? `已选 ${totalTags} 个标签` : `Selected ${totalTags} tags`
              : displayLang === 'zh' ? '点击标签添加' : 'Click tags to add'
            }
          </span>
        </div>
        <div className="flex items-center gap-1">
          {totalTags > 0 && (
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
            disabled={disabled || totalTags === 0}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-text-secondary hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30"
          >
            <Trash2 size={12} /> {displayLang === 'zh' ? '清空' : 'Clear'}
          </button>
        </div>
      </div>

      {/* Custom prompt area */}
      <div className="relative">
        <textarea
          value={customPrompt}
          onChange={(e) => onCustomPromptChange(e.target.value)}
          placeholder={displayLang === 'zh' ? '输入自定义描述，或直接点击下方标签添加...' : 'Enter custom description, or click tags below to add...'}
          rows={3}
          disabled={disabled}
          className="w-full bg-bg-elevated border border-border rounded-xl px-4 py-3 pr-10 text-sm text-text-primary placeholder:text-gray-400 focus:outline-none focus:border-primary/60 transition-colors resize-none"
        />
        {onOptimizePrompt && (
          <button
            onClick={onOptimizePrompt}
            disabled={disabled}
            className="absolute right-2 bottom-2 p-1.5 rounded-lg text-text-secondary hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-30"
            title="优化提示词"
          >
            <Wand2 size={14} />
          </button>
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
