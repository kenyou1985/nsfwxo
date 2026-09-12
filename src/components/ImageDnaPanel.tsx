import React, { useState, useRef, useCallback, useEffect, ChangeEvent } from 'react';
import { User, MapPin, Shirt, Sparkles, Loader2, RefreshCw, Zap, Download, Copy, Wand2, ChevronRight, ChevronDown, X, Maximize2, Replace, Plus, Trash2, RotateCcw, Pencil, Image as ImageIcon, Upload, Check } from 'lucide-react';
import type { ClothingInfo, ImageDnaResult } from '../services/promptApi';
import { extractClothings } from '../services/promptApi';
import { useToast } from '../hooks/useToast';

const RUNNINGHUB_CDN = 'https://rh-hk-images-switch.xiaoyaoyou.com/input';

/** 将相对路径转为完整 CDN URL */
function toFullImageUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return `${RUNNINGHUB_CDN}/${url.replace(/^\//, '')}`;
}

interface ImageDnaPanelProps {
  /** DNA 提取结果 */
  dna: ImageDnaResult | null;
  /** 是否正在提取中 */
  loading: boolean;
  /** 错误信息 */
  error?: string | null;
  /** 参考图预览 URL */
  imageUrl?: string;
  /** 额外参考图 URL 列表（最多 5 张），与 imageUrl 一起作为多参考图参与识别/合成 */
  additionalImageUrls?: string[];
  /** 重新提取 DNA */
  onReExtract: () => void;
  /** 将服装描述复制到剪贴板（作为提示词锚点） */
  onCopyClothing?: (clothing: ClothingInfo) => void;
  /** 将人物描述复制到剪贴板 */
  onCopyCharacter?: () => void;
  /** 将场景描述复制到剪贴板 */
  onCopyScene?: () => void;
  /** 将提取的服装图插入为参考图（替换首图槽位） */
  onInsertAsReference?: (dataUrl: string, clothingName: string) => void;
  /** 自定义补充信息（必须出现的姿势/道具/场景元素等） */
  supplementary?: string;
  /** 补充信息变化回调 */
  onSupplementaryChange?: (value: string) => void;
  /** 逐条补充模式：'individual' = 每条独立，'unified' = 统一使用 supplementary */
  supplementaryMode?: 'unified' | 'individual';
  /** 模式切换回调 */
  onSupplementaryModeChange?: (mode: 'unified' | 'individual') => void;
  /** 每条提示词的补充文本数组 */
  supplementaryItems?: string[];
  /** 逐条补充变化回调 */
  onSupplementaryItemsChange?: (items: string[]) => void;
  /** 生成条数（用于逐条模式渲染对应数量的文本框） */
  eroticCount?: number;
}

const NSFW_LEVEL_COLORS: Record<string, string> = {
  soft: 'bg-pink-100 text-pink-700 border-pink-200',
  normal: 'bg-rose-100 text-rose-700 border-rose-200',
  hard: 'bg-red-100 text-red-700 border-red-200',
};

const NSFW_LEVEL_LABELS: Record<string, string> = {
  soft: '纯情色',
  normal: '亲密暧昧',
  hard: '激情热辣',
};

const OVERALL_STYLE_COLORS: Record<string, string> = {
  romantic_soft: 'from-pink-50 to-rose-50 border-pink-200',
  intimate_normal: 'from-rose-50 to-red-50 border-rose-200',
  passionate_hot: 'from-red-50 to-orange-50 border-red-200',
  dramatic_theatrical: 'from-purple-50 to-violet-50 border-purple-200',
  bdsm_heavy: 'from-gray-700 to-gray-900 border-gray-600',
};

const CHARACTER_TYPE_LABELS: Record<string, string> = {
  '萝莉(严格18+)': '萝莉（18+）',
  '少女': '少女',
  '御姐': '御姐',
  '熟女': '熟女',
  '少妇': '少妇',
  'OL': 'OL',
  '女仆': '女仆',
  '护士': '护士',
  '教师': '教师',
  '瑜伽教练': '瑜伽教练',
  '啦啦队': '啦啦队',
  '比基尼模特': '比基尼模特',
  '和服': '和服',
  '汉服': '汉服',
  '其他': '其他',
};

const SCENE_TYPE_LABELS: Record<string, string> = {
  '客厅': '客厅',
  '卧室': '卧室',
  '浴室': '浴室',
  '游泳池': '游泳池',
  '海滩': '海滩',
  '办公室': '办公室',
  '教室': '教室',
  '酒店': '酒店',
  '街头': '街头',
  '森林': '森林',
  '厨房': '厨房',
  '健身房': '健身房',
  '更衣室': '更衣室',
  '其他': '其他',
};

// 服装类型下拉选项
const CLOTHING_TYPE_OPTIONS = [
  '上装',
  '下装',
  '连体',
  '鞋子',
  '袜子',
  '配饰',
  '其他',
];

/** 编辑行（前端 UI 状态）：包含唯一 id 与是否自定义标记 */
interface EditableClothing {
  id: string;
  name: string;
  type: string;
  color: string;
  style: string;
  isCustom: boolean;
}

/** 简易唯一 id 生成（避免引入 uuid 依赖） */
let _edIdCounter = 0;
function nextEditableId(): string {
  _edIdCounter += 1;
  return `c_${Date.now().toString(36)}_${_edIdCounter}`;
}

/** 从 ClothingInfo 构造 EditableClothing */
function clothingToEditable(c: ClothingInfo, isCustom = false): EditableClothing {
  return {
    id: nextEditableId(),
    name: c.name || '',
    type: c.type || '其他',
    color: c.color || '',
    style: c.style || '',
    isCustom,
  };
}

export const ImageDnaPanel: React.FC<ImageDnaPanelProps> = ({
  dna,
  loading,
  error,
  imageUrl,
  additionalImageUrls,
  onReExtract,
  onCopyClothing,
  onCopyCharacter,
  onCopyScene,
  onInsertAsReference,
  supplementary = '',
  onSupplementaryChange,
  supplementaryMode = 'individual',
  onSupplementaryModeChange,
  supplementaryItems = [],
  onSupplementaryItemsChange,
  eroticCount = 3,
}) => {
  const toast = useToast();
  // 包装调用，保持原有 showToast(msg, type) 接口
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') => {
    if (type === 'success') toast.success(message);
    else if (type === 'error') toast.error(message);
    else if (type === 'warning') toast.warning(message);
    else toast.info(message);
  }, [toast]);
  // 服装提取状态
  const [extracting, setExtracting] = useState(false);
  const [extractedClothings, setExtractedClothings] = useState<Array<{
    clothing: ClothingInfo;
    dataUrl: string;
    inserted: boolean;
  }>>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 放大预览状态：被点击查看的图片 dataUrl 与标题
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);
  // 可编辑服装列表（用户删减/新增），初始从 dna.clothing_list 同步
  const [editableClothings, setEditableClothings] = useState<EditableClothing[]>([]);
  const [editingClothings, setEditingClothings] = useState(false);
  // 服装提取模型选择
  const [extractModel, setExtractModel] = useState('gpt-image-2-c');
  // 自定义服装元素图片（最多 3 张）
  const [customElementImages, setCustomElementImages] = useState<string[]>([]);
  const customImageInputRef = useRef<HTMLInputElement>(null);

  // ─── 补充信息编辑流 ──────────────────────────────────────────────────
  // supplementary（prop）= 已生效（已提交）的补充信息，用于 H3 生成
  // draftSupplementary（local）= 用户当前在文本框里编辑的草稿，未提交不生效
  const [draftSupplementary, setDraftSupplementary] = useState(supplementary || '');
  const [isEditingSupplementary, setIsEditingSupplementary] = useState(!supplementary);
  // ─── 补充信息面板折叠/展开 ───────────────────────────────────────────
  // 默认折叠：避免视觉杂乱，用户点击标题栏或「展开」按钮才显示编辑区。
  // 触发自动展开的例外：用户已开始编辑（isEditingSupplementary=true）且没有已提交内容
  const [isSupplementaryPanelOpen, setIsSupplementaryPanelOpen] = useState(false);
  // 自动展开判断：仅在初次进入"无任何内容 + 用户已开始编辑"时打开
  // 当 prop supplementary 非空（有已提交内容）时也保持折叠，需要展开才能看到详情
  // 若 isEditingSupplementary=true 但尚未提交，则视作用户主动编辑，临时展开
  React.useEffect(() => {
    if (isEditingSupplementary && !supplementary.trim()) {
      setIsSupplementaryPanelOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── 逐条补充信息流 ──────────────────────────────────────────────────
  // 逐条模式下，每个槽位独立维护本地草稿；提交时一次性同步到父组件
  // 初始化：补充数组同步到 eroticCount 长度
  const effectiveCount = Math.max(1, eroticCount);
  const [draftSupplementaryItems, setDraftSupplementaryItems] = useState<string[]>(() => {
    // 用补充信息初始化或空字符串补齐
    const items: string[] = [];
    for (let i = 0; i < effectiveCount; i++) {
      items.push(supplementaryItems[i] ?? '');
    }
    return items;
  });
  const [individualEditing, setIndividualEditing] = useState(false);
  // 逐条模式：追踪每个槽位是否已提交（用于成功 UI 显示）
  const [submittedItems, setSubmittedItems] = useState<boolean[]>(() =>
    Array(effectiveCount).fill(false)
  );
  // 统一模式：追踪是否已提交（用于成功 UI 显示）
  const [unifiedSubmitted, setUnifiedSubmitted] = useState(false);

  // 当 eroticCount 或 supplementaryItems 变化时，重新同步本地草稿
  useEffect(() => {
    const items: string[] = [];
    for (let i = 0; i < effectiveCount; i++) {
      items.push(supplementaryItems[i] ?? '');
    }
    setDraftSupplementaryItems(items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eroticCount, supplementaryItems.length]);

  // 当父组件重置了 supplementary（例如切图后重新提取 DNA），同步本地草稿
  useEffect(() => {
    if (isEditingSupplementary) {
      setDraftSupplementary(supplementary || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplementary]);

  // 当 DNA 更新时，把 dna.clothing_list 同步到 editableClothings（保留现有自定义项）
  useEffect(() => {
    if (!dna) {
      setEditableClothings([]);
      return;
    }
    setEditableClothings(prev => {
      // 保留所有已存在的自定义项
      const customItems = prev.filter(p => p.isCustom);
      // 重建 DNA 项（不带自定义）
      const dnaItems = dna.clothing_list.map(c => clothingToEditable(c, false));
      return [...dnaItems, ...customItems];
    });
  }, [dna]);

  // ─── 编辑模式操作 ─────────────────────────────────────────────────
  const handleStartEditClothings = useCallback(() => {
    setEditingClothings(true);
  }, []);

  const handleCancelEditClothings = useCallback(() => {
    setEditingClothings(false);
    // 退出编辑模式 → 恢复为 DNA 原始列表（清掉所有自定义项）
    if (dna) {
      setEditableClothings(dna.clothing_list.map(c => clothingToEditable(c, false)));
    }
  }, [dna]);

  // 重置（保留编辑模式开启，清掉所有自定义、回到 DNA 原始列表）
  const handleResetClothings = useCallback(() => {
    if (!dna) return;
    setEditableClothings(dna.clothing_list.map(c => clothingToEditable(c, false)));
    showToast('已重置为 DNA 原始列表', 'info');
  }, [dna, showToast]);

  // 添加自定义服装行
  const handleAddCustomClothing = useCallback(() => {
    setEditableClothings(prev => [
      ...prev,
      {
        id: nextEditableId(),
        name: '',
        type: '其他',
        color: '',
        style: '',
        isCustom: true,
      },
    ]);
  }, []);

  // 删除某行
  const handleRemoveClothing = useCallback((id: string) => {
    setEditableClothings(prev => prev.filter(c => c.id !== id));
  }, []);

  // 更新某行字段
  const handleUpdateClothing = useCallback((id: string, patch: Partial<EditableClothing>) => {
    setEditableClothings(prev =>
      prev.map(c => (c.id === id ? { ...c, ...patch } : c))
    );
  }, []);

  // 把可编辑列表转换为 ClothingInfo 数组（用于传给后端或展示）
  const buildFinalClothings = useCallback((): ClothingInfo[] => {
    return editableClothings
      .filter(c => c.name.trim().length > 0)
      .map(c => ({
        name: c.name.trim(),
        type: c.type || '其他',
        color: c.color.trim(),
        style: c.style.trim(),
      }));
  }, [editableClothings]);

  // 服装提取函数：使用 Gemini-3.8-flash AI 从参考图提取服装区域图片
  const handleExtractClothings = useCallback(async () => {
    console.log('[ImageDnaPanel] handleExtractClothings called', {
      hasDna: !!dna,
      imageUrl: imageUrl?.slice(0, 60),
      clothingCount: dna?.clothing_list?.length || 0,
    });
    if (!dna) {
      showToast('请先等待 DNA 提取完成', 'warning');
      return;
    }
    if (!imageUrl) {
      showToast('没有可用的参考图', 'error');
      return;
    }
    // 使用用户编辑后的服装列表（删减 + 自定义合并后的最终列表）
    const finalClothings = buildFinalClothings();
    if (finalClothings.length === 0) {
      showToast('服装列表为空，请先添加至少一件服装', 'warning');
      return;
    }
    setExtracting(true);
    try {
      // 从最终列表中提取服装名称作为提示词
      const clothingNames = finalClothings.map(c => c.name);
      console.log('[ImageDnaPanel] 调用后端提取服装:', {
        imageUrl: imageUrl.slice(0, 60),
        clothingNames,
        additionalRefs: additionalImageUrls?.length || 0,
      });

      // 调用后端 Gemini-3.8-flash API 提取服装图片
      const result = await extractClothings(imageUrl, clothingNames, extractModel, customElementImages, additionalImageUrls);

      console.log('[ImageDnaPanel] 服装提取成功:', result.clothings);

      // 如果后端返回了图片，使用后端的图片；否则使用 Canvas 裁剪
      const results: Array<{ clothing: ClothingInfo; dataUrl: string; inserted: boolean }> = [];

      if (result.clothings && result.clothings.length > 0) {
        // 使用后端返回的 AI 提取图片
        for (const clothing of result.clothings) {
          if (clothing.image_url) {
            results.push({ clothing, dataUrl: clothing.image_url, inserted: false });
          }
        }
      }

      // 如果后端没有返回图片，回退到 Canvas 裁剪
      if (results.length === 0) {
        console.log('[ImageDnaPanel] 后端未返回图片，使用 Canvas 裁剪回退方案');

        // 加载参考图（使用完整 CDN URL）
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new Image();
          const loadSrc = toFullImageUrl(imageUrl);
          if (!loadSrc.startsWith('data:')) {
            i.crossOrigin = 'anonymous';
          }
          i.onload = () => resolve(i);
          i.onerror = (e) => {
            console.error('[ImageDnaPanel] image load error', e);
            reject(new Error('图片加载失败'));
          };
          i.src = loadSrc;
        });

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const imgW = img.naturalWidth;
        const imgH = img.naturalHeight;
        canvas.width = imgW;
        canvas.height = imgH;
        ctx.drawImage(img, 0, 0, imgW, imgH);

        for (const clothing of finalClothings) {
          // 根据服装类型估算裁剪区域（比例值，基于经验）
          let cropX = 0, cropY = 0, cropW = imgW, cropH = imgH;

          if (clothing.type === '上装') {
            cropW = Math.round(imgW * 0.55);
            cropH = Math.round(imgH * 0.4);
            cropX = Math.round(imgW * 0.2);
            cropY = Math.round(imgH * 0.1);
          } else if (clothing.type === '下装') {
            cropW = Math.round(imgW * 0.5);
            cropH = Math.round(imgH * 0.35);
            cropX = Math.round(imgW * 0.25);
            cropY = Math.round(imgH * 0.38);
          } else if (clothing.type === '连体') {
            cropW = Math.round(imgW * 0.6);
            cropH = Math.round(imgH * 0.65);
            cropX = Math.round(imgW * 0.2);
            cropY = Math.round(imgH * 0.08);
          } else if (clothing.type === '鞋子') {
            cropW = Math.round(imgW * 0.3);
            cropH = Math.round(imgH * 0.15);
            cropX = Math.round(imgW * 0.35);
            cropY = Math.round(imgH * 0.78);
          } else if (clothing.type === '袜子') {
            cropW = Math.round(imgW * 0.25);
            cropH = Math.round(imgH * 0.2);
            cropX = Math.round(imgW * 0.38);
            cropY = Math.round(imgH * 0.7);
          } else if (clothing.type === '配饰') {
            cropW = Math.round(imgW * 0.3);
            cropH = Math.round(imgH * 0.2);
            cropX = Math.round(imgW * 0.35);
            cropY = Math.round(imgH * 0.05);
          }

          // 确保不超出边界
          cropX = Math.max(0, Math.min(cropX, imgW - 1));
          cropY = Math.max(0, Math.min(cropY, imgH - 1));
          cropW = Math.min(cropW, imgW - cropX);
          cropH = Math.min(cropH, imgH - cropY);

          // 创建裁剪画布
          const cropCanvas = document.createElement('canvas');
          cropCanvas.width = cropW;
          cropCanvas.height = cropH;
          const cropCtx = cropCanvas.getContext('2d');
          if (!cropCtx) continue;

          cropCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

          // 添加白色边框模拟展示效果
          const padded = document.createElement('canvas');
          const pad = 8;
          padded.width = cropW + pad * 2;
          padded.height = cropH + pad * 2;
          const paddedCtx = padded.getContext('2d');
          if (!paddedCtx) continue;
          paddedCtx.fillStyle = '#ffffff';
          paddedCtx.fillRect(0, 0, padded.width, padded.height);
          paddedCtx.drawImage(cropCanvas, pad, pad);

          const dataUrl = padded.toDataURL('image/png');
          results.push({ clothing, dataUrl, inserted: false });
        }
      }

      setExtractedClothings(results);
      showToast(`已提取 ${results.length} 件服装区域`, 'success');
    } catch (err) {
      console.error('[ImageDnaPanel] clothing extraction failed:', err);
      showToast(`服装提取失败: ${err instanceof Error ? err.message : '未知错误'}`, 'error');
    } finally {
      setExtracting(false);
    }
  }, [dna, imageUrl, showToast, buildFinalClothings, extractModel, customElementImages, additionalImageUrls]);

  // 下载单件服装图片
  const handleDownloadClothing = useCallback((item: { clothing: ClothingInfo; dataUrl: string }) => {
    const a = document.createElement('a');
    a.href = item.dataUrl;
    a.download = `clothing_${item.clothing.name.replace(/\s+/g, '_')}.png`;
    a.click();
  }, []);

  // 复制到剪贴板
  const handleCopyClothing = useCallback(async (item: { clothing: ClothingInfo; dataUrl: string }) => {
    try {
      const res = await fetch(item.dataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
    } catch {
      // fallback: 复制 dataUrl 文本
      await navigator.clipboard.writeText(item.clothing.name);
    }
  }, []);

  // 一键复制所有服装名称（用于提示词）
  const handleCopyAllClothings = useCallback(async () => {
    if (!dna) return;
    const text = dna.clothing_list.map(c => c.name).join(', ');
    await navigator.clipboard.writeText(text);
  }, [dna]);

  // 点击图片 → 打开大图预览
  const handleOpenPreview = useCallback((item: { clothing: ClothingInfo; dataUrl: string }) => {
    setPreviewImage({ url: item.dataUrl, title: item.clothing.name });
  }, []);

  // 关闭大图预览
  const handleClosePreview = useCallback(() => setPreviewImage(null), []);

  // ESC 关闭预览
  React.useEffect(() => {
    if (!previewImage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewImage(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewImage]);

  // 点击"插入到参考图"
  const handleInsertAsReference = useCallback((item: { clothing: ClothingInfo; dataUrl: string }) => {
    if (!onInsertAsReference) {
      showToast('当前页面不支持插入参考图', 'warning');
      return;
    }
    onInsertAsReference(item.dataUrl, item.clothing.name);
  }, [onInsertAsReference, showToast]);

  // 上传自定义服装元素图片（最多 3 张）
  const handleCustomElementUpload = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    if (customElementImages.length >= 3) {
      showToast('最多上传 3 张自定义服装元素图片', 'warning');
      return;
    }
    const remaining = 3 - customElementImages.length;
    const toProcess = Array.from(files).slice(0, remaining);

    try {
      const newDataUrls: string[] = [];
      for (const file of toProcess) {
        const dataUrl: string = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        newDataUrls.push(dataUrl);
      }
      setCustomElementImages(prev => [...prev, ...newDataUrls].slice(0, 3));
      showToast(`已添加 ${newDataUrls.length} 张自定义服装元素`, 'success');
    } catch {
      showToast('自定义服装元素图片读取失败', 'error');
    }
    // reset input
    if (customImageInputRef.current) customImageInputRef.current.value = '';
  }, [customElementImages.length, showToast]);

  // 移除某张自定义元素图
  const handleRemoveCustomElement = useCallback((idx: number) => {
    setCustomElementImages(prev => prev.filter((_, i) => i !== idx));
  }, []);

  // ─── 补充信息提交 ──────────────────────────────────────────────────────
  // 使用普通函数而非 useCallback，避免闭包陷阱导致取消按钮失效
  const handleSubmitSupplementary = () => {
    const trimmed = draftSupplementary.trim();
    onSupplementaryChange?.(trimmed);
    setIsEditingSupplementary(false);
    setUnifiedSubmitted(true);
    showToast(
      trimmed ? `已提交补充信息（${trimmed.length} 字），下次生成 H3 提示词时生效` : '已清空补充信息',
      'success',
    );
  };

  // 统一模式删除处理
  const handleDeleteUnifiedSupplementary = () => {
    onSupplementaryChange?.('');
    setUnifiedSubmitted(false);
    showToast('已删除补充信息，将使用系统默认 H3 提示词', 'info');
  };

  // 取消编辑，恢复到已提交的文本
  const handleCancelEditSupplementary = () => {
    // 强制同步更新两步，确保编辑状态立即关闭
    setDraftSupplementary(supplementary || '');
    setIsEditingSupplementary(false);
  };

  // 进入编辑模式
  const handleStartEditSupplementary = () => {
    setDraftSupplementary(supplementary || '');
    setIsEditingSupplementary(true);
  };

  // ─── 逐条补充信息处理函数 ─────────────────────────────────────────────
  // 编辑单个槽位的内容
  const handleSupplementaryItemChange = (idx: number, value: string) => {
    setDraftSupplementaryItems(prev => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  };

  // 提交所有逐条补充（一次性同步到父组件）
  const handleSubmitSupplementaryItems = () => {
    onSupplementaryItemsChange?.(draftSupplementaryItems);
    setIndividualEditing(false);
    // 标记所有有内容的条目为已提交状态
    const newSubmitted = draftSupplementaryItems.map(s => s.trim().length > 0);
    setSubmittedItems(newSubmitted);
    const filledCount = draftSupplementaryItems.filter(s => s.trim().length > 0).length;
    showToast(
      filledCount > 0
        ? `已提交 ${filledCount}/${effectiveCount} 条补充信息`
        : '已清空全部补充信息',
      'success',
    );
  };

  // 删除单个逐条补充（清除该项并回退到系统默认）
  const handleDeleteSupplementaryItem = (idx: number) => {
    const newItems = [...draftSupplementaryItems];
    newItems[idx] = '';
    setDraftSupplementaryItems(newItems);
    // 同步到父组件
    onSupplementaryItemsChange?.(newItems);
    // 更新提交状态
    const newSubmitted = [...submittedItems];
    newSubmitted[idx] = false;
    setSubmittedItems(newSubmitted);
    showToast(`已删除补充信息 #${idx + 1}，将使用系统默认 H3 提示词`, 'info');
  };

  // 统一模式提交成功处理（合并到原函数）

  // 取消逐条编辑（恢复到父组件数据）
  const handleCancelSupplementaryItems = () => {
    // 重新从父组件数据初始化本地草稿
    const items: string[] = [];
    for (let i = 0; i < effectiveCount; i++) {
      items.push(supplementaryItems[i] ?? '');
    }
    setDraftSupplementaryItems(items);
    setIndividualEditing(false);
  };

  // 一键清空全部逐条补充
  const handleClearSupplementaryItems = () => {
    setDraftSupplementaryItems(Array(effectiveCount).fill(''));
  };

  // 加载中状态
  if (loading) {
    return (
      <div className="rounded-xl border border-pink-200 bg-gradient-to-br from-pink-50 to-rose-50 p-4">
        <div className="flex items-center justify-center gap-3 py-8">
          <Loader2 size={20} className="text-pink-500 animate-spin" />
          <span className="text-sm text-pink-600 font-medium">正在提取图片DNA...</span>
        </div>
        <p className="text-xs text-center text-text-tertiary">
          Gemini-3.8-flash 视觉分析中，请稍候
        </p>
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <p className="text-sm text-red-700 font-medium">DNA 提取失败</p>
            <p className="text-xs text-red-500 mt-1">{error}</p>
          </div>
          <button
            onClick={onReExtract}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-100 hover:bg-red-200 text-red-700 text-xs font-medium transition-colors"
          >
            <RefreshCw size={12} />
            重试
          </button>
        </div>
      </div>
    );
  }

  // 无数据状态
  if (!dna) {
    return null;
  }

  const nsfwColor = NSFW_LEVEL_COLORS[dna.nsfw_level] || NSFW_LEVEL_COLORS.normal;
  const nsfwLabel = NSFW_LEVEL_LABELS[dna.nsfw_level] || '未知';
  const styleColor = OVERALL_STYLE_COLORS[dna.overall_style] || OVERALL_STYLE_COLORS.intimate_normal;

  return (
    <div className="space-y-3">
      {/* 整体风格 & NSFW 级别 */}
      <div className={`rounded-xl border bg-gradient-to-br ${styleColor} p-3`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-pink-500" />
            <span className="text-xs font-medium text-text-primary">图片DNA分析结果</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${nsfwColor}`}>
              {nsfwLabel}
            </span>
            <button
              onClick={onReExtract}
              className="p-1 rounded-lg hover:bg-black/5 transition-colors"
              title="重新提取"
            >
              <RefreshCw size={12} className="text-text-tertiary" />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* 人物信息 */}
        <div className="rounded-xl border border-pink-200 bg-white p-3">
          <div className="flex items-center gap-2 mb-2">
            <User size={14} className="text-pink-500" />
            <span className="text-xs font-semibold text-text-primary">人物信息</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-text-tertiary w-12 flex-shrink-0">类型</span>
              <span className="text-xs font-medium text-pink-600">
                {CHARACTER_TYPE_LABELS[dna.character_type] || dna.character_type}
              </span>
            </div>
            <div className="flex items-start gap-1.5">
              <span className="text-[10px] text-text-tertiary w-12 flex-shrink-0 pt-0.5">描述</span>
              <span className="text-[10px] text-text-secondary leading-relaxed">
                {dna.character_description || '-'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-text-tertiary w-12 flex-shrink-0">年龄段</span>
              <span className="text-[10px] font-medium text-text-primary">
                {dna.character_age_hint === 'YOUNG_ADULT' ? '青年 (18-25)' :
                 dna.character_age_hint === 'MATURE' ? '成熟 (26-40)' :
                 dna.character_age_hint === 'MIDDLE_AGED' ? '中年 (40+)' :
                 dna.character_age_hint || '-'}
              </span>
            </div>
          </div>
          {onCopyCharacter && (
            <button
              onClick={onCopyCharacter}
              className="mt-2 w-full text-[10px] py-1 px-2 rounded-lg border border-pink-200 text-pink-600 hover:bg-pink-50 transition-colors"
            >
              复制人物描述
            </button>
          )}
        </div>

        {/* 场景信息 */}
        <div className="rounded-xl border border-blue-200 bg-white p-3">
          <div className="flex items-center gap-2 mb-2">
            <MapPin size={14} className="text-blue-500" />
            <span className="text-xs font-semibold text-text-primary">场景信息</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-text-tertiary w-12 flex-shrink-0">类型</span>
              <span className="text-xs font-medium text-blue-600">
                {SCENE_TYPE_LABELS[dna.scene_type] || dna.scene_type}
              </span>
            </div>
            <div className="flex items-start gap-1.5">
              <span className="text-[10px] text-text-tertiary w-12 flex-shrink-0 pt-0.5">描述</span>
              <span className="text-[10px] text-text-secondary leading-relaxed">
                {dna.scene_description || '-'}
              </span>
            </div>
          </div>
          {onCopyScene && (
            <button
              onClick={onCopyScene}
              className="mt-2 w-full text-[10px] py-1 px-2 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors"
            >
              复制场景描述
            </button>
          )}
        </div>

        {/* 动作预判 */}
        <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-purple-50 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Zap size={14} className="text-violet-500" />
            <span className="text-xs font-semibold text-text-primary">动作预判</span>
          </div>
          <p className="text-[10px] text-text-secondary leading-relaxed">
            {dna.action_prediction || '等待 Gemini 分析...'}
          </p>
        </div>
      </div>

      {/* 自定义补充信息 - 用户可手动指定必须出现的姿势/道具/场景元素等 */}
      <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-3">
        {/* 标题栏 + 折叠/展开 + 模式切换 */}
        <div
          className="flex items-center gap-2 mb-0 cursor-pointer select-none"
          onClick={() => setIsSupplementaryPanelOpen(prev => !prev)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsSupplementaryPanelOpen(prev => !prev);
            }
          }}
        >
          <Pencil size={14} className="text-emerald-500" />
          <span className="text-xs font-semibold text-text-primary">自定义补充信息</span>

          {/* 已提交内容摘要（折叠时显示） */}
          {!isSupplementaryPanelOpen && supplementaryMode === 'unified' && supplementary.trim().length > 0 && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[9px] font-medium border border-emerald-200">
              <Check size={9} />
              已设置 · {supplementary.trim().length} 字
            </span>
          )}
          {!isSupplementaryPanelOpen && supplementaryMode === 'individual' && supplementaryItems.some(s => s.trim().length > 0) && (() => {
            const filled = supplementaryItems.filter(s => s.trim().length > 0).length;
            return (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[9px] font-medium border border-emerald-200">
                <Check size={9} />
                已设置 · {filled}/{effectiveCount}
              </span>
            );
          })()}

          {/* 展开/折叠按钮（点击整行也可切换） */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsSupplementaryPanelOpen(prev => !prev);
            }}
            className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-lg border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50 text-[10px] font-medium transition-colors"
            title={isSupplementaryPanelOpen ? '折叠补充信息面板' : '展开补充信息面板'}
          >
            {isSupplementaryPanelOpen ? '折叠' : '展开'}
            {isSupplementaryPanelOpen
              ? <ChevronDown size={11} className="rotate-180 transition-transform" />
              : <ChevronDown size={11} className="transition-transform" />
            }
          </button>
        </div>

        {/* 折叠状态下的简要说明 + 一键展开 */}
        {!isSupplementaryPanelOpen && (
          <div className="mt-2 text-[10px] text-emerald-600/80 leading-relaxed">
            💡 用于指定必须出现的姿势 / 道具 / 场景元素。除非明确改变场景，否则 H3 提示词默认以参考图作为首帧。
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setIsSupplementaryPanelOpen(true); }}
              className="ml-1 underline decoration-emerald-400 hover:text-emerald-700"
            >
              点击展开
            </button>
          </div>
        )}

        {/* 面板内容：仅在展开时显示 */}
        {isSupplementaryPanelOpen && (
          <>
            {/* 模式切换 Pills（放在独立行，避免与标题栏的展开按钮冲突） */}
            <div className="flex items-center gap-2 mt-3 mb-3">
              <span className="text-[10px] text-emerald-700/80 font-medium">补充模式：</span>
              <div className="flex rounded-lg border border-emerald-300 overflow-hidden text-[9px] font-medium">
                <button
                  onClick={() => onSupplementaryModeChange?.('individual')}
                  className={`px-2 py-1 transition-colors ${
                    supplementaryMode === 'individual'
                      ? 'bg-emerald-500 text-white'
                      : 'bg-white text-emerald-700 hover:bg-emerald-50'
                  }`}
                >
                  逐条补充
                </button>
                <button
                  onClick={() => onSupplementaryModeChange?.('unified')}
                  className={`px-2 py-1 transition-colors ${
                    supplementaryMode === 'unified'
                      ? 'bg-emerald-500 text-white'
                      : 'bg-white text-emerald-700 hover:bg-emerald-50'
                  }`}
                >
                  统一补充
                </button>
              </div>
            </div>

        {/* ── 逐条补充模式 ───────────────────────────────────────── */}
        {supplementaryMode === 'individual' ? (
          <div className="space-y-2">
            {Array.from({ length: effectiveCount }).map((_, idx) => {
              const itemValue = draftSupplementaryItems[idx] ?? '';
              const hasContent = itemValue.trim().length > 0;
              const isSubmitted = submittedItems[idx] && hasContent;
              return (
                <div
                  key={idx}
                  className={`rounded-lg border p-2 transition-all ${
                    isSubmitted
                      ? 'bg-emerald-50 border-emerald-300 shadow-sm'
                      : hasContent
                        ? 'bg-white/70 border-emerald-200'
                        : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 ${
                      isSubmitted
                        ? 'bg-emerald-500 text-white'
                        : hasContent
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-gray-100 text-gray-500'
                    }`}>
                      {isSubmitted && <Check size={9} />}
                      提示词 #{idx + 1}
                    </span>
                    {isSubmitted && (
                      <span className="flex items-center gap-0.5 text-[9px] text-emerald-600 font-medium">
                        <Check size={9} />
                        已提交 · {itemValue.trim().length} 字
                      </span>
                    )}
                    {!isSubmitted && hasContent && (
                      <span className="flex items-center gap-0.5 text-[9px] text-amber-500">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        草稿
                      </span>
                    )}
                    {!hasContent && (
                      <span className="text-[9px] text-gray-400">未设置</span>
                    )}
                    {/* 删除按钮 */}
                    {isSubmitted && (
                      <button
                        onClick={() => handleDeleteSupplementaryItem(idx)}
                        className="ml-auto flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-emerald-100 hover:bg-red-100 text-emerald-500 hover:text-red-500 transition-colors"
                        title="删除补充信息（回退到系统默认）"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  <textarea
                    value={itemValue}
                    onChange={(e) => handleSupplementaryItemChange(idx, e.target.value)}
                    placeholder={`为提示词 #${idx + 1} 指定特殊姿势/道具/场景...`}
                    rows={2}
                    className={`w-full px-2 py-1 rounded-lg text-[10px] bg-white border placeholder:text-gray-400/60 focus:outline-none focus:ring-1 resize-y leading-relaxed ${
                      isSubmitted
                        ? 'text-emerald-700 border-emerald-200 focus:ring-emerald-300'
                        : hasContent
                          ? 'text-text-primary border-emerald-100 focus:ring-emerald-300'
                          : 'text-text-primary border-gray-200 focus:ring-gray-300'
                    }`}
                  />
                </div>
              );
            })}

            {/* 逐条补充操作栏 */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleSubmitSupplementaryItems}
                className="flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold transition-colors"
              >
                <Check size={11} />
                提交全部
              </button>
              <button
                onClick={() => {
                  // 取消编辑，恢复父组件数据
                  const items: string[] = [];
                  for (let i = 0; i < effectiveCount; i++) {
                    items.push(supplementaryItems[i] ?? '');
                  }
                  setDraftSupplementaryItems(items);
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 text-[10px] font-medium transition-colors"
              >
                <X size={11} />
                取消
              </button>
              <button
                onClick={() => {
                  setDraftSupplementaryItems(Array(effectiveCount).fill(''));
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 text-[10px] font-medium transition-colors"
              >
                <Trash2 size={10} />
                清空
              </button>
              <span className="text-[9px] text-emerald-600/80 ml-auto">
                ✦ 提交后生效，未提交不用于生成
              </span>
            </div>
          </div>
        ) : (
          /* ── 统一补充模式 ──────────────────────────────────────── */
          <div>
            {isEditingSupplementary ? (
              /* 编辑中状态 */
              <>
                <textarea
                  value={draftSupplementary}
                  onChange={(e) => setDraftSupplementary(e.target.value)}
                  placeholder="例如：必须出现传教士姿势；必须使用按摩棒道具；站立后入；跪在椅子上口交；需要颜射收尾..."
                  rows={3}
                  className="w-full px-2 py-1.5 rounded-lg text-[10px] text-text-primary bg-white border border-emerald-200 placeholder:text-emerald-400/60 focus:outline-none focus:ring-1 focus:ring-emerald-300 resize-y leading-relaxed"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={handleSubmitSupplementary}
                    className="flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold transition-colors"
                  >
                    <Check size={11} />
                    {draftSupplementary.trim() ? '保存' : '清空'}
                  </button>
                  <button
                    onClick={handleCancelEditSupplementary}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 text-[10px] font-medium transition-colors"
                  >
                    <X size={11} />
                    放弃
                  </button>
                  <span className="text-[9px] text-emerald-600/80 ml-auto">
                    ✦ 未保存不会生效
                  </span>
                </div>
              </>
            ) : supplementary.trim().length > 0 ? (
              /* 已提交 - 标签式展示 */
              <>
                <div className={`flex items-start gap-2 p-3 rounded-lg border transition-all ${
                  unifiedSubmitted
                    ? 'bg-emerald-50 border-emerald-300 shadow-sm'
                    : 'bg-white border-emerald-200'
                }`}>
                  <div className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500 text-white flex-shrink-0">
                    <Check size={12} />
                  </div>
                  <span
                    onClick={handleStartEditSupplementary}
                    className="flex-1 text-[10px] text-text-primary leading-relaxed whitespace-pre-wrap break-words cursor-pointer hover:bg-emerald-50 rounded px-1 py-0.5 transition-colors"
                    title="点击编辑"
                  >
                    {supplementary}
                  </span>
                  <button
                    onClick={handleDeleteUnifiedSupplementary}
                    className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-gray-100 hover:bg-red-100 text-gray-400 hover:text-red-500 transition-colors"
                    title="删除补充信息（回退到系统默认）"
                  >
                    <X size={12} />
                  </button>
                </div>
                {unifiedSubmitted && (
                  <div className="mt-2 flex items-center gap-1.5 text-[9px] text-emerald-600 font-medium">
                    <Check size={10} />
                    已成功提交，下次生成 H3 提示词时生效
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => {
                      handleStartEditSupplementary();
                      setUnifiedSubmitted(false);
                    }}
                    className="flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700 text-[10px] font-bold transition-colors"
                  >
                    <Pencil size={11} />
                    编辑
                  </button>
                  <span className="text-[9px] text-emerald-600/80">
                    ✦ 已合并到 H3 提示词生成（3 条共用）
                  </span>
                </div>
              </>
            ) : (
              /* 未设置 */
              <>
                <div className="text-[10px] text-emerald-500/70 text-center py-2">
                  暂未设置补充信息，点击下方「填写」开始
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={handleStartEditSupplementary}
                    className="flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700 text-[10px] font-bold transition-colors"
                  >
                    <Pencil size={11} />
                    填写补充信息
                  </button>
                </div>
              </>
            )}
          </div>
        )}
          </>
        )}
      </div>

      {/* 服装信息 */}
      <div className="rounded-xl border border-amber-200 bg-white p-3">
        <div className="flex items-center gap-2 mb-2">
          <Shirt size={14} className="text-amber-500" />
          <span className="text-xs font-semibold text-text-primary">服装信息</span>
          <span className="text-[10px] text-text-tertiary ml-auto">
            {dna.clothing_list.length} 件
          </span>
          {/* 模型选择下拉 */}
          <select
            value={extractModel}
            onChange={(e) => setExtractModel(e.target.value)}
            className="px-1.5 py-0.5 rounded text-[10px] border border-amber-200 text-amber-700 bg-amber-50 focus:outline-none focus:ring-1 focus:ring-amber-300"
            title="选择服装提取图片生成模型"
          >
            <option value="gpt-image-2-c">GPT-Image-2-C</option>
            <option value="grok-imagine-image-2.0">Grok-Imagine-2.0</option>
            <option value="gemini-3.1-flash-image-preview">Gemini-3.1-Flash</option>
          </select>
          <button
            onClick={handleExtractClothings}
            disabled={extracting || (dna.clothing_list.length === 0 && editableClothings.filter(c => c.name.trim()).length === 0)}
            className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-700 text-[10px] font-medium disabled:opacity-50 transition-colors"
            title="使用 AI 从参考图提取服装区域"
          >
            {extracting ? <Loader2 size={10} className="animate-spin" /> : <Wand2 size={10} />}
            {extracting ? '提取中...' : '提取服装'}
          </button>
          {dna.clothing_list.length > 0 && (
            <button
              onClick={handleCopyAllClothings}
              className="flex items-center gap-1 px-2 py-0.5 rounded-lg border border-amber-200 text-amber-600 text-[10px] font-medium hover:bg-amber-50 transition-colors"
              title="复制所有服装名称"
            >
              <Copy size={10} />
              复制名称
            </button>
          )}
        </div>

        {/* ─── 自定义服装元素图片上传（最多 3 张） ─── */}
        <div className="mb-2 p-2 rounded-lg bg-rose-50 border border-rose-200">
          <div className="flex items-center gap-1 mb-1.5">
            <ImageIcon size={11} className="text-rose-500" />
            <span className="text-[10px] font-semibold text-rose-700">自定义服装元素</span>
            <span className="text-[9px] text-rose-400 ml-auto">
              {customElementImages.length}/3 张
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 flex-wrap flex-1">
              {customElementImages.map((url, idx) => (
                <div key={idx} className="relative group w-10 h-10 rounded overflow-hidden border border-rose-200 bg-white">
                  <img src={url} alt={`自定义元素${idx + 1}`} className="w-full h-full object-cover" />
                  <button
                    onClick={() => handleRemoveCustomElement(idx)}
                    className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="移除"
                  >
                    <X size={8} />
                  </button>
                </div>
              ))}
              {customElementImages.length < 3 && (
                <button
                  onClick={() => customImageInputRef.current?.click()}
                  className="w-10 h-10 rounded border-2 border-dashed border-rose-300 flex items-center justify-center text-rose-400 hover:border-rose-400 hover:text-rose-600 transition-colors"
                  title="上传自定义服装元素图片（最多 3 张）"
                >
                  <Plus size={14} />
                </button>
              )}
            </div>
          </div>
          <p className="text-[9px] text-rose-400 mt-1">
            上传服装元素图片，将与参考图服装一起合成（可配合上方自定义元素名称使用）
          </p>
          <input
            ref={customImageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleCustomElementUpload}
          />
        </div>

        {/* 提取后的服装图片展示 */}
        {extractedClothings.length > 0 && (
          <div className="mb-3 p-2 rounded-lg bg-amber-50 border border-amber-200">
            <div className="flex items-center gap-1 mb-2">
              <span className="text-[10px] font-semibold text-amber-700">已提取服装（可下载 / 复制 / 插入为参考图）</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {extractedClothings.map((item, idx) => (
                <div key={idx} className="relative group rounded-lg overflow-hidden border border-amber-200 bg-white">
                  {/* 可点击放大：cursor-zoom-in + 点击触发预览 */}
                  <img
                    src={item.dataUrl}
                    alt={item.clothing.name}
                    className="w-full aspect-square object-contain bg-white cursor-zoom-in transition-transform group-hover:scale-[1.02]"
                    onClick={() => handleOpenPreview(item)}
                    title="点击放大预览"
                  />
                  {/* 角标：放大提示 */}
                  <div className="absolute top-1 right-1 bg-black/55 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <Maximize2 size={10} className="text-white" />
                  </div>
                  <div className="absolute inset-x-0 bottom-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 py-1">
                    <button
                      onClick={() => handleOpenPreview(item)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/90 text-amber-700 text-[9px] font-medium hover:bg-white transition-colors"
                      title="放大预览"
                    >
                      <Maximize2 size={9} />
                      预览
                    </button>
                    <button
                      onClick={() => handleDownloadClothing(item)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/90 text-amber-700 text-[9px] font-medium hover:bg-white transition-colors"
                      title="下载 PNG"
                    >
                      <Download size={9} />
                      下载
                    </button>
                    <button
                      onClick={() => handleCopyClothing(item)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/90 text-amber-700 text-[9px] font-medium hover:bg-white transition-colors"
                      title="复制图片"
                    >
                      <Copy size={9} />
                      复制
                    </button>
                    <button
                      onClick={() => handleInsertAsReference(item)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500 text-white text-[9px] font-bold hover:bg-amber-600 transition-colors"
                      title="替换当前参考图（首图）"
                    >
                      <Replace size={9} />
                      插入参考图
                    </button>
                  </div>
                  <div className="absolute top-0 inset-x-0 bg-black/50 text-white text-[9px] px-1 py-0.5 truncate">
                    {item.clothing.name}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 只读 / 编辑 切换 */}
        {!editingClothings ? (
          <>
            {dna.clothing_list.length > 0 ? (
              <>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {dna.clothing_list.map((clothing, idx) => (
                    <div key={idx} className="flex items-start gap-1.5 p-1.5 rounded-lg bg-amber-50">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-[10px] font-medium text-amber-700">{clothing.name}</span>
                          <span className="text-[9px] text-amber-500">({clothing.type})</span>
                        </div>
                        {(clothing.color || clothing.style) && (
                          <div className="text-[9px] text-amber-400 mt-0.5">
                            {[clothing.color, clothing.style].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                      {onCopyClothing && (
                        <button
                          onClick={() => onCopyClothing(clothing)}
                          className="flex-shrink-0 text-[9px] px-1.5 py-0.5 rounded border border-amber-200 text-amber-600 hover:bg-amber-100 transition-colors"
                        >
                          复制
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {/* 编辑入口 */}
                <button
                  onClick={handleStartEditClothings}
                  className="mt-2 w-full flex items-center justify-center gap-1 py-1 rounded-lg border border-amber-200 text-amber-600 hover:bg-amber-50 text-[10px] font-medium transition-colors"
                  title="删减不需要的服装，或添加自定义服装（如黑色丁字裤、帽子、白色手套等）"
                >
                  <Pencil size={10} />
                  编辑服装（删减 / 添加）
                </button>
              </>
            ) : (
              <>
                <p className="text-[10px] text-text-tertiary text-center py-2">未检测到服装</p>
                <button
                  onClick={handleStartEditClothings}
                  className="mt-2 w-full flex items-center justify-center gap-1 py-1 rounded-lg border border-amber-200 text-amber-600 hover:bg-amber-50 text-[10px] font-medium transition-colors"
                  title="手动添加服装元素"
                >
                  <Plus size={10} />
                  添加服装
                </button>
              </>
            )}
          </>
        ) : (
          /* ─── 编辑模式：可删减/添加 ─── */
          <div className="space-y-2">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[10px] text-amber-700 font-semibold">
                共 {editableClothings.length} 件
              </span>
              <span className="text-[9px] text-amber-500">
                （{editableClothings.filter(c => c.isCustom).length} 项自定义）
              </span>
              <button
                onClick={handleAddCustomClothing}
                className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-bold transition-colors"
                title="添加自定义服装（如黑色丁字裤、帽子、白色手套等）"
              >
                <Plus size={10} />
                添加
              </button>
              <button
                onClick={handleResetClothings}
                className="flex items-center gap-1 px-2 py-0.5 rounded-lg border border-amber-200 text-amber-600 hover:bg-amber-50 text-[10px] font-medium transition-colors"
                title="清掉所有自定义、回到 DNA 原始列表"
              >
                <RotateCcw size={10} />
                重置
              </button>
              <button
                onClick={handleCancelEditClothings}
                className="flex items-center gap-1 px-2 py-0.5 rounded-lg border border-amber-200 text-amber-600 hover:bg-amber-50 text-[10px] font-medium transition-colors"
                title="取消编辑"
              >
                <X size={10} />
                取消
              </button>
            </div>

            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {editableClothings.length === 0 && (
                <p className="text-[10px] text-text-tertiary text-center py-3">
                  列表为空，点击右上「添加」手动添加服装
                </p>
              )}
              {editableClothings.map((item) => (
                <div
                  key={item.id}
                  className={`p-1.5 rounded-lg border ${
                    item.isCustom
                      ? 'bg-rose-50 border-rose-200'
                      : 'bg-amber-50 border-amber-200'
                  }`}
                >
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={item.name}
                      onChange={(e) => handleUpdateClothing(item.id, { name: e.target.value })}
                      placeholder="服装名称（如 黑色丁字裤）"
                      className={`flex-1 min-w-0 px-1.5 py-0.5 rounded text-[10px] font-medium border bg-white focus:outline-none focus:ring-1 ${
                        item.isCustom
                          ? 'text-rose-700 border-rose-200 focus:ring-rose-300'
                          : 'text-amber-700 border-amber-200 focus:ring-amber-300'
                      }`}
                    />
                    <button
                      onClick={() => handleRemoveClothing(item.id)}
                      className="flex-shrink-0 p-0.5 rounded text-red-500 hover:bg-red-50 transition-colors"
                      title="删除此行"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    <select
                      value={item.type}
                      onChange={(e) => handleUpdateClothing(item.id, { type: e.target.value })}
                      className={`flex-shrink-0 px-1 py-0.5 rounded text-[9px] border bg-white ${
                        item.isCustom
                          ? 'text-rose-600 border-rose-200'
                          : 'text-amber-600 border-amber-200'
                      }`}
                    >
                      {CLOTHING_TYPE_OPTIONS.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={item.color}
                      onChange={(e) => handleUpdateClothing(item.id, { color: e.target.value })}
                      placeholder="颜色"
                      className={`flex-1 min-w-0 px-1.5 py-0.5 rounded text-[9px] border bg-white ${
                        item.isCustom
                          ? 'text-rose-600 border-rose-200 placeholder:text-rose-300'
                          : 'text-amber-600 border-amber-200 placeholder:text-amber-300'
                      }`}
                    />
                    <input
                      type="text"
                      value={item.style}
                      onChange={(e) => handleUpdateClothing(item.id, { style: e.target.value })}
                      placeholder="风格"
                      className={`flex-1 min-w-0 px-1.5 py-0.5 rounded text-[9px] border bg-white ${
                        item.isCustom
                          ? 'text-rose-600 border-rose-200 placeholder:text-rose-300'
                          : 'text-amber-600 border-amber-200 placeholder:text-amber-300'
                      }`}
                    />
                  </div>
                  {item.isCustom && (
                    <div className="text-[9px] text-rose-500 mt-0.5">✦ 自定义</div>
                  )}
                </div>
              ))}
            </div>

            {/* 提示信息 */}
            {editableClothings.length > 0 && (
              <p className="text-[9px] text-text-tertiary leading-relaxed px-1">
                ✦ 点击「提取服装」将仅基于当前列表（共 {editableClothings.filter(c => c.name.trim()).length} 件有效）生成扣图合成图
              </p>
            )}
          </div>
        )}
      </div>

      {/* ─── 大图预览 Lightbox ─── */}
      {previewImage && (
        <div
          className="fixed inset-0 z-[100] bg-black/85 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={handleClosePreview}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={previewImage.url}
              alt={previewImage.title}
              className="max-w-[90vw] max-h-[80vh] object-contain rounded-lg shadow-2xl cursor-default bg-white"
            />
            <div className="flex items-center gap-3 px-4 py-2 rounded-full bg-black/60 text-white">
              <span className="text-xs font-medium">{previewImage.title}</span>
              <button
                onClick={() => {
                  const a = document.createElement('a');
                  a.href = previewImage.url;
                  a.download = `clothing_${previewImage.title.replace(/\s+/g, '_')}.png`;
                  a.click();
                }}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/15 hover:bg-white/25 text-[10px] transition-colors"
                title="下载 PNG"
              >
                <Download size={10} />
                下载
              </button>
              <button
                onClick={handleClosePreview}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/15 hover:bg-white/25 text-[10px] transition-colors"
                title="关闭 (ESC)"
              >
                <X size={10} />
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageDnaPanel;
