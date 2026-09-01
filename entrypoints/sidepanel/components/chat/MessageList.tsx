import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import {
  Bot,
  FileText,
  Lightbulb,
  HelpCircle,
  CheckSquare,
  AlertCircle,
  ArrowDown,
  X,
  Settings as SettingsIcon,
} from 'lucide-react';
import type { AssistantMessage, ChatMessage, ToolResultMessage } from '@/lib/types';
import { EMPTY_USAGE } from '@/lib/storage';
import { MessageItem } from './MessageItem';
import { Button } from '@/components/ui/button';

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming?: boolean;
  streamingContent?: string;
  /** 流式期间的思考过程文本 */
  streamingThinking?: string;
  /** 正在执行的工具标签 */
  activeToolLabels?: string[];
  isCancelled?: boolean;
  errorMessage?: string | null;
  onDismissError?: () => void;
  onSelectPrompt: (prompt: string) => void;
  hasProvider: boolean;
  hasModel: boolean;
  activeModelName?: string;
  onOpenSettings: () => void;
}

const PRESET_PROMPTS = [
  {
    icon: FileText,
    title: '总结此网页',
    desc: '提炼 3-5 个核心要点',
    prompt: '请用清晰结构总结当前网页的核心内容，列出 3-5 个关键要点。',
  },
  {
    icon: Lightbulb,
    title: '提炼核心观点',
    desc: '分析论点与核心逻辑',
    prompt: '提炼当前网页的核心观点和结论，分析其主要论据与支持论点。',
  },
  {
    icon: HelpCircle,
    title: '通俗解释概念',
    desc: '用平实语言拆解内容',
    prompt: '用通俗易懂、生动的语言解释当前网页所讨论的主题和关键概念。',
  },
  {
    icon: CheckSquare,
    title: '提取行动建议',
    desc: '提炼可落地的待办事项',
    prompt: '根据当前网页的内容，提取出可以落地的实用行动建议或待办清单。',
  },
];

export function MessageList({
  messages,
  isStreaming,
  streamingContent,
  streamingThinking,
  activeToolLabels,
  isCancelled,
  errorMessage,
  onDismissError,
  onSelectPrompt,
  hasProvider,
  hasModel,
  activeModelName,
  onOpenSettings,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const userScrolledUpRef = useRef(false);
  const scrollRafId = useRef<number | null>(null);
  const lastScrollTimeRef = useRef<number>(0);

  // Check scroll position to determine if user manually scrolled up
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isUp = distanceToBottom > 80;
    userScrolledUpRef.current = isUp;
    setShowScrollBottom(isUp);
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (el) {
      if (smooth) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      } else {
        el.scrollTop = el.scrollHeight;
      }
      userScrolledUpRef.current = false;
      setShowScrollBottom(false);
    }
  }, []);

  const smoothScrollToBottom = useCallback(() => {
    scrollToBottom(true);
  }, [scrollToBottom]);

  const handleManualScrollToBottom = useCallback(() => {
    userScrolledUpRef.current = false;
    setShowScrollBottom(false);
    smoothScrollToBottom();
  }, [smoothScrollToBottom]);

  // 1. ResizeObserver: 监听消息内容容器高度变化 (包含气泡加载动画挂载、工具卡片完成、thinking 展开等全场景)
  useEffect(() => {
    const contentEl = contentRef.current;
    if (!contentEl) return;

    const observer = new ResizeObserver(() => {
      if (!userScrolledUpRef.current) {
        // 高度跳变时立即跟进到底部
        const el = scrollRef.current;
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      }
    });

    observer.observe(contentEl);
    return () => observer.disconnect();
  }, []);

  // 2. 状态依赖监听 (涵盖发送瞬间、isStreaming 切换、内容追加、工具标签变更、轮次提交)
  useEffect(() => {
    if (userScrolledUpRef.current) return;

    const now = performance.now();
    // 节流平滑滚动 (~80ms)，避免高频 token 动画排队打断
    if (now - lastScrollTimeRef.current > 80) {
      lastScrollTimeRef.current = now;
      smoothScrollToBottom();
    } else if (!scrollRafId.current) {
      scrollRafId.current = requestAnimationFrame(() => {
        scrollRafId.current = null;
        lastScrollTimeRef.current = performance.now();
        if (!userScrolledUpRef.current) {
          smoothScrollToBottom();
        }
      });
    }

    return () => {
      if (scrollRafId.current) {
        cancelAnimationFrame(scrollRafId.current);
        scrollRafId.current = null;
      }
    };
  }, [
    messages,
    isStreaming,
    streamingContent,
    streamingThinking,
    activeToolLabels,
    smoothScrollToBottom,
  ]);

  const toolResultsByCallId = useMemo(() => {
    const map = new Map<string, ToolResultMessage>();
    for (const m of messages) {
      if (m.role === 'toolResult') {
        map.set(m.toolCallId, m as ToolResultMessage);
      }
    }
    return map;
  }, [messages]);

  const isEmpty = messages.length === 0 && !streamingContent;

  return (
    <div className="relative flex flex-1 min-h-0 flex-col overflow-hidden bg-background">
      {/* Top Gradient Fade Mask */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-background to-transparent z-10"
        aria-hidden="true"
      />

      {/* Error Alert Banner */}
      {errorMessage && (
        <div className="sticky top-0 z-20 m-2 flex shrink-0 items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive overflow-hidden animate-in fade-in-0 slide-in-from-top-2 duration-150 motion-reduce:animate-none">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 font-medium leading-relaxed break-all whitespace-pre-wrap">{errorMessage}</div>
          {onDismissError && (
            <button
              type="button"
              onClick={onDismissError}
              className="text-destructive/70 hover:text-destructive p-0.5 rounded transition-colors shrink-0"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Main Messages Viewport */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2 pt-2.5 pb-2.5"
      >
        {isEmpty ? (
          <div className="flex min-h-full flex-col justify-center px-3 py-6 text-center animate-in fade-in-0 duration-150 motion-reduce:animate-none">
            {/* Header & Logo */}
            <div className="mb-6 flex flex-col items-center">
              <div className="mb-3 flex size-10 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
                <Bot className="size-5" />
              </div>
              <h2 className="text-sm font-semibold tracking-tight text-foreground">
                AI 侧边栏
              </h2>
              <p className="mt-1 text-xs text-muted-foreground max-w-[260px] leading-relaxed">
                {hasModel && activeModelName ? (
                  <span>当前模型: <span className="font-medium text-foreground">{activeModelName}</span></span>
                ) : (
                  <span>配置你的 API Key，随时开启智能浏览</span>
                )}
              </p>
            </div>

            {/* If no provider / model configured */}
            {(!hasProvider || !hasModel) && (
              <div className="mb-5 rounded-lg border p-3.5 text-left bg-muted/30">
                <p className="text-xs font-semibold text-foreground">尚未完成模型配置</p>
                <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                  {!hasProvider
                    ? '请先添加 OpenAI 兼容或 Anthropic 格式提供商'
                    : '请选择或配置可用模型'}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onOpenSettings}
                  className="mt-2.5 h-7 text-xs gap-1.5"
                >
                  <SettingsIcon className="size-3" />
                  前往设置
                </Button>
              </div>
            )}

            {/* Quick Prompt Cards */}
            <div className="space-y-1.5 text-left">
              <p className="px-1 text-xs font-medium text-muted-foreground">推荐快捷指令</p>
              <div className="grid grid-cols-1 gap-1.5">
                {PRESET_PROMPTS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.title}
                      type="button"
                      onClick={() => onSelectPrompt(item.prompt)}
                      className="group flex items-start gap-2.5 rounded-lg border bg-card p-2.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      <Icon className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-foreground">
                          {item.title}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {item.desc}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div ref={contentRef} className="flex flex-col gap-1 pb-4">
            {messages
              .filter((m) => m.role !== 'toolResult')
              .map((msg, i) => (
                <MessageItem
                  key={`${msg.timestamp}-${i}`}
                  message={msg}
                  toolResults={toolResultsByCallId}
                />
              ))}
            {isStreaming && (
              <MessageItem
                message={{
                  role: 'assistant',
                  content: [{ type: 'text', text: streamingContent ?? '' }],
                  api: 'openai-completions',
                  provider: '',
                  model: '',
                  stopReason: 'stop',
                  usage: EMPTY_USAGE,
                  timestamp: Date.now(),
                } satisfies AssistantMessage}
                isStreaming
                isCancelled={isCancelled}
                liveThinking={streamingThinking}
                liveToolLabels={activeToolLabels}
                toolResults={toolResultsByCallId}
              />
            )}
          </div>
        )}
      </div>

      {/* Bottom Gradient Fade Mask */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-background to-transparent z-10"
        aria-hidden="true"
      />

      {/* Scroll to bottom button */}
      {showScrollBottom && (
        <Button
          type="button"
          size="icon"
          variant="secondary"
          onClick={handleManualScrollToBottom}
          className="absolute bottom-3 right-5 z-20 size-7 rounded-full border border-border shadow-md hover:bg-secondary/90 animate-in fade-in-0 duration-150 motion-reduce:animate-none"
          title="回到底部"
        >
          <ArrowDown className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
