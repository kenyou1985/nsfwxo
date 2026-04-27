import React, { useState, useCallback, useEffect, useRef } from 'react';
import { extractVideoPromptFromImagePrompt } from '../utils/videoPromptExtractor';
import {
  Wand2, Shuffle, LayoutList, Copy, Check, Loader2,
  ChevronDown, ChevronUp, Sparkles, RotateCcw, Send,
  AlertCircle, Settings, Eye, Tag, History, Trash2, Plus, Clock,
  Image, Zap, X, Download, User, Heart, Star, Clapperboard,
  ChevronLeft, ChevronRight, Video, ZoomIn, RefreshCw,
} from 'lucide-react';
import {
  expandPrompt,
  randomPrompt,
  generateStoryboard,
  generateStoryboardThemes,
  generateStoryboardOutline,
  generateVideoScript,
  listStoryboardThemes,
  pollPromptTask,
  type PromptTaskStatus,
  PromptResult,
} from '../services/promptApi';
import {
  getYunwuKey,
  getExpandHistory, addExpandHistory, removeExpandHistory, clearExpandHistory,
  getRandomHistory, addRandomHistory, removeRandomHistory, clearRandomHistory,
  getStoryboardHistory, addStoryboardHistory, removeStoryboardHistory, clearStoryboardHistory,
  updateStoryboardHistoryImages,
  getExpandSession, saveExpandSession, clearExpandSession,
  getRandomSession, saveRandomSession, clearRandomSession,
  getStoryboardSession, saveStoryboardSession, clearStoryboardSession,
  cacheStoryboardPanelImages, getAllCachedPanelImages,
  addFavorite, removeFavorite, getFavorites, clearFavorites, isFavorited,
  type ExpandHistoryItem, type RandomHistoryItem, type StoryboardHistoryItem, type FavoriteItem,
  resolvePanelImages,
} from '../services/storage';
import { loadCachedOrExtractPanelImages } from '../services/imageCacheService';
import { useFinishedTaskImages } from '../contexts/FinishedTaskImagesContext';
import type { TaskManagerReturn } from '../hooks/useTaskManager';
import type { GirlfriendPreset } from '../data/girlfriendPresets';
import { GirlfriendSelector } from '../components/GirlfriendSelector';
import { StoryboardSection } from '../components/StoryboardSection';
import { buildTxt2ImgNodeList } from '../utils/txt2imgNodeBuilder';
import type { QueuedTask, TabType, NodeInfo } from '../types';
import { DEFAULT_TXT2IMG_PARAMS, QUALITY_BOOST_PROMPT } from '../constants';
import { WORKFLOW, getWorkflowFormat, uploadImage, ensureDataUrl } from '../services/runninghub';

type PromptMode = 'expand' | 'random' | 'storyboard';

interface AIPromptPageProps {
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  onOpenSettings?: () => void;
  taskManager: TaskManagerReturn;
  apiKey: string;
  onNavigate?: (tab: TabType) => void;
}

export function AIPromptPage({ onError, onSuccess, onOpenSettings, taskManager, apiKey, onNavigate }: AIPromptPageProps) {
  const [activeMode, setActiveMode] = useState<PromptMode>('expand');
  const [loading, setLoading] = useState(false);
  const [yunwuConfigured] = useState(() => !!getYunwuKey());
  const [r18Mode, setR18Mode] = useState(false);
  const [digitalHumanMode, setDigitalHumanMode] = useState(false);
  const [selectedGirlfriend, setSelectedGirlfriend] = useState<GirlfriendPreset | null>(null);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Mode Tabs */}
      <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
        <div className="flex">
          <ModeTab label="智能扩写" icon={<Wand2 size={14} />} active={activeMode === 'expand'} onClick={() => setActiveMode('expand')} />
          <ModeTab label="随机抽卡" icon={<Shuffle size={14} />} active={activeMode === 'random'} onClick={() => setActiveMode('random')} />
          <ModeTab label="剧情分镜" icon={<LayoutList size={14} />} active={activeMode === 'storyboard'} onClick={() => setActiveMode('storyboard')} />
        </div>
      </div>

      {/* Yunwu Key not configured warning */}
      {!yunwuConfigured && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3">
          <AlertCircle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800">请先配置 Yunwu AI API Key</p>
            <p className="text-xs text-amber-600 mt-0.5">AI 提示词功能需要 Yunwu AI Key 才能使用，请在右上角设置中填入。</p>
          </div>
          {onOpenSettings && (
            <button onClick={onOpenSettings} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-medium hover:bg-amber-600 transition-colors flex-shrink-0">
              <Settings size={12} />去设置
            </button>
          )}
        </div>
      )}

      {/* R18 Toggle */}
      <div className="rounded-2xl bg-white border border-border shadow-card px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Eye size={15} className={r18Mode ? 'text-red-500' : 'text-text-tertiary'} />
            <div>
              <span className="text-sm font-medium text-text-primary">R18 模式</span>
              <p className="text-xs text-text-tertiary -mt-0.5">{r18Mode ? '已启用：将优先抽取 NSFW 标签，生成成人内容提示词' : '关闭：生成普通风格提示词'}</p>
            </div>
          </div>
          <button
            onClick={() => setR18Mode(!r18Mode)}
            className={`relative w-12 h-6 rounded-full transition-all duration-300 flex-shrink-0 ${r18Mode ? 'bg-red-500' : 'bg-gray-300'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all duration-300 ${r18Mode ? 'left-[26px]' : 'left-0.5'}`} />
          </button>
        </div>
      </div>

      {/* 数字人锚定开关 - 放在顶部显眼位置 */}
      <div className={`rounded-2xl border shadow-card overflow-hidden transition-colors ${digitalHumanMode ? 'bg-red-50/40 border-red-300' : 'bg-white border-border'}`}>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${digitalHumanMode ? 'bg-red-500' : 'bg-bg-elevated border border-border'}`}>
              <User size={16} className={digitalHumanMode ? 'text-white' : 'text-text-tertiary'} />
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">数字人锚定</p>
              <p className="text-[11px] text-text-tertiary">{digitalHumanMode ? '已启用：锚定 AI 女友角色生成提示词' : '关闭：不锚定角色身份，生图使用文生图'}</p>
            </div>
          </div>
          <button
            onClick={() => { setDigitalHumanMode(!digitalHumanMode); if (digitalHumanMode) setSelectedGirlfriend(null); }}
            className={`relative w-12 h-6 rounded-full transition-all duration-300 flex-shrink-0 ${digitalHumanMode ? 'bg-red-500' : 'bg-gray-300'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-300 ${digitalHumanMode ? 'left-[26px]' : 'left-0.5'}`} />
          </button>
        </div>
        {digitalHumanMode && (
          <div className="px-4 pb-4">
            {selectedGirlfriend ? (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white border border-border">
                <img
                  src={selectedGirlfriend.thumbnailUrl || selectedGirlfriend.portraitUrl}
                  alt={selectedGirlfriend.nameZh}
                  className="w-11 h-11 rounded-full object-cover border-2 border-red-300"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary">{selectedGirlfriend.nameZh || selectedGirlfriend.name}</p>
                  <p className="text-xs text-text-tertiary">{selectedGirlfriend.description}</p>
                </div>
                <button
                  onClick={() => setSelectedGirlfriend(null)}
                  className="w-8 h-8 rounded-full bg-bg-elevated flex items-center justify-center text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <GirlfriendSelector
                apiKey={apiKey}
                selectedId={null}
                onSelect={(gf) => setSelectedGirlfriend(gf)}
              />
            )}
          </div>
        )}
      </div>

      {activeMode === 'expand' && <ExpandMode onError={onError} onSuccess={onSuccess} loading={loading} setLoading={setLoading} r18Mode={r18Mode} taskManager={taskManager} apiKey={apiKey} digitalHumanMode={digitalHumanMode} selectedGirlfriend={selectedGirlfriend} onNavigate={onNavigate} setDigitalHumanMode={setDigitalHumanMode} setSelectedGirlfriend={setSelectedGirlfriend} />}
      {activeMode === 'random' && <RandomMode onError={onError} onSuccess={onSuccess} loading={loading} setLoading={setLoading} r18Mode={r18Mode} taskManager={taskManager} apiKey={apiKey} digitalHumanMode={digitalHumanMode} selectedGirlfriend={selectedGirlfriend} onNavigate={onNavigate} setDigitalHumanMode={setDigitalHumanMode} setSelectedGirlfriend={setSelectedGirlfriend} />}
      {activeMode === 'storyboard' && <StoryboardMode onError={onError} onSuccess={onSuccess} loading={loading} setLoading={setLoading} r18Mode={r18Mode} taskManager={taskManager} apiKey={apiKey} digitalHumanMode={digitalHumanMode} selectedGirlfriend={selectedGirlfriend} onNavigate={onNavigate} setDigitalHumanMode={setDigitalHumanMode} setSelectedGirlfriend={setSelectedGirlfriend} />}
    </div>
  );
}

function ModeTab({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-all ${active ? 'text-primary bg-primary/5 border-b-2 border-primary' : 'text-text-tertiary hover:text-text-primary hover:bg-bg-hover'}`}>
      {icon}<span>{label}</span>
    </button>
  );
}

// ─── Image Generate Utilities ─────────────────────────────────────────────────

interface GenerateState {
  [resultId: string]: {
    loading: boolean;
    images: string[];
    taskId: string | null;
  };
}

function useGenerateState() {
  return useState<GenerateState>({});
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

// ─── Expand Mode ─────────────────────────────────────────────────────────────

function ExpandMode({ onError, onSuccess, loading, setLoading, r18Mode, taskManager, apiKey, onNavigate, digitalHumanMode, setDigitalHumanMode, selectedGirlfriend, setSelectedGirlfriend }: {
  onError: (msg: string) => void; onSuccess: (msg: string) => void; loading: boolean; setLoading: (v: boolean) => void; r18Mode: boolean;
  taskManager: TaskManagerReturn; apiKey: string; onNavigate?: (tab: TabType) => void;
  digitalHumanMode: boolean; setDigitalHumanMode: (v: boolean) => void; selectedGirlfriend: GirlfriendPreset | null; setSelectedGirlfriend: (gf: GirlfriendPreset | null) => void;
}) {
  const savedExpand = getExpandSession();
  const [input, setInput] = useState(savedExpand?.input || '');
  const [type, setType] = useState<'image' | 'video'>(savedExpand?.type || 'image');
  const [count, setCount] = useState(savedExpand?.count || 5);
  const [results, setResults] = useState<{ id: string; original: string; prompt: string; r18: boolean }[]>(savedExpand?.results || []);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<ExpandHistoryItem[]>(() => getExpandHistory());
  // Safety net: reload history on mount (covers cases where init state missed localStorage)
  useEffect(() => { setHistory(getExpandHistory()); }, []);
  const [genState, setGenState] = useState<GenerateState>({});
  const [genStates, setGenStates] = useState<Record<string, { loading: boolean; images: string[] }>>({});
  const [sbHistoryId, setSbHistoryId] = useState<string | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [outputPrompts, setOutputPrompts] = useState<string[]>(savedExpand?.outputPrompts || []);
  const [selectedOutputIdx, setSelectedOutputIdx] = useState(savedExpand?.selectedOutputIdx || 0);
  const [outputText, setOutputText] = useState(savedExpand?.outputText || '');
  const [generatingMain, setGeneratingMain] = useState(false);
  const [girlfriendUploading, setGirlfriendUploading] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteItem[]>(() => getFavorites());

  const handleToggleFavorite = useCallback((imageUrl: string, prompt?: string) => {
    // Use imageRef for lookup since addFavorite stores the URL in imageRef field
    const existing = favorites.find((f) => f.imageRef === imageUrl);
    if (existing) {
      removeFavorite(existing.id);
      setFavorites(getFavorites());
    } else {
      const added = addFavorite({ imageUrl, prompt, source: 'expand', r18: r18Mode });
      if (!added) {
        console.error('[handleToggleFavorite] addFavorite returned false — URL mismatch or duplicate:', imageUrl.slice(0, 80));
      }
      setFavorites(getFavorites());
    }
  }, [favorites, r18Mode]);

  // Persist expand state to sessionStorage so it survives page switches
  useEffect(() => {
    if (input || results.length > 0 || outputText) {
      saveExpandSession({ input, type, count, results, outputPrompts, selectedOutputIdx, outputText });
    } else {
      clearExpandSession();
    }
  }, [input, type, count, results, outputPrompts, selectedOutputIdx, outputText]);

  // Sync restored tasks from taskManager to UI state (survives page refresh)
  useEffect(() => {
    setGenState((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const result of results) {
        const matchedTask = taskManager.tasks.find(
          (t) => t.prompt === result.prompt && (t.status === 'RUNNING' || t.status === 'QUEUEING')
        );
        if (matchedTask && !prev[result.id]) {
          next[result.id] = { loading: true, images: [], taskId: matchedTask.id };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [taskManager.tasks, results]);

  const handleGenerate = async () => {
    if (!input.trim()) { onError('请输入描述内容'); return; }
    setLoading(true);
    try {
      const res = await expandPrompt(
        input.trim(), type, r18Mode, count, 0,
        digitalHumanMode ? selectedGirlfriend?.portraitUrl : undefined,
        digitalHumanMode,
        digitalHumanMode ? selectedGirlfriend?.characterPrompt : undefined,
      );
      const newResults = res.results.map((r, i) => ({ id: `${Date.now()}-${i}`, original: r.original, prompt: r.prompt, r18: r.r18 }));
      setResults(newResults);
      addExpandHistory({
        original: input.trim(),
        type,
        r18: r18Mode,
        prompts: res.results.map((r) => r.prompt),
      });
      setHistory(getExpandHistory());
      const prompts = res.results.map((r) => r.prompt);
      setOutputPrompts(prompts);
      setSelectedOutputIdx(0);
      setOutputText(prompts[0] || '');
      onSuccess(`成功生成 ${res.results.length} 个提示词`);
    } catch (err) {
      onError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => { setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); });
  };

  const handleDeleteHistory = (id: string) => { removeExpandHistory(id); setHistory(getExpandHistory()); };

  const handleHistoryLoad = (item: ExpandHistoryItem) => {
    setInput(item.original);
    setResults((item.prompts ?? []).map((prompt, i) => ({
      id: `hist-${item.id}-${i}`,
      original: item.original,
      prompt,
      r18: item.r18,
    })));
    const prompts = item.prompts ?? [];
    setOutputPrompts(prompts);
    setSelectedOutputIdx(0);
    setOutputText(prompts[0] || '');
    setShowHistory(false);
  };

  const handleOutputSelect = (idx: number) => {
    setSelectedOutputIdx(idx);
    setOutputText(outputPrompts[idx] || '');
  };

  const handleOutputTextChange = (text: string) => {
    setOutputText(text);
    const newPrompts = [...outputPrompts];
    newPrompts[selectedOutputIdx] = text;
    setOutputPrompts(newPrompts);
    setResults((prev) => prev.map((r, i) => i === selectedOutputIdx ? { ...r, prompt: text } : r));
  };

  const handleMainGenerateImage = useCallback(async () => {
    if (!outputText.trim()) { onError('请先生成或选择一个扩写提示词'); return; }
    if (taskManager.isFull) {
      onError('任务队列已满（最多 20 个任务），请等待当前任务完成');
      return;
    }
    setGeneratingMain(true);
    try {
      let imagePath = selectedGirlfriend?.portraitUrl || '';
      if (digitalHumanMode && selectedGirlfriend) {
        setGirlfriendUploading(true);
        try {
          const res = await fetch(selectedGirlfriend.portraitUrl);
          const blob = await res.blob();
          const file = new File([blob], `${selectedGirlfriend.id}.jpg`, { type: blob.type || 'image/jpeg' });
          const result = await uploadImage(apiKey, file);
          imagePath = result.imagePath;
        } catch {
          onError('AI 女友图片上传失败，请重试');
          return;
        } finally {
          setGirlfriendUploading(false);
        }
      }
      if (digitalHumanMode && selectedGirlfriend) {
        const nodes = [
        { nodeId: '7', fieldName: 'image', fieldValue: imagePath, description: 'image' },
        { nodeId: '9', fieldName: 'batch_size', fieldValue: String(DEFAULT_TXT2IMG_PARAMS.imageCount), description: 'batch_size' },
        { nodeId: '33', fieldName: 'text', fieldValue: outputText, description: 'text' },
      ];
      await taskManager.addTask('img2img', nodes, outputText, WORKFLOW.IMAGE_TO_IMAGE);
        onSuccess('任务已提交，请到图生图查看生成结果');
        if (onNavigate) onNavigate('img2img');
      } else {
        const nodes = buildTxt2ImgNodeList({
          width: DEFAULT_TXT2IMG_PARAMS.width,
          height: DEFAULT_TXT2IMG_PARAMS.height,
          imageCount: DEFAULT_TXT2IMG_PARAMS.imageCount,
          prompt: outputText,
          lora1Name: DEFAULT_TXT2IMG_PARAMS.lora1Name,
          lora1Weight: DEFAULT_TXT2IMG_PARAMS.lora1Weight,
          lora2Name: DEFAULT_TXT2IMG_PARAMS.lora2Name,
          lora2Weight: DEFAULT_TXT2IMG_PARAMS.lora2Weight,
        });
        await taskManager.addTask('txt2img', nodes, outputText);
        onSuccess('任务已提交，请到文生图查看生成结果');
        if (onNavigate) onNavigate('txt2img');
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setGeneratingMain(false);
    }
  }, [outputText, taskManager, onError, onSuccess, digitalHumanMode, selectedGirlfriend, apiKey, onNavigate]);

  const handleExpandGenerateImage = useCallback(async (result: { id: string; prompt: string }) => {
    if (taskManager.isFull) {
      onError('任务队列已满（最多 20 个任务），请等待当前任务完成');
      return;
    }
    setGenState((prev) => ({ ...prev, [result.id]: { loading: true, images: [], taskId: null } }));
    let imagePath = selectedGirlfriend?.portraitUrl || '';
    if (digitalHumanMode && selectedGirlfriend) {
      try {
        const res = await fetch(selectedGirlfriend.portraitUrl);
        const blob = await res.blob();
        const file = new File([blob], `${selectedGirlfriend.id}.jpg`, { type: blob.type || 'image/jpeg' });
        const uploadResult = await uploadImage(apiKey, file);
        imagePath = uploadResult.imagePath;
      } catch {
        setGenState((prev) => {
          const next = { ...prev };
          delete next[result.id];
          return next;
        });
        onError('AI 女友图片上传失败，请重试');
        return;
      }
    }
    if (digitalHumanMode && selectedGirlfriend) {
      const nodes = [
        { nodeId: '7', fieldName: 'image', fieldValue: imagePath, description: 'image' },
        { nodeId: '9', fieldName: 'batch_size', fieldValue: String(DEFAULT_TXT2IMG_PARAMS.imageCount), description: 'batch_size' },
        { nodeId: '33', fieldName: 'text', fieldValue: result.prompt, description: 'text' },
      ];
      try {
        await taskManager.addTask('img2img', nodes, result.prompt, WORKFLOW.IMAGE_TO_IMAGE);
        onSuccess('任务已提交，请到图生图查看生成结果');
        if (onNavigate) onNavigate('img2img');
      } catch (err) {
        onError(err instanceof Error ? err.message : '提交失败');
        setGenState((prev) => {
          const next = { ...prev };
          delete next[result.id];
          return next;
        });
      }
    } else {
      const nodes = buildTxt2ImgNodeList({
        width: DEFAULT_TXT2IMG_PARAMS.width,
        height: DEFAULT_TXT2IMG_PARAMS.height,
        imageCount: DEFAULT_TXT2IMG_PARAMS.imageCount,
        prompt: result.prompt,
        lora1Name: DEFAULT_TXT2IMG_PARAMS.lora1Name,
        lora1Weight: DEFAULT_TXT2IMG_PARAMS.lora1Weight,
        lora2Name: DEFAULT_TXT2IMG_PARAMS.lora2Name,
        lora2Weight: DEFAULT_TXT2IMG_PARAMS.lora2Weight,
      });
      try {
        await taskManager.addTask('txt2img', nodes, result.prompt);
        onSuccess('任务已提交，请到文生图查看生成结果');
        if (onNavigate) onNavigate('txt2img');
      } catch (err) {
        onError(err instanceof Error ? err.message : '提交失败');
        setGenState((prev) => {
          const next = { ...prev };
          delete next[result.id];
          return next;
        });
      }
    }
  }, [taskManager, onError, onSuccess, digitalHumanMode, selectedGirlfriend, apiKey, onNavigate]);

  const handleBatchGenerate = useCallback(async () => {
    if (results.length === 0) return;
    const availableSlots = 20 - taskManager.tasks.length;
    if (availableSlots <= 0) {
      onError('任务队列已满，请等待当前任务完成');
      return;
    }
    setBatchLoading(true);
    let submitted = 0;
    let imagePath = selectedGirlfriend?.portraitUrl || '';
    if (digitalHumanMode && selectedGirlfriend) {
      try {
        const res = await fetch(selectedGirlfriend.portraitUrl);
        const blob = await res.blob();
        const file = new File([blob], `${selectedGirlfriend.id}.jpg`, { type: blob.type || 'image/jpeg' });
        const uploadResult = await uploadImage(apiKey, file);
        imagePath = uploadResult.imagePath;
      } catch {
        setBatchLoading(false);
        onError('AI 女友图片上传失败，请重试');
        return;
      }
    }
    const toSubmit = results.slice(0, availableSlots);
    const tasks = toSubmit.map(async (result) => {
      if (digitalHumanMode && selectedGirlfriend) {
        const nodes = [
          { nodeId: '7', fieldName: 'image', fieldValue: imagePath, description: 'image' },
          { nodeId: '9', fieldName: 'batch_size', fieldValue: String(DEFAULT_TXT2IMG_PARAMS.imageCount), description: 'batch_size' },
          { nodeId: '33', fieldName: 'text', fieldValue: result.prompt, description: 'text' },
        ];
        await taskManager.addTask('img2img', nodes, result.prompt, WORKFLOW.IMAGE_TO_IMAGE);
      } else {
        const nodes = buildTxt2ImgNodeList({
          width: DEFAULT_TXT2IMG_PARAMS.width,
          height: DEFAULT_TXT2IMG_PARAMS.height,
          imageCount: DEFAULT_TXT2IMG_PARAMS.imageCount,
          prompt: result.prompt,
          lora1Name: DEFAULT_TXT2IMG_PARAMS.lora1Name,
          lora1Weight: DEFAULT_TXT2IMG_PARAMS.lora1Weight,
          lora2Name: DEFAULT_TXT2IMG_PARAMS.lora2Name,
          lora2Weight: DEFAULT_TXT2IMG_PARAMS.lora2Weight,
        });
        await taskManager.addTask('txt2img', nodes, result.prompt);
      }
    });
    const results_await = await Promise.allSettled(tasks);
    submitted = results_await.filter((r) => r.status === 'fulfilled').length;
    results_await.forEach((r, i) => {
      if (r.status === 'rejected') {
        onError(`提交第 ${i + 1} 个时失败: ${r.reason instanceof Error ? r.reason.message : '未知错误'}`);
      }
    });
    setBatchLoading(false);
    if (submitted > 0) {
      onSuccess(`已提交 ${submitted} 个生图任务`);
      if (digitalHumanMode && selectedGirlfriend) {
        if (onNavigate) onNavigate('img2img');
      } else {
        if (onNavigate) onNavigate('txt2img');
      }
    }
  }, [results, taskManager, onError, onSuccess, digitalHumanMode, selectedGirlfriend, apiKey, onNavigate]);

  // Handles single-panel image generation from StoryboardSection (ExpandMode version).
  // Reuses the same logic as handleGenerateStoryboard but for a single panel.
  const handleExpandModeSinglePanelGenerate = useCallback(async (panelIdx: number, prompt: string) => {
    console.log(`[handleExpandModeSinglePanelGenerate] panelIdx=${panelIdx}, digitalHumanMode=${digitalHumanMode}, selectedGirlfriend=${!!selectedGirlfriend}, prompt length=${prompt.length}, prompt="${prompt.slice(0, 80)}"`);
    if (!prompt.trim()) {
      onError('分镜内容为空，请先生成分镜');
      return;
    }
    if (taskManager.isFull) { onError('任务队列已满'); return; }

    // Determine or create a historyId for this storyboard
    let hid = sessionStorage.getItem('sb_latest_history_id') || sbHistoryId;
    if (!hid) {
      // Create a minimal history entry so we have a valid historyId
      hid = `expand_${Date.now()}`;
      sessionStorage.setItem('sb_latest_history_id', hid);
      setSbHistoryId(hid);
    }

    const key = `${hid}_${panelIdx}`;
    const storyboardInfo = { historyId: hid, panelIdx };
    setGenStates((prev) => ({ ...prev, [key]: { loading: true, images: [] } }));
    let imagePath = selectedGirlfriend?.portraitUrl || '';
    if (digitalHumanMode && selectedGirlfriend) {
      try {
        const res = await fetch(selectedGirlfriend.portraitUrl);
        const blob = await res.blob();
        const file = new File([blob], `${selectedGirlfriend.id}.jpg`, { type: blob.type || 'image/jpeg' });
        const uploadResult = await uploadImage(apiKey, file);
        imagePath = uploadResult.imagePath;
      } catch {
        setGenStates((prev) => { const next = { ...prev }; delete next[key]; return next; });
        onError('AI 女友图片上传失败'); return;
      }
    }
    if (digitalHumanMode && selectedGirlfriend) {
      const charId = (selectedGirlfriend.id as string).toUpperCase().slice(0, 4);
      const anchorPrompt = `【严格锁定】严格锁定图中22岁女性（ID:${charId}），完全保留原有面部特征，五官轮廓、脸型、眼睛、鼻子、嘴唇、发型、肤色、身材比例完全不变，不做任何面部修改，动作流畅不僵硬。超高清8K，写实细节，皮肤质感细腻，无畸变、无模糊、无穿模。`;
      const finalPrompt = `${anchorPrompt}\n\n${prompt}`;
      const nodes = [
        { nodeId: '7', fieldName: 'image', fieldValue: imagePath, description: 'image' },
        { nodeId: '9', fieldName: 'batch_size', fieldValue: String(DEFAULT_TXT2IMG_PARAMS.imageCount), description: 'batch_size' },
        { nodeId: '33', fieldName: 'text', fieldValue: finalPrompt, description: 'text' },
      ];
      try {
        await taskManager.addTask('img2img', nodes, finalPrompt, WORKFLOW.IMAGE_TO_IMAGE, undefined, storyboardInfo);
        onSuccess('分镜图片任务已提交');
      } catch (err) {
        onError(err instanceof Error ? err.message : '提交失败');
        setGenStates((prev) => { const next = { ...prev }; delete next[key]; return next; });
      }
    } else {
      const finalPrompt = `${QUALITY_BOOST_PROMPT}, ${prompt}`;
      const nodes = buildTxt2ImgNodeList({
        width: DEFAULT_TXT2IMG_PARAMS.width,
        height: DEFAULT_TXT2IMG_PARAMS.height,
        imageCount: DEFAULT_TXT2IMG_PARAMS.imageCount,
        prompt: finalPrompt,
        lora1Name: DEFAULT_TXT2IMG_PARAMS.lora1Name,
        lora1Weight: DEFAULT_TXT2IMG_PARAMS.lora1Weight,
        lora2Name: DEFAULT_TXT2IMG_PARAMS.lora2Name,
        lora2Weight: DEFAULT_TXT2IMG_PARAMS.lora2Weight,
      });
      try {
        await taskManager.addTask('txt2img', nodes, finalPrompt, undefined, undefined, storyboardInfo);
        console.log(`[handleExpandModeSinglePanelGenerate] submitted txt2img task, prompt length=${finalPrompt.length}`);
        onSuccess('分镜图片任务已提交');
      } catch (err) {
        onError(err instanceof Error ? err.message : '提交失败');
        setGenStates((prev) => { const next = { ...prev }; delete next[key]; return next; });
      }
    }
  }, [taskManager, onError, onSuccess, digitalHumanMode, selectedGirlfriend, apiKey, sbHistoryId]);

  // Handle direct video generation from storyboard panel in ExpandMode.
  // Reuses the ImageToVideoPage logic by writing to sessionStorage and navigating.
  const handleExpandModeGenerateVideo = useCallback(async (panelKey: string, imageUrl: string, prompt: string) => {
    console.log(`[handleExpandModeGenerateVideo] panelKey=${panelKey}, imageUrl=${imageUrl.slice(0, 50)}, prompt length=${prompt.length}`);

    // Generate video prompt from image prompt
    const videoPrompt = extractVideoPromptFromImagePrompt(prompt, r18Mode);
    console.log(`[handleExpandModeGenerateVideo] videoPrompt="${videoPrompt}"`);

    // Upload image if needed (data URL or blob URL)
    let imagePath = imageUrl;
    if (imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) {
      try {
        const resp = await fetch(imageUrl);
        const blob = await resp.blob();
        const file = new File([blob], `storyboard_${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' });
        const { imagePath: uploadedPath } = await uploadImage(apiKey, file);
        imagePath = uploadedPath;
        console.log(`[handleExpandModeGenerateVideo] uploaded, imagePath=${imagePath}`);
      } catch (err) {
        console.error('[handleExpandModeGenerateVideo] upload failed:', err);
        onError('图片上传失败，请重试');
        return;
      }
    }

    // Safety check
    if (!imagePath || imagePath.length > 300) {
      console.error('[handleExpandModeGenerateVideo] Invalid imagePath:', imagePath?.slice(0, 100));
      onError('图片路径无效，请重新选择图片');
      return;
    }

    // Store in sessionStorage and navigate to ImageToVideoPage (same pattern as existing storyboard_img2vid)
    const data = JSON.stringify({ imageUrl, imagePath, prompt: videoPrompt });
    sessionStorage.setItem('storyboard_img2vid_direct', data);
    onNavigate?.('img2vid');
  }, [apiKey, onError, onNavigate, r18Mode]);

  const handleGenerateStoryboard = useCallback(async (
    panels: { panel_number: number; scene_description: string; image_prompt: string }[],
    sceneName: string,
    isR18: boolean,
    onSuccessMsg: (msg: string) => void,
    onErrorMsg: (msg: string) => void,
  ) => {
    if (panels.length === 0) { onErrorMsg('没有可生成的分镜'); return; }
    const availableSlots = 20 - taskManager.tasks.length;
    if (availableSlots <= 0) { onErrorMsg('任务队列已满'); return; }

    const newHistoryId = addStoryboardHistory({
      plot: sceneName,
      panel_count: panels.length,
      r18: isR18,
      panels,
    });

    sessionStorage.setItem('sb_latest_history_id', newHistoryId);
    sessionStorage.setItem(`sb_panel_${newHistoryId}_submitted`, JSON.stringify(true));

    let imagePath = selectedGirlfriend?.portraitUrl || '';
    if (digitalHumanMode && selectedGirlfriend) {
      try {
        const res = await fetch(selectedGirlfriend.portraitUrl);
        const blob = await res.blob();
        const file = new File([blob], `${selectedGirlfriend.id}.jpg`, { type: blob.type || 'image/jpeg' });
        const uploadResult = await uploadImage(apiKey, file);
        imagePath = uploadResult.imagePath;
      } catch {
        onErrorMsg('AI 女友图片上传失败'); return;
      }
    }

    const toSubmit = panels.slice(0, availableSlots);
    const tasks = toSubmit.map((panel, i) => async () => {
      const panelIdx = i;
      const panelStoryboardInfo = { historyId: newHistoryId, panelIdx };
      if (digitalHumanMode && selectedGirlfriend) {
        const charId = (selectedGirlfriend.id as string).toUpperCase().slice(0, 4);
        const anchorPrompt = `【严格锁定】严格锁定图中22岁女性（ID:${charId}），完全保留原有面部特征，五官轮廓、脸型、眼睛、鼻子、嘴唇、发型、肤色、身材比例完全不变，不做任何面部修改，动作流畅不僵硬。超高清8K，写实细节，皮肤质感细腻，无畸变、无模糊、无穿模。`;
        const finalPrompt = `${anchorPrompt}\n\n${panel.image_prompt}`;
        const nodes = [
          { nodeId: '7', fieldName: 'image', fieldValue: imagePath, description: 'image' },
          { nodeId: '9', fieldName: 'batch_size', fieldValue: String(DEFAULT_TXT2IMG_PARAMS.imageCount), description: 'batch_size' },
          { nodeId: '33', fieldName: 'text', fieldValue: finalPrompt, description: 'text' },
        ];
        await taskManager.addTask('img2img', nodes, finalPrompt, WORKFLOW.IMAGE_TO_IMAGE, undefined, panelStoryboardInfo);
      } else {
        const finalPrompt = `${QUALITY_BOOST_PROMPT}, ${panel.image_prompt}`;
        const nodes = buildTxt2ImgNodeList({
          width: DEFAULT_TXT2IMG_PARAMS.width,
          height: DEFAULT_TXT2IMG_PARAMS.height,
          imageCount: DEFAULT_TXT2IMG_PARAMS.imageCount,
          prompt: finalPrompt,
          lora1Name: DEFAULT_TXT2IMG_PARAMS.lora1Name,
          lora1Weight: DEFAULT_TXT2IMG_PARAMS.lora1Weight,
          lora2Name: DEFAULT_TXT2IMG_PARAMS.lora2Name,
          lora2Weight: DEFAULT_TXT2IMG_PARAMS.lora2Weight,
        });
        await taskManager.addTask('txt2img', nodes, finalPrompt, undefined, undefined, panelStoryboardInfo);
      }
    });

    const settled = await Promise.allSettled(tasks.map((t) => t()));
    const submitted = settled.filter((r) => r.status === 'fulfilled').length;
    settled.forEach((r, i) => {
      if (r.status === 'rejected') {
        onErrorMsg(`提交第 ${i + 1} 个时失败: ${r.reason instanceof Error ? r.reason.message : '未知错误'}`);
      }
    });
    if (submitted > 0) {
      onSuccessMsg(`已提交 ${submitted} 个分镜生图任务`);
    }
  }, [taskManager, apiKey, digitalHumanMode, selectedGirlfriend]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white border border-border shadow-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className={r18Mode ? 'text-red-500' : 'text-primary'} />
            <span className="text-sm font-medium text-text-primary">
              输入简单描述
              {r18Mode && <span className="ml-2 text-xs text-red-500 font-medium">(R18)</span>}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowHistory(!showHistory)} className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium transition-all ${showHistory ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'}`}>
              <History size={12} />历史记录
            </button>
            <div className="flex gap-1">
              {(['image', 'video'] as const).map((t) => (
                <button key={t} onClick={() => setType(t)} className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${type === t ? 'bg-primary text-white' : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'}`}>{t === 'image' ? '生图' : '生视频'}</button>
              ))}
            </div>
          </div>
        </div>

        <textarea value={input} onChange={(e) => setInput(e.target.value)}
          placeholder={r18Mode ? '输入你的成人内容想法... 例如: 一个性感的护士...' : `输入你的 ${type === 'image' ? '图片' : '视频'} 想法...`}
          rows={3}
          className={`w-full border rounded-xl px-4 py-3 text-sm placeholder:text-text-secondary focus:outline-none transition-colors resize-none ${r18Mode ? 'bg-red-50/50 border-red-200 focus:border-red-400' : 'bg-bg-elevated border-border focus:border-primary'}`}
        />

        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs text-text-tertiary">生成数量:</span>
          <div className="flex gap-1">
            {[1, 3, 5, 8, 10].map((n) => (
              <button key={n} onClick={() => setCount(n)}
                className={`w-8 h-7 rounded-lg text-xs font-medium transition-all ${count === n ? (r18Mode ? 'bg-red-500 text-white' : 'bg-primary text-white') : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'}`}>{n}</button>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={handleGenerate} disabled={loading || !input.trim()}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all ${loading || !input.trim() ? 'bg-bg-elevated text-text-secondary cursor-not-allowed' : r18Mode ? 'bg-gradient-to-r from-red-500 to-red-600 text-white hover:opacity-90 active:scale-[0.98]' : 'bg-gradient-to-r from-primary to-primary/80 text-white hover:opacity-90 active:scale-[0.98]'}`}>
            {loading ? <><Loader2 size={16} className="animate-spin" /> 生成中...</> : <><Send size={16} />{r18Mode ? '生成 R18 提示词' : '开始生成'}</>}
          </button>
          {results.length > 0 && (
            <button onClick={() => { setInput(''); setResults([]); setOutputPrompts([]); setOutputText(''); setSelectedOutputIdx(0); clearExpandSession(); clearExpandHistory(); setHistory(getExpandHistory()); }}
              className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl font-medium text-sm bg-bg-elevated text-text-tertiary hover:bg-bg-hover transition-colors">
              <RotateCcw size={14} />清空
            </button>
          )}
        </div>
      </div>

      {/* Output Section - Only show when prompts are generated */}
      {outputPrompts.length > 0 && (
        <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
          {/* Output Tabs */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50 bg-bg-elevated overflow-x-auto">
            <span className={`px-2.5 py-0.5 rounded-full text-white text-[11px] font-bold bg-gradient-to-r ${r18Mode ? 'from-red-500 to-pink-500' : 'from-primary to-indigo-500'} flex-shrink-0`}>扩写</span>
            <div className="flex gap-1.5 overflow-x-auto">
              {outputPrompts.map((_, idx) => (
                <button key={idx} onClick={() => handleOutputSelect(idx)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-all flex-shrink-0 ${
                    selectedOutputIdx === idx
                      ? (r18Mode ? 'bg-red-500 text-white' : 'bg-primary text-white')
                      : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'
                  }`}>
                  {idx + 1}
                </button>
              ))}
            </div>
          </div>

          {/* Output Textarea */}
          <div className="p-4">
            <textarea
              value={outputText}
              onChange={(e) => handleOutputTextChange(e.target.value)}
              rows={6}
              className={`w-full border rounded-xl px-4 py-3 text-sm leading-relaxed placeholder:text-text-secondary focus:outline-none transition-colors resize-none font-mono ${r18Mode ? 'bg-red-50/50 border-red-200 focus:border-red-400 text-red-800' : 'bg-bg-elevated border-border focus:border-primary text-text-secondary'}`}
              placeholder="扩写后的提示词将显示在这里..."
            />
            <div className="flex gap-2 mt-3">
              <button onClick={() => navigator.clipboard.writeText(outputText).then(() => { onSuccess('已复制到剪贴板'); setTimeout(() => {}, 2000); })}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium transition-all ${r18Mode ? 'bg-red-50 text-red-500 hover:bg-red-100 border border-red-200' : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'}`}>
                <Copy size={12} />复制提示词
              </button>
              <button onClick={handleMainGenerateImage}
                disabled={generatingMain || !outputText.trim() || girlfriendUploading || (digitalHumanMode && !selectedGirlfriend)}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl font-medium text-sm transition-all ${
                  generatingMain || !outputText.trim() || girlfriendUploading || (digitalHumanMode && !selectedGirlfriend)
                    ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                    : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:opacity-90 active:scale-[0.98]'
                }`}>
                {girlfriendUploading ? <><Loader2 size={14} className="animate-spin" /> 上传参考图中...</> :
                 generatingMain ? <><Loader2 size={14} className="animate-spin" /> 提交中...</> :
                 digitalHumanMode && selectedGirlfriend ? <><Image size={14} />图生图锚定生图</> :
                 <><Image size={14} />基于此提示词生图</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expand History */}
      {showHistory && (
        <ExpandHistoryPanel
          history={history}
          r18Mode={r18Mode}
          onLoad={handleHistoryLoad}
          onDelete={handleDeleteHistory}
          onClear={() => { clearExpandHistory(); setHistory([]); }}
          onCopy={handleCopy}
        />
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          {/* Batch Generate Header */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-text-tertiary font-medium">提示词列表 · {results.length} 个</span>
            <button
              onClick={handleBatchGenerate}
              disabled={batchLoading || taskManager.isFull || (digitalHumanMode && !selectedGirlfriend)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                batchLoading || taskManager.isFull || (digitalHumanMode && !selectedGirlfriend)
                  ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:opacity-90 active:scale-[0.98]'
              }`}
            >
              {batchLoading ? <><Loader2 size={12} className="animate-spin" /> 提交中...</> : <><Zap size={12} />一键批量生图</>}
            </button>
          </div>
          {results.map((result) => (
            <ExpandResultCard
              key={result.id}
              result={result}
              r18Mode={r18Mode}
              isCopied={copiedId === result.id}
              genState={genState[result.id]}
              digitalHumanMode={digitalHumanMode}
              selectedGirlfriend={selectedGirlfriend}
              onCopy={() => handleCopy(result.id, result.prompt)}
              onDelete={() => {
                const idx = results.findIndex((r) => r.id === result.id);
                setResults((p) => p.filter((r) => r.id !== result.id));
                setOutputPrompts((p) => p.filter((_, i) => i !== idx));
                if (results.length === 1) {
                  setOutputText('');
                } else if (selectedOutputIdx >= results.length - 1) {
                  setSelectedOutputIdx(Math.max(0, results.length - 2));
                  setOutputText(outputPrompts[Math.max(0, results.length - 2)] || '');
                }
              }}
              onGenerateImage={() => handleExpandGenerateImage(result)}
              onUseAsOutput={() => {
                const idx = results.findIndex((r) => r.id === result.id);
                setSelectedOutputIdx(idx);
                setOutputText(result.prompt);
              }}
              onFavorited={(url) => handleToggleFavorite(url, result.prompt)}
              taskManager={taskManager}
            />
          ))}
        </div>
      )}

      {/* Smart Storyboard Section */}
      <StoryboardSection
        r18Enabled={r18Mode}
        selectedGirlfriend={selectedGirlfriend}
        displayLang="zh"
        disabled={taskManager.isFull || (digitalHumanMode && !selectedGirlfriend)}
        onGenerateStoryboard={handleGenerateStoryboard}
        onGenerateSingleImage={handleExpandModeSinglePanelGenerate}
        onGenerateVideo={(imageUrl, prompt, panelKey) => handleExpandModeGenerateVideo(panelKey, imageUrl, prompt)}
        onToggleFavorite={handleToggleFavorite}
        onSuccess={onSuccess}
        onError={onError}
      />
    </div>
  );
}

function ExpandHistoryPanel({ history, r18Mode, onLoad, onDelete, onClear, onCopy }: {
  history: ExpandHistoryItem[];
  r18Mode: boolean;
  onLoad: (h: ExpandHistoryItem) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onCopy: (id: string, text: string) => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const copy = (id: string, text: string) => { onCopy(id, text); setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); };

  return (
    <div className={`rounded-2xl bg-white border shadow-card overflow-hidden ${r18Mode ? 'border-red-200' : 'border-border'}`}>
      <div className={`flex items-center justify-between px-4 py-3 border-b ${r18Mode ? 'border-red-100 bg-red-50/40' : 'border-border/50 bg-bg-elevated'}`}>
        <div className="flex items-center gap-2">
          <History size={14} className={r18Mode ? 'text-red-500' : 'text-text-tertiary'} />
          <span className={`text-sm font-medium ${r18Mode ? 'text-red-600' : 'text-text-primary'}`}>扩写历史</span>
          <span className="px-2 py-0.5 rounded-full text-[11px] bg-bg-elevated text-text-tertiary">{history.length} 条</span>
        </div>
        {history.length > 0 && (
          <button onClick={onClear} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-all">
            <Trash2 size={11} />清空
          </button>
        )}
      </div>
      {history.length === 0 ? (
        <div className="px-4 py-8 text-center"><Clock size={24} className="mx-auto text-text-tertiary/40 mb-2" /><p className="text-sm text-text-tertiary">暂无历史记录</p></div>
      ) : (
        <div className="max-h-[500px] overflow-y-auto divide-y divide-border/50">
          {history.map((h) => (
            <div key={h.id}>
              <div className="flex items-center gap-2 px-4 py-3 hover:bg-bg-hover/30 transition-colors">
                <button onClick={() => onLoad(h)} className="flex-1 flex items-start gap-2 w-full min-w-0 text-left group">
                  <Plus size={13} className="flex-shrink-0 mt-0.5 text-text-tertiary group-hover:text-primary transition-colors" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-text-primary font-medium line-clamp-1">{h.original}</p>
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-bg-elevated text-text-tertiary flex-shrink-0">{(h.prompts ?? []).length} 个提示词</span>
                    </div>
                    <p className="text-[11px] text-text-tertiary mt-0.5">
                      {new Date(h.timestamp).toLocaleString('zh-CN')}
                    </p>
                  </div>
                </button>
                <button onClick={() => setExpandedId(expandedId === h.id ? null : h.id)}
                  className="p-1.5 rounded-lg text-text-tertiary hover:bg-bg-hover transition-all">
                  <span className={`transition-transform ${expandedId === h.id ? 'rotate-180' : ''}`}><ChevronDown size={14} /></span>
                </button>
                <button onClick={() => onDelete(h.id)} className="p-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-all">
                  <Trash2 size={13} />
                </button>
              </div>
              {expandedId === h.id && (
                <div className="px-4 pb-3 space-y-2">
                  {(h.prompts ?? []).map((prompt, pi) => (
                    <div key={pi} className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${r18Mode ? 'bg-red-50/60 text-red-800 border border-red-100' : 'bg-bg-elevated text-text-secondary'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-text-tertiary">{pi + 1}</span>
                        <button onClick={() => copy(`${h.id}-${pi}`, prompt)}
                          className={`flex items-center gap-1 text-[10px] transition-colors ${copiedId === `${h.id}-${pi}` ? 'text-green-500' : 'text-text-tertiary hover:text-primary'}`}>
                          {copiedId === `${h.id}-${pi}` ? <><Check size={10} />已复制</> : <><Copy size={10} />复制</>}
                        </button>
                      </div>
                      <p className="whitespace-pre-wrap">{prompt}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExpandResultCard({ result, r18Mode, isCopied, genState, onCopy, onDelete, onGenerateImage, onUseAsOutput, onFavorited, taskManager, digitalHumanMode, selectedGirlfriend }: {
  result: { id: string; original: string; prompt: string; r18: boolean };
  r18Mode: boolean; isCopied: boolean;
  genState?: { loading: boolean; images: string[]; taskId: string | null };
  onCopy: () => void; onDelete: () => void; onGenerateImage: () => void; onUseAsOutput: () => void;
  onFavorited?: (url: string) => void;
  taskManager: TaskManagerReturn;
  digitalHumanMode?: boolean; selectedGirlfriend?: GirlfriendPreset | null;
}) {
  const badge = r18Mode ? 'from-red-500 to-pink-500' : 'from-primary to-indigo-500';
  const isGenLoading = genState?.loading;
  const genImages = genState?.images ?? [];

  // Find related running tasks
  const relatedTasks = taskManager.tasks.filter(
    (t: QueuedTask) => t.status === 'RUNNING' || t.status === 'QUEUEING' || t.status === 'FINISHED'
  ).filter((t: QueuedTask) => t.prompt === result.prompt);

  const displayImages = genImages.length > 0 ? genImages : relatedTasks.flatMap((t: QueuedTask) => t.images);

  return (
    <div className={`rounded-2xl bg-white border shadow-card overflow-hidden ${r18Mode ? 'border-red-200' : 'border-border'}`}>
      <div className={`flex items-center gap-2 px-4 py-2.5 border-b ${r18Mode ? 'bg-red-50/60 border-red-100' : 'bg-bg-elevated border-border/50'}`}>
        <div className={`px-2.5 py-0.5 rounded-full text-white text-[11px] font-bold bg-gradient-to-r ${badge}`}>{r18Mode ? 'R18' : '提示词'}</div>
        <button onClick={onGenerateImage}
          disabled={isGenLoading || (digitalHumanMode && !selectedGirlfriend)}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex-shrink-0 ${
            isGenLoading || (digitalHumanMode && !selectedGirlfriend)
              ? 'bg-blue-100 text-blue-400 cursor-not-allowed'
              : 'bg-blue-500 text-white hover:bg-blue-600'
          }`}
        >
          {isGenLoading ? <Loader2 size={11} className="animate-spin" /> : <Image size={11} />}
          {digitalHumanMode && selectedGirlfriend ? '图生图' : '生图'}
        </button>
        <button onClick={onUseAsOutput}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex-shrink-0 ${r18Mode ? 'bg-red-50 text-red-500 hover:bg-red-100 border border-red-200' : 'bg-primary/8 text-primary hover:bg-primary/15 border border-primary/20'}`}
        >
          <Wand2 size={11} />
          应用
        </button>
        <button onClick={onDelete} className="p-1 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-all ml-auto"><Trash2 size={13} /></button>
      </div>
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3 mb-3">
          <p className={`text-sm leading-relaxed whitespace-pre-wrap flex-1 ${r18Mode ? 'text-red-700' : 'text-text-secondary'}`}>{result.prompt}</p>
          <button onClick={onCopy}
            className={`flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${isCopied ? 'bg-green-500/10 text-green-500' : r18Mode ? 'bg-red-50 text-red-500 hover:bg-red-100' : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover hover:text-text-primary'}`}>
            {isCopied ? <><Check size={12} /> 已复制</> : <><Copy size={12} /> 复制</>}
          </button>
        </div>

        {/* Generated images preview */}
        {displayImages.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-text-tertiary font-medium">生成结果</span>
              <span className="text-[10px] text-text-tertiary">{displayImages.length} 张</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {displayImages.slice(0, 6).map((img, idx) => (
                <AIGeneratedImagePreview key={idx} src={img} prompt={result.prompt} onFavorited={onFavorited} allImages={displayImages.slice(0, 6)} index={idx} />
              ))}
              {displayImages.length > 6 && (
                <div className="aspect-square rounded-lg bg-bg-elevated flex items-center justify-center text-xs text-text-tertiary">
                  +{displayImages.length - 6}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Running tasks status */}
        {relatedTasks.filter((t: QueuedTask) => t.status === 'RUNNING' || t.status === 'QUEUEING').length > 0 && displayImages.length === 0 && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <div className="flex items-center gap-2 text-xs text-blue-500">
              <Loader2 size={12} className="animate-spin" />
              正在生成中... {relatedTasks.filter((t: QueuedTask) => t.status === 'RUNNING' || t.status === 'QUEUEING').length} 个任务
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Random Mode ─────────────────────────────────────────────────────────────

function RandomMode({ onError, onSuccess, loading, setLoading, r18Mode, taskManager, apiKey, onNavigate, digitalHumanMode, setDigitalHumanMode, selectedGirlfriend, setSelectedGirlfriend }: {
  onError: (msg: string) => void; onSuccess: (msg: string) => void; loading: boolean; setLoading: (v: boolean) => void; r18Mode: boolean;
  taskManager: TaskManagerReturn; apiKey: string; onNavigate?: (tab: TabType) => void;
  digitalHumanMode: boolean; setDigitalHumanMode: (v: boolean) => void; selectedGirlfriend: GirlfriendPreset | null; setSelectedGirlfriend: (gf: GirlfriendPreset | null) => void;
}) {
  const savedRandom = getRandomSession();
  const [type, setType] = useState<'image' | 'video'>(savedRandom?.type || 'image');
  const [count, setCount] = useState(savedRandom?.count || 5);
  const [theme, setTheme] = useState(savedRandom?.theme || '');
  const [results, setResults] = useState<PromptResult[]>(savedRandom?.results || []);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(savedRandom?.expandedIdx ?? null);
  const [tagsVisible, setTagsVisible] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<RandomHistoryItem[]>(() => getRandomHistory());
  const [genStates, setGenStates] = useState<Record<number, { loading: boolean; images: string[] }>>({});
  const [batchLoading, setBatchLoading] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteItem[]>(() => getFavorites());

  const handleToggleFavorite = (imageUrl: string, prompt?: string) => {
    // Use imageRef for lookup since addFavorite stores the URL in imageRef field
    const existing = favorites.find((f) => f.imageRef === imageUrl);
    if (existing) {
      removeFavorite(existing.id);
      setFavorites(getFavorites());
    } else {
      addFavorite({ imageUrl, prompt, source: 'random', r18: r18Mode });
      setFavorites(getFavorites());
    }
  };

  // Persist random state to sessionStorage
  useEffect(() => {
    if (results.length > 0 || theme) {
      saveRandomSession({ type, count, theme, results, expandedIdx });
    } else {
      clearRandomSession();
    }
  }, [type, count, theme, results, expandedIdx]);

  // Sync restored tasks from taskManager to UI state (survives page refresh)
  useEffect(() => {
    setGenStates((prev) => {
      let changed = false;
      const next = { ...prev };
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const matchedTask = taskManager.tasks.find(
          (t) => t.prompt === result.prompt && (t.status === 'RUNNING' || t.status === 'QUEUEING')
        );
        if (matchedTask && !prev[i]) {
          next[i] = { loading: true, images: [] };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [taskManager.tasks, results]);

  const THEMES = [
    { key: '', label: '完全随机' },
    { key: '暗示优雅', label: '暗示优雅' },
    { key: '亲密温馨', label: '亲密温馨' },
    { key: '幻想Cos', label: '幻想Cos' },
    { key: '职场诱惑', label: '职场诱惑' },
    { key: '热恋情侣', label: '热恋情侣' },
    { key: '禁忌场景', label: '禁忌场景' },
    { key: '性感睡衣', label: '性感睡衣' },
    { key: '浴室氛围', label: '浴室氛围' },
    { key: '写真艺术', label: '写真艺术' },
    { key: '野外激情', label: '野外激情' },
    { key: '公车痴汉', label: '公车痴汉' },
    { key: '巷子尾随', label: '巷子尾随' },
    { key: '办公室偷情', label: '办公室偷情' },
    { key: 'SM调教', label: 'SM调教' },
    { key: '角色扮演', label: '角色扮演' },
    { key: '制服诱惑', label: '制服诱惑' },
    { key: '浴室缠绵', label: '浴室缠绵' },
    { key: '后入猛烈', label: '后入猛烈' },
    { key: '羞耻play', label: '羞耻play' },
  ];

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const res = await randomPrompt(
        type, r18Mode, count, theme,
        digitalHumanMode,
        digitalHumanMode ? selectedGirlfriend?.portraitUrl : undefined,
        digitalHumanMode ? selectedGirlfriend?.characterPrompt : undefined,
      );
      setResults(res.results);
      setExpandedIdx(null);
      addRandomHistory({
        type,
        r18: r18Mode,
        theme,
        results: res.results.map((r) => ({
          prompt: r.prompt,
          tags_used: r.tags_used,
          theme_label: r.theme_label,
        })),
      });
      setHistory(getRandomHistory());
      const themeName = THEMES.find((t) => t.key === theme)?.label || '完全随机';
      onSuccess(`[${themeName}] 抽卡成功，生成了 ${res.results.length} 个提示词`);
    } catch (err) {
      onError(err instanceof Error ? err.message : '抽卡失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (idx: number, text: string) => { navigator.clipboard.writeText(text).then(() => { setCopiedIdx(idx); setTimeout(() => setCopiedIdx(null), 2000); }); };
  const handleCopyAll = () => { navigator.clipboard.writeText(results.map((r) => r.prompt).join('\n\n---\n\n')).then(() => { setCopiedIdx(-1); setTimeout(() => setCopiedIdx(null), 2000); }); };
  const handleDeleteHistory = (id: string) => { removeRandomHistory(id); setHistory(getRandomHistory()); };
  const handleHistoryLoad = (item: RandomHistoryItem) => {
    setTheme(item.theme || '');
    setResults(item.results.map((r) => ({
      theme_label: r.theme_label,
      theme: item.theme || '',
      tags_used: r.tags_used,
      prompt: r.prompt,
    })));
    setShowHistory(false);
  };

  const totalTags = results.reduce((sum, r) => sum + Object.values(r.tags_used || {}).flat().length, 0);

  const handleRandomGenerateImage = useCallback(async (idx: number, prompt: string) => {
    if (taskManager.isFull) {
      onError('任务队列已满（最多 20 个任务），请等待当前任务完成');
      return;
    }
    setGenStates((prev) => ({ ...prev, [idx]: { loading: true, images: [] } }));
    let imagePath = selectedGirlfriend?.portraitUrl || '';
    let referenceImageUrl = '';
    if (digitalHumanMode && selectedGirlfriend) {
      try {
        const res = await fetch(selectedGirlfriend.portraitUrl);
        const blob = await res.blob();
        const file = new File([blob], `${selectedGirlfriend.id}.jpg`, { type: blob.type || 'image/jpeg' });
        const uploadResult = await uploadImage(apiKey, file);
        imagePath = uploadResult.imagePath;
        referenceImageUrl = imagePath;
      } catch {
        setGenStates((prev) => {
          const next = { ...prev };
          delete next[idx];
          return next;
        });
        onError('AI 女友图片上传失败，请重试');
        return;
      }
    }
    if (digitalHumanMode && selectedGirlfriend) {
      const nodes = [
        { nodeId: '7', fieldName: 'image', fieldValue: imagePath, description: 'image' },
        { nodeId: '9', fieldName: 'batch_size', fieldValue: String(DEFAULT_TXT2IMG_PARAMS.imageCount), description: 'batch_size' },
        { nodeId: '33', fieldName: 'text', fieldValue: prompt, description: 'text' },
      ];
      try {
        await taskManager.addTask('img2img', nodes, prompt, WORKFLOW.IMAGE_TO_IMAGE);
        onSuccess('任务已提交，请到图生图查看生成结果');
        if (onNavigate) onNavigate('img2img');
      } catch (err) {
        onError(err instanceof Error ? err.message : '提交失败');
        setGenStates((prev) => {
          const next = { ...prev };
          delete next[idx];
          return next;
        });
      }
    } else {
      const nodes = buildTxt2ImgNodeList({
        width: DEFAULT_TXT2IMG_PARAMS.width,
        height: DEFAULT_TXT2IMG_PARAMS.height,
        imageCount: DEFAULT_TXT2IMG_PARAMS.imageCount,
        prompt: prompt,
        lora1Name: DEFAULT_TXT2IMG_PARAMS.lora1Name,
        lora1Weight: DEFAULT_TXT2IMG_PARAMS.lora1Weight,
        lora2Name: DEFAULT_TXT2IMG_PARAMS.lora2Name,
        lora2Weight: DEFAULT_TXT2IMG_PARAMS.lora2Weight,
      });
      try {
        await taskManager.addTask('txt2img', nodes, prompt);
        onSuccess('任务已提交，请到文生图查看生成结果');
        if (onNavigate) onNavigate('txt2img');
      } catch (err) {
        onError(err instanceof Error ? err.message : '提交失败');
        setGenStates((prev) => {
          const next = { ...prev };
          delete next[idx];
          return next;
        });
      }
    }
  }, [taskManager, onError, onSuccess, digitalHumanMode, selectedGirlfriend, apiKey, onNavigate]);

  const handleBatchGenerate = useCallback(async () => {
    if (results.length === 0) return;
    const availableSlots = 20 - taskManager.tasks.length;
    if (availableSlots <= 0) {
      onError('任务队列已满，请等待当前任务完成');
      return;
    }
    setBatchLoading(true);
    let submitted = 0;
    let imagePath = selectedGirlfriend?.portraitUrl || '';
    if (digitalHumanMode && selectedGirlfriend) {
      try {
        const res = await fetch(selectedGirlfriend.portraitUrl);
        const blob = await res.blob();
        const file = new File([blob], `${selectedGirlfriend.id}.jpg`, { type: blob.type || 'image/jpeg' });
        const uploadResult = await uploadImage(apiKey, file);
        imagePath = uploadResult.imagePath;
      } catch {
        setBatchLoading(false);
        onError('AI 女友图片上传失败，请重试');
        return;
      }
    }
    const toSubmit = results.slice(0, availableSlots);
    const tasks = toSubmit.map(async (result) => {
      if (digitalHumanMode && selectedGirlfriend) {
        const nodes = [
          { nodeId: '7', fieldName: 'image', fieldValue: imagePath, description: 'image' },
          { nodeId: '9', fieldName: 'batch_size', fieldValue: String(DEFAULT_TXT2IMG_PARAMS.imageCount), description: 'batch_size' },
          { nodeId: '33', fieldName: 'text', fieldValue: result.prompt, description: 'text' },
        ];
        await taskManager.addTask('img2img', nodes, result.prompt, WORKFLOW.IMAGE_TO_IMAGE);
      } else {
        const nodes = buildTxt2ImgNodeList({
          width: DEFAULT_TXT2IMG_PARAMS.width,
          height: DEFAULT_TXT2IMG_PARAMS.height,
          imageCount: DEFAULT_TXT2IMG_PARAMS.imageCount,
          prompt: result.prompt,
          lora1Name: DEFAULT_TXT2IMG_PARAMS.lora1Name,
          lora1Weight: DEFAULT_TXT2IMG_PARAMS.lora1Weight,
          lora2Name: DEFAULT_TXT2IMG_PARAMS.lora2Name,
          lora2Weight: DEFAULT_TXT2IMG_PARAMS.lora2Weight,
        });
        await taskManager.addTask('txt2img', nodes, result.prompt);
      }
    });
    const settled = await Promise.allSettled(tasks);
    submitted = settled.filter((r) => r.status === 'fulfilled').length;
    settled.forEach((r, i) => {
      if (r.status === 'rejected') {
        onError(`提交第 ${i + 1} 个时失败: ${r.reason instanceof Error ? r.reason.message : '未知错误'}`);
      }
    });
    setBatchLoading(false);
    if (submitted > 0) {
      onSuccess(`已提交 ${submitted} 个生图任务`);
      if (digitalHumanMode && selectedGirlfriend) {
        if (onNavigate) onNavigate('img2img');
      } else {
        if (onNavigate) onNavigate('txt2img');
      }
    }
  }, [results, taskManager, onError, onSuccess, digitalHumanMode, selectedGirlfriend, apiKey, onNavigate]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white border border-border shadow-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Shuffle size={14} className={r18Mode ? 'text-red-500' : 'text-primary'} />
            <span className="text-sm font-medium text-text-primary">随机抽卡{r18Mode && <span className="ml-2 text-xs text-red-500 font-medium">(R18)</span>}</span>
          </div>
          <div className="flex items-center gap-2">
            {results.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-text-tertiary">
                <span className="px-2 py-0.5 rounded-full bg-bg-elevated">{results.length} 个提示词</span>
                {totalTags > 0 && <span className="px-2 py-0.5 rounded-full bg-bg-elevated">{totalTags} 标签</span>}
              </div>
            )}
            <button onClick={() => setShowHistory(!showHistory)} className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium transition-all ${showHistory ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'}`}>
              <History size={12} />历史记录
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-3">
          <div className="flex gap-1">
            {(['image', 'video'] as const).map((t) => (
              <button key={t} onClick={() => setType(t)} className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${type === t ? 'bg-primary text-white' : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'}`}>{t === 'image' ? '生图' : '生视频'}</button>
            ))}
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-tertiary">生成数量:</span>
            <div className="flex gap-1">
              {[1, 3, 5, 8, 10].map((n) => (
                <button key={n} onClick={() => setCount(n)} className={`w-8 h-7 rounded-lg text-xs font-medium transition-all ${count === n ? (r18Mode ? 'bg-red-500 text-white' : 'bg-primary text-white') : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'}`}>{n}</button>
              ))}
            </div>
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-tertiary">主题:</span>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              className={`h-7 px-2 rounded-lg text-xs border transition-all appearance-none cursor-pointer ${r18Mode ? 'bg-red-50 border-red-200 text-red-700 focus:border-red-400' : 'bg-bg-elevated border-border text-text-primary focus:border-primary'} focus:outline-none`}
            >
              {THEMES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => setTagsVisible(!tagsVisible)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${tagsVisible ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-bg-elevated text-text-tertiary border border-transparent hover:bg-bg-hover'}`}>
            <Tag size={12} />{tagsVisible ? '已显示标签' : '显示标签'}
          </button>
          {results.length > 0 && (
            <button onClick={handleCopyAll} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-bg-elevated text-text-tertiary border border-transparent hover:bg-bg-hover transition-all">
              {copiedIdx === -1 ? <><Check size={12} className="text-green-500" /> 已复制全部</> : <><Copy size={12} /> 复制全部</>}
            </button>
          )}
        </div>

        <div className="flex gap-2">
          <button onClick={handleGenerate} disabled={loading}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all ${loading ? 'bg-bg-elevated text-text-secondary cursor-not-allowed' : r18Mode ? 'bg-gradient-to-r from-red-500 to-red-600 text-white hover:opacity-90 active:scale-[0.98]' : 'bg-gradient-to-r from-primary to-primary/80 text-white hover:opacity-90 active:scale-[0.98]'}`}>
            {loading ? <><Loader2 size={16} className="animate-spin" /> 抽卡中...</> : <><Sparkles size={16} />{r18Mode ? 'R18 抽卡' : '开始抽卡'}{theme ? ` [${THEMES.find(t => t.key === theme)?.label}]` : ''}</>}
          </button>
          {results.length > 0 && <button onClick={() => { setResults([]); setExpandedIdx(null); }} className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl font-medium text-sm bg-bg-elevated text-text-tertiary hover:bg-bg-hover transition-colors"><RotateCcw size={14} />清空</button>}
        </div>
      </div>

      {/* Random History */}
      {showHistory && (
        <RandomHistoryPanel
          history={history}
          r18Mode={r18Mode}
          onLoad={handleHistoryLoad}
          onDelete={handleDeleteHistory}
          onClear={() => { clearRandomHistory(); setHistory([]); }}
          onCopy={handleCopy}
        />
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          {/* Batch Generate Header */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-text-tertiary font-medium">提示词列表 · {results.length} 个</span>
            <button
              onClick={handleBatchGenerate}
              disabled={batchLoading || taskManager.isFull || (digitalHumanMode && !selectedGirlfriend)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                batchLoading || taskManager.isFull || (digitalHumanMode && !selectedGirlfriend)
                  ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:opacity-90 active:scale-[0.98]'
              }`}
            >
              {batchLoading ? <><Loader2 size={12} className="animate-spin" /> 提交中...</> : <><Zap size={12} />一键批量生图</>}
            </button>
          </div>
          {results.map((result, idx) => (
            <RandomResultCard
              key={idx}
              index={idx}
              result={result}
              isExpanded={expandedIdx === idx}
              isCopied={copiedIdx === idx}
              tagsVisible={tagsVisible}
              r18Mode={r18Mode}
              onToggle={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
              onCopy={() => handleCopy(idx, result.prompt)}
              genState={genStates[idx]}
              onGenerateImage={() => handleRandomGenerateImage(idx, result.prompt)}
              onFavorited={(url) => handleToggleFavorite(url, result.prompt)}
              taskManager={taskManager}
              digitalHumanMode={digitalHumanMode}
              selectedGirlfriend={selectedGirlfriend}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RandomHistoryPanel({ history, r18Mode, onLoad, onDelete, onClear, onCopy }: {
  history: RandomHistoryItem[];
  r18Mode: boolean;
  onLoad: (h: RandomHistoryItem) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onCopy: (idx: number, text: string) => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const copy = (id: string, text: string) => { onCopy(0, text); setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); };

  return (
    <div className={`rounded-2xl bg-white border shadow-card overflow-hidden ${r18Mode ? 'border-red-200' : 'border-border'}`}>
      <div className={`flex items-center justify-between px-4 py-3 border-b ${r18Mode ? 'border-red-100 bg-red-50/40' : 'border-border/50 bg-bg-elevated'}`}>
        <div className="flex items-center gap-2">
          <History size={14} className={r18Mode ? 'text-red-500' : 'text-text-tertiary'} />
          <span className={`text-sm font-medium ${r18Mode ? 'text-red-600' : 'text-text-primary'}`}>抽卡历史</span>
          <span className="px-2 py-0.5 rounded-full text-[11px] bg-bg-elevated text-text-tertiary">{history.length} 条</span>
        </div>
        {history.length > 0 && <button onClick={onClear} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-all"><Trash2 size={11} />清空</button>}
      </div>
      {history.length === 0 ? (
        <div className="px-4 py-8 text-center"><Clock size={24} className="mx-auto text-text-tertiary/40 mb-2" /><p className="text-sm text-text-tertiary">暂无历史记录</p></div>
      ) : (
        <div className="max-h-[500px] overflow-y-auto divide-y divide-border/50">
          {history.map((h) => (
            <div key={h.id}>
              <div className="flex items-center gap-2 px-4 py-3 hover:bg-bg-hover/30 transition-colors">
                <button onClick={() => onLoad(h)} className="flex-1 flex items-start gap-2 w-full min-w-0 text-left group">
                  <Plus size={13} className="flex-shrink-0 mt-0.5 text-text-tertiary group-hover:text-primary transition-colors" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="flex flex-wrap gap-1">
                        {(h.results ?? []).slice(0, 3).map((r, ri) => (
                          <span key={ri} className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${r18Mode ? 'bg-red-100 text-red-600' : 'bg-primary/8 text-primary'}`}>{r.theme_label || '主题'}</span>
                        ))}
                        {(h.results ?? []).length > 3 && <span className="text-[10px] text-text-tertiary">+{(h.results ?? []).length - 3}</span>}
                      </div>
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-bg-elevated text-text-tertiary flex-shrink-0">{(h.results ?? []).length} 个</span>
                    </div>
                    <p className="text-[11px] text-text-tertiary mt-0.5">{new Date(h.timestamp).toLocaleString('zh-CN')}</p>
                  </div>
                </button>
                <button onClick={() => setExpandedId(expandedId === h.id ? null : h.id)}
                  className="p-1.5 rounded-lg text-text-tertiary hover:bg-bg-hover transition-all">
                  <span className={`transition-transform ${expandedId === h.id ? 'rotate-180' : ''}`}><ChevronDown size={14} /></span>
                </button>
                <button onClick={() => onDelete(h.id)} className="p-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-all"><Trash2 size={13} /></button>
              </div>
              {expandedId === h.id && (
                <div className="px-4 pb-3 space-y-2">
                  {(h.results ?? []).map((r, ri) => (
                    <div key={ri} className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${r18Mode ? 'bg-red-50/60 text-red-800 border border-red-100' : 'bg-bg-elevated text-text-secondary'}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-medium text-text-tertiary">{ri + 1}</span>
                          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${r18Mode ? 'bg-red-200 text-red-700' : 'bg-primary/10 text-primary'}`}>{r.theme_label || ''}</span>
                        </div>
                        <button onClick={() => copy(`${h.id}-${ri}`, r.prompt)}
                          className={`flex items-center gap-1 text-[10px] transition-colors ${copiedId === `${h.id}-${ri}` ? 'text-green-500' : 'text-text-tertiary hover:text-primary'}`}>
                          {copiedId === `${h.id}-${ri}` ? <><Check size={10} />已复制</> : <><Copy size={10} />复制</>}
                        </button>
                      </div>
                      <p className="whitespace-pre-wrap">{r.prompt}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RandomResultCard({ index, result, isExpanded, isCopied, tagsVisible, r18Mode, onToggle, onCopy, genState, onGenerateImage, onFavorited, taskManager, digitalHumanMode, selectedGirlfriend }: {
  index: number; result: PromptResult; isExpanded: boolean; isCopied: boolean; tagsVisible: boolean; r18Mode: boolean; onToggle: () => void; onCopy: () => void;
  genState?: { loading: boolean; images: string[] };
  onGenerateImage: () => void;
  onFavorited?: (url: string) => void;
  taskManager: TaskManagerReturn;
  digitalHumanMode?: boolean; selectedGirlfriend?: GirlfriendPreset | null;
}) {
  const themeLabel = result.theme_label || `主题 ${index + 1}`;
  const totalTags = Object.values(result.tags_used || {}).flat().length;
  const accentColor = r18Mode ? 'border-red-200' : 'border-border';
  const headerBg = r18Mode ? 'bg-red-50/60' : 'bg-bg-elevated';
  const badgeBg = r18Mode ? 'bg-gradient-to-r from-red-500 to-pink-500' : 'bg-gradient-to-r from-primary to-indigo-500';
  const isGenLoading = genState?.loading;
  const displayImages = genState?.images ?? [];

  // Find related running tasks
  const relatedTasks = taskManager.tasks.filter(
    (t: QueuedTask) => t.status === 'RUNNING' || t.status === 'QUEUEING' || t.status === 'FINISHED'
  ).filter((t: QueuedTask) => t.prompt === result.prompt);

  const allDisplayImages = displayImages.length > 0 ? displayImages : relatedTasks.flatMap((t: QueuedTask) => t.images);

  return (
    <div className={`rounded-2xl bg-white border shadow-card overflow-hidden ${accentColor}`}>
      <div role="button" tabIndex={0} onClick={onToggle} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggle(); }}
        className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover/50 transition-colors cursor-pointer ${headerBg}`}>
        <div className={`flex-shrink-0 px-3 py-1 rounded-full text-white text-xs font-bold shadow-sm ${badgeBg}`}>{themeLabel}</div>
        <div className="flex-1 min-w-0 text-left">
          <p className={`text-sm line-clamp-1 ${r18Mode ? 'text-red-700/80' : 'text-text-secondary'}`}>{result.prompt.slice(0, 80)}{result.prompt.length > 80 ? '...' : ''}</p>
          {tagsVisible && totalTags > 0 && <p className="text-[10px] text-text-tertiary flex items-center gap-0.5 mt-0.5"><Tag size={10} />{totalTags} 标签</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={(e) => { e.stopPropagation(); onCopy(); }}
            className={`p-1.5 rounded-lg text-xs transition-all ${isCopied ? 'bg-green-500/10 text-green-500' : r18Mode ? 'text-red-500 hover:bg-red-50' : 'text-text-tertiary hover:bg-bg-hover'}`}>
            {isCopied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <span className={`text-text-tertiary transition-transform ${isExpanded ? 'rotate-180' : ''}`}><ChevronDown size={16} /></span>
        </div>
      </div>

      {isExpanded && (
        <div className={`border-t px-4 pb-4 pt-3 ${r18Mode ? 'border-red-100' : 'border-border/50'}`}>
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className={`text-xs font-medium ${r18Mode ? 'text-red-500' : 'text-text-tertiary'}`}>提示词</span>
              <button
                onClick={onGenerateImage}
                disabled={isGenLoading || (digitalHumanMode && !selectedGirlfriend)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                  isGenLoading || (digitalHumanMode && !selectedGirlfriend)
                    ? 'bg-blue-100 text-blue-400 cursor-not-allowed'
                    : 'bg-blue-500 text-white hover:bg-blue-600'
                }`}
              >
                {isGenLoading ? <><Loader2 size={11} className="animate-spin" /> 生成中</> : <><Image size={11} />{digitalHumanMode && selectedGirlfriend ? '图生图' : '生图'}</>}
              </button>
            </div>
            <div className={`rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${r18Mode ? 'bg-red-50/70 text-red-800 border border-red-100' : 'bg-bg-elevated text-text-secondary'}`}>{result.prompt}</div>
          </div>

          {/* Generated images preview */}
          {allDisplayImages.length > 0 && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-tertiary font-medium">生成结果</span>
                <span className="text-[10px] text-text-tertiary">{allDisplayImages.length} 张</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {allDisplayImages.slice(0, 6).map((img, idx) => (
                  <AIGeneratedImagePreview key={idx} src={img} prompt={result.prompt} onFavorited={onFavorited} />
                ))}
                {allDisplayImages.length > 6 && (
                  <div className="aspect-square rounded-lg bg-bg-elevated flex items-center justify-center text-xs text-text-tertiary">
                    +{allDisplayImages.length - 6}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Running status */}
          {relatedTasks.filter((t: QueuedTask) => t.status === 'RUNNING' || t.status === 'QUEUEING').length > 0 && allDisplayImages.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-blue-500 mb-3">
              <Loader2 size={12} className="animate-spin" />
              正在生成中... {relatedTasks.filter((t: QueuedTask) => t.status === 'RUNNING' || t.status === 'QUEUEING').length} 个任务
            </div>
          )}

          {tagsVisible && Object.keys(result.tags_used || {}).length > 0 && (
            <div>
              <div className="flex items-center gap-1 mb-2"><Tag size={11} className="text-text-tertiary" /><span className="text-xs text-text-tertiary font-medium">标签 ({totalTags})</span></div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(result.tags_used || {}).filter(([, v]) => v.length > 0).map(([cat, names]) => (
                  <div key={cat} className="flex flex-wrap gap-1">
                    {names.map((name, i) => (
                      <span key={i} className={`px-2 py-0.5 rounded-full text-[11px] ${r18Mode && (cat === 'r18' || cat === 'nsfw_details') ? 'bg-red-500/10 text-red-600 border border-red-200/50' : 'bg-primary/8 text-primary border border-primary/20'}`}>{name}</span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Storyboard Mode ────────────────────────────────────────────────────────

function StoryboardMode({ onError, onSuccess, loading, setLoading, r18Mode, taskManager, apiKey, onNavigate, digitalHumanMode, setDigitalHumanMode, selectedGirlfriend, setSelectedGirlfriend }: {
  onError: (msg: string) => void; onSuccess: (msg: string) => void; loading: boolean; setLoading: (v: boolean) => void; r18Mode: boolean;
  taskManager: TaskManagerReturn; apiKey: string; onNavigate?: (tab: TabType) => void;
  digitalHumanMode: boolean; setDigitalHumanMode: (v: boolean) => void; selectedGirlfriend: GirlfriendPreset | null; setSelectedGirlfriend: (gf: GirlfriendPreset | null) => void;
}) {
  const savedStoryboard = getStoryboardSession();
  const [plot, setPlot] = useState(savedStoryboard?.plot || '');
  const [panelCount, setPanelCount] = useState(savedStoryboard?.panelCount || 5);
  const [panels, setPanels] = useState<{ panel_number: number; scene_description: string; image_prompt: string }[]>(savedStoryboard?.panels || []);
  const [expandedPanel, setExpandedPanel] = useState<number | null>(savedStoryboard?.expandedPanel ?? null);
  const [copiedPanel, setCopiedPanel] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyTab, setHistoryTab] = useState<'history' | 'favorites'>('history');
  const [history, setHistory] = useState<StoryboardHistoryItem[]>(() => getStoryboardHistory());
  const [favorites, setFavorites] = useState<FavoriteItem[]>(() => getFavorites());
  const [genStates, setGenStates] = useState<Record<string, { loading: boolean; images: string[] }>>({});
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchVideoLoading, setBatchVideoLoading] = useState(false);
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(() => {
    const saved = getStoryboardSession();
    return saved?.historyId || null;
  });

  // 2-step storyboard state
  const [storyStep, setStoryStep] = useState<'themes' | 'outline' | 'panels'>(
    savedStoryboard?.themeId ? 'panels' : 'themes'
  );
  const [themeOptions, setThemeOptions] = useState<{
    id: number; title: string; description: string; tags: string[]; r18_level: string; category?: string; scenario_count?: number; costume_count?: number;
  }[]>([]);
  const [selectedThemes, setSelectedThemes] = useState<{
    id: number; title: string; description: string; tags: string[]; r18_level: string; category?: string; scenario_count?: number; costume_count?: number;
  }[]>([]);
  const [selectedTheme, setSelectedTheme] = useState<{
    id: number; title: string; description: string; tags: string[]; r18_level: string; category?: string; scenario_count?: number; costume_count?: number;
  } | null>(null);
  const [customThemeMode, setCustomThemeMode] = useState(false);
  const [customThemeDescription, setCustomThemeDescription] = useState('');
  const [customThemeCount, setCustomThemeCount] = useState(10);
  const [themeLibraryOpen, setThemeLibraryOpen] = useState(false);
  const [loadingThemeLibrary, setLoadingThemeLibrary] = useState(false);
  const [themeSearchQuery, setThemeSearchQuery] = useState('');
  const [themeCategoryFilter, setThemeCategoryFilter] = useState('');
  const [outlineArc, setOutlineArc] = useState(savedStoryboard?.outlineArc || '');
  const [outlineScenes, setOutlineScenes] = useState<string[]>(savedStoryboard?.outlineScenes || []);
  const [generatingOutline, setGeneratingOutline] = useState(false);

  // Refs for callbacks used inside async effects — avoids stale closure issues
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // Track pending async prompt tasks (task_id -> task type) for polling/restore on refresh.
  // Persisted to sessionStorage so tasks survive page refresh — the server-side
  // background task keeps running even when the browser is killed/backgrounded.
  const [pendingPromptTasks, setPendingPromptTasks] = useState<Record<string, string>>(() => {
    try {
      const raw = sessionStorage.getItem('nsfwxo_pending_prompt_tasks');
      console.log('[restore] useState init, sessionStorage raw:', raw);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });

  // Always log sessionStorage on mount, regardless of task state
  useEffect(() => {
    console.log('[restore] mount, pendingPromptTasks:', pendingPromptTasks);
    console.log('[restore] mount, sessionStorage:', sessionStorage.getItem('nsfwxo_pending_prompt_tasks'));
  }, []);

  // Persist pending tasks to sessionStorage so they survive page refresh
  useEffect(() => {
    try {
      console.log('[restore] persisting pendingPromptTasks:', pendingPromptTasks);
      sessionStorage.setItem('nsfwxo_pending_prompt_tasks', JSON.stringify(pendingPromptTasks));
    } catch (e) { console.error('[restore] sessionStorage write failed:', e); }
  }, [pendingPromptTasks]);

  // Poll pending tasks and restore them on mount.
  useEffect(() => {
    const tasks = Object.entries(pendingPromptTasks);
    console.log('[restore] useEffect running, tasks from sessionStorage:', tasks);

    if (tasks.length === 0) return;

    const abortCtrl = new AbortController();

    const pollTasks = async () => {
      for (const [taskId, taskType] of tasks) {
        if (abortCtrl.signal.aborted) break;
        try {
          const status = await pollPromptTask(taskId, undefined, abortCtrl.signal);

          if (status.status === 'DONE') {
            const res = status.result;
            if (taskType === 'themes' && res?.themes) {
              setThemeOptions(res.themes);
              setStoryStep('themes');
              setSelectedThemes([]);
              onSuccessRef.current(`主题已生成（${res.themes.length} 个），请选择`);
            } else if (taskType === 'outline' && res?.storyboard) {
              const panels = res.storyboard;
              const hid = res.theme_id;
              const historyId = addStoryboardHistory({
                plot: res.theme_title ?? '主题',
                panel_count: panels.length,
                r18: r18Mode,
                panels,
              });
              if (hid !== undefined) {
                setThemeOutlineStates((prev) => ({
                  ...prev,
                  [hid]: {
                    generating: false,
                    outlineArc: res.outline?.arc ?? '',
                    outlineScenes: res.outline?.scenes ?? [],
                    panels,
                    historyId,
                    error: undefined,
                  },
                }));
              }
              setCurrentHistoryId(historyId);
              saveStoryboardSession({
                plot: res.theme_title ?? '主题',
                panelCount: panels.length,
                panels,
                expandedPanel: null,
                themeTitle: res.theme_title,
                historyId,
              });
              setHistory(getStoryboardHistory());
              onSuccessRef.current(`「${res.theme_title ?? '主题'}」的大纲已生成`);
            } else if (taskType === 'script' && res?.panels) {
              setVideoScript({
                script_title: res.script_title ?? `${res.theme_title ?? '主题'} 脚本`,
                duration: res.duration ?? '15-30秒',
                panels: res.panels ?? [],
              });
              onSuccessRef.current('视频脚本生成完成');
            }
            // Remove completed task
            setPendingPromptTasks((prev) => { const n = { ...prev }; delete n[taskId]; return n; });
          } else if (status.status === 'FAILED') {
            onErrorRef.current(status.error ?? '任务失败');
            setPendingPromptTasks((prev) => { const n = { ...prev }; delete n[taskId]; return n; });
          }
        } catch {
          // Network/polling error — keep task for next attempt
        }
      }
    };

    pollTasks();
    return () => abortCtrl.abort();
  }, [pendingPromptTasks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track generation state per theme (for multi-select)
  const [themeOutlineStates, setThemeOutlineStates] = useState<Record<number, {
    generating: boolean;
    outlineArc: string;
    outlineScenes: string[];
    panels: { panel_number: number; scene_description: string; image_prompt: string }[];
    historyId?: string;
    error?: string; // error message when generation failed
  }>>({});

  // Active theme tab (for tab switching between themes) — MUST be declared before sbHistoryId
  const [activeThemeTab, setActiveThemeTab] = useState<number | null>(null);

  // Helper: get the effective historyId for multi-theme mode
  const sbHistoryId = activeThemeTab !== null
    ? (themeOutlineStates[activeThemeTab]?.historyId || currentHistoryId)
    : currentHistoryId;

  // Restore cached panel images on page load — critical for surviving page refresh.
  // On initial mount genStates is empty, but panels + currentHistoryId are restored from
  // sessionStorage via useState initializers. This effect bridges the gap by loading
  // cached images into genStates so panel cards display them immediately.
  useEffect(() => {
    const saved = getStoryboardSession();
    if (!saved?.historyId || !saved?.panels?.length) return;

    const hid = saved.historyId;

    const historyItems = getStoryboardHistory();
    const historyItem = historyItems.find((h) => h.id === hid);
    const initial: Record<string, { loading: boolean; images: string[] }> = {};

    if (historyItem?.panelImages) {
      const resolved = resolvePanelImages(historyItem.panelImages);
      for (const [idx, imgs] of Object.entries(resolved)) {
        initial[`${hid}_${idx}`] = { loading: false, images: imgs };
      }
    }

    const cached = getAllCachedPanelImages(hid, saved.panels.length);
    for (const [idx, imgs] of Object.entries(cached)) {
      const key = `${hid}_${idx}`;
      if (!initial[key]) {
        initial[key] = { loading: false, images: imgs };
      }
    }

    if (Object.keys(initial).length > 0) {
      setGenStates(initial);
    }

    // Background zip extraction for any panels still missing images
    for (let i = 0; i < saved.panels.length; i++) {
      const key = `${hid}_${i}`;
      if (initial[key]?.images.length > 0) continue;

      const count = historyItem?.panelImageCounts?.[i] || 4;
      loadCachedOrExtractPanelImages(historyItem?.zipUrl, count, hid, i).then((images) => {
        if (images.length > 0) {
          setGenStates((prev) => {
            const existing = prev[key];
            if (existing?.images.length > 0 && existing.images[0]?.startsWith('data:')) return prev;
            return { ...prev, [key]: { loading: false, images } };
          });
        }
      });
    }
  }, []); // intentionally empty — only runs once on mount

  // ── Derived active values (must be before useEffects that depend on them) ──
  const activeOutlineArc = activeThemeTab !== null ? (themeOutlineStates[activeThemeTab]?.outlineArc || '') : outlineArc;
  const activeOutlineScenes = activeThemeTab !== null ? (themeOutlineStates[activeThemeTab]?.outlineScenes || []) : outlineScenes;
  const activePanels = activeThemeTab !== null ? (themeOutlineStates[activeThemeTab]?.panels || []) : panels;
  const activeThemeInfo = activeThemeTab !== null ? selectedThemes.find((t) => t.id === activeThemeTab) : (selectedTheme || (selectedThemes[0] ?? null));

  // ── Subscribe to finished task images and cache them for the storyboard ──
  // This is the primary path: when any task completes, its data URL images are
  // immediately cached into the storyboard panel cache so they survive page refresh.
  // We use the storyboardInfo from the task callback to know exactly which panel to update.
  const { finishedTasks } = useFinishedTaskImages();
  useEffect(() => {
    // Support both ExpandMode's sbHistoryId and StoryboardSection's sb_latest_history_id
    const storyboardHistoryId = sessionStorage.getItem('sb_latest_history_id') || sbHistoryId;
    if (!storyboardHistoryId) return;
    for (const [taskId, info] of Object.entries(finishedTasks)) {
      const { images, storyboardInfo, zipUrl } = info;
      if (!images || images.length === 0) continue;
      const hid = storyboardInfo?.historyId || storyboardHistoryId;
      // If the task has explicit storyboardInfo, use it directly
      if (storyboardInfo && (storyboardInfo.historyId === storyboardHistoryId || storyboardInfo.historyId === sbHistoryId)) {
        const { panelIdx } = storyboardInfo;
        const key = `${hid}_${panelIdx}`;
        setGenStates((prev) => {
          const current = prev[key];
          if (current?.images.length > 0 && current.images[0]?.startsWith('data:')) return prev;
          return { ...prev, [key]: { loading: false, images } };
        });
        cacheStoryboardPanelImages(hid, panelIdx, images).then(() => {
          const panelImages: Record<number, string[]> = { [panelIdx]: images };
          updateStoryboardHistoryImages(hid, panelImages, zipUrl, { [panelIdx]: images.length });
        });
        continue;
      }
      // Fallback: match by prompt text (for tasks without explicit storyboardInfo)
      for (let i = 0; i < activePanels.length; i++) {
        const panel = activePanels[i];
        const panelPromptNorm = panel.image_prompt.trim().replace(/\s+/g, ' ');
        const matchedTask = taskManager.tasks.find((t) => {
          if (t.id !== taskId || t.images.length === 0) return false;
          const taskPromptNorm = t.prompt.trim().replace(/\s+/g, ' ');
          return taskPromptNorm === panelPromptNorm ||
            taskPromptNorm.includes(panelPromptNorm) ||
            panelPromptNorm.includes(taskPromptNorm) ||
            (panelPromptNorm.length > 50 && taskPromptNorm.includes(panelPromptNorm.substring(0, Math.min(panelPromptNorm.length, 150))));
        });
        if (matchedTask) {
          const key = `${hid}_${i}`;
          setGenStates((prev) => {
            const current = prev[key];
            if (current?.images.length > 0 && current.images[0]?.startsWith('data:')) return prev;
            return { ...prev, [key]: { loading: false, images } };
          });
          cacheStoryboardPanelImages(hid, i, images).then(() => {
            const panelImages: Record<number, string[]> = { [i]: images };
            updateStoryboardHistoryImages(hid, panelImages);
          });
        }
      }
    }
  }, [finishedTasks, activePanels, sbHistoryId]);

  // ── Sync genStates with taskManager.tasks so panel cards reflect live images ──
  // Also converts blob URLs to data URLs immediately so they survive page refresh.
  useEffect(() => {
    const hid = sbHistoryId;
    if (!hid) return;
    setGenStates((prev) => {
      let changed = false;
      const next = { ...prev };
      for (let i = 0; i < activePanels.length; i++) {
        const panel = activePanels[i];
        const panelPromptNorm = panel.image_prompt.trim().replace(/\s+/g, ' ');
        const matchedTask = taskManager.tasks.find((t) => {
          if (t.images.length === 0) return false;
          const taskPromptNorm = t.prompt.trim().replace(/\s+/g, ' ');
          return taskPromptNorm === panelPromptNorm ||
            taskPromptNorm.includes(panelPromptNorm) ||
            panelPromptNorm.includes(taskPromptNorm) ||
            (panelPromptNorm.length > 50 && taskPromptNorm.includes(panelPromptNorm.substring(0, Math.min(panelPromptNorm.length, 150))));
        });
        const key = `${hid}_${i}`;
        if (matchedTask) {
          const taskImages = matchedTask.images;
          const currentImages = next[key]?.images ?? [];
          // Determine if current images are valid: have data URLs or non-stale blob URLs
          const hasCurrent = currentImages.length > 0;
          const currentIsDataUrl = hasCurrent && currentImages[0].startsWith('data:');
          const taskHasDataUrl = taskImages.length > 0 && taskImages[0].startsWith('data:');
          const shouldUpdate = !hasCurrent ||
            (!currentIsDataUrl && taskHasDataUrl && currentImages[0] !== taskImages[0]) ||
            (!currentIsDataUrl && !taskHasDataUrl && currentImages[0] !== taskImages[0]);

          if (shouldUpdate) {
            next[key] = { loading: false, images: taskImages };
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [taskManager.tasks, activePanels, sbHistoryId]);

  // Persist generated panel images: blob URLs are converted to data URLs immediately
  // and cached so they survive page refresh. Also updates genStates so the UI uses
  // data URLs instead of ephemeral blob URLs.
  useEffect(() => {
    const hid = sbHistoryId;
    if (!hid) return;

    const genStateKeys = Object.keys(genStates).filter((k) => k.startsWith(`${hid}_`));
    console.debug(`[Storyboard] convertAndCache effect triggered, hid=${hid}, genStateKeys=${JSON.stringify(genStateKeys)}`);

    let hasNewImages = false;
    for (const [key, state] of Object.entries(genStates)) {
      const parts = key.split('_');
      const historyIdFromKey = parts.slice(0, -1).join('_');
      if (historyIdFromKey !== hid) continue;
      // Only process entries that have actual images
      if (state.images && state.images.length > 0 && state.images.some((img) => img.startsWith('blob:'))) {
        hasNewImages = true;
        break;
      }
    }
    if (!hasNewImages) {
      console.debug(`[Storyboard] convertAndCache: no blob images found in genStates for ${hid}`);
      return;
    }

    // Convert blob URLs to data URLs and cache them immediately
    const convertAndCache = async () => {
      // Read genStates fresh inside async function to avoid closure snapshot bug
      const states = genStates;
      const panelImages: Record<number, string[]> = {};
      let needsGenStatesUpdate = false;
      const updates: Record<string, { loading: boolean; images: string[] }> = {};

      for (const [key, state] of Object.entries(states)) {
        const parts = key.split('_');
        const historyIdFromKey = parts.slice(0, -1).join('_');
        const panelIdx = parts[parts.length - 1];
        if (historyIdFromKey !== hid) continue;
        if (!state.images || state.images.length === 0) continue;

        const hasBlob = state.images.some((img) => img.startsWith('blob:'));
        if (hasBlob) {
          const dataUrlImages = await Promise.all(state.images.map((img) => ensureDataUrl(img)));
          panelImages[Number(panelIdx)] = dataUrlImages;
          await cacheStoryboardPanelImages(hid, Number(panelIdx), dataUrlImages);
          updates[key] = { loading: false, images: dataUrlImages };
          needsGenStatesUpdate = true;
        } else if (!state.images.some((img) => img.startsWith('data:'))) {
          // Has images but not data URLs — try to cache them too
          const dataUrlImages = await Promise.all(state.images.map((img) => ensureDataUrl(img)));
          panelImages[Number(panelIdx)] = dataUrlImages;
          await cacheStoryboardPanelImages(hid, Number(panelIdx), dataUrlImages);
          updates[key] = { loading: false, images: dataUrlImages };
          needsGenStatesUpdate = true;
        }
      }

      // Update genStates so UI uses persistent data URLs instead of blob URLs
      if (needsGenStatesUpdate) {
        setGenStates((prev) => {
          const next = { ...prev, ...updates };
          return Object.keys(next).length > 0 ? next : prev;
        });
      }

      // Also save to history record for persistence
      if (Object.keys(panelImages).length > 0) {
        updateStoryboardHistoryImages(hid, panelImages);
        setHistory(getStoryboardHistory());
      }
      console.debug(`[Storyboard] convertAndCache complete: ${Object.keys(panelImages).length} panels cached, ${Object.keys(updates).length} genState keys updated`);
    };

    convertAndCache();
  }, [genStates, sbHistoryId]);

  // Video prompt state
  const [videoScript, setVideoScript] = useState<{
    script_title: string; duration: string; panels: {
      panel: number; heading: string; action: string; dialogue: string; sound_cue: string; camera: string;
    }[];
  } | null>(null);
  const [generatingScript, setGeneratingScript] = useState(false);

  // Image selection and video generation state
  const [selectedPanelImages, setSelectedPanelImages] = useState<Record<string, { index: number; url: string }>>({});
  const [videoGenLoading, setVideoGenLoading] = useState<Record<string, boolean>>({});
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewPrompt, setPreviewPrompt] = useState<string>('');
  const [showPreview, setShowPreview] = useState(false);

  // Persist storyboard state
  useEffect(() => {
    if (plot || panels.length > 0 || selectedThemes.length > 0) {
      saveStoryboardSession({
        plot, panelCount, panels, expandedPanel,
        themeId: selectedThemes[0]?.id,
        themeTitle: selectedThemes[0]?.title,
        outlineArc,
        outlineScenes,
        historyId: currentHistoryId || undefined,
      });
    } else {
      clearStoryboardSession();
    }
  }, [plot, panelCount, panels, expandedPanel, selectedTheme, outlineArc, outlineScenes, currentHistoryId]);

  // Step 1: Generate theme options (supports custom description)
  const handleGenerateThemes = async (customDesc?: string, customCnt?: number) => {
    setLoading(true);
    try {
      const desc = customDesc !== undefined ? customDesc : customThemeMode ? customThemeDescription : undefined;
      const cnt = customCnt !== undefined ? customCnt : customThemeCount;
      const res = await generateStoryboardThemes(r18Mode, cnt, desc || undefined, true);

      // Async mode: if task_id returned, track for polling
      if (res.task_id) {
        setPendingPromptTasks((prev) => ({ ...prev, [res.task_id!]: 'themes' }));
        setStoryStep('themes');
        onSuccess(`主题生成任务已提交（可后台运行，屏幕关闭不影响）`);
        setLoading(false);
        return;
      }

      // Sync mode fallback (shouldn't happen with asyncMode=true, but handle it)
      setThemeOptions(res.themes);
      setStoryStep('themes');
      setSelectedThemes([]);
      setPanels([]);
      setOutlineArc('');
      setOutlineScenes([]);
      setThemeOutlineStates({});
      onSuccess(`生成了 ${res.themes.length} 个主题，请选择`);
    } catch (err) {
      onError(err instanceof Error ? err.message : '主题生成失败');
    } finally {
      setLoading(false);
    }
  };

  // Load theme library directly from database (no LLM, no 502 risk)
  const handleOpenThemeLibrary = async () => {
    setThemeLibraryOpen(true);
    setLoadingThemeLibrary(true);
    try {
      const res = await listStoryboardThemes();
      setThemeOptions(res.themes);
      setStoryStep('themes');
      setSelectedThemes([]);
      setPanels([]);
      setOutlineArc('');
      setOutlineScenes([]);
      setThemeOutlineStates({});
    } catch (err) {
      onError(err instanceof Error ? err.message : '主题库加载失败');
    } finally {
      setLoadingThemeLibrary(false);
    }
  };

  // Add a single theme from library to selected themes (for manual selection)
  const handleAddThemeFromLibrary = (theme: { id: number; title: string; description: string; tags: string[]; r18_level: string; category?: string; scenario_count?: number; costume_count?: number }) => {
    if (selectedThemes.some((t) => t.id === theme.id)) return;
    setSelectedThemes((prev) => [...prev, theme]);
  };

  // Remove a theme from selected themes
  const handleRemoveThemeFromSelected = (themeId: number) => {
    setSelectedThemes((prev) => prev.filter((t) => t.id !== themeId));
    // Also reset its outline state if it was generated
    setThemeOutlineStates((prev) => {
      const next = { ...prev };
      delete next[themeId];
      return next;
    });
  };

  // Generate outline for ONE single selected theme (independent, not batch)
  const handleGenerateOutlineSingle = async (theme: { id: number; title: string; description: string; tags: string[]; r18_level: string; category?: string; scenario_count?: number; costume_count?: number }) => {
    // Mark this theme as generating, clear any previous error
    setThemeOutlineStates((prev) => ({
      ...prev,
      [theme.id]: { generating: true, outlineArc: '', outlineScenes: [], panels: [], historyId: undefined, error: undefined },
    }));
    try {
      const res = await generateStoryboardOutline(theme.id, theme.title, panelCount, r18Mode, true);

      // Async mode: if task_id returned, track for polling
      if (res.task_id) {
        setPendingPromptTasks((prev) => ({ ...prev, [res.task_id!]: 'outline' }));
        return;
      }

      // Sync fallback
      const historyId = addStoryboardHistory({ plot: theme.title, panel_count: panelCount, r18: r18Mode, panels: res.storyboard });
      setThemeOutlineStates((prev) => ({
        ...prev,
        [theme.id]: {
          generating: false,
          outlineArc: res.outline.arc,
          outlineScenes: res.outline.scenes,
          panels: res.storyboard,
          historyId,
          error: undefined,
        },
      }));
      onSuccess(`「${theme.title}」的大纲已生成`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : `「${theme.title}」分镜生成失败`;
      setThemeOutlineStates((prev) => ({
        ...prev,
        [theme.id]: {
          ...prev[theme.id],
          generating: false,
          error: errMsg,
        },
      }));
      onError(errMsg);
    }
  };

  // Generate outlines for ALL selected themes in parallel — partial success is OK
  const handleGenerateSelectedThemes = async () => {
    if (selectedThemes.length === 0) return;
    onSuccess(`开始为 ${selectedThemes.length} 个主题并行生成大纲...`);
    // Promise.allSettled ensures all run even if one fails — no short-circuit
    const results = await Promise.allSettled(selectedThemes.map((theme) => handleGenerateOutlineSingle(theme)));
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      onSuccess(`完成：${succeeded} 个成功，${failed} 个失败（点击失败卡片重试）`);
    } else {
      onSuccess(`全部 ${succeeded} 个主题大纲生成完成`);
    }
  };

  // Step 2: Generate outline + panels from selected theme
  const handleGenerateOutline = async () => {
    if (!selectedTheme) { onError('请先选择一个主题'); return; }
    setGeneratingOutline(true);
    try {
      const res = await generateStoryboardOutline(selectedTheme.id, selectedTheme.title, panelCount, r18Mode, true);

      // Async mode: track for polling
      if (res.task_id) {
        setPendingPromptTasks((prev) => ({ ...prev, [res.task_id!]: 'outline' }));
        onSuccess(`分镜生成任务已提交（可后台运行，屏幕关闭不影响）`);
        setGeneratingOutline(false);
        return;
      }

      // Sync fallback
      const historyId = addStoryboardHistory({ plot: selectedTheme.title, panel_count: panelCount, r18: r18Mode, panels: res.storyboard });
      setOutlineArc(res.outline.arc);
      setOutlineScenes(res.outline.scenes);
      setPanels(res.storyboard);
      setExpandedPanel(null);
      setStoryStep('panels');
      setCurrentHistoryId(historyId);
      saveStoryboardSession({
        plot: selectedTheme.title, panelCount, panels: res.storyboard, expandedPanel: null,
        themeId: selectedTheme.id, themeTitle: selectedTheme.title,
        outlineArc: res.outline.arc, outlineScenes: res.outline.scenes, historyId,
      });
      setHistory(getStoryboardHistory());
      onSuccess(`剧情大纲已生成，${res.storyboard.length} 个分镜就绪`);
    } catch (err) {
      onError(err instanceof Error ? err.message : '分镜生成失败');
    } finally {
      setGeneratingOutline(false);
    }
  };

  // Generate outline for a specific theme (multi-select mode) - independent execution
  const handleGenerateOutlineForTheme = async (theme: { id: number; title: string; description: string; tags: string[]; r18_level: string; category?: string; scenario_count?: number; costume_count?: number }) => {
    // Mark as generating immediately so UI reflects live progress
    setThemeOutlineStates((prev) => ({
      ...prev,
      [theme.id]: { generating: true, outlineArc: '', outlineScenes: [], panels: [], historyId: prev[theme.id]?.historyId, error: undefined },
    }));
    try {
      const res = await generateStoryboardOutline(theme.id, theme.title, panelCount, r18Mode, true);

      // Async mode: track for polling
      if (res.task_id) {
        setPendingPromptTasks((prev) => ({ ...prev, [res.task_id!]: 'outline' }));
        return;
      }

      // Sync fallback
      const historyId = addStoryboardHistory({ plot: theme.title, panel_count: panelCount, r18: r18Mode, panels: res.storyboard });
      setThemeOutlineStates((prev) => ({
        ...prev,
        [theme.id]: {
          generating: false,
          outlineArc: res.outline.arc,
          outlineScenes: res.outline.scenes,
          panels: res.storyboard,
          historyId,
          error: undefined,
        },
      }));
      onSuccess(`「${theme.title}」的大纲已生成`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : `「${theme.title}」分镜生成失败`;
      setThemeOutlineStates((prev) => ({
        ...prev,
        [theme.id]: {
          ...prev[theme.id],
          generating: false,
          error: errMsg,
        },
      }));
      onError(errMsg);
    }
  };

  // Generate outlines for all selected themes independently (each updates its own card state)
  const handleGenerateMultipleOutlines = async () => {
    if (selectedThemes.length === 0) return;
    onSuccess(`开始为 ${selectedThemes.length} 个主题独立生成大纲...`);
    await Promise.all(selectedThemes.map((theme) => handleGenerateOutlineForTheme(theme)));
    onSuccess(`已完成 ${selectedThemes.length} 个主题的大纲生成`);
  };

  // View panels for a specific theme in multi-select mode
  const handleViewThemePanels = (themeId: number) => {
    const state = themeOutlineStates[themeId];
    if (!state) return;
    setActiveThemeTab(themeId);
    setStoryStep('panels');
    if (state.historyId) {
      setCurrentHistoryId(state.historyId);
      const cachedImages = getAllCachedPanelImages(state.historyId, state.panels.length);
      const initial: Record<string, { loading: boolean; images: string[] }> = {};
      for (const [idx, imgs] of Object.entries(cachedImages)) {
        initial[`${state.historyId}_${idx}`] = { loading: false, images: imgs };
      }
      setGenStates(initial);
    } else {
      setGenStates({});
    }
    onSuccess(`已加载「${themeOptions.find((t) => t.id === themeId)?.title}」的分镜`);
  };

  // Load a specific theme's panels to the main panel area
  const handleLoadThemeToPanels = (themeId: number) => {
    const state = themeOutlineStates[themeId];
    if (!state) return;
    const theme = themeOptions.find((t) => t.id === themeId);
    // Set active tab to this theme
    setActiveThemeTab(themeId);
    setStoryStep('panels');
    if (theme && state.historyId) {
      // Reuse existing history entry instead of creating a duplicate
      const historyId = state.historyId;
      setCurrentHistoryId(historyId);
      // Restore cached images for this history entry
      const cachedImages = getAllCachedPanelImages(historyId, state.panels.length);
      const initial: Record<string, { loading: boolean; images: string[] }> = {};
      for (const [idx, imgs] of Object.entries(cachedImages)) {
        initial[`${historyId}_${idx}`] = { loading: false, images: imgs };
      }
      setGenStates(initial);
      saveStoryboardSession({
        plot: theme.title, panelCount, panels: state.panels, expandedPanel: null,
        themeId: theme.id, themeTitle: theme.title, outlineArc: state.outlineArc,
        outlineScenes: state.outlineScenes, historyId,
      });
      setHistory(getStoryboardHistory());
    }
    onSuccess(`已加载「${theme?.title}」到分镜区`);
  };

  // Reset everything
  const handleReset = () => {
    setPlot('');
    setPanels([]);
    setExpandedPanel(null);
    setThemeOptions([]);
    setSelectedTheme(null);
    setSelectedThemes([]);
    setOutlineArc('');
    setOutlineScenes([]);
    setVideoScript(null);
    setStoryStep('themes');
    setGenStates({});
    setCurrentHistoryId(null);
    clearStoryboardSession();
  };

  // Generate video script
  const handleGenerateScript = async () => {
    if (panels.length === 0) { onError('先生成分镜'); return; }
    setGeneratingScript(true);
    try {
      const res = await generateVideoScript(selectedTheme?.title || '默认主题', r18Mode, panels, true);

      // Async mode: track for polling
      if (res.task_id) {
        setPendingPromptTasks((prev) => ({ ...prev, [res.task_id!]: 'script' }));
        onSuccess(`视频脚本生成任务已提交（可后台运行）`);
        setGeneratingScript(false);
        return;
      }

      // Sync fallback
      setVideoScript(res);
      onSuccess('视频脚本已生成');
    } catch (err) {
      onError(err instanceof Error ? err.message : '脚本生成失败');
    } finally {
      setGeneratingScript(false);
    }
  };

  const handleCopyPanel = (panel: { image_prompt: string }, idx: number) => { navigator.clipboard.writeText(panel.image_prompt).then(() => { setCopiedPanel(idx); setTimeout(() => setCopiedPanel(null), 2000); }); };
  const handleCopyAll = () => { navigator.clipboard.writeText(panels.map((p) => `[Panel ${p.panel_number}]\n${p.image_prompt}`).join('\n\n')).then(() => { setCopiedPanel(-1); setTimeout(() => setCopiedPanel(null), 2000); }); };
  const handleDeleteHistory = (id: string) => { removeStoryboardHistory(id); setHistory(getStoryboardHistory()); };
  const handleHistoryLoad = async (item: StoryboardHistoryItem) => {
    setPlot(item.plot);
    setPanels(item.panels);
    setStoryStep('panels');
    setVideoScript(null);
    setOutlineArc('');
    setOutlineScenes([]);
    setSelectedThemes([]);
    setThemeOutlineStates({});
    setShowHistory(false);
    setCurrentHistoryId(item.id);

    // Restore images for this history entry from three sources (same priority as HistoryPage):
    // 1. direct panelImages field in history record (fastest, already in memory)
    // 2. panel image cache (sb_panel_v2_ keys — survives page refresh)
    // 3. zip extraction fallback (guarantees images show even when cache is empty)
    const initial: Record<string, { loading: boolean; images: string[] }> = {};

    if (item.panelImages) {
      const resolved = resolvePanelImages(item.panelImages);
      for (const [idx, imgs] of Object.entries(resolved)) {
        initial[`${item.id}_${idx}`] = { loading: false, images: imgs };
      }
    }

    const cachedImages = getAllCachedPanelImages(item.id, item.panels.length);
    for (const [idx, imgs] of Object.entries(cachedImages)) {
      const key = `${item.id}_${idx}`;
      if (!initial[key]) {
        initial[key] = { loading: false, images: imgs };
      }
    }

    setGenStates(initial);

    // Save theme title to session so handleBatchGenerate can use it even after selectedThemes is cleared
    saveStoryboardSession({
      plot: item.plot, panelCount: item.panel_count, panels: item.panels, expandedPanel: null,
      themeTitle: item.plot, historyId: item.id,
    });
    // Also update selectedTheme so activeThemeInfo is populated for batch generate
    setSelectedTheme({ id: 0, title: item.plot, description: '', tags: [], r18_level: '', category: undefined });

    // Background: try zip extraction for any panels still missing images
    for (let i = 0; i < item.panels.length; i++) {
      const key = `${item.id}_${i}`;
      const current = initial[key];
      if (current?.images.length > 0 && current.images[0]?.startsWith('data:')) continue;

      const count = item.panelImageCounts?.[i] || 4;
      const images = await loadCachedOrExtractPanelImages(item.zipUrl, count, item.id, i);
      if (images.length > 0) {
        setGenStates((prev) => {
          const existing = prev[key];
          if (existing?.images.length > 0 && existing.images[0]?.startsWith('data:')) return prev;
          return { ...prev, [key]: { loading: false, images } };
        });
      }
    }
  };

  const handleToggleFavorite = (imageUrl: string, prompt?: string) => {
    // Use imageRef for lookup since addFavorite stores the URL in imageRef field
    const existing = favorites.find((f) => f.imageRef === imageUrl);
    if (existing) {
      removeFavorite(existing.id);
      setFavorites(getFavorites());
    } else {
      addFavorite({ imageUrl, prompt, source: 'storyboard', r18: r18Mode });
      setFavorites(getFavorites());
    }
  };

  // Handles single-panel image generation (called from StoryboardSection per-panel button).
  // Uses sb_latest_history_id from sessionStorage if available, otherwise sbHistoryId.
  // This ensures the finished-task effect can cache images back to the correct history entry.
  const handleStoryboardGenerateImage = useCallback(async (panelIdx: number, prompt: string) => {
    console.log(`[handleStoryboardGenerateImage] panelIdx=${panelIdx}, digitalHumanMode=${digitalHumanMode}, selectedGirlfriend=${!!selectedGirlfriend}, prompt length=${prompt.length}, prompt preview=${prompt.slice(0, 100)}`);
    if (!prompt.trim()) {
      onError('分镜内容为空，请先生成分镜');
      return;
    }
    if (taskManager.isFull) { onError('任务队列已满'); return; }
    const hid = sessionStorage.getItem('sb_latest_history_id') || sbHistoryId || `temp_${Date.now()}`;
    const key = `${hid}_${panelIdx}`;
    const storyboardInfo = { historyId: hid, panelIdx };
    setGenStates((prev) => ({ ...prev, [key]: { loading: true, images: [] } }));
    let imagePath = selectedGirlfriend?.portraitUrl || '';
    if (digitalHumanMode && selectedGirlfriend) {
      try {
        const res = await fetch(selectedGirlfriend.portraitUrl);
        const blob = await res.blob();
        const file = new File([blob], `${selectedGirlfriend.id}.jpg`, { type: blob.type || 'image/jpeg' });
        const uploadResult = await uploadImage(apiKey, file);
        imagePath = uploadResult.imagePath;
      } catch {
        setGenStates((prev) => { const next = { ...prev }; delete next[key]; return next; });
        onError('AI 女友图片上传失败'); return;
      }
    }
    if (digitalHumanMode && selectedGirlfriend) {
      const charId = (selectedGirlfriend.id as string).toUpperCase().slice(0, 4);
      const anchorPrompt = `【严格锁定】严格锁定图中22岁女性（ID:${charId}），完全保留原有面部特征，五官轮廓、脸型、眼睛、鼻子、嘴唇、发型、肤色、身材比例完全不变，不做任何面部修改，动作流畅不僵硬。超高清8K，写实细节，皮肤质感细腻，无畸变、无模糊、无穿模。`;
      const finalPrompt = `${anchorPrompt}\n\n${prompt}`;
      const nodes = [
        { nodeId: '7', fieldName: 'image', fieldValue: imagePath, description: 'image' },
        { nodeId: '9', fieldName: 'batch_size', fieldValue: String(DEFAULT_TXT2IMG_PARAMS.imageCount), description: 'batch_size' },
        { nodeId: '33', fieldName: 'text', fieldValue: finalPrompt, description: 'text' },
      ];
      try {
        await taskManager.addTask('img2img', nodes, finalPrompt, WORKFLOW.IMAGE_TO_IMAGE, undefined, storyboardInfo);
        onSuccess('分镜图片任务已提交');
      } catch (err) {
        onError(err instanceof Error ? err.message : '提交失败');
        setGenStates((prev) => { const next = { ...prev }; delete next[key]; return next; });
      }
    } else {
      const finalPrompt = `${QUALITY_BOOST_PROMPT}, ${prompt}`;
      const nodes = buildTxt2ImgNodeList({
        width: DEFAULT_TXT2IMG_PARAMS.width,
        height: DEFAULT_TXT2IMG_PARAMS.height,
        imageCount: DEFAULT_TXT2IMG_PARAMS.imageCount,
        prompt: finalPrompt,
        lora1Name: DEFAULT_TXT2IMG_PARAMS.lora1Name,
        lora1Weight: DEFAULT_TXT2IMG_PARAMS.lora1Weight,
        lora2Name: DEFAULT_TXT2IMG_PARAMS.lora2Name,
        lora2Weight: DEFAULT_TXT2IMG_PARAMS.lora2Weight,
      });
      try {
        await taskManager.addTask('txt2img', nodes, finalPrompt, undefined, undefined, storyboardInfo);
        console.log(`[handleStoryboardGenerateImage] submitted txt2img task, prompt length=${finalPrompt.length}, nodes=`, JSON.stringify(nodes));
        onSuccess('分镜图片任务已提交');
      } catch (err) {
        onError(err instanceof Error ? err.message : '提交失败');
        setGenStates((prev) => { const next = { ...prev }; delete next[key]; return next; });
      }
    }
  }, [taskManager, onError, onSuccess, digitalHumanMode, selectedGirlfriend, apiKey, sbHistoryId]);

  // Generate video prompt for a panel based on image prompt
  const generateVideoPromptForPanel = useCallback((imagePrompt: string): string => {
    return extractVideoPromptFromImagePrompt(imagePrompt, r18Mode);
  }, [r18Mode]);

  // Handle image selection for a panel
  const handleSelectPanelImage = useCallback((panelKey: string, imageIndex: number, imageUrl: string) => {
    setSelectedPanelImages(prev => ({
      ...prev,
      [panelKey]: { index: imageIndex, url: imageUrl }
    }));
  }, []);

  // Handle preview images
  const handlePreviewImage = useCallback((images: string[], index: number, prompt?: string) => {
    setPreviewImages(images);
    setPreviewIndex(index);
    setPreviewPrompt(prompt || '');
    setShowPreview(true);
  }, []);

  // Handle direct video generation from storyboard panel
  const handleDirectGenerateVideo = useCallback(async (panelKey: string, imageUrl: string, prompt: string) => {
    setVideoGenLoading(prev => ({ ...prev, [panelKey]: true }));
    try {
      let imagePath = imageUrl;
      if (imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) {
        try {
          const res = await fetch(imageUrl);
          const blob = await res.blob();
          const file = new File([blob], `storyboard_${Date.now()}.jpg`, { type: 'image/jpeg' });
          const { imagePath: uploadedPath } = await uploadImage(apiKey, file);
          imagePath = uploadedPath;
        } catch {
          onError('图片上传失败，请重试');
          setVideoGenLoading(prev => { const next = { ...prev }; delete next[panelKey]; return next; });
          return;
        }
      }

      // Generate video prompt
      const videoPrompt = generateVideoPromptForPanel(prompt);

      // Build node list for video generation (matching ImageToVideoPage format)
      const nodes = [
        { nodeId: '28', fieldName: 'value', fieldValue: '720', description: '最长边' },
        { nodeId: '20', fieldName: 'value', fieldValue: '5', description: '时长（秒）' },
        { nodeId: '77', fieldName: 'value', fieldValue: 'false', description: '补帧（默认关）' },
        { nodeId: '21', fieldName: 'image', fieldValue: imagePath, description: '图片上传' },
        { nodeId: '38', fieldName: 'value', fieldValue: videoPrompt, description: '提示词' },
        { nodeId: '42', fieldName: 'lora_name', fieldValue: 'SmoothMixAnimationStyle_High.safetensors', description: 'lora（high）' },
        { nodeId: '42', fieldName: 'strength_model', fieldValue: '1.0', description: 'lora权重' },
      ];

      // Notify VideoTaskList via localStorage so it shows the task
      const taskId = `storyboard-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const taskData = { id: taskId, prompt: videoPrompt, imagePreview: imageUrl, nodeInfoList: nodes, processed: false };
      localStorage.setItem('nsfwxo_video_task_submit', JSON.stringify(taskData));
      window.dispatchEvent(new StorageEvent('storage', { key: 'nsfwxo_video_task_submit', newValue: JSON.stringify(taskData) }));

      await taskManager.addTask('img2vid', nodes, videoPrompt, WORKFLOW.IMAGE_TO_VIDEO);
      onSuccess('视频生成任务已提交');
    } catch (err) {
      onError(err instanceof Error ? err.message : '视频生成失败');
    } finally {
      setVideoGenLoading(prev => { const next = { ...prev }; delete next[panelKey]; return next; });
    }
  }, [apiKey, taskManager, onError, onSuccess, generateVideoPromptForPanel]);

  // Handle batch video generation from storyboard panels
  const handleBatchGenerateVideo = useCallback(async () => {
    if (activePanels.length === 0) { onError('没有可用的分镜'); return; }
    setBatchVideoLoading(true);
    let submitted = 0;
    const submittedTasks: Array<{ id: string; prompt: string; imagePreview: string; nodeInfoList: NodeInfo[] }> = [];
    try {
      for (let i = 0; i < activePanels.length; i++) {
        const panel = activePanels[i];
        const panelKey = `panel-${i}`;
        const panelGenState = genStates[`${sbHistoryId}_${i}`];
        const panelTasks = taskManager.tasks.filter((t) => t.prompt === panel.image_prompt && t.images.length > 0);
        let imageUrl = '';

        // Priority 1: User manually selected an image for this panel
        const manualSelection = selectedPanelImages[panelKey];
        if (manualSelection) {
          imageUrl = manualSelection.url;
        }
        // Priority 2: Local genState (includes cached images from history)
        else if (panelGenState?.images && panelGenState.images.length > 0) {
          imageUrl = panelGenState.images[0];
        }
        // Priority 3: Task manager tasks (live running tasks)
        else if (panelTasks.length > 0) {
          imageUrl = panelTasks[0].images[0];
        }

        if (!imageUrl) continue;

        // Upload image if needed (only local data URLs need upload)
        let imagePath = imageUrl;
        if (imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) {
          try {
            const res = await fetch(imageUrl);
            const blob = await res.blob();
            const file = new File([blob], `storyboard_video_${Date.now()}_${i}.jpg`, { type: 'image/jpeg' });
            const uploadResult = await uploadImage(apiKey, file);
            imagePath = uploadResult.imagePath;
          } catch {
            onError(`分镜 ${i + 1} 图片上传失败`);
            continue;
          }
        }

        // Generate video prompt
        const videoPrompt = generateVideoPromptForPanel(panel.image_prompt);

        // Build node list for video generation (matching ImageToVideoPage format)
        const nodes = [
          { nodeId: '28', fieldName: 'value', fieldValue: '720', description: '最长边' },
          { nodeId: '20', fieldName: 'value', fieldValue: '5', description: '时长（秒）' },
          { nodeId: '77', fieldName: 'value', fieldValue: 'false', description: '补帧（默认关）' },
          { nodeId: '21', fieldName: 'image', fieldValue: imagePath, description: '图片上传' },
          { nodeId: '38', fieldName: 'value', fieldValue: videoPrompt, description: '提示词' },
          { nodeId: '42', fieldName: 'lora_name', fieldValue: 'SmoothMixAnimationStyle_High.safetensors', description: 'lora（high）' },
          { nodeId: '42', fieldName: 'strength_model', fieldValue: '1.0', description: 'lora权重' },
        ];

        try {
          const taskId = `storyboard-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          submittedTasks.push({ id: taskId, prompt: videoPrompt, imagePreview: imageUrl, nodeInfoList: nodes });
          await taskManager.addTask('img2vid', nodes, videoPrompt, WORKFLOW.IMAGE_TO_VIDEO);
          submitted++;
        } catch (err) {
          onError(`提交分镜 ${i + 1} 视频任务失败: ${err instanceof Error ? err.message : '未知错误'}`);
        }
      }
      // Notify VideoTaskList about all submitted tasks
      if (submittedTasks.length > 0) {
        const batchData = { tasks: submittedTasks, processed: false };
        localStorage.setItem('nsfwxo_video_task_batch', JSON.stringify(batchData));
        window.dispatchEvent(new StorageEvent('storage', { key: 'nsfwxo_video_task_batch', newValue: JSON.stringify(batchData) }));
      }
      if (submitted > 0) {
        onSuccess(`已提交 ${submitted} 个视频生成任务`);
      } else {
        onError('没有找到已生成的图片，请先生成分镜图片');
      }
    } finally {
      setBatchVideoLoading(false);
    }
  }, [activePanels, genStates, taskManager, apiKey, generateVideoPromptForPanel, onError, onSuccess]);

  const handleBatchGenerate = useCallback(async () => {
    if (activePanels.length === 0) return;
    const availableSlots = 20 - taskManager.tasks.length;
    if (availableSlots <= 0) { onError('任务队列已满'); return; }
    setBatchLoading(true);
    let submitted = 0;

    // Create a new history entry for the regenerated images — don't overwrite existing history
    const newHistoryId = addStoryboardHistory({
      plot: activeThemeInfo?.title || selectedThemes[0]?.title || '新生成',
      panel_count: activePanels.length,
      r18: r18Mode,
      panels: activePanels,
    });
    setCurrentHistoryId(newHistoryId);
    const hid = newHistoryId;

    // Mark all panels as loading immediately (use string keys for multi-theme support)
    setGenStates((prev) => {
      const next = { ...prev };
      for (let i = 0; i < activePanels.length; i++) {
        next[`${hid}_${i}`] = { loading: true, images: [] };
      }
      return next;
    });
    let imagePath = selectedGirlfriend?.portraitUrl || '';
    if (digitalHumanMode && selectedGirlfriend) {
      try {
        const res = await fetch(selectedGirlfriend.portraitUrl);
        const blob = await res.blob();
        const file = new File([blob], `${selectedGirlfriend.id}.jpg`, { type: blob.type || 'image/jpeg' });
        const uploadResult = await uploadImage(apiKey, file);
        imagePath = uploadResult.imagePath;
      } catch {
        setBatchLoading(false);
        onError('AI 女友图片上传失败'); return;
      }
    }
    const toSubmit = activePanels.slice(0, availableSlots);
    console.log(`[handleBatchGenerate] activePanels.length=${activePanels.length}, toSubmit.length=${toSubmit.length}, r18Mode=${r18Mode}`);
    for (let i = 0; i < toSubmit.length; i++) {
      console.log(`[handleBatchGenerate] panel[${i}].image_prompt = "${toSubmit[i].image_prompt.slice(0, 100)}" (length=${toSubmit[i].image_prompt.length})`);
    }
    const tasks: (() => Promise<void>)[] = toSubmit.map((panel, i) => {
      const panelIdx = i;
      console.log(`[handleBatchGenerate] task[${i}] using panel.image_prompt="${panel.image_prompt.slice(0, 100)}" (length=${panel.image_prompt.length})`);
      const panelStoryboardInfo = { historyId: hid, panelIdx };
      return async () => {
        if (digitalHumanMode && selectedGirlfriend) {
          const charName = selectedGirlfriend.nameZh || selectedGirlfriend.name;
          const charId = (selectedGirlfriend.id as string).toUpperCase().slice(0, 4);
          const anchorPrompt = `【严格锁定】严格锁定图中22岁女性（ID:${charId}），完全保留原有面部特征，五官轮廓、脸型、眼睛、鼻子、嘴唇、发型、肤色、身材比例完全不变，不做任何面部修改，动作流畅不僵硬。超高清8K，写实细节，皮肤质感细腻，无畸变、无模糊、无穿模。`;
          const finalPrompt = `${anchorPrompt}\n\n${panel.image_prompt}`;
          const nodes = [
            { nodeId: '7', fieldName: 'image', fieldValue: imagePath, description: 'image' },
            { nodeId: '9', fieldName: 'batch_size', fieldValue: String(DEFAULT_TXT2IMG_PARAMS.imageCount), description: 'batch_size' },
            { nodeId: '33', fieldName: 'text', fieldValue: finalPrompt, description: 'text' },
          ];
          await taskManager.addTask('img2img', nodes, finalPrompt, WORKFLOW.IMAGE_TO_IMAGE, undefined, panelStoryboardInfo);
        } else {
          const finalPrompt = `${QUALITY_BOOST_PROMPT}, ${panel.image_prompt}`;
          const nodes = buildTxt2ImgNodeList({
            width: DEFAULT_TXT2IMG_PARAMS.width,
            height: DEFAULT_TXT2IMG_PARAMS.height,
            imageCount: DEFAULT_TXT2IMG_PARAMS.imageCount,
            prompt: finalPrompt,
            lora1Name: DEFAULT_TXT2IMG_PARAMS.lora1Name,
            lora1Weight: DEFAULT_TXT2IMG_PARAMS.lora1Weight,
            lora2Name: DEFAULT_TXT2IMG_PARAMS.lora2Name,
            lora2Weight: DEFAULT_TXT2IMG_PARAMS.lora2Weight,
          });
          await taskManager.addTask('txt2img', nodes, finalPrompt, undefined, undefined, panelStoryboardInfo);
        }
      };
    });
    const settled = await Promise.allSettled(tasks.map((t) => t()));
    submitted = settled.filter((r) => r.status === 'fulfilled').length;
    settled.forEach((r, i) => {
      if (r.status === 'rejected') {
        onError(`提交第 ${i + 1} 个时失败: ${r.reason instanceof Error ? r.reason.message : '未知错误'}`);
      }
    });
    setBatchLoading(false);
    setHistory(getStoryboardHistory());
    if (submitted > 0) {
      onSuccess(`已提交 ${submitted} 个生图任务`);
    }
  }, [activePanels, activeThemeInfo, selectedThemes, taskManager, setGenStates, onError, onSuccess, digitalHumanMode, selectedGirlfriend, apiKey, r18Mode]);

  const hasContent = storyStep === 'panels' && panels.length > 0;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white border border-border shadow-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <LayoutList size={14} className={r18Mode ? 'text-red-500' : 'text-primary'} />
            <span className="text-sm font-medium text-text-primary">
              剧情分镜{r18Mode && <span className="ml-2 text-xs text-red-500 font-medium">(R18)</span>}
            </span>
          </div>
          <button onClick={() => setShowHistory(!showHistory)} className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium transition-all ${showHistory ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'}`}>
            <History size={12} />历史记录{favorites.length > 0 && <span className="px-1 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold">{favorites.length}</span>}
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-3">
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${storyStep === 'themes' ? 'bg-primary text-white' : 'bg-bg-elevated text-text-tertiary'}`}>
            <span className="w-4 h-4 rounded-full bg-current/20 flex items-center justify-center text-[10px] font-bold">1</span>
            <span>选主题</span>
          </div>
          <div className="flex-1 h-px bg-border" />
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${storyStep === 'outline' ? 'bg-primary text-white' : storyStep === 'panels' ? 'bg-green-500 text-white' : 'bg-bg-elevated text-text-tertiary'}`}>
            <span className="w-4 h-4 rounded-full bg-current/20 flex items-center justify-center text-[10px] font-bold">2</span>
            <span>生成大纲</span>
          </div>
          <div className="flex-1 h-px bg-border" />
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${storyStep === 'panels' ? 'bg-green-500 text-white' : 'bg-bg-elevated text-text-tertiary'}`}>
            <span className="w-4 h-4 rounded-full bg-current/20 flex items-center justify-center text-[10px] font-bold">3</span>
            <span>分镜就绪</span>
          </div>
        </div>

        {/* ── Theme Selection Area ── */}
        {/* Panel count selector */}
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs text-text-tertiary">分镜数量:</span>
          <div className="flex gap-1">
            {[5, 6, 7, 8, 9, 10].map((n) => (
              <button key={n} onClick={() => setPanelCount(n)} className={`w-8 h-7 rounded-lg text-xs font-medium transition-all ${panelCount === n ? 'bg-primary text-white' : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'}`}>{n}</button>
            ))}
          </div>
        </div>

        {/* Theme library button + custom mode */}
        <div className="space-y-2">
          {/* Primary actions */}
          <div className="flex gap-2">
            <button
              onClick={handleOpenThemeLibrary}
              disabled={loadingThemeLibrary}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all ${
                loadingThemeLibrary
                  ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                  : r18Mode
                    ? 'bg-gradient-to-r from-red-500 to-red-600 text-white hover:opacity-90 active:scale-[0.98]'
                    : 'bg-gradient-to-r from-primary to-primary/80 text-white hover:opacity-90 active:scale-[0.98]'
              }`}
            >
              {loadingThemeLibrary ? (
                <><Loader2 size={16} className="animate-spin" /> 加载主题库...</>
              ) : (
                <><LayoutList size={16} />从主题库选择</>
              )}
            </button>
            <button
              onClick={() => handleGenerateThemes()}
              disabled={loading}
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium text-sm transition-all ${
                loading
                  ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                  : r18Mode
                    ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 active:scale-[0.98]'
                    : 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:opacity-90 active:scale-[0.98]'
              }`}
            >
              {loading ? (
                <><Loader2 size={16} className="animate-spin" /> 生成中...</>
              ) : (
                <><Wand2 size={16} />随机生成</>
              )}
            </button>
          </div>

          {/* Custom description toggle */}
          <div className="p-3 rounded-xl border border-border bg-bg-elevated">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-text-primary">自定义选题</span>
                <span className="text-[10px] text-text-tertiary">输入描述生成主题</span>
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
                  placeholder="例如：办公室暧昧、浴室激情、古风青楼..."
                  className="w-full px-3 py-2 rounded-lg bg-white border border-border text-sm text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                  rows={2}
                />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-tertiary">数量:</span>
                  <input
                    type="number"
                    value={customThemeCount}
                    onChange={(e) => setCustomThemeCount(Math.max(5, Math.min(20, parseInt(e.target.value) || 5)))}
                    min={5}
                    max={20}
                    className="w-14 px-2 py-1 rounded-lg bg-white border border-border text-xs text-text-primary text-center focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <span className="text-xs text-text-tertiary">个</span>
                  <div className="flex-1" />
                  <button
                    onClick={() => handleGenerateThemes()}
                    disabled={loading || !customThemeDescription.trim()}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      loading || !customThemeDescription.trim()
                        ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                        : r18Mode
                          ? 'bg-red-500 text-white hover:bg-red-600'
                          : 'bg-primary text-white hover:bg-primary/90'
                    }`}
                  >
                    {loading ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                    根据描述生成
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Theme Library Modal ── */}
        {themeLibraryOpen && (
          <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4 animate-fade-in" onClick={() => setThemeLibraryOpen(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden animate-slide-up" onClick={(e) => e.stopPropagation()}>
              {/* Modal header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
                <div className="flex items-center gap-2">
                  <LayoutList size={18} className="text-primary" />
                  <span className="font-semibold text-text-primary">主题库</span>
                  <span className="px-2 py-0.5 rounded-full text-[11px] bg-bg-elevated text-text-tertiary">{themeOptions.length} 个主题</span>
                </div>
                <button onClick={() => setThemeLibraryOpen(false)} className="p-2 rounded-lg hover:bg-bg-hover transition-colors">
                  <X size={18} className="text-text-tertiary" />
                </button>
              </div>

              {/* Search & filter */}
              <div className="px-5 py-3 border-b border-border flex-shrink-0 space-y-2">
                <input
                  type="text"
                  placeholder="搜索主题..."
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
                    { label: '多人', cat: 'multi' },
                    { label: '特殊', cat: 'special' },
                    { label: '玩具', cat: 'toys' },
                    { label: '口交', cat: 'oral' },
                    { label: '肛交', cat: 'anal' },
                    { label: '体液', cat: 'fluid' },
                    { label: '颜射', cat: 'facial' },
                    { label: '交通', cat: 'transport' },
                  ].map(({ label, cat }) => (
                    <button
                      key={cat}
                      onClick={() => setThemeCategoryFilter(cat)}
                      className={`px-2 py-0.5 rounded-full text-[11px] transition-all ${
                        themeCategoryFilter === cat
                          ? 'bg-primary text-white'
                          : 'bg-bg-elevated text-text-secondary hover:bg-primary hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Theme grid */}
              <div className="flex-1 overflow-y-auto p-5">
                {loadingThemeLibrary ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 size={24} className="animate-spin text-text-tertiary" />
                  </div>
                ) : themeOptions.length === 0 ? (
                  <div className="text-center py-12 text-text-tertiary text-sm">
                    <LayoutList size={32} className="mx-auto mb-2 opacity-40" />
                    <p>暂无主题，请先点击「从主题库选择」加载</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* Filtered themes based on search and category */}
                    {(() => {
                      const filteredThemes = themeOptions.filter((t) => {
                        const matchesCategory = !themeCategoryFilter || t.category === themeCategoryFilter;
                        const matchesSearch = !themeSearchQuery ||
                          t.title.toLowerCase().includes(themeSearchQuery) ||
                          t.description.toLowerCase().includes(themeSearchQuery) ||
                          t.tags.some((tag) => tag.toLowerCase().includes(themeSearchQuery));
                        return matchesCategory && matchesSearch;
                      });
                      return (
                        <>
                          <div className="flex items-center gap-2 px-1">
                            <span className="text-xs text-text-tertiary">显示 {filteredThemes.length} / {themeOptions.length} 个主题</span>
                          </div>
                          {filteredThemes.length === 0 ? (
                            <div className="text-center py-8 text-text-tertiary text-sm">
                              <p>没有找到匹配的主题</p>
                            </div>
                          ) : (
                            <>
                              {/* Select all filtered */}
                              {filteredThemes.length > 1 && (
                                <div className="flex items-center gap-2 px-1">
                                  <button
                                    onClick={() => {
                                      const filteredIds = filteredThemes.map((t) => t.id);
                                      const currentlySelectedIds = selectedThemes.map((t) => t.id);
                                      const allFilteredSelected = filteredIds.every((id) => currentlySelectedIds.includes(id));
                                      if (allFilteredSelected) {
                                        // Deselect all filtered
                                        setSelectedThemes(selectedThemes.filter((t) => !filteredIds.includes(t.id)));
                                      } else {
                                        // Select all filtered
                                        const newThemes = [...selectedThemes.filter((t) => !filteredIds.includes(t.id)), ...filteredThemes];
                                        setSelectedThemes(newThemes);
                                      }
                                    }}
                                    className="flex items-center gap-2 text-xs text-text-secondary hover:text-primary transition-colors"
                                  >
                                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                                      (() => {
                                        const filteredIds = filteredThemes.map((t) => t.id);
                                        const currentlySelectedIds = selectedThemes.map((t) => t.id);
                                        return filteredIds.length > 0 && filteredIds.every((id) => currentlySelectedIds.includes(id));
                                      })()
                                        ? 'bg-primary border-primary'
                                        : 'border-border hover:border-primary'
                                    }`}>
                                      {((): boolean => {
                                        const filteredIds = filteredThemes.map((t) => t.id);
                                        const currentlySelectedIds = selectedThemes.map((t) => t.id);
                                        return filteredIds.length > 0 && filteredIds.every((id) => currentlySelectedIds.includes(id));
                                      })() && (
                                        <Check size={10} className="text-white" />
                                      )}
                                    </div>
                                    <span className="font-medium">全选 ({(() => {
                                      const filteredIds = filteredThemes.map((t) => t.id);
                                      const currentlySelectedIds = selectedThemes.map((t) => t.id);
                                      return filteredIds.filter((id) => currentlySelectedIds.includes(id)).length;
                                    })()}/{filteredThemes.length})</span>
                                  </button>
                                </div>
                              )}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {filteredThemes.map((theme) => {
                        const isAlreadySelected = selectedThemes.some((t) => t.id === theme.id);
                        return (
                          <div
                            key={theme.id}
                            onClick={() => {
                              if (isAlreadySelected) {
                                setSelectedThemes(selectedThemes.filter((t) => t.id !== theme.id));
                              } else {
                                setSelectedThemes([...selectedThemes, theme]);
                              }
                              // Stay in modal — no auto-navigation
                            }}
                            className={`relative p-3 rounded-xl border cursor-pointer transition-all ${
                              isAlreadySelected
                                ? 'border-green-400 bg-green-50/50'
                                : 'border-border bg-bg-elevated hover:bg-bg-hover hover:border-primary/40'
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              {/* Checkbox */}
                              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${
                                isAlreadySelected
                                  ? 'bg-green-500 border-green-500'
                                  : 'border-border bg-white'
                              }`}>
                                {isAlreadySelected && <Check size={10} className="text-white" />}
                              </div>
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                                isAlreadySelected ? 'bg-green-500 text-white' : r18Mode ? 'bg-red-100 text-red-600' : 'bg-primary/10 text-primary'
                              }`}>
                                {theme.id}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                                  <p className="text-sm font-semibold text-text-primary leading-tight">{theme.title}</p>
                                  {theme.category && (
                                    <span className="text-[9px] px-1 py-0.5 rounded-full bg-bg-elevated text-text-tertiary">{theme.category}</span>
                                  )}
                                  <span className={`text-[9px] px-1 py-0.5 rounded-full font-medium ${
                                    theme.r18_level === 'hard' ? 'bg-red-100 text-red-600' : theme.r18_level === 'medium' ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'
                                  }`}>
                                    {theme.r18_level === 'hard' ? '高强度' : theme.r18_level === 'medium' ? '中等' : '柔和'}
                                  </span>
                                </div>
                                <p className="text-[11px] text-text-tertiary leading-relaxed line-clamp-2">{theme.description}</p>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {theme.tags.slice(0, 3).map((tag, i) => (
                                    <span key={i} className="text-[9px] px-1 py-0.5 rounded-full bg-bg-elevated text-text-secondary">{tag}</span>
                                  ))}
                                </div>
                                {(theme.scenario_count || 0) > 0 || (theme.costume_count || 0) > 0 ? (
                                  <div className="flex flex-wrap gap-1 mt-1.5">
                                    {(theme.scenario_count || 0) > 0 && (
                                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">
                                        {theme.scenario_count} 个场景
                                      </span>
                                    )}
                                    {(theme.costume_count || 0) > 0 && (
                                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-600 font-medium">
                                        {theme.costume_count} 种服装
                                      </span>
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                            </>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* Modal footer */}
              <div className="px-5 py-3 border-t border-border flex items-center justify-between flex-shrink-0 bg-bg-elevated/50">
                <span className="text-xs text-text-tertiary">已选 {selectedThemes.length} 个主题</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setThemeLibraryOpen(false)}
                    className="px-4 py-2 rounded-lg text-xs text-text-tertiary hover:bg-bg-hover transition-all"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => {
                      // Keep modal open, user can continue adjusting selections
                      // Only close if they click "确定" or manually close
                    }}
                    className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                      selectedThemes.length > 0
                        ? 'bg-green-500 text-white hover:bg-green-600'
                        : 'bg-primary text-white hover:bg-primary/90'
                    }`}
                  >
                    {selectedThemes.length > 0
                      ? `已选 ${selectedThemes.length} 个，确定`
                      : '全选全部主题'}
                  </button>
                  {selectedThemes.length === themeOptions.length && (
                    <button
                      onClick={() => setSelectedThemes([])}
                      className="px-4 py-2 rounded-lg text-xs text-text-tertiary hover:bg-bg-hover transition-all"
                    >
                      取消全选
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Selected themes panel (always visible when themes are selected) ── */}
        {storyStep === 'themes' && selectedThemes.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-text-primary">已选主题</span>
                <span className="px-1.5 py-0.5 rounded-full text-[11px] bg-primary/10 text-primary font-medium">{selectedThemes.length}</span>
              </div>
              <button
                onClick={handleGenerateSelectedThemes}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  r18Mode
                    ? 'bg-gradient-to-r from-red-500 to-red-600 text-white hover:opacity-90'
                    : 'bg-gradient-to-r from-primary to-primary/80 text-white hover:opacity-90'
                }`}
              >
                <Wand2 size={12} />
                为 {selectedThemes.length} 个主题生成大纲
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {selectedThemes.map((theme) => {
                const state = themeOutlineStates[theme.id];
                const isGenerating = !!state?.generating;
                const isDone = !!state?.outlineArc;
                const hasError = !!state?.error;
                return (
                  <div
                    key={theme.id}
                    className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${
                      isDone
                        ? 'border-green-300 bg-green-50/30'
                        : isGenerating
                          ? 'border-yellow-300 bg-yellow-50/30'
                          : hasError
                            ? 'border-red-300 bg-red-50/30'
                            : 'border-border bg-bg-elevated'
                    }`}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRemoveThemeFromSelected(theme.id); }}
                      className="flex-shrink-0 p-0.5 rounded text-text-tertiary hover:text-red-500 transition-colors mt-0.5"
                      title="移除"
                    >
                      <X size={14} />
                    </button>
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                      isDone ? 'bg-green-500 border-green-500' : hasError ? 'bg-red-500 border-red-500' : 'border-border'
                    }`}>
                      {isDone ? <Check size={10} className="text-white" /> : hasError ? <AlertCircle size={10} className="text-white" /> : null}
                    </div>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                      isDone ? 'bg-green-500 text-white' : isGenerating ? 'bg-yellow-500 text-white' : hasError ? 'bg-red-500 text-white' : r18Mode ? 'bg-red-100 text-red-600' : 'bg-primary/10 text-primary'
                    }`}>
                      {isGenerating ? <Loader2 size={10} className="animate-spin" /> : theme.id}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <p className="text-sm font-semibold text-text-primary">{theme.title}</p>
                        {theme.category && (
                          <span className="text-[9px] px-1 py-0.5 rounded-full bg-bg-elevated text-text-tertiary">{theme.category}</span>
                        )}
                        <span className={`text-[9px] px-1 py-0.5 rounded-full font-medium ${
                          theme.r18_level === 'hard' ? 'bg-red-100 text-red-600' : theme.r18_level === 'medium' ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'
                        }`}>
                          {theme.r18_level === 'hard' ? '高强度' : theme.r18_level === 'medium' ? '中等' : '柔和'}
                        </span>
                        {isDone && <span className="text-[9px] text-green-600 font-medium">已生成</span>}
                        {isGenerating && <span className="text-[9px] text-yellow-600 font-medium animate-pulse">生成中...</span>}
                        {hasError && <span className="text-[9px] text-red-500 font-medium">失败</span>}
                      </div>
                      {hasError ? (
                        <p className="text-[11px] text-red-400 leading-relaxed line-clamp-1">{state.error}</p>
                      ) : (
                        <p className="text-[11px] text-text-tertiary leading-relaxed line-clamp-1">
                          {isDone && state ? state.outlineArc : theme.description}
                        </p>
                      )}
                      {isDone && (
                        <p className="text-[10px] text-text-tertiary mt-0.5">{state.panels.length} 个分镜</p>
                      )}
                      {/* Action buttons */}
                      <div className="flex items-center gap-1.5 mt-2">
                        {isDone && state && (
                          <>
                            <button
                              onClick={() => {
                                setActiveThemeTab(theme.id);
                                setPanels(state.panels);
                                setOutlineArc(state.outlineArc);
                                setOutlineScenes(state.outlineScenes);
                                setStoryStep('panels');
                                const hid = state.historyId;
                                if (hid) {
                                  setCurrentHistoryId(hid);
                                  const cached = getAllCachedPanelImages(hid, state.panels.length);
                                  if (Object.keys(cached).length > 0) {
                                    const initial: Record<string, { loading: boolean; images: string[] }> = {};
                                    for (const [idx, imgs] of Object.entries(cached)) {
                                      initial[`${hid}_${idx}`] = { loading: false, images: imgs };
                                    }
                                    setGenStates(initial);
                                  }
                                }
                              }}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-primary text-white hover:bg-primary/90 transition-all"
                            >
                              加载分镜
                            </button>
                            <button
                              onClick={() => handleGenerateOutlineSingle(theme)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-bg-elevated text-text-secondary hover:bg-bg-hover transition-all"
                            >
                              重新生成
                            </button>
                          </>
                        )}
                        {!isGenerating && !isDone && (
                          <button
                            onClick={() => handleGenerateOutlineSingle(theme)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                              hasError
                                ? 'bg-red-500 text-white hover:bg-red-600'
                                : r18Mode ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-primary text-white hover:bg-primary/90'
                            }`}
                          >
                            {hasError ? '重试' : '生成大纲'}
                          </button>
                        )}
                        {isGenerating && (
                          <button
                            onClick={() => {
                              setThemeOutlineStates((prev) => {
                                const next = { ...prev };
                                delete next[theme.id];
                                return next;
                              });
                            }}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-bg-elevated text-text-secondary hover:bg-bg-hover transition-all"
                          >
                            取消
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Theme grid for selection (always visible when there are themes to choose from) ── */}
        {storyStep === 'themes' && themeOptions.length > 0 && (
          <div className="space-y-2 mt-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-text-tertiary font-medium">请选择主题（{themeOptions.length} 个可选）</p>
              <button
                onClick={() => setSelectedThemes([...themeOptions])}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-primary hover:bg-primary/5 transition-all"
              >
                <Check size={10} />
                全选
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {themeOptions.map((theme) => {
                const isSelected = selectedThemes.some((t) => t.id === theme.id);
                return (
                  <button
                    type="button"
                    key={theme.id}
                    onClick={() => {
                      if (isSelected) {
                        setSelectedThemes(selectedThemes.filter((t) => t.id !== theme.id));
                      } else {
                        setSelectedThemes((prev) => [...prev, theme]);
                      }
                    }}
                    className={`w-full text-left p-3 rounded-xl border transition-all ${
                      isSelected
                        ? 'border-green-400 bg-green-50/30'
                        : 'border-border bg-bg-elevated hover:bg-bg-hover'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${
                        isSelected ? 'bg-green-500 border-green-500' : 'border-border bg-white'
                      }`}>
                        {isSelected && <Check size={10} className="text-white" />}
                      </div>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${isSelected ? 'bg-green-500 text-white' : r18Mode ? 'bg-red-100 text-red-600' : 'bg-primary/10 text-primary'}`}>
                        {theme.id}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className={`text-sm font-semibold ${r18Mode ? 'text-red-700' : 'text-text-primary'}`}>{theme.title}</p>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${theme.r18_level === 'hard' ? 'bg-red-100 text-red-600' : theme.r18_level === 'medium' ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'}`}>
                            {theme.r18_level === 'hard' ? '高强度' : theme.r18_level === 'medium' ? '中等' : '柔和'}
                          </span>
                          {theme.category && (
                            <span className="text-[9px] px-1 py-0.5 rounded-full bg-bg-elevated text-text-tertiary">{theme.category}</span>
                          )}
                        </div>
                        <p className="text-xs text-text-tertiary leading-relaxed">{theme.description}</p>
                        {theme.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {theme.tags.map((tag, i) => (
                              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-elevated text-text-secondary">{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 3: Outline + panels */}
        {storyStep === 'panels' && panels.length > 0 && (
          <>
            {outlineArc && (
              <div className={`mb-3 p-3 rounded-xl border ${r18Mode ? 'bg-red-50/40 border-red-200' : 'bg-primary/5 border-primary/20'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <Clapperboard size={14} className={r18Mode ? 'text-red-500' : 'text-primary'} />
                  <span className={`text-xs font-semibold ${r18Mode ? 'text-red-600' : 'text-primary'}`}>剧情大纲</span>
                </div>
                <p className="text-sm font-medium text-text-primary mb-2">{outlineArc}</p>
                {outlineScenes.length > 0 && (
                  <div className="space-y-1.5">
                    {outlineScenes.map((scene, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5 ${r18Mode ? 'bg-red-500 text-white' : 'bg-primary text-white'}`}>{i + 1}</span>
                        <p className="text-xs text-text-secondary leading-relaxed">{scene}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              <button onClick={handleCopyAll} className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl font-medium text-sm bg-bg-elevated text-text-tertiary hover:bg-bg-hover transition-colors">
                {copiedPanel === -1 ? <><Check size={14} className="text-green-500" /> 已复制</> : <><Copy size={14} />复制全部</>}
              </button>
              <button
                onClick={handleGenerateScript}
                disabled={generatingScript}
                className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl font-medium text-sm transition-all ${generatingScript ? 'bg-bg-elevated text-text-secondary cursor-not-allowed' : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:opacity-90'}`}
              >
                {generatingScript ? <><Loader2 size={14} className="animate-spin" /> 生成脚本...</> : <><Clapperboard size={14} />生成视频脚本</>}
              </button>
              <button onClick={() => { setStoryStep('themes'); setSelectedTheme(null); setOutlineArc(''); setOutlineScenes([]); setPanels([]); setVideoScript(null); }} className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl font-medium text-sm bg-bg-elevated text-text-tertiary hover:bg-bg-hover transition-colors">
                <RotateCcw size={14} />换主题
              </button>
            </div>

            {/* Video Script Display */}
            {videoScript && (
              <div className={`mt-3 p-3 rounded-xl border ${r18Mode ? 'bg-purple-50/40 border-purple-200' : 'bg-purple-50/40 border-purple-200'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Clapperboard size={14} className="text-purple-500" />
                    <span className="text-xs font-semibold text-purple-600">视频脚本</span>
                    {videoScript.duration && <span className="text-[10px] text-purple-400">{videoScript.duration}</span>}
                  </div>
                  <button onClick={() => setVideoScript(null)} className="text-xs text-purple-400 hover:text-purple-600">
                    <X size={14} />
                  </button>
                </div>
                <p className="text-sm font-medium text-text-primary mb-2">{videoScript.script_title}</p>
                <div className="space-y-2">
                  {videoScript.panels.map((sp) => (
                    <div key={sp.panel} className={`rounded-lg p-3 text-xs ${r18Mode ? 'bg-red-50/50 border border-red-100' : 'bg-bg-elevated'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${r18Mode ? 'bg-red-500' : 'bg-purple-500'}`}>{sp.panel}</span>
                        <span className="font-medium text-text-primary">{sp.heading}</span>
                      </div>
                      {sp.action && <p className="text-text-secondary leading-relaxed mb-1"><span className="text-text-tertiary">动作: </span>{sp.action}</p>}
                      {sp.dialogue && <p className="text-text-secondary leading-relaxed mb-1"><span className="text-text-tertiary">对白: </span><em>"{sp.dialogue}"</em></p>}
                      {sp.sound_cue && <p className="text-text-secondary leading-relaxed mb-1"><span className="text-text-tertiary">音效: </span><span className="text-purple-500">{sp.sound_cue}</span></p>}
                      {sp.camera && <p className="text-text-secondary leading-relaxed"><span className="text-text-tertiary">镜头: </span><span className="text-blue-500">{sp.camera}</span></p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {hasContent && (
          <button onClick={handleReset} className="w-full mt-2 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl font-medium text-sm bg-bg-elevated text-text-tertiary hover:bg-bg-hover transition-colors">
            <RotateCcw size={14} />重新开始
          </button>
        )}
      </div>

      {/* Storyboard History + Favorites */}
      {showHistory && (
        <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
          <div className="flex items-center border-b border-border/50 bg-bg-elevated">
            <button
              onClick={() => setHistoryTab('history')}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-r border-border/50 transition-all ${historyTab === 'history' ? 'text-primary border-b-2 border-primary bg-white' : 'text-text-tertiary hover:text-text-primary'}`}
            >
              <History size={12} />
              分镜历史<span className="px-1.5 py-0.5 rounded-full text-[10px] bg-bg-elevated">{history.length}</span>
            </button>
            <button
              onClick={() => setHistoryTab('favorites')}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-r border-border/50 transition-all ${historyTab === 'favorites' ? 'text-red-500 border-b-2 border-red-500 bg-white' : 'text-text-tertiary hover:text-text-primary'}`}
            >
              <Heart size={12} />
              我的收藏<span className="px-1.5 py-0.5 rounded-full text-[10px] bg-bg-elevated">{favorites.length}</span>
            </button>
            <div className="flex-1" />
            <button onClick={() => setShowHistory(false)} className="px-3 py-2.5 text-text-tertiary hover:text-text-primary transition-colors">
              <X size={14} />
            </button>
          </div>
          <div className="max-h-[500px] overflow-y-auto">
            {historyTab === 'history' ? (
              <StoryboardHistoryList
                history={history}
                onLoad={handleHistoryLoad}
                onDelete={handleDeleteHistory}
              />
            ) : (
              <FavoritesList
                favorites={favorites}
                r18Mode={r18Mode}
                onRemove={(id) => { removeFavorite(id); setFavorites(getFavorites()); }}
                onClear={() => { clearFavorites(); setFavorites([]); }}
              />
            )}
          </div>
        </div>
      )}

      {/* Panels */}
      {storyStep === 'panels' && activePanels.length > 0 && (
        <div className="space-y-3">
          {/* Theme tabs - show when multiple themes have generated outlines */}
          {selectedThemes.length > 0 && selectedThemes.some((t) => themeOutlineStates[t.id]?.outlineArc) && (
            <div className="flex flex-wrap gap-2 px-1">
              {selectedThemes.filter((t) => themeOutlineStates[t.id]?.outlineArc).map((theme) => {
                const isActive = activeThemeTab === theme.id;
                return (
                  <button
                    key={theme.id}
                    onClick={() => handleViewThemePanels(theme.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isActive
                        ? 'bg-primary text-white shadow-sm'
                        : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                    }`}
                  >
                    <LayoutList size={12} />
                    {theme.title}
                    {themeOutlineStates[theme.id]?.generating && (
                      <Loader2 size={10} className="animate-spin" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Active theme label */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-text-tertiary font-medium">
              {activeThemeInfo && <span className="mr-1">{activeThemeInfo.title} · </span>}
              {activePanels.length} 个分镜
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleBatchGenerateVideo}
                disabled={batchVideoLoading || activePanels.length === 0}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  batchVideoLoading || activePanels.length === 0
                    ? 'bg-purple-100 text-purple-400 cursor-not-allowed'
                    : 'bg-purple-500 text-white hover:bg-purple-600'
                }`}
              >
                {batchVideoLoading ? <><Loader2 size={12} className="animate-spin" /> 提交中...</> : <><Video size={12} />一键批量视频</>}
              </button>
              <button
                onClick={handleBatchGenerate}
                disabled={batchLoading || taskManager.isFull || (digitalHumanMode && !selectedGirlfriend)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  batchLoading || taskManager.isFull || (digitalHumanMode && !selectedGirlfriend)
                    ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                    : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:opacity-90 active:scale-[0.98]'
                }`}
              >
                {batchLoading ? <><Loader2 size={12} className="animate-spin" /> 提交中...</> : <><Zap size={12} />一键批量生图</>}
              </button>
            </div>
          </div>
          {activePanels.map((panel, idx) => {
            // Use theme-specific panel key to avoid conflicts when switching tabs
            const panelKey = activeThemeTab !== null ? `theme-${activeThemeTab}-panel-${idx}` : `panel-${idx}`;
            const selectedImage = selectedPanelImages[panelKey];
            const videoPrompt = generateVideoPromptForPanel(panel.image_prompt);
            const normalizedPanelPrompt = panel.image_prompt.trim().replace(/\s+/g, ' ');
            const panelRelatedTasks = taskManager.tasks.filter(
              (t: QueuedTask) => (t.status === 'RUNNING' || t.status === 'QUEUEING' || t.status === 'FINISHED') && t.images.length > 0
            ).filter((t: QueuedTask) => {
              const taskPromptNorm = t.prompt.trim().replace(/\s+/g, ' ');
              return taskPromptNorm === normalizedPanelPrompt ||
                taskPromptNorm.includes(normalizedPanelPrompt) ||
                normalizedPanelPrompt.includes(taskPromptNorm) ||
                (normalizedPanelPrompt.length > 50 && taskPromptNorm.includes(normalizedPanelPrompt.substring(0, Math.min(normalizedPanelPrompt.length, 150))));
            });
            const genStateKey = `${sbHistoryId}_${idx}`;
            const hasGenerated = (genStates[genStateKey]?.images?.length ?? 0) > 0;
            return (
              <StoryboardPanelCard
                key={panelKey}
                panel={panel}
                idx={idx}
                isExpanded={expandedPanel === idx}
                r18Mode={r18Mode}
                copiedPanel={copiedPanel}
                onToggle={() => setExpandedPanel(expandedPanel === idx ? null : idx)}
                onCopyPanel={() => handleCopyPanel(panel, idx)}
                genState={genStates[genStateKey]}
                onGenerateImage={() => handleStoryboardGenerateImage(idx, panel.image_prompt)}
                onFavorited={(url) => handleToggleFavorite(url, panel.image_prompt)}
                taskManager={taskManager}
                digitalHumanMode={digitalHumanMode}
                selectedGirlfriend={selectedGirlfriend}
                selectedImageIndex={selectedImage?.index}
                onSelectImage={(imageIdx, imageUrl) => handleSelectPanelImage(panelKey, imageIdx, imageUrl)}
                videoPrompt={videoPrompt}
                hasGeneratedImages={hasGenerated}
                onPreviewImage={handlePreviewImage}
                videoGenLoading={videoGenLoading[panelKey]}
                onDirectGenerateVideo={(imageUrl, prompt) => handleDirectGenerateVideo(panelKey, imageUrl, prompt)}
              />
            );
          })}
        </div>
      )}

      {/* Image Preview Overlay */}
      {showPreview && previewImages.length > 0 && (
        <div
          className="fixed inset-0 z-[9999] bg-black/95 flex flex-col animate-fade-in"
          onClick={() => setShowPreview(false)}
        >
          <div className="flex items-center justify-between px-6 py-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="text-sm text-white/60">{previewIndex + 1} / {previewImages.length}</span>
              <button
                onClick={() => handleToggleFavorite(previewImages[previewIndex], previewPrompt)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  favorites.some((f) => f.imageUrl === previewImages[previewIndex])
                    ? 'bg-red-500 text-white'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                <Heart size={12} fill={favorites.some((f) => f.imageUrl === previewImages[previewIndex]) ? 'currentColor' : 'none'} />
                {favorites.some((f) => f.imageUrl === previewImages[previewIndex]) ? '已收藏' : '收藏'}
              </button>
            </div>
            <button
              onClick={() => setShowPreview(false)}
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
            >
              <X size={20} />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center relative" onClick={(e) => e.stopPropagation()}>
            {previewImages.length > 1 && (
              <button
                onClick={() => setPreviewIndex((i) => (i - 1 + previewImages.length) % previewImages.length)}
                className="absolute left-4 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
              >
                <ChevronLeft size={24} />
              </button>
            )}
            <img
              src={previewImages[previewIndex]}
              alt=""
              className="max-w-full max-h-full object-contain select-none"
              style={{ maxHeight: 'calc(100vh - 120px)' }}
            />
            {previewImages.length > 1 && (
              <button
                onClick={() => setPreviewIndex((i) => (i + 1) % previewImages.length)}
                className="absolute right-4 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
              >
                <ChevronRight size={24} />
              </button>
            )}
          </div>
          {previewImages.length > 1 && (
            <div className="flex items-center justify-center gap-2 py-4 px-6 overflow-x-auto">
              {previewImages.map((img, i) => (
                <button
                  key={i}
                  onClick={(e) => { e.stopPropagation(); setPreviewIndex(i); }}
                  className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-all ${i === previewIndex ? 'border-white opacity-100' : 'border-transparent opacity-50 hover:opacity-80'}`}
                >
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StoryboardHistoryList({ history, onLoad, onDelete }: {
  history: StoryboardHistoryItem[];
  onLoad: (h: StoryboardHistoryItem) => void;
  onDelete: (id: string) => void;
}) {
  const [previewImages, setPreviewImages] = useState<Record<string, string[]>>({});
  const previewImagesRef = useRef<Record<string, string[]>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadingPreviews, setLoadingPreviews] = useState<Set<string>>(new Set());
  const loadingPreviewsRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const syncCache = () => {
      const newPreviews: Record<string, string[]> = {};
      for (const h of history) {
        const cached = getAllCachedPanelImages(h.id, h.panel_count);
        const seen = new Set<string>();
        const allImages: string[] = [];
        const addImages = (imgs: string[]) => {
          for (const img of imgs) {
            if (img && !seen.has(img)) { seen.add(img); allImages.push(img); }
          }
        };
        for (const imgs of Object.values(cached)) addImages(imgs);
        if (h.panelImages) {
          const resolved = resolvePanelImages(h.panelImages);
          for (const imgs of Object.values(resolved)) addImages(imgs);
        }
        addImages(h.images || []);
        if (allImages.length > 0) newPreviews[h.id] = allImages.slice(0, 6);
      }
      if (!cancelled) {
        previewImagesRef.current = newPreviews;
        setPreviewImages(newPreviews);
      }
    };

    const sync = () => {
      const missing = history.filter((h) =>
        !previewImagesRef.current[h.id] &&
        !loadingPreviewsRef.current.has(h.id)
      );
      if (missing.length === 0) return;

      if (inFlightRef.current) return;
      inFlightRef.current = true;

      missing.forEach((h) => {
        loadingPreviewsRef.current.add(h.id);
      });
      if (!cancelled) setLoadingPreviews((prev) => new Set([...prev, ...missing.map((h) => h.id)]));

      (async () => {
        for (const h of missing) {
          if (cancelled) break;
          try {
            const images = await loadCachedOrExtractPanelImages(h.zipUrl, 6, h.id, 0);
            if (!cancelled && images.length > 0) {
              const updated = { ...previewImagesRef.current, [h.id]: images.slice(0, 6) };
              previewImagesRef.current = updated;
              setPreviewImages(updated);
            }
          } catch (e) {
            console.debug('[StoryboardHistoryList] zip extraction failed for', h.id, e);
          } finally {
            if (!cancelled) {
              loadingPreviewsRef.current.delete(h.id);
              setLoadingPreviews((prev) => {
                const next = new Set(prev);
                next.delete(h.id);
                return next;
              });
            }
          }
        }
        inFlightRef.current = false;
      })();
    };

    syncCache();
    sync();
  }, [history, refreshKey]);

  if (history.length === 0) {
    return <div className="px-4 py-8 text-center"><Clock size={24} className="mx-auto text-text-tertiary/40 mb-2" /><p className="text-sm text-text-tertiary">暂无历史记录</p></div>;
  }

  return (
    <div>
      {history.map((h) => (
        <div key={h.id} className="flex items-start gap-2 px-4 py-3 border-b border-border/50 last:border-0 hover:bg-bg-hover/30 transition-colors">
          <button onClick={() => onLoad(h)} className="flex-1 flex items-start gap-2 w-full min-w-0 text-left group">
            {previewImages[h.id] && previewImages[h.id].length > 0 ? (
              <div className="flex-shrink-0 flex gap-0.5">
                {previewImages[h.id].slice(0, 4).map((img, i) => (
                  <img key={i} src={img} alt="" className="w-9 h-9 rounded object-cover border border-border/50" />
                ))}
              </div>
            ) : (
              <div className="flex-shrink-0 w-9 h-9 rounded bg-bg-elevated flex items-center justify-center border border-border/50">
                <Image size={14} className="text-text-tertiary/40" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-text-primary font-medium line-clamp-1">{h.panel_count} 个分镜</p>
              <p className="text-[11px] text-text-tertiary line-clamp-1 mt-0.5">{h.plot}</p>
              <p className="text-[10px] text-text-tertiary/60 mt-0.5">{new Date(h.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
            </div>
          </button>
          <button onClick={() => onDelete(h.id)} className="p-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-all flex-shrink-0"><Trash2 size={13} /></button>
        </div>
      ))}
    </div>
  );
}

function FavoritesList({ favorites, r18Mode, onRemove, onClear }: {
  favorites: FavoriteItem[];
  r18Mode: boolean;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const handleDownload = (e: React.MouseEvent, item: FavoriteItem) => {
    e.stopPropagation();
    const a = document.createElement('a');
    a.href = item.imageUrl ?? "";
    a.download = `favorite_${item.id}.png`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  };

  if (favorites.length === 0) {
    return <div className="px-4 py-8 text-center"><Heart size={24} className="mx-auto text-text-tertiary/40 mb-2" /><p className="text-sm text-text-tertiary">暂无收藏</p><p className="text-[11px] text-text-tertiary/60 mt-1">在图片预览中点击收藏按钮添加</p></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50">
        <span className="text-xs text-text-tertiary">{favorites.length} 张收藏</span>
        {favorites.length > 0 && (
          <button onClick={onClear} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-all">
            <Trash2 size={11} />清空全部
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 p-3">
        {favorites.map((item) => (
          <div key={item.id} className="relative group aspect-square rounded-lg overflow-hidden bg-bg-elevated">
            <img src={item.imageUrl ?? ""} alt="" className="w-full h-full object-cover" loading="lazy" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
              <button
                onClick={(e) => handleDownload(e, item)}
                className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center text-gray-700 hover:bg-white transition-colors"
              >
                <Download size={14} />
              </button>
              <button
                onClick={() => onRemove(item.id)}
                className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center text-red-500 hover:bg-red-500 hover:text-white transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <p className="text-[9px] text-white/80 truncate">{item.prompt?.slice(0, 40) || '已收藏图片'}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StoryboardPanelCard({ panel, idx, isExpanded, r18Mode, copiedPanel, onToggle, onCopyPanel, genState, onGenerateImage, onFavorited, taskManager, digitalHumanMode, selectedGirlfriend, selectedImageIndex, onSelectImage, onGenerateVideo, videoPrompt, hasGeneratedImages, onPreviewImage, videoGenLoading, onDirectGenerateVideo }: {
  panel: { panel_number: number; scene_description: string; image_prompt: string };
  idx: number; isExpanded: boolean; r18Mode: boolean; copiedPanel: number | null;
  onToggle: () => void; onCopyPanel: () => void;
  genState?: { loading: boolean; images: string[] };
  onGenerateImage: () => void;
  onFavorited?: (url: string) => void;
  taskManager: TaskManagerReturn;
  digitalHumanMode?: boolean; selectedGirlfriend?: GirlfriendPreset | null;
  selectedImageIndex?: number;
  onSelectImage?: (index: number, imageUrl: string) => void;
  onGenerateVideo?: (imageUrl: string, prompt: string) => void;
  videoPrompt?: string;
  hasGeneratedImages?: boolean;
  onPreviewImage?: (images: string[], currentIndex: number, prompt?: string) => void;
  videoGenLoading?: boolean;
  onDirectGenerateVideo?: (imageUrl: string, prompt: string) => void;
}) {
  const isGenLoading = genState?.loading;
  const displayImages = genState?.images ?? [];

  const normalizedPanelPrompt = panel.image_prompt.trim().replace(/\s+/g, ' ');
  const panelRelatedTasks = taskManager.tasks.filter(
    (t: QueuedTask) => (t.status === 'RUNNING' || t.status === 'QUEUEING' || t.status === 'FINISHED') && t.images.length > 0
  ).filter((t: QueuedTask) => {
    const taskPromptNorm = t.prompt.trim().replace(/\s+/g, ' ');
    return taskPromptNorm === normalizedPanelPrompt ||
      taskPromptNorm.includes(normalizedPanelPrompt) ||
      normalizedPanelPrompt.includes(taskPromptNorm) ||
      (normalizedPanelPrompt.length > 50 && taskPromptNorm.includes(normalizedPanelPrompt.substring(0, Math.min(normalizedPanelPrompt.length, 150))));
  });

  const taskImages = panelRelatedTasks.flatMap((t: QueuedTask) => t.images);
  const allDisplayImages = displayImages.length > 0 ? displayImages : taskImages;
  const hasImages = allDisplayImages.length > 0;

  return (
    <div className={`rounded-2xl overflow-hidden shadow-card ${r18Mode ? 'border border-red-200 bg-white' : 'bg-white border border-border'}`}>
      <button onClick={onToggle}
        className={`w-full flex items-center justify-between px-4 py-3 hover:bg-bg-hover transition-colors ${r18Mode ? 'bg-red-50/30' : ''}`}>
        <div className="flex items-center gap-3">
          <span className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${r18Mode ? 'bg-gradient-to-br from-red-500 to-red-700 text-white' : 'bg-gradient-to-br from-primary to-primary/60 text-white'}`}>{panel.panel_number}</span>
          <span className="text-sm text-text-primary font-medium line-clamp-1">{panel.scene_description}</span>
          {hasImages && <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 bg-green-500 text-white`}>{allDisplayImages.length}</span>}
        </div>
        {isExpanded ? <ChevronUp size={14} className="text-text-tertiary" /> : <ChevronDown size={14} className="text-text-tertiary" />}
      </button>
      {isExpanded && (
        <div className={`px-4 pb-4 border-t ${r18Mode ? 'border-red-100' : 'border-border/50'}`}>
          <div className="pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs font-medium ${r18Mode ? 'text-red-500' : 'text-text-tertiary'}`}>Image Prompt</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={onGenerateImage}
                  disabled={isGenLoading || (digitalHumanMode && !selectedGirlfriend)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                    isGenLoading || (digitalHumanMode && !selectedGirlfriend)
                      ? 'bg-blue-100 text-blue-400 cursor-not-allowed'
                      : 'bg-blue-500 text-white hover:bg-blue-600'
                  }`}
                >
                  {isGenLoading ? <><Loader2 size={11} className="animate-spin" /> 生成中</> : <><Image size={11} />{digitalHumanMode && selectedGirlfriend ? '图生图' : '生图'}</>}
                </button>
                <button onClick={onCopyPanel} className={`flex items-center gap-1 text-xs transition-colors ${copiedPanel === idx ? 'text-green-500' : r18Mode ? 'text-red-500' : 'text-primary'}`}>
                  {copiedPanel === idx ? <><Check size={12} /> 已复制</> : <><Copy size={12} /> 复制</>}
                </button>
              </div>
            </div>
            <div className={`rounded-xl px-4 py-3 text-xs leading-relaxed whitespace-pre-wrap font-mono ${r18Mode ? 'bg-red-50 text-red-700' : 'bg-bg-elevated text-text-secondary'}`}>{panel.image_prompt}</div>

            {/* Generated images preview with selection and preview */}
            {hasImages && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-text-tertiary font-medium">生成结果（点击选中/预览）</span>
                  <span className="text-[10px] text-text-tertiary">{allDisplayImages.length} 张</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {allDisplayImages.slice(0, 6).map((img, i) => (
                    <div
                      key={i}
                      className={`relative group cursor-pointer rounded-lg overflow-hidden transition-all ${
                        selectedImageIndex === i ? 'ring-2 ring-purple-500 ring-offset-2' : ''
                      }`}
                      onClick={() => {
                        onSelectImage?.(i, img);
                        onPreviewImage?.(allDisplayImages, i, panel.image_prompt);
                      }}
                    >
                      <img src={img} alt="" className="w-full aspect-square object-cover" loading="lazy" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-1">
                        <div className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <ZoomIn size={16} className="text-white" />
                        </div>
                        {onFavorited && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onFavorited(img); }}
                            className={`w-8 h-8 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity ${isFavorited(img) ? 'bg-red-500 text-white' : 'bg-black/50 text-white hover:bg-red-500'}`}
                          >
                            <Heart size={14} className={isFavorited(img) ? 'fill-white' : ''} />
                          </button>
                        )}
                      </div>
                      {selectedImageIndex === i && (
                        <div className="absolute top-1 left-1 bg-purple-500 text-white text-[9px] px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5">
                          <Check size={10} /> 已选
                        </div>
                      )}
                    </div>
                  ))}
                  {allDisplayImages.length > 6 && (
                    <div className="aspect-square rounded-lg bg-bg-elevated flex items-center justify-center text-xs text-text-tertiary">
                      +{allDisplayImages.length - 6}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Video Prompt Section */}
            <div className={`rounded-xl border ${videoPrompt ? 'border-purple-200 bg-purple-50/30' : 'border-border bg-bg-elevated/50'} p-3 mt-3`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <Video size={12} className={videoPrompt ? 'text-purple-500' : 'text-text-tertiary'} />
                  <span className={`text-xs font-medium ${videoPrompt ? 'text-purple-600' : 'text-text-tertiary'}`}>视频提示词</span>
                </div>
                {hasImages && (
                  <button
                    onClick={() => {
                      const imageToUse = selectedImageIndex !== undefined && allDisplayImages[selectedImageIndex]
                        ? allDisplayImages[selectedImageIndex]
                        : allDisplayImages[0];
                      onDirectGenerateVideo?.(imageToUse, videoPrompt || panel.image_prompt);
                    }}
                    disabled={videoGenLoading || !videoPrompt}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      !videoPrompt || videoGenLoading
                        ? 'bg-purple-100 text-purple-400 cursor-not-allowed'
                        : 'bg-purple-500 text-white hover:bg-purple-600'
                    }`}
                  >
                    {videoGenLoading ? <><Loader2 size={11} className="animate-spin" /> 生成中</> : <><Video size={11} />图生视频</>}
                  </button>
                )}
              </div>
              {videoPrompt ? (
                <div className="text-xs leading-relaxed text-text-secondary whitespace-pre-wrap font-mono">{videoPrompt}</div>
              ) : (
                <div className="text-xs text-text-tertiary">生成图片后将自动生成视频提示词</div>
              )}
            </div>

            {/* Running status */}
            {panelRelatedTasks.filter((t: QueuedTask) => t.status === 'RUNNING' || t.status === 'QUEUEING').length > 0 && allDisplayImages.length === 0 && (
              <div className="flex items-center gap-2 text-xs text-blue-500 mt-3">
                <Loader2 size={12} className="animate-spin" />
                正在生成中...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shared Image Preview Component ─────────────────────────────────────────

function AIGeneratedImagePreview({ src, prompt, onFavorited, allImages, index }: { src: string; prompt?: string; onFavorited?: (url: string) => void; allImages?: string[]; index?: number }) {
  const [lightbox, setLightbox] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(index ?? 0);

  // Sync currentIdx when index prop changes (e.g., when parent re-renders with different allImages)
  useEffect(() => {
    if (index !== undefined) {
      setCurrentIdx(index);
    }
  }, [index]);

  const images = allImages && allImages.length > 0 ? allImages : [src];
  const activeIdx = index !== undefined ? index : currentIdx;
  const displaySrc = images[activeIdx] || src;

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (index !== undefined) {
      setCurrentIdx((i) => (i - 1 + images.length) % images.length);
    } else {
      setCurrentIdx((i) => (i - 1 + images.length) % images.length);
    }
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIdx((i) => (i + 1) % images.length);
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const a = document.createElement('a');
    a.href = displaySrc;
    a.download = displaySrc.split('/').pop() || `generated_${Date.now()}.png`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  };

  const handleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFavorited?.(displaySrc);
  };

  return (
    <>
      <div className="relative group aspect-square rounded-lg overflow-hidden bg-bg-elevated cursor-pointer" onClick={() => { setCurrentIdx(index ?? 0); setLightbox(true); }}>
        <img src={displaySrc} alt="" className="w-full h-full object-cover" loading="lazy" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={handleDownload} className="w-7 h-7 rounded-full bg-white/90 flex items-center justify-center text-gray-700 hover:bg-white transition-colors">
            <Download size={12} />
          </button>
          {onFavorited && (
            <button onClick={handleFavorite} className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${isFavorited(displaySrc) ? 'bg-red-500 text-white' : 'bg-white/90 text-gray-700 hover:bg-white'}`}>
              <Heart size={12} className={isFavorited(displaySrc) ? 'fill-white' : ''} />
            </button>
          )}
          {images.length > 1 && (
            <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] font-medium">
              {activeIdx + 1}/{images.length}
            </div>
          )}
        </div>
      </div>
      {lightbox && (
        <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center animate-fade-in" onClick={() => setLightbox(false)}>
          <div className="absolute top-4 right-4 flex items-center gap-2">
            {prompt && (
              <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(prompt); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 text-white text-xs hover:bg-white/20 transition-colors">
                <Copy size={12} />复制提示词
              </button>
            )}
            <button onClick={handleDownload} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors">
              <Download size={16} />
            </button>
            <button onClick={handleFavorite} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
              <Heart size={16} className={isFavorited(displaySrc) ? 'fill-red-500 text-red-500' : 'text-white'} />
            </button>
            <button onClick={setLightbox.bind(null, false)} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors">
              <X size={20} />
            </button>
          </div>
          {images.length > 1 && (
            <button onClick={handlePrev} className="absolute left-4 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10">
              <ChevronLeft size={24} />
            </button>
          )}
          <img src={displaySrc} alt="" className="max-w-[90vw] max-h-[80vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
          {images.length > 1 && (
            <button onClick={handleNext} className="absolute right-4 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10">
              <ChevronRight size={24} />
            </button>
          )}
          {images.length > 1 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-black/60 text-white text-sm font-medium">
              {activeIdx + 1} / {images.length}
            </div>
          )}
          <button onClick={handleDownload} className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-gray-800 text-sm font-medium hover:bg-gray-100 transition-colors">
            <Download size={16} /> 下载图片
          </button>
        </div>
      )}
    </>
  );
}
