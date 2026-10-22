// 打印一个主题的完整 H3 提示词（端到端验收）
import { THEME_LIBRARY, 主题转视频提示词 } from '../src/data/themeLibrary';

const id = process.argv[2] || 'theme_001';
const d = (Number(process.argv[3]) || 30) as 15 | 30 | 60 | 120 | 180;
const t = THEME_LIBRARY.find(x => x.id === id);
if (!t) { console.error('主题不存在'); process.exit(1); }
console.log(主题转视频提示词(t, d));
