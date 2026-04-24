import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ImagePlus, Sparkles } from 'lucide-react';
import { ImageUploader } from '../components/ImageUploader';
import { GirlfriendSelector } from '../components/GirlfriendSelector';
import { ParameterSlider } from '../components/ParameterSlider';
import { GenerateButton } from '../components/GenerateButton';
import { TaskList } from '../components/TaskList';
import { TagPanel } from '../components/TagPanel';
import { getWorkflowFormat, uploadImage, WORKFLOW } from '../services/runninghub';
import { expandPrompt, randomPrompt } from '../services/promptApi';
import type { ImageToImageParams, QueuedTask } from '../types';
import type { TaskManagerReturn } from '../hooks/useTaskManager';
import type { WeightMode } from '../components/PromptEditor';
import { DEFAULT_GIRLFRIEND_PRESETS, type GirlfriendPreset } from '../data/girlfriendPresets';
import { PosePresetSelector } from '../components/PosePresetSelector';
import { QUALITY_BOOST_PROMPT } from '../constants';

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
}: ImageToImagePageProps) {
  const [params, setParams] = useState<ImageToImageParams>({
    prompt: '',
    batchSize: 4,
    uploadedImagePath: '',
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

  // Pre-fill customPrompt when navigating from history regenerate
  useEffect(() => {
    if (initialPrompt && initialPrompt.trim()) {
      setCustomPrompt(initialPrompt.trim());
      onPromptConsumed?.();
    }
  }, [initialPrompt]); // eslint-disable-line react-hooks/exhaustive-deps

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
        const { imagePath } = await uploadImage(apiKey, file);
        if (cancelled) return;

        // Update state for UI
        updateParam('uploadedImagePath', imagePath);

        if (cancelled) return;

        // Build prompt: character prompt (from gf) + history prompt (initialPrompt) + quality boost
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
          onError('任务队列已满（最多 20 个任务），请等待当前任务完成');
          return;
        }
        const nodeList = [
          { nodeId: '60', fieldName: 'image', fieldValue: imagePath, description: '选择图片' },
          { nodeId: '64', fieldName: 'batch_size', fieldValue: String(params.batchSize), description: '图片数量' },
          { nodeId: '82', fieldName: 'value', fieldValue: 'false', description: 'tt/zip（默认zip）' },
          { nodeId: '59', fieldName: 'text', fieldValue: promptText, description: '文字描述' },
          { nodeId: '70', fieldName: 'ckpt_name', fieldValue: 'Qwen-Rapid-AIO-NSFW-v23.0.safetensors', description: '模型选择（qwen-2511-edit）' },
          { nodeId: '80', fieldName: 'lora_name', fieldValue: 'any2realV2.safetensors', description: 'lora(qwen-2511)' },
          { nodeId: '80', fieldName: 'strength_model', fieldValue: '0', description: 'lora权重' },
        ];
        await taskManager.addTask('img2img', nodeList, promptText, WORKFLOW.QWEN_IMG2IMG);
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
  }, [regenerateWithGirlfriendId]); // eslint-disable-line react-hooks/exhaustive-deps

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
      try {
        const res = await fetch(gf.portraitUrl);
        const blob = await res.blob();
        const file = new File([blob], `${gf.id}.jpg`, { type: 'image/jpeg' });
        const objectUrl = URL.createObjectURL(file);
        setPreviewUrl(objectUrl);
        const { imagePath } = await uploadImage(apiKey, file);
        updateParam('uploadedImagePath', imagePath);
        onSuccess(`已选择女友「${gf.nameZh || gf.name}」作为参考`);
      } catch (err) {
        onError('女友图片上传失败，请重试');
        setSelectedGirlfriend(null);
        setPreviewUrl('');
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
        const { imagePath } = await uploadImage(apiKey, file);
        updateParam('uploadedImagePath', imagePath);
        onSuccess('图片上传成功');
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : '上传失败');
        throw err;
      }
    },
    [apiKey, onSuccess]
  );

  const handlePoseSelect = useCallback((posePrompt: string, poseName: string) => {
    const current = customPrompt.trim();
    const newPrompt = current ? `${current}, ${posePrompt}` : posePrompt;
    setCustomPrompt(newPrompt);
    onSuccess(`已添加姿势: ${poseName}`);
  }, [customPrompt, onSuccess]);

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
  const IDENTITY_ANCHOR = '1girl, same character as reference image, character consistency, preserve identity, do not alter the character from the input image, ';

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

  const handleGacha = useCallback(async () => {
    if (taskManager.isFull) {
      onError('任务队列已满（最多 20 个任务），请等待当前任务完成');
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
    try {
      const res = await randomPrompt('image', isR18Enabled, 1, '', true, referenceImageUrl);
      if (res.results.length > 0) {
        const prompt = res.results[0].prompt;
        // Format with Qwen-2511 face-lock if girlfriend selected
        const formatted = formatQwen2511Prompt(prompt, selectedGirlfriend);
        setGachaPrompt(formatted);
      }
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
      onError('任务队列已满（最多 20 个任务），请等待当前任务完成');
      return;
    }

    // Apply Qwen-2511 face-lock format if girlfriend selected but not already applied
    let finalText = textToUse;
    if (selectedGirlfriend && !textToUse.includes('Strictly preserve') && !textToUse.includes('【严格锁定】')) {
      finalText = formatQwen2511Prompt(textToUse, selectedGirlfriend);
    }

    setIsGeneratingFromPrompt(true);
    try {
      // Debug: log workflow format
      try {
        const format = await getWorkflowFormat(apiKey, WORKFLOW.QWEN_IMG2IMG);
        console.log('[QWEN_IMG2IMG] Workflow format:', JSON.stringify(format, null, 2));
      } catch (e) {
        console.warn('[QWEN_IMG2IMG] Could not fetch workflow format:', e);
      }

      const nodeList = [
        { nodeId: '60', fieldName: 'image', fieldValue: params.uploadedImagePath, description: '选择图片' },
        { nodeId: '64', fieldName: 'batch_size', fieldValue: String(params.batchSize), description: '图片数量' },
        { nodeId: '82', fieldName: 'value', fieldValue: 'false', description: 'tt/zip（默认zip）' },
        { nodeId: '59', fieldName: 'text', fieldValue: finalText, description: '文字描述' },
        { nodeId: '70', fieldName: 'ckpt_name', fieldValue: 'Qwen-Rapid-AIO-NSFW-v23.0.safetensors', description: '模型选择（qwen-2511-edit）' },
        { nodeId: '80', fieldName: 'lora_name', fieldValue: 'any2realV2.safetensors', description: 'lora(qwen-2511)' },
        { nodeId: '80', fieldName: 'strength_model', fieldValue: '0', description: 'lora权重' },
      ];
      await taskManager.addTask('img2img', nodeList, finalText, WORKFLOW.QWEN_IMG2IMG);
      onSuccess('任务已提交');
    } catch (err) {
      onError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setIsGeneratingFromPrompt(false);
    }
  }, [expandedPrompt, gachaPrompt, customPrompt, params, selectedGirlfriend, taskManager, apiKey, onError, onSuccess]);

  const buildNodeList = () => {
    const finalPrompt = buildFinalPrompt();

    return [
      { nodeId: '60', fieldName: 'image', fieldValue: params.uploadedImagePath, description: '选择图片' },
      { nodeId: '64', fieldName: 'batch_size', fieldValue: String(params.batchSize), description: '图片数量' },
      { nodeId: '82', fieldName: 'value', fieldValue: 'false', description: 'tt/zip（默认zip）' },
      { nodeId: '59', fieldName: 'text', fieldValue: finalPrompt || params.prompt, description: '文字描述' },
      { nodeId: '70', fieldName: 'ckpt_name', fieldValue: 'Qwen-Rapid-AIO-NSFW-v23.0.safetensors', description: '模型选择（qwen-2511-edit）' },
      { nodeId: '80', fieldName: 'lora_name', fieldValue: 'any2realV2.safetensors', description: 'lora(qwen-2511)' },
      { nodeId: '80', fieldName: 'strength_model', fieldValue: '0', description: 'lora权重' },
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
      onError('任务队列已满（最多 20 个任务），请等待当前任务完成');
      return;
    }
    try {
      const nodeList = buildNodeList();
      const combinedPrompt = customPrompt || params.prompt || finalPrompt;
      await taskManager.addTask('img2img', nodeList, combinedPrompt, WORKFLOW.QWEN_IMG2IMG);
      onSuccess('任务已提交');
    } catch (err) {
      onError(err instanceof Error ? err.message : '提交失败');
    }
  };

  const img2imgTasks = taskManager.tasks.filter((t: QueuedTask) => t.workflowType === 'img2img');
  const totalSelected = positiveTags.length + negativeTags.length;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Task list */}
      <TaskList
        tasks={img2imgTasks}
        onCancel={taskManager.cancelTask}
        onClearCompleted={taskManager.clearCompleted}
        onRegenerate={taskManager.regenerateTask}
      />

      {/* Girlfriend Selector */}
      <GirlfriendSelector
        apiKey={apiKey}
        selectedId={selectedGirlfriend ? (selectedGirlfriend.isCustom ? `custom_${selectedGirlfriend.id}` : selectedGirlfriend.id) : null}
        onSelect={handleGirlfriendSelect}
        disabled={girlfriendUploading || taskManager.isFull}
      />

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

      {/* Pose presets */}
      <PosePresetSelector
        type="image"
        onSelect={handlePoseSelect}
        disabled={taskManager.isFull}
        selectedGirlfriend={selectedGirlfriend}
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
    </div>
  );
}
