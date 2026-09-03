import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Video, Image as ImageIcon, Wand2, Copy, Check, Loader2, X, Clock, History, Sparkles, ChevronRight, ChevronDown, ChevronUp, Trash2, Clapperboard, Layers } from 'lucide-react';
import { ImageUploader } from '../components/ImageUploader';
import { GirlfriendSelector } from '../components/GirlfriendSelector';
import { ParameterSlider } from '../components/ParameterSlider';
import { ParameterSelect } from '../components/ParameterSelect';
import { GenerateButton } from '../components/GenerateButton';
import { VideoTaskList } from '../components/VideoTaskList';
import { uploadImage, WORKFLOW } from '../services/runninghub';
import { expandVideoFromImage, streamExpandPrompt, streamRandomPrompt } from '../services/promptApi';
import { parseStoryboardScript, toVideoScriptPanels, type ParsedScriptPanel } from '../utils/scriptParser';
import { getYunwuKey } from '../services/storage';
import { getRecords, deleteRecord, clearAllHistory, type HistoryRecord } from '../services/historyService';
import { extractImagesFromZipAsDataUrls } from '../services/runninghub';
import type { NodeInfo } from '../types';
import type { GirlfriendPreset } from '../data/girlfriendPresets';
import { PosePresetSelector } from '../components/PosePresetSelector';
import { RunningHubModelPicker } from '../components/RunningHubModelPicker';
import type { RunningHubModelEntry } from '../services/runninghubModelsService';
import { NinfiniteLongVideoPage } from './NinfiniteLongVideoPage';
import { generateH3Prompt } from '../services/h3PromptService';

const DURATION_OPTIONS = [
  { value: '5', label: '5秒' },
  { value: '8', label: '8秒' },
];

const RESOLUTION_OPTIONS = [
  { value: '512', label: '512px (快速)' },
  { value: '720', label: '720px (推荐)' },
  { value: '1024', label: '1024px (高清)' },
];

const LORA_HIGH_OPTIONS = [
  { value: 'SmoothMixAnimationStyle_High.safetensors', label: 'SmoothMixAnimationStyle_High (默认)' },
];

const LORA_LOW_OPTIONS = [
  { value: 'SmoothMixAnimation_Low.safetensors', label: 'SmoothMixAnimation_Low (默认)' },
];

// MiniMax H3 constants
const MINIMAX_VIDEO_MODEL_OPTIONS = [
  { value: 'DasiwaMinimaxH3_dasiwaREF2VAHybridV1.safetensors', label: 'MiniMax H3 (默认)' },
];

const MINIMAX_LORA_OPTIONS = [
  { value: 'MysticXXX_MMH3-V1.safetensors', label: 'MysticXXX_MMH3-V1 (默认)' },
];

const MINIMAX_STYLE_OPTIONS = [
  { value: '1', label: '风格1' },
  { value: '2', label: '风格2' },
  { value: '3', label: '风格3' },
];

const MINIMAX_DURATION_OPTIONS = [
  { value: '5', label: '5秒' },
  { value: '10', label: '10秒' },
  { value: '15', label: '15秒' },
  { value: '20', label: '20秒' },
];

interface ImageToVideoPageProps {
  apiKey: string;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

// ─── Wan 2.2 Video Prompt Builder ────────────────────────────────────────────────
// All options use English values for pure English output

const MOTION_OPTIONS = [
  { value: '', label: '请选择动作' },
  { value: 'slow walking, light footsteps, long hair flowing in wind', label: '缓慢行走' },
  { value: 'elegant turn, dress flowing naturally', label: '优雅转身' },
  { value: 'standing smile, slowly raising hand to brush hair, natural blinking', label: '站立微笑' },
  { value: 'standing sideways, gently turning head to look back, natural breathing', label: '侧身回眸' },
  { value: 'sitting gracefully, hands naturally crossed, slight head tilt', label: '坐姿端庄' },
  { value: 'slowly reaching out hand, elegant movement to pick up item, smooth motion', label: '缓慢伸手' },
  { value: 'gentle body sway, dress flowing with wind, light footsteps', label: '身体轻摆' },
  { value: 'close-up portrait, delicate expression, subtle facial changes', label: '近距离特写' },
  { value: 'full body walking, stable camera tracking, natural movement', label: '全身行走' },
  { value: 'lying relaxed, natural rolling over, smooth continuous motion', label: '躺卧放松' },
];

const CAMERA_OPTIONS = [
  { value: '', label: '请选择镜头' },
  { value: 'medium shot, eye-level angle, camera slowly pushing in', label: '中景推进' },
  { value: 'full body shot, fixed tracking, eye-level angle', label: '全身跟随' },
  { value: 'face close-up, low angle upward shot, shallow depth of field', label: '脸部特写' },
  { value: 'half body shot, side lighting, slow pan', label: '半身侧光' },
  { value: 'wide shot, wide angle lens, camera slightly pulling back', label: '全景拉远' },
  { value: 'over shoulder shot, shallow depth of field, cinematic', label: '过肩镜头' },
  { value: 'low angle upward shot, mysterious atmosphere, stable camera', label: '低角度仰拍' },
  { value: 'high angle downward shot, soft lighting, slow orbit', label: '高角度俯拍' },
];

const LIGHTING_OPTIONS = [
  { value: '', label: '请选择光影' },
  { value: 'natural soft light, sunlight through window, warm tone', label: '自然柔光' },
  { value: 'backlit rim lighting, golden edge light, shadow details', label: '逆光轮廓' },
  { value: 'warm tone, side lighting, soft shadow, evening atmosphere', label: '暖色调侧光' },
  { value: 'cool tone, blue tone, fresh bright, natural light', label: '冷色调' },
  { value: 'golden hour, dusk warm light, light flare and glow', label: '黄金时刻' },
  { value: 'softbox, even lighting, smooth transition, no harsh shadows', label: '柔光箱' },
  { value: 'dark tone, dramatic lighting, high contrast', label: '暗调戏剧' },
  { value: 'haze and mist, atmospheric perspective, dreamy atmosphere', label: '薄雾感' },
];

const STYLE_OPTIONS = [
  { value: '', label: '请选择风格' },
  { value: 'realistic, high definition, cinematic quality, no distortion, smooth natural motion', label: '写实电影' },
  { value: 'ultra realistic, delicate features, detailed skin texture, high definition detail', label: '超写实' },
  { value: 'aesthetic, soft color tone, strong atmosphere, romantic elegant', label: '唯美浪漫' },
  { value: 'portrait photography style, soft lighting, natural makeup, realistic', label: '写真风格' },
  { value: 'film grain texture, warm tone, vintage aesthetic', label: '胶片质感' },
  { value: 'ancient Chinese style, ink wash texture, traditional Chinese aesthetic, classical charm', label: '古风国风' },
  { value: 'cyberpunk, cold neon light, blue tone, sci-fi atmosphere', label: '赛博朋克' },
  { value: 'Japanese style, soft focus, warm tone, fresh natural', label: '日系清新' },
];

const SCENE_OPTIONS = [
  { value: '', label: '请选择场景' },
  { value: 'indoor, minimalist home decor, curtain light transmission, clean background', label: '室内家居' },
  { value: 'beach, golden sunlight, gentle waves lapping, vast background', label: '海边沙滩' },
  { value: 'forest grassland, sunlight dappling through trees, natural fresh, green background', label: '森林草地' },
  { value: 'city street, neon signs, evening atmosphere, modern feel', label: '城市街头' },
  { value: 'studio, minimalist background, soft lighting, professional setup', label: '工作室' },
  { value: 'garden courtyard, flowers and grass, natural light, spring vibe', label: '花园庭院' },
  { value: 'bathroom, water vapor haze, soft lighting, intimate atmosphere', label: '浴室' },
  { value: 'bedroom, warm comfortable, soft curtain light, private atmosphere', label: '卧室' },
];

const VIDEO_THEMES = [
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
];

// Strictly strip ALL appearance descriptors, return pure English for video
function stripAppearancePrompt(rawPrompt: string): string {
  // Remove anything that describes the subject's physical appearance
  const appearancePatterns = [
    // Race / ethnicity
    /\b(african|asian|caucasian|european|american|british|french|german|italian|indian|chinese|japanese|korean|pacific islander|latino|hispanic|middle eastern|southeast asian|nordic)\b/gi,
    // Hair
    /\b(blonde|blond|brunette|black[- ]hair|white[- ]hair|grey hair|gray hair|red hair|brown hair|ginger|long[- ]hair|short[- ]hair|curly[- ]hair|straight[- ]hair|wavy[- ]hair|hair|braids|dreadlocks|bun|style)\b/gi,
    // Face / body features
    /\b(face|facial|features|fine features|delicate|sharp jaw|full lips|plump|thin lips|nose|eyes|eye color|heterochromia|heterochromatic|blue eyes|brown eyes|green eyes|grey eyes|amber eyes|beauty|beautiful|handsome|pretty|elegant|gorgeous|attractive|stunning|pretty)\b/gi,
    // Skin
    /\b(skin|fair skin|dark skin|pale|olive skin|tan|freckles|mole|beauty mark|blemish|skin texture|clear skin)\b/gi,
    // Body type
    /\b(slim|skinny|curvy|plump|petite|tall|short|average height|muscular|thin|thick|hourglass|body type|body|physique)\b/gi,
    // Age
    /\b(young|old|teen|young adult|middle aged|elderly|adult|minor|child|baby face|aged)\b/gi,
    // Clothing (worn by subject)
    /\b(wearing|worn|dressed in|dressed as|dress|outfit|clothes|shirt|pants|jeans|jacket|blouse|top|bottom|skirt|dress|heels|boots|shoes|hat|cap|accessories|jewelry|necklace|earrings|bracelet|ring|tattoo|piercing|makeup|make-up|lipstick|eyeshadow|mascara|nail polish|hairoil|cosmetic)\b/gi,
    // Color + clothing combo
    /\b(white|red|black|pink|blue|green|golden|silver|purple|orange|navy|beige|brown|gray|grey|colored?)\s+(dress|skirt|shirt|outfit|clothes|top|jacket|pants|hair|eyes|skin|lip|cloth)\b/gi,
    // Specific person types
    /\b(seductive|vamp|queen|princess|angel|demon|goth|gothic|femme fatale|bombshell|model|celebrity|actress|vip|beauty queen)\b/gi,
    // Realistic portrait
    /\b(photo|portrait|hyperrealistic|hyper-realistic|stunning|photorealistic|photo-realistic|realistic portrait|headshot)\b/gi,
  ];

  let cleaned = rawPrompt;
  appearancePatterns.forEach((pattern) => {
    cleaned = cleaned.replace(pattern, '');
  });

  // Collapse multiple commas/spaces
  cleaned = cleaned.replace(/,\s*,/g, ',').replace(/\s+/g, ' ').trim();
  cleaned = cleaned.replace(/^[, ]+|[, ]+$/g, '');

  return cleaned;
}

// Convert to Wan 2.2 style English output, NO appearance descriptions
function transformToWan22Style(rawPrompt: string, isR18: boolean): string {
  const cleaned = stripAppearancePrompt(rawPrompt);

  const parts = cleaned.split(/[,，.。;；\n]/).map((p) => p.trim()).filter(Boolean);

  const motion: string[] = [];
  const camera: string[] = [];
  const lighting: string[] = [];
  const style: string[] = [];
  const environment: string[] = [];
  const other: string[] = [];

  const motionWords = ['walk', 'turn', 'move', 'dance', 'run', 'jump', 'sit', 'stand', 'slow', 'fast', 'gentle', 'smooth', 'natural', 'flow', 'flowing', 'sway', 'swing', 'breathing', 'breath', 'smile', 'blink', 'blink', 'head', 'turning', 'looking', 'reach', 'raise', 'touch', 'hold', 'cross', 'lean', 'bend', 'twist', 'rolling', 'moving', 'step', 'foot'];
  const cameraWords = ['close-up', 'close up', 'closeup', 'medium shot', 'long shot', 'pan', 'zoom', 'tilt', 'dolly', 'tracking', 'steady', 'cinematic', 'camera', 'angle', 'shot', 'shot', 'wide', 'lens', 'depth of field', 'background blur', 'bokeh'];
  const lightingWords = ['light', 'sunlight', 'natural light', 'backlit', 'soft light', 'hard light', 'warm', 'cool', 'dim', 'bright', 'glow', 'shadow', 'rim light', 'edge light', 'golden hour', 'dusk', 'dawn', 'fog', 'haze', 'contrast', 'lighting'];
  const styleWords = ['realistic', 'cinematic', '8k', '4k', 'high quality', 'aesthetic', 'soft tone', 'vintage', 'film grain', 'portrait', 'photo', 'no distortion'];
  const envWords = ['indoor', 'outdoor', 'beach', 'forest', 'park', 'street', 'studio', 'garden', 'room', 'bedroom', 'bathroom', 'balcony', 'rooftop', 'background', 'setting'];

  parts.forEach((part) => {
    const lower = part.toLowerCase();
    if (motionWords.some((w) => lower.includes(w))) motion.push(part);
    else if (cameraWords.some((w) => lower.includes(w))) camera.push(part);
    else if (lightingWords.some((w) => lower.includes(w))) lighting.push(part);
    else if (styleWords.some((w) => lower.includes(w))) style.push(part);
    else if (envWords.some((w) => lower.includes(w))) environment.push(part);
    else other.push(part);
  });

  const sections: string[] = [];

  // Always start with 1girl - appearance anchored by reference image
  sections.push('1girl');

  if (environment.length > 0) sections.push(environment.slice(0, 1).join(', '));
  if (motion.length > 0) sections.push(motion.slice(0, 2).join(', '));
  else sections.push('natural smooth motion');

  if (camera.length > 0) sections.push(camera.slice(0, 1).join(', '));
  else sections.push('stable camera tracking');

  if (lighting.length > 0) sections.push(lighting.slice(0, 1).join(', '));
  else sections.push('soft natural lighting');

  if (style.length > 0) sections.push(style.slice(0, 1).join(', '));
  else sections.push('realistic cinematic quality');

  if (isR18) sections.push('intimate atmosphere, smooth natural motion');

  // Append remaining keywords (no appearance ones since they're stripped)
  const remaining = other.filter((p) => p.length > 3 && p.length < 100);
  if (remaining.length > 0) sections.push(remaining.slice(0, 3).join(', '));

  return sections.filter(Boolean).join(', ');
}

// ─── 内嵌 AI 提示词面板 ────────────────────────────────────────────────────────

interface AIPromptPanelProps {
  on应用: (提示词: string) => void;
}

function AIPromptPanel({ on应用 }: AIPromptPanelProps) {
  const [模式, set模式] = useState<'智能视频' | '智能扩写' | '随机抽卡'>('智能视频');
  const [输入, set输入] = useState('');
  const [数量, set数量] = useState(5);
  const [R18模式, setR18模式] = useState(false);
  const [主题, set主题] = useState('');
  const [加载中, set加载中] = useState(false);
  const [结果列表, set结果列表] = useState<string[]>([]);
  const [已复制索引, set已复制索引] = useState<number | null>(null);
  const [选中索引, set选中索引] = useState(0);
  const [输出文本, set输出文本] = useState('');

  const [动作, set动作] = useState('');
  const [镜头, set镜头] = useState('');
  const [光影, set光影] = useState('');
  const [风格, set风格] = useState('');
  const [场景, set场景] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea, no scrollbar
  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
      ta.style.overflowY = 'hidden';
    }
  }, []);

  useEffect(() => {
    autoResize();
  }, [输出文本, autoResize]);

  const 构建视频提示词 = (): string => {
    const 部分: string[] = ['1girl'];
    if (场景) 部分.push(场景);
    if (动作) 部分.push(动作);
    if (镜头) 部分.push(镜头);
    if (光影) 部分.push(光影);
    if (风格) 部分.push(风格);
    if (R18模式) 部分.push('intimate atmosphere, smooth natural motion');
    return 部分.filter(Boolean).join(', ');
  };

  const 处理生成视频 = () => {
    const 提示词 = 构建视频提示词();
    if (!提示词 || 提示词 === '1girl') {
      alert('请至少选择一项视频参数');
      return;
    }
    set结果列表([提示词]);
    set选中索引(0);
    set输出文本(提示词);
  };

  const 处理扩写 = async () => {
    if (!输入.trim()) return;
    if (!getYunwuKey()) { alert('请先在设置中配置 OpenLux API Key'); return; }
    set加载中(true);
    // Seed N empty slots so the UI shows N cards immediately, and each
    // streams text into its slot. transformToWan22Style is applied per-card
    // on each `delta` so the visible text already matches Wan2.2 style.
    const seeded = Array.from({ length: 数量 }).map(() => '');
    set结果列表(seeded);
    set选中索引(0);
    set输出文本('');
    try {
      await streamExpandPrompt(
        输入.trim(), 'video', R18模式, 数量, 0,
        undefined, false, undefined,
        {
          onDelta: ({ index, text }) => {
            set结果列表((prev) => {
              const next = [...prev];
              while (next.length <= index) next.push('');
              next[index] = transformToWan22Style((next[index] || '') + text, R18模式);
              return next;
            });
          },
          onEnd: ({ index, prompt }) => {
            const styled = transformToWan22Style(prompt, R18模式);
            set结果列表((prev) => {
              const next = [...prev];
              while (next.length <= index) next.push('');
              next[index] = styled;
              return next;
            });
            // Auto-select first finished slot
            set选中索引((cur) => cur === 0 && index === 0 ? 0 : cur);
          },
          onError: ({ index, message }) => {
            alert(`扩写失败${index !== undefined ? ` (第${index + 1}条)` : ''}: ${message}`);
          },
        },
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : '扩写失败');
    } finally {
      set加载中(false);
    }
  };

  const 处理随机 = async () => {
    if (!getYunwuKey()) { alert('请先在设置中配置 OpenLux API Key'); return; }
    set加载中(true);
    const seeded = Array.from({ length: 数量 }).map(() => '');
    set结果列表(seeded);
    set选中索引(0);
    set输出文本('');
    try {
      await streamRandomPrompt(
        'video', R18模式, 数量, 主题,
        false, undefined, undefined,
        {
          onDelta: ({ index, text }) => {
            set结果列表((prev) => {
              const next = [...prev];
              while (next.length <= index) next.push('');
              next[index] = transformToWan22Style((next[index] || '') + text, R18模式);
              return next;
            });
          },
          onEnd: ({ index, prompt }) => {
            const styled = transformToWan22Style(prompt, R18模式);
            set结果列表((prev) => {
              const next = [...prev];
              while (next.length <= index) next.push('');
              next[index] = styled;
              return next;
            });
          },
          onError: ({ index, message }) => {
            alert(`随机抽卡失败${index !== undefined ? ` (第${index + 1}条)` : ''}: ${message}`);
          },
        },
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : '随机抽卡失败');
    } finally {
      set加载中(false);
    }
  };
  const 处理复制 = (idx: number, 文本: string) => {
    navigator.clipboard.writeText(文本).then(() => { set已复制索引(idx); setTimeout(() => set已复制索引(null), 2000); });
  };

  const 处理应用 = () => {
    if (!输出文本.trim()) return;
    on应用(输出文本);
  };

  return (
    <div className="rounded-xl bg-bg-surface border border-border p-4 space-y-4">
      {/* 模式切换 */}
      <div className="flex items-center gap-2">
        <div className="flex bg-bg-elevated rounded-xl p-1">
          {(['智能视频', '智能扩写', '随机抽卡'] as const).map((m) => (
            <button
              key={m}
              onClick={() => set模式(m)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                模式 === m ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {m === '智能视频' && <Video size={11} />}
              {m === '智能扩写' && <Wand2 size={11} />}
              {m === '随机抽卡' && <Sparkles size={11} />}
              {m}
            </button>
          ))}
        </div>
        <button
          onClick={() => setR18模式(!R18模式)}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            R18模式 ? 'bg-red-500 text-white' : 'bg-bg-elevated text-text-secondary'
          }`}
        >
          R18
        </button>
      </div>

      {/* 智能视频模式 */}
      {模式 === '智能视频' && (
        <div className="space-y-3">
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 text-[11px] text-blue-700 leading-relaxed">
            Prompt starts with <strong>1girl</strong>, subject appearance anchored by reference image. Focus on <strong>motion, camera, lighting, and style</strong> only. No appearance descriptors.
          </div>
          <div className="grid grid-cols-1 gap-2">
            <select
              value={动作}
              onChange={(e) => set动作(e.target.value)}
              className="w-full h-9 px-3 rounded-lg text-xs border border-border bg-bg-elevated text-text-primary focus:outline-none focus:border-primary appearance-none cursor-pointer"
            >
              {MOTION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <select value={镜头} onChange={(e) => set镜头(e.target.value)}
                className="w-full h-9 px-3 rounded-lg text-xs border border-border bg-bg-elevated text-text-primary focus:outline-none focus:border-primary appearance-none cursor-pointer">
                {CAMERA_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
              <select value={光影} onChange={(e) => set光影(e.target.value)}
                className="w-full h-9 px-3 rounded-lg text-xs border border-border bg-bg-elevated text-text-primary focus:outline-none focus:border-primary appearance-none cursor-pointer">
                {LIGHTING_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select value={风格} onChange={(e) => set风格(e.target.value)}
                className="w-full h-9 px-3 rounded-lg text-xs border border-border bg-bg-elevated text-text-primary focus:outline-none focus:border-primary appearance-none cursor-pointer">
                {STYLE_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
              <select value={场景} onChange={(e) => set场景(e.target.value)}
                className="w-full h-9 px-3 rounded-lg text-xs border border-border bg-bg-elevated text-text-primary focus:outline-none focus:border-primary appearance-none cursor-pointer">
                {SCENE_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
            </div>
          </div>

          {构建视频提示词() !== '1girl' && (
            <div className="bg-bg-elevated border border-border rounded-xl px-3 py-2">
              <div className="text-[10px] text-text-tertiary mb-1">预览</div>
              <p className="text-xs text-text-secondary leading-relaxed">{构建视频提示词()}</p>
            </div>
          )}

          <button
            onClick={处理生成视频}
            className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-medium text-sm transition-all ${
              R18模式 ? 'bg-gradient-to-r from-red-500 to-red-600 text-white hover:opacity-90' : 'bg-gradient-to-r from-primary to-primary/80 text-white hover:opacity-90'
            }`}
          >
            <Video size={14} />生成动画提示词
          </button>
        </div>
      )}

      {/* 智能扩写模式 */}
      {模式 === '智能扩写' && (
        <div className="space-y-3">
          <textarea
            value={输入}
            onChange={(e) => set输入(e.target.value)}
            placeholder="输入你的视频想法描述..."
            rows={2}
            className="w-full border border-border rounded-xl px-4 py-3 text-sm placeholder:text-text-secondary focus:outline-none focus:border-primary bg-bg-elevated resize-none"
          />
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-tertiary">数量:</span>
            <div className="flex gap-1">
              {[1, 3, 5, 8, 10].map((n) => (
                <button key={n} onClick={() => set数量(n)}
                  className={`w-7 h-7 rounded-lg text-xs font-medium transition-all ${数量 === n ? (R18模式 ? 'bg-red-500 text-white' : 'bg-primary text-white') : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'}`}>{n}</button>
              ))}
            </div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[11px] text-amber-700">
            扩写后自动转换，仅保留动作/镜头/光影/风格，移除人物外貌描述
          </div>
          <button
            onClick={处理扩写}
            disabled={加载中 || !输入.trim()}
            className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-medium text-sm transition-all ${
              加载中 || !输入.trim()
                ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                : R18模式 ? 'bg-gradient-to-r from-red-500 to-red-600 text-white hover:opacity-90' : 'bg-gradient-to-r from-primary to-primary/80 text-white hover:opacity-90'
            }`}
          >
            {加载中 ? <><Loader2 size={14} className="animate-spin" /> 扩写中...</> : <><Wand2 size={14} />{R18模式 ? '生成 R18 提示词' : '开始扩写'}</>}
          </button>
        </div>
      )}

      {/* 随机抽卡模式 */}
      {模式 === '随机抽卡' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {[1, 3, 5, 8, 10].map((n) => (
                <button key={n} onClick={() => set数量(n)}
                  className={`w-7 h-7 rounded-lg text-xs font-medium transition-all ${数量 === n ? (R18模式 ? 'bg-red-500 text-white' : 'bg-primary text-white') : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'}`}>{n}</button>
              ))}
            </div>
            <div className="h-4 w-px bg-border" />
            <select
              value={主题}
              onChange={(e) => set主题(e.target.value)}
              className="h-7 px-2 rounded-lg text-xs border bg-bg-elevated border-border text-text-primary focus:outline-none focus:border-primary appearance-none cursor-pointer"
            >
              {VIDEO_THEMES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[11px] text-amber-700">
            抽卡后自动转换，仅保留动作/镜头/光影/风格，移除人物外貌描述
          </div>
          <button
            onClick={处理随机}
            disabled={加载中}
            className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-medium text-sm transition-all ${
              加载中
                ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                : R18模式 ? 'bg-gradient-to-r from-red-500 to-red-600 text-white hover:opacity-90' : 'bg-gradient-to-r from-primary to-primary/80 text-white hover:opacity-90'
            }`}
          >
            {加载中 ? <><Loader2 size={14} className="animate-spin" /> 抽卡中...</> : <><Sparkles size={14} />{R18模式 ? 'R18 抽卡' : '开始抽卡'}{主题 ? ` [${VIDEO_THEMES.find(t => t.key === 主题)?.label}]` : ''}</>}
          </button>
        </div>
      )}

      {/* 结果输出 */}
      {结果列表.length > 0 && (
        <div className="space-y-3 pt-2 border-t border-border/50">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-white text-[11px] font-bold bg-gradient-to-r ${R18模式 ? 'from-red-500 to-pink-500' : 'from-primary to-indigo-500'}`}>
              {结果列表.length} 个提示词
            </span>
            <div className="flex gap-1 overflow-x-auto">
              {结果列表.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => { set选中索引(idx); set输出文本(结果列表[idx]); }}
                  className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-all flex-shrink-0 ${
                    选中索引 === idx
                      ? (R18模式 ? 'bg-red-500 text-white' : 'bg-primary text-white')
                      : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'
                  }`}
                >
                  {idx + 1}
                </button>
              ))}
            </div>
          </div>

          {/* 输出 textarea — auto-resize, no scrollbar */}
          <div>
            <textarea
              ref={textareaRef}
              value={输出文本}
              onChange={(e) => {
                set输出文本(e.target.value);
                const next = [...结果列表];
                next[选中索引] = e.target.value;
                set结果列表(next);
              }}
              style={{ overflow: 'hidden' }}
              className={`w-full border rounded-xl px-4 py-3 text-sm leading-relaxed placeholder:text-text-secondary focus:outline-none transition-colors ${
                R18模式 ? 'bg-red-50/50 border-red-200 focus:border-red-400 text-red-800' : 'bg-bg-elevated border-border focus:border-primary text-text-secondary'
              }`}
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => 处理复制(选中索引, 输出文本)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium transition-all ${R18模式 ? 'bg-red-50 text-red-500 hover:bg-red-100 border border-red-200' : 'bg-bg-elevated text-text-tertiary hover:bg-bg-hover'}`}
            >
              {已复制索引 === 选中索引 ? <><Check size={12} /> 已复制</> : <><Copy size={12} /> 复制</>}
            </button>
            <button
              onClick={处理应用}
              disabled={!输出文本.trim()}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl font-medium text-sm transition-all ${
                !输出文本.trim()
                  ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:opacity-90'
              }`}
            >
              <Video size={14} />应用并生视频
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 历史记录选择器 ─────────────────────────────────────────────────────────────

interface 历史分组项 {
  ids: string[]; // 支持多个记录（同一提示词可能有多条）
  提示词: string;
  创建时间: number;
  图片列表: string[];
  zipUrl?: string;
  workflowType: 'txt2img' | 'img2img' | 'img2vid';
}

function 历史图片选择器({ on选择, 当前图片路径 }: { on选择: (url: string, preview: string) => void; 当前图片路径: string }) {
  const [显示面板, set显示面板] = useState(false);
  const [分组列表, set分组列表] = useState<历史分组项[]>([]);
  const [展开分组, set展开分组] = useState<string | null>(null);
  const [加载中图片, set加载中图片] = useState<Record<string, string[]>>({});

  const 加载历史 = useCallback(() => {
    const records = getRecords();
    const 分组 = new Map<string, 历史分组项>();
    records.forEach((rec) => {
      const key = rec.prompt || '无描述';
      if (分组.has(key)) {
        const 已存在 = 分组.get(key)!;
        已存在.ids.push(rec.id);
        if (rec.images && rec.images.length > 0) {
          已存在.图片列表 = [...已存在.图片列表, ...rec.images].slice(0, 20);
        }
        if (!已存在.zipUrl && rec.zipUrl) 已存在.zipUrl = rec.zipUrl;
      } else {
        分组.set(key, {
          ids: [rec.id],
          提示词: key,
          创建时间: rec.createdAt,
          图片列表: rec.images || [],
          zipUrl: rec.zipUrl || undefined,
          workflowType: rec.workflowType,
        });
      }
    });
    const 结果 = Array.from(分组.values()).sort((a, b) => b.创建时间 - a.创建时间).slice(0, 30);
    set分组列表(结果);
  }, []);

  const 加载分组图片 = useCallback(async (分组: 历史分组项) => {
    if (加载中图片[分组.提示词]) return;

    // img2vid: the input image is stored directly in 图片列表 — no zip extraction needed
    if (分组.workflowType === 'img2vid') {
      const valid = 分组.图片列表.filter(Boolean);
      set加载中图片((prev) => ({ ...prev, [分组.提示词]: valid }));
      return;
    }

    // txt2img / img2img: extract thumbnail images from zip
    const cached = 分组.图片列表.filter(Boolean);
    if (cached.length > 0) {
      set加载中图片((prev) => ({ ...prev, [分组.提示词]: cached }));
      return;
    }

    if (分组.zipUrl) {
      set加载中图片((prev) => ({ ...prev, [分组.提示词]: [] }));
      try {
        const imgs = await extractImagesFromZipAsDataUrls(分组.zipUrl);
        if (imgs.length > 0) {
          set加载中图片((prev) => ({ ...prev, [分组.提示词]: imgs }));
        }
      } catch {
        set加载中图片((prev) => ({ ...prev, [分组.提示词]: [] }));
      }
    }
  }, [加载中图片]);

  useEffect(() => {
    if (显示面板) 加载历史();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [显示面板]);

  const 处理选择图片 = (分组: 历史分组项, 图片: string) => {
    on选择(图片, 图片);
    set显示面板(false);
  };

  const 删除分组 = (分组: 历史分组项, e: React.MouseEvent) => {
    e.stopPropagation();
    分组.ids.forEach((id) => deleteRecord(id));
    set分组列表((prev) => prev.filter((g) => g.提示词 !== 分组.提示词));
    set展开分组(null);
  };

  const 清空全部 = () => {
    clearAllHistory();
    set分组列表([]);
    set展开分组(null);
  };

  return (
    <div>
      <button
        onClick={() => set显示面板(!显示面板)}
        className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
          显示面板
            ? 'bg-primary/10 text-primary border border-primary/20'
            : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover'
        }`}
      >
        <History size={13} />
        历史记录
      </button>

      {显示面板 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => set显示面板(false)}>
          <div className="bg-white rounded-2xl border border-border shadow-2xl w-full max-w-md max-h-[70vh] flex flex-col animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
              <h3 className="text-sm font-semibold text-text-primary">按提示词选择历史图片</h3>
              <div className="flex items-center gap-1">
                {分组列表.length > 0 && (
                  <button
                    onClick={清空全部}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 border border-red-200 transition-all"
                    title="清空全部历史记录"
                  >
                    <Trash2 size={12} />
                    清空
                  </button>
                )}
                <button onClick={() => set显示面板(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-bg-hover transition-colors">
                  <X size={16} className="text-text-secondary" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {分组列表.length === 0 ? (
                <div className="text-center py-12">
                  <Clock size={32} className="mx-auto text-text-tertiary/40 mb-2" />
                  <p className="text-sm text-text-tertiary">暂无历史记录</p>
                </div>
              ) : (
                分组列表.map((分组) => {
                  const 图片列表 = 加载中图片[分组.提示词] || 分组.图片列表;
                  const 是展开 = 展开分组 === 分组.提示词;
                  const 是当前选中 = 图片列表.includes(当前图片路径);

                  return (
                    <div key={分组.提示词} className="rounded-xl border border-border bg-bg-elevated overflow-hidden">
                      {/* 折叠行：左侧显示第一张图片预览 */}
                      <div className="flex items-stretch">
                        {/* 左侧预览图 */}
                        <div className="w-16 h-16 flex-shrink-0 bg-bg-base">
                          {图片列表.length > 0 ? (
                            <img
                              src={图片列表[0]}
                              alt=""
                              className="w-full h-full object-cover"
                              onClick={() => {
                                if (!是展开) {
                                  set展开分组(分组.提示词);
                                  加载分组图片(分组);
                                }
                              }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Loader2 size={16} className="text-text-tertiary animate-spin" />
                            </div>
                          )}
                        </div>

                        {/* 右侧内容 */}
                        <button
                          onClick={() => {
                            if (是展开) {
                              set展开分组(null);
                            } else {
                              set展开分组(分组.提示词);
                              加载分组图片(分组);
                            }
                          }}
                          className="flex-1 flex items-start gap-2 p-3 text-left hover:bg-bg-hover/50 transition-colors"
                        >
                          <div className="mt-0.5 text-text-tertiary flex-shrink-0">
                            {是展开 ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-text-primary line-clamp-2">{分组.提示词}</p>
                            <p className="text-[10px] text-text-tertiary mt-1">
                              {new Date(分组.创建时间).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              {图片列表.length > 0 && ` · ${图片列表.length} 张图片`}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={(e) => 删除分组(分组, e)}
                              className="w-7 h-7 flex items-center justify-center rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-colors"
                              title="删除此条记录"
                            >
                              <Trash2 size={13} />
                            </button>
                            {是当前选中 && <Check size={14} className="text-primary" />}
                          </div>
                        </button>
                      </div>

                      {/* 展开：图片网格 */}
                      {是展开 && (
                        <div className="px-3 pb-3">
                          {图片列表.length === 0 ? (
                            <div className="text-center py-4 text-xs text-text-tertiary">无法加载图片</div>
                          ) : (
                            <div className="grid grid-cols-3 gap-2">
                              {图片列表.map((img, idx) => (
                                <button
                                  key={idx}
                                  onClick={() => 处理选择图片(分组, img)}
                                  className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                                    img === 当前图片路径 ? 'border-primary' : 'border-transparent hover:border-primary/40'
                                  }`}
                                >
                                  <img src={img} alt="" className="w-full h-full object-cover" />
                                  {img === 当前图片路径 && (
                                    <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                                      <Check size={16} className="text-primary" />
                                    </div>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MiniMax H3 面板 ─────────────────────────────────────────────────────────

interface MiniMaxH3PanelProps {
  apiKey: string;
  mmImages: { path: string; preview: string }[];
  setMmImages: React.Dispatch<React.SetStateAction<{ path: string; preview: string }[]>>;
  mmPrompt: string;
  setMmPrompt: (v: string) => void;
  mmDuration: string;
  setMmDuration: (v: string) => void;
  mmStrength: number;
  setMmStrength: (v: number) => void;
  mmStyleMode: string;
  setMmStyleMode: (v: string) => void;
  mmAutoPrompt: boolean;
  setMmAutoPrompt: (v: boolean) => void;
  mmDirectOutput: boolean;
  setMmDirectOutput: (v: boolean) => void;
  mmVideoModel: string;
  setMmVideoModel: (v: string) => void;
  mmLora: string;
  setMmLora: (v: string) => void;
  mmLoraWeight: number;
  setMmLoraWeight: (v: number) => void;
  mmUploading: boolean;
  setMmUploading: (v: boolean) => void;
  isSubmitting: boolean;
  setIsSubmitting: (v: boolean) => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  taskListRef: React.RefObject<{ submitTask: (prompt: string, imagePath: string, imagePreview: string, nodeInfoList: NodeInfo[], workflowId?: string) => void } | null>;
  // Digital human (girlfriend) props
  selectedGirlfriend: GirlfriendPreset | null;
  setSelectedGirlfriend: (gf: GirlfriendPreset | null) => void;
  girlfriendUploading: boolean;
  setGirlfriendUploading: (v: boolean) => void;
}

function MiniMaxH3Panel({
  apiKey, mmImages, setMmImages, mmPrompt, setMmPrompt,
  mmDuration, setMmDuration, mmStrength, setMmStrength,
  mmStyleMode, setMmStyleMode, mmAutoPrompt, setMmAutoPrompt,
  mmDirectOutput, setMmDirectOutput, mmVideoModel, setMmVideoModel,
  mmLora, setMmLora, mmLoraWeight, setMmLoraWeight,
  mmUploading, setMmUploading, isSubmitting, setIsSubmitting,
  onError, onSuccess, taskListRef,
  selectedGirlfriend, setSelectedGirlfriend, girlfriendUploading, setGirlfriendUploading
}: MiniMaxH3PanelProps) {

  // Pose preset handler
  const handlePoseSelect = (posePrompt: string, poseName: string) => {
    if (mmPrompt.trim()) {
      setMmPrompt(mmPrompt + ', ' + posePrompt);
    } else {
      setMmPrompt(posePrompt);
    }
    onSuccess(`已应用姿势: ${poseName}`);
  };

  // Template preset handler
  const handleTemplateApply = (template: typeof H3_VIDEO_TEMPLATES[0]) => {
    setMmPrompt(template.prompt);
    onSuccess(`已应用模板：${template.name}`);
  };

  // Girlfriend selection handler
  const handleGirlfriendSelect = useCallback(async (gf: GirlfriendPreset) => {
    setSelectedGirlfriend(gf);
    setGirlfriendUploading(true);
    try {
      let file: File;
      let objectUrl: string;

      if (gf.portraitUrl.startsWith('data:')) {
        const res = await fetch(gf.portraitUrl);
        const blob = await res.blob();
        file = new File([blob], `${gf.id}.jpg`, { type: blob.type || 'image/jpeg' });
        objectUrl = gf.portraitUrl;
      } else {
        const res = await fetch(gf.portraitUrl);
        const blob = await res.blob();
        file = new File([blob], `${gf.id}.jpg`, { type: blob.type || 'image/jpeg' });
        objectUrl = URL.createObjectURL(blob);
      }

      const { imagePath } = await uploadImage(apiKey, file);
      // Add as first reference image
      setMmImages(prev => {
        const updated = [{ path: imagePath, preview: objectUrl }, ...prev.slice(0, 2)];
        return updated;
      });
      onSuccess(`已选择女友「${gf.nameZh || gf.name}」并设为参考图`);
    } catch (err) {
      onError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setGirlfriendUploading(false);
    }
  }, [apiKey, setMmImages, onSuccess, onError, setSelectedGirlfriend, setGirlfriendUploading]);

  const handleImageUpload = async (file: File, index: number) => {
    setMmUploading(true);
    try {
      const objectUrl = URL.createObjectURL(file);
      const { imagePath } = await uploadImage(apiKey, file);
      setMmImages(prev => {
        const updated = [...prev];
        updated[index] = { path: imagePath, preview: objectUrl };
        return updated;
      });
      onSuccess(`参考图 ${index + 1} 上传成功`);
    } catch (err) {
      onError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setMmUploading(false);
    }
  };

  const handleImageRemove = (index: number) => {
    setMmImages(prev => {
      const updated = [...prev];
      updated[index] = { path: '', preview: '' };
      return updated;
    });
  };

  const buildMiniMaxNodeList = (): NodeInfo[] => {
    const nodeList: NodeInfo[] = [
      { nodeId: '238', fieldName: 'value', fieldValue: String(mmStrength), description: '强度' },
      { nodeId: '185', fieldName: 'value', fieldValue: mmDuration, description: '时长' },
      { nodeId: '182', fieldName: 'select', fieldValue: mmStyleMode, description: '风格模式' },
      { nodeId: '127', fieldName: 'value', fieldValue: String(mmAutoPrompt), description: '自动提示词' },
      { nodeId: '38', fieldName: 'prompt', fieldValue: getFullPrompt(), description: '提示词' },
      { nodeId: '19', fieldName: 'unet_name', fieldValue: mmVideoModel, description: '视频模型' },
      { nodeId: '111', fieldName: 'lora_name', fieldValue: mmLora, description: 'LoRA模型' },
      { nodeId: '111', fieldName: 'strength_model', fieldValue: String(mmLoraWeight), description: 'LoRA权重' },
    ];

    // Add images (up to 3)
    const imageNodeIds = ['50', '76', '79'];
    mmImages.forEach((img, idx) => {
      if (img.path) {
        nodeList.push({
          nodeId: imageNodeIds[idx],
          fieldName: 'image',
          fieldValue: img.path,
          description: `参考图${idx + 1}`
        });
      }
    });

    return nodeList;
  };

  const handleSubmit = () => {
    if (mmImages.length === 0 || !mmImages[0]?.path) {
      onError('请至少上传一张参考图');
      return;
    }
    if (mmSubmitting) return;
    setMmSubmitting(true);
    setIsSubmitting(true);

    const nodeList = buildMiniMaxNodeList();
    const preview = mmImages[0]?.preview || '';
    const fullPrompt = getFullPrompt();

    taskListRef.current?.submitTask(fullPrompt, mmImages[0]?.path || '', preview, nodeList, WORKFLOW.MINIMAX_H3);
    onSuccess('任务已提交');
    setMmSubmitting(false);
    setIsSubmitting(false);
  };

  // We need a local submitting state that syncs with parent
  const [mmSubmitting, setMmSubmitting] = useState(false);

  // Build full prompt with character anchor
  const getFullPrompt = (): string => {
    const identityPrefix = selectedGirlfriend?.characterPrompt || '';
    return identityPrefix ? `${identityPrefix} ${mmPrompt}`.trim() : mmPrompt;
  };

  return (
    <div className="space-y-4">
      {/* GirlfriendSelector - 数字人锚定 */}
      <GirlfriendSelector
        selectedId={selectedGirlfriend ? (selectedGirlfriend.isCustom ? `custom_${selectedGirlfriend.id}` : selectedGirlfriend.id) : null}
        onSelect={handleGirlfriendSelect}
        disabled={girlfriendUploading || isSubmitting}
      />

      {/* PosePresetSelector - 视频姿势预设 */}
      <PosePresetSelector
        type="video"
        onSelect={handlePoseSelect}
        disabled={isSubmitting}
        selectedGirlfriend={selectedGirlfriend}
      />

      {/* 参考图上传 - 支持最多9张 */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
            <ImageIcon size={16} className="text-purple-500" />
            参考图（最多9张）
            {selectedGirlfriend && (
              <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 text-[10px] font-medium">
                AI 女友模式
              </span>
            )}
          </h3>
          <span className="text-xs text-text-tertiary">
            {mmImages.filter(img => img.path).length}/9
          </span>
        </div>

        <div className="grid grid-cols-5 gap-2">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(idx => (
            <div key={idx} className="relative">
              {mmImages[idx]?.preview ? (
                <div className="relative aspect-square rounded-xl overflow-hidden border-2 border-purple-200 bg-bg-elevated">
                  <img
                    src={mmImages[idx].preview}
                    alt={`参考图${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => handleImageRemove(idx)}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                    disabled={isSubmitting}
                  >
                    <X size={12} />
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1">
                    <span className="text-[10px] text-white/90">参考图 {idx + 1}</span>
                  </div>
                </div>
              ) : (
                <label className="relative flex flex-col items-center justify-center aspect-square rounded-xl border-2 border-dashed border-border hover:border-purple-400 bg-bg-elevated cursor-pointer transition-colors">
                  {mmUploading ? (
                    <Loader2 size={20} className="text-purple-400 animate-spin" />
                  ) : (
                    <>
                      <ImageIcon size={20} className="text-text-tertiary" />
                      <span className="text-[10px] text-text-tertiary mt-1">上传</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImageUpload(file, idx);
                    }}
                    disabled={isSubmitting || mmUploading}
                  />
                </label>
              )}
            </div>
          ))}
        </div>

        <p className="text-[11px] text-text-tertiary mt-2">
          第一张图将作为视频首帧，后续图片作为动作参考
        </p>
      </div>

      {/* 提示词 */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-text-primary">提示词</h3>
          {/* 自动提示词开关 */}
          <button
            onClick={() => setMmAutoPrompt(!mmAutoPrompt)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              mmAutoPrompt ? 'bg-green-500/20 text-green-600 border border-green-300' : 'bg-bg-elevated text-text-tertiary'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${mmAutoPrompt ? 'bg-green-500' : 'bg-text-tertiary'}`} />
            自动提示词 {mmAutoPrompt ? '开启' : '关闭'}
          </button>
        </div>
        {/* 模版预设 */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-text-tertiary flex-shrink-0">模版：</span>
          <div className="flex flex-wrap gap-1.5">
            {H3_VIDEO_TEMPLATES.map((tpl) => (
              <button
                key={tpl.name}
                onClick={() => handleTemplateApply(tpl)}
                className={`px-3 py-1 rounded-lg text-xs font-medium bg-gradient-to-r ${tpl.color} text-white hover:opacity-90 transition-opacity`}
                disabled={isSubmitting}
              >
                {tpl.name}
              </button>
            ))}
          </div>
        </div>
        <div className="relative">
          <textarea
            value={mmPrompt}
            onChange={(e) => setMmPrompt(e.target.value)}
            placeholder={mmAutoPrompt ? '开启自动提示词，可不填或填写简单描述' : '描述视频中的人物动作、表情、场景变化...'}
            rows={4}
            className="w-full px-3 py-2 pr-9 rounded-lg bg-bg-elevated border border-border text-sm text-text-primary placeholder-slate-500 focus:outline-none focus:border-purple-400/50 resize-none"
            disabled={isSubmitting}
          />
          {mmPrompt && (
            <button
              type="button"
              onClick={() => setMmPrompt('')}
              disabled={isSubmitting}
              className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full bg-bg-surface border border-border text-text-tertiary hover:text-red-500 hover:border-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-50"
              title="清除提示词"
            >
              <X size={12} />
            </button>
          )}
        </div>
        {selectedGirlfriend && (
          <div className="mt-2 px-2 py-1 rounded bg-red-50 border border-red-200 text-[10px] text-red-600">
            已锚定数字人：{selectedGirlfriend.nameZh || selectedGirlfriend.name}
          </div>
        )}
      </div>

      {/* 风格设置 */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <h3 className="text-sm font-medium text-text-primary mb-3">风格设置</h3>
        <div className="space-y-3">
          {/* 风格模式选择 */}
          <div>
            <label className="text-xs text-text-secondary mb-1.5 block">风格模式</label>
            <div className="flex gap-2">
              {MINIMAX_STYLE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setMmStyleMode(opt.value)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                    mmStyleMode === opt.value
                      ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
                      : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover'
                  }`}
                  disabled={isSubmitting}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 时长 */}
          <div className="grid grid-cols-4 gap-2">
            <div className="col-span-1">
              <ParameterSelect
                label="时长"
                value={mmDuration}
                options={MINIMAX_DURATION_OPTIONS}
                onChange={setMmDuration}
                disabled={isSubmitting}
              />
            </div>
            <div className="col-span-3">
              <ParameterSlider
                label="强度"
                value={mmStrength}
                min={0.1}
                max={1}
                step={0.1}
                onChange={setMmStrength}
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* 输出格式 */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMmDirectOutput(!mmDirectOutput)}
              className={`w-10 h-6 rounded-full transition-colors relative ${mmDirectOutput ? 'bg-purple-500' : 'bg-text-tertiary'}`}
              disabled={isSubmitting}
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${mmDirectOutput ? 'translate-x-5' : 'translate-x-1'}`} />
            </button>
            <span className="text-xs text-text-secondary">
              直出模式 {mmDirectOutput ? '（直出视频）' : '（ZIP格式，默认关闭）'}
            </span>
          </div>
        </div>
      </div>

      {/* 视频模型配置 */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <h3 className="text-sm font-medium text-text-primary mb-3">视频模型配置</h3>
        <RunningHubModelPicker
          label="视频模型"
          kind="checkpoint"
          value={mmVideoModel}
          onChange={(name) => setMmVideoModel(name || '')}
          placeholder="不使用"
          disabled={isSubmitting}
          baseModelFilter="minimax-h3"
        />
      </div>

      {/* LoRA配置 */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <h3 className="text-sm font-medium text-text-primary mb-3">LoRA配置</h3>
        <div className="space-y-3">
          <RunningHubModelPicker
            label="LoRA模型"
            kind="lora"
            loraSlot="lora1"
            value={mmLora}
            onChange={(name) => setMmLora(name || '')}
            placeholder="不使用"
            disabled={isSubmitting}
            baseModelFilter="minimax-h3"
          />
          <ParameterSlider
            label="LoRA权重"
            value={mmLoraWeight}
            min={0.1}
            max={1}
            step={0.1}
            onChange={setMmLoraWeight}
            disabled={isSubmitting}
          />
        </div>
      </div>

      {/* 生成按钮 */}
      <div className="pt-2 pb-4">
        <GenerateButton
          onClick={handleSubmit}
          isLoading={isSubmitting}
          disabled={!mmImages[0]?.path || isSubmitting || mmUploading}
          label={mmUploading ? '上传中...' : isSubmitting ? '提交中...' : '生成视频'}
        />
      </div>
    </div>
  );
}

// ─── MiniMax Long Video 面板 ─────────────────────────────────────────────────────────

interface MiniMaxLongVideoPanelProps {
  apiKey: string;
  mlImages: { path: string; preview: string }[];
  setMlImages: React.Dispatch<React.SetStateAction<{ path: string; preview: string }[]>>;
  mlPrompts: string[];
  setMlPrompts: (v: string[]) => void;
  mlDuration: number;
  setMlDuration: (v: number) => void;
  mlAutoPrompt: boolean;
  setMlAutoPrompt: (v: boolean) => void;
  mlDirectOutput: boolean;
  setMlDirectOutput: (v: boolean) => void;
  mlVideoModel: string;
  setMlVideoModel: (v: string) => void;
  mlLora: string;
  setMlLora: (v: string) => void;
  mlLoraWeight: number;
  setMlLoraWeight: (v: number) => void;
  mlUploading: boolean;
  setMlUploading: (v: boolean) => void;
  isSubmitting: boolean;
  setIsSubmitting: (v: boolean) => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  taskListRef: React.RefObject<{ submitTask: (prompt: string, imagePath: string, imagePreview: string, nodeInfoList: NodeInfo[], workflowId?: string) => void } | null>;
  selectedGirlfriend: GirlfriendPreset | null;
  setSelectedGirlfriend: (gf: GirlfriendPreset | null) => void;
  girlfriendUploading: boolean;
  setGirlfriendUploading: (v: boolean) => void;
  /** H3 提示词引擎相关 */
  mlH3Prompt?: string;
  setMlH3Prompt?: (v: string) => void;
  mlH3Duration?: 15 | 30 | 60;
  setMlH3Duration?: (v: 15 | 30 | 60) => void;
  handleGenerateH3Prompt?: (duration?: 15 | 30 | 60) => void;
  handleGotoLongVideoWithH3?: () => void;
}

function MiniMaxLongVideoPanel({
  apiKey, mlImages, setMlImages, mlPrompts, setMlPrompts,
  mlDuration, setMlDuration, mlAutoPrompt, setMlAutoPrompt, mlDirectOutput, setMlDirectOutput,
  mlVideoModel, setMlVideoModel, mlLora, setMlLora, mlLoraWeight, setMlLoraWeight,
  mlUploading, setMlUploading, isSubmitting, setIsSubmitting,
  onError, onSuccess, taskListRef,
  selectedGirlfriend, setSelectedGirlfriend, girlfriendUploading, setGirlfriendUploading,
  mlH3Prompt, setMlH3Prompt, mlH3Duration, setMlH3Duration,
  handleGenerateH3Prompt, handleGotoLongVideoWithH3,
}: MiniMaxLongVideoPanelProps) {

  // Handle image upload
  const handleImageUpload = async (file: File, index: number) => {
    setMlUploading(true);
    try {
      const objectUrl = URL.createObjectURL(file);
      const { imagePath } = await uploadImage(apiKey, file);
      setMlImages(prev => {
        const updated = [...prev];
        updated[index] = { path: imagePath, preview: objectUrl };
        return updated;
      });
      onSuccess(`参考图 ${index + 1} 上传成功`);
    } catch (err) {
      onError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setMlUploading(false);
    }
  };

  const handleImageRemove = (index: number) => {
    setMlImages(prev => {
      const updated = [...prev];
      updated[index] = { path: '', preview: '' };
      return updated;
    });
  };

  // Pose preset handler
  const handlePoseSelect = (posePrompt: string, poseName: string) => {
    // Apply to first empty prompt
    const idx = mlPrompts.findIndex(p => !p.trim());
    if (idx >= 0) {
      const newPrompts = [...mlPrompts];
      newPrompts[idx] = posePrompt;
      setMlPrompts(newPrompts);
    } else {
      // All filled, append to first
      const newPrompts = [...mlPrompts];
      newPrompts[0] = mlPrompts[0] + ', ' + posePrompt;
      setMlPrompts(newPrompts);
    }
    onSuccess(`已应用姿势: ${poseName}`);
  };

  // Template preset handler (apply to first prompt slot)
  const handleTemplateApply = (template: typeof H3_VIDEO_TEMPLATES[0]) => {
    const newPrompts = [...mlPrompts];
    newPrompts[0] = template.prompt;
    setMlPrompts(newPrompts);
    onSuccess(`已应用模板：${template.name}`);
  };

  // Girlfriend selection handler
  const handleGirlfriendSelect = useCallback(async (gf: GirlfriendPreset) => {
    setSelectedGirlfriend(gf);
    setGirlfriendUploading(true);
    try {
      let file: File;
      let objectUrl: string;

      if (gf.portraitUrl.startsWith('data:')) {
        const res = await fetch(gf.portraitUrl);
        const blob = await res.blob();
        file = new File([blob], `${gf.id}.jpg`, { type: blob.type || 'image/jpeg' });
        objectUrl = gf.portraitUrl;
      } else {
        const res = await fetch(gf.portraitUrl);
        const blob = await res.blob();
        file = new File([blob], `${gf.id}.jpg`, { type: blob.type || 'image/jpeg' });
        objectUrl = URL.createObjectURL(blob);
      }

      const { imagePath } = await uploadImage(apiKey, file);
      // Add as first reference image
      setMlImages(prev => {
        const updated = [{ path: imagePath, preview: objectUrl }, ...prev.slice(0, 2)];
        return updated;
      });
      onSuccess(`已选择女友「${gf.nameZh || gf.name}」并设为参考图`);
    } catch (err) {
      onError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setGirlfriendUploading(false);
    }
  }, [apiKey, setMlImages, onSuccess, onError, setSelectedGirlfriend, setGirlfriendUploading]);

  // Build full prompt with character anchor
  const getFullPrompt = (index: number): string => {
    const identityPrefix = selectedGirlfriend?.characterPrompt || '';
    const prompt = mlPrompts[index] || '';
    return identityPrefix ? `${identityPrefix} ${prompt}`.trim() : prompt;
  };

  // Build node list — node IDs match the MiniMax Long Video workflow template (workflowId: 2091369701523136514)
  const buildNodeList = (): NodeInfo[] => {
    const nodeList: NodeInfo[] = [];

    // ── Duration (per-segment, default 10 seconds) ──────────────────────────
    nodeList.push({
      nodeId: '159',
      fieldName: 'value',
      fieldValue: String(mlDuration),
      description: '单段时长(秒)'
    });

    // ── Strength (matching template default 0.4) ──────────────────────────────
    nodeList.push({
      nodeId: '25',
      fieldName: 'value',
      fieldValue: String(mlLoraWeight),
      description: '强度'
    });

    // ── HDR and other bool flags (matching template defaults) ────────────────
    nodeList.push({
      nodeId: '329',
      fieldName: 'value',
      fieldValue: 'true',
      description: 'enable_hdr'
    });
    nodeList.push({
      nodeId: '272',
      fieldName: 'value',
      fieldValue: 'false',
      description: 'denoise'
    });

    // ── Combined prompt (nodeId 59) ─────────────────────────────────────────
    const combinedPrompt = mlPrompts.filter(Boolean).join(' | ');
    if (combinedPrompt) {
      nodeList.push({
        nodeId: '59',
        fieldName: 'prompt',
        fieldValue: combinedPrompt,
        description: '提示词'
      });
    }

    // ── Per-segment durations (nodes 210, 211, 212) ─────────────────────────
    const segmentDurations = [210, 211, 212];
    segmentDurations.forEach((nodeId) => {
      nodeList.push({
        nodeId: String(nodeId),
        fieldName: 'text',
        fieldValue: String(mlDuration),
        description: '单段时长'
      });
    });

    // ── Video model (UNet, nodeId 11) ───────────────────────────────────────
    if (mlVideoModel) {
      nodeList.push({
        nodeId: '11',
        fieldName: 'unet_name',
        fieldValue: mlVideoModel,
        description: '视频模型'
      });
    }

    // ── LoRA (nodeId 57) ────────────────────────────────────────────────────
    if (mlLora) {
      nodeList.push({
        nodeId: '57',
        fieldName: 'lora_name',
        fieldValue: mlLora,
        description: 'LoRA模型'
      });
      nodeList.push({
        nodeId: '57',
        fieldName: 'strength_model',
        fieldValue: String(mlLoraWeight),
        description: 'LoRA权重'
      });
    }

    // ── Reference images (nodeIds 28, 273, 285 — up to 3) ──────────────────
    const imageNodeIds = ['28', '273', '285'];
    mlImages.slice(0, 3).forEach((img, idx) => {
      if (img.path) {
        nodeList.push({
          nodeId: imageNodeIds[idx],
          fieldName: 'image',
          fieldValue: img.path,
          description: `参考图${idx + 1}`
        });
      }
    });

    return nodeList;
  };

  const [mlSubmitting, setMlSubmitting] = useState(false);

  const handleSubmit = () => {
    if (mlImages.length === 0 || !mlImages[0]?.path) {
      onError('请至少上传一张参考图');
      return;
    }
    if (mlSubmitting) return;
    setMlSubmitting(true);
    setIsSubmitting(true);

    const nodeList = buildNodeList();
    const preview = mlImages[0]?.preview || '';
    const combinedPrompt = mlPrompts.filter(Boolean).join(' | ');

    taskListRef.current?.submitTask(combinedPrompt, mlImages[0]?.path || '', preview, nodeList, WORKFLOW.MINIMAX_LONG);
    onSuccess('任务已提交');
    setMlSubmitting(false);
    setIsSubmitting(false);
  };

  const updatePrompt = (index: number, value: string) => {
    const newPrompts = [...mlPrompts];
    newPrompts[index] = value;
    setMlPrompts(newPrompts);
  };

  return (
    <div className="space-y-4">
      {/* GirlfriendSelector - 数字人锚定 */}
      <GirlfriendSelector
        selectedId={selectedGirlfriend ? (selectedGirlfriend.isCustom ? `custom_${selectedGirlfriend.id}` : selectedGirlfriend.id) : null}
        onSelect={handleGirlfriendSelect}
        disabled={girlfriendUploading || isSubmitting}
      />

      {/* PosePresetSelector - 视频姿势预设 */}
      <PosePresetSelector
        type="video"
        onSelect={handlePoseSelect}
        disabled={isSubmitting}
        selectedGirlfriend={selectedGirlfriend}
      />

      {/* 参考图上传 - 支持最多9张 */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
            <ImageIcon size={16} className="text-cyan-500" />
            参考图（最多9张）
            {selectedGirlfriend && (
              <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 text-[10px] font-medium">
                AI 女友模式
              </span>
            )}
          </h3>
          <span className="text-xs text-text-tertiary">
            {mlImages.filter(img => img.path).length}/9
          </span>
        </div>

        <div className="grid grid-cols-5 gap-2">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(idx => (
            <div key={idx} className="relative">
              {mlImages[idx]?.preview ? (
                <div className="relative aspect-square rounded-xl overflow-hidden border-2 border-cyan-200 bg-bg-elevated">
                  <img
                    src={mlImages[idx].preview}
                    alt={`参考图${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => handleImageRemove(idx)}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                    disabled={isSubmitting}
                  >
                    <X size={12} />
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1">
                    <span className="text-[10px] text-white/90">参考图 {idx + 1}</span>
                  </div>
                </div>
              ) : (
                <label className="relative flex flex-col items-center justify-center aspect-square rounded-xl border-2 border-dashed border-border hover:border-cyan-400 bg-bg-elevated cursor-pointer transition-colors">
                  {mlUploading ? (
                    <Loader2 size={20} className="text-cyan-400 animate-spin" />
                  ) : (
                    <>
                      <ImageIcon size={20} className="text-text-tertiary" />
                      <span className="text-[10px] text-text-tertiary mt-1">上传</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImageUpload(file, idx);
                    }}
                    disabled={isSubmitting || mlUploading}
                  />
                </label>
              )}
            </div>
          ))}
        </div>

        <p className="text-[11px] text-text-tertiary mt-2">
          第一张图将作为视频首帧，后续图片作为动作参考
        </p>
      </div>

      {/* 3段提示词 */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-text-primary">提示词（3段）</h3>
          {/* 自动提示词开关 */}
          <button
            onClick={() => setMlAutoPrompt(!mlAutoPrompt)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              mlAutoPrompt ? 'bg-green-500/20 text-green-600 border border-green-300' : 'bg-bg-elevated text-text-tertiary'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${mlAutoPrompt ? 'bg-green-500' : 'bg-text-tertiary'}`} />
            自动提示词 {mlAutoPrompt ? '开启' : '关闭'}
          </button>
        </div>
        {/* 模版预设 */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-text-tertiary flex-shrink-0">模版：</span>
          <div className="flex flex-wrap gap-1.5">
            {H3_VIDEO_TEMPLATES.map((tpl) => (
              <button
                key={tpl.name}
                onClick={() => handleTemplateApply(tpl)}
                className={`px-3 py-1 rounded-lg text-xs font-medium bg-gradient-to-r ${tpl.color} text-white hover:opacity-90 transition-opacity`}
                disabled={isSubmitting}
              >
                {tpl.name}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          {[0, 1, 2].map(idx => (
            <div key={idx}>
              <label className="text-xs text-text-secondary mb-1 block">提示词 {idx + 1}</label>
              <div className="relative">
                <textarea
                  value={mlPrompts[idx]}
                  onChange={(e) => updatePrompt(idx, e.target.value)}
                  placeholder={mlAutoPrompt ? '开启自动提示词，可不填或填写简单描述' : `描述第${idx + 1}段视频的动作、表情、场景变化...`}
                  rows={3}
                  className="w-full px-3 py-2 pr-9 rounded-lg bg-bg-elevated border border-border text-sm text-text-primary placeholder-slate-500 focus:outline-none focus:border-cyan-400/50 resize-none"
                  disabled={isSubmitting}
                />
                {mlPrompts[idx] && (
                  <button
                    type="button"
                    onClick={() => updatePrompt(idx, '')}
                    disabled={isSubmitting}
                    className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full bg-bg-surface border border-border text-text-tertiary hover:text-red-500 hover:border-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                    title="清除提示词"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {selectedGirlfriend && (
          <div className="mt-2 px-2 py-1 rounded bg-red-50 border border-red-200 text-[10px] text-red-600">
            已锚定数字人：{selectedGirlfriend.nameZh || selectedGirlfriend.name}
          </div>
        )}

        {/* MiniMax H3 提示词引擎 */}
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-indigo-600 flex items-center gap-1">
              <Sparkles size={12} />
              MiniMax H3 提示词引擎
            </span>
          </div>
          {/* 时长选择 */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] text-text-tertiary">视频时长：</span>
            {([15, 30, 60] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setMlH3Duration?.(d)}
                className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  mlH3Duration === d ? 'bg-indigo-500 text-white' : 'bg-bg-elevated text-text-secondary hover:bg-indigo-100'
                }`}
              >
                {d}秒
              </button>
            ))}
          </div>
          {/* 操作按钮行 */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleGenerateH3Prompt?.()}
              disabled={isSubmitting || !mlPrompts.some((p) => p.trim())}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-500 text-white hover:bg-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Sparkles size={12} />
              生成H3视频提示词
            </button>
            {mlH3Prompt && (
              <button
                type="button"
                onClick={handleGotoLongVideoWithH3}
                disabled={isSubmitting}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:opacity-90 transition-colors disabled:opacity-50"
              >
                <Video size={12} />
                图生视频 → 长视频1.1
              </button>
            )}
          </div>
          {/* H3 提示词预览 */}
          {mlH3Prompt && (
            <div className="mt-2">
              <textarea
                value={mlH3Prompt}
                onChange={(e) => setMlH3Prompt?.(e.target.value)}
                rows={6}
                className="w-full px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-200 text-[11px] text-indigo-800 font-mono focus:outline-none focus:border-indigo-400 resize-none"
                placeholder="生成的 H3 视频提示词..."
              />
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-indigo-400">H3 Ref2VA 六段式提示词（可编辑）</span>
                <button
                  type="button"
                  onClick={() => { navigator.clipboard?.writeText(mlH3Prompt); onSuccess('已复制到剪贴板'); }}
                  className="text-[10px] text-indigo-500 hover:text-indigo-700 flex items-center gap-0.5"
                >
                  <Copy size={10} /> 复制
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 视频模型配置 */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <h3 className="text-sm font-medium text-text-primary mb-3">视频模型配置</h3>
        <RunningHubModelPicker
          label="视频模型"
          kind="checkpoint"
          value={mlVideoModel}
          onChange={(name) => setMlVideoModel(name || '')}
          placeholder="不使用"
          disabled={isSubmitting}
          baseModelFilter="minimax-h3"
        />
      </div>

      {/* 单段时长设置 */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <h3 className="text-sm font-medium text-text-primary mb-3">单段时长</h3>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={5}
            max={30}
            step={1}
            value={mlDuration}
            onChange={(e) => setMlDuration(Number(e.target.value))}
            disabled={isSubmitting}
            className="flex-1 h-2 rounded-lg appearance-none bg-gray-200 cursor-pointer accent-cyan-500 disabled:opacity-50"
          />
          <div className="flex items-center gap-1 w-20">
            <input
              type="number"
              min={5}
              max={30}
              value={mlDuration}
              onChange={(e) => setMlDuration(Math.max(5, Math.min(30, Number(e.target.value))))}
              disabled={isSubmitting}
              className="w-14 px-2 py-1 rounded-lg border border-border bg-bg-elevated text-sm text-text-primary text-center focus:outline-none focus:border-cyan-400 disabled:opacity-50"
            />
            <span className="text-xs text-text-tertiary">秒</span>
          </div>
        </div>
        <p className="text-[10px] text-text-tertiary mt-1.5">设置每个分段的视频时长（5-30秒），影响生成视频的总长度</p>

        {/* ZIP直出开关 */}
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={() => setMlDirectOutput(!mlDirectOutput)}
            className={`w-10 h-5 rounded-full transition-colors relative ${mlDirectOutput ? 'bg-cyan-500' : 'bg-text-tertiary'}`}
            disabled={isSubmitting}
          >
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${mlDirectOutput ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
          <span className="text-xs text-text-secondary">
            直出模式 {mlDirectOutput ? '（直出视频）' : '（ZIP格式，默认关闭）'}
          </span>
        </div>
      </div>

      {/* LoRA配置 */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <h3 className="text-sm font-medium text-text-primary mb-3">LoRA配置</h3>
        <div className="space-y-3">
          <RunningHubModelPicker
            label="LoRA模型"
            kind="lora"
            loraSlot="lora2"
            value={mlLora}
            onChange={(name) => setMlLora(name || '')}
            placeholder="不使用"
            disabled={isSubmitting}
            baseModelFilter="minimax-h3"
          />
          <ParameterSlider
            label="LoRA权重"
            value={mlLoraWeight}
            min={0.1}
            max={1}
            step={0.1}
            onChange={setMlLoraWeight}
            disabled={isSubmitting}
          />
        </div>
      </div>

      {/* 生成按钮 */}
      <div className="pt-2 pb-4">
        <GenerateButton
          onClick={handleSubmit}
          isLoading={isSubmitting}
          disabled={!mlImages[0]?.path || isSubmitting || mlUploading}
          label={mlUploading ? '上传中...' : isSubmitting ? '提交中...' : '生成视频'}
        />
      </div>
    </div>
  );
}

// ─── MiniMax H3 视频模板（文生视频 / 图生视频 / 图生长视频 通用） ─────────────────────────

export const H3_VIDEO_TEMPLATES = [
  {
    name: '指挥舞蹈',
    color: 'from-amber-500 to-orange-500',
    prompt: `subject_definitions:

<Subject 1>是一位年轻东亚女性，精致五官，清冷气质，黑色长直发，身穿修身吊带连衣裙，在视频中展现自信妩媚的神态与舞蹈动作。

<Subject 2>是位于画面前景右下角的手指控制器，作为发出指令的视觉主体，其动作遵循固定的屏幕坐标映射逻辑。

summary:

目标视频展示<Subject 1>在卧室环境中根据<Subject 2>的四向指令进行舞蹈。视频采用稳定的单镜头构图，通过手指的上下左右移动驱动女性同拍做出升降重心或全身横移的响应动作，并在验证轴向规则后以一次短促的收尾动作结束。

detailed_description:

视频采用写实电影风格，卧室环境光线柔和且带有暖色调，营造出私密而暧昧的氛围。

[Shot 1] 画面中景呈现<Subject 1>，她身穿修身吊带连衣裙，神情妩媚地注视镜头。前景右下角的<Subject 2>手指清晰可见，确立了同框且可读的空间关系。

[Shot 2] At 00:01.500，<Subject 2>向上方移动发出指令，<Subject 1>在同一节拍内迅速抬高身体重心，挺胸并微微仰头，展现出明显的纵向位移。

[Shot 3] At 00:03.000，<Subject 2>向下方移动，<Subject 1>随即压低重心，腰部下沉并向一侧轻微扭转，完成"下"的映射。

[Shot 4] At 00:05.000，<Subject 2>向左平移，<Subject 1>进行全身性的向左横移，保持姿态连贯。

[Shot 5] At 00:07.000，<Subject 2>向右平移，<Subject 1>跟随指令向右侧整体位移，与上一动作形成对称验证。

[Shot 6] At 00:09.000，<Subject 2>再次向上方移动，<Subject 1>重复抬升重心的动作，进一步确认纵向轴的映射规则。

[Shot 7] At 00:11.000，<Subject 2>向下方移动，<Subject 1>完成最后一次重心下沉，确保纵横轴均已得到重复验证。

[Shot 8] At 00:13.000，<Subject 2>快速点动一次作为收尾信号，<Subject 1>配合做一个短促的甩发与定格动作，表情保持妩媚。

overall_soundscape:

室内环境背景音轻微，伴随着女性衣物摩擦的细微声响和节奏感极强的节拍器音效，每个指令发出时伴有清脆的提示音。

non_diegetic_music:

一段节奏明快、带有电子合成器元素的舞曲，BPM约为120，低音贝斯贯穿始终，在动作切换点有明显的重音强调。`,
  },
  {
    name: '时间停止',
    color: 'from-violet-500 to-purple-600',
    prompt: `subject_definitions:

<Picture 1>是视频主角的参考图，由用户上传，图中女性将作为目标视频的核心角色出现。

summary:

目标视频展示<Picture 1>中的女性角色在时间停止效果触发后，完全陷入静止状态，一名男性趁机对她实施不可描述行为。视频采用写实电影风格，第一人称视角，镜头稳定略带手持轻微晃动。

retention_analysis:

<Picture 1>中的女性在所有镜头中 fully_preserved（面部 / 发型 / 妆容 / 身材比例 / 服装完全保留）。

detailed_description:

[Shot 1] 00:00.000，实拍电影风格，第一人称视角，中景镜头完整呈现<Picture 1>中的女性角色正面朝向镜头站立于画面中央，完整保留其面部特征、发型、妆容、身材比例及上身完整服装。她的左手抬起放在脸侧，手指比出和平手势指向镜头。镜头稳定拍摄，略带轻微手持晃动。At 00:02.000，一只男性手从画面右侧进入帧中手持一枚怀表，怀表顶部表面有可见按钮。食指向下按动按钮，动作清晰、机械感十足。随即触发时间停止视觉效果：强烈的菱形光线折射在画面中爆发，图像短暂扭曲变形，整个场景冻结，时间完全停止。

[Shot 2] At 00:02.500，镜头切至同一第一人称视角构图。<Picture 1>中的女性现已完全冻结僵硬——她的身体笔直僵硬，比出和平手势的手锁定原位，眼睛空洞无神无聚焦，没有眨眼和任何眼球运动，身体各部分完全静止。两只手进入画面用力撕开她的上身服装，从领口或中心接缝处撕裂布料，露出大尺寸裸露乳房。撕裂过程中，女性的身体、和平手势和眼睛保持完全冻结静止。

[Shot 3] At 00:05.000，镜头小幅向下倾斜缓慢移动拍摄她的下半身。两只手用力撕开她的裙子或裤子，从中间撕裂布料露出私处。一只手揉捏挤压她的大腿内侧和外侧。镜头随后小幅拉远缓慢移动拍摄她的全身。

[Shot 4] At 00:07.000，镜头切至更近的中景。<Picture 1>中的女性保持完全冻结静止，两只手用力揉捏和挤压她裸露的乳房，动作清晰、刻意、强劲。一只手向上移动抓住她的下巴或脸颊。<Picture 1>中的女性保持和平手势无任何变化，眼睛保持空洞完全无眨眼，眼球不动，全身保持绝对冻结静止直到视频结束。At no point does the woman blink, move her eyes, shift any body part, change her peace-sign gesture, or react in any way after the time-stop effect. No man's face, subtitles, watermarks, or additional characters appear. The background remains unchanged throughout the video. The clothes are fully intact before being torn.

[Shot 5] At 00:10.000，阴茎从后方拔出，浓稠白色精液喷射在她的脸上、脸颊、嘴唇和张开的嘴中，分多次喷出（颜射）。视频以颜射后的冷冻面部定格结束。

overall_soundscape:

清脆响亮的机械咔哒声在怀表按钮按下的瞬间发出，紧接着是短暂的时间停止音效，模拟时钟齿轮快速旋转的声音。效果消退后，响亮的暴力撕裂布料声主导音景，伴随着轻微潮湿的肉体被揉捏挤压的声音。视频结束时大量精液喷出的潮湿喷射声。没有女性发出的任何声音、呼吸声或任何其他声音。

non_diegetic_music: N/A`,
  },
  {
    name: '远程换装',
    color: 'from-pink-500 to-rose-500',
    prompt: `subject_definitions:

<Picture 1>是视频主角的参考图，由用户上传，图中女性将作为目标视频的核心角色出现。

summary:

目标视频展示<Picture 1>中的女性角色在试衣间镜子前持续展示服装，一名男性手持手机通过按钮切换服装，最终触发时间停止并实施不可描述行为。视频采用写实电影风格，第一人称视角，镜头稳定略带手持轻微晃动。

retention_analysis:

<Picture 1>中的女性在所有镜头中 fully_preserved（面部 / 发型 / 妆容 / 身材比例 / 原始服装完全保留）。

detailed_description:

[Shot 1] 00:00.000，实拍电影风格，明亮干净的试衣间配全身镜，中景镜头呈现<Picture 1>中的女性站立于镜子前，完整保留其面部特征、发型、妆容、身材比例及完整原始服装。她已经持续扭动身体、左右旋转、小幅旋转展示服装和身材，表情骄傲俏皮。镜头稳定中景拍摄，略带轻微手持晃动。At 00:03.000，一只男性手从画面底部以第一人称视角进入帧中手持智能手机。手机屏幕清晰显示一个无面白色全身人体模型穿着时尚短外套和迷你裙，下方有亮红色按钮。食指按下红色按钮。瞬间，零延迟，女性的服装切换为完全相同的短外套和迷你裙。她实时惊讶地向下看，然后继续愉快地扭动和旋转。

[Shot 2] At 00:05.000，手向左滑动；人体模型现在穿着紧身露背迷你裙。红色按钮再次按下。瞬间她的服装变为同一款连衣裙。她惊喜地睁大眼睛，继续更夸张地旋转。

[Shot 3] At 00:08.000，再次滑动显示白色蕾丝比基尼。按钮按下。瞬间她穿着白色蕾丝比基尼。她僵住0.5-1秒，眼睛因真实震惊和尴尬而睁大，双手遮住胸部，身体变得僵硬和拘束。

[Shot 4] At 00:10.000，最后一次滑动显示完全赤裸的空白人体模型。按钮按下。瞬间她所有衣服消失，完全赤裸露出大尺寸裸露乳房和暴露的私处。同时触发怀表时间停止效果：菱形光线折射闪烁，场景冻结。<Picture 1>中的女性完全僵硬冻结，眼睛空洞无眨眼，如果存在之前的和平手势也锁定原位。两只手撕裂任何剩余布料（如需要），然后抓住她的臀部，以站立狗式姿势用力节奏抽插。一只手绕过身体粗略地揉捏和挤压她的乳房。

[Shot 5] At 00:14.000，在她保持绝对冻结静止的同时，阴茎拔出。浓稠白色精液喷射在她的脸上、脸颊、嘴唇和张开的嘴中，分多次喷出（颜射）。视频以颜射后的冷冻面部定格结束。At no point after the time-stop does the woman blink, move her eyes, shift any body part, or react. No man's face, subtitles, watermarks, or additional characters appear. Background unchanged. Clothes fully intact before each switch.

overall_soundscape:

开始时轻柔的布料摩擦声和她旋转时的轻快脚步声。每次按下按钮时清脆的按钮点击声。短暂的时钟齿轮时间停止音效。然后是响亮的潮湿冲击声和肉体撞击声。最后是大量颜射的潮湿喷射声。时间停止后没有女性发出的任何声音或呼吸声。

non_diegetic_music: N/A`,
  },
];

const MH3_ASPECT_RATIOS = [
  { value: '1:1 (Square)', label: '1:1', sub: '方形' },
  { value: '2:3 (Portrait Photo)', label: '2:3', sub: '竖向照片' },
  { value: '3:2 (Photo)', label: '3:2', sub: '横向照片' },
  { value: '3:4 (Portrait Standard)', label: '3:4', sub: '竖向标准' },
  { value: '4:3 (Standard)', label: '4:3', sub: '标准' },
  { value: '9:16 (Portrait Widescreen)', label: '9:16', sub: '竖屏宽银幕' },
  { value: '16:9 (Widescreen)', label: '16:9', sub: '宽银幕' },
  { value: '21:9 (Ultrawide)', label: '21:9', sub: '超宽银幕' },
];

interface MiniMaxH3T2VPanelProps {
  apiKey: string;
  mh3Prompt: string;
  setMh3Prompt: (v: string) => void;
  mh3AutoPrompt: boolean;
  setMh3AutoPrompt: (v: boolean) => void;
  mh3DirectOutput: boolean;
  setMh3DirectOutput: (v: boolean) => void;
  mh3Duration: number;
  setMh3Duration: (v: number) => void;
  mh3AspectRatio: string;
  setMh3AspectRatio: (v: string) => void;
  mh3Submitting: boolean;
  setMh3Submitting: (v: boolean) => void;
  isSubmitting: boolean;
  setIsSubmitting: (v: boolean) => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  taskListRef: React.RefObject<{ submitTask: (prompt: string, imagePath: string, imagePreview: string, nodeInfoList: NodeInfo[], workflowId?: string) => void } | null>;
}

function MiniMaxH3T2VPanel({
  apiKey, mh3Prompt, setMh3Prompt,
  mh3AutoPrompt, setMh3AutoPrompt,
  mh3DirectOutput, setMh3DirectOutput,
  mh3Duration, setMh3Duration,
  mh3AspectRatio, setMh3AspectRatio,
  mh3Submitting, setMh3Submitting,
  isSubmitting, setIsSubmitting,
  onError, onSuccess, taskListRef,
}: MiniMaxH3T2VPanelProps) {

  const buildNodeList = (): NodeInfo[] => {
    const nodeList: NodeInfo[] = [
      { nodeId: '171', fieldName: 'index', fieldValue: '0', description: '序号' },
      { nodeId: '115', fieldName: 'aspect_ratio', fieldValue: mh3AspectRatio, description: '视频比例' },
      { nodeId: '133', fieldName: 'value', fieldValue: String(mh3Duration), description: '时长' },
      { nodeId: '186', fieldName: 'text', fieldValue: mh3Prompt, description: '提示词' },
    ];
    // 直出模式 (true=MP4直出, false=ZIP)
    nodeList.push({
      nodeId: '171',
      fieldName: 'direct_output',
      fieldValue: String(mh3DirectOutput),
      description: '直出模式'
    });
    return nodeList;
  };

  const handleSubmit = () => {
    if (!mh3Prompt.trim()) {
      onError('请输入提示词');
      return;
    }
    if (mh3Submitting) return;
    setMh3Submitting(true);
    setIsSubmitting(true);

    const nodeList = buildNodeList();
    taskListRef.current?.submitTask(mh3Prompt, '', '', nodeList, WORKFLOW.MINIMAX_H3_T2V);
    onSuccess('任务已提交');
    setMh3Submitting(false);
    setIsSubmitting(false);
  };

  const handleTemplateApply = (template: typeof H3_VIDEO_TEMPLATES[0]) => {
    setMh3Prompt(template.prompt);
    onSuccess(`已应用模板：${template.name}`);
  };

  return (
    <div className="space-y-4">
      {/* 提示词 */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-text-primary">提示词</h3>
          <div className="flex items-center gap-2">
            {/* 自动优化提示词开关 — 默认开启 */}
            <button
              onClick={() => setMh3AutoPrompt(!mh3AutoPrompt)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                mh3AutoPrompt ? 'bg-green-500/20 text-green-600 border border-green-300' : 'bg-bg-elevated text-text-tertiary'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${mh3AutoPrompt ? 'bg-green-500' : 'bg-text-tertiary'}`} />
              自动优化提示词 {mh3AutoPrompt ? '开' : '关'}
            </button>
            {/* 直出模式开关 — 默认关闭（ZIP） */}
            <button
              onClick={() => setMh3DirectOutput(!mh3DirectOutput)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                mh3DirectOutput ? 'bg-blue-500/20 text-blue-600 border border-blue-300' : 'bg-bg-elevated text-text-tertiary'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${mh3DirectOutput ? 'bg-blue-500' : 'bg-text-tertiary'}`} />
              直出模式 {mh3DirectOutput ? '开' : '关'}
            </button>
          </div>
        </div>

        {/* 模版预设 */}
        {H3_VIDEO_TEMPLATES.length > 0 && (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-text-tertiary flex-shrink-0">模版：</span>
            <div className="flex flex-wrap gap-1.5">
              {H3_VIDEO_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.name}
                  onClick={() => handleTemplateApply(tpl)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium bg-gradient-to-r ${tpl.color} text-white hover:opacity-90 transition-opacity`}
                  disabled={isSubmitting}
                >
                  {tpl.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="relative">
          <textarea
            value={mh3Prompt}
            onChange={(e) => setMh3Prompt(e.target.value)}
            placeholder={mh3AutoPrompt ? '开启自动优化提示词，可不填或填写简单描述' : '描述视频中的人物动作、表情、场景变化...'}
            rows={4}
            className="w-full px-3 py-2 pr-9 rounded-lg bg-bg-elevated border border-border text-sm text-text-primary placeholder-slate-500 focus:outline-none focus:border-blue-400/50 resize-none"
            disabled={isSubmitting}
          />
          {mh3Prompt && (
            <button
              type="button"
              onClick={() => setMh3Prompt('')}
              disabled={isSubmitting}
              className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full bg-bg-surface border border-border text-text-tertiary hover:text-red-500 hover:border-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-50"
              title="清除提示词"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* 时长 */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <h3 className="text-sm font-medium text-text-primary mb-3">时长</h3>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={5}
            max={15}
            value={mh3Duration}
            onChange={(e) => setMh3Duration(Number(e.target.value))}
            className="flex-1 h-2 bg-bg-elevated rounded-full appearance-none cursor-pointer accent-blue-500"
            disabled={isSubmitting}
          />
          <span className="w-12 text-center text-sm font-medium text-text-primary">{mh3Duration}秒</span>
        </div>
        <p className="text-[10px] text-text-tertiary mt-1.5">设置视频生成时长（5-15秒）</p>
      </div>

      {/* 视频比例 */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <h3 className="text-sm font-medium text-text-primary mb-3">视频比例</h3>
        <div className="grid grid-cols-4 gap-2">
          {MH3_ASPECT_RATIOS.map((ar) => {
            const isSelected = mh3AspectRatio === ar.value;
            return (
              <button
                key={ar.value}
                onClick={() => setMh3AspectRatio(ar.value)}
                className={`flex flex-col items-center justify-center py-2.5 rounded-xl border text-xs transition-all ${
                  isSelected
                    ? 'border-blue-400 bg-blue-50 text-blue-600'
                    : 'border-border bg-bg-elevated text-text-secondary hover:border-blue-300 hover:bg-blue-50/30'
                }`}
                disabled={isSubmitting}
              >
                <span className="text-sm font-semibold">{ar.label}</span>
                <span className="text-[10px] opacity-70">{ar.sub}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 生成按钮 */}
      <div className="pt-2 pb-4">
        <GenerateButton
          onClick={handleSubmit}
          isLoading={isSubmitting}
          disabled={!mh3Prompt.trim() || isSubmitting || mh3Submitting}
          label={isSubmitting ? '提交中...' : '生成视频'}
        />
      </div>
    </div>
  );
}

// ─── 主页面 ────────────────────────────────────────────────────────────────

type VideoModel = 'wan22' | 'minimaxh3' | 'minimaxlong' | 'minimaxh3t2v' | 'longvideov2';

export function ImageToVideoPage({ apiKey, onError, onSuccess }: ImageToVideoPageProps) {
  // Model selector
  const [videoModel, setVideoModel] = useState<VideoModel>('minimaxh3');

  // 长视频 v1.1 初始参考图（从历史记录跳转时设置，由 NinfiniteLongVideoPage 一次性消费）
  const [nlInitialImage, setNlInitialImage] = useState<{ path: string; preview: string } | null>(null);
  // 长视频 v1.1 初始提示词（来自 H3 提示词引擎）
  const [nlInitialPrompt, setNlInitialPrompt] = useState<string | null>(null);

  // Wan 2.2 state
  const [imagePath, setImagePath] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState('5');
  const [resolution, setResolution] = useState('720');
  const [interpolation, setInterpolation] = useState(false);
  const [loraHigh, setLoraHigh] = useState('SmoothMixAnimationStyle_High.safetensors');
  const [loraHighWeight, setLoraHighWeight] = useState(1.0);
  const [loraLow, setLoraLow] = useState('SmoothMixAnimation_Low.safetensors');
  const [loraLowWeight, setLoraLowWeight] = useState(1.0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReuploading, setIsReuploading] = useState(false);
  // Spinner state for the 视频参数 → 提示词 textarea "智能扩写" button.
  const [isExpandingPrompt, setIsExpandingPrompt] = useState(false);

  // MiniMax H3 state
  const [mmImages, setMmImages] = useState<{ path: string; preview: string }[]>([
    { path: '', preview: '' },
    { path: '', preview: '' },
    { path: '', preview: '' },
    { path: '', preview: '' },
    { path: '', preview: '' },
    { path: '', preview: '' },
    { path: '', preview: '' },
    { path: '', preview: '' },
    { path: '', preview: '' },
  ]);
  const [mmPrompt, setMmPrompt] = useState('');
  const [mmDuration, setMmDuration] = useState('15');
  const [mmStrength, setMmStrength] = useState(0.6);
  const [mmStyleMode, setMmStyleMode] = useState('1');
  const [mmAutoPrompt, setMmAutoPrompt] = useState(true); // true = 开启自动提示词
  const [mmDirectOutput, setMmDirectOutput] = useState(false); // false = ZIP 格式（直出模式默认关闭）
  const [mmVideoModel, setMmVideoModel] = useState('DasiwaMinimaxH3_dasiwaREF2VAHybridV1.safetensors');
  const [mmLora, setMmLora] = useState('MysticXXX_MMH3-V1.safetensors');
  const [mmLoraWeight, setMmLoraWeight] = useState(0.4);
  const [mmUploading, setMmUploading] = useState(false);

  // MiniMax Long Video state
  const [mlImages, setMlImages] = useState<{ path: string; preview: string }[]>([
    { path: '', preview: '' },
    { path: '', preview: '' },
    { path: '', preview: '' },
    { path: '', preview: '' },
    { path: '', preview: '' },
    { path: '', preview: '' },
    { path: '', preview: '' },
    { path: '', preview: '' },
    { path: '', preview: '' },
  ]);
  const [mlPrompts, setMlPrompts] = useState<string[]>(['', '', '']);
  const [mlDuration, setMlDuration] = useState(10);
  const [mlAutoPrompt, setMlAutoPrompt] = useState(false); // false = 关闭自动提示词
  const [mlDirectOutput, setMlDirectOutput] = useState(false); // false = ZIP 格式（直出模式默认关闭）
  const [mlVideoModel, setMlVideoModel] = useState('');
  const [mlLora, setMlLora] = useState('');
  const [mlLoraWeight, setMlLoraWeight] = useState(0.4);
  const [mlUploading, setMlUploading] = useState(false);
  const [mlSelectedGirlfriend, setMlSelectedGirlfriend] = useState<GirlfriendPreset | null>(null);
  const [mlGirlfriendUploading, setMlGirlfriendUploading] = useState(false);

  // MiniMax H3 提示词引擎状态（截图2 图生视频区域）
  const [mlH3Prompt, setMlH3Prompt] = useState('');        // 生成的 H3 提示词
  const [mlH3Duration, setMlH3Duration] = useState<15 | 30 | 60>(15); // H3 视频时长选项

  // ── MiniMax H3 提示词引擎 ─────────────────────────────────────────────────
  const handleGenerateH3Prompt = useCallback((duration: 15 | 30 | 60 = mlH3Duration) => {
    const basePrompt = mlPrompts.filter(Boolean).join(' ');
    if (!basePrompt.trim()) return;
    const h3Prompt = generateH3Prompt({
      imagePrompt: basePrompt,
      duration,
      r18: true,
    });
    setMlH3Prompt(h3Prompt);
    setMlH3Duration(duration);
  }, [mlPrompts, mlH3Duration]);

  // ── 跳转到长视频 1.1 并填入 H3 提示词 ────────────────────────────────────
  const handleGotoLongVideoWithH3 = useCallback(async () => {
    const h3Prompt = mlH3Prompt || generateH3Prompt({
      imagePrompt: mlPrompts.filter(Boolean).join(' '),
      duration: mlH3Duration,
      r18: true,
    });
    const firstImage = mlImages.find((img) => img.path && img.path !== 'None') ?? mlImages[0];
    if (firstImage?.path && firstImage.path !== 'None') {
      setNlInitialImage({ path: firstImage.path, preview: firstImage.preview });
    }
    setNlInitialPrompt(h3Prompt);
    setVideoModel('longvideov2');
    onSuccess('已切换到长视频 1.1，H3 提示词已填入');
  }, [mlH3Prompt, mlH3Duration, mlPrompts, mlImages, onSuccess]);

  // MiniMax H3 T2V state
  const [mh3Prompt, setMh3Prompt] = useState('');
  const [mh3AutoPrompt, setMh3AutoPrompt] = useState(true); // true = 开启自动优化提示词
  const [mh3DirectOutput, setMh3DirectOutput] = useState(false); // false = ZIP 格式（直出模式默认关闭）
  const [mh3Duration, setMh3Duration] = useState(12);
  const [mh3AspectRatio, setMh3AspectRatio] = useState('9:16 (Portrait Widescreen)');
  const [mh3Submitting, setMh3Submitting] = useState(false);

  const [selectedGirlfriend, setSelectedGirlfriend] = useState<GirlfriendPreset | null>(null);
  const [girlfriendUploading, setGirlfriendUploading] = useState(false);

  // Script import state
  const [parsedScriptPanels, setParsedScriptPanels] = useState<ParsedScriptPanel[]>([]);
  const [scriptInputText, setScriptInputText] = useState('');
  const [scriptInputOpen, setScriptInputOpen] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Check for storyboard image2video data on mount
  useEffect(() => {
    // 定义异步处理函数
    const processStoryboardData = async () => {
      // Try new direct format first (auto-generate)
      const directData = sessionStorage.getItem('storyboard_img2vid_direct');
      // Try old format (navigate only)
      const oldData = sessionStorage.getItem('storyboard_img2vid');
      // 历史记录 → 图生视频：只预填图片，不自动生成
      const historyData = sessionStorage.getItem('history_img2vid');
      // H3 提示词引擎 → 长视频 1.1：预填图片和 H3 提示词
      const h3LongVideoData = sessionStorage.getItem('storyboard_h3_longvideo');
      // 随机抽卡 → 长视频 1.1：预填图片和提示词（如果有的话）
      const randomLongVideoData = sessionStorage.getItem('random_longvideo_v1_1');

      // Clear storage BEFORE processing to prevent duplicate submissions
      if (directData) {
        sessionStorage.removeItem('storyboard_img2vid_direct');
      }
      if (oldData) {
        sessionStorage.removeItem('storyboard_img2vid');
      }
      if (historyData) {
        sessionStorage.removeItem('history_img2vid');
      }
      if (h3LongVideoData) {
        sessionStorage.removeItem('storyboard_h3_longvideo');
        try {
          const { imagePath: h3ImgPath, imagePreview: h3ImgPreview, h3Prompt: h3PromptText } = JSON.parse(h3LongVideoData);
          // 切换到长视频 1.1 模型
          setVideoModel('longvideov2');
          // 设置参考图
          if (h3ImgPath) {
            setNlInitialImage({ path: h3ImgPath, preview: h3ImgPreview || h3ImgPath });
          }
          // 设置 H3 提示词
          if (h3PromptText) {
            setMlH3Prompt(h3PromptText);
          }
          onSuccess?.('已从剧情分镜导入图片和 H3 提示词到长视频 1.1');
        } catch (err) {
          console.warn('[ImageToVideoPage] Failed to process storyboard_h3_longvideo:', err);
        }
      }
      // 处理随机抽卡 → 长视频 1.1 数据
      if (randomLongVideoData) {
        sessionStorage.removeItem('random_longvideo_v1_1');
        try {
          const { imageUrl, h3Prompt: randomH3Prompt, prompt: randomPrompt } = JSON.parse(randomLongVideoData);
          // 切换到长视频 1.1 模型
          setVideoModel('longvideov2');
          
          // 处理图片
          let finalImagePath = imageUrl || '';
          let finalImagePreview = imageUrl || '';
          
          // Upload image if it's a data URL or blob
          if (imageUrl && (imageUrl.startsWith('data:') || imageUrl.startsWith('blob:'))) {
            try {
              const res = await fetch(imageUrl);
              const blob = await res.blob();
              const file = new File([blob], `random_${Date.now()}.jpg`, { type: 'image/jpeg' });
              const uploadResult = await uploadImage(apiKey, file);
              finalImagePath = uploadResult.imagePath;
              finalImagePreview = imageUrl;
            } catch (uploadErr) {
              console.warn('[ImageToVideoPage] Failed to upload random image:', uploadErr);
            }
          }
          
          // 设置参考图
          if (finalImagePath) {
            setNlInitialImage({ path: finalImagePath, preview: finalImagePreview });
          }
          
          // 设置提示词：如果有 H3 提示词则用 nlInitialPrompt，否则用普通提示词
          if (randomH3Prompt) {
            setNlInitialPrompt(randomH3Prompt);
          } else if (randomPrompt) {
            setNlInitialPrompt(randomPrompt);
          }
          
          onSuccess?.('已从随机抽卡导入图片和提示词到长视频 1.1');
        } catch (err) {
          console.warn('[ImageToVideoPage] Failed to process random_longvideo_v1_1:', err);
        }
      }

      const processData = async (data: string, autoGenerate: boolean) => {
        try {
          const { imageUrl, imagePath: uploadedPath, prompt: videoPrompt, targetModel } = JSON.parse(data);
          let finalImagePath = uploadedPath || '';
          let finalImagePreview = imageUrl;

          // Upload image if it's a data URL or blob
          if (imageUrl && (imageUrl.startsWith('data:') || imageUrl.startsWith('blob:'))) {
            try {
              const res = await fetch(imageUrl);
              const blob = await res.blob();
              const file = new File([blob], `storyboard_${Date.now()}.jpg`, { type: 'image/jpeg' });
              const uploadResult = await uploadImage(apiKey, file);
              finalImagePath = uploadResult.imagePath;
              finalImagePreview = imageUrl;
            } catch {
              // If upload fails, we'll show error below
            }
          } else if (imageUrl) {
            finalImagePath = imageUrl;
            finalImagePreview = imageUrl;
          }

          if (!finalImagePath) {
            onError?.('图片上传失败，请重试');
            return;
          }

          // 根据 targetModel 自动切换到对应的视频模型
          if (targetModel === 'longvideov2') {
            // 切换到 长视频 v1.1 模型，并写入 slot 0
            setVideoModel('longvideov2');
            setNlInitialImage({ path: finalImagePath, preview: finalImagePreview });
          } else if (targetModel === 'minimaxh3') {
            // 切换到 MiniMax H3 模型
            setVideoModel('minimaxh3');
            // 设置图片到 MiniMax H3 面板
            setMmImages([{ path: finalImagePath, preview: finalImagePreview }, { path: '', preview: '' }, { path: '', preview: '' }]);
          } else {
            // 默认使用 Wan 2.2 模型
            setImagePreview(finalImagePreview);
            setImagePath(finalImagePath);
          }

          if (videoPrompt) {
            setPrompt(videoPrompt);
          }

          if (autoGenerate) {
            // Auto-generate video after a short delay to let the UI update
            setTimeout(() => {
              if (finalImagePath && videoPrompt) {
                // Use ref to get current function
                const nodeList = buildNodeListWithParamsRef.current(
                  finalImagePath,
                  videoPrompt,
                  resolution,
                  duration,
                  interpolation,
                  loraHigh,
                  loraHighWeight,
                  loraLow,
                  loraLowWeight
                );
                taskListRef.current?.submitTask(videoPrompt, finalImagePath, finalImagePreview, nodeList);
              }
            }, 500);
          }
          
          if (autoGenerate) {
            onSuccess?.('正在从分镜生成视频...');
          } else {
            onSuccess?.('已从分镜导入图片和提示词');
          }
        } catch {
          // Ignore parse errors
        }
      };

      if (directData) {
        await processData(directData, true);
      } else if (oldData) {
        await processData(oldData, false);
      } else if (historyData) {
        // 历史记录只导入图片，不带 prompt，不自动生成。
        // 复用 processData 但用空 prompt + autoGenerate=false 走完整的上传/预览路径。
        await processData(historyData, false);
        // 根据 targetModel 显示不同的提示信息
        try {
          const { targetModel } = JSON.parse(historyData);
          if (targetModel === 'minimaxh3') {
            onSuccess?.('已从历史记录导入图片到 MiniMax H3，请输入提示词后点击生成');
          } else if (targetModel === 'longvideov2') {
            onSuccess?.('已从历史记录导入图片到长视频 v1.1，请输入提示词后点击生成');
          } else {
            onSuccess?.('已从历史记录导入图片，请输入提示词后点击生成');
          }
        } catch {
          onSuccess?.('已从历史记录导入图片，请输入提示词后点击生成');
        }
      }
    };

    // 执行异步处理
    processStoryboardData();
  }, [apiKey, onError, onSuccess, resolution, duration, interpolation, loraHigh, loraHighWeight, loraLow, loraLowWeight]);

  const taskListRef = useRef<{ submitTask: (prompt: string, imagePath: string, imagePreview: string, nodeInfoList: NodeInfo[]) => void } | null>(null);

  // Build node list with custom parameters (for storyboard video generation)
  const buildNodeListWithParams = (
    imgPath: string,
    vidPrompt: string,
    res: string,
    dur: string,
    interp: boolean,
    loraH: string,
    loraHWeight: number,
    loraL: string,
    loraLWeight: number
  ): NodeInfo[] => {
    const nodeList: NodeInfo[] = [
      { nodeId: '28', fieldName: 'value', fieldValue: res, description: '最长边' },
      { nodeId: '20', fieldName: 'value', fieldValue: dur, description: '时长（秒）' },
      { nodeId: '77', fieldName: 'value', fieldValue: String(interp), description: '补帧（默认关）' },
      { nodeId: '21', fieldName: 'image', fieldValue: imgPath, description: '图片上传' },
      { nodeId: '38', fieldName: 'value', fieldValue: vidPrompt, description: '提示词' },
    ];
    if (loraH) {
      nodeList.push(
        { nodeId: '42', fieldName: 'lora_name', fieldValue: loraH, description: 'lora（high）' },
        { nodeId: '42', fieldName: 'strength_model', fieldValue: String(loraHWeight), description: 'lora权重' }
      );
    }
    if (loraL) {
      nodeList.push(
        { nodeId: '43', fieldName: 'lora_name', fieldValue: loraL, description: 'lora（low）' },
        { nodeId: '43', fieldName: 'strength_model', fieldValue: String(loraLWeight), description: 'lora权重' }
      );
    }
    return nodeList;
  };

  const buildNodeListWithParamsRef = useRef(buildNodeListWithParams);

  // Update ref when function changes
  useEffect(() => {
    buildNodeListWithParamsRef.current = buildNodeListWithParams;
  });

  const handleGirlfriendSelect = useCallback(
    async (gf: GirlfriendPreset) => {
      setSelectedGirlfriend(gf);
      setUploadError(null);
      setGirlfriendUploading(true);
      try {
        let file: File;
        let objectUrl: string;

        if (gf.portraitUrl.startsWith('data:')) {
          // data URL: fetch 可以直接转换 data URL 为 blob
          const res = await fetch(gf.portraitUrl);
          const blob = await res.blob();
          file = new File([blob], `${gf.id}.jpg`, { type: blob.type || 'image/jpeg' });
          objectUrl = gf.portraitUrl;
          setImagePreview(objectUrl);
        } else {
          // 外部 URL: 走原逻辑
          const res = await fetch(gf.portraitUrl);
          const blob = await res.blob();
          file = new File([blob], `${gf.id}.jpg`, { type: blob.type || 'image/jpeg' });
          objectUrl = URL.createObjectURL(file);
          setImagePreview(objectUrl);
        }

        const { imagePath: path } = await uploadImage(apiKey, file);
        setImagePath(path);
        onSuccess(`已选择女友「${gf.nameZh || gf.name}」作为视频主角`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '未知错误';
        onError(`女友图片上传失败: ${msg}`);
        setSelectedGirlfriend(null);
        setImagePreview('');
        setImagePath('');
      } finally {
        setGirlfriendUploading(false);
      }
    },
    [apiKey, onSuccess, onError]
  );

  const handleUpload = useCallback(
    async (file: File) => {
      setUploadError(null);
      setSelectedGirlfriend(null);
      try {
        const objectUrl = URL.createObjectURL(file);
        setImagePreview(objectUrl);
        const { imagePath: path } = await uploadImage(apiKey, file);
        setImagePath(path);
        onSuccess('图片上传成功');
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : '上传失败');
        throw err;
      }
    },
    [apiKey, onSuccess]
  );

  const handleImageSelect = useCallback(
    async (path: string, preview: string) => {
      setImagePreview(preview);
      setSelectedGirlfriend(null);

      // If path is a blob URL (from history), re-upload it to RunningHub since blobs
      // expire on page refresh. For server URLs, use directly.
      if (path.startsWith('blob:')) {
        setIsReuploading(true);
        setImagePath(''); // clear while re-uploading
        try {
          const res = await fetch(path);
          if (!res.ok) throw new Error('无法读取历史图片');
          const blob = await res.blob();
          const file = new File([blob], 'history_image.jpg', { type: blob.type || 'image/jpeg' });
          const { imagePath: serverPath } = await uploadImage(apiKey, file);
          setImagePath(serverPath);
        } catch {
          setImagePath('');
          onError('历史图片重新上传失败，请重新上传该图片');
        } finally {
          setIsReuploading(false);
        }
      } else {
        setImagePath(path);
      }
    },
    [apiKey, onError]
  );

  const buildNodeList = (): NodeInfo[] => {
    return buildNodeListWithParams(imagePath, prompt, resolution, duration, interpolation, loraHigh, loraHighWeight, loraLow, loraLowWeight);
  };

  const handleSubmit = () => {
    if (!imagePath) { onError('请上传或选择一张图片'); return; }
    if (!prompt.trim()) { onError('请输入提示词'); return; }
    if (isSubmitting) return;
    taskListRef.current?.submitTask(prompt, imagePath, imagePreview, buildNodeList());
  };

  const handlePromptApply = (newPrompt: string) => {
    setPrompt(newPrompt);
  };

  const handlePoseSelect = (posePrompt: string, poseName: string) => {
    setPrompt(posePrompt);
    onSuccess(`已应用姿势: ${poseName}`);
  };

  // 复用 智能分镜 里的"智能扩写"逻辑（wan2.2 i2v 端点），把提示词 textarea
  // 的内容当成"想看的动作/镜头/表情"扩写成符合 wan2.2 格式的英文视频提示词。
  // 如果是从分镜导航过来的（parsedScriptPanels 非空），优先用 panel.image_prompt
  // 作为画面锚（不再复述）、panel.scene_description 作为动作目标。
  const handleExpandPrompt = useCallback(async () => {
    const actionInput = prompt.trim();
    const firstPanel = parsedScriptPanels[0];
    const imageAnchor = firstPanel?.image_prompt?.trim() || '1 person, single human character';
    const actionTarget = actionInput || firstPanel?.scene_description?.trim() || 'subtle natural micro-movement, slight head turn, breathing';
    console.log('[视频参数·智能扩写] 开始', {
      imageAnchorLength: imageAnchor.length,
      actionTargetLength: actionTarget.length,
      hasFirstPanel: !!firstPanel,
      r18: false,
    });
    setIsExpandingPrompt(true);
    try {
      let res;
      try {
        res = await expandVideoFromImage(imageAnchor, actionTarget, false, 1);
      } catch (firstErr) {
        const isTimeout = firstErr instanceof Error &&
          (firstErr.message.includes('超时') || firstErr.message.includes('timeout'));
        if (isTimeout) {
          console.warn('[视频参数·智能扩写] 超时，尝试 fast 模型重试（150s）');
          // retry：跳过默认慢模型，直接用 fast 模型，并延长超时到 150s
          res = await expandVideoFromImage(imageAnchor, actionTarget, false, 1, ['grok-4.6', 'grok-4.3'], 150000);
        } else {
          throw firstErr;
        }
      }
      console.log('[视频参数·智能扩写] 返回', res);
      const first = res.results?.[0];
      if (!first?.prompt) {
        throw new Error('智能扩写返回为空，请重试');
      }
      setPrompt(first.prompt.trim());
      onSuccess('提示词已按 Wan2.2 格式智能扩写');
    } catch (err) {
      console.error('[视频参数·智能扩写] 失败', err);
      onError(err instanceof Error ? err.message : '智能扩写失败');
    } finally {
      setIsExpandingPrompt(false);
    }
  }, [prompt, parsedScriptPanels, onError, onSuccess]);

  const handleParseScript = () => {
    if (!scriptInputText.trim()) return;
    try {
      const result = parseStoryboardScript(scriptInputText);
      if (result.panels.length === 0) {
        setParseError('未能识别到任何分镜，请检查格式是否正确（需包含「镜头」编号）');
        return;
      }
      setParsedScriptPanels(result.panels);
      setParseError(null);
      onSuccess(`成功解析 ${result.panels.length} 个分镜`);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : '解析失败');
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* 任务列表 */}
      <VideoTaskList
        ref={taskListRef}
        apiKey={apiKey}
        onError={onError}
        onSuccess={onSuccess}
        maxTasks={10}
      />

      {/* 视频模型选择器 */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-text-primary flex items-center gap-2">
            <Layers size={16} className="text-primary" />
            视频模型
          </span>
          <div className="flex bg-bg-elevated rounded-xl p-1">
            <button
              onClick={() => setVideoModel('wan22')}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                videoModel === 'wan22'
                  ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Wan 2.2
            </button>
            <button
              onClick={() => setVideoModel('minimaxh3t2v')}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                videoModel === 'minimaxh3t2v'
                  ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              MiniMax H3 文生视频
            </button>
            <button
              onClick={() => setVideoModel('minimaxh3')}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                videoModel === 'minimaxh3'
                  ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              MiniMax H3
            </button>
            <button
              onClick={() => setVideoModel('minimaxlong')}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                videoModel === 'minimaxlong'
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              MiniMax 长视频
            </button>
            <button
              onClick={() => setVideoModel('longvideov2')}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                videoModel === 'longvideov2'
                  ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              长视频 v1.1
            </button>
          </div>
        </div>
      </div>

      {/* 视频模型面板 */}
      {videoModel === 'minimaxh3t2v' && (
        <MiniMaxH3T2VPanel
          apiKey={apiKey}
          mh3Prompt={mh3Prompt}
          setMh3Prompt={setMh3Prompt}
          mh3AutoPrompt={mh3AutoPrompt}
          setMh3AutoPrompt={setMh3AutoPrompt}
          mh3DirectOutput={mh3DirectOutput}
          setMh3DirectOutput={setMh3DirectOutput}
          mh3Duration={mh3Duration}
          setMh3Duration={setMh3Duration}
          mh3AspectRatio={mh3AspectRatio}
          setMh3AspectRatio={setMh3AspectRatio}
          mh3Submitting={mh3Submitting}
          setMh3Submitting={setMh3Submitting}
          isSubmitting={isSubmitting}
          setIsSubmitting={setIsSubmitting}
          onError={onError}
          onSuccess={onSuccess}
          taskListRef={taskListRef}
        />
      )}

      {/* MiniMax H3 UI */}
      {videoModel === 'minimaxh3' && (
        <MiniMaxH3Panel
          apiKey={apiKey}
          mmImages={mmImages}
          setMmImages={setMmImages}
          mmPrompt={mmPrompt}
          setMmPrompt={setMmPrompt}
          mmDuration={mmDuration}
          setMmDuration={setMmDuration}
          mmStrength={mmStrength}
          setMmStrength={setMmStrength}
          mmStyleMode={mmStyleMode}
          setMmStyleMode={setMmStyleMode}
          mmAutoPrompt={mmAutoPrompt}
          setMmAutoPrompt={setMmAutoPrompt}
          mmDirectOutput={mmDirectOutput}
          setMmDirectOutput={setMmDirectOutput}
          mmVideoModel={mmVideoModel}
          setMmVideoModel={setMmVideoModel}
          mmLora={mmLora}
          setMmLora={setMmLora}
          mmLoraWeight={mmLoraWeight}
          setMmLoraWeight={setMmLoraWeight}
          mmUploading={mmUploading}
          setMmUploading={setMmUploading}
          isSubmitting={isSubmitting}
          setIsSubmitting={setIsSubmitting}
          onError={onError}
          onSuccess={onSuccess}
          taskListRef={taskListRef}
          selectedGirlfriend={selectedGirlfriend}
          setSelectedGirlfriend={setSelectedGirlfriend}
          girlfriendUploading={girlfriendUploading}
          setGirlfriendUploading={setGirlfriendUploading}
        />
      )}

      {/* MiniMax Long Video UI */}
      {videoModel === 'minimaxlong' && (
        <MiniMaxLongVideoPanel
          apiKey={apiKey}
          mlImages={mlImages}
          setMlImages={setMlImages}
          mlPrompts={mlPrompts}
          setMlPrompts={setMlPrompts}
          mlDuration={mlDuration}
          setMlDuration={setMlDuration}
          mlAutoPrompt={mlAutoPrompt}
          setMlAutoPrompt={setMlAutoPrompt}
          mlDirectOutput={mlDirectOutput}
          setMlDirectOutput={setMlDirectOutput}
          mlVideoModel={mlVideoModel}
          setMlVideoModel={setMlVideoModel}
          mlLora={mlLora}
          setMlLora={setMlLora}
          mlLoraWeight={mlLoraWeight}
          setMlLoraWeight={setMlLoraWeight}
          mlUploading={mlUploading}
          setMlUploading={setMlUploading}
          isSubmitting={isSubmitting}
          setIsSubmitting={setIsSubmitting}
          onError={onError}
          onSuccess={onSuccess}
          taskListRef={taskListRef}
          selectedGirlfriend={mlSelectedGirlfriend}
          setSelectedGirlfriend={setMlSelectedGirlfriend}
          girlfriendUploading={mlGirlfriendUploading}
          setGirlfriendUploading={setMlGirlfriendUploading}
          mlH3Prompt={mlH3Prompt}
          setMlH3Prompt={setMlH3Prompt}
          mlH3Duration={mlH3Duration}
          setMlH3Duration={setMlH3Duration}
          handleGenerateH3Prompt={handleGenerateH3Prompt}
          handleGotoLongVideoWithH3={handleGotoLongVideoWithH3}
        />
      )}

      {/* 长视频 v1.1 UI */}
      {videoModel === 'longvideov2' && (
        <NinfiniteLongVideoPage
          apiKey={apiKey}
          onError={onError}
          onSuccess={onSuccess}
          initialImage={nlInitialImage}
          initialPrompt={nlInitialPrompt}
        />
      )}

      {/* Wan 2.2 UI */}
      {videoModel === 'wan22' && (
        <>
      {/* Girlfriend 选择器 */}
      <GirlfriendSelector
        selectedId={selectedGirlfriend ? (selectedGirlfriend.isCustom ? `custom_${selectedGirlfriend.id}` : selectedGirlfriend.id) : null}
        onSelect={handleGirlfriendSelect}
        disabled={girlfriendUploading || isSubmitting}
      />

      {/* 图片上传 */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
            <ImageIcon size={16} className="text-primary" />
            选择图片
          </h3>
          <历史图片选择器 on选择={handleImageSelect} 当前图片路径={imagePath} />
        </div>
        <ImageUploader
          value={imagePath}
          previewUrl={imagePreview}
          onChange={handleImageSelect}
          onUpload={handleUpload}
          disabled={isSubmitting || girlfriendUploading}
          error={uploadError || undefined}
          uploadLabel={selectedGirlfriend ? '更换图片' : undefined}
        />
        {selectedGirlfriend && (
          <div className="mt-2 flex items-center gap-2">
            <div className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 text-[10px] font-medium border border-red-200/50">
              AI 女友模式 · {selectedGirlfriend.nameZh || selectedGirlfriend.name}
            </div>
            {girlfriendUploading && (
              <div className="flex items-center gap-1 text-[10px] text-text-tertiary">
                <div className="w-3 h-3 border border-text-tertiary/30 border-t-text-tertiary rounded-full animate-spin" />
                上传中...
              </div>
            )}
          </div>
        )}
      </div>

      {/* AI 提示词面板 — 放在参考图下面 */}
      <AIPromptPanel on应用={handlePromptApply} />

      {/* 预设姿势 */}
      <PosePresetSelector
        type="video"
        onSelect={handlePoseSelect}
        disabled={isSubmitting}
        selectedGirlfriend={selectedGirlfriend}
      />

      {/* 脚本导入 — 从粘贴的脚本文本中识别分镜 */}
      <div className="rounded-xl bg-bg-surface border border-border overflow-hidden">
        <button
          onClick={() => setScriptInputOpen(!scriptInputOpen)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-bg-elevated transition-colors"
        >
          <div className="flex items-center gap-2">
            <Clapperboard size={15} className="text-purple-500" />
            <span className="text-sm font-medium text-text-primary">脚本导入</span>
            {parsedScriptPanels.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-600 text-[11px] font-medium">
                {parsedScriptPanels.length} 个分镜
              </span>
            )}
          </div>
          {scriptInputOpen ? <ChevronUp size={15} className="text-text-tertiary" /> : <ChevronDown size={15} className="text-text-tertiary" />}
        </button>

        {scriptInputOpen && (
          <div className="px-4 pb-4 space-y-3 border-t border-border/50">
            <p className="text-xs text-text-tertiary mt-2">
              粘贴分镜脚本文本，自动识别「镜头文案」「图片提示词」「视频提示词」「景别」「音效」「语音分镜」等字段。
            </p>
            <textarea
              value={scriptInputText}
              onChange={(e) => { setScriptInputText(e.target.value); setParseError(null); }}
              placeholder={'粘贴分镜脚本，例如：\n\n镜头1\n镜头文案: xxx\n图片提示词: xxx\n视频提示词: xxx\n景别: 中景\n音效: xxx\n\n镜头2\n...'}
              rows={8}
              className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-xs text-text-primary placeholder-slate-600 focus:outline-none focus:border-primary/50 resize-none font-mono"
            />
            {parseError && (
              <p className="text-xs text-red-500">{parseError}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleParseScript}
                disabled={!scriptInputText.trim()}
                className="px-4 py-2 rounded-lg bg-purple-600 text-white text-xs font-medium hover:bg-purple-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                解析脚本
              </button>
              {parsedScriptPanels.length > 0 && (
                <button
                  onClick={() => { setParsedScriptPanels([]); setScriptInputText(''); setParseError(null); }}
                  className="px-4 py-2 rounded-lg bg-bg-elevated border border-border text-text-secondary text-xs hover:bg-bg-hover transition-colors"
                >
                  清除
                </button>
              )}
            </div>

            {/* Parsed panels preview */}
            {parsedScriptPanels.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-secondary font-medium">解析结果预览</span>
                  <span className="text-xs text-text-tertiary">{parsedScriptPanels.length} 个分镜</span>
                </div>
                <div className="max-h-60 overflow-y-auto space-y-2">
                  {parsedScriptPanels.map((panel, idx) => (
                    <div key={idx} className="rounded-lg bg-bg-elevated border border-border p-3 space-y-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-1.5 py-0.5 rounded bg-purple-600 text-white text-[10px] font-medium">
                          镜头{panel.panel_number}
                        </span>
                        {panel.shot_type && (
                          <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 text-[10px]">
                            {panel.shot_type}
                          </span>
                        )}
                      </div>
                      {panel.scene_description && (
                        <p className="text-[11px] text-text-secondary whitespace-pre-wrap break-words">{panel.scene_description}</p>
                      )}
                      {panel.video_prompt && (
                        <p className="text-[10px] text-purple-500 whitespace-pre-wrap break-words">视频: {panel.video_prompt}</p>
                      )}
                      {panel.image_prompt && (
                        <p className="text-[10px] text-green-600 whitespace-pre-wrap break-words">图片: {panel.image_prompt}</p>
                      )}
                      {panel.sound_cue && (
                        <p className="text-[10px] text-amber-600">音效: {panel.sound_cue}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 视频参数 */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <h3 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
          <Video size={16} className="text-primary" />
          视频参数
        </h3>

        <div className="space-y-4">
          {/* 提示词输入 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-text-secondary">提示词</label>
              <button
                onClick={handleExpandPrompt}
                disabled={isExpandingPrompt || isSubmitting}
                title="智能扩写：按 Wan2.2 i2v 规范生成英文视频提示词（不含场景/背景/外观）"
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                  isExpandingPrompt || isSubmitting
                    ? 'bg-bg-elevated text-text-secondary cursor-not-allowed'
                    : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:opacity-90'
                }`}
              >
                {isExpandingPrompt ? (
                  <><Loader2 size={11} className="animate-spin" /> 扩写中</>
                ) : (
                  <><Wand2 size={11} />智能扩写</>
                )}
              </button>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述视频中的人物动作、表情、场景变化... 或点击「智能扩写」自动生成 Wan2.2 格式提示词"
              rows={4}
              className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-sm text-text-primary placeholder-slate-500 focus:outline-none focus:border-primary/50 resize-none"
              disabled={isSubmitting}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <ParameterSelect label="时长" value={duration} options={DURATION_OPTIONS} onChange={setDuration} disabled={isSubmitting} />
            <ParameterSelect label="分辨率" value={resolution} options={RESOLUTION_OPTIONS} onChange={setResolution} disabled={isSubmitting} />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setInterpolation(!interpolation)}
              className={`w-10 h-6 rounded-full transition-colors relative ${interpolation ? 'bg-primary' : 'bg-text-tertiary'}`}
              disabled={isSubmitting}
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${interpolation ? 'translate-x-5' : 'translate-x-1'}`} />
            </button>
            <span className="text-xs text-text-secondary">补帧（视频更流畅但耗时更长）</span>
          </div>

          {/* LoRA 设置 */}
          <div className="border-t border-border/50 pt-4">
            <h4 className="text-xs text-text-secondary mb-3">LoRA 设置（可选）</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <ParameterSelect label="High LoRA" value={loraHigh} options={LORA_HIGH_OPTIONS} onChange={setLoraHigh} disabled={isSubmitting} />
                {loraHigh && (
                  <div className="mt-2">
                    <ParameterSlider label="权重" value={loraHighWeight} min={0.1} max={2} step={0.1} onChange={setLoraHighWeight} disabled={isSubmitting} />
                  </div>
                )}
              </div>
              <div>
                <ParameterSelect label="Low LoRA" value={loraLow} options={LORA_LOW_OPTIONS} onChange={setLoraLow} disabled={isSubmitting} />
                {loraLow && (
                  <div className="mt-2">
                    <ParameterSlider label="权重" value={loraLowWeight} min={0.1} max={2} step={0.1} onChange={setLoraLowWeight} disabled={isSubmitting} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 生成按钮 */}
      <div className="pt-2 pb-4">
        <GenerateButton
          onClick={handleSubmit}
          isLoading={isSubmitting}
          disabled={!imagePath || !prompt.trim() || isSubmitting || girlfriendUploading || isReuploading}
          label={
            isReuploading ? '重新上传历史图片中...' :
            girlfriendUploading ? '上传女友图片中...' :
            isSubmitting ? '提交中...' : '生成视频'
          }
        />
      </div>
        </>
      )}
    </div>
  );
}
