// 逐条核对"地点改写"是否正确：打印主题文本 + 派生场景 + 分镜地点
import { THEME_LIBRARY, 根据时长生成分镜 } from '../src/data/themeLibrary';

const IDS = process.argv[2].split(',');
for (const id of IDS) {
  const t = THEME_LIBRARY.find(x => x.id === id);
  if (!t) { console.log(`!! ${id} 不存在`); continue; }
  const beats = 根据时长生成分镜(t, 30);
  const s1 = beats[0]?.prompt || '';
  const loc = (s1.match(/走入([^，。]{2,14}?)(?=展示身材|缓步|登场|亮相|站定|进入|来到|推开|走向|靠近|坐下|躺|，|。)/)
    || s1.match(/在([^，。]{2,14}?)(?=[中里内上]|缓慢|面对|优雅|侧身|，|。)/) || [])[1] || '';
  console.log(`\n[${t.id}] ${t.title} (${t.category})`);
  console.log(`  desc    : ${t.description}`);
  console.log(`  scenario: ${t.scenario}`);
  console.log(`  分镜地点: ${loc}`);
  console.log(`  首镜    : ${s1.slice(0, 110)}`);
}
