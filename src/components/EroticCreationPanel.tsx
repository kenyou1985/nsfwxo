import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, Play, Copy, Check, X, ChevronDown, ChevronUp, Video, Wand2, Settings2, Clock, Hash, Brain, Film, ListOrdered, Image as ImageIcon, Layers } from 'lucide-react';
import { streamGenerateH3DnaPrompt, type ImageDnaResult } from '../services/promptApi';
import { ImageDnaPanel } from './ImageDnaPanel';
import { SeriesWorkbench } from './SeriesWorkbench';
import { compressDataUrlIfNeeded, isHeicDataUrl } from '../utils/imagePreprocess';
import { 构建首帧约束块 } from '../utils/h3FirstFrameConstraint';

// ──────────────────────────────────────────────────────────────────────────────
// 共享「情色创作模式」面板
// ──────────────────────────────────────────────────────────────────────────────
//
// 三个图生视频页面（MiniMaxH3 / 长视频 v1.1 / 长视频 V2）共用同一套 UI + 逻辑。
// 父页面负责：
//   1. 维护 `images` / `prompt` / DNA / 情色模式开关 / 方向 / 时长 / 条数 等状态
//   2. 上传/选择参考图、提交任务、保存历史
// 本组件负责：
//   - 渲染 3 个 Skill 触发器（3 分钟成人短片 / 10 集成人短剧 / 自定义主题系列）+ 时长/条数快捷按钮
//   - 调 Grok-4.6 流式生成 H3 提示词
//   - 渲染结果卡片（每条提示词可：编辑 / 复制 / 使用 / 一键生成 / 发送到长视频）
// 父组件只需传入状态和回调即可复用本组件，无需关心流式通信细节。
//
// 默认模型：Grok-4.6（由后端 /api/prompt/generate/h3-dna/stream 固定）。
// ──────────────────────────────────────────────────────────────────────────────

/** 视频时长选项（秒） */
export type EroticDuration = 15 | 30 | 60 | 120 | 180 | 240;
/** 创作方向 */
export type EroticLevel = 'soft' | 'normal' | 'sm';
/** 单条补充信息模式 */
export type SupplementaryMode = 'unified' | 'individual';

/** 通用图片描述（兼容所有页面的图片格式） */
export interface EroticImageRef {
  path: string;
  preview: string;
}

/** Skill 触发器（一键套用时长 + 条数 + 用户提示词） */
export interface SkillPreset {
  id: string;
  /** 触发器展示名（中文短） */
  label: string;
  /** 触发器副标题（最长 20 字） */
  hint: string;
  /** 图标（lucide-react） */
  icon: React.ReactNode;
  /** 套用时长（秒） */
  duration: EroticDuration;
  /** 套用条数 */
  count: number;
  /** 套用的方向 */
  level: EroticLevel;
  /** 套用到 prompt 输入框的内容（用户可继续编辑） */
  userHint: string;
  /** 套用后是否自动开始生成（默认 false） */
  autoStart?: boolean;
}

/** 3 个 Skill 触发器（来自 adult-short-film-from-image SKILL，去重后保留） */
export const SKILL_PRESETS: SkillPreset[] = [
  {
    id: '3min-short-film',
    label: '3 分钟成人短片',
    hint: '用图片写一个 3 分钟成人小短片',
    icon: <Film size={12} />,
    duration: 180,
    count: 1,
    level: 'normal',
    userHint: '根据这张图生成 3 分钟成人短片：完整起承转合，开场-前戏-中段-高潮-收尾 5 阶段全部展开，主体完全暴露，所有性动作真实描写。',
  },
  {
    id: '10-episode-series',
    label: '10 集成人短剧',
    hint: '根据照片设计 10 集成人短剧',
    icon: <ListOrdered size={12} />,
    duration: 60,
    count: 10,
    level: 'normal',
    userHint: '根据这张照片设计 10 集成人短剧的大纲与每集分镜（每集 60s），每集独立成段，剧情连贯递进，集与集之间通过场景/人物关系串联。',
  },
  {
    id: 'custom-theme',
    label: '自定义主题系列',
    hint: '输入完整新主题，生成系列脚本',
    icon: <Wand2 size={12} />,
    duration: 60,
    count: 3,
    level: 'normal',
    userHint: '请根据下方输入的完整主题生成系列大纲与每集分镜（每集 60s），每集独立成段，剧情连贯递进，集与集之间通过场景/人物关系串联，主体符合参考图角色外观。',
  },
];

/** 时长选项（与后端 schema 同步） */
export const DURATION_OPTIONS: { value: EroticDuration; label: string; sub: string }[] = [
  { value: 15,  label: '15秒',  sub: '短' },
  { value: 30,  label: '30秒',  sub: '中' },
  { value: 60,  label: '1分钟', sub: '标准' },
  { value: 120, label: '2分钟', sub: '长' },
  { value: 180, label: '3分钟', sub: '完整' },
  { value: 240, label: '4分钟', sub: '加长' },
];

/** 条数选项（与后端 schema 同步：1-30） */
export const COUNT_OPTIONS = [
  { value: 3,  label: '3条' },
  { value: 5,  label: '5条' },
  { value: 10, label: '10条' },
  { value: 20, label: '20条' },
  { value: 30, label: '30条' },
] as const;

/** 创作方向（与后端 Literal 同步） */
const LEVEL_OPTIONS: { value: EroticLevel; label: string; gradient: string; hint: string }[] = [
  { value: 'soft',   label: '纯情色', gradient: 'from-pink-400 to-rose-400',  hint: '抚摸/挑逗/脱衣/裸体，不强制插入' },
  { value: 'normal', label: '带性爱', gradient: 'from-rose-400 to-red-400',   hint: '多体位真实插入 + 射精收尾' },
  { value: 'sm',     label: 'SM重口味', gradient: 'from-red-400 to-orange-400', hint: 'BDSM 道具 + 肛交 + 深喉' },
];

// ─── 单条结果卡片 ───────────────────────────────────────────────────────────

export interface EroticPromptCardProps {
  index: number;
  prompt: string;
  duration: EroticDuration;
  imagePreview?: string;
  imagePath?: string;
  onUse: (prompt: string) => void;
  onSendToLongVideo?: (prompt: string) => void;
  onSendToLongVideoV2?: (prompt: string) => void;
  onGenerateVideo: (prompt: string) => void;
  onSuccess?: (msg: string) => void;
  onError?: (msg: string) => void;
}


// 情色创作生成的 H3 提示词缺少说话人标签与 speaker_mapping → 统一补齐，避免火星语。
const _MALE_CMD = /(?:不要出声|乖乖听话|乖乖含住|乖乖坐上去|夹紧|张嘴|别动|站好|继续含|含住|含深|转过来|腿抬好|别停|坐上去|含住)/;
const _FEMALE_PLEA = /(?:求求你|放过|不要|疼|轻点|停|别这样|别插|我怕|别碰)/;

/** 一镜一主动作：只保留最后一个“人物+动作”句 + 状态句 + 台词句。 */
function oneActionShot(line: string): string {
  const pm = line.match(/^(\[Shot\s+\d+\]\s*\d{2}:\d{2}\.\d{3})\s*/);
  const prefix = pm ? pm[1] : '';
  const body = prefix ? line.slice(pm![0].length) : line;
  const parts = body.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (parts.length <= 2) return line;
  const isAction = (x: string) => /\b(?:he|she|his|her|man|woman)\b/i.test(x) && /\b\w+(?:s|ed|ing)\b/.test(x);
  const isState = (x: string) => /^(?:Fully clothed|Both are fully nude|Clothing|No clothing|She is|He is fully)/i.test(x);
  let last = -1;
  for (let i = 0; i < parts.length; i++) if (isAction(parts[i])) last = i;
  if (last < 0) return line;
  return `${prefix} ${parts.filter((x, i) => i === last || isState(x) || /<d>/.test(x)).join(' ')}`.trim();
}

export function normalizeEroticPrompt(raw: string): string {
  let p = String(raw || '');
  if (!p) return p;
  p = p.replace(/(?:\(S[12]\):\s*)?<d>([\s\S]*?)<\/d>/g, (m, inner) => {
    let body = String(inner);
    if (!/^\s*\[/.test(body)) body = `[Chinese] ${body}`;
    const txt = body.replace(/^\s*\[[^\]]+\]\s*/, '').trim();
    // 男命令优先：明确命令词 → S2，即使句子里含“不要”（不要出声/不要动）。
    const isMale = _MALE_CMD.test(txt);
    const isFemale = !isMale && _FEMALE_PLEA.test(txt);
    const existing = m.match(/\(S[12]\)/)?.[0];
    const who = isMale ? 'S2' : isFemale ? 'S1' : (existing ? existing.slice(1, -1) : 'S1');
    return `(${who}): <d>${body}</d>`;
  });
  // 一镜一说话人：同一镜头内多句台词只保留一句（优先男命令 S2）
  p = p.replace(/(\[Shot\s+\d+\][\s\S]*?)(?=\n\[Shot\s+\d+\]|\noverall_soundscape|$)/g, (block) => {
    const ds = [...block.matchAll(/\(S[12]\):\s*<d>[\s\S]*?<\/d>/g)];
    if (ds.length <= 1) return block;
    const keep = ds.find((d) => /^\(S2\)/.test(d[0])) || ds[0];
    let out = block;
    for (const d of ds) if (d[0] !== keep[0]) out = out.replace(d[0], '');
    return out.replace(/[ \t]{2,}/g, ' ').replace(/\s+\n/g, '\n');
  });

  // 一镜一主动作 + 禁止转身：去掉 then 链，turns/spins 改为 repositions/moves
  p = p.split('\n').map((line) => {
    if (!/^\[Shot\s+\d+\]/.test(line.trim())) return line;
    let s2 = line
      .replace(/\bturns?\s+her\s+back\s+to\b/gi, 'repositions with her back to')
      .replace(/\bturns?\s+her\s+to\s+face\b/gi, 'repositions her to face')
      .replace(/\bturns?\s+around\b/gi, 'repositions')
      .replace(/\bturns?\s+to\b/gi, 'repositions toward')
      .replace(/\bspins?\b/gi, 'moves')
      // 去掉“then”后的第二个动作（保留第一个动作 + 状态句）
      .replace(/\b(?:He|She|The man|The woman)\s+then\s+[^.]*\./gi, '')
      .replace(/\s*(?:;|,)?\s*(?:and\s+)?then\s+[^.]*\./gi, '.')
      // 去掉元叙述（不是画面）
      .replace(/\bThis is the (?:single|only) ejaculation[^.]*\./gi, '')
      .replace(/\bFirst insertion of[^.]*\./gi, '')
      .replace(/\bNo change of position[^.]*\./gi, '');
    s2 = s2.replace(/[ \t]{2,}/g, ' ').replace(/\.\s*\./g, '.');
    return oneActionShot(s2);
  }).join('\n');

  if (!/^speaker_mapping\s*:/m.test(p)) {
    p = `${p.trimEnd()}\n\nspeaker_mapping: {"S1":"Chinese (Mandarin)_Adult_Female_Soft","S2":"Chinese (Mandarin)_Adult_Male_Low"}`;
  }
  return p;
}

function EroticPromptCard({
  index,
  prompt,
  duration,
  imagePreview,
  imagePath,
  onUse,
  onSendToLongVideo,
  onSendToLongVideoV2,
  onGenerateVideo,
  onSuccess,
  onError,
}: EroticPromptCardProps) {
  const [editingPrompt, setEditingPrompt] = useState(prompt);
  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [generating, setGenerating] = useState(false);
  const genTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isEditing) setEditingPrompt(prompt);
    setCollapsed(true);
  }, [prompt, isEditing]);

  const handleCopy = async () => {
    const textToCopy = editingPrompt || prompt;
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = textToCopy;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    };
    try {
      let ok = false;
      if (navigator.clipboard && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(textToCopy);
          ok = true;
        } catch {
          ok = fallback();
        }
      } else {
        ok = fallback();
      }
      if (!ok) throw new Error('copy failed');
      setCopied(true);
      onSuccess?.('提示词已复制');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[EroticPromptCard] 复制失败', err);
      onError?.('复制失败，请手动选择文本复制');
    }
  };

  // 生成完成后，任务列表广播结果，卡片按提示词匹配显示预览视频
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (typeof d.prompt === 'string' && d.prompt.trim() === prompt.trim() && d.videoUrl) {
        setVideoUrl(d.videoUrl);
        setGenerating(false);
        if (genTimerRef.current) { window.clearTimeout(genTimerRef.current); genTimerRef.current = null; }
      }
    };
    const failHandler = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (typeof d.prompt === 'string' && d.prompt.trim() === prompt.trim()) {
        setGenerating(false);
        if (genTimerRef.current) { window.clearTimeout(genTimerRef.current); genTimerRef.current = null; }
      }
    };
    window.addEventListener('nsfwxo:daotai-finished', handler);
    window.addEventListener('nsfwxo:daotai-failed', failHandler);
    return () => {
      window.removeEventListener('nsfwxo:daotai-finished', handler);
      window.removeEventListener('nsfwxo:daotai-failed', failHandler);
      if (genTimerRef.current) window.clearTimeout(genTimerRef.current);
    };
  }, [prompt]);

  const handleGenerateVideo = () => {
    if (generating) return;
    setGenerating(true);
    onGenerateVideo(editingPrompt);
    // 兜底：10 分钟未返回结果则恢复按钮
    genTimerRef.current = window.setTimeout(() => setGenerating(false), 10 * 60 * 1000);
  };

  return (
    <div className="rounded-xl border border-pink-200 bg-white overflow-hidden">
      {/* 折叠态：单行紧凑菜单 */}
      <div
        onClick={() => setCollapsed(c => !c)}
        className="flex items-center justify-between gap-2 px-3 py-2 bg-gradient-to-r from-pink-50 to-rose-50 cursor-pointer hover:from-pink-100 hover:to-rose-100 transition-colors"
        role="button"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-pink-500 text-white text-[10px] font-bold">
            {index + 1}
          </span>
          <span className="text-[10px] font-medium text-pink-600 truncate min-w-0">
            {duration >= 120 ? `${duration / 60}分钟` : `${duration}秒`} · {editingPrompt.slice(0, 28).replace(/\n/g, ' ')}{editingPrompt.length > 28 ? '...' : ''}
          </span>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {onSendToLongVideo && (
            <button
              onClick={() => onSendToLongVideo(editingPrompt)}
              title="发送至长视频 v1.1"
              className="flex items-center gap-0.5 px-1.5 py-1 rounded-lg bg-violet-100 text-violet-600 text-[9px] font-medium hover:bg-violet-200 transition-colors"
            >
              <Video size={9} />
              长视频
            </button>
          )}
          {onSendToLongVideoV2 && (
            <button
              onClick={() => onSendToLongVideoV2(editingPrompt)}
              title="发送至长视频 V2"
              className="flex items-center gap-0.5 px-1.5 py-1 rounded-lg bg-cyan-100 text-cyan-600 text-[9px] font-medium hover:bg-cyan-200 transition-colors"
            >
              <Video size={9} />
              长视频V2
            </button>
          )}
          <button
            onClick={() => onUse(editingPrompt)}
            title="应用到下方视频提示词"
            className="flex items-center gap-0.5 px-2 py-1 rounded-lg bg-emerald-500 text-white text-[10px] font-bold hover:bg-emerald-600 transition-colors"
          >
            <Check size={10} />
            应用
          </button>
          <button
            onClick={handleGenerateVideo}
            disabled={generating}
            title="一键生成视频"
            className={`flex items-center gap-0.5 px-2 py-1 rounded-lg text-white text-[10px] font-bold transition-opacity shadow-sm ${
              generating ? 'bg-pink-300 cursor-wait' : 'bg-gradient-to-r from-rose-500 to-pink-500 hover:opacity-90'
            }`}
          >
            {generating ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
            {generating ? '生视频中...' : '生成视频'}
          </button>
          <button
            onClick={handleCopy}
            title={copied ? '已复制' : '复制提示词到剪贴板'}
            className={`flex items-center gap-0.5 px-1.5 py-1 rounded-lg text-[9px] font-medium transition-colors ${
              copied
                ? 'bg-emerald-500 text-white'
                : 'bg-white/80 text-pink-600 border border-pink-200 hover:bg-white'
            }`}
          >
            {copied ? <><Check size={9} />已复制</> : <><Copy size={9} />复制</>}
          </button>
          {collapsed ? (
            <ChevronDown size={14} className="text-pink-500 ml-0.5" />
          ) : (
            <ChevronUp size={14} className="text-pink-500 ml-0.5" />
          )}
        </div>
      </div>

      {/* 展开态：完整提示词 + 全部操作按钮 */}
      {!collapsed && (
        <>
          <div className="px-3 py-2">
            {isEditing ? (
              <textarea
                value={editingPrompt}
                onChange={(e) => setEditingPrompt(e.target.value)}
                className="w-full min-h-[80px] p-2 rounded-lg border border-amber-300 bg-amber-50 text-[10px] text-text-primary resize-y focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="编辑提示词内容..."
              />
            ) : (
              <p className="text-[10px] text-text-primary leading-relaxed whitespace-pre-wrap">
                {editingPrompt}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1 px-3 pb-2 flex-wrap">
            <button
              onClick={() => {
                if (isEditing) {
                  onUse(editingPrompt);
                  setIsEditing(false);
                } else {
                  setIsEditing(true);
                }
              }}
              className={`px-2 py-0.5 rounded-lg text-[9px] font-medium transition-colors ${
                isEditing
                  ? 'bg-amber-500 text-white'
                  : 'bg-amber-100 text-amber-600 hover:bg-amber-200'
              }`}
            >
              {isEditing ? '✓ 确认' : '✎ 编辑'}
            </button>
            <button
              onClick={handleCopy}
              title="复制提示词到剪贴板"
              className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-medium transition-colors ${
                copied
                  ? 'bg-emerald-100 text-emerald-600'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {copied ? <><Check size={9} /> 已复制</> : <><Copy size={9} /> 复制</>}
            </button>
            <button
              onClick={() => onUse(editingPrompt)}
              className="px-2 py-0.5 rounded-lg bg-pink-100 text-pink-600 text-[9px] font-medium hover:bg-pink-200 transition-colors"
            >
              使用
            </button>
            {onSendToLongVideo && (
              <button
                onClick={() => onSendToLongVideo(editingPrompt)}
                className="px-2 py-0.5 rounded-lg bg-violet-100 text-violet-600 text-[9px] font-medium hover:bg-violet-200 transition-colors"
              >
                长视频
              </button>
            )}
            {onSendToLongVideoV2 && (
              <button
                onClick={() => onSendToLongVideoV2(editingPrompt)}
                className="px-2 py-0.5 rounded-lg bg-cyan-100 text-cyan-600 text-[9px] font-medium hover:bg-cyan-200 transition-colors"
              >
                长视频V2
              </button>
            )}
            {imagePreview && (
              <div className="ml-auto flex items-center gap-1 text-[9px] text-pink-400/60">
                <ImageIcon size={9} />
                参考图1
              </div>
            )}
          </div>
          {videoUrl && (
            <div className="px-3 pb-3">
              <video src={videoUrl} controls className="w-full rounded-lg border border-pink-200 bg-black" />
              <div className="mt-1 text-[9px] text-pink-500">已生成视频预览</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── 主组件：EroticCreationPanel ──────────────────────────────────────────────

export interface EroticCreationPanelProps {
  // ── 图片 & 用户提示词（来自父页面） ──────────────────────────────────────
  /** 已上传的参考图列表（取首张作为视频首帧） */
  images: EroticImageRef[];
  /** 用户提示词（用于 userHint） */
  prompt: string;
  /** 整体禁用（提交中、生成中、初始化时） */
  disabled?: boolean;

  // ── 状态值（受控） ─────────────────────────────────────────────────────────
  eroticMode: boolean;
  setEroticMode: (v: boolean) => void;
  eroticLevel: EroticLevel;
  setEroticLevel: (v: EroticLevel) => void;
  duration: EroticDuration;
  setDuration: (v: EroticDuration) => void;
  eroticCount: number;
  setEroticCount: (v: number) => void;

  // ── 补充信息（姿势/道具/场景元素） ────────────────────────────────────────
  supplementary: string;
  setSupplementary: (v: string) => void;
  supplementaryMode: SupplementaryMode;
  setSupplementaryMode: (v: SupplementaryMode) => void;
  supplementaryItems: string[];
  setSupplementaryItems: React.Dispatch<React.SetStateAction<string[]>>;

  // ── DNA 提取结果（由父页面 useEffect 自动提取，本组件只读） ────────────────
  imageDna: ImageDnaResult | null;
  dnaLoading: boolean;
  dnaError: string | null;
  onReExtract: () => void;
  /** 来自 ImageDnaPanel 的"插入为参考图"回调（必须实现） */
  onInsertClothingAsReference: (dataUrl: string, clothingName: string) => void;

  // ── 单条结果回调 ───────────────────────────────────────────────────────────
  /** 点击「使用」按钮：把这条提示词写入父页面的 prompt 输入框 */
  onUsePrompt: (prompt: string, idx: number) => void;
  /** 点击「生成视频」：父页面用这条提示词构建节点并提交任务 */
  onGenerateVideo: (prompt: string, idx: number) => void;
  /** 系列资产生成/上传成功：自动填入父页面参考图槽（不触发 DNA 重提取） */
  onAssetToRef?: (dataUrl: string, name: string) => void;
  /** 「发送到长视频 v1.1」（可选，仅 ImageToVideoPage 注入） */
  onSendToLongVideo?: (prompt: string) => void;
  /** 「发送到长视频 V2」（可选，仅 ImageToVideoPage 注入） */
  onSendToLongVideoV2?: (prompt: string) => void;
  /** 「自定义主题」Skill 触发后，把用户输入的完整主题写回父页面的 prompt 输入框（可选） */
  onSetPrompt?: (prompt: string) => void;

  // ── 错误/成功反馈 ──────────────────────────────────────────────────────────
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;

  // ── 标识 ──────────────────────────────────────────────────────────────────
  /** 父页面名称（用于 toast/debug 区分） */
  panelName?: string;
  /** 当前时长超出当前模型硬上限时显示的提示信息（可选）
   *  例如：「V2 当前上限 60s，2 分钟/3 分钟可能生成失败」 */
  durationLimitHint?: string;
}

/**
 * 共享的情色创作模式面板。
 *
 * 工作流：
 *  1. 用户上传参考图（父页面管理）→ 自动触发 DNA 提取（父页面 useEffect）
 *  2. 用户打开情色创作模式开关 → 选择创作方向 / 时长 / 条数
 *  3. 用户点击「分析参考图生成提示词」→ 本组件调后端流式生成 → 实时显示结果
 *  4. 用户对每条结果：编辑 / 复制 / 使用 / 一键生成 / 发送到长视频
 */
export function EroticCreationPanel({
  images,
  prompt,
  disabled = false,
  eroticMode,
  setEroticMode,
  eroticLevel,
  setEroticLevel,
  duration,
  setDuration,
  eroticCount,
  setEroticCount,
  supplementary,
  setSupplementary,
  supplementaryMode,
  setSupplementaryMode,
  supplementaryItems,
  setSupplementaryItems,
  imageDna,
  dnaLoading,
  dnaError,
  onReExtract,
  onInsertClothingAsReference,
  onUsePrompt,
  onGenerateVideo,
  onAssetToRef,
  onSendToLongVideo,
  onSendToLongVideoV2,
  onSetPrompt,
  onError,
  onSuccess,
  panelName = 'Erotic',
  durationLimitHint,
}: EroticCreationPanelProps) {
  // ── 内部状态：分析中、结果列表 ────────────────────────────────────────────
  const [eroticAnalyzing, setEroticAnalyzing] = useState(false);
  const [eroticPrompts, setEroticPrompts] = useState<string[]>([]);
  // ── 自定义主题文本 + 当前激活的 Skill ID ─────────────────────────────────
  const [customThemeText, setCustomThemeText] = useState<string>('');
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);

  // 当前激活 Skill 的 userHint（供系列工作台使用：10 集 / 自定义主题的系列主题）
  const activePresetUserHint = SKILL_PRESETS.find(p => p.id === activeSkillId)?.userHint ?? '';

  // ── 当 count 变化时，同步补充项数组长度 ──────────────────────────────────
  useEffect(() => {
    setSupplementaryItems((prev) => {
      if (prev.length === eroticCount) return prev;
      if (prev.length < eroticCount) {
        return [...prev, ...Array(eroticCount - prev.length).fill('')];
      }
      return prev.slice(0, eroticCount);
    });
  }, [eroticCount, setSupplementaryItems]);

  // ── 套用 Skill 触发器 ──────────────────────────────────────────────────────
  const applySkillPreset = useCallback(
    (preset: SkillPreset) => {
      setDuration(preset.duration);
      setEroticCount(preset.count);
      setEroticLevel(preset.level);
      // 自定义主题系列：显示文本输入区，等待用户输入完整主题后点「应用主题」写回父页面
      if (preset.id === 'custom-theme') {
        setActiveSkillId(preset.id);
        onSuccess(`已选择「${preset.label}」，请在下方输入完整主题内容（${preset.duration >= 120 ? `${preset.duration / 60}分钟` : `${preset.duration}秒`} × ${preset.count}条）`);
      } else {
        setActiveSkillId(null);
        onSuccess(`已套用「${preset.label}」：${preset.duration >= 120 ? `${preset.duration / 60}分钟` : `${preset.duration}秒`} × ${preset.count}条`);
      }
    },
    [setDuration, setEroticCount, setEroticLevel, onSuccess],
  );

  // ── 应用自定义主题：把用户输入的主题文本 + Skill 模板拼成完整 prompt ───────
  const applyCustomTheme = useCallback(() => {
    const themeText = customThemeText.trim();
    if (!themeText) {
      onError('请先输入完整的主题内容');
      return;
    }
    const preset = SKILL_PRESETS.find(p => p.id === 'custom-theme');
    if (!preset) return;
    // 把主题文本嵌入 Skill 模板，生成完整提示词
    const composed = `${preset.userHint}\n\n【完整主题】\n${themeText}\n\n要求：严格按照上述主题生成系列大纲与每集分镜，主体外观严格遵循参考图，每集独立成段且剧情连贯递进。`;
    if (onSetPrompt) {
      onSetPrompt(composed);
      onSuccess(`已应用自定义主题：${themeText.slice(0, 20)}${themeText.length > 20 ? '...' : ''}`);
      setActiveSkillId(null);
      setCustomThemeText('');
    } else {
      onError('当前页面未实现 onSetPrompt 回调，无法应用自定义主题');
    }
  }, [customThemeText, onSetPrompt, onSuccess, onError]);

  // ── 取消自定义主题输入 ─────────────────────────────────────────────────────
  const cancelCustomTheme = useCallback(() => {
    setActiveSkillId(null);
    setCustomThemeText('');
  }, []);

  // ── 流式生成：结合 DNA + 用户提示词 + 补充信息 + 多样性约束 ─────────────
  const handleEroticAnalyze = useCallback(async () => {
    const uploadedImages = images.filter(img => img.path && img.path !== 'None');
    if (uploadedImages.length === 0) {
      onError('请先上传至少一张参考图');
      return;
    }
    if (!imageDna) {
      onError('请等待 DNA 提取完成');
      return;
    }
    setEroticAnalyzing(true);

    // ── 图片 base64 转换 ──────────────────────────────────────────────────
    const firstImage = uploadedImages[0];
    let imageDataUrl = firstImage.path;
    if (firstImage.path.startsWith('blob:') || firstImage.path.startsWith('http')) {
      try {
        const resp = await fetch(firstImage.path);
        const blob = await resp.blob();
        imageDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch { /* use original path */ }
    }
    try {
      imageDataUrl = await compressDataUrlIfNeeded(imageDataUrl);
      if (isHeicDataUrl(imageDataUrl)) {
        throw new Error(
          '检测到 HEIC/HEIF 格式图片。Safari canvas 无法解码此格式，AI 也无法识别。\n' +
          '请在 iPhone 设置 → 相机 → 格式中改为"兼容性最佳"（自动转 JPEG），然后重新上传图片。',
        );
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : '图片预处理失败');
      setEroticAnalyzing(false);
      return;
    }

    // ── 用户提示词 + 补充信息 ──────────────────────────────────────────────
    const userHintRaw = prompt.trim() || undefined;
    const supplementaryRaw = supplementary.trim() || undefined;

    const hasUnifiedSupplementary = supplementaryMode === 'unified' && (supplementaryRaw || '').trim().length > 0;
    const hasIndividualSupplementary = supplementaryMode === 'individual' && supplementaryItems.some(s => s.trim().length > 0);

    const UNIFIED_SUPPLEMENTARY_REQUIREMENT = hasUnifiedSupplementary
      ? `\n\n【用户自定义补充信息 - 必须严格遵守】\n${supplementaryRaw}\n要求：补充内容里如果包含剧情/事件（例如裙底偷拍、跟踪、威胁、偷情被发现），必须把它写成主线剧情动作，分配到 Shot 1–3 的实际动作链中，不能只当背景或一句旁白；姿势/道具/场景元素也必须明确出现并实际执行，不允许忽略或替换。`
      : '';

    const INDIVIDUAL_SUPPLEMENTARY_REQUIREMENT = hasIndividualSupplementary
      ? (() => {
          const lines = supplementaryItems
            .map((item, idx) => item.trim().length > 0 ? `  - 提示词 #${idx + 1}：${item.trim()}` : null)
            .filter(Boolean)
            .join('\n');
          return `\n\n【逐条自定义补充信息 - 必须严格遵守】\n${lines}\n要求：每一项必须出现在对应编号的提示词中；若该项是剧情/事件（如裙底偷拍、偷情被发现），必须作为该条的主线动作推进，不能只当背景；姿势/道具/场景必须实际执行，不允许忽略或替换。`;
        })()
      : '';

    // ── 多样性约束（仅 count ≥ 2 时启用，避免单条空约束）──────────────────
    const DIVERSITY_CONSTRAINT = eroticCount >= 2
      ? `\n\n【多样性约束 - 必须严格执行】
1. 姿势多样性：每条提示词必须从不同角度/不同姿势切入，禁止所有镜头都围绕同一道具。
2. 5种射精方式轮换：必须在 5 种射精方式中至少出现 3 种 —— (a) 口爆 (b) 内射 creampie (c) 后入射臀部 (d) 射胸部 (e) 颜射 facial。每条提示词随机抽取一种作为唯一射精，5 种之间均匀分布。
3. 最后一个镜头统一为射精收尾：最后一个 [Shot N] 必须是射精瞬间 + 女性高潮反应的合并镜头。严禁单独出现「事后展示/衣衫不整/精液残留/半裸靠椅背/餍足表情」这种收尾镜头。
4. 分镜结构：倒数第二个镜头是持续抽插/高潮前奏，最后一个镜头立即转入射精收尾（高潮 → 射精 → 精液溢出/覆盖）。`
      : '';

    // ── 首帧约束（统一口径：参考图只锚定外观，绝不作为开场画面）──────────────────────────
    // 【2026-10-22 修复】原先默认注入的是正向「首帧锚点」（"[Shot 1] 必须以参考图作为首帧
    // 视觉起点 / 场景默认沿用参考图"），LLM 会照抄成 "以参考图为首帧、场景沿用参考图"，
    // 于是视频开头退化成参考图静止贴图 / 参考图场景动画，剧情迟迟不进入。
    //
    // 现在与 470 主题库（themeLibrary.ts）、后端 det16 兜底注入完全同口径：
    //   参考图只锚定外观（面部/发型/发色）→ 成片第 1 帧直接呈现 [Shot 1] 剧情场景。
    // 只有用户显式说"以参考图为首帧 / 沿用参考图场景"时才回到正向锚点。
    const anchorBlock = 构建首帧约束块(userHintRaw, supplementaryRaw, supplementaryItems);
    const anchorSep = anchorBlock ? '\n\n' : '';
    let userHint: string | undefined;
    if (userHintRaw) {
      userHint = `${anchorBlock}${anchorSep}${userHintRaw}${UNIFIED_SUPPLEMENTARY_REQUIREMENT}${INDIVIDUAL_SUPPLEMENTARY_REQUIREMENT}${DIVERSITY_CONSTRAINT}`;
    } else if (hasUnifiedSupplementary) {
      userHint = `${anchorBlock}${anchorSep}【用户自定义补充信息】\n${supplementaryRaw}${DIVERSITY_CONSTRAINT}`;
    } else if (hasIndividualSupplementary) {
      userHint = `${anchorBlock}${anchorSep}${INDIVIDUAL_SUPPLEMENTARY_REQUIREMENT}${DIVERSITY_CONSTRAINT}`;
    } else if (anchorBlock) {
      userHint = anchorBlock;
    }

    const count = eroticCount;
    setEroticPrompts(Array(count).fill(''));

    const accumulated: Record<number, string> = {};
    const t0 = performance.now();
    console.log(`[${panelName}] handleEroticAnalyze start`, {
      duration, count, level: eroticLevel, hasUserHint: !!userHintRaw, hasSupp: hasUnifiedSupplementary || hasIndividualSupplementary,
    });

    await streamGenerateH3DnaPrompt(
      {
        imageUrl: imageDataUrl,
        dna: imageDna,
        eroticLevel,
        duration: duration as 15 | 30 | 60 | 120 | 180 | 240,
        userHint,
        count,
      },
      {
        onStart: ({ index }) => { accumulated[index] = ''; },
        onDelta: ({ index, text }) => {
          accumulated[index] = (accumulated[index] ?? '') + text;
          setEroticPrompts(prev => {
            const updated = [...prev];
            while (updated.length <= index) updated.push('');
            updated[index] = accumulated[index] ?? '';
            return updated;
          });
        },
        onEnd: ({ index, prompt: p }) => {
          const fixed = normalizeEroticPrompt(p);
          accumulated[index] = fixed;
          setEroticPrompts(prev => {
            const updated = [...prev];
            while (updated.length <= index) updated.push('');
            updated[index] = fixed;
            return updated;
          });
        },
        onError: ({ index, message }) => {
          console.error(`[${panelName}] H3 stream prompt #${index + 1} failed:`, message);
          accumulated[index] = `[生成失败 #${index + 1}: ${message}]`;
          setEroticPrompts(prev => {
            const updated = [...prev];
            while (updated.length <= index) updated.push('');
            updated[index] = accumulated[index] ?? '';
            return updated;
          });
        },
        onDone: ({ successful, total }) => {
          setEroticAnalyzing(false);
          const first = Object.values(accumulated).map(normalizeEroticPrompt).find(p => p && !p.startsWith('[生成失败'));
          if (first) onUsePrompt(first, 0);
          const elapsedMs = Math.round(performance.now() - t0);
          if (successful > 0) {
            onSuccess(`已生成 ${successful}/${total} 条 H3 提示词 (${elapsedMs}ms)`);
          } else {
            onError('H3 提示词生成全部失败，请重试');
          }
        },
      },
    );
  }, [
    images, imageDna, eroticLevel, duration, eroticCount, prompt, supplementary, supplementaryMode, supplementaryItems,
    onError, onSuccess, onUsePrompt, panelName,
  ]);

  // ── 套用 Skill 触发器 + 自动开始 ─────────────────────────────────────────
  const applyPresetAndGenerate = useCallback(async (preset: SkillPreset) => {
    applySkillPreset(preset);
    // 通知父页面更新 prompt（通过临时把 userHint 写回去）
    // 这里不直接修改父页面的 prompt（受控），而是依赖后续的 prop 同步
    // 为简化：直接调用 onUsePrompt 的反向方法 — 但父页面需要自己处理
    // 所以这里只设置内部状态，prompt 通过 prop 传入
  }, [applySkillPreset]);

  // ── 触发器：把 userHint 写回父页面的 prompt ─────────────────────────────
  // 通过 onUsePrompt 的反向调用 + 父页面预订阅：这里用一个特殊的回调
  // 实际实现：父页面传入 onSkillPresetApply 回调时由父页面同步 prompt
  // 当前实现：先设值，再触发 handleEroticAnalyze

  // ── 渲染：开关行（始终可见） ──────────────────────────────────────────────
  return (
    <div className="rounded-xl bg-gradient-to-r from-pink-500/5 via-rose-500/5 to-red-500/5 border border-pink-200/50">
      {/* 开关 + Grok-4.6 模型标识 */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles size={14} className="text-pink-500" />
          <span className="text-xs font-medium text-text-primary">情色创作模式</span>
          <span className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gradient-to-r from-amber-400 to-orange-500 text-white text-[9px] font-bold shadow-sm">
            <Brain size={9} />
            Grok-4.6
          </span>
          <span className="text-[10px] text-text-tertiary hidden md:inline">NSFW 内容默认启用最强模型</span>
        </div>
        <button
          onClick={() => setEroticMode(!eroticMode)}
          className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${eroticMode ? 'bg-pink-500' : 'bg-text-tertiary'}`}
          disabled={disabled || eroticAnalyzing}
        >
          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${eroticMode ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {eroticMode && (
        <div className="space-y-3 px-3 pb-3">
          {/* ── 创作方向（3 个） ─────────────────────────────────────── */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-text-tertiary flex-shrink-0 inline-flex items-center gap-1">
              <Settings2 size={10} />
              创作方向：
            </span>
            {LEVEL_OPTIONS.map(({ value, label, gradient, hint }) => (
              <button
                key={value}
                onClick={() => setEroticLevel(value)}
                disabled={disabled || eroticAnalyzing}
                title={hint}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold bg-gradient-to-r ${gradient} text-white transition-all hover:opacity-90 disabled:opacity-50 ${
                  eroticLevel === value
                    ? 'ring-2 ring-yellow-300 shadow-md scale-105'
                    : 'opacity-60'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── 时长（6 档：15s/30s/1分钟/2分钟/3分钟/4分钟） ───────────────── */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-text-tertiary flex-shrink-0 inline-flex items-center gap-1">
              <Clock size={10} />
              视频时长：
            </span>
            {DURATION_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setDuration(opt.value)}
                disabled={disabled || eroticAnalyzing}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all hover:opacity-90 disabled:opacity-50 ${
                  duration === opt.value
                    ? 'bg-pink-500 text-white ring-2 ring-pink-300 shadow-sm'
                    : 'bg-pink-500/30 text-pink-300/80 hover:bg-pink-500/40'
                }`}
                title={opt.sub}
              >
                {opt.label}
              </button>
            ))}
            {durationLimitHint && (duration === 120 || duration === 180 || duration === 240) && (
              <span className="text-[9px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                {durationLimitHint}
              </span>
            )}
          </div>

          {/* ── 条数（5 档：3/5/10/20/30） ───────────────────────────── */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-text-tertiary flex-shrink-0 inline-flex items-center gap-1">
              <Hash size={10} />
              生成条数：
            </span>
            {COUNT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setEroticCount(opt.value)}
                disabled={disabled || eroticAnalyzing}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all hover:opacity-90 disabled:opacity-50 ${
                  eroticCount === opt.value
                    ? 'bg-rose-500 text-white ring-2 ring-rose-300 shadow-sm'
                    : 'bg-rose-500/30 text-rose-300/80 hover:bg-rose-500/40'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* ── Skill 触发器（3 个一键按钮 + 自定义主题输入区） ─────────── */}
          <div className="rounded-lg bg-white/60 border border-pink-200/60 p-2.5">
            <div className="flex items-center gap-1.5 mb-2">
              <Layers size={11} className="text-pink-500" />
              <span className="text-[10px] font-semibold text-pink-700">Skill 一键触发</span>
              <span className="text-[9px] text-pink-400/70">（点击套用时长+条数+方向）</span>
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {SKILL_PRESETS.map(preset => (
                <div key={preset.id}>
                  <SkillPresetButton
                    preset={preset}
                    disabled={disabled || eroticAnalyzing}
                    active={activeSkillId === preset.id}
                    onClick={() => applySkillPreset(preset)}
                  />
                  {/* 自定义主题：激活后展开文本输入区 */}
                  {preset.id === 'custom-theme' && activeSkillId === preset.id && (
                    <div className="mt-1.5 ml-1 rounded-lg border border-pink-300 bg-pink-50/70 p-2.5 space-y-2 animate-fade-in">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-bold text-pink-700">输入完整主题（将作为脚本生成依据）</span>
                        <button
                          onClick={cancelCustomTheme}
                          className="w-5 h-5 rounded-full bg-pink-200 text-pink-700 hover:bg-pink-300 flex items-center justify-center transition-colors"
                          title="取消"
                        >
                          <X size={11} />
                        </button>
                      </div>
                      <textarea
                        value={customThemeText}
                        onChange={(e) => setCustomThemeText(e.target.value)}
                        disabled={disabled || eroticAnalyzing}
                        rows={3}
                        placeholder="例：禁欲系女家教到学生家中补课，从最初保持距离的紧张拘谨，到被学生出其不意挑逗后渐渐沦陷，发生禁忌师生关系。每集独立成段且剧情连贯递进。"
                        className="w-full px-2.5 py-2 rounded-md text-[10px] border border-pink-300 bg-white focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-400 resize-none"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={applyCustomTheme}
                          disabled={disabled || eroticAnalyzing || !customThemeText.trim()}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-gradient-to-r from-pink-500 to-rose-500 text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                        >
                          <Wand2 size={11} />
                          应用主题并生成 {eroticCount} 条提示词
                        </button>
                      </div>
                      <p className="text-[9px] text-pink-500/80 leading-relaxed">
                        主题将自动套用为系列剧本的核心设定，并按下方「生成条数」配置的数量生成独立的 H3 提示词（默认 3 条）
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ── DNA 面板 ───────────────────────────────────────────── */}
          <ImageDnaPanel
            dna={imageDna}
            loading={dnaLoading}
            error={dnaError}
            imageUrl={images[0]?.path || images[0]?.preview || undefined}
            additionalImageUrls={images.slice(1, 6).map(img => img.preview || img.path).filter(Boolean)}
            onReExtract={onReExtract}
            onInsertAsReference={onInsertClothingAsReference}
            supplementary={supplementary}
            onSupplementaryChange={setSupplementary}
            supplementaryMode={supplementaryMode}
            onSupplementaryModeChange={setSupplementaryMode}
            supplementaryItems={supplementaryItems}
            onSupplementaryItemsChange={setSupplementaryItems}
            eroticCount={eroticCount}
          />

          {/* ── 分析按钮 ──────────────────────────────────────────── */}
          <button
            onClick={handleEroticAnalyze}
            disabled={
              disabled || eroticAnalyzing ||
              images.filter(img => img.path && img.path !== 'None').length === 0 ||
              dnaLoading || !imageDna
            }
            title={
              disabled ? '正在提交中，请稍候'
              : eroticAnalyzing ? '正在生成中，请稍候'
              : images.filter(img => img.path && img.path !== 'None').length === 0 ? '请先上传参考图'
              : dnaLoading ? 'DNA 提取中，请稍候'
              : !imageDna ? '请等待 DNA 提取完成'
              : '点击让 Grok-4.6 分析参考图并生成 H3 提示词'
            }
            className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
              eroticAnalyzing
                ? 'bg-pink-500/50 text-white/70 cursor-not-allowed'
                : (!imageDna || dnaLoading)
                ? 'bg-pink-500/30 text-white/50 cursor-not-allowed'
                : 'bg-gradient-to-r from-pink-500 via-rose-500 to-red-500 text-white hover:opacity-90 shadow-md'
            }`}
          >
            {eroticAnalyzing ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>分析中，请稍候...</span>
              </>
            ) : (
              <>
                <Sparkles size={14} />
                <span>分析参考图生成提示词（{eroticCount} 条 · {duration >= 120 ? `${duration / 60}分钟` : `${duration}秒`}）</span>
              </>
            )}
          </button>
          <p className="text-[10px] text-pink-400/80 leading-relaxed">
            将自动分析第一张参考图（DNA 提取）→ 结合选定方向与补充信息 → Grok-4.6 流式生成 H3 格式提示词
          </p>

          {/* ── 系列工作台（大纲 + 脚本 + 角色/场景/道具资产） ─────────── */}
          <SeriesWorkbench
            images={images}
            imageDna={imageDna}
            eroticLevel={eroticLevel}
            duration={duration}
            count={eroticCount}
            userHint={activePresetUserHint}
            onError={onError}
            onSuccess={onSuccess}
            onUsePrompt={(promptText, idx) => onUsePrompt(promptText, idx)}
            onGenerateVideo={(promptText, idx) => onGenerateVideo(promptText, idx)}
            onAssetToRef={onAssetToRef}
          />

          {/* ── 结果展示区 ──────────────────────────────────────────── */}
          {eroticPrompts.length > 0 && (
            <div className="pt-3 border-t border-pink-200/40">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-pink-600">✦ 已生成 {eroticPrompts.length} 条提示词</span>
                  {eroticAnalyzing && <Loader2 size={11} className="animate-spin text-pink-500" />}
                </div>
                <span className="text-[9px] text-pink-400/60">点击「生成视频」可一键提交任务</span>
              </div>
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
                {eroticPrompts.map((p, idx) => (
                  <EroticPromptCard
                    key={idx}
                    index={idx}
                    prompt={p}
                    duration={duration}
                    imagePreview={images[0]?.preview || ''}
                    imagePath={images[0]?.path || ''}
                    onUse={(promptText) => onUsePrompt(promptText, idx)}
                    onSendToLongVideo={onSendToLongVideo}
                    onSendToLongVideoV2={onSendToLongVideoV2}
                    onGenerateVideo={(promptText) => onGenerateVideo(promptText, idx)}
                    onSuccess={onSuccess}
                    onError={onError}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 子组件：Skill 触发器按钮 ───────────────────────────────────────────────

function SkillPresetButton({
  preset,
  disabled,
  active,
  onClick,
}: {
  preset: SkillPreset;
  disabled: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={preset.hint}
      className={`group flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg border transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left ${
        active
          ? 'bg-gradient-to-r from-pink-100 to-rose-100 border-pink-500 ring-2 ring-pink-400/60 shadow-sm'
          : 'bg-white border-pink-200/80 hover:border-pink-400 hover:bg-pink-50'
      }`}
    >
      <span className="flex-shrink-0 w-6 h-6 rounded-md bg-gradient-to-br from-pink-500 to-rose-500 text-white flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
        {preset.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-bold text-pink-700 truncate">{preset.label}</div>
        <div className="text-[9px] text-pink-400/80 truncate">{preset.hint}</div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className="px-1.5 py-0.5 rounded bg-pink-100 text-pink-600 text-[9px] font-medium">
          {preset.duration >= 120 ? `${preset.duration / 60}分钟` : `${preset.duration}秒`}
        </span>
        <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-600 text-[9px] font-medium">
          ×{preset.count}
        </span>
      </div>
    </button>
  );
}

// ─── 子组件：补充信息编辑 ───────────────────────────────────────────────────

function SupplementarySection({
  disabled,
  mode,
  setMode,
  supplementary,
  setSupplementary,
  supplementaryItems,
  setSupplementaryItems,
  count,
}: {
  disabled: boolean;
  mode: SupplementaryMode;
  setMode: (m: SupplementaryMode) => void;
  supplementary: string;
  setSupplementary: (v: string) => void;
  supplementaryItems: string[];
  setSupplementaryItems: React.Dispatch<React.SetStateAction<string[]>>;
  count: number;
}) {
  return (
    <div className="rounded-lg bg-white/60 border border-pink-200/60 p-2.5">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] font-semibold text-pink-700 inline-flex items-center gap-1">
          <Wand2 size={10} />
          补充姿势/道具/场景
        </span>
        <div className="flex bg-pink-100/60 rounded-md p-0.5 ml-auto">
          {(['unified', 'individual'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={disabled}
              className={`px-2 py-0.5 rounded text-[9px] font-medium transition-all ${
                mode === m
                  ? 'bg-white text-pink-600 shadow-sm'
                  : 'text-pink-500/70 hover:text-pink-700'
              }`}
            >
              {m === 'unified' ? '统一' : '逐条'}
            </button>
          ))}
        </div>
      </div>
      {mode === 'unified' ? (
        <textarea
          value={supplementary}
          onChange={(e) => setSupplementary(e.target.value)}
          disabled={disabled}
          rows={2}
          placeholder="例：女上位 + 沙发 + 窗外夜景（所有提示词必须出现）"
          className="w-full px-2 py-1.5 rounded-md text-[10px] border border-pink-200/80 bg-white focus:outline-none focus:border-pink-400 resize-none"
        />
      ) : (
        <div className="space-y-1 max-h-32 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
          {Array.from({ length: count }).map((_, idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-pink-500 text-white text-[9px] font-bold flex items-center justify-center">
                {idx + 1}
              </span>
              <input
                type="text"
                value={supplementaryItems[idx] ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setSupplementaryItems(prev => {
                    const next = [...prev];
                    while (next.length <= idx) next.push('');
                    next[idx] = v;
                    return next;
                  });
                }}
                disabled={disabled}
                placeholder={`#${idx + 1} 的姿势/道具/场景（可选）`}
                className="flex-1 px-2 py-1 rounded-md text-[10px] border border-pink-200/80 bg-white focus:outline-none focus:border-pink-400"
              />
            </div>
          ))}
        </div>
      )}
      <p className="text-[9px] text-pink-400/70 mt-1.5 leading-relaxed">
        {mode === 'unified'
          ? '所有提示词共用同一份补充（姿势/道具/场景元素必须出现）'
          : `每条提示词独立指定（#1 = 提示词 1，#2 = 提示词 2，…共 ${count} 条）`}
      </p>
    </div>
  );
}
