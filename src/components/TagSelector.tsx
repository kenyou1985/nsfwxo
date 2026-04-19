import React, { useState, useMemo } from 'react';
import { Tag, Globe } from 'lucide-react';
import { TAG_CATEGORIES, TAG_CATEGORY_ORDER, getTagDisplayName, type TagCategory, type DisplayLang } from '../data/tags';

interface TagSelectorProps {
  onTagClick: (tag: string) => void;
  selectedTags: string[];
  disabled?: boolean;
  displayLang: DisplayLang;
  onDisplayLangChange?: (lang: DisplayLang) => void;
  compactMode?: boolean;
}

export function TagSelector({
  onTagClick,
  selectedTags,
  disabled = false,
  displayLang,
  onDisplayLangChange,
  compactMode = false,
}: TagSelectorProps) {
  const [activeCategory, setActiveCategory] = useState<string>(TAG_CATEGORY_ORDER[0]);
  const [r18Confirmed, setR18Confirmed] = useState(false);

  const activeCat = useMemo(
    () => TAG_CATEGORIES.find((c) => c.id === activeCategory) || TAG_CATEGORIES[0],
    [activeCategory]
  );

  const isR18 = activeCategory === 'r18';
  const canShowTags = !isR18 || r18Confirmed;

  const filteredSubCategories = useMemo(() => {
    if (!activeCat.subCategories || activeCat.subCategories.length === 0) {
      return [{ name: 'All', nameZh: '全部', tags: activeCat.tags }];
    }
    return activeCat.subCategories;
  }, [activeCat]);

  const handleTagClick = (tag: string) => {
    if (disabled) return;
    onTagClick(tag);
  };

  if (compactMode) {
    return (
      <div className="flex flex-col h-full rounded-xl bg-bg-surface border border-border overflow-hidden">
        {/* Compact header: lang toggle */}
        <div className="px-2 py-1.5 border-b border-border flex items-center gap-1.5 flex-shrink-0">
          {onDisplayLangChange && (
            <button
              onClick={() => onDisplayLangChange(displayLang === 'en' ? 'zh' : 'en')}
              disabled={disabled}
              className="flex items-center gap-1 px-2 py-1 rounded bg-bg-elevated border border-border text-[10px] font-medium text-slate-300 hover:text-primary hover:border-primary/40 transition-colors flex-shrink-0"
            >
              <Globe size={10} />
              {displayLang === 'en' ? '中文' : 'EN'}
            </button>
          )}
        </div>

        {/* Compact category tabs */}
        <div className="border-b border-border flex-shrink-0">
          <div className="grid grid-cols-2 sm:grid-cols-3">
            {TAG_CATEGORY_ORDER.map((catId) => {
              const cat = TAG_CATEGORIES.find((c) => c.id === catId);
              if (!cat) return null;
              const catName = displayLang === 'zh' ? cat.name : cat.nameEn;
              return (
                <button
                  key={catId}
                  onClick={() => {
                    setActiveCategory(catId);
                    if (catId === 'r18') setR18Confirmed(false);
                  }}
                  className={[
                    'flex min-w-0 items-center justify-center gap-1 border-b border-r border-border/60 px-2 py-2 text-[11px] font-medium transition-all',
                    activeCategory === catId
                      ? 'bg-primary/8 text-primary'
                      : 'text-slate-400 hover:bg-bg-elevated hover:text-slate-200',
                  ].join(' ')}
                >
                  <span className="shrink-0 text-[11px]">{cat.icon}</span>
                  <span className="truncate">{catName}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* R18 Confirmation */}
        {isR18 && !r18Confirmed && (
          <div className="mx-2 my-1.5 px-2 py-2 rounded-lg bg-red-500/10 border border-red-500/30 flex-shrink-0">
            <p className="text-[10px] text-red-400 mb-1.5 leading-tight">
              {displayLang === 'zh'
                ? '该分类包含成人内容，请确认您的地区和法律允许查看'
                : 'This category contains adult content.'}
            </p>
            <button
              onClick={() => setR18Confirmed(true)}
              className="w-full py-1 px-2 rounded-md bg-red-500/20 border border-red-500/40 text-[10px] font-medium text-red-400 hover:bg-red-500/30 transition-colors"
            >
              {displayLang === 'zh' ? '我已年满18岁，确认进入' : 'I am 18+, confirm'}
            </button>
          </div>
        )}

        {/* Tag Content */}
        {canShowTags ? (
          <div className="flex-1 overflow-y-auto px-2 py-1.5 min-h-0">
            {filteredSubCategories.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-slate-500">
                <Tag size={20} className="mb-1 opacity-30" />
                <p className="text-[10px]">
                  {displayLang === 'zh' ? '未找到匹配的标签' : 'No matching tags'}
                </p>
              </div>
            ) : (
              <div className="space-y-2 pb-2">
                {filteredSubCategories.map((sub) => (
                  <div key={sub.name}>
                    {filteredSubCategories.length > 1 && (
                      <div className="text-[9px] font-medium text-slate-500 mb-1 px-0.5">
                        {displayLang === 'zh' ? sub.nameZh : sub.name}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {sub.tags.map((tag) => {
                        const isSelected = selectedTags.includes(tag);
                        return (
                          <button
                            key={tag}
                            onClick={() => handleTagClick(tag)}
                            disabled={disabled}
                            className={`
                              px-1.5 py-0.5 rounded text-[10px] transition-all border
                              ${isSelected
                                ? 'bg-primary/20 border-primary/40 text-primary'
                                : 'bg-bg-elevated border-border/50 text-slate-300 hover:border-primary/40 hover:text-primary'
                              }
                              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                            `}
                          >
                            {getTagDisplayName(tag, displayLang)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            <p className="text-[10px]">
              {displayLang === 'zh' ? '请点击上方按钮确认年龄' : 'Please confirm age above'}
            </p>
          </div>
        )}
      </div>
    );
  }

  // Desktop layout (non-compact)
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Category Tabs */}
      <div className="border-b border-border flex-shrink-0">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {TAG_CATEGORY_ORDER.map((catId) => {
            const cat = TAG_CATEGORIES.find((c) => c.id === catId);
            if (!cat) return null;
            const catName = displayLang === 'zh' ? cat.name : cat.nameEn;
            return (
              <button
                key={catId}
                onClick={() => {
                  setActiveCategory(catId);
                  if (catId === 'r18') setR18Confirmed(false);
                }}
                className={[
                  'flex min-w-0 items-center gap-1.5 border-b border-r border-border/60 px-3 py-2.5 text-xs font-medium transition-all',
                  activeCategory === catId
                    ? 'bg-primary/8 text-primary'
                    : 'text-slate-500 hover:bg-bg-elevated hover:text-slate-300',
                ].join(' ')}
              >
                <span className="shrink-0">{cat.icon}</span>
                <span className="truncate">{catName}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* R18 Confirmation */}
      {isR18 && !r18Confirmed && (
        <div className="mx-3 my-2 px-3 py-3 rounded-xl bg-red-500/10 border border-red-500/30 flex-shrink-0">
          <p className="text-xs text-red-400 mb-2">
            {displayLang === 'zh'
              ? '该分类包含成人内容，请确认您的地区和法律允许查看'
              : 'This category contains adult content. Please confirm your region allows viewing.'}
          </p>
          <button
            onClick={() => setR18Confirmed(true)}
            className="w-full py-2 rounded-lg bg-red-500/20 border border-red-500/40 text-xs font-medium text-red-400 hover:bg-red-500/30 transition-colors"
          >
            {displayLang === 'zh' ? '我已年满18岁，确认进入' : 'I am 18+, confirm to enter'}
          </button>
        </div>
      )}

      {/* Tag Content */}
      {canShowTags ? (
        <div className="flex-1 overflow-y-auto px-3 py-2 min-h-0">
          {filteredSubCategories.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <Tag size={32} className="mb-2 opacity-30" />
              <p className="text-xs">
                {displayLang === 'zh' ? '未找到匹配的标签' : 'No matching tags found'}
              </p>
            </div>
          ) : (
            <div className="space-y-4 pb-4">
              {filteredSubCategories.map((sub) => (
                <div key={sub.name}>
                  {filteredSubCategories.length > 1 && (
                    <div className="text-xs font-medium text-slate-500 mb-2 px-1 sticky top-0 bg-bg-surface z-10 py-0.5">
                      {displayLang === 'zh' ? sub.nameZh : sub.name}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {sub.tags.map((tag) => {
                      const isSelected = selectedTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          onClick={() => handleTagClick(tag)}
                          disabled={disabled}
                          className={`
                            px-2 py-1 rounded-md text-xs transition-all border
                            ${isSelected
                              ? 'bg-primary/20 border-primary/40 text-primary'
                              : 'bg-bg-elevated border-border/50 text-slate-300 hover:border-primary/40 hover:text-primary'
                            }
                            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                          `}
                        >
                          {getTagDisplayName(tag, displayLang)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-500">
          <p className="text-xs">
            {displayLang === 'zh' ? '请点击上方按钮确认年龄' : 'Please confirm age above'}
          </p>
        </div>
      )}
    </div>
  );
}
