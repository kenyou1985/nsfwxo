import React, { useEffect, useState } from 'react';
import { getCachedVideoUrl } from '../services/videoCache';

export function CachedVideo({ src, className }: { src: string; className?: string }) {
  const [url, setUrl] = useState(src);
  useEffect(() => {
    let alive = true;
    let objectUrl = '';
    getCachedVideoUrl(src).then(u => { if (alive) { setUrl(u); if (u.startsWith('blob:')) objectUrl = u; } });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src]);
  return <video src={url} controls playsInline preload="auto" className={className} />;
}
