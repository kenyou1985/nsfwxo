import { THEME_LIBRARY, 根据时长生成分镜 } from '../src/data/themeLibrary';

// 抓「在/于 + 地点 + 方位后缀」的完整短语（含 中/里/边/上/前/旁/内/处）
const PLACE_TAIL = /^(.*?)([中里边上前后旁内处台面地板毯墙顶层角落地面])/;
const LOC = /(?:在|于|来到|进入|走进|回到|靠近)([\u4e00-\u9fa5]{2,12}?[中里边上前后旁内处])/g;

const freq = new Map<string, Set<string>>();
for (const t of THEME_LIBRARY) {
  const beats = 根据时长生成分镜(t, 30);
  for (const b of beats) {
    for (const m of b.prompt.matchAll(LOC)) {
      const s = m[1];
      if (!freq.has(s)) freq.set(s, new Set());
      freq.get(s)!.add(t.id);
    }
  }
}
const rows = [...freq.entries()].sort((a, b) => b[1].size - a[1].size);
console.log(`带方位后缀的地点短语: ${rows.length} 种`);
rows.forEach(([k, v]) => console.log(`  ${k} → ${v.size}主题`));