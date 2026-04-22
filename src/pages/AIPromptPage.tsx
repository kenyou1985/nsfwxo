import React, { useState, useCallback, useEffect } from 'react';
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
  type ExpandHistoryItem, type RandomHistoryItem, type StoryboardHistoryItem,
} from '../services/storage';
import type { TaskManagerReturn } from '../hooks/useTaskManager';
import type { GirlfriendPreset } from '../data/girlfriendPresets';
import { GirlfriendSelector } from '../components/GirlfriendSelector';
import { buildTxt2ImgNodeList } from '../utils/txt2imgNodeBuilder';
import type { QueuedTask, TabType, NodeInfo } from '../types';
import { DEFAULT_TXT2IMG_PARAMS } from '../constants';
import { WORKFLOW, getWorkflowFormat, uploadImage } from '../services/runninghub';

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
  const [genState, setGenState] = useState<GenerateState>({});
  const [batchLoading, setBatchLoading] = useState(false);
  const [outputPrompts, setOutputPrompts] = useState<string[]>(savedExpand?.outputPrompts || []);
  const [selectedOutputIdx, setSelectedOutputIdx] = useState(savedExpand?.selectedOutputIdx || 0);
  const [outputText, setOutputText] = useState(savedExpand?.outputText || '');
  const [generatingMain, setGeneratingMain] = useState(false);
  const [girlfriendUploading, setGirlfriendUploading] = useState(false);

  // Persist expand state to sessionStorage so it survives page switches
  useEffect(() => {
    if (input || results.length > 0 || outputText) {
      saveExpandSession({ input, type, count, results, outputPrompts, selectedOutputIdx, outputText });
    } else {
      clearExpandSession();
    }
  }, [input, type, count, results, outputPrompts, selectedOutputIdx, outputText]);

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
          { nodeId: '60', fieldName: 'image', fieldValue: imagePath, description: '选择图片' },
          { nodeId: '64', fieldName: 'batch_size', fieldValue: String(DEFAULT_TXT2IMG_PARAMS.imageCount), description: '图片数量' },
          { nodeId: '82', fieldName: 'value', fieldValue: 'false', description: 'tt/zip（默认zip）' },
          { nodeId: '59', fieldName: 'text', fieldValue: outputText, description: '文字描述' },
          { nodeId: '70', fieldName: 'ckpt_name', fieldValue: 'Qwen-Rapid-AIO-NSFW-v18.safetensors', description: '模型选择（qwen-2511-edit）' },
          { nodeId: '80', fieldName: 'lora_name', fieldValue: 'any2realV2.safetensors', description: 'lora(qwen-2511)' },
          { nodeId: '80', fieldName: 'strength_model', fieldValue: '0', description: 'lora权重' },
        ];
        await taskManager.addTask('img2img', nodes, outputText, WORKFLOW.QWEN_IMG2IMG);
        onSuccess('任务已提交，请到图生图查看生成结果');
        if (onNavigate) onNavigate('img2img');
      } else {
        const nodes = [
          { nodeId: '5', fieldName: 'width', fieldValue: '1024', description: '宽度' },
          { nodeId: '5', fieldName: 'height', fieldValue: '1024', description: '高度' },
          { nodeId: '5', fieldName: 'batch_size', fieldValue: String(DEFAULT_TXT2IMG_PARAMS.imageCount), description: '数量' },
          { nodeId: '6', fieldName: 'text', fieldValue: outputText, description: '提示词' },
          { nodeId: '7', fieldName: 'text', fieldValue: 'nsfw, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry', description: '负面提示词' },
        ];
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

  const handleGenerateImage = useCallback(async (result: { id: string; prompt: string }) => {
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
        { nodeId: '60', fieldName: 'image', fieldValue: imagePath, description: '选择图片' },
        { nodeId: '64', fieldName: 'batch_size', fieldValue: String(DEFAULT_TXT2IMG_PARAMS.imageCount), description: '图片数量' },
        { nodeId: '82', fieldName: 'value', fieldValue: 'false', description: 'tt/zip（默认zip）' },
        { nodeId: '59', fieldName: 'text', fieldValue: result.prompt, description: '文字描述' },
        { nodeId: '70', fieldName: 'ckpt_name', fieldValue: 'Qwen-Rapid-AIO-NSFW-v18.safetensors', description: '模型选择（qwen-2511-edit）' },
        { nodeId: '80', fieldName: 'lora_name', fieldValue: 'any2realV2.safetensors', description: 'lora(qwen-2511)' },
        { nodeId: '80', fieldName: 'strength_model', fieldValue: '0', description: 'lora权重' },
      ];
      try {
        await taskManager.addTask('img2img', nodes, result.prompt, WORKFLOW.QWEN_IMG2IMG);
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
      const nodes = [
        { nodeId: '5', fieldName: 'width', fieldValue: '1024', description: '宽度' },
        { nodeId: '5', fieldName: 'height', fieldValue: '1024', description: '高度' },
        { nodeId: '5', fieldName: 'batch_size', fieldValue: String(DEFAULT_TXT2IMG_PARAMS.imageCount), description: '数量' },
        { nodeId: '6', fieldName: 'text', fieldValue: result.prompt, description: '提示词' },
        { nodeId: '7', fieldName: 'text', fieldValue: 'nsfw, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry', description: '负面提示词' },
      ];
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
    for (let i = 0; i < Math.min(results.length, availableSlots); i++) {
      const result = results[i];
      if (digitalHumanMode && selectedGirlfriend) {
        const nodes = [
          { nodeId: '60', fieldName: 'image', fieldValue: imagePath, description: '选择图片' },
          { nodeId: '64', fieldName: 'batch_size', fieldValue: String(DEFAULT_TXT2IMG_PARAMS.imageCount), description: '图片数量' },
          { nodeId: '82', fieldName: 'value', fieldValue: 'false', description: 'tt/zip（默认zip）' },
          { nodeId: '59', fieldName: 'text', fieldValue: result.prompt, description: '文字描述' },
          { nodeId: '70', fieldName: 'ckpt_name', fieldValue: 'Qwen-Rapid-AIO-NSFW-v18.safetensors', description: '模型选择（qwen-2511-edit）' },
          { nodeId: '80', fieldName: 'lora_name', fieldValue: 'any2realV2.safetensors', description: 'lora(qwen-2511)' },
          { nodeId: '80', fieldName: 'strength_model', fieldValue: '0', description: 'lora权重' },
        ];
        try {
          await taskManager.addTask('img2img', nodes, result.prompt, WORKFLOW.QWEN_IMG2IMG);
          submitted++;
        } catch (err) {
          onError(`提交第 ${i + 1} 个时失败: ${err instanceof Error ? err.message : '未知错误'}`);
        }
      } else {
        const nodes = [
          { nodeId: '5', fieldName: 'width', fieldValue: '1024', description: '宽度' },
          { nodeId: '5', fieldName: 'height', fieldValue: '1024', description: '高度' },
          { nodeId: '5', fieldName: 'batch_size', fieldValue: String(DEFAULT_TXT2IMG_PARAMS.imageCount), description: '数量' },
          { nodeId: '6', fieldName: 'text', fieldValue: result.prompt, description: '提示词' },
          { nodeId: '7', fieldName: 'text', fieldValue: 'nsfw, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry', description: '负面提示词' },
        ];
        try {
          await taskManager.addTask('txt2img', nodes, result.prompt);
          submitted++;
        } catch (err) {
          onError(`提交第 ${i + 1} 个时失败: ${err instanceof Error ? err.message : '未知错误'}`);
        }
      }
    }
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
              onGenerateImage={() => handleGenerateImage(result)}
              onUseAsOutput={() => {
                const idx = results.findIndex((r) => r.id === result.id);
                setSelectedOutputIdx(idx);
                setOutputText(result.prompt);
              }}
              taskManager={taskManager}
            />
          ))}
        </div>
      )}
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

function ExpandResultCard({ result, r18Mode, isCopied, genState, onCopy, onDelete, onGenerateImage, onUseAsOutput, taskManager, digitalHumanMode, selectedGirlfriend }: {
  result: { id: string; original: string; prompt: string; r18: boolean };
  r18Mode: boolean; isCopied: boolean;
  genState?: { loading: boolean; images: string[]; taskId: string | null };
  onCopy: () => void; onDelete: () => void; onGenerateImage: () => void; onUseAsOutput: () => void;
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
                <AIGeneratedImagePreview key={idx} src={img} />
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

  // Persist random state to sessionStorage
  useEffect(() => {
    if (results.length > 0 || theme) {
      saveRandomSession({ type, count, theme, results, expandedIdx });
    } else {
      clearRandomSession();
    }
  }, [type, count, theme, results, expandedIdx]);

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

  const handleGenerateImage = useCallback(async (idx: number, prompt: string) => {
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
        { nodeId: '60', fieldName: 'image', fieldValue: imagePath, description: '选择图片' },
        { nodeId: '64', fieldName: 'batch_size', fieldValue: String(DEFAULT_TXT2IMG_PARAMS.imageCount), description: '图片数量' },
        { nodeId: '82', fieldName: 'value', fieldValue: 'false', description: 'tt/zip（默认zip）' },
        { nodeId: '59', fieldName: 'text', fieldValue: prompt, description: '文字描述' },
        { nodeId: '70', fieldName: 'ckpt_name', fieldValue: 'Qwen-Rapid-AIO-NSFW-v18.safetensors', description: '模型选择（qwen-2511-edit）' },
        { nodeId: '80', fieldName: 'lora_name', fieldValue: 'any2realV2.safetensors', description: 'lora(qwen-2511)' },
        { nodeId: '80', fieldName: 'strength_model', fieldValue: '0', description: 'lora权重' },
      ];
      try {
        await taskManager.addTask('img2img', nodes, prompt, WORKFLOW.QWEN_IMG2IMG);
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
      const nodes = [
        { nodeId: '5', fieldName: 'width', fieldValue: '1024', description: '宽度' },
        { nodeId: '5', fieldName: 'height', fieldValue: '1024', description: '高度' },
        { nodeId: '5', fieldName: 'batch_size', fieldValue: String(DEFAULT_TXT2IMG_PARAMS.imageCount), description: '数量' },
        { nodeId: '6', fieldName: 'text', fieldValue: prompt, description: '提示词' },
        { nodeId: '7', fieldName: 'text', fieldValue: 'nsfw, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry', description: '负面提示词' },
      ];
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
    for (let i = 0; i < Math.min(results.length, availableSlots); i++) {
      const result = results[i];
      if (digitalHumanMode && selectedGirlfriend) {
        const nodes = [
          { nodeId: '60', fieldName: 'image', fieldValue: imagePath, description: '选择图片' },
          { nodeId: '64', fieldName: 'batch_size', fieldValue: String(DEFAULT_TXT2IMG_PARAMS.imageCount), description: '图片数量' },
          { nodeId: '82', fieldName: 'value', fieldValue: 'false', description: 'tt/zip（默认zip）' },
          { nodeId: '59', fieldName: 'text', fieldValue: result.prompt, description: '文字描述' },
          { nodeId: '70', fieldName: 'ckpt_name', fieldValue: 'Qwen-Rapid-AIO-NSFW-v18.safetensors', description: '模型选择（qwen-2511-edit）' },
          { nodeId: '80', fieldName: 'lora_name', fieldValue: 'any2realV2.safetensors', description: 'lora(qwen-2511)' },
          { nodeId: '80', fieldName: 'strength_model', fieldValue: '0', description: 'lora权重' },
        ];
        try {
          await taskManager.addTask('img2img', nodes, result.prompt, WORKFLOW.QWEN_IMG2IMG);
          submitted++;
        } catch (err) {
          onError(`提交第 ${i + 1} 个时失败: ${err instanceof Error ? err.message : '未知错误'}`);
        }
      } else {
        const nodes = [
          { nodeId: '5', fieldName: 'width', fieldValue: '1024', description: '宽度' },
          { nodeId: '5', fieldName: 'height', fieldValue: '1024', description: '高度' },
          { nodeId: '5', fieldName: 'batch_size', fieldValue: String(DEFAULT_TXT2IMG_PARAMS.imageCount), description: '数量' },
          { nodeId: '6', fieldName: 'text', fieldValue: result.prompt, description: '提示词' },
          { nodeId: '7', fieldName: 'text', fieldValue: 'nsfw, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry', description: '负面提示词' },
        ];
        try {
          await taskManager.addTask('txt2img', nodes, result.prompt);
          submitted++;
        } catch (err) {
          onError(`提交第 ${i + 1} 个时失败: ${err instanceof Error ? err.message : '未知错误'}`);
        }
      }
    }
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
              onGenerateImage={() => handleGenerateImage(idx, result.prompt)}
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

function RandomResultCard({ index, result, isExpanded, isCopied, tagsVisible, r18Mode, onToggle, onCopy, genState, onGenerateImage, taskManager, digitalHumanMode, selectedGirlfriend }: {
  index: number; result: PromptResult; isExpanded: boolean; isCopied: boolean; tagsVisible: boolean; r18Mode: boolean; onToggle: () => void; onCopy: () => void;
  genState?: { loading: boolean; images: string[] };
  onGenerateImage: () => void;
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
                  <AIGeneratedImagePreview key={idx} src={img} />
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
  const [history, setHistory] = useState<StoryboardHistoryItem[]>(() => getStoryboardHistory());
  const [genStates, setGenStates] = useState<Record<number, { loading: boolean; images: string[] }>>(() => {
    const saved = getStoryboardSession();
    if (saved?.historyId) {
      const cachedImages = getAllCachedPanelImages(saved.historyId, saved.panels.length);
      const initial: Record<number, { loading: boolean; images: string[] }> = {};
      for (const [idx, imgs] of Object.entries(cachedImages)) {
        initial[Number(idx)] = { loading: false, images: imgs };
      }
      return initial;
    }
    return {};
  });
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchVideoLoading, setBatchVideoLoading] = useState(false);
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(() => {
    const saved = getStoryboardSession();
    return saved?.historyId || null;
  });

  // Sync genStates with taskManager.tasks so panel cards reflect live images
  useEffect(() => {
    setGenStates((prev) => {
      let changed = false;
      const next = { ...prev };
      for (let i = 0; i < panels.length; i++) {
        const panel = panels[i];
        const panelPromptNorm = panel.image_prompt.trim().replace(/\s+/g, ' ');
        // Find any task whose prompt matches this panel (same robust matching as StoryboardPanelCard)
        const matchedTask = taskManager.tasks.find((t) => {
          if (t.images.length === 0) return false;
          const taskPromptNorm = t.prompt.trim().replace(/\s+/g, ' ');
          return taskPromptNorm === panelPromptNorm ||
            taskPromptNorm.includes(panelPromptNorm) ||
            panelPromptNorm.includes(taskPromptNorm) ||
            (panelPromptNorm.length > 50 && taskPromptNorm.includes(panelPromptNorm.substring(0, Math.min(panelPromptNorm.length, 150))));
        });
        if (matchedTask) {
          const currentImages = next[i]?.images ?? [];
          // Always sync if we found a task with images (even if already synced, refresh with latest)
          if (currentImages.length === 0 || currentImages[0] !== matchedTask.images[0]) {
            next[i] = { loading: false, images: matchedTask.images };
            changed = true;
          }
        } else if (next[i]?.loading === undefined) {
          // Ensure panel index exists in genStates even before batch generate is clicked
          // (no-op entry so panels appear in the state map)
        }
      }
      return changed ? next : prev;
    });
  }, [taskManager.tasks, panels]);

  // Persist generated panel images to history record (both legacy cache and direct storage for consistency)
  useEffect(() => {
    if (!currentHistoryId) return;
    const panelImages: Record<number, string[]> = {};
    for (const [panelIdx, state] of Object.entries(genStates)) {
      if (state.images && state.images.length > 0) {
        panelImages[Number(panelIdx)] = state.images;
        cacheStoryboardPanelImages(currentHistoryId, Number(panelIdx), state.images);
      }
    }
    // Also save to history record directly (like image history page)
    if (Object.keys(panelImages).length > 0) {
      updateStoryboardHistoryImages(currentHistoryId, panelImages);
      // Update local history state so StoryboardHistoryPanel can see the new images immediately
      setHistory(getStoryboardHistory());
    }
  }, [genStates, currentHistoryId]);

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

  // Track generation state per theme (for multi-select)
  const [themeOutlineStates, setThemeOutlineStates] = useState<Record<number, {
    generating: boolean;
    outlineArc: string;
    outlineScenes: string[];
    panels: { panel_number: number; scene_description: string; image_prompt: string }[];
    historyId?: string;
  }>>({});

  // Active theme tab (for tab switching between themes)
  const [activeThemeTab, setActiveThemeTab] = useState<number | null>(null);

  // Derived: panels from active theme tab
  const activePanels = activeThemeTab !== null ? (themeOutlineStates[activeThemeTab]?.panels || []) : panels;
  const activeOutlineArc = activeThemeTab !== null ? (themeOutlineStates[activeThemeTab]?.outlineArc || '') : outlineArc;
  const activeOutlineScenes = activeThemeTab !== null ? (themeOutlineStates[activeThemeTab]?.outlineScenes || []) : outlineScenes;
  const activeThemeInfo = activeThemeTab !== null ? selectedThemes.find((t) => t.id === activeThemeTab) : selectedTheme;

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
  const [showPreview, setShowPreview] = useState(false);

  // Persist storyboard state
  useEffect(() => {
    if (plot || panels.length > 0 || selectedTheme) {
      saveStoryboardSession({
        plot, panelCount, panels, expandedPanel,
        themeId: selectedTheme?.id,
        themeTitle: selectedTheme?.title,
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
      const res = await generateStoryboardThemes(r18Mode, cnt, desc || undefined);
      setThemeOptions(res.themes);
      setStoryStep('themes');
      setSelectedTheme(null);
      setSelectedThemes([]);
      setPanels([]);
      setOutlineArc('');
      setOutlineScenes([]);
      setThemeOutlineStates({});
      onSuccess(`生成了 ${res.themes.length} 个主题，请选择一个`);
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
      setSelectedTheme(null);
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
    // Mark this theme as generating
    setThemeOutlineStates((prev) => ({
      ...prev,
      [theme.id]: { generating: true, outlineArc: '', outlineScenes: [], panels: [], historyId: undefined },
    }));
    try {
      const res = await generateStoryboardOutline(theme.id, theme.title, panelCount, r18Mode);
      addStoryboardHistory({ plot: theme.title, panel_count: panelCount, r18: r18Mode, panels: res.storyboard });
      const updatedHistory = getStoryboardHistory();
      const historyId = updatedHistory[0]?.id;
      setThemeOutlineStates((prev) => ({
        ...prev,
        [theme.id]: {
          generating: false,
          outlineArc: res.outline.arc,
          outlineScenes: res.outline.scenes,
          panels: res.storyboard,
          historyId,
        },
      }));
      onSuccess(`「${theme.title}」的大纲已生成`);
    } catch (err) {
      setThemeOutlineStates((prev) => {
        const next = { ...prev };
        delete next[theme.id];
        return next;
      });
      onError(err instanceof Error ? err.message : `「${theme.title}」分镜生成失败`);
    }
  };

  // Generate outlines for ALL selected themes independently (each runs on its own)
  const handleGenerateSelectedThemes = async () => {
    if (selectedThemes.length === 0) return;
    onSuccess(`开始为 ${selectedThemes.length} 个主题独立生成大纲...`);
    // Kick off all of them concurrently — each updates its own card state independently
    await Promise.all(selectedThemes.map((theme) => handleGenerateOutlineSingle(theme)));
    onSuccess(`已完成 ${selectedThemes.length} 个主题的大纲生成`);
  };

  // Step 2: Generate outline + panels from selected theme
  const handleGenerateOutline = async () => {
    if (!selectedTheme) { onError('请先选择一个主题'); return; }
    setGeneratingOutline(true);
    try {
      const res = await generateStoryboardOutline(selectedTheme.id, selectedTheme.title, panelCount, r18Mode);
      setOutlineArc(res.outline.arc);
      setOutlineScenes(res.outline.scenes);
      setPanels(res.storyboard);
      setExpandedPanel(null);
      setStoryStep('panels');
      addStoryboardHistory({ plot: selectedTheme.title, panel_count: panelCount, r18: r18Mode, panels: res.storyboard });
      const updatedHistory = getStoryboardHistory();
      const newEntry = updatedHistory[0];
      if (newEntry) {
        setCurrentHistoryId(newEntry.id);
        saveStoryboardSession({
          plot: selectedTheme.title, panelCount, panels: res.storyboard, expandedPanel: null,
          themeId: selectedTheme.id, themeTitle: selectedTheme.title,
          outlineArc: res.outline.arc, outlineScenes: res.outline.scenes, historyId: newEntry.id,
        });
      }
      setHistory(updatedHistory);
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
      [theme.id]: { generating: true, outlineArc: '', outlineScenes: [], panels: [], historyId: prev[theme.id]?.historyId },
    }));
    try {
      const res = await generateStoryboardOutline(theme.id, theme.title, panelCount, r18Mode);
      addStoryboardHistory({ plot: theme.title, panel_count: panelCount, r18: r18Mode, panels: res.storyboard });
      const updatedHistory = getStoryboardHistory();
      const historyId = updatedHistory[0]?.id;
      setThemeOutlineStates((prev) => ({
        ...prev,
        [theme.id]: {
          generating: false,
          outlineArc: res.outline.arc,
          outlineScenes: res.outline.scenes,
          panels: res.storyboard,
          historyId,
        },
      }));
      onSuccess(`「${theme.title}」的大纲已生成`);
    } catch (err) {
      setThemeOutlineStates((prev) => {
        const next = { ...prev };
        delete next[theme.id];
        return next;
      });
      onError(err instanceof Error ? err.message : `「${theme.title}」分镜生成失败`);
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
    // Set active tab to this theme
    setActiveThemeTab(themeId);
    setStoryStep('panels');
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
      if (Object.keys(cachedImages).length > 0) {
        const initial: Record<number, { loading: boolean; images: string[] }> = {};
        for (const [idx, imgs] of Object.entries(cachedImages)) {
          initial[Number(idx)] = { loading: false, images: imgs };
        }
        setGenStates(initial);
      } else {
        setGenStates({});
      }
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
      const res = await generateVideoScript(selectedTheme?.title || '默认主题', r18Mode, panels);
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
  const handleHistoryLoad = (item: StoryboardHistoryItem) => {
    setPlot(item.plot);
    setPanels(item.panels);
    setStoryStep('panels');
    setVideoScript(null);
    setOutlineArc('');
    setOutlineScenes([]);
    setShowHistory(false);
    // Restore images for this history entry (like image history page)
    // First try direct images field, then fallback to cached panel images
    let initial: Record<number, { loading: boolean; images: string[] }> = {};

    // First check if history item has direct images field (new method)
    if (item.panelImages) {
      for (const [idx, imgs] of Object.entries(item.panelImages)) {
        initial[Number(idx)] = { loading: false, images: imgs };
      }
    } else {
      // Fallback to legacy cached panel images
      const cachedImages = getAllCachedPanelImages(item.id, item.panels.length);
      for (const [idx, imgs] of Object.entries(cachedImages)) {
        initial[Number(idx)] = { loading: false, images: imgs };
      }
    }
    setGenStates(initial);
    setCurrentHistoryId(item.id);
    saveStoryboardSession({
      plot: item.plot, panelCount: item.panel_count, panels: item.panels, expandedPanel: null,
      themeTitle: item.plot, historyId: item.id,
    });
  };

  const handleGenerateImage = useCallback(async (panelIdx: number, prompt: string) => {
    if (taskManager.isFull) { onError('任务队列已满'); return; }
    // Set loading state immediately
    setGenStates((prev) => ({ ...prev, [panelIdx]: { loading: true, images: [] } }));
    let imagePath = selectedGirlfriend?.portraitUrl || '';
    if (digitalHumanMode && selectedGirlfriend) {
      try {
        const res = await fetch(selectedGirlfriend.portraitUrl);
        const blob = await res.blob();
        const file = new File([blob], `${selectedGirlfriend.id}.jpg`, { type: blob.type || 'image/jpeg' });
        const uploadResult = await uploadImage(apiKey, file);
        imagePath = uploadResult.imagePath;
      } catch {
        setGenStates((prev) => { const next = { ...prev }; delete next[panelIdx]; return next; });
        onError('AI 女友图片上传失败'); return;
      }
    }
    if (digitalHumanMode && selectedGirlfriend) {
      // Format prompt with Qwen-2511 face-lock for character consistency
      const charName = selectedGirlfriend.nameZh || selectedGirlfriend.name;
      const charId = (selectedGirlfriend.id as string).toUpperCase().slice(0, 4);
      const anchorPrompt = `【严格锁定】严格锁定图中22岁女性（ID:${charId}），完全保留原有面部特征，五官轮廓、脸型、眼睛、鼻子、嘴唇、发型、肤色、身材比例完全不变，不做任何面部修改，动作流畅不僵硬。超高清8K，写实细节，皮肤质感细腻，无畸变、无模糊、无穿模。`;
      const finalPrompt = `${anchorPrompt}\n\n${prompt}`;
      const nodes = [
        { nodeId: '60', fieldName: 'image', fieldValue: imagePath, description: '选择图片' },
        { nodeId: '64', fieldName: 'batch_size', fieldValue: String(DEFAULT_TXT2IMG_PARAMS.imageCount), description: '图片数量' },
        { nodeId: '82', fieldName: 'value', fieldValue: 'false', description: 'tt/zip' },
        { nodeId: '59', fieldName: 'text', fieldValue: finalPrompt, description: '文字描述' },
        { nodeId: '70', fieldName: 'ckpt_name', fieldValue: 'Qwen-Rapid-AIO-NSFW-v18.safetensors', description: '模型' },
        { nodeId: '80', fieldName: 'lora_name', fieldValue: 'any2realV2.safetensors', description: 'lora' },
        { nodeId: '80', fieldName: 'strength_model', fieldValue: '0', description: 'lora权重' },
      ];
      try {
        await taskManager.addTask('img2img', nodes, finalPrompt, WORKFLOW.QWEN_IMG2IMG);
        onSuccess('任务已提交');
      } catch (err) {
        onError(err instanceof Error ? err.message : '提交失败');
        setGenStates((prev) => { const next = { ...prev }; delete next[panelIdx]; return next; });
      }
    } else {
      const nodes = [
        { nodeId: '5', fieldName: 'width', fieldValue: '1024', description: '宽度' },
        { nodeId: '5', fieldName: 'height', fieldValue: '1024', description: '高度' },
        { nodeId: '5', fieldName: 'batch_size', fieldValue: String(DEFAULT_TXT2IMG_PARAMS.imageCount), description: '数量' },
        { nodeId: '6', fieldName: 'text', fieldValue: prompt, description: '提示词' },
        { nodeId: '7', fieldName: 'text', fieldValue: 'nsfw, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry', description: '负面提示词' },
      ];
      try {
        await taskManager.addTask('txt2img', nodes, prompt);
        onSuccess('任务已提交');
      } catch (err) {
        onError(err instanceof Error ? err.message : '提交失败');
        setGenStates((prev) => { const next = { ...prev }; delete next[panelIdx]; return next; });
      }
    }
  }, [taskManager, onError, onSuccess, digitalHumanMode, selectedGirlfriend, apiKey]);

  // Generate video prompt for a panel based on image prompt
  const generateVideoPromptForPanel = useCallback((imagePrompt: string): string => {
    const parts = imagePrompt.split(/[,，.。;；\n]/).map((p) => p.trim()).filter(Boolean);
    const motion: string[] = [];
    const camera: string[] = [];
    const lighting: string[] = [];
    const style: string[] = [];
    const environment: string[] = [];
    const other: string[] = [];
    const motionWords = ['walk', 'turn', 'move', 'dance', 'run', 'jump', 'sit', 'stand', 'slow', 'fast', 'gentle', 'smooth', 'natural', 'flow', 'breathing', 'smile', 'blink', 'head', 'turning', 'looking', 'reach', 'raise', 'touch', 'hold', 'cross', 'lean', 'bend', 'twist', 'rolling', 'moving', 'step', 'foot'];
    const cameraWords = ['close-up', 'close up', 'medium shot', 'long shot', 'pan', 'zoom', 'tilt', 'dolly', 'tracking', 'steady', 'cinematic', 'camera', 'angle', 'shot', 'wide', 'lens', 'depth of field', 'bokeh', 'pov', 'background blur'];
    const lightingWords = ['light', 'sunlight', 'natural light', 'backlit', 'soft light', 'hard light', 'warm', 'cool', 'dim', 'bright', 'glow', 'shadow', 'rim light', 'golden hour', 'dusk', 'dawn', 'fog', 'neon', 'candlelight', 'moonlight'];
    const styleWords = ['realistic', 'cinematic', '8k', '4k', 'high quality', 'aesthetic', 'soft tone', 'vintage', 'film grain', 'portrait', 'photo', 'no distortion', 'hyperrealistic', 'photorealistic', 'masterpiece'];
    const envWords = ['indoor', 'outdoor', 'beach', 'forest', 'park', 'street', 'studio', 'garden', 'room', 'bedroom', 'bathroom', 'balcony', 'rooftop', 'background', 'setting', 'hotel', 'office', 'classroom', 'shower', 'pool', 'car', 'gym'];
    parts.forEach((part) => {
      const lower = part.toLowerCase();
      if (motionWords.some((w) => lower.includes(w))) motion.push(part);
      else if (cameraWords.some((w) => lower.includes(w))) camera.push(part);
      else if (lightingWords.some((w) => lower.includes(w))) lighting.push(part);
      else if (styleWords.some((w) => lower.includes(w))) style.push(part);
      else if (envWords.some((w) => lower.includes(w))) environment.push(part);
      else other.push(part);
    });
    const sections: string[] = [];
    if (environment.length > 0) sections.push(environment.slice(0, 2).join(', '));
    if (motion.length > 0) sections.push(motion.slice(0, 3).join(', '));
    if (camera.length > 0) sections.push(camera.slice(0, 2).join(', '));
    if (lighting.length > 0) sections.push(lighting.slice(0, 1).join(', '));
    if (style.length > 0) sections.push(style.slice(0, 1).join(', '));
    else sections.push('realistic cinematic quality');
    if (r18Mode) sections.push('intimate atmosphere, smooth natural motion');
    const remaining = other.filter((p) => p.length > 3 && p.length < 100);
    if (remaining.length > 0) sections.push(remaining.slice(0, 3).join(', '));
    return sections.filter(Boolean).join(', ');
  }, [r18Mode]);

  // Handle image selection for a panel
  const handleSelectPanelImage = useCallback((panelKey: string, imageIndex: number, imageUrl: string) => {
    setSelectedPanelImages(prev => ({
      ...prev,
      [panelKey]: { index: imageIndex, url: imageUrl }
    }));
  }, []);

  // Handle preview images
  const handlePreviewImage = useCallback((images: string[], index: number) => {
    setPreviewImages(images);
    setPreviewIndex(index);
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
        const panelGenState = genStates[i];
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

    // Mark all panels as loading immediately
    setGenStates((prev) => {
      const next = { ...prev };
      for (let i = 0; i < activePanels.length; i++) {
        next[i] = { loading: true, images: [] };
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
    for (let i = 0; i < Math.min(activePanels.length, availableSlots); i++) {
      const panel = activePanels[i];
      if (digitalHumanMode && selectedGirlfriend) {
        // Format prompt with Qwen-2511 face-lock for character consistency
        const charName = selectedGirlfriend.nameZh || selectedGirlfriend.name;
        const charId = (selectedGirlfriend.id as string).toUpperCase().slice(0, 4);
        const anchorPrompt = `【严格锁定】严格锁定图中22岁女性（ID:${charId}），完全保留原有面部特征，五官轮廓、脸型、眼睛、鼻子、嘴唇、发型、肤色、身材比例完全不变，不做任何面部修改，动作流畅不僵硬。超高清8K，写实细节，皮肤质感细腻，无畸变、无模糊、无穿模。`;
        const finalPrompt = `${anchorPrompt}\n\n${panel.image_prompt}`;
        const nodes = [
          { nodeId: '60', fieldName: 'image', fieldValue: imagePath, description: '选择图片' },
          { nodeId: '64', fieldName: 'batch_size', fieldValue: String(DEFAULT_TXT2IMG_PARAMS.imageCount), description: '图片数量' },
          { nodeId: '82', fieldName: 'value', fieldValue: 'false', description: 'tt/zip' },
          { nodeId: '59', fieldName: 'text', fieldValue: finalPrompt, description: '文字描述' },
          { nodeId: '70', fieldName: 'ckpt_name', fieldValue: 'Qwen-Rapid-AIO-NSFW-v18.safetensors', description: '模型' },
          { nodeId: '80', fieldName: 'lora_name', fieldValue: 'any2realV2.safetensors', description: 'lora' },
          { nodeId: '80', fieldName: 'strength_model', fieldValue: '0', description: 'lora权重' },
        ];
        try {
          await taskManager.addTask('img2img', nodes, finalPrompt, WORKFLOW.QWEN_IMG2IMG);
          submitted++;
        } catch (err) { onError(`提交第 ${i + 1} 个时失败: ${err instanceof Error ? err.message : '未知错误'}`); }
      } else {
        const nodes = [
          { nodeId: '5', fieldName: 'width', fieldValue: '1024', description: '宽度' },
          { nodeId: '5', fieldName: 'height', fieldValue: '1024', description: '高度' },
          { nodeId: '5', fieldName: 'batch_size', fieldValue: String(DEFAULT_TXT2IMG_PARAMS.imageCount), description: '数量' },
          { nodeId: '6', fieldName: 'text', fieldValue: panel.image_prompt, description: '提示词' },
          { nodeId: '7', fieldName: 'text', fieldValue: 'nsfw, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry', description: '负面提示词' },
        ];
        try {
          await taskManager.addTask('txt2img', nodes, panel.image_prompt);
          submitted++;
        } catch (err) { onError(`提交第 ${i + 1} 个时失败: ${err instanceof Error ? err.message : '未知错误'}`); }
      }
    }
    setBatchLoading(false);
    if (submitted > 0) {
      onSuccess(`已提交 ${submitted} 个生图任务`);
      // Don't auto-navigate, stay on current page
    }
  }, [panels, taskManager, setGenStates, onError, onSuccess, digitalHumanMode, selectedGirlfriend, apiKey]);

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
            <History size={12} />历史记录
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
                    关闭
                  </button>
                  {selectedThemes.length > 0 && (
                    <button
                      onClick={() => {
                        setThemeLibraryOpen(false);
                        setStoryStep('themes');
                      }}
                      className="px-4 py-2 rounded-lg text-xs bg-primary text-white hover:bg-primary/90 transition-all"
                    >
                      查看已选主题 ({selectedThemes.length})
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Selected Themes: Independent Cards with Live Progress ── */}
        {storyStep === 'themes' && selectedThemes.length > 0 && (
          <div className="space-y-3 mt-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-text-primary">已选主题</span>
                <span className="px-1.5 py-0.5 rounded-full text-[11px] bg-primary/10 text-primary font-medium">{selectedThemes.length}</span>
              </div>
              <div className="flex items-center gap-2">
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
            </div>

            {/* Independent theme cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {selectedThemes.map((theme) => {
                const state = themeOutlineStates[theme.id];
                const isGenerating = !!state?.generating;
                const isDone = !!state?.outlineArc;

                return (
                  <div
                    key={theme.id}
                    className={`rounded-xl border overflow-hidden transition-all ${
                      isDone
                        ? 'border-green-300 bg-green-50/30'
                        : isGenerating
                          ? 'border-yellow-300 bg-yellow-50/30 animate-pulse-subtle'
                          : 'border-border bg-bg-elevated hover:border-primary/30'
                    }`}
                  >
                    {/* Card header */}
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                        isDone ? 'bg-green-500 text-white' : isGenerating ? 'bg-yellow-500 text-white' : r18Mode ? 'bg-red-100 text-red-600' : 'bg-primary/10 text-primary'
                      }`}>
                        {isGenerating ? <Loader2 size={10} className="animate-spin" /> : theme.id}
                      </span>
                      <p className="flex-1 text-xs font-semibold text-text-primary truncate">{theme.title}</p>
                      {theme.category && (
                        <span className="text-[9px] px-1 py-0.5 rounded-full bg-bg-elevated text-text-tertiary">{theme.category}</span>
                      )}
                      <button
                        onClick={() => handleRemoveThemeFromSelected(theme.id)}
                        className="p-0.5 rounded text-text-tertiary hover:text-red-500 transition-colors"
                        title="移除"
                      >
                        <X size={12} />
                      </button>
                    </div>

                    {/* Card body */}
                    <div className="px-3 py-2">
                      {isGenerating && (
                        <div className="flex items-center gap-1.5 text-[11px] text-yellow-600">
                          <Loader2 size={10} className="animate-spin" />
                          正在生成大纲...
                        </div>
                      )}
                      {isDone && state && (
                        <div className="space-y-1.5">
                          <p className="text-[11px] text-text-secondary leading-relaxed">{state.outlineArc}</p>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-text-tertiary">{state.panels.length} 个分镜</span>
                            <div className="flex-1" />
                            <button
                              onClick={() => {
                                const st = themeOutlineStates[theme.id];
                                if (st) {
                                  setPanels(st.panels);
                                  setOutlineArc(st.outlineArc);
                                  setOutlineScenes(st.outlineScenes);
                                  setStoryStep('panels');
                                  const hid = st.historyId;
                                  if (hid) {
                                    setCurrentHistoryId(hid);
                                    const cached = getAllCachedPanelImages(hid, st.panels.length);
                                    if (Object.keys(cached).length > 0) {
                                      const initial: Record<number, { loading: boolean; images: string[] }> = {};
                                      for (const [idx, imgs] of Object.entries(cached)) {
                                        initial[Number(idx)] = { loading: false, images: imgs };
                                      }
                                      setGenStates(initial);
                                    }
                                  }
                                }
                              }}
                              className="px-2 py-0.5 rounded text-[10px] font-medium bg-primary text-white hover:bg-primary/90 transition-all"
                            >
                              加载分镜
                            </button>
                            <button
                              onClick={() => handleGenerateOutlineSingle(theme)}
                              className="px-2 py-0.5 rounded text-[10px] font-medium bg-bg-elevated text-text-secondary hover:bg-bg-hover transition-all"
                            >
                              重新生成
                            </button>
                          </div>
                        </div>
                      )}
                      {!isGenerating && !isDone && (
                        <div className="flex items-center gap-2">
                          <p className="text-[10px] text-text-tertiary line-clamp-2 flex-1">{theme.description}</p>
                          <button
                            onClick={() => handleGenerateOutlineSingle(theme)}
                            className={`flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all ${
                              r18Mode
                                ? 'bg-red-500 text-white hover:bg-red-600'
                                : 'bg-primary text-white hover:bg-primary/90'
                            }`}
                          >
                            <Wand2 size={10} />
                            生成大纲
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Single theme selection (non-multi) ── */}
        {storyStep === 'themes' && selectedThemes.length === 0 && themeOptions.length > 0 && (
          <div className="space-y-2 mt-3">
            <p className="text-xs text-text-tertiary font-medium">请选择一个主题（{themeOptions.length} 个可选）</p>
            <div className="grid grid-cols-1 gap-2">
              {themeOptions.map((theme) => (
                <button
                  key={theme.id}
                  onClick={() => setSelectedTheme(theme)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${selectedTheme?.id === theme.id
                    ? r18Mode ? 'border-red-400 bg-red-50/60' : 'border-primary bg-primary/5'
                    : 'border-border bg-bg-elevated hover:bg-bg-hover'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${selectedTheme?.id === theme.id ? (r18Mode ? 'bg-red-500 text-white' : 'bg-primary text-white') : 'bg-bg-elevated text-text-tertiary'}`}>
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
                    {selectedTheme?.id === theme.id && (
                      <Check size={16} className={r18Mode ? 'text-red-500' : 'text-primary'} />
                    )}
                  </div>
                </button>
              ))}
            </div>
            {selectedTheme && (
              <button
                onClick={handleGenerateOutline}
                disabled={generatingOutline}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-sm transition-all ${generatingOutline ? 'bg-bg-elevated text-text-secondary cursor-not-allowed' : r18Mode ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 active:scale-[0.98]' : 'bg-gradient-to-r from-indigo-500 to-primary text-white hover:opacity-90 active:scale-[0.98]'}`}
              >
                {generatingOutline ? <><Loader2 size={16} className="animate-spin" /> 生成大纲和分镜中...</> : <><Wand2 size={16} />生成「{selectedTheme.title}」的大纲和分镜</>}
              </button>
            )}
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

      {/* Storyboard History */}
      {showHistory && (
        <StoryboardHistoryPanel
          history={history}
          r18Mode={r18Mode}
          onLoad={handleHistoryLoad}
          onDelete={handleDeleteHistory}
          onClear={() => { clearStoryboardHistory(); setHistory([]); }}
        />
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
            const hasActiveTask = panelRelatedTasks.some((t: QueuedTask) => t.status === 'RUNNING' || t.status === 'QUEUEING');
            const hasGenerated = (genStates[idx]?.images?.length ?? 0) > 0 && hasActiveTask;
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
                genState={genStates[idx]}
                onGenerateImage={() => handleGenerateImage(idx, panel.image_prompt)}
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
            <span className="text-sm text-white/60">{previewIndex + 1} / {previewImages.length}</span>
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

function StoryboardHistoryPanel({ history, r18Mode, onLoad, onDelete, onClear }: {
  history: StoryboardHistoryItem[];
  r18Mode: boolean;
  onLoad: (h: StoryboardHistoryItem) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}) {
  // Load cached images for history items (just first panel for preview)
  // Use direct history images field first (like image history page), fallback to cached panel images
  const [previewImages, setPreviewImages] = useState<Record<string, string[]>>({});
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const newPreviews: Record<string, string[]> = {};
    for (const h of history) {
      // First try direct images field (like image history page)
      let allImages: string[] = h.images || [];

      // Fallback to cached panel images if no direct images
      if (allImages.length === 0) {
        const cached = getAllCachedPanelImages(h.id, h.panel_count);
        for (const imgs of Object.values(cached)) {
          allImages.push(...imgs);
        }
      }

      if (allImages.length > 0) newPreviews[h.id] = allImages.slice(0, 6);
    }
    setPreviewImages(newPreviews);
  }, [history, refreshKey]);

  return (
    <div className={`rounded-2xl bg-white border shadow-card overflow-hidden ${r18Mode ? 'border-red-200' : 'border-border'}`}>
      <div className={`flex items-center justify-between px-4 py-3 border-b ${r18Mode ? 'border-red-100 bg-red-50/40' : 'border-border/50 bg-bg-elevated'}`}>
        <div className="flex items-center gap-2">
          <History size={14} className={r18Mode ? 'text-red-500' : 'text-text-tertiary'} />
          <span className={`text-sm font-medium ${r18Mode ? 'text-red-600' : 'text-text-primary'}`}>分镜历史</span>
          <span className="px-2 py-0.5 rounded-full text-[11px] bg-bg-elevated text-text-tertiary">{history.length}</span>
        </div>
        {history.length > 0 && (
          <div className="flex items-center gap-1">
            <button onClick={() => setRefreshKey((k) => k + 1)} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-text-tertiary hover:text-primary hover:bg-bg-hover transition-all" title="刷新缩略图"><RefreshCw size={11} /></button>
            <button onClick={onClear} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-all"><Trash2 size={11} />清空</button>
          </div>
        )}
      </div>
      {history.length === 0 ? (
        <div className="px-4 py-8 text-center"><Clock size={24} className="mx-auto text-text-tertiary/40 mb-2" /><p className="text-sm text-text-tertiary">暂无历史记录</p></div>
      ) : (
        <div className="max-h-[400px] overflow-y-auto">
          {history.map((h) => (
            <div key={h.id} className="flex items-start gap-2 px-4 py-3 border-b border-border/50 last:border-0 hover:bg-bg-hover/30 transition-colors">
              <button onClick={() => onLoad(h)} className="flex-1 flex items-start gap-2 w-full min-w-0 text-left group">
                {/* Thumbnail strip for cached images */}
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
      )}
    </div>
  );
}

function StoryboardPanelCard({ panel, idx, isExpanded, r18Mode, copiedPanel, onToggle, onCopyPanel, genState, onGenerateImage, taskManager, digitalHumanMode, selectedGirlfriend, selectedImageIndex, onSelectImage, onGenerateVideo, videoPrompt, hasGeneratedImages, onPreviewImage, videoGenLoading, onDirectGenerateVideo }: {
  panel: { panel_number: number; scene_description: string; image_prompt: string };
  idx: number; isExpanded: boolean; r18Mode: boolean; copiedPanel: number | null;
  onToggle: () => void; onCopyPanel: () => void;
  genState?: { loading: boolean; images: string[] };
  onGenerateImage: () => void;
  taskManager: TaskManagerReturn;
  digitalHumanMode?: boolean; selectedGirlfriend?: GirlfriendPreset | null;
  selectedImageIndex?: number;
  onSelectImage?: (index: number, imageUrl: string) => void;
  onGenerateVideo?: (imageUrl: string, prompt: string) => void;
  videoPrompt?: string;
  hasGeneratedImages?: boolean;
  onPreviewImage?: (images: string[], currentIndex: number) => void;
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
    // Match on exact or partial (longer) prompt overlap
    return taskPromptNorm === normalizedPanelPrompt ||
      taskPromptNorm.includes(normalizedPanelPrompt) ||
      normalizedPanelPrompt.includes(taskPromptNorm) ||
      (normalizedPanelPrompt.length > 50 && taskPromptNorm.includes(normalizedPanelPrompt.substring(0, Math.min(normalizedPanelPrompt.length, 150))));
  });

  // Only show cached images if there's a matching active/queued task, otherwise hide them
  const hasActiveTask = panelRelatedTasks.some((t: QueuedTask) => t.status === 'RUNNING' || t.status === 'QUEUEING');
  const allDisplayImages = hasActiveTask ? (displayImages.length > 0 ? displayImages : panelRelatedTasks.flatMap((t: QueuedTask) => t.images)) : panelRelatedTasks.flatMap((t: QueuedTask) => t.images);
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
                        onPreviewImage?.(allDisplayImages, i);
                      }}
                    >
                      <img src={img} alt="" className="w-full aspect-square object-cover" loading="lazy" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                        <div className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <ZoomIn size={16} className="text-white" />
                        </div>
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

function AIGeneratedImagePreview({ src }: { src: string }) {
  const [lightbox, setLightbox] = useState(false);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const a = document.createElement('a');
    a.href = src;
    a.download = src.split('/').pop() || `generated_${Date.now()}.png`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  };

  return (
    <>
      <div className="relative group aspect-square rounded-lg overflow-hidden bg-bg-elevated cursor-pointer" onClick={() => setLightbox(true)}>
        <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={handleDownload} className="w-7 h-7 rounded-full bg-white/90 flex items-center justify-center text-gray-700 hover:bg-white transition-colors">
            <Download size={12} />
          </button>
          <button onClick={() => setLightbox(true)} className="w-7 h-7 rounded-full bg-white/90 flex items-center justify-center text-gray-700 hover:bg-white transition-colors">
            <span className="text-xs font-bold">+</span>
          </button>
        </div>
      </div>
      {lightbox && (
        <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center animate-fade-in" onClick={() => setLightbox(false)}>
          <button onClick={() => setLightbox(false)} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors">
            <X size={20} />
          </button>
          <img src={src} alt="" className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
          <button onClick={handleDownload} className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-gray-800 text-sm font-medium hover:bg-gray-100 transition-colors">
            <Download size={16} /> 下载图片
          </button>
        </div>
      )}
    </>
  );
}
