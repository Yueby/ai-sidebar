import type { ReactNode } from 'react';
import type { RefElementMeta } from '@/lib/types';
import { ANY_ELEMENT_MARKER_RE } from '@/lib/types';
import { elementChipLabel } from '@/lib/elementLabel';
import { SquareMousePointer } from 'lucide-react';

/**
 * 元素标记的共享渲染器(chip/quote 两形态):
 * - chip:用户消息内的徽章(内容预览 + tooltip #{N} · selector;查无 id 灰样式"元素 N");
 * - quote:assistant 回复内的斜体预览引用(查无 id 保留原文标记)。
 * 新旧标记(#[element:N] / [元素:N])统一匹配,旧会话兼容。
 */

export type ElementMarkerMode = 'chip' | 'quote';

export function renderElementMarker(
  id: number,
  elementById: Map<number, RefElementMeta> | null | undefined,
  mode: ElementMarkerMode,
): ReactNode {
  const el = elementById?.get(id);
  const title = el ? `#${el.id} · ${el.selector}` : undefined;
  if (!el) {
    return mode === 'chip' ? (
      <span key={`elem-${id}`} className="element-chip element-chip-unknown" title={title}>
        <SquareMousePointer className="size-3 shrink-0 text-muted-foreground" />
        <span className="element-chip-label">元素 {id}</span>
      </span>
    ) : (
      <em key={`elem-${id}`} className="element-quote">
        [element:{id}]
      </em>
    );
  }
  const label = elementChipLabel(el);
  return mode === 'chip' ? (
    <span key={`elem-${id}`} className="element-chip select-all" title={title}>
      <SquareMousePointer className="size-3 shrink-0 text-muted-foreground" />
      <span className="element-chip-label">{label}</span>
    </span>
  ) : (
    <em key={`elem-${id}`} className="element-quote" title={title}>
      {label}
    </em>
  );
}

/** 文本内的标记 → ReactNode 序列(文本段原样保留,空白/换行由容器 pre-wrap 承载) */
export function renderMarkersInText(
  text: string,
  elementById: Map<number, RefElementMeta> | null | undefined,
  mode: ElementMarkerMode,
): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = new RegExp(ANY_ELEMENT_MARKER_RE.source, ANY_ELEMENT_MARKER_RE.flags);
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(renderElementMarker(parseInt(match[1]!, 10), elementById, mode));
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
