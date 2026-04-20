import React, { useState } from 'react';
import { TagSelector } from './TagSelector';
import { PromptEditor, type WeightMode } from './PromptEditor';
import { Plus } from 'lucide-react';

interface TagPanelProps {
  positiveTags: { tag: string; weight: WeightMode; order: number }[];
  negativeTags: { tag: string; weight: WeightMode; order: number }[];
  customPrompt: string;
  enableRandomPrompt: boolean;
  isR18Enabled: boolean;
  displayLang: 'en' | 'zh';
  onCustomPromptChange: (v: string) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onUpdateTagWeight: (tag: string, weight: WeightMode) => void;
  onMoveTagUp: (tag: string) => void;
  onMoveTagDown: (tag: string) => void;
  onClearAll: () => void;
  onEnableRandomPrompt: (v: boolean) => void;
  onEnableR18: () => void;
  onDisplayLangChange: (lang: 'en' | 'zh') => void;
  disabled?: boolean;
}

export function TagPanel({
  positiveTags,
  negativeTags,
  customPrompt,
  enableRandomPrompt,
  isR18Enabled,
  displayLang,
  onCustomPromptChange,
  onAddTag,
  onRemoveTag,
  onUpdateTagWeight,
  onMoveTagUp,
  onMoveTagDown,
  onClearAll,
  onEnableRandomPrompt,
  onEnableR18,
  onDisplayLangChange,
  disabled = false,
}: TagPanelProps) {
  const [tagDrawerOpen, setTagDrawerOpen] = useState(false);

  const handleTagClick = (tag: string) => {
    onAddTag(tag);
    setTagDrawerOpen(false);
  };

  return (
    <div>
      {/* Desktop: two-column grid */}
      <div className="hidden lg:grid lg:grid-cols-2 gap-4">
        <div
          className="rounded-xl bg-bg-surface border border-border overflow-hidden flex flex-col"
          style={{ maxHeight: '700px', minHeight: '500px' }}
        >
          <div className="px-3 py-2 border-b border-border flex-shrink-0 flex items-center justify-between">
            <span className="text-xs text-slate-500 font-medium">
              {displayLang === 'zh' ? '标签库' : 'Tag Library'}
            </span>
            <button
              onClick={() => onDisplayLangChange(displayLang === 'en' ? 'zh' : 'en')}
              disabled={disabled}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-bg-elevated border border-border text-xs font-medium text-slate-300 hover:text-primary hover:border-primary/40 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
              {displayLang === 'en' ? '中文' : 'EN'}
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <TagSelector
              onTagClick={onAddTag}
              selectedTags={[...positiveTags, ...negativeTags].map((t) => t.tag)}
              disabled={disabled}
              displayLang={displayLang}
            />
          </div>
        </div>

        <div
          className="rounded-xl bg-bg-surface border border-border overflow-y-auto p-4"
          style={{ maxHeight: '700px', minHeight: '500px' }}
        >
          <PromptEditor
            positiveTags={positiveTags}
            negativeTags={negativeTags}
            customPrompt={customPrompt}
            enableRandomPrompt={enableRandomPrompt}
            onCustomPromptChange={onCustomPromptChange}
            onAddTag={onAddTag}
            onRemoveTag={onRemoveTag}
            onUpdateTagWeight={onUpdateTagWeight}
            onMoveTagUp={onMoveTagUp}
            onMoveTagDown={onMoveTagDown}
            onClearAll={onClearAll}
            onEnableRandomPrompt={onEnableRandomPrompt}
            disabled={disabled}
            isR18Enabled={isR18Enabled}
            onEnableR18={onEnableR18}
            displayLang={displayLang}
          />
        </div>
      </div>

      {/* Mobile: prompt editor inline + tag launcher FAB */}
      <div className="lg:hidden space-y-3">
        {/* Prompt editor — always visible, compact */}
        <div className="rounded-xl bg-bg-surface border border-border overflow-hidden">
          <PromptEditor
            positiveTags={positiveTags}
            negativeTags={negativeTags}
            customPrompt={customPrompt}
            enableRandomPrompt={enableRandomPrompt}
            onCustomPromptChange={onCustomPromptChange}
            onAddTag={onAddTag}
            onRemoveTag={onRemoveTag}
            onUpdateTagWeight={onUpdateTagWeight}
            onMoveTagUp={onMoveTagUp}
            onMoveTagDown={onMoveTagDown}
            onClearAll={onClearAll}
            onEnableRandomPrompt={onEnableRandomPrompt}
            disabled={disabled}
            isR18Enabled={isR18Enabled}
            onEnableR18={onEnableR18}
            displayLang={displayLang}
          />
        </div>

        {/* Tag launcher button */}
        <button
          onClick={() => setTagDrawerOpen(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-bg-surface border border-border text-sm text-slate-300 hover:text-primary hover:border-primary/40 transition-colors active:scale-[0.98]"
        >
          <Plus size={16} />
          {displayLang === 'zh' ? '添加标签' : 'Add Tags'}
          {(positiveTags.length + negativeTags.length) > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-xs">
              {positiveTags.length + negativeTags.length}
            </span>
          )}
        </button>
      </div>

      {/* Mobile tag selector bottom card */}
      {tagDrawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col" onClick={() => setTagDrawerOpen(false)}>
          {/* Dark overlay — tap to dismiss */}
          <div className="flex-1" onClick={(e) => e.stopPropagation()} />

          {/* Bottom card */}
          <div
            className="bg-bg-surface border-t border-border rounded-t-2xl shadow-2xl animate-slide-in-bottom"
            style={{ maxHeight: '78vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-slate-600" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 pb-2">
              <span className="text-sm font-semibold text-slate-100">
                {displayLang === 'zh' ? '选择标签' : 'Select Tags'}
              </span>
              <button
                onClick={() => setTagDrawerOpen(false)}
                className="px-3 py-1 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-bg-elevated transition-colors border border-border"
              >
                {displayLang === 'zh' ? '完成' : 'Done'}
              </button>
            </div>

            {/* Tag selector content */}
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(78vh - 60px)' }}>
              <TagSelector
                onTagClick={handleTagClick}
                selectedTags={[...positiveTags, ...negativeTags].map((t) => t.tag)}
                disabled={disabled}
                displayLang={displayLang}
                onDisplayLangChange={onDisplayLangChange}
                compactMode={true}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
