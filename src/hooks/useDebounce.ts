import { useEffect, useState } from 'react';

/**
 * 防抖 Hook：value 在 delay 毫秒内不变才会更新返回的 debouncedValue。
 *
 * 用途：搜索框、提示词编辑等高频输入场景。
 * 直接 setState 会导致每次按键都触发 filter / 校验 / 网络请求，
 * 加 200-300ms 防抖可显著降低 CPU 占用和重渲染次数。
 *
 * 用法：
 *   const [input, setInput] = useState('');
 *   const debouncedInput = useDebounce(input, 250);
 *   useEffect(() => { runSearch(debouncedInput); }, [debouncedInput]);
 */
export function useDebounce<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
