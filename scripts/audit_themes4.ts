import { THEME_LIBRARY, 主题转视频提示词, 根据时长生成分镜 } from '../src/data/themeLibrary';

const headsOf = (s: string) =>
  s.split(/[，,]/).map((x) => x.trim()).filter((x) => /镜头$/.test(x) && x !== '稳定镜头');

let dup = 0; let total = 0;
const samples: string[] = [];
for (const t of THEME_LIBRARY) {
  for (const d of [15, 30, 60] as const) {
    const beats = 根据时长生成分镜(t, d);
    beats.forEach((b, i) => {
      total++;
      const h = headsOf(b.prompt);
      if (h.length > 1) {
        dup++;
        if (samples.length < 10) samples.push(`${t.id}/${d}s Shot${i + 1} heads=${JSON.stringify(h)} :: ${b.prompt.slice(0, 50)}`);
      }
    });
  }
}
console.log(`真实双镜头前缀: ${dup} / ${total}`);
samples.forEach((s) => console.log('  ' + s));

// 场景错配（修正优先级后是否还错）
const 场景 = 主题转视频提示词(THEME_LIBRARY[0], 30).match(/^主题场景：(.*)$/m)?.[1];
console.log('\ntheme_001 场景:', 场景);

// 残留 fully_preserved / 身材比例
let fp = 0; let bp = 0;
for (const t of THEME_LIBRARY) {
  const p = 主题转视频提示词(t, 30);
  if (/fully_preserved/.test(p)) fp++;
  if (/身材比例完全保留/.test(p)) bp++;
}
console.log(`fully_preserved=${fp} 身材比例完全保留=${bp}`);

// multiRef 主题里 Picture 2 的定义行
const m = THEME_LIBRARY.find((t) => t.multiRef)!;
console.log('\nPicture2 行:', 主题转视频提示词(m, 30).match(/<Picture 2>.*/)?.[0]);