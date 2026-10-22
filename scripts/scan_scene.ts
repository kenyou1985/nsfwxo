// 量化「主题派生场景」与「分镜内实际场景」的偏差
import { THEME_LIBRARY, 主题转视频提示词, 根据时长生成分镜 } from '../src/data/themeLibrary';

type Row = {
  id: string; title: string; category: string;
  summaryScene: string;      // 主题派生的场景（summary 里的"主题场景："）
  beatScene: string;         // 分镜首镜里的实际地点
  shot1: string;
};

const rows: Row[] = THEME_LIBRARY.map((t) => {
  const p = 主题转视频提示词(t, 30);
  const beats = 根据时长生成分镜(t, 30);
  const summaryScene = (p.match(/^主题场景：(.*)$/m)?.[1] || '').trim();
  const shot1 = beats[0]?.prompt || '';
  // 优先用显式标记
  let beatScene = (shot1.match(/（场景位于\s*([^）]*)）/) || [])[1] || '';
  if (!beatScene) {
    // 30s/60s 首镜：服装 + "走入{地点}" + 亮相
    const m2 = shot1.match(/走入([^，。]{2,16})/);
    beatScene = m2 ? m2[1] : '';
  }
  return { id: t.id, title: t.title, category: t.category, summaryScene, beatScene, shot1 };
});

console.log(`主题总数 ${rows.length}`);
console.log(`分镜里能定位到地点: ${rows.filter(r => r.beatScene).length}`);
console.log(`summary 场景: ${rows.filter(r => r.summaryScene).length}`);

// 判定冲突：summary 场景的核心地点词是否出现在分镜地点里
function 核心词(s: string): string[] {
  if (!s) return [];
  const head = s.split(/[，,]/)[0].trim();
  return (head.match(/[一-龥]{2,8}/g) || []).slice(0, 2);
}

const conflict = rows.filter(r => {
  const kw = 核心词(r.summaryScene);
  if (!kw.length) return false;
  if (!r.beatScene) return false;
  return !kw.some(k => r.beatScene.includes(k) || k.includes(r.beatScene));
});

console.log(`\n=== 场景冲突主题数: ${conflict.length} / ${rows.length} ===`);

// 冲突主题的 summary 场景是否都退化成同一个兜底值？
const bySummary = new Map<string, number>();
for (const r of conflict) bySummary.set(r.summaryScene, (bySummary.get(r.summaryScene) || 0) + 1);
console.log('\n冲突主题的 summary 场景分布 top10:');
for (const [k, v] of [...bySummary.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${v.toString().padStart(4)}  ${k}`);
}

console.log('\n=== 冲突抽样 20 条 ===');
for (const r of conflict.slice(0, 20)) {
  console.log(`[${r.id}] ${r.title} (${r.category})`);
  console.log(`    summary 场景: ${r.summaryScene}`);
  console.log(`    分镜地点    : ${r.beatScene}`);
}

// 统计：分镜地点被多少主题共用（说明 beats 是"通用模板"而非逐主题定制）
const byBeat = new Map<string, string[]>();
for (const r of rows) {
  if (!r.beatScene) continue;
  if (!byBeat.has(r.beatScene)) byBeat.set(r.beatScene, []);
  byBeat.get(r.beatScene)!.push(r.id);
}
const shared = [...byBeat.entries()].filter(([, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length);
console.log(`\n=== 分镜地点分布 ===`);
console.log(`  不同地点数: ${byBeat.size}`);
console.log(`  被多主题共用的地点数: ${shared.length}`);
for (const [k, v] of shared.slice(0, 8)) {
  console.log(`  ${v.length.toString().padStart(4)} 个主题共用地点「${k}」`);
}
