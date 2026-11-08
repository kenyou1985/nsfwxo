import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getApiKey, setApiKey, clearApiKey,
  getConsumerApiKey, setConsumerApiKey, clearConsumerApiKey,
  getRhApiTier, setRhApiTier,
  detectRhKeyTier, maskApiKey, type RhApiTier,
} from '../services/storage';

export function useApiKey() {
  const [enterpriseKey, setEnterpriseKeyState] = useState<string | null>(null);
  const [consumerKey, setConsumerKeyState] = useState<string | null>(null);
  const [apiTier, setApiTierState] = useState<RhApiTier>('enterprise');
  const [isLoaded, setIsLoaded] = useState(false);
  const autoCheckedRef = useRef(false);

  useEffect(() => {
    const ent = getApiKey();
    const con = getConsumerApiKey();
    setEnterpriseKeyState(ent);
    setConsumerKeyState(con);
    setApiTierState(getRhApiTier());
    setIsLoaded(true);
  }, []);

  // 老版本把消费级 Key 存在企业级字段：启动时自动识别并迁移，避免用户必须手动重存。
  useEffect(() => {
    if (!isLoaded || autoCheckedRef.current) return;
    if (!enterpriseKey) return;
    autoCheckedRef.current = true;
    void detectRhKeyTier(enterpriseKey).then((detected) => {
      if (detected !== 'consumer') return;
      setConsumerApiKey(enterpriseKey);
      setConsumerKeyState(enterpriseKey);
      setRhApiTier('consumer');
      setApiTierState('consumer');
      clearApiKey();
      setEnterpriseKeyState(null);
    });
  }, [isLoaded, enterpriseKey, consumerKey]);

  const saveEnterpriseKey = useCallback(async (key: string) => {
    const trimmed = key.trim();
    // 企业级输入框里误贴消费级 Key 时，自动迁移到消费级并切通道，避免 tier=enterprise 仍触发自杀链。
    const detected = await detectRhKeyTier(trimmed);
    if (detected === 'consumer') {
      setConsumerApiKey(trimmed);
      setConsumerKeyState(trimmed);
      setRhApiTier('consumer');
      setApiTierState('consumer');
      return;
    }
    setApiKey(trimmed);
    setEnterpriseKeyState(trimmed);
  }, []);

  const saveConsumerKey = useCallback((key: string) => {
    setConsumerApiKey(key);
    setConsumerKeyState(key.trim());
    // 保存消费级 Key 即视为选择消费级通道，避免“Key 已是消费级但 tier 仍企业级”导致误走自杀链。
    setRhApiTier('consumer');
    setApiTierState('consumer');
  }, []);

  const changeApiTier = useCallback((tier: RhApiTier) => {
    setRhApiTier(tier);
    setApiTierState(tier);
  }, []);

  const removeEnterpriseKey = useCallback(() => {
    clearApiKey();
    setEnterpriseKeyState(null);
  }, []);

  const removeConsumerKey = useCallback(() => {
    clearConsumerApiKey();
    setConsumerKeyState(null);
  }, []);

  // 兼容旧调用方：保存/清除默认作用在企业级 key 上
  const saveApiKey = saveEnterpriseKey;
  const removeApiKey = removeEnterpriseKey;

  const apiKey = apiTier === 'consumer' ? consumerKey : enterpriseKey;
  const maskedKey = apiKey ? maskApiKey(apiKey) : '';

  return {
    apiKey,
    maskedKey,
    hasApiKey: !!apiKey,
    isLoaded,
    apiTier,
    setApiTier: changeApiTier,
    enterpriseKey,
    consumerKey,
    maskedEnterpriseKey: enterpriseKey ? maskApiKey(enterpriseKey) : '',
    maskedConsumerKey: consumerKey ? maskApiKey(consumerKey) : '',
    saveEnterpriseKey,
    saveConsumerKey,
    removeEnterpriseKey,
    removeConsumerKey,
    saveApiKey,
    removeApiKey,
  };
}
