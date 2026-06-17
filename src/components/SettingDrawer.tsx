import React, { useState, useEffect, useRef } from 'react';
import { X, Eye, EyeOff, Check, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

interface SettingDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: string | null;
  maskedKey: string;
  onSave: (key: string) => void;
  onClear: () => void;
}

export function SettingDrawer({
  isOpen,
  onClose,
  apiKey,
  maskedKey,
  onSave,
  onClear,
}: SettingDrawerProps) {
  const [inputKey, setInputKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setInputKey(apiKey || '');
      setSaveSuccess(false);
      setIsExpanded(true);
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen, apiKey]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEsc);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  const handleSave = () => {
    const trimmed = inputKey.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  const handleClear = () => {
    onClear();
    setInputKey('');
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Desktop: full overlay + right panel */}
      <div className="hidden lg:block fixed inset-0 z-50 flex justify-end">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose} />
        <div
          ref={drawerRef}
          className="relative w-full max-w-sm h-full bg-bg-surface border-l border-border animate-slide-in-right flex flex-col"
        >
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-border bg-bg-surface z-10">
            <h2 className="text-base font-semibold text-text-primary">API 设置</h2>
            <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-bg-elevated transition-colors" aria-label="Close">
              <X size={18} className="text-text-secondary" />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
            <ContentSection
              inputKey={inputKey}
              showKey={showKey}
              saveSuccess={saveSuccess}
              maskedKey={maskedKey}
              apiKey={apiKey}
              onInputChange={setInputKey}
              onToggleKey={setShowKey}
              onSave={handleSave}
              onClear={handleClear}
              inputRef={inputRef}
            />
          </div>
        </div>
      </div>

      {/* Mobile: half-cover — no overlay, page stays interactive */}
      <div className="lg:hidden fixed inset-y-0 right-0 z-50 flex">
        {/* Tappable dismiss area on the left edge */}
        <div className="flex-1" onClick={onClose} />
        <div
          ref={drawerRef}
          className="relative w-full max-w-[85vw] bg-bg-surface border-l border-border animate-slide-in-right flex flex-col"
          style={{ height: '100dvh', paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-surface">
            <h2 className="text-base font-semibold text-text-primary">API 设置</h2>
            <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-bg-elevated transition-colors" aria-label="Close">
              <X size={18} className="text-text-secondary" />
            </button>
          </div>

          {/* Collapse handle bar — always visible */}
          <button
            onClick={() => setIsExpanded((v) => !v)}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium border-b border-border/50 transition-colors active:bg-bg-elevated"
          >
            {isExpanded ? (
              <>
                <ChevronUp size={14} className="text-primary" />
                <span className="text-primary">收起详情</span>
              </>
            ) : (
              <>
                <ChevronDown size={14} className="text-text-secondary" />
                <span className="text-text-secondary">展开详情</span>
              </>
            )}
          </button>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto">
            <div
              className={`
                transition-all duration-300 ease-in-out
                p-4 space-y-5
                ${isExpanded ? 'max-h-[2000px] opacity-100 py-4' : 'max-h-0 opacity-0 overflow-hidden py-0'}
              `}
            >
              <ContentSection
                inputKey={inputKey}
                showKey={showKey}
                saveSuccess={saveSuccess}
                maskedKey={maskedKey}
                apiKey={apiKey}
                onInputChange={setInputKey}
                onToggleKey={setShowKey}
                onSave={handleSave}
                onClear={handleClear}
                inputRef={inputRef}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

interface ContentSectionProps {
  inputKey: string;
  showKey: boolean;
  saveSuccess: boolean;
  maskedKey: string;
  apiKey: string | null;
  onInputChange: (v: string) => void;
  onToggleKey: (v: boolean) => void;
  onSave: () => void;
  onClear: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
}

function ContentSection({
  inputKey,
  showKey,
  saveSuccess,
  maskedKey,
  apiKey,
  onInputChange,
  onToggleKey,
  onSave,
  onClear,
  inputRef,
}: ContentSectionProps) {
  return (
    <>
      <div className="space-y-3">
        <label className="block text-sm font-medium text-text-primary">
          RunningHub API Key
        </label>

        {apiKey && (
          <div className="flex items-center gap-2 text-xs text-green-400 bg-green-400/10 px-3 py-2 rounded-lg">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
            当前已保存: {maskedKey}
          </div>
        )}

        <div className="relative">
          <input
            ref={inputRef}
            type={showKey ? 'text' : 'password'}
            value={inputKey}
            onChange={(e) => onInputChange(e.target.value)}
            placeholder="请输入 32 位 API Key"
            className="w-full bg-bg-elevated border border-border rounded-lg px-4 py-3 pr-12 text-sm text-text-primary placeholder:text-gray-400 focus:outline-none focus:border-primary transition-colors"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => onToggleKey(!showKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
          >
            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        <p className="text-xs text-text-secondary">
          获取 API Key: 登录 RunningHub → 右上角头像 → API 控制台
        </p>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onSave}
          disabled={!inputKey.trim()}
          className={`
            flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-medium text-sm transition-all
            ${
              inputKey.trim()
                ? 'bg-gradient-to-r from-primary to-primary/80 text-white hover:opacity-90 active:scale-[0.98]'
                : 'bg-bg-elevated text-text-secondary cursor-not-allowed'
            }
          `}
        >
          {saveSuccess ? (
            <>
              <Check size={16} />
              已保存
            </>
          ) : (
            '保存 Key'
          )}
        </button>

        {apiKey && (
          <button
            onClick={onClear}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium text-sm bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
          >
            <Trash2 size={16} />
            清除
          </button>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="text-sm font-medium text-text-primary mb-2">使用说明</h3>
        <ol className="space-y-2 text-xs text-text-secondary">
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-medium">1</span>
            在 RunningHub 注册账号并开通会员
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-medium">2</span>
            获取 API Key 并填入上方输入框
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-medium">3</span>
            目标工作流需在网页端至少运行过一次
          </li>
        </ol>
      </div>
    </>
  );
}
