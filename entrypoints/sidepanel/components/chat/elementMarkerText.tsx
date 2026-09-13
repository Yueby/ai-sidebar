import type { ReactNode } from 'react';
import type { RefElementMeta } from '@/lib/types';
import { elementChipLabel } from '@/lib/elementLabel';
import { SquareMousePointer } from 'lucide-react';
import { FaviconIcon, RefTooltipContent } from './FaviconIcon';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * 用户消息内元素引用的 chip 渲染:
 * - <picked-element …/> 自闭合块(单一表示),label 取块属性;
 * - 图标位置 = 来源页 favicon(同一条消息可引多页,图标是唯一的页来源标识);
 *   页网址未知(无 refs 块/旧数据)时退化为指针图标;
 * - tooltip 首行给页网址,次行给 #id · <tag> · selector;
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

/** 单条元素引用 chip(url = 来源页网址,由调用方按 tabId 解析) */
function ElementChip({
  label,
  el,
  fallbackId,
  url,
}: {
  label: string;
  el: RefElementMeta | undefined;
  fallbackId: number;
  url?: string;
}) {
  const fallback = !el;
  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className={`element-chip cursor-default ${fallback ? 'element-chip-unknown' : 'select-all'}`}
            />
          }
        >
          {el && url ? (
            <FaviconIcon url={url} tabId={el.tabId} className="size-3" />
          ) : (
            <SquareMousePointer className="size-3 shrink-0 text-muted-foreground" />
          )}
          <span className="element-chip-label">{el ? elementChipLabel(el) : label}</span>
        </TooltipTrigger>
        <TooltipContent side="top">
          {el ? (
            <RefTooltipContent
              url={url}
              detail={`#${el.id}${el.tagName ? ` · <${el.tagName.toLowerCase()}>` : ''} · ${el.selector}`}
            />
          ) : (
            `#${fallbackId}`
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function renderMarkersInText(
  text: string,
  elementById: Map<number, RefElementMeta> | null | undefined,
  tabUrlById?: Map<number, string>,
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
      <ElementChip
        key={`elem-${parsed.elementId}-${match.index}`}
        label={parsed.label}
        el={el}
        fallbackId={parsed.elementId}
        url={el ? tabUrlById?.get(el.tabId) : undefined}
      />,
    );
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
