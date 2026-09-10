import { useEffect } from 'react';

/**
 * 全局键盘快捷键注册 Hook
 *
 * 用法：
 *   useHotkeys([
 *     { key: 'Enter', cmdOrCtrl: true, handler: () => handleSubmit() },
 *     { key: 'Escape', handler: () => handleCancel() },
 *   ]);
 *
 * 注意：
 * - handler 返回 false 时会阻止浏览器默认行为
 * - cmdOrCtrl 自动适配 Mac (meta) / Windows (ctrl)
 * - input/textarea 中按 Enter 默认会换行 — 调用方需要在 handler 中自行判断
 */
export interface HotkeyBinding {
  /** 键名（不区分大小写），如 'Enter' / 'Escape' / 'k' */
  key: string;
  /** 是否需要 Cmd (Mac) / Ctrl (Windows) 修饰键 */
  cmdOrCtrl?: boolean;
  /** 是否需要 Shift 修饰键 */
  shift?: boolean;
  /** 是否需要 Alt/Option 修饰键 */
  alt?: boolean;
  /** 快捷键触发回调 */
  handler: (e: KeyboardEvent) => void | false;
  /** 是否阻止浏览器默认行为（默认 true） */
  preventDefault?: boolean;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function useHotkeys(bindings: HotkeyBinding[], enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // 跳过纯 Enter 在编辑控件里触发（避免误触发生成按钮）
      // 用户在 Cmd+Enter 时仍可触发，因为编辑控件一般不拦截 Cmd 组合键
      for (const b of bindings) {
        const keyMatch = e.key.toLowerCase() === b.key.toLowerCase();
        if (!keyMatch) continue;

        if (b.cmdOrCtrl) {
          const ctrl = e.ctrlKey || e.metaKey;
          if (!ctrl) continue;
        }
        if (b.shift && !e.shiftKey) continue;
        if (!b.shift && e.shiftKey) continue;
        if (b.alt && !e.altKey) continue;

        // 非 Cmd 修饰的快捷键在编辑控件里不响应（避免吞掉正常输入）
        // Cmd+Enter / Cmd+K 等仍然可以触发
        if (!b.cmdOrCtrl && isEditableTarget(e.target)) continue;

        if (b.preventDefault !== false) e.preventDefault();
        const result = b.handler(e);
        if (result === false) e.preventDefault();
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bindings, enabled]);
}
