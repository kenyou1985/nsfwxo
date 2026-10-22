// 列出场景派生为"私密空间"兜底的主题（说明标题/描述里的场景线索没被关键词库覆盖）
import { THEME_LIBRARY, 主题转视频提示词 } from '../src/data/themeLibrary';

const rows = THEME_LIBRARY.map(t => {
  const p = 主题转视频提示词(t, 30);
  const scene = (p.match(/^主题场景：(.*)$/m)?.[1] || '').trim();
  return { id: t.id, title: t.title, category: t.category, scene, desc: t.description };
});

const fb = rows.filter(r => r.scene === '私密空间。');
console.log(`落到"私密空间"兜底的主题: ${fb.length} / ${rows.length}\n`);
for (const r of fb) {
  console.log(`[${r.id}] ${r.title}  (${r.category})`);
  console.log(`      ${r.desc.slice(0, 70)}`);
}
