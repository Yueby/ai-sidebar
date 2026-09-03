import type { ReactNode } from 'react';
import type { RefElementMeta } from '@/lib/types';
import { elementChipLabel } from '@/lib/elementLabel';
import { SquareMousePointer } from 'lucide-react';

/**
 * 用户消息内元素引用的 chip 渲染:
 * - 新协议:<picked-element …/> 自闭合块(单一表示),label 取块属性;
 * - 旧消息兜底:[element:N] / [元素:N] 标记,经 refs 元数据查 label;
 * - 查无数据(伪造/悬空)→ 灰样式兜底,不猜内容。
 */

/** 块属性值反转义(serialize 端经 &quot;/&lt;/&gt; 转义) */
function unescapeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** 从自闭合块字符串提取 chip 所需字段 */
function parsePickedElementBlock(block: string): { elementId: number; label: string } | null {
  const elementId = parseInt(/elementId="(\d+)"/.exec(block)?.[1] ?? '', 10);
  if (!Number.isFinite(elementId) || elementId <= 0) return null;
  const label = unescapeAttr(/label="([^"]*)"/.exec(block)?.[1] ?? '');
  return { elementId, label };
}

function renderChip(
  key: string,
  label: string,
  el: RefElementMeta | undefined,
  fallbackId: number,
): ReactNode {
  if (el) {
    return (
      <span key={key} className="element-chip select-all" title={`#${el.id} · ${el.selector}`}>
        <SquareMousePointer className="size-3 shrink-0 text-muted-foreground" />
        <span className="element-chip-label">{elementChipLabel(el)}</span>
      </span>
    );
  }
  return (
    <span key={key} className="element-chip element-chip-unknown" title={`#${fallbackId}`}>
      <SquareMousePointer className="size-3 shrink-0 text-muted-foreground" />
      <span className="element-chip-label">{label}</span>
    </span>
  );
}

export function renderMarkersInText(
  text: string,
  elementById: Map<number, RefElementMeta> | null | undefined,
): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /<picked-element\s+[^>]*>|\[(?:element|元素):(\d+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith('<picked-element')) {
      const parsed = parsePickedElementBlock(token);
      const legacy = parsed ? undefined : /(?:element|元素):(\d+)/.exec(token);
      const el = parsed ? elementById?.get(parsed.elementId) : undefined;
      parts.push(
        renderChip(
          `elem-${match.index}`,
          parsed?.label ?? `元素 ${legacy?.[1] ?? '?'}`,
          el,
          parsed?.elementId ?? Number(legacy?.[1] ?? 0),
        ),
      );
    } else {
      const id = parseInt(match[1]!, 10);
      const el = elementById?.get(id);
      parts.push(renderChip(`elem-${id}-${match.index}`, `元素 ${id}`, el, id));
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
