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
   * 文本仍在逐字揭示(流式)。
   * true 时代码块做**节流高亮**:每帧都重新分词是 O(n²)(曾导致"回复时整页卡"),
   * 但完全不高亮又会"说完了才上色"。折中 = 实时着色 + 节流,已完成的块走 shiki 缓存(零成本)。
   */
  live?: boolean;
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
/** 流式期间的最小高亮间隔(ms):块越大间隔越长,避免大块高频分词 */
const LIVE_HIGHLIGHT_MIN_MS = 200;
const LIVE_HIGHLIGHT_BIG_MS = 400;
const LIVE_HIGHLIGHT_BIG_CHARS = 4000;

/**
 * 代码块高亮容器:定型后同步高亮;流式中**节流高亮**(约 5Hz)。
 * 组件身份恒定,reveal 过程中不重挂,只在节流点更新 html。
 */
function CodeBlock({
  code,
  lang,
  live,
  children,
}: {
  code: string;
  lang: string;
  live: boolean;
  children?: React.ReactNode;
}) {
  const [html, setHtml] = useState<string | null>(() => (live ? null : highlightToHtml(code, lang)));
  const lastAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const codeRef = useRef(code);
  codeRef.current = code;

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    if (!live) {
      // 定型:清掉挂起的节流回调,同步高亮一次(cache 命中即几乎零成本)
      clearTimer();
      lastAtRef.current = Date.now();
      setHtml(highlightToHtml(code, lang));
      return;
    }
    const interval = code.length > LIVE_HIGHLIGHT_BIG_CHARS ? LIVE_HIGHLIGHT_BIG_MS : LIVE_HIGHLIGHT_MIN_MS;
    const run = () => {
      timerRef.current = null;
      lastAtRef.current = Date.now();
      setHtml(highlightToHtml(codeRef.current, lang));
    };
    const since = Date.now() - lastAtRef.current;
    if (since >= interval) run();
    else if (timerRef.current === null) timerRef.current = window.setTimeout(run, interval - since);
  }, [code, lang, live]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <PreWithCopy html={html} copyText={code}>
      {children}
    </PreWithCopy>
  );
}

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
  live = false,
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
                <CodeBlock code={text} lang={lang} live={live}>
                  {codeEl}
                </CodeBlock>
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
