import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  LayoutList, Wand2, Loader2, Check, X, Film, Sparkles,
  RotateCcw, Zap, History, Trash2, AlertCircle, ChevronDown,
  ChevronUp, ChevronLeft, ChevronRight, Grid3X3, LayoutGrid,
  BookTemplate, ArrowLeft, Settings,
  Download, Heart, Copy, RefreshCw, ZoomIn, Shuffle, XCircle,
} from 'lucide-react';
import { GridPanelEditor } from './GridPanelEditor';
import { GRID_TEMPLATES, type GridTemplate } from '../data/gridTemplates';
import type { GridPanel, GridHistoryItem } from '../services/storage';
import {
  getGridHistory, addGridHistory, removeGridHistory, clearGridHistory,
  getGridSession, saveGridSession, clearGridSession,
  cacheStoryboardPanelImages, getCachedStoryboardPanelImages,
  addFavorite, removeFavorite, getFavorites, isFavorited as isFavoritedFn,
} from '../services/storage';
import {
  generateStoryboardOutline,
  generateStoryboardThemes, listStoryboardThemes,
  getPromptTaskStatus,
  type StoryboardThemeOption,
  type StoryboardPanel,
} from '../services/promptApi';
import { useFinishedTaskImages } from '../contexts/FinishedTaskImagesContext';
import { MAX_TASKS, type TaskManagerReturn } from '../hooks/useTaskManager';
import type { GirlfriendPreset } from '../data/girlfriendPresets';
import { buildTxt2ImgNodeList } from '../utils/txt2imgNodeBuilder';
import { buildUnifiedTxt2ImgOptions } from '../utils/txt2imgDefaults';
import { withQualityBoost } from '../constants';
import { WORKFLOW, uploadImage } from '../services/runninghub';
import type { TabType } from '../types';

const GRID_LOG_PREFIX = '[GridStoryboardMode]';

type GridStep = 'themes' | 'edit' | 'view';
type GridSize = 4 | 9 | 12;

function formatElapsedTime(startTime?: number): string {
  if (!startTime) return '';
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return `${mins}m${secs}s`;
}

interface GridStoryboardModeProps {
  r18Mode: boolean;
  taskManager: TaskManagerReturn;
  apiKey: string;
  displayLang: 'en' | 'zh';
  digitalHumanMode: boolean;
  selectedGirlfriend: GirlfriendPreset | null;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  onNavigate?: (tab: TabType) => void;
}

/**
 * Random sexy outfit for variety across panels.
 */
const sexyOutfitPool = [
  'sexy lace lingerie',
  'slip satin dress',
  'tight mini skirt with crop top',
  'V-neck silk blouse',
  'leather mini dress',
  'off-shoulder bodysuit',
  'sheer mesh top',
  'wrap dress with deep neckline',
  'corset with garter belt',
  'backless halter top',
  'bodycon dress',
  'plunging neckline top',
];

/**
 * Build a single grid storyboard prompt from individual panels.
 * Automatically adds sexy clothing descriptions to the base prompt.
 * Ensures character consistency and camera angle variety across panels.
 */
// Camera angles and shot types for variety
const cameraAngles = [
  'medium shot', 'close-up shot', 'wide shot', 'low angle shot',
  'high angle shot', 'over-the-shoulder shot', 'side profile shot',
  'Dutch angle shot', 'tracking shot', 'POV shot', 'establishing shot',
  'bird eye view', 'worm eye view', 'three-quarter view',
];

const shotTypes = [
  'front view', 'back view', 'side view', 'three-quarter rear view',
  'profile view', 'dramatic angle', 'dynamic angle', 'intimate framing',
];

function buildFullGridPrompt(panels: GridPanel[], gridSize: number): string {
  if (panels.length === 0) return '';
  const basePanel = panels[0];
  const basePrompt = basePanel.image_prompt;
  const panelMatch = basePrompt.match(/^(.*?)(?:Panel\d+:|$)/s);
  let basePart = panelMatch ? panelMatch[1].trim() : basePrompt;
  const gridCols = gridSize <= 4 ? '2×2' : gridSize <= 9 ? '3×3' : '3×4';

  // Add sexy clothing to base prompt if not already present
  const hasClothing = /dress|skirt|lingerie|leather|bodysuit|blouse|top|outfit|corset|satin|lace/i.test(basePart);
  if (!hasClothing) {
    const outfit = sexyOutfitPool[Math.floor(Math.random() * sexyOutfitPool.length)];
    basePart += `, wearing ${outfit}`;
  }

  // Build anchor for character consistency
  const anchorMatch = basePrompt.match(/\[ANCHOR:\s*([^\]]+)\]/i);
  const characterAnchor = anchorMatch ? anchorMatch[1].trim() : '';
  const anchorTag = characterAnchor ? `[ANCHOR: ${characterAnchor}]` : '';

  let fullPrompt = `cinematic storyboard grid, ${gridSize} panels in ${gridCols} grid, ${basePart}`;
  fullPrompt += `\n\n【CRITICAL CONSISTENCY REQUIREMENTS】`;
  fullPrompt += `\n- Character appearance MUST remain IDENTICAL across all panels: same face, same body, same hair, same clothing color and style`;
  fullPrompt += `\n- Do NOT change clothing color, style, or type between panels`;
  fullPrompt += `\n- Each panel MUST show a DIFFERENT action, pose, and camera angle`;
  fullPrompt += `\n- Maintain scene continuity: same location, same lighting, same time of day`;

  // Assign consistent outfit and varied camera angles/actions per panel
  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i];
    const panelPrompt = panel.image_prompt;
    const panelSpecificMatch = panelPrompt.match(/Panel\d+:\s*(.*)/s);
    const panelSpecific = panelSpecificMatch ? panelSpecificMatch[1].trim() : panelPrompt;

    // Pick camera angle and shot type for variety
    const angleIdx = i % cameraAngles.length;
    const shotIdx = i % shotTypes.length;
    const cameraAngle = cameraAngles[angleIdx];
    const shotType = shotTypes[shotIdx];

    fullPrompt += `\nPanel${panel.panel_number}: ${cameraAngle}, ${shotType}, ${anchorTag} ${panelSpecific}`;
  }
  return fullPrompt;
}

export function GridStoryboardMode({
  r18Mode,
  taskManager,
  apiKey,
  displayLang,
  digitalHumanMode,
  selectedGirlfriend,
  onError,
  onSuccess,
  onNavigate,
}: GridStoryboardModeProps) {
  // Step state
  const [step, setStep] = useState<GridStep>('themes');
  const [gridSize, setGridSize] = useState<GridSize>(9);

  // Theme selection state
  const [themeOptions, setThemeOptions] = useState<StoryboardThemeOption[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<GridTemplate | null>(null);
  const [customThemeMode, setCustomThemeMode] = useState(false);
  const [customThemeDescription, setCustomThemeDescription] = useState('');
  const [customThemeCount, setCustomThemeCount] = useState(3);
  const [themeLibraryOpen, setThemeLibraryOpen] = useState(false);
  const [loadingThemeLibrary, setLoadingThemeLibrary] = useState(false);
  const [themeSearchQuery, setThemeSearchQuery] = useState('');
  const [themeCategoryFilter, setThemeCategoryFilter] = useState('');
  const [generatingThemes, setGeneratingThemes] = useState(false);

  // Selected themes (like linear storyboard)
  const [selectedThemes, setSelectedThemes] = useState<StoryboardThemeOption[]>([]);

  // Random theme confirmation state
  const [randomThemes, setRandomThemes] = useState<StoryboardThemeOption[]>([]);
  const [showRandomConfirm, setShowRandomConfirm] = useState(false);

  // Grid task tracking - one per selected theme
  const [gridTasks, setGridTasks] = useState<Array<{ taskId: string; themeTitle: string; status: string; progress?: string; panels?: GridPanel[]; startTime?: number }>>([]);
  const gridPollIntervalsRef = useRef<ReturnType<typeof setInterval>[]>([]);

  // Completed themes - user can click to load any of them
  const [completedThemes, setCompletedThemes] = useState<Array<{ themeTitle: string; panels: GridPanel[]; gridSize: GridSize }>>([]);
  const [activeThemeIdx, setActiveThemeIdx] = useState<number>(0);
  const completedThemesRef = useRef<Array<{ themeTitle: string; panels: GridPanel[]; gridSize: GridSize }>>([]);

  // Per-panel redraw state
  const [redrawPanelIdx, setRedrawPanelIdx] = useState<number | null>(null);
  const streamPanelsRef = useRef<GridPanel[]>([]);

  // Panels state
  const [panels, setPanels] = useState<GridPanel[]>([]);
  const [fullPrompt, setFullPrompt] = useState('');
  const [loading, setLoading] = useState(false);

  // Multiple images state (API may return multiple grid images)
  // Store images per-theme to support multi-theme switching
  const [gridImagesMap, setGridImagesMap] = useState<Record<number, string[]>>({});
  const [gridImages, setGridImages] = useState<string[]>([]);
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  // Track generating state per-theme
  const [isGeneratingMap, setIsGeneratingMap] = useState<Record<number, boolean>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  // Track historyId per-theme
  const [currentHistoryIdMap, setCurrentHistoryIdMap] = useState<Record<number, string | null>>({});
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);

  // Lightbox state
  const [showLightbox, setShowLightbox] = useState(false);

  // History
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<GridHistoryItem[]>(() => getGridHistory());

  // Favorites
  const [favorites, setFavorites] = useState(() => getFavorites());

  // Refs
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // Restore session on mount - default to theme selection page
  useEffect(() => {
    // Reset generation lock on mount (in case page was refreshed during generation)
    isGeneratingRef.current = false;

    // Always start at theme selection page (screenshot 3)
    setStep('themes');
    setPanels([]);
    setGridImages([]);
  }, []);

  // Persist session
  useEffect(() => {
    if (panels.length > 0) {
      saveGridSession({
        plot: selectedTemplate?.titleZh || '',
        gridSize,
        panels,
        themeTitle: selectedTemplate?.titleZh,
        historyId: currentHistoryId || undefined,
      });
    }
  }, [panels, gridSize, selectedTemplate, currentHistoryId]);

  // Update fullPrompt whenever panels change
  useEffect(() => {
    if (panels.length > 0) {
      setFullPrompt(buildFullGridPrompt(panels, panels.length));
    }
  }, [panels]);

  // Watch gridTasks and update loading state when all tasks are done
  useEffect(() => {
    if (gridTasks.length === 0) return;
    const allDone = gridTasks.every((t) => ['DONE', 'FAILED'].includes(t.status));
    if (allDone) {
      setLoading(false);
      isGeneratingRef.current = false;
      gridPollIntervalsRef.current = [];
    }
  }, [gridTasks]);

  // Subscribe to finished task images - handles per-theme image tracking
  const { finishedTasks } = useFinishedTaskImages();
  useEffect(() => {
    // Collect all active history IDs from all themes
    const allHistoryIds = new Set<string>();
    if (currentHistoryId) allHistoryIds.add(currentHistoryId);
    Object.values(currentHistoryIdMap).forEach((hid) => { if (hid) allHistoryIds.add(hid); });
    if (sessionStorage.getItem('sb_latest_history_id')) allHistoryIds.add(sessionStorage.getItem('sb_latest_history_id')!);

    if (allHistoryIds.size === 0) return;

    // Process finished tasks for each theme
    for (const [, info] of Object.entries(finishedTasks)) {
      const { images, storyboardInfo } = info;
      if (!images || images.length === 0) continue;
      const hid = storyboardInfo?.historyId;
      if (!hid || !allHistoryIds.has(hid)) continue;
      const { panelIdx } = storyboardInfo ?? {};
      if (panelIdx === undefined) continue;

      // Find which theme this historyId belongs to
      let themeIdx = -1;
      if (currentHistoryId === hid) {
        themeIdx = activeThemeIdx;
      } else {
        for (const [idx, historyId] of Object.entries(currentHistoryIdMap)) {
          if (historyId === hid) {
            themeIdx = parseInt(idx);
            break;
          }
        }
      }
      if (themeIdx < 0) themeIdx = activeThemeIdx;

      // Collect images for this task
      const newImages: string[] = [];
      if (images.length > 1) {
        for (let i = 0; i < images.length; i++) {
          if (images[i] && !newImages[i]) newImages[i] = images[i];
        }
      } else {
        if (!newImages[panelIdx]) newImages[panelIdx] = images[0];
      }

      if (newImages.length === 0) continue;

      // Update images for this theme
      setGridImagesMap((prev) => {
        const existing = prev[themeIdx] || [];
        const merged = [...existing];
        for (let i = 0; i < newImages.length; i++) {
          if (newImages[i]) merged[i] = newImages[i];
        }
        return { ...prev, [themeIdx]: merged };
      });

      // Update current theme's images if this is the active theme
      if (themeIdx === activeThemeIdx) {
        setGridImages((prev) => {
          const merged = [...prev];
          for (let i = 0; i < newImages.length; i++) {
            if (newImages[i]) merged[i] = newImages[i];
          }
          return merged;
        });
        setStep('view');
      }

      // Set generating to false for this theme
      setIsGeneratingMap((prev) => ({ ...prev, [themeIdx]: false }));
      if (themeIdx === activeThemeIdx) setIsGenerating(false);

      // Cache all images
      for (let i = 0; i < newImages.length; i++) {
        if (newImages[i]) {
          cacheStoryboardPanelImages(hid, i, [newImages[i]]).catch(() => {});
        }
      }
    }
  }, [finishedTasks, currentHistoryId, currentHistoryIdMap, activeThemeIdx]);

  // ── Theme selection handlers ──

  const handleLoadThemeLibrary = async () => {
    console.log(`${GRID_LOG_PREFIX} handleLoadThemeLibrary called`);
    setThemeLibraryOpen(true);
    setLoadingThemeLibrary(true);
    try {
      const res = await listStoryboardThemes();
      console.log(`${GRID_LOG_PREFIX} handleLoadThemeLibrary success:`, res.themes?.length, 'themes');
      setThemeOptions(res.themes);
    } catch (err) {
      console.error(`${GRID_LOG_PREFIX} handleLoadThemeLibrary error:`, err);
      onError(err instanceof Error ? err.message : '主题库加载失败');
    } finally {
      setLoadingThemeLibrary(false);
    }
  };

  const handleGenerateThemes = async () => {
    console.log(`${GRID_LOG_PREFIX} handleGenerateThemes called, count=${customThemeCount}`);
    setGeneratingThemes(true);
    try {
      const desc = customThemeMode && customThemeDescription.trim() ? customThemeDescription.trim() : undefined;
      const res = await generateStoryboardThemes(r18Mode, customThemeCount, desc || undefined, false);
      console.log(`${GRID_LOG_PREFIX} handleGenerateThemes success:`, res.themes?.length, 'themes');
      setThemeOptions(res.themes);
      setThemeLibraryOpen(true);
      // Auto-select the generated themes
      setSelectedThemes(res.themes);
      onSuccess(`生成了 ${res.themes.length} 个主题，已自动选中，点击"生成九宫格分镜"开始生成`);
    } catch (err) {
      console.error(`${GRID_LOG_PREFIX} handleGenerateThemes error:`, err);
      onError(err instanceof Error ? err.message : '主题生成失败');
    } finally {
      setGeneratingThemes(false);
    }
  };

  const handleSelectTemplate = (template: GridTemplate) => {
    console.log(`${GRID_LOG_PREFIX} handleSelectTemplate:`, template.titleZh);
    setSelectedTemplate(template);
    const templatePanels = template.panels.map((p) => ({
      panel_number: p.panel_number,
      scene_description: p.scene_description,
      image_prompt: `${template.basePrompt}\n${p.image_prompt}`,
    }));
    setPanels(templatePanels);
    setGridSize(templatePanels.length as GridSize);
    setStep('edit');
    onSuccess(`已加载模板「${template.titleZh}」，可编辑提示词后生成图片`);
  };

  // ── Generate grid storyboard using the same API as linear storyboard ──
  // Uses async mode (returns task_id) + polling, identical to linear storyboard flow

  // Cancel a specific task by index - just stop polling and mark as cancelled
  const handleCancelTask = (taskIndex: number) => {
    // Find and clear the polling interval for this task
    const interval = gridPollIntervalsRef.current[taskIndex];
    if (interval) {
      clearInterval(interval);
      gridPollIntervalsRef.current[taskIndex] = undefined as any;
    }
    // Mark as cancelled
    setGridTasks((prev) => {
      const next = [...prev];
      if (next[taskIndex] && ['SUBMITTING', 'RUNNING'].includes(next[taskIndex].status)) {
        next[taskIndex] = { ...next[taskIndex], status: 'FAILED', progress: '已取消' };
      }
      return next;
    });
  };

  // Poll for grid task result - keeps polling until DONE or FAILED (no max limit)
  const startGridTaskPolling = (taskId: string, themeTitle: string, taskIndex: number) => {
    let pollCount = 0;

    const pollInterval = setInterval(async () => {
      pollCount++;

      try {
        const statusRes = await getPromptTaskStatus(taskId);
        console.log(`${GRID_LOG_PREFIX} poll ${pollCount} for ${themeTitle}: status=${statusRes.status}`);

        // Still running - update progress and keep polling
        if (statusRes.status === 'RUNNING' || statusRes.status === 'PENDING') {
          setGridTasks((prev) => {
            const next = [...prev];
            if (next[taskIndex]) {
              next[taskIndex] = {
                ...next[taskIndex],
                status: statusRes.status,
                progress: statusRes.progress || `生成中 (${Math.floor(pollCount * 3 / 60)}分${(pollCount * 3) % 60}秒)`,
              };
            }
            return next;
          });
          return; // keep polling
        }

        // Done or failed - stop polling
        clearInterval(pollInterval);

        if (statusRes.status === 'DONE' && statusRes.result) {
          const resultPanels = statusRes.result.storyboard || [];
          setGridTasks((prev) => {
            const next = [...prev];
            if (next[taskIndex]) {
              next[taskIndex] = {
                ...next[taskIndex],
                status: 'DONE',
                panels: resultPanels,
                progress: `完成 ${resultPanels.length} 格`,
              };
            }
            return next;
          });
          // Add to completedThemes immediately when done
          const completedEntry = {
            themeTitle,
            panels: resultPanels,
            gridSize: resultPanels.length as GridSize,
          };
          setCompletedThemes((prev) => {
            const existing = prev.findIndex((t) => t.themeTitle === themeTitle);
            if (existing >= 0) {
              const next = [...prev];
              next[existing] = completedEntry;
              return next;
            }
            return [...prev, completedEntry];
          });
          completedThemesRef.current = completedThemes;
        } else if (statusRes.status === 'FAILED') {
          setGridTasks((prev) => {
            const next = [...prev];
            if (next[taskIndex]) {
              next[taskIndex] = {
                ...next[taskIndex],
                status: 'FAILED',
                progress: statusRes.error || '生成失败',
              };
            }
            return next;
          });
        }
      } catch (err) {
        console.warn(`${GRID_LOG_PREFIX} poll error for ${themeTitle}:`, err);
        // Don't stop polling on network errors - keep trying
      }
    }, 3000); // poll every 3 seconds

    gridPollIntervalsRef.current.push(pollInterval);
  };

  // Cancel all ongoing tasks - stop polling and mark as cancelled
  const handleCancelAll = () => {
    // Stop all polling intervals
    gridPollIntervalsRef.current.forEach((interval) => clearInterval(interval));
    gridPollIntervalsRef.current = [];

    // Mark running tasks as cancelled
    setGridTasks((prev) =>
      prev.map((t) =>
        ['SUBMITTING', 'RUNNING'].includes(t.status)
          ? { ...t, status: 'FAILED', progress: '已取消' }
          : t
      )
    );

    setLoading(false);
    isGeneratingRef.current = false;
    onError('已取消生成任务');
  };

  // Check if all tasks are complete - just add to completedThemes
  // The useEffect watching gridTasks handles setting loading=false
  const checkAllTasksComplete = () => {
    setGridTasks((current) => {
      const allDone = current.every((t) => ['DONE', 'FAILED'].includes(t.status));
      if (allDone) {
        const successful = current.filter((t) => t.status === 'DONE' && t.panels?.length);
        if (successful.length > 0) {
          const newCompleted = successful.map((t) => ({
            themeTitle: t.themeTitle,
            panels: t.panels!,
            gridSize: t.panels!.length as GridSize,
          }));
          completedThemesRef.current = newCompleted;
          setCompletedThemes(newCompleted);
          // Auto-load first theme only if no theme is currently displayed
          if (panels.length === 0 || step === 'themes') {
            setPanels(successful[0].panels!);
            setGridSize(successful[0].panels!.length as GridSize);
            setActiveThemeIdx(0);
            setStep('edit');
            const historyId = addGridHistory({
              plot: successful[0].themeTitle || '九宫格分镜',
              grid_size: successful[0].panels!.length,
              r18: r18Mode,
              panels: successful[0].panels!,
            });
            setCurrentHistoryId(historyId);
            sessionStorage.setItem('sb_latest_history_id', historyId);
          }
          setTimeout(() => onSuccess(`${successful.length} 个主题分镜已生成完成`), 0);
        } else {
          setTimeout(() => onError('所有主题的分镜生成均失败，请重试'), 0);
        }
      }
      return current;
    });
  };

  // Load a theme by its themeTitle (works for both gridTasks and completedThemes)
  const handleLoadTheme = (themeTitle: string) => {
    // Find in completedThemes first
    let theme = completedThemesRef.current.find((t) => t.themeTitle === themeTitle);
    if (!theme) theme = completedThemes.find((t) => t.themeTitle === themeTitle);
    // Also check gridTasks for DONE status
    if (!theme) {
      const task = gridTasks.find((t) => t.themeTitle === themeTitle && t.status === 'DONE');
      if (task?.panels) {
        theme = { themeTitle: task.themeTitle, panels: task.panels, gridSize: task.panels.length as GridSize };
      }
    }
    if (theme) {
      // Save current theme's images and generating state before switching
      setGridImagesMap((prev) => ({ ...prev, [activeThemeIdx]: gridImages }));
      setIsGeneratingMap((prev) => ({ ...prev, [activeThemeIdx]: isGenerating }));
      setCurrentHistoryIdMap((prev) => ({ ...prev, [activeThemeIdx]: currentHistoryId }));

      // Restore new theme's images and state
      const themeIdx = completedThemes.findIndex((t) => t.themeTitle === themeTitle);
      const newThemeIdx = themeIdx >= 0 ? themeIdx : activeThemeIdx;
      const newImages = gridImagesMap[newThemeIdx] || [];
      const newIsGenerating = isGeneratingMap[newThemeIdx] || false;
      const newHistoryId = currentHistoryIdMap[newThemeIdx] || null;

      setGridImages(newImages);
      setActiveImageIdx(0);
      setIsGenerating(newIsGenerating);
      setCurrentHistoryId(newHistoryId);
      setPanels(theme.panels);
      setGridSize(theme.gridSize);
      setActiveThemeIdx(newThemeIdx);
      setStep('edit');
      // Save to history with theme title
      saveGridHistoryEntry(theme.themeTitle);
      onSuccess(`已加载「${theme.themeTitle}」分镜`);
    }
  };

  // Save current panels to history with theme title
  const saveGridHistoryEntry = useCallback((themeTitle: string) => {
    const historyId = addGridHistory({
      plot: themeTitle || '九宫格分镜',
      grid_size: panels.length,
      r18: r18Mode,
      panels,
    });
    setCurrentHistoryId(historyId);
    setCurrentHistoryIdMap((prev) => ({ ...prev, [activeThemeIdx]: historyId }));
    sessionStorage.setItem('sb_latest_history_id', historyId);
  }, [panels, r18Mode, activeThemeIdx]);

  // ── Random: pick 3 themes from library and add to theme pool ──

  const handleRandomClick = async () => {
    console.log(`${GRID_LOG_PREFIX} handleRandomClick called`);
    // If we don't have themes loaded yet, load them first
    let themes = themeOptions;
    if (themes.length === 0) {
      try {
        const res = await listStoryboardThemes();
        themes = res.themes;
        setThemeOptions(res.themes);
      } catch (err) {
        onError('主题库加载失败，无法随机选择');
        return;
      }
    }
    // Pick 3 random themes and add to themeOptions for display
    const shuffled = [...themes].sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, 3);
    // Add to themeOptions if not already there
    setThemeOptions((prev) => {
      const existingIds = new Set(prev.map((t) => t.id));
      const newThemes = picked.filter((t) => !existingIds.has(t.id));
      return [...prev, ...newThemes];
    });
    // Auto-select the 3 random themes
    setSelectedThemes(picked);
    onSuccess(`已随机选择 3 个主题，点击"生成九宫格分镜"按钮开始生成`);
  };

  // Toggle theme selection
  const handleToggleTheme = (theme: StoryboardThemeOption) => {
    setSelectedThemes((prev) => {
      const exists = prev.some((t) => t.id === theme.id);
      if (exists) {
        return prev.filter((t) => t.id !== theme.id);
      }
      return [...prev, theme];
    });
  };

  // Ref to prevent concurrent generation calls
  const isGeneratingRef = useRef(false);

  // Generate grid storyboard from the first selected theme
  const handleGenerateGridStoryboard = async () => {
    console.log(`${GRID_LOG_PREFIX} handleGenerateGridStoryboard called, selectedThemes=${selectedThemes.length}`);
    if (selectedThemes.length === 0) {
      onError('请先选择一个主题');
      return;
    }

    // Clear any existing polling
    gridPollIntervalsRef.current.forEach((interval) => clearInterval(interval));
    gridPollIntervalsRef.current = [];

    // Prevent concurrent generation
    if (isGeneratingRef.current) {
      console.log(`${GRID_LOG_PREFIX} generation already in progress`);
      return;
    }
    isGeneratingRef.current = true;
    setLoading(true);

    // Generate for ALL selected themes in parallel
    const tasks: Array<{ taskId: string; themeTitle: string; status: string; progress?: string; panels?: GridPanel[]; startTime?: number }> = [];

    for (const theme of selectedThemes) {
      console.log(`${GRID_LOG_PREFIX} submitting task for theme: ${theme.title}`);
      tasks.push({ taskId: '', themeTitle: theme.title, status: 'SUBMITTING', startTime: Date.now() });
    }
    setGridTasks([...tasks]);

    // Submit all tasks in parallel
    const results = await Promise.allSettled(
      selectedThemes.map(async (theme, index) => {
        try {
          const res = await generateStoryboardOutline(theme.id, theme.title, gridSize, r18Mode, true);
          if (res.task_id) {
            setGridTasks((prev) => {
              const next = [...prev];
              next[index] = { ...next[index], taskId: res.task_id!, status: 'RUNNING' };
              return next;
            });
            return { taskId: res.task_id, themeTitle: theme.title, index };
          } else if (res.storyboard?.length) {
            setGridTasks((prev) => {
              const next = [...prev];
              next[index] = { ...next[index], status: 'DONE', panels: res.storyboard };
              return next;
            });
            return { taskId: '', themeTitle: theme.title, index, panels: res.storyboard };
          }
          throw new Error('返回的分镜为空');
        } catch (err) {
          setGridTasks((prev) => {
            const next = [...prev];
            next[index] = { ...next[index], status: 'FAILED', progress: err instanceof Error ? err.message : '生成失败' };
            return next;
          });
          return { taskId: '', themeTitle: theme.title, index };
        }
      }),
    );

    // Start polling for tasks that got a task_id
    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value?.taskId) {
        startGridTaskPolling(result.value.taskId, result.value.themeTitle, result.value.index);
      }
    });

    onSuccess(`已为 ${selectedThemes.length} 个主题提交分镜生成任务`);
  };

  const handleToggleLibraryTheme = (theme: StoryboardThemeOption) => {
    handleToggleTheme(theme);
  };

  const handleConfirmLibraryThemes = () => {
    setThemeLibraryOpen(false);
    onSuccess(`已选择 ${selectedThemes.length} 个主题，点击"生成九宫格分镜"按钮开始生成`);
  };

  // ── Panel editing handlers ──

  const handleUpdatePanel = useCallback((idx: number, field: 'scene_description' | 'image_prompt', value: string) => {
    setPanels((prev) => {
      const next = [...prev];
      if (next[idx]) {
        next[idx] = { ...next[idx], [field]: value };
      }
      return next;
    });
  }, []);

  const handleFullPromptChange = useCallback((prompt: string) => {
    setFullPrompt(prompt);
  }, []);

  // ── Image generation handler (single grid image) ──

  const handleGenerateImage = useCallback(async () => {
    if (!fullPrompt.trim()) return;
    if (taskManager.isFull) { onError('任务队列已满'); return; }

    console.log(`${GRID_LOG_PREFIX} handleGenerateImage called, prompt length=${fullPrompt.length}`);

    // Get theme title from completedThemes or use default
    const themeTitle = completedThemesRef.current[activeThemeIdx]?.themeTitle
      || selectedTemplate?.titleZh
      || '九宫格分镜';

    const historyId = addGridHistory({
      plot: themeTitle,
      grid_size: panels.length,
      r18: r18Mode,
      panels,
    });
    setCurrentHistoryId(historyId);
    setCurrentHistoryIdMap((prev) => ({ ...prev, [activeThemeIdx]: historyId }));
    sessionStorage.setItem('sb_latest_history_id', historyId);

    setIsGenerating(true);
    setIsGeneratingMap((prev) => ({ ...prev, [activeThemeIdx]: true }));
    setStep('view');
    setGridImages([]);
    setActiveImageIdx(0);
    // Save images for current theme index
    setGridImagesMap((prev) => ({ ...prev, [activeThemeIdx]: [] }));

    let imagePath = selectedGirlfriend?.portraitUrl || '';
    let downloadUrl = '';
    if (digitalHumanMode && selectedGirlfriend) {
      try {
        const file = await (async () => {
          const res = await fetch(selectedGirlfriend.portraitUrl);
          const blob = await res.blob();
          return new File([blob], `${selectedGirlfriend.id}.jpg`, { type: blob.type || 'image/jpeg' });
        })();
        const result = await uploadImage(apiKey, file);
        imagePath = result.imagePath;
        downloadUrl = result.downloadUrl;
      } catch {
        onError('AI 女友图片上传失败');
        setIsGenerating(false);
        return;
      }
    }

    // Submit image generation tasks (may produce multiple images)
    // We submit one task per expected image (usually 1-2)
    const imageCount = 2; // Request 2 images by default
    const storyboardInfo = { historyId, panelIdx: 0 };
    try {
      if (digitalHumanMode && selectedGirlfriend) {
        const charId = (selectedGirlfriend.id as string).toUpperCase().slice(0, 4);
        const anchorPrompt = `【严格锁定】严格锁定图中22岁女性（ID:${charId}），完全保留原有面部特征，五官轮廓、脸型、眼睛、鼻子、嘴唇、发型、肤色、身材比例完全不变，不做任何面部修改，动作流畅不僵硬。超高清8K，写实细节，皮肤质感细腻，无畸变、无模糊、无穿模。`;
        const finalPrompt = `${anchorPrompt}\n\n${fullPrompt}`;
        const nodes = [
          { nodeId: '291', fieldName: 'prompt', fieldValue: finalPrompt, description: 'prompt' },
          { nodeId: '172', fieldName: 'value', fieldValue: '9', description: 'width' },
          { nodeId: '173', fieldName: 'value', fieldValue: '16', description: 'height' },
          { nodeId: '269', fieldName: 'value', fieldValue: String(imageCount), description: 'count' },
          { nodeId: '104', fieldName: 'image', fieldValue: downloadUrl || imagePath, description: 'image' },
          { nodeId: '273', fieldName: 'value', fieldValue: 'false', description: 'enhance' },
        ];
        await taskManager.addTask('img2img', nodes, finalPrompt, WORKFLOW.IMAGE_TO_IMAGE, undefined, storyboardInfo, 'storyboard', selectedTemplate?.titleZh || '九宫格', 1);
      } else {
        const finalPrompt = withQualityBoost(fullPrompt);
        const txt2imgOptions = buildUnifiedTxt2ImgOptions(finalPrompt);
        txt2imgOptions.imageCount = imageCount;
        const nodes = buildTxt2ImgNodeList(txt2imgOptions);
        await taskManager.addTask('txt2img', nodes, finalPrompt, undefined, undefined, storyboardInfo, 'storyboard', selectedTemplate?.titleZh || '九宫格', 1);
      }
      console.log(`${GRID_LOG_PREFIX} task submitted successfully`);
      onSuccess(`九宫格分镜图片生成任务已提交（预计生成 ${imageCount} 张）`);
    } catch (err) {
      console.error(`${GRID_LOG_PREFIX} handleGenerateImage error:`, err);
      onError(err instanceof Error ? err.message : '生成失败');
      setIsGenerating(false);
    }
  }, [fullPrompt, panels, taskManager, onError, onSuccess, digitalHumanMode, selectedGirlfriend, apiKey, r18Mode, selectedTemplate]);

  // ── Regenerate handler ──

  const handleRegenerate = useCallback(async () => {
    if (!fullPrompt.trim() || isGenerating || isGeneratingMap[activeThemeIdx]) return;
    if (taskManager.isFull) { onError('任务队列已满'); return; }
    await handleGenerateImage();
  }, [fullPrompt, isGenerating, isGeneratingMap, activeThemeIdx, taskManager, onError, handleGenerateImage]);

  // ── Per-panel smart edit: modify prompt to emphasize variety ──
  // (The regenerateGridPanel API is not available, so we use a smart edit approach:
  // when user clicks "重绘", we auto-enhance the panel's prompt with diverse actions/clothing)

  const sexyOutfits = [
    'sexy lace lingerie',
    'slip satin dress',
    'tight mini skirt with crop top',
    'V-neck silk blouse unbuttoned',
    'leather mini dress',
    'off-shoulder bodysuit',
    'sheer mesh top',
    'wrap dress with deep neckline',
    'corset with garter belt',
    'backless halter top',
  ];

  const undressingActions = [
    'unbuttoning her blouse',
    'slipping off her dress zipper',
    'pulling down her skirt',
    'unhooking her bra',
    'sliding off her straps',
    'peeling off her stockings',
    'wriggling out of her tight dress',
  ];

  // ── Per-panel redraw: use same API as linear storyboard ──

  const handleRedrawPanel = useCallback(async (idx: number) => {
    if (idx < 0 || idx >= panels.length) return;
    const panel = panels[idx];
    console.log(`${GRID_LOG_PREFIX} handleRedrawPanel: panel ${panel.panel_number}`);
    setRedrawPanelIdx(idx);
    setLoading(true);

    try {
      // Use the same API as linear storyboard to regenerate this panel
      // Note: panel_count must be >= 2 (API requirement)
      const res = await generateStoryboardOutline(
        0, // no theme id for redraw
        panel.scene_description || `panel ${panel.panel_number}`,
        2, // panel_count must be >= 2
        r18Mode,
        false,
      );

      if (res.storyboard && res.storyboard.length > 0) {
        // Use first panel as the replacement
        const newPanel = res.storyboard[0];
        handleUpdatePanel(idx, 'image_prompt', newPanel.image_prompt);
        handleUpdatePanel(idx, 'scene_description', newPanel.scene_description);
        onSuccess(`第 ${panel.panel_number} 镜已重绘，点击"生成"出图`);
      } else {
        onError('重绘返回结果为空，请重试');
      }
    } catch (err) {
      console.error(`${GRID_LOG_PREFIX} handleRedrawPanel error:`, err);
      onError(err instanceof Error ? err.message : '分镜重绘失败');
    } finally {
      setRedrawPanelIdx(null);
      setLoading(false);
    }
  }, [panels, r18Mode, onError, onSuccess, handleUpdatePanel]);

  // ── History handlers ──

  const handleHistoryLoad = async (item: GridHistoryItem) => {
    console.log(`${GRID_LOG_PREFIX} handleHistoryLoad:`, item.plot);
    setPanels(item.panels);
    setGridSize(item.grid_size as GridSize);
    setCurrentHistoryId(item.id);
    setCurrentHistoryIdMap((prev) => ({ ...prev, [activeThemeIdx]: item.id }));
    setShowHistory(false);
    setStep('edit');

    const cached = getCachedStoryboardPanelImages(item.id, 0);
    if (cached.length > 0) {
      // Load all cached images for this history
      const allCached: string[] = [];
      for (let i = 0; i < 4; i++) {
        const imgs = getCachedStoryboardPanelImages(item.id, i);
        if (imgs.length > 0) allCached[i] = imgs[0];
      }
      setGridImages(allCached);
      setGridImagesMap((prev) => ({ ...prev, [activeThemeIdx]: allCached }));
      setStep('view');
    }
    onSuccess(`已加载历史记录：${item.plot}`);
  };

  const handleDeleteHistory = (id: string) => {
    removeGridHistory(id);
    setHistory(getGridHistory());
  };

  // ── Favorites ──

  const handleToggleFavorite = useCallback((imageUrl: string, prompt?: string) => {
    const existing = favorites.find((f) => f.imageRef === imageUrl || f.imageUrl === imageUrl);
    if (existing) {
      removeFavorite(existing.id);
    } else {
      addFavorite({ imageUrl, prompt, source: 'storyboard', r18: r18Mode });
    }
    setFavorites(getFavorites());
  }, [favorites, r18Mode]);

  // ── Download ──

  const handleDownload = (imageUrl?: string) => {
    const url = imageUrl || gridImages[activeImageIdx];
    if (!url) return;
    try {
      const a = document.createElement('a');
      a.href = url;
      const mimeMatch = url.match(/^data:(image\/[a-zA-Z0-9+.-]+);/);
      const ext = mimeMatch ? mimeMatch[1].split('/')[1] : 'png';
      a.download = `grid_storyboard_${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error(`${GRID_LOG_PREFIX} download failed:`, err);
    }
  };

  // ── Reset ──

  const handleReset = () => {
    setPanels([]);
    setFullPrompt('');
    setGridImages([]);
    setActiveImageIdx(0);
    setSelectedTemplate(null);
    setStep('themes');
    setCurrentHistoryId(null);
    clearGridSession();
  };

  // ── Render ──

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-2xl bg-white border border-border shadow-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Grid3X3 size={14} className={r18Mode ? 'text-red-500' : 'text-primary'} />
            <span className="text-sm font-medium text-text-primary">
              {displayLang === 'zh' ? '九宫格分镜' : 'Grid Storyboard'}
            </span>
            {r18Mode && <span className="text-xs text-red-500 font-medium">(R18)</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium transition-all ${showHistory ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'}`}
            >
              <History size={12} />
              {displayLang === 'zh' ? '历史' : 'History'}
            </button>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-3">
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${step === 'themes' ? 'bg-primary text-white' : 'bg-bg-elevated text-text-tertiary'}`}>
            <span className="w-4 h-4 rounded-full bg-current/20 flex items-center justify-center text-[10px] font-bold">1</span>
            <span>{displayLang === 'zh' ? '选主题' : 'Theme'}</span>
          </div>
          <div className="flex-1 h-px bg-border" />
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${step === 'edit' ? 'bg-primary text-white' : step === 'view' ? 'bg-green-500 text-white' : 'bg-bg-elevated text-text-tertiary'}`}>
            <span className="w-4 h-4 rounded-full bg-current/20 flex items-center justify-center text-[10px] font-bold">2</span>
            <span>{displayLang === 'zh' ? '编辑分镜' : 'Edit'}</span>
          </div>
          <div className="flex-1 h-px bg-border" />
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${step === 'view' ? 'bg-green-500 text-white' : 'bg-bg-elevated text-text-tertiary'}`}>
            <span className="w-4 h-4 rounded-full bg-current/20 flex items-center justify-center text-[10px] font-bold">3</span>
            <span>{displayLang === 'zh' ? '图片展示' : 'View'}</span>
          </div>
        </div>

        {/* Grid size selector (only in themes step) */}
        {step === 'themes' && (
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs text-text-tertiary">{displayLang === 'zh' ? '网格尺寸:' : 'Grid:'}</span>
            <div className="flex gap-1">
              {([4, 9, 12] as GridSize[]).map((n) => (
                <button
                  key={n}
                  onClick={() => setGridSize(n)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                    gridSize === n
                      ? 'bg-primary text-white'
                      : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'
                  }`}
                >
                  {n === 4 ? '2×2' : n === 9 ? '3×3' : '3×4'}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Theme selection area */}
        {step === 'themes' && (
          <div className="space-y-3">
            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={handleLoadThemeLibrary}
                disabled={loadingThemeLibrary}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-sm transition-all ${
                  loadingThemeLibrary
                    ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                    : 'bg-gradient-to-r from-primary to-primary/80 text-white hover:opacity-90 active:scale-[0.98]'
                }`}
              >
                {loadingThemeLibrary ? (
                  <><Loader2 size={14} className="animate-spin" /> {displayLang === 'zh' ? '加载中...' : 'Loading...'}</>
                ) : (
                  <><LayoutList size={14} />{displayLang === 'zh' ? '从主题库选择' : 'Theme Library'}</>
                )}
              </button>
              <button
                onClick={handleRandomClick}
                disabled={loading}
                className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${
                  loading
                    ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                    : 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:opacity-90 active:scale-[0.98]'
                }`}
              >
                {loading ? (
                  <><Loader2 size={14} className="animate-spin" /></>
                ) : (
                  <><Shuffle size={14} />{displayLang === 'zh' ? '随机选题' : 'Random'}</>
                )}
              </button>
            </div>

            {/* Custom theme input */}
            <div className="p-3 rounded-xl border border-border bg-bg-elevated">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-text-primary">{displayLang === 'zh' ? '自定义选题' : 'Custom Theme'}</span>
                  <span className="text-[10px] text-text-tertiary">{displayLang === 'zh' ? '输入描述生成主题' : 'Enter description'}</span>
                </div>
                <button
                  onClick={() => setCustomThemeMode(!customThemeMode)}
                  className={`relative w-10 h-5 rounded-full transition-all flex-shrink-0 ${customThemeMode ? 'bg-primary' : 'bg-gray-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${customThemeMode ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
              {customThemeMode && (
                <div className="space-y-2">
                  <textarea
                    value={customThemeDescription}
                    onChange={(e) => setCustomThemeDescription(e.target.value)}
                    placeholder={displayLang === 'zh' ? '例如：办公室暧昧、浴室激情、古风青楼...' : 'e.g., office romance, bathroom passion...'}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-border text-sm text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                    rows={2}
                  />
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-text-tertiary">{displayLang === 'zh' ? '生成数量:' : 'Count:'}</span>
                      <div className="flex gap-0.5">
                        {[1, 3, 5, 10].map((n) => (
                          <button
                            key={n}
                            onClick={() => setCustomThemeCount(n)}
                            className={`w-7 h-6 rounded text-[10px] font-medium transition-all ${
                              customThemeCount === n
                                ? 'bg-primary text-white'
                                : 'bg-white border border-border text-text-tertiary hover:bg-bg-hover'
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex-1" />
                    <button
                      onClick={handleGenerateThemes}
                      disabled={generatingThemes || !customThemeDescription.trim()}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        generatingThemes || !customThemeDescription.trim()
                          ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                          : 'bg-primary text-white hover:bg-primary/90'
                      }`}
                    >
                      {generatingThemes ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                      {displayLang === 'zh' ? '生成主题' : 'Generate'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Selected themes + Generate button (like linear storyboard) */}
            {selectedThemes.length > 0 && (
              <div className="p-3 rounded-xl border border-purple-200 bg-purple-50/30">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-text-primary">
                      {displayLang === 'zh' ? `已选主题 ${selectedThemes.length}` : `Selected ${selectedThemes.length}`}
                    </span>
                  </div>
                  <button
                    onClick={() => setSelectedThemes([])}
                    className="text-[10px] text-text-tertiary hover:text-red-400 transition-colors"
                  >
                    {displayLang === 'zh' ? '清空' : 'Clear'}
                  </button>
                </div>
                <div className="space-y-1.5 mb-3">
                  {selectedThemes.map((theme) => (
                    <div key={theme.id} className="flex items-center gap-2 p-2 rounded-lg bg-white border border-purple-100">
                      <span className="text-xs font-semibold text-text-primary flex-1">{theme.title}</span>
                      <span className={`text-[9px] px-1 py-0.5 rounded-full font-medium ${
                        theme.r18_level === 'hard' ? 'bg-red-100 text-red-600' : theme.r18_level === 'medium' ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'
                      }`}>
                        {theme.r18_level === 'hard' ? '高强度' : theme.r18_level === 'medium' ? '中等' : '柔和'}
                      </span>
                      <button
                        onClick={() => handleToggleTheme(theme)}
                        className="p-0.5 rounded text-text-tertiary hover:text-red-400 transition-colors"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleGenerateGridStoryboard}
                  disabled={loading}
                  className="w-full py-2.5 rounded-lg text-xs font-medium bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-1.5">
                      <Loader2 size={12} className="animate-spin" />
                      {displayLang === 'zh' ? '生成中...' : 'Generating...'}
                    </span>
                  ) : (
                    displayLang === 'zh' ? '✨ 生成九宫格分镜' : '✨ Generate Grid Storyboard'
                  )}
                </button>
              </div>
            )}

            {/* Built-in templates */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <BookTemplate size={12} className="text-purple-500" />
                <span className="text-xs font-medium text-text-primary">{displayLang === 'zh' ? '内置模板' : 'Templates'}</span>
                <span className="text-[10px] text-text-tertiary">{displayLang === 'zh' ? '快速套用' : 'Quick start'}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {GRID_TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => handleSelectTemplate(template)}
                    className={`text-left p-3 rounded-xl border transition-all ${
                      selectedTemplate?.id === template.id
                        ? 'border-purple-400 bg-purple-50/50'
                        : 'border-border bg-bg-elevated hover:bg-bg-hover hover:border-purple-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-text-primary">{template.titleZh}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-600 font-medium">9格</span>
                    </div>
                    <p className="text-[10px] text-text-tertiary leading-relaxed line-clamp-2">{template.description}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Back to themes button */}
        {step !== 'themes' && (
          <div className="flex gap-2">
            <button
              onClick={() => setStep('themes')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-bg-elevated text-text-secondary hover:bg-bg-hover transition-colors"
            >
              <ArrowLeft size={12} />
              {displayLang === 'zh' ? '返回选主题' : 'Back'}
            </button>
            {step === 'view' && (
              <button
                onClick={() => setStep('edit')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-bg-elevated text-text-secondary hover:bg-bg-hover transition-colors"
              >
                {displayLang === 'zh' ? '继续编辑' : 'Edit More'}
              </button>
            )}
            <div className="flex-1" />
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-text-tertiary hover:text-red-400 transition-colors"
            >
              <RotateCcw size={12} />
              {displayLang === 'zh' ? '重新开始' : 'Reset'}
            </button>
          </div>
        )}
      </div>

      {/* Random Theme Modal - shows 3 random themes for selection */}
      {showRandomConfirm && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowRandomConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Shuffle size={18} className="text-purple-500" />
                <span className="font-semibold text-text-primary">{displayLang === 'zh' ? '随机选题' : 'Random Theme'}</span>
              </div>
              <button onClick={() => setShowRandomConfirm(false)} className="p-2 rounded-lg hover:bg-bg-hover transition-colors">
                <X size={18} className="text-text-tertiary" />
              </button>
            </div>
            <div className="p-5">
              <p className="text-sm text-text-secondary mb-4">
                {displayLang === 'zh' ? '已为您随机选择 3 个主题，点击选择：' : '3 random themes picked for you:'}
              </p>
              <div className="space-y-2">
                {randomThemes.map((theme) => {
                  const isSelected = selectedThemes.some((t) => t.id === theme.id);
                  return (
                    <button
                      key={theme.id}
                      onClick={() => handleToggleTheme(theme)}
                      className={`w-full text-left p-3 rounded-xl border transition-all ${
                        isSelected
                          ? 'border-purple-400 bg-purple-50 ring-2 ring-purple-200'
                          : 'border-border bg-bg-elevated hover:bg-purple-50/50 hover:border-purple-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                          isSelected ? 'border-purple-500 bg-purple-500' : 'border-gray-300'
                        }`}>
                          {isSelected && <Check size={10} className="text-white" />}
                        </div>
                        <span className="text-sm font-semibold text-text-primary">{theme.title}</span>
                        <span className={`text-[9px] px-1 py-0.5 rounded-full font-medium ${
                          theme.r18_level === 'hard' ? 'bg-red-100 text-red-600' : theme.r18_level === 'medium' ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'
                        }`}>
                          {theme.r18_level === 'hard' ? '高强度' : theme.r18_level === 'medium' ? '中等' : '柔和'}
                        </span>
                      </div>
                      <p className="text-[11px] text-text-tertiary leading-relaxed ml-6">{theme.description}</p>
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={handleRandomClick}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-medium bg-bg-elevated text-text-secondary hover:bg-bg-hover transition-colors"
                >
                  <RefreshCw size={12} />
                  {displayLang === 'zh' ? '换一批' : 'Refresh'}
                </button>
                <button
                  onClick={() => {
                    setShowRandomConfirm(false);
                    onSuccess(`已选择 ${selectedThemes.length} 个主题，点击"生成九宫格分镜"按钮开始生成`);
                  }}
                  disabled={selectedThemes.length === 0}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-medium transition-all ${
                    selectedThemes.length === 0
                      ? 'bg-bg-elevated text-text-tertiary cursor-not-allowed'
                      : 'bg-purple-500 text-white hover:bg-purple-600'
                  }`}
                >
                  <Check size={12} />
                  {displayLang === 'zh' ? `确定 (${selectedThemes.length})` : `Confirm (${selectedThemes.length})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Grid Tasks Progress Overlay */}
      {gridTasks.length > 0 && (
        <div className="rounded-2xl bg-white shadow-card p-4 border border-purple-200">
          <div className="flex items-center gap-2 mb-3">
            {loading ? (
              <Loader2 size={16} className="animate-spin text-purple-500" />
            ) : (
              <Check size={16} className="text-green-500" />
            )}
            <span className="text-sm font-medium text-text-primary">
              {loading
                ? (displayLang === 'zh' ? `正在为 ${gridTasks.length} 个主题生成分镜...` : `Generating for ${gridTasks.length} themes...`)
                : (displayLang === 'zh' ? `${gridTasks.length} 个主题分镜生成完成` : `${gridTasks.length} themes completed`)
              }
            </span>
            {loading && (
              <button
                onClick={handleCancelAll}
                className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-red-500 hover:bg-red-50 transition-colors"
              >
                <XCircle size={12} />
                {displayLang === 'zh' ? '取消' : 'Cancel'}
              </button>
            )}
          </div>
          <div className="space-y-2">
            {gridTasks.map((task, idx) => (
              <div key={idx}>
                <div
                  className={`flex items-center gap-2 p-2 rounded-lg ${
                    task.status === 'DONE' && task.panels?.length
                      ? 'bg-green-50 cursor-pointer hover:bg-green-100 transition-colors'
                      : 'bg-bg-elevated'
                  }`}
                  onClick={() => {
                    if (task.status === 'DONE' && task.panels?.length) {
                      handleLoadTheme(task.themeTitle);
                    }
                  }}
                >
                  <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                    {task.status === 'DONE' ? (
                      <Check size={14} className="text-green-500" />
                    ) : task.status === 'FAILED' ? (
                      <X size={14} className="text-red-500" />
                    ) : (
                      <Loader2 size={14} className="animate-spin text-purple-500" />
                    )}
                  </div>
                  <span className="text-xs text-text-primary flex-1 truncate">{task.themeTitle}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    task.status === 'DONE' ? 'bg-green-100 text-green-700' :
                    task.status === 'FAILED' ? 'bg-red-100 text-red-700' :
                    'bg-purple-100 text-purple-700'
                  }`}>
                    {task.status === 'SUBMITTING' ? (displayLang === 'zh' ? '提交中' : 'Submitting') :
                     task.status === 'RUNNING' ? (displayLang === 'zh' ? '生成中' : 'Running') :
                     task.status === 'DONE' ? (displayLang === 'zh' ? `完成 ${task.panels?.length || 0} 格` : `Done ${task.panels?.length || 0}`) :
                     task.status === 'FAILED' ? (displayLang === 'zh' ? '失败' : 'Failed') :
                     task.status}
                  </span>
                  {task.status === 'DONE' && task.panels?.length && (
                    <button
                      className="text-[10px] text-purple-600 hover:text-purple-800 font-medium"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleLoadTheme(task.themeTitle);
                      }}
                    >
                      {displayLang === 'zh' ? '加载' : 'Load'}
                    </button>
                  )}
                  {(task.status === 'SUBMITTING' || task.status === 'RUNNING') && (
                    <button
                      className="text-[10px] text-red-500 hover:text-red-700 font-medium"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCancelTask(idx);
                      }}
                    >
                      {displayLang === 'zh' ? '取消' : 'Cancel'}
                    </button>
                  )}
                </div>
                {task.status === 'RUNNING' && (
                  <div className="mt-1.5 ml-7">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 rounded-full bg-bg-elevated overflow-hidden">
                        <div className="h-full rounded-full bg-purple-400 animate-pulse" style={{ width: '60%' }} />
                      </div>
                      <span className="text-[9px] text-text-tertiary">
                        {task.startTime ? formatElapsedTime(task.startTime) : ''}
                      </span>
                    </div>
                    {task.progress && (
                      <p className="text-[9px] text-text-tertiary mt-0.5 truncate">{task.progress}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-text-tertiary mt-2">
            {displayLang === 'zh'
              ? loading
                ? '提示：每个主题独立生成，完成后可点击"加载"查看（其他任务继续在后台运行）'
                : '提示：点击"加载"按钮或主题标签切换查看不同主题的分镜'
              : loading
                ? 'Each theme generates independently. Click "Load" when ready (others continue in background)'
                : 'Click "Load" or theme tabs to switch between completed themes'}
          </p>
        </div>
      )}

      {/* Theme Library Modal */}
      {themeLibraryOpen && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4 animate-fade-in" onClick={() => setThemeLibraryOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-2">
                <LayoutList size={18} className="text-primary" />
                <span className="font-semibold text-text-primary">{displayLang === 'zh' ? '主题库' : 'Theme Library'}</span>
                <span className="px-2 py-0.5 rounded-full text-[11px] bg-bg-elevated text-text-tertiary">{themeOptions.length}</span>
              </div>
              <button onClick={() => setThemeLibraryOpen(false)} className="p-2 rounded-lg hover:bg-bg-hover transition-colors">
                <X size={18} className="text-text-tertiary" />
              </button>
            </div>
            <div className="px-5 py-3 border-b border-border flex-shrink-0 space-y-2">
              <input
                type="text"
                placeholder={displayLang === 'zh' ? '搜索主题...' : 'Search themes...'}
                className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30"
                onChange={(e) => setThemeSearchQuery(e.target.value.toLowerCase())}
              />
              <div className="flex flex-wrap gap-1">
                {[
                  { label: '全部', cat: '' },
                  { label: '户外', cat: 'outdoor' },
                  { label: '室内', cat: 'indoor' },
                  { label: '制服', cat: 'costume' },
                  { label: 'SM', cat: 'sm' },
                  { label: '幻想', cat: 'fantasy' },
                  { label: '职场', cat: 'work' },
                  { label: '交通', cat: 'transport' },
                ].map(({ label, cat }) => (
                  <button
                    key={cat}
                    onClick={() => setThemeCategoryFilter(cat)}
                    className={`px-2 py-0.5 rounded-full text-[11px] transition-all ${
                      themeCategoryFilter === cat ? 'bg-primary text-white' : 'bg-bg-elevated text-text-secondary hover:bg-primary hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {loadingThemeLibrary ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-text-tertiary" />
                </div>
              ) : themeOptions.length === 0 ? (
                <div className="text-center py-12 text-text-tertiary text-sm">
                  <LayoutList size={32} className="mx-auto mb-2 opacity-40" />
                  <p>{displayLang === 'zh' ? '暂无主题，请先点击「从主题库选择」或「自定义选题」生成' : 'No themes loaded yet'}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {themeOptions
                    .filter((t) => {
                      const matchesCategory = !themeCategoryFilter || t.category === themeCategoryFilter;
                      const matchesSearch = !themeSearchQuery ||
                        t.title.toLowerCase().includes(themeSearchQuery) ||
                        t.description.toLowerCase().includes(themeSearchQuery) ||
                        t.tags.some((tag) => tag.toLowerCase().includes(themeSearchQuery));
                      return matchesCategory && matchesSearch;
                    })
                    .map((theme) => {
                      const isSelected = selectedThemes.some((st) => st.id === theme.id);
                      return (
                        <div
                          key={theme.id}
                          className={`p-3 rounded-xl border transition-all cursor-pointer ${
                            isSelected
                              ? 'border-purple-400 bg-purple-50 ring-2 ring-purple-200'
                              : 'border-border bg-bg-elevated hover:bg-bg-hover hover:border-primary/40'
                          }`}
                          onClick={() => handleToggleLibraryTheme(theme)}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                              isSelected ? 'border-purple-500 bg-purple-500' : 'border-gray-300'
                            }`}>
                              {isSelected && <Check size={10} className="text-white" />}
                            </div>
                            <span className="text-sm font-semibold text-text-primary">{theme.title}</span>
                            <span className={`text-[9px] px-1 py-0.5 rounded-full font-medium ${
                              theme.r18_level === 'hard' ? 'bg-red-100 text-red-600' : theme.r18_level === 'medium' ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'
                            }`}>
                              {theme.r18_level === 'hard' ? '高强度' : theme.r18_level === 'medium' ? '中等' : '柔和'}
                            </span>
                          </div>
                          <p className="text-[11px] text-text-tertiary leading-relaxed line-clamp-2 ml-6">{theme.description}</p>
                          {theme.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5 ml-6">
                              {theme.tags.slice(0, 3).map((tag, i) => (
                                <span key={i} className="text-[9px] px-1 py-0.5 rounded-full bg-bg-elevated text-text-secondary">{tag}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
            {/* Bottom confirm bar */}
            {themeOptions.length > 0 && (
              <div className="px-5 py-3 border-t border-border flex items-center gap-3 flex-shrink-0">
                <span className="text-xs text-text-tertiary">
                  {selectedThemes.length > 0
                    ? (displayLang === 'zh' ? `已选 ${selectedThemes.length} 个主题` : `${selectedThemes.length} selected`)
                    : (displayLang === 'zh' ? '点击主题进行选择' : 'Click themes to select')
                  }
                </span>
                <div className="flex-1" />
                <button
                  onClick={() => setSelectedThemes([])}
                  disabled={selectedThemes.length === 0}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-bg-elevated text-text-secondary hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {displayLang === 'zh' ? '清空' : 'Clear'}
                </button>
                <button
                  onClick={handleConfirmLibraryThemes}
                  disabled={selectedThemes.length === 0}
                  className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    selectedThemes.length === 0
                      ? 'bg-bg-elevated text-text-tertiary cursor-not-allowed'
                      : 'bg-purple-500 text-white hover:bg-purple-600'
                  }`}
                >
                  {displayLang === 'zh' ? '确定' : 'Confirm'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* History Panel */}
      {showHistory && (
        <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-bg-elevated">
            <div className="flex items-center gap-2">
              <History size={14} className="text-text-tertiary" />
              <span className="text-sm font-medium text-text-primary">{displayLang === 'zh' ? '九宫格历史' : 'Grid History'}</span>
              <span className="px-2 py-0.5 rounded-full text-[11px] bg-bg-elevated text-text-tertiary">{history.length}</span>
            </div>
            <div className="flex items-center gap-2">
              {history.length > 0 && (
                <button onClick={() => { clearGridHistory(); setHistory([]); }} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-all">
                  <Trash2 size={11} />{displayLang === 'zh' ? '清空' : 'Clear'}
                </button>
              )}
              <button onClick={() => setShowHistory(false)} className="p-1.5 rounded-lg text-text-tertiary hover:bg-bg-hover transition-all">
                <X size={14} />
              </button>
            </div>
          </div>
          {history.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <ClockIcon size={24} className="mx-auto text-text-tertiary/40 mb-2" />
              <p className="text-sm text-text-tertiary">{displayLang === 'zh' ? '暂无历史记录' : 'No history'}</p>
            </div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto divide-y divide-border/50">
              {history.map((h) => {
                // Get first available image for preview
                const previewImage = h.images?.[0] || h.panelImages?.[0]?.[0] || undefined;
                return (
                  <div key={h.id} className="flex items-center gap-2 px-4 py-3 hover:bg-bg-hover/30 transition-colors">
                    <button onClick={() => handleHistoryLoad(h)} className="flex-1 flex items-start gap-2 w-full min-w-0 text-left group">
                      {/* Preview image or grid icon */}
                      {previewImage ? (
                        <div className="flex-shrink-0 w-10 h-10 rounded-lg overflow-hidden border border-border/50">
                          <img src={previewImage} alt="" className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-bg-elevated flex items-center justify-center border border-border/50">
                          <Grid3X3 size={16} className="text-text-tertiary/40" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-text-primary font-medium line-clamp-1">{h.plot}</p>
                        <p className="text-[10px] text-text-tertiary">{h.grid_size} 格 · {new Date(h.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                    </button>
                    <button onClick={() => handleDeleteHistory(h.id)} className="p-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-all flex-shrink-0">
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Step 2: Panel Editor */}
      {step === 'edit' && panels.length > 0 && (
        <div className="rounded-2xl bg-white border border-border shadow-card p-4">
          {/* Theme tabs - show when multiple themes completed */}
          {completedThemes.length > 1 && (
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border overflow-x-auto">
              <span className="text-[10px] text-text-tertiary flex-shrink-0">
                {displayLang === 'zh' ? '主题' : 'Theme'}:
              </span>
              {completedThemes.map((theme, idx) => (
                <button
                  key={idx}
                  onClick={() => handleLoadTheme(theme.themeTitle)}
                  className={`flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                    activeThemeIdx === idx
                      ? 'bg-purple-500 text-white'
                      : 'bg-bg-elevated text-text-secondary hover:bg-purple-100 hover:text-purple-700'
                  }`}
                >
                  {theme.themeTitle}
                </button>
              ))}
            </div>
          )}
          <GridPanelEditor
            panels={panels}
            gridSize={panels.length}
            fullPrompt={fullPrompt}
            onUpdatePanel={handleUpdatePanel}
            onFullPromptChange={handleFullPromptChange}
            onGenerateImages={handleGenerateImage}
            onRedrawPanel={handleRedrawPanel}
            isGenerating={isGenerating}
            redrawPanelIdx={redrawPanelIdx}
            displayLang={displayLang}
          />
        </div>
      )}

      {/* Step 3: Image Viewer - Multiple images as tabs */}
      {step === 'view' && (
        <div className="rounded-2xl bg-white border border-border shadow-card p-4">
          <div className="space-y-3">
            {/* Image tabs */}
            {gridImages.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {gridImages.map((img, idx) => (
                  <button
                    key={idx}
                    onClick={() => setActiveImageIdx(idx)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      activeImageIdx === idx
                        ? 'bg-purple-500 text-white'
                        : 'bg-bg-elevated text-text-secondary hover:bg-purple-50'
                    }`}
                  >
                    {displayLang === 'zh' ? `图片 ${idx + 1}` : `Image ${idx + 1}`}
                  </button>
                ))}
              </div>
            )}

            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Film size={14} className="text-purple-500" />
                <span className="text-xs font-medium text-purple-700">
                  {displayLang === 'zh' ? `九宫格分镜图片${gridImages.length > 1 ? ` (${activeImageIdx + 1}/${gridImages.length})` : ''}` : `Grid Storyboard${gridImages.length > 1 ? ` (${activeImageIdx + 1}/${gridImages.length})` : ''}`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {gridImages[activeImageIdx] && (
                  <>
                    <button
                      onClick={() => setShowLightbox(true)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors"
                    >
                      <ZoomIn size={10} />
                      {displayLang === 'zh' ? '放大查看' : 'Enlarge'}
                    </button>
                    <button
                      onClick={() => handleDownload()}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-bg-elevated text-text-secondary hover:bg-bg-hover transition-colors"
                    >
                      <Download size={10} />
                      {displayLang === 'zh' ? '下载' : 'Download'}
                    </button>
                    {isFavoritedFn && (
                      <button
                        onClick={() => handleToggleFavorite(gridImages[activeImageIdx], fullPrompt)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                          isFavoritedFn(gridImages[activeImageIdx]) ? 'bg-red-100 text-red-600' : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover'
                        }`}
                      >
                        <Heart size={10} fill={isFavoritedFn(gridImages[activeImageIdx]) ? 'currentColor' : 'none'} />
                        {isFavoritedFn(gridImages[activeImageIdx]) ? (displayLang === 'zh' ? '已收藏' : 'Favorited') : (displayLang === 'zh' ? '收藏' : 'Favorite')}
                      </button>
                    )}
                  </>
                )}
                <button
                  onClick={handleRegenerate}
                  disabled={isGenerating}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                    isGenerating ? 'bg-bg-elevated text-text-tertiary cursor-not-allowed' : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover'
                  }`}
                >
                  {isGenerating ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                  {displayLang === 'zh' ? '重新生成' : 'Regenerate'}
                </button>
              </div>
            </div>

            {/* Image display */}
            <div
              className="relative rounded-lg overflow-hidden border border-purple-100/60 bg-bg-elevated cursor-pointer"
              onClick={() => gridImages[activeImageIdx] && setShowLightbox(true)}
            >
              {gridImages[activeImageIdx] ? (
                <div className="relative group">
                  <img
                    src={gridImages[activeImageIdx]}
                    alt="Grid Storyboard"
                    className="w-full h-auto object-contain"
                    style={{ maxHeight: '70vh' }}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                        <ZoomIn size={24} className="text-gray-700" />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="aspect-[9/16] flex flex-col items-center justify-center">
                  {isGenerating ? (
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 size={32} className="animate-spin text-purple-400" />
                      <span className="text-sm text-text-tertiary">
                        {displayLang === 'zh' ? '九宫格分镜图片生成中...' : 'Generating grid storyboard...'}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <Film size={32} className="text-purple-200" />
                      <span className="text-sm text-text-tertiary">
                        {displayLang === 'zh' ? '点击上方"生成"按钮获取九宫格图片' : 'Click "Generate" above to create grid image'}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Panel descriptions - editable with per-panel redraw */}
            {panels.length > 0 && (
              <div className="pt-2 border-t border-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-text-tertiary font-medium">
                    {displayLang === 'zh' ? '分镜描述（可编辑 / 可单独重绘）' : 'Panel Descriptions (editable / redrawable)'}
                  </span>
                  <span className="text-[9px] text-text-tertiary bg-bg-elevated px-1.5 py-0.5 rounded">
                    {displayLang === 'zh' ? '✏️ 点击编辑 🔄 重绘' : '✏️ Edit 🔄 Redraw'}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {panels.map((panel, idx) => (
                    <div
                      key={panel.panel_number}
                      className={`rounded-lg p-2.5 border transition-colors ${
                        redrawPanelIdx === idx
                          ? 'border-orange-300 bg-orange-50/50'
                          : 'border-purple-100/60 bg-bg-elevated hover:border-purple-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-purple-500 text-white text-[9px] font-bold">
                            {panel.panel_number}
                          </span>
                          <span className="text-[10px] text-purple-600 font-medium">
                            {displayLang === 'zh' ? '镜' : 'Panel'}
                          </span>
                        </div>
                        <button
                          onClick={() => handleRedrawPanel(idx)}
                          disabled={redrawPanelIdx === idx}
                          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] text-orange-500 hover:bg-orange-50 transition-colors disabled:opacity-50"
                          title={displayLang === 'zh' ? '单独重绘此镜' : 'Redraw this panel'}
                        >
                          {redrawPanelIdx === idx ? (
                            <Loader2 size={9} className="animate-spin" />
                          ) : (
                            <RefreshCw size={9} />
                          )}
                          <span>{displayLang === 'zh' ? '重绘' : 'Redraw'}</span>
                        </button>
                      </div>
                      <textarea
                        value={panel.scene_description}
                        onChange={(e) => handleUpdatePanel(idx, 'scene_description', e.target.value)}
                        rows={2}
                        className="w-full px-2 py-1 rounded-md border border-purple-100 bg-white text-[10px] text-text-primary resize-none focus:outline-none focus:border-purple-300 focus:ring-1 focus:ring-purple-200"
                        placeholder={displayLang === 'zh' ? '描述这个镜头...' : 'Describe this scene...'}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Lightbox */}
      {showLightbox && gridImages[activeImageIdx] && (
        <div
          className="fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center animate-fade-in"
          onClick={() => setShowLightbox(false)}
        >
          <div className="relative w-full h-full flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowLightbox(false)}
              className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
            >
              <X size={20} />
            </button>

            {/* Image navigation for multiple images */}
            {gridImages.length > 1 && activeImageIdx > 0 && (
              <button
                onClick={() => setActiveImageIdx(i => i - 1)}
                className="absolute left-4 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
              >
                <ChevronLeft size={24} />
              </button>
            )}

            <img
              src={gridImages[activeImageIdx]}
              alt="Grid Storyboard"
              className="max-w-full max-h-full object-contain rounded-lg"
            />

            {gridImages.length > 1 && activeImageIdx < gridImages.length - 1 && (
              <button
                onClick={() => setActiveImageIdx(i => i + 1)}
                className="absolute right-4 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
              >
                <ChevronRight size={24} />
              </button>
            )}

            {/* Bottom actions */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3">
              {gridImages.length > 1 && (
                <span className="px-3 py-2 rounded-xl bg-black/60 text-white text-sm font-medium">
                  {activeImageIdx + 1} / {gridImages.length}
                </span>
              )}
              <button
                onClick={() => handleDownload()}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/90 text-gray-800 text-sm font-medium hover:bg-white transition-colors"
              >
                <Download size={16} /> {displayLang === 'zh' ? '下载' : 'Download'}
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(fullPrompt);
                  onSuccess('提示词已复制');
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/90 text-gray-800 text-sm font-medium hover:bg-white transition-colors"
              >
                <Copy size={16} /> {displayLang === 'zh' ? '复制提示词' : 'Copy Prompt'}
              </button>
              <button
                onClick={handleRegenerate}
                disabled={isGenerating}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 transition-colors disabled:opacity-50"
              >
                {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                {displayLang === 'zh' ? '重新生成' : 'Regenerate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ClockIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
