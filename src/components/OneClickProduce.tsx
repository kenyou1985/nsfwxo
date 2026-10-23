import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Clapperboard, Loader2, Maximize2, Video } from 'lucide-react';
import { uploadImage } from '../services/runninghub';
import { submitDaotaiVideo, pollDaotaiTask, concatDaotaiVideos } from '../services/daotai';
import { getBackendUrl } from '../services/storage';

type PanelLike = { panel_number: number; scene_description?: string; image_prompt?: string };
type ItemState = { status: 'idle' | 'running' | 'done' | 'error'; url?: string; error?: string; taskId?: string };

interface Props {
  panels: PanelLike[];
  images: (string | undefined)[];
  h3Prompts: (string | undefined)[];
  apiKey: string;
  themeTitle?: string;
  themeKey?: string;
}

const WORKFLOW_DET16 = '2110330160000516098';

function dataUrlToFile(dataUrl: string, name: string): File {
  const [meta, b64] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(meta)?.[1] || 'image/png';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], name, { type: mime });
}

type ThemeState = { items: Record<number, ItemState>; busy: boolean; finalUrl: string; error: string };
const EMPTY_THEME: ThemeState = { items: {}, busy: false, finalUrl: '', error: '' };

export function OneClickProduce({ panels, images, h3Prompts, apiKey, themeTitle, themeKey }: Props) {
  const key = themeKey || themeTitle || 'default';
  const [states, setStates] = useState<Record<string, ThemeState>>(() => {
    try {
      const raw = localStorage.getItem('nsfwxo_oneclick_states');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem('nsfwxo_oneclick_states', JSON.stringify(states)); } catch {}
  }, [states]);
  const current = states[key] || EMPTY_THEME;
  const { items, busy, finalUrl, error } = current;
  const setItems = (updater: React.SetStateAction<Record<number, ItemState>>) => {
    setStates(prev => {
      const s = prev[key] || EMPTY_THEME;
      const nextItems = typeof updater === 'function'
        ? (updater as (old: Record<number, ItemState>) => Record<number, ItemState>)(s.items)
        : updater;
      return { ...prev, [key]: { ...s, items: nextItems } };
    });
  };
  const setBusy = (v: boolean) => setStates(prev => ({ ...prev, [key]: { ...(prev[key] || EMPTY_THEME), busy: v } }));
  const setFinalUrl = (v: string) => setStates(prev => ({ ...prev, [key]: { ...(prev[key] || EMPTY_THEME), finalUrl: v } }));
  const setError = (v: string) => setStates(prev => ({ ...prev, [key]: { ...(prev[key] || EMPTY_THEME), error: v } }));
  const [portraits, setPortraits] = useState<(string | undefined)[]>([]);
  const [clarity, setClarity] = useState<number>(() => {
    const v = Number(localStorage.getItem('nsfwxo_video_clarity') || '0.2');
    return Number.isFinite(v) && v >= 0.2 && v <= 1 ? v : 0.2;
  });

  const abortRef = useRef(false);
  const imagesKey = images.map(u => u || '').join('|');

  // 图片生成后，逐格裁一张清晰头像 → H3 的 <Picture 2> 人物锚定
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const out: (string | undefined)[] = [];
      const extractLimit = Math.min(2, images.length); // 只从开头 1-2 格提取清晰人脸
      for (let i = 0; i < images.length; i++) {
        const img = i < extractLimit ? images[i] : undefined;
        if (!img) { out.push(undefined); continue; }
        try {
          const resp = await fetch(`${getBackendUrl().replace(/\/$/, '')}/api/daotai/portrait`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ image_url: img }),
          });
          const data = await resp.json().catch(() => ({}));
          out.push(data.portrait_url || data.url || undefined);
        } catch {
          out.push(undefined);
        }
      }
      // 后面的分镜基本是器官特写，共用开头提取到的人物形象照
      const shared = out.find(Boolean);
      const filled = out.map((u, i) => u || (i >= extractLimit ? shared : undefined));
      if (!cancelled) setPortraits(filled);
    };
    if (images.some(Boolean)) void run();
    return () => { cancelled = true; };
  }, [imagesKey, apiKey]);

  const start = useCallback(async (indices?: number[]) => {
    const isSingle = !!indices && indices.length === 1;
    if (busy && !isSingle) return;
    const targets = indices && indices.length ? indices : panels.map((_, i) => i);
    if (!apiKey) { setError('缺少 RunningHub API Key'); return; }
    if (!panels.length) { setError('没有分镜'); return; }
    setError('');
    setFinalUrl('');
    if (!isSingle) setBusy(true);
    abortRef.current = false;
    const init: Record<number, ItemState> = {};
    targets.forEach((i) => { init[i] = { status: 'idle' }; });
    setItems((prev) => ({ ...prev, ...init }));

    try {
      // 1) 并行提交：每格独立上传首帧 + 提交 det16，任何一格慢/失败不阻塞其他格
      const withTimeout = <T,>(p: Promise<T>, ms: number, label: string) => Promise.race([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(label + '超时')), ms)),
      ]);
      await Promise.all(targets.map(async (i) => {
        const img = images[i];
        if (!img) {
          setItems(prev => ({ ...prev, [i]: { status: 'error', error: '该分镜还没有生成图片' } }));
          return;
        }
        setItems(prev => ({ ...prev, [i]: { status: 'running' } }));
        try {
          let firstFrameUrl = img;
          if (img.startsWith('data:') || img.startsWith('blob:')) {
            let file: File;
            if (img.startsWith('data:')) {
              file = dataUrlToFile(img, `panel_${i + 1}.png`);
            } else {
              const blob = await (await fetch(img)).blob();
              file = new File([blob], `panel_${i + 1}.png`, { type: blob.type || 'image/png' });
            }
            const up = await withTimeout(uploadImage(apiKey, file), 90000, '首帧上传');
            firstFrameUrl = up.downloadUrl || up.imagePath;
          }
          if (firstFrameUrl.startsWith('/')) {
            firstFrameUrl = getBackendUrl().replace(/\/$/, '') + firstFrameUrl;
          }
          let prompt = (h3Prompts[i] || '').trim()
            || `[Shot 1] 对应<Picture 1>，${panels[i].scene_description || panels[i].image_prompt || '角色保持首帧构图'}，动作流畅，60fps，无肢体畸形，正确人体解剖，面部特征一致。`;
          // det16 target_segs=2 至少需要 3 个 [Shot]，不足时补一个收尾镜头，避免“2 分镜 < 3”直接拒绝。
          const shotCount = (prompt.match(/\[Shot\s+\d+\]/gi) || []).length;
          if (shotCount === 2) {
            prompt = prompt.replace(/\s*$/, '') + '\n[Shot 3] At 00:10.000, the same characters hold the final pose, breathing and eye movement only.';
          }
          const res = await withTimeout(submitDaotaiVideo(apiKey, prompt, {
            firstFrameUrl,
            media: portraits[i] ? [{ type: 'reference_image', url: portraits[i] }] : [],
            workflow_id: WORKFLOW_DET16,
            target_segs: 2,
            no_llm: true,
            use_bridge: false,
            duration: 15,
            resolution: clarity,
            aspect_ratio: 'match',
            shots_per_seg: 1,
          }), 90000, '视频任务提交');
          setItems(prev => ({ ...prev, [i]: { status: 'running', taskId: res.taskId } }));
        } catch (e) {
          setItems(prev => ({ ...prev, [i]: { status: 'error', error: e instanceof Error ? e.message : '提交失败' } }));
        }
      }));

      // 2) 轮询所有任务
      const deadline = Date.now() + 20 * 60 * 1000;
      while (!abortRef.current && Date.now() < deadline) {
        const snapshot = items; // stale closure guard: read from setState callback instead
        void snapshot;
        let pending = 0;
        const current = await new Promise<Record<number, ItemState>>((resolve) => {
          setItems(prev => { resolve(prev); return prev; });
        });
        for (const i of targets) {
          const it = current[i];
          if (!it || it.status === 'done' || it.status === 'error') continue;
          if (!it.taskId) { pending++; continue; }
          try {
            const st = await pollDaotaiTask(apiKey, it.taskId);
            if (st.status === 'SUCCESS') {
              const url = st.video_url || st.url || st.output?.video_url || '';
              setItems(prev => ({ ...prev, [i]: { ...prev[i], status: 'done', url } }));
            } else if (st.status === 'FAILED') {
              setItems(prev => ({ ...prev, [i]: { ...prev[i], status: 'error', error: st.message || '生成失败' } }));
            } else {
              pending++;
            }
          } catch {
            pending++;
          }
        }
        if (pending === 0) break;
        await new Promise(r => setTimeout(r, 8000));
      }

      // 3) 合成最终视频
      const finalState = await new Promise<Record<number, ItemState>>((resolve) => {
        setItems(prev => { resolve(prev); return prev; });
      });
      const urls = targets.map((i) => finalState[i]?.url).filter((u): u is string => !!u);
      if (urls.length >= 2) {
        let merged: { video_url: string } | null = null;
        let lastErr: unknown = null;
        // 六格刚完成时 8765 media 偶发还没落盘，400 时重试 3 次
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            merged = await concatDaotaiVideos(apiKey, urls);
            break;
          } catch (e) {
            lastErr = e;
            await new Promise((r) => setTimeout(r, 3000));
          }
        }
        if (merged) setFinalUrl(merged.video_url);
        else throw lastErr instanceof Error ? lastErr : new Error('最终视频合成失败');
      } else if (urls.length === 1) {
        setFinalUrl(urls[0]);
      } else {
        setError('没有成功生成的分镜视频');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '一键出片失败');
    } finally {
      if (!isSingle) setBusy(false);
    }
  }, [busy, apiKey, panels, images, h3Prompts, portraits, clarity]);

  useEffect(() => {
    const handler = () => { void start(); };
    window.addEventListener('nsfwxo:oneclick', handler);
    return () => window.removeEventListener('nsfwxo:oneclick', handler);
  }, [start]);

  const cancel = () => {
    abortRef.current = true;
    setBusy(false);
    setItems({});
    setFinalUrl('');
    setError('已取消当前出片（已提交的后台任务可能仍会继续，可重新开始）');
  };

  const concatTriedRef = useRef<Record<string, boolean>>({});
  const [concatTick, setConcatTick] = useState(0);
  const [concatBusy, setConcatBusy] = useState(false);
  // 兼容：六个分镜已完成但最终合成当时 400（media 还没落盘）→ 自动补合成一次
  useEffect(() => {
    if (busy || finalUrl) return;
    if (!panels.length) return;
    const allDone = panels.every((_, i) => items[i]?.status === 'done' && !!items[i]?.url);
    if (!allDone) return;
    if (concatTriedRef.current[key]) return;
    const urls = panels.map((_, i) => items[i]?.url).filter((u): u is string => !!u);
    if (urls.length < 2) return;
    void (async () => {
      let last: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const merged = await concatDaotaiVideos(apiKey, urls);
          concatTriedRef.current[key] = true;
          setFinalUrl(merged.video_url);
          setError('');
          return;
        } catch (e) {
          last = e;
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
      setError(last instanceof Error ? last.message : '最终视频合成失败');
      setTimeout(() => setConcatTick((t) => t + 1), 5000);
    })();
  }, [items, busy, finalUrl, panels, key, apiKey, concatTick]);

  const doneCount = Object.values(items).filter(i => i.status === 'done').length;

  return (
    <div className="mt-3 rounded-2xl border border-fuchsia-200 bg-gradient-to-b from-fuchsia-50/60 to-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Clapperboard size={14} className="text-fuchsia-500" />
          <span className="text-xs font-semibold text-fuchsia-700">一键出片 · 图生视频（det16）</span>
          <span className="text-[10px] text-fuchsia-500/80">{themeTitle || ''} · {doneCount}/{panels.length} 完成</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-text-tertiary">清晰度</span>
          <select
            value={clarity}
            onChange={(e) => {
              const v = Number(e.target.value);
              setClarity(v);
              try { localStorage.setItem('nsfwxo_video_clarity', String(v)); } catch {}
            }}
            disabled={busy}
            className="bg-white border border-fuchsia-200 rounded-lg px-1.5 py-1 text-[11px] text-fuchsia-700"
          >
            {[0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1].map((v) => (
              <option key={v} value={v}>{v.toFixed(1)}</option>
            ))}
          </select>
          {busy && (
            <button type="button" onClick={cancel} className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-500 border border-red-200 hover:bg-red-100">
              取消
            </button>
          )}
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              busy ? 'bg-fuchsia-200 text-fuchsia-500 cursor-not-allowed' : 'bg-gradient-to-r from-fuchsia-500 to-purple-600 text-white hover:opacity-90'
            }`}
          >
            {busy ? <><Loader2 size={12} className="animate-spin" /> 生成中…</> : <><Video size={12} /> 一键出片</>}
          </button>
        </div>
      </div>
      {error && (
        <div className="mb-2 flex items-start gap-1.5 text-[11px] text-red-500">
          <AlertCircle size={12} className="mt-0.5 flex-shrink-0" /> <span>{error}</span>
        </div>
      )}
      {portraits.some(Boolean) && (
        <div className="mb-2">
          <div className="text-[10px] text-fuchsia-600 mb-1">人物形象照（开头 1-3 格提取，后续分镜共用 · H3 &lt;Picture 2&gt;）</div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {portraits.slice(0, 3).map((u, i) => u ? (
              <img key={i} src={u} alt={`portrait-${i + 1}`} className="w-14 h-18 rounded-lg object-cover border border-fuchsia-200" />
            ) : null)}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {panels.map((p, i) => {
          const it = items[i];
          return (
            <div key={i} className="rounded-xl border border-border bg-white overflow-hidden">
              {it?.status === 'done' && it.url ? (
                <div className="relative">
                  <video src={it.url} controls muted playsInline className="w-full aspect-[3/4] object-cover bg-black" />
                  <button
                    type="button"
                    onClick={(e) => {
                      const v = (e.currentTarget.parentElement?.querySelector('video') as HTMLVideoElement | null);
                      if (v) { if (v.requestFullscreen) void v.requestFullscreen(); else (v as any).webkitEnterFullscreen?.(); }
                    }}
                    className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/55 text-white hover:bg-black/75"
                    title="全屏预览"
                  >
                    <Maximize2 size={12} />
                  </button>
                </div>
              ) : (
                <div className="w-full aspect-[3/4] flex flex-col items-center justify-center gap-1 bg-bg-elevated text-[10px] text-text-tertiary">
                  {it?.status === 'running' ? <Loader2 size={14} className="animate-spin text-fuchsia-500" /> : null}
                  {it?.status === 'error' ? <AlertCircle size={14} className="text-red-400" /> : null}
                  {it?.status === 'done' ? <Check size={14} className="text-green-500" /> : null}
                  <span>分镜 {p.panel_number} · {
                    it?.status === 'running' ? '生成中'
                      : it?.status === 'error' ? '失败'
                      : it?.status === 'done' ? '完成'
                      : '待提交'
                  }</span>
                  {it?.error && <span className="px-2 text-center text-red-400 line-clamp-2">{it.error}</span>}
                  {it?.taskId && <span className="text-[9px] text-text-tertiary/60 font-mono">{it.taskId}</span>}
                  {it?.status !== 'done' && it?.status !== 'running' && (
                    <button type="button" onClick={() => void start([i])} className="mt-1 px-2 py-0.5 rounded bg-fuchsia-500 text-white text-[10px]">
                      单独生成
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!finalUrl && doneCount >= 2 && doneCount === panels.length && !busy && (
        <button
          type="button"
          disabled={concatBusy}
          onClick={async () => {
            const urls = panels.map((_, i) => items[i]?.url).filter((u): u is string => !!u);
            if (urls.length < 2) { setError('分镜视频不足，无法合成'); return; }
            setError('');
            setConcatBusy(true);
            try {
              for (let attempt = 0; attempt < 5; attempt++) {
                try {
                  const merged = await concatDaotaiVideos(apiKey, urls);
                  setFinalUrl(merged.video_url);
                  return;
                } catch (e) {
                  if (attempt === 4) setError(e instanceof Error ? e.message : '最终视频合成失败');
                  await new Promise((r) => setTimeout(r, 3000));
                }
              }
            } finally {
              setConcatBusy(false);
            }
          }}
          className="w-full mt-3 py-2 rounded-lg bg-fuchsia-600 text-white text-xs font-medium hover:bg-fuchsia-700 disabled:opacity-60"
        >
          {concatBusy ? '合成中…' : '合成最终视频'}
        </button>
      )}
      {finalUrl && (
        <div className="mt-3">
          <div className="text-[11px] font-medium text-fuchsia-700 mb-1">最终合成视频</div>
          <div className="relative">
            <video src={finalUrl} controls playsInline className="w-full rounded-xl bg-black max-h-[420px]" />
            <button
              type="button"
              onClick={(e) => {
                const v = (e.currentTarget.parentElement?.querySelector('video') as HTMLVideoElement | null);
                if (v) { if (v.requestFullscreen) void v.requestFullscreen(); else (v as any).webkitEnterFullscreen?.(); }
              }}
              className="absolute top-2 right-2 p-1.5 rounded-md bg-black/55 text-white hover:bg-black/75"
              title="全屏预览"
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default OneClickProduce;
