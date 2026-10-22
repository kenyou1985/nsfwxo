// 深度体检：主题库提示词结构性问题定位
import { THEME_LIBRARY, 主题转视频提示词, 根据时长生成分镜 } from '../src/data/themeLibrary';

const issues: Record<string, string[]> = {};

const add = (k: string, s: string) => { (issues[k] ||= []).push(s); };

for (const t of THEME_LIBRARY) {
  const p = 主题转视频提示词(t, 30);
  const beats = 根据时长生成分镜(t, 30);
  const tag = `[${t.id}] ${t.title} (${t.category})`;

  // 1. 标题含明确场景词，但场景被「服装对应场景」覆盖成不相干场景
  const TITLE_SCENE: Array<[RegExp, string]> = [
    [/卧室/, '卧室'], [/泳池|泳装/, '泳池'], [/教堂|修女/, '教堂'],
    [/教室|校园/, '教室'], [/红毯|晚礼/, '红毯'], [/健身房|瑜伽/, '健身房'],
    [/夜店|派对/, '夜店'], [/小巷|巷子/, '小巷'], [/车库|地下车库/, '车库'],
    [/电车/, '电车'], [/电梯/, '电梯'], [/暴雨|雨夜/, '雨夜'], [/森林|树林/, '森林'],
    [/沙漠/, '沙漠'], [/雪|冰原/, '雪'], [/海滩|海边/, '海边'], [/天台|屋顶|阁楼/, '天台'],
    [/赛车|F1|维修站/, '赛车'], [/拳击|搏击|擂台/, '拳击'], [/芭蕾|剧院/, '剧院'],
    [/监狱|铁笼|审讯/, '监狱'], [/公路|机车|加油站/, '加油站'], [/工厂|仓库/, '仓库'],
  ];
  for (const [re, want] of TITLE_SCENE) {
    if (re.test(t.title)) {
      const m = p.match(/^主题场景：(.*)$/m)?.[1] ?? '';
      if (!re.test(m) && !m.includes(want)) add('标题场景与提示词场景不一致', `${tag}\n    标题含「${t.title.match(re)}」→ 期望场景含「${want}」，实际：${m}`);
      break;
    }
  }

  // 2. 镜头前缀重复（"中景镜头，近景特写，" 之类）
  beats.forEach((b, i) => {
    const heads = b.prompt.split(/[，,]/).filter((s) => /镜头$/.test(s.trim()));
    if (heads.length > 1) add('同一分镜出现两个镜头前缀', `${tag} Shot${i + 1}: ${b.prompt.slice(0, 40)}`);
  });

  // 3. 残留 fully_preserved / 身材比例完全保留（应只锁面部）
  if (/fully_preserved/.test(p)) add('残留 fully_preserved', tag);
  if (/身材比例完全保留/.test(p)) add('残留「身材比例完全保留」', tag);

  // 4. 首镜为纯静态展示（无动词动作）
  const s1 = beats[0]?.prompt ?? '';
  if (!/(走|推|拉|转|靠近|压|抱|吻|脱|解|褪|伸|抬|骑|跨|抓|甩|挥|流|滴|倒|按|抵|贴|蹲|趴|躺|坐|跑|追|拦|压|扯|撕|舔|咬|扇|掐|绑|抽|插|进入|推开|抓住)/.test(s1))
    add('首镜无明显动作动词', `${tag}: ${s1.slice(0, 50)}`);

  // 5. 分类与 needMale 不一致：强制凌辱/SM 应有男性主体
  if (['纯性爱', '户外野战', '多人派对', 'SM重口', '强制凌辱'].includes(t.category) && !/男性主体/.test(p))
    add('需男性主题缺男性主体定义', tag);

  // 6. 分镜数与时长不匹配
  if (beats.length !== 9) add(`30s 分镜数=${beats.length}（期望 9）`, tag);

  // 7. 出现「参考图」正向沿用表述
  if (/沿用参考图的场景|参考图.{0,4}作为首帧|紧贴参考图/.test(p)) add('提示词含正向参考图沿用', tag);

  // 8. 占位符残留
  if (/\{[^}]+\}/.test(p)) add('占位符未替换', `${tag}: ${(p.match(/\{[^}]+\}/g) || []).join(',')}`);

  // 9. 空镜头
  beats.forEach((b, i) => { if (!b.prompt.trim()) add('空分镜', `${tag} Shot${i + 1}`); });
}

console.log('================ 问题汇总 ================');
let total = 0;
for (const [k, v] of Object.entries(issues)) {
  total += v.length;
  console.log(`\n### ${k} → ${v.length}`);
  v.slice(0, 14).forEach((s) => console.log('  - ' + s));
  if (v.length > 14) console.log(`  ... 其余 ${v.length - 14} 条`);
}
console.log(`\n总计问题数: ${total}（主题 ${THEME_LIBRARY.length} 个）`);