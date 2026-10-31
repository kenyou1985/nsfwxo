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
  let out = line
    .replace(/\bOtherwise I have to\b[^.]*\.?/gi, '')
    .replace(/\bSHOT\s+\d+\s+\d{2}:\d{2}\s*[-–]\s*\d{2}:\d{2}\s*\|[^.]*\.?/gi, '')
    .replace(/\bSHOT\s+\d+\s*[:：][^.]*\.?/gi, '');
  out = out
    .replace(/\*{2,}/g, '')
    .replace(/\.\s*\./g, '.')
    .replace(/\b(\w+)\s+\1\b/gi, '$1')
    .replace(/\bthe\s+the\s+/gi, 'the ')
    .replace(/\b(?:spinning|spins?)\s+(her|him)\b/gi, 'moves $1')
    .replace(/\bturns?\s+(her|him)\s+back\s+to\b/gi, 'repositions with $1 back to')
    .replace(/\bturns?\s+(her|him)\s+to\s+face\b/gi, 'repositions $1 to face')
    .replace(/\bturns?\s+around\b/gi, 'repositions')
    .replace(/\bturns?\s+to\b/gi, 'repositions toward')
    .replace(/\bsilhouette\b/gi, 'him')
    .replace(/[\u201c\u201d]/g, '')
    .replace(/\bno restoration\b/gi, 'never reset')
    .replace(/\bskirt-skirted\b/gi, 'skirted')
    .replace(/\bskirt\s+skirt\b/gi, 'skirt')
    .replace(/\bMuffled\s*:\s*He\s*:\s*/gi, '')
    .replace(/\bHe,\s*close to her ear\s*:\s*/gi, '')
  return out;
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

function normalizeWardrobe(line: string, ctx: H3CanonicalCtx): string {
  const w = String(ctx.wardrobe || '').toLowerCase();
  let s = line;
  if (/red low-cut shirt/.test(w)) {
    s = s.replace(/\bred\s+(?:low-cut\s+)?(?:blouse|shirt|top)\b/gi, 'red low-cut shirt');
  }
  if (/white ultra-mini skirt/.test(w)) {
    s = s.replace(/\bwhite\s+(?:ultra[-\s]?)?(?:mini|micro|super[-\s]?mini)(?:[-\s]?skirt)?(?![- ]?skirted)\b/gi, 'white ultra-mini skirt')
      .replace(/\bwhite\s+mini\b/gi, 'white ultra-mini skirt')
      .replace(/\bthe\s+mini\b/gi, 'the white ultra-mini skirt');
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
    // 只替换 Scene 这一句（到句号为止），绝不吞掉后面的 Only one man / Clothing 规则。
    t = t.replace(/Scene:[\s\S]*?\.(?=\s*(?:Only one man|Clothing, undressing|Never reset|\n|$))/gi, `${scene.replace(/\.$/, '')}.`);
    // 没有句号的 Scene 行：只到行尾，不跨行。
    t = t.replace(/Scene:[^\n.]*(?=\n|$)/gi, `${scene.replace(/\.$/, '')}`);
    if (!/Scene:\s*the theme's location progression/i.test(t)) issues.push('scene-missing');
  }

  // 2) 分镜区：统一清理 + 地点归并 + 旁白尾巴
  const ddStart = t.indexOf('detailed_description:');
  const ddEnd = t.indexOf('overall_soundscape:');
  if (ddStart >= 0 && ddEnd > ddStart) {
    const dd = t.slice(ddStart, ddEnd);
    const rawShots = dd.split('\n').filter((l) => /^\[Shot\s+\d+\]/.test(l.trim()));
    const protect = (line: string, fn: (x: string) => string) =>
      line.split(/(<d>[\s\S]*?<\/d>)/g).map((p) => (/^<d>/.test(p) ? p : fn(p))).join('');

    let cleaned = rawShots.map((line) => {
      let s2 = protect(line, cosmetic);
      s2 = protect(s2, (x) => normalizeLocations(x, ctx));
      s2 = protect(s2, (x) => normalizeWardrobe(x, ctx));
      s2 = s2.replace(/\bthe\s+the\s+/gi, 'the ');
      s2 = dropOrphanTail(s2);
      return s2;
    });

    // 3) 脱衣后：不得回穿；纯跟踪镜头丢弃
    const stripIdx = cleaned.findIndex((s2) => STRIP_RE.test(s2));
    if (stripIdx >= 0) {
      cleaned = cleaned.map((s2, k) => {
        if (k <= stripIdx) return s2;
        const fixed = s2.replace(DRESS_RE, 'fully nude').replace(/Fully clothed\.?/gi, 'Both are fully nude; no clothing on either body.');
        if (!STRONG_SEX_RE.test(fixed) && /\b(?:phone|stalking|follow\w*|alley|filming)\b/i.test(fixed)) {
          issues.push('post-nude-regression-dropped');
          return '';
        }
        return fixed;
      }).filter(Boolean);
    }

    // 4) 绑定/性行为不得早于最终地点
    if (ctx.finalLoc && ctx.locs.length > 1) {
      const f = ctx.finalLoc.replace(/^the\s+/i, '');
      const finalRe = new RegExp(`\\b${f.split(/\s+/).join('\\s+')}\\b`, 'i');
      const finalAt = cleaned.findIndex((s2) => finalRe.test(s2) || (/construction site/i.test(f) && /scaffold/i.test(s2)));
      if (finalAt > 0) {
        const before = cleaned.slice(0, finalAt);
        const after = cleaned.slice(finalAt);
        const moved = before.filter((s2) => STRONG_SEX_RE.test(s2));
        if (moved.length) {
          cleaned = [...before.filter((s2) => !STRONG_SEX_RE.test(s2)), ...after, ...moved];
          issues.push('sex-before-final-moved');
        }
      }
      // 3c) 到达最终地点后不得再出现旧地点
      let reached = false;
      cleaned = cleaned.map((s2) => {
        if (finalRe.test(s2) || (/construction site/i.test(f) && /scaffold/i.test(s2))) { reached = true; return s2; }
        if (reached && /\b(?:alley|street|road|sidewalk)\b/i.test(s2)) {
          issues.push('post-arrival-location-fixed');
          return s2.replace(/\b(?:the\s+)?(?:alley|street|road|sidewalk)\b/gi, `the ${f}`);
        }
        return s2;
      });
    }

    // 重编分镜号 + 6 秒时间戳
    const body = cleaned.map((s2, i) => {
      const rest = s2.replace(/^\[Shot\s+\d+\]\s*/, '').replace(/^\d{2}:\d{2}\.\d{3}\s*/, '');
      const sec = i * 6;
      const stamp = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}.000`;
      return `[Shot ${i + 1}] ${stamp} ${rest}`;
    }).join('\n');
    t = t.slice(0, ddStart) + `detailed_description:\n${body}\n\n` + t.slice(ddEnd);
  }

  // 5) 去重音频块/speaker_mapping
  const _beforeBlocks = t;
  t = dedupeBlocks(t);
  if (t !== _beforeBlocks) issues.push('blocks-deduped');

  // 5b) <d> 内混入英文 → 丢弃该台词块（中文台词才朗读，英文会变火星语）
  t = t.replace(/<d>([\s\S]*?)<\/d>/g, (m, inner) => {
    const txt = String(inner).replace(/^\s*\[[^\]]+\]\s*/, '');
    return /[A-Za-z]/.test(txt) ? '' : m;
  });

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
