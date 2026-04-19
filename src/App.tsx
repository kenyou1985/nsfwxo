import React, { useState, useCallback } from 'react';
import { Header } from './components/Header';
import { TabNavigation } from './components/TabNavigation';
import { SettingDrawer } from './components/SettingDrawer';
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
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mb-6">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-slate-100 mb-2">请先设置 API Key</h2>
          <p className="text-sm text-slate-500 mb-6 max-w-[280px]">
            使用 RunningHub API 需要先配置您的 API Key
          </p>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-primary to-secondary text-white font-medium text-sm hover:opacity-90 transition-opacity"
          >
            前往设置
          </button>
        </div>
      );
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
      <main className="max-w-[480px] lg:max-w-none mx-auto px-4 lg:px-6 pt-4 pb-8">
        {renderPage()}
      </main>

      <SettingDrawer
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        apiKey={apiKey}
        maskedKey={maskedKey}
        onSave={saveApiKey}
        onClear={removeApiKey}
      />

      <Toast toasts={toast.toasts} onRemove={toast.removeToast} />
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
