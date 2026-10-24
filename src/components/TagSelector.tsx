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
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [openSubCategory, setOpenSubCategory] = useState<string | null>(null);
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

  const subCats = activeCat.subCategories && activeCat.subCategories.length > 0
    ? activeCat.subCategories
    : [{ name: 'All', nameZh: '全部', tags: activeCat.tags }];
  const activeSub = subCats.find(x => x.name === openSubCategory) || null;
  const visibleTags = activeSub ? activeSub.tags : subCats.flatMap(x => x.tags);

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* 只显示分类，点击后弹窗选标签 */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-px bg-border-light">
        {TAG_CATEGORY_ORDER.map((catId) => {
          const cat = TAG_CATEGORIES.find((c) => c.id === catId);
          if (!cat) return null;
          return (
            <button
              key={catId}
              onClick={() => {
                setActiveCategory(catId);
                setOpenSubCategory(null);
                setOpenCategory(catId);
                if (catId === 'r18') setR18Confirmed(false);
              }}
              className="flex items-center justify-center gap-1.5 bg-white px-2 py-3 text-xs font-medium text-text-secondary hover:bg-primary-light hover:text-primary transition-colors"
            >
              <span>{cat.icon}</span>
              <span className="truncate">{displayLang === 'zh' ? cat.name : cat.nameEn}</span>
            </button>
          );
        })}
      </div>

      {openCategory && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/60" onClick={() => setOpenCategory(null)}>
          <div className="w-full max-w-xl max-h-[82vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b bg-bg-elevated">
              <span className="text-sm font-semibold">{activeCat.icon} {displayLang === 'zh' ? activeCat.name : activeCat.nameEn}</span>
              <div className="flex items-center gap-2">
                {activeSub && <button onClick={() => setOpenSubCategory(null)} className="text-xs text-text-tertiary">返回分类</button>}
                <button onClick={() => setOpenCategory(null)} className="text-xs text-text-tertiary">关闭</button>
              </div>
            </div>

            {isR18 && !r18Confirmed ? (
              <div className="p-5">
                <p className="text-xs text-red-500 mb-3">该分类包含成人内容，请确认已满 18 岁。</p>
                <button onClick={() => setR18Confirmed(true)} className="w-full py-2 rounded-lg bg-red-100 border border-red-300 text-xs font-medium text-red-600">我已年满18岁，确认进入</button>
              </div>
            ) : !activeSub && subCats.length > 1 ? (
              <div className="p-3 grid grid-cols-2 sm:grid-cols-3 gap-2 overflow-y-auto">
                {subCats.map((sub) => (
                  <button
                    key={sub.name}
                    onClick={() => setOpenSubCategory(sub.name)}
                    className="px-3 py-3 rounded-xl border border-border bg-bg-elevated text-xs font-medium hover:border-primary hover:text-primary"
                  >
                    {displayLang === 'zh' ? sub.nameZh : sub.name}
                    <span className="block mt-1 text-[9px] text-text-tertiary">{sub.tags.length} 个标签</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-4 overflow-y-auto flex flex-wrap gap-1.5">
                {[...new Set(visibleTags)].map((tag) => {
                  const isSelected = selectedTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      onClick={() => handleTagClick(tag)}
                      disabled={disabled}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${isSelected ? 'bg-primary text-white border-primary' : 'bg-bg-elevated border-border text-text-primary hover:border-primary hover:text-primary'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {getTagDisplayName(tag, displayLang)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
