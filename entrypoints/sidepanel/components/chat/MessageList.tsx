import React, { useEffect, useMemo, useRef } from 'react';
import { i18n } from '#i18n';
import {
  Bot,
  FileText,
  Lightbulb,
  HelpCircle,
  CheckSquare,
  Sparkles,
  RefreshCw,
  Settings as SettingsIcon,
} from 'lucide-react';
import type { AssistantMessage, ChatMessage, ToolResultMessage } from '@/lib/types';
import type { GateRequest } from '@/entrypoints/sidepanel/gateAdapter';
import type { QuickPromptsState } from '@/entrypoints/sidepanel/hooks/useQuickPrompts';
import { EMPTY_USAGE } from '@/lib/storage';
import { MessageItem } from './MessageItem';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import {
  Item,
  ItemMedia,
  ItemContent,
  ItemTitle,
  ItemDescription,
} from '@/components/ui/item';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
} from '@/components/ui/message-scroller';

interface MessageListProps {
  /** 所属会话标识:透传 MessageItem 作为入场动画抑制的重估边界;同时作为 scroller 重挂载键(切会话恢复默认滚动位) */
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
  onSelectPrompt: (prompt: string) => void;
  hasProvider: boolean;
  hasModel: boolean;
  activeModelName?: string;
  onOpenSettings: () => void;
  quickPrompts: QuickPromptsState;
  /** 编辑并重发用户消息 */
  onEditResend?: (messageTimestamp: number, newText: string) => void;
  /** 是否允许编辑(非流式、非门控、非压缩) */
  canEditMessage?: boolean;
}

const PROMPT_ICONS = [FileText, Lightbulb, HelpCircle, CheckSquare];

/** 门控卡强制可见:审批卡是阻塞式交互(agent 循环挂起等待),出现即强制贴底,
 *  即使用户上翻阅读也拉回,否则卡片落在视口外会造成「转圈圈无卡」死等。
 *  语义对齐旧体系 gateRequest effect;自动跟底本身不覆盖「用户已上翻」场景。 */
function GatePinner({ gateRequest }: { gateRequest: GateRequest | null }) {
  const scroller = useMessageScroller();
  useEffect(() => {
    if (gateRequest) scroller.scrollToEnd();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gateRequest 出现即触发一次
  }, [gateRequest]);
  return null;
}

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
  onSelectPrompt,
  hasProvider,
  hasModel,
  activeModelName,
  onOpenSettings,
  quickPrompts,
  onEditResend,
  canEditMessage,
}: MessageListProps) {
  const isEmpty = messages.length === 0 && !streamingContent && !streamingThinking && !gateRequest;
  // 过滤后的非 toolResult 消息(工具结果合入 ToolCallCard 内联展示)
  const filteredMessages = useMemo(() => messages.filter((m) => m.role !== 'toolResult'), [messages]);
  // 尾部 quietTailCount 条 = 刚从 live 接管的 in-flight 消息:跳过入场动画(随消息身份重估)
  const quietFrom = Math.max(0, filteredMessages.length - (quietTailCount ?? 0));

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

  const liveTimestampRef = useRef(Date.now());
  if (!isStreaming) {
    liveTimestampRef.current = Date.now();
  }

  // live 项存在条件:流式中且(有正文/思考/活动工具,或在等待首个 token)
  const hasLiveContent = Boolean(
    (streamingContent && streamingContent.length > 0) ||
      (streamingThinking && streamingThinking.length > 0) ||
      (liveToolLabels && liveToolLabels.length > 0)
  );

  const isWaitingForFirstToken = Boolean(
    isStreaming &&
      (messages.length === 0 ||
        messages[messages.length - 1]?.role === 'user' ||
        messages[messages.length - 1]?.role === 'toolResult')
  );

  const hasLiveItem = Boolean(isStreaming && (hasLiveContent || isWaitingForFirstToken));

  // 单一统一渲染数组:将 live 流式项并入 filteredMessages 数组末尾,
  // 消除不同 JSX 槽位导致的卸载/重挂载——live 与物化使用相同 key(`msg-${i}`)并在
  // 同一个数组槽中协调,物化时仅为 props 更新,彻底杜绝“正文输出完闪一下”
  const itemsToRender = useMemo(() => {
    const list: Array<{
      key: string;
      messageId: string;
      message: ChatMessage;
      isStreaming?: boolean;
      isCancelled?: boolean;
      liveThinking?: string;
      liveToolLabels?: string[];
      suppressEntryAnimation: boolean;
      scrollAnchor: boolean;
      compactionInfo?: { tokensBefore: number } | null;
    }> = filteredMessages.map((msg, i) => ({
      key: `msg-${i}`,
      messageId: `msg-${i}`,
      message: msg,
      suppressEntryAnimation: i >= quietFrom,
      scrollAnchor: msg.role === 'user',
      compactionInfo:
        compaction && msg.timestamp === compaction.summaryTimestamp
          ? { tokensBefore: compaction.tokensBefore }
          : null,
    }));

    if (hasLiveItem) {
      list.push({
        key: `msg-${filteredMessages.length}`,
        messageId: `msg-${filteredMessages.length}`,
        message: {
          role: 'assistant',
          content: [
            ...(streamingThinking ? [{ type: 'thinking' as const, thinking: streamingThinking }] : []),
            ...(streamingContent || !streamingThinking ? [{ type: 'text' as const, text: streamingContent ?? '' }] : []),
          ],
          api: 'openai-completions',
          provider: '',
          model: '',
          stopReason: 'stop',
          usage: EMPTY_USAGE,
          timestamp: liveTimestampRef.current,
        } satisfies AssistantMessage,
        isStreaming: true,
        isCancelled: isCancelled,
        liveThinking: streamingThinking,
        liveToolLabels: liveToolLabels,
        suppressEntryAnimation: false,
        scrollAnchor: false,
      });
    }

    return list;
  }, [
    filteredMessages,
    hasLiveItem,
    streamingContent,
    streamingThinking,
    isCancelled,
    liveToolLabels,
    quietFrom,
    compaction,
  ]);

  return (
    <div className="relative flex flex-1 min-h-0 flex-col overflow-hidden bg-background">
      {isEmpty ? (
        /* 空态:无滚动语义,独立容器居中 */
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="flex min-h-full flex-col justify-center px-3 py-6 text-center animate-in fade-in-0 duration-150 motion-reduce:animate-none">
            {/* Header & Logo */}
            <Empty className="border-0 p-0 gap-3 mb-6 flex-initial">
              <EmptyHeader className="gap-1">
                <EmptyMedia variant="icon" className="mb-1 size-10 rounded-lg border bg-muted text-muted-foreground">
                  <Bot className="size-5" />
                </EmptyMedia>
                <EmptyTitle className="text-sm font-semibold tracking-tight text-foreground">
                  {i18n.t('messages.welcomeTitle')}
                </EmptyTitle>
                <EmptyDescription className="text-xs text-muted-foreground max-w-[260px] leading-relaxed">
                  {hasModel && activeModelName ? (
                    <span>{i18n.t('messages.currentModel')} <span className="font-medium text-foreground">{activeModelName}</span></span>
                  ) : (
                    <span>{i18n.t('messages.welcomeSubtitle')}</span>
                  )}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>

            {/* If no provider / model configured */}
            {(!hasProvider || !hasModel) && (
              <Alert className="mb-4 text-left bg-muted/30">
                <SettingsIcon className="size-4" />
                <AlertTitle className="text-xs font-semibold text-foreground">
                  {i18n.t('messages.setupIncomplete')}
                </AlertTitle>
                <AlertDescription className="text-xs text-muted-foreground leading-relaxed">
                  {!hasProvider
                    ? i18n.t('messages.setupNoProvider')
                    : i18n.t('messages.setupNoModel')}
                  <div className="mt-2.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onOpenSettings}
                      className="h-7 text-xs gap-1.5"
                    >
                      <SettingsIcon className="size-3" />
                      {i18n.t('messages.goSettings')}
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Quick Prompt Cards */}
            {hasModel && quickPrompts.available && (
              <div className="space-y-1.5 text-left">
                <div className="flex items-center justify-between px-1">
                  <p className="text-xs font-medium text-muted-foreground">{i18n.t('messages.starterPrompts')}</p>
                  <TooltipProvider delay={200}>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span className="inline-flex">
                            <button
                              type="button"
                              onClick={quickPrompts.regenerate}
                              disabled={quickPrompts.loading}
                              className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted/60 transition-colors disabled:opacity-40"
                              aria-label={i18n.t('messages.refreshPrompts')}
                            >
                              <RefreshCw className={quickPrompts.loading ? 'size-3 animate-spin' : 'size-3'} />
                            </button>
                          </span>
                        }
                      />
                      <TooltipContent side="top">
                        {i18n.t('messages.refreshPrompts')}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>

                {quickPrompts.loading ? (
                  <div className="grid grid-cols-1 gap-1.5">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2.5 rounded-lg border bg-card/60 p-2.5"
                      >
                        <Skeleton className="size-4 shrink-0 mt-0.5" />
                        <div className="flex-1 space-y-1.5 py-0.5">
                          <Skeleton className="h-3 w-1/3" />
                          <Skeleton className="h-2.5 w-2/3" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-1.5">
                    {quickPrompts.items.map((item, idx) => {
                      const Icon = PROMPT_ICONS[idx] ?? Sparkles;
                      return (
                        <Item
                          key={`${item.title}-${idx}`}
                          variant="outline"
                          render={<button type="button" />}
                          onClick={() => onSelectPrompt(item.prompt)}
                          className="w-full rounded-lg bg-card p-2.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground items-start gap-2.5"
                        >
                          <ItemMedia
                            variant="icon"
                            className="size-7 rounded-md shrink-0 border bg-muted/60 text-muted-foreground"
                          >
                            <Icon className="size-3.5" />
                          </ItemMedia>
                          <ItemContent className="min-w-0 flex-1 gap-0.5">
                            <ItemTitle className="text-xs font-medium text-foreground">
                              {item.title}
                            </ItemTitle>
                            <ItemDescription className="text-[11px] text-muted-foreground truncate">
                              {item.desc}
                            </ItemDescription>
                          </ItemContent>
                        </Item>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* 官方 MessageScroller:autoScroll 仅在读者位于底部时跟随(上翻自动退避、回底恢复),
         * scrollAnchor 把每轮首条用户消息锚在视口近顶(AI 回复原地长进屏幕),
         * preserveScrollOnPrepend 保住历史加载位置;key=sessionKey 切会话重挂载走 defaultScrollPosition */
        <MessageScrollerProvider
          key={sessionKey}
          autoScroll
          defaultScrollPosition="end"
          scrollPreviousItemPeek={64}
        >
          <GatePinner gateRequest={gateRequest ?? null} />
          <MessageScroller className="flex-1 min-h-0">
            <MessageScrollerViewport aria-label="Messages" preserveScrollOnPrepend className="message-scroll-fade-mask px-2 pt-2.5 pb-2.5">
              {/* 位置键隐式契约:键依赖 pi agent-loop 的 message_end 与 newMessages 推送
                  同一消息对象引用(pi agent-loop.ts:355/368),React 才能跨 live→in-flight→落盘
                  复用同一 MessageItem 实例(live 槽键 = 未来物化位置);若 pi 升级改变此行为
                  (消息对象在转写间重建),流式交接会重现闪烁。 */}
              <MessageScrollerContent className="gap-1 pb-12">
                {itemsToRender.map((item) => (
                  <MessageScrollerItem
                    key={item.key}
                    messageId={item.messageId}
                    scrollAnchor={item.scrollAnchor}
                  >
                    <MessageItem
                      message={item.message}
                      toolResults={toolResultsByCallId}
                      activeToolNames={item.isStreaming ? undefined : activeToolLabels}
                      activeGateRequest={gateRequest}
                      pendingGateTotal={pendingGateTotal}
                      suppressEntryAnimation={item.suppressEntryAnimation}
                      sessionKey={sessionKey}
                      compactionInfo={item.compactionInfo}
                      onEditResend={onEditResend}
                      canEdit={canEditMessage}
                      isStreaming={item.isStreaming}
                      isCancelled={item.isCancelled}
                      liveThinking={item.liveThinking}
                      liveToolLabels={item.liveToolLabels}
                    />
                  </MessageScrollerItem>
                ))}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            {/* 回到底按钮:官方件自带 active 态(离底出现/贴底隐藏) */}
            <TooltipProvider delay={200}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <MessageScrollerButton
                      direction="end"
                      size="icon"
                      className="bottom-12 z-20 size-7 rounded-full border border-border shadow-md"
                      aria-label={i18n.t('messages.backToBottom')}
                    />
                  }
                />
                <TooltipContent side="top">
                  {i18n.t('messages.backToBottom')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </MessageScroller>
        </MessageScrollerProvider>
      )}
    </div>
  );
}