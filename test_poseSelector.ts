// 测试 poseSelector
import { pickDiversePoses, pickPoseForShot, categorizePose } from './src/utils/poseSelector';

console.log('=== Test 1: theme_504 (地下车库绑架) 6 poses ===');
const p1 = pickDiversePoses('theme_504', 6, {
  preferredCategories: ['cowgirl', 'doggy', 'oral', 'missionary', 'standing'],
  excludeCategories: ['multi', 'anal', 'toy'],
  context: 'standing',
});
for (const p of p1) {
  console.log(`  - ${p.nameZh}  [${p.categories.join(', ')}]  (ctx=${p.context})`);
}

console.log('\n=== Test 2: theme_229 (床上经典Doggy猛烈后入) 6 poses ===');
const p2 = pickDiversePoses('theme_229', 6, {
  preferredCategories: ['cowgirl', 'doggy', 'oral', 'missionary'],
  excludeCategories: ['multi', 'anal', 'toy'],
  context: 'bed',
});
for (const p of p2) {
  console.log(`  - ${p.nameZh}  [${p.categories.join(', ')}]  (ctx=${p.context})`);
}

console.log('\n=== Test 3: theme_229 with cumshot forcing for last shot ===');
const p3 = pickPoseForShot('theme_229', 8, 9, new Set(p2.map((x) => x.nameZh)), {
  preferredCategories: ['cowgirl'],
  context: 'bed',
  forceCumshot: true,
});
console.log(`  - ${p3?.nameZh}  [${p3?.categories.join(', ')}]`);

console.log('\n=== Test 4: 多次调用 theme_504，每次姿势都不同 ===');
for (let i = 0; i < 3; i++) {
  const ps = pickDiversePoses('theme_504', 6, {
    preferredCategories: ['cowgirl', 'doggy', 'oral', 'missionary', 'standing'],
    excludeCategories: ['multi', 'anal', 'toy'],
    context: 'standing',
  });
  console.log(`  Run ${i + 1}: ${ps.map((p) => p.nameZh.split(/(?=猛烈|强|疯狂|亲|激|强)/)[0]).join(', ')}`);
}

console.log('\n=== Test 5: categorizePose ===');
const tests = [
  '床上经典Doggy猛烈后入',
  '站立69抱起',
  '桥式抬臀',
  '强制颜射凌辱',
  '楼梯扶手站立',
  '海边沙滩性爱',
  '假装吞精',
];
for (const t of tests) {
  console.log(`  ${t} -> ${categorizePose(t).join(', ')}`);
}
