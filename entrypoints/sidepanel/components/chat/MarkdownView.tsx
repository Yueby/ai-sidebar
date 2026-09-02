import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { RefElementMeta } from '@/lib/types';
import { renderElementMarker } from './elementMarkerText';

interface MarkdownViewProps {
  content: string;
  className?: string;
  /** assistant 回复内元素标记 → 斜体预览引用(App 组合层经 collectPageRefs 提供;缺省不处理标记) */
  elementById?: Map<number, RefElementMeta> | null;
}

/** 标记 → 内联代码 token(react-markdown 可控渲染点;查无 id 时按原文还原) */
const MARKER_TOKEN_RE = /%%ELM:(\d+)%%/g;
const ANY_MARKER_SOURCE = '\\[(?:element|元素):\\d+\\]';

function transformMarkers(content: string): string | null {
  if (!new RegExp(ANY_MARKER_SOURCE).test(content)) return null;
  return content.replace(
    new RegExp(ANY_MARKER_SOURCE, 'g'),
    (m, id: string) => `\`%%ELM:${id}%%\``,
  );
}

export const MarkdownView = memo(function MarkdownView({
  content,
  className = '',
  elementById,
}: MarkdownViewProps) {
  const transformed = elementById ? transformMarkers(content) : null;
  return (
    <div className={`md-body ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ href, children, ...props }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary underline hover:opacity-80 transition-opacity"
              {...props}
            >
              {children}
            </a>
          ),
          pre: ({ children, ...props }) => (
            <pre className="relative my-2 rounded-lg bg-zinc-950 text-zinc-100 overflow-x-auto text-xs p-3" {...props}>
              {children}
            </pre>
          ),
          code: ({ className: codeClassName, children, ...props }) => {
            // 元素标记 token → 斜体预览引用(仅行内 code;查无 id 保留原文标记)
            if (elementById && !codeClassName) {
              const m = MARKER_TOKEN_RE.exec(String(children));
              MARKER_TOKEN_RE.lastIndex = 0;
              if (m) {
                return <>{renderElementMarker(Number(m[1]), elementById, 'quote')}</>;
              }
            }
            const isInline = !codeClassName;
            if (isInline) {
              return (
                <code
                  className="rounded bg-secondary/80 px-1.5 py-0.5 text-xs font-mono text-foreground font-medium"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className={codeClassName} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {transformed ?? content}
      </ReactMarkdown>
    </div>
  );
});
