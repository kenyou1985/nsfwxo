import React, { useState, useEffect, useRef } from 'react';
import { X, Eye, EyeOff, Check, Trash2 } from 'lucide-react';

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
  const inputRef = useRef<HTMLInputElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setInputKey(apiKey || '');
      setSaveSuccess(false);
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
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div
        ref={drawerRef}
        className="relative w-full max-w-sm h-full bg-bg-surface border-l border-border animate-slide-in-right overflow-y-auto"
      >
        <div className="sticky top-0 bg-bg-surface z-10 flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-slate-100">API 设置</h2>
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-bg-elevated transition-colors"
            aria-label="Close"
          >
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        <div className="p-4 space-y-6">
          <div className="space-y-3">
            <label className="block text-sm font-medium text-slate-300">
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
                onChange={(e) => setInputKey(e.target.value)}
                placeholder="请输入 32 位 API Key"
                className="w-full bg-bg-elevated border border-border rounded-lg px-4 py-3 pr-12 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-primary transition-colors"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-200 transition-colors"
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            <p className="text-xs text-slate-500">
              获取 API Key: 登录 RunningHub → 右上角头像 → API 控制台
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={!inputKey.trim()}
              className={`
                flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-medium text-sm transition-all
                ${
                  inputKey.trim()
                    ? 'bg-gradient-to-r from-primary to-primary/80 text-white hover:opacity-90 active:scale-[0.98]'
                    : 'bg-bg-elevated text-slate-500 cursor-not-allowed'
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
                onClick={handleClear}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium text-sm bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
              >
                <Trash2 size={16} />
                清除
              </button>
            )}
          </div>

          <div className="border-t border-border pt-4">
            <h3 className="text-sm font-medium text-slate-300 mb-2">使用说明</h3>
            <ol className="space-y-2 text-xs text-slate-500">
              <li className="flex gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-medium">
                  1
                </span>
                在 RunningHub 注册账号并开通会员
              </li>
              <li className="flex gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-medium">
                  2
                </span>
                获取 API Key 并填入上方输入框
              </li>
              <li className="flex gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-medium">
                  3
                </span>
                目标工作流需在网页端至少运行过一次
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
