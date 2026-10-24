import React, { useMemo, useState } from 'react';
import { TAG_CATEGORIES, TAG_CATEGORY_ORDER, getTagDisplayName } from '../data/tags';

export function TagPickerButton({ onPick, disabled }: { onPick: (tag: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [catId, setCatId] = useState<string | null>(null);
  const cat = useMemo(() => TAG_CATEGORIES.find(c => c.id === catId), [catId]);
  const tags = useMemo(() => {
    if (!cat) return [];
    return [...new Set((cat.subCategories || []).flatMap(s => s.tags).concat(cat.tags || []))];
  }, [cat]);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="px-2 py-1 rounded-md text-[9px] font-medium bg-emerald-100 text-emerald-700 border border-emerald-200 hover:bg-emerald-200 disabled:opacity-50"
      >
        🏷 标签库
      </button>
      {open && (
        <div className="fixed inset-0 z-[320] flex items-center justify-center p-4 bg-black/60" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg max-h-[80vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b bg-bg-elevated">
              <span className="text-sm font-semibold">{cat ? `${cat.icon} ${cat.name}` : '选择标签分类'}</span>
              <div className="flex gap-2">
                {cat && <button onClick={() => setCatId(null)} className="text-xs text-text-tertiary">返回分类</button>}
                <button onClick={() => setOpen(false)} className="text-xs text-text-tertiary">关闭</button>
              </div>
            </div>
            {!cat ? (
              <div className="grid grid-cols-3 gap-2 p-3 overflow-y-auto">
                {TAG_CATEGORY_ORDER.map(id => {
                  const c = TAG_CATEGORIES.find(x => x.id === id);
                  if (!c) return null;
                  return (
                    <button key={id} onClick={() => setCatId(id)} className="px-2 py-2 rounded-lg border border-border bg-bg-elevated text-xs hover:border-primary hover:text-primary">
                      {c.icon} {c.name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="p-3 overflow-y-auto flex flex-wrap gap-1.5">
                {tags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => { onPick(tag); }}
                    className="px-2.5 py-1.5 rounded-lg text-xs border border-border bg-bg-elevated hover:border-primary hover:text-primary"
                  >
                    {getTagDisplayName(tag, 'zh')}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
