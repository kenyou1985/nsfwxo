import React from 'react';
import { Image, Type, Video, History, Wand2, Sparkles } from 'lucide-react';
import type { TabType } from '../types';

interface TabNavigationProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

const TABS: { id: TabType; label: string; icon: React.ReactNode }[] = [
  { id: 'txt2img', label: '文生图', icon: <Type size={14} /> },
  { id: 'img2img', label: '图生图', icon: <Image size={14} /> },
  { id: 'img2vid', label: '图生视频', icon: <Video size={14} /> },
  { id: 'aiprompt', label: 'AI 提示词', icon: <Wand2 size={14} /> },
  { id: 'gptimg2', label: 'GPT Image 2', icon: <Sparkles size={14} /> },
  { id: 'history', label: '历史记录', icon: <History size={14} /> },
];

export function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  return (
    <nav className="sticky top-14 z-30 bg-white/90 backdrop-blur-md border-b border-border-light">
      <div className="w-full">
        {/* Desktop: horizontal tabs */}
        <div className="hidden lg:flex items-center justify-center px-4">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                relative flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-all
                ${
                  activeTab === tab.id
                    ? 'text-primary'
                    : 'text-text-tertiary hover:text-text-primary'
                }
              `}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-primary rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* Mobile/Tablet: compact tabs */}
        <div className="flex lg:hidden items-stretch overflow-x-auto scrollbar-none justify-center" style={{ height: '48px' }}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                relative flex-shrink-0 flex items-center justify-center gap-1.5 px-4 text-sm font-medium transition-all
                ${
                  activeTab === tab.id
                    ? 'text-primary'
                    : 'text-text-tertiary hover:text-text-primary'
                }
              `}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-primary rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}
