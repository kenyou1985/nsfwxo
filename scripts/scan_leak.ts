// 扫描主题库分镜文案里的"内部标签泄漏"（姿势库字段名等）
import { THEME_LIBRARY, 根据时长生成分镜 } from '../src/data/themeLibrary';

const SUSPECT = [
  '主姿势插入', '主姿势抽插', '主姿势', '插入方式', '姿势描述', '姿势名称',
  '{', '}', 'undefined', 'NaN', 'null', 'TODO', '占位',
  '场景位于', 'XXX', 'xxx',
];

const hits = new Map<string, number>();
const samples = new Map<string, string>();

for (const t of THEME_LIBRARY) {
  for (const d of [15, 30, 60, 120, 180] as const) {
    for (const b of 根据时长生成分镜(t, d)) {
      for (const s of SUSPECT) {
        if (b.prompt.includes(s)) {
          hits.set(s, (hits.get(s) || 0) + 1);
          if (!samples.has(s)) {
            const i = b.prompt.indexOf(s);
            samples.set(s, `[${t.id}] ${b.prompt.slice(Math.max(0, i - 30), i + 40)}`);
          }
        }
      }
    }
  }
}

console.log('=== 疑似泄漏标记统计 ===');
for (const [k, v] of [...hits.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${v.toString().padStart(6)}  ${k}`);
  console.log(`          └─ ${samples.get(k)}`);
}

// 统计"进行 X 姿势"这类带空格的姿势拼接形态
let spaced = 0;
let spacedSample = '';
for (const t of THEME_LIBRARY) {
  for (const d of [15, 30, 60] as const) {
    for (const b of 根据时长生成分镜(t, d)) {
      if (/进行\s+\S+\s+姿势/.test(b.prompt) || /切换到\s+\S+\s+姿势/.test(b.prompt)) {
        spaced++;
        if (!spacedSample) {
          const i = b.prompt.search(/(进行|切换到)\s+\S+\s+姿势/);
          spacedSample = `[${t.id}] ${b.prompt.slice(i, i + 40)}`;
        }
      }
    }
  }
}
console.log(`\n带空格的姿势拼接: ${spaced} 处`);
console.log(`  └─ ${spacedSample}`);
