/**
 * HTML 转义与基础模板工具。
 *
 * 不引入任何模板引擎 —— 静态生成 + 字符串拼装在这个体量下最简单，
 * 且部署时零依赖（任意静态托管都能跑）。
 */

export function esc(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 属性值转义（用于 JSON-LD 内的引号） */
export function attr(input: unknown): string {
  return esc(input);
}

export function slugify(input: string): string {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** 美元金额格式化 */
export function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** 多行文本转 HTML 段落 */
export function paragraphs(text: string): string {
  return String(text)
    .split(/\n\s*\n/)
    .map((p) => `<p>${esc(p.trim())}</p>`)
    .join('\n');
}

/**
 * 极简 markdown → HTML。
 * 只支持本站指南用到的语法：## 小标题、- 列表、**粗体**、[链接](href)。
 * 刻意不引入完整 markdown 解析器，避免处理不可信输入时的复杂度。
 */
export function markdown(text: string): string {
  const out: string[] = [];
  let inList = false;

  const inline = (s: string): string =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, href: string) =>
        `<a href="${attr(href)}">${text}</a>`,
      );

  for (const rawLine of String(text).split('\n')) {
    const line = rawLine.trimEnd();

    if (!line.trim()) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      continue;
    }

    if (line.startsWith('## ')) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      out.push(`<h2>${inline(line.slice(3))}</h2>`);
      continue;
    }

    if (line.startsWith('- ')) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }

    if (inList) {
      out.push('</ul>');
      inList = false;
    }
    out.push(`<p>${inline(line)}</p>`);
  }

  if (inList) out.push('</ul>');
  return out.join('\n');
}

/**
 * JSON-LD 序列化。
 * 转义 `<` 是为了防止内容里的 `</script>` 提前闭合 script 标签 ——
 * schema 文本里出现这种情况的概率低但后果是整页结构化数据失效。
 */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
