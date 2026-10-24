/** 清理扩写/抽卡模型输出，整理成 Krea2 官方偏好的自然语言生图提示词。 */
export function normalizeKrea2Prompt(input: string): string {
  let text = String(input || '').trim();
  if (!text) return text;

  // 去掉模型自带的“保持人物一致”等元指令，这些不属于画面描述
  text = text
    .replace(/Maintain the exact facial identity[^.]*\./gi, '')
    .replace(/High-fidelity character consistency[^.]*\./gi, '')
    .replace(/do not alter any defining traits\.?/gi, '')
    .replace(/^[,.\s]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // 拆成短句，去重并保持原有画面顺序
  const parts = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const unique = parts.filter(p => {
    const k = p.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '');
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  text = unique.join(' ').replace(/\s+/g, ' ').trim();

  const lower = text.toLowerCase();
  const suffix: string[] = [];
  if (!/photorealistic|photo-realistic|realistic photography/.test(lower)) suffix.push('photorealistic editorial photography');
  if (!/natural skin|skin texture|skin pores/.test(lower)) suffix.push('natural skin texture with visible pores');
  if (!/anatomically correct|correct anatomy/.test(lower)) suffix.push('anatomically correct proportions');
  if (!/50mm|85mm|lens/.test(lower)) suffix.push('50mm lens');
  if (!/shallow depth of field|bokeh/.test(lower)) suffix.push('shallow depth of field');
  if (!/cinematic lighting|soft light|directional light/.test(lower)) suffix.push('cinematic lighting');
  if (!/8k|ultra-detailed|high detail/.test(lower)) suffix.push('8K, ultra-detailed');

  return [text, ...suffix].join(', ').replace(/,\s*,/g, ', ');
}
