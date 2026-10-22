// 批量体检主题库（只读审计，不修改任何文件）
import { THEME_LIBRARY, 主题转视频提示词, 根据时长生成分镜 } from '../src/data/themeLibrary';

type Row = {
  id: string; title: string; category: string; intensity: string; multiRef: boolean;
  scene: string; outfit: string; props: string; atmosphere: string; male: string;
  shot1: string; shotCount: number; prompt: string;
};

const rows: Row[] = THEME_LIBRARY.map((t) => {
  const p = 主题转视频提示词(t, 30);
  const beats = 根据时长生成分镜(t, 30);
  const g = (re: RegExp) => (p.match(re) || [''])[1]?.trim() ?? '';
  return {
    id: t.id, title: t.title, category: t.category, intensity: t.intensity, multiRef: t.multiRef,
    scene: g(/^主题场景：(.*)$/m),
    outfit: g(/^服装设定：(.*)$/m),
    props: g(/^道具：(.*)$/m),
    atmosphere: g(/^视频采用真实感、电影级风格，(.*?)，.*$|^视频采用真实感、电影级风格，(.*?)。/m) || '',
    male: (p.match(/男性主体（不在参考图中）[^。]*。(.*?)，保持完整着装/) || ['', ''])[1],
    shot1: beats[0]?.prompt ?? '',
    shotCount: beats.length,
    prompt: p,
  };
});

const count = (pred: (r: Row) => boolean) => rows.filter(pred).length;
const show = (label: string, pred: (r: Row) => boolean, n = 8) => {
  const hit = rows.filter(pred);
  console.log(`\n### ${label}  → ${hit.length} / ${rows.length}`);
  hit.slice(0, n).forEach((r) => console.log(`  [${r.id}] ${r.title} (${r.category})`));
};

console.log(`总主题数: ${rows.length}`);

show('场景为兜底"私密空间"', (r) => r.scene === '私密空间');
show('服装为兜底"紧身日常服装连体搭配"', (r) => r.outfit === '紧身日常服装连体搭配');
show('场景为兜底且服装也为兜底', (r) => r.scene === '私密空间' && r.outfit === '紧身日常服装连体搭配');
show('氛围为兜底"电影级光影氛围"', (r) => !r.atmosphere || r.atmosphere === '电影级光影氛围');
show('首镜为"全身远景…亮相"静态亮相', (r) => /全身远景.*亮相/.test(r.shot1));
show('首镜含特写/静态词', (r) => /特写|特写镜头|静态|定格|回眸镜头/.test(r.shot1));
show('首镜含"穿…走入"动作开场', (r) => /走入|走向|靠近|推开|拉住|转身/.test(r.shot1));
show('含道具', (r) => r.props !== '');
show('multiRef', (r) => r.multiRef);
show('分类=强制凌辱', (r) => r.category === '强制凌辱');
show('分类=魔幻奇幻', (r) => r.category === '魔幻奇幻');
show('分类=运动健身', (r) => r.category === '运动健身');
show('分类=角色扮演', (r) => r.category === '角色扮演');
show('分类=纯展示露出', (r) => r.category === '纯展示露出');
show('分类=轻情色', (r) => r.category === '轻情色');

console.log('\n=== 分类 × 首镜开头分布 ===');
const byCat = new Map<string, Map<string, number>>();
for (const r of rows) {
  const head = r.shot1.slice(0, 12);
  if (!byCat.has(r.category)) byCat.set(r.category, new Map());
  const m = byCat.get(r.category)!;
  m.set(head, (m.get(head) || 0) + 1);
}
for (const [cat, m] of byCat) {
  const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  console.log(`  ${cat} (${rows.filter((r) => r.category === cat).length}): ` + top.map(([k, v]) => `${k} ×${v}`).join(' | '));
}

console.log('\n=== 兜底场景"私密空间"的主题（全部列出） ===');
rows.filter((r) => r.scene === '私密空间').forEach((r) => console.log(`  [${r.id}] ${r.title} (${r.category}) | 服装=${r.outfit}`));

console.log('\n=== 兜底服装的主题（全部列出） ===');
rows.filter((r) => r.outfit === '紧身日常服装连体搭配').forEach((r) => console.log(`  [${r.id}] ${r.title} (${r.category}) | 场景=${r.scene}`));

console.log('\n=== 男性服装分布 ===');
const maleMap = new Map<string, number>();
rows.forEach((r) => { if (r.male) maleMap.set(r.male, (maleMap.get(r.male) || 0) + 1); });
[...maleMap.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k} ×${v}`));

console.log('\n=== 单条样例（纯展示露出 / 纯性爱 / 角色扮演） ===');
for (const cat of ['纯展示露出', '纯性爱', '角色扮演']) {
  const r = rows.find((x) => x.category === cat);
  if (r) console.log(`\n--- [${r.id}] ${r.title} ---\n${r.prompt}\n`);
}
