import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import type { ToastMessage } from '../types';

let toastIdCounter = 0;

// ── Context ──────────────────────────────────────────────────────────────────

interface ToastContextValue {
  toasts: ToastMessage[];
  addToast: (message: string, type?: ToastMessage['type'], duration?: number) => string;
  removeToast: (id: string) => void;
  success: (msg: string) => string;
  error: (msg: string) => string;
  warning: (msg: string) => string;
  info: (msg: string) => string;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // 组件卸载时清理所有 timer
  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastMessage['type'] = 'info', duration = 4000) => {
      const id = `toast-${++toastIdCounter}`;
      const toast: ToastMessage = { id, type, message };
      setToasts((prev) => [...prev, toast]);

      const timer = setTimeout(() => {
        removeToast(id);
      }, duration);
      timersRef.current.set(id, timer);

      return id;
    },
    [removeToast]
  );

  const success = useCallback((msg: string) => addToast(msg, 'success'), [addToast]);
  const error = useCallback((msg: string) => addToast(msg, 'error'), [addToast]);
  const warning = useCallback((msg: string) => addToast(msg, 'warning'), [addToast]);
  const info = useCallback((msg: string) => addToast(msg, 'info'), [addToast]);

  const value: ToastContextValue = { toasts, addToast, removeToast, success, error, warning, info };

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * 全局共享的 Toast hook。
 * 必须在 ToastProvider 内部使用。
 * 返回的 toasts 数组和操作函数由 Context 全局共享。
 */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast() 必须在 <ToastProvider> 内部调用');
  }
  return ctx;
}
