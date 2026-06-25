import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Sparkles,
  Upload,
  Image as ImageIcon,
  Wand2,
  RotateCcw,
  X,
  Loader2,
  Download,
  Palette,
  Loader,
  Heart,
  Video,
  History,
  Plus,
  Grid,
  Grid3x3,
} from 'lucide-react';
import { GirlfriendSelector } from '../components/GirlfriendSelector';
import { generateImage, editImage, girlfriendToFile, type GptImageQuality, type GptImageSize, type GptImageResult } from '../services/gptImage2Api';
import { expandPrompt, generateGridStoryboard, type GridPanel } from '../services/promptApi';
import { saveGeneratedImages, toggleFavorite } from '../services/gptImage2HistoryService';
import { getFavorites } from '../services/storage';
import type { GirlfriendPreset } from '../data/girlfriendPresets';
import { downloadImage, fetchImageAsDataUrl } from '../services/runninghub';

interface GPTImage2PageProps {
  yunwuKey: string | null;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  historyRefreshKey?: number;
  onGenerate?: () => void;
  onNavigate?: (tab: 'txt2img' | 'img2img' | 'img2vid' | 'aiprompt' | 'history') => void;
}

type SubMode = 'txt2img' | 'edit';

interface EditImageEntry {
  file: File;
  preview: string;
  name: string;
}

const QUALITY_OPTIONS: { value: GptImageQuality; label: string; desc: string }[] = [
  { value: 'low', label: '快速', desc: '草稿预览' },
  { value: 'medium', label: '标准', desc: '平衡速度与质量' },
  { value: 'high', label: '高清', desc: '最高质量' },
];

const SIZE_OPTIONS: { value: GptImageSize; label: string; ratio: string; tier: '1k' | '2k' | 'auto' }[] = [
  { value: '1024x1024', label: '1:1', ratio: '正方形', tier: '1k' },
  { value: '1536x1024', label: '3:2', ratio: '横版 3:2', tier: '1k' },
  { value: '1024x1536', label: '2:3', ratio: '竖版 2:3', tier: '1k' },
  { value: '1536x864', label: '16:9', ratio: '横版 16:9', tier: '1k' },
  { value: '1024x768', label: '4:3', ratio: '横版 4:3', tier: '1k' },
  { value: '864x1536', label: '9:16', ratio: '竖版 9:16', tier: '1k' },
  { value: '768x1024', label: '3:4', ratio: '竖版 3:4', tier: '1k' },
  { value: '2048x1152', label: '16:9', ratio: '横版 16:9', tier: '2k' },
  { value: '2048x1536', label: '4:3', ratio: '横版 4:3', tier: '2k' },
  { value: '1152x2048', label: '9:16', ratio: '竖版 9:16', tier: '2k' },
  { value: '1536x2048', label: '3:4', ratio: '竖版 3:4', tier: '2k' },
  { value: 'auto', label: '自动', ratio: '由模型决定', tier: 'auto' },
];

const STYLE_PRESETS = [
  'photorealistic',
  'anime',
  'digital art',
  'oil painting',
  'watercolor',
  '3d render',
  'concept art',
  'cinematic',
];

const MAX_EDIT_IMAGES = 16;

const GRID_COMPOSITE_SIZE = 864; // 9:16 portrait — 864px wide x 1536px tall (1K)

function buildCompositePrompt(panels: GridPanel[]): string {
  if (panels.length === 0) return '';
  const panelDescs = panels
    .sort((a, b) => a.panel_number - b.panel_number)
    .map(
      (p) =>
        `Cell ${p.panel_number}: ${p.image_prompt.trim()}`
    )
    .join(' | ');
  return (
    `A 3x3 storyboard grid. Nine panels arranged in reading order (left-to-right, top-to-bottom). ` +
    `Each cell is a distinct moment of the same story, sharing the same subject and setting. ` +
    `Clean white or dark grid lines between cells. Cinematic composition, ultra-detailed. ` +
    `${panelDescs}.`
  );
}

async function compositeGridImage(
  panelImageUrls: (string | null)[],
  gridPanels: GridPanel[]
): Promise<string> {
  // 9:16 portrait — cell width = GRID_COMPOSITE_SIZE/3, cell height = 4/3 of that
  const CELL = GRID_COMPOSITE_SIZE / 3;
  const ROW_H = (CELL * 4) / 3;
  const WIDTH = GRID_COMPOSITE_SIZE;
  const HEIGHT = ROW_H * 3;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d')!;

  // Dark background
  ctx.fillStyle = '#111827';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Draw each cell
  const sortedPanels = [...gridPanels].sort(
    (a, b) => a.panel_number - b.panel_number
  );

  const loadImage = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

  await Promise.all(
    sortedPanels.map(async (panel) => {
      const idx = panel.panel_number - 1;
      const col = idx % 3;
      const row = Math.floor(idx / 3);
      const x = col * CELL;
      const y = row * ROW_H;
      const url = panelImageUrls[idx];

      if (!url) {
        // Placeholder with panel number + scene description
        const hue = ((panel.panel_number - 1) * 40 + 200) % 360;
        ctx.fillStyle = `hsl(${hue}, 40%, 20%)`;
        ctx.fillRect(x, y, CELL, ROW_H);
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(x, y, CELL, ROW_H);

        // Panel number
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = `bold ${Math.floor(ROW_H * 0.2)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(panel.panel_number), x + CELL / 2, y + ROW_H / 2 - 12);

        // Scene description (2 lines)
        ctx.font = `${Math.floor(ROW_H * 0.06)}px sans-serif`;
        const words = panel.scene_description;
        if (words.length > 8) {
          ctx.fillText(words.slice(0, 8), x + CELL / 2, y + ROW_H / 2 + 10);
          ctx.fillText(words.slice(8, 16), x + CELL / 2, y + ROW_H / 2 + 26);
        } else {
          ctx.fillText(words, x + CELL / 2, y + ROW_H / 2 + 10);
        }
        return;
      }

      try {
        const img = await loadImage(url);
        ctx.drawImage(img, x, y, CELL, ROW_H);
      } catch {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(x, y, CELL, ROW_H);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = `bold ${Math.floor(ROW_H * 0.15)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(panel.panel_number), x + CELL / 2, y + ROW_H / 2);
      }
    })
  );

  return canvas.toDataURL('image/png');
}

export function GPTImage2Page({ yunwuKey, onError, onSuccess, historyRefreshKey, onGenerate, onNavigate }: GPTImage2PageProps) {
  const [mode, setMode] = useState<SubMode>('txt2img');

  // ── Shared params ─────────────────────────────────────────────────────────
  const [prompt, setPrompt] = useState('');
  const [quality, setQuality] = useState<GptImageQuality>('medium');
  const [size, setSize] = useState<GptImageSize>('1024x1024');
  const [n, setN] = useState(1);
  const [style, setStyle] = useState('');

  // ── Edit image (supports up to 16) ──────────────────────────────────────
  const [editImageEntries, setEditImageEntries] = useState<EditImageEntry[]>([]);
  const [maskFile, setMaskFile] = useState<File | null>(null);
  const [maskPreview, setMaskPreview] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const maskInputRef = useRef<HTMLInputElement>(null);

  // ── Girlfriend ───────────────────────────────────────────────────────────
  const [selectedGirlfriend, setSelectedGirlfriend] = useState<GirlfriendPreset | null>(null);
  const [gfImageFile, setGfImageFile] = useState<File | null>(null);

  // ── Smart expand ──────────────────────────────────────────────────────────
  const [isExpanding, setIsExpanding] = useState(false);

  // ── Grid storyboard ──────────────────────────────────────────────────────
  const [isGeneratingGrid, setIsGeneratingGrid] = useState(false);
  /** 9 个分镜的文字提示词（来自 LLM） */
  const [gridPanels, setGridPanels] = useState<GridPanel[]>([]);
  /** 合成的九宫格图片列表（支持多张） */
  const [gridImages, setGridImages] = useState<string[]>([]);
  /** 当前选中的九宫格下标 */
  const [selectedGridIndex, setSelectedGridIndex] = useState(0);
  /** 生成九宫格合成图时的 loading（对应下标） */
  const [isGeneratingGridImage, setIsGeneratingGridImage] = useState(false);
  /** 当前选中的分镜编号（用于生成单张） */
  const [selectedPanelNum, setSelectedPanelNum] = useState<number | null>(null);
  /** 每个分镜对应的生成图片 URL：Record<gridIdx, Record<panelNum, url>> */
  const [gridPanelsMap, setGridPanelsMap] = useState<Record<number, Record<number, string>>>({});
  /** 正在生成分镜图的分镜编号 */
  const [generatingPanelNums, setGeneratingPanelNums] = useState<Set<number>>(new Set());

  // ── Results ───────────────────────────────────────────────────────────────
  const [results, setResults] = useState<GptImageResult[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  // ── Restore from history "重新生成" ─────────────────────────────────────
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('gpt2_regenerate');
      if (!raw) return;
      const params = JSON.parse(raw) as {
        prompt: string;
        style: string;
        size: string;
        quality: string;
        n: number;
        mode: 'txt2img' | 'edit';
      };
      setPrompt(params.prompt || '');
      setStyle(params.style || '');
      setSize((params.size || '1024x1024') as GptImageSize);
      setQuality((params.quality || 'medium') as GptImageQuality);
      setN(params.n || 1);
      setMode(params.mode || 'txt2img');
      sessionStorage.removeItem('gpt2_regenerate');
    } catch {
      // ignore corrupt data
    }
  }, []);

  // ── Lightbox ─────────────────────────────────────────────────────────────
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [favorites, setFavorites] = useState(() => getFavorites());

  const successImages = results.filter((r) => !r.error && r.url);

  const handleFavoriteToggle = useCallback((url: string, recordPrompt?: string) => {
    toggleFavorite(url, recordPrompt ?? prompt);
    setFavorites(getFavorites());
  }, [prompt]);

  const openLightbox = (idx: number) => setLightboxIdx(idx);
  const closeLightbox = () => setLightboxIdx(null);

  // ── Jump to img2vid with the selected image ─────────────────────────────────
  const handleGenerateVideoFromImage = (url: string) => {
    if (!onNavigate) return;
    try {
      sessionStorage.setItem('history_img2vid', JSON.stringify({ imageUrl: url }));
    } catch {}
    onNavigate('img2vid');
  };

  // ── Edit image handlers ─────────────────────────────────────────────────
  const handleEditImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const remaining = MAX_EDIT_IMAGES - editImageEntries.length;
    const toAdd = files.slice(0, remaining);

    const newEntries: EditImageEntry[] = toAdd.map((file, i) => ({
      file,
      preview: URL.createObjectURL(file),
      name: `图${editImageEntries.length + i + 1}`,
    }));

    setEditImageEntries((prev) => {
      const updated = [...prev, ...newEntries];
      return updated.map((entry, idx) => ({ ...entry, name: `图${idx + 1}` }));
    });

    const count = toAdd.length;
    const startIdx = editImageEntries.length + 1;
    const newAnchors = Array.from({ length: count }, (_, i) => `@图${startIdx + i}`).join(' ');
    setPrompt((prev) => {
      if (prev.includes(newAnchors.trim())) return prev;
      return prev.trim() ? `${prev.trim()} ${newAnchors}` : newAnchors;
    });
  }, [editImageEntries.length]);

  const handleRemoveEditImage = useCallback((idx: number) => {
    setEditImageEntries((prev) => {
      const removedEntry = prev[idx];
      const updated = prev.filter((_, i) => i !== idx);
      const renamed = updated.map((entry, i) => ({ ...entry, name: `图${i + 1}` }));
      if (removedEntry) {
        const anchor = `@${removedEntry.name}`;
        setPrompt((p) => p.replace(new RegExp(`\\s*${anchor.replace(/[图]/g, (c) => (c === '图' ? '图' : '\\' + c))}`, 'g'), '').trim());
      }
      return renamed;
    });
  }, []);

  const handleMaskChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMaskFile(file);
    setMaskPreview(URL.createObjectURL(file));
  }, []);

  // ── Girlfriend handlers ──────────────────────────────────────────────────
  const handleGirlfriendSelect = useCallback(async (gf: GirlfriendPreset) => {
    setSelectedGirlfriend(gf);
    try {
      const file = await girlfriendToFile(gf);
      setGfImageFile(file);
      onSuccess(`已选择「${gf.nameZh || gf.name}」作为参考角色`);
    } catch {
      onError('加载女友图片失败');
    }
    setPrompt((prev) => {
      const anchor = `@数字人:${gf.nameZh || gf.name}`;
      if (prev.includes(anchor)) return prev;
      return prev.trim() ? `${prev.trim()} ${anchor}` : anchor;
    });
  }, [onSuccess, onError]);

  const handleGirlfriendDeselect = useCallback(() => {
    setSelectedGirlfriend(null);
    setGfImageFile(null);
    setPrompt((p) => {
      return p.replace(/\s*@数字人:[^\s\[\]]+/g, '').trim();
    });
  }, []);

  // ── Auto-append @ anchors when images / girlfriend change ───────────────
  const buildAnchor = useCallback((): string => {
    const anchors: string[] = [];
    if (selectedGirlfriend) {
      anchors.push(`@数字人:${selectedGirlfriend.nameZh || selectedGirlfriend.name}`);
    }
    if (editImageEntries.length > 0) {
      anchors.push(...editImageEntries.map((e) => `@${e.name}`));
    }
    return anchors.length > 0 ? ` [${anchors.join(' ')}]` : '';
  }, [selectedGirlfriend, editImageEntries]);

  const syncPromptAnchors = useCallback((newPrompt: string) => {
    const anchor = buildAnchor();
    const stripped = newPrompt.replace(/\s*\[[\s\S]*?@[\s\S]*?\]/g, '').trim();
    return stripped + anchor;
  }, [buildAnchor]);

  // ── Smart expand ──────────────────────────────────────────────────────────
  const handleExpand = useCallback(async () => {
    if (!prompt.trim()) {
      onError('请先输入提示词内容');
      return;
    }

    setIsExpanding(true);
    try {
      const res = await expandPrompt(
        prompt.trim(),
        'image',
        false,
        1,
        0,
        selectedGirlfriend?.portraitUrl,
        mode === 'edit',
        selectedGirlfriend?.characterPrompt,
      );

      if (res.results.length === 0 || !res.results[0].prompt) {
        onError('智能扩写返回为空，请重试');
        return;
      }

      setPrompt(res.results[0].prompt.trim());
      onSuccess('智能扩写完成');
    } catch (err) {
      console.error('[GPTImage2Page] handleExpand failed:', err);
      onError(err instanceof Error ? err.message : '智能扩写失败');
    } finally {
      setIsExpanding(false);
    }
  }, [prompt, selectedGirlfriend, mode, onError, onSuccess]);

  // ── Grid storyboard ───────────────────────────────────────────────────────
  const handleGenerateGrid = useCallback(async () => {
    if (!prompt.trim()) {
      onError('请先输入提示词内容');
      return;
    }
    if (!yunwuKey) {
      onError('请先在设置中配置 Yunwu AI API Key');
      return;
    }

    // 1) 生成 9 个分镜提示词（LLM）
    setIsGeneratingGrid(true);
    setGridPanels([]);
    setGridImages([]);
    setSelectedGridIndex(0);
    setGridPanelsMap({});
    setSelectedPanelNum(null);

    let panels: GridPanel[] = [];
    try {
      const res = await generateGridStoryboard(prompt.trim(), false);
      if (!res.grid || res.grid.length === 0) {
        onError('九宫格分镜生成返回为空，请重试');
        return;
      }
      panels = res.grid;
      setGridPanels(panels);

      // 用合成提示词填充编辑框，方便用户看到生成九宫格图的完整提示词
      const compositePrompt = buildCompositePrompt(panels);
      setPrompt(compositePrompt);
      onSuccess('九宫格分镜生成完成，请手动点击「生成九宫格图」按钮合成预览图');
    } catch (err) {
      console.error('[GPTImage2Page] handleGenerateGrid failed:', err);
      onError(err instanceof Error ? err.message : '九宫格分镜生成失败');
    } finally {
      setIsGeneratingGrid(false);
    }
  }, [prompt, yunwuKey, onError, onSuccess]);

  // ── Generate composite grid image ────────────────────────────────────────
  const handleGenerateCompositeGrid = useCallback(async () => {
    if (!yunwuKey) {
      onError('请先在设置中配置 Yunwu AI API Key');
      return;
    }
    if (gridPanels.length === 0) {
      onError('请先生成分镜提示词');
      return;
    }

    setIsGeneratingGridImage(true);
    try {
      const compositePrompt = buildCompositePrompt(gridPanels);
      const imgs = await generateImage(yunwuKey, compositePrompt, {
        n: 1,
        size: '1024x1792',
        quality: 'medium',
      });

      if (imgs.length > 0 && imgs[0].url) {
        const dataUrl = await fetchImageAsDataUrl(imgs[0].url);
        const finalUrl = dataUrl || imgs[0].url;
        const newIdx = gridImages.length;
        setGridImages(prev => [...prev, finalUrl]);
        setSelectedGridIndex(newIdx);
        onSuccess('九宫格合成图生成完成');
        // 保存到历史记录
        await saveGeneratedImages([finalUrl], buildCompositePrompt(gridPanels), '', '1024x1792', 'medium', 1, 'txt2img');
        onGenerate?.();
      } else {
        onError('九宫格合成图生成失败');
      }
    } catch (err) {
      console.error('[GPTImage2Page] handleGenerateCompositeGrid failed:', err);
      onError(err instanceof Error ? err.message : '九宫格合成图生成失败');
    } finally {
      setIsGeneratingGridImage(false);
    }
  }, [yunwuKey, gridPanels, gridImages, buildCompositePrompt, onError, onSuccess]);

  // ── Single panel: apply prompt + select ───────────────────────────────
  const handleSelectPanel = useCallback((panel: GridPanel) => {
    setPrompt(panel.image_prompt.trim());
    setSelectedPanelNum(panel.panel_number);
    onSuccess(`已填入第 ${panel.panel_number} 格提示词`);
  }, [onSuccess]);

  // ── Crop panel from composite grid image ─────────────────────────────────
  const cropPanelFromGrid = useCallback(async (panelNum: number): Promise<string | null> => {
    const currentUrl = gridImages[selectedGridIndex];
    if (!currentUrl) return null;
    
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        // 9:16 portrait composite: 3 columns, cell width = img.width/3; 3 rows, cell height = img.height/3
        const cellW = img.width / 3;
        const cellH = img.height / 3;
        const col = (panelNum - 1) % 3;
        const row = Math.floor((panelNum - 1) / 3);
        canvas.width = cellW;
        canvas.height = cellH;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, col * cellW, row * cellH, cellW, cellH, 0, 0, cellW, cellH);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(null);
      img.src = currentUrl;
    });
  }, [gridImages, selectedGridIndex]);

  // ── Generate single panel image (parallel-safe) ───────────────────────────
  const handleGeneratePanelImage = useCallback(async (panel: GridPanel) => {
    if (!yunwuKey) {
      onError('请先在设置中配置 Yunwu AI API Key');
      return;
    }

    const panelNum = panel.panel_number;

    // Parallel guard: skip if this panel is already generating
    if (generatingPanelNums.has(panelNum)) return;

    setGeneratingPanelNums(prev => new Set([...prev, panelNum]));
    setSelectedPanelNum(panelNum);
    setPrompt(panel.image_prompt.trim());

    try {
      const croppedPanel = await cropPanelFromGrid(panelNum);
      let finalUrl: string;

      if (croppedPanel) {
        const blob = await (await fetch(croppedPanel)).blob();
        const file = new File([blob], `panel-${panelNum}.png`, { type: 'image/png' });
        const imgs = await editImage(yunwuKey, panel.image_prompt.trim(), file, {
          n: 1,
          size: '1024x1792',
          quality: 'medium',
        });
        if (!imgs.length || !imgs[0].url) {
          throw new Error(`第 ${panelNum} 格图片放大失败，请稍后重试`);
        }
        finalUrl = imgs[0].url;
        await saveGeneratedImages([finalUrl], panel.image_prompt, '', '1024x1792', 'medium', 1, 'edit');
        onSuccess(`第 ${panelNum} 格图片高清放大完成`);
      } else {
        const imgs = await generateImage(yunwuKey, panel.image_prompt.trim(), {
          n: 1,
          size: '1024x1792',
          quality: 'medium',
        });
        if (!imgs.length || !imgs[0].url) {
          throw new Error(`第 ${panelNum} 格图片生成失败`);
        }
        finalUrl = imgs[0].url;
        await saveGeneratedImages([finalUrl], panel.image_prompt, '', '1024x1792', 'medium', 1, 'txt2img');
        onSuccess(`第 ${panelNum} 格图片生成完成`);
      }

      const dataUrl = await fetchImageAsDataUrl(finalUrl);
      const resolvedUrl = dataUrl || finalUrl;
      const currentPanelImages = gridPanelsMap[selectedGridIndex] ?? {};
      setGridPanelsMap(prev => ({
        ...prev,
        [selectedGridIndex]: { ...currentPanelImages, [panelNum]: resolvedUrl },
      }));
      setResults(prev => [...prev, { url: resolvedUrl, error: false, revised_prompt: null }]);
      onGenerate?.();

    } catch (err) {
      console.error('[GPTImage2Page] handleGeneratePanelImage failed:', err);
      onError(err instanceof Error ? err.message : '分镜图生成失败');
    } finally {
      setGeneratingPanelNums(prev => {
        const next = new Set(prev);
        next.delete(panelNum);
        return next;
      });
    }
  }, [yunwuKey, gridPanelsMap, gridPanels, gridImages, selectedGridIndex, generatingPanelNums, onError, onSuccess, cropPanelFromGrid]);

  const handleCloseGrid = () => {
    setGridImages([]);
    setSelectedGridIndex(0);
    setGridPanelsMap({});
    setSelectedPanelNum(null);
  };

  // ── Import a single generated image into the 9-grid view ──────────────────
  const handleImportToGrid = useCallback(async (imageUrl: string) => {
    try {
      const dataUrl = await fetchImageAsDataUrl(imageUrl);
      const finalUrl = dataUrl || imageUrl;
      const newIdx = gridImages.length;
      setGridImages(prev => [...prev, finalUrl]);
      setSelectedGridIndex(newIdx);
      onSuccess(`已导入第 ${newIdx + 1} 张到九宫格`);
    } catch (err) {
      onError('导入九宫格失败');
    }
  }, [gridImages, onSuccess, onError]);

  const buildPrompt = useCallback((): string => {
    const parts: string[] = [prompt.trim()];
    if (style) {
      parts.push(style);
    }
    if (selectedGirlfriend?.characterPrompt) {
      parts.push(selectedGirlfriend.characterPrompt);
    }
    return parts.join(', ');
  }, [prompt, style, selectedGirlfriend]);

  const handleGenerate = useCallback(async () => {
    const finalPrompt = buildPrompt();
    if (!finalPrompt) {
      onError('请输入提示词');
      return;
    }
    if (!yunwuKey) {
      onError('请先在设置中配置 Yunwu AI API Key');
      return;
    }

    setIsGenerating(true);
    setResults([]);

    try {
      if (mode === 'txt2img') {
        const imgs = await generateImage(yunwuKey, finalPrompt, { n, size, quality });
        setResults(imgs);
        if (imgs.length > 0) {
          onSuccess(`生成成功，获得 ${imgs.length} 张图片`);
          const permanentDataUrls = await Promise.all(
            imgs.filter((i) => i.url).map((i) => fetchImageAsDataUrl(i.url))
          );
          const validUrls = permanentDataUrls.filter((u): u is string => Boolean(u));
          await saveGeneratedImages(validUrls, finalPrompt, style, size, quality, n, 'txt2img');
          onGenerate?.();
        }
      } else {
        const imageFiles: File[] = [];
        if (gfImageFile) imageFiles.push(gfImageFile);
        for (const entry of editImageEntries) {
          imageFiles.push(entry.file);
        }
        if (imageFiles.length === 0) {
          onError('请上传要编辑的图片，或选择一个数字人女友作为参考');
          setIsGenerating(false);
          return;
        }
        const imgs = await editImage(yunwuKey, finalPrompt, imageFiles, {
          n,
          size,
          quality,
          maskFile: maskFile || undefined,
        });
        setResults(imgs);
        if (imgs.length > 0) {
          onSuccess(`编辑成功，获得 ${imgs.length} 张图片`);
          const permanentDataUrls = await Promise.all(
            imgs.filter((i) => i.url).map((i) => fetchImageAsDataUrl(i.url))
          );
          const validUrls = permanentDataUrls.filter((u): u is string => Boolean(u));
          await saveGeneratedImages(validUrls, finalPrompt, style, size, quality, n, 'edit');
          onGenerate?.();
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成失败';
      setResults([{ url: '', error: msg }]);
      onError(msg);
    } finally {
      setIsGenerating(false);
    }
  }, [mode, yunwuKey, buildPrompt, n, size, quality, style, gfImageFile, editImageEntries, maskFile, onError, onSuccess, onGenerate]);

  const handleReset = () => {
    setPrompt('');
    setEditImageEntries([]);
    setMaskFile(null);
    setMaskPreview('');
    setSelectedGirlfriend(null);
    setGfImageFile(null);
    setResults([]);
  };

  const handleDownload = (url: string, idx: number) => {
    const ext = url.startsWith('data:') ? 'png' : 'jpg';
    downloadImage(url, `gpt-image-2-${Date.now()}-${idx + 1}.${ext}`);
  };

  const activeAnchors = buildAnchor();
  const hasImages = editImageEntries.length > 0 || selectedGirlfriend !== null;

  // Helper: get panel thumbnail from composite grid image (synchronous crop on paint)
  // Returns null if no composite image is available
  const getPanelThumb = useCallback((panel: GridPanel): string | null => {
    const currentUrl = gridImages[selectedGridIndex];
    if (!currentUrl) return null;
    return `_crop_panel_${panel.panel_number}`;
  }, [gridImages, selectedGridIndex]);

  return (
    <div className="space-y-4">
      {/* ── Mode tabs ── */}
      <div className="flex items-center gap-1 p-1 bg-bg-elevated rounded-xl border border-border">
        <button
          onClick={() => setMode('txt2img')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
            mode === 'txt2img'
              ? 'bg-white text-primary shadow-sm'
              : 'text-text-tertiary hover:text-text-primary'
          }`}
        >
          <Wand2 size={14} />
          文生图
        </button>
        <button
          onClick={() => setMode('edit')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
            mode === 'edit'
              ? 'bg-white text-primary shadow-sm'
              : 'text-text-tertiary hover:text-text-primary'
          }`}
        >
          <Palette size={14} />
          图片编辑
        </button>
      </div>

      {/* ── Prompt area ── */}
      <div className="rounded-xl bg-white border border-border overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-bg-elevated flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={12} className="text-primary" />
            <span className="text-xs font-medium text-text-primary">提示词</span>
            {mode === 'edit' && hasImages && (
              <span className="text-[10px] text-text-tertiary">（提示词中的 @图1 等锚定了参考图）</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {style && (
              <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium">
                {style}
              </span>
            )}
            {selectedGirlfriend && (
              <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 text-[10px] font-medium">
                {selectedGirlfriend.nameZh || selectedGirlfriend.name}
              </span>
            )}
            <button
              onClick={handleExpand}
              disabled={isExpanding || !prompt.trim()}
              title="智能扩写：先用 grok-4.3，失败自动用 grok-4-1-fast"
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                isExpanding || !prompt.trim()
                  ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                  : 'bg-gradient-to-r from-primary to-pink-500 text-white hover:opacity-90 active:scale-[0.97]'
              }`}
            >
              {isExpanding ? (
                <>
                  <Loader size={11} className="animate-spin" />
                  扩写中...
                </>
              ) : (
                <>
                  <Wand2 size={11} />
                  智能扩写
                </>
              )}
            </button>
            <button
              onClick={handleGenerateGrid}
              disabled={isGeneratingGrid || !prompt.trim()}
              title="九宫格分镜：基于提示词生成9个连贯的分镜画面"
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                isGeneratingGrid || !prompt.trim()
                  ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                  : 'bg-blue-500 text-white hover:bg-blue-600 active:scale-[0.97]'
              }`}
            >
              {isGeneratingGrid ? (
                <>
                  <Loader size={11} className="animate-spin" />
                  生成分镜...
                </>
              ) : (
                <>
                  <Grid size={11} />
                  九宫格
                </>
              )}
            </button>
          </div>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={mode === 'txt2img'
            ? '描述你想生成的图片内容...'
            : '描述你想对图片做的修改...（配合 @图1 @图2 等锚定参考图）'}
          rows={4}
          className="w-full px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary resize-none focus:outline-none"
        />
        {/* Active anchors bar */}
        {activeAnchors && (
          <div className="px-4 pb-2.5 flex flex-wrap gap-1.5">
            {selectedGirlfriend && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-400 text-[10px] font-medium">
                <span className="text-red-400">@</span>
                数字人:{selectedGirlfriend.nameZh || selectedGirlfriend.name}
                <button
                  onClick={handleGirlfriendDeselect}
                  className="ml-0.5 hover:text-red-600"
                >
                  <X size={8} />
                </button>
              </span>
            )}
            {editImageEntries.map((entry, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-400 text-[10px] font-medium"
              >
                <span className="text-blue-400">@</span>
                {entry.name}
                <button
                  onClick={() => handleRemoveEditImage(idx)}
                  className="ml-0.5 hover:text-blue-600"
                >
                  <X size={8} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Edit image (edit mode) ── */}
      {mode === 'edit' && (
        <div className="rounded-xl bg-white border border-border overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-bg-elevated">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ImageIcon size={12} className="text-text-tertiary" />
                <span className="text-xs font-medium text-text-primary">参考图片</span>
                <span className="text-[10px] text-text-tertiary">最多 {MAX_EDIT_IMAGES} 张</span>
              </div>
              <div className="flex items-center gap-2">
                {editImageEntries.length > 0 && (
                  <span className="text-[10px] text-text-tertiary">{editImageEntries.length} / {MAX_EDIT_IMAGES}</span>
                )}
                <label
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium cursor-pointer transition-all ${
                    editImageEntries.length >= MAX_EDIT_IMAGES
                      ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                      : 'bg-primary text-white hover:opacity-90 active:scale-95'
                  }`}
                >
                  <Plus size={10} />
                  <span>添加图片</span>
                  <input
                    ref={editInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleEditImageChange}
                    disabled={editImageEntries.length >= MAX_EDIT_IMAGES}
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Images grid */}
          {editImageEntries.length > 0 ? (
            <div className="p-4">
              <div className="grid grid-cols-4 gap-3">
                {editImageEntries.map((entry, idx) => (
                  <div key={idx} className="relative rounded-xl overflow-hidden border border-border bg-bg-elevated group">
                    <img
                      src={entry.preview}
                      alt={entry.name}
                      className="w-full object-cover"
                      style={{ aspectRatio: '1', height: 80 }}
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1.5">
                      <span className="text-white text-[10px] font-medium">{entry.name}</span>
                    </div>
                    <button
                      onClick={() => handleRemoveEditImage(idx)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-black/70 transition-all"
                    >
                      <X size={10} className="text-white" />
                    </button>
                    <div className="absolute top-1 left-1 w-4 h-4 rounded-full bg-black/50 flex items-center justify-center">
                      <span className="text-white text-[9px] font-bold">{idx + 1}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-4 flex flex-col items-center justify-center">
              <label className="flex flex-col items-center justify-center gap-2 py-8 w-full rounded-xl border-2 border-dashed border-border hover:border-primary transition-colors cursor-pointer">
                <Upload size={20} className="text-text-tertiary" />
                <span className="text-xs text-text-tertiary">点击添加参考图片（最多 {MAX_EDIT_IMAGES} 张）</span>
                <span className="text-[10px] text-text-tertiary/60">支持 JPG / PNG / WEBP</span>
                <input
                  ref={editInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleEditImageChange}
                />
              </label>
            </div>
          )}

          {/* Mask upload */}
          <div className="px-4 pb-4">
            {maskPreview ? (
              <div className="relative rounded-xl overflow-hidden border border-border">
                <img src={maskPreview} alt="蒙版" className="w-full object-contain max-h-32 opacity-70" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="px-2 py-1 rounded-lg bg-black/50 text-white text-[10px] font-medium">蒙版</span>
                </div>
                <button
                  onClick={() => { setMaskFile(null); setMaskPreview(''); }}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70"
                >
                  <X size={10} className="text-white" />
                </button>
              </div>
            ) : (
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:border-primary transition-colors cursor-pointer">
                <input
                  ref={maskInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleMaskChange}
                />
                <span className="text-[10px] text-text-tertiary">+ 添加蒙版（可选，用于局部重绘）</span>
              </label>
            )}
          </div>
        </div>
      )}

      {/* ── Girlfriend selector ── */}
      <GirlfriendSelector
        selectedId={selectedGirlfriend ? (selectedGirlfriend.isCustom ? `custom_${selectedGirlfriend.id}` : selectedGirlfriend.id) : null}
        onSelect={handleGirlfriendSelect}
      />

      {/* ── Style presets ── */}
      <div className="rounded-xl bg-white border border-border overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-bg-elevated">
          <div className="flex items-center gap-2">
            <Palette size={12} className="text-text-tertiary" />
            <span className="text-xs font-medium text-text-primary">风格预设（可选）</span>
          </div>
        </div>
        <div className="p-3 flex flex-wrap gap-2">
          <button
            onClick={() => setStyle('')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              !style
                ? 'bg-primary text-white'
                : 'bg-bg-elevated text-text-tertiary hover:text-text-primary'
            }`}
          >
            无
          </button>
          {STYLE_PRESETS.map((s) => (
            <button
              key={s}
              onClick={() => setStyle(s === style ? '' : s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                s === style
                  ? 'bg-primary text-white'
                  : 'bg-bg-elevated text-text-tertiary hover:text-text-primary'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* ── Params row ── */}
      <div className="flex items-stretch gap-3">
        {/* Quality */}
        <div className="flex-1 rounded-xl bg-white border border-border overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-bg-elevated">
            <span className="text-[10px] font-medium text-text-primary">质量</span>
          </div>
          <div className="p-2 space-y-1">
            {QUALITY_OPTIONS.map((q) => (
              <button
                key={q.value}
                onClick={() => setQuality(q.value)}
                className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-all ${
                  quality === q.value
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-text-tertiary hover:bg-bg-elevated'
                }`}
              >
                <span>{q.label}</span>
                <span className="text-[10px] opacity-60">{q.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Size */}
        <div className="flex-1 rounded-xl bg-white border border-border overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-bg-elevated">
            <span className="text-[10px] font-medium text-text-primary">尺寸</span>
          </div>
          <div className="p-2 grid grid-cols-4 gap-1">
            {SIZE_OPTIONS.map((s) => (
              <button
                key={s.value}
                onClick={() => setSize(s.value)}
                className={`flex flex-col items-center justify-center px-1 py-1.5 rounded-lg text-[10px] transition-all leading-tight ${
                  size === s.value
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-text-tertiary hover:bg-bg-elevated'
                }`}
              >
                <span>{s.label}</span>
                <span className={`text-[9px] ${s.tier === '2k' ? 'text-orange-400' : 'opacity-50'}`}>
                  {s.tier === '2k' ? '2K' : s.ratio}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Count */}
        <div className="flex-1 rounded-xl bg-white border border-border overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-bg-elevated flex items-center justify-between">
            <span className="text-[10px] font-medium text-text-primary">数量</span>
            {onNavigate && (
              <button
                onClick={() => onNavigate('history')}
                className="flex items-center gap-1 text-[10px] text-text-tertiary hover:text-primary transition-colors"
                title="查看历史记录"
              >
                <History size={10} />
                历史
              </button>
            )}
          </div>
          <div className="p-2 flex items-center justify-center gap-3">
            <button
              onClick={() => setN((v) => Math.max(1, v - 1))}
              disabled={n <= 1}
              className="w-7 h-7 rounded-lg bg-bg-elevated text-text-secondary hover:bg-border disabled:opacity-30 transition-colors flex items-center justify-center"
            >
              <span className="text-sm">−</span>
            </button>
            <span className="text-sm font-semibold text-text-primary w-4 text-center">{n}</span>
            <button
              onClick={() => setN((v) => Math.min(10, v + 1))}
              disabled={n >= 10}
              className="w-7 h-7 rounded-lg bg-bg-elevated text-text-secondary hover:bg-border disabled:opacity-30 transition-colors flex items-center justify-center"
            >
              <span className="text-sm">+</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Action buttons ── */}
      <div className="flex gap-3">
        <button
          onClick={handleReset}
          className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-medium bg-bg-elevated text-text-tertiary hover:bg-border transition-colors"
        >
          <RotateCcw size={13} />
          重置
        </button>
        <button
          onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim()}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all ${
            isGenerating || !prompt.trim()
              ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
              : 'bg-gradient-to-r from-primary to-pink-500 text-white hover:opacity-90 active:scale-[0.98]'
          }`}
        >
          {isGenerating ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              生成中...
            </>
          ) : (
            <>
              <Sparkles size={15} />
              {mode === 'txt2img' ? '生成图片' : '编辑图片'}
            </>
          )}
        </button>
      </div>

      {/* ── Results ── */}
      {results.length > 0 && (
        <div className="rounded-xl bg-white border border-border overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-bg-elevated flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ImageIcon size={12} className="text-green-500" />
              <span className="text-xs font-medium text-text-primary">生成结果</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-text-tertiary">{successImages.length} 张</span>
              {successImages.length > 0 && (
                <button
                  onClick={() => handleImportToGrid(successImages[0].url)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-blue-50 text-blue-500 hover:bg-blue-100 border border-blue-200 transition-colors"
                  title="将图片导入九宫格分镜视图"
                >
                  <Grid3x3 size={11} />
                  导入九宫格
                </button>
              )}
              {onNavigate && (
                <button
                  onClick={() => onNavigate('history')}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-bg-elevated text-text-secondary hover:text-primary border border-border transition-colors"
                  title="查看历史记录"
                >
                  <History size={11} />
                  历史
                </button>
              )}
            </div>
          </div>
          <div className="p-4">
            {/* 错误卡片 */}
            {results.some((r) => r.error) && (
              <div className="mb-4 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-red-200 bg-red-50 p-5 text-center">
                <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                  <X size={22} className="text-red-400" />
                </div>
                <p className="text-sm font-medium text-red-500 leading-snug">
                  {results.find((r) => r.error)?.error}
                </p>
              </div>
            )}
            {/* 成功图片网格 */}
            {successImages.length > 0 && (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {successImages.map((item, idx) => {
                  const isFav = favorites.some((f) => f.imageUrl === item.url);
                  return (
                    <div
                      key={idx}
                      className="relative flex-shrink-0 rounded-xl overflow-hidden border border-border bg-bg-elevated cursor-pointer group hover:ring-2 hover:ring-primary transition-all"
                      style={{ width: 160, height: 160 }}
                      onClick={() => {
                        const globalIdx = results.filter((r) => r.url && !r.error).findIndex((r) => r.url === item.url);
                        openLightbox(globalIdx);
                      }}
                    >
                      <img
                        src={item.url}
                        alt={`生成结果 ${idx + 1}`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex flex-col items-center justify-center gap-1.5">
                        <ImageIcon size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                        <span className="text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">点击预览</span>
                        {onNavigate && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleGenerateVideoFromImage(item.url); }}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-500 text-white text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity hover:bg-purple-600"
                          >
                            <Video size={10} />生视频
                          </button>
                        )}
                      </div>
                      <div className="absolute top-1.5 right-1.5 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleFavoriteToggle(item.url); }}
                          className="w-7 h-7 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 transition-colors"
                          title="收藏"
                        >
                          <Heart size={13} className={isFav ? 'fill-red-500 text-red-500' : 'text-white'} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDownload(item.url, idx); }}
                          className="w-7 h-7 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 transition-colors"
                          title="下载"
                        >
                          <Download size={13} className="text-white" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Grid Storyboard ── */}
      {gridPanels.length > 0 && (
        <div className="rounded-xl bg-white border border-border overflow-hidden">
          {/* Header */}
          <div className="px-4 py-2.5 border-b border-border bg-bg-elevated flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Grid size={12} className="text-blue-500" />
              <span className="text-xs font-medium text-text-primary">九宫格分镜</span>
              <span className="text-[10px] text-text-tertiary">点击格子生成单张，或直接填入提示词</span>
            </div>
            <button
              onClick={handleCloseGrid}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-bg-elevated text-text-secondary hover:text-text-primary transition-colors"
            >
              <X size={10} />关闭
            </button>
          </div>

          <div className="p-4 space-y-4">
            {/* ── 1. Grid image thumbnails row (shown when multiple grids exist) ── */}
            {gridImages.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] text-text-tertiary font-medium">
                    已生成 {gridImages.length} 张九宫格
                  </span>
                  <button
                    onClick={handleGenerateCompositeGrid}
                    disabled={!yunwuKey || isGeneratingGridImage || gridPanels.length === 0}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-blue-500 hover:text-blue-600 disabled:opacity-40 transition-colors font-medium"
                  >
                    <Plus size={9} />再生成一张
                  </button>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
                  {gridImages.map((url, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedGridIndex(idx)}
                      className={`flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden border-2 transition-all ${
                        selectedGridIndex === idx
                          ? 'border-blue-500 ring-2 ring-blue-300'
                          : 'border-border hover:border-blue-300'
                      }`}
                      title={`第 ${idx + 1} 张`}
                    >
                      <img
                        src={url}
                        alt={`九宫格 ${idx + 1}`}
                        className="w-full h-full object-cover pointer-events-none"
                      />
                    </button>
                  ))}
                  {isGeneratingGridImage && (
                    <div className="flex-shrink-0 w-16 h-16 rounded-xl border-2 border-blue-500 border-dashed flex items-center justify-center bg-gray-100">
                      <Loader size={16} className="animate-spin text-blue-400" />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── 2. Selected grid: composite image + 3x3 interactive cells ── */}
            {gridImages.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-text-tertiary font-medium">
                    第 {selectedGridIndex + 1} 张（点击格子高清放大）
                  </span>
                  <div className="flex items-center gap-1">
                    {(() => {
                      const currentUrl = gridImages[selectedGridIndex];
                      if (!currentUrl) return null;
                      return (
                        <>
                          <button
                            onClick={() => handleDownload(currentUrl, selectedGridIndex + 1)}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-text-secondary hover:text-text-primary transition-colors"
                          >
                            <Download size={10} />下载
                          </button>
                          <button
                            onClick={() => handleFavoriteToggle(currentUrl, prompt)}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-text-secondary hover:text-red-500 transition-colors"
                          >
                            <Heart size={10} />收藏
                          </button>
                          {onNavigate && (
                            <button
                              onClick={() => handleGenerateVideoFromImage(currentUrl)}
                              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-text-secondary hover:text-purple-500 transition-colors"
                            >
                              <Video size={10} />生视频
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Composite image with 3x3 interactive overlay cells */}
                <div
                  className="relative rounded-xl overflow-hidden border border-border bg-gray-100 mx-auto"
                  style={{ aspectRatio: '9/16', maxHeight: 600 }}
                >
                  {(() => {
                    const currentUrl = gridImages[selectedGridIndex];
                    const currentPanels = gridPanelsMap[selectedGridIndex] ?? {};

                    return (
                      <>
                        {/* Base composite image */}
                        {currentUrl && (
                          <img
                            src={currentUrl}
                            alt={`九宫格 ${selectedGridIndex + 1}`}
                            className="absolute inset-0 w-full h-full object-contain"
                            onClick={() => {
                              const idx = results.length;
                              setResults(prev => [...prev, { url: currentUrl, error: false, revised_prompt: null }]);
                              openLightbox(idx);
                            }}
                          />
                        )}

                        {/* 3x3 interactive overlay cells */}
                        <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => {
                            const panel = gridPanels.find((p) => p.panel_number === num);
                            const upscaleUrl = currentPanels[num];
                            const isLoading = generatingPanelNums.has(num);

                            return (
                              <div
                                key={num}
                                className="relative cursor-pointer group"
                                onClick={() => {
                                  if (!isLoading && !upscaleUrl) {
                                    const p = panel ?? {
                                      panel_number: num,
                                      scene_description: `分镜 ${num}`,
                                      image_prompt: prompt.trim() || 'high quality photo',
                                    };
                                    handleGeneratePanelImage(p);
                                  }
                                }}
                              >
                                {/* Upscaled image overlay — always shown once generated */}
                                {upscaleUrl && (
                                  <img
                                    src={upscaleUrl}
                                    alt={`分镜 ${num} 高清`}
                                    className="absolute inset-0 w-full h-full object-cover z-20"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const globalIdx = results.length;
                                      setResults(prev => [...prev, { url: upscaleUrl, error: false, revised_prompt: null }]);
                                      openLightbox(globalIdx);
                                    }}
                                  />
                                )}

                                {/* Loading overlay */}
                                {isLoading && (
                                  <div className="absolute inset-0 z-30 bg-black/60 flex flex-col items-center justify-center">
                                    <Loader size={18} className="animate-spin text-white" />
                                    <span className="text-white text-[9px] mt-1">放大中...</span>
                                  </div>
                                )}

                                {/* Hover / action overlay */}
                                <div className={`absolute inset-0 z-10 bg-black/0 group-hover:bg-black/50 transition-all flex flex-col items-center justify-center ${upscaleUrl ? 'opacity-0 group-hover:opacity-100' : ''}`}>
                                  {upscaleUrl ? (
                                    /* Upscale ready: show preview / video / download */
                                    <div className="flex flex-col items-center gap-1">
                                      <span className="text-white text-[9px] font-medium">✓ 已高清</span>
                                      <div className="flex gap-0.5">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const globalIdx = results.length;
                                            setResults(prev => [...prev, { url: upscaleUrl, error: false, revised_prompt: null }]);
                                            openLightbox(globalIdx);
                                          }}
                                          className="px-1.5 py-0.5 rounded bg-blue-600 text-white text-[9px] hover:bg-blue-700"
                                          title="预览"
                                        >
                                          <ImageIcon size={9} />
                                        </button>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleDownload(upscaleUrl, num); }}
                                          className="px-1.5 py-0.5 rounded bg-green-600 text-white text-[9px] hover:bg-green-700"
                                          title="下载"
                                        >
                                          <Download size={8} />
                                        </button>
                                        {onNavigate && (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); handleGenerateVideoFromImage(upscaleUrl); }}
                                            className="px-1.5 py-0.5 rounded bg-purple-500 text-white text-[9px] hover:bg-purple-600"
                                            title="生视频"
                                          >
                                            <Video size={8} />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  ) : !isLoading ? (
                                    /* No upscale yet: show generate button */
                                    <div className="flex flex-col items-center gap-0.5">
                                      <Sparkles size={14} className="text-white" />
                                      <span className="text-white text-[9px] font-medium">{panel ? '高清放大' : '生成图片'}</span>
                                    </div>
                                  ) : null}
                                </div>

                                {/* Number badge */}
                                <div className={`absolute top-1 left-1 z-30 w-5 h-5 rounded-full flex items-center justify-center ${upscaleUrl ? 'bg-green-600' : isLoading ? 'bg-yellow-500' : 'bg-black/60'}`}>
                                  {isLoading ? (
                                    <Loader size={10} className="animate-spin text-white" />
                                  ) : (
                                    <span className="text-white text-[10px] font-bold">{num}</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* ── 3. Generate first composite grid button ── */}
            {gridImages.length === 0 && !isGeneratingGridImage && gridPanels.length > 0 && (
              <div className="text-center py-6 space-y-3">
                <div className="flex flex-col items-center gap-2">
                  <div className="grid grid-cols-3 gap-1 w-32">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => {
                      const panel = gridPanels.find((p) => p.panel_number === num);
                      return (
                        <div
                          key={num}
                          className="aspect-square rounded-lg flex flex-col items-center justify-center border border-dashed border-border"
                          style={{
                            background: `linear-gradient(135deg, hsl(${(num - 1) * 40 + 200}, 40%, 25%), hsl(${(num - 1) * 40 + 230}, 35%, 18%))`,
                          }}
                        >
                          <span className="text-white/60 text-[10px] font-bold">{num}</span>
                          {panel && (
                            <span className="text-white/30 text-[7px] text-center leading-tight px-0.5 line-clamp-2">
                              {panel.scene_description.slice(0, 15)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <span className="text-[10px] text-text-tertiary">
                    共 {gridPanels.length} 个分镜，点击生成九宫格合成图
                  </span>
                </div>
                <button
                  onClick={handleGenerateCompositeGrid}
                  disabled={!yunwuKey}
                  className="w-full py-2.5 rounded-xl bg-blue-500 text-white text-xs font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
                >
                  <Grid size={14} />
                  生成九宫格合成图
                </button>
              </div>
            )}

            {/* ── 4. Generating first grid ── */}
            {gridImages.length === 0 && isGeneratingGridImage && (
              <div className="text-center py-6 space-y-3">
                <div className="grid grid-cols-3 gap-1 w-32 mx-auto">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                    <div
                      key={num}
                      className="aspect-square rounded-lg bg-gray-200 animate-pulse flex items-center justify-center"
                    >
                      <span className="text-gray-400 text-[10px] font-bold">{num}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-center gap-2 text-text-tertiary text-xs">
                  <Loader size={14} className="animate-spin text-blue-400" />
                  生成九宫格合成图中...
                </div>
              </div>
            )}

            {/* ── 5. Panel list ── */}
            {gridPanels.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[10px] text-text-tertiary font-medium">分镜详情</span>
                {[...gridPanels]
                  .sort((a, b) => a.panel_number - b.panel_number)
                  .map((panel) => {
                    const currentPanels = gridPanelsMap[selectedGridIndex] ?? {};
                    const hasUpscale = panel.panel_number in currentPanels;
                    const isSelected = selectedPanelNum === panel.panel_number;

                    return (
                      <div
                        key={panel.panel_number}
                        className={`flex items-start gap-2 p-2 rounded-lg transition-colors cursor-pointer group ${
                          isSelected
                            ? 'bg-blue-50 border border-blue-200'
                            : 'bg-bg-elevated hover:bg-border/20'
                        }`}
                        onClick={() => handleSelectPanel(panel)}
                      >
                        <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold ${
                          hasUpscale ? 'bg-green-500' : 'bg-blue-500'
                        }`}>
                          {panel.panel_number}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] text-blue-600 font-medium mb-0.5">{panel.scene_description}</p>
                          <p className="text-[10px] text-text-primary leading-snug line-clamp-2">{panel.image_prompt}</p>
                        </div>
                        {hasUpscale && (
                          <span className="text-[9px] text-green-600 font-medium flex-shrink-0">已高清</span>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Lightbox ── */}
      {lightboxIdx !== null && successImages[lightboxIdx] && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex flex-col"
          onClick={closeLightbox}
        >
          <div
            className="flex-shrink-0 flex items-center justify-between px-4 py-3 z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-sm text-white/70">
              {lightboxIdx + 1} / {successImages.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const url = successImages[lightboxIdx].url;
                  handleFavoriteToggle(url);
                }}
                className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
                title="收藏"
              >
                <Heart
                  size={18}
                  className={favorites.some((f) => f.imageUrl === successImages[lightboxIdx].url) ? 'fill-red-500 text-red-500' : 'text-white'}
                />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownload(successImages[lightboxIdx].url, lightboxIdx);
                }}
                className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
                title="下载"
              >
                <Download size={18} className="text-white" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); closeLightbox(); }}
                className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
                title="关闭"
              >
                <X size={18} className="text-white" />
              </button>
            </div>
          </div>

          <div
            className="flex-1 flex items-center justify-center overflow-hidden p-4 pb-16"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={successImages[lightboxIdx].url}
              alt={`图片 ${lightboxIdx + 1}`}
              className="max-w-full max-h-full object-contain"
            />
          </div>

          {lightboxIdx > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIdx((i) => (i ?? 0) - 1); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/40 flex items-center justify-center text-white hover:bg-black/60 transition-colors text-2xl z-10"
              title="上一张"
            >
              ‹
            </button>
          )}

          {lightboxIdx < successImages.length - 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIdx((i) => (i ?? 0) + 1); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/40 flex items-center justify-center text-white hover:bg-black/60 transition-colors text-2xl z-10"
              title="下一张"
            >
              ›
            </button>
          )}
        </div>
      )}
    </div>
  );
}
