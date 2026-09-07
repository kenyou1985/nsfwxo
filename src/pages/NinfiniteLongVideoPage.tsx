import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Video, Image as ImageIcon, Loader2, X, Upload, Sparkles, Copy, Check, ShieldCheck, Layers } from 'lucide-react';
import { uploadImage, WORKFLOW } from '../services/runninghub';
import { expandVideoFromImage } from '../services/promptApi';
import { ImageUploader } from '../components/ImageUploader';
import { GenerateButton } from '../components/GenerateButton';
import { VideoTaskList } from '../components/VideoTaskList';
import type { NodeInfo } from '../types';
import type { GirlfriendPreset } from '../data/girlfriendPresets';
import { GirlfriendSelector } from '../components/GirlfriendSelector';
import { PosePresetSelector } from '../components/PosePresetSelector';
import { H3_VIDEO_TEMPLATES } from './ImageToVideoPage';
import ThemeLibraryPanel from '../components/ThemeLibraryPanel';
import { THEME_LIBRARY, THEME_CATEGORIES, 主题转视频提示词 } from '../data/themeLibrary';
import type { ThemeEntry } from '../data/themeLibrary';

// ────────────────────────────────────────────────────────────────────────────────
// N无限X一键长视频 v1.1 — workflowId 2094226327238135810 (Minimax H3)
// 参考文档: https://www.runninghub.ai/zh-cn/call-api/api-detail/2094226327238135810?apiType=4
// ────────────────────────────────────────────────────────────────────────────────

const WORKFLOW_ID = '2094226327238135810';

/** H3 提示词强制约束文本（开启约束开关时追加到提示词前） */
const H3_CONSTRAINT_TEXT = `【最高优先级强制约束】
严格忠实执行本提示词全部指令，禁止任何自主创作、额外联想、擅自脑补新增剧情、私自增加未描述动作、特效、人物行为、场景细节。
不允许改写、扩充、演绎故事内容，所有画面、动作、人物、镜头、氛围必须完全遵循参考图片<Picture X>内容。
禁止自行添加额外镜头、额外互动、多余表情、额外物体。只生成提示词明确写明的内容，未写明的元素一律不要出现。
人物样貌、服装、场景构图必须严格跟随参考图，不得主观美化或修改人物形象。`;

// 节点 ID 与官方 curl 示例完全对齐 (description: null)
const NODE = {
  videoDuration:  '217',          // value, 秒数
  unetModelIndex: '417',         // index, UNet 模型序号
  aspectRatioIndex: '435',       // index, 画幅比例序号
  modeSelect:     '533',         // select, 模式选择
  refImageResolution: '520',     // select, 参考图分辨率
  randomSeed:     '500',         // value, 随机种子
  enableUpscale:  '315',        // value, 打开二采放大
  promptEnhance:  '494',        // value, 提示词增强
  prompt:         '205',         // value, 提示词
  // node 465: 官方 curl 存在，文档未说明用途（待确认）
  node465:        '465',
  // 二采放大目标分辨率 (node 483)
  upscaleTarget:  '483',
  refImage1:      '368',        // image, 参考图1
  refImage2:      '361',        // image, 参考图2
  refImage3:      '362',        // image, 参考图3
  refImage4:      '363',        // image, 参考图4
  refImage5:      '364',        // image, 参考图5
  refImage6:      '365',        // image, 参考图6
  refImage7:      '366',        // image, 参考图7
  refImage8:      '367',        // image, 参考图8
  refImage9:      '356',        // image, 参考图9
  // node 168 是工作流图内的 easy convertAnything 节点 (ComfyUI-Easy-Use)；
  // 官方 V1.1 curl 请求体里不包含它 —— 不要通过 nodeInfoList 强行注入。
  easyConvertAnything: '168',
} as const;

// ── 参数选项 ──────────────────────────────────────────────────────────────────

const DURATION_PRESETS = [
  { value: 5, label: '5秒' },
  { value: 8, label: '8秒' },
  { value: 15, label: '15秒' },
  { value: 30, label: '30秒' },
  { value: 60, label: '60秒' },
];

const UNET_MODEL_OPTIONS = [
  { value: '0', label: '608x352 (0.2M)' },
  { value: '1', label: '864x480 (0.4M)' },
  { value: '2', label: '960x544 (0.5M)' },
  { value: '3', label: '1152x640 (0.7M)' },
  { value: '4', label: '1280x736 (0.9M)' },
  { value: '5', label: '1504x832 (1.2M)' },
  { value: '6', label: '1824x1024 (1.8M)' },
];

const ASPECT_RATIO_OPTIONS = [
  { value: '2', label: '2:3 竖向照片 (640×960)' },
  { value: '3', label: '3:2 横向照片 (960×640)' },
  { value: '4', label: '3:4 竖向标准 (704×960)' },
  { value: '5', label: '4:3 横向标准 (960×704)' },
  { value: '6', label: '9:16 竖屏 (448×832)' },
  { value: '7', label: '16:9 横版 (832×480)' },
];

const MODE_OPTIONS = [
  { value: '1', label: '4步快速 (文戏)' },
  { value: '2', label: '20步质量 (高动态武戏)' },
];

const REF_RES_OPTIONS = [
  { value: '0', label: 'match (匹配)' },
  { value: '1', label: '544P' },
  { value: '2', label: '736P' },
  { value: '3', label: '1024P' },
  { value: '4', label: '2048P' },
];

// 放大目标 (node 483) — 二采放大目标分辨率
const UPSCALE_TARGET_OPTIONS = [
  { value: '0', label: '544×320 (0.5m)' },
  { value: '1', label: '800×448 (0.9m)' },
  { value: '2', label: '1152×640 (1.5m)' },
  { value: '3', label: '1504×832 (2.0m)' },
  { value: '4', label: '1920×1088 (2.8m)' },
  { value: '5', label: '2560×1440 (3.5m)' },
];

const REFERENCE_IMAGE_NODE_IDS = [
  NODE.refImage1, NODE.refImage2, NODE.refImage3, NODE.refImage4,
  NODE.refImage5, NODE.refImage6, NODE.refImage7, NODE.refImage8,
  NODE.refImage9,
] as const;

interface ReferenceImage {
  path: string;       // RunningHub 上传后的路径 (openapi/xxx.png) 或 'None'
  preview: string;    // 本地 object URL / dataURL 用于 UI 预览
}

interface NinfiniteLongVideoPageProps {
  apiKey: string;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  /** 初始参考图 (用于历史记录 → 长视频 v1.1 的场景，会被写入 slot 0) */
  initialImage?: { path: string; preview: string } | null;
  /** 初始参考图列表 (用于剧情分镜 → 长视频 v1.1 多图场景，按顺序写入 slot 0..N-1) */
  initialImages?: Array<{ path: string; preview: string }> | null;
  /** 初始提示词 (用于 H3 提示词引擎 → 长视频 v1.1 的场景) */
  initialPrompt?: string | null;
}

export function NinfiniteLongVideoPage({ apiKey, onError, onSuccess, initialImage, initialImages, initialPrompt }: NinfiniteLongVideoPageProps) {
  // ── 表单状态 (默认值全部对齐官方 curl 示例) ────────────────────────────────
  const [images, setImages] = useState<ReferenceImage[]>(
    Array.from({ length: 9 }, () => ({ path: 'None', preview: '' }))
  );

  // ── 一次性注入初始参考图 (从历史记录/分镜跳转过来时) ────────────────────────────────
  // 使用 ref 来跟踪已应用的值，确保只应用一次
  const appliedPromptRef = useRef<string | null>(null);
  const appliedImageRef = useRef<string | null>(null);
  const appliedImagesKeyRef = useRef<string | null>(null);
  useEffect(() => {
    // 注入初始提示词（来自 H3 提示词引擎）
    if (initialPrompt && initialPrompt !== appliedPromptRef.current) {
      setPrompt(initialPrompt);
      appliedPromptRef.current = initialPrompt;
      onSuccess('已填入 H3 视频提示词');
    }

    // 注入多张初始参考图（来自剧情分镜批量上传，按顺序写入 slot 0..N-1）
    if (initialImages && initialImages.length > 0) {
      const key = initialImages.map((img) => img.path).join('|');
      if (key !== appliedImagesKeyRef.current) {
        setImages((prev) => {
          const next = [...prev];
          initialImages.forEach((img, idx) => {
            if (idx < 9 && img.path) {
              next[idx] = { path: img.path, preview: img.preview || img.path };
            }
          });
          return next;
        });
        appliedImagesKeyRef.current = key;
        appliedImageRef.current = initialImages[0].path;
        if (!initialPrompt) {
          onSuccess(`已从剧情分镜导入 ${initialImages.length} 张图片到长视频 v1.1`);
        }
      }
      return;
    }

    // 注入单张初始参考图（来自历史记录 / 单分镜跳转，写入 slot 0）
    if (initialImage?.path && initialImage.path !== appliedImageRef.current) {
      setImages((prev) => {
        const next = [...prev];
        next[0] = { path: initialImage.path, preview: initialImage.preview };
        return next;
      });
      appliedImageRef.current = initialImage.path;
      if (!initialPrompt) {
        onSuccess('已从历史记录导入图片到长视频 v1.1（参考图 1）');
      }
    }
  }, [initialImage, initialImages, initialPrompt, onSuccess]);
  const [prompt, setPrompt] = useState<string>('15s剧情，<Picture 1> 和<Picture 2> 在激烈性爱，多姿势多角度。');
  // 主题库"单独填入"后显示的标签切换：每个主题一个独立可编辑的提示词
  const [themeTabs, setThemeTabs] = useState<ThemeEntry[]>([]);
  const [themeTabIndex, setThemeTabIndex] = useState<number>(0);
  const [themePrompts, setThemePrompts] = useState<string[]>([]);
  const [duration, setDuration] = useState<number>(60);
  const [customDuration, setCustomDuration] = useState<string>('');
  const [unetModelIndex, setUnetModelIndex] = useState<string>('0');
  const [aspectRatioIndex, setAspectRatioIndex] = useState<string>('6');
  const [mode, setMode] = useState<string>('1');
  const [refResolution, setRefResolution] = useState<string>('3');
  const [seed, setSeed] = useState<string>('111');
  const [randomizeSeed, setRandomizeSeed] = useState<boolean>(true);
  const [enableUpscale, setEnableUpscale] = useState<boolean>(false);
  const [upscaleTarget, setUpscaleTarget] = useState<string>('1');
  const [promptEnhance, setPromptEnhance] = useState<boolean>(true);
  const [promptConstraintEnabled, setPromptConstraintEnabled] = useState<boolean>(false); // 强制约束开关
  const [node465, setNode465] = useState<boolean>(false); // 官方 curl 中存在，文档未说明用途
  const [enhancedPrompt, setEnhancedPrompt] = useState<string>(''); // 返回的优化提示词
  const [enhancedPromptCopied, setEnhancedPromptCopied] = useState<boolean>(false); // 复制状态反馈
  // 主题库批量生成状态
  const [themeBatchProgress, setThemeBatchProgress] = useState<{ current: number; total: number } | null>(null);

  const [uploading, setUploading] = useState<boolean>(false);
  // 每个槽位的上传状态（移动端优化：避免一个上传阻塞全部 9 个槽位）
  const [uploadingSlots, setUploadingSlots] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState<boolean>(false);
  // 情色创作模式
  const [eroticMode, setEroticMode] = useState(false);
  const [eroticLevel, setEroticLevel] = useState<'soft' | 'normal' | 'sm'>('normal');
  const [eroticAnalyzing, setEroticAnalyzing] = useState(false);
  // 多数字人锚定：每个女友绑定到一个参考图槽位
  // 数组按顺序排列，第一个元素对应图1，第二个对应图2，依次类推
  const [selectedGirlfriends, setSelectedGirlfriends] = useState<GirlfriendPreset[]>([]);
  const [girlfriendUploading, setGirlfriendUploading] = useState<boolean>(false);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  /** 给定一个女友 ID，返回对应的图片槽位索引（如果未锚定则返回 -1） */
  const findSlotByGirlfriendId = useCallback(
    (gf: GirlfriendPreset): number => {
      const targetId = gf.isCustom ? `custom_${gf.id}` : gf.id;
      return selectedGirlfriends.findIndex(
        (g) => (g.isCustom ? `custom_${g.id}` : g.id) === targetId
      );
    },
    [selectedGirlfriends]
  );

  /** 寻找下一个空槽位（无图片的槽） */
  const findNextEmptySlot = useCallback((): number => {
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (!img.path || img.path === 'None' || !img.preview) return i;
    }
    return images.length; // 已满，返回末尾索引（理论上不发生）
  }, [images]);

  const taskListRef = useRef<{
    submitTask: (prompt: string, imagePath: string, imagePreview: string, nodeInfoList: NodeInfo[], workflowId?: string) => void;
  } | null>(null);

  /** 构建带自定义提示词的 node list（用于主题库批量生成） — 100% 对齐官方 curl 示例 */
  const buildNodeListWithPrompt = useCallback((videoPrompt: string, duration: number): NodeInfo[] => {
    const finalDuration = customDuration ? parseInt(customDuration, 10) || duration : duration;
    const finalSeed = randomizeSeed ? Math.floor(Math.random() * 1_000_000_000).toString() : seed;

    const nodeInfoList: NodeInfo[] = [
      { nodeId: NODE.videoDuration,      fieldName: 'value',  fieldValue: String(finalDuration),      description: null },
      { nodeId: NODE.unetModelIndex,    fieldName: 'index',  fieldValue: unetModelIndex,             description: null },
      { nodeId: NODE.aspectRatioIndex,   fieldName: 'index',  fieldValue: aspectRatioIndex,           description: null },
      { nodeId: NODE.modeSelect,        fieldName: 'select', fieldValue: mode,                       description: null },
      { nodeId: NODE.refImageResolution,fieldName: 'select', fieldValue: refResolution,              description: null },
      { nodeId: NODE.upscaleTarget,    fieldName: 'index',  fieldValue: upscaleTarget,               description: null },
      { nodeId: NODE.randomSeed,        fieldName: 'value',  fieldValue: finalSeed,                   description: null },
      { nodeId: NODE.enableUpscale,     fieldName: 'value',  fieldValue: String(enableUpscale),      description: null },
      { nodeId: NODE.promptEnhance,     fieldName: 'value',  fieldValue: String(promptEnhance),      description: null },
      { nodeId: NODE.node465,           fieldName: 'value',  fieldValue: String(node465),            description: null },
      // 强制约束开关对齐 buildNodeList：开启时把 H3_CONSTRAINT_TEXT 拼到 prompt 开头
      { nodeId: NODE.prompt,            fieldName: 'value',  fieldValue: promptConstraintEnabled ? H3_CONSTRAINT_TEXT + '\n\n' + videoPrompt : videoPrompt, description: null },
    ];

    // 9 个图片节点, 未上传的填 'None' (与官方文档一致)
    REFERENCE_IMAGE_NODE_IDS.forEach((nodeId, idx) => {
      nodeInfoList.push({
        nodeId,
        fieldName: 'image',
        fieldValue: images[idx].path || 'None',
        description: null,
      });
    });

    return nodeInfoList;
  }, [customDuration, duration, unetModelIndex, aspectRatioIndex, mode, refResolution,
      upscaleTarget, randomizeSeed, seed, enableUpscale, promptEnhance, node465,
      promptConstraintEnabled, images]);

  /** 视频姿势预设应用：插入到当前提示词末尾 */
  const handlePoseSelect = useCallback((posePrompt: string, poseName: string) => {
    setPrompt((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return posePrompt;
      // 避免重复追加
      if (trimmed.endsWith(posePrompt.trim())) return trimmed;
      return `${trimmed}, ${posePrompt}`;
    });
    onSuccess(`已应用姿势: ${poseName}`);
  }, [onSuccess]);

  /** 主题库批量生成 */
  const handleThemeBatchGenerate = useCallback(async (themes: ThemeEntry[], duration: 15 | 30 | 60) => {
    const firstImage = images.find((img) => img.path && img.path !== 'None');
    if (!firstImage?.path || firstImage.path === 'None') {
      onError('请先上传或选择一张参考图片');
      return;
    }
    if (themes.length === 0) return;
    setThemeBatchProgress({ current: 0, total: themes.length });
    for (let i = 0; i < themes.length; i++) {
      const theme = themes[i];
      const themePrompt = 主题转视频提示词(theme, duration);
      const nodeList = buildNodeListWithPrompt(themePrompt, duration);
      taskListRef.current?.submitTask(themePrompt, firstImage.path, firstImage.preview, nodeList, WORKFLOW_ID);
      setThemeBatchProgress({ current: i + 1, total: themes.length });
      await new Promise((r) => setTimeout(r, 200));
    }
    setThemeBatchProgress(null);
    onSuccess(`已提交 ${themes.length} 个主题到长视频 v1.1 生成队列`);
  }, [images, buildNodeListWithPrompt, onError, onSuccess]);

  /** 主题库"单独填入"：每个主题独立生成 H3 提示词，存入主题标签列表，
   *  用户可在标签之间切换查看 / 编辑。第一个主题默认显示在 textarea 中。 */
  const handleTheme单独填入 = useCallback((themes: ThemeEntry[], duration: 15 | 30 | 60) => {
    if (themes.length === 0) return;
    const prompts = themes.map((t) => 主题转视频提示词(t, duration));
    setThemeTabs(themes);
    setThemeTabIndex(0);
    setThemePrompts(prompts);
    setPrompt(prompts[0] ?? '');
    onSuccess(`已填入 ${themes.length} 个主题，可点击标签切换`);
  }, [onSuccess]);

  /** 切换主题标签：更新 textarea 显示当前主题的提示词 */
  const handleThemeTabSwitch = useCallback((idx: number) => {
    if (idx < 0 || idx >= themePrompts.length) return;
    setThemeTabIndex(idx);
    setPrompt(themePrompts[idx] ?? '');
  }, [themePrompts]);

  /** 用户编辑 textarea 时，同步更新当前主题的提示词 */
  const handleThemePromptChange = useCallback((value: string) => {
    setPrompt(value);
    setThemePrompts((prev) => {
      if (themeTabIndex < 0 || themeTabIndex >= prev.length) return prev;
      const updated = [...prev];
      updated[themeTabIndex] = value;
      return updated;
    });
  }, [themeTabIndex]);

  /** 清除所有主题标签状态（点 X 按钮时调用） */
  const handleClearThemeTabs = useCallback(() => {
    setThemeTabs([]);
    setThemePrompts([]);
    setThemeTabIndex(0);
  }, []);

  // 安全释放 blob URL，避免移动端内存泄漏导致页面崩溃
  const revokeIfBlob = (url: string) => {
    if (typeof url === 'string' && url.startsWith('blob:')) {
      try { URL.revokeObjectURL(url); } catch { /* noop */ }
    }
  };

  /** 情色创作模式：调用 Grok-4.6 分析参考图，生成提示词 */
  const handleEroticAnalyze = useCallback(async () => {
    const uploadedImages = images.filter(img => img.path && img.path !== 'None');
    if (uploadedImages.length === 0) {
      onError('请先上传至少一张参考图');
      return;
    }
    setEroticAnalyzing(true);
    try {
      const firstImage = uploadedImages[0];
      const levelMap = {
        soft: '浪漫唯美氛围（唯美暧昧镜头，无直接身体接触）',
        normal: '亲密互动（含身体互动动作、情感氛围与亲密神态）',
        sm: '戏剧化场景（角色扮演、强情感张力、戏剧化叙事）',
      };
      const levelHint = levelMap[eroticLevel];
      // 过滤触发词的同时也用中性表达，避免 xAI 内容审核误判
      const hintRaw = `请生成一段适合MiniMax H3图生视频的英文动作提示词。创作方向：${levelHint}。要求输出纯英文提示词句子，不要解释。`;
      const sceneHint2 = hintRaw
        .replace(/未成年[人人]?/g, 'adult')
        .replace(/未满18[岁]?/g, '18+')
        .replace(/纯情色|情色|色情|色性/g, 'romantic')
        .replace(/带性爱|性爱|性行为/g, 'intimate')
        .replace(/SM重口味|重口味|SM/g, 'dramatic')
        .replace(/[少青]年/g, 'adult')
        .replace(/萝莉|正太|幼女|正幼/g, '')
        .replace(/teenager|underage|minor|child\b/g, 'adult');

      let imageDataUrl = firstImage.path;
      if (firstImage.path.startsWith('blob:') || firstImage.path.startsWith('http')) {
        try {
          const resp = await fetch(firstImage.path);
          const blob = await resp.blob();
          const reader = new FileReader();
          imageDataUrl = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch { /* use original path */ }
      }

      const res = await expandVideoFromImage(imageDataUrl, sceneHint2, true, 1, ['grok-4.6'], 150000);
      const generated = res.prompts?.[0];
      if (generated) {
        setPrompt(generated);
        onSuccess('情色创作提示词已生成，请根据需要编辑');
      } else {
        onError('生成失败，未返回提示词');
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : '分析失败，请重试');
    } finally {
      setEroticAnalyzing(false);
    }
  }, [images, eroticLevel, onError, onSuccess]);

  // ── 图片上传 ────────────────────────────────────────────────────────────────
  const handleImageUpload = useCallback(async (file: File, index: number) => {
    // iOS 17.4.1+ 兼容性：URL.createObjectURL 在 iOS 17.4.1 上失效，改用 FileReader 转 data URL
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.readAsDataURL(file);
    });
    // 乐观更新：立即用本地预览显示图片，不阻塞其他槽位
    setImages((prev) => {
      const next = [...prev];
      revokeIfBlob(next[index]?.preview);
      next[index] = { path: '', preview: dataUrl };
      return next;
    });
    setUploadingSlots((prev) => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
    setUploading(true);
    try {
      const { imagePath } = await uploadImage(apiKey, file);
      setImages((prev) => {
        const next = [...prev];
        next[index] = { path: imagePath, preview: dataUrl };
        return next;
      });
      onSuccess(`参考图 ${index + 1} 上传成功`);
    } catch (err) {
      setImages((prev) => {
        const next = [...prev];
        revokeIfBlob(next[index]?.preview);
        next[index] = { path: 'None', preview: '' };
        return next;
      });
      onError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploadingSlots((prev) => {
        const next = new Set(prev);
        next.delete(index);
        if (next.size === 0) setUploading(false);
        return next;
      });
    }
  }, [apiKey, onSuccess, onError]);

  const handleImageRemove = useCallback((index: number) => {
    setImages((prev) => {
      const next = [...prev];
      revokeIfBlob(next[index]?.preview);
      next[index] = { path: 'None', preview: '' };
      return next;
    });
  }, []);

  // ── 多数字人锚定 ───────────────────────────────────────────────────────────────
// 逻辑：点击未锚定的女友 → 自动上传到下一个空槽位（自动跳过被参考图占用的位置）；
//      点击已锚定的女友 → 取消锚定，并清空对应槽位图片。
const handleGirlfriendSelect = useCallback(
  async (gf: GirlfriendPreset) => {
    const gfKey = gf.isCustom ? `custom_${gf.id}` : gf.id;
    const existingIdx = findSlotByGirlfriendId(gf);

    // 1) 已锚定 → 取消锚定（移除列表元素 + 清空对应槽位图片）
    if (existingIdx >= 0) {
      setSelectedGirlfriends((prev) => prev.filter((_, idx) => idx !== existingIdx));
      setImages((imgs) => {
        const updated = [...imgs];
        revokeIfBlob(updated[existingIdx]?.preview);
        updated[existingIdx] = { path: 'None', preview: '' };
        return updated;
      });
      onSuccess(`已取消锚定「${gf.nameZh || gf.name}」（参考图 ${existingIdx + 1} 已清空）`);
      return;
    }

    // 2) 未锚定 → 寻找下一个空槽位
    //    优先级：先填被数字人占着的空槽（slot 索引），再填第一个没有图片的槽位
    const occupiedSlots = new Set<number>();
    selectedGirlfriends.forEach((g, idx) => {
      if (g) occupiedSlots.add(idx);
    });
    let emptyIdx = -1;
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (occupiedSlots.has(i)) continue;
      if (!img.path || img.path === 'None' || !img.preview) {
        emptyIdx = i;
        break;
      }
    }
    if (emptyIdx < 0) {
      onError('参考图已满（9/9），请先移除一张图片后再添加新的数字人');
      return;
    }

    // 3) 立刻把女友放到对应槽位（乐观更新，UI 上立刻有选中状态）
    const slotIdx = emptyIdx;
    setSelectedGirlfriends((prev) => {
      const next = [...prev];
      while (next.length <= slotIdx) next.push(undefined as unknown as GirlfriendPreset);
      next[slotIdx] = gf;
      return next;
    });
    // 乐观更新：立即显示 portraitUrl 作为预览，避免等 fetch+upload 期间参考图无变化
    setImages((imgs) => {
      const updated = [...imgs];
      revokeIfBlob(updated[slotIdx]?.preview);
      updated[slotIdx] = { path: '', preview: gf.portraitUrl };
      return updated;
    });

    // 4) 异步上传图片到对应槽位（不阻塞整个数字人选择器）
    setGirlfriendUploading(true);
    try {
      // iOS 17.4.1+ 兼容性：去掉 fetch 的 signal（iOS Safari 17.4.1 上带 signal 的 fetch 不稳定），
      // 改用 FileReader 转 base64，避免 Blob URL 在 iOS 17.4.1 失效。
      const res = await fetch(gf.portraitUrl);
      if (!res.ok) throw new Error(`下载头像失败: HTTP ${res.status}`);
      const blob = await res.blob();
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(blob);
      });
      const cleanBlob = await (await fetch(dataUrl)).blob();
      const mime = cleanBlob.type || 'image/jpeg';
      const file = new File([cleanBlob], `${gf.id}.jpg`, { type: mime });
      const { imagePath } = await uploadImage(apiKey, file);
      setImages((imgsPrev) => {
        const updated = [...imgsPrev];
        updated[slotIdx] = { path: imagePath, preview: dataUrl };
        return updated;
      });
      onSuccess(`已锚定「${gf.nameZh || gf.name}」到参考图 ${slotIdx + 1}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '上传失败';
      console.error('[NinfiniteLongVideo handleGirlfriendSelect] failed:', err, { gfId: gf.id, url: gf.portraitUrl });
      onError(`锚定「${gf.nameZh || gf.name}」失败: ${msg}。图片已显示但未上传，请检查网络后重试`);
      // 抓取/上传失败：保留 portraitUrl 作为预览（用户至少能看到头像），path 留空表示没真正上传成功
      // 不取消 selectedGirlfriends，让用户可以继续选择其他数字人
    } finally {
      setGirlfriendUploading(false);
    }
  },
  [apiKey, images, selectedGirlfriends, findSlotByGirlfriendId, onSuccess, onError]
);

  // ── 构建节点列表 — 100% 对齐官方 curl 示例 (description: null) ─────────────
  const buildNodeList = useCallback((): NodeInfo[] => {
    const finalDuration = customDuration ? parseInt(customDuration, 10) || duration : duration;
    const finalSeed = randomizeSeed ? Math.floor(Math.random() * 1_000_000_000).toString() : seed;

    const nodeInfoList: NodeInfo[] = [
      { nodeId: NODE.videoDuration,      fieldName: 'value',  fieldValue: String(finalDuration), description: null },
      { nodeId: NODE.unetModelIndex,    fieldName: 'index',  fieldValue: unetModelIndex,        description: null },
      { nodeId: NODE.aspectRatioIndex,   fieldName: 'index',  fieldValue: aspectRatioIndex,      description: null },
      { nodeId: NODE.modeSelect,        fieldName: 'select', fieldValue: mode,                  description: null },
      { nodeId: NODE.refImageResolution,fieldName: 'select', fieldValue: refResolution,         description: null },
      { nodeId: NODE.upscaleTarget,    fieldName: 'index',  fieldValue: upscaleTarget,        description: null },
      { nodeId: NODE.randomSeed,        fieldName: 'value',  fieldValue: finalSeed,             description: null },
      { nodeId: NODE.enableUpscale,     fieldName: 'value',  fieldValue: String(enableUpscale), description: null },
      { nodeId: NODE.promptEnhance,     fieldName: 'value',  fieldValue: String(promptEnhance), description: null },
      { nodeId: NODE.node465,           fieldName: 'value',  fieldValue: String(node465),        description: null },
      // 如果开启了强制约束开关，在提示词前追加约束文本
      { nodeId: NODE.prompt,            fieldName: 'value',  fieldValue: promptConstraintEnabled ? H3_CONSTRAINT_TEXT + '\n\n' + prompt : prompt, description: null },
    ];

    // 注意：promptEnhance=true 成功的官方 curl 请求体里没有 node 168
    // (也没出现 "could not convert string to float" 这个错)。之前在这里为 node 168
    // 注入 `value` / `anything` 字段全部触发 NODE_INFO_MISMATCH。
    // 既然工作流自己已经处理好了这个分支，就不要再提交 node 168。
    //
    // 9 个图片节点, 未上传的填 'None' (与官方文档一致)
    REFERENCE_IMAGE_NODE_IDS.forEach((nodeId, idx) => {
      nodeInfoList.push({
        nodeId,
        fieldName: 'image',
        fieldValue: images[idx].path || 'None',
        description: null,
      });
    });

    return nodeInfoList;
  }, [customDuration, duration, unetModelIndex, aspectRatioIndex,
      mode, refResolution, upscaleTarget, randomizeSeed, seed, enableUpscale, promptEnhance,
      node465, promptConstraintEnabled, prompt, images]);

  // ── 任务完成回调：提取返回的优化提示词 txt ────────────────────────────────
  const handleTaskComplete = useCallback(async (result: {
    results: { url: string; nodeId: string; outputType: string; text: string | null }[];
  }) => {
    // 找到 nodeId 为 497 的 txt 文件
    const txtResult = result.results.find(
      (r) => r.outputType === 'txt' || r.url?.endsWith('.txt')
    );
    if (!txtResult?.url) return;

    try {
      const resp = await fetch(txtResult.url);
      if (!resp.ok) return;
      const text = await resp.text();
      setEnhancedPrompt(text);
      onSuccess('已返回优化提示词，可在下方查看和编辑');
    } catch (err) {
      console.warn('[NinfiniteLongVideo] Failed to fetch enhanced prompt:', err);
    }
  }, [onSuccess]);

  // ── 复制优化提示词到剪贴板 ──────────────────────────────────────────────
  const handleCopyEnhancedPrompt = useCallback(async () => {
    if (!enhancedPrompt.trim()) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(enhancedPrompt);
      } else {
        // Fallback: 使用传统 document.execCommand 方式
        const ta = document.createElement('textarea');
        ta.value = enhancedPrompt;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setEnhancedPromptCopied(true);
      setTimeout(() => setEnhancedPromptCopied(false), 1500);
    } catch (err) {
      console.warn('[NinfiniteLongVideo] Failed to copy prompt:', err);
      onError('复制失败，请手动复制');
    }
  }, [enhancedPrompt, onError]);

  // ── 提交 ────────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(() => {
    if (!prompt.trim()) {
      onError('请输入提示词');
      return;
    }
    if (!images.some((img) => img.path && img.path !== 'None')) {
      onError('请至少上传一张参考图');
      return;
    }
    if (submitting) return;
    setSubmitting(true);

    const nodeList = buildNodeList();
    const firstImage = images.find((img) => img.path && img.path !== 'None') ?? images[0];
    taskListRef.current?.submitTask(
      prompt,
      firstImage.path,
      firstImage.preview,
      nodeList,
      WORKFLOW_ID
    );
    onSuccess('任务已提交');
    setSubmitting(false);
  }, [prompt, images, submitting, buildNodeList, onError, onSuccess]);

  const uploadedCount = images.filter((img) => img.path && img.path !== 'None').length;
  const finalDuration = customDuration ? parseInt(customDuration, 10) || duration : duration;

  // ── 模板预设 ──────────────────────────────────────────────────────────────────
  const handleTemplateApply = useCallback((template: typeof H3_VIDEO_TEMPLATES[0]) => {
    setPrompt(template.prompt);
    // 应用模板时清除主题标签：用户已选择用模板覆盖提示词
    handleClearThemeTabs();
    onSuccess(`已应用模板：${template.name}`);
  }, [onSuccess, handleClearThemeTabs]);

  return (
    <div className="space-y-4 pb-24">
      {/* 标题 */}
      <div className="rounded-xl bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-200/30 p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <Video size={20} className="text-white" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-text-primary">N无限X一键长视频 v1.1</h2>
            <p className="text-[11px] text-text-tertiary">workflowId: {WORKFLOW_ID}</p>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-text-tertiary">已上传</div>
            <div className="text-sm font-bold text-primary">{uploadedCount}/9</div>
          </div>
        </div>
      </div>

      {/* 任务列表 */}
      <VideoTaskList
        ref={taskListRef}
        apiKey={apiKey}
        workflowId={WORKFLOW_ID}
        onError={onError}
        onSuccess={onSuccess}
        onTaskComplete={handleTaskComplete}
      />

      {/* 数字人锚定 (支持多数字人：移动端允许并行锚定，不阻塞整个选择器) */}
      <GirlfriendSelector
        selectedIds={selectedGirlfriends
          .filter(Boolean)
          .map((g) => (g.isCustom ? `custom_${g.id}` : g.id))}
        onSelect={handleGirlfriendSelect}
        disabled={submitting}
      />

      {/* PosePresetSelector - 视频姿势预设 */}
      <PosePresetSelector
        type="video"
        onSelect={handlePoseSelect}
        disabled={submitting}
        selectedGirlfriends={selectedGirlfriends.filter(Boolean)}
        selectedGirlfriend={selectedGirlfriends.find(Boolean) ?? null}
      />

      {/* 参考图 (9 宫格) */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <h3 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
          <ImageIcon size={15} className="text-purple-500" />
          参考图 (最多 9 张)
          {selectedGirlfriends.filter(Boolean).length > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 text-[10px] font-medium">
              AI 女友模式 · {selectedGirlfriends.filter(Boolean).length} 位
            </span>
          )}
        </h3>

        {/* 情色创作模式开关 + 方向选择 */}
        <div className="mb-3 p-3 rounded-xl bg-gradient-to-r from-pink-500/5 via-rose-500/5 to-red-500/5 border border-pink-200/50">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-pink-500" />
              <span className="text-xs font-medium text-text-primary">情色创作模式</span>
              <span className="text-[10px] text-text-tertiary hidden sm:inline">· Grok-4.6 AI 分析</span>
            </div>
            <button
              onClick={() => setEroticMode(!eroticMode)}
              className={`w-10 h-5 rounded-full transition-colors relative ${eroticMode ? 'bg-pink-500' : 'bg-text-tertiary'}`}
              disabled={submitting || eroticAnalyzing}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${eroticMode ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>
          {eroticMode && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-text-tertiary flex-shrink-0">创作方向：</span>
                {([
                  { value: 'soft', label: '纯情色', color: 'from-pink-400 to-rose-400' },
                  { value: 'normal', label: '带性爱', color: 'from-rose-400 to-red-400' },
                  { value: 'sm', label: 'SM重口味', color: 'from-red-400 to-orange-400' },
                ] as const).map(({ value, label, color }) => (
                  <button
                    key={value}
                    onClick={() => setEroticLevel(value)}
                    disabled={submitting || eroticAnalyzing}
                    className={`px-3 py-1 rounded-lg text-[10px] font-bold bg-gradient-to-r ${color} text-white transition-all hover:opacity-90 disabled:opacity-50 ${
                      eroticLevel === value ? 'ring-2 ring-yellow-300 shadow-md scale-105' : 'opacity-60'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                onClick={handleEroticAnalyze}
                disabled={submitting || eroticAnalyzing || images.filter(img => img.path).length === 0}
                className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  eroticAnalyzing
                    ? 'bg-pink-500/50 text-white/70 cursor-not-allowed'
                    : images.filter(img => img.path).length === 0
                    ? 'bg-pink-500/30 text-white/50 cursor-not-allowed'
                    : 'bg-gradient-to-r from-pink-500 to-rose-500 text-white hover:opacity-90 shadow-sm'
                }`}
              >
                {eroticAnalyzing ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>分析中，请稍候...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    <span>分析参考图生成提示词</span>
                  </>
                )}
              </button>
              <p className="text-[10px] text-pink-400/80">
                将分析第一张参考图，结合选定方向生成适合该场景的视频提示词
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-5 gap-2">
          {images.map((img, idx) => {
            const isUploading = uploadingSlots.has(idx);
            return (
              <div key={idx} className="relative">
                {img.preview ? (
                  <div className="relative aspect-square rounded-xl overflow-hidden border-2 border-purple-200 bg-bg-elevated">
                    <img src={img.preview} alt={`参考图 ${idx + 1}`} className="w-full h-full object-cover" />
                    {/* 上传中遮罩：仅在该槽位上传时显示 */}
                    {isUploading && (
                      <div className="absolute inset-0 bg-black/45 flex flex-col items-center justify-center gap-1 pointer-events-none">
                        <Loader2 size={20} className="text-white animate-spin" />
                        <span className="text-[10px] text-white/90">上传中...</span>
                      </div>
                    )}
                    {!isUploading && (
                      <button
                        type="button"
                        onClick={() => handleImageRemove(idx)}
                        disabled={submitting}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                      >
                        <X size={12} />
                      </button>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1">
                      <span className="text-[10px] text-white/90">
                        {isUploading ? '上传中...' : `参考图 ${idx + 1}`}
                      </span>
                    </div>
                  </div>
                ) : (
                  <label className={`relative flex flex-col items-center justify-center aspect-square rounded-xl border-2 border-dashed bg-bg-elevated transition-colors ${submitting ? 'border-border opacity-50 cursor-not-allowed' : 'border-border hover:border-purple-400 cursor-pointer'}`}>
                    <Upload size={18} className="text-text-tertiary" />
                    <span className="text-[10px] text-text-tertiary mt-1">图 {idx + 1}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        // 重置 input.value，确保下次能重新选择同一文件
                        e.target.value = '';
                        if (file) handleImageUpload(file, idx);
                      }}
                      disabled={submitting}
                    />
                  </label>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-text-tertiary mt-2">
          未上传的参考图将自动使用 'None' 填充 (与官方 API 一致)
        </p>
      </div>

      {/* 提示词 */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
            <Sparkles size={15} className="text-primary" />
            提示词 (node 205)
            {themeTabs.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold">
                {themeTabIndex + 1}/{themeTabs.length}
              </span>
            )}
          </h3>
        </div>
        {/* 模版预设 + 主题标签切换 */}
        {H3_VIDEO_TEMPLATES.length > 0 && (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-text-tertiary flex-shrink-0">模版：</span>
            <div className="flex flex-wrap gap-1.5">
              {H3_VIDEO_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.name}
                  type="button"
                  onClick={() => handleTemplateApply(tpl)}
                  disabled={submitting}
                  className={`px-3 py-1 rounded-lg text-xs font-medium bg-gradient-to-r ${tpl.color} text-white hover:opacity-90 transition-opacity disabled:opacity-50`}
                >
                  {tpl.name}
                </button>
              ))}
            </div>
            {/* 主题标签切换（单独填入后显示在截图位置 1） */}
            {themeTabs.length > 0 && (
              <div className="ml-auto flex flex-wrap items-center gap-1.5 flex-shrink-0 max-w-[60%]">
                <span className="text-[10px] text-amber-600 font-semibold whitespace-nowrap">主题：</span>
                {themeTabs.map((theme, idx) => {
                  const isActive = idx === themeTabIndex;
                  const catDef = THEME_CATEGORIES.find((c) => c.key === theme.category);
                  return (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() => handleThemeTabSwitch(idx)}
                      disabled={submitting}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border ${
                        isActive
                          ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white border-amber-400 shadow-sm'
                          : 'bg-bg-elevated text-text-secondary border-border hover:border-amber-300 hover:bg-amber-50'
                      } disabled:opacity-50`}
                      title={theme.title}
                    >
                      {theme.title.length > 6 ? theme.title.slice(0, 6) + '…' : theme.title}
                      {catDef && catDef.japanese[0] && (
                        <span className="ml-1 text-[9px] opacity-80">{catDef.japanese[0]}</span>
                      )}
                    </button>
                  );
                })}
                {/* 清除按钮 */}
                <button
                  type="button"
                  onClick={handleClearThemeTabs}
                  disabled={submitting}
                  className="ml-1 px-1.5 py-1 rounded-md text-[10px] text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                  title="清除所有主题标签"
                >
                  <X size={11} />
                </button>
              </div>
            )}
          </div>
        )}
        <textarea
          value={prompt}
          onChange={(e) => (themeTabs.length > 0 ? handleThemePromptChange(e.target.value) : setPrompt(e.target.value))}
          rows={4}
          placeholder="例如: 图片1为男主，图片2为女主，生成两人约会的视频提示词"
          disabled={submitting}
          style={{ maxHeight: '320px', minHeight: '80px' }}
          className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-sm text-text-primary placeholder-slate-500 focus:outline-none focus:border-primary/50 resize-y overflow-y-auto"
        />
        {/* 引用参考图快捷按钮 */}
        {uploadedCount > 0 && (
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="text-[10px] text-text-tertiary">引用参考图：</span>
            {images.map((img, idx) => (
              img.path && img.path !== 'None' && (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setPrompt((p) => p + `<Picture ${idx + 1}>`)}
                  disabled={submitting}
                  className="px-2 py-1 rounded-md text-[10px] bg-purple-50 border border-purple-200 text-purple-600 hover:bg-purple-100 transition-colors disabled:opacity-50"
                  title={`插入 <Picture ${idx + 1}> 引用参考图 ${idx + 1}`}
                >
                  图{idx + 1}
                </button>
              )
            ))}
          </div>
        )}
        {/* 强制约束开关 */}
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={() => setPromptConstraintEnabled(!promptConstraintEnabled)}
            disabled={submitting}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              promptConstraintEnabled
                ? 'bg-indigo-500 text-white border border-indigo-600 hover:bg-indigo-600'
                : 'bg-indigo-50 border border-indigo-200 text-indigo-600 hover:bg-indigo-100'
            }`}
            title="开启后将追加严格约束文本到提示词开头"
          >
            <ShieldCheck size={12} />
            强制约束 {promptConstraintEnabled ? '已开启' : '已关闭'}
          </button>
          <span className="text-[10px] text-indigo-400">
            提示：可用 &lt;Picture 1&gt;, &lt;Picture 2&gt; 等引用参考图
          </span>
        </div>
        {selectedGirlfriends.filter(Boolean).length > 0 && (
          <div className="mt-2 px-2 py-1.5 rounded bg-red-50 border border-red-200 text-[10px] text-red-600 flex items-start gap-2">
            <span className="font-medium flex-shrink-0">已锚定数字人：</span>
            <span className="flex flex-wrap gap-x-2 gap-y-0.5">
              {selectedGirlfriends
                .map((g, idx) => (g ? `图${idx + 1}=${g.nameZh || g.name}` : null))
                .filter(Boolean)
                .join('，')}
            </span>
          </div>
        )}
        {/* 返回的优化提示词 */}
        {enhancedPrompt && (
          <div className="mt-3 p-3 rounded-lg bg-green-50 border border-green-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-green-700 flex items-center gap-1">
                ✨ 优化提示词（可编辑）
              </span>
              <button
                type="button"
                onClick={handleCopyEnhancedPrompt}
                disabled={!enhancedPrompt.trim()}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-green-600 hover:bg-green-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="一键复制优化提示词到剪贴板"
              >
                {enhancedPromptCopied ? (
                  <>
                    <Check size={12} />
                    已复制
                  </>
                ) : (
                  <>
                    <Copy size={12} />
                    一键复制
                  </>
                )}
              </button>
            </div>
            <textarea
              value={enhancedPrompt}
              onChange={(e) => setEnhancedPrompt(e.target.value)}
              rows={4}
              style={{ maxHeight: '320px', minHeight: '80px' }}
              className="w-full px-3 py-2 rounded-lg bg-white border border-green-200 text-sm text-green-800 focus:outline-none focus:border-green-400 resize-y overflow-y-auto font-mono"
              placeholder="返回的优化提示词将在此显示..."
            />
          </div>
        )}

        {/* 生成按钮 - 放在提示词下方 */}
        <div className="pt-3 mt-3 border-t border-border/50">
          <GenerateButton
            onClick={handleSubmit}
            isLoading={submitting}
            disabled={!prompt.trim() || uploadedCount === 0 || submitting || uploading}
            label={uploading ? '上传中...' : submitting ? '提交中...' : `生成 ${finalDuration} 秒视频`}
          />
        </div>
      </div>

      {/* 时长 (核心参数) */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <h3 className="text-sm font-medium text-text-primary mb-3">
          视频时长 (node 217) — 当前: <span className="text-primary">{finalDuration} 秒</span>
        </h3>
        <div className="flex flex-wrap gap-2 mb-3">
          {DURATION_PRESETS.map((d) => (
            <button
              key={d.value}
              type="button"
              onClick={() => { setDuration(d.value); setCustomDuration(''); }}
              disabled={submitting}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                duration === d.value && !customDuration
                  ? 'bg-primary text-white'
                  : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover'
              }`}
            >
              {d.label}
            </button>
          ))}
          <input
            type="number"
            value={customDuration}
            onChange={(e) => setCustomDuration(e.target.value)}
            placeholder="自定义"
            min={1}
            max={300}
            disabled={submitting}
            className="w-20 px-2 py-1.5 rounded-lg bg-bg-elevated border border-border text-xs text-text-primary focus:outline-none focus:border-primary"
          />
        </div>
      </div>

      {/* ── 主题库面板（长视频 v1.1）── */}
      <div className="rounded-xl bg-gradient-to-br from-violet-500/10 via-fuchsia-500/5 to-pink-500/10 border border-violet-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-violet-50/50">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-violet-500" />
            <span className="text-sm font-semibold text-text-primary">主题库</span>
            <span className="px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-medium">
              {THEME_LIBRARY.length} 个专业主题
            </span>
            {themeBatchProgress && (
              <span className="px-1.5 py-0.5 rounded-full bg-violet-600 text-white text-[10px] font-medium animate-pulse">
                生成中 {themeBatchProgress.current}/{themeBatchProgress.total}
              </span>
            )}
            <span className="text-[11px] text-text-tertiary hidden sm:inline">
              · 长视频 v1.1 · MiniMax H3 模型
            </span>
          </div>
        </div>
        <div className="px-4 pb-4 pt-2">
          <ThemeLibraryPanel
            on应用提示词={(提示词) => {
              // 单个主题应用：直接填入，并清除主题标签状态
              handleClearThemeTabs();
              setPrompt(提示词);
              onSuccess('已应用主题提示词');
            }}
            on批量生成={handleThemeBatchGenerate}
            on单独填入={handleTheme单独填入}
          />
        </div>
      </div>

      {/* 高级设置 */}
      <div className="rounded-xl bg-bg-surface border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-bg-elevated transition-colors"
        >
          <span className="text-sm font-medium text-text-primary">高级设置</span>
          <span className="text-xs text-text-tertiary">{showAdvanced ? '收起' : '展开'}</span>
        </button>
        {showAdvanced && (
          <div className="px-4 pb-4 space-y-3 border-t border-border/50">
            {/* 模式选择 (node 533) */}
            <div>
              <label className="text-xs text-text-secondary block mb-1.5">模式选择 (node 533)</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                disabled={submitting}
                className="w-full h-9 px-3 rounded-lg text-xs border border-border bg-bg-elevated text-text-primary focus:outline-none focus:border-primary appearance-none cursor-pointer"
              >
                {MODE_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
            </div>

            {/* 视频分辨率 (node 417) */}
            <div>
              <label className="text-xs text-text-secondary block mb-1.5">视频分辨率（推荐先用最低分辨率抽卡，再同种子放大）(node 417)</label>
              <select
                value={unetModelIndex}
                onChange={(e) => setUnetModelIndex(e.target.value)}
                disabled={submitting}
                className="w-full h-9 px-3 rounded-lg text-xs border border-border bg-bg-elevated text-text-primary focus:outline-none focus:border-primary appearance-none cursor-pointer"
              >
                {UNET_MODEL_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
            </div>

            {/* 画幅比例 (node 435) */}
            <div>
              <label className="text-xs text-text-secondary block mb-1.5">画幅比例 (node 435)</label>
              <select
                value={aspectRatioIndex}
                onChange={(e) => setAspectRatioIndex(e.target.value)}
                disabled={submitting}
                className="w-full h-9 px-3 rounded-lg text-xs border border-border bg-bg-elevated text-text-primary focus:outline-none focus:border-primary appearance-none cursor-pointer"
              >
                {ASPECT_RATIO_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
            </div>

            {/* 参考图分辨率 (node 520) */}
            <div>
              <label className="text-xs text-text-secondary block mb-1.5">参考图分辨率 (node 520)</label>
              <select
                value={refResolution}
                onChange={(e) => setRefResolution(e.target.value)}
                disabled={submitting}
                className="w-full h-9 px-3 rounded-lg text-xs border border-border bg-bg-elevated text-text-primary focus:outline-none focus:border-primary appearance-none cursor-pointer"
              >
                {REF_RES_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
            </div>

            {/* 二采放大目标分辨率 (node 483) */}
            <div>
              <label className="text-xs text-text-secondary block mb-1.5">二采放大目标分辨率 (node 483)</label>
              <select
                value={upscaleTarget}
                onChange={(e) => setUpscaleTarget(e.target.value)}
                disabled={submitting}
                className="w-full h-9 px-3 rounded-lg text-xs border border-border bg-bg-elevated text-text-primary focus:outline-none focus:border-primary appearance-none cursor-pointer"
              >
                {UPSCALE_TARGET_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
            </div>

            {/* 随机种子 */}
            <div className="grid grid-cols-2 gap-3 items-end">
              <div>
                <label className="text-xs text-text-secondary block mb-1.5">随机种子 (node 500)</label>
                <input
                  type="text"
                  value={randomizeSeed ? '(每次随机)' : seed}
                  onChange={(e) => { setRandomizeSeed(false); setSeed(e.target.value); }}
                  disabled={randomizeSeed || submitting}
                  className="w-full h-9 px-3 rounded-lg text-xs border border-border bg-bg-elevated text-text-primary focus:outline-none focus:border-primary disabled:opacity-50"
                />
              </div>
              <button
                type="button"
                onClick={() => setRandomizeSeed(!randomizeSeed)}
                disabled={submitting}
                className={`h-9 px-3 rounded-lg text-xs font-medium transition-all ${
                  randomizeSeed ? 'bg-primary text-white' : 'bg-bg-elevated text-text-secondary'
                }`}
              >
                随机 {randomizeSeed ? '✓' : ''}
              </button>
            </div>

            {/* 二采放大 */}
            <label className="flex items-center justify-between px-3 py-2 rounded-lg bg-bg-elevated cursor-pointer">
              <span className="text-xs text-text-secondary">二采放大 (node 315) — 开启后画质更好但耗时翻倍</span>
              <button
                type="button"
                onClick={() => setEnableUpscale(!enableUpscale)}
                disabled={submitting}
                className={`w-10 h-6 rounded-full transition-colors relative ${enableUpscale ? 'bg-primary' : 'bg-text-tertiary'}`}
              >
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${enableUpscale ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
            </label>

            {/* 提示词增强 */}
            <label className="flex items-center justify-between px-3 py-2 rounded-lg bg-bg-elevated cursor-pointer">
              <span className="text-xs text-text-secondary">提示词增强 (node 494) — 自动补全细节</span>
              <button
                type="button"
                onClick={() => setPromptEnhance(!promptEnhance)}
                disabled={submitting}
                className={`w-10 h-6 rounded-full transition-colors relative ${promptEnhance ? 'bg-primary' : 'bg-text-tertiary'}`}
              >
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${promptEnhance ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
            </label>

            {/* node 465 — 官方 curl 存在，文档未说明用途 */}
            <label className="flex items-center justify-between px-3 py-2 rounded-lg bg-bg-elevated cursor-pointer">
              <span className="text-xs text-text-secondary">额外开关 (node 465) — 用途待确认</span>
              <button
                type="button"
                onClick={() => setNode465(!node465)}
                disabled={submitting}
                className={`w-10 h-6 rounded-full transition-colors relative ${node465 ? 'bg-primary' : 'bg-text-tertiary'}`}
              >
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${node465 ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

export default NinfiniteLongVideoPage;
