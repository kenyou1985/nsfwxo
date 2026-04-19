import React from 'react';
import { Image, Type, Video, History } from 'lucide-react';
import type { TabType } from '../types';

interface TabNavigationProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

const TABS: { id: TabType; label: string; icon: React.ReactNode }[] = [
  { id: 'txt2img', label: '文生图', icon: <Type size={14} /> },
  { id: 'img2img', label: '图生图', icon: <Image size={14} /> },
  { id: 'img2vid', label: '图生视频', icon: <Video size={14} /> },
  { id: 'history', label: '历史记录', icon: <History size={14} /> },
];

export function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  return (
    <nav className="sticky top-14 z-30 bg-bg-base/95 backdrop-blur-md border-b border-border">
      <div className="w-full">
        {/* Desktop: horizontal tabs, no scrollbar */}
        <div className="hidden lg:flex items-center justify-center px-4">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                relative flex items-center gap-1.5 px-4 py-3 text-xs font-medium transition-all
                ${
                  activeTab === tab.id
                    ? 'text-primary'
                    : 'text-slate-400 hover:text-slate-200'
                }
              `}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-gradient-to-r from-primary to-secondary rounded-full" />
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
                relative flex-shrink-0 flex items-center justify-center gap-1.5 px-4 text-xs font-medium transition-all
                ${
                  activeTab === tab.id
                    ? 'text-primary'
                    : 'text-slate-500 hover:text-slate-300'
                }
              `}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-gradient-to-r from-primary to-secondary rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}
