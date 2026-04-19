import React from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import type { ToastMessage } from '../types';

interface ToastProps {
  toasts: ToastMessage[];
  onRemove: (id: string) => void;
}

const icons = {
  success: <CheckCircle size={18} className="text-green-400" />,
  error: <AlertCircle size={18} className="text-red-400" />,
  warning: <AlertTriangle size={18} className="text-yellow-400" />,
  info: <Info size={18} className="text-blue-400" />,
};

const bgColors = {
  success: 'bg-green-500/15 border-green-500/30',
  error: 'bg-red-500/15 border-red-500/30',
  warning: 'bg-yellow-500/15 border-yellow-500/30',
  info: 'bg-blue-500/15 border-blue-500/30',
};

export function Toast({ toasts, onRemove }: ToastProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none max-w-[480px] mx-auto">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`
            pointer-events-auto flex items-start gap-3 p-3 rounded-xl border backdrop-blur-sm
            animate-fade-in shadow-lg
            ${bgColors[toast.type]}
          `}
        >
          <span className="flex-shrink-0 mt-0.5">{icons[toast.type]}</span>
          <p className="flex-1 text-sm text-slate-100">{toast.message}</p>
          <button
            onClick={() => onRemove(toast.id)}
            className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={14} className="text-slate-400" />
          </button>
        </div>
      ))}
    </div>
  );
}
