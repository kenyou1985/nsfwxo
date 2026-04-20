import React from 'react';
import { Settings, Cpu } from 'lucide-react';

interface HeaderProps {
  onSettingsClick: () => void;
  hasApiKey: boolean;
}

export function Header({ onSettingsClick, hasApiKey }: HeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-md border-b border-border">
      <div className="max-w-screen-xl mx-auto h-14 flex items-center justify-between px-4 xl:px-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center shadow-md">
            <Cpu size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-text-primary leading-none">
              NSFWXO
            </h1>
            <p className="text-[10px] text-text-tertiary leading-none mt-0.5">AI Image Generator</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {hasApiKey && (
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-50 border border-green-200">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-xs text-green-600 font-medium">Connected</span>
            </div>
          )}
          <button
            onClick={onSettingsClick}
            className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-bg-elevated transition-colors active:scale-95"
            aria-label="Settings"
          >
            <Settings size={20} className="text-text-secondary" />
          </button>
        </div>
      </div>
    </header>
  );
}
