/**
 * 移动端图片预处理工具集
 *
 * 解决问题：
 * 1. iOS Safari canvas 无法解码 HEIC（iPhone 14 PM 默认相机格式），强制压缩会产生空白图
 * 2. Safari canvas 对超大图（> 8192px）有内存限制
 * 3. iPhone 14 PM 48MP 相机原图 base64 后 5-15MB，移动端 fetch 经常超时
 * 4. 不同浏览器 / 设备对大图 FileReader、canvas.toBlob 行为差异巨大
 *
 * 设计原则：
 * - HEIC / HEIF 显式检测，跳过 canvas 压缩（交给后端 415 错误提示用户转格式）
 * - 多级降级：1280/q0.82 → 1024/q0.7 → 800/q0.6，每次失败自动降一档
 * - 8s 整体超时保护
 * - 失败时返回原图 + 详细错误日志，让上层决定是否继续
 */

/** 是否为 HEIC/HEIF data URL */
export function isHeicDataUrl(dataUrl: string): boolean {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return false;
  const lower = dataUrl.slice(0, 80).toLowerCase();
  return (
    lower.startsWith('data:image/heic') ||
    lower.startsWith('data:image/heif') ||
    lower.includes(';codecs=heic') ||
    lower.includes(';codecs=heif')
  );
}

/** 推断 data URL 的图片格式（jpeg/png/webp/heic/heif 等） */
export function detectImageFormat(dataUrl: string): string {
  if (!dataUrl.startsWith('data:image/')) return 'http';
  const prefix = dataUrl.split(',', 1)[0];
  const parts = prefix.split(';')[0].split('/');
  if (parts.length >= 2) return parts[1].toLowerCase();
  return 'unknown';
}

/** 是否为移动端（iOS Safari / Android Chrome 等） */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iphone|ipad|ipod|android|blackberry|iemobile|opera mini|mobile safari/i.test(ua);
}

/** 是否为 iOS Safari（与 macOS Safari 区分） */
export function isIOSSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // iPhone/iPad 上的 Safari：包含 'Safari' 但不含 'Chrome'、'CriOS'、'FxiOS'
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  const isSafari = /safari/i.test(ua) &&
    !/chrome|crios|fxios|edg|opera|brave/i.test(ua);
  return isIOS && isSafari;
}

/**
 * 把过大的 data URL 压缩到合理大小。
 *
 * @param srcDataUrl 原始 data URL
 * @param maxEdge 最长边像素（默认 1280）
 * @param quality JPEG 质量（默认 0.82）
 * @param maxBytes 超过这个字节数才压缩（默认 900KB）
 * @returns 压缩后的 data URL；失败时返回原图
 */
export async function compressDataUrlIfNeeded(
  srcDataUrl: string,
  maxEdge = 1280,
  quality = 0.82,
  maxBytes = 900_000,
): Promise<string> {
  // 非 data URL（HTTP / CDN 相对路径）不在浏览器里压缩
  if (!srcDataUrl.startsWith('data:image/')) return srcDataUrl;

  // HEIC / HEIF：Safari canvas 不能解码，强行压缩会产生空白图
  if (isHeicDataUrl(srcDataUrl)) {
    console.warn(
      '[imagePreprocess] HEIC/HEIF detected, skipping canvas compression ' +
      '(Safari canvas cannot decode HEIC)',
    );
    return srcDataUrl;
  }

  // 已经够小就直接返回
  if (srcDataUrl.length <= maxBytes) return srcDataUrl;

  // 多级降级策略
  const fallbackChain: Array<{ edge: number; q: number }> = [
    { edge: maxEdge, q: quality },
    { edge: 1024, q: 0.7 },
    { edge: 800, q: 0.6 },
  ];

  const overallTimeoutMs = 8_000;
  const overallTimeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`压缩超时（${overallTimeoutMs / 1000}s）`)),
      overallTimeoutMs,
    );
  });

  const compressPromise = (async (): Promise<string> => {
    let lastErr: Error | null = null;
    for (const tier of fallbackChain) {
      try {
        return await tryCompressOnce(srcDataUrl, tier.edge, tier.q);
      } catch (tierErr) {
        lastErr = tierErr instanceof Error ? tierErr : new Error(String(tierErr));
        console.warn(
          `[imagePreprocess] tier ${tier.edge}/q=${tier.q} failed: ${lastErr.message}`,
        );
      }
    }
    throw lastErr || new Error('所有压缩档位均失败');
  })();

  try {
    return await Promise.race([compressPromise, overallTimeoutPromise]);
  } catch (compressErr) {
    const errMsg =
      compressErr instanceof Error ? compressErr.message : String(compressErr);
    console.warn(`[imagePreprocess] 压缩失败 (${errMsg})，返回原图`);
    return srcDataUrl;
  }
}

async function tryCompressOnce(
  srcDataUrl: string,
  edge: number,
  q: number,
): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    // Safari HEIC 不会触发 onerror（display 可见），所以需要 width 检查兜底
    i.onerror = () =>
      reject(new Error('图片解码失败（浏览器无法加载此格式）'));
    i.src = srcDataUrl;
  });

  if (!img.width || !img.height) {
    throw new Error(
      `图片解码失败（width=${img.width}, height=${img.height}，可能是浏览器不支持的格式）`,
    );
  }

  let { width, height } = img;
  if (width > edge || height > edge) {
    if (width >= height) {
      height = Math.round((edge / width) * height);
      width = edge;
    } else {
      width = Math.round((edge / height) * width);
      height = edge;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context 不可用');

  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve, reject) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', q);
  });
  if (!blob) {
    throw new Error('Canvas toBlob 返回 null（Safari 对超大图 / HEIC 经常静默失败）');
  }
  if (blob.size < 100) {
    throw new Error(`Canvas toBlob 输出过小 (${blob.size} bytes)，压缩结果损坏`);
  }

  const compressed = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('FileReader 读取失败'));
    reader.readAsDataURL(blob);
  });

  console.log(
    `[imagePreprocess] compressed: ${(srcDataUrl.length / 1024).toFixed(0)}KB → ${(compressed.length / 1024).toFixed(0)}KB` +
    ` (${width}×${height}, q=${q})`,
  );
  return compressed;
}

/**
 * 把 File 压缩成 JPEG File。
 *
 * 用于 RunningHub 图片上传前的预处理（避免 iPhone 14 PM 48MP 原图上传超时）。
 *
 * @param file 原始 File
 * @param maxEdge 最长边像素（默认 1280）
 * @param quality JPEG 质量（默认 0.82）
 * @param maxBytes 超过这个字节数才压缩（默认 900KB）
 * @returns 压缩后的 File；失败时返回原 file
 */
export async function compressImageFile(
  file: File,
  maxEdge = 1280,
  quality = 0.82,
  maxBytes = 900_000,
): Promise<File> {
  // HEIC 文件直接跳过（Safari canvas 不能解码）
  const mime = (file.type || '').toLowerCase();
  if (mime === 'image/heic' || mime === 'image/heif') {
    console.warn('[imagePreprocess] HEIC file detected, skipping compression');
    return file;
  }

  if (file.size <= maxBytes) return file;

  // 走和 compressDataUrlIfNeeded 相同的降级链路
  const fallbackChain: Array<{ edge: number; q: number }> = [
    { edge: maxEdge, q: quality },
    { edge: 1024, q: 0.7 },
    { edge: 800, q: 0.6 },
  ];

  // 先把 file 读成 data URL
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('FileReader 读取失败'));
    reader.readAsDataURL(file);
  });

  const overallTimeoutMs = 8_000;
  const overallTimeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`压缩超时（${overallTimeoutMs / 1000}s）`)),
      overallTimeoutMs,
    );
  });

  const compressPromise = (async (): Promise<File> => {
    let lastErr: Error | null = null;
    for (const tier of fallbackChain) {
      try {
        const compressedDataUrl = await tryCompressOnce(dataUrl, tier.edge, tier.q);
        // 把 data URL 转回 File
        const blob = await (await fetch(compressedDataUrl)).blob();
        return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
          type: 'image/jpeg',
        });
      } catch (tierErr) {
        lastErr = tierErr instanceof Error ? tierErr : new Error(String(tierErr));
        console.warn(
          `[imagePreprocess] file tier ${tier.edge}/q=${tier.q} failed: ${lastErr.message}`,
        );
      }
    }
    throw lastErr || new Error('所有压缩档位均失败');
  })();

  try {
    return await Promise.race([compressPromise, overallTimeoutPromise]);
  } catch (compressErr) {
    const errMsg =
      compressErr instanceof Error ? compressErr.message : String(compressErr);
    console.warn(`[imagePreprocess] 文件压缩失败 (${errMsg})，返回原文件`);
    return file;
  }
}
