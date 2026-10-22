import { THEME_LIBRARY, 根据时长生成分镜 } from '../src/data/themeLibrary';

// 统计所有分镜里出现的「地点短语」分布
const LOC = /(?:在|于)([\u4e00-\u9fa5]{2,10}?)(?=中|里|前|旁|内|处|边|上|下|，|,|。|的|缓|完|褪|解|展|回|解)/g;
const freq = new Map<string, number>();
const perTheme = new Map<string, Set<string>>();

for (const t of THEME_LIBRARY) {
  const beats = 根据时长生成分镜(t, 30);
  const set = new Set<string>();
  for (const b of beats) {
    for (const m of b.prompt.matchAll(LOC)) {
      const s = m[1];
      if (s.length < 2) continue;
      set.add(s);
      freq.set(s, (freq.get(s) || 0) + 1);
    }
  }
  perTheme.set(t.id, set);
}

console.log(`不同地点短语种类: ${freq.size}`);
const top = [...freq.entries()].sort((a, b) => b[1] - a[1]);
top.slice(0, 60).forEach(([k, v]) => console.log(`  ${k} ×${v}`));
console.log(`\n只出现一次的地名: ${top.filter(([, v]) => v === 1).length}`);

// 每主题的地名数量
const counts = new Map<number, number>();
for (const [, s] of perTheme) counts.set(s.size, (counts.get(s.size) || 0) + 1);
console.log('\n每主题地点短语种类数分布:', [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}种→${v}主题`).join('  '));