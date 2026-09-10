/**
 * Blob URL 生命周期管理工具
 *
 * 问题：组件里调用 URL.createObjectURL(blob) 生成的临时 URL 在组件卸载时不会自动释放。
 * 长时间停留的页面（比如 HistoryPage 一直开着）累积大量 blob URL 会导致内存泄漏，
 * 直到浏览器 tab 关闭才回收。
 *
 * 用法：
 *   const trackerRef = useRef<BlobUrlTracker | null>(null);
 *   useEffect(() => {
 *     trackerRef.current = new BlobUrlTracker();
 *     return () => trackerRef.current?.revokeAll();
 *   }, []);
 *
 *   const url = trackerRef.current?.create(blob) ?? URL.createObjectURL(blob);
 *
 * 性能数据：每张 500KB 的图片 blob URL 会占用约 0.5MB 内存，泄漏 100 张就是 50MB。
 */

export class BlobUrlTracker {
  private urls = new Set<string>();

  /** 创建一个被追踪的 blob URL，组件卸载时会自动 revoke */
  create(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.urls.add(url);
    return url;
  }

  /** 手动释放单个 URL（如果某个组件提前完成了使用） */
  revoke(url: string): void {
    if (this.urls.has(url)) {
      URL.revokeObjectURL(url);
      this.urls.delete(url);
    }
  }

  /** 释放所有当前追踪的 URL — 在 useEffect cleanup 调用 */
  revokeAll(): void {
    for (const url of this.urls) {
      URL.revokeObjectURL(url);
    }
    this.urls.clear();
  }

  /** 当前追踪的 URL 数量（用于调试） */
  size(): number {
    return this.urls.size;
  }
}
