import React from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import type { ToastMessage } from '../types';

interface ToastProps {
  toasts: ToastMessage[];
  onRemove: (id: string) => void;
}

const icons = {
  success: <CheckCircle size={18} className="text-green-600" />,
  error: <AlertCircle size={18} className="text-red-500" />,
  warning: <AlertTriangle size={18} className="text-yellow-600" />,
  info: <Info size={18} className="text-blue-500" />,
};

const bgColors = {
  success: 'bg-green-50 border-green-200',
  error: 'bg-red-50 border-red-200',
  warning: 'bg-yellow-50 border-yellow-200',
  info: 'bg-blue-50 border-blue-200',
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
          <p className="flex-1 text-sm text-text-primary">{toast.message}</p>
          <button
            onClick={() => onRemove(toast.id)}
            className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-lg hover:bg-black/5 transition-colors"
          >
            <X size={14} className="text-text-tertiary" />
          </button>
        </div>
      ))}
    </div>
  );
}
