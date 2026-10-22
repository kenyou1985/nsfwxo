import { THEME_LIBRARY, 根据时长生成分镜 } from '../src/data/themeLibrary';

// 抽样每个分类的前 2 个主题的 beat30s 全文，用于设计"详细化"规则
const cats = ['纯展示露出', '轻情色', '纯性爱', '角色扮演', '户外野战', '运动健身', '多人派对', '女同情欲', '魔幻奇幻', '奇异猎奇', 'SM重口', '强制凌辱'];
for (const cat of cats) {
  const list = THEME_LIBRARY.filter((t) => t.category === cat);
  const t = list[0];
  const beats = 根据时长生成分镜(t, 30);
  console.log(`\n########## ${cat} — [${t.id}] ${t.title} ##########`);
  beats.forEach((b) => console.log(`  S${b.shotNumber}: ${b.prompt}`));
  if (list[1]) {
    const b2 = 根据时长生成分镜(list[1], 30);
    console.log(`  --- 同类第二例 [${list[1].id}] ${list[1].title} ---`);
    b2.forEach((b) => console.log(`  S${b.shotNumber}: ${b.prompt}`));
  }
}