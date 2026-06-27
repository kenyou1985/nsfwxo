import React from 'react';
import { Image, Type, Video, History, Wand2, Sparkles, Library } from 'lucide-react';
import type { TabType } from '../types';

interface TabNavigationProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

const TABS: { id: TabType; label: string; icon: React.ReactNode }[] = [
  { id: 'txt2img', label: '文生图', icon: <Type size={13} /> },
  { id: 'img2img', label: '图生图', icon: <Image size={13} /> },
  { id: 'img2vid', label: '图生视频', icon: <Video size={13} /> },
  { id: 'models', label: '模型库', icon: <Library size={13} /> },
  { id: 'aiprompt', label: 'AI 提示词', icon: <Wand2 size={13} /> },
  { id: 'gptimg2', label: 'GPT Image 2', icon: <Sparkles size={13} /> },
  { id: 'history', label: '历史记录', icon: <History size={13} /> },
];

export function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  return (
    <nav className="sticky top-14 z-30 bg-white border-b border-gray-200">
      {/* Desktop */}
      <div className="hidden lg:flex items-center justify-center px-2">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                relative flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-all whitespace-nowrap
                ${isActive ? 'text-primary' : 'text-gray-400 hover:text-gray-600'}
              `}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {isActive && (
                <span className="absolute bottom-0.5 left-4 right-4 h-0.5 bg-primary rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* Mobile / Tablet: 6 tabs horizontally scrollable */}
      <div
        className="flex lg:hidden items-stretch overflow-x-auto scrollbar-hide"
        style={{ height: '48px' }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                relative flex-shrink-0 flex items-center justify-center gap-1 px-3 text-xs font-medium transition-all whitespace-nowrap
                ${isActive ? 'text-primary' : 'text-gray-400 hover:text-gray-600'}
              `}
              style={{ minWidth: '72px' }}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {isActive && (
                <span
                  className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full"
                  style={{ display: 'block' }}
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
