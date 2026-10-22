import { THEME_LIBRARY, 主题转视频提示词, 根据时长生成分镜 } from '../src/data/themeLibrary';

// 对比：summary 的「主题场景」 vs 各分镜里内嵌的场景短语
let mismatch = 0;
const rows: string[] = [];
for (const t of THEME_LIBRARY) {
  const p = 主题转视频提示词(t, 30);
  const scene = p.match(/^主题场景：(.*)$/m)?.[1] ?? '';
  const beats = 根据时长生成分镜(t, 30);
  // 找出分镜里出现的场景短语（以「在…」「于…」或结尾「…水边/镜前/大床」等）
  const beatScenes = new Set<string>();
  for (const b of beats) {
    for (const m of b.prompt.matchAll(/(?:在|于)([\u4e00-\u9fa5，、]{2,10}?)(?:中|里|前|旁|内|处|边|上|下)?[，,]/g)) {
      beatScenes.add(m[1]);
    }
  }
  // 简化判断：主题场景的核心词是否出现在分镜中
  const core = scene.split(/[，,]/)[0].trim();
  const inBeat = beats.some((b) => b.prompt.includes(core));
  if (!inBeat) {
    mismatch++;
    if (rows.length < 25) rows.push(`[${t.id}] ${t.title} (${t.category})\n    summary场景: ${scene}\n    分镜内嵌场景: ${[...beatScenes].slice(0, 4).join(' / ')}`);
  }
}
console.log(`summary 场景未出现在任何分镜中的主题: ${mismatch} / ${THEME_LIBRARY.length}`);
rows.forEach((r) => console.log('  ' + r));