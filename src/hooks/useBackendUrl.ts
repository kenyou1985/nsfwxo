import { useState, useEffect, useCallback } from 'react';
import {
  getBackendUrl,
  setBackendUrl as saveBackendUrl,
  clearBackendUrl,
  getDefaultBackendUrl,
} from '../services/storage';

export function useBackendUrl() {
  const [backendUrl, setBackendUrlState] = useState<string>(getDefaultBackendUrl());
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setBackendUrlState(getBackendUrl());
    setIsLoaded(true);
  }, []);

  const saveBackendUrlFn = useCallback((url: string) => {
    saveBackendUrl(url);
    setBackendUrlState(url);
  }, []);

  const resetBackendUrl = useCallback(() => {
    clearBackendUrl();
    setBackendUrlState(getDefaultBackendUrl());
  }, []);

  return {
    backendUrl,
    isLoaded,
    saveBackendUrl: saveBackendUrlFn,
    resetBackendUrl,
    defaultUrl: getDefaultBackendUrl(),
  };
}
