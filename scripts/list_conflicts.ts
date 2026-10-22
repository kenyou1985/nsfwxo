// 列出剩余的「summary 场景 vs 分镜地点」不一致项（去重，按主题计）
import { THEME_LIBRARY, 主题转视频提示词, 根据时长生成分镜 } from '../src/data/themeLibrary';

const grams = (s: string) => { const o = new Set<string>(); for (let i = 0; i + 2 <= s.length; i++) o.add(s.slice(i, i + 2)); return o; };
const 冲突: { id: string; title: string; summary: string; beat: string }[] = [];

for (const t of THEME_LIBRARY) {
  const p = 主题转视频提示词(t, 30);
  const beats = 根据时长生成分镜(t, 30);
  const summary = (p.match(/^主题场景：(.*)$/m)?.[1] || '').trim();
  const head = summary.split(/[，,]/)[0].trim();
  const s1 = beats[0]?.prompt || '';
  const m = s1.match(/走入([^，。]{2,14}?)(?=展示身材|缓步|登场|亮相|站定|进入|来到|推开|走向|靠近|坐下|躺|，|。)/)
    || s1.match(/在([^，。]{2,14}?)(?=[中里内上]|缓慢|面对|优雅|侧身|，|。)/)
    || s1.match(/，([^，。]{2,16})，([^，。]{2,24})，(?:高清8K|4K|8K)/);
  const beat = (m ? m[1] : '').trim();
  if (!head || !beat) continue;
  const a = grams(head), b = grams(beat);
  let ok = false;
  for (const g of a) if (b.has(g)) { ok = true; break; }
  if (!ok) 冲突.push({ id: t.id, title: t.title, summary: head, beat });
}

console.log(`剩余不一致主题: ${冲突.length}`);
const bySummary = new Map<string, number>();
for (const c of 冲突) bySummary.set(c.summary, (bySummary.get(c.summary) || 0) + 1);
console.log('\n按 summary 地点分组:');
for (const [k, v] of [...bySummary.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${v.toString().padStart(4)}  ${k}`);
}
console.log('\n明细:');
for (const c of 冲突) {
  console.log(`  [${c.id}] ${c.title}: summary「${c.summary}」 vs 分镜「${c.beat}」`);
}
