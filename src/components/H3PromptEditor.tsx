import React, { useMemo, useRef } from 'react';

function esc(t: string) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlight(text: string) {
  let h = esc(text);
  h = h.replace(/&lt;(Subject\s+\d+)&gt;/g, '<span class="rounded px-0.5 bg-sky-500/20 text-sky-300">&lt;$1&gt;</span>');
  h = h.replace(/&lt;(Picture\s+\d+)&gt;/g, '<span class="rounded px-0.5 bg-purple-500/20 text-purple-300">&lt;$1&gt;</span>');
  h = h.replace(/&lt;d&gt;([\s\S]*?)&lt;\/d&gt;/g, '<span class="rounded px-0.5 bg-pink-500/20 text-pink-300">&lt;d&gt;$1&lt;/d&gt;</span>');
  h = h.replace(/(^|[\s（(])@([\w\u4e00-\u9fa5·]+)/g, '$1<span class="rounded px-0.5 bg-emerald-500/20 text-emerald-300">@$2</span>');
  return h + '\n';
}

export function H3PromptEditor({
  value,
  onChange,
  refNames = [],
  refImages = [],
  rows = 16,
}: {
  value: string;
  onChange: (v: string) => void;
  refNames?: string[];
  refImages?: Array<{ name: string; url: string }>;
  rows?: number;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const hlRef = useRef<HTMLPreElement>(null);

  const html = useMemo(() => highlight(value), [value]);
  const anchors = useMemo(() => {
    const subs = [...value.matchAll(/<Subject\s+(\d+)>\s*(?:是|is)?\s*(@[\w\u4e00-\u9fa5·]+)/g)].map(m => `S${m[1]} ${m[2]}`);
    const pics = [...value.matchAll(/<Picture\s+(\d+)>/g)].map(m => `<Picture ${m[1]}>`);
    const dlgs = [...value.matchAll(/<d>([\s\S]*?)<\/d>/g)].map(m => m[1].replace(/^\[Chinese\]\s*/, ''));
    const uniq = (a: string[]) => [...new Set(a)];
    return { subs: uniq(subs), pics: uniq(pics), dlgs: uniq(dlgs) };
  }, [value]);

  const insert = (text: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const a = ta.selectionStart || 0;
    const b = ta.selectionEnd || 0;
    const next = value.slice(0, a) + text + value.slice(b);
    onChange(next);
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = a + text.length;
      ta.focus();
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
        <select
          className="text-[10px] px-1.5 py-0.5 rounded bg-bg-elevated border border-border text-text-secondary"
          defaultValue=""
          onChange={(e) => { if (e.target.value) insert(`@${e.target.value} `); e.target.value = ''; }}
        >
          <option value="">@ 参考资产</option>
          {refNames.map(n => <option key={n} value={n}>@{n}</option>)}
        </select>
        <button type="button" onClick={() => insert('<d>[Chinese] </d>')} className="text-[10px] px-1.5 py-0.5 rounded bg-pink-500/10 border border-pink-500/40 text-pink-300"># 台词</button>
        <span className="text-[10px] text-text-tertiary">@ 插入参考， # 插入 &lt;d&gt; 台词块</span>
      </div>
      <div className="relative">
        <pre
          ref={hlRef}
          aria-hidden
          className="absolute inset-0 m-0 px-3 py-2 rounded-lg bg-bg-elevated border border-border text-xs leading-5 font-mono whitespace-pre-wrap break-words overflow-auto pointer-events-none text-text-primary"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <textarea
          ref={taRef}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => { if (hlRef.current) { hlRef.current.scrollTop = e.currentTarget.scrollTop; hlRef.current.scrollLeft = e.currentTarget.scrollLeft; } }}
          className="relative w-full px-3 py-2 rounded-lg bg-transparent border border-border text-xs text-transparent caret-sky-300 placeholder-slate-600 focus:outline-none focus:border-primary/50 resize-y font-mono leading-5"
          style={{ minHeight: rows * 20 + 16 }}
          placeholder={'[Shot 1] …\n<Subject 1> is <Picture 1> …\n<d>[Chinese] 台词</d>'}
        />
      </div>
      <div className="flex flex-wrap gap-1 mt-1.5 text-[10px]">
        {anchors.subs.map(s => <span key={s} className="px-1.5 py-0.5 rounded-full border border-sky-500/30 text-sky-300">{s}</span>)}
        {anchors.pics.map(p => {
          const n = Number((p.match(/\d+/) || ['1'])[0]);
          const img = refImages[n - 1];
          return (
            <span key={p} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-purple-500/30 text-purple-300">
              {img?.url ? <img src={img.url} alt={p} className="w-5 h-5 rounded-full object-cover border border-purple-500/40" /> : null}
              {p}{img?.name ? <span className="text-[9px] text-purple-200/80">{img.name}</span> : null}
            </span>
          );
        })}
        {anchors.dlgs.slice(0, 8).map(d => <span key={d} className="px-1.5 py-0.5 rounded-full border border-pink-500/30 text-pink-300">“{d}”</span>)}
        {!anchors.subs.length && !anchors.pics.length && !anchors.dlgs.length && (
          <span className="px-1.5 py-0.5 rounded-full border border-border text-text-tertiary">未检测到锚点/台词</span>
        )}
      </div>
    </div>
  );
}
