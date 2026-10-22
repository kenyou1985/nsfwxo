import { THEME_LIBRARY, 主题转视频提示词, 根据时长生成分镜 } from '../src/data/themeLibrary';

let fileDup = 0;
let fileTotal = 0;
const samples: string[] = [];
for (const t of THEME_LIBRARY) {
  for (const b of t.beat30s ?? []) {
    fileTotal++;
    const heads = b.prompt.split(/[，,]/).map((s) => s.trim()).filter((s) => /镜头$/.test(s));
    if (heads.length > 1) {
      fileDup++;
      if (samples.length < 6) samples.push(`FILE ${t.id} Shot${b.shotNumber}: ${b.prompt.slice(0, 60)}`);
    }
  }
}
console.log(`文件 beat30s 总数 ${fileTotal}，双前缀 ${fileDup}`);
samples.forEach((s) => console.log('  ' + s));

const p = 主题转视频提示词(THEME_LIBRARY[0], 30);
console.log('\n误判检查 —— 正则 沿用参考图的场景 命中:', /沿用参考图的场景/.test(p));
console.log('  实际句子:', p.match(/retention_analysis:\n(.*)/)?.[1]?.slice(0, 90));

const b = 根据时长生成分镜(THEME_LIBRARY[0], 30);
b.forEach((x, i) => console.log(`  Shot${i + 1} heads=${JSON.stringify(x.prompt.split(/[，,]/).map((s) => s.trim()).filter((s) => /镜头$/.test(s)))} :: ${x.prompt.slice(0, 34)}`));

const 服装对应场景: Array<[RegExp, string]> = [
  [/修女/, '教堂'], [/比基尼|泳装|泳池|海边|沙滩/, '泳池'], [/学生|JK|校服|水手|校园|教室/, '教室'],
];
const 场景关键词库: Array<[RegExp, string]> = [
  [/卧室|床|私密|玫瑰|花瓣/, '私密卧室'], [/教堂|修道院|祈祷|忏悔|神父/, '教堂'],
  [/泳池|海边|沙滩|游泳/, '户外泳池'], [/雪|雪山|雪地|冰原/, '雪原'], [/巷子|暗巷/, '暗巷'],
  [/图书馆|书房|书/, '图书馆'],
];
const m1 = (text: string, lib: Array<[RegExp, string]>) => {
  for (const [re, v] of lib) if (re.test(text)) return v;
  return '(无)';
};
for (const id of ['卧室晨光比基尼', '海边礁石', '古镇小巷', '雪纺内衬', '雪女传说', '图书馆闭馆后强制', '泳池边比基尼']) {
  console.log(`  「${id}」 服装对应场景=${m1(id, 服装对应场景)}  场景关键词库=${m1(id, 场景关键词库)}`);
}