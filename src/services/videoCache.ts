const CACHE = 'nsfwxo-video-cache-v1';

export async function cacheVideo(url: string): Promise<void> {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return;
  try {
    const cache = await caches.open(CACHE);
    if (await cache.match(url)) return;
    const resp = await fetch(url, { mode: 'cors' });
    if (resp.ok) await cache.put(url, resp.clone());
  } catch {}
}

export async function getCachedVideoUrl(url: string): Promise<string> {
  if (!url) return '';
  try {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return URL.createObjectURL(await hit.blob());
  } catch {}
  return url;
}

export async function prefetchVideos(urls: string[]): Promise<void> {
  await Promise.all(urls.filter(Boolean).map(cacheVideo));
}
