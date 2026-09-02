import React, { useState, useMemo, useRef } from 'react';
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
  ShieldAlert,
  HelpCircle,
} from 'lucide-react';
import type { AssistantMessage, ChatMessage, PageRefs, RefElementMeta, ToolResultMessage } from '@/lib/types';
import type { GateRequest } from '@/entrypoints/sidepanel/gateAdapter';
import { toolLabel } from '@/lib/types';
import { messageText } from '@/lib/storage';
import { parsePageRefs } from '@/lib/pageRefs';
import { elementChipLabel, elementListLabel } from '@/lib/elementLabel';
import { renderMarkersInText } from './elementMarkerText';
import { MarkdownView } from './MarkdownView';
import { CompactionRow } from './CompactionRow';
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
  /** 正在执行的工具原始名列表(块卡执行窗口:message_end 物化先于结果返回,补"执行中"徽标) */
  activeToolNames?: string[];
  /** 当前待处理的门控请求(confirm/ask;仅用于状态徽标匹配,交互审批在 App 的独立槽位渲染) */
  activeGateRequest?: GateRequest | null;
  /** 当前待确认总数 (仅当 >1 时在当前待确认卡标题旁提示) */
  pendingGateTotal?: number;
  /** 压缩摘要标记:此消息是 Session.compaction 指向的摘要 user 消息 → 渲染分隔线卡 */
  compactionInfo?: { tokensBefore: number } | null;
  /** assistant 回复内元素标记 → 斜体预览引用(App 组合层经 collectPageRefs 提供) */
  assistantElementById?: Map<number, RefElementMeta> | null;
  /** 跳过入场动画:该消息刚从 live 流式气泡接管(内容此前已可见),重播入场动画会"闪一下"。
      实例内冻结(useRef 取首帧值)——finalize 后同 key 实例复用,保持不动画,避免二次闪烁 */
  suppressEntryAnimation?: boolean;
}

function formatTokens(count: number): string {
  if (!count) return '0';
  if (count >= 1000) {
    const k = (count / 1000).toFixed(1).replace(/\.0$/, '');
    return `${k}k`;
  }
  return `${count}`;
}

function renderUserMessageText(text: string, elementById?: Map<number, RefElementMeta> | null) {
  return renderMarkersInText(text, elementById, 'chip');
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
      {elements.map((elem) => (
        <div
          key={`elem-${elem.id}`}
          className="flex items-center gap-1.5 text-[10px] text-foreground bg-background/80 border border-border/50 rounded px-1.5 py-0.5 max-w-full overflow-hidden"
          title={`#${elem.id}${elem.tagName ? ` · <${elem.tagName.toLowerCase()}>` : ''} · ${elem.selector}`}
        >
          <span className="font-mono text-muted-foreground shrink-0">{elem.id}.</span>
          <SquareMousePointer className="size-2.5 shrink-0 text-muted-foreground" />
          <span className="truncate max-w-full">{elementListLabel(elem)}</span>
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

  // Extract latest 3 non-empty lines for collapsed preview(useMemo 必须在条件 return 之前)
  const previewText = useMemo(() => {
    const trimmed = thinking.trim();
    const lines = trimmed.split('\n').filter((l) => l.trim().length > 0);
    return lines.slice(-3).join('\n');
  }, [thinking]);

  if (!thinking || !thinking.trim()) return null;

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
  isWaitingConfirmation?: boolean;
  isQueued?: boolean;
  /** 仅 isWaitingConfirmation 时传入:门控种类(决定琥珀/蓝配色);卡内零交互控件 */
  gateKind?: 'confirm' | 'ask' | null;
  /** 待确认总数(>1 时显示轻提示) */
  pendingGateTotal?: number;
}

function ToolCallCard({
  name,
  args,
  result,
  isExecuting,
  isWaitingConfirmation,
  isQueued,
  gateKind,
  pendingGateTotal,
}: ToolCallCardProps) {
  const [open, setOpen] = useState(false);
  const label = toolLabel(name);

  // 拒绝判定:优先结构化标志(gate.details.denied);旧持久化消息无此标志,保留文本嗅探兜底
  const isDenied = useMemo(() => {
    if (!result) return false;
    if (result.details?.denied === true) return true;
    if (!result.content) return false;
    return result.content.some(
      (c) => c.type === 'text' && c.text.includes('User denied permission')
    );
  }, [result]);

  const isError = result?.isError === true || isDenied;
  const isDone = Boolean(result) && !isExecuting && !isWaitingConfirmation && !isQueued;

  // Extract and truncate result text
  const resultText = useMemo(() => {
    if (!result?.content) return '';
    if (isDenied) return '用户拒绝授权执行该操作';
    return result.content
      .map((c) => (c.type === 'text' ? c.text : ''))
      .join('');
  }, [result, isDenied]);

  const isTruncated = resultText.length > 500;
  const displayResultText = isTruncated ? `${resultText.slice(0, 500)}...` : resultText;

  // 边框和背景调优: 等待确认时用琥珀色/蓝色警示强调
  const cardBorderClass = isWaitingConfirmation
    ? gateKind === 'ask'
      ? 'border-blue-500/40 bg-blue-500/5'
      : 'border-amber-500/40 bg-amber-500/5'
    : 'border-border/60 bg-muted/20';

  const isAskGate = gateKind === 'ask';

  return (
    <div className={`my-1.5 w-full max-w-full rounded-lg border p-2 text-xs text-foreground transition-all animate-in fade-in-0 duration-150 motion-reduce:animate-none ${cardBorderClass}`}>
      {/* Header row (Click to toggle expand) */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 text-left select-none outline-none hover:opacity-80 transition-opacity cursor-pointer"
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {isWaitingConfirmation ? (
            isAskGate ? (
              <HelpCircle className="size-3.5 shrink-0 text-blue-500" />
            ) : (
              <ShieldAlert className="size-3.5 shrink-0 text-amber-500" />
            )
          ) : isQueued ? (
            <ShieldAlert className="size-3.5 shrink-0 text-muted-foreground/70" />
          ) : isExecuting ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="font-medium text-[11px] truncate">{label}</span>
          <span className="text-[10px] text-muted-foreground font-mono truncate">
            ({name})
          </span>
          {isWaitingConfirmation && pendingGateTotal && pendingGateTotal > 1 ? (
            <span className="text-[10px] text-muted-foreground font-normal shrink-0">
              (共 {pendingGateTotal} 个待确认)
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isWaitingConfirmation ? (
            isAskGate ? (
              <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium animate-pulse">
                等待回复
              </span>
            ) : (
              <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium animate-pulse">
                等待确认
              </span>
            )
          ) : isQueued ? (
            <span className="text-[10px] text-muted-foreground/80 font-normal">
              排队中
            </span>
          ) : isExecuting ? (
            <span className="text-[10px] text-muted-foreground">执行中</span>
          ) : isDenied ? (
            <span className="text-[10px] text-destructive font-medium">用户拒绝</span>
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

      {/* 状态化卡:交互审批统一渲染在 App 的审批槽位,卡内只有状态与参数/结果展开 */}

      {/* Expanded details (参数与历史结果) */}
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

            {isWaitingConfirmation ? (
              <div className="text-[10px] text-amber-600 dark:text-amber-400 italic py-0.5">
                正在等待用户确认授权...
              </div>
            ) : isQueued ? (
              <div className="text-[10px] text-muted-foreground italic py-0.5">
                排队等待前序操作确认与执行...
              </div>
            ) : isExecuting ? (
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
  activeToolNames,
  activeGateRequest,
  pendingGateTotal,
  compactionInfo,
  assistantElementById,
  suppressEntryAnimation,
}: MessageItemProps) {
  const [copied, setCopied] = useState(false);
  // 入场动画抑制:随消息身份重估——同位置实例在 live→物化→finalize 间复用(key 稳定),
  // 抑制态冻结可避免 finalize 的 class 翻转闪烁;会话切换(消息对象全变)时重读 prop,
  // 入场动画按新会话正常播放
  const suppressAnimRef = useRef(Boolean(suppressEntryAnimation));
  const lastMessageRef = useRef(message);
  if (lastMessageRef.current !== message) {
    lastMessageRef.current = message;
    suppressAnimRef.current = Boolean(suppressEntryAnimation);
  }

  // 引用 chips:从本条消息 content 的 <page-refs> 块解析(与 LLM 消费同一份字符串,零中间状态)
  const pageRefs = useMemo(
    () => (message.role === 'user' ? parsePageRefs(message.content) : null),
    [message],
  );
  // 本条消息内标记 id → 元素元数据(用户气泡 chip 的预览/tooltip 数据源)
  const elementById = useMemo(
    () => new Map((pageRefs?.elements ?? []).map((e) => [e.id, e])),
    [pageRefs],
  );

  // ── Assistant 内容块(仅 assistant 消息;其余角色为空,保证无条件 hooks 全部先于条件 return)──
  const blocks =
    message.role === 'assistant' && Array.isArray((message as AssistantMessage).content)
      ? (message as AssistantMessage).content
      : [];
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

  // 块序还原:按 content 原始顺序分组 —— 连续 thinking/text 合并为一个气泡段,toolCall
  // 独立成卡插在其原始位置(此前工具卡被统一前置到气泡之前,导致「工具卡跑到最前」错乱)
  const segments = useMemo(() => {
    const segs: Array<
      | { kind: 'bubble'; items: typeof blocks }
      | { kind: 'tool'; block: (typeof toolCallBlocks)[number] }
    > = [];
    for (const b of blocks) {
      if (b.type === 'toolCall') {
        segs.push({ kind: 'tool', block: b });
        continue;
      }
      if (b.type !== 'text' && b.type !== 'thinking') continue;
      if (b.type === 'text' && !b.text.trim()) continue;
      if (b.type === 'thinking' && !b.thinking.trim()) continue;
      const last = segs[segs.length - 1];
      if (last && last.kind === 'bubble') {
        last.items.push(b);
      } else {
        segs.push({ kind: 'bubble', items: [b] });
      }
    }
    return segs;
  }, [blocks]);

  const pendingGateToolName =
    activeGateRequest?.kind === 'confirm' ? activeGateRequest.toolName : activeGateRequest?.kind === 'ask' ? 'ask_user' : null;
  const pendingGateToolCallId = activeGateRequest?.toolCallId ?? null;

  // 门控匹配:首个未出结果的 confirm/ask 工具(当无 toolCallId 时退化匹配首个)
  const firstUnresolvedConfirmCall = useMemo(() => {
    if (!pendingGateToolName) return null;
    return toolCallBlocks.find((b) => b.name === pendingGateToolName && !toolResults?.has(b.id)) ?? null;
  }, [pendingGateToolName, toolCallBlocks, toolResults]);

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
    // 压缩摘要 user 消息 → 分隔线卡(默认收起徽标,可展开摘要全文)
    if (compactionInfo) {
      return (
        <CompactionRow tokensBefore={compactionInfo.tokensBefore} summary={rawText} />
      );
    }
    return (
      <div className="group flex justify-end px-3 py-1 animate-in fade-in-0 slide-in-from-bottom-1 duration-150 motion-reduce:animate-none">
        <div className="flex max-w-[85%] flex-col items-end gap-0.5">
          <div className="w-fit max-w-full rounded-lg bg-secondary text-secondary-foreground px-3 py-1.5 text-sm shadow-xs">
            {/* rawText 已经过 messageText 剥离 <page-refs> 块,正文不泄漏 JSON;标记渲染为内容预览 chip(新旧标记兼容) */}
            <p className="whitespace-pre-wrap break-all leading-relaxed">
              {renderUserMessageText(rawText, elementById)}
            </p>
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

  // Assistant Message(此时 message.role === 'assistant' 已由上方条件 return 保证)
  const assistantMsg = message as AssistantMessage;
  const errorMessage = assistantMsg.errorMessage;
  const usage = assistantMsg.usage;
  const hasUsage = usage && usage.totalTokens > 0;
  const hasVisibleTextOrThinking = textBlocks.length > 0 || thinkingBlocks.length > 0 || Boolean(rawText);
  const hasLiveActivity = Boolean(liveThinking) || (liveToolLabels && liveToolLabels.length > 0);
  // gate pending = turn 空闲等待用户操作,并非生成中:打字点与空 live 气泡都不渲染
  const isTurnIdle = Boolean(activeGateRequest);
  const hasTextInSegments = segments.some(
    (s) => s.kind === 'bubble' && s.items.some((it) => it.type === 'text')
  );
  const showDots =
    Boolean(isStreaming) &&
    !isTurnIdle &&
    !liveThinking &&
    (!liveToolLabels || liveToolLabels.length === 0) &&
    !hasTextInSegments;
  const emptyReply =
    !isStreaming && !errorMessage && !hasVisibleTextOrThinking && toolCallBlocks.length === 0;
  const hasStatus = showDots || Boolean(errorMessage) || Boolean(isCancelled) || emptyReply;
  // 状态节点/流式光标锚定最后一个「气泡段」(末段可能是工具卡,状态必须仍可见)
  const lastBubbleIndex = segments.reduce((acc, s, i) => (s.kind === 'bubble' ? i : acc), -1);
  const hasBubble = lastBubbleIndex >= 0;
  // 行渲染条件:有内容段/live 活动/真实生成中/状态兜底才渲染(gate 空闲等待时整行不渲染)
  const shouldRenderRow =
    segments.length > 0 ||
    hasLiveActivity ||
    hasStatus ||
    Boolean(isStreaming && !isTurnIdle);

  const statusNodes = (
    <>
      {showDots && (
        /* AI Typing Animation (3 bouncing dots) —— 仅真正生成中 */
        <div className="flex items-center gap-1 py-1 px-1">
          <span className="size-1.5 rounded-full bg-muted-foreground/70 animate-bounce [animation-delay:-0.3s]" />
          <span className="size-1.5 rounded-full bg-muted-foreground/70 animate-bounce [animation-delay:-0.15s]" />
          <span className="size-1.5 rounded-full bg-muted-foreground/70 animate-bounce" />
        </div>
      )}
      {errorMessage && (
        <div className="text-xs text-muted-foreground italic leading-relaxed break-all whitespace-pre-wrap">
          {errorMessage}
        </div>
      )}
      {isCancelled && (
        <div className="mt-1.5 text-xs text-muted-foreground">(已停止生成)</div>
      )}
      {emptyReply && (
        <div className="text-xs text-muted-foreground italic">无回复内容</div>
      )}
    </>
  );

  if (!shouldRenderRow) return null;

  const renderToolCard = (block: (typeof toolCallBlocks)[number], i: number) => {
    const result = block.id ? toolResults?.get(block.id) : null;
    const hasResult = Boolean(result);

    // 状态判定顺序(块卡):结果(终态)→ 等待审批(toolCallId 精确匹配,退化首张未决议同名卡)
    // → 排队中(同轮同名其余未决议;判定优先于执行中,未轮到的调用绝不显示执行中)
    // → 执行中(结果未返回但该工具正在执行:恢复执行窗口的 spinner,不再落到兜底"已调用")
    const isWaiting =
      !hasResult &&
      Boolean(
        (pendingGateToolCallId && block.id === pendingGateToolCallId) ||
          (!pendingGateToolCallId &&
            pendingGateToolName === block.name &&
            firstUnresolvedConfirmCall?.id === block.id)
      );

    const isQueued =
      !hasResult &&
      !isWaiting &&
      Boolean(pendingGateToolName && (block.name === pendingGateToolName || block.name === 'execute_js'));

    const isExecuting =
      !hasResult && !isWaiting && !isQueued && Boolean(activeToolNames?.includes(block.name));

    return (
      <ToolCallCard
        key={block.id || `tool-${i}`}
        id={block.id}
        name={block.name}
        args={block.arguments}
        result={result}
        isExecuting={isExecuting}
        isWaitingConfirmation={isWaiting}
        isQueued={isQueued}
        gateKind={isWaiting ? (activeGateRequest?.kind ?? null) : null}
        pendingGateTotal={pendingGateTotal}
      />
    );
  };

  return (
    <div className="flex flex-col gap-1 px-3 py-1">
      <div
        className={`group flex gap-2.5 py-0.5 ${
          suppressAnimRef.current
            ? ''
            : 'animate-in fade-in-0 slide-in-from-bottom-1 duration-150 motion-reduce:animate-none'
        }`}
      >
        <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
          <Bot className="size-3.5" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5 overflow-hidden">
          {/* 块序还原:thinking → text → toolCall 按 content 原始顺序渲染 */}
          {segments.map((seg, i) =>
            seg.kind === 'tool' ? (
              renderToolCard(seg.block, i)
            ) : (
              <div
                key={i}
                className="relative min-w-0 w-fit max-w-full rounded-lg border bg-card p-2.5 text-card-foreground overflow-hidden"
              >
                {/* Live streaming thinking block(仅 live 气泡;流式消息无物化 thinking 块,置于首段首位) */}
                {i === 0 && liveThinking && (
                  <ThinkingBlock
                    thinking={liveThinking}
                    isGenerating={Boolean(isStreaming) && !rawText}
                  />
                )}

                {seg.items.map((item, j) =>
                  item.type === 'thinking' ? (
                    <ThinkingBlock key={j} thinking={item.thinking} />
                  ) : item.type === 'text' ? (
                    <MarkdownView
                      key={j}
                      content={item.text}
                      elementById={assistantElementById}
                      /* 流式光标:内联 ::after 贴在本段最后一个文本块末行(条件与旧光标一致:流式中有文本) */
                      className={
                        i === lastBubbleIndex && j === seg.items.length - 1 && isStreaming && rawText
                          ? 'md-caret'
                          : ''
                      }
                    />
                  ) : null
                )}

                {/* 状态节点附在最后一个气泡段内;无气泡段时独立壳渲染 */}
                {i === lastBubbleIndex && hasStatus && statusNodes}
              </div>
            )
          )}

          {/* Live executing tool calls during streaming(块卡未物化前的过渡卡;物化后由 MessageList 过滤。
              置于内容序末尾 = 即将出现的 toolCall 块的位置) */}
          {liveToolLabels && liveToolLabels.length > 0 && (
            <div className="w-full space-y-1">
              {liveToolLabels.map((toolName, i) => {
                // 状态判定顺序(live 卡):等待审批(仅无 toolCallId 的退化名匹配)→ 排队中 → 执行中。
                // 有门控挂起而非门控目标时一律排队,绝不显示执行中(排队中判定优先于执行中)
                const isWaiting = !pendingGateToolCallId && pendingGateToolName === toolName;
                const isQueued = !isWaiting && Boolean(pendingGateToolName);
                return (
                  <ToolCallCard
                    key={`live-tool-${i}`}
                    name={toolName}
                    isExecuting={!isWaiting && !isQueued}
                    isWaitingConfirmation={isWaiting}
                    isQueued={isQueued}
                    gateKind={isWaiting ? (activeGateRequest?.kind ?? null) : null}
                    pendingGateTotal={pendingGateTotal}
                  />
                );
              })}
            </div>
          )}

          {/* 无气泡段但有 live 思考/状态(纯 thinking 阶段、纯工具卡报错等):气泡壳兜底。
              Bug 3 修复:仅 thinking 时此前整列无气泡壳 → 气泡"消失"空档;此处保证壳连续 */}
          {!hasBubble && (hasStatus || liveThinking) && (
            <div className="relative min-w-0 w-fit max-w-full rounded-lg border bg-card p-2.5 text-card-foreground overflow-hidden">
              {liveThinking && (
                <ThinkingBlock
                  thinking={liveThinking}
                  isGenerating={Boolean(isStreaming) && !rawText}
                />
              )}
              {statusNodes}
            </div>
          )}

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
    </div>
  );
}
