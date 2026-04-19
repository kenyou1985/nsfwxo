import React from 'react';
import { Sparkles } from 'lucide-react';

interface GenerateButtonProps {
  onClick: () => void;
  isLoading: boolean;
  disabled?: boolean;
  label?: string;
}

export function GenerateButton({
  onClick,
  isLoading,
  disabled = false,
  label = '开始生成',
}: GenerateButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      className={`
        w-full py-4 rounded-xl font-semibold text-base
        flex items-center justify-center gap-2
        transition-all active:scale-[0.98]
        ${
          disabled || isLoading
            ? 'bg-bg-elevated text-slate-500 cursor-not-allowed'
            : 'bg-gradient-to-r from-primary to-secondary text-white hover:opacity-90 shadow-[0_0_20px_rgba(168,85,247,0.3)] hover:shadow-[0_0_30px_rgba(168,85,247,0.5)]'
        }
      `}
    >
      {isLoading ? (
        <>
          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          生成中...
        </>
      ) : (
        <>
          <Sparkles size={20} />
          {label}
        </>
      )}
    </button>
  );
}
