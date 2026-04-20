import React, { useState, useCallback } from 'react';
import { Header } from './components/Header';
import { TabNavigation } from './components/TabNavigation';
import { Toast } from './components/Toast';
import { TextToImagePage } from './pages/TextToImagePage';
import { ImageToImagePage } from './pages/ImageToImagePage';
import { ImageToVideoPage } from './pages/ImageToVideoPage';
import { HistoryPage } from './pages/HistoryPage';
import { useApiKey } from './hooks/useApiKey';
import { useToast } from './hooks/useToast';
import { useTaskManager } from './hooks/useTaskManager';
import { saveTaskToHistory, type HistoryRecord } from './services/historyService';
import type { TabType, QueuedTask } from './types';
import { Eye, EyeOff, Check, Trash2, X } from 'lucide-react';
import { useRef } from 'react';

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('txt2img');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { apiKey, maskedKey, hasApiKey, isLoaded, saveApiKey, removeApiKey } = useApiKey();
  const toast = useToast();

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
  });

  const handleRegenerateFromHistory = useCallback(
    (record: HistoryRecord) => {
      if (!record.nodeInfoList || record.nodeInfoList.length === 0) {
        toast.error('该记录无法重新生成');
        return;
      }
      if (taskManager.isFull) {
        toast.error('任务队列已满，请等待');
        return;
      }
      taskManager.addTaskWithNodeList(record.workflowType, record.nodeInfoList, record.prompt);
      toast.success('已提交重新生成任务');
      setActiveTab(record.workflowType === 'txt2img' ? 'txt2img' : 'img2img');
    },
    [taskManager, toast]
  );

  const handleTabChange = useCallback((tab: TabType) => {
    setActiveTab(tab);
  }, []);

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-bg-base flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

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
        return <HistoryPage onRegenerate={handleRegenerateFromHistory} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-bg-base">
      <Header onSettingsClick={() => setIsSettingsOpen(true)} hasApiKey={hasApiKey} />
      <TabNavigation activeTab={activeTab} onTabChange={handleTabChange} />

      {/* Responsive container: mobile=max-w-[480px], desktop=full */}
      {/* pt-[120px] accounts for fixed header (56px) + tab nav (48px) + extra breathing room */}
      <main className="max-w-[480px] lg:max-w-none mx-auto px-4 lg:px-6 pt-[120px] pb-8 xl:pt-4">
        {renderPage()}
      </main>

      {/* Mobile: Inline API Key editor panel */}
      {isSettingsOpen && (
        <div className="lg:hidden fixed inset-x-0 bottom-0 z-50 bg-bg-surface border-t border-border rounded-t-2xl shadow-2xl animate-slide-in-bottom">
          <InlineApiKeyEditor
            apiKey={apiKey}
            maskedKey={maskedKey}
            onSave={saveApiKey}
            onClear={removeApiKey}
            onClose={() => setIsSettingsOpen(false)}
          />
        </div>
      )}

      {/* Desktop: full overlay drawer */}
      {isSettingsOpen && (
        <div className="hidden lg:block fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setIsSettingsOpen(false)} />
          <div className="relative w-full max-w-sm h-full bg-bg-surface border-l border-border animate-slide-in-right overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-surface sticky top-0 z-10">
              <h2 className="text-base font-semibold text-slate-100">API 设置</h2>
              <button onClick={() => setIsSettingsOpen(false)} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-bg-elevated transition-colors">
                <X size={18} className="text-slate-400" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <InlineApiKeyEditor
                apiKey={apiKey}
                maskedKey={maskedKey}
                onSave={saveApiKey}
                onClear={removeApiKey}
                onClose={() => setIsSettingsOpen(false)}
              />
            </div>
          </div>
        </div>
      )}

      <Toast toasts={toast.toasts} onRemove={toast.removeToast} />
    </div>
  );
}

function InlineApiKeySetup({ onClose }: { onClose: () => void }) {
  const { apiKey, maskedKey, saveApiKey } = useApiKey();
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <InlineApiKeyEditor apiKey={apiKey} maskedKey={maskedKey} onSave={saveApiKey} onClear={() => {}} onClose={onClose} />
    </div>
  );
}

interface InlineApiKeyEditorProps {
  apiKey: string | null;
  maskedKey: string;
  onSave: (key: string) => void;
  onClear: () => void;
  onClose: () => void;
}

function InlineApiKeyEditor({ apiKey, maskedKey, onSave, onClear, onClose }: InlineApiKeyEditorProps) {
  const [inputKey, setInputKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    const trimmed = inputKey.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setSaveSuccess(true);
    setInputKey('');
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  const handleClear = () => {
    onClear();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-100">API Key 设置</h2>
        <button
          onClick={onClose}
          className="lg:hidden w-8 h-8 flex items-center justify-center rounded-lg hover:bg-bg-elevated transition-colors"
        >
          <X size={16} className="text-slate-400" />
        </button>
      </div>

      {apiKey && (
        <div className="flex items-center gap-2 text-xs text-green-400 bg-green-400/10 px-3 py-2 rounded-lg">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
          <span className="truncate">已保存: {maskedKey}</span>
        </div>
      )}

      <div className="relative">
        <input
          ref={inputRef}
          type={showKey ? 'text' : 'password'}
          value={inputKey}
          onChange={(e) => setInputKey(e.target.value)}
          placeholder="请输入 RunningHub API Key"
          className="w-full bg-bg-elevated border border-border rounded-xl px-4 py-3 pr-12 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-primary transition-colors"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={() => setShowKey((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-200 transition-colors"
        >
          {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>

      <p className="text-xs text-slate-500 -mt-1">
        获取: RunningHub → 右上角头像 → API 控制台
      </p>

      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={!inputKey.trim()}
          className={`
            flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all
            ${inputKey.trim()
              ? 'bg-gradient-to-r from-primary to-primary/80 text-white hover:opacity-90 active:scale-[0.98]'
              : 'bg-bg-elevated text-slate-500 cursor-not-allowed'
            }
          `}
        >
          {saveSuccess ? <><Check size={16} /> 已保存</> : '保存 Key'}
        </button>

        {apiKey && (
          <button
            onClick={handleClear}
            className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl font-medium text-sm bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
          >
            <Trash2 size={15} />
            清除
          </button>
        )}
      </div>

      <div className="border-t border-border pt-3 space-y-1.5">
        <p className="text-xs font-medium text-slate-400">使用步骤</p>
        <ol className="space-y-1 text-[11px] text-slate-500">
          <li className="flex gap-2"><span className="text-primary font-medium">1.</span>在 RunningHub 注册并开通会员</li>
          <li className="flex gap-2"><span className="text-primary font-medium">2.</span>获取 API Key 填入上方</li>
          <li className="flex gap-2"><span className="text-primary font-medium">3.</span>工作流需在网页端至少运行一次</li>
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
