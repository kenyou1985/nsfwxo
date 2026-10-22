import { THEME_LIBRARY, 根据时长生成分镜 } from '../src/data/themeLibrary';

// 更严格地抽取地点短语：排除身体部位/动作类误报
const BODY = /臀部|胸部|乳房|腰|腿|脚|手|身|头|眼|嘴|脸|腹|胯|背|肩|颈|指|臂|膝|臀|乳|阴茎|阴部|穴|喉|心|发|皮肤|肌肤|身体|大腿|小腿|屁股|腹肌|胸肌|腹|档|身下|身前|身后/;
const ACTION = /搏动|挣扎|缓|慢|快|用力|猛烈|配合|握住|缠绵|后入|抽插|插入|深喉|承受|前进|移动|旋转|颤抖|并|一起|同时|背景|前方|上方|下方|里面|外面|表面|过程中|之后|之前|时|中]/;

const LOC = /(?:在|于|来到|进入|走进|回到|靠近)([\u4e00-\u9fa5]{2,10}?)(?=中|里|前|旁|内|处|边|上|下|，|,|。|的|缓|完|褪|解|展|回|双|手|身|躺|坐|趴|蹲|站|背|靠|躺|趴)/g;

const freq = new Map<string, Set<string>>();
for (const t of THEME_LIBRARY) {
  const beats = 根据时长生成分镜(t, 30);
  for (const b of beats) {
    for (const m of b.prompt.matchAll(LOC)) {
      const s = m[1];
      if (s.length < 2) continue;
      if (BODY.test(s) || ACTION.test(s)) continue;
      if (!freq.has(s)) freq.set(s, new Set());
      freq.get(s)!.add(t.id);
    }
  }
}

const rows = [...freq.entries()].sort((a, b) => b[1].size - a[1].size);
console.log(`候选地点短语: ${rows.length} 种`);
rows.forEach(([k, v]) => console.log(`  ${k} → ${v.size} 主题`));