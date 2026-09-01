import React, { useState, useMemo } from 'react';
import {
  Copy,
  Check,
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  Globe,
  Wrench,
  Loader2,
  SquareMousePointer,
} from 'lucide-react';
import type { AssistantMessage, ChatMessage, PageRefs, ToolResultMessage } from '@/lib/types';
import { toolLabel } from '@/lib/types';
import { messageText } from '@/lib/storage';
import { parsePageRefs } from '@/lib/pageRefs';
import { MarkdownView } from './MarkdownView';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface MessageItemProps {
  message: ChatMessage;
  isStreaming?: boolean;
  isCancelled?: boolean;
  /** 流式期间的思考过程文本(仅 live 气泡用) */
  liveThinking?: string;
  /** 流式期间正在执行的工具原始名列表(仅 live 气泡用) */
  liveToolLabels?: string[];
  /** 按 toolCallId 索引的工具执行结果字典 */
  toolResults?: Map<string, ToolResultMessage>;
}

function formatTokens(count: number): string {
  if (!count) return '0';
  if (count >= 1000) {
    const k = (count / 1000).toFixed(1).replace(/\.0$/, '');
    return `${k}k`;
  }
  return `${count}`;
}

function UserRefSnapshot({ refs }: { refs: PageRefs }) {
  const [open, setOpen] = useState(false);
  const tabs = refs.tabs ?? [];
  const elements = refs.elements ?? [];
  const total = tabs.length + elements.length;

  if (total === 0) return null;

  const isMany = total > 2;

  const renderItems = () => (
    <div className="space-y-1">
      {tabs.map((tab, idx) => (
        <div
          key={`tab-${idx}`}
          className="flex items-center gap-1.5 text-[10px] text-foreground bg-background/80 border border-border/50 rounded px-1.5 py-0.5 max-w-full overflow-hidden"
          title={`${tab.url} · #${tab.tabId}`}
        >
          <Globe className="size-2.5 shrink-0 text-muted-foreground" />
          <span className="truncate max-w-full">{tab.title || tab.url}</span>
          {tab.focused && (
            <span className="shrink-0 rounded bg-muted px-1 text-[9px] leading-[14px] text-muted-foreground font-medium">
              当前
            </span>
          )}
        </div>
      ))}
      {elements.map((elem, idx) => (
        <div
          key={`elem-${idx}`}
          className="flex items-center gap-1.5 text-[10px] text-foreground bg-background/80 border border-border/50 rounded px-1.5 py-0.5 max-w-full overflow-hidden"
          title={elem.selector || elem.preview}
        >
          <SquareMousePointer className="size-2.5 shrink-0 text-muted-foreground" />
          {elem.tagName && (
            <span className="font-mono text-muted-foreground shrink-0">&lt;{elem.tagName.toLowerCase()}&gt;</span>
          )}
          <span className="truncate max-w-full">{elem.preview || '页面元素'}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="pt-1 mt-1 border-t border-border/60 text-xs w-full">
      {isMany ? (
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground select-none transition-colors py-0.5"
          >
            <span>引用 {total} 项</span>
            {open ? <ChevronDown className="size-2.5" /> : <ChevronRight className="size-2.5" />}
          </button>
          {open && (
            <div className="animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none">
              {renderItems()}
            </div>
          )}
        </div>
      ) : (
        renderItems()
      )}
    </div>
  );
}

function ThinkingBlock({
  thinking,
  defaultOpen = false,
  isGenerating = false,
}: {
  thinking: string;
  defaultOpen?: boolean;
  isGenerating?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!thinking || !thinking.trim()) return null;

  // Extract latest 3 non-empty lines for collapsed preview
  const previewText = useMemo(() => {
    const trimmed = thinking.trim();
    const lines = trimmed.split('\n').filter((l) => l.trim().length > 0);
    return lines.slice(-3).join('\n');
  }, [thinking]);

  return (
    <div className="my-1 text-xs w-full">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground select-none transition-colors py-0.5"
      >
        {isGenerating ? (
          <Brain className="size-3 animate-pulse text-foreground" />
        ) : (
          <Brain className="size-3" />
        )}
        <span>{isGenerating ? '思考中...' : '思考过程'}</span>
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
      </button>

      {open ? (
        <div className="mt-1 whitespace-pre-wrap break-all border-l-2 border-border pl-2.5 text-[11px] leading-relaxed text-muted-foreground animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none">
          {thinking}
        </div>
      ) : (
        <div
          onClick={() => setOpen(true)}
          className="group/preview relative mt-0.5 cursor-pointer border-l-2 border-border/60 pl-2.5 hover:border-border transition-colors select-none"
          title="点击展开完整思考过程"
        >
          <p className="line-clamp-3 whitespace-pre-wrap break-all text-[11px] leading-relaxed text-muted-foreground/75 group-hover/preview:text-muted-foreground transition-colors">
            {previewText}
          </p>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3.5 bg-gradient-to-t from-card to-transparent opacity-80" />
        </div>
      )}
    </div>
  );
}

interface ToolCallCardProps {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
  result?: ToolResultMessage | null;
  isExecuting?: boolean;
}

function ToolCallCard({ name, args, result, isExecuting }: ToolCallCardProps) {
  const [open, setOpen] = useState(false);
  const label = toolLabel(name);

  const isError = result?.isError === true;
  const isDone = Boolean(result) && !isExecuting;

  // Extract and truncate result text
  const resultText = useMemo(() => {
    if (!result?.content) return '';
    return result.content
      .map((c) => (c.type === 'text' ? c.text : ''))
      .join('');
  }, [result]);

  const isTruncated = resultText.length > 500;
  const displayResultText = isTruncated ? `${resultText.slice(0, 500)}...` : resultText;

  return (
    <div className="my-1.5 w-full max-w-full rounded-lg border border-border/60 bg-muted/20 p-2 text-xs text-foreground transition-all animate-in fade-in-0 duration-150 motion-reduce:animate-none">
      {/* Header row (Click to toggle expand) */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 text-left select-none outline-none hover:opacity-80 transition-opacity cursor-pointer"
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {isExecuting ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="font-medium text-[11px] truncate">{label}</span>
          <span className="text-[10px] text-muted-foreground font-mono truncate">
            ({name})
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isExecuting ? (
            <span className="text-[10px] text-muted-foreground">执行中</span>
          ) : isError ? (
            <span className="text-[10px] text-destructive font-medium">失败</span>
          ) : isDone ? (
            <span className="text-[10px] text-muted-foreground/70">完成</span>
          ) : (
            <span className="text-[10px] text-muted-foreground/70">已调用</span>
          )}

          {open ? (
            <ChevronDown className="size-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expanded details */}
      {open && (
        <div className="mt-2 pt-2 border-t border-border/40 space-y-2 text-[11px] animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none">
          {/* Parameters */}
          {args && Object.keys(args).length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground">调用参数:</div>
              <pre className="font-mono text-[10px] bg-background/80 rounded p-1.5 border border-border/40 overflow-x-auto whitespace-pre-wrap break-all max-h-36">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>
          )}

          {/* Result */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] font-medium text-muted-foreground">
              <span>返回结果:</span>
              {isTruncated && (
                <span className="text-[9px] text-muted-foreground/70">
                  (已截断展示前 500 字，共 {resultText.length} 字)
                </span>
              )}
            </div>

            {isExecuting ? (
              <div className="text-[10px] text-muted-foreground italic py-0.5">
                等待执行结果...
              </div>
            ) : resultText ? (
              <pre
                className={`font-mono text-[10px] bg-background/80 rounded p-1.5 border overflow-x-auto whitespace-pre-wrap break-all max-h-48 ${
                  isError ? 'border-destructive/30 text-destructive' : 'border-border/40 text-muted-foreground'
                }`}
              >
                {displayResultText}
              </pre>
            ) : isDone ? (
              <div className="text-[10px] text-muted-foreground italic py-0.5">
                执行完成（无文本输出）
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground italic py-0.5">
                等待结果...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function MessageItem({
  message,
  isStreaming,
  isCancelled,
  liveThinking,
  liveToolLabels,
  toolResults,
}: MessageItemProps) {
  const [copied, setCopied] = useState(false);

  // 引用 chips:从本条消息 content 的 <page-refs> 块解析(与 LLM 消费同一份字符串,零中间状态)
  const pageRefs = useMemo(
    () => (message.role === 'user' ? parsePageRefs(message.content) : null),
    [message],
  );

  // 工具结果消息不直接作为独立气泡渲染(已在对应 toolCall 卡片内展示)
  if (message.role === 'toolResult') return null;

  const rawText = messageText(message);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="group flex justify-end px-3 py-1 animate-in fade-in-0 slide-in-from-bottom-1 duration-150 motion-reduce:animate-none">
        <div className="flex max-w-[85%] flex-col items-end gap-0.5">
          <div className="w-fit max-w-full rounded-lg bg-secondary text-secondary-foreground px-3 py-1.5 text-sm shadow-xs">
            {/* rawText 已经过 messageText 剥离 <page-refs> 块,正文不泄漏 JSON */}
            <p className="whitespace-pre-wrap break-all leading-relaxed">{rawText}</p>
            {pageRefs && <UserRefSnapshot refs={pageRefs} />}
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 px-1"
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            <span>{copied ? '已复制' : '复制'}</span>
          </button>
        </div>
      </div>
    );
  }

  // Assistant Message
  const assistantMsg = message as AssistantMessage;
  const blocks = Array.isArray(assistantMsg.content) ? assistantMsg.content : [];
  const textBlocks = blocks.filter(
    (b): b is { type: 'text'; text: string } => b.type === 'text' && b.text.trim().length > 0
  );
  const thinkingBlocks = blocks.filter(
    (b): b is { type: 'thinking'; thinking: string } => b.type === 'thinking' && b.thinking.trim().length > 0
  );
  const toolCallBlocks = blocks.filter(
    (b): b is { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> } =>
      b.type === 'toolCall'
  );

  const hasVisibleTextOrThinking = textBlocks.length > 0 || thinkingBlocks.length > 0 || Boolean(rawText);
  const hasLiveActivity = Boolean(liveThinking) || (liveToolLabels && liveToolLabels.length > 0);
  const errorMessage = assistantMsg.errorMessage;
  const usage = assistantMsg.usage;
  const hasUsage = usage && usage.totalTokens > 0;

  return (
    <div className="flex flex-col gap-1 px-3 py-1">
      {/* 1. Independent Tool Call Cards (Ordered) */}
      {toolCallBlocks.map((block, i) => (
        <ToolCallCard
          key={block.id || `tool-${i}`}
          id={block.id}
          name={block.name}
          args={block.arguments}
          result={block.id ? toolResults?.get(block.id) : null}
        />
      ))}

      {/* Live executing tool calls during streaming */}
      {liveToolLabels && liveToolLabels.length > 0 && (
        <div className="space-y-1">
          {liveToolLabels.map((toolName, i) => (
            <ToolCallCard key={`live-tool-${i}`} name={toolName} isExecuting />
          ))}
        </div>
      )}

      {/* 2. Assistant Message Bubble (Only if there is text, thinking, live stream, or error) */}
      {(hasVisibleTextOrThinking || hasLiveActivity || isStreaming || errorMessage || toolCallBlocks.length === 0) && (
        <div className="group flex gap-2.5 py-0.5 animate-in fade-in-0 slide-in-from-bottom-1 duration-150 motion-reduce:animate-none">
          <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
            <Bot className="size-3.5" />
          </div>

          <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5 overflow-hidden">
            <div className="relative min-w-0 w-fit max-w-full rounded-lg border bg-card p-2.5 text-card-foreground overflow-hidden">
              {/* Live streaming thinking block */}
              {liveThinking && (
                <ThinkingBlock
                  thinking={liveThinking}
                  isGenerating={isStreaming && !rawText}
                />
              )}

              {/* Historical thinking blocks */}
              {thinkingBlocks.map((block, i) => (
                <ThinkingBlock key={i} thinking={block.thinking} />
              ))}

              {/* Text content or loading / error indicators */}
              {textBlocks.length > 0 ? (
                textBlocks.map((block, i) => (
                  <MarkdownView key={i} content={block.text} />
                ))
              ) : rawText ? (
                <MarkdownView content={rawText} />
              ) : isStreaming ? (
                !liveThinking && (!liveToolLabels || liveToolLabels.length === 0) ? (
                  /* AI Typing Animation (3 bouncing dots) */
                  <div className="flex items-center gap-1 py-1 px-1">
                    <span className="size-1.5 rounded-full bg-muted-foreground/70 animate-bounce [animation-delay:-0.3s]" />
                    <span className="size-1.5 rounded-full bg-muted-foreground/70 animate-bounce [animation-delay:-0.15s]" />
                    <span className="size-1.5 rounded-full bg-muted-foreground/70 animate-bounce" />
                  </div>
                ) : null
              ) : errorMessage ? (
                <div className="text-xs text-muted-foreground italic leading-relaxed break-all whitespace-pre-wrap">
                  {errorMessage}
                </div>
              ) : toolCallBlocks.length === 0 ? (
                <div className="text-xs text-muted-foreground italic">无回复内容</div>
              ) : null}

              {/* Streaming blinking cursor */}
              {isStreaming && rawText && (
                <span
                  className="inline-block h-3.5 w-1.5 ml-1 bg-foreground align-middle animate-pulse"
                  aria-hidden="true"
                />
              )}

              {/* Cancelled indicator */}
              {isCancelled && (
                <div className="mt-1.5 text-xs text-muted-foreground">(已停止生成)</div>
              )}
            </div>

            {/* Action & Usage bar (Only shown when text or usage exists) */}
            {(hasVisibleTextOrThinking || hasUsage) && (
              <div className="flex w-full items-center justify-between px-0.5 text-[11px] text-muted-foreground">
                <div className="flex items-center gap-1.5 truncate min-w-0">
                  <span>
                    {message.timestamp
                      ? new Date(message.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : ''}
                  </span>

                  {hasUsage && (
                    <span className="text-[10px] text-muted-foreground/70 truncate">
                      ↑ {formatTokens(usage.input)} ↓ {formatTokens(usage.output)}
                    </span>
                  )}
                </div>

                {hasVisibleTextOrThinking && (
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={handleCopy}
                          className="size-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0"
                        >
                          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                          <span className="sr-only">复制</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p>{copied ? '已复制' : '复制'}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
