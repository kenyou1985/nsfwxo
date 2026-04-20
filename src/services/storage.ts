const STORAGE_KEY = 'rh_api_key';
const YUNWU_KEY = 'yunwu_api_key';
const BACKEND_URL_KEY = 'prompt_backend_url';

export function getApiKey(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setApiKey(key: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, key.trim());
  } catch {
    // storage full or unavailable
  }
}

export function clearApiKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

// ─── Yunwu AI API Key ───────────────────────────────────────────────────────

export function getYunwuKey(): string | null {
  try {
    return localStorage.getItem(YUNWU_KEY);
  } catch {
    return null;
  }
}

export function setYunwuKey(key: string): void {
  try {
    localStorage.setItem(YUNWU_KEY, key.trim());
  } catch {
    // ignore
  }
}

export function clearYunwuKey(): void {
  try {
    localStorage.removeItem(YUNWU_KEY);
  } catch {
    // ignore
  }
}

export function maskYunwuKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

// ─── Backend URL ─────────────────────────────────────────────────────────────

const DEFAULT_BACKEND_URL = 'http://localhost:8000';

export function getBackendUrl(): string {
  try {
    return localStorage.getItem(BACKEND_URL_KEY) || DEFAULT_BACKEND_URL;
  } catch {
    return DEFAULT_BACKEND_URL;
  }
}

export function setBackendUrl(url: string): void {
  try {
    localStorage.setItem(BACKEND_URL_KEY, url.trim());
  } catch {
    // ignore
  }
}

export function clearBackendUrl(): void {
  try {
    localStorage.removeItem(BACKEND_URL_KEY);
  } catch {
    // ignore
  }
}

export function getDefaultBackendUrl(): string {
  return DEFAULT_BACKEND_URL;
}
