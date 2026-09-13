/**
 * 选择器分段的纯逻辑(可单测)。
 *
 * 用途:`read_element` / `read_page mode=tree` 的 `root`/`selector` 需要"跨开放 shadow root"
 * 逐段下潜,而**分段必须引号/括号感知** —— 属性值里带空格是常见写法:
 *   `[aria-label="Save changes"]` 按空白硬切会变成 `[aria-label="Save` 与 `changes"]`,
 * 两段都匹配不到,于是"影子树内的这类选择器永远读不到"(光 DOM 有回退路径,故只在影子里暴露)。
 */

/**
 * 按后代组合器(空白)切分选择器;**引号内、方括号/圆括号内**的空白不切。
 * 反斜杠转义(`\"`)按 CSS 规则跳过下一个字符,不误判引号状态。
 */
export function splitSelectorSegments(selector: string): string[] {
  const out: string[] = [];
  let buf = '';
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < selector.length; i += 1) {
    const ch = selector[i]!;
    if (quote) {
      buf += ch;
      if (ch === '\\' && i + 1 < selector.length) {
        buf += selector[i + 1]!;
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === '[' || ch === '(') {
      depth += 1;
      buf += ch;
      continue;
    }
    if (ch === ']' || ch === ')') {
      depth = Math.max(0, depth - 1);
      buf += ch;
      continue;
    }
    if (depth === 0 && /\s/.test(ch)) {
      if (buf) {
        out.push(buf);
        buf = '';
      }
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}
