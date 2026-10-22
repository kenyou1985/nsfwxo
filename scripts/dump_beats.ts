// 打印若干主题的完整分镜，人工确认"地点"在句中的出现形态
import { THEME_LIBRARY, 根据时长生成分镜 } from '../src/data/themeLibrary';

const IDS = process.argv[2] ? process.argv[2].split(',') : ['theme_001', 'theme_014', 'theme_229', 'theme_424'];
for (const id of IDS) {
  const t = THEME_LIBRARY.find(x => x.id === id);
  if (!t) { console.log(`!! ${id} 不存在`); continue; }
  console.log(`\n${'='.repeat(90)}`);
  console.log(`[${t.id}] ${t.title}  (${t.category})`);
  console.log(`description: ${t.description}`);
  console.log(`scenario   : ${t.scenario}`);
  console.log('-' .repeat(90));
  for (const b of 根据时长生成分镜(t, 30)) {
    console.log(`  #${b.shotNumber} [${b.scene}]`);
    console.log(`      ${b.prompt}`);
  }
}
