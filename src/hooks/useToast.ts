import { useState, useCallback, useRef } from 'react';
import type { ToastMessage } from '../types';

let toastIdCounter = 0;

export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastMessage['type'] = 'info', duration = 4000) => {
      const id = `toast-${++toastIdCounter}`;
      const toast: ToastMessage = { id, type, message };

      setToasts((prev) => [...prev, toast]);

      const timer = setTimeout(() => {
        removeToast(id);
        timersRef.current.delete(id);
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

  return {
    toasts,
    addToast,
    removeToast,
    success,
    error,
    warning,
    info,
  };
}
