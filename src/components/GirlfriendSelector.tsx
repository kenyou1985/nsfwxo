import React, { useState, useRef, useCallback } from 'react';
import {
  Heart,
  Plus,
  Trash2,
  Upload,
  X,
  Check,
  Star,
  Image,
  ZoomIn,
  Maximize2,
} from 'lucide-react';
import type { GirlfriendPreset } from '../data/girlfriendPresets';
import {
  getCustomGirlfriends,
  saveCustomGirlfriend,
  removeCustomGirlfriend,
  createThumbnail,
  compressImageForStorage,
  toPreset,
  type CustomGirlfriend,
} from '../services/girlfriendStorage';
import { DEFAULT_GIRLFRIEND_PRESETS } from '../data/girlfriendPresets';

interface GirlfriendSelectorProps {
  selectedId: string | null;
  onSelect: (girlfriend: GirlfriendPreset) => void;
  disabled?: boolean;
}

export function GirlfriendSelector({
  selectedId,
  onSelect,
  disabled,
}: GirlfriendSelectorProps) {
  const [activeTab, setActiveTab] = useState<'presets' | 'custom'>('presets');
  const [customGirlfriends, setCustomGirlfriends] = useState<CustomGirlfriend[]>(() =>
    getCustomGirlfriends()
  );
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [previewModal, setPreviewModal] = useState<GirlfriendPreset | null>(null);
  const [saveName, setSaveName] = useState('');
  const [saveNameZh, setSaveNameZh] = useState('');
  const [saveDesc, setSaveDesc] = useState('');
  const [savePrompt, setSavePrompt] = useState('');
  const [saveTags, setSaveTags] = useState('');
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPreview, setUploadingPreview] = useState<string | null>(null);
  const [uploadingError, setUploadingError] = useState('');

  const customPresets: GirlfriendPreset[] = customGirlfriends.map(toPreset);

  /** 将 File 转成 data URL（base64），用于本地持久化存储 */
  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });

  const handleFileUpload = useCallback(async (file: File) => {
    setUploadingError('');
    setSaveError('');
    try {
      const dataUrl = await fileToDataUrl(file);
      setUploadingPreview(dataUrl);
    } catch (err) {
      setUploadingError(err instanceof Error ? err.message : '读取文件失败');
      throw err;
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    handleFileUpload(file);
    setShowSaveModal(true);
    setSaveName('');
    setSaveNameZh('');
    setSaveDesc('');
    setSavePrompt('');
    setSaveTags('');
    setSaveError('');
  };

  const handleSaveGirlfriend = async () => {
    if (!uploadingPreview) {
      setSaveError('请先上传图片');
      return;
    }
    if (!saveName.trim()) {
      setSaveError('请输入名称');
      return;
    }
    setSaveLoading(true);
    try {
      const [thumb, compressed] = await Promise.all([
        createThumbnail(uploadingPreview),
        compressImageForStorage(uploadingPreview),
      ]);
      const result = saveCustomGirlfriend({
        name: saveName.trim(),
        nameZh: saveNameZh.trim() || saveName.trim(),
        description: saveDesc.trim(),
        characterPrompt: savePrompt.trim(),
        tags: saveTags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        imageDataUrl: compressed,
        thumbnailDataUrl: thumb,
        aspectRatio: '9:16',
      });
      if (!result.success || !result.data) {
        setSaveError(result.error || '保存失败');
        return;
      }
      const preset = toPreset(result.data);
      setCustomGirlfriends(getCustomGirlfriends());
      setShowSaveModal(false);
      setUploadingPreview(null);
      onSelect(preset);
      setActiveTab('custom');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteCustom = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeCustomGirlfriend(id);
    setCustomGirlfriends(getCustomGirlfriends());
  };

  const handleCloseModal = () => {
    setShowSaveModal(false);
    setUploadingPreview(null);
    setSaveError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDoubleClick = (gf: GirlfriendPreset) => {
    setPreviewModal(gf);
  };

  const presets = DEFAULT_GIRLFRIEND_PRESETS;

  return (
    <>
      <div className="rounded-xl bg-white border border-border overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg-elevated">
          <div className="flex items-center gap-1.5">
            <Heart size={12} className="text-red-400" />
            <span className="text-xs font-medium text-text-primary">AI 女友</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-text-tertiary">
              {activeTab === 'presets' ? `${presets.length} 预设` : `${customPresets.length} 自定义`}
            </span>
            <label className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium cursor-pointer transition-all ${disabled ? 'opacity-50 cursor-not-allowed' : 'bg-red-500 text-white hover:bg-red-600 active:scale-95'}`}>
              <Plus size={10} />
              <span>新增</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
                disabled={disabled}
              />
            </label>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          <button
            onClick={() => setActiveTab('presets')}
            className={`flex-1 py-2 text-[10px] font-medium transition-all ${
              activeTab === 'presets'
                ? 'text-red-500 border-b-2 border-red-500 bg-red-50/50'
                : 'text-text-tertiary hover:text-text-primary'
            }`}
          >
            <div className="flex items-center justify-center gap-1">
              <Star size={10} />
              预设
            </div>
          </button>
          <button
            onClick={() => setActiveTab('custom')}
            className={`flex-1 py-2 text-[10px] font-medium transition-all ${
              activeTab === 'custom'
                ? 'text-red-500 border-b-2 border-red-500 bg-red-50/50'
                : 'text-text-tertiary hover:text-text-primary'
            }`}
          >
            <div className="flex items-center justify-center gap-1">
              <Heart size={10} />
              我的 ({customPresets.length})
            </div>
          </button>
        </div>

        {/* Grid — compact circular avatars */}
        <div className="p-3">
          {activeTab === 'presets' && (
            <CompactAvatarGrid
              girlfriends={presets}
              selectedId={selectedId}
              onSelect={onSelect}
              onDoubleClick={handleDoubleClick}
              onDelete={undefined}
              disabled={disabled}
            />
          )}
          {activeTab === 'custom' && (
            <>
              {customPresets.length === 0 ? (
                <div className="text-center py-6">
                  <Heart size={20} className="mx-auto text-text-tertiary/20 mb-1.5" />
                  <p className="text-[10px] text-text-tertiary">暂无自定义女友</p>
                  <p className="text-[9px] text-text-tertiary/60 mt-0.5">点击「+ 新增」上传图片</p>
                </div>
              ) : (
                <CompactAvatarGrid
                  girlfriends={customPresets}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  onDoubleClick={handleDoubleClick}
                  onDelete={(id, e) => handleDeleteCustom(id.replace('custom_', ''), e)}
                  disabled={disabled}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Save Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleCloseModal} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden animate-slide-in-bottom">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-elevated">
              <div className="flex items-center gap-2">
                <Heart size={13} className="text-red-400" />
                <span className="text-sm font-semibold text-text-primary">保存新女友</span>
              </div>
              <button
                onClick={handleCloseModal}
                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-bg-hover transition-colors"
              >
                <X size={15} className="text-text-tertiary" />
              </button>
            </div>

            <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
              {/* Preview */}
              {uploadingPreview ? (
                <div
                  className="relative rounded-xl overflow-hidden bg-bg-elevated border border-border cursor-pointer hover:border-red-400 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <img
                    src={uploadingPreview}
                    alt="预览"
                    className="w-full object-cover"
                    style={{ aspectRatio: '9/16', maxHeight: 220 }}
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-green-500 text-white text-[10px] font-medium">
                    已就绪
                  </div>
                </div>
              ) : (
                <div
                  className={`rounded-xl border-2 border-dashed flex items-center justify-center cursor-pointer transition-colors ${
                    uploadingError ? 'border-red-300 bg-red-50' : 'border-border hover:border-red-400'
                  }`}
                  style={{ aspectRatio: '9/16', maxHeight: 220 }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <div className="text-center">
                    <Upload size={22} className="mx-auto text-text-tertiary/40 mb-1" />
                    <p className="text-xs text-text-tertiary">点击上传图片</p>
                  </div>
                </div>
              )}
              {uploadingError && <p className="text-xs text-red-500">{uploadingError}</p>}

              <div className="space-y-2.5">
                <div>
                  <label className="text-[10px] text-text-secondary mb-1 block">名称（英文）</label>
                  <input
                    type="text"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    placeholder="Luna"
                    className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-primary transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-text-secondary mb-1 block">名称（中文）</label>
                  <input
                    type="text"
                    value={saveNameZh}
                    onChange={(e) => setSaveNameZh(e.target.value)}
                    placeholder="露娜"
                    className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-primary transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-text-secondary mb-1 block">描述</label>
                  <input
                    type="text"
                    value={saveDesc}
                    onChange={(e) => setSaveDesc(e.target.value)}
                    placeholder="温柔可爱的邻家女孩"
                    className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-primary transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-text-secondary mb-1 block">角色提示词</label>
                  <textarea
                    value={savePrompt}
                    onChange={(e) => setSavePrompt(e.target.value)}
                    placeholder="描述这个角色的特征..."
                    rows={2}
                    className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-primary transition-colors resize-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-text-secondary mb-1 block">标签（逗号分隔）</label>
                  <input
                    type="text"
                    value={saveTags}
                    onChange={(e) => setSaveTags(e.target.value)}
                    placeholder="粉色头发, 可爱, 温柔"
                    className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-primary transition-colors"
                  />
                </div>
              </div>

              {saveError && <p className="text-xs text-red-500">{saveError}</p>}
            </div>

            <div className="px-4 pb-4 flex gap-2">
              <button
                onClick={handleCloseModal}
                className="flex-1 py-2 rounded-xl text-xs font-medium bg-bg-elevated text-text-tertiary hover:bg-bg-hover transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSaveGirlfriend}
                disabled={saveLoading || !uploadingPreview}
                className={`flex-1 py-2 rounded-xl text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                  saveLoading || !uploadingPreview
                    ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                    : 'bg-gradient-to-r from-red-500 to-pink-500 text-white hover:opacity-90 active:scale-[0.98]'
                }`}
              >
                {saveLoading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    保存中...
                  </>
                ) : (
                  <>
                    <Heart size={12} />
                    保存女友
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Large Preview Modal */}
      {previewModal && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center p-6 animate-fade-in"
          onClick={() => setPreviewModal(null)}
        >
          <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" />
          <div className="relative flex flex-col items-center max-w-sm w-full animate-slide-in-bottom">
            <button
              onClick={() => setPreviewModal(null)}
              className="absolute -top-10 right-0 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
            >
              <X size={16} className="text-white" />
            </button>
            <div className="relative rounded-2xl overflow-hidden shadow-2xl w-full" style={{ aspectRatio: '9/16' }}>
              <img
                src={previewModal.portraitUrl}
                alt={previewModal.name}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="mt-3 text-center">
              <p className="text-sm font-semibold text-white">
                {previewModal.nameZh || previewModal.name}
              </p>
              {previewModal.description && (
                <p className="text-[10px] text-white/60 mt-0.5">{previewModal.description}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Compact Avatar Grid ───────────────────────────────────────────────────────

interface CompactAvatarGridProps {
  girlfriends: GirlfriendPreset[];
  selectedId: string | null;
  onSelect: (gf: GirlfriendPreset) => void;
  onDoubleClick: (gf: GirlfriendPreset) => void;
  onDelete?: (id: string, e: React.MouseEvent) => void;
  disabled?: boolean;
}

function CompactAvatarGrid({
  girlfriends,
  selectedId,
  onSelect,
  onDoubleClick,
  onDelete,
  disabled,
}: CompactAvatarGridProps) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {girlfriends.map((gf) => (
        <AvatarBubble
          key={gf.id}
          girlfriend={gf}
          isSelected={selectedId === gf.id}
          onSelect={onSelect}
          onDoubleClick={onDoubleClick}
          onDelete={onDelete}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

// ─── Avatar Bubble ───────────────────────────────────────────────────────────

interface AvatarBubbleProps {
  girlfriend: GirlfriendPreset;
  isSelected: boolean;
  onSelect: (gf: GirlfriendPreset) => void;
  onDoubleClick: (gf: GirlfriendPreset) => void;
  onDelete?: (id: string, e: React.MouseEvent) => void;
  disabled?: boolean;
}

function AvatarBubble({
  girlfriend,
  isSelected,
  onSelect,
  onDoubleClick,
  onDelete,
  disabled,
}: AvatarBubbleProps) {
  const [imgError, setImgError] = useState(false);

  const handleClick = () => {
    if (!disabled) onSelect(girlfriend);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!disabled) onDoubleClick(girlfriend);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(girlfriend.id, e);
  };

  return (
    <div className="flex flex-col items-center gap-0.5 group">
      {/* Avatar Circle */}
      <div
        className={`relative cursor-pointer transition-all ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        title={`${girlfriend.nameZh || girlfriend.name} — 双击预览`}
      >
        {/* Ring */}
        <div
          className={`rounded-full p-0.5 transition-all ${
            isSelected
              ? 'bg-gradient-to-br from-red-500 to-pink-500 ring-2 ring-red-400 ring-offset-1'
              : 'hover:bg-gradient-to-br hover:from-red-400 hover:to-pink-400'
          }`}
        >
          <div
            className="w-11 h-11 rounded-full overflow-hidden bg-bg-elevated border-2 border-white/20"
          >
            {!imgError ? (
              <img
                src={girlfriend.thumbnailUrl || girlfriend.portraitUrl}
                alt={girlfriend.name}
                className="w-full h-full object-cover"
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-bg-elevated">
                <Image size={16} className="text-text-tertiary/30" />
              </div>
            )}
          </div>
        </div>

        {/* Selected checkmark */}
        {isSelected && (
          <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center border-2 border-white shadow-sm">
            <Check size={9} className="text-white" />
          </div>
        )}

        {/* Delete button */}
        {onDelete && (
          <button
            onClick={handleDelete}
            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-red-600"
          >
            <Trash2 size={8} className="text-white" />
          </button>
        )}

        {/* Custom badge */}
        {girlfriend.isCustom && (
          <div className="absolute -top-0.5 -left-0.5 px-1 py-0.5 rounded-full bg-red-500/90 text-white text-[7px] font-medium">
            我的
          </div>
        )}
      </div>

      {/* Name below */}
      <span className={`text-[9px] font-medium truncate max-w-[52px] text-center ${
        isSelected ? 'text-red-500' : 'text-text-secondary'
      }`}>
        {girlfriend.nameZh || girlfriend.name}
      </span>
    </div>
  );
}
