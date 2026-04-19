import { useState, useEffect, useCallback } from 'react';
import { getApiKey, setApiKey, clearApiKey, maskApiKey } from '../services/storage';

export function useApiKey() {
  const [apiKey, setApiKeyState] = useState<string | null>(null);
  const [maskedKey, setMaskedKey] = useState<string>('');
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const stored = getApiKey();
    setApiKeyState(stored);
    setMaskedKey(stored ? maskApiKey(stored) : '');
    setIsLoaded(true);
  }, []);

  const saveApiKey = useCallback((key: string) => {
    setApiKey(key);
    setApiKeyState(key);
    setMaskedKey(maskApiKey(key));
  }, []);

  const removeApiKey = useCallback(() => {
    clearApiKey();
    setApiKeyState(null);
    setMaskedKey('');
  }, []);

  const hasApiKey = !!apiKey;

  return {
    apiKey,
    maskedKey,
    hasApiKey,
    isLoaded,
    saveApiKey,
    removeApiKey,
  };
}
