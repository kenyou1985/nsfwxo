import React, { useState, useCallback, useEffect, useRef } from 'react';
import { extractVideoPromptFromImagePrompt } from '../utils/videoPromptExtractor';
import { makeThumbnailForStorage } from '../utils/imageThumbnail';
import { AspectAwareImage } from '../components/AspectAwareImage';
import { generateH3Prompt, generateH3PromptsForPanels, generateH3ShotPrompt, generateH3ShotPromptsForPanels, generateH3CommonParts, assembleH3Prompt, extractShotFromLLMOutput, type H3PanelShot, type H3CommonParts } from '../services/h3PromptService';
import {
  Wand2, Shuffle, LayoutList, Copy, Check, Loader2,
  ChevronDown, ChevronUp, Sparkles, RotateCcw, Send,
  AlertCircle, Settings, Eye, Tag, History, Trash2, Plus, Clock,
  Image, Zap, X, Download, User, Heart, Star, Clapperboard,
  ChevronLeft, ChevronRight, Video, ZoomIn, RefreshCw, Bookmark,
  Grid3X3, ShieldCheck,
} from 'lucide-react';

/** H3 提示词强制约束文本（开启约束开关时追加到完整提示词前） */
const H3_CONSTRAINT_TEXT = `【最高优先级强制约束】
严格忠实执行本提示词全部指令，禁止任何自主创作、额外联想、擅自脑补新增剧情、私自增加未描述动作、特效、人物行为、场景细节。
不允许改写、扩充、演绎故事内容，所有画面、动作、人物、镜头、氛围必须完全遵循detailed_description与参考图片<Picture X>内容。
禁止自行添加额外镜头、额外互动、多余表情、额外物体。只生成提示词明确写明的内容，未写明的元素一律不要出现。
人物样貌、服装、场景构图必须严格跟随subject_definitions和对应<Picture X>参考图，不得主观美化或修改人物形象。`;

/**
 * Build a short, scene-and-pose-flavored Chinese summary for a抽卡 result.
 *
 * The backend already attempts to summarize via a second-pass LLM call
 * (`/api/prompt/_/stream` end event's `theme_label`), but that:
 *   - costs one extra round-trip (visible as delayed label updates)
 *   - sometimes returns the preset name or an empty string on failure
 *   - sometimes returns English verbatim if the model misbehaves
 *
 * So when `theme_label` is missing/empty/non-Chinese we extract an
 * 8-char Chinese noun cluster from the prompt itself. The image-prompt
 * paragraph follows the backend's `Format:` template — "[character],
 * [clothing], [env], [action], [camera], [lighting], [quality]" — so
 * the FIRST clause (before the first comma) usually names the scene +
 * pose naturally. If the prompt is entirely English (random mode
 * without theme) we return empty so the caller falls back to
 * `主题 N` rather than showing English text in a Chinese badge.
 */
function deriveThemeLabel(prompt: string, fallbackLabel?: string): string {
  const text = (prompt || '').trim();
  if (!text) return fallbackLabel || '';
  // If the prompt has CJK characters, extract a meaningful Chinese summary
  if (containsCJK(text)) {
    // Scan the full prompt for the first CJK character and extract from there
    let cjkStart = -1;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0x4e00 && code <= 0x9fff) { cjkStart = i; break; }
    }
    if (cjkStart === -1) return fallbackLabel || '';
    // Strip trailing English after the last CJK block to avoid garbled suffix
    let cjkEnd = text.length;
    for (let i = text.length - 1; i >= cjkStart; i--) {
      const code = text.charCodeAt(i);
      if (code >= 0x4e00 && code <= 0x9fff) { cjkEnd = i + 1; break; }
    }
    let cleaned = text.slice(cjkStart, cjkEnd).trim();
    if (!cleaned) return fallbackLabel || '';
    // Cap to a visually-reasonable width in the badge
    const MAX = 24;
    if (cleaned.length <= MAX) return cleaned;
    // Try to cut at a word-ish boundary
    const sliced = cleaned.slice(0, MAX);
    const lastSpace = sliced.lastIndexOf(' ');
    return (lastSpace > MAX * 0.6 ? sliced.slice(0, lastSpace) : sliced) + '…';
  }
  // For English-only prompts, try to extract meaningful keywords
  // Look for scene/setting/pose keywords in the prompt
  const sceneKeywords = [
    'bedroom', 'bathroom', 'kitchen', 'outdoor', 'beach', 'pool', 'office',
    'hospital', 'school', 'hotel', 'studio', 'forest', 'garden', 'car', 'street',
    'night', 'day', 'sunset', 'dawn', 'morning', 'evening',
    'indoor', 'outdoor', 'public', 'private', 'romantic', 'sensual', 'intimate'
  ];
  const poseKeywords = [
    'lying', 'standing', 'sitting', 'kneeling', 'on', 'with', 'holding',
    'embracing', 'kissing', 'touching', 'looking', 'smiling', 'laughing',
    'dancing', 'sleeping', 'bathing', 'dressing', 'undressing', 'working'
  ];
  
  const words = text.split(/\s+/).slice(0, 30); // First 30 words to analyze
  const found = new Set<string>();
  
  for (const word of words) {
    const lower = word.toLowerCase().replace(/[^a-z]/g, '');
    for (const kw of sceneKeywords) {
      if (lower.includes(kw) && !found.has(kw)) {
        found.add(kw.charAt(0).toUpperCase() + kw.slice(1));
        break;
      }
    }
    for (const kw of poseKeywords) {
      if (lower.includes(kw) && !found.has(kw)) {
        found.add(kw.charAt(0).toUpperCase() + kw.slice(1));
        break;
      }
    }
    if (found.size >= 2) break;
  }
  
  if (found.size > 0) {
    const summary = Array.from(found).slice(0, 2).join(' ');
    if (summary.length <= 24) return summary;
    return summary.slice(0, 22) + '…';
  }
  
  // Last resort: use first meaningful words from prompt
  const firstWords = text.split(/[,\.]/).filter(s => s.trim().length > 3).slice(0, 2);
  if (firstWords.length > 0) {
    const summary = firstWords[0].trim().split(/\s+/).slice(0, 4).join(' ');
    if (summary.length <= 24) return summary.charAt(0).toUpperCase() + summary.slice(1);
  }
  
  return fallbackLabel || '';
}

/** True if the string contains at least one CJK Unified Ideograph. */
function containsCJK(text: string): boolean {
  if (!text) return false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x4e00 && code <= 0x9fff) return true;
  }
  return false;
}

/**
 * Render a human-friendly Chinese elapsed-time string for the "已等待
 * X" label next to the in-flight outline card. The shape is fixed-width
 * enough that the badge doesn't reflow every second.
 */
function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec} 秒`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes < 60) return `${minutes} 分${seconds.toString().padStart(2, '0')} 秒`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return `${hours} 时${remMin.toString().padStart(2, '0')} 分`;
}

/**
 * 生成 H3 视频提示词的中文总结。
 * 从 H3 六段式提示词中提取关键信息，用中文简洁描述。
 */
function generateH3Summary(h3Prompt: string): string {
  if (!h3Prompt) return '';
  const text = h3Prompt.trim();

  // 尝试提取各段信息
  const segments = text.split(/\n|\r|(?:<\/s>)|(?:<[^>]+>)/i).filter(s => s.trim());

  // 中英关键词映射表
  const keywordMap: Record<string, string> = {
    // 动作
    'turning': '转身', 'looking': '凝视', 'walking': '行走', 'breathing': '呼吸', 'blinking': '眨眼',
    'smiling': '微笑', 'laughing': '大笑', 'swaying': '摇摆', 'stretching': '伸展', 'moving': '移动',
    'shifting': '变换', 'gentle': '轻柔', 'slow': '缓慢', 'subtle': '微妙', 'leaning': '倾斜',
    'dancing': '舞动', 'embracing': '拥抱', 'caressing': '抚摸', 'whispering': '低语', 'gazing': '注视',
    'rotating': '旋转', 'panning': '摇镜', 'tracking': '追踪',
    'wide': '全景', 'medium': '中景', 'shot': '镜头',
    // 镜头
    'close-up': '特写', 'close up': '特写', 'half-body': '半身', 'full-body': '全身',
    'wide shot': '全景', 'medium shot': '中景', 'extreme close-up': '大特写',
    'cinematic': '电影感', 'portrait': '人像', 'dolly': '推拉', 'steady cam': '稳定器',
    'POV': '主观视角', 'over-the-shoulder': '过肩', "bird's-eye": '鸟瞰', 'birds-eye': '鸟瞰',
    // 光影
    'soft': '柔和', 'warm': '暖色', 'cool': '冷色', 'dramatic': '戏剧', 'volumetric': '体积光',
    'neon': '霓虹', 'natural': '自然', 'backlight': '逆光', 'rim light': '轮廓光',
    'side light': '侧光', 'golden hour': '黄金时刻', 'blue hour': '蓝调时刻', 'dim': '昏暗',
    // 质量
    'photorealistic': '写实', 'anime': '动漫', '8k': '高清', 'hyperrealistic': '超写实',
    // 场景/动作
    'indoor': '室内', 'outdoor': '户外', 'bedroom': '卧室', 'bathroom': '浴室',
    'beach': '海滩', 'forest': '森林', 'studio': '影棚', 'garden': '花园', 'pool': '泳池',
    'sunlight': '阳光', 'moonlight': '月光', 'night': '夜景', 'sunset': '日落', 'dawn': '黎明',
    'intimate': '亲密', 'sensual': '感性', 'romantic': '浪漫', 'elegant': '优雅',
  };

  const parts: string[] = [];
  const addedPhrases = new Set<string>();

  const addPart = (phrase: string) => {
    if (phrase && !addedPhrases.has(phrase) && phrase.length < 30) {
      parts.push(phrase);
      addedPhrases.add(phrase);
    }
  };

  // 提取动作描述
  for (const seg of segments) {
    const lower = seg.toLowerCase();
    for (const [eng, chn] of Object.entries(keywordMap)) {
      if (lower.includes(eng.toLowerCase())) {
        if (['turning', 'looking', 'walking', 'breathing', 'blinking', 'smiling', 'laughing',
             'swaying', 'stretching', 'moving', 'shifting', 'gentle', 'slow', 'subtle',
             'leaning', 'dancing', 'embracing', 'caressing', 'whispering', 'gazing', 'rotating'].includes(eng.toLowerCase())) {
          addPart(chn + '动作');
          break;
        }
        if (['close-up', 'close up', 'half-body', 'full-body', 'wide shot', 'medium shot',
             'extreme close-up', 'portrait', 'dolly', 'POV', 'over-the-shoulder', "bird's-eye", 'birds-eye'].includes(eng.toLowerCase())) {
          addPart(chn + '镜头');
          break;
        }
        if (['soft', 'warm', 'cool', 'dramatic', 'backlight', 'rim light', 'side light',
             'golden hour', 'blue hour', 'dim'].includes(eng.toLowerCase())) {
          addPart('光影' + chn);
          break;
        }
        if (['bedroom', 'bathroom', 'beach', 'forest', 'studio', 'garden', 'pool', 'indoor', 'outdoor'].includes(eng.toLowerCase())) {
          addPart('场景' + chn);
          break;
        }
      }
    }
  }

  // 如果提取不到，返回简单描述
  if (parts.length === 0) {
    // 尝试截取前80个字符作为描述
    const preview = text.slice(0, 80).replace(/[.,;:!?]/g, '').trim();
    if (preview.length > 20) {
      return preview.slice(0, 40) + '...';
    }
    return preview || '视频生成中';
  }

  // 去重并限制长度
  const uniqueParts = [...new Set(parts)].slice(0, 3);
  return uniqueParts.join(' · ');
}
import {
  expandPrompt,
  expandVideoFromImage,
  randomPrompt,
  streamRandomPrompt,
  streamExpandPrompt,
  generateStoryboard,
  generateStoryboardThemes,
  generateStoryboardOutline,
  generateVideoScript,
  listStoryboardThemes,
  pollPromptTask,
  getPromptTaskStatus,
  type PromptTaskStatus,
  PromptResult,
} from '../services/promptApi';
import {
  getYunwuKey,
  getExpandHistory, addExpandHistory, removeExpandHistory, clearExpandHistory,
  getRandomHistory, addRandomHistory, removeRandomHistory, clearRandomHistory,
  getStoryboardHistory, addStoryboardHistory, removeStoryboardHistory, clearStoryboardHistory,
  updateStoryboardHistoryImages,
  getExpandSession, saveExpandSession, clearExpandSession,
  getRandomSession, saveRandomSession, clearRandomSession,
  getStoryboardSession, saveStoryboardSession, clearStoryboardSession,
  cacheStoryboardPanelImages, getAllCachedPanelImages,
  addFavorite, removeFavorite, getFavorites, clearFavorites, isFavorited,
  type ExpandHistoryItem, type RandomHistoryItem, type StoryboardHistoryItem, type FavoriteItem,
  resolvePanelImages,
} from '../services/storage';
import { loadCachedOrExtractPanelImages, getCachedImages, getCachedStoryboardPanelImages, storeImage } from '../services/imageCacheService';
import { extractImagesFromZipAsDataUrls } from '../services/runninghub';
import { useFinishedTaskImages } from '../contexts/FinishedTaskImagesContext';
import { MAX_TASKS, type TaskManagerReturn } from '../hooks/useTaskManager';
import type { GirlfriendPreset } from '../data/girlfriendPresets';
import { GirlfriendSelector } from '../components/GirlfriendSelector';
import { StoryboardSection } from '../components/StoryboardSection';
import { GridStoryboardMode } from '../components/GridStoryboardMode';
import { buildTxt2ImgNodeList } from '../utils/txt2imgNodeBuilder';
import type { QueuedTask, TabType, NodeInfo } from '../types';
import { withQualityBoost, sanitizePromptForClip } from '../constants';
import { WORKFLOW, getWorkflowFormat, uploadImage, ensureDataUrl } from '../services/runninghub';
import { buildUnifiedTxt2ImgOptions } from '../utils/txt2imgDefaults';

/**
 * 将 GirlfriendPreset.portraitUrl 转为 File 对象用于上传。
 * fetch 支持 data: / blob: / http: 等各类 URL 类型。
 */
async function gfUrlToFile(portraitUrl: string, id: string): Promise<File> {
  const res = await fetch(portraitUrl);
  const blob = await res.blob();
  return new File([blob], `${id}.jpg`, { type: blob.type || 'image/jpeg' });
}

/**
 * 构建图生图节点列表（新的工作流 2083569010550423553）
 */
function buildImg2ImgNodeList(params: {
  prompt: string;
  imagePath: string;
  aspectRatio: 'portrait' | 'landscape';
  count?: number;
}): NodeInfo[] {
  const widthRatio = params.aspectRatio === 'portrait' ? '9' : '16';
  const heightRatio = params.aspectRatio === 'portrait' ? '16' : '9';
  return [
    { nodeId: '291', fieldName: 'prompt', fieldValue: params.prompt, description: 'prompt' },
    { nodeId: '172', fieldName: 'value', fieldValue: widthRatio, description: 'width' },
    { nodeId: '173', fieldName: 'value', fieldValue: heightRatio, description: 'height' },
    { nodeId: '269', fieldName: 'value', fieldValue: String(params.count ?? 2), description: 'count' },
    { nodeId: '104', fieldName: 'image', fieldValue: params.imagePath, description: 'image' },
    { nodeId: '273', fieldName: 'value', fieldValue: 'false', description: 'enhance' },
  ];
}

type PromptMode = 'expand' | 'random' | 'storyboard';

interface AIPromptPageProps {
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  onOpenSettings?: () => void;
  taskManager: TaskManagerReturn;
  apiKey: string;
  onNavigate?: (tab: TabType) => void;
}

export function AIPromptPage({ onError, onSuccess, onOpenSettings, taskManager, apiKey, onNavigate }: AIPromptPageProps) {
  const [activeMode, setActiveMode] = useState<PromptMode>('expand');
  const [loading, setLoading] = useState(false);
  const [yunwuConfigured] = useState(() => !!getYunwuKey());
  const [r18Mode, setR18Mode] = useState(false);
  const [digitalHumanMode, setDigitalHumanMode] = useState(false);
  const [selectedGirlfriend, setSelectedGirlfriend] = useState<GirlfriendPreset | null>(null);
  // Aspect ratio for img2img: 'portrait' (9:16) or 'landscape' (16:9)
  const [img2imgAspectRatio, setImg2imgAspectRatio] = useState<'portrait' | 'landscape'>('portrait');

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Mode Tabs */}
      <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
        <div className="flex">
          <ModeTab label="智能扩写" icon={<Wand2 size={14} />} active={activeMode === 'expand'} onClick={() => setActiveMode('expand')} />
          <ModeTab label="随机抽卡" icon={<Shuffle size={14} />} active={activeMode === 'random'} onClick={() => setActiveMode('random')} />
          <ModeTab label="剧情分镜" icon={<LayoutList size={14} />} active={activeMode === 'storyboard'} onClick={() => setActiveMode('storyboard')} />
        </div>
      </div>

      {/* Yunwu Key not configured warning */}
      {!yunwuConfigured && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3">
          <AlertCircle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800">请先配置 OpenLux API Key</p>
            <p className="text-xs text-amber-600 mt-0.5">AI 提示词功能需要 OpenLux API Key 才能使用，请在右上角设置中填入。</p>
          </div>
          {onOpenSettings && (
            <button onClick={onOpenSettings} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-medium hover:bg-amber-600 transition-colors flex-shrink-0">
              <Settings size={12} />去设置
            </button>
          )}
        </div>
      )}

      {/* R18 Toggle */}
      <div className="rounded-2xl bg-white border border-border shadow-card px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Eye size={15} className={r18Mode ? 'text-red-500' : 'text-text-tertiary'} />
            <div>
              <span className="text-sm font-medium text-text-primary">R18 模式</span>
              <p className="text-xs text-text-tertiary -mt-0.5">{r18Mode ? '已启用：将优先抽取 NSFW 标签，生成成人内容提示词' : '关闭：生成普通风格提示词'}</p>
            </div>
          </div>
          <button
            onClick={() => setR18Mode(!r18Mode)}
            className={`relative w-12 h-6 rounded-full transition-all duration-300 flex-shrink-0 ${r18Mode ? 'bg-red-500' : 'bg-gray-300'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all duration-300 ${r18Mode ? 'left-[26px]' : 'left-0.5'}`} />
          </button>
        </div>
      </div>

      {/* 数字人锚定开关 - 放在顶部显眼位置 */}
      <div className={`rounded-2xl border shadow-card overflow-hidden transition-colors ${digitalHumanMode ? 'bg-red-50/40 border-red-300' : 'bg-white border-border'}`}>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${digitalHumanMode ? 'bg-red-500' : 'bg-bg-elevated border border-border'}`}>
              <User size={16} className={digitalHumanMode ? 'text-white' : 'text-text-tertiary'} />
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">数字人锚定</p>
              <p className="text-[11px] text-text-tertiary">{digitalHumanMode ? '已启用：锚定 AI 女友角色生成提示词' : '关闭：不锚定角色身份，生图使用文生图'}</p>
            </div>
          </div>
          <button
            onClick={() => { setDigitalHumanMode(!digitalHumanMode); if (digitalHumanMode) setSelectedGirlfriend(null); }}
            className={`relative w-12 h-6 rounded-full transition-all duration-300 flex-shrink-0 ${digitalHumanMode ? 'bg-red-500' : 'bg-gray-300'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-300 ${digitalHumanMode ? 'left-[26px]' : 'left-0.5'}`} />
          </button>
        </div>
        {digitalHumanMode && (
          <div className="px-4 pb-4">
            {selectedGirlfriend ? (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white border border-border">
                <img
                  src={selectedGirlfriend.thumbnailUrl || selectedGirlfriend.portraitUrl}
                  alt={selectedGirlfriend.nameZh}
                  className="w-11 h-11 rounded-full object-cover border-2 border-red-300"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary">{selectedGirlfriend.nameZh || selectedGirlfriend.name}</p>
                  <p className="text-xs text-text-tertiary">{selectedGirlfriend.description}</p>
                </div>
                <button
                  onClick={() => setSelectedGirlfriend(null)}
                  className="w-8 h-8 rounded-full bg-bg-elevated flex items-center justify-center text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <GirlfriendSelector
                selectedId={null}
                onSelect={(gf) => setSelectedGirlfriend(gf)}
              />
            )}
          </div>
        )}
      </div>

      {activeMode === 'expand' && <ExpandMode onError={onError} onSuccess={onSuccess} loading={loading} setLoading={setLoading} r18Mode={r18Mode} taskManager={taskManager} apiKey={apiKey} digitalHumanMode={digitalHumanMode} selectedGirlfriend={selectedGirlfriend} onNavigate={onNavigate} setDigitalHumanMode={setDigitalHumanMode} setSelectedGirlfriend={setSelectedGirlfriend} img2imgAspectRatio={img2imgAspectRatio} />}
      {activeMode === 'random' && <RandomMode onError={onError} onSuccess={onSuccess} loading={loading} setLoading={setLoading} r18Mode={r18Mode} taskManager={taskManager} apiKey={apiKey} digitalHumanMode={digitalHumanMode} selectedGirlfriend={selectedGirlfriend} onNavigate={onNavigate} setDigitalHumanMode={setDigitalHumanMode} setSelectedGirlfriend={setSelectedGirlfriend} img2imgAspectRatio={img2imgAspectRatio} />}
      {activeMode === 'storyboard' && <StoryboardMode onError={onError} onSuccess={onSuccess} loading={loading} setLoading={setLoading} r18Mode={r18Mode} taskManager={taskManager} apiKey={apiKey} digitalHumanMode={digitalHumanMode} selectedGirlfriend={selectedGirlfriend} onNavigate={onNavigate} setDigitalHumanMode={setDigitalHumanMode} setSelectedGirlfriend={setSelectedGirlfriend} img2imgAspectRatio={img2imgAspectRatio} />}
    </div>
  );
}

function ModeTab({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-all ${active ? 'text-primary bg-primary/5 border-b-2 border-primary' : 'text-text-tertiary hover:text-text-primary hover:bg-bg-hover'}`}>
      {icon}<span>{label}</span>
    </button>
  );
}

// ─── Image Generate Utilities ─────────────────────────────────────────────────

interface GenerateState {
  [resultId: string]: {
    loading: boolean;
    images: string[];
    taskId: string | null;
  };
}

function useGenerateState() {
  return useState<GenerateState>({});
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

// ─── Expand Mode ─────────────────────────────────────────────────────────────

function ExpandMode({ onError, onSuccess, loading, setLoading, r18Mode, taskManager, apiKey, onNavigate, digitalHumanMode, setDigitalHumanMode, selectedGirlfriend, setSelectedGirlfriend, img2imgAspectRatio }: {
  onError: (msg: string) => void; onSuccess: (msg: string) => void; loading: boolean; setLoading: (v: boolean) => void; r18Mode: boolean;
  taskManager: TaskManagerReturn; apiKey: string; onNavigate?: (tab: TabType) => void;
  digitalHumanMode: boolean; setDigitalHumanMode: (v: boolean) => void; selectedGirlfriend: GirlfriendPreset | null; setSelectedGirlfriend: (gf: GirlfriendPreset | null) => void;
  img2imgAspectRatio: 'portrait' | 'landscape';
}) {
  const savedExpand = getExpandSession();
  const [input, setInput] = useState(savedExpand?.input || '');
  const [type, setType] = useState<'image' | 'video'>(savedExpand?.type || 'image');
  const [count, setCount] = useState(savedExpand?.count || 5);
  const [results, setResults] = useState<{ id: string; original: string; prompt: string; r18: boolean }[]>(savedExpand?.results || []);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<ExpandHistoryItem[]>(() => getExpandHistory());
  // Safety net: reload history on mount (covers cases where init state missed localStorage)
  useEffect(() => { setHistory(getExpandHistory()); }, []);
  const [genState, setGenState] = useState<GenerateState>({});
  const [genStates, setGenStates] = useState<Record<string, { loading: boolean; images: string[] }>>({});
  // Initialize sbHistoryId from sessionStorage so a hard refresh of the
  // page can re-hydrate the per-panel images already stored in
  // genStates. Without this, sbHistoryId stays null until the user
  // submits a new task (line ~537), so every panel card looks up
  // genStates[`null_${idx}`] — which is always empty — and shows the
  // broken-image placeholder, even though mount effect has just
  // populated genStates[`${savedHistoryId}_${idx}`] with the right
  // images. The lazy initializer fires once, on first render.
  const [sbHistoryId, setSbHistoryId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return sessionStorage.getItem('sb_latest_history_id');
  });
  const [batchLoading, setBatchLoading] = useState(false);
  const [outputPrompts, setOutputPrompts] = useState<string[]>(savedExpand?.outputPrompts || []);
  const [selectedOutputIdx, setSelectedOutputIdx] = useState(savedExpand?.selectedOutputIdx || 0);
  const [outputText, setOutputText] = useState(savedExpand?.outputText || '');
  const [generatingMain, setGeneratingMain] = useState(false);
  const [girlfriendUploading, setGirlfriendUploading] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteItem[]>(() => getFavorites());

  const handleToggleFavorite = useCallback((imageUrl: string, prompt?: string) => {
    // Use imageRef for lookup since addFavorite stores the URL in imageRef field
    const existing = favorites.find((f) => f.imageRef === imageUrl);
    if (existing) {
      removeFavorite(existing.id);
      setFavorites(getFavorites());
    } else {
      const added = addFavorite({ imageUrl, prompt, source: 'expand', r18: r18Mode });
      if (!added) {
        console.error('[handleToggleFavorite] addFavorite returned false — URL mismatch or duplicate:', imageUrl.slice(0, 80));
      }
      setFavorites(getFavorites());
    }
  }, [favorites, r18Mode]);

  // Persist expand state to sessionStorage so it survives page switches
  useEffect(() => {
    if (input || results.length > 0 || outputText) {
      saveExpandSession({ input, type, count, results, outputPrompts, selectedOutputIdx, outputText });
    } else {
      clearExpandSession();
    }
  }, [input, type, count, results, outputPrompts, selectedOutputIdx, outputText]);

  // Sync restored tasks from taskManager to UI state (survives page refresh)
  useEffect(() => {
    setGenState((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const result of results) {
        const matchedTask = taskManager.tasks.find(
          (t) => t.prompt === result.prompt && (t.status === 'RUNNING' || t.status === 'QUEUEING')
        );
        if (matchedTask && !prev[result.id]) {
          next[result.id] = { loading: true, images: [], taskId: matchedTask.id };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [taskManager.tasks, results]);

  // Refs for callbacks used inside async effects — avoids stale closure issues
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  const resultsRef = useRef(results);
  const outputPromptsRef = useRef(outputPrompts);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { resultsRef.current = results; }, [results]);
  useEffect(() => { outputPromptsRef.current = outputPrompts; }, [outputPrompts]);

  // Track pending expand tasks (streamHandle -> true) for abort on cleanup
  const [pendingExpandHandles, setPendingExpandHandles] = useState<Record<number, boolean>>({});
  // Total slots done (success + fatal error) — used so we can flip
  // loading back to false exactly once, after the LAST slot finishes.
  // `onDone` from the NDJSON stream is the authoritative completion
  // signal; `finally` cannot be used because streamExpandPrompt()
  // resolves immediately (the stream is consumed in a background IIFE)
  // so `finally` would fire BEFORE any chunks arrive, leaving the user
  // staring at a static spinner-less UI while the backend is still
  // working — exactly what the user reported ("点击扩写，没有任何
  // 生成中的状态显示").
  const [pendingExpandCount, setPendingExpandCount] = useState(0);
  const [pendingExpandFailed, setPendingExpandFailed] = useState(0);

  // ── handleGenerate: streaming NDJSON — slots appear instantly, update in real time ──
  const handleGenerate = async () => {
    if (!input.trim()) { onError('请输入描述内容'); return; }

    // ── "生视频" 路径：本地生成 H3 视频提示词（不走后端） ──
    // 用户在「智能扩写」选「生视频」时，需要两步模型调用：
    //   Step 1: expandPrompt → 把用户描述扩写成详细的图片提示词
    //   Step 2: expandVideoFromImage → 把图片提示词转化为视频提示词
    //   Step 3: generateH3Prompt → 格式化成 H3 Ref2VA 六段式
    if (type === 'video') {
      setLoading(true);
      try {
        const baseId = `h3-${Date.now()}`;
        const ids = Array.from({ length: count }, (_, i) => `${baseId}-${i}`);
        // 先用 N 个空槽位让 UI 立即可见
        const seeded: { id: string; original: string; prompt: string; r18: boolean }[] = ids.map((id) => ({
          id, original: input.trim(), prompt: '', r18: r18Mode,
        }));
        setResults(seeded);
        setOutputPrompts(Array(count).fill(''));
        setOutputText('');
        setSelectedOutputIdx(0);

        const themeTitle = r18Mode ? 'R18' : '默认主题';

        // ── 并行生成所有 H3 视频提示词 ──
        // 每个 slot 独立执行：Step1 扩写 → Step2 视频化 → Step3 H3 格式化
        // 完成时渐进式更新 UI（不等待全部完成）
        const total = count;
        let completedCount = 0;
        let firstError: string | null = null;

        const tasks = Array.from({ length: count }, async (_, i) => {
          try {
            // Step 1: 扩写成图片提示词（超时则自动切换 fast 模型兜底）
            let expandRes;
            try {
              expandRes = await expandPrompt(input.trim(), 'image', r18Mode, 1);
            } catch (firstErr) {
              const isTimeout = firstErr instanceof Error &&
                (firstErr.message.includes('超时') || firstErr.message.includes('timeout'));
              if (isTimeout) {
                console.warn(`[智能扩写] expandPrompt 超时，尝试 fast 模型重试`);
                expandRes = await expandPrompt(input.trim(), 'image', r18Mode, 1, 0, undefined, false, undefined, ['grok-4.6', 'grok-4.3']);
              } else {
                throw firstErr;
              }
            }
            const expandedImgPrompt = expandRes.results?.[0]?.prompt?.trim();
            if (!expandedImgPrompt) {
              throw new Error(`第 ${i + 1} 个图片提示词扩写返回为空`);
            }

            // Step 2: 图片提示词 → 视频提示词（超时则自动切换 fast 模型兜底）
            let videoRes;
            try {
              videoRes = await expandVideoFromImage(expandedImgPrompt, themeTitle, r18Mode, 1);
            } catch (secondErr) {
              const isTimeout = secondErr instanceof Error &&
                (secondErr.message.includes('超时') || secondErr.message.includes('timeout'));
              if (isTimeout) {
                console.warn(`[智能扩写] expandVideoFromImage 超时，尝试 fast 模型重试（150s）`);
                videoRes = await expandVideoFromImage(expandedImgPrompt, themeTitle, r18Mode, 1, ['grok-4.6', 'grok-4.3'], 150000);
              } else {
                throw secondErr;
              }
            }
            const videoPrompt = videoRes.results?.[0]?.prompt?.trim();
            if (!videoPrompt) {
              throw new Error(`第 ${i + 1} 个视频提示词扩写返回为空`);
            }

            // Step 3: 格式化成 H3 六段式
            const h3 = generateH3Prompt({
              imagePrompt: expandedImgPrompt,
              sceneDescription: videoPrompt,
              duration: 15,
              r18: r18Mode,
            });

            return { index: i, id: ids[i], prompt: h3, error: null };
          } catch (err) {
            return {
              index: i,
              id: ids[i],
              prompt: `[错误] ${err instanceof Error ? err.message : '未知错误'}`,
              error: err instanceof Error ? err.message : '未知错误',
            };
          }
        });

        // 并行执行，实时更新 UI
        const settled = await Promise.all(tasks);

        // 排序并更新 UI
        const sorted = settled.sort((a, b) => a.index - b.index);
        const allPrompts = sorted.map((s) => s.prompt);
        const failedCount = sorted.filter((s) => s.error).length;
        const successCount = sorted.filter((s) => !s.error).length;

        // 全量更新（此时所有并行请求均已完成）
        const finalResults = sorted.map((s) => ({
          id: s.id,
          original: input.trim(),
          prompt: s.prompt,
          r18: r18Mode,
        }));
        setResults(finalResults);
        setOutputPrompts(allPrompts);
        if (allPrompts[0] && !allPrompts[0].startsWith('[错误]')) {
          setSelectedOutputIdx(0);
          setOutputText(allPrompts[0]);
        }

        // 持久化到历史记录（只存成功的）
        const successfulPrompts = sorted.filter((s) => !s.error).map((s) => s.prompt);
        if (successfulPrompts.length > 0) {
          addExpandHistory({
            original: input.trim(),
            type,
            r18: r18Mode,
            prompts: successfulPrompts,
          });
          setHistory(getExpandHistory());
        }

        const msg = failedCount > 0
          ? `已生成 ${successCount} 个 H3 视频提示词（${failedCount} 个失败）`
          : `已生成 ${successCount} 个 H3 视频提示词`;
        onSuccess(msg);
      } catch (err) {
        onError(err instanceof Error ? err.message : 'H3 提示词生成失败');
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    setPendingExpandCount(count);
    setPendingExpandFailed(0);

    // Seed N empty slots immediately so the UI renders N outline cards without
    // waiting for any network response — this is what makes the UI feel instant
    // on both desktop and slow mobile connections.
    const initialResults = Array.from({ length: count }).map((_, i) => ({
      id: `pending-${Date.now()}-${i}`,
      original: input.trim(),
      prompt: '',
      r18: r18Mode,
    }));
    setResults(initialResults);
    setOutputPrompts(Array(count).fill(''));
    setOutputText('');
    setSelectedOutputIdx(0);

    // Build a stable handle counter so we can abort on cleanup / new request
    const handleKey = Date.now();
    setPendingExpandHandles((prev) => ({ ...prev, [handleKey]: true }));

    // Suppress the `try/finally` reset — loading state is now driven by
    // `onDone` (or the global-error catch). The catch below still handles
    // synchronous fetch failures (network down, auth error, etc.).
    try {
      await streamExpandPrompt(
        input.trim(),
        type,
        r18Mode,
        count,
        0,
        digitalHumanMode ? selectedGirlfriend?.portraitUrl : undefined,
        digitalHumanMode,
        digitalHumanMode ? selectedGirlfriend?.characterPrompt : undefined,
        {
          onStart: ({ index, original }) => {
            setResults((prev) => {
              const next = [...prev];
              while (next.length <= index) next.push({ id: `pending-${handleKey}-${index}`, original: input.trim(), prompt: '', r18: r18Mode });
              next[index] = { ...next[index], original: original || input.trim() };
              return next;
            });
          },
          onDelta: ({ index, text }) => {
            setResults((prev) => {
              const next = [...prev];
              while (next.length <= index) next.push({ id: `pending-${handleKey}-${index}`, original: input.trim(), prompt: '', r18: r18Mode });
              next[index] = { ...next[index], prompt: (next[index].prompt || '') + text };
              return next;
            });
            // Mirror into outputPrompts so the selected slot is live-updated
            setOutputPrompts((prev) => {
              const next = [...prev];
              while (next.length <= index) next.push('');
              next[index] = (next[index] || '') + text;
              return next;
            });
            // Mirror into outputText for the currently selected slot
            setSelectedOutputIdx((curr) => {
              if (curr === index) {
                setOutputText((t) => (t || '') + text);
              }
              return curr;
            });
          },
          onEnd: ({ index, prompt }) => {
            setResults((prev) => {
              const next = [...prev];
              while (next.length <= index) next.push({ id: `pending-${handleKey}-${index}`, original: input.trim(), prompt: '', r18: r18Mode });
              next[index] = { ...next[index], prompt };
              return next;
            });
            setOutputPrompts((prev) => {
              const next = [...prev];
              while (next.length <= index) next.push('');
              next[index] = prompt;
              return next;
            });
            // Auto-select first completed slot
            if (index === 0) {
              setSelectedOutputIdx(0);
              setOutputText(prompt);
            }
            // Mark one slot as done.
            setPendingExpandCount((c) => {
              const next = c - 1;
              if (next <= 0) {
                setLoading(false);
                setPendingExpandHandles((prev) => { const n = { ...prev }; delete n[handleKey]; return n; });
                // Persist all fully-completed slots to history
                const completed = resultsRef.current
                  .filter((r) => r.prompt && !r.prompt.startsWith('[错误]'))
                  .map((r) => r.prompt);
                if (completed.length > 0) {
                  addExpandHistory({
                    original: input.trim(),
                    type,
                    r18: r18Mode,
                    prompts: completed,
                  });
                  setHistory(getExpandHistory());
                }
                onSuccessRef.current(`成功生成 ${pendingExpandFailed > 0 ? `${completed.length} 个（${pendingExpandFailed} 个失败）` : `${completed.length} 个`}提示词`);
                return 0;
              }
              return next;
            });
          },
          onError: ({ index, message }) => {
            if (index === undefined) {
              // Global error — abort everything immediately.
              onErrorRef.current(message);
              setLoading(false);
              setPendingExpandCount(0);
              setPendingExpandHandles((prev) => { const n = { ...prev }; delete n[handleKey]; return n; });
              return;
            }
            setResults((prev) => {
              const next = [...prev];
              while (next.length <= index) next.push({ id: `pending-${handleKey}-${index}`, original: input.trim(), prompt: '', r18: r18Mode });
              next[index] = {
                ...next[index],
                prompt: next[index].prompt
                  ? `${next[index].prompt}\n\n[错误] ${message}`
                  : `[错误] ${message}`,
              };
              return next;
            });
            setPendingExpandFailed((f) => f + 1);
            setPendingExpandCount((c) => {
              const next = c - 1;
              if (next <= 0) {
                setLoading(false);
                setPendingExpandHandles((prev) => { const n = { ...prev }; delete n[handleKey]; return n; });
                const completed = resultsRef.current
                  .filter((r) => r.prompt && !r.prompt.startsWith('[错误]'))
                  .map((r) => r.prompt);
                if (completed.length > 0) {
                  addExpandHistory({
                    original: input.trim(),
                    type,
                    r18: r18Mode,
                    prompts: completed,
                  });
                  setHistory(getExpandHistory());
                }
                onSuccessRef.current?.(`生成完成，成功 ${completed.length} 个`);
                return 0;
              }
              return next;
            });
          },
          onDone: ({ successful }) => {
            // Fallback completion — fires only if some slots didn't fire onEnd.
            // Real completion path is driven by onEnd/onError counter above.
            setPendingExpandCount((c) => {
              if (c > 0) {
                setLoading(false);
                setPendingExpandHandles((prev) => { const n = { ...prev }; delete n[handleKey]; return n; });
                const completed = resultsRef.current
                  .filter((r) => r.prompt && !r.prompt.startsWith('[错误]'))
                  .map((r) => r.prompt);
                if (completed.length > 0) {
                  addExpandHistory({
                    original: input.trim(),
                    type,
                    r18: r18Mode,
                    prompts: completed,
                  });
                  setHistory(getExpandHistory());
                }
                onSuccessRef.current(`生成完成，成功 ${successful} 个`);
                return 0;
              }
              return c;
            });
          },
        },
      );
    } catch (err) {
      // Synchronous fetch error (network down, auth, etc.) — reset state.
      onError(err instanceof Error ? err.message : '生成失败');
      setLoading(false);
      setPendingExpandHandles((prev) => { const n = { ...prev }; delete n[handleKey]; return n; });
      setPendingExpandCount(0);
    }
  };

  // Abort in-flight expand streams on unmount or new request
  useEffect(() => {
    return () => {
      // All handles auto-abort via AbortController inside streaming.ts on signal.abort
      // Just clear the state here
      setPendingExpandHandles({});
    };
  }, []);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => { setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); });
  };

  const handleDeleteHistory = (id: string) => { removeExpandHistory(id); setHistory(getExpandHistory()); };

  const handleHistoryLoad = (item: ExpandHistoryItem) => {
    setInput(item.original);
    setResults((item.prompts ?? []).map((prompt, i) => ({
      id: `hist-${item.id}-${i}`,
      original: item.original,
      prompt,
      r18: item.r18,
    })));
    const prompts = item.prompts ?? [];
    setOutputPrompts(prompts);
    setSelectedOutputIdx(0);
    setOutputText(prompts[0] || '');
    setShowHistory(false);
  };

  const handleOutputSelect = (idx: number) => {
    setSelectedOutputIdx(idx);
    setOutputText(outputPrompts[idx] || '');
  };

  const handleOutputTextChange = (text: string) => {
    setOutputText(text);
    const newPrompts = [...outputPrompts];
    newPrompts[selectedOutputIdx] = text;
    setOutputPrompts(newPrompts);
    setResults((prev) => prev.map((r, i) => i === selectedOutputIdx ? { ...r, prompt: text } : r));
  };

  const handleMainGenerateImage = useCallback(async () => {
    if (!outputText.trim()) { onError('请先生成或选择一个扩写提示词'); return; }
    if (taskManager.isFull) {
      onError(`任务队列已满（最多 ${MAX_TASKS} 个任务），请等待当前任务完成`);
      return;
    }
    setGeneratingMain(true);
    try {
      let imagePath = selectedGirlfriend?.portraitUrl || '';
      let downloadUrl = '';
      if (digitalHumanMode && selectedGirlfriend) {
        setGirlfriendUploading(true);
        try {
          const file = await gfUrlToFile(selectedGirlfriend.portraitUrl, selectedGirlfriend.id);
          const result = await uploadImage(apiKey, file);
          imagePath = result.imagePath;
          downloadUrl = result.downloadUrl;
        } catch {
          onError('AI 女友图片上传失败，请重试');
          return;
        } finally {
          setGirlfriendUploading(false);
        }
      }
      if (digitalHumanMode && selectedGirlfriend) {
        const nodes = buildImg2ImgNodeList({
          prompt: outputText,
          imagePath: downloadUrl || imagePath,
          aspectRatio: img2imgAspectRatio,
        });
        await taskManager.addTask('img2img', nodes, outputText, WORKFLOW.IMAGE_TO_IMAGE, undefined, undefined, 'expand');
        onSuccess('任务已提交，请到图生图查看生成结果');
        if (onNavigate) onNavigate('img2img');
      } else {
        const nodes = buildTxt2ImgNodeList(buildUnifiedTxt2ImgOptions(outputText));
        await taskManager.addTask('txt2img', nodes, outputText, undefined, undefined, undefined, 'expand');
        onSuccess('任务已提交，请到文生图查看生成结果');
        if (onNavigate) onNavigate('txt2img');
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setGeneratingMain(false);
    }
  }, [outputText, taskManager, onError, onSuccess, digitalHumanMode, selectedGirlfriend, apiKey, onNavigate]);

  const handleExpandGenerateImage = useCallback(async (result: { id: string; prompt: string }) => {
    if (taskManager.isFull) {
      onError(`任务队列已满（最多 ${MAX_TASKS} 个任务），请等待当前任务完成`);
      return;
    }
    setGenState((prev) => ({ ...prev, [result.id]: { loading: true, images: [], taskId: null } }));
    let imagePath = selectedGirlfriend?.portraitUrl || '';
    let downloadUrl = '';
    if (digitalHumanMode && selectedGirlfriend) {
      try {
        const file = await gfUrlToFile(selectedGirlfriend.portraitUrl, selectedGirlfriend.id);
        const uploadResult = await uploadImage(apiKey, file);
        imagePath = uploadResult.imagePath;
        downloadUrl = uploadResult.downloadUrl;
      } catch {
        setGenState((prev) => {
          const next = { ...prev };
          delete next[result.id];
          return next;
        });
        onError('AI 女友图片上传失败，请重试');
        return;
      }
    }
    if (digitalHumanMode && selectedGirlfriend) {
      const nodes = buildImg2ImgNodeList({
        prompt: result.prompt,
        imagePath: downloadUrl || imagePath,
        aspectRatio: img2imgAspectRatio,
      });
      try {
        await taskManager.addTask('img2img', nodes, result.prompt, WORKFLOW.IMAGE_TO_IMAGE, undefined, undefined, 'expand');
        onSuccess('任务已提交，请到图生图查看生成结果');
        if (onNavigate) onNavigate('img2img');
      } catch (err) {
        onError(err instanceof Error ? err.message : '提交失败');
        setGenState((prev) => {
          const next = { ...prev };
          delete next[result.id];
          return next;
        });
      }
    } else {
      const nodes = buildTxt2ImgNodeList(buildUnifiedTxt2ImgOptions(result.prompt));
      try {
        await taskManager.addTask('txt2img', nodes, result.prompt, undefined, undefined, undefined, 'expand');
        onSuccess('任务已提交，请到文生图查看生成结果');
        if (onNavigate) onNavigate('txt2img');
      } catch (err) {
        onError(err instanceof Error ? err.message : '提交失败');
        setGenState((prev) => {
          const next = { ...prev };
          delete next[result.id];
          return next;
        });
      }
    }
  }, [taskManager, onError, onSuccess, digitalHumanMode, selectedGirlfriend, apiKey, onNavigate]);

  const handleBatchGenerate = useCallback(async () => {
    if (results.length === 0) return;
    const availableSlots = MAX_TASKS - taskManager.tasks.length;
    if (availableSlots <= 0) {
      onError('任务队列已满，请等待当前任务完成');
      return;
    }
    setBatchLoading(true);
    let submitted = 0;
    let imagePath = selectedGirlfriend?.portraitUrl || '';
    let downloadUrl = '';
    if (digitalHumanMode && selectedGirlfriend) {
      try {
        const file = await gfUrlToFile(selectedGirlfriend.portraitUrl, selectedGirlfriend.id);
        const uploadResult = await uploadImage(apiKey, file);
        imagePath = uploadResult.imagePath;
        downloadUrl = uploadResult.downloadUrl;
      } catch {
        setBatchLoading(false);
        onError('AI 女友图片上传失败，请重试');
        return;
      }
    }
    const toSubmit = results.slice(0, availableSlots);
    const tasks = toSubmit.map(async (result) => {
      if (digitalHumanMode && selectedGirlfriend) {
        const nodes = buildImg2ImgNodeList({
          prompt: result.prompt,
          imagePath: downloadUrl || imagePath,
          aspectRatio: img2imgAspectRatio,
        });
        await taskManager.addTask('img2img', nodes, result.prompt, WORKFLOW.IMAGE_TO_IMAGE, undefined, undefined, 'expand');
      } else {
        const nodes = buildTxt2ImgNodeList(buildUnifiedTxt2ImgOptions(result.prompt));
        await taskManager.addTask('txt2img', nodes, result.prompt, undefined, undefined, undefined, 'expand');
      }
    });
    const results_await = await Promise.allSettled(tasks);
    submitted = results_await.filter((r) => r.status === 'fulfilled').length;
    results_await.forEach((r, i) => {
      if (r.status === 'rejected') {
        onError(`提交第 ${i + 1} 个时失败: ${r.reason instanceof Error ? r.reason.message : '未知错误'}`);
      }
    });
    setBatchLoading(false);
    if (submitted > 0) {
      onSuccess(`已提交 ${submitted} 个生图任务`);
      if (digitalHumanMode && selectedGirlfriend) {
        if (onNavigate) onNavigate('img2img');
      } else {
        if (onNavigate) onNavigate('txt2img');
      }
    }
  }, [results, taskManager, onError, onSuccess, digitalHumanMode, selectedGirlfriend, apiKey, onNavigate]);

  // Handles single-panel image generation from StoryboardSection (ExpandMode version).
  // Reuses the same logic as handleGenerateStoryboard but for a single panel.
  const handleExpandModeSinglePanelGenerate = useCallback(async (panelIdx: number, prompt: string, context?: { themeTitle?: string; panelNumber?: number }) => {
    console.log(`[handleExpandModeSinglePanelGenerate] panelIdx=${panelIdx}, digitalHumanMode=${digitalHumanMode}, selectedGirlfriend=${!!selectedGirlfriend}, prompt length=${prompt.length}, prompt="${prompt.slice(0, 80)}"`);
    if (!prompt.trim()) {
      onError('分镜内容为空，请先生成分镜');
      return;
    }
    if (taskManager.isFull) { onError('任务队列已满'); return; }

    // Determine or create a historyId for this storyboard
    let hid = sessionStorage.getItem('sb_latest_history_id') || sbHistoryId;
    if (!hid) {
      // Create a minimal history entry so we have a valid historyId
      hid = `expand_${Date.now()}`;
      sessionStorage.setItem('sb_latest_history_id', hid);
      setSbHistoryId(hid);
    }

    const key = `${hid}_${panelIdx}`;
    const storyboardInfo = { historyId: hid, panelIdx };
    setGenStates((prev) => ({ ...prev, [key]: { loading: true, images: [] } }));
    let imagePath = selectedGirlfriend?.portraitUrl || '';
    let downloadUrl = '';
    if (digitalHumanMode && selectedGirlfriend) {
      try {
        const file = await gfUrlToFile(selectedGirlfriend.portraitUrl, selectedGirlfriend.id);
        const uploadResult = await uploadImage(apiKey, file);
        imagePath = uploadResult.imagePath;
        downloadUrl = uploadResult.downloadUrl;
      } catch {
        setGenStates((prev) => { const next = { ...prev }; delete next[key]; return next; });
        onError('AI 女友图片上传失败'); return;
      }
    }
    if (digitalHumanMode && selectedGirlfriend) {
      const charId = (selectedGirlfriend.id as string).toUpperCase().slice(0, 4);
      const anchorPrompt = `【严格锁定】严格锁定图中22岁女性（ID:${charId}），完全保留原有面部特征，五官轮廓、脸型、眼睛、鼻子、嘴唇、发型、肤色、身材比例完全不变，不做任何面部修改，动作流畅不僵硬。超高清8K，写实细节，皮肤质感细腻，无畸变、无模糊、无穿模。`;
      const finalPrompt = `${anchorPrompt}\n\n${prompt}`;
      const nodes = buildImg2ImgNodeList({
        prompt: finalPrompt,
        imagePath: downloadUrl || imagePath,
        aspectRatio: img2imgAspectRatio,
      });
      try {
        await taskManager.addTask('img2img', nodes, finalPrompt, WORKFLOW.IMAGE_TO_IMAGE, undefined, storyboardInfo, 'smart-storyboard', context?.themeTitle, context?.panelNumber);
        onSuccess('分镜图片任务已提交');
      } catch (err) {
        onError(err instanceof Error ? err.message : '提交失败');
        setGenStates((prev) => { const next = { ...prev }; delete next[key]; return next; });
      }
    } else {
      const finalPrompt = withQualityBoost(prompt);
      const nodes = buildTxt2ImgNodeList(buildUnifiedTxt2ImgOptions(finalPrompt));
      try {
        await taskManager.addTask('txt2img', nodes, finalPrompt, undefined, undefined, storyboardInfo, 'smart-storyboard', context?.themeTitle, context?.panelNumber);
        console.log(`[handleExpandModeSinglePanelGenerate] submitted txt2img task, prompt length=${finalPrompt.length}`);
        onSuccess('分镜图片任务已提交');
      } catch (err) {
        onError(err instanceof Error ? err.message : '提交失败');
        setGenStates((prev) => { const next = { ...prev }; delete next[key]; return next; });
      }
    }
  }, [taskManager, onError, onSuccess, digitalHumanMode, selectedGirlfriend, apiKey, sbHistoryId]);

  // Handle direct video generation from storyboard panel in ExpandMode.
  // Reuses the ImageToVideoPage logic by writing to sessionStorage and navigating.
  // Receives the panel's image_prompt + scene_description so the video prompt
  // can target the panel's specific action (rather than the whole storyboard's
  // master image_prompt, which would otherwise be a junk string like "32宫格").
  const handleExpandModeGenerateVideo = useCallback(async (
    panelKey: string,
    imageUrl: string,
    imagePrompt: string,
    sceneDescription: string,
  ) => {
    console.log(`[handleExpandModeGenerateVideo] panelKey=${panelKey}, imageUrl=${imageUrl.slice(0, 50)}, imagePrompt length=${imagePrompt.length}, sceneDescription length=${sceneDescription.length}`);

    // Generate video prompt using BOTH image_prompt and scene_description.
    // The sceneDescription drives the action sequence; imagePrompt drives the
    // visual identity (subject/outfit/environment framing).
    const videoPrompt = extractVideoPromptFromImagePrompt({
      imagePrompt,
      sceneDescription,
      r18Mode,
    });
    console.log(`[handleExpandModeGenerateVideo] videoPrompt="${videoPrompt}"`);

    // Upload image if needed (data URL or blob URL)
    let imagePath = imageUrl;
    if (imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) {
      try {
        const resp = await fetch(imageUrl);
        const blob = await resp.blob();
        const file = new File([blob], `storyboard_${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' });
        const { imagePath: uploadedPath } = await uploadImage(apiKey, file);
        imagePath = uploadedPath;
        console.log(`[handleExpandModeGenerateVideo] uploaded, imagePath=${imagePath}`);
      } catch (err) {
        console.error('[handleExpandModeGenerateVideo] upload failed:', err);
        onError('图片上传失败，请重试');
        return;
      }
    }

    // Safety check
    if (!imagePath || imagePath.length > 300) {
      console.error('[handleExpandModeGenerateVideo] Invalid imagePath:', imagePath?.slice(0, 100));
      onError('图片路径无效，请重新选择图片');
      return;
    }

    // Store in sessionStorage and navigate to ImageToVideoPage (same pattern as existing storyboard_img2vid).
    // imageUrl is down-scaled to a 64×64 JPEG thumbnail — full data: URLs can
    // be 1-2 MB each, and even sessionStorage has a 10 MB cap that fills
    // quickly with multiple panels in a row.
    const thumbnail = await makeThumbnailForStorage(imageUrl);
    const data = JSON.stringify({ imageUrl: thumbnail, imagePath, prompt: videoPrompt });
    try {
      sessionStorage.setItem('storyboard_img2vid_direct', data);
    } catch (storageErr) {
      console.error('[handleExpandModeGenerateVideo] sessionStorage write failed:', storageErr);
      onError('存储空间不足，请清理浏览器数据后重试');
      return;
    }
    onNavigate?.('img2vid');
  }, [apiKey, onError, onNavigate, r18Mode]);

  const handleGenerateStoryboard = useCallback(async (
    panels: { panel_number: number; scene_description: string; image_prompt: string }[],
    sceneName: string,
    themeTitle: string,
    isR18: boolean,
    onSuccessMsg: (msg: string) => void,
    onErrorMsg: (msg: string) => void,
  ) => {
    if (panels.length === 0) { onErrorMsg('没有可生成的分镜'); return; }
    const availableSlots = MAX_TASKS - taskManager.tasks.length;
    if (availableSlots <= 0) { onErrorMsg('任务队列已满'); return; }

    // Use the real theme title as the history plot identifier. The
    // `sceneName` (scene.nameZh like "豪华酒店套房") is the SCENE
    // within the storyboard, while `themeTitle` is the actual theme the
    // user selected or the scene itself for Smart Storyboard. Pass both
    // so the history record is identifiable by its real name.
    const plotLabel = themeTitle || sceneName || '剧情分镜';
    const newHistoryId = addStoryboardHistory({
      plot: plotLabel,
      panel_count: panels.length,
      r18: isR18,
      panels,
    });

    sessionStorage.setItem('sb_latest_history_id', newHistoryId);
    sessionStorage.setItem(`sb_panel_${newHistoryId}_submitted`, JSON.stringify(true));

    let imagePath = selectedGirlfriend?.portraitUrl || '';
    let downloadUrl = '';
    if (digitalHumanMode && selectedGirlfriend) {
      try {
        const file = await gfUrlToFile(selectedGirlfriend.portraitUrl, selectedGirlfriend.id);
        const uploadResult = await uploadImage(apiKey, file);
        imagePath = uploadResult.imagePath;
        downloadUrl = uploadResult.downloadUrl;
      } catch {
        onErrorMsg('AI 女友图片上传失败'); return;
      }
    }

    const toSubmit = panels.slice(0, availableSlots);
    const tasks = toSubmit.map((panel, i) => async () => {
      const panelIdx = i;
      const panelStoryboardInfo = { historyId: newHistoryId, panelIdx };
      const panelNum = panel.panel_number || (i + 1);
      if (digitalHumanMode && selectedGirlfriend) {
        const charId = (selectedGirlfriend.id as string).toUpperCase().slice(0, 4);
        const anchorPrompt = `【严格锁定】严格锁定图中22岁女性（ID:${charId}），完全保留原有面部特征，五官轮廓、脸型、眼睛、鼻子、嘴唇、发型、肤色、身材比例完全不变，不做任何面部修改，动作流畅不僵硬。超高清8K，写实细节，皮肤质感细腻，无畸变、无模糊、无穿模。`;
        const finalPrompt = `${anchorPrompt}\n\n${panel.image_prompt}`;
        const nodes = buildImg2ImgNodeList({
          prompt: finalPrompt,
          imagePath: downloadUrl || imagePath,
          aspectRatio: img2imgAspectRatio,
        });
        await taskManager.addTask('img2img', nodes, finalPrompt, WORKFLOW.IMAGE_TO_IMAGE, undefined, panelStoryboardInfo, 'storyboard', plotLabel, panelNum);
      } else {
        const finalPrompt = withQualityBoost(panel.image_prompt);
        const nodes = buildTxt2ImgNodeList(buildUnifiedTxt2ImgOptions(finalPrompt));
        await taskManager.addTask('txt2img', nodes, finalPrompt, undefined, undefined, panelStoryboardInfo, 'storyboard', plotLabel, panelNum);
      }
    });

    const settled = await Promise.allSettled(tasks.map((t) => t()));
    const submitted = settled.filter((r) => r.status === 'fulfilled').length;
    settled.forEach((r, i) => {
      if (r.status === 'rejected') {
        onErrorMsg(`提交第 ${i + 1} 个时失败: ${r.reason instanceof Error ? r.reason.message : '未知错误'}`);
      }
    });
    if (submitted > 0) {
      onSuccessMsg(`已提交 ${submitted} 个分镜生图任务`);
    }
  }, [taskManager, apiKey, digitalHumanMode, selectedGirlfriend]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white border border-border shadow-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className={r18Mode ? 'text-red-500' : 'text-primary'} />
            <span className="text-sm font-medium text-text-primary">
              输入简单描述
              {r18Mode && <span className="ml-2 text-xs text-red-500 font-medium">(R18)</span>}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowHistory(!showHistory)} className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium transition-all ${showHistory ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'}`}>
              <History size={12} />历史记录
            </button>
            <div className="flex gap-1">
              {(['image', 'video'] as const).map((t) => (
                <button key={t} onClick={() => setType(t)} className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${type === t ? 'bg-primary text-white' : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'}`}>{t === 'image' ? '生图' : '生视频'}</button>
              ))}
            </div>
          </div>
        </div>

        <textarea value={input} onChange={(e) => setInput(e.target.value)}
          placeholder={r18Mode ? '输入你的成人内容想法... 例如: 一个性感的护士...' : `输入你的 ${type === 'image' ? '图片' : '视频'} 想法...`}
          rows={3}
          className={`w-full border rounded-xl px-4 py-3 text-sm placeholder:text-text-secondary focus:outline-none transition-colors resize-none ${r18Mode ? 'bg-red-50/50 border-red-200 focus:border-red-400' : 'bg-bg-elevated border-border focus:border-primary'}`}
        />

        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs text-text-tertiary">生成数量:</span>
          <div className="flex gap-1">
            {[1, 3, 5, 8, 10].map((n) => (
              <button key={n} onClick={() => setCount(n)}
                className={`w-8 h-7 rounded-lg text-xs font-medium transition-all ${count === n ? (r18Mode ? 'bg-red-500 text-white' : 'bg-primary text-white') : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'}`}>{n}</button>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={handleGenerate} disabled={loading || !input.trim()}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all ${loading || !input.trim() ? 'bg-bg-elevated text-text-secondary cursor-not-allowed' : r18Mode ? 'bg-gradient-to-r from-red-500 to-red-600 text-white hover:opacity-90 active:scale-[0.98]' : 'bg-gradient-to-r from-primary to-primary/80 text-white hover:opacity-90 active:scale-[0.98]'}`}>
            {loading ? <><Loader2 size={16} className="animate-spin" /> 生成中...</> : <><Send size={16} />{r18Mode ? '生成 R18 提示词' : '开始生成'}</>}
          </button>
          {results.length > 0 && (
            <button onClick={() => { setInput(''); setResults([]); setOutputPrompts([]); setOutputText(''); setSelectedOutputIdx(0); clearExpandSession(); clearExpandHistory(); setHistory(getExpandHistory()); }}
              className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl font-medium text-sm bg-bg-elevated text-text-tertiary hover:bg-bg-hover transition-colors">
              <RotateCcw size={14} />清空
            </button>
          )}
        </div>
      </div>

      {/* Output Section - Only show when prompts are generated */}
      {outputPrompts.length > 0 && (
        <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
          {/* Output Tabs */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50 bg-bg-elevated overflow-x-auto">
            <span className={`px-2.5 py-0.5 rounded-full text-white text-[11px] font-bold bg-gradient-to-r ${r18Mode ? 'from-red-500 to-pink-500' : 'from-primary to-indigo-500'} flex-shrink-0`}>扩写</span>
            <div className="flex gap-1.5 overflow-x-auto">
              {outputPrompts.map((_, idx) => (
                <button key={idx} onClick={() => handleOutputSelect(idx)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-all flex-shrink-0 ${
                    selectedOutputIdx === idx
                      ? (r18Mode ? 'bg-red-500 text-white' : 'bg-primary text-white')
                      : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'
                  }`}>
                  {idx + 1}
                </button>
              ))}
            </div>
          </div>

          {/* Output Textarea */}
          <div className="p-4">
            <textarea
              value={outputText}
              onChange={(e) => handleOutputTextChange(e.target.value)}
              rows={6}
              className={`w-full border rounded-xl px-4 py-3 text-sm leading-relaxed placeholder:text-text-secondary focus:outline-none transition-colors resize-none font-mono ${r18Mode ? 'bg-red-50/50 border-red-200 focus:border-red-400 text-red-800' : 'bg-bg-elevated border-border focus:border-primary text-text-secondary'}`}
              placeholder="扩写后的提示词将显示在这里..."
            />
            <div className="flex gap-2 mt-3">
              <button onClick={() => navigator.clipboard.writeText(outputText).then(() => { onSuccess('已复制到剪贴板'); setTimeout(() => {}, 2000); })}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium transition-all ${r18Mode ? 'bg-red-50 text-red-500 hover:bg-red-100 border border-red-200' : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'}`}>
                <Copy size={12} />复制提示词
              </button>
              <button onClick={handleMainGenerateImage}
                disabled={generatingMain || !outputText.trim() || girlfriendUploading || (digitalHumanMode && !selectedGirlfriend)}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl font-medium text-sm transition-all ${
                  generatingMain || !outputText.trim() || girlfriendUploading || (digitalHumanMode && !selectedGirlfriend)
                    ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                    : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:opacity-90 active:scale-[0.98]'
                }`}>
                {girlfriendUploading ? <><Loader2 size={14} className="animate-spin" /> 上传参考图中...</> :
                 generatingMain ? <><Loader2 size={14} className="animate-spin" /> 提交中...</> :
                 digitalHumanMode && selectedGirlfriend ? <><Image size={14} />图生图锚定生图</> :
                 <><Image size={14} />基于此提示词生图</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expand History */}
      {showHistory && (
        <ExpandHistoryPanel
          history={history}
          r18Mode={r18Mode}
          onLoad={handleHistoryLoad}
          onDelete={handleDeleteHistory}
          onClear={() => { clearExpandHistory(); setHistory([]); }}
          onCopy={handleCopy}
        />
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          {/* Batch Generate Header */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-text-tertiary font-medium">提示词列表 · {results.length} 个</span>
            <button
              onClick={handleBatchGenerate}
              disabled={batchLoading || taskManager.isFull || (digitalHumanMode && !selectedGirlfriend)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                batchLoading || taskManager.isFull || (digitalHumanMode && !selectedGirlfriend)
                  ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:opacity-90 active:scale-[0.98]'
              }`}
            >
              {batchLoading ? <><Loader2 size={12} className="animate-spin" /> 提交中...</> : <><Zap size={12} />一键批量生图</>}
            </button>
          </div>
          {results.map((result) => (
            <ExpandResultCard
              key={result.id}
              result={result}
              r18Mode={r18Mode}
              isCopied={copiedId === result.id}
              genState={genState[result.id]}
              digitalHumanMode={digitalHumanMode}
              selectedGirlfriend={selectedGirlfriend}
              onCopy={() => handleCopy(result.id, result.prompt)}
              onDelete={() => {
                const idx = results.findIndex((r) => r.id === result.id);
                setResults((p) => p.filter((r) => r.id !== result.id));
                setOutputPrompts((p) => p.filter((_, i) => i !== idx));
                if (results.length === 1) {
                  setOutputText('');
                } else if (selectedOutputIdx >= results.length - 1) {
                  setSelectedOutputIdx(Math.max(0, results.length - 2));
                  setOutputText(outputPrompts[Math.max(0, results.length - 2)] || '');
                }
              }}
              onGenerateImage={() => handleExpandGenerateImage(result)}
              onUseAsOutput={() => {
                const idx = results.findIndex((r) => r.id === result.id);
                setSelectedOutputIdx(idx);
                setOutputText(result.prompt);
              }}
              onFavorited={(url) => handleToggleFavorite(url, result.prompt)}
              taskManager={taskManager}
            />
          ))}
        </div>
      )}

      {/* Smart Storyboard Section */}
      <StoryboardSection
        r18Enabled={r18Mode}
        selectedGirlfriend={selectedGirlfriend}
        displayLang="zh"
        disabled={taskManager.isFull || (digitalHumanMode && !selectedGirlfriend)}
        onGenerateStoryboard={handleGenerateStoryboard}
        onGenerateSingleImage={handleExpandModeSinglePanelGenerate}
        onGenerateVideo={(imageUrl, imagePrompt, sceneDescription, panelKey) =>
          handleExpandModeGenerateVideo(panelKey, imageUrl, imagePrompt, sceneDescription)
        }
        onToggleFavorite={handleToggleFavorite}
        onSuccess={onSuccess}
        onError={onError}
      />
    </div>
  );
}

function ExpandHistoryPanel({ history, r18Mode, onLoad, onDelete, onClear, onCopy }: {
  history: ExpandHistoryItem[];
  r18Mode: boolean;
  onLoad: (h: ExpandHistoryItem) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onCopy: (id: string, text: string) => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const copy = (id: string, text: string) => { onCopy(id, text); setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); };

  return (
    <div className={`rounded-2xl bg-white border shadow-card overflow-hidden ${r18Mode ? 'border-red-200' : 'border-border'}`}>
      <div className={`flex items-center justify-between px-4 py-3 border-b ${r18Mode ? 'border-red-100 bg-red-50/40' : 'border-border/50 bg-bg-elevated'}`}>
        <div className="flex items-center gap-2">
          <History size={14} className={r18Mode ? 'text-red-500' : 'text-text-tertiary'} />
          <span className={`text-sm font-medium ${r18Mode ? 'text-red-600' : 'text-text-primary'}`}>扩写历史</span>
          <span className="px-2 py-0.5 rounded-full text-[11px] bg-bg-elevated text-text-tertiary">{history.length} 条</span>
        </div>
        {history.length > 0 && (
          <button onClick={onClear} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-all">
            <Trash2 size={11} />清空
          </button>
        )}
      </div>
      {history.length === 0 ? (
        <div className="px-4 py-8 text-center"><Clock size={24} className="mx-auto text-text-tertiary/40 mb-2" /><p className="text-sm text-text-tertiary">暂无历史记录</p></div>
      ) : (
        <div className="max-h-[500px] overflow-y-auto divide-y divide-border/50">
          {history.map((h) => (
            <div key={h.id}>
              <div className="flex items-center gap-2 px-4 py-3 hover:bg-bg-hover/30 transition-colors">
                <button onClick={() => onLoad(h)} className="flex-1 flex items-start gap-2 w-full min-w-0 text-left group">
                  <Plus size={13} className="flex-shrink-0 mt-0.5 text-text-tertiary group-hover:text-primary transition-colors" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-text-primary font-medium line-clamp-1">{h.original}</p>
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-bg-elevated text-text-tertiary flex-shrink-0">{(h.prompts ?? []).length} 个提示词</span>
                    </div>
                    <p className="text-[11px] text-text-tertiary mt-0.5">
                      {new Date(h.timestamp).toLocaleString('zh-CN')}
                    </p>
                  </div>
                </button>
                <button onClick={() => setExpandedId(expandedId === h.id ? null : h.id)}
                  className="p-1.5 rounded-lg text-text-tertiary hover:bg-bg-hover transition-all">
                  <span className={`transition-transform ${expandedId === h.id ? 'rotate-180' : ''}`}><ChevronDown size={14} /></span>
                </button>
                <button onClick={() => onDelete(h.id)} className="p-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-all">
                  <Trash2 size={13} />
                </button>
              </div>
              {expandedId === h.id && (
                <div className="px-4 pb-3 space-y-2">
                  {(h.prompts ?? []).map((prompt, pi) => (
                    <div key={pi} className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${r18Mode ? 'bg-red-50/60 text-red-800 border border-red-100' : 'bg-bg-elevated text-text-secondary'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-text-tertiary">{pi + 1}</span>
                        <button onClick={() => copy(`${h.id}-${pi}`, prompt)}
                          className={`flex items-center gap-1 text-[10px] transition-colors ${copiedId === `${h.id}-${pi}` ? 'text-green-500' : 'text-text-tertiary hover:text-primary'}`}>
                          {copiedId === `${h.id}-${pi}` ? <><Check size={10} />已复制</> : <><Copy size={10} />复制</>}
                        </button>
                      </div>
                      <p className="whitespace-pre-wrap">{prompt}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExpandResultCard({ result, r18Mode, isCopied, genState, onCopy, onDelete, onGenerateImage, onUseAsOutput, onFavorited, taskManager, digitalHumanMode, selectedGirlfriend }: {
  result: { id: string; original: string; prompt: string; r18: boolean };
  r18Mode: boolean; isCopied: boolean;
  genState?: { loading: boolean; images: string[]; taskId: string | null };
  onCopy: () => void; onDelete: () => void; onGenerateImage: () => void; onUseAsOutput: () => void;
  onFavorited?: (url: string) => void;
  taskManager: TaskManagerReturn;
  digitalHumanMode?: boolean; selectedGirlfriend?: GirlfriendPreset | null;
}) {
  const badge = r18Mode ? 'from-red-500 to-pink-500' : 'from-primary to-indigo-500';
  const isGenLoading = genState?.loading;
  const genImages = genState?.images ?? [];
  // The card is "generating" while the LLM hasn't produced the final
  // prompt yet (or while an error message is still being written).
  // Without this guard, the card body renders empty during the stream
  // — the user reported "点击扩写，没有任何生成中的状态显示".
  const isPromptLoading = !result.prompt;
  // Tick once per second so the "已等待 X 秒" label re-renders.
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  useEffect(() => {
    if (!isPromptLoading) { setLoadingSeconds(0); return; }
    const t0 = Date.now();
    const id = window.setInterval(() => setLoadingSeconds(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [isPromptLoading, result.prompt]);

  // Find related running tasks
  const relatedTasks = taskManager.tasks.filter(
    (t: QueuedTask) => t.status === 'RUNNING' || t.status === 'QUEUEING' || t.status === 'FINISHED'
  ).filter((t: QueuedTask) => t.prompt === result.prompt);

  const displayImages = genImages.length > 0 ? genImages : relatedTasks.flatMap((t: QueuedTask) => t.images);

  return (
    <div className={`rounded-2xl bg-white border shadow-card overflow-hidden ${r18Mode ? 'border-red-200' : 'border-border'} ${isPromptLoading ? 'ring-1 ring-primary/20' : ''}`}>
      <div className={`flex items-center gap-2 px-4 py-2.5 border-b ${r18Mode ? 'bg-red-50/60 border-red-100' : 'bg-bg-elevated border-border/50'}`}>
        <div className={`px-2.5 py-0.5 rounded-full text-white text-[11px] font-bold bg-gradient-to-r ${badge} flex items-center gap-1`}>
          {isPromptLoading && <Loader2 size={10} className="animate-spin" />}
          {r18Mode ? 'R18' : '提示词'}
        </div>
        {isPromptLoading && (
          <span className="text-[11px] tabular-nums text-text-tertiary/70">
            生成中 · 已等 {loadingSeconds} 秒
          </span>
        )}
        <button onClick={onGenerateImage}
          disabled={isGenLoading || (digitalHumanMode && !selectedGirlfriend)}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex-shrink-0 ml-auto ${
            isGenLoading || (digitalHumanMode && !selectedGirlfriend)
              ? 'bg-blue-100 text-blue-400 cursor-not-allowed'
              : 'bg-blue-500 text-white hover:bg-blue-600'
          }`}
        >
          {isGenLoading ? <Loader2 size={11} className="animate-spin" /> : <Image size={11} />}
          {digitalHumanMode && selectedGirlfriend ? '图生图' : '生图'}
        </button>
        <button onClick={onUseAsOutput}
          disabled={isPromptLoading}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex-shrink-0 ${isPromptLoading ? 'opacity-40 cursor-not-allowed ' : ''}${r18Mode ? 'bg-red-50 text-red-500 hover:bg-red-100 border border-red-200' : 'bg-primary/8 text-primary hover:bg-primary/15 border border-primary/20'}`}
        >
          <Wand2 size={11} />
          应用
        </button>
        <button onClick={onDelete} className="p-1 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-all"><Trash2 size={13} /></button>
      </div>
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3 mb-3">
          {isPromptLoading ? (
            <div className="flex-1 space-y-2">
              <div className={`h-3 rounded w-[90%] animate-pulse ${r18Mode ? 'bg-red-200/70' : 'bg-text-tertiary/15'}`} />
              <div className={`h-3 rounded w-[70%] animate-pulse ${r18Mode ? 'bg-red-200/70' : 'bg-text-tertiary/15'}`} />
              <div className={`h-3 rounded w-[80%] animate-pulse ${r18Mode ? 'bg-red-200/70' : 'bg-text-tertiary/15'}`} />
            </div>
          ) : (
            <p className={`text-sm leading-relaxed whitespace-pre-wrap flex-1 ${r18Mode ? 'text-red-700' : 'text-text-secondary'}`}>{result.prompt}</p>
          )}
          <button onClick={onCopy}
            disabled={isPromptLoading}
            className={`flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${isPromptLoading ? 'opacity-40 cursor-not-allowed ' : ''}${isCopied ? 'bg-green-500/10 text-green-500' : r18Mode ? 'bg-red-50 text-red-500 hover:bg-red-100' : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover hover:text-text-primary'}`}>
            {isCopied ? <><Check size={12} /> 已复制</> : <><Copy size={12} /> 复制</>}
          </button>
        </div>

        {/* Generated images preview */}
        {displayImages.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-text-tertiary font-medium">生成结果</span>
              <span className="text-[10px] text-text-tertiary">{displayImages.length} 张</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {displayImages.slice(0, 6).map((img, idx) => (
                <AIGeneratedImagePreview key={idx} src={img} prompt={result.prompt} onFavorited={onFavorited} allImages={displayImages.slice(0, 6)} index={idx} />
              ))}
              {displayImages.length > 6 && (
                <div className="aspect-square rounded-lg bg-bg-elevated flex items-center justify-center text-xs text-text-tertiary">
                  +{displayImages.length - 6}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Running tasks status */}
        {relatedTasks.filter((t: QueuedTask) => t.status === 'RUNNING' || t.status === 'QUEUEING').length > 0 && displayImages.length === 0 && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <div className="flex items-center gap-2 text-xs text-blue-500">
              <Loader2 size={12} className="animate-spin" />
              正在生成中... {relatedTasks.filter((t: QueuedTask) => t.status === 'RUNNING' || t.status === 'QUEUEING').length} 个任务
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Random Mode ─────────────────────────────────────────────────────────────

function RandomMode({ onError, onSuccess, loading, setLoading, r18Mode, taskManager, apiKey, onNavigate, digitalHumanMode, setDigitalHumanMode, selectedGirlfriend, setSelectedGirlfriend, img2imgAspectRatio }: {
  onError: (msg: string) => void; onSuccess: (msg: string) => void; loading: boolean; setLoading: (v: boolean) => void; r18Mode: boolean;
  taskManager: TaskManagerReturn; apiKey: string; onNavigate?: (tab: TabType) => void;
  digitalHumanMode: boolean; setDigitalHumanMode: (v: boolean) => void; selectedGirlfriend: GirlfriendPreset | null; setSelectedGirlfriend: (gf: GirlfriendPreset | null) => void;
  img2imgAspectRatio: 'portrait' | 'landscape';
}) {
  const savedRandom = getRandomSession();
  const [type, setType] = useState<'image' | 'video'>(savedRandom?.type || 'image');
  const [count, setCount] = useState(savedRandom?.count || 5);
  const [theme, setTheme] = useState(savedRandom?.theme || '');
  const [results, setResults] = useState<PromptResult[]>(savedRandom?.results || []);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(savedRandom?.expandedIdx ?? null);
  const [tagsVisible, setTagsVisible] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<RandomHistoryItem[]>(() => getRandomHistory());
  // Bug fix: h3Prompts is restored from sessionStorage on mount. genStates is NOT
  // persisted (see RandomSession interface), so it starts as {}. Images are recovered
  // from taskManager.tasks via the relatedTasks fallback in PromptResultCard — this
  // is more reliable than trying to persist megabytes of base64 image data.
  const [h3Prompts, setH3Prompts] = useState<Record<number, string>>(() => savedRandom?.h3Prompts || {});
  const [genStates, setGenStates] = useState<Record<number, { loading: boolean; images: string[] }>>({});
  const [batchLoading, setBatchLoading] = useState(false);
  const [h3Loading, setH3Loading] = useState(false);
  const [h3Progress, setH3Progress] = useState<{ current: number; total: number } | null>(null);
  // Track which indices are currently being processed (for parallel loading indicators)
  const [h3ProcessingIndices, setH3ProcessingIndices] = useState<Set<number>>(new Set());
  const [favorites, setFavorites] = useState<FavoriteItem[]>(() => getFavorites());
  // Track selected image index per card (for 长视频 1.1 selection)
  const [selectedImageIndices, setSelectedImageIndices] = useState<Record<number, number>>({});

  // Refs for async callbacks to access latest state
  const h3PromptsRef = useRef<Record<number, string>>(h3Prompts);
  const genStatesRef = useRef<Record<number, { loading: boolean; images: string[] }>>(genStates);
  useEffect(() => { h3PromptsRef.current = h3Prompts; }, [h3Prompts]);
  useEffect(() => { genStatesRef.current = genStates; }, [genStates]);

  // Latest results mirror for use inside async callbacks (the `results` state
  // closure value would be stale by the time the stream finishes).
  const resultsRef = useRef<PromptResult[]>(results);
  useEffect(() => { resultsRef.current = results; }, [results]);
  // Refs for the toast callbacks — same pattern as ExpandMode/StoryboardMode.
  // Needed so async stream events (especially the per-slot stuck-retry path
  // added below) can surface success/error messages without closing over
  // stale props.
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  const handleToggleFavorite = (imageUrl: string, prompt?: string) => {
    // Use imageRef for lookup since addFavorite stores the URL in imageRef field
    const existing = favorites.find((f) => f.imageRef === imageUrl);
    if (existing) {
      removeFavorite(existing.id);
      setFavorites(getFavorites());
    } else {
      addFavorite({ imageUrl, prompt, source: 'random', r18: r18Mode });
      setFavorites(getFavorites());
    }
  };

  // 选中图片用于长视频 1.1
  const handleSelectRandomImage = (cardIdx: number, imageIdx: number, _imageUrl: string) => {
    setSelectedImageIndices((prev) => ({
      ...prev,
      [cardIdx]: imageIdx,
    }));
  };

  // Persist random state to sessionStorage
  // Bug fix: h3Prompts must also be persisted — otherwise generating H3
  // prompts in a session and then switching pages causes H3 prompts to vanish
  // on remount, making "生视频" fall back to extractVideoPromptFromImagePrompt.
  // NOTE: genStates is NOT persisted here because its images field contains
  // base64 data URLs (3-8 MB per session) that would exceed the ~5 MB
  // sessionStorage quota. Images are recovered from taskManager.tasks
  // via the relatedTasks fallback in PromptResultCard on mount, so no data
  // is lost even without persistence.
  useEffect(() => {
    if (results.length > 0 || theme) {
      saveRandomSession({ type, count, theme, results, expandedIdx, h3Prompts });
    } else {
      clearRandomSession();
    }
  }, [type, count, theme, results, expandedIdx, h3Prompts]);

  // Sync restored tasks from taskManager to UI state (survives page refresh)
  // Also sync images from FINISHED tasks so the UI reflects completed results immediately.
  // Bug fix:
  // 1. Prompt comparison now uses .trim() on both sides — the LLM can return prompts
  //    with trailing newlines/whitespace that don't match the stripped prompt stored in
  //    the task object, causing matchedTask to be null and genStates[idx] to stay
  //    permanently stuck at loading:true even after the backend has finished.
  // 2. Added FINISHED case: previously this effect only handled RUNNING/QUEUEING to set
  //    loading:true, but never cleared loading:false when a task finished — so even if
  //    the prompt match were to succeed, the card would stay stuck at "生成中" forever.
  useEffect(() => {
    setGenStates((prev) => {
      let changed = false;
      const next = { ...prev };
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        // Normalize both sides so trailing whitespace / newlines in LLM output don't break the match
        const resultPromptNorm = (result.prompt || '').trim();
        const matchedTask = taskManager.tasks.find(
          (t) => (t.prompt || '').trim() === resultPromptNorm
        );
        if (matchedTask) {
          if (matchedTask.status === 'RUNNING' || matchedTask.status === 'QUEUEING') {
            // Task is still running — show loading state if not already set
            if (!prev[i] || !prev[i].loading) {
              next[i] = { loading: true, images: [] };
              changed = true;
            }
          } else if (matchedTask.status === 'FINISHED' && matchedTask.images && matchedTask.images.length > 0) {
            // Task finished with images — update genState to show the result and clear loading
            const existing = prev[i];
            if (!existing || existing.images.length === 0 || JSON.stringify(existing.images) !== JSON.stringify(matchedTask.images)) {
              next[i] = { loading: false, images: matchedTask.images };
              changed = true;
            }
          }
        }
      }
      return changed ? next : prev;
    });
  }, [taskManager.tasks, results]);

  const THEMES = [
    { key: '', label: '完全随机' },
    { key: '暗示优雅', label: '暗示优雅' },
    { key: '亲密温馨', label: '亲密温馨' },
    { key: '幻想Cos', label: '幻想Cos' },
    { key: '职场诱惑', label: '职场诱惑' },
    { key: '热恋情侣', label: '热恋情侣' },
    { key: '禁忌场景', label: '禁忌场景' },
    { key: '性感睡衣', label: '性感睡衣' },
    { key: '浴室氛围', label: '浴室氛围' },
    { key: '写真艺术', label: '写真艺术' },
    { key: '野外激情', label: '野外激情' },
    { key: '公车痴汉', label: '公车痴汉' },
    { key: '巷子尾随', label: '巷子尾随' },
    { key: '办公室偷情', label: '办公室偷情' },
    { key: 'SM调教', label: 'SM调教' },
    { key: '角色扮演', label: '角色扮演' },
    { key: '制服诱惑', label: '制服诱惑' },
    { key: '浴室缠绵', label: '浴室缠绵' },
    { key: '后入猛烈', label: '后入猛烈' },
    { key: '羞耻play', label: '羞耻play' },
  ];

  const handleGenerate = async () => {
    if (!getYunwuKey()) { onError('请先在设置中配置 OpenLux API Key'); return; }
    setLoading(true);
    setExpandedIdx(null);

    // Seed N placeholder cards so the UI renders an empty shell for every
    // slot immediately, then we stream text into them as NDJSON chunks
    // arrive. This is what eliminates the "stuck at 抽卡中" feeling — the
    // user sees the card slot populate the instant the LLM emits its
    // first text chunk (~0.5-1s after request start), instead of waiting
    // for the slowest of N parallel generations to finish.
    const initialResults: PromptResult[] = Array.from({ length: count }).map(() => ({
      theme_label: '',
      theme: '',
      tags_used: {},
      prompt: '',
    }));
    setResults(initialResults);

    // `streamRandomPrompt` resolves immediately (the stream is consumed
    // in a background IIFE), so `finally { setLoading(false) }` would
    // flip the button back to "抽卡" BEFORE any chunks arrived — leaving
    // the user with no spinner / "生成中" affordance. We must drive
    // `loading` from `onDone` (or the global-error path) instead.
    const completeBatch = () => {
      setLoading(false);
      // 获取最新的视频提示词和图片
      const currentH3Prompts = h3PromptsRef.current;
      const currentGenStates = genStatesRef.current;
      
      addRandomHistory({
        type,
        r18: r18Mode,
        theme,
        // Snapshot only fully-completed slots (have non-empty prompt).
        results: resultsRef.current
          .filter((r) => r.prompt && !r.prompt.startsWith('[错误]'))
          .map((r, idx) => ({
            prompt: r.prompt,
            tags_used: r.tags_used,
            theme_label: r.theme_label,
            // 保存 H3 视频提示词
            h3Prompt: currentH3Prompts[idx] || undefined,
            // 保存生成的图片
            images: currentGenStates[idx]?.images || undefined,
          })),
      });
      setHistory(getRandomHistory());
      const themeName = THEMES.find((t) => t.key === theme)?.label || '完全随机';
      onSuccessRef.current(`[${themeName}] 抽卡完成`);
    };

    try {
      await streamRandomPrompt(
        type, r18Mode, count, theme,
        digitalHumanMode,
        digitalHumanMode ? selectedGirlfriend?.portraitUrl : undefined,
        digitalHumanMode ? selectedGirlfriend?.characterPrompt : undefined,
        {
          onStart: ({ index, theme: presetLabel, tags_used }) => {
            setResults((prev) => {
              const next = [...prev];
              while (next.length <= index) {
                next.push({ theme_label: '', theme: '', tags_used: {}, prompt: '' });
              }
              next[index] = {
                ...next[index],
                theme: presetLabel,
                tags_used: tags_used ?? next[index].tags_used ?? {},
              };
              return next;
            });
          },
          onDelta: ({ index, text }) => {
            setResults((prev) => {
              const next = [...prev];
              while (next.length <= index) {
                next.push({ theme_label: '', theme: '', tags_used: {}, prompt: '' });
              }
              const currentPrompt = (next[index].prompt || '') + text;
              // 实时提取主题名字：当提示词超过50个字符且还没有主题名字时，尝试从提示词中提取
              let newThemeLabel = next[index].theme_label;
              if (!newThemeLabel && currentPrompt.length >= 50) {
                newThemeLabel = deriveThemeLabel(currentPrompt) || '';
              }
              next[index] = {
                ...next[index],
                prompt: currentPrompt,
                theme_label: newThemeLabel || next[index].theme_label,
              };
              return next;
            });
          },
          onEnd: ({ index, theme_label, prompt }) => {
            // When the backend sends an empty `theme_label` (second-pass LLM
            // call failed or returned non-Chinese), derive one locally from
            // the prompt itself. deriveThemeLabel() now scans the entire
            // prompt for the first CJK character (not just the comma-
            // separated English prefix), so it reliably extracts Chinese
            // scene labels even after a long English descriptor block.
            // If THAT also returns empty, fall back to "主题 N" so the
            // badge always has SOME content — never an empty label.
            const backendLabel = (theme_label ?? '').trim();
            const derivedLabel = !backendLabel ? (deriveThemeLabel(prompt) || `主题 ${index + 1}`) : backendLabel;
            setResults((prev) => {
              const next = [...prev];
              while (next.length <= index) {
                next.push({ theme_label: '', theme: '', tags_used: {}, prompt: '' });
              }
              next[index] = {
                ...next[index],
                theme_label: derivedLabel,
                prompt,
              };
              return next;
            });
          },
          onError: ({ index, message }) => {
            // Per-slot errors don't stop the whole batch — show inline
            // on the affected card. Global (no index) errors abort
            // immediately.
            if (index === undefined) {
              onErrorRef.current(message);
              setLoading(false);
              return;
            }
            setResults((prev) => {
              const next = [...prev];
              while (next.length <= index) {
                next.push({ theme_label: '', theme: '', tags_used: {}, prompt: '' });
              }
              next[index] = {
                ...next[index],
                theme_label: next[index].theme_label || '生成失败',
                prompt: next[index].prompt
                  ? `${next[index].prompt}\n\n[错误] ${message}`
                  : `[错误] ${message}`,
              };
              return next;
            });
          },
          onDone: ({ successful }) => {
            completeBatch();
            // Suppress the unused-var lint warning on `successful` —
            // it's surfaced via the success toast for caller-context.
            void successful;
          },
        },
      );
    } catch (err) {
      // 当发生错误时，将所有还在"生成中"的 slot 标记为失败
      const errorMsg = err instanceof Error ? err.message : '抽卡失败';
      setResults((prev) => prev.map((r) => {
        // 只更新还没有完成或失败的 slot
        if (!r.prompt) {
          return { ...r, theme_label: '生成失败', prompt: `[错误] ${errorMsg}` };
        }
        return r;
      }));
      onErrorRef.current(`随机抽卡出错: ${errorMsg}`);
      setLoading(false);
    }
  };

  const handleCopy = (idx: number, text: string) => { navigator.clipboard.writeText(text).then(() => { setCopiedIdx(idx); setTimeout(() => setCopiedIdx(null), 2000); }); };
  const handleCopyAll = () => { navigator.clipboard.writeText(results.map((r) => r.prompt).join('\n\n---\n\n')).then(() => { setCopiedIdx(-1); setTimeout(() => setCopiedIdx(null), 2000); }); };
  const handleDeleteHistory = (id: string) => { removeRandomHistory(id); setHistory(getRandomHistory()); };
  const handleHistoryLoad = (item: RandomHistoryItem) => {
    setTheme(item.theme || '');
    setResults(item.results.map((r) => ({
      theme_label: r.theme_label,
      theme: item.theme || '',
      tags_used: r.tags_used,
      prompt: r.prompt,
    })));
    // 加载历史记录中的视频提示词
    const loadedH3Prompts: Record<number, string> = {};
    const loadedGenStates: Record<number, { loading: boolean; images: string[] }> = {};
    item.results.forEach((r, idx) => {
      if (r.h3Prompt) {
        loadedH3Prompts[idx] = r.h3Prompt;
      }
      if (r.images && r.images.length > 0) {
        loadedGenStates[idx] = { loading: false, images: r.images };
      }
    });
    // 立即更新 ref，确保点击"生视频"时能获取到最新的 H3 提示词
    h3PromptsRef.current = loadedH3Prompts;
    genStatesRef.current = loadedGenStates;
    setH3Prompts(loadedH3Prompts);
    setGenStates(loadedGenStates);
    setShowHistory(false);
  };

  const totalTags = results.reduce((sum, r) => sum + Object.values(r.tags_used || {}).flat().length, 0);

  const handleRandomGenerateImage = useCallback(async (idx: number, prompt: string) => {
    if (taskManager.isFull) {
      onError(`任务队列已满（最多 ${MAX_TASKS} 个任务），请等待当前任务完成`);
      return;
    }
    setGenStates((prev) => ({ ...prev, [idx]: { loading: true, images: [] } }));
    // Per the user feedback: the history card's "主题" label for random
    // records must show the per-result theme_label that the UI displays
    // alongside the prompt (e.g. "地牢舔阴", "失禁盲绳"), NOT the
    // user-selected dropdown theme (which is "完全随机" by default and
    // adds no information). theme_label is set by the API on every抽卡
    // result and loaded back from history on reload — so it's always
    // available here.
    const resultForIdx = results[idx];
    const randomTheme = resultForIdx?.theme_label || '';
    let imagePath = selectedGirlfriend?.portraitUrl || '';
    let downloadUrl = '';
    let referenceImageUrl = '';
    if (digitalHumanMode && selectedGirlfriend) {
      try {
        const file = await gfUrlToFile(selectedGirlfriend.portraitUrl, selectedGirlfriend.id);
        const uploadResult = await uploadImage(apiKey, file);
        imagePath = uploadResult.imagePath;
        downloadUrl = uploadResult.downloadUrl;
        referenceImageUrl = downloadUrl || imagePath;
      } catch {
        setGenStates((prev) => {
          const next = { ...prev };
          delete next[idx];
          return next;
        });
        onError('AI 女友图片上传失败，请重试');
        return;
      }
    }
    if (digitalHumanMode && selectedGirlfriend) {
      const nodes = buildImg2ImgNodeList({
        prompt,
        imagePath: downloadUrl || imagePath,
        aspectRatio: img2imgAspectRatio,
      });
      try {
        await taskManager.addTask('img2img', nodes, prompt, WORKFLOW.IMAGE_TO_IMAGE, undefined, undefined, 'random', randomTheme || undefined);
        onSuccess('任务已提交，请到图生图查看生成结果');
        if (onNavigate) onNavigate('img2img');
      } catch (err) {
        onError(err instanceof Error ? err.message : '提交失败');
        setGenStates((prev) => {
          const next = { ...prev };
          delete next[idx];
          return next;
        });
      }
    } else {
      const nodes = buildTxt2ImgNodeList(buildUnifiedTxt2ImgOptions(prompt));
      try {
        await taskManager.addTask('txt2img', nodes, prompt, undefined, undefined, undefined, 'random', randomTheme || undefined);
        onSuccess('任务已提交，请到文生图查看生成结果');
        if (onNavigate) onNavigate('txt2img');
      } catch (err) {
        onError(err instanceof Error ? err.message : '提交失败');
        setGenStates((prev) => {
          const next = { ...prev };
          delete next[idx];
          return next;
        });
      }
    }
  }, [taskManager, onError, onSuccess, digitalHumanMode, selectedGirlfriend, apiKey, onNavigate, theme]);

  // ── handleRetryStuckSlot ────────────────────────────────────────────────────────
  // A "stuck" slot is one that's been in `isPromptLoading` for >90s without
  // receiving any stream events (delta or end). The mobile user reported:
  // "后台已经扣费了，手机移动端前端的ai提示词的随机抽卡还是一直显示生成中".
  // Two possible root causes:
  //   1. The stream connection dropped silently after the backend started
  //      charging the LLM call. The backend still has the work in flight
  //      but the client never gets any data back.
  //   2. One of the N parallel slots was started but stalled (LLM provider
  //      rate-limit, network hiccup, etc.) and the others kept going.
  // In both cases the cleanest UX is: allow the user to re-trigger just
  // this one slot with a fresh stream request, while preserving the slots
  // that already completed.
  const handleRetryStuckSlot = useCallback(async (idx: number) => {
    // Reset the slot to a fresh empty card
    setResults((prev) => {
      const next = [...prev];
      while (next.length <= idx) next.push({ theme_label: '', theme: '', tags_used: {}, prompt: '' });
      next[idx] = { theme_label: '', theme: '', tags_used: {}, prompt: '' };
      return next;
    });
    onSuccessRef.current?.(`正在重试抽卡 #${idx + 1}…`);
    try {
      // Single-slot retry: pass count=1 but slot index = idx so the
      // backend treats it as one fresh generation. We approximate this
      // by reusing the same stream endpoint with the same count and
      // then throwing away all OTHER slots' updates — but the simplest
      // and most reliable approach is just to re-issue the full batch
      // and have the in-flight stream cancel-and-replace.
      await streamRandomPrompt(
        type, r18Mode, count, theme,
        digitalHumanMode,
        digitalHumanMode ? selectedGirlfriend?.portraitUrl : undefined,
        digitalHumanMode ? selectedGirlfriend?.characterPrompt : undefined,
        {
          onStart: ({ index, theme: presetLabel, tags_used }) => {
            // Only write to slots that are still empty (i.e. stuck) so we
            // don't clobber slots that already completed in the previous batch.
            setResults((prev) => {
              const next = [...prev];
              while (next.length <= index) next.push({ theme_label: '', theme: '', tags_used: {}, prompt: '' });
              if (!next[index].prompt) {
                next[index] = {
                  ...next[index],
                  theme: presetLabel,
                  tags_used: tags_used ?? next[index].tags_used ?? {},
                };
              }
              return next;
            });
          },
          onDelta: ({ index, text }) => {
            setResults((prev) => {
              const next = [...prev];
              while (next.length <= index) next.push({ theme_label: '', theme: '', tags_used: {}, prompt: '' });
              if (!next[index].prompt || next[index].prompt.startsWith('[错误]')) {
                // fresh slot or stuck retry → start clean
                next[index] = { ...next[index], prompt: text };
              } else {
                // already-completed slot → append in case the user re-ran
                next[index] = { ...next[index], prompt: next[index].prompt + text };
              }
              return next;
            });
          },
          onEnd: ({ index, theme_label, prompt }) => {
            setResults((prev) => {
              const next = [...prev];
              while (next.length <= index) next.push({ theme_label: '', theme: '', tags_used: {}, prompt: '' });
              next[index] = { ...next[index], theme_label: theme_label || next[index].theme_label || '', prompt };
              return next;
            });
          },
          onError: ({ index, message }) => {
            if (index === undefined) { onErrorRef.current(message); return; }
            setResults((prev) => {
              const next = [...prev];
              while (next.length <= index) next.push({ theme_label: '', theme: '', tags_used: {}, prompt: '' });
              next[index] = {
                ...next[index],
                theme_label: next[index].theme_label || '生成失败',
                prompt: next[index].prompt
                  ? `${next[index].prompt}\n\n[错误] ${message}`
                  : `[错误] ${message}`,
              };
              return next;
            });
          },
          onDone: ({ successful }) => {
            onSuccessRef.current?.(`重试完成，新增 ${successful} 个结果`);
          },
        },
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : '重试失败');
    }
  }, [type, r18Mode, count, theme, digitalHumanMode, selectedGirlfriend]);

  const handleBatchGenerate = useCallback(async () => {
    if (results.length === 0) return;
    const availableSlots = MAX_TASKS - taskManager.tasks.length;
    if (availableSlots <= 0) {
      onError('任务队列已满，请等待当前任务完成');
      return;
    }
    setBatchLoading(true);
    let submitted = 0;
    let imagePath = selectedGirlfriend?.portraitUrl || '';
    let downloadUrl = '';
    if (digitalHumanMode && selectedGirlfriend) {
      try {
        const file = await gfUrlToFile(selectedGirlfriend.portraitUrl, selectedGirlfriend.id);
        const uploadResult = await uploadImage(apiKey, file);
        imagePath = uploadResult.imagePath;
        downloadUrl = uploadResult.downloadUrl;
      } catch {
        setBatchLoading(false);
        onError('AI 女友图片上传失败，请重试');
        return;
      }
    }
    const toSubmit = results.slice(0, availableSlots);
    // Each result has its own theme_label (e.g. "森林绳缚", "室内双插",
    // "触手逆骑") and each task MUST carry its own — otherwise all 3
    // history cards in a batch will show the first result's theme, which
    // is what the user reported. result.theme_label is populated by the
    // API on fresh抽卡 and re-populated when results are loaded from
    // history.
    // Set loading state for submitted results so the UI shows progress
    toSubmit.forEach((result, i) => {
      const idx = results.indexOf(result);
      if (idx >= 0) {
        setGenStates((prev) => ({ ...prev, [idx]: { loading: true, images: [] } }));
      }
    });
    const tasks = toSubmit.map(async (result) => {
      const perTaskTheme = result.theme_label || '';
      if (digitalHumanMode && selectedGirlfriend) {
        const nodes = buildImg2ImgNodeList({
          prompt: result.prompt,
          imagePath: downloadUrl || imagePath,
          aspectRatio: img2imgAspectRatio,
        });
        await taskManager.addTask('img2img', nodes, result.prompt, WORKFLOW.IMAGE_TO_IMAGE, undefined, undefined, 'random', perTaskTheme || undefined);
      } else {
        const nodes = buildTxt2ImgNodeList(buildUnifiedTxt2ImgOptions(result.prompt));
        await taskManager.addTask('txt2img', nodes, result.prompt, undefined, undefined, undefined, 'random', perTaskTheme || undefined);
      }
    });
    const settled = await Promise.allSettled(tasks);
    submitted = settled.filter((r) => r.status === 'fulfilled').length;
    settled.forEach((r, i) => {
      if (r.status === 'rejected') {
        onError(`提交第 ${i + 1} 个时失败: ${r.reason instanceof Error ? r.reason.message : '未知错误'}`);
      }
    });
    setBatchLoading(false);
    if (submitted > 0) {
      onSuccess(`已提交 ${submitted} 个生图任务，任务已在后台运行中`);
      // 不自动跳转页面，保留在当前页面
    }
  }, [results, taskManager, onError, onSuccess, digitalHumanMode, selectedGirlfriend, apiKey, theme]);

  // ── 一键批量生成 H3 视频提示词 ──
  // 每个抽卡结果对应一条 H3 Ref2VA 视频提示词，确保视频画面与生成的图片一一对应。
  // 流程：图片提示词 → expandVideoFromImage（模型扩写） → generateH3Prompt（格式化）
  // 超时重试策略：首次 90s 超时后，retry 时跳过慢模型直接用 fast 模型 + 延长到 150s
  // 并行处理：每次最多 3 个并发，加快生成速度
  const CONCURRENT_H3 = 3;

  const handleBatchGenerateH3 = useCallback(async () => {
    if (results.length === 0) { onError('请先生成图片提示词'); return; }
    const validResults = results.filter((r) => r.prompt);
    if (validResults.length === 0) { onError('没有可用的图片提示词'); return; }

    // Mark all valid indices as processing
    const validIndices = results.map((r, i) => r.prompt ? i : -1).filter(i => i >= 0);
    setH3ProcessingIndices(new Set(validIndices));
    setH3Loading(true);
    setH3Progress({ current: 0, total: validResults.length });

    const themeLabel = THEMES.find((t) => t.key === theme)?.label || theme || (r18Mode ? 'R18' : '默认主题');
    const completed: Record<number, string> = {};

    try {
      // 并行处理函数
      // Bug fix:
      // 1. finally 块确保每个任务完成后立即从 h3ProcessingIndices 中移除其索引，
      //    避免失败任务导致卡片永远卡在 processing 状态。
      // 2. 超时判断改用大小写不敏感的正则，避免 "Timeout" / "REQUEST TIMEOUT" 漏判。
      // 3. 除了超时外的瞬态错误（500/网络断开）也触发一次兜底重试（fast 模型 + 更长超时）。
      const processOne = async (i: number, result: PromptResult): Promise<void> => {
        // try-finally 确保 cleanup 同步执行（Promise settle 之前），正确驱动 setH3ProcessingIndices 更新
        try {
          const perTaskLabel = result.theme_label || themeLabel;

          const isTimeoutErr = (err: unknown): boolean =>
            err instanceof Error && /timeout/i.test(err.message);

          // Step 1: 把图片提示词扩写成视频提示词
          let videoRes;
          let lastErr: unknown;
          try {
            videoRes = await expandVideoFromImage(result.prompt, perTaskLabel, r18Mode, 1);
          } catch (h3Err) {
            lastErr = h3Err;
            if (isTimeoutErr(h3Err)) {
              // 超时 → 用 fast 模型重试（更长超时）
              console.warn(`[handleBatchGenerateH3] 第 ${i + 1} 个超时，fast 模型重试（150s）`);
              try {
                videoRes = await expandVideoFromImage(result.prompt, perTaskLabel, r18Mode, 1, ['grok-4.6', 'grok-4.3'], 150000);
                lastErr = null; // 重试成功
              } catch (retryErr) {
                lastErr = retryErr;
                // 重试仍超时或失败 → 兜底一次（允许慢模型）
                if (isTimeoutErr(retryErr) || (retryErr instanceof Error && /50\d|network|fetch/i.test(retryErr.message))) {
                  console.warn(`[handleBatchGenerateH3] 第 ${i + 1} 个重试仍失败，最后兜底（180s）`);
                  try {
                    videoRes = await expandVideoFromImage(result.prompt, perTaskLabel, r18Mode, 1, undefined, 180000);
                    lastErr = null;
                  } catch (fallbackErr) {
                    lastErr = fallbackErr;
                  }
                }
              }
            } else if (h3Err instanceof Error && /50\d|network|fetch/i.test(h3Err.message)) {
              // 非超时但可能是瞬态错误（500/网络） → 直接兜底重试
              console.warn(`[handleBatchGenerateH3] 第 ${i + 1} 个瞬态错误，兜底重试（180s）`);
              try {
                videoRes = await expandVideoFromImage(result.prompt, perTaskLabel, r18Mode, 1, undefined, 180000);
                lastErr = null;
              } catch (fallbackErr) {
                lastErr = fallbackErr;
              }
            }
            // else: 已知业务错误（如参数错误），不重试，直接抛
            if (lastErr) throw lastErr;
          }

          const videoPrompt = videoRes.results?.[0]?.prompt?.trim();
          if (!videoPrompt) {
            console.warn(`[handleBatchGenerateH3] 第 ${i + 1} 个视频提示词扩写返回为空，跳过`);
            return;
          }

          // Step 2: 格式化成 H3 六段式
          completed[i] = generateH3Prompt({
            imagePrompt: result.prompt,
            sceneDescription: videoPrompt,
            duration: 15,
            r18: r18Mode,
          });
        } finally {
          // 无论成功/失败/空结果，都立即从 processing 集合中移除该索引，
          // 避免失败任务导致对应卡片永远卡在 loading 状态。
          setH3ProcessingIndices(prev => {
            const next = new Set(prev);
            next.delete(i);
            return next;
          });
        }
      };

      // 分批并行处理，每批最多 CONCURRENT_H3 个
      for (let batchStart = 0; batchStart < validResults.length; batchStart += CONCURRENT_H3) {
        const batch = validResults.slice(batchStart, batchStart + CONCURRENT_H3);
        await Promise.all(batch.map((result, i) => processOne(batchStart + i, result)));
        // 更新进度
        setH3Progress({ current: Math.min(batchStart + CONCURRENT_H3, validResults.length), total: validResults.length });
      }

      const count = Object.keys(completed).length;
      setH3Progress(null);
      if (count === 0) { onError('所有视频提示词扩写均失败，请重试'); return; }
      setH3Prompts(completed);
      onSuccess(`已生成 ${count} 个 H3 视频提示词，可点击每张卡查看`);
    } catch (err) {
      setH3ProcessingIndices(new Set());
      setH3Progress(null);
      onError(err instanceof Error ? err.message : 'H3 提示词生成失败');
    } finally {
      setH3Loading(false);
    }
  }, [results, theme, r18Mode, onError, onSuccess]);

  // ── 单个生成 H3 视频提示词 ──
  // 用于每个抽卡结果卡片的独立"生成视频提示词"按钮
  const handleGenerateSingleH3 = useCallback(async (idx: number) => {
    const result = results[idx];
    if (!result?.prompt) { onError('该提示词尚未生成'); return; }
    
    // 标记该卡片为处理中
    setH3ProcessingIndices(prev => new Set([...prev, idx]));
    
    const perTaskLabel = result.theme_label || THEMES.find(t => t.key === theme)?.label || theme || (r18Mode ? 'R18' : '默认主题');
    
    try {
      // Step 1: 把图片提示词扩写成视频提示词（超时则自动切换 fast 模型兜底）
      let videoRes;
      try {
        videoRes = await expandVideoFromImage(result.prompt, perTaskLabel, r18Mode, 1);
      } catch (h3Err) {
        const isTimeout = h3Err instanceof Error &&
          (h3Err.message.includes('超时') || h3Err.message.includes('timeout'));
        if (isTimeout) {
          console.warn(`[handleGenerateSingleH3] expandVideoFromImage 第 ${idx + 1} 个超时，尝试 fast 模型重试（150s）`);
          videoRes = await expandVideoFromImage(result.prompt, perTaskLabel, r18Mode, 1, ['grok-4.6', 'grok-4.3'], 150000);
        } else {
          throw h3Err;
        }
      }
      
      const videoPrompt = videoRes.results?.[0]?.prompt?.trim();
      if (!videoPrompt) {
        onError(`第 ${idx + 1} 个视频提示词扩写返回为空`);
        return;
      }
      
      // Step 2: 格式化成 H3 六段式
      const h3Prompt = generateH3Prompt({
        imagePrompt: result.prompt,
        sceneDescription: videoPrompt,
        duration: 15,
        r18: r18Mode,
      });
      
      // 更新该卡片的 H3 提示词
      setH3Prompts(prev => ({ ...prev, [idx]: h3Prompt }));
      onSuccess(`第 ${idx + 1} 个 H3 视频提示词已生成`);
    } catch (err) {
      onError(err instanceof Error ? err.message : `第 ${idx + 1} 个 H3 提示词生成失败`);
    } finally {
      setH3ProcessingIndices(prev => {
        const next = new Set(prev);
        next.delete(idx);
        return next;
      });
    }
  }, [results, theme, r18Mode, onError, onSuccess]);

  /**
   * 跳转长视频 1.1：把视频提示词和参考图暂存到 sessionStorage，
   * 切换到 img2vid 页后由 ImageToVideoPage 读取并填入。
   * 如果未提供 videoPrompt，则自动从当前卡的提示词生成视频提示词。
   * @param imageUrl 图片 URL
   * @param idx 当前卡片索引（用于获取对应的 H3 提示词）
   * @param videoPrompt 可选的视频提示词
   */
  const handleGotoLongVideoWithH3 = useCallback(async (imageUrl: string, idx: number, videoPrompt?: string) => {
    if (!imageUrl) { onError('需要先生成图片'); return; }
    const result = results[idx];
    if (!result) { onError('未找到对应结果'); return; }
    
    // 优先使用传入的 videoPrompt 或 h3PromptsRef 中的提示词（确保获取最新的值）
    // 备用方案：从当前卡的提示词生成视频提示词
    let finalPrompt = videoPrompt || h3PromptsRef.current[idx];
    if (!finalPrompt) {
      // 没有 H3 提示词时，自动从当前卡的提示词生成视频提示词
      finalPrompt = extractVideoPromptFromImagePrompt({
        imagePrompt: result.prompt,
        sceneDescription: result.prompt,
        r18Mode,
      });
    }
    
    sessionStorage.setItem('random_longvideo_v1_1', JSON.stringify({
      imageUrl,
      h3Prompt: finalPrompt,
      // 如果有 H3 提示词则填入，否则留空
      prompt: finalPrompt || '',
      processed: false,
    }));
    if (onNavigate) onNavigate('img2vid');
    onSuccess('已切换到长视频 1.1，提示词与参考图已填入');
  }, [results, r18Mode, onNavigate, onSuccess, onError]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white border border-border shadow-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Shuffle size={14} className={r18Mode ? 'text-red-500' : 'text-primary'} />
            <span className="text-sm font-medium text-text-primary">随机抽卡{r18Mode && <span className="ml-2 text-xs text-red-500 font-medium">(R18)</span>}</span>
          </div>
          <div className="flex items-center gap-2">
            {results.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-text-tertiary">
                <span className="px-2 py-0.5 rounded-full bg-bg-elevated">{results.length} 个提示词</span>
                {totalTags > 0 && <span className="px-2 py-0.5 rounded-full bg-bg-elevated">{totalTags} 标签</span>}
              </div>
            )}
            <button onClick={() => setShowHistory(!showHistory)} className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium transition-all ${showHistory ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'}`}>
              <History size={12} />历史记录
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-tertiary">生成数量:</span>
            <div className="flex gap-1">
              {[1, 3, 5, 8, 10].map((n) => (
                <button key={n} onClick={() => setCount(n)} className={`w-8 h-7 rounded-lg text-xs font-medium transition-all ${count === n ? (r18Mode ? 'bg-red-500 text-white' : 'bg-primary text-white') : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'}`}>{n}</button>
              ))}
            </div>
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-tertiary">主题:</span>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              className={`h-7 px-2 rounded-lg text-xs border transition-all appearance-none cursor-pointer ${r18Mode ? 'bg-red-50 border-red-200 text-red-700 focus:border-red-400' : 'bg-bg-elevated border-border text-text-primary focus:border-primary'} focus:outline-none`}
            >
              {THEMES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => setTagsVisible(!tagsVisible)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${tagsVisible ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-bg-elevated text-text-tertiary border border-transparent hover:bg-bg-hover'}`}>
            <Tag size={12} />{tagsVisible ? '已显示标签' : '显示标签'}
          </button>
          {results.length > 0 && (
            <button onClick={handleCopyAll} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-bg-elevated text-text-tertiary border border-transparent hover:bg-bg-hover transition-all">
              {copiedIdx === -1 ? <><Check size={12} className="text-green-500" /> 已复制全部</> : <><Copy size={12} /> 复制全部</>}
            </button>
          )}
        </div>

        <div className="flex gap-2">
          <button onClick={handleGenerate} disabled={loading}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all ${loading ? 'bg-bg-elevated text-text-secondary cursor-not-allowed' : r18Mode ? 'bg-gradient-to-r from-red-500 to-red-600 text-white hover:opacity-90 active:scale-[0.98]' : 'bg-gradient-to-r from-primary to-primary/80 text-white hover:opacity-90 active:scale-[0.98]'}`}>
            {loading ? <><Loader2 size={16} className="animate-spin" /> 抽卡中...</> : <><Sparkles size={16} />{r18Mode ? 'R18 抽卡' : '开始抽卡'}{theme ? ` [${THEMES.find(t => t.key === theme)?.label}]` : ''}</>}
          </button>
          {results.length > 0 && <button onClick={() => { setResults([]); setExpandedIdx(null); }} className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl font-medium text-sm bg-bg-elevated text-text-tertiary hover:bg-bg-hover transition-colors"><RotateCcw size={14} />清空</button>}
        </div>
      </div>

      {/* Random History */}
      {showHistory && (
        <RandomHistoryPanel
          history={history}
          r18Mode={r18Mode}
          onLoad={handleHistoryLoad}
          onDelete={handleDeleteHistory}
          onClear={() => { clearRandomHistory(); setHistory([]); }}
          onCopy={handleCopy}
        />
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          {/* Batch Generate Header */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-text-tertiary font-medium">提示词列表 · {results.length} 个</span>
            <div className="flex items-center gap-2">
              {/* 一键批量视频提示词（H3）—— 在生图按钮左侧 */}
              <button
                onClick={handleBatchGenerateH3}
                disabled={h3Loading || results.length === 0}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  h3Loading || results.length === 0
                    ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                    : 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:opacity-90 active:scale-[0.98]'
                }`}
                title="为所有已生成的图片提示词批量生成 H3 视频提示词"
              >
                {h3Loading ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    {h3Progress ? `第 ${h3Progress.current}/${h3Progress.total} 个...` : '生成中...'}
                  </>
                ) : (
                  <><Sparkles size={12} />一键批量视频提示词</>
                )}
              </button>
              <button
                onClick={handleBatchGenerate}
                disabled={batchLoading || taskManager.isFull || (digitalHumanMode && !selectedGirlfriend)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  batchLoading || taskManager.isFull || (digitalHumanMode && !selectedGirlfriend)
                    ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                    : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:opacity-90 active:scale-[0.98]'
                }`}
              >
                {batchLoading ? <><Loader2 size={12} className="animate-spin" /> 提交中...</> : <><Zap size={12} />一键批量生图</>}
              </button>
            </div>
          </div>
          {results.map((result, idx) => (
            <RandomResultCard
              key={idx}
              index={idx}
              result={result}
              isExpanded={expandedIdx === idx}
              isCopied={copiedIdx === idx}
              tagsVisible={tagsVisible}
              r18Mode={r18Mode}
              onToggle={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
              onCopy={() => handleCopy(idx, result.prompt)}
              genState={genStates[idx]}
              onGenerateImage={() => handleRandomGenerateImage(idx, result.prompt)}
              onGenerateSingleH3={() => handleGenerateSingleH3(idx)}
              onFavorited={(url) => handleToggleFavorite(url, result.prompt)}
              onRetryStuck={() => handleRetryStuckSlot(idx)}
              taskManager={taskManager}
              digitalHumanMode={digitalHumanMode}
              selectedGirlfriend={selectedGirlfriend}
              h3Prompt={h3Prompts[idx]}
              h3Generating={h3ProcessingIndices.has(idx)}
              sceneLabel={result.theme_label || result.theme || (THEMES.find((t) => t.key === theme)?.label || theme || (r18Mode ? 'R18' : '默认主题'))}
              onGotoLongVideoWithH3={handleGotoLongVideoWithH3}
              selectedImageIndex={selectedImageIndices[idx]}
              onSelectImage={(imageIdx, imageUrl) => handleSelectRandomImage(idx, imageIdx, imageUrl)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RandomHistoryPanel({ history, r18Mode, onLoad, onDelete, onClear, onCopy }: {
  history: RandomHistoryItem[];
  r18Mode: boolean;
  onLoad: (h: RandomHistoryItem) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onCopy: (idx: number, text: string) => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const copy = (id: string, text: string) => { onCopy(0, text); setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); };

  return (
    <div className={`rounded-2xl bg-white border shadow-card overflow-hidden ${r18Mode ? 'border-red-200' : 'border-border'}`}>
      <div className={`flex items-center justify-between px-4 py-3 border-b ${r18Mode ? 'border-red-100 bg-red-50/40' : 'border-border/50 bg-bg-elevated'}`}>
        <div className="flex items-center gap-2">
          <History size={14} className={r18Mode ? 'text-red-500' : 'text-text-tertiary'} />
          <span className={`text-sm font-medium ${r18Mode ? 'text-red-600' : 'text-text-primary'}`}>抽卡历史</span>
          <span className="px-2 py-0.5 rounded-full text-[11px] bg-bg-elevated text-text-tertiary">{history.length} 条</span>
        </div>
        {history.length > 0 && <button onClick={onClear} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-all"><Trash2 size={11} />清空</button>}
      </div>
      {history.length === 0 ? (
        <div className="px-4 py-8 text-center"><Clock size={24} className="mx-auto text-text-tertiary/40 mb-2" /><p className="text-sm text-text-tertiary">暂无历史记录</p></div>
      ) : (
        <div className="max-h-[500px] overflow-y-auto divide-y divide-border/50">
          {history.map((h) => (
            <div key={h.id}>
              <div className="flex items-center gap-2 px-4 py-3 hover:bg-bg-hover/30 transition-colors">
                <button onClick={() => onLoad(h)} className="flex-1 flex items-start gap-2 w-full min-w-0 text-left group">
                  <Plus size={13} className="flex-shrink-0 mt-0.5 text-text-tertiary group-hover:text-primary transition-colors" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="flex flex-wrap gap-1">
                        {(h.results ?? []).slice(0, 3).map((r, ri) => {
                          const lbl = containsCJK(r.theme_label || '') ? r.theme_label : '主题';
                          return (
                            <span key={ri} className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${r18Mode ? 'bg-red-100 text-red-600' : 'bg-primary/8 text-primary'}`}>{lbl}</span>
                          );
                        })}
                        {(h.results ?? []).length > 3 && <span className="text-[10px] text-text-tertiary">+{(h.results ?? []).length - 3}</span>}
                      </div>
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-bg-elevated text-text-tertiary flex-shrink-0">{(h.results ?? []).length} 个</span>
                    </div>
                    <p className="text-[11px] text-text-tertiary mt-0.5">{new Date(h.timestamp).toLocaleString('zh-CN')}</p>
                  </div>
                </button>
                <button onClick={() => setExpandedId(expandedId === h.id ? null : h.id)}
                  className="p-1.5 rounded-lg text-text-tertiary hover:bg-bg-hover transition-all">
                  <span className={`transition-transform ${expandedId === h.id ? 'rotate-180' : ''}`}><ChevronDown size={14} /></span>
                </button>
                <button onClick={() => onDelete(h.id)} className="p-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-all"><Trash2 size={13} /></button>
              </div>
              {expandedId === h.id && (
                <div className="px-4 pb-3 space-y-2">
                  {(h.results ?? []).map((r, ri) => (
                    <div key={ri} className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${r18Mode ? 'bg-red-50/60 text-red-800 border border-red-100' : 'bg-bg-elevated text-text-secondary'}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-medium text-text-tertiary">{ri + 1}</span>
                          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${r18Mode ? 'bg-red-200 text-red-700' : 'bg-primary/10 text-primary'}`}>{containsCJK(r.theme_label || '') ? r.theme_label : ''}</span>
                          {r.h3Prompt && (
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-indigo-100 text-indigo-600">有视频提示词</span>
                          )}
                        </div>
                        <button onClick={() => copy(`${h.id}-${ri}`, r.prompt)}
                          className={`flex items-center gap-1 text-[10px] transition-colors ${copiedId === `${h.id}-${ri}` ? 'text-green-500' : 'text-text-tertiary hover:text-primary'}`}>
                          {copiedId === `${h.id}-${ri}` ? <><Check size={10} />已复制</> : <><Copy size={10} />复制</>}
                        </button>
                      </div>
                      {/* 显示历史图片 */}
                      {r.images && r.images.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1">
                          {r.images.slice(0, 3).map((img, imgIdx) => (
                            <div key={imgIdx} className="w-12 h-12 rounded overflow-hidden bg-bg-base border border-border">
                              <img src={img} alt="" className="w-full h-full object-cover" />
                            </div>
                          ))}
                          {r.images.length > 3 && (
                            <div className="w-12 h-12 rounded bg-bg-base border border-border flex items-center justify-center text-[10px] text-text-tertiary">
                              +{r.images.length - 3}
                            </div>
                          )}
                        </div>
                      )}
                      <p className="whitespace-pre-wrap line-clamp-3">{r.prompt}</p>
                      {/* 显示 H3 视频提示词摘要 */}
                      {r.h3Prompt && (
                        <div className="mt-2 px-2 py-1.5 rounded bg-indigo-50 border border-indigo-100">
                          <div className="text-[10px] text-indigo-500 mb-0.5">H3 视频提示词摘要</div>
                          <p className="text-[10px] text-indigo-700 line-clamp-2">{generateH3Summary(r.h3Prompt)}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RandomResultCard({ index, result, isExpanded, isCopied, tagsVisible, r18Mode, onToggle, onCopy, genState, onGenerateImage, onGenerateSingleH3, onFavorited, onRetryStuck, taskManager, digitalHumanMode, selectedGirlfriend, h3Prompt, h3Generating, sceneLabel, onGotoLongVideoWithH3, selectedImageIndex, onSelectImage, onPreviewImage }: {
  index: number; result: PromptResult; isExpanded: boolean; isCopied: boolean; tagsVisible: boolean; r18Mode: boolean; onToggle: () => void; onCopy: () => void;
  genState?: { loading: boolean; images: string[] };
  onGenerateImage: () => void;
  /** 单个生成 H3 视频提示词回调 */
  onGenerateSingleH3: () => void;
  onFavorited?: (url: string) => void;
  /** Called when a card has been "loading" for >90s with no stream events.
   *  Lets the user manually retry the slow slot without a full refresh. */
  onRetryStuck?: () => void;
  taskManager: TaskManagerReturn;
  digitalHumanMode?: boolean; selectedGirlfriend?: GirlfriendPreset | null;
  /** 已生成的 H3 视频提示词（来自一键批量视频提示词按钮） */
  h3Prompt?: string;
  /** 当前卡片是否正在生成 H3 视频提示词 */
  h3Generating?: boolean;
  /** 当前场景/主题标签（用于显示在 H3 提示词上方） */
  sceneLabel?: string;
  /** 点击后用 H3 提示词 + 第一张生成图跳转到长视频 1.1 */
  onGotoLongVideoWithH3?: (imageUrl: string, idx: number, videoPrompt?: string) => void;
  /** 当前选中的图片索引（用于长视频 1.1） */
  selectedImageIndex?: number;
  /** 选中图片回调 */
  onSelectImage?: (imageIndex: number, imageUrl: string) => void;
  /** 预览图片回调（打开灯箱） */
  onPreviewImage?: (imageUrl: string, imageIndex: number) => void;
}) {
  // 灯箱状态：预览大图
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  // A card is "generating" until the LLM has produced at least one chunk
  // for it. With the streaming backend, prompt stays "" for ~0.5-2s after
  // the user clicks "抽卡", so we render an explicit loading affordance
  // instead of an empty card (which the user reported as "看不出是否在
  // 生成" — they only saw "主题 1/2/3..." placeholders with no spinner).
  const isPromptLoading = !result.prompt;
  // Prefer the server-generated theme_label (e.g. "森林绳缚", "酒店女仆").
  // If it's empty — happens when the second-pass LLM call for the label
  // failed and the backend fell back to the preset name — synthesize one
  // from the prompt itself so the user always sees a meaningful summary
  // ("主题 1..5" placeholders are useless in the UI).
  const serverLabelRaw = result.theme_label?.trim() ?? '';
  const serverLabel = serverLabelRaw;
  // Use result.theme (preset name like "暗示优雅") as fallback when theme_label is empty
  const presetLabel = result.theme?.trim() ?? '';
  // For English-only prompts or when theme_label is empty, derive theme from prompt
  const autoLabel = serverLabel ? '' : deriveThemeLabel(result.prompt, presetLabel);
  // Priority: server theme_label > preset theme name > prompt-derived > "主题 N"
  const themeLabel = serverLabel || presetLabel || autoLabel || `主题 ${index + 1}`;
  // ── Soft-timeout for mobile users stuck on "生成中" ──
  // The user reported that on mobile the card stayed in "生成中" forever
  // even though the backend had already charged the request. Track how
  // long the card has been loading; if it exceeds the timeout and the
  // stream hasn't produced a first chunk yet, surface a "重试" affordance
  // in the spinner area so the user can recover without a full refresh.
  // The timer is anchored on the latest write (result.prompt or
  // result.theme_label), so any successful stream event resets it.
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  useEffect(() => {
    if (!isPromptLoading) { setLoadingSeconds(0); return; }
    const t0 = Date.now();
    const id = window.setInterval(() => setLoadingSeconds(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [isPromptLoading, result.theme_label]);
  // 降低超时时间到 45 秒，让用户更快看到重试按钮
  const STUCK_TIMEOUT_S = 45;
  const isStuck = isPromptLoading && loadingSeconds > STUCK_TIMEOUT_S;
  const totalTags = Object.values(result.tags_used || {}).flat().length;
  const accentColor = r18Mode ? 'border-red-200' : 'border-border';
  const headerBg = r18Mode ? 'bg-red-50/60' : 'bg-bg-elevated';
  const badgeBg = isPromptLoading
    ? 'bg-gradient-to-r from-slate-400 to-slate-500'
    : r18Mode
      ? 'bg-gradient-to-r from-red-500 to-pink-500'
      : 'bg-gradient-to-r from-primary to-indigo-500';
  const isGenLoading = genState?.loading;
  const displayImages = genState?.images ?? [];

  // Find related running tasks — normalize prompts so trailing whitespace/newlines in
  // LLM output don't prevent the fallback from finding finished task images.
  const resultPromptNorm = (result.prompt || '').trim();
  const relatedTasks = taskManager.tasks.filter(
    (t: QueuedTask) => t.status === 'RUNNING' || t.status === 'QUEUEING' || t.status === 'FINISHED'
  ).filter((t: QueuedTask) => (t.prompt || '').trim() === resultPromptNorm);

  const allDisplayImages = displayImages.length > 0 ? displayImages : relatedTasks.flatMap((t: QueuedTask) => t.images);

  return (
    <div className={`rounded-2xl bg-white border shadow-card overflow-hidden ${accentColor} ${isPromptLoading ? 'ring-1 ring-primary/20' : ''}`}>
      <div role="button" tabIndex={0} onClick={onToggle} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggle(); }}
        className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover/50 transition-colors cursor-pointer ${headerBg}`}>
        <div className={`flex-shrink-0 px-3 py-1 rounded-full text-white text-xs font-bold shadow-sm flex items-center gap-1.5 ${badgeBg}`}>
          {isPromptLoading && <Loader2 size={11} className="animate-spin" />}
          {themeLabel}
          {h3Generating && (
            <span className="ml-1 flex items-center gap-0.5 text-[9px] bg-white/30 px-1.5 py-0.5 rounded-full">
              <Loader2 size={8} className="animate-spin" />视频
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0 text-left">
          {isPromptLoading ? (
            <div className="flex items-center gap-2 flex-wrap">
              <p className={`text-sm ${r18Mode ? 'text-red-600/70' : 'text-text-tertiary'}`}>
                {result.theme ? `生成 [${result.theme}] 中` : '生成中'}
                <span className="inline-flex ml-0.5">
                  <span className="animate-pulse">.</span>
                  <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>.</span>
                  <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>.</span>
                </span>
                <span className={`ml-2 text-[11px] tabular-nums ${isStuck ? 'text-orange-500 font-medium' : 'text-text-tertiary/60'}`}>
                  · 已等 {loadingSeconds} 秒
                </span>
              </p>
              {isStuck && onRetryStuck && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRetryStuck(); }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-orange-500/10 text-orange-600 hover:bg-orange-500/20 border border-orange-300/50 transition-colors"
                  title="长时间未返回，尝试重新请求这一个"
                >
                  <RefreshCw size={10} />重试
                </button>
              )}
            </div>
          ) : (
            <>
              <p className={`text-sm line-clamp-1 ${r18Mode ? 'text-red-700/80' : 'text-text-secondary'}`}>{result.prompt.slice(0, 80)}{result.prompt.length > 80 ? '...' : ''}</p>
              {h3Generating && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="flex items-center gap-1 text-[10px] text-indigo-500">
                    <Loader2 size={9} className="animate-spin" />
                    生成视频提示词中
                  </span>
                </div>
              )}
              {tagsVisible && totalTags > 0 && <p className="text-[10px] text-text-tertiary flex items-center gap-0.5 mt-0.5"><Tag size={10} />{totalTags} 标签</p>}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={(e) => { e.stopPropagation(); onCopy(); }}
            disabled={isPromptLoading}
            className={`p-1.5 rounded-lg text-xs transition-all ${
              isPromptLoading
                ? 'opacity-40 cursor-not-allowed text-text-tertiary'
                : isCopied
                  ? 'bg-green-500/10 text-green-500'
                  : r18Mode
                    ? 'text-red-500 hover:bg-red-50'
                    : 'text-text-tertiary hover:bg-bg-hover'
            }`}>
            {isCopied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <span className={`text-text-tertiary transition-transform ${isExpanded ? 'rotate-180' : ''}`}><ChevronDown size={16} /></span>
        </div>
      </div>

      {isExpanded && (
        <div className={`border-t px-4 pb-4 pt-3 ${r18Mode ? 'border-red-100' : 'border-border/50'}`}>
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className={`text-xs font-medium flex items-center gap-1.5 ${r18Mode ? 'text-red-500' : 'text-text-tertiary'}`}>
                {isPromptLoading && <Loader2 size={11} className="animate-spin" />}
                提示词 {isPromptLoading && <span className="text-text-tertiary/70">· 生成中...</span>}
              </span>
              <div className="flex items-center gap-1.5">
                {/* 单个生成视频提示词按钮 */}
                <button
                  onClick={onGenerateSingleH3}
                  disabled={h3Generating || isPromptLoading}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all ${
                    h3Generating || isPromptLoading
                      ? 'bg-indigo-100 text-indigo-400 cursor-not-allowed'
                      : 'bg-indigo-500 text-white hover:bg-indigo-600'
                  }`}
                  title="基于此图片提示词生成 H3 视频提示词"
                >
                  {h3Generating ? <><Loader2 size={11} className="animate-spin" /> 生成中</> : <><Sparkles size={11} />生成视频提示词</>}
                </button>
                <button
                  onClick={onGenerateImage}
                  disabled={isGenLoading || isPromptLoading || (digitalHumanMode && !selectedGirlfriend)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                    isGenLoading || isPromptLoading || (digitalHumanMode && !selectedGirlfriend)
                      ? 'bg-blue-100 text-blue-400 cursor-not-allowed'
                      : 'bg-blue-500 text-white hover:bg-blue-600'
                  }`}
                >
                  {isGenLoading ? <><Loader2 size={11} className="animate-spin" /> 生成中</> : <><Image size={11} />{digitalHumanMode && selectedGirlfriend ? '图生图' : '生图'}</>}
                </button>
              </div>
            </div>
            <div className={`rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap min-h-[3.5rem] ${r18Mode ? 'bg-red-50/70 text-red-800 border border-red-100' : 'bg-bg-elevated text-text-secondary'} ${isPromptLoading ? 'animate-pulse' : ''}`}>
              {isPromptLoading ? (
                <div className="space-y-2">
                  <div className={`h-3 rounded w-[90%] ${r18Mode ? 'bg-red-200/70' : 'bg-text-tertiary/15'}`} />
                  <div className={`h-3 rounded w-[70%] ${r18Mode ? 'bg-red-200/70' : 'bg-text-tertiary/15'}`} />
                  <div className={`h-3 rounded w-[80%] ${r18Mode ? 'bg-red-200/70' : 'bg-text-tertiary/15'}`} />
                </div>
              ) : (
                result.prompt
              )}
            </div>
          </div>

          {/* H3 视频提示词（来自一键批量视频提示词按钮） */}
          {(h3Prompt || h3Generating) && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium flex items-center gap-1.5 text-indigo-500">
                  <Sparkles size={11} />
                  H3 视频提示词
                  {h3Generating && <span className="ml-1 flex items-center gap-1"><Loader2 size={10} className="animate-spin" />生成中...</span>}
                  {sceneLabel && <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-indigo-500/10 text-indigo-500">{sceneLabel}</span>}
                </span>
                {h3Prompt && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(h3Prompt).catch(() => {}); }}
                      className="p-1 rounded-md text-text-tertiary hover:bg-bg-hover transition-colors"
                      title="复制 H3 提示词"
                    >
                      <Copy size={12} />
                    </button>
                    {allDisplayImages.length > 0 && onGotoLongVideoWithH3 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const imageToUse = selectedImageIndex !== undefined && allDisplayImages[selectedImageIndex]
                            ? allDisplayImages[selectedImageIndex]
                            : allDisplayImages[0];
                          onGotoLongVideoWithH3(imageToUse, index, h3Prompt);
                        }}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:opacity-90 transition-all"
                        title={selectedImageIndex !== undefined ? '用已选中的图片生成视频' : '点击图片选中后再生成视频（默认使用第一张）'}
                      >
                        <Video size={11} />长视频 1.1
                      </button>
                    )}
                  </div>
                )}
              </div>
              {h3Generating ? (
                <div className="rounded-xl px-4 py-3 text-xs leading-relaxed animate-pulse">
                  <div className="space-y-2">
                    <div className="h-2.5 rounded w-[90%] bg-indigo-200/60" />
                    <div className="h-2.5 rounded w-[75%] bg-indigo-200/60" />
                    <div className="h-2.5 rounded w-[85%] bg-indigo-200/60" />
                    <div className="h-2.5 rounded w-[60%] bg-indigo-200/60" />
                  </div>
                </div>
              ) : h3Prompt ? (
                <div>
                  <div className={`rounded-xl px-4 py-3 text-xs leading-relaxed whitespace-pre-wrap max-h-[28rem] overflow-y-auto font-mono ${r18Mode ? 'bg-indigo-50/40 text-indigo-900 border border-indigo-100' : 'bg-indigo-50/40 text-text-secondary border border-indigo-100'}`}>
                    {h3Prompt}
                  </div>
                  {/* 中文总结 */}
                  <div className="mt-2 px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-500/5 to-purple-500/5 border border-indigo-100/50">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] font-medium text-indigo-500">视频概要</span>
                    </div>
                    <p className="text-xs text-text-secondary leading-relaxed">
                      {generateH3Summary(h3Prompt)}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* Generated images preview */}
          {allDisplayImages.length > 0 && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-tertiary font-medium">生成结果（点击选中/预览）</span>
                <span className="text-[10px] text-text-tertiary">{allDisplayImages.length} 张</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {allDisplayImages.slice(0, 6).map((img, idx) => (
                  <div
                    key={idx}
                    className={`relative group cursor-pointer rounded-lg overflow-hidden transition-all ${
                      selectedImageIndex === idx ? 'ring-2 ring-purple-500 ring-offset-2' : ''
                    }`}
                    onClick={() => {
                      onSelectImage?.(idx, img);
                      setLightboxUrl(img);
                    }}
                  >
                    <AspectAwareImage
                      src={img}
                      alt=""
                      maxHeight={120}
                      objectFit="cover"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors pointer-events-none" />
                    {onFavorited && (
                      <div className="absolute top-1 right-1 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onFavorited(img); }}
                          title={isFavorited(img) ? '取消收藏' : '收藏'}
                          className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                            isFavorited(img) ? 'bg-red-500 text-white' : 'bg-black/55 text-white hover:bg-red-500'
                          }`}
                        >
                          <Heart size={11} className={isFavorited(img) ? 'fill-white' : ''} />
                        </button>
                      </div>
                    )}
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                      <div className="w-7 h-7 rounded-full bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto flex items-center justify-center">
                        <ZoomIn size={14} className="text-white" />
                      </div>
                    </div>
                    {selectedImageIndex === idx && (
                      <div className="absolute top-1 left-1 bg-purple-500 text-white text-[9px] px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5">
                        <Check size={9} /> 已选
                      </div>
                    )}
                  </div>
                ))}
                {allDisplayImages.length > 6 && (
                  <div className="aspect-square rounded-lg bg-bg-elevated flex items-center justify-center text-xs text-text-tertiary">
                    +{allDisplayImages.length - 6}
                  </div>
                )}
              </div>
              {allDisplayImages.length > 0 && onGotoLongVideoWithH3 && (
                <div className="flex justify-end mt-2">
                  <button
                    onClick={() => {
                      const img = selectedImageIndex !== undefined ? allDisplayImages[selectedImageIndex] : allDisplayImages[0];
                      onGotoLongVideoWithH3(img, index, h3Prompt);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:opacity-90 transition-all"
                  >
                    <Video size={12} />生视频
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 灯箱预览 */}
          {lightboxUrl && (
            <div
              className="fixed inset-0 z-50 bg-black/95 flex flex-col"
              onClick={() => setLightboxUrl(null)}
            >
              {/* Top bar */}
              <div
                className="flex-shrink-0 flex items-center justify-between px-4 py-3 z-10"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="text-sm text-white/70">图片预览</span>
                <div className="flex items-center gap-2">
                  {onFavorited && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onFavorited(lightboxUrl); }}
                      className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
                      title="收藏"
                    >
                      <Heart
                        size={18}
                        className={isFavorited(lightboxUrl) ? 'fill-red-500 text-red-500' : 'text-white'}
                      />
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const a = document.createElement('a');
                      a.href = lightboxUrl;
                      a.download = `抽卡_${index + 1}_${Date.now()}.jpg`;
                      a.click();
                    }}
                    className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
                    title="下载"
                  >
                    <Download size={18} className="text-white" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setLightboxUrl(null); }}
                    className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
                    title="关闭"
                  >
                    <X size={18} className="text-white" />
                  </button>
                </div>
              </div>

              {/* Image */}
              <div
                className="flex-1 flex items-center justify-center overflow-hidden p-4 pb-16"
                onClick={(e) => e.stopPropagation()}
              >
                <img
                  src={lightboxUrl}
                  alt="预览大图"
                  className="max-w-full max-h-full object-contain"
                />
              </div>
            </div>
          )}

          {/* Running status */}
          {relatedTasks.filter((t: QueuedTask) => t.status === 'RUNNING' || t.status === 'QUEUEING').length > 0 && allDisplayImages.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-blue-500 mb-3">
              <Loader2 size={12} className="animate-spin" />
              正在生成中... {relatedTasks.filter((t: QueuedTask) => t.status === 'RUNNING' || t.status === 'QUEUEING').length} 个任务
            </div>
          )}

          {tagsVisible && Object.keys(result.tags_used || {}).length > 0 && (
            <div>
              <div className="flex items-center gap-1 mb-2"><Tag size={11} className="text-text-tertiary" /><span className="text-xs text-text-tertiary font-medium">标签 ({totalTags})</span></div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(result.tags_used || {}).filter(([, v]) => v.length > 0).map(([cat, names]) => (
                  <div key={cat} className="flex flex-wrap gap-1">
                    {names.map((name, i) => (
                      <span key={i} className={`px-2 py-0.5 rounded-full text-[11px] ${r18Mode && (cat === 'r18' || cat === 'nsfw_details') ? 'bg-red-500/10 text-red-600 border border-red-200/50' : 'bg-primary/8 text-primary border border-primary/20'}`}>{name}</span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Storyboard Mode ────────────────────────────────────────────────────────

function StoryboardMode({ onError, onSuccess, loading, setLoading, r18Mode, taskManager, apiKey, onNavigate, digitalHumanMode, setDigitalHumanMode, selectedGirlfriend, setSelectedGirlfriend, img2imgAspectRatio }: {
  onError: (msg: string) => void; onSuccess: (msg: string) => void; loading: boolean; setLoading: (v: boolean) => void; r18Mode: boolean;
  taskManager: TaskManagerReturn; apiKey: string; onNavigate?: (tab: TabType) => void;
  digitalHumanMode: boolean; setDigitalHumanMode: (v: boolean) => void; selectedGirlfriend: GirlfriendPreset | null; setSelectedGirlfriend: (gf: GirlfriendPreset | null) => void;
  img2imgAspectRatio: 'portrait' | 'landscape';
}) {
  const savedStoryboard = getStoryboardSession();
  const [plot, setPlot] = useState(savedStoryboard?.plot || '');
  const [panelCount, setPanelCount] = useState(() => {
    const saved = getStoryboardSession()?.panelCount;
    // Clamp to legal UI range [5,10] so a stale localStorage value (e.g. 1)
    // doesn't leave the selector with no active button. The backend also
    // clamps to [2,10] when generating, but the UI should always show a
    // sensible highlight.
    if (typeof saved === 'number' && saved >= 5 && saved <= 10) return saved;
    return 6;
  });
  const [panels, setPanels] = useState<{ panel_number: number; scene_description: string; image_prompt: string }[]>(savedStoryboard?.panels || []);
  const [expandedPanel, setExpandedPanel] = useState<number | null>(savedStoryboard?.expandedPanel ?? null);
  const [copiedPanel, setCopiedPanel] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyTab, setHistoryTab] = useState<'history' | 'favorites'>('history');
  const [history, setHistory] = useState<StoryboardHistoryItem[]>(() => getStoryboardHistory());
  const [favorites, setFavorites] = useState<FavoriteItem[]>(() => getFavorites());
  const [genStates, setGenStates] = useState<Record<string, { loading: boolean; images: string[] }>>({});
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchVideoLoading, setBatchVideoLoading] = useState(false);
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(() => {
    const saved = getStoryboardSession();
    return saved?.historyId || null;
  });

  // ============================================================
  // 【H3 提示词引擎状态 - 提前声明，因为 triggerAutoH3ForPanel 在 useEffect 中使用】
  // 这些状态必须在 useFinishedTaskImages useEffect 之前声明，确保 TDZ 安全。
  // ============================================================
  /**
   * 【动画提示词回填】生成视频脚本（handleGenerateScript）后，按 panel 索引回填到每个分镜。
   * key 格式：`${sbHistoryId}_${idx}` —— 多主题隔离，避免切换主题后另一个主题的提示词被覆盖。
   * 单主题模式（无 activeThemeTab）时 historyId 可能为 null，使用 `'solo'` 作 fallback。
   * 渲染时 StoryboardPanelCard 的 videoPrompt prop 优先从这里取。
   * 切换主题 / 重新生成分镜 / 主动 reset 时会清空。
   *
   * 此外，本状态也是"图片生成成功后自动调用 LLM 生成的 H3 Shot 提示词"的回填目标。
   */
  const [panelVideoPrompts, setPanelVideoPrompts] = useState<Record<string, string>>(() => {
    const s = getStoryboardSession();
    return s?.panelVideoPrompts || {};
  });

  // H3 提示词引擎状态
  // key 与 panelVideoPrompts 一致：`${sbHistoryId}_${idx}`
  const [panelH3Prompts, setPanelH3Prompts] = useState<Record<string, string>>(() => {
    const s = getStoryboardSession();
    return s?.panelH3Prompts || {};
  });
  const [panelH3Duration, setPanelH3Duration] = useState<15 | 30 | 60>(15); // 默认 15 秒
  const [panelH3Loading, setPanelH3Loading] = useState<Record<string, boolean>>({});
  /** 强制约束开关（per historyId）：打开时在 H3 提示词前加入严格约束文本 */
  const [panelH3ConstraintEnabled, setPanelH3ConstraintEnabled] = useState<Record<string, boolean>>(() => {
    const s = getStoryboardSession();
    return s?.panelH3ConstraintEnabled || {};
  });
  // H3 共享部分缓存：按 historyId 隔离，每个主题独立一份（多主题并行生成时不会互相覆盖）
  const [panelH3CommonParts, setPanelH3CommonParts] = useState<Record<string, H3CommonParts>>(() => {
    const s = getStoryboardSession();
    return s?.panelH3CommonParts || {};
  });
  // H3 Shot Map：按 historyId 隔离。从 sessionStorage 还原时把 entries 数组恢复成 Map
  const [panelH3ShotMap, setPanelH3ShotMap] = useState<Record<string, Map<number, H3PanelShot>>>(() => {
    const s = getStoryboardSession();
    const out: Record<string, Map<number, H3PanelShot>> = {};
    if (s?.panelH3ShotMap) {
      for (const [historyId, entries] of Object.entries(s.panelH3ShotMap)) {
        out[historyId] = new Map(entries as Array<[number, H3PanelShot]>);
      }
    }
    return out;
  });

  // Helper: 计算 panel 提示词在 prompt state 中的 key
  // 多主题模式下用 `${sbHistoryId}_${idx}`，单主题模式下用 `solo_${idx}`。
  const promptKey = (idx: number, historyId?: string | null) => `${historyId || 'solo'}_${idx}`;

  // 2-step storyboard state
  const [storyStep, setStoryStep] = useState<'themes' | 'outline' | 'panels'>(
    savedStoryboard?.themeId ? 'panels' : 'themes'
  );
  const [themeOptions, setThemeOptions] = useState<{
    id: number; title: string; description: string; tags: string[]; r18_level: string; category?: string; scenario_count?: number; costume_count?: number;
  }[]>([]);
  const [selectedThemes, setSelectedThemes] = useState<{
    id: number; title: string; description: string; tags: string[]; r18_level: string; category?: string; scenario_count?: number; costume_count?: number;
  }[]>(() => {
    const s = getStoryboardSession();
    if (!s?.selectedThemes) return [];
    // sessionStorage 版本字段是简化版（无 scenario_count / costume_count），需要补齐
    return s.selectedThemes.map((t: any) => ({
      id: t.id,
      title: t.title,
      description: t.description || '',
      tags: t.tags || [],
      r18_level: t.r18_level || '',
      category: t.category,
      scenario_count: undefined,
      costume_count: undefined,
    }));
  });
  const [selectedTheme, setSelectedTheme] = useState<{
    id: number; title: string; description: string; tags: string[]; r18_level: string; category?: string; scenario_count?: number; costume_count?: number;
  } | null>(null);
  const [customThemeMode, setCustomThemeMode] = useState(false);
  const [customThemeDescription, setCustomThemeDescription] = useState('');
  const [customThemeCount, setCustomThemeCount] = useState(3);
  const [themeLibraryOpen, setThemeLibraryOpen] = useState(false);
  const [loadingThemeLibrary, setLoadingThemeLibrary] = useState(false);
  const [themeSearchQuery, setThemeSearchQuery] = useState('');
  const [themeCategoryFilter, setThemeCategoryFilter] = useState('');
  const [outlineArc, setOutlineArc] = useState(savedStoryboard?.outlineArc || '');
  const [outlineScenes, setOutlineScenes] = useState<string[]>(savedStoryboard?.outlineScenes || []);
  const [generatingOutline, setGeneratingOutline] = useState(false);
  // Latest in-flight progress string for the single-theme outline
  // generation flow. Set by `handlePromptTaskResult` from
  // `status.progress`, cleared when the task ends. Rendered next to
  // the spinner so the user can see what the backend is actually
  // doing instead of a frozen "生成中..." with no feedback.
  const [outlineProgress, setOutlineProgress] = useState<string | null>(null);
  // Live progress string for the async theme generation task. Mirrors
  // `outlineProgress` for outlines: every poll update from the backend
  // carries a `progress` string we want to surface in the "主题生成中"
  // indicator instead of a frozen spinner. Cleared when the task
  // transitions to DONE / FAILED.
  const [themeTaskProgress, setThemeTaskProgress] = useState<string | null>(null);

  // Sub-mode: linear (existing) or grid (九宫格)
  const [subMode, setSubMode] = useState<'linear' | 'grid'>('linear');

  // Refs for callbacks used inside async effects — avoids stale closure issues
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  // 【修复】并发防护闸门：useState setBatchVideoLoading 是异步的，
  // React 把 true 推给 DOM 之前用户可能再次点击按钮（disabled 还没生效），
  // 导致同一批 6 张图被反复上传 + 重复写 sessionStorage → 撑爆配额
  // → QuotaExceededError。ref 是同步的，从源头挡住重入。
  const batchVideoUploadingRef = useRef(false);

  /**
   * 用于在异步任务完成（handlePromptTaskResult 'script' 分支）时拿到最新的 panels 列表。
   * useCallback 闭包的是最初渲染时的值，单纯依赖 panels 数组会让 callback 频繁重建，破坏 polling
   * 循环的稳定性；改用 ref 每次 effect 同步最新值即可。
   */
  const panelsRefForPrompt = useRef(panels);
  useEffect(() => { panelsRefForPrompt.current = panels; }, [panels]);

  // Track pending async prompt tasks (task_id -> task type) for polling/restore on refresh.
  // Persisted to localStorage so tasks survive page refresh and are shared across tabs.
  const [pendingPromptTasks, setPendingPromptTasks] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem('nsfwxo_pending_prompt_tasks');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });

  // Persist pending tasks to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('nsfwxo_pending_prompt_tasks', JSON.stringify(pendingPromptTasks));
    } catch (e) { console.error('[prompt-task] localStorage write failed:', e); }
  }, [pendingPromptTasks]);

  // Cross-tab synchronization: listen for storage events from other tabs
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === 'nsfwxo_pending_prompt_tasks' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue) as Record<string, string>;
          setPendingPromptTasks(parsed);
        } catch { /* ignore */ }
      }
      // Also process cross-tab task submission signals
      if (e.key === 'nsfwxo_prompt_task_submit' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (!parsed.processed && parsed.taskId) {
            setPendingPromptTasks((prev) => ({ ...prev, [parsed.taskId]: parsed.taskType }));
          }
          localStorage.setItem('nsfwxo_prompt_task_submit', JSON.stringify({ ...parsed, processed: true }));
        } catch { /* ignore */ }
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  // ── Core: handle a single task completing (or still running) ──
  const handlePromptTaskResult = useCallback((taskId: string, taskType: string, status: PromptTaskStatus) => {
    const tCallMs = Date.now();
    console.log('[handlePromptTaskResult]', { taskId, taskType, status: status.status, progress: status.progress ?? null, hasResult: !!status.result });
    const res = status.result;
    // Live progress updates: every poll (even RUNNING) carries a
    // human-readable `status.progress` string from the backend. Mirror
    // it into the per-theme UI state so users see "正在调用 LLM..." /
    // "正在校验第 3/5 个分镜..." instead of a frozen "生成中..." spinner.
    if (status.progress) {
      const themeKey = res?.theme_id;
      if (typeof themeKey === 'number' && taskType === 'outline') {
        setThemeOutlineStates((prev) => {
          const existing = prev[themeKey];
          if (!existing?.generating) return prev;
          return {
            ...prev,
            [themeKey]: { ...existing, progress: status.progress ?? undefined },
          };
        });
      }
      // Single-theme outline flow: mirror the same progress string
      // into the top-level `outlineProgress` state so the user sees
      // "正在调用 LLM..." etc. alongside the per-theme cards.
      if (taskType === 'outline' && status.status === 'RUNNING') {
        setOutlineProgress(status.progress);
      }
      // Theme generation: mirror progress into `themeTaskProgress` so
      // the dedicated "主题生成中" card surfaces the backend's live
      // progress string (e.g. "正在调用 LLM 生成主题（最长约 1-2 分钟）...").
      if (taskType === 'themes' && status.status === 'RUNNING') {
        setThemeTaskProgress(status.progress);
      }
    }
    if (status.status === 'DONE') {
      if (taskType === 'themes' && res?.themes) {
        setThemeOptions(res.themes);
        setStoryStep('themes');
        setSelectedThemes([]);
        // Clear the "主题生成中" indicator as soon as we have a result.
        setThemeTaskProgress(null);
        setLoading(false);
        onSuccessRef.current(`主题已生成（${res.themes.length} 个），请选择`);
      } else if (taskType === 'outline' && res?.storyboard) {
        const panels = res.storyboard;
        const themeKey = res.theme_id;
        // Clear the single-theme progress indicator as soon as we have
        // a result — the UI jumps to the panels step right after this.
        setOutlineProgress(null);
        // CRITICAL: if the LLM returned ZERO panels (all were filtered by
        // safety / coherence / placeholder checks), DON'T push an empty
        // storyboard into history. Doing so left the previous round's
        // panels visible behind an empty record, which is exactly what the
        // user saw in the screenshots ("5 panels all identical, prompt
        // template leak like '身体部位，体液等描写'"). Treat this as a
        // failed task and surface an error instead.
        if (!Array.isArray(panels) || panels.length === 0) {
          console.error('[outline] backend returned 0 panels for themeKey=', themeKey, res);
          onErrorRef.current?.(`「${res.theme_title ?? '主题'}」的大纲生成失败：返回的 panels 为空`);
          // Clear generating flag for this theme so the UI stops showing "生成中"
          if (themeKey !== undefined && themeKey !== null) {
            setThemeOutlineStates((prev) => ({
              ...prev,
              [themeKey]: {
                ...(prev[themeKey] || {}),
                generating: false,
                error: 'panels 为空，请重试',
              },
            }));
          }
          setPendingPromptTasks((prev) => { const n = { ...prev }; delete n[taskId]; return n; });
          return;
        }
        // Idempotency guard: the polling loop can deliver the same DONE
        // status multiple times after a page refresh, and React strict mode
        // can also double-invoke effects in dev. Without this guard we'd
        // unshift a duplicate StoryboardHistory entry every time, leading
        // to dozens of identical rows in the history panel.
        const alreadyHandledKey = `outline_done_${taskId}`;
        if (sessionStorage.getItem(alreadyHandledKey) === '1') {
          setPendingPromptTasks((prev) => { const n = { ...prev }; delete n[taskId]; return n; });
          return;
        }
        sessionStorage.setItem(alreadyHandledKey, '1');
        const historyId = addStoryboardHistory({
          plot: res.theme_title ?? '主题',
          panel_count: panels.length,
          r18: r18Mode,
          panels,
        });
        if (themeKey !== undefined) {
          setThemeOutlineStates((prev) => ({
            ...prev,
            [themeKey]: {
              generating: false,
              outlineArc: res.outline?.arc ?? '',
              outlineScenes: res.outline?.scenes ?? [],
              panels,
              historyId,
              error: undefined,
            },
          }));
        }
        setCurrentHistoryId(historyId);
        saveStoryboardSession({
          plot: res.theme_title ?? '主题',
          panelCount: panels.length,
          panels,
          expandedPanel: null,
          themeTitle: res.theme_title,
          historyId,
        });
        setHistory(getStoryboardHistory());
        onSuccessRef.current(`「${res.theme_title ?? '主题'}」的大纲已生成`);
      } else if (taskType === 'script' && res?.panels) {
        const scriptRes = {
          script_title: res.script_title ?? `${res.theme_title ?? '主题'} 脚本`,
          duration: res.duration ?? '15-30秒',
          panels: res.panels ?? [],
        };
        setVideoScript(scriptRes);

        // 【修复】异步完成路径也要把脚本回填到每个分镜的"动画提示词"位置
        // 用 res.panels（后端生成的 VideoScriptPanel）按 panel 编号映射回 panels 数组 idx
        // 注意：使用 promptKey(idx, sbHistoryId) 作 key，避免多主题时互相覆盖。
        const nextPrompts: Record<string, string> = {};
        const livePanels = panelsRefForPrompt.current;
        const liveHistoryId = currentHistoryId || 'solo';
        for (let i = 0; i < livePanels.length; i++) {
          const panel = livePanels[i];
          const scriptPanel = scriptRes.panels.find((sp) => sp.panel === panel.panel_number) || scriptRes.panels[i];
          if (!scriptPanel) continue;
          const sceneForPrompt = [
            scriptPanel.action,
            scriptPanel.heading,
            scriptPanel.dialogue ? `对白：${scriptPanel.dialogue}` : '',
            scriptPanel.sound_cue ? `音效：${scriptPanel.sound_cue}` : '',
            scriptPanel.camera ? `镜头：${scriptPanel.camera}` : '',
          ].filter(Boolean).join('；');
          nextPrompts[promptKey(i, liveHistoryId)] = extractVideoPromptFromImagePrompt({
            imagePrompt: panel.image_prompt,
            sceneDescription: sceneForPrompt,
            r18Mode,
          });
        }
        setPanelVideoPrompts(prev => ({ ...prev, ...nextPrompts }));
        onSuccessRef.current(`视频脚本生成完成，已回填到 ${Object.keys(nextPrompts).length} 个分镜的动画提示词`);
      }
      setPendingPromptTasks((prev) => { const n = { ...prev }; delete n[taskId]; return n; });
    } else if (status.status === 'FAILED') {
      setOutlineProgress(null);
      // Clear theme-generation indicator + loading flag if the failed
      // task was a themes task — otherwise the "主题生成中" card
      // would stay visible after the backend has marked the task FAILED.
      if (taskType === 'themes') {
        setThemeTaskProgress(null);
        setLoading(false);
      }
      onErrorRef.current(status.error ?? '任务失败');
      // Clear the per-theme "generating" flag so the UI stops showing
      // "生成中" on a failed outline task. Without this, a theme tab that
      // failed in the background would stay stuck in the loading state
      // forever even though the user had navigated away.
      setThemeOutlineStates((prev) => {
        const next: Record<number, any> = { ...prev };
        for (const k of Object.keys(next)) {
          const numKey = Number(k);
          const state = next[numKey];
          if (state?.generating) {
            next[numKey] = {
              ...(state || {}),
              generating: false,
              error: status.error ?? '任务失败',
            };
          }
        }
        return next;
      });
      setPendingPromptTasks((prev) => { const n = { ...prev }; delete n[taskId]; return n; });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Restore: parallel pre-fetch on mount, then switch to continuous polling ──
  useEffect(() => {
    const entries = Object.entries(pendingPromptTasks);
    if (entries.length === 0) return;

    // Helper: if the backend reports the task is gone, drop it from the
    // pending queue and surface a one-time warning. Otherwise we'd poll it
    // forever (and the user would see 404s flood the console every 3s).
    const dropIfNotFound = (taskId: string, err: unknown) => {
      if (err && typeof err === 'object' && (err as { notFound?: boolean }).notFound) {
        console.warn(`[prompt-task] ${taskId} no longer exists on backend; dropping from pending queue.`);
        setPendingPromptTasks((prev) => {
          if (!(taskId in prev)) return prev;
          const { [taskId]: _drop, ...rest } = prev;
          return rest;
        });
        return true;
      }
      return false;
    };

    // Step 1: Parallel status pre-fetch (like useTaskManager.restoreTasks)
    const restore = async () => {
      await Promise.allSettled(
        entries.map(async ([taskId, taskType]) => {
          try {
            const status = await getPromptTaskStatus(taskId);
            if (status.status === 'DONE' || status.status === 'FAILED') {
              handlePromptTaskResult(taskId, taskType, status);
            }
            // else still RUNNING/PENDING — will be picked up by continuous polling
          } catch (err) {
            if (dropIfNotFound(taskId, err)) return;
            // Network error during restore — will be retried by continuous polling
          }
        })
      );
    };
    restore();

    // Step 2: Continuous polling via setInterval
    const pollInterval = setInterval(async () => {
      const currentTasks = Object.entries(pendingPromptTasks);
      if (currentTasks.length === 0) return;

      await Promise.allSettled(
        currentTasks.map(async ([taskId, taskType]) => {
          try {
            // Non-blocking single status check. Use this (not the
            // blocking `pollPromptTask` loop) so the setInterval
            // cadence stays at ~3s — otherwise a single slow task
            // could hold the polling loop open for the full 5-minute
            // `POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS` window and starve
            // peer tasks of progress updates.
            const status = await getPromptTaskStatus(taskId);
            // Mirror RUNNING updates into the UI even when status
            // doesn't change — the backend updates the in-memory
            // `progress` string every few seconds, which we want to
            // surface immediately rather than only on status change.
            handlePromptTaskResult(taskId, taskType, status);
          } catch (err) {
            if (dropIfNotFound(taskId, err)) return;
            // Polling error — keep task for next interval
          }
        })
      );
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [pendingPromptTasks, handlePromptTaskResult]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track generation state per theme (for multi-select)
  const [themeOutlineStates, setThemeOutlineStates] = useState<Record<number, {
    generating: boolean;
    outlineArc: string;
    outlineScenes: string[];
    panels: { panel_number: number; scene_description: string; image_prompt: string }[];
    historyId?: string;
    error?: string; // error message when generation failed
    startedAt?: number; // Date.now() when generating flipped to true
    progress?: string; // live progress string from the backend (e.g. "正在校验第 3/5 个分镜...")
  }>>(() => {
    const s = getStoryboardSession();
    if (!s?.themeOutlineStates) return {};
    // sessionStorage 中 key 是字符串，需转回 number
    const out: Record<number, any> = {};
    for (const [k, v] of Object.entries(s.themeOutlineStates)) {
      out[Number(k)] = v;
    }
    return out;
  });

  // Tick once per second so the "已等待 X 秒" label and the soft-timeout
  // check can re-render. Re-rendering 1 Hz is fine — these labels only
  // exist on at most a handful of theme cards and the cost is trivial.
  const [, setTick] = useState(0);
  useEffect(() => {
    const hasAnyGenerating = Object.values(themeOutlineStates).some((s) => s.generating);
    if (!hasAnyGenerating) return;
    const id = window.setInterval(() => setTick((n) => (n + 1) % 1_000_000), 1000);
    return () => window.clearInterval(id);
  }, [themeOutlineStates]);

  // Client-side safety net: if the backend task never reports back
  // (polling drops, backend silently fails to set FAILED, etc.), force
  // the per-theme "生成中" UI into an error state after this many ms so
  // the user isn't stuck staring at a spinner with no feedback.
  // 10 min matches the server's hard cap on long-running prompt tasks.
  const OUTLINE_GENERATION_TIMEOUT_MS = 10 * 60 * 1000;
  useEffect(() => {
    const entries = Object.entries(themeOutlineStates).filter(
      ([, s]) => s.generating && typeof s.startedAt === 'number'
        && Date.now() - (s.startedAt as number) > OUTLINE_GENERATION_TIMEOUT_MS
    );
    if (entries.length === 0) return;
    setThemeOutlineStates((prev) => {
      const next = { ...prev };
      for (const [k, s] of entries) {
        next[Number(k)] = {
          ...s,
          generating: false,
          error: '大纲生成超时（10分钟），后端可能仍在后台运行。可手动重试，或到控制台查看任务状态。',
        };
      }
      return next;
    });
    const ids = entries.map(([k]) => Number(k)).join(', ');
    onErrorRef.current?.(`主题大纲生成超时（10分钟）— theme id(s): ${ids}`);
  }, [themeOutlineStates]);

  // Active theme tab (for tab switching between themes) — MUST be declared before sbHistoryId
  const [activeThemeTab, setActiveThemeTab] = useState<number | null>(() => {
    const s = getStoryboardSession();
    return s?.activeThemeTab ?? null;
  });

  // Helper: get the effective historyId for multi-theme mode
  const sbHistoryId = activeThemeTab !== null
    ? (themeOutlineStates[activeThemeTab]?.historyId || currentHistoryId)
    : currentHistoryId;

  // Restore cached panel images on page load — critical for surviving page refresh.
  // On initial mount genStates is empty, but panels + currentHistoryId are restored from
  // sessionStorage via useState initializers. This effect bridges the gap by loading
  // cached images into genStates so panel cards display them immediately.
  useEffect(() => {
    const saved = getStoryboardSession();
    if (!saved?.historyId || !saved?.panels?.length) return;

    const hid = saved.historyId;

    const historyItems = getStoryboardHistory();
    const historyItem = historyItems.find((h) => h.id === hid);
    // Diagnostic: log what we have so it's easy to see in the console why
    // a panel might render as empty after a page refresh.
    console.debug('[storyboard:restore]', {
      hid,
      zipUrl: historyItem?.zipUrl,
      hasPanelImages: !!historyItem?.panelImages,
      panelImageEntries: historyItem?.panelImages ? Object.keys(historyItem.panelImages).length : 0,
      panelImageSample: historyItem?.panelImages ? Object.values(historyItem.panelImages)[0]?.slice(0, 2) : null,
      panelCount: saved.panels.length,
    });
    const initial: Record<string, { loading: boolean; images: string[] }> = {};

    // Source of truth: historyItem.panelImages — the same field the
    // history list now reads. resolvePanelImages already strips orphan
    // hash refs and empty strings, leaving only data: / blob: / http:
    // URLs that <img src> can actually render.
    if (historyItem?.panelImages) {
      const resolved = resolvePanelImages(historyItem.panelImages);
      for (const [idx, imgs] of Object.entries(resolved)) {
        initial[`${hid}_${idx}`] = { loading: false, images: imgs };
      }
    }

    if (Object.keys(initial).length > 0) {
      setGenStates(initial);
    }

    // Background: for any panel slot still empty, ask the per-panel zip
    // for its images and write them back into panelImages. This is a
    // single zip download per missing panel — no unified-store, no
    // djb2 legacy cache, no inline sha256 of the first 2 KB. The point
    // is to be boring and reliable: if the zip is still on RunningHub
    // we re-extract, and we never overwrite a fresh live task result
    // with a stale zip image.
    for (let i = 0; i < saved.panels.length; i++) {
      const key = `${hid}_${i}`;
      const hasUsable = (initial[key]?.images || []).some(
        (img) => img && (img.startsWith('data:') || img.startsWith('blob:') || img.startsWith('http')),
      );
      if (hasUsable) continue;

      const panelZip = historyItem?.panelZipUrls?.[i] || historyItem?.zipUrl;
      if (!panelZip) continue;

      extractImagesFromZipAsDataUrls(panelZip)
        .then((images) => {
          const usable = images.filter((img) => img && img.startsWith('data:'));
          if (usable.length === 0) return;
          setGenStates((prev) => {
            const existing = prev[key];
            // Don't clobber a later-arriving value (e.g. live task finish).
            if (existing?.images.length > 0 && existing.images[0]?.startsWith('data:')) return prev;
            return { ...prev, [key]: { loading: false, images: usable } };
          });
          // Note: do NOT call updateStoryboardHistoryImages here. Each
          // entry's dataURLs are 1-2MB of base64, and the history list
          // is bounded only by MAX_HISTORY (200) — writing 4 panels ×
          // 4 imgs × ~1.5MB per entry is ~24MB, which busts the 5-10MB
          // localStorage quota and cascades into a QuotaExceededError
          // that locks out all subsequent history writes. The image
          // cache (img_cache_<hash>_N) is the right place for that data
          // and is already populated by the live task path.
        })
        .catch((err) => {
          console.debug('[storyboard:restore] panel zip extraction failed for', hid, i, err);
        });
    }
  }, []); // intentionally empty — only runs once on mount

  // ── Derived active values (must be before useEffects that depend on them) ──
  const activeOutlineArc = activeThemeTab !== null ? (themeOutlineStates[activeThemeTab]?.outlineArc || '') : outlineArc;
  const activeOutlineScenes = activeThemeTab !== null ? (themeOutlineStates[activeThemeTab]?.outlineScenes || []) : outlineScenes;
  const activePanels = activeThemeTab !== null ? (themeOutlineStates[activeThemeTab]?.panels || []) : panels;
  const activeThemeInfo = activeThemeTab !== null ? selectedThemes.find((t) => t.id === activeThemeTab) : (selectedTheme || (selectedThemes[0] ?? null));
  // True when the user has selected a theme tab that has no panels yet
  // but is still generating or has failed. Used to keep the panels
  // section mounted (showing a generating placeholder) instead of
  // collapsing it, so the user can seamlessly flip between an
  // in-flight theme and a completed peer.
  const activeThemeTabInFlight = activeThemeTab !== null && activePanels.length === 0 && (
    !!themeOutlineStates[activeThemeTab]?.generating ||
    !!themeOutlineStates[activeThemeTab]?.error
  );

  // ── Mirror HistoryPage's image-loading pattern for the storyboard view ──
  // HistoryPage's `loadImagesForRecord` runs whenever the user lands on a
  // record and populates the gallery asynchronously. The storyboard view
  // was missing an equivalent: after navigating to a different
  // currentHistoryId (e.g. picking a row from the history list, or
  // returning after a refresh) the per-panel cache might be empty in
  // genStates and the user would see blank thumbnails until the next
  // finished task fires. This effect proactively pulls images from the
  // unified + generic cache (loadCachedOrExtractPanelImages' fallback
  // chain) for every panel of the active history, with the same
  // in-flight + error guards used in HistoryPage.
  //
  // genStates is intentionally read via ref so the effect doesn't re-run
  // on every state update (which would re-trigger the load and create
  // a render loop). We only want to react to changes in the active
  // history or panel list.
  const genStatesRef = useRef(genStates);
  genStatesRef.current = genStates;
  const loadedKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const hid = sbHistoryId;
    if (!hid || activePanels.length === 0) return;

    const historyItem = getStoryboardHistory().find((h) => h.id === hid);
    const zipUrl = historyItem?.zipUrl;
    const panelImageCounts = historyItem?.panelImageCounts;

    let cancelled = false;
    (async () => {
      for (let i = 0; i < activePanels.length; i++) {
        if (cancelled) return;
        const key = `${hid}_${i}`;
        if (loadedKeysRef.current.has(key)) continue;
        const state = genStatesRef.current[key];
        if (state?.images.length && state.images[0].startsWith('data:')) {
          loadedKeysRef.current.add(key);
          continue;
        }
        const count = panelImageCounts?.[i] || 4;
        const panelZip = historyItem?.panelZipUrls?.[i] || zipUrl;
        const images = await loadCachedOrExtractPanelImages(panelZip, count, hid, i, panelZip);
        if (cancelled) return;
        if (images.length === 0) continue;
        loadedKeysRef.current.add(key);
        setGenStates((prev) => {
          const existing = prev[key];
          if (existing?.images.length > 0 && existing.images[0]?.startsWith('data:')) return prev;
          return { ...prev, [key]: { loading: false, images } };
        });
      }
    })().catch((err) => {
      console.debug('[storyboard] cache load failed:', err);
    });

    return () => { cancelled = true; };
  }, [sbHistoryId, activePanels]);

  // ── Auto H3 trigger helper ───────────────────────────────────────────────────
  // 图片生成成功后，自动调用 LLM 生成的 H3 Shot 提示词会写入 panelVideoPrompts[idx]（动画提示词区域）。
  // 用 ref 跟踪已触发的分镜，避免重复调用或覆盖用户编辑内容。

  /** 跟踪哪些分镜已经自动触发了 H3 生成（避免用户编辑后再被覆盖或重复调用 LLM）
   * key 格式：${sbHistoryId}_${idx} */
  const autoH3TriggeredRef = useRef<Set<string>>(new Set());

  /** 自动触发的 H3 提示词生成（图片生成成功后自动调用）
   *
   * 流程：
   *   1. panelVideoPrompts[`${sbHistoryId}_${idx}`] 已经存在（非空）→ 跳过（H3 已经生成过或用户编辑过）
   *   2. 空 → 调 expandVideoFromImage 生成场景描述
   *   3. 调用 generateH3ShotPrompt 格式化单个分镜的 Shot 提示词
   *   4. 写入 panelVideoPrompts（动画提示词区域，theme-scoped key）
   *   5. 同时缓存到 panelH3ShotMap / panelH3Prompts 供长视频 1.1 上传使用
   *
   * 错误处理：
   *   - 422 验证错误：跳过，不写入动画提示词区域（用户可手动点击 H3 按钮）
   *   - 其它错误：重试一次，仍失败兜底
   */
  const triggerAutoH3ForPanel = useCallback(async (idx: number, panel: { panel_number: number; image_prompt: string; scene_description?: string }, opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    const curHistoryId = sbHistoryId || 'solo';
    const pK = promptKey(idx, curHistoryId);
    // 已存在 → 不覆盖（避免破坏用户编辑）
    if (panelVideoPrompts[pK] && panelVideoPrompts[pK].trim().length > 0) {
      return;
    }
    // 防御性：image_prompt 不能为空
    if (!panel.image_prompt || panel.image_prompt.trim().length === 0) {
      if (!silent) onError(`分镜 ${panel.panel_number} 的图片提示词为空，跳过 H3 自动生成`);
      return;
    }

    setPanelH3Loading(prev => ({ ...prev, [pK]: true }));
    try {
      // 优先使用 panel.scene_description（来自分镜生成时的场景描述），而不是 themeLabel。
      // 原因：themeLabel（如"公园幽会"）太宽泛，LLM 会扩写成通用的"2人-成人"性描写，
      // 但 image_prompt 描述的可能是单个女人独自坐在公园长椅——文字和图片内容矛盾，
      // 导致最终视频画面与图片不一致。
      // panel.scene_description 是分镜生成时由后端 LLM 基于完整上下文输出的场景描述，
      // 与图片内容最匹配，应该优先用作视频提示词的扩写基础。
      const panelSceneDesc = (panel.scene_description || '').trim();
      const themeLabel = activeThemeInfo?.title || plot || (r18Mode ? 'R18' : '默认主题');
      const sceneDescriptionForLLM = panelSceneDesc || themeLabel;
      let videoRes;
      try {
        videoRes = await expandVideoFromImage(panel.image_prompt, sceneDescriptionForLLM, r18Mode, 1);
      } catch (err) {
        const status = (err && typeof err === 'object' && 'status' in err) ? (err as { status?: number }).status : 0;
        const msg = err instanceof Error ? err.message : String(err);
        if (status === 422 || /422/i.test(msg)) {
          // 422 验证错误：跳过，让用户稍后手动点击 H3 按钮
          console.warn(`[triggerAutoH3ForPanel] 分镜 ${idx + 1} 422，跳过`);
          return;
        }
        // 其它错误：重试一次（用 fast 模型 + 150s 超时）
        try {
          videoRes = await expandVideoFromImage(panel.image_prompt, sceneDescriptionForLLM, r18Mode, 1, ['grok-4.6', 'grok-4.3'], 150000);
        } catch (retryErr) {
          console.warn(`[triggerAutoH3ForPanel] 分镜 ${idx + 1} 重试仍失败`);
          return;
        }
      }

      const videoPrompt = videoRes.results?.[0]?.prompt?.trim();

      // 生成 H3 Shot 提示词
      const shot = generateH3ShotPrompt(
        idx,
        {
          image_prompt: panel.image_prompt,
          scene_description: videoPrompt,
        },
        activePanels.length,
        panelH3Duration,
        r18Mode,
      );

      // 缓存到 shotMap（per-historyId 隔离，多主题互不冲突）
      setPanelH3ShotMap(prev => {
        const next = { ...prev };
        const curMap = new Map(next[curHistoryId] || new Map<number, H3PanelShot>());
        curMap.set(shot.panelIndex, shot);
        next[curHistoryId] = curMap;
        return next;
      });

      // 写入动画提示词区域（核心目标：让动画提示词显示 H3 Shot 提示词）
      setPanelVideoPrompts(prev => ({ ...prev, [pK]: shot.shotPrompt }));

      // 把 Shot 提示词存到 panelH3Prompts（用于卡片预览）
      setPanelH3Prompts(prev => ({ ...prev, [pK]: shot.shotPrompt }));

      if (!silent) onSuccess(`分镜 ${panel.panel_number} 的 H3 提示词已自动生成（图片生成成功触发）`);
    } catch (err) {
      console.warn(`[triggerAutoH3ForPanel] 分镜 ${idx + 1} 异常:`, err);
    } finally {
      setPanelH3Loading(prev => { const next = { ...prev }; delete next[pK]; return next; });
    }
  }, [panelVideoPrompts, activeThemeInfo, plot, panelH3Duration, r18Mode, onSuccess, onError, activePanels.length, sbHistoryId]);

  // ── Subscribe to finished task images and cache them for the storyboard ──
  // This is the primary path: when any task completes, its data URL images are
  // immediately cached into the storyboard panel cache so they survive page refresh.
  // We use the storyboardInfo from the task callback to know exactly which panel to update.
  const { finishedTasks } = useFinishedTaskImages();
  useEffect(() => {
    // Support both ExpandMode's sbHistoryId and StoryboardSection's sb_latest_history_id
    const storyboardHistoryId = sessionStorage.getItem('sb_latest_history_id') || sbHistoryId;
    if (!storyboardHistoryId) return;
    for (const [taskId, info] of Object.entries(finishedTasks)) {
      const { images, storyboardInfo, zipUrl } = info;
      if (!images || images.length === 0) continue;
      const hid = storyboardInfo?.historyId || storyboardHistoryId;
      // If the task has explicit storyboardInfo, use it directly
      if (storyboardInfo && (storyboardInfo.historyId === storyboardHistoryId || storyboardInfo.historyId === sbHistoryId)) {
        const { panelIdx } = storyboardInfo;
        const key = `${hid}_${panelIdx}`;
        setGenStates((prev) => {
          const current = prev[key];
          if (current?.images.length > 0 && current.images[0]?.startsWith('data:')) return prev;
          return { ...prev, [key]: { loading: false, images } };
        });
        cacheStoryboardPanelImages(hid, panelIdx, images).then(() => {
          // Don't write the recovered dataURLs back into
          // history.panelImages — see the comment in the mount effect
          // for the quota math. The unified store already holds the
          // images (via cacheStoryboardPanelImages above), and the
          // getCachedStoryboardPanelImages path in the preview list
          // reads from there.
        });

        // 【自动 H3】图片生成成功后，自动调用 LLM 生成 H3 Shot 提示词，
        // 写入 panelVideoPrompts[idx]（动画提示词区域）。用 ref 防止重复触发。
        const triggerKey = `${hid}_${panelIdx}`;
        if (!autoH3TriggeredRef.current.has(triggerKey)) {
          autoH3TriggeredRef.current.add(triggerKey);
          const panel = activePanels[panelIdx];
          if (panel) {
            // 用 setTimeout 让图像渲染优先，避免和 setState 冲突
            setTimeout(() => {
              triggerAutoH3ForPanel(panelIdx, panel, { silent: true }).catch((err) => {
                console.warn(`[storyboard] auto H3 for panel ${panelIdx + 1} failed:`, err);
                // 触发失败 → 下次图片更新时可重试
                autoH3TriggeredRef.current.delete(triggerKey);
              });
            }, 0);
          }
        }
        continue;
      }
      // Fallback: match by exact prompt (for tasks without explicit
      // storyboardInfo). Substring match was merging tasks from adjacent
      // panels whose prompts share a common prefix.
      for (let i = 0; i < activePanels.length; i++) {
        const panel = activePanels[i];
        const panelPromptNorm = panel.image_prompt.trim().replace(/\s+/g, ' ');
        const matchedTask = taskManager.tasks.find((t) => {
          if (t.id !== taskId || t.images.length === 0) return false;
          const taskPromptNorm = t.prompt.trim().replace(/\s+/g, ' ');
          return taskPromptNorm === panelPromptNorm;
        });
        if (matchedTask) {
          const key = `${hid}_${i}`;
          setGenStates((prev) => {
            const current = prev[key];
            if (current?.images.length > 0 && current.images[0]?.startsWith('data:')) return prev;
            return { ...prev, [key]: { loading: false, images } };
          });
          cacheStoryboardPanelImages(hid, i, images);
          // See the comment in the live path above for why we don't
          // call updateStoryboardHistoryImages here.

          // 【自动 H3】图片生成成功后自动调用 LLM（fallback 路径）
          const triggerKey = `${hid}_${i}`;
          if (!autoH3TriggeredRef.current.has(triggerKey)) {
            autoH3TriggeredRef.current.add(triggerKey);
            setTimeout(() => {
              triggerAutoH3ForPanel(i, activePanels[i], { silent: true }).catch((err) => {
                console.warn(`[storyboard] auto H3 (fallback) for panel ${i + 1} failed:`, err);
                autoH3TriggeredRef.current.delete(triggerKey);
              });
            }, 0);
          }
        }
      }
    }
  }, [finishedTasks, activePanels, sbHistoryId, triggerAutoH3ForPanel]);

  // ── Sync genStates with taskManager.tasks so panel cards reflect live images ──
  // Also converts blob URLs to data URLs immediately so they survive page refresh.
  useEffect(() => {
    const hid = sbHistoryId;
    if (!hid) return;
    setGenStates((prev) => {
      let changed = false;
      const next = { ...prev };
      for (let i = 0; i < activePanels.length; i++) {
        const panel = activePanels[i];
        const panelPromptNorm = panel.image_prompt.trim().replace(/\s+/g, ' ');
        // Prefer storyboardInfo match (set by handleBatchGenerate). Fall back
        // to exact-prompt match — substring match was merging tasks from
        // adjacent panels whose prompts share a common prefix.
        const matchedTask = taskManager.tasks.find((t) => {
          if (t.images.length === 0) return false;
          if (t.storyboardInfo && t.storyboardInfo.historyId === hid) {
            return t.storyboardInfo.panelIdx === i;
          }
          const taskPromptNorm = t.prompt.trim().replace(/\s+/g, ' ');
          return taskPromptNorm === panelPromptNorm;
        });
        const key = `${hid}_${i}`;
        if (matchedTask) {
          const taskImages = matchedTask.images;
          const currentImages = next[key]?.images ?? [];
          // Determine if current images are valid: have data URLs or non-stale blob URLs
          const hasCurrent = currentImages.length > 0;
          const currentIsDataUrl = hasCurrent && currentImages[0].startsWith('data:');
          const taskHasDataUrl = taskImages.length > 0 && taskImages[0].startsWith('data:');
          const shouldUpdate = !hasCurrent ||
            (!currentIsDataUrl && taskHasDataUrl && currentImages[0] !== taskImages[0]) ||
            (!currentIsDataUrl && !taskHasDataUrl && currentImages[0] !== taskImages[0]);

          if (shouldUpdate) {
            next[key] = { loading: false, images: taskImages };
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [taskManager.tasks, activePanels, sbHistoryId]);

  // Persist generated panel images: blob URLs are converted to data URLs immediately
  // and cached so they survive page refresh. Also updates genStates so the UI uses
  // data URLs instead of ephemeral blob URLs.
  // Extracted as component-level function so handleHistoryLoad can call it directly
  // after setGenStates(initial), bypassing React's async state-update timing issue.
  const convertAndCache = useCallback(async (hid: string, states: Record<string, { loading: boolean; images: string[] }>) => {
    const panelImages: Record<number, string[]> = {};
    let needsGenStatesUpdate = false;
    const updates: Record<string, { loading: boolean; images: string[] }> = {};

    for (const [key, state] of Object.entries(states)) {
      const parts = key.split('_');
      const historyIdFromKey = parts.slice(0, -1).join('_');
      const panelIdx = parts[parts.length - 1];
      if (historyIdFromKey !== hid) continue;
      if (!state.images || state.images.length === 0) continue;

      const dataUrlImages = (await Promise.all(state.images.map((img) => ensureDataUrl(img))))
        .filter((s): s is string => !!s);
      if (dataUrlImages.length === 0) continue;

      panelImages[Number(panelIdx)] = dataUrlImages;
      await cacheStoryboardPanelImages(hid, Number(panelIdx), dataUrlImages);
      updates[key] = { loading: false, images: dataUrlImages };
      needsGenStatesUpdate = true;
    }

    if (needsGenStatesUpdate) {
      setGenStates((prev) => {
        const next = { ...prev, ...updates };
        return Object.keys(next).length > 0 ? next : prev;
      });
    }

    // History record persistence intentionally skipped — dataURLs live in the
    // unified store via cacheStoryboardPanelImages; writing back to history.panelImages
    // would multiply localStorage usage ~10x and trip QuotaExceededError.
    console.debug(`[Storyboard] convertAndCache complete: ${Object.keys(panelImages).length} panels cached, ${Object.keys(updates).length} genState keys updated`);
  }, []);

  useEffect(() => {
    const hid = sbHistoryId;
    if (!hid) return;

    const genStateKeys = Object.keys(genStates).filter((k) => k.startsWith(`${hid}_`));
    console.debug(`[Storyboard] convertAndCache effect triggered, hid=${hid}, genStateKeys=${JSON.stringify(genStateKeys)}`);

    let hasNewImages = false;
    for (const [key, state] of Object.entries(genStates)) {
      const parts = key.split('_');
      const historyIdFromKey = parts.slice(0, -1).join('_');
      if (historyIdFromKey !== hid) continue;
      if (state.images && state.images.length > 0 && state.images.some((img) => img.startsWith('blob:'))) {
        hasNewImages = true;
        break;
      }
    }
    if (!hasNewImages) {
      console.debug(`[Storyboard] convertAndCache: no blob images found in genStates for ${hid}`);
      return;
    }

    convertAndCache(hid, genStates);
  }, [genStates, sbHistoryId, convertAndCache]);

  // Video prompt state
  const [videoScript, setVideoScript] = useState<{
    script_title: string; duration: string; panels: {
      panel: number; heading: string; action: string; dialogue: string; sound_cue: string; camera: string;
    }[];
  } | null>(null);
  const [generatingScript, setGeneratingScript] = useState(false);

  // NOTE: 以下 panel* 状态已经在文件顶部声明（line ~3190），
  // 因为它们在 useFinishedTaskImages useEffect 中通过 triggerAutoH3ForPanel 引用。
  // 这里不再重复声明。

  // Image selection and video generation state
  const [selectedPanelImages, setSelectedPanelImages] = useState<Record<string, { index: number; url: string }>>({});
  const [videoGenLoading, setVideoGenLoading] = useState<Record<string, boolean>>({});
  // Per-panel "智能扩写" spinner state for the video prompt editor.
  const [promptEditLoading, setPromptEditLoading] = useState<Record<number, boolean>>({});
  // Per-panel "重新生成图片提示词" spinner state for the image prompt editor.
  // 用 theme-scoped key `${sbHistoryId}_${idx}`，避免多主题切换时串扰。
  const [imagePromptRegenLoading, setImagePromptRegenLoading] = useState<Record<string, boolean>>({});
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewPrompt, setPreviewPrompt] = useState<string>('');
  const [showPreview, setShowPreview] = useState(false);

  // Persist storyboard state
  // Bug fix: 现在持久化 panelVideoPrompts / panelH3Prompts / panelH3CommonParts / panelH3ShotMap，
  // 这些字段之前未持久化，导致用户从「长视频 1.1」/「文生图」/「图生图」返回后动画提示词和 H3 提示词都消失。
  // panelH3CommonParts / panelH3ShotMap 用 plain object 序列化（Map → entries 数组）
  useEffect(() => {
    if (plot || panels.length > 0 || selectedThemes.length > 0) {
      // 把 Map 序列化为 [panelIndex, shot][] 以便 JSON.stringify
      const panelH3ShotMapSerial: Record<string, Array<[number, any]>> = {};
      for (const [historyId, shotMap] of Object.entries(panelH3ShotMap)) {
        panelH3ShotMapSerial[historyId] = Array.from(shotMap.entries());
      }
      saveStoryboardSession({
        plot, panelCount, panels, expandedPanel,
        themeId: selectedThemes[0]?.id,
        themeTitle: selectedThemes[0]?.title,
        outlineArc,
        outlineScenes,
        historyId: currentHistoryId || undefined,
        // 持久化多主题隔离提示词状态（Bug 修复：返回页面后不再丢失）
        panelVideoPrompts: Object.keys(panelVideoPrompts).length > 0 ? panelVideoPrompts : undefined,
        panelH3Prompts: Object.keys(panelH3Prompts).length > 0 ? panelH3Prompts : undefined,
        panelH3ConstraintEnabled: Object.keys(panelH3ConstraintEnabled).length > 0 ? panelH3ConstraintEnabled : undefined,
        panelH3CommonParts: Object.keys(panelH3CommonParts).length > 0 ? panelH3CommonParts : undefined,
        panelH3ShotMap: Object.keys(panelH3ShotMapSerial).length > 0 ? panelH3ShotMapSerial : undefined,
        activeThemeTab,
        themeOutlineStates,
        selectedThemes: selectedThemes.map((t) => ({ id: t.id, title: t.title, description: t.description, tags: t.tags, r18_level: t.r18_level, category: t.category })),
      });
    } else {
      clearStoryboardSession();
    }
  }, [plot, panelCount, panels, expandedPanel, selectedTheme, outlineArc, outlineScenes, currentHistoryId, panelVideoPrompts, panelH3Prompts, panelH3ConstraintEnabled, panelH3CommonParts, panelH3ShotMap, activeThemeTab, themeOutlineStates, selectedThemes]);

  // Step 1: Generate theme options (supports custom description)
  const handleGenerateThemes = async (customDesc?: string, customCnt?: number) => {
    setLoading(true);
    setThemeTaskProgress(null);
    try {
      const desc = customDesc !== undefined ? customDesc : customThemeMode ? customThemeDescription : undefined;
      const cnt = customCnt !== undefined ? customCnt : customThemeCount;
      const res = await generateStoryboardThemes(r18Mode, cnt, desc || undefined, true);

      // Async mode: if task_id returned, track for polling
      // Keep loading=true so the "生成中" indicator stays visible in the theme area
      if (res.task_id) {
        setPendingPromptTasks((prev) => ({ ...prev, [res.task_id!]: 'themes' }));
        setStoryStep('themes');
        // loading stays true until the task completes (handlePromptTaskResult clears it)
        onSuccess(`主题生成任务已提交（可后台运行，屏幕关闭不影响）`);
        return;
      }

      // Sync mode fallback (shouldn't happen with asyncMode=true, but handle it)
      setThemeOptions(res.themes);
      setStoryStep('themes');
      setSelectedThemes([]);
      setPanels([]);
      setOutlineArc('');
      setOutlineScenes([]);
      setThemeOutlineStates({});
      setPanelVideoPrompts({});
      onSuccess(`生成了 ${res.themes.length} 个主题，请选择`);
    } catch (err) {
      onError(err instanceof Error ? err.message : '主题生成失败');
    } finally {
      setLoading(false);
    }
  };

  // Load theme library directly from database (no LLM, no 502 risk)
  const handleOpenThemeLibrary = async () => {
    setThemeLibraryOpen(true);
    setLoadingThemeLibrary(true);
    try {
      const res = await listStoryboardThemes();
      setThemeOptions(res.themes);
      setStoryStep('themes');
      setSelectedThemes([]);
      setPanels([]);
      setOutlineArc('');
      setOutlineScenes([]);
      setThemeOutlineStates({});
      setPanelVideoPrompts({});
    } catch (err) {
      onError(err instanceof Error ? err.message : '主题库加载失败');
    } finally {
      setLoadingThemeLibrary(false);
    }
  };

  // Add a single theme from library to selected themes (for manual selection)
  const handleAddThemeFromLibrary = (theme: { id: number; title: string; description: string; tags: string[]; r18_level: string; category?: string; scenario_count?: number; costume_count?: number }) => {
    if (selectedThemes.some((t) => t.id === theme.id)) return;
    setSelectedThemes((prev) => [...prev, theme]);
  };

  // Remove a theme from selected themes
  const handleRemoveThemeFromSelected = (themeId: number) => {
    setSelectedThemes((prev) => prev.filter((t) => t.id !== themeId));
    // Also reset its outline state if it was generated
    setThemeOutlineStates((prev) => {
      const next = { ...prev };
      delete next[themeId];
      return next;
    });
  };

  // Generate outline for ONE single selected theme (independent, not batch)
  const handleGenerateOutlineSingle = async (theme: { id: number; title: string; description: string; tags: string[]; r18_level: string; category?: string; scenario_count?: number; costume_count?: number }) => {
    // Mark this theme as generating, clear any previous error
    setThemeOutlineStates((prev) => ({
      ...prev,
      [theme.id]: { generating: true, outlineArc: '', outlineScenes: [], panels: [], historyId: undefined, error: undefined, startedAt: Date.now() },
    }));
    try {
      const res = await generateStoryboardOutline(theme.id, theme.title, panelCount, r18Mode, true);

      // Async mode: if task_id returned, track for polling
      if (res.task_id) {
        setPendingPromptTasks((prev) => ({ ...prev, [res.task_id!]: 'outline' }));
        onSuccess(`「${theme.title}」大纲生成任务已提交，正在后台运行（最长约 10 分钟）`);
        return;
      }

      // Sync fallback
      const historyId = addStoryboardHistory({ plot: theme.title, panel_count: panelCount, r18: r18Mode, panels: res.storyboard });
      setThemeOutlineStates((prev) => ({
        ...prev,
        [theme.id]: {
          generating: false,
          outlineArc: res.outline.arc,
          outlineScenes: res.outline.scenes,
          panels: res.storyboard,
          historyId,
          error: undefined,
        },
      }));
      onSuccess(`「${theme.title}」的大纲已生成`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : `「${theme.title}」分镜生成失败`;
      setThemeOutlineStates((prev) => ({
        ...prev,
        [theme.id]: {
          ...prev[theme.id],
          generating: false,
          error: errMsg,
        },
      }));
      onError(errMsg);
    }
  };

  // Generate outlines for ALL selected themes in parallel — partial success is OK
  const handleGenerateSelectedThemes = async () => {
    if (selectedThemes.length === 0) return;
    onSuccess(`开始为 ${selectedThemes.length} 个主题并行生成大纲...`);
    // Promise.allSettled ensures all run even if one fails — no short-circuit
    const results = await Promise.allSettled(selectedThemes.map((theme) => handleGenerateOutlineSingle(theme)));
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      onSuccess(`完成：${succeeded} 个成功，${failed} 个失败（点击失败卡片重试）`);
    } else {
      onSuccess(`全部 ${succeeded} 个主题大纲生成完成`);
    }
  };

  // Step 2: Generate outline + panels from selected theme
  const handleGenerateOutline = async () => {
    if (!selectedTheme) { onError('请先选择一个主题'); return; }
    setGeneratingOutline(true);
    try {
      const res = await generateStoryboardOutline(selectedTheme.id, selectedTheme.title, panelCount, r18Mode, true);

      // Async mode: track for polling
      if (res.task_id) {
        setPendingPromptTasks((prev) => ({ ...prev, [res.task_id!]: 'outline' }));
        onSuccess(`分镜生成任务已提交（可后台运行，屏幕关闭不影响）`);
        setGeneratingOutline(false);
        return;
      }

      // Sync fallback
      const historyId = addStoryboardHistory({ plot: selectedTheme.title, panel_count: panelCount, r18: r18Mode, panels: res.storyboard });
      setOutlineArc(res.outline.arc);
      setOutlineScenes(res.outline.scenes);
      setPanels(res.storyboard);
      setExpandedPanel(null);
      setStoryStep('panels');
      setCurrentHistoryId(historyId);
      setPanelVideoPrompts({});
      saveStoryboardSession({
        plot: selectedTheme.title, panelCount, panels: res.storyboard, expandedPanel: null,
        themeId: selectedTheme.id, themeTitle: selectedTheme.title,
        outlineArc: res.outline.arc, outlineScenes: res.outline.scenes, historyId,
      });
      setHistory(getStoryboardHistory());
      onSuccess(`剧情大纲已生成，${res.storyboard.length} 个分镜就绪`);
    } catch (err) {
      onError(err instanceof Error ? err.message : '分镜生成失败');
    } finally {
      setGeneratingOutline(false);
    }
  };

  // Generate outline for a specific theme (multi-select mode) - independent execution
  const handleGenerateOutlineForTheme = async (theme: { id: number; title: string; description: string; tags: string[]; r18_level: string; category?: string; scenario_count?: number; costume_count?: number }) => {
    // Mark as generating immediately so UI reflects live progress
    setThemeOutlineStates((prev) => ({
      ...prev,
      [theme.id]: { generating: true, outlineArc: '', outlineScenes: [], panels: [], historyId: prev[theme.id]?.historyId, error: undefined, startedAt: Date.now() },
    }));
    try {
      const res = await generateStoryboardOutline(theme.id, theme.title, panelCount, r18Mode, true);

      // Async mode: track for polling
      if (res.task_id) {
        setPendingPromptTasks((prev) => ({ ...prev, [res.task_id!]: 'outline' }));
        onSuccess(`「${theme.title}」大纲生成任务已提交，正在后台运行（最长约 10 分钟）`);
        return;
      }

      // Sync fallback
      const historyId = addStoryboardHistory({ plot: theme.title, panel_count: panelCount, r18: r18Mode, panels: res.storyboard });
      setThemeOutlineStates((prev) => ({
        ...prev,
        [theme.id]: {
          generating: false,
          outlineArc: res.outline.arc,
          outlineScenes: res.outline.scenes,
          panels: res.storyboard,
          historyId,
          error: undefined,
        },
      }));
      onSuccess(`「${theme.title}」的大纲已生成`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : `「${theme.title}」分镜生成失败`;
      setThemeOutlineStates((prev) => ({
        ...prev,
        [theme.id]: {
          ...prev[theme.id],
          generating: false,
          error: errMsg,
        },
      }));
      onError(errMsg);
    }
  };

  // Generate outlines for all selected themes independently (each updates its own card state)
  const handleGenerateMultipleOutlines = async () => {
    if (selectedThemes.length === 0) return;
    onSuccess(`开始为 ${selectedThemes.length} 个主题独立生成大纲...`);
    await Promise.all(selectedThemes.map((theme) => handleGenerateOutlineForTheme(theme)));
    onSuccess(`已完成 ${selectedThemes.length} 个主题的大纲生成`);
  };

  // View panels for a specific theme in multi-select mode
  //
  // Bug fix (q3+): previous version early-returned when the state didn't
  // exist, and wiped `genStates` to `{}` when the theme was still
  // generating. The cascade was:
  //   1. User clicked the in-flight theme's tab → setGenStates({})
  //      wiped every other completed theme's genStates, throwing
  //      away their cached images.
  //   2. activePanels.length === 0 (because the generating theme has
  //      no panels yet) → entire panels UI hidden, looking like the
  //      app "exited back to the linear page".
  //   3. Clicking back to the completed theme → its genStates were
  //      empty, so the panels rendered blank.
  //
  // The fix: always update activeThemeTab/storyStep, never overwrite
  // genStates wholesale (only fill in the keys that belong to this
  // theme), and let the render path show a "generating" UI for in-flight
  // themes instead of hiding the panel area.
  const handleViewThemePanels = (themeId: number) => {
    const state = themeOutlineStates[themeId];
    setActiveThemeTab(themeId);
    setStoryStep('panels');

    // Only fill in the genStates entries for THIS theme; never touch
    // other themes' entries. We use a partial update (merge), so a
    // completed theme's cached images remain intact while the user
    // browses a peer theme that's still generating.
    if (state?.historyId) {
      setCurrentHistoryId(state.historyId);
      const cachedImages = getAllCachedPanelImages(state.historyId, state.panels.length);
      if (Object.keys(cachedImages).length > 0) {
        setGenStates((prev) => {
          const next = { ...prev };
          for (const [idx, imgs] of Object.entries(cachedImages)) {
            next[`${state.historyId}_${idx}`] = { loading: false, images: imgs };
          }
          return next;
        });
      }
    }

    // Don't announce "loaded" for in-flight themes — that message
    // implies the panels are ready, which they aren't. The render
    // path will show the generating UI instead.
    if (state?.panels && state.panels.length > 0) {
      const themeTitle = themeOptions.find((t) => t.id === themeId)?.title;
      onSuccess(`已加载「${themeTitle}」的分镜`);
    } else if (state?.error) {
      onSuccess(`「${themeOptions.find((t) => t.id === themeId)?.title}」生成失败`);
    } else if (state?.generating) {
      const themeTitle = themeOptions.find((t) => t.id === themeId)?.title;
      onSuccess(`「${themeTitle}」正在生成大纲…`);
    }
  };

  // Load a specific theme's panels to the main panel area
  //
  // Bug fix (q3+): previous version overwrote `genStates` wholesale
  // with only the new theme's keys, wiping peer themes' cached images.
  // Now we merge instead of replace, so peer themes' genStates survive
  // a tab switch.
  const handleLoadThemeToPanels = (themeId: number) => {
    const state = themeOutlineStates[themeId];
    if (!state) return;
    const theme = themeOptions.find((t) => t.id === themeId);
    // Set active tab to this theme
    setActiveThemeTab(themeId);
    setStoryStep('panels');
    if (theme && state.historyId) {
      // Reuse existing history entry instead of creating a duplicate
      const historyId = state.historyId;
      setCurrentHistoryId(historyId);
      // Restore cached images for this history entry; merge into
      // existing genStates instead of replacing, so peer themes keep
      // their cached images intact.
      const cachedImages = getAllCachedPanelImages(historyId, state.panels.length);
      if (Object.keys(cachedImages).length > 0) {
        setGenStates((prev) => {
          const next = { ...prev };
          for (const [idx, imgs] of Object.entries(cachedImages)) {
            next[`${historyId}_${idx}`] = { loading: false, images: imgs };
          }
          return next;
        });
      }
      saveStoryboardSession({
        plot: theme.title, panelCount, panels: state.panels, expandedPanel: null,
        themeId: theme.id, themeTitle: theme.title, outlineArc: state.outlineArc,
        outlineScenes: state.outlineScenes, historyId,
      });
      setHistory(getStoryboardHistory());
    }
    onSuccess(`已加载「${theme?.title}」到分镜区`);
  };

  // Reset everything
  const handleReset = () => {
    setPlot('');
    setPanels([]);
    setExpandedPanel(null);
    setThemeOptions([]);
    setSelectedTheme(null);
    setSelectedThemes([]);
    setOutlineArc('');
    setOutlineScenes([]);
    setVideoScript(null);
    setPanelVideoPrompts({});
    setPanelH3Prompts({});
    setPanelH3CommonParts({});
    setPanelH3ShotMap({});
    autoH3TriggeredRef.current.clear();
    setStoryStep('themes');
    setGenStates({});
    setCurrentHistoryId(null);
    clearStoryboardSession();
  };

  // Generate video script
  const handleGenerateScript = async () => {
    if (panels.length === 0) { onError('先生成分镜'); return; }
    setGeneratingScript(true);
    try {
      // Explicit model order: try grok-4.6 first; if it fails (timeout,
      // 5xx, content filter, etc.) backend's call_grok() automatically
      // falls back to grok-4.3. Same chain used for per-panel regen below.
      const modelOrder = ['grok-4.6', 'grok-4.3'];
      const res = await generateVideoScript(selectedTheme?.title || '默认主题', r18Mode, panels, true, modelOrder);

      // Async mode: track for polling
      if (res.task_id) {
        setPendingPromptTasks((prev) => ({ ...prev, [res.task_id!]: 'script' }));
        onSuccess(`视频脚本生成任务已提交（可后台运行）`);
        setGeneratingScript(false);
        return;
      }

      // Sync fallback
      setVideoScript(res);

      // 【修复】把脚本里的 action 回填到每个分镜的"动画提示词"位置
      // 把后端返回的 VideoScriptPanel 按 panel 编号映射回 panels 数组的 idx，
      // 然后用 extractVideoPromptFromImagePrompt 以"后端 action（剧情）" + "图片 prompt" 双重输入，
      // 生成"以剧情为核心、围绕首帧画面"的 Wan2.2 中文视频提示词。
      // 注意：使用 promptKey(idx, sbHistoryId) 作 key，避免多主题时互相覆盖。
      const scriptHistoryId = sbHistoryId || 'solo';
      const nextPrompts: Record<string, string> = {};
      for (let i = 0; i < panels.length; i++) {
        const panel = panels[i];
        const scriptPanel = res.panels.find((sp) => sp.panel === panel.panel_number) || res.panels[i];
        if (!scriptPanel) continue;
        // 合并"后端 action（剧情主体）" + "dialogue + heading + sound_cue + camera（环境/氛围）"
        const sceneForPrompt = [
          scriptPanel.action,
          scriptPanel.heading,
          scriptPanel.dialogue ? `对白：${scriptPanel.dialogue}` : '',
          scriptPanel.sound_cue ? `音效：${scriptPanel.sound_cue}` : '',
          scriptPanel.camera ? `镜头：${scriptPanel.camera}` : '',
        ].filter(Boolean).join('；');
        // 重新以"剧情为优先"生成视频提示词（覆盖"按图片 prompt 推测"的结果）
        nextPrompts[promptKey(i, scriptHistoryId)] = extractVideoPromptFromImagePrompt({
          imagePrompt: panel.image_prompt,
          sceneDescription: sceneForPrompt,
          r18Mode,
        });
      }
      setPanelVideoPrompts(prev => ({ ...prev, ...nextPrompts }));
      onSuccess(`视频脚本已生成，已回填到 ${Object.keys(nextPrompts).length} 个分镜的动画提示词`);
    } catch (err) {
      onError(err instanceof Error ? err.message : '脚本生成失败');
    } finally {
      setGeneratingScript(false);
    }
  };

  const handleRegenerateVideoPrompt = useCallback(async (panelIdx: number) => {
    const panel = panels[panelIdx];
    if (!panel) { onError('找不到对应的分镜'); return; }
    const requestStartTime = Date.now();
    // 走专用 i2v 端点 /api/prompt/expand/video-from-image。
    // 后端用 wan2.2 专用 system prompt：image_prompt 作为"画面锚"(禁止复述)、
    // scene_description 作为"动作目标"(扩写对象)，输出严格符合 wan2.2 i2v 格式
    // 的一段英文视频提示词（50-120 词，shota framing + 动作 + 镜头 + 质量尾巴）。
    // 不走通用 /api/prompt/expand 那个链路，因为那个 system prompt 不区分"画面已
    // 锁定"的 i2v 场景，输出会很长、且会塞场景/背景/外观等对图生视频无用的描述。
    const theme = selectedTheme?.title || activeThemeInfo?.title || '默认主题';
    const imageAnchor = panel.image_prompt?.trim() || '';
    const actionToExpand = panel.scene_description?.trim() || 'subtle natural micro-movement, slight head turn, breathing';
    console.log('[智能扩写] 开始（走 wan2.2 i2v 端点）', {
      panelIdx,
      panelNumber: panel.panel_number,
      theme,
      r18Mode,
      imageAnchorLength: imageAnchor.length,
      actionToExpandLength: actionToExpand.length,
    });
    setPromptEditLoading((prev) => ({ ...prev, [panelIdx]: true }));
    try {
      let res;
      try {
        res = await expandVideoFromImage(imageAnchor, actionToExpand, r18Mode, 1);
      } catch (firstErr) {
        const isTimeout = firstErr instanceof Error &&
          (firstErr.message.includes('超时') || firstErr.message.includes('timeout'));
        if (isTimeout) {
          console.warn(`[handleRegenerateVideoPrompt] 超时，尝试 fast 模型重试（150s）`);
          // retry：跳过默认慢模型，直接用 fast 模型，并延长超时到 150s
          res = await expandVideoFromImage(imageAnchor, actionToExpand, r18Mode, 1, ['grok-4.6', 'grok-4.3'], 150000);
        } else {
          throw firstErr;
        }
      }
      const elapsedMs = Date.now() - requestStartTime;
      console.log('[智能扩写] i2v 返回', {
        panelIdx,
        panelNumber: panel.panel_number,
        elapsedMs,
        resultsCount: res.results?.length ?? 0,
        results: res.results,
      });

      const first = res.results?.[0];
      if (!first?.prompt) {
        throw new Error('智能扩写返回为空，请重试');
      }

      const newPrompt = first.prompt.trim();
      console.log('[智能扩写] 写入新提示词', {
        panelIdx,
        panelNumber: panel.panel_number,
        newPromptLength: newPrompt.length,
        newPrompt,
      });
      // 主题-scoped key：避免切换主题后另一主题的提示词被覆盖
      setPanelVideoPrompts((prev) => ({ ...prev, [promptKey(panelIdx, sbHistoryId)]: newPrompt }));
      onSuccess(`分镜 ${panel.panel_number} 的动画提示词已智能扩写（Wan2.2 格式）`);
    } catch (err) {
      const elapsedMs = Date.now() - requestStartTime;
      console.error('[智能扩写] 失败', {
        panelIdx,
        panelNumber: panel.panel_number,
        elapsedMs,
        errorName: err instanceof Error ? err.name : String(err),
        errorMessage: err instanceof Error ? err.message : String(err),
        errorStack: err instanceof Error ? err.stack : undefined,
      });
      onError(err instanceof Error ? err.message : '智能扩写失败');
    } finally {
      setPromptEditLoading((prev) => {
        const next = { ...prev };
        delete next[panelIdx];
        return next;
      });
    }
  }, [panels, selectedTheme, activeThemeInfo, r18Mode, onError, onSuccess, sbHistoryId]);

  const handleCopyPanel = (panel: { image_prompt: string }, idx: number) => { navigator.clipboard.writeText(panel.image_prompt).then(() => { setCopiedPanel(idx); setTimeout(() => setCopiedPanel(null), 2000); }); };
  const handleCopyAll = () => { navigator.clipboard.writeText(panels.map((p) => `[Panel ${p.panel_number}]\n${p.image_prompt}`).join('\n\n')).then(() => { setCopiedPanel(-1); setTimeout(() => setCopiedPanel(null), 2000); }); };
  const handleDeleteHistory = (id: string) => { removeStoryboardHistory(id); setHistory(getStoryboardHistory()); };
  const handleHistoryLoad = async (item: StoryboardHistoryItem) => {
    // 防御：旧历史记录可能没有 panels 字段，避免 setPanels(undefined) 导致崩溃
    if (!item.panels || item.panels.length === 0) {
      console.warn('[handleHistoryLoad] 历史记录缺少 panels 数据，item=', item);
      onError?.('该历史记录缺少分镜数据，请重新生成分镜');
      return;
    }

    setShowHistory(false);  // 先关闭历史面板，避免 React 批处理时状态混乱
    setStoryStep('panels');
    setPlot(item.plot);
    setPanels(item.panels);
    setVideoScript(null);
    setPanelVideoPrompts({});
    setOutlineArc('');
    setOutlineScenes([]);
    setSelectedThemes([]);
    setThemeOutlineStates({});
    setCurrentHistoryId(item.id);
    sessionStorage.setItem('sb_latest_history_id', item.id);

    // Restore images for this history entry from three sources (same priority as HistoryPage):
    // 1. direct panelImages field in history record (fastest, already in memory)
    // 2. panel image cache (sb_panel_v2_ keys — survives page refresh)
    // 3. zip extraction fallback (guarantees images show even when cache is empty)
    const initial: Record<string, { loading: boolean; images: string[] }> = {};

    if (item.panelImages) {
      const resolved = resolvePanelImages(item.panelImages);
      for (const [idx, imgs] of Object.entries(resolved)) {
        initial[`${item.id}_${idx}`] = { loading: false, images: imgs };
      }
    }

    setGenStates(initial);

    // Save theme title to session so handleBatchGenerate can use it even after selectedThemes is cleared
    saveStoryboardSession({
      plot: item.plot, panelCount: item.panel_count, panels: item.panels, expandedPanel: null,
      themeTitle: item.plot, historyId: item.id,
    });
    // Also update selectedTheme so activeThemeInfo is populated for batch generate
    setSelectedTheme({ id: 0, title: item.plot, description: '', tags: [], r18_level: '', category: undefined });

    // Background: pull images from each panel's zip for any panel slot
    // still empty. Same "ask the zip" path used by the mount effect and
    // the history list preview — no unified store, no djb2 cache, no
    // shadow djb2 path. The zip is the authoritative source.
    // 立即调用 convertAndCache：解决 React 异步 state-update 时序问题，
    // 确保刚加载的图片（initial 中的 data URL）被立即缓存到 unified store，
    // 避免因 effect 触发时 genStates 仍为旧值而导致图片破裂。
    convertAndCache(item.id, initial);
    for (let i = 0; i < item.panels.length; i++) {
      const key = `${item.id}_${i}`;
      const current = initial[key];
      if (current?.images.length > 0 && current.images[0]?.startsWith('data:')) continue;

      const panelZip = item.panelZipUrls?.[i] || item.zipUrl;
      if (!panelZip) continue;

      extractImagesFromZipAsDataUrls(panelZip)
        .then((images) => {
          const usable = images.filter((img) => img && img.startsWith('data:'));
          if (usable.length === 0) return;
          setGenStates((prev) => {
            const existing = prev[key];
            if (existing?.images.length > 0 && existing.images[0]?.startsWith('data:')) return prev;
            return { ...prev, [key]: { loading: false, images: usable } };
          });
          // Don't write the recovered dataURLs back into
          // history.panelImages — the per-entry payload would blow the
          // localStorage quota and cascade into QuotaExceededError on
          // every subsequent history save.
        })
        .catch((err) => {
          console.debug('[handleHistoryLoad] panel zip extraction failed for', item.id, i, err);
        });
    }
  };

  const handleToggleFavorite = (imageUrl: string, prompt?: string) => {
    // Match by either the new hash-ref format (imageRef is a small hash
    // pointing into the unified cache) or the legacy format where
    // imageRef was the data URL itself. Also check the resolved imageUrl
    // field for any leftover data URL references from older code paths.
    const existing = favorites.find(
      (f) =>
        f.imageRef === imageUrl ||
        f.imageUrl === imageUrl ||
        (typeof f.imageRef === 'string' && f.imageRef.startsWith('data:') && f.imageRef === imageUrl),
    );
    if (existing) {
      removeFavorite(existing.id);
      setFavorites(getFavorites());
    } else {
      const ok = addFavorite({ imageUrl, prompt, source: 'storyboard', r18: r18Mode });
      if (ok) {
        setFavorites(getFavorites());
      } else {
        onError?.('收藏失败：存储空间已满，请先清理浏览器数据');
      }
    }
  };

  // Handles single-panel image generation (called from StoryboardSection per-panel button).
  // Uses sb_latest_history_id from sessionStorage if available, otherwise sbHistoryId.
  // This ensures the finished-task effect can cache images back to the correct history entry.
  const handleStoryboardGenerateImage = useCallback(async (panelIdx: number, prompt: string) => {
    console.log(`[handleStoryboardGenerateImage] panelIdx=${panelIdx}, digitalHumanMode=${digitalHumanMode}, selectedGirlfriend=${!!selectedGirlfriend}, prompt length=${prompt.length}, prompt preview=${prompt.slice(0, 100)}`);
    if (!prompt.trim()) {
      onError('分镜内容为空，请先生成分镜');
      return;
    }
    if (taskManager.isFull) { onError('任务队列已满'); return; }
    const hid = sessionStorage.getItem('sb_latest_history_id') || sbHistoryId || `temp_${Date.now()}`;
    const key = `${hid}_${panelIdx}`;
    const storyboardInfo = { historyId: hid, panelIdx };
    setGenStates((prev) => ({ ...prev, [key]: { loading: true, images: [] } }));
    let imagePath = selectedGirlfriend?.portraitUrl || '';
    let downloadUrl = '';
    if (digitalHumanMode && selectedGirlfriend) {
      try {
        const file = await gfUrlToFile(selectedGirlfriend.portraitUrl, selectedGirlfriend.id);
        const uploadResult = await uploadImage(apiKey, file);
        imagePath = uploadResult.imagePath;
        downloadUrl = uploadResult.downloadUrl;
      } catch {
        setGenStates((prev) => { const next = { ...prev }; delete next[key]; return next; });
        onError('AI 女友图片上传失败'); return;
      }
    }
    if (digitalHumanMode && selectedGirlfriend) {
      const charId = (selectedGirlfriend.id as string).toUpperCase().slice(0, 4);
      const anchorPrompt = `【严格锁定】严格锁定图中22岁女性（ID:${charId}），完全保留原有面部特征，五官轮廓、脸型、眼睛、鼻子、嘴唇、发型、肤色、身材比例完全不变，不做任何面部修改，动作流畅不僵硬。超高清8K，写实细节，皮肤质感细腻，无畸变、无模糊、无穿模。`;
      const finalPrompt = `${anchorPrompt}\n\n${prompt}`;
      const nodes = buildImg2ImgNodeList({
        prompt: finalPrompt,
        imagePath: downloadUrl || imagePath,
        aspectRatio: img2imgAspectRatio,
      });
      try {
        await taskManager.addTask('img2img', nodes, finalPrompt, WORKFLOW.IMAGE_TO_IMAGE, undefined, storyboardInfo, 'storyboard', activeThemeInfo?.title || plot || undefined, panelIdx + 1);
        onSuccess('分镜图片任务已提交');
      } catch (err) {
        onError(err instanceof Error ? err.message : '提交失败');
        setGenStates((prev) => { const next = { ...prev }; delete next[key]; return next; });
      }
    } else {
      const finalPrompt = withQualityBoost(prompt);
      const nodes = buildTxt2ImgNodeList(buildUnifiedTxt2ImgOptions(finalPrompt));
      try {
        await taskManager.addTask('txt2img', nodes, finalPrompt, undefined, undefined, storyboardInfo, 'storyboard', activeThemeInfo?.title || plot || undefined, panelIdx + 1);
        console.log(`[handleStoryboardGenerateImage] submitted txt2img task, prompt length=${finalPrompt.length}, nodes=`, JSON.stringify(nodes));
        onSuccess('分镜图片任务已提交');
      } catch (err) {
        onError(err instanceof Error ? err.message : '提交失败');
        setGenStates((prev) => { const next = { ...prev }; delete next[key]; return next; });
      }
    }
  }, [taskManager, onError, onSuccess, digitalHumanMode, selectedGirlfriend, apiKey, sbHistoryId, activeThemeInfo, plot]);

  /** 重新生成分镜的图片提示词（panel.image_prompt）。
   *
   * 使用 expandPrompt(type='image') 走图片扩写链路，结果覆盖到 panels[idx]
   * 或 themeOutlineStates[activeThemeTab].panels[idx]，取决于当前是单主题
   * 还是多主题模式。覆盖后会同步刷新缓存的 panelPrompt 派生值，并清掉
   * 该分镜的"动画提示词 / H3 提示词"，因为旧提示词是基于过期的 image_prompt
   * 生成的，留着会让用户看到与新图片提示词不一致的视频提示词。
   *
   * 错误处理：
   *   - 422 验证错误：跳过，不写入（用户可手动点击重试）
   *   - 其它错误（超时/500/网络）：用 fast 模型重试一次（150s 超时）
   */
  const handleRegenerateImagePrompt = useCallback(async (panelIdx: number, panel: { panel_number: number; scene_description: string; image_prompt: string }) => {
    const curHistoryId = sbHistoryId || 'solo';
    const regenKey = `${curHistoryId}_${panelIdx}`;
    const sceneDesc = panel.scene_description?.trim();
    if (!sceneDesc) {
      onError(`分镜 ${panel.panel_number} 的场景描述为空，无法重新生成图片提示词`);
      return;
    }
    const themeLabel = activeThemeInfo?.title || plot || (r18Mode ? 'R18' : '默认主题');
    console.log('[重新生成图片提示词] 开始', {
      panelIdx,
      panelNumber: panel.panel_number,
      sceneDescLength: sceneDesc.length,
      currentImagePromptLength: panel.image_prompt?.length || 0,
    });
    setImagePromptRegenLoading((prev) => ({ ...prev, [regenKey]: true }));
    try {
      let res;
      try {
        res = await expandPrompt(sceneDesc, 'image', r18Mode, 1);
      } catch (firstErr) {
        const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
        const isTimeout = firstErr instanceof Error &&
          (firstErr.message.includes('超时') || firstErr.message.includes('timeout'));
        // 422 验证错误：直接抛出去，不重试
        if (/422/i.test(msg)) {
          console.warn('[重新生成图片提示词] 422 错误，跳过重试');
          throw firstErr;
        }
        if (isTimeout) {
          console.warn('[重新生成图片提示词] 超时，尝试 fast 模型重试（150s）');
          res = await expandPrompt(sceneDesc, 'image', r18Mode, 1, 0, undefined, false, undefined, ['grok-4.6', 'grok-4.3']);
        } else {
          throw firstErr;
        }
      }
      const first = res.results?.[0];
      if (!first?.prompt) {
        throw new Error('扩写返回为空，请重试');
      }
      const newPrompt = first.prompt.trim();
      console.log('[重新生成图片提示词] 新提示词长度=', newPrompt.length);

      // 写入到 panels 或 themeOutlineStates（取决于模式）
      if (activeThemeTab !== null) {
        setThemeOutlineStates((prev) => {
          const cur = prev[activeThemeTab];
          if (!cur) return prev;
          const nextPanels = (cur.panels || []).map((p, i) =>
            i === panelIdx ? { ...p, image_prompt: newPrompt } : p
          );
          return { ...prev, [activeThemeTab]: { ...cur, panels: nextPanels } };
        });
      } else {
        setPanels((prev) => prev.map((p, i) =>
          i === panelIdx ? { ...p, image_prompt: newPrompt } : p
        ));
      }

      // 同步清掉旧 prompt 派生出来的"动画提示词 / H3 提示词"缓存
      // （这些 prompt 是基于过期的 image_prompt 生成的，留着会让 UI 显示与新
      //  image_prompt 不一致的视频提示词）。
      const pK = promptKey(panelIdx, curHistoryId);
      setPanelVideoPrompts((prev) => {
        if (!(pK in prev)) return prev;
        const next = { ...prev };
        delete next[pK];
        return next;
      });
      setPanelH3Prompts((prev) => {
        if (!(pK in prev)) return prev;
        const next = { ...prev };
        delete next[pK];
        return next;
      });
      setPanelH3ShotMap((prev) => {
        const cur = prev[curHistoryId];
        if (!cur || !cur.has(panelIdx + 1)) return prev;
        const nextMap = new Map(cur);
        nextMap.delete(panelIdx + 1);
        return { ...prev, [curHistoryId]: nextMap };
      });
      // 允许自动 H3 重新触发
      autoH3TriggeredRef.current?.delete(`${curHistoryId}_${panelIdx}`);

      onSuccess(`分镜 ${panel.panel_number} 的图片提示词已重新生成`);
    } catch (err) {
      console.error('[重新生成图片提示词] 失败', err);
      onError(err instanceof Error ? err.message : '图片提示词重新生成失败');
    } finally {
      setImagePromptRegenLoading((prev) => {
        const next = { ...prev };
        delete next[regenKey];
        return next;
      });
    }
  }, [sbHistoryId, activeThemeInfo, plot, r18Mode, onSuccess, onError, activeThemeTab]);

  /** 允许用户在分镜卡片里直接编辑图片提示词（持久化到 panels / themeOutlineStates）。
   * 注意：image_prompt 是 LLM 扩写结果，用户编辑后会影响后续 image 生成时的提示词，
   * 所以改完要同步刷新 genStates 派生键（如果已生过图，缓存的图片保持不变，但新点击
   * "生图"会用新 prompt）。 */
  const handleImagePromptChange = useCallback((panelIdx: number, newPrompt: string) => {
    if (activeThemeTab !== null) {
      setThemeOutlineStates((prev) => {
        const cur = prev[activeThemeTab];
        if (!cur) return prev;
        const nextPanels = (cur.panels || []).map((p, i) =>
          i === panelIdx ? { ...p, image_prompt: newPrompt } : p
        );
        return { ...prev, [activeThemeTab]: { ...cur, panels: nextPanels } };
      });
    } else {
      setPanels((prev) => prev.map((p, i) =>
        i === panelIdx ? { ...p, image_prompt: newPrompt } : p
      ));
    }
  }, [activeThemeTab]);

  /** 允许用户在分镜卡片里直接编辑 H3 提示词（持久化到 panelH3Prompts）。 */
  const handlePanelH3PromptChange = useCallback((panelIdx: number, newPrompt: string) => {
    const curHistoryId = sbHistoryId || 'solo';
    const pK = promptKey(panelIdx, curHistoryId);
    setPanelH3Prompts((prev) => ({ ...prev, [pK]: newPrompt }));
  }, [sbHistoryId]);

  /** 切换 H3 强制约束开关（per historyId 隔离） */
  const handleTogglePanelH3Constraint = useCallback(() => {
    const curHistoryId = sbHistoryId || 'solo';
    setPanelH3ConstraintEnabled((prev) => ({
      ...prev,
      [curHistoryId]: !prev[curHistoryId],
    }));
  }, [sbHistoryId]);

  // Handle image selection for a panel
  const handleSelectPanelImage = useCallback((panelKey: string, imageIndex: number, imageUrl: string) => {
    setSelectedPanelImages(prev => ({
      ...prev,
      [panelKey]: { index: imageIndex, url: imageUrl }
    }));
  }, []);

  // Handle preview images
  const handlePreviewImage = useCallback((images: string[], index: number, prompt?: string) => {
    setPreviewImages(images);
    setPreviewIndex(index);
    setPreviewPrompt(prompt || '');
    setShowPreview(true);
  }, []);

  // Handle downloading a single image from a storyboard panel. Mirrors the
  // download action used in HistoryPage so users have a consistent way to
  // save generated images without leaving the storyboard view.
  const handleDownloadImage = useCallback((imageUrl: string) => {
    try {
      const a = document.createElement('a');
      a.href = imageUrl;
      // Data URLs come through as `data:image/png;base64,...` — the browser
      // will derive the right extension from the MIME type. For blob URLs we
      // let the browser decide as well. Fall back to "png" if neither
      // sniffable pattern matches.
      const mimeMatch = imageUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);/);
      const ext = mimeMatch ? mimeMatch[1].split('/')[1] : 'png';
      a.download = `storyboard-${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error('[handleDownloadImage] failed:', err);
    }
  }, []);

  // Handle direct video generation from storyboard panel.
  // Receives the already-computed `videoPrompt` (which was derived in the
  // StoryboardMode render using BOTH image_prompt and scene_description via
  // extractVideoPromptFromImagePrompt). We just pass it through.
  const handleDirectGenerateVideo = useCallback(async (panelKey: string, imageUrl: string, videoPrompt: string) => {
    setVideoGenLoading(prev => ({ ...prev, [panelKey]: true }));
    try {
      let imagePath = imageUrl;
      if (imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) {
        try {
          const res = await fetch(imageUrl);
          const blob = await res.blob();
          const file = new File([blob], `storyboard_${Date.now()}.jpg`, { type: 'image/jpeg' });
          const { imagePath: uploadedPath } = await uploadImage(apiKey, file);
          imagePath = uploadedPath;
        } catch {
          onError('图片上传失败，请重试');
          setVideoGenLoading(prev => { const next = { ...prev }; delete next[panelKey]; return next; });
          return;
        }
      }

      // videoPrompt is now sourced from panelVideoPrompts[idx] directly.
      // It is set either by:
      //   - User manually editing the animation prompt textarea, or
      //   - The auto-H3 trigger that runs after image generation succeeds.
      // No legacy dual-input fallback here (extractVideoPromptFromImagePrompt).
      const finalVideoPrompt = videoPrompt;
      if (!finalVideoPrompt) {
        onError('动画提示词为空，请等待 H3 自动生成完成或手动填写');
        setVideoGenLoading(prev => { const next = { ...prev }; delete next[panelKey]; return next; });
        return;
      }

      // Build node list for video generation (matching ImageToVideoPage format)
      const nodes = [
        { nodeId: '28', fieldName: 'value', fieldValue: '720', description: '最长边' },
        { nodeId: '20', fieldName: 'value', fieldValue: '5', description: '时长（秒）' },
        { nodeId: '77', fieldName: 'value', fieldValue: 'false', description: '补帧（默认关）' },
        { nodeId: '21', fieldName: 'image', fieldValue: imagePath, description: '图片上传' },
        { nodeId: '38', fieldName: 'value', fieldValue: finalVideoPrompt, description: '提示词' },
        { nodeId: '42', fieldName: 'lora_name', fieldValue: 'SmoothMixAnimationStyle_High.safetensors', description: 'lora（high）' },
        { nodeId: '42', fieldName: 'strength_model', fieldValue: '1.0', description: 'lora权重' },
      ];

      // Notify VideoTaskList via localStorage so it shows the task.
      // CRITICAL: imagePreview here is only used by VideoTaskList for a
      // 48×48 thumbnail. Stashing the raw 1-2 MB data: URL would blow the
      // ~5 MB localStorage budget in just 3-4 tasks. Downscale to a tiny
      // JPEG first; the visual difference at thumbnail size is invisible.
      const taskId = `storyboard-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const thumbnailForStorage = await makeThumbnailForStorage(imageUrl);
      const taskData = {
        id: taskId,
        prompt: finalVideoPrompt,
        imagePreview: thumbnailForStorage,
        nodeInfoList: nodes,
        processed: false,
      };
      try {
        localStorage.setItem('nsfwxo_video_task_submit', JSON.stringify(taskData));
        window.dispatchEvent(new StorageEvent('storage', { key: 'nsfwxo_video_task_submit', newValue: JSON.stringify(taskData) }));
      } catch (storageErr) {
        // Quota can still trip even with thumbnails if other app code has
        // already filled localStorage. Log and continue — the task itself
        // is submitted below via taskManager, so the user still gets video.
        console.warn('[handleDirectGenerateVideo] localStorage notify failed (non-fatal):', storageErr);
      }

      await taskManager.addTask('img2vid', nodes, finalVideoPrompt, WORKFLOW.IMAGE_TO_VIDEO);
      onSuccess('视频生成任务已提交');
    } catch (err) {
      onError(err instanceof Error ? err.message : '视频生成失败');
    } finally {
      setVideoGenLoading(prev => { const next = { ...prev }; delete next[panelKey]; return next; });
    }
  }, [apiKey, taskManager, onError, onSuccess, r18Mode]);

  // ── H3 提示词引擎 ─────────────────────────────────────────────────────────
  /** 单个分镜：生成 H3 视频提示词（仅生成 [Shot N] 提示词，共享部分按需缓存）
   *
   * 1 个图片分镜 ↔ 1 个视频提示词 (1:1 对应)
   * - 每个分镜独立生成 [Shot N] 对应<Picture N> 提示词
   * - 共享部分 (subject_definitions, summary, etc.) 由 handleBatchGenerateH3 一次性生成
   *
   * 优先使用"动画提示词"（panelVideoPrompts[`${sbHistoryId}_${idx}`]），没有时才调用 expandVideoFromImage 扩写。
   * 这样避免重复 LLM 调用，且 422 错误时仍能稳定工作。
   *
   * 多主题模式：所有提示词都按 `${sbHistoryId}_${idx}` 隔离存储，互不覆盖。
   */
  const handleGeneratePanelH3 = useCallback(async (idx: number, panel: { panel_number: number; image_prompt: string; scene_description?: string }) => {
    const curHistoryId = sbHistoryId || 'solo';
    const pK = promptKey(idx, curHistoryId);
    setPanelH3Loading(prev => ({ ...prev, [pK]: true }));
    try {
      // Step 1: 选择场景描述来源（直接使用现有的"动画提示词"，避免再次调用 LLM）
      let sceneDesc: string | undefined = panelVideoPrompts[pK]?.trim() || panel.scene_description?.trim();

      // 如果动画提示词为空，再回退到调用 expandVideoFromImage 扩写（仍可能 422 失败）
      if (!sceneDesc || sceneDesc.length === 0) {
        // 防御性检查：image_prompt 不能为空字符串（否则后端 422）
        if (!panel.image_prompt || panel.image_prompt.trim().length === 0) {
          onError(`分镜 ${panel.panel_number} 的图片提示词为空，请先生成分镜图片`);
          return;
        }

        const themeLabel = activeThemeInfo?.title || plot || (r18Mode ? 'R18' : '默认主题');
        try {
          const videoRes = await expandVideoFromImage(panel.image_prompt, themeLabel, r18Mode, 1);
          sceneDesc = videoRes.results?.[0]?.prompt?.trim();
        } catch (err) {
          // 422 (validation error) / 500 / 网络错误 → 直接跳过，不重试
          const status = (err && typeof err === 'object' && 'status' in err) ? (err as { status?: number }).status : 0;
          const msg = err instanceof Error ? err.message : String(err);
          if (status === 422 || /422/i.test(msg)) {
            console.warn(`[handleGeneratePanelH3] 第 ${idx + 1} 个 expandVideoFromImage 422，跳过`);
            sceneDesc = undefined;  // Shot prompt 用 image_prompt 作为兜底
          } else {
            // 其它错误（超时/500）→ 重试一次
            console.warn(`[handleGeneratePanelH3] 第 ${idx + 1} 个 expandVideoFromImage 失败，重试（150s）`);
            try {
              const videoRes = await expandVideoFromImage(panel.image_prompt, themeLabel, r18Mode, 1, ['grok-4.6', 'grok-4.3'], 150000);
              sceneDesc = videoRes.results?.[0]?.prompt?.trim();
            } catch (retryErr) {
              sceneDesc = undefined;  // 最终失败，shot prompt 用 image_prompt 兜底
            }
          }
        }
      }

      // Step 2: 生成该分镜的 [Shot N] 提示词
      const shot = generateH3ShotPrompt(
        idx,
        {
          image_prompt: panel.image_prompt,
          scene_description: sceneDesc,
        },
        activePanels.length,
        panelH3Duration,
        r18Mode,
      );

      // 缓存 shot 到 state（per-historyId 隔离），供批量上传使用
      setPanelH3ShotMap(prev => {
        const next = { ...prev };
        const curMap = new Map(next[curHistoryId] || new Map<number, H3PanelShot>());
        curMap.set(idx + 1, shot);
        next[curHistoryId] = curMap;
        return next;
      });

      // 只在 panelH3Prompts[`${sbHistoryId}_${idx}`] 存当前分镜的 [Shot N] 提示词，
      // 不要拼装完整 H3 六段式（包含 subject_definitions / summary / 其它 Shot 等），
      // 那样会让单分镜卡片显示"所有分镜的内容"，破坏 1:1 对应关系。
      setPanelH3Prompts(prev => ({ ...prev, [pK]: shot.shotPrompt }));
      onSuccess(`分镜 ${panel.panel_number} 的 [Shot ${shot.pictureNumber}] 提示词已生成${sceneDesc ? '（使用动画提示词）' : '（使用图片提示词兜底）'}`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'H3 提示词生成失败');
    } finally {
      setPanelH3Loading(prev => { const next = { ...prev }; delete next[pK]; return next; });
    }
  }, [activeThemeInfo, plot, panelH3Duration, r18Mode, onSuccess, onError, activePanels.length, panelVideoPrompts, sbHistoryId]);

  /** 一键批量生成所有分镜的 H3 Shot 提示词
   *
   * 工作流：
   *   1. 优先使用 panelVideoPrompts[`${sbHistoryId}_${idx}`]（动画提示词）作为场景描述，避免重复 LLM 调用
   *   2. 仅当动画提示词为空时才回退调用 expandVideoFromImage
   *   3. 422 错误时跳过重试，直接用 image_prompt 兜底
   *   4. 调用 generateH3ShotPromptsForPanels 生成所有分镜的 [Shot N] 提示词
   *   5. 调用 generateH3CommonParts 一次性生成共享部分（per-historyId 隔离）
   *
   * 多主题模式：所有提示词都按 `${sbHistoryId}_${idx}` 隔离存储，互不覆盖。
   */
  const handleBatchGenerateH3 = useCallback(async () => {
    if (activePanels.length === 0) { onError('没有可用的分镜'); return; }
    const curHistoryId = sbHistoryId || 'solo';
    setPanelH3Loading(prev => Object.fromEntries(activePanels.map((_, i) => [promptKey(i, curHistoryId), true])));
    const themeLabel = activeThemeInfo?.title || plot || (r18Mode ? 'R18' : '默认主题');
    try {
      // Step 1: 为每个分镜确定场景描述来源
      // 优先：panelVideoPrompts[`${sbHistoryId}_${idx}`]（动画提示词，避免重 LLM 调用）
      // 回退：调用 expandVideoFromImage（422 时跳过重试，用 image_prompt 兜底）
      const sceneDescs: Array<string | undefined> = new Array(activePanels.length);
      const needLLMCall: number[] = [];  // 需要 LLM 扩写的 panel idx

      activePanels.forEach((panel, i) => {
        const existing = panelVideoPrompts[promptKey(i, curHistoryId)]?.trim();
        if (existing && existing.length > 0) {
          sceneDescs[i] = existing;
        } else {
          sceneDescs[i] = undefined;
          // 防御性：空 image_prompt 直接跳过 LLM 调用
          if (panel.image_prompt && panel.image_prompt.trim().length > 0) {
            needLLMCall.push(i);
          }
        }
      });

      const processOne = async (i: number) => {
        const panel = activePanels[i];
        // 优先使用 panel.scene_description 而不是 themeLabel，与 triggerAutoH3ForPanel 保持一致。
        // 原因同上：themeLabel 太宽泛，会让 LLM 扩写出与图片不符的内容。
        const sceneDescForPanel = (panel.scene_description || '').trim() || themeLabel;
        try {
          const videoRes = await expandVideoFromImage(panel.image_prompt, sceneDescForPanel, r18Mode, 1);
          sceneDescs[i] = videoRes.results?.[0]?.prompt?.trim();
        } catch (err) {
          // 422 是请求验证错误，重试无用，直接跳过
          const status = (err && typeof err === 'object' && 'status' in err) ? (err as { status?: number }).status : 0;
          const msg = err instanceof Error ? err.message : String(err);
          if (status === 422 || /422/i.test(msg)) {
            console.warn(`[handleBatchGenerateH3] 第 ${i + 1} 个 expandVideoFromImage 422，跳过 LLM 扩写`);
            return;  // sceneDescs[i] 保持 undefined，shot prompt 用 image_prompt 兜底
          }
          // 其它错误（超时/500/网络） → 重试一次，仍失败兜底
          try {
            const videoRes = await expandVideoFromImage(panel.image_prompt, sceneDescForPanel, r18Mode, 1, ['grok-4.6', 'grok-4.3'], 150000);
            sceneDescs[i] = videoRes.results?.[0]?.prompt?.trim();
          } catch {
            console.warn(`[handleBatchGenerateH3] 第 ${i + 1} 个重试仍失败`);
          }
        }
      };

      // 【修复】真正并行：所有 LLM 调用同时发出，不再分批串行。
      // 之前 CONCURRENT=3 分批处理，6 个分镜实际变成 3+3 串行，
      // 用户看到第一批完成后第二批才"排队"，感知上不是并行。
      if (needLLMCall.length > 0) {
        await Promise.all(needLLMCall.map((idx) => processOne(idx)));
      }

      // Step 2: 用确定的 scene_description 生成每个分镜的 [Shot N] 提示词
      const panelsWithVideo = activePanels.map((p, i) => ({
        image_prompt: p.image_prompt || '',
        scene_description: sceneDescs[i],
      }));

      const shotMap = generateH3ShotPromptsForPanels(panelsWithVideo, panelH3Duration, r18Mode);

      // Step 3: 一次性生成共享部分
      const commonParts = generateH3CommonParts(panelsWithVideo, {
        duration: panelH3Duration,
        r18: r18Mode,
      });

      // Step 4: 缓存到 state（per-historyId 隔离，多主题互不冲突）
      setPanelH3ShotMap(prev => ({ ...prev, [curHistoryId]: new Map(shotMap) }));
      setPanelH3CommonParts(prev => ({ ...prev, [curHistoryId]: commonParts }));

      // Step 5: 每个分镜只存自己的 [Shot N] 提示词到 panelH3Prompts（per-historyId 隔离）
      // 不要把"全部 6 个 Shot 拼成的完整 H3"塞进每个分镜卡，
      // 否则每个分镜会显示同样的、包含其它分镜内容的完整 H3 提示词。
      // 完整 H3 提示词只在 handleBatchGotoLongVideoWithH3 中按需拼装给上传用。
      const newPrompts: Record<string, string> = {};
      const sortedShots = Array.from(shotMap.values()).sort((a, b) => a.panelIndex - b.panelIndex);
      sortedShots.forEach((shot, idx) => {
        newPrompts[promptKey(idx, curHistoryId)] = shot.shotPrompt;  // 每个分镜卡只显示自己的 Shot N 提示词
      });
      setPanelH3Prompts(prev => ({ ...prev, ...newPrompts }));
      const usedLLM = needLLMCall.length > 0;
      const fromAnims = activePanels.length - needLLMCall.length;
      const sourceDesc = !usedLLM
        ? '（全部使用现有动画提示词，无需 LLM 调用）'
        : `${fromAnims}/${activePanels.length} 个使用动画提示词，${needLLMCall.length} 个回退到 LLM 扩写`;
      onSuccess(`已为 ${activePanels.length} 个分镜生成 [Shot 1..${activePanels.length}] 视频提示词 ${sourceDesc}`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'H3 提示词批量生成失败');
    } finally {
      setPanelH3Loading({});
    }
  }, [activePanels, activeThemeInfo, plot, panelH3Duration, r18Mode, onSuccess, onError, panelVideoPrompts, sbHistoryId]);

  /** 仅补全缺失的 H3 提示词（用于"截图2部分主题的分镜提示词缺失"场景）
   *
   * 与 handleBatchGenerateH3 的区别：
   *   - 不覆盖已生成的 shot，只补 panelH3ShotMap 中缺失的 panel
   *   - 缺失判断：activePanels[idx] 存在 && panelH3ShotMap[historyId] 没有 idx+1 的条目
   *
   * 使用流程：用户在面板顶部看到 "N 个分镜的提示词缺失" 的提示，点击按钮自动
   * 重新生成缺失的那几个，避免重新跑全部分镜（也避免覆盖已有提示词）。
   */
  const handleRetryMissingH3Prompts = useCallback(async () => {
    if (activePanels.length === 0) { onError('没有可用的分镜'); return; }
    const curHistoryId = sbHistoryId || 'solo';
    const curShotMap = panelH3ShotMap[curHistoryId] || new Map<number, H3PanelShot>();
    const missingIdxs: number[] = [];
    activePanels.forEach((panel, i) => {
      // 1-based panelNumber 存进 shotMap
      if (!curShotMap.has(i + 1)) {
        missingIdxs.push(i);
      }
    });
    if (missingIdxs.length === 0) {
      onSuccess('所有分镜的 H3 提示词已存在，无需补全');
      return;
    }

    setPanelH3Loading(prev => Object.fromEntries(missingIdxs.map((i) => [promptKey(i, curHistoryId), true])));
    const themeLabel = activeThemeInfo?.title || plot || (r18Mode ? 'R18' : '默认主题');
    try {
      // 复用 handleGeneratePanelH3 的逻辑（已经处理了"动画提示词优先 / 422 跳过 / 重试 150s"）
      // 每个缺失分镜并行补全
      await Promise.all(missingIdxs.map(async (i) => {
        try {
          await handleGeneratePanelH3(i, activePanels[i]);
        } catch (err) {
          console.warn(`[handleRetryMissingH3Prompts] 分镜 ${i + 1} 补全失败:`, err);
        }
      }));
      const stillMissing = missingIdxs.filter((i) => {
        // 通过 setPanelH3Prompts 已经写入的视为已成功
        const pK = promptKey(i, curHistoryId);
        return !panelH3Prompts[pK];
      });
      if (stillMissing.length === 0) {
        onSuccess(`已补全 ${missingIdxs.length} 个分镜的 H3 提示词`);
      } else {
        onSuccess(`已尝试补全 ${missingIdxs.length} 个分镜，仍有 ${stillMissing.length} 个失败（可重试）`);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : '补全缺失提示词失败');
    } finally {
      setPanelH3Loading({});
    }
  }, [activePanels, activeThemeInfo, plot, panelH3Duration, r18Mode, onSuccess, onError, panelVideoPrompts, sbHistoryId, panelH3ShotMap, panelH3Prompts, handleGeneratePanelH3]);

  /** 单个分镜：跳转到长视频 1.1 并填入 H3 提示词 */
  const handleGotoLongVideoWithH3 = useCallback(async (
    idx: number,
    panel: { image_prompt: string },
    imageUrl: string,
    panelH3Prompt: string,
  ) => {
    // 先上传图片获取 path
    let imagePath = imageUrl;
    if (imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) {
      try {
        const res = await fetch(imageUrl);
        const blob = await res.blob();
        const file = new File([blob], `storyboard_h3_${Date.now()}.jpg`, { type: 'image/jpeg' });
        const { imagePath: uploadedPath } = await uploadImage(apiKey, file);
        imagePath = uploadedPath;
      } catch {
        onError('图片上传失败，请重试');
        return;
      }
    }

    // 存储到 sessionStorage，由 ImageToVideoPage 消费
    //
    // panelH3Prompts[`${sbHistoryId}_${idx}`] 现在只存当前分镜的 [Shot N] 提示词（不是完整 H3 六段式）。
    // 单分镜长视频上传仍需要一份合法的 H3 提示词给 longvideov2 模型，这里按以下
    // 优先级拼装：
    //   1. 优先用 panelH3ShotMap[`${sbHistoryId}`].get(idx+1) + 单分镜的 generateH3CommonParts 拼一份
    //      "单 Shot" H3 提示词（Subject 1 + Shot 1，结构完整）。
    //   2. 否则 fallback 到 panelH3Prompt（即当前 [Shot N] 纯字符串）。
    //   3. 都没有则 generateH3Prompt 从 image_prompt 现生成。
    const curHistoryId = sbHistoryId || 'solo';
    const curShotMap = panelH3ShotMap[curHistoryId] || new Map<number, H3PanelShot>();
    let h3Prompt: string;
    const shot = curShotMap.get(idx + 1);
    if (shot) {
      const singlePanelCommonParts = generateH3CommonParts(
        [{ image_prompt: panel.image_prompt }],
        { duration: panelH3Duration, r18: r18Mode },
      );
      h3Prompt = assembleH3Prompt(singlePanelCommonParts, [shot], panelH3Duration);
    } else if (panelH3Prompt) {
      h3Prompt = panelH3Prompt;
    } else {
      h3Prompt = generateH3Prompt({
        imagePrompt: panel.image_prompt,
        duration: panelH3Duration,
        r18: r18Mode,
      });
    }
    sessionStorage.setItem('storyboard_h3_longvideo', JSON.stringify({
      imagePath,
      imagePreview: imageUrl,
      h3Prompt,
      processed: false,
    }));
    onNavigate?.('img2vid');
  }, [apiKey, panelH3Duration, r18Mode, onError, onNavigate, onSuccess, panelH3ShotMap, sbHistoryId]);

  /** 一键批量上传所有分镜到长视频 v1.1 并填入完整 H3 提示词
   *
   * 工作流：
   *   1. 收集所有分镜的图片（从 selectedPanelImages / genStates / taskManager 中按优先级取）
   *   2. 上传所有图片到 ImageToVideoPage 的 sessionStorage
   *   3. 用 panelH3ShotMap[`${sbHistoryId}`] + panelH3CommonParts[`${sbHistoryId}`] 拼装完整 H3 提示词
   *      （per-historyId 隔离，多主题互不冲突）
   *   4. 跳转到 img2vid 页面（自动切换到 longvideov2 模型）
   */
  const handleBatchGotoLongVideoWithH3 = useCallback(async () => {
    // 【修复】ref 同步闸门，防止 useState 异步更新期间用户重复点击导致
    // 上传重复 + sessionStorage 配额被撑爆。
    if (batchVideoUploadingRef.current) {
      console.warn('[handleBatchGotoLongVideoWithH3] 已有上传任务在执行，跳过重入');
      return;
    }
    batchVideoUploadingRef.current = true;
    if (activePanels.length === 0) { onError('没有可用的分镜'); batchVideoUploadingRef.current = false; return; }
    const curHistoryId = sbHistoryId || 'solo';
    const curShotMap = panelH3ShotMap[curHistoryId];
    const curCommonParts = panelH3CommonParts[curHistoryId];
    if (!curCommonParts || !curShotMap || curShotMap.size === 0) {
      onError('请先生成 H3 提示词（点击"一键批量生成 H3 提示词"）');
      batchVideoUploadingRef.current = false;
      return;
    }

    setBatchVideoLoading(true);
    try {
      // Step 1: 收集所有分镜的图片
      const panelImages: Array<{ idx: number; url: string; path?: string }> = [];

      for (let i = 0; i < activePanels.length; i++) {
        const panel = activePanels[i];
        // 【修复】selectedPanelImages 在多主题模式下用 `theme-${activeThemeTab}-panel-${idx}`
        // 作为 key，但单主题模式下用 `panel-${idx}`。两个入口必须用同一个 key 才能正确读出
        // 用户选中的图片——否则用户选了图片 #2，但这里查不到 manualSelection，掉到下面的
        // Priority 2/3 取回图片 #1，表现为"选了第二张但总是调用第一张"。
        const selKey = activeThemeTab !== null
          ? `theme-${activeThemeTab}-panel-${i}`
          : `panel-${i}`;
        const panelGenState = genStates[`${sbHistoryId}_${i}`];
        const panelTasks = taskManager.tasks.filter((t) => t.prompt === panel.image_prompt && t.images.length > 0);
        let imageUrl = '';

        // Priority 1: User manually selected an image
        const manualSelection = selectedPanelImages[selKey];
        if (manualSelection) {
          imageUrl = manualSelection.url;
        }
        // Priority 2: Local genState
        else if (panelGenState?.images && panelGenState.images.length > 0) {
          imageUrl = panelGenState.images[0];
        }
        // Priority 3: Task manager tasks
        else if (panelTasks.length > 0) {
          imageUrl = panelTasks[0].images[0];
        }

        if (imageUrl) {
          panelImages.push({ idx: i, url: imageUrl });
        } else {
          console.warn(`[handleBatchGotoLongVideoWithH3] 分镜 ${i + 1} 没有可用图片，跳过`);
        }
      }

      if (panelImages.length === 0) {
        onError('所有分镜都没有可用图片，请先生成分镜图片');
        return;
      }

      // Step 2: 上传所有图片到 server（如果需要）
      const uploadedImages: Array<{ idx: number; path: string; preview: string }> = [];
      for (const pi of panelImages) {
        let imagePath = pi.url;
        let preview = pi.url;
        if (pi.url.startsWith('data:') || pi.url.startsWith('blob:')) {
          try {
            // 【修复】不能在 sessionStorage 写原始 data URL：
            // 6 张分镜 × ~3MB ≈ 18MB，直接撑爆 5MB 配额 → QuotaExceededError。
            // 也不能用 server URL 当 preview（rh-hk-images-switch.xiaoyaoyou.com
            // 无 CORS 头，浏览器 <img> 标签直接引用 → 破裂图标）。
            // 正确做法：
            //   path   = server URL （用于 RunningHub API）
            //   preview = storeImage() 返回的 cacheKey （~64字节短字符串）
            // 把 data URL 存到 unified cache (IndexedDB，容量充足)，然后只把
            // cacheKey 写进 sessionStorage，consumer 端 resolveImageRef(cacheKey)
            // 会从 IndexedDB 读出 data URL → <img> 正常渲染。
            const res = await fetch(pi.url);
            const blob = await res.blob();
            const file = new File([blob], `storyboard_h3_batch_${Date.now()}_${pi.idx}.jpg`, { type: 'image/jpeg' });
            const uploadResult = await uploadImage(apiKey, file);
            imagePath = uploadResult.imagePath;
            // storeImage 内部会 await _ensureSync()，确保 IndexedDB 可用。
            // 返回值是 cacheKey，写到 sessionStorage 几乎不占空间。
            preview = await storeImage(pi.url);
          } catch (uploadErr) {
            console.warn(`[handleBatchGotoLongVideoWithH3] 分镜 ${pi.idx + 1} 图片上传失败:`, uploadErr);
            continue;
          }
        }
        uploadedImages.push({ idx: pi.idx, path: imagePath, preview });
      }

      if (uploadedImages.length === 0) {
        onError('所有图片上传失败');
        return;
      }

      // Step 3: 拼装完整 H3 提示词（按 panelIndex 排序）
      // 如果开启了强制约束开关，在提示词前追加约束文本
      const sortedShots = Array.from(curShotMap.values()).sort((a, b) => a.panelIndex - b.panelIndex);
      const prependConstraint = panelH3ConstraintEnabled[curHistoryId] ? H3_CONSTRAINT_TEXT : undefined;
      const fullH3Prompt = assembleH3Prompt(curCommonParts, sortedShots, panelH3Duration, prependConstraint);

      // Step 4: 构造跳转数据 → 全部入 IndexedDB，sessionStorage 只放一个 ~64字节的 ref。
      // 【关键】修复 sessionStorage QuotaExceededError：之前是直接把 6 张 data URL
      // (~3MB/张) + h3Prompt + shotPrompts 一起塞进 5MB sessionStorage，必然溢出。
      // 改成：把所有"大块数据"（preview data URLs、h3Prompt、shotPrompts）打成一个
      // JSON 字符串，调用 storeImage() 存进 unified cache (IndexedDB)，只把 ref 写
      // sessionStorage。sessionStorage 写一个 ~64字节字符串，零 quota 风险。
      // consumer 端 ImageToVideoPage 通过 resolveImageRef(ref) 从 IndexedDB 读回
      // 整个 JSON payload，再解析成 images/h3Prompt/shotPrompts。
      try {
        const payloadJson = JSON.stringify({
          images: uploadedImages,  // preview 已在上一步替换成 cacheKey
          h3Prompt: fullH3Prompt,
          shotPrompts: sortedShots,
          totalPanels: activePanels.length,
        });
        const batchRef = await storeImage(payloadJson);  // 复用现有 IndexedDB 通道
        console.log(`[handleBatchGotoLongVideoWithH3] batch payload=${(payloadJson.length / 1024).toFixed(1)}KB → ref=${batchRef}`);
        sessionStorage.setItem('storyboard_h3_longvideo_batch', JSON.stringify({
          ref: batchRef,
          totalPanels: activePanels.length,
          processed: false,
        }));
      // 修复：sessionStorage 写完后必须 return，否则 onSuccess/onNavigate 会在失败后仍被调用。
      } catch (storageErr) {
        const isQuota = storageErr instanceof DOMException && storageErr.name === 'QuotaExceededError';
        console.error('[handleBatchGotoLongVideoWithH3] sessionStorage 写入失败:', storageErr);
        onError(isQuota
          ? `跳转数据过大（${uploadedImages.length} 张分镜图），无法写入浏览器临时存储。请先清理浏览器数据后重试。`
          : `写入跳转数据失败：${storageErr instanceof Error ? storageErr.message : String(storageErr)}`);
        batchVideoUploadingRef.current = false;
        return;
      }
      onSuccess(`已切换到长视频 1.1：${uploadedImages.length} 张分镜图 + 完整 H3 提示词已填入`);
      onNavigate?.('img2vid');
    } catch (err) {
      onError(err instanceof Error ? err.message : '批量跳转到长视频 1.1 失败');
    } finally {
      setBatchVideoLoading(false);
      // 【修复】无论成功失败都释放并发闸门，否则后续点击会被永久挡掉。
      batchVideoUploadingRef.current = false;
    }
  }, [
    activePanels, panelH3CommonParts, panelH3ShotMap, panelH3Duration,
    genStates, sbHistoryId, taskManager, selectedPanelImages,
    apiKey, onError, onSuccess, onNavigate,
  ]);

  // Handle batch video generation from storyboard panels
  const handleBatchGenerateVideo = useCallback(async () => {
    if (activePanels.length === 0) { onError('没有可用的分镜'); return; }
    setBatchVideoLoading(true);
    let submitted = 0;
    const submittedTasks: Array<{ id: string; prompt: string; imagePreview: string; nodeInfoList: NodeInfo[] }> = [];
    try {
      for (let i = 0; i < activePanels.length; i++) {
        const panel = activePanels[i];
        // 【修复】多主题模式下 selectedPanelImages 用 `theme-${activeThemeTab}-panel-${idx}` 作 key，
        // 单主题模式下用 `panel-${idx}`，必须用同一个 key 才能读到用户选中的图片（见 handleBatchGotoLongVideoWithH3 同注释）。
        const panelKey = activeThemeTab !== null
          ? `theme-${activeThemeTab}-panel-${i}`
          : `panel-${i}`;
        const panelGenState = genStates[`${sbHistoryId}_${i}`];
        const panelTasks = taskManager.tasks.filter((t) => t.prompt === panel.image_prompt && t.images.length > 0);
        let imageUrl = '';

        // Priority 1: User manually selected an image for this panel
        const manualSelection = selectedPanelImages[panelKey];
        if (manualSelection) {
          imageUrl = manualSelection.url;
        }
        // Priority 2: Local genState (includes cached images from history)
        else if (panelGenState?.images && panelGenState.images.length > 0) {
          imageUrl = panelGenState.images[0];
        }
        // Priority 3: Task manager tasks (live running tasks)
        else if (panelTasks.length > 0) {
          imageUrl = panelTasks[0].images[0];
        }

        if (!imageUrl) continue;

        // Upload image if needed (only local data URLs need upload)
        let imagePath = imageUrl;
        if (imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) {
          try {
            const res = await fetch(imageUrl);
            const blob = await res.blob();
            const file = new File([blob], `storyboard_video_${Date.now()}_${i}.jpg`, { type: 'image/jpeg' });
            const uploadResult = await uploadImage(apiKey, file);
            imagePath = uploadResult.imagePath;
          } catch {
            onError(`分镜 ${i + 1} 图片上传失败`);
            continue;
          }
        }

        // Generate video prompt using both image_prompt and scene_description
        // so the action sequence lines up with the panel's actual scene.
        const videoPrompt = extractVideoPromptFromImagePrompt({
          imagePrompt: panel.image_prompt,
          sceneDescription: panel.scene_description,
          r18Mode,
        });

        // Build node list for video generation (matching ImageToVideoPage format)
        const nodes = [
          { nodeId: '28', fieldName: 'value', fieldValue: '720', description: '最长边' },
          { nodeId: '20', fieldName: 'value', fieldValue: '5', description: '时长（秒）' },
          { nodeId: '77', fieldName: 'value', fieldValue: 'false', description: '补帧（默认关）' },
          { nodeId: '21', fieldName: 'image', fieldValue: imagePath, description: '图片上传' },
          { nodeId: '38', fieldName: 'value', fieldValue: videoPrompt, description: '提示词' },
          { nodeId: '42', fieldName: 'lora_name', fieldValue: 'SmoothMixAnimationStyle_High.safetensors', description: 'lora（high）' },
          { nodeId: '42', fieldName: 'strength_model', fieldValue: '1.0', description: 'lora权重' },
        ];

        try {
          const taskId = `storyboard-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          // Use a tiny JPEG thumbnail for the localStorage handoff (raw
          // data: URLs blow past the quota in 3-4 entries).
          const thumbnail = await makeThumbnailForStorage(imageUrl);
          submittedTasks.push({ id: taskId, prompt: videoPrompt, imagePreview: thumbnail, nodeInfoList: nodes });
          await taskManager.addTask('img2vid', nodes, videoPrompt, WORKFLOW.IMAGE_TO_VIDEO);
          submitted++;
        } catch (err) {
          onError(`提交分镜 ${i + 1} 视频任务失败: ${err instanceof Error ? err.message : '未知错误'}`);
        }
      }
      // Notify VideoTaskList about all submitted tasks
      if (submittedTasks.length > 0) {
        const batchData = { tasks: submittedTasks, processed: false };
        try {
          localStorage.setItem('nsfwxo_video_task_batch', JSON.stringify(batchData));
          window.dispatchEvent(new StorageEvent('storage', { key: 'nsfwxo_video_task_batch', newValue: JSON.stringify(batchData) }));
        } catch (storageErr) {
          // Quota can still trip even with thumbnails if other code filled
          // localStorage. Tasks are already submitted via taskManager, so
          // the user still gets their videos.
          console.warn('[handleBatchGenerateVideo] localStorage notify failed (non-fatal):', storageErr);
        }
      }
      if (submitted > 0) {
        onSuccess(`已提交 ${submitted} 个视频生成任务`);
      } else {
        onError('没有找到已生成的图片，请先生成分镜图片');
      }
    } finally {
      setBatchVideoLoading(false);
    }
  }, [activePanels, genStates, taskManager, apiKey, onError, onSuccess, r18Mode]);

  const handleBatchGenerate = useCallback(async () => {
    if (activePanels.length === 0) return;
    const availableSlots = MAX_TASKS - taskManager.tasks.length;
    if (availableSlots <= 0) { onError('任务队列已满'); return; }
    setBatchLoading(true);
    let submitted = 0;

    // Reuse the current history entry when the user is regenerating images
    // for an already-loaded storyboard. Creating a brand-new history entry
    // on every click was producing a long list of duplicate rows in the
    // history panel (same theme + same panels, many copies).
    const hid = currentHistoryId ?? addStoryboardHistory({
      plot: activeThemeInfo?.title || selectedThemes[0]?.title || '新生成',
      panel_count: activePanels.length,
      r18: r18Mode,
      panels: activePanels,
    });
    setCurrentHistoryId(hid);
    // Other parts of the app (e.g. FinishedTaskImagesContext subscriber) look
    // for the latest history id in sessionStorage — keep it in sync.
    sessionStorage.setItem('sb_latest_history_id', hid);

    // Mark all panels as loading immediately (use string keys for multi-theme support)
    setGenStates((prev) => {
      const next = { ...prev };
      for (let i = 0; i < activePanels.length; i++) {
        next[`${hid}_${i}`] = { loading: true, images: [] };
      }
      return next;
    });
    let imagePath = selectedGirlfriend?.portraitUrl || '';
    let downloadUrl = '';
    if (digitalHumanMode && selectedGirlfriend) {
      try {
        const file = await gfUrlToFile(selectedGirlfriend.portraitUrl, selectedGirlfriend.id);
        const uploadResult = await uploadImage(apiKey, file);
        imagePath = uploadResult.imagePath;
        downloadUrl = uploadResult.downloadUrl;
      } catch {
        setBatchLoading(false);
        onError('AI 女友图片上传失败'); return;
      }
    }
    const toSubmit = activePanels.slice(0, availableSlots);
    console.log(`[handleBatchGenerate] activePanels.length=${activePanels.length}, toSubmit.length=${toSubmit.length}, r18Mode=${r18Mode}`);
    for (let i = 0; i < toSubmit.length; i++) {
      console.log(`[handleBatchGenerate] panel[${i}].image_prompt = "${toSubmit[i].image_prompt.slice(0, 100)}" (length=${toSubmit[i].image_prompt.length})`);
    }
    const tasks: (() => Promise<void>)[] = toSubmit.map((panel, i) => {
      const panelIdx = i;
      console.log(`[handleBatchGenerate] task[${i}] using panel.image_prompt="${panel.image_prompt.slice(0, 100)}" (length=${panel.image_prompt.length})`);
      const panelStoryboardInfo = { historyId: hid, panelIdx };
      const panelNum = panel.panel_number || (i + 1);
      const themeForTask = activeThemeInfo?.title || plot || undefined;
      return async () => {
        if (digitalHumanMode && selectedGirlfriend) {
          const charName = selectedGirlfriend.nameZh || selectedGirlfriend.name;
          const charId = (selectedGirlfriend.id as string).toUpperCase().slice(0, 4);
          const anchorPrompt = `【严格锁定】严格锁定图中22岁女性（ID:${charId}），完全保留原有面部特征，五官轮廓、脸型、眼睛、鼻子、嘴唇、发型、肤色、身材比例完全不变，不做任何面部修改，动作流畅不僵硬。超高清8K，写实细节，皮肤质感细腻，无畸变、无模糊、无穿模。`;
          const finalPrompt = `${anchorPrompt}\n\n${panel.image_prompt}`;
          const nodes = buildImg2ImgNodeList({
            prompt: finalPrompt,
            imagePath: downloadUrl || imagePath,
            aspectRatio: img2imgAspectRatio,
          });
          await taskManager.addTask('img2img', nodes, finalPrompt, WORKFLOW.IMAGE_TO_IMAGE, undefined, panelStoryboardInfo, 'storyboard', themeForTask, panelNum);
        } else {
          const finalPrompt = withQualityBoost(sanitizePromptForClip(panel.image_prompt));
          const nodes = buildTxt2ImgNodeList(buildUnifiedTxt2ImgOptions(finalPrompt));
          await taskManager.addTask('txt2img', nodes, finalPrompt, undefined, undefined, panelStoryboardInfo, 'storyboard', themeForTask, panelNum);
        }
      };
    });
    const settled = await Promise.allSettled(tasks.map((t) => t()));
    submitted = settled.filter((r) => r.status === 'fulfilled').length;
    settled.forEach((r, i) => {
      if (r.status === 'rejected') {
        onError(`提交第 ${i + 1} 个时失败: ${r.reason instanceof Error ? r.reason.message : '未知错误'}`);
      }
    });
    setBatchLoading(false);
    setHistory(getStoryboardHistory());
    if (submitted > 0) {
      onSuccess(`已提交 ${submitted} 个生图任务`);
    }
  }, [activePanels, activeThemeInfo, selectedThemes, taskManager, setGenStates, onError, onSuccess, digitalHumanMode, selectedGirlfriend, apiKey, r18Mode, currentHistoryId]);

  const hasContent = storyStep === 'panels' && panels.length > 0;

  return (
    <div className="space-y-4">
      {/* Sub-mode toggle */}
      <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
        <div className="flex">
          <button
            onClick={() => setSubMode('linear')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-all ${
              subMode === 'linear'
                ? 'text-primary bg-primary/5 border-b-2 border-primary'
                : 'text-text-tertiary hover:text-text-primary hover:bg-bg-hover'
            }`}
          >
            <LayoutList size={13} />
            <span>线性分镜</span>
          </button>
          <button
            onClick={() => setSubMode('grid')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-all ${
              subMode === 'grid'
                ? 'text-purple-600 bg-purple-50/50 border-b-2 border-purple-500'
                : 'text-text-tertiary hover:text-text-primary hover:bg-bg-hover'
            }`}
          >
            <Grid3X3 size={13} />
            <span>九宫格分镜</span>
          </button>
        </div>
      </div>

      {/* Grid Storyboard Mode */}
      {subMode === 'grid' && (
        <GridStoryboardMode
          r18Mode={r18Mode}
          taskManager={taskManager}
          apiKey={apiKey}
          displayLang="zh"
          digitalHumanMode={digitalHumanMode}
          selectedGirlfriend={selectedGirlfriend}
          onError={onError}
          onSuccess={onSuccess}
          onNavigate={onNavigate}
        />
      )}

      {/* Linear Storyboard Mode (existing) */}
      {subMode === 'linear' && (
      <>
      <div className="rounded-2xl bg-white border border-border shadow-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <LayoutList size={14} className={r18Mode ? 'text-red-500' : 'text-primary'} />
            <span className="text-sm font-medium text-text-primary">
              剧情分镜{r18Mode && <span className="ml-2 text-xs text-red-500 font-medium">(R18)</span>}
            </span>
          </div>
          <button onClick={() => setShowHistory(!showHistory)} className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium transition-all ${showHistory ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'}`}>
            <History size={12} />历史记录{favorites.length > 0 && <span className="px-1 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold">{favorites.length}</span>}
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-3">
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${storyStep === 'themes' ? 'bg-primary text-white' : 'bg-bg-elevated text-text-tertiary'}`}>
            <span className="w-4 h-4 rounded-full bg-current/20 flex items-center justify-center text-[10px] font-bold">1</span>
            <span>选主题</span>
          </div>
          <div className="flex-1 h-px bg-border" />
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${storyStep === 'outline' ? 'bg-primary text-white' : storyStep === 'panels' ? 'bg-green-500 text-white' : 'bg-bg-elevated text-text-tertiary'}`}>
            <span className="w-4 h-4 rounded-full bg-current/20 flex items-center justify-center text-[10px] font-bold">2</span>
            <span>生成大纲</span>
          </div>
          <div className="flex-1 h-px bg-border" />
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${storyStep === 'panels' ? 'bg-green-500 text-white' : 'bg-bg-elevated text-text-tertiary'}`}>
            <span className="w-4 h-4 rounded-full bg-current/20 flex items-center justify-center text-[10px] font-bold">3</span>
            <span>分镜就绪</span>
          </div>
        </div>

        {/* ── Theme Selection Area ── */}
        {/* Panel count selector */}
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs text-text-tertiary">分镜数量:</span>
          <div className="flex gap-1">
            {[5, 6, 7, 8, 9, 10].map((n) => (
              <button key={n} onClick={() => setPanelCount(n)} className={`w-8 h-7 rounded-lg text-xs font-medium transition-all ${panelCount === n ? 'bg-primary text-white' : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'}`}>{n}</button>
            ))}
          </div>
        </div>

        {/* Theme library button + custom mode */}
        <div className="space-y-2">
          {/* Primary actions */}
          <div className="flex gap-2">
            <button
              onClick={handleOpenThemeLibrary}
              disabled={loadingThemeLibrary}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all ${
                loadingThemeLibrary
                  ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                  : r18Mode
                    ? 'bg-gradient-to-r from-red-500 to-red-600 text-white hover:opacity-90 active:scale-[0.98]'
                    : 'bg-gradient-to-r from-primary to-primary/80 text-white hover:opacity-90 active:scale-[0.98]'
              }`}
            >
              {loadingThemeLibrary ? (
                <><Loader2 size={16} className="animate-spin" /> 加载主题库...</>
              ) : (
                <><LayoutList size={16} />从主题库选择</>
              )}
            </button>
            <button
              onClick={() => handleGenerateThemes()}
              disabled={loading}
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium text-sm transition-all ${
                loading
                  ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                  : r18Mode
                    ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 active:scale-[0.98]'
                    : 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:opacity-90 active:scale-[0.98]'
              }`}
            >
              {loading ? (
                <><Loader2 size={16} className="animate-spin" /> 生成中...</>
              ) : (
                <><Wand2 size={16} />随机生成</>
              )}
            </button>
          </div>

          {/* Custom description toggle */}
          <div className="p-3 rounded-xl border border-border bg-bg-elevated">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-text-primary">自定义选题</span>
                <span className="text-[10px] text-text-tertiary">输入描述生成主题</span>
              </div>
              <button
                onClick={() => setCustomThemeMode(!customThemeMode)}
                className={`relative w-10 h-5 rounded-full transition-all flex-shrink-0 ${customThemeMode ? 'bg-primary' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${customThemeMode ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
            {customThemeMode && (
              <div className="space-y-2">
                <textarea
                  value={customThemeDescription}
                  onChange={(e) => setCustomThemeDescription(e.target.value)}
                  placeholder="例如：办公室暧昧、浴室激情、古风青楼..."
                  className="w-full px-3 py-2 rounded-lg bg-white border border-border text-sm text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                  rows={2}
                />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-tertiary">主题数量:</span>
                  <input
                    type="number"
                    value={customThemeCount}
                    onChange={(e) => setCustomThemeCount(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                    min={1}
                    max={20}
                    className="w-14 px-2 py-1 rounded-lg bg-white border border-border text-xs text-text-primary text-center focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <span className="text-xs text-text-tertiary">个</span>
                  <div className="flex-1" />
                  <button
                    onClick={() => handleGenerateThemes()}
                    disabled={loading || !customThemeDescription.trim()}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      loading || !customThemeDescription.trim()
                        ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                        : r18Mode
                          ? 'bg-red-500 text-white hover:bg-red-600'
                          : 'bg-primary text-white hover:bg-primary/90'
                    }`}
                  >
                    {loading ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                    根据描述生成
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Theme generation in-flight indicator ── */}
        {/* Shown when a themes task is in `pendingPromptTasks` (i.e. the
            backend hasn't returned DONE/FAILED yet). Mirrors the same
            `loading` flag the buttons use, but persists past the initial
            sync fetch so the user sees progress all the way through to
            the async DONE poll. The card also surfaces the backend's
            live progress string ("正在调用 LLM 生成主题..."). */}
        {Object.values(pendingPromptTasks).includes('themes') && (
          <div className="mt-3 p-3 rounded-xl border border-primary/30 bg-primary/5 flex items-center gap-3">
            <Loader2 size={16} className="animate-spin text-primary flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary">
                {customThemeMode ? '自定义主题生成中' : '主题生成中'}
              </p>
              <p className="text-[11px] text-text-tertiary mt-0.5 truncate">
                {themeTaskProgress ?? '后台运行中，关闭页面不影响，稍后回到此页查看'}
              </p>
            </div>
          </div>
        )}

        {/* ── Theme Library Modal ── */}
        {themeLibraryOpen && (
          <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4 animate-fade-in" onClick={() => setThemeLibraryOpen(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden animate-slide-up" onClick={(e) => e.stopPropagation()}>
              {/* Modal header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
                <div className="flex items-center gap-2">
                  <LayoutList size={18} className="text-primary" />
                  <span className="font-semibold text-text-primary">主题库</span>
                  <span className="px-2 py-0.5 rounded-full text-[11px] bg-bg-elevated text-text-tertiary">{themeOptions.length} 个主题</span>
                </div>
                <button onClick={() => setThemeLibraryOpen(false)} className="p-2 rounded-lg hover:bg-bg-hover transition-colors">
                  <X size={18} className="text-text-tertiary" />
                </button>
              </div>

              {/* Search & filter */}
              <div className="px-5 py-3 border-b border-border flex-shrink-0 space-y-2">
                <input
                  type="text"
                  placeholder="搜索主题..."
                  className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30"
                  onChange={(e) => setThemeSearchQuery(e.target.value.toLowerCase())}
                />
                <div className="flex flex-wrap gap-1">
                  {[
                    { label: '全部', cat: '' },
                    { label: '户外', cat: 'outdoor' },
                    { label: '室内', cat: 'indoor' },
                    { label: '制服', cat: 'costume' },
                    { label: 'SM', cat: 'sm' },
                    { label: '幻想', cat: 'fantasy' },
                    { label: '职场', cat: 'work' },
                    { label: '多人', cat: 'multi' },
                    { label: '特殊', cat: 'special' },
                    { label: '玩具', cat: 'toys' },
                    { label: '口交', cat: 'oral' },
                    { label: '肛交', cat: 'anal' },
                    { label: '体液', cat: 'fluid' },
                    { label: '颜射', cat: 'facial' },
                    { label: '交通', cat: 'transport' },
                  ].map(({ label, cat }) => (
                    <button
                      key={cat}
                      onClick={() => setThemeCategoryFilter(cat)}
                      className={`px-2 py-0.5 rounded-full text-[11px] transition-all ${
                        themeCategoryFilter === cat
                          ? 'bg-primary text-white'
                          : 'bg-bg-elevated text-text-secondary hover:bg-primary hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Theme grid */}
              <div className="flex-1 overflow-y-auto p-5">
                {loadingThemeLibrary ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 size={24} className="animate-spin text-text-tertiary" />
                  </div>
                ) : themeOptions.length === 0 ? (
                  <div className="text-center py-12 text-text-tertiary text-sm">
                    <LayoutList size={32} className="mx-auto mb-2 opacity-40" />
                    <p>暂无主题，请先点击「从主题库选择」加载</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* Filtered themes based on search and category */}
                    {(() => {
                      const filteredThemes = themeOptions.filter((t) => {
                        const matchesCategory = !themeCategoryFilter || t.category === themeCategoryFilter;
                        const matchesSearch = !themeSearchQuery ||
                          t.title.toLowerCase().includes(themeSearchQuery) ||
                          t.description.toLowerCase().includes(themeSearchQuery) ||
                          t.tags.some((tag) => tag.toLowerCase().includes(themeSearchQuery));
                        return matchesCategory && matchesSearch;
                      });
                      return (
                        <>
                          <div className="flex items-center gap-2 px-1">
                            <span className="text-xs text-text-tertiary">显示 {filteredThemes.length} / {themeOptions.length} 个主题</span>
                          </div>
                          {filteredThemes.length === 0 ? (
                            <div className="text-center py-8 text-text-tertiary text-sm">
                              <p>没有找到匹配的主题</p>
                            </div>
                          ) : (
                            <>
                              {/* Select all filtered */}
                              {filteredThemes.length > 1 && (
                                <div className="flex items-center gap-2 px-1">
                                  <button
                                    onClick={() => {
                                      const filteredIds = filteredThemes.map((t) => t.id);
                                      const currentlySelectedIds = selectedThemes.map((t) => t.id);
                                      const allFilteredSelected = filteredIds.every((id) => currentlySelectedIds.includes(id));
                                      if (allFilteredSelected) {
                                        // Deselect all filtered
                                        setSelectedThemes(selectedThemes.filter((t) => !filteredIds.includes(t.id)));
                                      } else {
                                        // Select all filtered
                                        const newThemes = [...selectedThemes.filter((t) => !filteredIds.includes(t.id)), ...filteredThemes];
                                        setSelectedThemes(newThemes);
                                      }
                                    }}
                                    className="flex items-center gap-2 text-xs text-text-secondary hover:text-primary transition-colors"
                                  >
                                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                                      (() => {
                                        const filteredIds = filteredThemes.map((t) => t.id);
                                        const currentlySelectedIds = selectedThemes.map((t) => t.id);
                                        return filteredIds.length > 0 && filteredIds.every((id) => currentlySelectedIds.includes(id));
                                      })()
                                        ? 'bg-primary border-primary'
                                        : 'border-border hover:border-primary'
                                    }`}>
                                      {((): boolean => {
                                        const filteredIds = filteredThemes.map((t) => t.id);
                                        const currentlySelectedIds = selectedThemes.map((t) => t.id);
                                        return filteredIds.length > 0 && filteredIds.every((id) => currentlySelectedIds.includes(id));
                                      })() && (
                                        <Check size={10} className="text-white" />
                                      )}
                                    </div>
                                    <span className="font-medium">全选 ({(() => {
                                      const filteredIds = filteredThemes.map((t) => t.id);
                                      const currentlySelectedIds = selectedThemes.map((t) => t.id);
                                      return filteredIds.filter((id) => currentlySelectedIds.includes(id)).length;
                                    })()}/{filteredThemes.length})</span>
                                  </button>
                                </div>
                              )}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {filteredThemes.map((theme) => {
                        const isAlreadySelected = selectedThemes.some((t) => t.id === theme.id);
                        return (
                          <div
                            key={theme.id}
                            onClick={() => {
                              if (isAlreadySelected) {
                                setSelectedThemes(selectedThemes.filter((t) => t.id !== theme.id));
                              } else {
                                setSelectedThemes([...selectedThemes, theme]);
                              }
                              // Stay in modal — no auto-navigation
                            }}
                            className={`relative p-3 rounded-xl border cursor-pointer transition-all ${
                              isAlreadySelected
                                ? 'border-green-400 bg-green-50/50'
                                : 'border-border bg-bg-elevated hover:bg-bg-hover hover:border-primary/40'
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              {/* Checkbox */}
                              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${
                                isAlreadySelected
                                  ? 'bg-green-500 border-green-500'
                                  : 'border-border bg-white'
                              }`}>
                                {isAlreadySelected && <Check size={10} className="text-white" />}
                              </div>
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                                isAlreadySelected ? 'bg-green-500 text-white' : r18Mode ? 'bg-red-100 text-red-600' : 'bg-primary/10 text-primary'
                              }`}>
                                {theme.id}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                                  <p className="text-sm font-semibold text-text-primary leading-tight">{theme.title}</p>
                                  {theme.category && (
                                    <span className="text-[9px] px-1 py-0.5 rounded-full bg-bg-elevated text-text-tertiary">{theme.category}</span>
                                  )}
                                  <span className={`text-[9px] px-1 py-0.5 rounded-full font-medium ${
                                    theme.r18_level === 'hard' ? 'bg-red-100 text-red-600' : theme.r18_level === 'medium' ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'
                                  }`}>
                                    {theme.r18_level === 'hard' ? '高强度' : theme.r18_level === 'medium' ? '中等' : '柔和'}
                                  </span>
                                </div>
                                <p className="text-[11px] text-text-tertiary leading-relaxed line-clamp-2">{theme.description}</p>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {theme.tags.slice(0, 3).map((tag, i) => (
                                    <span key={i} className="text-[9px] px-1 py-0.5 rounded-full bg-bg-elevated text-text-secondary">{tag}</span>
                                  ))}
                                </div>
                                {(theme.scenario_count || 0) > 0 || (theme.costume_count || 0) > 0 ? (
                                  <div className="flex flex-wrap gap-1 mt-1.5">
                                    {(theme.scenario_count || 0) > 0 && (
                                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">
                                        {theme.scenario_count} 个场景
                                      </span>
                                    )}
                                    {(theme.costume_count || 0) > 0 && (
                                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-600 font-medium">
                                        {theme.costume_count} 种服装
                                      </span>
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                            </>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* Modal footer */}
              <div className="px-5 py-3 border-t border-border flex items-center justify-between flex-shrink-0 bg-bg-elevated/50">
                <span className="text-xs text-text-tertiary">已选 {selectedThemes.length} 个主题</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setThemeLibraryOpen(false)}
                    className="px-4 py-2 rounded-lg text-xs text-text-tertiary hover:bg-bg-hover transition-all"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => {
                      if (selectedThemes.length === 0) {
                        // No selection — treat "确定" as "select all" so the
                        // button is still useful even before the user clicks
                        // any individual card.
                        setSelectedThemes([...themeOptions]);
                        onSuccess(`已全选 ${themeOptions.length} 个主题，可继续筛选`);
                        return;
                      }
                      // Close the modal and proceed to outline generation.
                      // The "为已选主题生成大纲" panel below is always visible
                      // when selectedThemes.length > 0, so the user just
                      // needs to click that button next.
                      setThemeLibraryOpen(false);
                      onSuccess(`已选定 ${selectedThemes.length} 个主题，下一步点击「为 ${selectedThemes.length} 个主题生成大纲」`);
                    }}
                    className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                      selectedThemes.length > 0
                        ? 'bg-green-500 text-white hover:bg-green-600'
                        : 'bg-primary text-white hover:bg-primary/90'
                    }`}
                  >
                    {selectedThemes.length > 0
                      ? `已选 ${selectedThemes.length} 个，确定`
                      : '全选全部主题'}
                  </button>
                  {selectedThemes.length === themeOptions.length && (
                    <button
                      onClick={() => setSelectedThemes([])}
                      className="px-4 py-2 rounded-lg text-xs text-text-tertiary hover:bg-bg-hover transition-all"
                    >
                      取消全选
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Selected themes panel (always visible when themes are selected) ── */}
        {storyStep === 'themes' && selectedThemes.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-text-primary">已选主题</span>
                <span className="px-1.5 py-0.5 rounded-full text-[11px] bg-primary/10 text-primary font-medium">{selectedThemes.length}</span>
              </div>
              <button
                onClick={handleGenerateSelectedThemes}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  r18Mode
                    ? 'bg-gradient-to-r from-red-500 to-red-600 text-white hover:opacity-90'
                    : 'bg-gradient-to-r from-primary to-primary/80 text-white hover:opacity-90'
                }`}
              >
                <Wand2 size={12} />
                为 {selectedThemes.length} 个主题生成大纲
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {selectedThemes.map((theme) => {
                const state = themeOutlineStates[theme.id];
                const isGenerating = !!state?.generating;
                const isDone = !!state?.outlineArc;
                const hasError = !!state?.error;
                return (
                  <div
                    key={theme.id}
                    className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${
                      isDone
                        ? 'border-green-300 bg-green-50/30'
                        : isGenerating
                          ? 'border-yellow-300 bg-yellow-50/30'
                          : hasError
                            ? 'border-red-300 bg-red-50/30'
                            : 'border-border bg-bg-elevated'
                    }`}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRemoveThemeFromSelected(theme.id); }}
                      className="flex-shrink-0 p-0.5 rounded text-text-tertiary hover:text-red-500 transition-colors mt-0.5"
                      title="移除"
                    >
                      <X size={14} />
                    </button>
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                      isDone ? 'bg-green-500 border-green-500' : hasError ? 'bg-red-500 border-red-500' : 'border-border'
                    }`}>
                      {isDone ? <Check size={10} className="text-white" /> : hasError ? <AlertCircle size={10} className="text-white" /> : null}
                    </div>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                      isDone ? 'bg-green-500 text-white' : isGenerating ? 'bg-yellow-500 text-white' : hasError ? 'bg-red-500 text-white' : r18Mode ? 'bg-red-100 text-red-600' : 'bg-primary/10 text-primary'
                    }`}>
                      {isGenerating ? <Loader2 size={10} className="animate-spin" /> : theme.id}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <p className="text-sm font-semibold text-text-primary">{theme.title}</p>
                        {theme.category && (
                          <span className="text-[9px] px-1 py-0.5 rounded-full bg-bg-elevated text-text-tertiary">{theme.category}</span>
                        )}
                        <span className={`text-[9px] px-1 py-0.5 rounded-full font-medium ${
                          theme.r18_level === 'hard' ? 'bg-red-100 text-red-600' : theme.r18_level === 'medium' ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'
                        }`}>
                          {theme.r18_level === 'hard' ? '高强度' : theme.r18_level === 'medium' ? '中等' : '柔和'}
                        </span>
                        {isDone && <span className="text-[9px] text-green-600 font-medium">已生成</span>}
                        {isGenerating && state?.startedAt && (
                          <span className="text-[9px] text-yellow-600 font-medium animate-pulse">
                            生成中… {formatElapsed(Date.now() - state.startedAt)}
                          </span>
                        )}
                        {isGenerating && !state?.startedAt && (
                          <span className="text-[9px] text-yellow-600 font-medium animate-pulse">生成中...</span>
                        )}
                        {hasError && <span className="text-[9px] text-red-500 font-medium">失败</span>}
                      </div>
                      {isGenerating && state?.startedAt && (() => {
                        const elapsedMs = Date.now() - state.startedAt;
                        // Warn at 2 min ("可能较慢"), be explicit at 5 min
                        // ("可后台等待") — this is the user's only signal
                        // that the request is still alive but the LLM is
                        // slow. The hard 10-min cap is enforced separately.
                        if (elapsedMs < 2 * 60 * 1000) return null;
                        const warn = elapsedMs >= 5 * 60 * 1000
                          ? '已超过 5 分钟，任务仍在后台运行，可关闭此页面稍后回来查看。'
                          : '生成时间较长，请耐心等待。';
                        return (
                          <p className={`text-[10px] mt-0.5 ${elapsedMs >= 5 * 60 * 1000 ? 'text-orange-600' : 'text-text-tertiary'}`}>
                            {warn}
                          </p>
                        );
                      })()}
                      {hasError ? (
                        <p className="text-[11px] text-red-400 leading-relaxed line-clamp-1">{state.error}</p>
                      ) : (
                        <p className="text-[11px] text-text-tertiary leading-relaxed line-clamp-1">
                          {isDone && state ? state.outlineArc : theme.description}
                        </p>
                      )}
                      {/* Live progress string from the backend, e.g.
                          "正在校验第 3/5 个分镜...". Shown only while
                          generating. Lives below the description so it
                          doesn't push out the theme description. */}
                      {isGenerating && state?.progress && (
                        <p className="text-[10px] text-primary mt-0.5 line-clamp-1" title={state.progress}>
                          {state.progress}
                        </p>
                      )}
                      {isDone && (
                        <p className="text-[10px] text-text-tertiary mt-0.5">{state.panels.length} 个分镜</p>
                      )}
                      {/* Action buttons */}
                      <div className="flex items-center gap-1.5 mt-2">
                        {isDone && state && (
                          <>
                            <button
                              onClick={() => {
                                setActiveThemeTab(theme.id);
                                setPanels(state.panels);
                                setOutlineArc(state.outlineArc);
                                setOutlineScenes(state.outlineScenes);
                                setStoryStep('panels');
                                setPanelVideoPrompts({});
                                const hid = state.historyId;
                                if (hid) {
                                  setCurrentHistoryId(hid);
                                  const cached = getAllCachedPanelImages(hid, state.panels.length);
                                  if (Object.keys(cached).length > 0) {
                                    const initial: Record<string, { loading: boolean; images: string[] }> = {};
                                    for (const [idx, imgs] of Object.entries(cached)) {
                                      initial[`${hid}_${idx}`] = { loading: false, images: imgs };
                                    }
                                    setGenStates(initial);
                                  }
                                }
                              }}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-primary text-white hover:bg-primary/90 transition-all"
                            >
                              加载分镜
                            </button>
                            <button
                              onClick={() => handleGenerateOutlineSingle(theme)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-bg-elevated text-text-secondary hover:bg-bg-hover transition-all"
                            >
                              重新生成
                            </button>
                          </>
                        )}
                        {!isGenerating && !isDone && (
                          <button
                            onClick={() => handleGenerateOutlineSingle(theme)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                              hasError
                                ? 'bg-red-500 text-white hover:bg-red-600'
                                : r18Mode ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-primary text-white hover:bg-primary/90'
                            }`}
                          >
                            {hasError ? '重试' : '生成大纲'}
                          </button>
                        )}
                        {isGenerating && (
                          <button
                            onClick={() => {
                              setThemeOutlineStates((prev) => {
                                const next = { ...prev };
                                delete next[theme.id];
                                return next;
                              });
                            }}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-bg-elevated text-text-secondary hover:bg-bg-hover transition-all"
                          >
                            取消
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Theme grid for selection (always visible when there are themes to choose from) ── */}
        {storyStep === 'themes' && themeOptions.length > 0 && (
          <div className="space-y-2 mt-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-text-tertiary font-medium">请选择主题（{themeOptions.length} 个可选）</p>
              <button
                onClick={() => setSelectedThemes([...themeOptions])}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-primary hover:bg-primary/5 transition-all"
              >
                <Check size={10} />
                全选
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {themeOptions.map((theme) => {
                const isSelected = selectedThemes.some((t) => t.id === theme.id);
                return (
                  <button
                    type="button"
                    key={theme.id}
                    onClick={() => {
                      if (isSelected) {
                        setSelectedThemes(selectedThemes.filter((t) => t.id !== theme.id));
                      } else {
                        setSelectedThemes((prev) => [...prev, theme]);
                      }
                    }}
                    className={`w-full text-left p-3 rounded-xl border transition-all ${
                      isSelected
                        ? 'border-green-400 bg-green-50/30'
                        : 'border-border bg-bg-elevated hover:bg-bg-hover'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${
                        isSelected ? 'bg-green-500 border-green-500' : 'border-border bg-white'
                      }`}>
                        {isSelected && <Check size={10} className="text-white" />}
                      </div>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${isSelected ? 'bg-green-500 text-white' : r18Mode ? 'bg-red-100 text-red-600' : 'bg-primary/10 text-primary'}`}>
                        {theme.id}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className={`text-sm font-semibold ${r18Mode ? 'text-red-700' : 'text-text-primary'}`}>{theme.title}</p>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${theme.r18_level === 'hard' ? 'bg-red-100 text-red-600' : theme.r18_level === 'medium' ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'}`}>
                            {theme.r18_level === 'hard' ? '高强度' : theme.r18_level === 'medium' ? '中等' : '柔和'}
                          </span>
                          {theme.category && (
                            <span className="text-[9px] px-1 py-0.5 rounded-full bg-bg-elevated text-text-tertiary">{theme.category}</span>
                          )}
                        </div>
                        <p className="text-xs text-text-tertiary leading-relaxed">{theme.description}</p>
                        {theme.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {theme.tags.map((tag, i) => (
                              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-elevated text-text-secondary">{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 3: Outline + panels */}
        {storyStep === 'panels' && panels.length > 0 && (
          <>
            {outlineArc && (
              <div className={`mb-3 p-3 rounded-xl border ${r18Mode ? 'bg-red-50/40 border-red-200' : 'bg-primary/5 border-primary/20'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <Clapperboard size={14} className={r18Mode ? 'text-red-500' : 'text-primary'} />
                  <span className={`text-xs font-semibold ${r18Mode ? 'text-red-600' : 'text-primary'}`}>剧情大纲</span>
                </div>
                <p className="text-sm font-medium text-text-primary mb-2">{outlineArc}</p>
                {outlineScenes.length > 0 && (
                  <div className="space-y-1.5">
                    {outlineScenes.map((scene, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5 ${r18Mode ? 'bg-red-500 text-white' : 'bg-primary text-white'}`}>{i + 1}</span>
                        <p className="text-xs text-text-secondary leading-relaxed">{scene}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              <button onClick={handleCopyAll} className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl font-medium text-sm bg-bg-elevated text-text-tertiary hover:bg-bg-hover transition-colors">
                {copiedPanel === -1 ? <><Check size={14} className="text-green-500" /> 已复制</> : <><Copy size={14} />复制全部</>}
              </button>
              <button
                onClick={handleGenerateScript}
                disabled={generatingScript}
                className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl font-medium text-sm transition-all ${generatingScript ? 'bg-bg-elevated text-text-secondary cursor-not-allowed' : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:opacity-90'}`}
              >
                {generatingScript ? <><Loader2 size={14} className="animate-spin" /> 生成脚本...</> : <><Clapperboard size={14} />生成视频脚本</>}
              </button>
              <button onClick={() => { setStoryStep('themes'); setSelectedTheme(null); setOutlineArc(''); setOutlineScenes([]); setPanels([]); setVideoScript(null); setPanelVideoPrompts({}); setPanelH3Prompts({}); setPanelH3CommonParts({}); setPanelH3ShotMap({}); autoH3TriggeredRef.current.clear(); }} className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl font-medium text-sm bg-bg-elevated text-text-tertiary hover:bg-bg-hover transition-colors">
                <RotateCcw size={14} />换主题
              </button>
            </div>

            {/* Video Script Display */}
            {videoScript && (
              <div className={`mt-3 p-3 rounded-xl border ${r18Mode ? 'bg-purple-50/40 border-purple-200' : 'bg-purple-50/40 border-purple-200'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Clapperboard size={14} className="text-purple-500" />
                    <span className="text-xs font-semibold text-purple-600">视频脚本</span>
                    {videoScript.duration && <span className="text-[10px] text-purple-400">{videoScript.duration}</span>}
                  </div>
                  <button onClick={() => setVideoScript(null)} className="text-xs text-purple-400 hover:text-purple-600">
                    <X size={14} />
                  </button>
                </div>
                <p className="text-sm font-medium text-text-primary mb-2">{videoScript.script_title}</p>
                <div className="space-y-2">
                  {videoScript.panels.map((sp) => (
                    <div key={sp.panel} className={`rounded-lg p-3 text-xs ${r18Mode ? 'bg-red-50/50 border border-red-100' : 'bg-bg-elevated'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${r18Mode ? 'bg-red-500' : 'bg-purple-500'}`}>{sp.panel}</span>
                        <span className="font-medium text-text-primary">{sp.heading}</span>
                      </div>
                      {sp.action && <p className="text-text-secondary leading-relaxed mb-1"><span className="text-text-tertiary">动作: </span>{sp.action}</p>}
                      {sp.dialogue && <p className="text-text-secondary leading-relaxed mb-1"><span className="text-text-tertiary">对白: </span><em>"{sp.dialogue}"</em></p>}
                      {sp.sound_cue && <p className="text-text-secondary leading-relaxed mb-1"><span className="text-text-tertiary">音效: </span><span className="text-purple-500">{sp.sound_cue}</span></p>}
                      {sp.camera && <p className="text-text-secondary leading-relaxed"><span className="text-text-tertiary">镜头: </span><span className="text-blue-500">{sp.camera}</span></p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {hasContent && (
          <button onClick={handleReset} className="w-full mt-2 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl font-medium text-sm bg-bg-elevated text-text-tertiary hover:bg-bg-hover transition-colors">
            <RotateCcw size={14} />重新开始
          </button>
        )}
      </div>

      {/* Storyboard History + Favorites */}
      {showHistory && (
        <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
          <div className="flex items-center border-b border-border/50 bg-bg-elevated">
            <button
              onClick={() => setHistoryTab('history')}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-r border-border/50 transition-all ${historyTab === 'history' ? 'text-primary border-b-2 border-primary bg-white' : 'text-text-tertiary hover:text-text-primary'}`}
            >
              <History size={12} />
              分镜历史<span className="px-1.5 py-0.5 rounded-full text-[10px] bg-bg-elevated">{history.length}</span>
            </button>
            <button
              onClick={() => setHistoryTab('favorites')}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-r border-border/50 transition-all ${historyTab === 'favorites' ? 'text-red-500 border-b-2 border-red-500 bg-white' : 'text-text-tertiary hover:text-text-primary'}`}
            >
              <Heart size={12} />
              我的收藏<span className="px-1.5 py-0.5 rounded-full text-[10px] bg-bg-elevated">{favorites.length}</span>
            </button>
            <div className="flex-1" />
            <button onClick={() => setShowHistory(false)} className="px-3 py-2.5 text-text-tertiary hover:text-text-primary transition-colors">
              <X size={14} />
            </button>
          </div>
          <div className="max-h-[500px] overflow-y-auto">
            {historyTab === 'history' ? (
              <StoryboardHistoryList
                history={history}
                onLoad={handleHistoryLoad}
                onDelete={handleDeleteHistory}
              />
            ) : (
              <FavoritesList
                favorites={favorites}
                r18Mode={r18Mode}
                onRemove={(id) => { removeFavorite(id); setFavorites(getFavorites()); }}
                onClear={() => { clearFavorites(); setFavorites([]); }}
              />
            )}
          </div>
        </div>
      )}

      {/* Panels */}
      {storyStep === 'panels' && (activePanels.length > 0 || activeThemeTabInFlight) && (
        <div className="space-y-3">
          {/* Theme tabs - show ALL selected themes (including those still generating).
              只显示有 outlineArc / generating / error 的主题，未开始生成的主题不显示 tab。 */}
          {selectedThemes.length > 0 && selectedThemes.some((t) => {
            const s = themeOutlineStates[t.id];
            return s?.outlineArc || s?.generating || s?.error;
          }) && (
            <div className="flex flex-wrap gap-2 px-1">
              {selectedThemes.filter((t) => {
                const s = themeOutlineStates[t.id];
                return s?.outlineArc || s?.generating || s?.error;
              }).map((theme) => {
                const isActive = activeThemeTab === theme.id;
                const state = themeOutlineStates[theme.id];
                const isGenerating = !!state?.generating;
                const hasError = !!state?.error;
                const isDone = !!state?.outlineArc;
                return (
                  <button
                    key={theme.id}
                    onClick={() => handleViewThemePanels(theme.id)}
                    title={
                      isGenerating ? '生成中…' :
                      hasError ? `生成失败：${state.error}` :
                      isDone ? `已生成 ${state.panels.length} 个分镜` :
                      '等待生成'
                    }
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isActive
                        ? 'bg-primary text-white shadow-sm'
                        : isGenerating
                          ? 'bg-yellow-50 text-yellow-700 border border-yellow-300 hover:bg-yellow-100'
                          : hasError
                            ? 'bg-red-50 text-red-600 border border-red-300 hover:bg-red-100'
                            : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                    }`}
                  >
                    {isGenerating ? <Loader2 size={11} className="animate-spin" /> :
                     hasError ? <AlertCircle size={11} /> :
                     <LayoutList size={11} />}
                    {theme.title}
                    {isDone && !isActive && <Check size={10} className="text-green-500" />}
                  </button>
                );
              })}
            </div>
          )}

          {/* Active theme label + batch action bar — hidden when the active
              theme tab is still in flight (no panels yet) because there's
              nothing to operate on. The "generating" placeholder below
              replaces this section's purpose for in-flight tabs.
              MOBILE LAYOUT FIX: previously this was `flex items-center
              justify-between` with no wrap, which on a 390px viewport
              pushed the H3 subgroup to its 2nd internal row because of
              `flex-wrap`, and the bottom-right "一键长视频v1.1" button
              ended up *between* the title row and the panel cards —
              overflowing the toolbar's vertical bounds on small screens.
              On the iPhone-class viewport users were tapping, the
              button's bounding box overlapped with the first panel
              card (which has its own click handlers), so the click
              reached the panel card instead of the long-video button
              and "didn't navigate". Stack everything vertically on
              `< sm`, restore side-by-side only on `≥ sm`. */}
          {!activeThemeTabInFlight && (
            <div className="flex flex-col gap-2 px-1 sm:flex-row sm:items-center sm:justify-between sm:gap-0">
              <span className="text-xs text-text-tertiary font-medium">
                {activeThemeInfo && <span className="mr-1">{activeThemeInfo.title} · </span>}
                {activePanels.length} 个分镜
              </span>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
                <button
                  onClick={handleBatchGenerate}
                  disabled={batchLoading || taskManager.isFull || (digitalHumanMode && !selectedGirlfriend)}
                  title="为当前主题的所有分镜批量生成图片"
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                    batchLoading || taskManager.isFull || (digitalHumanMode && !selectedGirlfriend)
                      ? 'bg-blue-100 text-blue-500 cursor-not-allowed border border-blue-200'
                      : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:opacity-90 active:scale-[0.98]'
                  }`}
                >
                  {batchLoading
                    ? <><Loader2 size={12} className="animate-spin" />图片生成中…</>
                    : <><Zap size={12} />一键批量生图</>}
                </button>
                {/* H3 提示词引擎
                    - Mobile (`< sm`): each row is its own flex line so 按钮
                      不被裁切；duration 三个按钮 + 长视频 1.1 按钮各占
                      一行（手指头大 ≈ 44px 高度，拇指可点）。
                    - Desktop (`≥ sm`): 单行排列，开关紧凑。 */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-1 sm:flex-wrap">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[10px] text-indigo-500">H3:</span>
                  {([15, 30, 60] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setPanelH3Duration(d)}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                        panelH3Duration === d ? 'bg-indigo-500 text-white' : 'bg-indigo-100 text-indigo-600'
                      }`}
                    >
                      {d}秒
                    </button>
                  ))}
                  </div>
                  <button
                    type="button"
                    onClick={handleBatchGenerateH3}
                    disabled={activePanels.length === 0 || Object.values(panelH3Loading).some(Boolean)}
                    title="为当前主题的所有分镜生成/重新生成 H3 视频提示词（已有提示词会被覆盖）"
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors ${
                      Object.values(panelH3Loading).some(Boolean)
                        ? 'bg-indigo-100 text-indigo-500 border border-indigo-200 cursor-not-allowed'
                        : (panelH3ShotMap[sbHistoryId || 'solo']?.size ?? 0) > 0
                          ? 'bg-white text-indigo-600 border border-indigo-300 hover:bg-indigo-50'
                          : 'bg-indigo-500 text-white hover:bg-indigo-600'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {Object.values(panelH3Loading).some(Boolean)
                      ? <><Loader2 size={10} className="animate-spin" />视频提示词生成中…</>
                      : (panelH3ShotMap[sbHistoryId || 'solo']?.size ?? 0) > 0
                        ? <><RefreshCw size={10} />重新生成H3提示词</>
                        : <><Sparkles size={10} />一键生成H3视频提示词</>}
                  </button>
                  {/* 一键批量上传到长视频 v1.1（多图 + 完整 H3 提示词） */}
                  <button
                    type="button"
                    onClick={handleBatchGotoLongVideoWithH3}
                    disabled={
                      batchVideoLoading ||
                      activePanels.length === 0 ||
                      !panelH3CommonParts[sbHistoryId || 'solo'] ||
                      !panelH3ShotMap[sbHistoryId || 'solo'] ||
                      (panelH3ShotMap[sbHistoryId || 'solo']?.size ?? 0) === 0
                    }
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                    title="将所有分镜的图片批量上传到长视频 v1.1 的多个 slot，拼接完整 H3 提示词（一键多图生视频）"
                  >
                    {batchVideoLoading ? <><Loader2 size={10} className="animate-spin" /> 上传中...</> : <><Clapperboard size={10} />一键长视频v1.1</>}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Missing H3 prompts banner — shown when panelH3ShotMap is
              partially populated (e.g. user reported screenshots showing
              "部分主题的分镜提示词缺失"). Surface the count and offer
              a one-click补全 (does NOT overwrite existing shots). */}
          {!activeThemeTabInFlight && activePanels.length > 0 && (() => {
            const curShotMap = panelH3ShotMap[sbHistoryId || 'solo'];
            const missingCount = curShotMap
              ? activePanels.filter((_, i) => !curShotMap.has(i + 1)).length
              : activePanels.length;
            if (missingCount === 0) return null;
            const isLoadingAny = Object.values(panelH3Loading).some(Boolean);
            return (
              <div className="rounded-xl bg-amber-50/70 border border-amber-200 px-3 py-2 flex flex-wrap items-center gap-2 text-xs text-amber-800">
                <AlertCircle size={13} className="text-amber-500 flex-shrink-0" />
                <span className="flex-1 min-w-0">
                  有 <strong>{missingCount}</strong> / {activePanels.length} 个分镜的 H3 视频提示词缺失，可一键补全（不会覆盖已有提示词）。
                </span>
                <button
                  type="button"
                  onClick={handleRetryMissingH3Prompts}
                  disabled={isLoadingAny}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${
                    isLoadingAny
                      ? 'bg-amber-100 text-amber-500 cursor-not-allowed'
                      : 'bg-amber-500 text-white hover:bg-amber-600'
                  }`}
                >
                  {isLoadingAny
                    ? <><Loader2 size={10} className="animate-spin" />补全中…</>
                    : <><RefreshCw size={10} />补全缺失提示词</>}
                </button>
              </div>
            );
          })()}

          {activePanels.map((panel, idx) => {
            // Use theme-specific panel key to avoid conflicts when switching tabs
            const selKey = activeThemeTab !== null ? `theme-${activeThemeTab}-panel-${idx}` : `panel-${idx}`;
            // 主题-scoped key：所有提示词都按 `${sbHistoryId}_${idx}` 隔离存储
            const pK = promptKey(idx, sbHistoryId);
            const selectedImage = selectedPanelImages[selKey];
            // 【修复】动画提示词直接读取 panelVideoPrompts[pK]（主题-scoped key）：
            //   - 图片生成成功后，自动调用 LLM 生成的 H3 Shot 提示词会写入这里
            //   - 用户也可以手动编辑该区域
            //   - 不再自动兜底（之前用 extractVideoPromptFromImagePrompt 自动填充的设计取消）
            const videoPrompt = panelVideoPrompts[pK];
            const normalizedPanelPrompt = panel.image_prompt.trim().replace(/\s+/g, ' ');
            const panelRelatedTasks = taskManager.tasks.filter(
              (t: QueuedTask) => (t.status === 'RUNNING' || t.status === 'QUEUEING' || t.status === 'FINISHED') && t.images.length > 0
            ).filter((t: QueuedTask) => {
              const taskPromptNorm = t.prompt.trim().replace(/\s+/g, ' ');
              return taskPromptNorm === normalizedPanelPrompt ||
                taskPromptNorm.includes(normalizedPanelPrompt) ||
                normalizedPanelPrompt.includes(taskPromptNorm) ||
                (normalizedPanelPrompt.length > 50 && taskPromptNorm.includes(normalizedPanelPrompt.substring(0, Math.min(normalizedPanelPrompt.length, 150))));
            });
            const genStateKey = `${sbHistoryId}_${idx}`;
            const hasGenerated = (genStates[genStateKey]?.images?.length ?? 0) > 0;
            return (
              <StoryboardPanelCard
                key={selKey}
                panel={panel}
                idx={idx}
                isExpanded={expandedPanel === idx}
                r18Mode={r18Mode}
                copiedPanel={copiedPanel}
                onToggle={() => setExpandedPanel(expandedPanel === idx ? null : idx)}
                onCopyPanel={() => handleCopyPanel(panel, idx)}
                genState={genStates[genStateKey]}
                onGenerateImage={() => handleStoryboardGenerateImage(idx, panel.image_prompt)}
                onFavorited={(url) => handleToggleFavorite(url, panel.image_prompt)}
                taskManager={taskManager}
                digitalHumanMode={digitalHumanMode}
                selectedGirlfriend={selectedGirlfriend}
                selectedImageIndex={selectedImage?.index}
                onSelectImage={(imageIdx, imageUrl) => handleSelectPanelImage(selKey, imageIdx, imageUrl)}
                onDownload={handleDownloadImage}
                videoPrompt={videoPrompt}
                hasGeneratedImages={hasGenerated}
                onPreviewImage={handlePreviewImage}
                videoGenLoading={videoGenLoading[selKey]}
                onDirectGenerateVideo={(imageUrl, prompt) => handleDirectGenerateVideo(selKey, imageUrl, prompt)}
                themeTitle={activeThemeInfo?.title || plot}
                onRegenerateVideoPrompt={() => handleRegenerateVideoPrompt(idx)}
                promptEditLoading={!!promptEditLoading[idx]}
                onVideoPromptChange={(newPrompt) => setPanelVideoPrompts((prev) => ({ ...prev, [pK]: newPrompt }))}
                historyId={sbHistoryId || ''}
                // 图片提示词编辑 + 重新生成
                onImagePromptChange={(newPrompt) => handleImagePromptChange(idx, newPrompt)}
                onRegenerateImagePrompt={() => handleRegenerateImagePrompt(idx, panel)}
                imagePromptRegenLoading={!!imagePromptRegenLoading[`${sbHistoryId || 'solo'}_${idx}`]}
                onPanelH3PromptChange={(newPrompt) => handlePanelH3PromptChange(idx, newPrompt)}
                // H3 提示词引擎相关
                panelH3Prompt={panelH3Prompts[pK]}
                panelH3Duration={panelH3Duration}
                panelH3Loading={!!panelH3Loading[pK]}
                panelH3ConstraintEnabled={panelH3ConstraintEnabled[sbHistoryId || 'solo']}
                onTogglePanelH3Constraint={handleTogglePanelH3Constraint}
                onGeneratePanelH3={() => handleGeneratePanelH3(idx, panel)}
                onGotoLongVideoWithH3={(imageUrl) => handleGotoLongVideoWithH3(idx, panel, imageUrl, panelH3Prompts[pK])}
              />
            );
          })}

          {/* Generating / error placeholder for the currently-active theme tab.
              Shown when the user picked a theme tab that's still in flight
              (activePanels.length === 0 but state.generating or state.error
              is set). Without this the panels section would hide entirely,
              looking like the user got bounced back to the linear flow. */}
          {activeThemeTabInFlight && activeThemeTab !== null && (() => {
            const inFlightState = themeOutlineStates[activeThemeTab];
            const inFlightTheme = selectedThemes.find((t) => t.id === activeThemeTab);
            if (!inFlightTheme) return null;
            if (inFlightState?.error) {
              return (
                <div className="rounded-2xl bg-red-50 border border-red-200 p-5 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <AlertCircle size={16} className="text-red-500" />
                    <span className="text-sm font-semibold text-red-700">
                      「{inFlightTheme.title}」大纲生成失败
                    </span>
                  </div>
                  <p className="text-xs text-red-600/80 leading-relaxed">{inFlightState.error}</p>
                  <button
                    onClick={() => handleGenerateOutlineForTheme(inFlightTheme)}
                    className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition-colors"
                  >
                    <RotateCcw size={12} />重新生成
                  </button>
                </div>
              );
            }
            if (inFlightState?.generating) {
              const liveProgress = inFlightState.progress || `正在为「${inFlightTheme.title}」生成 ${panelCount} 个分镜...`;
              return (
                <div className="rounded-2xl bg-yellow-50/60 border border-yellow-200 p-5 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin text-yellow-600" />
                    <span className="text-sm font-semibold text-yellow-800">
                      「{inFlightTheme.title}」大纲生成中
                    </span>
                  </div>
                  <p className="text-xs text-yellow-700/80 leading-relaxed">{liveProgress}</p>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-yellow-700/70">
                    <Clock size={11} />
                    <span>已等待 {formatElapsed(Date.now() - (inFlightState.startedAt || Date.now()))}</span>
                    <span className="mx-1">·</span>
                    <span>最长约 3 分钟（后台运行，可切换到其他主题继续工作）</span>
                  </div>
                </div>
              );
            }
            return null;
          })()}
        </div>
      )}

      {/* Image Preview Overlay */}
      {showPreview && previewImages.length > 0 && (
        <div
          className="fixed inset-0 z-[9999] bg-black/95 flex flex-col animate-fade-in"
          onClick={() => setShowPreview(false)}
        >
          <div className="flex items-center justify-between px-6 py-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="text-sm text-white/60">{previewIndex + 1} / {previewImages.length}</span>
              <button
                onClick={() => handleToggleFavorite(previewImages[previewIndex], previewPrompt)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  isFavorited(previewImages[previewIndex])
                    ? 'bg-red-500 text-white'
                    : 'bg-white/90 text-gray-700 hover:bg-white'
                }`}
              >
                <Heart size={12} fill={isFavorited(previewImages[previewIndex]) ? 'currentColor' : 'none'} />
                {isFavorited(previewImages[previewIndex]) ? '已收藏' : '收藏'}
              </button>
              <button
                onClick={() => handleDownloadImage(previewImages[previewIndex])}
                title="下载图片"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-white/90 text-gray-700 hover:bg-white transition-all"
              >
                <Download size={12} />下载
              </button>
            </div>
            <button
              onClick={() => setShowPreview(false)}
              className="w-10 h-10 rounded-full bg-white/90 hover:bg-white text-gray-700 flex items-center justify-center transition-colors"
            >
              <X size={20} />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center relative" onClick={(e) => e.stopPropagation()}>
            {previewImages.length > 1 && (
              <button
                onClick={() => setPreviewIndex((i) => (i - 1 + previewImages.length) % previewImages.length)}
                className="absolute left-4 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
              >
                <ChevronLeft size={24} />
              </button>
            )}
            <img
              src={previewImages[previewIndex]}
              alt=""
              className="max-w-full max-h-full object-contain select-none"
              style={{ maxHeight: 'calc(100vh - 120px)' }}
            />
            {previewImages.length > 1 && (
              <button
                onClick={() => setPreviewIndex((i) => (i + 1) % previewImages.length)}
                className="absolute right-4 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
              >
                <ChevronRight size={24} />
              </button>
            )}
          </div>
          {previewImages.length > 1 && (
            <div className="flex items-center justify-center gap-2 py-4 px-6 overflow-x-auto">
              {previewImages.map((img, i) => (
                <button
                  key={i}
                  onClick={(e) => { e.stopPropagation(); setPreviewIndex(i); }}
                  className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-all ${i === previewIndex ? 'border-white opacity-100' : 'border-transparent opacity-50 hover:opacity-80'}`}
                >
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}

function StoryboardHistoryList({ history, onLoad, onDelete }: {
  history: StoryboardHistoryItem[];
  onLoad: (h: StoryboardHistoryItem) => void;
  onDelete: (id: string) => void;
}) {
  const [previewImages, setPreviewImages] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let cancelled = false;
    const next: Record<string, string[]> = {};
    const needZip: Array<{ hid: string; panelIdx: number; zipUrl: string; count: number }> = [];

    for (const h of history) {
      // Tier 0: read panelImages directly off the history entry. The
      // live task completion path used to write dataURLs here; if those
      // made it in (i.e. the user generated this entry before the quota
      // bomb started firing), they're already in the right shape for
      // <img src> and we render them with no extra work. This is the
      // path that worked for older history rows; we must not regress it.
      const seen = new Set<string>();
      const collected: string[] = [];
      if (h.panelImages) {
        const resolved = resolvePanelImages(h.panelImages);
        for (let p = 0; p < h.panel_count && collected.length < 6; p++) {
          const imgs = resolved[p] || [];
          for (const img of imgs) {
            if (img && !seen.has(img)) { seen.add(img); collected.push(img); }
            if (collected.length >= 6) break;
          }
        }
      }
      if (collected.length > 0) {
        next[h.id] = collected.slice(0, 6);
        continue;
      }

      // Tier 1: pull from the unified store for every panel. This is
      // a synchronous read of panel_image_cache_<hid>_<i> entries —
      // each entry's refs resolve to dataURLs via the unified store.
      for (let p = 0; p < h.panel_count && collected.length < 6; p++) {
        const imgs = getCachedStoryboardPanelImages(h.id, p);
        for (const img of imgs) {
          if (img && !seen.has(img)) { seen.add(img); collected.push(img); }
          if (collected.length >= 6) break;
        }
      }
      if (collected.length > 0) {
        next[h.id] = collected.slice(0, 6);
        continue;
      }

      // Tier 2: try the legacy img_cache_<fnv(zipUrl)>_N entries that
      // the older extractFinishedTaskImages path wrote. Sync read.
      const panelZip = h.panelZipUrls?.[0] || h.zipUrl;
      if (panelZip) {
        needZip.push({ hid: h.id, panelIdx: 0, zipUrl: panelZip, count: h.panelImageCounts?.[0] || 4 });
      }
    }

    setPreviewImages(next);

    // Tier 2 + tier 3 fallback. Tier 2 reads img_cache_<hash>_N
    // (cheap, sync-ish), tier 3 hits the network as a last resort.
    for (const req of needZip) {
      getCachedImages(req.zipUrl, req.count).then((cached) => {
        if (cancelled) return;
        const usable = cached.filter((u) => u && u.startsWith('data:'));
        if (usable.length > 0) {
          setPreviewImages((prev) => ({ ...prev, [req.hid]: usable.slice(0, 6) }));
          return;
        }
        return extractImagesFromZipAsDataUrls(req.zipUrl).then((imgs) => {
          if (cancelled) return;
          const usable2 = imgs.filter((u) => u && u.startsWith('data:'));
          if (usable2.length === 0) return;
          setPreviewImages((prev) => ({ ...prev, [req.hid]: usable2.slice(0, 6) }));
        });
      }).catch((err) => console.debug('[StoryboardHistoryList] fallback failed for', req.hid, err));
    }

    return () => { cancelled = true; };
  }, [history]);

  if (history.length === 0) {
    return <div className="px-4 py-8 text-center"><Clock size={24} className="mx-auto text-text-tertiary/40 mb-2" /><p className="text-sm text-text-tertiary">暂无历史记录</p></div>;
  }

  return (
    <div>
      {history.map((h) => (
        <div key={h.id} className="flex items-start gap-2 px-4 py-3 border-b border-border/50 last:border-0 hover:bg-bg-hover/30 transition-colors">
          <button onClick={() => onLoad(h)} className="flex-1 flex items-start gap-2 w-full min-w-0 text-left group">
            {previewImages[h.id] && previewImages[h.id].length > 0 ? (
              <div className="flex-shrink-0 flex gap-0.5">
                {previewImages[h.id].slice(0, 4).map((img, i) => (
                  <AspectAwareImage key={i} src={img} alt="" maxHeight={36} objectFit="cover" className="rounded border border-border/50" />
                ))}
              </div>
            ) : (
              <div className="flex-shrink-0 w-9 h-9 rounded bg-bg-elevated flex items-center justify-center border border-border/50">
                <Image size={14} className="text-text-tertiary/40" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-text-primary font-medium line-clamp-1">{h.panel_count} 个分镜</p>
              <p className="text-[11px] text-text-tertiary line-clamp-1 mt-0.5">{h.plot}</p>
              <p className="text-[10px] text-text-tertiary/60 mt-0.5">{new Date(h.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
            </div>
          </button>
          <button onClick={() => onDelete(h.id)} className="p-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-all flex-shrink-0"><Trash2 size={13} /></button>
        </div>
      ))}
    </div>
  );
}

function FavoritesList({ favorites, r18Mode, onRemove, onClear }: {
  favorites: FavoriteItem[];
  r18Mode: boolean;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const handleDownload = (e: React.MouseEvent, item: FavoriteItem) => {
    e.stopPropagation();
    const a = document.createElement('a');
    a.href = item.imageUrl ?? "";
    a.download = `favorite_${item.id}.png`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  };

  if (favorites.length === 0) {
    return <div className="px-4 py-8 text-center"><Heart size={24} className="mx-auto text-text-tertiary/40 mb-2" /><p className="text-sm text-text-tertiary">暂无收藏</p><p className="text-[11px] text-text-tertiary/60 mt-1">在图片预览中点击收藏按钮添加</p></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50">
        <span className="text-xs text-text-tertiary">{favorites.length} 张收藏</span>
        {favorites.length > 0 && (
          <button onClick={onClear} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-all">
            <Trash2 size={11} />清空全部
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2 p-3">
        {favorites.map((item) => (
          <div key={item.id} className="relative group rounded-lg overflow-hidden bg-bg-elevated">
            <AspectAwareImage
              src={item.imageUrl ?? ""}
              alt=""
              maxHeight={120}
              objectFit="cover"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
              <button
                onClick={(e) => handleDownload(e, item)}
                className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center text-gray-700 hover:bg-white transition-colors"
              >
                <Download size={14} />
              </button>
              <button
                onClick={() => onRemove(item.id)}
                className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center text-red-500 hover:bg-red-500 hover:text-white transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <p className="text-[9px] text-white/80 truncate">{item.prompt?.slice(0, 40) || '已收藏图片'}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StoryboardPanelCard({ panel, idx, isExpanded, r18Mode, copiedPanel, onToggle, onCopyPanel, genState, onGenerateImage, onFavorited, onDownload, taskManager, digitalHumanMode, selectedGirlfriend, selectedImageIndex, onSelectImage, onGenerateVideo, videoPrompt, hasGeneratedImages, onPreviewImage, videoGenLoading, onDirectGenerateVideo, themeTitle, onRegenerateVideoPrompt, promptEditLoading, onVideoPromptChange, historyId, panelH3Prompt, panelH3Duration, panelH3Loading, onGeneratePanelH3, onGotoLongVideoWithH3, onImagePromptChange, onRegenerateImagePrompt, imagePromptRegenLoading, onPanelH3PromptChange, panelH3ConstraintEnabled, onTogglePanelH3Constraint }: {
  panel: { panel_number: number; scene_description: string; image_prompt: string };
  idx: number; isExpanded: boolean; r18Mode: boolean; copiedPanel: number | null;
  onToggle: () => void; onCopyPanel: () => void;
  genState?: { loading: boolean; images: string[] };
  onGenerateImage: () => void;
  onFavorited?: (url: string) => void;
  onDownload?: (url: string) => void;
  taskManager: TaskManagerReturn;
  digitalHumanMode?: boolean; selectedGirlfriend?: GirlfriendPreset | null;
  selectedImageIndex?: number;
  onSelectImage?: (index: number, imageUrl: string) => void;
  onGenerateVideo?: (imageUrl: string, prompt: string) => void;
  videoPrompt?: string;
  hasGeneratedImages?: boolean;
  onPreviewImage?: (images: string[], currentIndex: number, prompt?: string) => void;
  videoGenLoading?: boolean;
  onDirectGenerateVideo?: (imageUrl: string, prompt: string) => void;
  themeTitle?: string;
  /** Trigger a single-panel video-prompt "智能扩写" via backend grok-4.6 → grok-4.3 */
  onRegenerateVideoPrompt?: () => void;
  /** Spinner state for the smart-expand button */
  promptEditLoading?: boolean;
  /** Edits to the prompt (writes back into parent state so 图生视频 uses the latest text) */
  onVideoPromptChange?: (newPrompt: string) => void;
  historyId?: string;
  // H3 提示词引擎
  panelH3Prompt?: string;
  panelH3Duration?: 15 | 30 | 60;
  panelH3Loading?: boolean;
  onGeneratePanelH3?: () => void;
  onGotoLongVideoWithH3?: (imageUrl: string) => void;
  /** 图片提示词编辑回调（用户在卡片内直接改 image_prompt） */
  onImagePromptChange?: (newPrompt: string) => void;
  /** 触发该分镜的图片提示词 LLM 重新生成 */
  onRegenerateImagePrompt?: () => void;
  /** 重新生成图片提示词时的 spinner state */
  imagePromptRegenLoading?: boolean;
  /** H3 提示词编辑回调（用户在卡片内直接改 H3 提示词） */
  onPanelH3PromptChange?: (newPrompt: string) => void;
  /** H3 强制约束开关状态 */
  panelH3ConstraintEnabled?: boolean;
  /** H3 强制约束开关切换回调 */
  onTogglePanelH3Constraint?: () => void;
}) {
  const isGenLoading = genState?.loading;
  const displayImages = genState?.images ?? [];
  const normalizedPanelPrompt = panel.image_prompt.trim().replace(/\s+/g, ' ');

  // Match tasks to this panel by storyboardInfo first (index-based), then fall back
  // to prompt match. storyboardInfo match is accurate regardless of whether the
  // prompt was modified (e.g. img2img adds 【严格锁定】 prefix, txt2img adds
  // quality boost). Without this, mixed batches of txt2img+img2img panels for
  // different themes would display the wrong images.
  // Include FAILED too so the panel can show a "重新生成图片" affordance.
  const panelRelatedTasks = taskManager.tasks.filter((t: QueuedTask) => {
    if (t.status !== 'RUNNING' && t.status !== 'QUEUEING' && t.status !== 'FINISHED' && t.status !== 'FAILED') return false;
    if (t.storyboardInfo && t.storyboardInfo.historyId === historyId && t.storyboardInfo.panelIdx === idx) return true;
    const taskPromptNorm = t.prompt.trim().replace(/\s+/g, ' ');
    return taskPromptNorm === normalizedPanelPrompt;
  });

  const taskImages = panelRelatedTasks.flatMap((t: QueuedTask) => t.images);
  const allDisplayImages = displayImages.length > 0 ? displayImages : taskImages;
  const hasImages = allDisplayImages.length > 0;

  // Per-panel status for loading placeholder. Only show "generating/queued"
  // when no images are present yet — once images arrive, the green badge
  // takes over.
  const isQueued = panelRelatedTasks.some((t: QueuedTask) => t.status === 'QUEUEING');
  const isGenerating = panelRelatedTasks.some((t: QueuedTask) => t.status === 'RUNNING');
  const hasFailedImageTask = !hasImages && panelRelatedTasks.some((t: QueuedTask) => t.status === 'FAILED');
  const failedTaskError = panelRelatedTasks.find((t: QueuedTask) => t.status === 'FAILED')?.error || '';
  const showLoadingState = !hasImages && (isGenLoading || isQueued || isGenerating);

  return (
    <div className={`rounded-2xl overflow-hidden shadow-card ${r18Mode ? 'border border-red-200 bg-white' : 'bg-white border border-border'}`}>
      <button onClick={onToggle}
        className={`w-full flex items-center justify-between px-4 py-3 hover:bg-bg-hover transition-colors ${r18Mode ? 'bg-red-50/30' : ''}`}>
        <div className="flex items-center gap-3 min-w-0">
          <span className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${r18Mode ? 'bg-gradient-to-br from-red-500 to-red-700 text-white' : 'bg-gradient-to-br from-primary to-primary/60 text-white'}`}>{panel.panel_number}</span>
          <span className="text-sm text-text-primary font-medium whitespace-pre-wrap break-words line-clamp-2">{panel.scene_description}</span>
          {hasImages && <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 bg-green-500 text-white`}>{allDisplayImages.length}</span>}
          {hasFailedImageTask && !hasImages && (
            <span
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 bg-red-50 text-red-600 border border-red-200"
              title={failedTaskError || '图片生成失败，点击下方重试按钮重新生成'}
            >
              <AlertCircle size={10} />
              生成失败
            </span>
          )}
          {showLoadingState && (
            <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 ${
              isGenerating
                ? 'bg-blue-50 text-blue-600 border border-blue-200'
                : 'bg-amber-50 text-amber-600 border border-amber-200'
            }`}>
              <Loader2 size={10} className="animate-spin" />
              {isQueued && !isGenerating ? '排队中' : '生成中'}
            </span>
          )}
          {themeTitle && (
            <span
              className={`hidden sm:inline-flex items-center gap-1 max-w-[160px] px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 ${
                r18Mode
                  ? 'bg-red-50 text-red-500 border border-red-200'
                  : 'bg-purple-50 text-purple-600 border border-purple-200'
              }`}
              title={`剧情：${themeTitle}`}
            >
              <Bookmark size={10} className="flex-shrink-0" />
              <span className="truncate">剧情：{themeTitle}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {themeTitle && (
            <span
              className={`sm:hidden inline-flex items-center max-w-[100px] px-1.5 py-0.5 rounded text-[10px] font-medium ${
                r18Mode ? 'bg-red-50 text-red-500 border border-red-200' : 'bg-purple-50 text-purple-600 border border-purple-200'
              }`}
              title={`剧情：${themeTitle}`}
            >
              <span className="truncate">{themeTitle}</span>
            </span>
          )}
          {isExpanded ? <ChevronUp size={14} className="text-text-tertiary" /> : <ChevronDown size={14} className="text-text-tertiary" />}
        </div>
      </button>
      {isExpanded && (
        <div className={`px-4 pb-4 border-t ${r18Mode ? 'border-red-100' : 'border-border/50'}`}>
          <div className="pt-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium ${r18Mode ? 'text-red-500' : 'text-text-tertiary'}`}>Image Prompt</span>
                <span className="text-[10px] text-text-tertiary">(可编辑)</span>
              </div>
              <div className="flex items-center gap-2">
                {onRegenerateImagePrompt && (
                  <button
                    onClick={onRegenerateImagePrompt}
                    disabled={!!imagePromptRegenLoading}
                    title="用 LLM 重新生成本分镜的图片提示词（覆盖现有内容）"
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                      imagePromptRegenLoading
                        ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                        : 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:opacity-90'
                    }`}
                  >
                    {imagePromptRegenLoading
                      ? <><Loader2 size={11} className="animate-spin" /> 重新生成中</>
                      : <><RefreshCw size={11} />重新生成图片提示词</>}
                  </button>
                )}
                <button
                  onClick={onGenerateImage}
                  disabled={isGenLoading || (digitalHumanMode && !selectedGirlfriend)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                    isGenLoading || (digitalHumanMode && !selectedGirlfriend)
                      ? 'bg-blue-100 text-blue-400 cursor-not-allowed'
                      : 'bg-blue-500 text-white hover:bg-blue-600'
                  }`}
                >
                  {isGenLoading ? <><Loader2 size={11} className="animate-spin" /> 生成中</> : <><Image size={11} />{digitalHumanMode && selectedGirlfriend ? '图生图' : '生图'}</>}
                </button>
                <button onClick={onCopyPanel} className={`flex items-center gap-1 text-xs transition-colors ${copiedPanel === idx ? 'text-green-500' : r18Mode ? 'text-red-500' : 'text-primary'}`}>
                  {copiedPanel === idx ? <><Check size={12} /> 已复制</> : <><Copy size={12} /> 复制</>}
                </button>
              </div>
            </div>
            {onImagePromptChange ? (
              <textarea
                value={panel.image_prompt || ''}
                onChange={(e) => onImagePromptChange(e.target.value)}
                rows={4}
                placeholder={imagePromptRegenLoading ? '正在用 LLM 重新生成分镜图片提示词…' : '分镜图片提示词（点击「重新生成图片提示词」可让 LLM 重新扩写）'}
                className={`w-full rounded-xl px-4 py-3 text-xs leading-relaxed font-mono resize-y focus:outline-none focus:ring-1 ${
                  r18Mode
                    ? 'bg-red-50 text-red-700 border border-red-200 focus:border-red-400 focus:ring-red-300'
                    : 'bg-bg-elevated text-text-secondary border border-border focus:border-primary focus:ring-primary/30'
                }`}
              />
            ) : (
              <div className={`rounded-xl px-4 py-3 text-xs leading-relaxed whitespace-pre-wrap font-mono ${r18Mode ? 'bg-red-50 text-red-700' : 'bg-bg-elevated text-text-secondary'}`}>{panel.image_prompt}</div>
            )}

            {/* Loading/queued placeholder — shown while a task is in flight for
                this panel but no images have arrived yet. Without this, the
                user sees a blank panel between batch submission and the first
                image landing. */}
            {showLoadingState && !hasImages && (
              <div className={`mt-3 rounded-xl border-2 border-dashed flex items-center justify-center gap-2 px-4 py-6 text-xs font-medium ${
                isGenerating
                  ? (r18Mode ? 'border-blue-200 bg-blue-50/40 text-blue-500' : 'border-blue-200 bg-blue-50/40 text-blue-600')
                  : (r18Mode ? 'border-amber-200 bg-amber-50/40 text-amber-500' : 'border-amber-200 bg-amber-50/40 text-amber-600')
              }`}>
                <Loader2 size={14} className="animate-spin" />
                <span>{isQueued && !isGenerating ? '排队中，等待生成…' : '生成中，图片即将出现…'}</span>
              </div>
            )}

            {/* Failed-task affordance — when a panel has no images but has
                at least one FAILED task, surface a one-click "重新生成图片"
                so the user can recover without going back to the batch
                submit. This is the common case the user reported: one
                panel's image failed (CLIPTextEncode / KSamplerAdvanced
                RuntimeError) while siblings succeeded. */}
            {hasFailedImageTask && !hasImages && !showLoadingState && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50/40 p-3 flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-red-700">分镜图片生成失败</p>
                    {failedTaskError && (
                      <p className="text-[11px] text-red-600/80 mt-0.5 line-clamp-2" title={failedTaskError}>
                        {failedTaskError}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onGenerateImage}
                  disabled={isGenLoading}
                  className={`self-start flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                    isGenLoading
                      ? 'bg-red-100 text-red-400 cursor-not-allowed'
                      : 'bg-red-500 text-white hover:bg-red-600'
                  }`}
                  title="重试该分镜的图片生成"
                >
                  {isGenLoading
                    ? <><Loader2 size={11} className="animate-spin" />图片生成中…</>
                    : <><RefreshCw size={11} />重新生成图片</>}
                </button>
              </div>
            )}

            {/* Generated images preview with selection and preview */}
            {hasImages && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-text-tertiary font-medium">生成结果（点击选中/预览）</span>
                  <span className="text-[10px] text-text-tertiary">{allDisplayImages.length} 张</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {allDisplayImages.filter((img) => img && (img.startsWith('data:') || img.startsWith('blob:') || img.startsWith('http'))).slice(0, 6).map((img, i) => (
                    <div
                      key={i}
                      className={`relative group cursor-pointer rounded-lg overflow-hidden transition-all ${
                        selectedImageIndex === i ? 'ring-2 ring-purple-500 ring-offset-2' : ''
                      }`}
                      onClick={() => {
                        onSelectImage?.(i, img);
                        onPreviewImage?.(allDisplayImages, i, panel.image_prompt);
                      }}
                    >
                      <AspectAwareImage
                        src={img}
                        alt=""
                        maxHeight={120}
                        objectFit="cover"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors pointer-events-none" />
                      <div className="absolute top-1 right-1 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {onFavorited && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); onFavorited(img); }}
                            title={isFavorited(img) ? '取消收藏' : '收藏'}
                            className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${isFavorited(img) ? 'bg-red-500 text-white' : 'bg-black/55 text-white hover:bg-red-500'}`}
                          >
                            <Heart size={13} className={isFavorited(img) ? 'fill-white' : ''} />
                          </button>
                        )}
                        {onDownload && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDownload(img); }}
                            title="下载图片"
                            className="w-7 h-7 rounded-full bg-black/55 text-white hover:bg-blue-500 flex items-center justify-center transition-all"
                          >
                            <Download size={13} />
                          </button>
                        )}
                      </div>
                      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                        <div className="w-9 h-9 rounded-full bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto flex items-center justify-center">
                          <ZoomIn size={18} className="text-white" />
                        </div>
                      </div>
                      {selectedImageIndex === i && (
                        <div className="absolute top-1 left-1 bg-purple-500 text-white text-[9px] px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5">
                          <Check size={10} /> 已选
                        </div>
                      )}
                    </div>
                  ))}
                  {allDisplayImages.length > 6 && (
                    <div className="rounded-lg bg-bg-elevated flex items-center justify-center text-xs text-text-tertiary" style={{ width: 80, height: 120 }}>
                      +{allDisplayImages.length - 6}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Video Prompt Section */}
            <div className={`rounded-xl border ${videoPrompt ? 'border-purple-200 bg-purple-50/30' : 'border-border bg-bg-elevated/50'} p-3 mt-3`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <Video size={12} className={videoPrompt ? 'text-purple-500' : 'text-text-tertiary'} />
                  <span className={`text-xs font-medium ${videoPrompt ? 'text-purple-600' : 'text-text-tertiary'}`}>动画提示词</span>
                  <span className="text-[10px] text-text-tertiary">(可编辑)</span>
                </div>
                <div className="flex items-center gap-1">
                  {onRegenerateVideoPrompt && (
                    <button
                      onClick={onRegenerateVideoPrompt}
                      disabled={promptEditLoading}
                      title="智能扩写：先用 grok-4.6，失败自动用 grok-4.3"
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        promptEditLoading
                          ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                          : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:opacity-90'
                      }`}
                    >
                      {promptEditLoading ? (
                        <><Loader2 size={11} className="animate-spin" /> 扩写中</>
                      ) : (
                        <><Wand2 size={11} />智能扩写</>
                      )}
                    </button>
                  )}
                  {hasImages && (
                    <button
                      onClick={() => {
                        const imageToUse = selectedImageIndex !== undefined && allDisplayImages[selectedImageIndex]
                          ? allDisplayImages[selectedImageIndex]
                          : allDisplayImages[0];
                        // Always pass a panel-derived videoPrompt. If empty, the button is
// already disabled (see below) — letting the user click would either
// submit an empty prompt or fall back to panel.image_prompt which is
// often the whole-storyboard master prompt and would produce junk.
                        // videoPrompt 可能为 undefined（动画提示词区域为空时），
                        // 但此时按钮已被 disabled={!videoPrompt} 禁用，
                        // 所以这里用空字符串兜底是安全的。
                        const promptForVideo = videoPrompt ?? '';
                        onDirectGenerateVideo?.(imageToUse, promptForVideo);
                      }}
                      disabled={videoGenLoading || !videoPrompt}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        !videoPrompt || videoGenLoading
                          ? 'bg-purple-100 text-purple-400 cursor-not-allowed'
                          : 'bg-purple-500 text-white hover:bg-purple-600'
                      }`}
                    >
                      {videoGenLoading ? <><Loader2 size={11} className="animate-spin" /> 生成中</> : <><Video size={11} />图生视频</>}
                    </button>
                  )}
                  {/* H3 提示词引擎按钮 */}
                  <button
                    type="button"
                    onClick={onGeneratePanelH3}
                    disabled={panelH3Loading || !hasImages}
                    title={panelH3Prompt ? '重新生成该分镜的 H3 视频提示词（已有提示词会被覆盖）' : '生成 MiniMax H3 六段式视频提示词'}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                      panelH3Loading || !hasImages
                        ? 'bg-indigo-100 text-indigo-400 cursor-not-allowed border border-indigo-200'
                        : panelH3Prompt
                          ? 'bg-white text-indigo-600 border border-indigo-300 hover:bg-indigo-50'
                          : 'bg-indigo-500 text-white hover:bg-indigo-600'
                    }`}
                  >
                    {panelH3Loading
                      ? <><Loader2 size={11} className="animate-spin" />视频提示词生成中…</>
                      : panelH3Prompt
                        ? <><RefreshCw size={11} />重新生成H3</>
                        : <><Sparkles size={11} />生成H3提示词</>}
                  </button>
                  {panelH3Prompt && hasImages && (
                    <button
                      type="button"
                      onClick={() => {
                        const img = selectedImageIndex !== undefined && allDisplayImages[selectedImageIndex]
                          ? allDisplayImages[selectedImageIndex]
                          : allDisplayImages[0];
                        onGotoLongVideoWithH3?.(img);
                      }}
                      disabled={videoGenLoading}
                      title="用 H3 提示词在长视频 1.1 中生成视频"
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        videoGenLoading
                          ? 'bg-indigo-100 text-indigo-400 cursor-not-allowed'
                          : 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:opacity-90'
                      }`}
                    >
                      <Video size={11} />图生视频 → 长视频1.1
                    </button>
                  )}
                </div>
              </div>
              {promptEditLoading ? (
                <div className={`w-full rounded-lg border border-purple-200 bg-purple-50/40 px-3 py-4 flex items-center justify-center gap-2 text-xs font-medium text-purple-600`}>
                  <Loader2 size={12} className="animate-spin" />
                  <span>智能扩写中…</span>
                </div>
              ) : videoPrompt ? (
                onVideoPromptChange ? (
                  <textarea
                    value={videoPrompt}
                    onChange={(e) => onVideoPromptChange(e.target.value)}
                    rows={3}
                    placeholder="动画提示词..."
                    className="w-full text-xs leading-relaxed text-text-secondary font-mono p-2 rounded-lg border border-purple-200 bg-white focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-300 resize-y"
                  />
                ) : (
                  <div className="text-xs leading-relaxed text-text-secondary whitespace-pre-wrap font-mono">{videoPrompt}</div>
                )
              ) : (
                <div className="text-xs text-text-tertiary">生成图片后将自动生成动画提示词，或点击「智能扩写」生成</div>
              )}
              {/* H3 提示词预览（可编辑） */}
              {panelH3Prompt && (
                <div className="mt-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-indigo-600 font-medium flex items-center gap-0.5">
                      <Sparkles size={10} />
                      H3 视频提示词（{panelH3Duration}秒，可编辑）
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => { navigator.clipboard?.writeText(panelH3Prompt); }}
                        className="text-[10px] text-indigo-500 hover:text-indigo-700 flex items-center gap-0.5"
                      >
                        <Copy size={10} /> 复制
                      </button>
                    </div>
                  </div>
                  {/* 强制约束开关 */}
                  <div className="flex items-center gap-2 mb-2">
                    <button
                      type="button"
                      onClick={onTogglePanelH3Constraint}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium transition-all ${
                        panelH3ConstraintEnabled
                          ? 'bg-indigo-500 text-white border border-indigo-600 hover:bg-indigo-600'
                          : 'bg-indigo-50 border border-indigo-200 text-indigo-600 hover:bg-indigo-100'
                      }`}
                      title="开启后将追加严格约束文本到提示词开头"
                    >
                      <ShieldCheck size={11} />
                      强制约束 {panelH3ConstraintEnabled ? '已开启' : '已关闭'}
                    </button>
                    <span className="text-[9px] text-indigo-400">
                      提示：提示词中可用 &lt;Picture 1&gt;, &lt;Picture 2&gt; 等引用参考图
                    </span>
                  </div>
                  {onPanelH3PromptChange ? (
                    <textarea
                      value={panelH3Prompt}
                      onChange={(e) => onPanelH3PromptChange(e.target.value)}
                      rows={4}
                      placeholder={"H3 Ref2VA 六段式提示词...\n\n提示：\n- 可用 <Picture 1> 引用第一张参考图\n- 可用 <Picture 2> 引用第二张参考图\n- 格式：Subject + Detailed Description + Camera + Lighting + Style + Music"}
                      className="w-full px-2 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-[10px] text-indigo-800 font-mono focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-300 resize-y"
                    />
                  ) : (
                    <textarea
                      value={panelH3Prompt}
                      rows={4}
                      readOnly
                      className="w-full px-2 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-[10px] text-indigo-800 font-mono focus:outline-none resize-none"
                      placeholder={"H3 Ref2VA 六段式提示词...\n\n提示：\n- 可用 <Picture 1> 引用第一张参考图\n- 可用 <Picture 2> 引用第二张参考图\n- 格式：Subject + Detailed Description + Camera + Lighting + Style + Music"}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Running status */}
            {panelRelatedTasks.filter((t: QueuedTask) => t.status === 'RUNNING' || t.status === 'QUEUEING').length > 0 && allDisplayImages.length === 0 && (
              <div className="flex items-center gap-2 text-xs text-blue-500 mt-3">
                <Loader2 size={12} className="animate-spin" />
                正在生成中...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shared Image Preview Component ─────────────────────────────────────────

function AIGeneratedImagePreview({ src, prompt, onFavorited, allImages, index }: { src: string; prompt?: string; onFavorited?: (url: string) => void; allImages?: string[]; index?: number }) {
  const [lightbox, setLightbox] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(index ?? 0);

  // Sync currentIdx when index prop changes (e.g., when parent re-renders with different allImages)
  useEffect(() => {
    if (index !== undefined) {
      setCurrentIdx(index);
    }
  }, [index]);

  const images = allImages && allImages.length > 0 ? allImages : [src];
  const activeIdx = index !== undefined ? index : currentIdx;
  const displaySrc = images[activeIdx] || src;

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (index !== undefined) {
      setCurrentIdx((i) => (i - 1 + images.length) % images.length);
    } else {
      setCurrentIdx((i) => (i - 1 + images.length) % images.length);
    }
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIdx((i) => (i + 1) % images.length);
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const a = document.createElement('a');
    a.href = displaySrc;
    a.download = displaySrc.split('/').pop() || `generated_${Date.now()}.png`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  };

  const handleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFavorited?.(displaySrc);
  };

  return (
    <>
      <div className="relative group aspect-square rounded-lg overflow-hidden bg-bg-elevated cursor-pointer" onClick={() => { setCurrentIdx(index ?? 0); setLightbox(true); }}>
        <img src={displaySrc} alt="" className="w-full h-full object-cover" loading="lazy" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={handleDownload} className="w-7 h-7 rounded-full bg-white/90 flex items-center justify-center text-gray-700 hover:bg-white transition-colors">
            <Download size={12} />
          </button>
          {onFavorited && (
            <button onClick={handleFavorite} className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${isFavorited(displaySrc) ? 'bg-red-500 text-white' : 'bg-white/90 text-gray-700 hover:bg-white'}`}>
              <Heart size={12} className={isFavorited(displaySrc) ? 'fill-white' : ''} />
            </button>
          )}
          {images.length > 1 && (
            <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] font-medium">
              {activeIdx + 1}/{images.length}
            </div>
          )}
        </div>
      </div>
      {lightbox && (
        <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center animate-fade-in" onClick={() => setLightbox(false)}>
          <div className="absolute top-4 right-4 flex items-center gap-2 z-20">
            {prompt && (
              <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(prompt); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/90 text-gray-700 text-xs hover:bg-white transition-colors">
                <Copy size={12} />复制提示词
              </button>
            )}
            <button
              onClick={handleDownload}
              title="下载图片"
              className="w-10 h-10 rounded-full bg-white/90 hover:bg-white text-gray-700 hover:text-blue-600 flex items-center justify-center transition-colors"
            >
              <Download size={18} />
            </button>
            <button
              onClick={handleFavorite}
              title={isFavorited(displaySrc) ? '取消收藏' : '收藏'}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                isFavorited(displaySrc)
                  ? 'bg-red-500 text-white hover:bg-red-600'
                  : 'bg-white/90 text-gray-700 hover:bg-white hover:text-red-500'
              }`}
            >
              <Heart size={18} className={isFavorited(displaySrc) ? 'fill-white' : ''} />
            </button>
            <button
              onClick={() => setLightbox(false)}
              title="关闭"
              className="w-10 h-10 rounded-full bg-white/90 hover:bg-white text-gray-700 flex items-center justify-center transition-colors"
            >
              <X size={20} />
            </button>
          </div>
          {images.length > 1 && (
            <button onClick={handlePrev} className="absolute left-4 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10">
              <ChevronLeft size={24} />
            </button>
          )}
          <img src={displaySrc} alt="" className="max-w-[90vw] max-h-[80vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
          {images.length > 1 && (
            <button onClick={handleNext} className="absolute right-4 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10">
              <ChevronRight size={24} />
            </button>
          )}
          {images.length > 1 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-black/60 text-white text-sm font-medium">
              {activeIdx + 1} / {images.length}
            </div>
          )}
          <button onClick={handleDownload} className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-gray-800 text-sm font-medium hover:bg-gray-100 transition-colors">
            <Download size={16} /> 下载图片
          </button>
        </div>
      )}
    </>
  );
}
