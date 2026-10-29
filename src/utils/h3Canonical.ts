import { isModelRefusal, stripOrphanSpeech } from './h3ScriptNormalizer';

/**
 * H3 最终文本规范化/门禁层（2026-10-29）
 *
 * 设计目标：不再为单个 bug 打补丁，而是对**最终组装文本**做一次统一检查：
 *   1) 场景句统一由主题地点链重写（subject/summary 两处必须一致）
 *   2) 主题外的地点词（street/road/lot/yard/worksite）归并到最终地点
 *   3) 绑定/插入/口交/脱衣不得早于最终地点 → 自动后移
 *   4) 脱衣后不得回穿（still clothed / shirt on / skirt on → fully nude）
 *   5) 台词后的旁白残句丢弃
 *   6) 重复词、双 the、双句号、`**`、spinning/silhouette 统一清理
 *   7) AUDIO CONSTRAINTS / speaker_mapping 去重，speaker_mapping 固定在末尾
 *
 * 拒绝文本 → 返回空串（不兜底输出）。
 */

export type H3CanonicalCtx = {
  locs: string[];
  finalLoc: string;
  wardrobe?: string;
};

export type H3CanonicalResult = {
  text: string;
  issues: string[];
};

const SECTION_ORDER = [
  'subject_definitions',
  'summary',
  'retention_analysis',
  'detailed_description',
  'overall_soundscape',
  'non_diegetic_music',
  'speaker_mapping',
];

const SEX_RE = /\b(?:thrust\w*|penetrat\w*|oral|blowjob|deepthroat|fuck\w*|pound\w*|insert\w*|creampie|cock|pussy|missionary|cowgirl|doggy)\b/i;
const STRONG_SEX_RE = /\b(?:thrust\w*|penetrat\w*|blowjob|deepthroat|fuck\w*|pound\w*|creampie|cock|pussy|missionary|cowgirl|doggy)\b/i;
const STRIP_RE = /\b(?:strips? the last garment|completely nude|fully nude|no clothing remains)\b/i;
const DRESS_RE = /\b(?:still clothed|shirt (?:still )?on|skirt (?:still )?on|still dressed|clothed at the waist)\b/i;
const ORPHAN_TAIL_RE = /\b(?:begs?|warns?|pleads?|says?|answers?|commands?|orders?|snaps?|snarls?|hisses?|whispers?|murmurs?|mutters?|voice|tone|bargain\w*|strips her dignity)\b/i;

function sceneLine(ctx: H3CanonicalCtx): string {
  const locs = (ctx.locs || []).map((l) => l.replace(/^the\s+/i, '')).filter(Boolean);
  if (locs.length > 1) {
    const finalLoc = (ctx.finalLoc || locs[locs.length - 1]).replace(/^the\s+/i, '');
    return `Scene: the theme's location progression is ${locs.join(' → ')}; the walk and the following happen only in the earlier locations, and all binding and sexual acts happen only at the final location (${finalLoc}); follow only these locations in order, and do not add any location not listed.`;
  }
  if (locs.length === 1) {
    return `Scene: the ${locs[0]} described by the current theme; keep that same place from Shot 1 to the end.`;
  }
  return '';
}

function cosmetic(line: string): string {
  return line
    .replace(/\*{2,}/g, '')
    .replace(/\.\s+\./g, '.')
    .replace(/\b(\w+)\s+\1\b/gi, '$1')
    .replace(/\bthe\s+the\s+/gi, 'the ')
    .replace(/\b(?:spinning|spins?)\s+(her|him)\b/gi, 'moves $1')
    .replace(/\bsilhouette\b/gi, 'him')
    .replace(/\bno restoration\b/gi, 'never reset');
}

function normalizeLocations(line: string, ctx: H3CanonicalCtx): string {
  if (!ctx.locs.length || !ctx.finalLoc) return line;
  const f = ctx.finalLoc.replace(/^the\s+/i, '');
  let s = line;
  for (const w of ['street', 'road', 'sidewalk', 'lot', 'yard', 'worksite']) {
    if (!ctx.locs.some((l) => new RegExp(`\\b${w}\\b`, 'i').test(l))) {
      s = s.replace(
        new RegExp(`\\bthe\\s+(?:abandoned\\s+|empty\\s+|open\\s+|vacant\\s+)?${w}\\b`, 'gi'),
        `the ${f}`,
      );
    }
  }
  return s;
}

function dropOrphanTail(line: string): string {
  const idx = line.lastIndexOf('</d>');
  if (idx < 0) return line;
  const head = line.slice(0, idx + 4);
  const tail = line.slice(idx + 4);
  if (!tail.trim()) return line;
  // 台词后只保留“动作/状态”短句；带说话动词、bargain、作者评价的尾巴丢弃。
  const kept = tail
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim() && !ORPHAN_TAIL_RE.test(s))
    .join(' ');
  return (head + ' ' + kept).trim();
}

/** 重建 speaker_mapping 与音频块，保证唯一且在末尾。 */
function dedupeBlocks(text: string): string {
  let t = text;
  // AUDIO CONSTRAINTS 只保留最后一块
  const blocks = [...t.matchAll(/=== AUDIO CONSTRAINTS[\s\S]*?=== END AUDIO CONSTRAINTS ===/gi)];
  if (blocks.length > 1) {
    for (let i = 0; i < blocks.length - 1; i++) {
      t = t.replace(blocks[i][0], '');
    }
    t = t.replace(/\n{3,}/g, '\n\n');
  }
  // speaker_mapping 只保留最后一条
  const spk = [...t.matchAll(/^speaker_mapping\s*:.*$/gim)];
  if (spk.length > 1) {
    for (let i = 0; i < spk.length - 1; i++) {
      t = t.replace(spk[i][0], '');
    }
    t = t.replace(/\n{3,}/g, '\n\n');
  }
  // non_diegetic_music 只保留一条
  const ndm = [...t.matchAll(/^non_diegetic_music\s*:.*$/gim)];
  if (ndm.length > 1) {
    for (let i = 0; i < ndm.length - 1; i++) {
      t = t.replace(ndm[i][0], '');
    }
  }
  return t;
}

export function canonicalizeH3(text: string, ctx: H3CanonicalCtx): H3CanonicalResult {
  const issues: string[] = [];
  let t = String(text || '').trim();
  if (!t) return { text: '', issues: ['empty'] };
  if (isModelRefusal(t)) return { text: '', issues: ['refusal'] };

  // 1) 场景句统一重写（subject_definitions / summary 两处）
  const scene = sceneLine(ctx);
  if (scene) {
    // 旧场景句可能含多个分号/重复尾巴：整段吞到 "Only one man" 或行尾，避免只换第一句。
    t = t.replace(/Scene:[\s\S]*?(?=Only one man)/gi, `${scene} `);
    t = t.replace(/Scene:[^\n]*/gi, `${scene}`);
    if (!/Scene:\s*the theme's location progression/i.test(t)) issues.push('scene-missing');
  }

  // 2) 分镜区：统一清理 + 地点归并 + 旁白尾巴
  const ddStart = t.indexOf('detailed_description:');
  const ddEnd = t.indexOf('overall_soundscape:');
  if (ddStart >= 0 && ddEnd > ddStart) {
    const dd = t.slice(ddStart, ddEnd);
    const lines = dd.split('\n');
    const shots: Array<{ line: string; i: number }> = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/^\[Shot\s+\d+\]/.test(lines[i].trim())) continue;
      let s = cosmetic(lines[i]);
      s = normalizeLocations(s, ctx);
      s = s.replace(/\bthe\s+the\s+/gi, 'the ');
      s = dropOrphanTail(s);
      lines[i] = s;
      shots.push({ line: s, i });
    }

    // 3) 脱衣后不得回穿
    const stripIdx = shots.findIndex((x) => STRIP_RE.test(x.line));
    if (stripIdx >= 0) {
      for (let k = stripIdx + 1; k < shots.length; k++) {
        let fixed = shots[k].line.replace(DRESS_RE, 'fully nude');
        if (/Fully clothed/i.test(fixed)) {
          fixed = fixed.replace(/Fully clothed\.?/gi, 'Both are fully nude; no clothing on either body.');
          issues.push('wardrobe-reset-fixed');
        }
        if (fixed !== shots[k].line) {
          lines[shots[k].i] = fixed;
          shots[k].line = fixed;
        }
        // 脱衣后仍出现纯跟踪/偷拍镜头（无性行为）→ 叙事回归，直接丢弃
        if (!STRONG_SEX_RE.test(fixed) && /\b(?:phone|stalking|follow\w*|alley|filming)\b/i.test(fixed)) {
          lines[shots[k].i] = '';
          issues.push('post-nude-regression-dropped');
        }
      }
    }

    // 4) 绑定/性行为不得早于最终地点：把早于最终地点的这类镜头后移
    if (ctx.finalLoc && ctx.locs.length > 1) {
      const f = ctx.finalLoc.replace(/^the\s+/i, '');
      const finalRe = new RegExp(`\\b${f.split(/\s+/).join('\\s+')}\\b`, 'i');
      const finalAt = shots.findIndex((x) => finalRe.test(x.line) || (/construction site/i.test(f) && /scaffold/i.test(x.line)));
      if (finalAt > 0) {
        const before = shots.slice(0, finalAt);
        const after = shots.slice(finalAt);
        const moved = before.filter((x) => SEX_RE.test(x.line));
        if (moved.length) {
          const kept = before.filter((x) => !SEX_RE.test(x.line));
          // 重建分镜序列（分镜号与时间戳最后统一重排）
          const ordered = [...kept, ...after, ...moved];
          const start = lines.findIndex((l) => /^\[Shot\s+\d+\]/.test(l.trim()));
          const end = lines.length;
          const head = lines.slice(0, start);
          const tail = lines.slice(end);
          const rebuilt = ordered.map((x) => x.line);
          lines.splice(0, lines.length, ...head, ...rebuilt, ...tail);
          issues.push('sex-before-final-moved');
        }
      }
    }

    // 重排后统一重编分镜号与 6 秒时间戳，避免移动镜头后时间倒流
    let _n = 0;
    for (let i = 0; i < lines.length; i++) {
      if (!/^\[Shot\s+\d+\]/.test(lines[i].trim())) continue;
      const rest = lines[i].replace(/^\[Shot\s+\d+\]\s*/, '').replace(/^\d{2}:\d{2}\.\d{3}\s*/, '');
      const sec = _n * 6;
      const stamp = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}.000`;
      lines[i] = `[Shot ${_n + 1}] ${stamp} ${rest}`;
      _n++;
    }
    t = t.slice(0, ddStart) + lines.join('\n') + t.slice(ddEnd);
  }

  // 4b) 分区标签前强制换行（防最后一镜吞掉 overall_soundscape）
  t = t.replace(/([^\n])(overall_soundscape\s*:)/gi, '$1\n$2');
  t = t.replace(/([^\n])(non_diegetic_music\s*:)/gi, '$1\n$2');
  t = t.replace(/([^\n])(speaker_mapping\s*:)/gi, '$1\n$2');

  // 5) 去重音频块/speaker_mapping
  const _beforeBlocks = t;
  t = dedupeBlocks(t);
  if (t !== _beforeBlocks) issues.push('blocks-deduped');

  // 6) speaker_mapping 固定在末尾
  const spkMatch = t.match(/^speaker_mapping\s*:\s*(\{.*\})$/im);
  const spk = spkMatch ? spkMatch[1] : '{"S1":"Chinese (Mandarin)_Adult_Female_Soft","S2":"Chinese (Mandarin)_Adult_Male_Low"}';
  t = t.replace(/^speaker_mapping\s*:.*$/gim, '').trim();
  t = `${t}\n\nspeaker_mapping: ${spk}`;

  // 7) 结构门禁
  for (const sec of SECTION_ORDER) {
    if (!new RegExp(`^${sec}\\s*:`, 'm').test(t)) issues.push(`missing:${sec}`);
  }

  t = t.replace(/\n{3,}/g, '\n\n').trim();
  return { text: t, issues };
}
