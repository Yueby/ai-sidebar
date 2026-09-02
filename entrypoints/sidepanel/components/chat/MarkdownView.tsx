import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

interface MarkdownViewProps {
  content: string;
  className?: string;
}

export const MarkdownView = memo(function MarkdownView({
  content,
  className = '',
}: MarkdownViewProps) {
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
        {content}
      </ReactMarkdown>
    </div>
  );
});
