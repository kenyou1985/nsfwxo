import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Video, Image as ImageIcon, Wand2, Copy, Check, Loader2, X, Clock, History, Sparkles, ChevronRight, ChevronDown, ChevronUp, Trash2, Clapperboard } from 'lucide-react';
import { ImageUploader } from '../components/ImageUploader';
import { GirlfriendSelector } from '../components/GirlfriendSelector';
import { ParameterSlider } from '../components/ParameterSlider';
import { ParameterSelect } from '../components/ParameterSelect';
import { GenerateButton } from '../components/GenerateButton';
import { VideoTaskList } from '../components/VideoTaskList';
import { uploadImage } from '../services/runninghub';
import { expandPrompt, expandVideoFromImage, randomPrompt } from '../services/promptApi';
import { parseStoryboardScript, toVideoScriptPanels, type ParsedScriptPanel } from '../utils/scriptParser';
import { getYunwuKey } from '../services/storage';
import { getRecords, deleteRecord, clearAllHistory, type HistoryRecord } from '../services/historyService';
import { extractImagesFromZipAsDataUrls } from '../services/runninghub';
import type { NodeInfo } from '../types';
import type { GirlfriendPreset } from '../data/girlfriendPresets';
import { PosePresetSelector } from '../components/PosePresetSelector';

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
    if (!getYunwuKey()) { alert('请先在设置中配置 Yunwu AI API Key'); return; }
    set加载中(true);
    try {
      const res = await expandPrompt(输入.trim(), 'video', R18模式, 数量);
      const 提示词列表 = res.results.map((r) => transformToWan22Style(r.prompt, r.r18));
      set结果列表(提示词列表);
      set选中索引(0);
      set输出文本(提示词列表[0] || '');
    } catch (err) {
      alert(err instanceof Error ? err.message : '扩写失败');
    } finally {
      set加载中(false);
    }
  };

  const 处理随机 = async () => {
    if (!getYunwuKey()) { alert('请先在设置中配置 Yunwu AI API Key'); return; }
    set加载中(true);
    try {
      const res = await randomPrompt('video', R18模式, 数量, 主题);
      const 提示词列表 = res.results.map((r) => transformToWan22Style(r.prompt, R18模式));
      set结果列表(提示词列表);
      set选中索引(0);
      set输出文本(提示词列表[0] || '');
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

// ─── 主页面 ────────────────────────────────────────────────────────────────

export function ImageToVideoPage({ apiKey, onError, onSuccess }: ImageToVideoPageProps) {
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

  const [selectedGirlfriend, setSelectedGirlfriend] = useState<GirlfriendPreset | null>(null);
  const [girlfriendUploading, setGirlfriendUploading] = useState(false);

  // Script import state
  const [parsedScriptPanels, setParsedScriptPanels] = useState<ParsedScriptPanel[]>([]);
  const [scriptInputText, setScriptInputText] = useState('');
  const [scriptInputOpen, setScriptInputOpen] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Check for storyboard image2video data on mount
  useEffect(() => {
    // Try new direct format first (auto-generate)
    const directData = sessionStorage.getItem('storyboard_img2vid_direct');
    // Try old format (navigate only)
    const oldData = sessionStorage.getItem('storyboard_img2vid');
    // 历史记录 → 图生视频：只预填图片，不自动生成
    const historyData = sessionStorage.getItem('history_img2vid');

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

    const processData = async (data: string, autoGenerate: boolean) => {
      try {
        const { imageUrl, imagePath: uploadedPath, prompt: videoPrompt } = JSON.parse(data);
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

        setImagePreview(finalImagePreview);
        setImagePath(finalImagePath);

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
      processData(directData, true);
    } else if (oldData) {
      processData(oldData, false);
    } else if (historyData) {
      // 历史记录只导入图片，不带 prompt，不自动生成。
      // 复用 processData 但用空 prompt + autoGenerate=false 走完整的上传/预览路径。
      processData(historyData, false);
      onSuccess?.('已从历史记录导入图片，请输入提示词后点击生成');
    }
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
        const res = await fetch(gf.portraitUrl);
        const blob = await res.blob();
        const file = new File([blob], `${gf.id}.jpg`, { type: 'image/jpeg' });
        const objectUrl = URL.createObjectURL(file);
        setImagePreview(objectUrl);
        const { imagePath: path } = await uploadImage(apiKey, file);
        setImagePath(path);
        onSuccess(`已选择女友「${gf.nameZh || gf.name}」作为视频主角`);
      } catch {
        onError('女友图片上传失败，请重试');
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
      const res = await expandVideoFromImage(imageAnchor, actionTarget, false, 1);
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

      {/* Girlfriend 选择器 */}
      <GirlfriendSelector
        apiKey={apiKey}
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
    </div>
  );
}
