import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { TabNavigation } from './components/TabNavigation';
import { Toast } from './components/Toast';
import { TextToImagePage } from './pages/TextToImagePage';
import { ImageToImagePage } from './pages/ImageToImagePage';
import { ImageToVideoPage } from './pages/ImageToVideoPage';
import { HistoryPage } from './pages/HistoryPage';
import { AIPromptPage } from './pages/AIPromptPage';
import { useApiKey } from './hooks/useApiKey';
import { useYunwuKey } from './hooks/useYunwuKey';
import { useBackendUrl } from './hooks/useBackendUrl';
import { useToast } from './hooks/useToast';
import { useTaskManager, loadPersistedTasks, clearPersistedTasks, type PersistedTaskEntry } from './hooks/useTaskManager';
import { saveTaskToHistory, type HistoryRecord } from './services/historyService';
import { migrateLegacyStorageData } from './services/storage';
import { DEFAULT_GIRLFRIEND_PRESETS } from './data/girlfriendPresets';
import { buildTxt2ImgNodeList } from './utils/txt2imgNodeBuilder';
import { WORKFLOW } from './services/runninghub';
import { DEFAULT_TXT2IMG_PARAMS } from './constants';
import type { TabType, QueuedTask } from './types';
import { Eye, EyeOff, Check, Trash2, X, Zap, Server, Image } from 'lucide-react';
import { FinishedTaskImagesContext } from './contexts/FinishedTaskImagesContext';

function App() {
  const { apiKey, maskedKey, hasApiKey, isLoaded, saveApiKey, removeApiKey } = useApiKey();
  const { yunwuKey, maskedYunwuKey, hasYunwuKey, saveYunwuKey, removeYunwuKey } = useYunwuKey();
  const { backendUrl, saveBackendUrl, resetBackendUrl, defaultUrl } = useBackendUrl();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<TabType>('txt2img');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [img2imgPendingPrompt, setImg2imgPendingPrompt] = useState<string>('');
  const [regenerateWithGirlfriendId, setRegenerateWithGirlfriendId] = useState<string>('');

  // One-time migration: strip legacy data URLs from favorites and storyboard history
  useEffect(() => {
    const result = migrateLegacyStorageData();
    if (result.favoritesCleaned > 0 || result.storyboardsCleaned > 0) {
      console.log('[App] Legacy storage migration complete:', result);
    }
  }, []);

  // ── Finished task images registry ──
  // Updated whenever any task completes, so pages can subscribe and cache images
  const [finishedTaskImages, setFinishedTaskImages] = useState<Record<string, { images: string[]; storyboardInfo?: { historyId: string; panelIdx: number }; zipUrl?: string }>>({});
  const registerTaskImages = useCallback((taskId: string, images: string[], storyboardInfo?: { historyId: string; panelIdx: number }, zipUrl?: string) => {
    setFinishedTaskImages((prev) => ({ ...prev, [taskId]: { images, storyboardInfo, zipUrl } }));
  }, []);

  const handleTaskError = useCallback(
    (taskId: string, message: string) => {
      toast.error(message);
    },
    [toast]
  );

  const handleTaskComplete = useCallback(
    (task: QueuedTask, elapsed: number) => {
      toast.success(`生成完成！用时 ${formatTime(elapsed)}${task.coins ? `，消耗 ${task.coins} 币` : ''}`);
      saveTaskToHistory(task);
    },
    [toast]
  );

  const taskManager = useTaskManager({
    apiKey,
    onError: handleTaskError,
    onTaskComplete: handleTaskComplete,
    onTaskImagesReady: registerTaskImages,
  });

  // Auto-restore in-progress tasks from localStorage on mount
  useEffect(() => {
    if (!apiKey) return;
    const entries = loadPersistedTasks();
    if (entries.length === 0) return;

    // Filter to only tasks with a RunningHub taskId and younger than 24 hours
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const validEntries = entries.filter((e) => e.taskId && e.timestamp > cutoff);
    const staleEntries = entries.filter((e) => !e.taskId || e.timestamp <= cutoff);

    if (staleEntries.length > 0) {
      clearPersistedTasks();
    }

    if (validEntries.length > 0) {
      taskManager.restoreTasks(validEntries);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  const handleRegenerateFromHistory = useCallback(
    (record: HistoryRecord) => {
      const prompt = record.prompt || '';

      if (!prompt.trim()) {
        toast.error('该记录没有提示词，无法重新生成');
        return;
      }

      if (record.workflowType === 'txt2img') {
        // 文生图：直接本地构建节点列表并提交任务
        if (taskManager.isFull) {
          toast.error('任务队列已满，请等待');
          return;
        }
        const nodes = buildTxt2ImgNodeList({
          width: DEFAULT_TXT2IMG_PARAMS.width,
          height: DEFAULT_TXT2IMG_PARAMS.height,
          imageCount: DEFAULT_TXT2IMG_PARAMS.imageCount,
          prompt,
          lora1Name: DEFAULT_TXT2IMG_PARAMS.lora1Name,
          lora1Weight: DEFAULT_TXT2IMG_PARAMS.lora1Weight,
          lora2Name: DEFAULT_TXT2IMG_PARAMS.lora2Name,
          lora2Weight: DEFAULT_TXT2IMG_PARAMS.lora2Weight,
        });
        taskManager.addTaskWithNodeList('txt2img', nodes, prompt, WORKFLOW.TEXT_TO_IMAGE);
        toast.success('任务已提交，请到文生图查看生成结果');
        setActiveTab('txt2img');
        return;
      }

      if (record.workflowType === 'img2img') {
        // 检查数字人锚定
        const anchorMatch = prompt.match(/ID:([A-Za-z0-9_]+)/);
        const anchorId = anchorMatch ? anchorMatch[1].toUpperCase() : null;
        let matchedGirlfriendId: string | undefined;
        if (anchorId) {
          const match = DEFAULT_GIRLFRIEND_PRESETS.find(
            (gf) => gf.id.toUpperCase() === anchorId || gf.name.toUpperCase() === anchorId
          );
          if (match) matchedGirlfriendId = match.id;
        }

        if (matchedGirlfriendId) {
          // 有锚定数字人：自动跳转 img2img 并自动生成
          setImg2imgPendingPrompt(prompt);
          setRegenerateWithGirlfriendId(matchedGirlfriendId);
          setActiveTab('img2img');
          toast.success('已检测到数字人锚定，正在自动重新生成');
        } else {
          // 无锚定：跳转 img2img 让用户上传参考图
          setImg2imgPendingPrompt(prompt);
          setRegenerateWithGirlfriendId('');
          setActiveTab('img2img');
        }
        return;
      }

      toast.error('该记录类型不支持重新生成');
    },
    [taskManager, toast]
  );

  const handleTabChange = useCallback((tab: TabType) => {
    setActiveTab(tab);
  }, []);

  const renderPage = () => {
    if (!apiKey) {
      return <InlineApiKeySetup onClose={() => setIsSettingsOpen(false)} />;
    }

    switch (activeTab) {
      case 'txt2img':
        return (
          <TextToImagePage
            apiKey={apiKey}
            onError={toast.error}
            onSuccess={toast.success}
            taskManager={taskManager}
          />
        );
      case 'img2img':
        return (
          <ImageToImagePage
            apiKey={apiKey}
            onError={toast.error}
            onSuccess={toast.success}
            taskManager={taskManager}
            initialPrompt={img2imgPendingPrompt}
            onPromptConsumed={() => setImg2imgPendingPrompt('')}
            regenerateWithGirlfriendId={regenerateWithGirlfriendId}
            onRegenerateConsumed={() => setRegenerateWithGirlfriendId('')}
          />
        );
      case 'img2vid':
        return (
          <ImageToVideoPage
            apiKey={apiKey}
            onError={toast.error}
            onSuccess={toast.success}
          />
        );
      case 'history':
        return <HistoryPage onRegenerate={handleRegenerateFromHistory} onSuccess={toast.success} onError={toast.error} onNavigate={(tab) => setActiveTab(tab)} />;
      case 'aiprompt':
        return (
          <AIPromptPage
            onError={toast.error}
            onSuccess={toast.success}
            onOpenSettings={() => setIsSettingsOpen(true)}
            taskManager={taskManager}
            apiKey={apiKey}
            onNavigate={(tab) => setActiveTab(tab)}
          />
        );
      default:
        return null;
    }
  };

  return (
    <FinishedTaskImagesContext.Provider value={{ finishedTasks: finishedTaskImages, registerTaskImages }}>
      <div className="min-h-screen bg-bg-base">
        <Header onSettingsClick={() => setIsSettingsOpen(true)} hasApiKey={hasApiKey} />
        <TabNavigation activeTab={activeTab} onTabChange={handleTabChange} />

        {/* Responsive container: mobile=max-w-[480px], desktop=full */}
        <main className="max-w-[480px] lg:max-w-none mx-auto px-4 lg:px-6 pt-24 lg:pt-20 pb-8">
          {!isLoaded ? (
            <div className="flex items-center justify-center min-h-[40vh]">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            renderPage()
          )}
        </main>


      {/* Mobile: full-screen drawer (not the half-cover sheet from earlier) */}
      {isSettingsOpen && isLoaded && (
        <div className="lg:hidden fixed inset-0 z-50 bg-bg-surface flex flex-col">
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-border bg-bg-surface">
            <h2 className="text-base font-semibold text-text-primary">API 设置</h2>
            <button onClick={() => setIsSettingsOpen(false)} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-bg-elevated transition-colors" aria-label="Close">
              <X size={18} className="text-text-secondary" />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            <InlineApiKeyEditor
              // RunningHub
              apiKey={apiKey}
              maskedKey={maskedKey}
              onSaveApiKey={saveApiKey}
              onClearApiKey={removeApiKey}
              // Yunwu
              yunwuKey={yunwuKey}
              maskedYunwuKey={maskedYunwuKey}
              onSaveYunwuKey={saveYunwuKey}
              onClearYunwuKey={removeYunwuKey}
              // Backend URL
              backendUrl={backendUrl}
              onSaveBackendUrl={saveBackendUrl}
              onResetBackendUrl={resetBackendUrl}
              defaultBackendUrl={defaultUrl}
              onClose={() => setIsSettingsOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Desktop: full overlay drawer */}
      {isSettingsOpen && isLoaded && (
        <div className="hidden lg:block fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setIsSettingsOpen(false)} />
          <div className="relative w-full max-w-sm h-full bg-bg-surface border-l border-border animate-slide-in-right flex flex-col">
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-border bg-bg-surface z-10">
              <h2 className="text-base font-semibold text-text-primary">API 设置</h2>
              <button onClick={() => setIsSettingsOpen(false)} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-bg-elevated transition-colors">
                <X size={18} className="text-text-secondary" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              <InlineApiKeyEditor
                // RunningHub
                apiKey={apiKey}
                maskedKey={maskedKey}
                onSaveApiKey={saveApiKey}
                onClearApiKey={removeApiKey}
                // Yunwu
                yunwuKey={yunwuKey}
                maskedYunwuKey={maskedYunwuKey}
                onSaveYunwuKey={saveYunwuKey}
                onClearYunwuKey={removeYunwuKey}
                // Backend URL
                backendUrl={backendUrl}
                onSaveBackendUrl={saveBackendUrl}
                onResetBackendUrl={resetBackendUrl}
                defaultBackendUrl={defaultUrl}
                onClose={() => setIsSettingsOpen(false)}
              />
            </div>
          </div>
        </div>
      )}

      <Toast toasts={toast.toasts} onRemove={toast.removeToast} />
      </div>
    </FinishedTaskImagesContext.Provider>
  );
}

function InlineApiKeySetup({ onClose }: { onClose: () => void }) {
  const { apiKey, maskedKey, saveApiKey } = useApiKey();
  const { yunwuKey, maskedYunwuKey, saveYunwuKey } = useYunwuKey();
  const { backendUrl, saveBackendUrl, defaultUrl } = useBackendUrl();
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <InlineApiKeyEditor
        apiKey={apiKey}
        maskedKey={maskedKey}
        onSaveApiKey={saveApiKey}
        onClearApiKey={() => {}}
        yunwuKey={yunwuKey}
        maskedYunwuKey={maskedYunwuKey}
        onSaveYunwuKey={saveYunwuKey}
        onClearYunwuKey={() => {}}
        backendUrl={backendUrl}
        onSaveBackendUrl={saveBackendUrl}
        onResetBackendUrl={() => {}}
        defaultBackendUrl={defaultUrl}
        onClose={onClose}
      />
    </div>
  );
}

interface InlineApiKeyEditorProps {
  apiKey: string | null;
  maskedKey: string;
  onSaveApiKey: (key: string) => void;
  onClearApiKey: () => void;
  yunwuKey: string | null;
  maskedYunwuKey: string;
  onSaveYunwuKey: (key: string) => void;
  onClearYunwuKey: () => void;
  backendUrl: string;
  onSaveBackendUrl: (url: string) => void;
  onResetBackendUrl: () => void;
  defaultBackendUrl: string;
  onClose: () => void;
}

function InlineApiKeyEditor({
  apiKey,
  maskedKey,
  onSaveApiKey,
  onClearApiKey,
  yunwuKey,
  maskedYunwuKey,
  onSaveYunwuKey,
  onClearYunwuKey,
  backendUrl,
  onSaveBackendUrl,
  onResetBackendUrl,
  defaultBackendUrl,
  onClose,
}: InlineApiKeyEditorProps) {
  const [rhInput, setRhInput] = useState('');
  const [rhShow, setRhShow] = useState(false);
  const [rhSaved, setRhSaved] = useState(false);
  const [yunwuInput, setYunwuInput] = useState('');
  const [yunwuShow, setYunwuShow] = useState(false);
  const [yunwuSaved, setYunwuSaved] = useState(false);
  const [urlInput, setUrlInput] = useState(backendUrl);
  const [urlSaved, setUrlSaved] = useState(false);
  const rhRef = useRef<HTMLInputElement>(null);
  const yunwuRef = useRef<HTMLInputElement>(null);

  const handleSaveRh = () => {
    const trimmed = rhInput.trim();
    if (!trimmed) return;
    onSaveApiKey(trimmed);
    setRhSaved(true);
    setRhInput('');
    setTimeout(() => setRhSaved(false), 2000);
  };

  const handleSaveYunwu = () => {
    const trimmed = yunwuInput.trim();
    if (!trimmed) return;
    onSaveYunwuKey(trimmed);
    setYunwuSaved(true);
    setYunwuInput('');
    setTimeout(() => setYunwuSaved(false), 2000);
  };

  const handleSaveUrl = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    onSaveBackendUrl(trimmed);
    setUrlSaved(true);
    setTimeout(() => setUrlSaved(false), 2000);
  };

  const handleResetUrl = () => {
    onResetBackendUrl();
    setUrlInput(defaultBackendUrl);
  };

  const isUrlModified = urlInput !== defaultBackendUrl && urlInput !== '';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-text-primary">API 设置</h2>
        <button
          onClick={onClose}
          className="lg:hidden w-8 h-8 flex items-center justify-center rounded-lg hover:bg-bg-elevated transition-colors"
        >
          <X size={16} className="text-text-secondary" />
        </button>
      </div>

      {/* RunningHub */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Image size={13} className="text-blue-500" />
          </div>
          <h3 className="text-sm font-semibold text-text-primary">RunningHub API Key</h3>
        </div>
        <p className="text-[11px] text-text-tertiary -mt-1">用于文生图、图生图、图生视频</p>
        {apiKey && (
          <div className="flex items-center gap-2 text-xs text-green-400 bg-green-400/10 px-3 py-2 rounded-lg">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
            <span className="truncate">已保存: {maskedKey}</span>
          </div>
        )}
        <div className="relative">
          <input
            ref={rhRef}
            type={rhShow ? 'text' : 'password'}
            value={rhInput}
            onChange={(e) => setRhInput(e.target.value)}
            placeholder="请输入 RunningHub API Key"
            className="w-full bg-bg-elevated border border-border rounded-xl px-4 py-3 pr-12 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-primary transition-colors"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setRhShow((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
          >
            {rhShow ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <p className="text-[11px] text-text-secondary">获取: RunningHub → 右上角头像 → API 控制台</p>
        <div className="flex gap-3">
          <button
            onClick={handleSaveRh}
            disabled={!rhInput.trim()}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all ${rhInput.trim() ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:opacity-90 active:scale-[0.98]' : 'bg-bg-elevated text-text-secondary cursor-not-allowed'}`}
          >
            {rhSaved ? <><Check size={16} /> 已保存</> : '保存 Key'}
          </button>
          {apiKey && (
            <button
              onClick={onClearApiKey}
              className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl font-medium text-sm bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
            >
              <Trash2 size={15} />清除
            </button>
          )}
        </div>
      </div>

      <div className="border-t border-border" />

      {/* Yunwu AI */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center">
            <Zap size={13} className="text-primary" />
          </div>
          <h3 className="text-sm font-semibold text-text-primary">Yunwu AI API Key</h3>
        </div>
        <p className="text-[11px] text-text-tertiary -mt-1">用于 AI 提示词推理（智能扩写 / 随机抽卡 / 剧情分镜）</p>
        {yunwuKey && (
          <div className="flex items-center gap-2 text-xs text-green-400 bg-green-400/10 px-3 py-2 rounded-lg">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
            <span className="truncate">已保存: {maskedYunwuKey}</span>
          </div>
        )}
        <div className="relative">
          <input
            ref={yunwuRef}
            type={yunwuShow ? 'text' : 'password'}
            value={yunwuInput}
            onChange={(e) => setYunwuInput(e.target.value)}
            placeholder="请输入 Yunwu AI API Key"
            className="w-full bg-bg-elevated border border-border rounded-xl px-4 py-3 pr-12 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-primary transition-colors"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setYunwuShow((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
          >
            {yunwuShow ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <p className="text-[11px] text-text-secondary">
          获取: <a href="https://yunwu.ai" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">yunwu.ai</a> → API Keys 页面
        </p>
        <div className="flex gap-3">
          <button
            onClick={handleSaveYunwu}
            disabled={!yunwuInput.trim()}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all ${yunwuInput.trim() ? 'bg-gradient-to-r from-primary to-primary/80 text-white hover:opacity-90 active:scale-[0.98]' : 'bg-bg-elevated text-text-secondary cursor-not-allowed'}`}
          >
            {yunwuSaved ? <><Check size={16} /> 已保存</> : '保存 Key'}
          </button>
          {yunwuKey && (
            <button
              onClick={onClearYunwuKey}
              className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl font-medium text-sm bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
            >
              <Trash2 size={15} />清除
            </button>
          )}
        </div>
      </div>

      <div className="border-t border-border" />

      {/* Backend URL */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Server size={13} className="text-amber-500" />
          </div>
          <h3 className="text-sm font-semibold text-text-primary">后端服务地址</h3>
        </div>
        <p className="text-[11px] text-text-tertiary -mt-1">本地开发默认 localhost:8000，部署到 Railway 后填入其分配的域名</p>
        {isUrlModified && (
          <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-400/10 px-3 py-2 rounded-lg">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
            <span className="truncate">已修改: {backendUrl}</span>
          </div>
        )}
        <div className="relative">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => { setUrlInput(e.target.value); setUrlSaved(false); }}
            placeholder={defaultBackendUrl}
            className="w-full bg-bg-elevated border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-primary transition-colors font-mono"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <p className="text-[11px] text-text-secondary">示例: <span className="font-mono text-[10px]">https://nsfwxo-prompt-engine.up.railway.app</span></p>
        <div className="flex gap-3">
          <button
            onClick={handleSaveUrl}
            disabled={!urlInput.trim()}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all ${urlInput.trim() ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white hover:opacity-90 active:scale-[0.98]' : 'bg-bg-elevated text-text-secondary cursor-not-allowed'}`}
          >
            {urlSaved ? <><Check size={16} /> 已保存</> : '保存地址'}
          </button>
          {isUrlModified && (
            <button
              onClick={handleResetUrl}
              className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl font-medium text-sm bg-bg-elevated text-text-tertiary hover:bg-bg-hover transition-colors"
              title="恢复默认地址"
            >
              <Server size={15} />重置
            </button>
          )}
        </div>
      </div>

      <div className="border-t border-border pt-4 space-y-1.5">
        <p className="text-xs font-medium text-text-secondary">使用说明</p>
        <ol className="space-y-1 text-[11px] text-text-secondary">
          <li className="flex gap-2"><span className="text-blue-500 font-medium">1.</span> RunningHub Key 用于调用 Flux/SD 生图、Wan2.1 生视频</li>
          <li className="flex gap-2"><span className="text-primary font-medium">2.</span> Yunwu AI Key 用于 AI 提示词智能生成（grok-4-20-reasoning）</li>
          <li className="flex gap-2"><span className="text-amber-500 font-medium">3.</span> 本地开发使用 localhost:8000，部署 Railway 后替换为分配的域名</li>
        </ol>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export default App;
