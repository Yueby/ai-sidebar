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
import type { GateRequest } from '@/entrypoints/sidepanel/gateAdapter';
import { EMPTY_USAGE } from '@/lib/storage';
import { MessageItem } from './MessageItem';
import { Button } from '@/components/ui/button';

interface MessageListProps {
  /** 所属会话标识:透传 MessageItem 作为入场动画抑制的重估边界 */
  sessionKey: string;
  messages: ChatMessage[];
  isStreaming?: boolean;
  streamingContent?: string;
  /** 流式期间的思考过程文本 */
  streamingThinking?: string;
  /** 正在执行的工具标签 */
  activeToolLabels?: string[];
  /** 当前待处理的门控请求(confirm/ask;仅用于工具卡状态徽标匹配,交互审批在 App 的独立槽位渲染) */
  gateRequest?: GateRequest | null;
  /** 待确认总数 (用于首张待确认卡显示「共 N 个待确认」轻提示) */
  pendingGateTotal?: number;
  /** 尾部 N 条消息刚从 live 流式气泡接管(in-flight 物化):跳过入场动画避免交接闪烁 */
  quietTailCount?: number;
  /** 会话压缩标记:摘要 user 消息在消息流内渲染为分隔线卡 */
  compaction?: { summaryTimestamp: number; tokensBefore: number } | null;
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
  gateRequest,
  pendingGateTotal,
  quietTailCount,
  compaction,
  sessionKey,
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
  // 「用户上翻」只由用户主动滚动行为置位(wheel 向上 / touch 下拖 / PageUp/ArrowUp/Home),
  // 或非程序性 scroll 事件落在离底 > 阈值处(滚动条拖动/惯性滚动;程序性滚动一律直达底部);
  // 视口/内容的程序性尺寸变化不改变跟底状态——挂起前若在跟底,尺寸变化后重新贴底
  const userScrolledUpRef = useRef(false);
  // 程序性 smooth 滚动进行中:吞掉中途 scroll 事件(落底前距离必然 > 阈值),防止误判挂起
  const programmaticScrollRef = useRef(false);
  // 时间盒:smooth 途中用户拖滚动条时事件被吞、标记无法经"落底"清除 → 350ms 兜底复位
  const programmaticScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const scrollRafId = useRef<number | null>(null);
  const lastScrollTimeRef = useRef<number>(0);
  // 首条消息身份(会话切换检测用)
  const firstMessageKeyRef = useRef<string | null>(null);

  /** 用户滚动意图:立即挂起跟底(夺回程序性 smooth 滚动的控制权) */
  const suspendFollow = useCallback(() => {
    programmaticScrollRef.current = false;
    userScrolledUpRef.current = true;
    setShowScrollBottom(true);
  }, []);

  // scroll 事件:程序性滚动途中不改变跟底状态,只等落底;非程序性滚动按落点判定
  // 挂起/恢复(此时 scroll 事件只可能来自用户:滚动条拖动、惯性滚动、键盘滚动)
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (programmaticScrollRef.current) {
      if (distance <= 80) programmaticScrollRef.current = false; // 已落底
      return;
    }
    const isUp = distance > 80;
    userScrolledUpRef.current = isUp;
    setShowScrollBottom(isUp);
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    if (smooth) {
      programmaticScrollRef.current = true;
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      // 每次滚动重启计时,350ms 内未落底也强制复位标记(避免吞掉用户后续 scroll 事件)
      if (programmaticScrollTimerRef.current) clearTimeout(programmaticScrollTimerRef.current);
      programmaticScrollTimerRef.current = setTimeout(() => {
        programmaticScrollRef.current = false;
        programmaticScrollTimerRef.current = null;
      }, 350);
    } else {
      // 同步赋值直达底部,落点必在阈值内,无需标记程序性
      el.scrollTop = el.scrollHeight;
    }
    userScrolledUpRef.current = false;
    setShowScrollBottom(false);
  }, []);

  const smoothScrollToBottom = useCallback(() => {
    scrollToBottom(true);
  }, [scrollToBottom]);

  const handleManualScrollToBottom = useCallback(() => {
    userScrolledUpRef.current = false;
    setShowScrollBottom(false);
    smoothScrollToBottom();
  }, [smoothScrollToBottom]);

  // 用户主动滚动手势:wheel 向上 / touch 下拖(仅当确实可向上滚时)
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (e.deltaY < 0 && (scrollRef.current?.scrollTop ?? 0) > 0) {
        suspendFollow();
      }
    },
    [suspendFollow]
  );

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      const startY = touchStartYRef.current;
      const curY = e.touches[0]?.clientY;
      if (startY === null || curY === undefined) return;
      // 手指向下拖(内容随之上移)= 用户向上滚动
      if (curY - startY > 8 && (scrollRef.current?.scrollTop ?? 0) > 0) {
        suspendFollow();
      }
    },
    [suspendFollow]
  );

  const handleTouchEnd = useCallback(() => {
    touchStartYRef.current = null;
  }, []);

  // 键盘滚动(PageUp/ArrowUp/Home;焦点须在列表内,Composer 按键不会落到这里)
  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (
        (e.key === 'PageUp' || e.key === 'ArrowUp' || e.key === 'Home') &&
        (scrollRef.current?.scrollTop ?? 0) > 0
      ) {
        suspendFollow();
      }
    },
    [suspendFollow]
  );

  // 1. ResizeObserver: 同时观察内容容器与视口容器。跟底状态下任何尺寸变化(内容跳变、
  // 审批槽位弹出/消失挤压视口)都重新贴底;挂起状态不动作,保持用户阅读位置
  useEffect(() => {
    const contentEl = contentRef.current;
    const scrollEl = scrollRef.current;
    if (!contentEl) return;

    const observer = new ResizeObserver(() => {
      if (!userScrolledUpRef.current) {
        const el = scrollRef.current;
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      }
    });

    observer.observe(contentEl);
    if (scrollEl) observer.observe(scrollEl);
    return () => observer.disconnect();
  }, []);

  // 1.5 会话切换检测:首条消息身份变化 → 重置跟底状态并立即贴底(切会话/新会话置底)。
  // 流式期间首条消息恒定,不误触发
  useEffect(() => {
    const first = messages[0];
    const firstKey = first ? `${first.timestamp}-${first.role}` : 'empty';
    if (firstMessageKeyRef.current !== null && firstMessageKeyRef.current !== firstKey) {
      firstMessageKeyRef.current = firstKey;
      userScrolledUpRef.current = false;
      programmaticScrollRef.current = false;
      setShowScrollBottom(false);
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    } else {
      firstMessageKeyRef.current = firstKey;
    }
  }, [messages]);

  // 2. 状态依赖监听 (涵盖发送瞬间、isStreaming 切换、内容追加、工具标签变更、轮次提交、Gate 请求出现)
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
    gateRequest,
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

  // live 执行卡去重:toolCall 块已随 message_end 物化进转录(in-flight)后,同一调用即从
  // live 卡剔除——否则门控挂起期间同一调用会同时出现「等待确认」块卡与「执行中」live 卡
  const liveToolLabels = useMemo(() => {
    if (!activeToolLabels || activeToolLabels.length === 0) return activeToolLabels ?? [];
    const materialized = new Set<string>();
    for (const m of messages) {
      if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
      for (const b of m.content) {
        if (b.type === 'toolCall' && !toolResultsByCallId.has(b.id)) materialized.add(b.name);
      }
    }
    return activeToolLabels.filter((n) => !materialized.has(n));
  }, [messages, activeToolLabels, toolResultsByCallId]);

  const isEmpty = messages.length === 0 && !streamingContent && !gateRequest;
  // 尾部 quietTailCount 条 = 刚从 live 接管的 in-flight 消息:跳过入场动画(随消息身份重估)
  const quietFrom = Math.max(0, messages.length - (quietTailCount ?? 0));
  // 键 = 过滤后位置(msg-${i})。live 槽键 = 其「未来物化位置」——message_end 时
  // in-flight 消息顶替 live 槽实例(零重挂载,MarkdownView memo 复用),finalize 后索引不变、
  // 实例跨转录落盘持续复用,全程无 class/实例翻转 → 肉眼无闪烁
  const filteredMessages = messages.filter((m) => m.role !== 'toolResult');

  return (
    <div className="relative flex flex-1 min-h-0 flex-col overflow-hidden bg-background">
      {/* Top Gradient Fade Mask */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-background to-transparent z-10"
        aria-hidden="true"
      />

      {/* Error Alert Banner (z-20) */}
      {errorMessage && (
        <div className="sticky top-0 z-20 m-2 flex shrink-0 items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive overflow-hidden animate-in fade-in-0 slide-in-from-top-2 duration-150 motion-reduce:animate-none">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 font-medium leading-relaxed break-all whitespace-pre-wrap">{errorMessage}</div>
          {onDismissError && (
            <button
              type="button"
              onClick={onDismissError}
              className="text-destructive/70 hover:text-destructive p-0.5 rounded transition-colors shrink-0 cursor-pointer"
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
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onKeyDown={handleListKeyDown}
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
                      className="group flex items-start gap-2.5 rounded-lg border bg-card p-2.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer"
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
            {/* 位置键隐式契约:键依赖 pi agent-loop 的 message_end 与 newMessages 推送
                同一消息对象引用(pi agent-loop.ts:355/368),React 才能跨 live→in-flight→落盘
                复用同一 MessageItem 实例(live 槽键 = 未来物化位置);若 pi 升级改变此行为
                (消息对象在转写间重建),流式交接会重现闪烁。 */}
            {filteredMessages.map((msg, i) => (
              <MessageItem
                key={`msg-${i}`}
                message={msg}
                toolResults={toolResultsByCallId}
                activeToolNames={activeToolLabels}
                activeGateRequest={gateRequest}
                pendingGateTotal={pendingGateTotal}
                suppressEntryAnimation={i >= quietFrom}
                sessionKey={sessionKey}
                compactionInfo={
                  compaction && msg.timestamp === compaction.summaryTimestamp
                    ? { tokensBefore: compaction.tokensBefore }
                    : null
                }
              />
            ))}
            {isStreaming && (
              <MessageItem
                key={`msg-${filteredMessages.length}`}
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
                liveToolLabels={liveToolLabels}
                toolResults={toolResultsByCallId}
                activeGateRequest={gateRequest}
                pendingGateTotal={pendingGateTotal}
                sessionKey={sessionKey}
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
          className="absolute bottom-3 right-5 z-20 size-7 rounded-full border border-border shadow-md hover:bg-secondary/90 animate-in fade-in-0 duration-150 motion-reduce:animate-none cursor-pointer"
          title="回到底部"
        >
          <ArrowDown className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
