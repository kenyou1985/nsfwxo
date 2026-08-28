import React from 'react';
import { Film, Copy, Check, Wand2, Loader2, Eye, RefreshCw } from 'lucide-react';
import type { GridPanel } from '../services/storage';

interface GridPanelEditorProps {
  panels: GridPanel[];
  gridSize: number;
  fullPrompt: string;
  onUpdatePanel: (idx: number, field: 'scene_description' | 'image_prompt', value: string) => void;
  onFullPromptChange: (prompt: string) => void;
  onGenerateImages: () => void;
  onRedrawPanel?: (idx: number) => void;
  isGenerating: boolean;
  redrawPanelIdx?: number | null;
  displayLang: 'en' | 'zh';
}

export function GridPanelEditor({
  panels,
  gridSize,
  fullPrompt,
  onUpdatePanel,
  onFullPromptChange,
  onGenerateImages,
  onRedrawPanel,
  isGenerating,
  redrawPanelIdx,
  displayLang,
}: GridPanelEditorProps) {
  const [copiedIdx, setCopiedIdx] = React.useState<number | null>(null);
  const [showFullPrompt, setShowFullPrompt] = React.useState(true);

  const handleCopy = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const handleCopyFullPrompt = async () => {
    try {
      await navigator.clipboard.writeText(fullPrompt);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = fullPrompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedIdx(-1);
    setTimeout(() => setCopiedIdx(null), 3000);
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Film size={14} className="text-purple-500" />
          <span className="text-xs font-medium text-purple-700">
            {displayLang === 'zh' ? `编辑分镜 (${gridSize}格)` : `Edit Panels (${gridSize})`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFullPrompt(!showFullPrompt)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors ${
              showFullPrompt
                ? 'bg-purple-100 text-purple-700'
                : 'bg-white border border-border text-text-secondary hover:text-purple-600 hover:border-purple-300'
            }`}
          >
            <Eye size={10} />
            <span>{displayLang === 'zh' ? '完整提示词' : 'Full Prompt'}</span>
          </button>
          <button
            onClick={handleCopyFullPrompt}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-white border border-border text-text-secondary hover:text-purple-600 hover:border-purple-300 transition-colors"
          >
            {copiedIdx === -1 ? <Check size={10} /> : <Copy size={10} />}
            <span>{displayLang === 'zh' ? '复制全部' : 'Copy All'}</span>
          </button>
        </div>
      </div>

      {/* Full prompt editor (collapsible) */}
      {showFullPrompt && (
        <div className="bg-purple-50/50 rounded-lg p-3 border border-purple-100">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-purple-600 font-medium">
              {displayLang === 'zh' ? '完整九宫格提示词（一次性生成一张图）' : 'Full Grid Prompt (generates one image)'}
            </span>
          </div>
          <textarea
            value={fullPrompt}
            onChange={(e) => onFullPromptChange(e.target.value)}
            rows={8}
            className="w-full px-3 py-2 rounded-md border border-purple-200 bg-white text-[11px] text-text-primary font-mono resize-y focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-200"
            placeholder={displayLang === 'zh' ? '完整的九宫格分镜提示词...' : 'Full grid storyboard prompt...'}
          />
        </div>
      )}

      {/* Individual panel descriptions with edit + redraw */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-text-tertiary font-medium">
            {displayLang === 'zh' ? '各镜场景描述（可编辑 / 可单独重绘）' : 'Panel Descriptions (editable / redrawable)'}
          </span>
          <span className="text-[9px] text-text-tertiary bg-bg-elevated px-1.5 py-0.5 rounded">
            {displayLang === 'zh' ? '✏️ 点击文字编辑' : '✏️ Click to edit'}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {panels.map((panel, idx) => (
            <div
              key={panel.panel_number}
              className={`rounded-lg p-2.5 border transition-colors ${
                redrawPanelIdx === idx
                  ? 'border-orange-300 bg-orange-50/50'
                  : 'border-purple-100/60 bg-white/70 hover:border-purple-200'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-purple-500 text-white text-[9px] font-bold">
                    {panel.panel_number}
                  </span>
                  <span className="text-[10px] text-purple-600 font-medium">
                    {displayLang === 'zh' ? '镜' : 'Panel'}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {onRedrawPanel && (
                    <button
                      onClick={() => onRedrawPanel(idx)}
                      disabled={redrawPanelIdx === idx}
                      className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] text-orange-500 hover:bg-orange-50 transition-colors disabled:opacity-50"
                      title={displayLang === 'zh' ? '单独重绘此镜' : 'Redraw this panel'}
                    >
                      {redrawPanelIdx === idx ? (
                        <Loader2 size={9} className="animate-spin" />
                      ) : (
                        <RefreshCw size={9} />
                      )}
                      <span>{displayLang === 'zh' ? '重绘' : 'Redraw'}</span>
                    </button>
                  )}
                  <button
                    onClick={() => handleCopy(panel.image_prompt, idx)}
                    className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] text-text-tertiary hover:text-purple-500 transition-colors"
                  >
                    {copiedIdx === idx ? (
                      <><Check size={9} className="text-green-400" /> {displayLang === 'zh' ? '已复制' : 'Copied'}</>
                    ) : (
                      <><Copy size={9} /> {displayLang === 'zh' ? '复制' : 'Copy'}</>
                    )}
                  </button>
                </div>
              </div>
              <textarea
                value={panel.scene_description}
                onChange={(e) => onUpdatePanel(idx, 'scene_description', e.target.value)}
                rows={2}
                className="w-full px-2 py-1 rounded-md border border-purple-100 bg-white text-[10px] text-text-primary resize-none focus:outline-none focus:border-purple-300 focus:ring-1 focus:ring-purple-200"
                placeholder={displayLang === 'zh' ? '描述这个镜头的场景...' : 'Describe this scene...'}
              />
              {/* Image prompt preview (editable) */}
              <details className="mt-1">
                <summary className="text-[9px] text-text-tertiary cursor-pointer hover:text-purple-500">
                  {displayLang === 'zh' ? '编辑英文提示词' : 'Edit English Prompt'}
                </summary>
                <textarea
                  value={panel.image_prompt}
                  onChange={(e) => onUpdatePanel(idx, 'image_prompt', e.target.value)}
                  rows={3}
                  className="w-full mt-1 px-2 py-1 rounded-md border border-purple-100 bg-white text-[9px] text-text-primary font-mono resize-none focus:outline-none focus:border-purple-300"
                  placeholder={displayLang === 'zh' ? '英文提示词...' : 'English prompt...'}
                />
              </details>
            </div>
          ))}
        </div>
      </div>

      {/* Generate button */}
      <button
        onClick={onGenerateImages}
        disabled={isGenerating}
        className="w-full py-2.5 rounded-lg text-[11px] font-medium bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
      >
        <span className="flex items-center justify-center gap-1.5">
          {isGenerating ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Wand2 size={12} />
          )}
          {displayLang === 'zh'
            ? '生成一张九宫格分镜图片'
            : 'Generate Grid Storyboard Image'}
        </span>
      </button>
    </div>
  );
}
