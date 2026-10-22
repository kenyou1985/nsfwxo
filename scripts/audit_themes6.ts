import { THEME_LIBRARY, 主题转视频提示词, 根据时长生成分镜 } from '../src/data/themeLibrary';

// 假设：分镜里内嵌的场景短语（"在泳池碧蓝水边"、"在老上海弄堂"）才是唯一真理。
// 试从分镜文本中抽出最高频地点短语，作为主题场景。

const LOC = /(?:在|于|来到|进入|走进|回到)([\u4e00-\u9fa5]{2,12}?)(?:中|里|前|旁|内|处|边|上|下|之间|中央|尽头)?(?=[，,。、])/g;

function extractScene(beats: { prompt: string }[]): { scene: string; count: number; total: number } {
  const freq = new Map<string, number>();
  for (const b of beats) {
    const seen = new Set<string>();
    for (const m of b.prompt.matchAll(LOC)) {
      const s = m[1];
      if (s.length < 3) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      freq.set(s, (freq.get(s) || 0) + 1);
    }
  }
  let best = '';
  let bestN = 0;
  for (const [k, v] of freq) if (v > bestN || (v === bestN && k.length > best.length)) { best = k; bestN = v; }
  return { scene: best, count: bestN, total: beats.length };
}

let covered = 0;
const weak: string[] = [];
const samples: string[] = [];
for (const t of THEME_LIBRARY) {
  const beats = 根据时长生成分镜(t, 30);
  const r = extractScene(beats);
  if (r.count >= 3) covered++;
  else weak.push(`[${t.id}] ${t.title} (${t.category}) 命中${r.count}/${r.total} → "${r.scene}"`);
  if (samples.length < 12) {
    const p = 主题转视频提示词(t, 30);
    samples.push(`[${t.id}] ${t.title}\n    抽出的场景: ${r.scene} (${r.count}/${r.total})\n    现在的summary: ${p.match(/^主题场景：(.*)$/m)?.[1]}`);
  }
}
console.log(`分镜内嵌场景可提取(≥3次命中)的主题: ${covered} / ${THEME_LIBRARY.length}`);
console.log('\n--- 样例 ---');
samples.forEach((s) => console.log('  ' + s));
console.log('\n--- 命中不足（需 fallback） ---');
weak.slice(0, 20).forEach((s) => console.log('  ' + s));
console.log(`  ... 共 ${weak.length} 条`);