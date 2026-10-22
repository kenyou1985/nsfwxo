// 报告「分镜文案规范化 + 场景一致性修正」的实际改动
import { THEME_LIBRARY, 根据时长生成分镜, type ThemeEntry, type ThemeBeat } from '../src/data/themeLibrary';

/** 取原始（未规范化）分镜：与 获取主题镜头 的文件优先策略一致 */
function 原始分镜(t: ThemeEntry, shotCount: number): ThemeBeat[] {
  if (t.category === '强制凌辱' || t.category === 'SM重口') return [];
  if (shotCount > 9) return [];
  const b = shotCount === 6 ? t.beat15s : (t.beat30s && t.beat30s.length > 0 ? t.beat30s : t.beat60s);
  return b && b.length === shotCount ? b : [];
}

let 泄漏修掉 = 0;
let 空格修掉 = 0;
let 地点改动 = 0;
const 地点改动明细: string[] = [];
const 泄漏样例: string[] = [];
const 地点样例: string[] = [];

for (const t of THEME_LIBRARY) {
  const raw = 原始分镜(t, 9);
  if (!raw.length) continue;
  const fixed = 根据时长生成分镜(t, 30);
  if (fixed.length !== raw.length) continue;

  for (let i = 0; i < raw.length; i++) {
    const a = raw[i].prompt;
    const b = fixed[i].prompt;
    if (a === b) continue;

    // 泄漏类
    if (/主姿势|场景位于/.test(a)) {
      泄漏修掉++;
      if (泄漏样例.length < 4) {
        泄漏样例.push(`[${t.id}] ${t.title}\n    前: ${a}\n    后: ${b}`);
      }
    } else {
      空格修掉++;
    }
  }

  // 地点改动：把"走入X"从前后对比里提取出来
  const locOf = (s: string) => {
    const m = s.match(/（场景位于\s*([^）]*)）/)
      || s.match(/走入([^，。]{2,14}?)(?=展示身材|缓步|登场|亮相|站定|进入|来到|推开|走向|靠近|坐下|躺|，|。)/)
      || s.match(/在([^，。]{2,14}?)(?=[中里内上]|缓慢|面对|优雅|侧身|，|。)/);
    return m ? m[1].trim() : '';
  };
  const l1 = locOf(raw[0].prompt);
  const l2 = locOf(fixed[0].prompt);
  if (l1 && l2 && l1 !== l2) {
    地点改动++;
    if (地点样例.length < 30) {
      地点改动明细.push(`[${t.id}] ${t.title} (${t.category})\n    ${l1}  →  ${l2}`);
    }
  }
}

console.log(`分镜文案含标签泄漏（被修）: ${泄漏修掉}`);
console.log(`分镜文案仅空格差异（被修）: ${空格修掉}`);
console.log(`分镜地点被改写: ${地点改动} / ${THEME_LIBRARY.length} 主题`);

console.log(`\n=== 标签泄漏修复样例 ===`);
泄漏样例.forEach(s => console.log('  ' + s));

console.log(`\n=== 地点改写明细（前 30 条）===`);
地点改动明细.forEach(s => console.log('  ' + s));
