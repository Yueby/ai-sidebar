import type { ReactNode } from 'react';
import type { RefElementMeta } from '@/lib/types';
import { elementChipLabel } from '@/lib/elementLabel';
import { SquareMousePointer } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * 用户消息内元素引用的 chip 渲染:
 * - <picked-element …/> 自闭合块(单一表示),label 取块属性;
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
    const tooltipText = `#${el.id} · ${el.selector}`;
    return (
      <TooltipProvider key={key} delay={200}>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="element-chip select-all cursor-default" />
            }
          >
            <SquareMousePointer className="size-3 shrink-0 text-muted-foreground" />
            <span className="element-chip-label">{elementChipLabel(el)}</span>
          </TooltipTrigger>
          <TooltipContent side="top">
            {tooltipText}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  const fallbackText = `#${fallbackId}`;
  return (
    <TooltipProvider key={key} delay={200}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="element-chip element-chip-unknown cursor-default" />
          }
        >
          <SquareMousePointer className="size-3 shrink-0 text-muted-foreground" />
          <span className="element-chip-label">{label}</span>
        </TooltipTrigger>
        <TooltipContent side="top">
          {fallbackText}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function renderMarkersInText(
  text: string,
  elementById: Map<number, RefElementMeta> | null | undefined,
): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /<picked-element\s+[^>]*>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const parsed = parsePickedElementBlock(match[0]);
    if (!parsed) {
      // 结构残缺的块:按原样保留为文本,不渲染 chip
      parts.push(match[0]);
      lastIndex = regex.lastIndex;
      continue;
    }
    const el = elementById?.get(parsed.elementId);
    parts.push(
      renderChip(`elem-${parsed.elementId}-${match.index}`, parsed.label, el, parsed.elementId),
    );
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
