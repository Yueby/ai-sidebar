import type { ReactNode } from 'react';
import type { RefElementMeta } from '@/lib/types';
import { ANY_ELEMENT_MARKER_RE } from '@/lib/types';
import { elementChipLabel } from '@/lib/elementLabel';
import { SquareMousePointer } from 'lucide-react';

/**
 * 用户消息内元素标记([element:N],兼容旧 [元素:N])的 chip 渲染:
 * label = 内容预览(elementChipLabel),tooltip = #{N} · selector;
 * 查无 id(伪造/悬空)→ 灰样式"元素 N"兜底,不猜内容。
 */
export function renderMarkersInText(
  text: string,
  elementById: Map<number, RefElementMeta> | null | undefined,
): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = new RegExp(ANY_ELEMENT_MARKER_RE.source, ANY_ELEMENT_MARKER_RE.flags);
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const id = parseInt(match[1]!, 10);
    const el = elementById?.get(id);
    parts.push(
      el ? (
        <span
          key={`elem-${id}-${match.index}`}
          className="element-chip select-all"
          title={`#${el.id} · ${el.selector}`}
        >
          <SquareMousePointer className="size-3 shrink-0 text-muted-foreground" />
          <span className="element-chip-label">{elementChipLabel(el)}</span>
        </span>
      ) : (
        <span key={`elem-${id}-${match.index}`} className="element-chip element-chip-unknown">
          <SquareMousePointer className="size-3 shrink-0 text-muted-foreground" />
          <span className="element-chip-label">元素 {id}</span>
        </span>
      ),
    );
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
