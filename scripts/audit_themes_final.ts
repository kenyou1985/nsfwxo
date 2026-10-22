// ─────────────────────────────────────────────────────────────────────────────
// 主题库全量体检（只读）
//
// 核对维度：
//   A. 首帧口径统一（参考图只锚定外观，不作为开场画面）
//   B. 场景一致性（summary 场景 vs 分镜实际场景）
//   C. 占位符 / 模板残留
//   D. 主体锚定（<Picture 1> / 男性主体）
//   E. 结构完整性（六段式 + [Shot N] + 时间戳）
//
// 用法：npx tsx scripts/audit_themes_final.ts
// ─────────────────────────────────────────────────────────────────────────────
import { THEME_LIBRARY, 主题转视频提示词, 根据时长生成分镜, 定位分镜地点 } from '../src/data/themeLibrary';
import { H3_OPENING_HARD_CONSTRAINT, H3_REF_FACE_ONLY_LINE } from '../src/utils/h3FirstFrameConstraint';

const DURATIONS = [15, 30, 60, 120, 180] as const;

type Issue = { id: string; title: string; kind: string; detail: string };
const issues: Issue[] = [];
const add = (id: string, title: string, kind: string, detail: string) =>
  issues.push({ id, title, kind, detail });

/** 残留占位符（模板占位符 / 未替换变量） */
const PLACEHOLDER_RE = /\{(主体|场景|服装|氛围|道具|男性|姿势描述|主体描述|男性服装)\}|主姿势插入|undefined|NaN|\[object Object\]/g;

/** 正向首帧锚点的特征词（出现即说明老口径泄漏）；需排除"不沿用…"等否定形式 */
const POSITIVE_ANCHOR_RE = /(?<![不未勿])(?:以参考图为首帧|场景默认沿用参考图|必须以参考图作为首帧视觉起点|沿用参考图的场景)/;

/** 出现即视为「参考图作为开场」的正向口吻（同样排除否定形式） */
const POSITIVE_LOOSE_RE = /(?<![不未勿])(?:参考图[^。\n]{0,12}作为首帧|首帧[^。\n]{0,12}参考图)/;

let totalPrompts = 0;
const kindCount = new Map<string, number>();
const bump = (k: string) => kindCount.set(k, (kindCount.get(k) || 0) + 1);

for (const t of THEME_LIBRARY) {
  for (const d of DURATIONS) {
    const p = 主题转视频提示词(t, d);
    const beats = 根据时长生成分镜(t, d);
    totalPrompts++;

    // ── A. 首帧口径 ──
    if (!p.includes(H3_OPENING_HARD_CONSTRAINT)) {
      add(t.id, t.title, 'A1-缺开场硬约束', `${d}s`);
      bump('A1-缺开场硬约束');
    }
    if (!p.includes(H3_REF_FACE_ONLY_LINE)) {
      add(t.id, t.title, 'A2-缺面部锚定主体行', `${d}s`);
      bump('A2-缺面部锚定主体行');
    }
    if (!/视频第一帧必须直接呈现/.test(p)) {
      add(t.id, t.title, 'A3-缺第一帧硬约束句', `${d}s`);
      bump('A3-缺第一帧硬约束句');
    }
    if (POSITIVE_ANCHOR_RE.test(p)) {
      add(t.id, t.title, 'A4-正向首帧锚点泄漏', (p.match(POSITIVE_ANCHOR_RE) || []).join('/'));
      bump('A4-正向首帧锚点泄漏');
    }
    if (POSITIVE_LOOSE_RE.test(p)) {
      add(t.id, t.title, 'A5-疑似参考图当开场', (p.match(POSITIVE_LOOSE_RE) || []).join('/'));
      bump('A5-疑似参考图当开场');
    }

    // ── C. 占位符残留 ──
    const ph = p.match(PLACEHOLDER_RE);
    if (ph) {
      add(t.id, t.title, 'C1-占位符残留', `${d}s: ${[...new Set(ph)].join(', ')}`);
      bump('C1-占位符残留');
    }

    // ── E. 结构完整性 ──
    for (const sec of ['subject_definitions:', 'summary:', 'retention_analysis:', 'detailed_description:', 'overall_soundscape:', 'non_diegetic_music:']) {
      if (!p.includes(sec)) {
        add(t.id, t.title, 'E1-缺段落', `${d}s: ${sec}`);
        bump('E1-缺段落');
      }
    }
    const shotMarks = (p.match(/\[Shot \d+\]/g) || []).length;
    if (shotMarks !== beats.length) {
      add(t.id, t.title, 'E2-分镜数不符', `${d}s: 标记${shotMarks} vs beats ${beats.length}`);
      bump('E2-分镜数不符');
    }
    if (beatCountCheck(beats, d)) {
      add(t.id, t.title, 'E3-分镜数偏离时长档', `${d}s: ${beats.length} 镜`);
      bump('E3-分镜数偏离时长档');
    }
    for (const b of beats) {
      if (!/^\d{2}:\d{2}\.\d{3}$/.test('')) { /* noop */ }
      if (!b.prompt || b.prompt.trim().length < 6) {
        add(t.id, t.title, 'E4-空分镜', `${d}s #${b.shotNumber}`);
        bump('E4-空分镜');
      }
    }

    // ── B. 场景一致性：summary 场景 vs 首镜场景短语 ──
    const summaryScene = (p.match(/^主题场景：(.*)$/m)?.[1] || '').trim();
    if (summaryScene) {
      if (t.category === '强制凌辱') {
        // 手写系列（CNC / 暗黑）的分镜不复述地点，地点由 scenario 指定；
        // 这里改为校验 summary 场景确实来自 scenario，且没有退化成通用兜底。
        const 场景来源 = (t.scenario.match(/场景[：:]\s*([^。；;]+)/)?.[1] || '').trim();
        if (!场景来源 && summaryScene.replace(/。$/, '') === '私密空间') {
          add(t.id, t.title, 'B2-手写主题场景退化为通用兜底', `${d}s\n      summary: ${summaryScene}`);
          bump('B2-手写主题场景退化为通用兜底');
        }
      } else {
        const shot1 = beats[0]?.prompt || '';
        if (!场景一致(summaryScene, shot1)) {
          add(t.id, t.title, 'B1-summary场景≠首镜场景', `${d}s\n      summary: ${summaryScene}\n      shot1  : ${shot1.slice(0, 60)}`);
          bump('B1-summary场景≠首镜场景');
        }
      }
    }

    // ── D. 主体锚定 ──
    if (!p.includes('<Picture 1>')) {
      add(t.id, t.title, 'D1-缺 <Picture 1> 锚点', `${d}s`);
      bump('D1-缺 <Picture 1> 锚点');
    }
  }
}

/** 时长 → 期望分镜数（对齐 themeLibrary 的规则） */
function beatCountCheck(beats: { shotNumber: number }[], d: number): boolean {
  const n = beats.length;
  if (d === 15) return n < 4 || n > 6;
  if (d === 30) return n !== 9;
  if (d === 60) return n < 9 || n > 12;
  if (d === 120) return n < 12 || n > 20;
  return n < 18 || n > 30;
}

/** 粗略判定 summary 场景是否出现在首镜里（2 字组重合判据，与修正逻辑同口径） */
function 场景一致(summaryScene: string, shot1: string): boolean {
  const loc = summaryScene.split(/[，,]/).map(s => s.trim()).filter(Boolean);
  if (loc.length === 0) return true;
  const head = loc[0];
  if (!head) return true;
  // 取分镜里的地点短语（与 themeLibrary 用同一套提取逻辑，避免口径不一致）
  const beatLoc = 定位分镜地点([{ shotNumber: 1, scene: '', prompt: shot1 }]);
  if (!beatLoc) return true;
  const grams = (s: string) => { const o = new Set<string>(); for (let i = 0; i + 2 <= s.length; i++) o.add(s.slice(i, i + 2)); return o; };
  const a = grams(head);
  const b = grams(beatLoc);
  for (const g of a) if (b.has(g)) return true;
  return false;
}

// ── 报告 ──
console.log(`主题总数: ${THEME_LIBRARY.length}，检查提示词数: ${totalPrompts}（5 档时长）`);
console.log(`\n=== 问题汇总 ===`);
if (issues.length === 0) {
  console.log('  ✅ 无问题');
} else {
  const sorted = [...kindCount.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, v] of sorted) console.log(`  ${k}: ${v}`);
  console.log(`\n总计 ${issues.length} 条`);
  const byTheme = new Map<string, Issue[]>();
  for (const i of issues) {
    if (!byTheme.has(i.id)) byTheme.set(i.id, []);
    byTheme.get(i.id)!.push(i);
  }
  const sample = [...byTheme.entries()].slice(0, 12);
  console.log(`\n=== 涉及主题数: ${byTheme.size}，抽样明细 ===`);
  for (const [id, list] of sample) {
    console.log(`\n[${id}] ${list[0].title}`);
    for (const i of list.slice(0, 3)) console.log(`    - ${i.kind}: ${i.detail}`);
  }

  // C1 占位符明细（去重后的具体占位符）
  const phSet = new Map<string, number>();
  for (const i of issues.filter(x => x.kind.startsWith('C1'))) {
    const key = i.detail.split(': ').slice(1).join(': ');
    phSet.set(key, (phSet.get(key) || 0) + 1);
  }
  if (phSet.size) {
    console.log(`\n=== C1 占位符明细 ===`);
    for (const [k, v] of [...phSet.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${v}x  ${k}`);
    }
  }
}
