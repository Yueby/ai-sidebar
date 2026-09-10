import React, { memo, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';
import { i18n } from '#i18n';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { highlightToHtml, normalizeShikiLang, onShikiReady } from '@/lib/shiki';

interface MarkdownViewProps {
  content: string;
  className?: string;
  /**
   * 是否做语法高亮(默认 true)。
   * 流式逐字揭示期间传 false:那一块文本每帧都在变,rAF 60fps × shiki 分词是 O(n²),
   * 真机表现为“AI 回复时整体卡顿”;回复定型后自动升级为高亮。
   */
  highlight?: boolean;
}

/** 递归拉平 React 子树为纯文本(代码块复制与 shiki 输入用) */
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

/** 高亮器就绪订阅:未就绪时先纯文本,就绪后重渲染升级 */
function useShikiReady(): boolean {
  const [ready, setReady] = useState(() => isShikiReadyLocal());
  useEffect(() => onShikiReady(() => setReady(true)), []);
  return ready;
}

import { isShikiReady as isShikiReadyLocal } from '@/lib/shiki';

/** 代码块容器:shiki HTML(双主题变量)或降级纯文本;右上角常驻复制按钮 */
function PreWithCopy({
  children,
  html,
  copyText,
}: {
  children?: React.ReactNode;
  html: string | null;
  copyText: string;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    void navigator.clipboard.writeText(copyText).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="relative my-2">
      {html ? (
        <div className="code-shiki-host overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="not-typeset rounded-lg bg-code-background text-code-foreground overflow-x-auto text-xs p-3">
          {children}
        </pre>
      )}
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
  highlight = true,
}: MarkdownViewProps) {
  // 高亮器就绪后触发一次重渲染(未就绪期间渲染的纯文本代码块升级为 shiki)
  useShikiReady();
  return (
    <div className={`typeset typeset-chat ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
          pre: ({ children }) => {
            // react-markdown v9:pre 的 children 是 <code className="language-x"> 元素
            const codeEl = Array.isArray(children) ? children[0] : children;
            if (React.isValidElement(codeEl)) {
              const props = codeEl.props as { className?: string; children?: React.ReactNode };
              const lang = normalizeShikiLang(props.className);
              const text = extractText(props.children).replace(/\n$/, '');
              return (
                <PreWithCopy html={highlight ? highlightToHtml(text, lang) : null} copyText={text}>
                  {codeEl}
                </PreWithCopy>
              );
            }
            return (
              <PreWithCopy html={null} copyText={extractText(children)}>
                {children}
              </PreWithCopy>
            );
          },
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
