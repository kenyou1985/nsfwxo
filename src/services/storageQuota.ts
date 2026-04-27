/**
 * Storage quota utilities.
 * Uses the Storage Manager API (navigator.storage.estimate()) to detect
 * the real available quota for this origin, then derives safe cache limits.
 */

const MB = 1024 * 1024;
const QUOTA_RESERVE_MB = 5; // Reserve 5MB for non-cache localStorage keys (API keys, history, sessions, etc.)

export interface StorageStats {
  totalBytes: number;       // Total quota in bytes (from navigator.storage.estimate)
  usedBytes: number;        // Total used by this origin
  localStorageBytes: number; // Bytes used specifically by our app's localStorage keys
  cacheBytes: number;       // Bytes used by the unified image cache
  availableBytes: number;   // Remaining bytes available
  usagePercent: number;     // usedBytes / totalBytes * 100
  warnPercent: number;      // localStorageBytes / availableBytes * 100 (storage pressure warning)
  detectedQuotaMB: number | null;
  isLowSpace: boolean;      // true if available space < 20% of quota
}

export interface StorageQuota {
  /** Hard limit for all image caches combined (bytes). */
  totalCacheLimit: number;
  /** Maximum per single image (bytes). */
  perImageLimit: number;
  /** How many MB the quota system has detected. */
  detectedQuotaMB: number | null;
}

/**
 * Detect the storage quota for this origin.
 * Returns immediately with conservative defaults if the API is unavailable.
 */
export async function detectStorageQuota(): Promise<StorageQuota> {
  const PER_IMAGE_MB = 5;

  try {
    if (navigator.storage && typeof navigator.storage.estimate === 'function') {
      const estimate = await navigator.storage.estimate();
      const quota = estimate.quota ?? 0;
      const usage = estimate.usage ?? 0;
      const available = quota - usage;

      // Hard cap: leave QUOTA_RESERVE_MB for non-cache data
      const usable = Math.max(available - QUOTA_RESERVE_MB * MB, 0);
      const totalCacheLimit = Math.floor(usable);

      // No point caching images larger than 5MB each
      const perImageLimit = PER_IMAGE_MB * MB;

      const detectedQuotaMB = Math.round(quota / MB);
      console.debug(
        `[StorageQuota] Detected ${detectedQuotaMB}MB quota, ` +
          `${Math.round(usage / MB)}MB used, ~${Math.round(usable / MB)}MB available for cache`
      );

      return { totalCacheLimit, perImageLimit, detectedQuotaMB };
    }
  } catch (e) {
    console.warn('[StorageQuota] estimate() failed, using fallback limits:', e);
  }

  // Fallback: assume modern browsers give at least 50MB per origin
  return {
    totalCacheLimit: 50 * MB,
    perImageLimit: PER_IMAGE_MB * MB,
    detectedQuotaMB: null,
  };
}

/**
 * Get detailed storage statistics for display in the UI.
 * This is a sync approximation for immediate UI display; async for precise quota.
 */
export function getLocalStorageStats(): {
  localStorageBytes: number;
  breakdown: { key: string; bytes: number }[];
} {
  let totalBytes = 0;
  const breakdown: { key: string; bytes: number }[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    try {
      const value = localStorage.getItem(key) || '';
      const bytes = (key.length + value.length) * 2; // UTF-16
      totalBytes += bytes;
      breakdown.push({ key, bytes });
    } catch {
      // skip
    }
  }

  return { localStorageBytes: totalBytes, breakdown };
}

/**
 * Get the unified image cache size.
 */
export function getUnifiedCacheStats(): { cacheBytes: number; entryCount: number } {
  try {
    const raw = localStorage.getItem('uni_img_store_v2');
    if (!raw) return { cacheBytes: 0, entryCount: 0 };
    const store = JSON.parse(raw) as Record<string, { sizeBytes: number }>;
    const cacheBytes = Object.values(store).reduce((sum, e) => sum + (e.sizeBytes || 0), 0);
    return { cacheBytes, entryCount: Object.keys(store).length };
  } catch {
    return { cacheBytes: 0, entryCount: 0 };
  }
}

/**
 * Get comprehensive storage stats for UI display.
 * Tries navigator.storage.estimate for quota, falls back to rough estimates.
 */
export async function getStorageStats(): Promise<StorageStats> {
  let totalBytes = 0;
  let usedBytes = 0;
  let availableBytes = 0;
  let detectedQuotaMB: number | null = null;

  try {
    if (navigator.storage && typeof navigator.storage.estimate === 'function') {
      const est = await navigator.storage.estimate();
      totalBytes = est.quota ?? 0;
      usedBytes = est.usage ?? 0;
      availableBytes = totalBytes - usedBytes;
      if (totalBytes > 0) {
        detectedQuotaMB = Math.round(totalBytes / MB);
      }
    }
  } catch {
    // ignore
  }

  const { localStorageBytes } = getLocalStorageStats();
  const { cacheBytes } = getUnifiedCacheStats();

  const usagePercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;
  const warnPercent = availableBytes > 0 ? Math.round((localStorageBytes / availableBytes) * 100) : 0;
  const isLowSpace = availableBytes < totalBytes * 0.2;

  return {
    totalBytes,
    usedBytes,
    localStorageBytes,
    cacheBytes,
    availableBytes,
    usagePercent,
    warnPercent,
    detectedQuotaMB,
    isLowSpace,
  };
}

/** Singleton promise — resolves once, reuses the result. */
let _quotaPromise: Promise<StorageQuota> | null = null;

export async function getStorageQuota(): Promise<StorageQuota> {
  if (!_quotaPromise) {
    _quotaPromise = detectStorageQuota();
  }
  return _quotaPromise;
}

/** Re-measure quota (call after clearing a lot of data if you want updated limits). */
export function refreshStorageQuota(): void {
  _quotaPromise = null;
}
