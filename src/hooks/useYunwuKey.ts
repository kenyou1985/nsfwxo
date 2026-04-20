import { useState, useEffect, useCallback } from 'react';
import {
  getYunwuKey,
  setYunwuKey,
  clearYunwuKey,
  maskYunwuKey,
} from '../services/storage';

export function useYunwuKey() {
  const [yunwuKey, setYunwuKeyState] = useState<string | null>(null);
  const [maskedYunwuKey, setMaskedYunwuKey] = useState<string>('');
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const stored = getYunwuKey();
    setYunwuKeyState(stored);
    setMaskedYunwuKey(stored ? maskYunwuKey(stored) : '');
    setIsLoaded(true);
  }, []);

  const saveYunwuKey = useCallback((key: string) => {
    setYunwuKey(key);
    setYunwuKeyState(key);
    setMaskedYunwuKey(maskYunwuKey(key));
  }, []);

  const removeYunwuKey = useCallback(() => {
    clearYunwuKey();
    setYunwuKeyState(null);
    setMaskedYunwuKey('');
  }, []);

  const hasYunwuKey = !!yunwuKey;

  return {
    yunwuKey,
    maskedYunwuKey,
    hasYunwuKey,
    isLoaded,
    saveYunwuKey,
    removeYunwuKey,
  };
}
