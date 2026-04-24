/**
 * Storage quota utilities.
 * Uses the Storage Manager API (navigator.storage.estimate()) to detect
 * the real available quota for this origin, then derives safe cache limits.
 */

const QUOTA_RESERVE_MB = 20; // Reserve 20MB for non-cache localStorage keys (API keys, history, etc.)

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
  const MB = 1024 * 1024;
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
