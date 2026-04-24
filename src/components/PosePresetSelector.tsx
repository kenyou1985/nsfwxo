import React, { useState, useMemo } from 'react';
import { User, Search, Lock, Settings, X } from 'lucide-react';
import { IMAGE_POSE_PRESETS, VIDEO_POSE_PRESETS, type ImagePosePreset, type VideoPosePreset } from '../data/presetPoses';
import type { GirlfriendPreset } from '../data/girlfriendPresets';
import {
  getDefaultMaleCharacter, setDefaultMaleCharacter,
  getMaleCharacterPrompt, MALE_CHARACTER_OPTIONS,
  type MaleCharacterId,
} from '../services/storage';

interface PosePresetSelectorProps {
  type: 'image' | 'video';
  onSelect: (prompt: string, name: string) => void;
  disabled?: boolean;
  selectedGirlfriend?: GirlfriendPreset | null;
  forceUnlock?: boolean;
}

function buildIdentityPrefix(gf: GirlfriendPreset | null, maleCharId: MaleCharacterId): string {
  const malePrompt = getMaleCharacterPrompt(maleCharId);
  const malePrefix = malePrompt
    ? `Fully naked, completely nude with no clothes. High-precision realistic hardcore sex photo, ${malePrompt}, `
    : '';
  if (!gf) return malePrefix;
  return `${malePrefix}${gf.characterPrompt}, Strictly preserve the exact identity, character, and features of ${gf.nameZh} (ID:${gf.id.toUpperCase()}). Do not alter the character at all. `;
}

export function PosePresetSelector({ type, onSelect, disabled, selectedGirlfriend = null, forceUnlock = false }: PosePresetSelectorProps) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [maleCharId, setMaleCharId] = useState<MaleCharacterId>(() => getDefaultMaleCharacter());

  const presets = type === 'video' ? VIDEO_POSE_PRESETS : IMAGE_POSE_PRESETS;

  const filtered = useMemo(() => {
    if (!search.trim()) return presets;
    const q = search.toLowerCase();
    return presets.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.nameZh.includes(search) ||
        p.prompt.toLowerCase().includes(q)
    );
  }, [presets, search]);

  const displayPresets = search.trim() ? filtered : presets;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showLockedToast, setShowLockedToast] = useState(false);

  const isImageMode = type === 'image';
  const isLocked = isImageMode && !forceUnlock && !selectedGirlfriend && !disabled;

  const handleToggle = () => {
    if (disabled) return;
    if (isLocked) {
      setShowLockedToast(true);
      setTimeout(() => setShowLockedToast(false), 3000);
      return;
    }
    setExpanded(!expanded);
  };

  const handleToggleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleToggle();
  };

  const handleSelect = (preset: ImagePosePreset | VideoPosePreset) => {
    if (disabled) return;

    if (isLocked) {
      setShowLockedToast(true);
      setTimeout(() => setShowLockedToast(false), 3000);
      return;
    }

    setSelectedId(preset.id);
    const identityPrefix = buildIdentityPrefix(selectedGirlfriend, maleCharId);
    const fullPrompt = identityPrefix + preset.prompt;
    onSelect(fullPrompt, preset.nameZh);
  };

  const handleMaleCharChange = (id: MaleCharacterId) => {
    setMaleCharId(id);
    setDefaultMaleCharacter(id);
  };

  const selectedMaleOption = MALE_CHARACTER_OPTIONS.find((o) => o.id === maleCharId);

  return (
    <div className="border border-border rounded-xl bg-white overflow-hidden">
      <div
        onClick={handleToggleClick}
        className="w-full px-4 py-3 flex items-center justify-between bg-bg-elevated hover:bg-bg-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <div className="flex items-center gap-2">
          {isLocked ? (
            <Lock className="w-4 h-4 text-text-tertiary" />
          ) : (
            <User className="w-4 h-4 text-primary" />
          )}
          <span className={`text-sm font-medium ${isLocked ? 'text-text-tertiary' : 'text-text-primary'}`}>
            {type === 'video' ? '视频姿势预设' : '图片姿势预设'}
          </span>
          {selectedGirlfriend && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
              {selectedGirlfriend.nameZh}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={(e) => { e.stopPropagation(); setShowSettings(true); }}
            className="p-1.5 rounded-lg hover:bg-bg-hover transition-colors text-text-tertiary hover:text-text-primary"
            title="男性角色设置"
          >
            <Settings size={14} />
          </button>
          <svg
            className={`w-4 h-4 text-text-tertiary transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Male character settings modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowSettings(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-[360px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-text-primary">男性角色设置</h3>
              <button onClick={() => setShowSettings(false)} className="p-1 rounded-lg hover:bg-bg-hover transition-colors">
                <X size={16} className="text-text-tertiary" />
              </button>
            </div>
            <div className="p-4 space-y-2">
              <p className="text-xs text-text-tertiary mb-3">
                选择剧情分镜中默认的男性角色类型，此设置将影响所有预设姿势中男性角色的描述。
              </p>
              {MALE_CHARACTER_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => handleMaleCharChange(opt.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${
                    maleCharId === opt.id
                      ? 'bg-primary/10 border border-primary/30 text-primary'
                      : 'bg-bg-elevated border border-transparent hover:bg-bg-hover text-text-primary'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    maleCharId === opt.id ? 'border-primary bg-primary' : 'border-border'
                  }`}>
                    {maleCharId === opt.id && (
                      <div className="w-2 h-2 rounded-full bg-white" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{opt.label}</div>
                    <div className="text-[11px] text-text-tertiary">{opt.labelEn}</div>
                  </div>
                </button>
              ))}
            </div>
            <div className="px-4 pb-4">
              <button
                onClick={() => setShowSettings(false)}
                className="w-full py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 锁定提示 */}
      {showLockedToast && (
        <div className="mx-3 mb-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs text-center animate-pulse">
          请先在左上方选择 AI 女友，才能加载预设姿势
        </div>
      )}

      {/* 锁定时的提示覆盖层 */}
      {isLocked && expanded && (
        <div className="p-3 border-t border-border">
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div className="w-12 h-12 rounded-full bg-bg-elevated flex items-center justify-center">
              <Lock className="w-6 h-6 text-text-tertiary" />
            </div>
            <div>
              <p className="text-sm font-medium text-text-secondary">需要先选择角色</p>
              <p className="text-xs text-text-tertiary mt-1">
                请先从上方「AI 女友」区域选择一个人物，姿势预设会自动锚定该角色
              </p>
            </div>
          </div>
        </div>
      )}

      {expanded && !isLocked && (
        <div className="p-3 border-t border-border">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索姿势..."
              className="w-full pl-9 pr-3 py-2 text-xs border border-border rounded-lg bg-white focus:outline-none focus:border-primary"
            />
          </div>

          <div
            className="grid grid-cols-2 gap-1.5 max-h-64 overflow-y-auto"
            style={{ scrollbarWidth: 'thin' }}
          >
            {displayPresets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handleSelect(preset)}
                className={[
                  'text-left px-2.5 py-2 rounded-lg text-xs transition-colors',
                  selectedId === preset.id
                    ? 'bg-primary text-white'
                    : 'bg-bg-elevated hover:bg-primary-light hover:text-primary',
                ].join(' ')}
                title={preset.prompt}
              >
                <div className="font-medium truncate">{preset.nameZh}</div>
                <div className={`text-[10px] truncate ${selectedId === preset.id ? 'text-white/70' : 'text-text-tertiary'}`}>
                  {preset.name}
                </div>
              </button>
            ))}
          </div>

          <div className="mt-2 pt-2 border-t border-border flex items-center justify-between">
            <span className="text-[10px] text-text-tertiary">
              共 {displayPresets.length} 个预设
              {selectedGirlfriend && (
                <span className="ml-2 text-primary/70">
                  · 已锚定 {selectedGirlfriend.nameZh}
                </span>
              )}
            </span>
            {selectedMaleOption && (
              <span className="text-[10px] text-text-tertiary truncate max-w-[120px]" title={selectedMaleOption.label}>
                · {selectedMaleOption.label}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
