import React, { useState, useMemo } from 'react';
import { User, Search, Lock } from 'lucide-react';
import { IMAGE_POSE_PRESETS, VIDEO_POSE_PRESETS, type ImagePosePreset, type VideoPosePreset } from '../data/presetPoses';
import type { GirlfriendPreset } from '../data/girlfriendPresets';

interface PosePresetSelectorProps {
  type: 'image' | 'video';
  onSelect: (prompt: string, name: string) => void;
  disabled?: boolean;
  selectedGirlfriend?: GirlfriendPreset | null;
  /** 多数字人锚定场景：传入全部已锚定的女友 */
  selectedGirlfriends?: GirlfriendPreset[];
  forceUnlock?: boolean;
}

function buildIdentityPrefix(gf: GirlfriendPreset | null | undefined, gfs?: GirlfriendPreset[]): string {
  // 多数字人：把每个女友的身份锚点串起来
  if (gfs && gfs.length > 0) {
    return gfs
      .map(
        (g) =>
          `Strictly preserve the exact identity, character, and features of ${g.nameZh} (ID:${g.id.toUpperCase()}); do not alter the character at all. `
      )
      .join('');
  }
  // No male character prefix - use pose presets as-is
  // Only add girlfriend identity anchor if one is selected
  if (!gf) return '';
  return `Strictly preserve the exact identity, character, and features of ${gf.nameZh} (ID:${gf.id.toUpperCase()}); do not alter the character at all. `;
}

export function PosePresetSelector({ type, onSelect, disabled, selectedGirlfriend = null, selectedGirlfriends, forceUnlock = false }: PosePresetSelectorProps) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);

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
  const isLocked =
    isImageMode &&
    !forceUnlock &&
    !selectedGirlfriend &&
    !(selectedGirlfriends && selectedGirlfriends.length > 0) &&
    !disabled;

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
    const identityPrefix = buildIdentityPrefix(
      selectedGirlfriend,
      selectedGirlfriends && selectedGirlfriends.length > 0 ? selectedGirlfriends : undefined
    );
    const fullPrompt = identityPrefix + preset.prompt;
    onSelect(fullPrompt, preset.nameZh);
  };

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
              {selectedGirlfriends && selectedGirlfriends.length > 1
                ? `${selectedGirlfriends.length} 位`
                : selectedGirlfriend.nameZh}
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-text-tertiary transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

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
                  · 已锚定{' '}
                  {selectedGirlfriends && selectedGirlfriends.length > 1
                    ? selectedGirlfriends.map((g) => g.nameZh).join('、')
                    : selectedGirlfriend.nameZh}
                </span>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
