import React from 'react';
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
  return (
    <div>
      {/* Desktop: two-column grid */}
      <div className="hidden lg:grid lg:grid-cols-2 gap-4">
        <div
          className="rounded-2xl bg-white border border-border shadow-card overflow-hidden flex flex-col"
          style={{ maxHeight: '700px', minHeight: '500px' }}
        >
          <div className="px-3 py-2 border-b border-border flex-shrink-0 flex items-center justify-between bg-white">
            <span className="text-xs text-text-secondary font-medium">
              {displayLang === 'zh' ? '标签库' : 'Tag Library'}
            </span>
            <button
              onClick={() => onDisplayLangChange(displayLang === 'en' ? 'zh' : 'en')}
              disabled={disabled}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-bg-elevated border border-border text-xs font-medium text-text-secondary hover:text-primary hover:border-primary transition-colors"
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
          className="rounded-2xl bg-white border border-border shadow-card overflow-y-auto p-4"
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

      {/* Mobile: two-column layout (same as desktop) */}
      <div className="lg:hidden space-y-3">
        {/* Two columns: TagSelector | PromptEditor */}
        <div className="grid grid-cols-2 gap-3">
          {/* Left: TagSelector */}
          <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden flex flex-col" style={{ minHeight: '520px' }}>
            <div className="px-3 py-2 border-b border-border flex-shrink-0 flex items-center justify-between bg-white">
              <span className="text-xs text-text-secondary font-medium">{displayLang === 'zh' ? '标签库' : 'Tag Library'}</span>
              <button
                onClick={() => onDisplayLangChange(displayLang === 'en' ? 'zh' : 'en')}
                disabled={disabled}
                className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-bg-elevated border border-border text-[10px] font-medium text-text-secondary hover:text-primary hover:border-primary transition-colors"
              >
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

          {/* Right: PromptEditor */}
          <div className="rounded-2xl bg-white border border-border shadow-card overflow-y-auto p-3" style={{ minHeight: '520px' }}>
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
  );
}
