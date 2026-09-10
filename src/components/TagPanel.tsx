import React, { useState } from 'react';
import { TagSelector } from './TagSelector';
import { PromptEditor, type WeightMode } from './PromptEditor';
import { Plus, Sparkles, Tag, Globe } from 'lucide-react';

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
  onOptimizePrompt?: () => void;
  isOptimizing?: boolean;
  onGenerateFromPrompt?: () => void;
  isGeneratingFromPrompt?: boolean;
  expandedPrompt?: string;
  onExpandedPromptChange?: (v: string) => void;
  onGacha?: () => void;
  isGachaLoading?: boolean;
  gachaPrompt?: string;
  onGachaPromptChange?: (v: string) => void;
  /** 文本框下方插入的自定义按钮组（如"插入参考图引用"）— 仅在多图模式使用 */
  extraTextareaActions?: React.ReactNode;
  /** 标签生成卡片的「生图」按钮回调 */
  onSubmitGeneration?: () => void;
  /** 「生图」按钮是否处于提交中状态 */
  isSubmittingGeneration?: boolean;
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
  onOptimizePrompt,
  isOptimizing,
  onGenerateFromPrompt,
  isGeneratingFromPrompt,
  expandedPrompt,
  onExpandedPromptChange,
  onGacha,
  isGachaLoading,
  gachaPrompt,
  onGachaPromptChange,
  extraTextareaActions,
  onSubmitGeneration,
  isSubmittingGeneration,
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
            onOptimizePrompt={onOptimizePrompt}
            isOptimizing={isOptimizing}
            onGenerateFromPrompt={onGenerateFromPrompt}
            isGeneratingFromPrompt={isGeneratingFromPrompt}
            expandedPrompt={expandedPrompt}
            onExpandedPromptChange={onExpandedPromptChange}
            onGacha={onGacha}
            isGachaLoading={isGachaLoading}
            gachaPrompt={gachaPrompt}
            onGachaPromptChange={onGachaPromptChange}
            extraTextareaActions={extraTextareaActions}
            onSubmitGeneration={onSubmitGeneration}
            isSubmittingGeneration={isSubmittingGeneration}
          />
        </div>
      </div>

      {/* Mobile: tab-based layout for better space usage */}
      <MobileTagPanel
        displayLang={displayLang}
        onDisplayLangChange={onDisplayLangChange}
        positiveTags={positiveTags}
        negativeTags={negativeTags}
        customPrompt={customPrompt}
        enableRandomPrompt={enableRandomPrompt}
        isR18Enabled={isR18Enabled}
        onCustomPromptChange={onCustomPromptChange}
        onAddTag={onAddTag}
        onRemoveTag={onRemoveTag}
        onUpdateTagWeight={onUpdateTagWeight}
        onMoveTagUp={onMoveTagUp}
        onMoveTagDown={onMoveTagDown}
        onClearAll={onClearAll}
        onEnableRandomPrompt={onEnableRandomPrompt}
        onEnableR18={onEnableR18}
        disabled={disabled}
        onOptimizePrompt={onOptimizePrompt}
        isOptimizing={isOptimizing}
        onGenerateFromPrompt={onGenerateFromPrompt}
        isGeneratingFromPrompt={isGeneratingFromPrompt}
        expandedPrompt={expandedPrompt}
        onExpandedPromptChange={onExpandedPromptChange}
        onGacha={onGacha}
        isGachaLoading={isGachaLoading}
        gachaPrompt={gachaPrompt}
        onGachaPromptChange={onGachaPromptChange}
        extraTextareaActions={extraTextareaActions}
        onSubmitGeneration={onSubmitGeneration}
        isSubmittingGeneration={isSubmittingGeneration}
      />
    </div>
  );
}

// ─── Mobile Tab Panel (标签库 | 提示词) ────────────────────────────────────────
// 移动端用 Tab 切换两个面板，避免 grid-cols-2 在小屏挤压文字 / 按钮
interface MobileTagPanelProps {
  displayLang: 'en' | 'zh';
  onDisplayLangChange: (lang: 'en' | 'zh') => void;
  positiveTags: { tag: string; weight: WeightMode; order: number }[];
  negativeTags: { tag: string; weight: WeightMode; order: number }[];
  customPrompt: string;
  enableRandomPrompt: boolean;
  isR18Enabled: boolean;
  onCustomPromptChange: (v: string) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onUpdateTagWeight: (tag: string, weight: WeightMode) => void;
  onMoveTagUp: (tag: string) => void;
  onMoveTagDown: (tag: string) => void;
  onClearAll: () => void;
  onEnableRandomPrompt: (v: boolean) => void;
  onEnableR18: () => void;
  disabled?: boolean;
  onOptimizePrompt?: () => void;
  isOptimizing?: boolean;
  onGenerateFromPrompt?: () => void;
  isGeneratingFromPrompt?: boolean;
  expandedPrompt?: string;
  onExpandedPromptChange?: (v: string) => void;
  onGacha?: () => void;
  isGachaLoading?: boolean;
  gachaPrompt?: string;
  onGachaPromptChange?: (v: string) => void;
  extraTextareaActions?: React.ReactNode;
  onSubmitGeneration?: () => void;
  isSubmittingGeneration?: boolean;
}

function MobileTagPanel(props: MobileTagPanelProps) {
  const {
    displayLang, onDisplayLangChange,
    positiveTags, negativeTags, customPrompt, enableRandomPrompt, isR18Enabled,
    onCustomPromptChange, onAddTag, onRemoveTag, onUpdateTagWeight, onMoveTagUp, onMoveTagDown,
    onClearAll, onEnableRandomPrompt, onEnableR18, disabled,
    onOptimizePrompt, isOptimizing, onGenerateFromPrompt, isGeneratingFromPrompt,
    expandedPrompt, onExpandedPromptChange, onGacha, isGachaLoading,
    gachaPrompt, onGachaPromptChange, extraTextareaActions,
    onSubmitGeneration, isSubmittingGeneration,
  } = props;

  const [mobileTab, setMobileTab] = useState<'tags' | 'prompt'>('prompt');

  return (
    <div className="lg:hidden">
      {/* Top tab bar + lang toggle */}
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-1 p-0.5 rounded-xl bg-bg-elevated border border-border">
          <button
            onClick={() => setMobileTab('prompt')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              mobileTab === 'prompt' ? 'bg-white shadow-sm text-primary' : 'text-text-secondary'
            }`}
          >
            <Sparkles size={12} />
            {displayLang === 'zh' ? '提示词' : 'Prompt'}
          </button>
          <button
            onClick={() => setMobileTab('tags')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              mobileTab === 'tags' ? 'bg-white shadow-sm text-primary' : 'text-text-secondary'
            }`}
          >
            <Tag size={12} />
            {displayLang === 'zh' ? '标签库' : 'Tags'}
            {(positiveTags.length + negativeTags.length) > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary text-white text-[9px] font-bold min-w-[16px] text-center">
                {positiveTags.length + negativeTags.length}
              </span>
            )}
          </button>
        </div>
        <button
          onClick={() => onDisplayLangChange(displayLang === 'en' ? 'zh' : 'en')}
          disabled={disabled}
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-bg-elevated border border-border text-[10px] font-medium text-text-secondary hover:text-primary hover:border-primary transition-colors"
        >
          <Globe size={10} />
          {displayLang === 'en' ? '中文' : 'EN'}
        </button>
      </div>

      {/* Content panels */}
      <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
        {mobileTab === 'prompt' && (
          <div className="p-3">
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
              onOptimizePrompt={onOptimizePrompt}
              isOptimizing={isOptimizing}
              onGenerateFromPrompt={onGenerateFromPrompt}
              isGeneratingFromPrompt={isGeneratingFromPrompt}
              expandedPrompt={expandedPrompt}
              onExpandedPromptChange={onExpandedPromptChange}
              onGacha={onGacha}
              isGachaLoading={isGachaLoading}
              gachaPrompt={gachaPrompt}
              onGachaPromptChange={onGachaPromptChange}
              extraTextareaActions={extraTextareaActions}
              onSubmitGeneration={onSubmitGeneration}
              isSubmittingGeneration={isSubmittingGeneration}
            />
          </div>
        )}
        {mobileTab === 'tags' && (
          <div className="flex flex-col" style={{ height: '520px' }}>
            <TagSelector
              onTagClick={onAddTag}
              selectedTags={[...positiveTags, ...negativeTags].map((t) => t.tag)}
              disabled={disabled}
              displayLang={displayLang}
              compactMode
            />
          </div>
        )}
      </div>
    </div>
  );
}
