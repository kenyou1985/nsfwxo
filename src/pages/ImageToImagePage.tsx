import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ImagePlus, Sparkles, User, Shirt, MapPin, Plus } from 'lucide-react';
import { ImageUploader } from '../components/ImageUploader';
import { GirlfriendSelector } from '../components/GirlfriendSelector';
import { ParameterSlider } from '../components/ParameterSlider';
import { GenerateButton } from '../components/GenerateButton';
import { TaskList } from '../components/TaskList';
import { TagPanel } from '../components/TagPanel';
import { StoryboardSection } from '../components/StoryboardSection';
import { ImageGrid } from '../components/ImageGrid';
import { uploadImage, WORKFLOW } from '../services/runninghub';
import { expandPrompt, streamRandomPrompt, extractImageDna, type ImageDnaResult } from '../services/promptApi';
import { addFavorite, removeFavorite, getFavorites } from '../services/storage';
import type { ImageToImageParams, QueuedTask } from '../types';
import { MAX_TASKS, type TaskManagerReturn } from '../hooks/useTaskManager';
import type { WeightMode } from '../components/PromptEditor';
import { DEFAULT_GIRLFRIEND_PRESETS, type GirlfriendPreset } from '../data/girlfriendPresets';
import { PosePresetSelector } from '../components/PosePresetSelector';
import { QUALITY_BOOST_PROMPT } from '../constants';
import type { StoryboardPanel } from '../services/storyboardGenerator';
import { ImageDnaPanel } from '../components/ImageDnaPanel';
import { compressDataUrlIfNeeded, isHeicDataUrl, isIOSSafari } from '../utils/imagePreprocess';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

interface SelectedTag {
  tag: string;
  weight: WeightMode;
  order: number;
}

interface ImageToImagePageProps {
  apiKey: string;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  taskManager: TaskManagerReturn;
  initialPrompt?: string;
  onPromptConsumed?: () => void;
  regenerateWithGirlfriendId?: string;
  onRegenerateConsumed?: () => void;
  /** 从历史记录跳转过来时，预填充一张图片作为参考图（data URL） */
  initialImageUrl?: string;
  onImageUrlConsumed?: () => void;
}

export function ImageToImagePage({
  apiKey,
  onError,
  onSuccess,
  taskManager,
  initialPrompt,
  onPromptConsumed,
  regenerateWithGirlfriendId,
  onRegenerateConsumed,
  initialImageUrl,
  onImageUrlConsumed,
}: ImageToImagePageProps) {
  const [params, setParams] = useState<ImageToImageParams>({
    prompt: '',
    batchSize: 2,
    uploadedImagePath: '',
    uploadedImageUrl: '',
  });
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Tag management
  const [positiveTags, setPositiveTags] = useState<SelectedTag[]>([]);
  const [negativeTags, setNegativeTags] = useState<SelectedTag[]>([]);
  const [tagCounter, setTagCounter] = useState(0);
  const [customPrompt, setCustomPrompt] = useState('');
  const [enableRandomPrompt, setEnableRandomPrompt] = useState(true);
  const [isR18Enabled, setIsR18Enabled] = useState(false);
  const [displayLang, setDisplayLang] = useState<'en' | 'zh'>('en');

  // Girlfriend state
  const [selectedGirlfriend, setSelectedGirlfriend] = useState<GirlfriendPreset | null>(null);
  const [girlfriendUploading, setGirlfriendUploading] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isGeneratingFromPrompt, setIsGeneratingFromPrompt] = useState(false);
  const [expandedPrompt, setExpandedPrompt] = useState('');
  const [isGachaLoading, setIsGachaLoading] = useState(false);
  const [gachaPrompt, setGachaPrompt] = useState('');

  // Image preview & favorites
  const [refreshKey, setRefreshKey] = useState(0);

  // Aspect ratio: 'portrait' (竖屏 9:16) or 'landscape' (横屏 16:9)
  const [aspectRatio, setAspectRatio] = useState<'portrait' | 'landscape'>('portrait');

  // ─── 图生图（多图编辑）模式 ────────────────────────────────────────────────
  type Img2ImgMode = 'single' | 'multi';
  const [img2imgMode, setImg2imgMode] = useState<Img2ImgMode>('single');

  interface MultiRefImage {
    path: string;   // RunningHub path (用于 nodeInfoList)
    preview: string; // data URL (用于 <img> preview)
  }

  const EMPTY_MULTI = (): MultiRefImage => ({ path: '', preview: '' });

  const [multiRefImages, setMultiRefImages] = useState<MultiRefImage[]>([EMPTY_MULTI(), EMPTY_MULTI(), EMPTY_MULTI()]);
  const [multiRefUploading, setMultiRefUploading] = useState(false); // 全局上传中标志
  // 默认 1024px（用户要求，避免移动端流量浪费）；9:16 竖屏适合人物/服装类创作
  const [multiRefAspectRatio, setMultiRefAspectRatio] = useState('9:16');
  const [multiRefPrompt, setMultiRefPrompt] = useState('');
  const [multiRefEnhance, setMultiRefEnhance] = useState(false); // 188: 文生图开关
  const [multiRefResolution, setMultiRefResolution] = useState(1024); // 186: 默认 1024
  const [multiRefCount, setMultiRefCount] = useState(2); // 187: 抽卡数（默认2）
  const [multiRefSubmitting, setMultiRefSubmitting] = useState(false);
  const [multiRefUploadErrors, setMultiRefUploadErrors] = useState<(string | null)[]>([null, null, null]);

  // 锚定数字人：选中的数字人预设会占据参考图1（nodeId 154）
  const [multiRefGirlfriend, setMultiRefGirlfriend] = useState<GirlfriendPreset | null>(null);
  const [multiRefGirlfriendUploading, setMultiRefGirlfriendUploading] = useState(false);

  // ── 多图模式 DNA 自动提取（与图生视频情色模式保持一致）─────────────────────────
  // 当首张参考图（图1）上传成功时，自动调用 extractImageDna 提取人物/场景/服装信息。
  // DNA 结果可作为多图编辑的"锚定角色"信息，辅助生成更有针对性的多图融合结果。
  const [multiRefDna, setMultiRefDna] = useState<ImageDnaResult | null>(null);
  const [multiRefDnaLoading, setMultiRefDnaLoading] = useState(false);
  const [multiRefDnaError, setMultiRefDnaError] = useState<string | null>(null);

  // DNA 自动提取开关（默认关闭，由用户主动开启才执行，避免无效调用 + 流量浪费）
  const [multiRefDnaAutoExtract, setMultiRefDnaAutoExtract] = useState(false);

  // ── 多图模式标签库（与单图模式 positiveTags/negativeTags 完全独立）────────────
  // 用户在标签库选择 tag → 拼成多图模式的自定义提示词种子
  // 与 single 模式共用一个独立 prompt 状态（multiRefPrompt），但维护自己独立的
  // 选中 tag 列表 + 自定义 prompt 路径，避免互相覆盖。
  const [multiRefPositiveTags, setMultiRefPositiveTags] = useState<SelectedTag[]>([]);
  const [multiRefNegativeTags, setMultiRefNegativeTags] = useState<SelectedTag[]>([]);
  const [multiRefTagCustomPrompt, setMultiRefTagCustomPrompt] = useState('');
  const [multiRefTagEn, setMultiRefTagEn] = useState(true); // 多图模式独立默认开启随机提示
  const [multiRefTagR18, setMultiRefTagR18] = useState(false);
  const [multiRefTagLang, setMultiRefTagLang] = useState<'en' | 'zh'>('en');
  const [multiRefTagExpanded, setMultiRefTagExpanded] = useState(''); // 多图模式独立的 expanded prompt

  // Pre-fill customPrompt when navigating from history regenerate
  useEffect(() => {
    if (initialPrompt && initialPrompt.trim()) {
      setCustomPrompt(initialPrompt.trim());
      onPromptConsumed?.();
    }
  }, [initialPrompt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select girlfriend and trigger generation when navigating from history with anchor
  useEffect(() => {
    if (!initialImageUrl) return;

    let cancelled = false;

    const doUpload = async () => {
      try {
        const res = await fetch(initialImageUrl);
        const blob = await res.blob();
        const file = new File([blob], 'history_edit.jpg', { type: blob.type || 'image/jpeg' });
        const objectUrl = URL.createObjectURL(file);
        setPreviewUrl(objectUrl);
        const { imagePath, downloadUrl } = await uploadImage(apiKey, file);
        if (cancelled) return;
        updateParam('uploadedImagePath', imagePath);
        updateParam('uploadedImageUrl', downloadUrl);
        onSuccess?.('参考图已上传，请输入提示词后点击生成');
      } catch (err) {
        if (cancelled) return;
        onError?.('历史图片上传失败，请重试');
      } finally {
        if (!cancelled) {
          setGirlfriendUploading(false);
          onImageUrlConsumed?.();
        }
      }
    };

    setGirlfriendUploading(true);
    doUpload();

    return () => { cancelled = true; };
  }, [initialImageUrl]);

  // Auto-select girlfriend and trigger generation when navigating from history with anchor
  useEffect(() => {
    if (!regenerateWithGirlfriendId) return;

    const gf = DEFAULT_GIRLFRIEND_PRESETS.find((g) => g.id === regenerateWithGirlfriendId);
    if (!gf) {
      onRegenerateConsumed?.();
      return;
    }

    let cancelled = false;

    const doUpload = async () => {
      setSelectedGirlfriend(gf);
      setUploadError(null);
      setGirlfriendUploading(true);
      try {
        const res = await fetch(gf.portraitUrl);
        const blob = await res.blob();
        const file = new File([blob], `${gf.id}.jpg`, { type: 'image/jpeg' });
        const objectUrl = URL.createObjectURL(file);
        setPreviewUrl(objectUrl);
        const { imagePath, downloadUrl } = await uploadImage(apiKey, file);
        if (cancelled) return;

        updateParam('uploadedImagePath', imagePath);
        updateParam('uploadedImageUrl', downloadUrl);

        if (cancelled) return;

        const parts: string[] = [];
        if (gf.characterPrompt) parts.push(gf.characterPrompt);
        if (initialPrompt?.trim()) parts.push(initialPrompt.trim());
        if (enableRandomPrompt) parts.push(QUALITY_BOOST_PROMPT);
        const promptText = parts.join(', ');
        if (!promptText.trim()) {
          onError('提示词为空');
          return;
        }
        if (taskManager.isFull) {
          onError(`任务队列已满（最多 ${MAX_TASKS} 个任务），请等待当前任务完成`);
          return;
        }
        // 新图生图工作流使用新的节点配置
        const widthRatio = aspectRatio === 'portrait' ? '9' : '16';
        const heightRatio = aspectRatio === 'portrait' ? '16' : '9';
        const nodeList = [
          { nodeId: '291', fieldName: 'prompt', fieldValue: promptText, description: 'prompt' },
          { nodeId: '172', fieldName: 'value', fieldValue: widthRatio, description: 'width' },
          { nodeId: '173', fieldName: 'value', fieldValue: heightRatio, description: 'height' },
          { nodeId: '269', fieldName: 'value', fieldValue: String(params.batchSize), description: 'count' },
          { nodeId: '104', fieldName: 'image', fieldValue: downloadUrl, description: 'image' },
          { nodeId: '273', fieldName: 'value', fieldValue: 'false', description: 'enhance' },
        ];
        await taskManager.addTask('img2img', nodeList, promptText, WORKFLOW.IMAGE_TO_IMAGE);
        onSuccess('任务已提交');
      } catch {
        if (cancelled) return;
        onError('数字人图片上传失败，请重试');
        setSelectedGirlfriend(null);
        setPreviewUrl('');
      } finally {
        if (!cancelled) setGirlfriendUploading(false);
      }
      onRegenerateConsumed?.();
    };

    doUpload();

    return () => { cancelled = true; };
  }, [regenerateWithGirlfriendId, aspectRatio]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateParam = <K extends keyof ImageToImageParams>(
    key: K,
    value: ImageToImageParams[K]
  ) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  const handleGirlfriendSelect = useCallback(
    async (gf: GirlfriendPreset) => {
      setSelectedGirlfriend(gf);
      setUploadError(null);
      setGirlfriendUploading(true);
      // 立即用 portraitUrl 作为预览（避免 fetch 转 blob 在移动端失败导致预览为空）
      setPreviewUrl(gf.portraitUrl);
      try {
        let file: File;
        let preview: string;

        if (gf.portraitUrl.startsWith('data:')) {
          // data URL: fetch 可以直接转换 data URL 为 blob
          const res = await fetch(gf.portraitUrl);
          const blob = await res.blob();
          file = new File([blob], `${gf.id}.jpg`, { type: blob.type || 'image/jpeg' });
          preview = gf.portraitUrl;
        } else {
          // 外部 URL: 走原逻辑
          const res = await fetch(gf.portraitUrl);
          const blob = await res.blob();
          file = new File([blob], `${gf.id}.jpg`, { type: blob.type || 'image/jpeg' });
          preview = URL.createObjectURL(file);
        }

        const { imagePath, downloadUrl } = await uploadImage(apiKey, file);
        updateParam('uploadedImagePath', imagePath);
        updateParam('uploadedImageUrl', downloadUrl);
        onSuccess(`已选择女友「${gf.nameZh || gf.name}」作为参考`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '未知错误';
        onError(`女友图片上传失败: ${msg}，已临时显示参考图`);
        // 上传失败：保留 previewUrl (portraitUrl)，用户仍能看到图片
        // 但 params.uploadedImagePath 为空，提交时会提示
      } finally {
        setGirlfriendUploading(false);
      }
    },
    [apiKey, onSuccess, onError]
  );

  const handleUpload = useCallback(
    async (file: File) => {
      setUploadError(null);
      setSelectedGirlfriend(null);
      try {
        const objectUrl = URL.createObjectURL(file);
        setPreviewUrl(objectUrl);
        const { imagePath, downloadUrl } = await uploadImage(apiKey, file);
        updateParam('uploadedImagePath', imagePath);
        updateParam('uploadedImageUrl', downloadUrl);
        onSuccess('图片上传成功');
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : '上传失败');
        throw err;
      }
    },
    [apiKey, onSuccess]
  );

  const handleMultiRefImageChange = (index: number, path: string, preview: string) => {
    setMultiRefImages(prev => {
      const updated = [...prev];
      updated[index] = { path, preview };
      return updated;
    });
  };

  // 锚定数字人：选中数字人后自动上传到参考图1（nodeId 154），并锁定该槽位
  const handleMultiRefGirlfriendSelect = useCallback(
    async (gf: GirlfriendPreset) => {
      setMultiRefGirlfriend(gf);
      setMultiRefUploadErrors([null, null, null]);
      setMultiRefGirlfriendUploading(true);
      // 清空参考图1手动上传内容（被数字人锁定）
      setMultiRefImages(prev => {
        const updated = [...prev];
        updated[0] = { path: '', preview: gf.portraitUrl }; // 先显示预设预览
        return updated;
      });
      try {
        let file: File;
        if (gf.portraitUrl.startsWith('data:')) {
          const res = await fetch(gf.portraitUrl);
          const blob = await res.blob();
          file = new File([blob], `${gf.id}.jpg`, { type: blob.type || 'image/jpeg' });
        } else {
          const res = await fetch(gf.portraitUrl);
          const blob = await res.blob();
          file = new File([blob], `${gf.id}.jpg`, { type: 'image/jpeg' });
        }
        const { imagePath } = await uploadImage(apiKey, file);
        setMultiRefImages(prev => {
          const updated = [...prev];
          updated[0] = { path: imagePath, preview: gf.portraitUrl };
          return updated;
        });
        onSuccess?.(`已锚定数字人「${gf.nameZh || gf.name}」作为参考图1`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '上传失败';
        onError?.(`数字人图片上传失败: ${msg}，已临时显示预览图`);
        // 仍保留预览 URL（portraitUrl），path 为空不影响提交（会提示）
      } finally {
        setMultiRefGirlfriendUploading(false);
      }
    },
    [apiKey, onSuccess, onError]
  );

  const handleMultiRefUpload = async (index: number, file: File) => {
    setMultiRefUploadErrors(prev => { const e = [...prev]; e[index] = null; return e; });
    setMultiRefUploading(true);
    try {
      const objectUrl = URL.createObjectURL(file);
      const { imagePath } = await uploadImage(apiKey, file);
      setMultiRefImages(prev => {
        const updated = [...prev];
        updated[index] = { path: imagePath, preview: objectUrl };
        return updated;
      });
      onSuccess?.(`参考图 ${index + 1} 上传成功`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '上传失败';
      setMultiRefUploadErrors(prev => { const e = [...prev]; e[index] = msg; return e; });
    } finally {
      setMultiRefUploading(false);
    }
  };

  const handleMultiRefGenerate = async (overridePrompt?: string) => {
    // 至少需要1张图
    const hasImage = multiRefImages.some(img => img.path);
    if (!hasImage) {
      onError?.('请至少上传一张参考图');
      return;
    }
    // 优先使用 overridePrompt（标签库「生图」按钮走这条路径）
    // 否则使用当前的 multiRefPrompt 状态
    const promptForSubmit = (overridePrompt ?? multiRefPrompt).trim();
    if (!promptForSubmit) {
      onError?.('请输入描述提示词');
      return;
    }
    if (taskManager.isFull) {
      onError?.(`任务队列已满（最多 ${MAX_TASKS} 个任务），请等待当前任务完成`);
      return;
    }

    // 同步覆盖 multiRefPrompt（让截图2位置的描述提示词编辑框也保持一致）
    if (overridePrompt) {
      setMultiRefPrompt(overridePrompt);
    }

    setMultiRefSubmitting(true);
    try {
      const nodeList: import('../types').NodeInfo[] = [];

      // 最多3张参考图（nodeId: 154/118/95）
      const multiImageNodeIds = ['154', '118', '95'];
      multiRefImages.forEach((img, idx) => {
        if (img.path) {
          nodeList.push({
            nodeId: multiImageNodeIds[idx],
            fieldName: 'image',
            fieldValue: img.path,
            description: `参考图${idx + 1}`,
          });
        }
      });

      // 增强开关（nodeId: 188）
      nodeList.push({
        nodeId: '188',
        fieldName: 'value',
        fieldValue: String(multiRefEnhance),
        description: '增强',
      });

      // 宽高比（nodeId: 189）
      nodeList.push({
        nodeId: '189',
        fieldName: 'aspect_ratio',
        fieldValue: multiRefAspectRatio,
        description: '宽高比',
      });

      // 分辨率（nodeId: 186）
      nodeList.push({
        nodeId: '186',
        fieldName: 'value',
        fieldValue: String(multiRefResolution),
        description: '分辨率',
      });

      // 生成数量（nodeId: 187）
      nodeList.push({
        nodeId: '187',
        fieldName: 'value',
        fieldValue: String(multiRefCount),
        description: '数量',
      });

      // 提示词（nodeId: 107）
      // 若锚定了数字人，追加角色身份锁定提示词
      let finalPrompt = promptForSubmit;
      if (multiRefGirlfriend) {
        const charName = multiRefGirlfriend.nameZh || multiRefGirlfriend.name;
        const charId = multiRefGirlfriend.id.toUpperCase().slice(0, 4);
        const identityAnchor = `Strictly preserve the exact identity, character, and features of ${charName} (ID:${charId}) from reference image 1. Do not alter the character at all. `;
        finalPrompt = identityAnchor + finalPrompt;
      }

      nodeList.push({
        nodeId: '107',
        fieldName: 'text',
        fieldValue: finalPrompt,
        description: '提示词',
      });

      await taskManager.addTask('multi-ref-img2img', nodeList, finalPrompt, WORKFLOW.MULTI_REF_IMG2IMG);
      onSuccess?.('多图编辑任务已提交');
    } catch (err) {
      onError?.(err instanceof Error ? err.message : '提交失败');
    } finally {
      setMultiRefSubmitting(false);
    }
  };

  const handlePoseSelect = useCallback((posePrompt: string, poseName: string) => {
    // Krea2 style: pose preset is a coherent English paragraph — join with
    // sentence break, not a comma. Avoid comma-separated tag accumulation.
    const current = customPrompt.trim();
    const newPrompt = current ? `${current}\n\n${posePrompt}` : posePrompt;
    setCustomPrompt(newPrompt);
    onSuccess(`已添加姿势: ${poseName}`);
  }, [customPrompt, onSuccess]);

  // 多图编辑模式：姿势预设同步到 multiRefPrompt
  const handleMultiRefPoseSelect = useCallback((posePrompt: string, poseName: string) => {
    const current = multiRefPrompt.trim();
    const newPrompt = current ? `${current}\n\n${posePrompt}` : posePrompt;
    setMultiRefPrompt(newPrompt);
    onSuccess?.(`多图编辑已添加姿势: ${poseName}`);
  }, [multiRefPrompt, onSuccess]);

  // ─── 多图编辑模式 DNA 自动提取 ────────────────────────────────────────
  // 当模式切到「多图编辑」 + 首张参考图（图1）上传完成时，自动调用 Gemini 提取 DNA。
  // DNA 信息可用于：
  // 1. 一键复制人物/场景/服装描述到多图提示词区（"图1 + 人物描述 + 服装 + 姿势"）
  // 2. 把提取出的服装图插入到参考图2/3 槽位，引导 AI 融合多图元素
  useEffect(() => {
    // 仅在多图模式下提取
    if (img2imgMode !== 'multi') return;
    // 用户没主动开启 DNA 自动提取开关，则不执行（节省流量 + 避免无效调用）
    if (!multiRefDnaAutoExtract) return;
    const firstUploaded = multiRefImages.find(img => img.path && img.path !== '');
    if (!firstUploaded) return;

    // 避免重复提取：用 path 作为 hash 标识
    const currentHash = firstUploaded.path;
    if (multiRefDna && (multiRefDna as any)._imageHash === currentHash) return;

    const doExtract = async () => {
      setMultiRefDnaLoading(true);
      setMultiRefDnaError(null);
      try {
        // 优先使用 preview（浏览器本地 data URL，无网络依赖）
        let imageDataUrl: string = firstUploaded.preview;
        if (!imageDataUrl) {
          // 回退：尝试 fetch path 转 base64（移动端可能失败）
          if (firstUploaded.path.startsWith('http://') ||
              firstUploaded.path.startsWith('https://') ||
              firstUploaded.path.startsWith('blob:')) {
            const resp = await fetch(firstUploaded.path);
            const blob = await resp.blob();
            imageDataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () => reject(new Error('FileReader 读取失败'));
              reader.readAsDataURL(blob);
            });
          } else {
            // RunningHub CDN 相对路径：交给后端处理
            imageDataUrl = firstUploaded.path;
          }
        }

        // 移动端原图压缩（iPhone 14 PM 48MP 上传后 base64 可能 5-15MB）
        imageDataUrl = await compressDataUrlIfNeeded(imageDataUrl);

        // HEIC 早返回，避免后端 415
        if (isHeicDataUrl(imageDataUrl)) {
          throw new Error(
            '检测到 HEIC/HEIF 格式图片。Safari canvas 无法解码此格式，AI 也无法识别。\n' +
            '请在 iPhone 设置 → 相机 → 格式中改为"兼容性最佳"，然后重新上传图片。',
          );
        }

        console.log(
          `[multiDNA] calling extractImageDna with image (${(imageDataUrl.length / 1024).toFixed(0)}KB)`,
        );
        const result = await extractImageDna(imageDataUrl);
        (result as any)._imageHash = currentHash;
        setMultiRefDna(result);
      } catch (err) {
        console.error('[multiDNA] extraction FAILED:', err);
        setMultiRefDnaError(err instanceof Error ? err.message : 'DNA 提取失败');
      } finally {
        setMultiRefDnaLoading(false);
      }
    };

    doExtract();
  }, [img2imgMode, multiRefDnaAutoExtract, multiRefImages.map(i => i.path).join(','), multiRefUploading]);

  const handleImageChange = (path: string, url: string) => {
    updateParam('uploadedImagePath', path);
    if (!url && previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl('');
    }
    if (!path) {
      setSelectedGirlfriend(null);
    }
  };

  const handleGenerateSingleStoryboardImage = useCallback(
    async (panelIdx: number, prompt: string) => {
      if (!params.uploadedImagePath) {
        onError('请先上传参考图片或选择 AI 女友');
        return;
      }
      if (!prompt.trim()) {
        onError('分镜内容为空，请先生成分镜');
        return;
      }
      if (taskManager.isFull) {
        onError('任务队列已满');
        return;
      }
      console.log(`[handleGenerateSingleStoryboardImage] panelIdx=${panelIdx}, prompt length=${prompt.length}, prompt="${prompt.slice(0, 80)}"`);
      const widthRatio = aspectRatio === 'portrait' ? '9' : '16';
      const heightRatio = aspectRatio === 'portrait' ? '16' : '9';
      const nodeList = [
        { nodeId: '291', fieldName: 'prompt', fieldValue: prompt, description: 'prompt' },
        { nodeId: '172', fieldName: 'value', fieldValue: widthRatio, description: 'width' },
        { nodeId: '173', fieldName: 'value', fieldValue: heightRatio, description: 'height' },
        { nodeId: '269', fieldName: 'value', fieldValue: '1', description: 'count' },
        { nodeId: '104', fieldName: 'image', fieldValue: params.uploadedImageUrl || params.uploadedImagePath, description: 'image' },
        { nodeId: '273', fieldName: 'value', fieldValue: 'false', description: 'enhance' },
      ];
      console.log(`[handleGenerateSingleStoryboardImage] nodeList=`, JSON.stringify(nodeList));
      try {
        await taskManager.addTask('img2img', nodeList, prompt, WORKFLOW.IMAGE_TO_IMAGE);
        onSuccess('分镜图片任务已提交');
      } catch (err) {
        onError(err instanceof Error ? err.message : '提交失败');
      }
    },
    [params.uploadedImagePath, taskManager, aspectRatio, onError, onSuccess]
  );

  const handleGenerateStoryboardPanels = useCallback(
    async (
      panels: StoryboardPanel[],
      sceneName: string,
      themeTitle: string,
      _isR18: boolean,
      onSuccess: (msg: string) => void,
      onError: (msg: string) => void
    ) => {
      if (!params.uploadedImagePath) {
        onError('请先上传参考图片或选择 AI 女友');
        return;
      }

      const remainingSlots = MAX_TASKS - taskManager.tasks.length;
      if (panels.length > remainingSlots) {
        onError(`队列空间不足（剩余 ${remainingSlots} 个），请等待任务完成后再试`);
        return;
      }

      const imageUrl = params.uploadedImageUrl || params.uploadedImagePath;
      console.log(`[handleGenerateStoryboardPanels] imageUrl=${imageUrl}, panels.length=${panels.length}`);
      const widthRatio = aspectRatio === 'portrait' ? '9' : '16';
      const heightRatio = aspectRatio === 'portrait' ? '16' : '9';
      for (let i = 0; i < panels.length; i++) {
        const panel = panels[i];
        const nodeList = [
          { nodeId: '291', fieldName: 'prompt', fieldValue: panel.image_prompt, description: 'prompt' },
          { nodeId: '172', fieldName: 'value', fieldValue: widthRatio, description: 'width' },
          { nodeId: '173', fieldName: 'value', fieldValue: heightRatio, description: 'height' },
          { nodeId: '269', fieldName: 'value', fieldValue: '1', description: 'count' },
          { nodeId: '104', fieldName: 'image', fieldValue: imageUrl, description: 'image' },
          { nodeId: '273', fieldName: 'value', fieldValue: 'false', description: 'enhance' },
        ];
        console.log(`[handleGenerateStoryboardPanels] panel[${i}] nodeList=`, JSON.stringify(nodeList));
        try {
          await taskManager.addTask('img2img', nodeList, panel.image_prompt, WORKFLOW.IMAGE_TO_IMAGE);
        } catch (err) {
          onError(err instanceof Error ? err.message : '任务提交失败');
          return;
        }
      }
      const label = themeTitle || sceneName || '分镜';
      onSuccess(`「${label}」共 ${panels.length} 个任务已提交`);
    },
    [params.uploadedImagePath, taskManager, aspectRatio, onError]
  );

  // Build tag-only prompt (for expand API — excludes customPrompt to avoid duplication)
  const buildTagPrompt = useCallback((): string => {
    const parts: string[] = [];
    if (selectedGirlfriend?.characterPrompt) {
      parts.push(selectedGirlfriend.characterPrompt);
    }
    positiveTags.forEach((item) => {
      if (item.weight === 'positive') {
        parts.push(`(${item.tag}:1.3)`);
      } else if (item.weight === 'negative') {
        parts.push(`[${item.tag}:0.7]`);
      } else {
        parts.push(item.tag);
      }
    });
    if (enableRandomPrompt) {
      parts.push(QUALITY_BOOST_PROMPT);
    }
    return parts.join(', ');
  }, [positiveTags, enableRandomPrompt, selectedGirlfriend]);

  // Build final prompt from tags + custom text (for actual generation)
  const buildFinalPrompt = useCallback((): string => {
    const parts: string[] = [];

    if (selectedGirlfriend?.characterPrompt) {
      parts.push(selectedGirlfriend.characterPrompt);
    }

    positiveTags.forEach((item) => {
      if (item.weight === 'positive') {
        parts.push(`(${item.tag}:1.3)`);
      } else if (item.weight === 'negative') {
        parts.push(`[${item.tag}:0.7]`);
      } else {
        parts.push(item.tag);
      }
    });

    if (customPrompt.trim()) {
      parts.push(customPrompt.trim());
    }

    if (enableRandomPrompt) {
      parts.push(QUALITY_BOOST_PROMPT);
    }

    return parts.join(', ');
  }, [positiveTags, customPrompt, enableRandomPrompt, selectedGirlfriend]);

  const buildNegativePrompt = useCallback((): string => {
    const parts: string[] = [];
    negativeTags.forEach((item) => {
      parts.push(item.tag);
    });
    return parts.join(', ') || 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, bad feet';
  }, [negativeTags]);

  const handleAddTag = useCallback((tag: string) => {
    const exists = [...positiveTags, ...negativeTags].some((t) => t.tag === tag);
    if (exists) return;

    setTagCounter((c) => c + 1);
    // Tags should always go to positiveTags regardless of R18 mode
    // so that expand can properly use them for prompt generation
    setPositiveTags((prev) => [...prev, { tag, weight: 'none', order: tagCounter }]);
  }, [positiveTags, negativeTags, tagCounter]);

  const handleRemoveTag = useCallback((tag: string) => {
    setPositiveTags((prev) => prev.filter((t) => t.tag !== tag));
    setNegativeTags((prev) => prev.filter((t) => t.tag !== tag));
  }, []);

  // Refs to avoid stale closure issues in callbacks
  const positiveTagsRef = useRef(positiveTags);
  const negativeTagsRef = useRef(negativeTags);
  positiveTagsRef.current = positiveTags;
  negativeTagsRef.current = negativeTags;
  // Forward ref so handleOptimizePrompt can trigger handleGenerateFromPrompt
  // (defined later in the file) without a TDZ violation.
  const handleGenerateFromPromptRef = useRef<() => void>(() => {});

  const handleUpdateTagWeight = useCallback((tag: string, weight: WeightMode) => {
    if (weight === 'negative') {
      const inPositive = positiveTagsRef.current.some((t) => t.tag === tag);
      const inNegative = negativeTagsRef.current.some((t) => t.tag === tag);
      if (inPositive) {
        setPositiveTags((prev) => prev.filter((t) => t.tag !== tag));
        setTagCounter((c) => c + 1);
        setNegativeTags((prev) => [...prev, { tag, weight: 'negative', order: tagCounter }]);
      } else if (!inNegative) {
        setTagCounter((c) => c + 1);
        setNegativeTags((prev) => [...prev, { tag, weight: 'negative', order: tagCounter }]);
      }
    } else if (weight === 'positive') {
      const inPositive = positiveTagsRef.current.some((t) => t.tag === tag);
      const inNegative = negativeTagsRef.current.some((t) => t.tag === tag);
      if (inNegative) {
        setNegativeTags((prev) => prev.filter((t) => t.tag !== tag));
        setTagCounter((c) => c + 1);
        setPositiveTags((prev) => [...prev, { tag, weight: 'positive', order: tagCounter }]);
      } else if (!inPositive) {
        setTagCounter((c) => c + 1);
        setPositiveTags((prev) => [...prev, { tag, weight: 'positive', order: tagCounter }]);
      }
    } else {
      setPositiveTags((prev) => prev.map((t) => t.tag === tag ? { ...t, weight } : t));
      setNegativeTags((prev) => prev.map((t) => t.tag === tag ? { ...t, weight } : t));
    }
  }, [tagCounter]);

  const handleMoveTagUp = useCallback((tag: string) => {
    setPositiveTags((prev) => {
      const idx = prev.findIndex((t) => t.tag === tag);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }, []);

  const handleMoveTagDown = useCallback((tag: string) => {
    setPositiveTags((prev) => {
      const idx = prev.findIndex((t) => t.tag === tag);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }, []);

  const handleClearAll = useCallback(() => {
    setPositiveTags([]);
    setNegativeTags([]);
    setCustomPrompt('');
    setEnableRandomPrompt(true);
    setTagCounter(0);
  }, []);

  // ═══════ 多图模式 标签库 handler（独立 state）═══════════════════════════════════
  // 为了避免污染单图模式逻辑，多图模式用独立的状态 + 独立 handlers。
  // 用户在标签库选择 tag 时，最终拼成 multiRefPrompt 的"自定义种子"。
  // 完整的"选 tag → 优化 → 生成"流程借用单图模式的 expand 生成能力（不重复实现）。

  const [multiRefTagCounter, setMultiRefTagCounter] = useState(0);
  const handleMultiRefAddTag = useCallback((tag: string) => {
    setMultiRefPositiveTags(prev => {
      const exists = prev.some(t => t.tag === tag) || multiRefNegativeTags.some(t => t.tag === tag);
      if (exists) return prev;
      setMultiRefTagCounter(c => c + 1);
      // ★ 同步把新正向标签注入"描述提示词"编辑框（截图2位置）
      // 写入方式：在 multiRefPrompt 末尾追加 ", tag"（避免覆盖用户已输入的内容）
      // 已存在的 tag 不会重复添加（if exists check 在这里完成）
      setMultiRefPrompt(current => {
        const cur = current.trim();
        // 如果当前 prompt 里已经包含这个 tag，跳过
        const tagRegex = new RegExp(`(^|,\\s*)${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s*,|$)`, 'i');
        if (cur && tagRegex.test(cur)) return current;
        return cur ? `${current.trimEnd()}, ${tag}` : tag;
      });
      return [...prev, { tag, weight: 'none', order: multiRefTagCounter }];
    });
  }, [multiRefNegativeTags, multiRefTagCounter]);

  const handleMultiRefRemoveTag = useCallback((tag: string) => {
    setMultiRefPositiveTags(prev => prev.filter(t => t.tag !== tag));
    setMultiRefNegativeTags(prev => prev.filter(t => t.tag !== tag));
  }, []);

  const handleMultiRefUpdateTagWeight = useCallback((tag: string, weight: WeightMode) => {
    if (weight === 'negative') {
      setMultiRefPositiveTags(prevP => {
        const inPositive = prevP.some(t => t.tag === tag);
        if (inPositive) {
          setMultiRefTagCounter(c => c + 1);
          setMultiRefNegativeTags(prevN => [...prevN, { tag, weight: 'negative', order: multiRefTagCounter }]);
          return prevP.filter(t => t.tag !== tag);
        } else {
          setMultiRefNegativeTags(prevN => {
            if (prevN.some(t => t.tag === tag)) return prevN;
            setMultiRefTagCounter(c => c + 1);
            return [...prevN, { tag, weight: 'negative', order: multiRefTagCounter }];
          });
          return prevP;
        }
      });
    } else if (weight === 'positive') {
      setMultiRefNegativeTags(prevN => {
        const inNegative = prevN.some(t => t.tag === tag);
        if (inNegative) {
          setMultiRefTagCounter(c => c + 1);
          setMultiRefPositiveTags(prevP => [...prevP, { tag, weight: 'positive', order: multiRefTagCounter }]);
          return prevN.filter(t => t.tag !== tag);
        } else {
          setMultiRefPositiveTags(prevP => {
            if (prevP.some(t => t.tag === tag)) return prevP;
            setMultiRefTagCounter(c => c + 1);
            return [...prevP, { tag, weight: 'positive', order: multiRefTagCounter }];
          });
          return prevN;
        }
      });
    } else {
      setMultiRefPositiveTags(prev => prev.map(t => t.tag === tag ? { ...t, weight } : t));
      setMultiRefNegativeTags(prev => prev.map(t => t.tag === tag ? { ...t, weight } : t));
    }
  }, [multiRefTagCounter]);

  const handleMultiRefMoveTagUp = useCallback((tag: string) => {
    setMultiRefPositiveTags(prev => {
      const idx = prev.findIndex(t => t.tag === tag);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }, []);

  const handleMultiRefMoveTagDown = useCallback((tag: string) => {
    setMultiRefPositiveTags(prev => {
      const idx = prev.findIndex(t => t.tag === tag);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }, []);

  const handleMultiRefClearAll = useCallback(() => {
    setMultiRefPositiveTags([]);
    setMultiRefNegativeTags([]);
    setMultiRefTagCustomPrompt('');
    setMultiRefTagCounter(0);
  }, []);

  // 多图标签库 → 拼成 multiRefPrompt 的标签片段（带权重语法）
  const buildMultiRefTagPrompt = useCallback(() => {
    const pos = multiRefPositiveTags
      .sort((a, b) => a.order - b.order)
      .map((t: SelectedTag) => {
        // WeightMode = 'none' | 'positive' | 'negative'
        if (t.weight === 'positive') return `(${t.tag})`;
        return t.tag;
      })
      .join(', ');
    const neg = multiRefNegativeTags
      .map((t: SelectedTag) => (t.weight as WeightMode) === 'negative' ? `(${t.tag}:0.8)` : t.tag)
      .join(', ');
    return [pos, neg].filter(Boolean).join(', ');
  }, [multiRefPositiveTags, multiRefNegativeTags]);

  /**
   * 把多图模式标签库里的内容拼成完整提示词：
   *   标签（正/负 tag + 权重） + 用户自定义文本 + 数字人 characterPrompt + 质量增强
   * 返回 null 表示没有任何内容（提示用户至少选 1 个 tag 或输入自定义文本）
   *
   * 被两处复用：
   *   1. 多图 TagPanel 的 onGenerateFromPrompt — 写入 multiRefPrompt（"自由提示词"按钮）
   *   2. 多图 TagPanel 标签生成卡片的「生图」按钮 — 拼好后直接提交生图
   */
  const buildMultiRefTagPanelPrompt = useCallback((): string | null => {
    const tagPart = buildMultiRefTagPrompt();
    const userText = multiRefTagCustomPrompt.trim();
    const parts: string[] = [];
    if (tagPart) parts.push(tagPart);
    if (userText) parts.push(userText);
    if (multiRefGirlfriend?.characterPrompt) parts.push(multiRefGirlfriend.characterPrompt);
    if (multiRefTagEn) parts.push(QUALITY_BOOST_PROMPT);
    const finalPrompt = parts.join(', ').trim();
    return finalPrompt || null;
  }, [
    buildMultiRefTagPrompt,
    multiRefTagCustomPrompt,
    multiRefGirlfriend,
    multiRefTagEn,
  ]);

  // ═══════ ════════════════════════════════════════════════════════════════════════

  const handleOptimizePrompt = useCallback(async () => {
    // Use tags-only for expand (avoid duplicating customPrompt which is shown in textarea separately)
    const tagPart = buildTagPrompt();
    const userText = customPrompt.trim();
    const combined = userText
      ? `${tagPart}, ${userText}`
      : tagPart;

    if (!combined.trim()) return;

    // Resolve reference image URL for img2img anchor
    let referenceImageUrl: string | undefined;
    if (params.uploadedImagePath || selectedGirlfriend) {
      if (selectedGirlfriend?.portraitUrl) {
        // Preset digital human — use the preset portrait URL directly
        referenceImageUrl = selectedGirlfriend.portraitUrl;
      } else if (previewUrl && previewUrl.startsWith('blob:')) {
        // User-uploaded image — convert blob URL to base64 data URL for backend access
        try {
          const resp = await fetch(previewUrl);
          const blob = await resp.blob();
          const base64 = await blobToBase64(blob);
          referenceImageUrl = base64;
        } catch {
          // fallback: continue without reference URL
        }
      }
    }

    const lower = combined.toLowerCase();
    const isWestern = /\b(european|western|american|british|french|italian|german|blonde|blue eyes|pale|r18)\b/.test(lower);
    const isEastAsian = /\b(east asian|chinese|japanese|korean|black|african|dark skin|indian|south asian)\b/.test(lower);
    const variantIndex = isEastAsian ? 0 : isWestern ? 1 : 0;

    setIsOptimizing(true);
    try {
      const res = await expandPrompt(combined, 'image', isR18Enabled, 1, variantIndex, referenceImageUrl, true);
      if (res.results.length > 0) {
        // Format result with Qwen-2511 face-lock structure for img2img
        const expanded = res.results[0].prompt;
        const formatted = formatQwen2511Prompt(expanded, selectedGirlfriend);
        setExpandedPrompt(formatted);
      }
    } catch {
      // silently fail
    } finally {
      setIsOptimizing(false);
    }
    // Auto-submit image generation right after expansion completes — the
    // "自由提示词" button now expands AND submits in a single click instead of
    // forcing the user to click "生图" a second time.
    handleGenerateFromPromptRef.current();
  }, [buildTagPrompt, customPrompt, isR18Enabled, params, selectedGirlfriend, previewUrl]);

  // Qwen-2511 face-lock prompt formatter for img2img mode
  // For img2img: strip ALL character appearance descriptors so the reference image defines identity.
  // Only keep action, pose, scene, lighting, style, quality, artistic effect.
  const stripAppearanceKeywords = (prompt: string): string => {
    // Strip appearance descriptors from LLM output for img2img mode.
    // Only strip known appearance keywords — keep pose, action, scene, lighting, style.
    // All patterns use simple alternations to avoid regex syntax errors.

    const patterns = [
      /\b(?:long|short|medium)\s+(?:hair|hairstyle)\b/gi,
      /\b(?:straight|wavy|curly|flowing|messy|sleek|bouncy|wet|tied|loose)\s+(?:hair|hairstyle)\b/gi,
      /\b(?:platinum|ash|golden|honey|strawberry|dirty|light|dark)?\s*(?:blonde|brunette|ginger|red|auburn|chestnut|brown|black|white|silver|grey|raven|onyx|pink|blue|purple|green|orange)\s+(?:hair|hairstyle)\b/gi,
      /\b(?:ponytail|bun|braid|braids|mohawk|afro|pixie|bob|layered|updo|twintails?|side-ponytail)\b/gi,
      /\b(?:blue|green|brown|hazel|grey|gray|amber|violet|red|pink|golden|dark)\s+(?:eyes?|irises?)\b/gi,
      /\b(?:eyelash|eyelashes|eyebrow|eyebrows)\b/gi,
      /\b(?:pale|fair|light|dark|tan|olive|porcelain|clear|smooth|matte|glowy|dewy)\s+(?:skin|skin tone|skin color)\b/gi,
      /\b(?:freckles?|freckled|beauty marks?|moles?|birthmarks?|scars?)\b/gi,
      /\b(?:east asian|southeast asian|south asian|central asian|caucasian|european|african|african-american|american|british|french|italian|german|spanish|portuguese|russian|turkish|arabic|persian|middle eastern|japanese|chinese|korean|indian|thai|vietnamese|indonesian|filipino|malaysian|singaporean|latino|mexican|brazilian|colombian|peruvian|mixed race|biracial|half-american|half-british|western|oriental|aboriginal|indigenous|nordic|mediterranean|pacific islander|polynesian|native american|hispanic|mestizo|inuit)\b/gi,
      /\b(?:Nordic|Scandinavian|Eastern European)\b/gi,
      /\b(?:日系|韩系|港风|欧美风|中式|异域风情|江南女子|东北女人|川渝女人|江浙女人|闽南女人|客家女人|南方女人|南方女孩|北方女人|北方女孩|东方女人|西方女人|东方人|西方人|非洲裔|亚裔|混血|拉丁裔|高加索人|白种人|黑种人|黄种人)\b/g,
      /\b(?:face|face shape|face structure|face contour)\b/gi,
      /\b(?:high cheekbones?|defined cheekbones?|round cheekbones?|sharp cheekbones?)\b/gi,
      /\b(?:full lips?|thin lips?|rosy lips?|plump lips?|pale lips?)\b/gi,
      /\b(?:soft features?|sharp features?|delicate features?|strong features?|baby face|chubby face|slim face|oval face|heart face|round face|sharp jawline|soft jawline|jawline|chin|nose|forehead|visage|countenance)\b/gi,
      /\b(?:tall|short|medium height|medium-build|petite|slim|skinny|thin|curvy|voluptuous|plump|athletic|muscular|lean|toned|fit)\b/gi,
      /\b(?:six-pack|abs|muscles?|defined muscles?|lean body|perfect body|ideal body|body shape|body type|body form|figure)\b/gi,
      /\b(?:big bust|small bust|large breasts?|small breasts?|big breasts?|busty|breasts?)\b/gi,
      /\b(?:big hips?|small hips?|wide hips?|narrow hips?)\b/gi,
      /\b(?:small waist|big waist|wide waist|narrow waist|tiny waist|waist|belly)\b/gi,
      /\b(?:thighs?|thigh|legs?|arms?)\b/gi,
      /\b(?:makeup|makeup-free|no makeup|natural makeup|heavy makeup|light makeup|lipstick|lip gloss|eyeshadow|blush|rosy cheeks?|foundation|cosmetics)\b/gi,
      /\b(?:young|youthful|mature|adult|middle-aged|aged|teenage|teen|age spots?|age lines?|wrinkles?)\b/gi,
      /\b(?:beautiful|pretty|handsome|attractive|gorgeous|cute|hot|elegant|classy|refined|delicate|enchanting|alluring|feminine|seductive|sensual|breathtaking|glamorous|exotic|innocent|pure|naughty|sexy|erotic|stunning|radiant|flawless)\b/gi,
      /\b(?:devil horns?|demon horns?|horns?|horn crown|crown|tiara|headpiece|headband|ribbons?|ribbon|feathers?|wings?)\b/gi,
      /\b(?:cat ears?|fox ears?|animal ears?|bunny ears?|wolf ears?)\b/gi,
      /\b(?:headwear|hat|hats|veil|veils|scarf|scarves|headwrap|halo|angel halo)\b/gi,
      /\b(?:necklace|necklaces|earring|earrings|choker|chokers|pendant|pendants)\b/gi,
      /\b(?:wet skin|sweaty|sweat|moist|wet body|dripping wet|wet look|wet hair|water droplets?|splashing|splashed)\b/gi,
      /\b(?:shaved|unshaved|hairless|body hair|armpit hair|pubic hair|shaved body|trimmed|body grooming)\b/gi,
      /\b(?:tattoo|tattoos|tribal tattoo|body tattoo|body ink|skin ink)\b/gi,
      /\b(?:carnival|christmas|halloween|cosplay|costume|maid outfit|nurse uniform|police uniform|schoolgirl|schoolboy|school uniform|catgirl|catboy|bunny girl|maid dress)\b/gi,
      /\b(?:Chinese woman|Japanese woman|Korean woman|East Asian|Asian woman)\b/gi,
      /\b(?:北欧|欧美|白人|黑人)\b/g,
    ];

    let cleaned = prompt;
    for (const p of patterns) {
      try { cleaned = cleaned.replace(p, ''); } catch { /* skip bad regex */ }
    }

    // Cleanup
    cleaned = cleaned.replace(/,\s*,/g, ',');
    cleaned = cleaned.replace(/^\s*,\s*/, '');
    cleaned = cleaned.replace(/\s+/g, ' ');
    cleaned = cleaned.trim();
    cleaned = cleaned.replace(/,\s*$/, '');
    cleaned = cleaned.trim();

    return cleaned;
  };

  // Fixed identity anchor for img2img — describes preservation without appearance specifics
  const IDENTITY_ANCHOR = 'Maintain the exact facial identity, hairstyle, and body features from the reference image throughout every panel. High-fidelity character consistency, do not alter the character from the input image. ';

  const formatQwen2511Prompt = (prompt: string, girlfriend: GirlfriendPreset | null): string => {
    // Step 1: strip all character appearance descriptors for img2img
    const cleaned = stripAppearanceKeywords(prompt);

    // Step 2: prepend fixed identity anchor
    const parts: string[] = [IDENTITY_ANCHOR];

    // Step 3: add girlfriend-specific identity lock (no appearance specifics)
    if (girlfriend) {
      const charName = girlfriend.nameZh || girlfriend.name;
      const charId = girlfriend.id.toUpperCase().slice(0, 4);
      parts.push(`Strictly preserve the exact identity, character, and features of ${charName} (ID:${charId}) from the reference image. Do not alter the character at all.`);
    }

    // Step 4: add the cleaned prompt content
    parts.push(cleaned);

    return parts.join(' ');
  };

  const handleToggleFavorite = (imageUrl: string) => {
    const existing = getFavorites().find((f) => f.imageRef === imageUrl);
    if (existing) {
      removeFavorite(existing.id);
    } else {
      addFavorite({ imageUrl, source: 'history', r18: isR18Enabled });
    }
    setRefreshKey((k) => k + 1);
  };

  const handleGacha = useCallback(async () => {
    if (taskManager.isFull) {
      onError(`任务队列已满（最多 ${MAX_TASKS} 个任务），请等待当前任务完成`);
      return;
    }

    // Resolve reference image URL for img2img anchor
    let referenceImageUrl: string | undefined;
    if (selectedGirlfriend?.portraitUrl) {
      referenceImageUrl = selectedGirlfriend.portraitUrl;
    } else if (previewUrl && previewUrl.startsWith('blob:')) {
      try {
        const resp = await fetch(previewUrl);
        const blob = await resp.blob();
        referenceImageUrl = await blobToBase64(blob);
      } catch {
        // fallback: continue without reference URL
      }
    }

    setIsGachaLoading(true);
    setGachaPrompt('');
    try {
      // Streamed: as soon as the first chunk arrives we update the prompt
      // text in-place. Final formatting (Qwen-2511 face-lock) is applied on
      // `end` once the full prompt is known.
      await streamRandomPrompt(
        'image', isR18Enabled, 1, '', true, referenceImageUrl,
        undefined,
        {
          onDelta: ({ text }) => {
            setGachaPrompt((prev) => prev + text);
          },
          onEnd: ({ prompt }) => {
            const formatted = formatQwen2511Prompt(prompt, selectedGirlfriend);
            setGachaPrompt(formatted);
          },
          onError: ({ message }) => {
            onError(`抽卡失败：${message}`);
          },
        },
      );
    } catch {
      onError('抽卡失败，请重试');
    } finally {
      setIsGachaLoading(false);
    }
  }, [isR18Enabled, selectedGirlfriend, taskManager, onError, previewUrl]);

  const handleGenerateFromPrompt = useCallback(async () => {
    if (!params.uploadedImagePath) {
      onError('请先上传参考图片或选择 AI 女友');
      return;
    }
    // Prefer expanded prompt, fall back to gacha prompt, then custom prompt
    const textToUse = expandedPrompt.trim() || gachaPrompt.trim() || customPrompt.trim();
    if (!textToUse) return;
    if (taskManager.isFull) {
      onError(`任务队列已满（最多 ${MAX_TASKS} 个任务），请等待当前任务完成`);
      return;
    }

    // Apply Qwen-2511 face-lock format if girlfriend selected but not already applied
    let finalText = textToUse;
    if (selectedGirlfriend && !textToUse.includes('Strictly preserve') && !textToUse.includes('【严格锁定】')) {
      finalText = formatQwen2511Prompt(textToUse, selectedGirlfriend);
    }

    setIsGeneratingFromPrompt(true);
    try {
      const widthRatio = aspectRatio === 'portrait' ? '9' : '16';
      const heightRatio = aspectRatio === 'portrait' ? '16' : '9';
      const nodeList = [
        { nodeId: '291', fieldName: 'prompt', fieldValue: finalText, description: 'prompt' },
        { nodeId: '172', fieldName: 'value', fieldValue: widthRatio, description: 'width' },
        { nodeId: '173', fieldName: 'value', fieldValue: heightRatio, description: 'height' },
        { nodeId: '269', fieldName: 'value', fieldValue: String(params.batchSize), description: 'count' },
        { nodeId: '104', fieldName: 'image', fieldValue: params.uploadedImageUrl || params.uploadedImagePath, description: 'image' },
        { nodeId: '273', fieldName: 'value', fieldValue: 'false', description: 'enhance' },
      ];
      await taskManager.addTask('img2img', nodeList, finalText, WORKFLOW.IMAGE_TO_IMAGE);
      onSuccess('任务已提交');
    } catch (err) {
      onError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setIsGeneratingFromPrompt(false);
    }
  }, [expandedPrompt, gachaPrompt, customPrompt, params, selectedGirlfriend, taskManager, aspectRatio, onError, onSuccess]);
  // Keep ref in sync so handleOptimizePrompt (defined earlier) can safely call us.
  handleGenerateFromPromptRef.current = handleGenerateFromPrompt;

  const buildNodeList = () => {
    const finalPrompt = buildFinalPrompt();
    const widthRatio = aspectRatio === 'portrait' ? '9' : '16';
    const heightRatio = aspectRatio === 'portrait' ? '16' : '9';

    return [
      { nodeId: '291', fieldName: 'prompt', fieldValue: finalPrompt || params.prompt, description: 'prompt' },
      { nodeId: '172', fieldName: 'value', fieldValue: widthRatio, description: 'width' },
      { nodeId: '173', fieldName: 'value', fieldValue: heightRatio, description: 'height' },
      { nodeId: '269', fieldName: 'value', fieldValue: String(params.batchSize), description: 'count' },
      { nodeId: '104', fieldName: 'image', fieldValue: params.uploadedImageUrl || params.uploadedImagePath, description: 'image' },
      { nodeId: '273', fieldName: 'value', fieldValue: 'false', description: 'enhance' },
    ];
  };

  const handleGenerate = async () => {
    if (!params.uploadedImagePath) {
      onError('请先上传参考图片或选择 AI 女友');
      return;
    }
    const finalPrompt = buildFinalPrompt();
    if (!finalPrompt.trim() && !params.prompt.trim()) {
      onError('请输入提示词或选择至少一个标签');
      return;
    }
    if (taskManager.isFull) {
      onError(`任务队列已满（最多 ${MAX_TASKS} 个任务），请等待当前任务完成`);
      return;
    }
    try {
      const nodeList = buildNodeList();
      const combinedPrompt = customPrompt || params.prompt || finalPrompt;
      await taskManager.addTask('img2img', nodeList, combinedPrompt, WORKFLOW.IMAGE_TO_IMAGE);
      onSuccess('任务已提交');
    } catch (err) {
      onError(err instanceof Error ? err.message : '提交失败');
    }
  };

  const img2imgTasks = taskManager.tasks.filter((t: QueuedTask) =>
    t.workflowType === 'img2img' || t.workflowType === 'multi-ref-img2img'
  );
  const allImages = img2imgTasks.flatMap((t: QueuedTask) => t.images);
  const totalSelected = positiveTags.length + negativeTags.length;

  // ── 多图模式「插入参考图引用」按钮组（TagPanel 内部 textarea 下方使用）──────────
  // 作用：点击图1/图2/图3 直接在 TagPanel 的多图种子 textarea 内追加占位符
  // 与描述提示词（multiRefPrompt）下方的同名按钮完全一致；图1 默认是锚定数字人
  const renderMultiRefTagPanelImageButtons = () => (
    <>
      <span className="text-[10px] text-text-tertiary">插入参考图:</span>
      {[0, 1, 2].map(idx => {
        const hasImage = !!multiRefImages[idx]?.path;
        const isLocked = idx === 0 && !!multiRefGirlfriend;
        const label = `图${idx + 1}`;
        return (
          <button
            key={idx}
            onClick={() => {
              // 写入 TagPanel 自己的种子 textarea（multiRefTagCustomPrompt）
              // 选中正向标签后同步注入 multiRefPrompt 的逻辑见 handleMultiRefAddTag
              setMultiRefTagCustomPrompt(prev => {
                const cur = prev.trim();
                return cur ? `${cur} ${label}` : label;
              });
            }}
            disabled={!hasImage || taskManager.isFull || multiRefSubmitting}
            title={hasImage
              ? `在标签库编辑框插入"${label}"占位符${isLocked ? '（锚定数字人）' : ''}`
              : `请先上传参考图 ${idx + 1}`}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all ${
              hasImage
                ? 'bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 cursor-pointer'
                : 'bg-bg-elevated text-text-tertiary border border-border cursor-not-allowed opacity-50'
            }`}
          >
            <Plus size={10} />
            {label}
            {isLocked && <span className="text-red-500 ml-0.5">●</span>}
          </button>
        );
      })}
    </>
  );

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Task list */}
      <TaskList
        tasks={img2imgTasks}
        onCancel={taskManager.cancelTask}
        onClearCompleted={taskManager.clearCompleted}
        onRegenerate={taskManager.regenerateTask}
      />

      {/* 图生图模型选择 */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-text-primary">图生图模型</span>
          <div className="flex gap-1">
            <button
              onClick={() => setImg2imgMode('single')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                img2imgMode === 'single'
                  ? 'bg-primary text-white'
                  : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'
              }`}
              disabled={taskManager.isFull}
            >
              单图编辑
            </button>
            <button
              onClick={() => setImg2imgMode('multi')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                img2imgMode === 'multi'
                  ? 'bg-primary text-white'
                  : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'
              }`}
              disabled={taskManager.isFull}
            >
              多图编辑
            </button>
          </div>
        </div>
        {img2imgMode === 'multi' && (
          <div className="mt-2 text-xs text-text-tertiary">
            支持同时上传3张参考图，生成融合多图元素的编辑结果
          </div>
        )}
      </div>

      {/* Girlfriend Selector — 仅单图模式 */}
      {img2imgMode === 'single' && (
      <GirlfriendSelector
        selectedId={selectedGirlfriend ? (selectedGirlfriend.isCustom ? `custom_${selectedGirlfriend.id}` : selectedGirlfriend.id) : null}
        onSelect={handleGirlfriendSelect}
        disabled={girlfriendUploading || taskManager.isFull}
      />
      )}

      {/* ─── 单图编辑模式 UI ─────────────────────────────────────────────── */}
      {img2imgMode === 'single' && (
        <>
      {/* Image upload (shows selected girlfriend preview) */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <ImageUploader
          value={params.uploadedImagePath}
          previewUrl={previewUrl}
          onChange={handleImageChange}
          onUpload={handleUpload}
          disabled={taskManager.isFull}
          error={uploadError || undefined}
          uploadLabel={selectedGirlfriend ? '更换图片' : undefined}
        />
        {selectedGirlfriend && (
          <div className="mt-2 flex items-center gap-2">
            <div className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 text-[10px] font-medium border border-red-200/50">
              AI 女友模式 · {selectedGirlfriend.nameZh || selectedGirlfriend.name}
            </div>
            {girlfriendUploading && (
              <div className="flex items-center gap-1 text-[10px] text-text-tertiary">
                <div className="w-3 h-3 border border-text-tertiary/30 border-t-text-tertiary rounded-full animate-spin" />
                上传中...
              </div>
            )}
          </div>
        )}
      </div>
        </>
      )}

      {/* ─── 多图编辑模式 UI ────────────────────────────────────────────── */}
      {img2imgMode === 'multi' && (
        <>
        {/* 锚定数字人（多图模式） */}
        <GirlfriendSelector
          selectedId={multiRefGirlfriend ? (multiRefGirlfriend.isCustom ? `custom_${multiRefGirlfriend.id}` : multiRefGirlfriend.id) : null}
          onSelect={handleMultiRefGirlfriendSelect}
          disabled={multiRefGirlfriendUploading || taskManager.isFull || multiRefSubmitting}
        />

        {/* 3张参考图上传 */}
        <div className="rounded-xl bg-bg-surface border border-border p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[0, 1, 2].map(idx => {
              const lockedByGirlfriend = idx === 0 && !!multiRefGirlfriend;
              return (
                <div key={idx}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-xs font-medium text-text-secondary">参考图 {idx + 1}</span>
                    {lockedByGirlfriend && (
                      <span className="px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 text-[10px] font-medium border border-red-200/50">
                        锚定数字人
                      </span>
                    )}
                  </div>
                  <ImageUploader
                    value={multiRefImages[idx]?.path || ''}
                    previewUrl={multiRefImages[idx]?.preview || ''}
                    onChange={(path, preview) => handleMultiRefImageChange(idx, path, preview)}
                    onUpload={(file) => handleMultiRefUpload(idx, file)}
                    disabled={taskManager.isFull || multiRefSubmitting || lockedByGirlfriend}
                    error={multiRefUploadErrors[idx] || undefined}
                    uploadLabel={lockedByGirlfriend ? '已锁定' : '上传'}
                  />
                </div>
              );
            })}
          </div>
          {multiRefUploading && (
            <div className="mt-2 flex items-center gap-1 text-xs text-text-tertiary">
              <div className="w-3 h-3 border border-text-tertiary/30 border-t-text-tertiary rounded-full animate-spin" />
              上传中...
            </div>
          )}
          {multiRefGirlfriend && (
            <div className="mt-2 flex items-center gap-2">
              <div className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 text-[10px] font-medium border border-red-200/50">
                锚定数字人 · {multiRefGirlfriend.nameZh || multiRefGirlfriend.name}
              </div>
              {multiRefGirlfriendUploading && (
                <div className="flex items-center gap-1 text-[10px] text-text-tertiary">
                  <div className="w-3 h-3 border border-text-tertiary/30 border-t-text-tertiary rounded-full animate-spin" />
                  上传中...
                </div>
              )}
            </div>
          )}
        </div>

        {/* 多图编辑设置面板 */}
        <div className="rounded-xl bg-bg-surface border border-border p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">宽高比</label>
            <select
              value={multiRefAspectRatio}
              onChange={e => setMultiRefAspectRatio(e.target.value)}
              disabled={taskManager.isFull || multiRefSubmitting}
              className="w-full px-3 py-2 rounded-lg bg-bg-elevated text-text-primary text-sm border border-border focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            >
              {['1:1', '3:4', '4:3', '2:3', '3:2', '9:16', '16:9'].map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">分辨率</label>
              <select
                value={multiRefResolution}
                onChange={e => setMultiRefResolution(Number(e.target.value))}
                disabled={taskManager.isFull || multiRefSubmitting}
                className="w-full px-3 py-2 rounded-lg bg-bg-elevated text-text-primary text-sm border border-border focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              >
                {[1024, 1536, 2048, 3072, 4096].map(r => (
                  <option key={r} value={r}>{r}px</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">抽卡数</label>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setMultiRefCount(Math.max(1, multiRefCount - 1))}
                  disabled={taskManager.isFull || multiRefSubmitting || multiRefCount <= 1}
                  className="w-8 h-8 rounded-lg bg-bg-elevated border border-border text-text-primary hover:bg-bg-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={multiRefCount}
                  onChange={e => {
                    const v = Number(e.target.value);
                    if (!isNaN(v)) setMultiRefCount(Math.max(1, Math.min(8, v)));
                  }}
                  disabled={taskManager.isFull || multiRefSubmitting}
                  className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-bg-elevated text-text-primary text-sm text-center border border-border focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
                <button
                  onClick={() => setMultiRefCount(Math.min(8, multiRefCount + 1))}
                  disabled={taskManager.isFull || multiRefSubmitting || multiRefCount >= 8}
                  className="w-8 h-8 rounded-lg bg-bg-elevated border border-border text-text-primary hover:bg-bg-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">
              描述提示词 <span className="text-red-500">*</span>
            </label>
            <textarea
              value={multiRefPrompt}
              onChange={e => setMultiRefPrompt(e.target.value)}
              placeholder={multiRefGirlfriend
                ? `描述多张图片之间的关系，例如：图1${multiRefGirlfriend.nameZh || multiRefGirlfriend.name}坐在图2沙发上，图3的背景是海边`
                : '描述多张图片之间的关系，例如：图1女人坐在图2沙发上，图3的背景是海边'}
              rows={3}
              disabled={taskManager.isFull || multiRefSubmitting}
              className="w-full px-3 py-2 rounded-lg bg-bg-elevated text-text-primary text-sm border border-border focus:outline-none focus:ring-1 focus:ring-primary resize-none disabled:opacity-50 placeholder:text-text-tertiary"
            />

            {/* 参考图快捷插入按钮（对应"图1/图2/图3"占位符） */}
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-text-tertiary">插入参考图引用:</span>
              {[0, 1, 2].map(idx => {
                const hasImage = !!multiRefImages[idx]?.path;
                const isLocked = idx === 0 && !!multiRefGirlfriend;
                const label = `图${idx + 1}`;
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      const current = multiRefPrompt.trim();
                      const newPrompt = current ? `${current} ${label}` : label;
                      setMultiRefPrompt(newPrompt);
                    }}
                    disabled={!hasImage || taskManager.isFull || multiRefSubmitting}
                    title={hasImage
                      ? `插入"${label}"到提示词开头（参考图 ${idx + 1} 已上传${isLocked ? '· 锚定数字人' : ''}）`
                      : `请先上传参考图 ${idx + 1}（未上传时按钮置灰）`}
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all ${
                      hasImage
                        ? 'bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 cursor-pointer'
                        : 'bg-bg-elevated text-text-tertiary border border-border cursor-not-allowed opacity-50'
                    }`}
                  >
                    <Plus size={10} />
                    {label}
                    {isLocked && <span className="text-red-500 ml-0.5">●</span>}
                  </button>
                );
              })}
              {/* DNA 描述快捷插入 */}
              {multiRefDna && multiRefDna.character_description && (
                <button
                  onClick={() => {
                    const desc = multiRefDna.character_description || '';
                    const current = multiRefPrompt.trim();
                    const newPrompt = current
                      ? `${current}，${desc}`
                      : desc;
                    setMultiRefPrompt(newPrompt);
                  }}
                  disabled={taskManager.isFull || multiRefSubmitting}
                  title="插入 DNA 提取的人物描述到提示词"
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-pink-500/10 text-pink-600 border border-pink-300/40 hover:bg-pink-500/20 transition-all"
                >
                  <User size={10} />
                  人物
                </button>
              )}
              {multiRefDna && multiRefDna.clothing_list && multiRefDna.clothing_list.length > 0 && (
                <button
                  onClick={() => {
                    const clothings = (multiRefDna.clothing_list || [])
                      .map((c: any) => c.name)
                      .filter(Boolean)
                      .join('，');
                    const current = multiRefPrompt.trim();
                    const newPrompt = current
                      ? `${current}，穿${clothings}`
                      : `穿${clothings}`;
                    setMultiRefPrompt(newPrompt);
                  }}
                  disabled={taskManager.isFull || multiRefSubmitting}
                  title="插入 DNA 提取的服装列表"
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-amber-500/10 text-amber-700 border border-amber-300/40 hover:bg-amber-500/20 transition-all"
                >
                  <Shirt size={10} />
                  服装
                </button>
              )}
              {multiRefDna && multiRefDna.scene_description && (
                <button
                  onClick={() => {
                    const desc = multiRefDna.scene_description || '';
                    const current = multiRefPrompt.trim();
                    const newPrompt = current
                      ? `${current}，场景：${desc}`
                      : `场景：${desc}`;
                    setMultiRefPrompt(newPrompt);
                  }}
                  disabled={taskManager.isFull || multiRefSubmitting}
                  title="插入 DNA 提取的场景描述"
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-blue-500/10 text-blue-700 border border-blue-300/40 hover:bg-blue-500/20 transition-all"
                >
                  <MapPin size={10} />
                  场景
                </button>
              )}
            </div>

            {/* 多图模式 DNA 面板（图片DNA自动提取结果，与图生视频情色模式一致） */}
            {(multiRefDna || multiRefDnaLoading || multiRefDnaError) && (
              <div className="mt-3">
                <ImageDnaPanel
                  dna={multiRefDna}
                  loading={multiRefDnaLoading}
                  error={multiRefDnaError}
                  imageUrl={multiRefImages[0]?.preview || multiRefImages[0]?.path}
                  additionalImageUrls={multiRefImages.slice(1, 6).map(img => img.preview || img.path).filter(Boolean)}
                  onReExtract={() => {
                    setMultiRefDna(null);
                    setMultiRefDnaError(null);
                  }}
                  onCopyClothing={(clothing) => {
                    const text = `${clothing.name}${clothing.color ? ' ' + clothing.color : ''}${clothing.style ? ' ' + clothing.style : ''}`;
                    const current = multiRefPrompt.trim();
                    setMultiRefPrompt(current ? `${current}，${text}` : text);
                    onSuccess?.(`已插入服装: ${clothing.name}`);
                  }}
                  onCopyCharacter={() => {
                    const desc = multiRefDna?.character_description || '';
                    if (!desc) return;
                    const current = multiRefPrompt.trim();
                    setMultiRefPrompt(current ? `${current}，${desc}` : desc);
                  }}
                  onCopyScene={() => {
                    const desc = multiRefDna?.scene_description || '';
                    if (!desc) return;
                    const current = multiRefPrompt.trim();
                    setMultiRefPrompt(current ? `${current}，场景：${desc}` : `场景：${desc}`);
                  }}
                  onInsertAsReference={(dataUrl, clothingName) => {
                    // 找到第一个空槽位（不是用户锚定的数字人）插入服装图
                    const targetIdx = multiRefImages.findIndex((img, idx) =>
                      !img.path && !(idx === 0 && multiRefGirlfriend)
                    );
                    if (targetIdx < 0) {
                      onError?.('没有空的参考图槽位，请先删除一些图片');
                      return;
                    }
                    // 上传到 RunningHub
                    (async () => {
                      try {
                        const blob = await (await fetch(dataUrl)).blob();
                        const file = new File([blob], `${clothingName}.png`, { type: 'image/png' });
                        const { imagePath, downloadUrl } = await uploadImage(apiKey, file);
                        setMultiRefImages(prev => {
                          const updated = [...prev];
                          updated[targetIdx] = { path: imagePath, preview: downloadUrl || dataUrl };
                          return updated;
                        });
                        onSuccess?.(`已插入"${clothingName}"到参考图 ${targetIdx + 1}`);
                      } catch (err) {
                        onError?.(`服装图插入失败: ${err instanceof Error ? err.message : '未知错误'}`);
                      }
                    })();
                  }}
                />
              </div>
            )}

            {/* 多图模式姿势预设（同步到 multiRefPrompt） */}
            <div className="mt-3">
              <PosePresetSelector
                type="image"
                onSelect={handleMultiRefPoseSelect}
                disabled={taskManager.isFull || multiRefSubmitting}
                selectedGirlfriend={multiRefGirlfriend}
              />
            </div>
            {multiRefGirlfriend && (
              <div className="mt-1.5 text-xs text-text-tertiary">
                已锚定数字人「{multiRefGirlfriend.nameZh || multiRefGirlfriend.name}」，将自动注入角色身份锁定提示词
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-text-primary">文生图开关</span>
            <button
              onClick={() => setMultiRefEnhance(v => !v)}
              className={`w-10 h-5 rounded-full transition-colors relative ${
                multiRefEnhance ? 'bg-primary' : 'bg-bg-elevated border border-border'
              }`}
              disabled={taskManager.isFull || multiRefSubmitting}
            >
              <div className={`w-4 h-4 rounded-full absolute top-0.5 transition-all ${
                multiRefEnhance ? 'right-0.5 bg-white' : 'left-0.5 bg-text-tertiary'
              }`} />
            </button>
          </div>

          {/* ─── DNA 自动提取开关 ─────────────────────────────────────────── */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-gradient-to-r from-pink-500/5 via-rose-500/5 to-red-500/5 border border-pink-200/50">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-pink-500" />
                <span className="text-sm font-semibold text-text-primary">DNA 自动提取</span>
                <span className="text-[10px] text-text-tertiary hidden sm:inline">· Gemini-3.8-flash</span>
              </div>
              <p className="text-[10px] text-text-tertiary mt-1 leading-relaxed">
                {multiRefDnaAutoExtract
                  ? '✅ 已开启：上传参考图后自动提取人物/场景/服装信息'
                  : '💡 开启后首张参考图上传完成时自动提取 DNA（需要联网调用 Gemini 视觉模型）'}
              </p>
            </div>
            <button
              onClick={() => {
                if (multiRefDnaAutoExtract) {
                  setMultiRefDnaAutoExtract(false);
                  return;
                }
                setMultiRefDnaAutoExtract(true);
                // 立刻清掉旧结果，让 useEffect 重新跑
                setMultiRefDna(null);
                setMultiRefDnaError(null);
              }}
              className={`flex-shrink-0 w-11 h-6 rounded-full transition-colors relative ${
                multiRefDnaAutoExtract ? 'bg-pink-500' : 'bg-text-tertiary/40'
              }`}
              disabled={taskManager.isFull || multiRefSubmitting}
            >
              <div
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${
                  multiRefDnaAutoExtract ? 'right-0.5' : 'left-0.5'
                }`}
              />
            </button>
          </div>

          {/* ─── DNA 状态行（即使关闭开关也能显示，便于用户开/关观察） ───────── */}
          {!multiRefDnaAutoExtract && !multiRefDna && !multiRefDnaError && !multiRefDnaLoading && (
            <div className="text-[10px] text-text-tertiary -mt-2">
              ℹ️ 当前未开启 DNA 提取。开启后这里会显示人物/场景/服装分析结果
            </div>
          )}

          {/* 多图编辑生成按钮 */}
          <GenerateButton
            onClick={() => handleMultiRefGenerate()}
            isLoading={multiRefSubmitting}
            disabled={!multiRefImages.some(img => img.path) || !multiRefPrompt.trim() || taskManager.isFull}
            label={multiRefSubmitting ? '提交中...' : taskManager.isFull ? '队列已满' : '开始生成'}
          />
        </div>

        {/* ═══ 多图模式标签库（与单图模式独立）══════════════════════════════════════ */}
        <div className="rounded-xl bg-bg-surface border border-border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text-primary">📚 标签库</span>
            <span className="text-[10px] text-text-tertiary">为多图编辑选 Tag，拼成提示词种子</span>
          </div>
          <p className="text-[10px] text-text-tertiary leading-relaxed">
            💡 在标签库选择的 tag 会自动追加到上方"图1/图2/图3"提示词中，可与"插入参考图"组合使用。
          </p>
          {/* 移动端：在 textarea 下方直接呈现紧凑版 */}
          <div className="lg:hidden">
            <TagPanel
              positiveTags={multiRefPositiveTags}
              negativeTags={multiRefNegativeTags}
              customPrompt={multiRefTagCustomPrompt}
              enableRandomPrompt={multiRefTagEn}
              isR18Enabled={multiRefTagR18}
              displayLang={multiRefTagLang}
              onCustomPromptChange={setMultiRefTagCustomPrompt}
              onAddTag={handleMultiRefAddTag}
              onRemoveTag={handleMultiRefRemoveTag}
              onUpdateTagWeight={handleMultiRefUpdateTagWeight}
              onMoveTagUp={handleMultiRefMoveTagUp}
              onMoveTagDown={handleMultiRefMoveTagDown}
              onClearAll={handleMultiRefClearAll}
              onEnableRandomPrompt={setMultiRefTagEn}
              onEnableR18={() => setMultiRefTagR18(v => !v)}
              onDisplayLangChange={setMultiRefTagLang}
              disabled={taskManager.isFull || multiRefSubmitting}
              expandedPrompt={multiRefTagExpanded}
              onExpandedPromptChange={setMultiRefTagExpanded}
              extraTextareaActions={renderMultiRefTagPanelImageButtons()}
              onGenerateFromPrompt={async () => {
                const finalPrompt = buildMultiRefTagPanelPrompt();
                if (!finalPrompt) {
                  onError?.('请先选择标签或输入自定义提示词');
                  return;
                }
                setMultiRefPrompt(finalPrompt);
                onSuccess?.('已根据标签/自定义提示词生成多图编辑种子');
              }}
              onSubmitGeneration={async () => {
                // 标签生成卡片的「生图」按钮 — 直接以标签库内容为提示词生图
                const finalPrompt = buildMultiRefTagPanelPrompt();
                if (!finalPrompt) {
                  onError?.('请先选择标签或输入自定义提示词');
                  return;
                }
                await handleMultiRefGenerate(finalPrompt);
              }}
              isSubmittingGeneration={multiRefSubmitting}
            />
          </div>
          {/* 桌面端：和单图模式一致的双列展示 */}
          <div className="hidden lg:block">
            <TagPanel
              positiveTags={multiRefPositiveTags}
              negativeTags={multiRefNegativeTags}
              customPrompt={multiRefTagCustomPrompt}
              enableRandomPrompt={multiRefTagEn}
              isR18Enabled={multiRefTagR18}
              displayLang={multiRefTagLang}
              onCustomPromptChange={setMultiRefTagCustomPrompt}
              onAddTag={handleMultiRefAddTag}
              onRemoveTag={handleMultiRefRemoveTag}
              onUpdateTagWeight={handleMultiRefUpdateTagWeight}
              onMoveTagUp={handleMultiRefMoveTagUp}
              onMoveTagDown={handleMultiRefMoveTagDown}
              onClearAll={handleMultiRefClearAll}
              onEnableRandomPrompt={setMultiRefTagEn}
              onEnableR18={() => setMultiRefTagR18(v => !v)}
              onDisplayLangChange={setMultiRefTagLang}
              disabled={taskManager.isFull || multiRefSubmitting}
              expandedPrompt={multiRefTagExpanded}
              onExpandedPromptChange={setMultiRefTagExpanded}
              extraTextareaActions={renderMultiRefTagPanelImageButtons()}
              onGenerateFromPrompt={async () => {
                const finalPrompt = buildMultiRefTagPanelPrompt();
                if (!finalPrompt) {
                  onError?.('请先选择标签或输入自定义提示词');
                  return;
                }
                setMultiRefPrompt(finalPrompt);
                onSuccess?.('已根据标签/自定义提示词生成多图编辑种子');
              }}
              onSubmitGeneration={async () => {
                const finalPrompt = buildMultiRefTagPanelPrompt();
                if (!finalPrompt) {
                  onError?.('请先选择标签或输入自定义提示词');
                  return;
                }
                await handleMultiRefGenerate(finalPrompt);
              }}
              isSubmittingGeneration={multiRefSubmitting}
            />
          </div>
          <div className="text-[10px] text-text-tertiary leading-relaxed">
            ✅ 已选 <span className="text-primary font-medium">{multiRefPositiveTags.length}</span> 个正向 tag
            {multiRefNegativeTags.length > 0 && (
              <span>，<span className="text-red-500 font-medium">{multiRefNegativeTags.length}</span> 个反向 tag</span>
            )}
          </div>
        </div>
        </>
      )}

      {/* ─── 单图模式专属功能 ─────────────────────────────────────────────── */}
      {img2imgMode === 'single' && (
        <>
      {/* Pose presets */}
      <PosePresetSelector
        type="image"
        onSelect={handlePoseSelect}
        disabled={taskManager.isFull}
        selectedGirlfriend={selectedGirlfriend}
      />

      {/* Smart Storyboard */}
      <StoryboardSection
        r18Enabled={isR18Enabled}
        selectedGirlfriend={selectedGirlfriend}
        displayLang={displayLang}
        disabled={taskManager.isFull}
        onGenerateStoryboard={handleGenerateStoryboardPanels}
        onGenerateSingleImage={handleGenerateSingleStoryboardImage}
        onSuccess={onSuccess}
        onError={onError}
      />

      {/* Tag Panel - desktop */}
      <div className="hidden lg:block">
        <TagPanel
          positiveTags={positiveTags}
          negativeTags={negativeTags}
          customPrompt={customPrompt}
          enableRandomPrompt={enableRandomPrompt}
          isR18Enabled={isR18Enabled}
          displayLang={displayLang}
          onCustomPromptChange={setCustomPrompt}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onUpdateTagWeight={handleUpdateTagWeight}
          onMoveTagUp={handleMoveTagUp}
          onMoveTagDown={handleMoveTagDown}
          onClearAll={handleClearAll}
          onEnableRandomPrompt={setEnableRandomPrompt}
          onEnableR18={() => setIsR18Enabled(!isR18Enabled)}
          onDisplayLangChange={setDisplayLang}
          disabled={taskManager.isFull}
          onOptimizePrompt={handleOptimizePrompt}
          isOptimizing={isOptimizing}
          onGenerateFromPrompt={handleGenerateFromPrompt}
          isGeneratingFromPrompt={isGeneratingFromPrompt}
          expandedPrompt={expandedPrompt}
          onExpandedPromptChange={setExpandedPrompt}
          onGacha={handleGacha}
          isGachaLoading={isGachaLoading}
          gachaPrompt={gachaPrompt}
          onGachaPromptChange={setGachaPrompt}
        />
      </div>

      {/* Tag Panel - mobile */}
      <div className="lg:hidden">
        <TagPanel
          positiveTags={positiveTags}
          negativeTags={negativeTags}
          customPrompt={customPrompt}
          enableRandomPrompt={enableRandomPrompt}
          isR18Enabled={isR18Enabled}
          displayLang={displayLang}
          onCustomPromptChange={setCustomPrompt}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onUpdateTagWeight={handleUpdateTagWeight}
          onMoveTagUp={handleMoveTagUp}
          onMoveTagDown={handleMoveTagDown}
          onClearAll={handleClearAll}
          onEnableRandomPrompt={setEnableRandomPrompt}
          onEnableR18={() => setIsR18Enabled(!isR18Enabled)}
          onDisplayLangChange={setDisplayLang}
          disabled={taskManager.isFull}
          onOptimizePrompt={handleOptimizePrompt}
          isOptimizing={isOptimizing}
          onGenerateFromPrompt={handleGenerateFromPrompt}
          isGeneratingFromPrompt={isGeneratingFromPrompt}
          expandedPrompt={expandedPrompt}
          onExpandedPromptChange={setExpandedPrompt}
          onGacha={handleGacha}
          isGachaLoading={isGachaLoading}
          gachaPrompt={gachaPrompt}
          onGachaPromptChange={setGachaPrompt}
        />
      </div>

      {/* Batch size */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <ParameterSlider
          label="生成数量"
          value={params.batchSize}
          min={1}
          max={8}
          onChange={(v) => updateParam('batchSize', v)}
        />
      </div>

      {/* Aspect ratio toggle */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-text-primary">图片比例</span>
          <div className="flex gap-1">
            <button
              onClick={() => setAspectRatio('portrait')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                aspectRatio === 'portrait'
                  ? 'bg-primary text-white'
                  : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'
              }`}
              disabled={taskManager.isFull}
            >
              竖屏 (9:16)
            </button>
            <button
              onClick={() => setAspectRatio('landscape')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                aspectRatio === 'landscape'
                  ? 'bg-primary text-white'
                  : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'
              }`}
              disabled={taskManager.isFull}
            >
              横屏 (16:9)
            </button>
          </div>
        </div>
      </div>

      {/* Generate button - desktop */}
      <div className="hidden lg:block pt-2 pb-4">
        <GenerateButton
          onClick={handleGenerate}
          isLoading={false}
          disabled={!params.uploadedImagePath || taskManager.isFull || girlfriendUploading}
          label={
            taskManager.isFull
              ? '队列已满'
              : girlfriendUploading
              ? '上传女友图片中...'
              : `开始生成${totalSelected > 0 ? ` (${totalSelected}标签)` : ''}`
          }
        />
      </div>

      {/* Generate button - mobile */}
      <div className="lg:hidden pt-1 pb-2">
        <GenerateButton
          onClick={handleGenerate}
          isLoading={false}
          disabled={!params.uploadedImagePath || taskManager.isFull || girlfriendUploading}
          label={
            taskManager.isFull
              ? '队列已满'
              : girlfriendUploading
              ? '上传女友图片中...'
              : `开始生成${totalSelected > 0 ? ` (${totalSelected}标签)` : ''}`
          }
        />
      </div>
        </>
      )}
    </div>
  );
}
