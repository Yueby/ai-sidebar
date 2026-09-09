import React, { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy } from 'lucide-react';
import { i18n } from '#i18n';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface MarkdownViewProps {
  content: string;
  className?: string;
}

/** 递归拉平 React 子树为纯文本(代码块复制用:children 是 hljs 处理后的 <code> 元素树) */
function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    return extractText(props.children);
  }
  return '';
}

/** 代码块容器:右上角常驻复制按钮(官方 Button + Tooltip,文案复用 messages.copy/copied) */
function PreWithCopy({ children, ...props }: React.ComponentProps<'pre'>) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    void navigator.clipboard.writeText(extractText(children)).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="relative my-2">
      <pre
        className="not-typeset rounded-lg bg-code-background text-code-foreground overflow-x-auto text-xs p-3"
        {...props}
      >
        {children}
      </pre>
      <TooltipProvider delay={200}>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={handleCopy}
                aria-label={i18n.t(copied ? 'messages.copied' : 'messages.copy')}
                className="absolute right-1.5 top-1.5 size-6 rounded-md text-muted-foreground/80 hover:text-foreground bg-background/60 backdrop-blur-sm"
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              </Button>
            }
          />
          <TooltipContent side="top">
            {i18n.t(copied ? 'messages.copied' : 'messages.copy')}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

export const MarkdownView = memo(function MarkdownView({
  content,
  className = '',
}: MarkdownViewProps) {
  return (
    <div className={`typeset typeset-chat ${className}`}>
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
          pre: (props) => <PreWithCopy {...props} />,
          table: ({ children, ...props }) => (
            <div className="typeset-scroll my-2">
              <table {...props}>{children}</table>
            </div>
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
