import React, { useState } from 'react';
import { TagSelector } from './TagSelector';
import { PromptEditor, type WeightMode } from './PromptEditor';
import { Tags, Globe } from 'lucide-react';

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

  return (
    <div className="relative">
      {/* Desktop: two-column grid */}
      <div className="hidden lg:grid lg:grid-cols-2 gap-4">
        {/* Left: Tag Selector */}
        <div
          className="rounded-xl bg-bg-surface border border-border overflow-hidden flex flex-col"
          style={{ maxHeight: '700px', minHeight: '500px' }}
        >
          {/* Language toggle bar */}
          <div className="px-3 py-2 border-b border-border flex-shrink-0 flex items-center justify-between">
            <span className="text-xs text-slate-500 font-medium">
              {displayLang === 'zh' ? '标签库' : 'Tag Library'}
            </span>
            <button
              onClick={() => onDisplayLangChange(displayLang === 'en' ? 'zh' : 'en')}
              disabled={disabled}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-bg-elevated border border-border text-xs font-medium text-slate-300 hover:text-primary hover:border-primary/40 transition-colors"
            >
              <Globe size={12} />
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

        {/* Right: Prompt Editor */}
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

      {/* Mobile: Tag selector grid + FAB */}
      <div className="lg:hidden relative" style={{ height: 'calc(100vh - 250px)' }}>
        <TagSelector
          onTagClick={onAddTag}
          selectedTags={[...positiveTags, ...negativeTags].map((t) => t.tag)}
          disabled={disabled}
          displayLang={displayLang}
          onDisplayLangChange={onDisplayLangChange}
          compactMode={true}
        />
      </div>

      {/* Mobile FAB to open editor drawer */}
      <button
        onClick={() => setTagDrawerOpen(!tagDrawerOpen)}
        className="lg:hidden fixed bottom-6 right-6 w-14 h-14 rounded-full bg-gradient-to-r from-primary to-secondary shadow-[0_0_20px_rgba(168,85,247,0.5)] flex items-center justify-center text-white hover:scale-105 active:scale-95 transition-all z-40"
      >
        <Tags size={24} />
      </button>

      {/* Mobile drawer */}
      {tagDrawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col" onClick={() => setTagDrawerOpen(false)}>
          <div className="flex-1" onClick={(e) => e.stopPropagation()} />
          <div
            className="bg-bg-base rounded-t-2xl border-t border-border animate-slide-in-right"
            style={{ maxHeight: '80vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-slate-600" />
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(80vh - 40px)' }}>
              <div className="px-4 pb-4">
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
          </div>
        </div>
      )}
    </div>
  );
}
