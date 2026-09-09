import React, { useState, useMemo, useRef, useEffect } from 'react';
import { i18n } from '#i18n';
import {
  Copy,
  Check,
  Pencil,
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  Globe,
  Wrench,
  SquareMousePointer,
  ShieldAlert,
  HelpCircle,
  Link2,
} from 'lucide-react';
import type { AssistantMessage, ChatMessage, PageRefs, RefElementMeta, ToolResultMessage } from '@/lib/types';
import type { GateRequest } from '@/entrypoints/sidepanel/gateAdapter';
import { toolLabel } from '@/lib/toolLabels';
import { messageText } from '@/lib/storage';
import { parsePageRefs } from '@/lib/pageRefs';
import { elementChipLabel, elementListLabel } from '@/lib/elementLabel';
import { renderMarkersInText } from './elementMarkerText';
import { MarkdownView } from './MarkdownView';
import { CompactionRow } from './CompactionRow';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Message, MessageAvatar, MessageContent, MessageFooter } from '@/components/ui/message';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Spinner } from '@/components/ui/spinner';
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { Badge } from '@/components/ui/badge';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import { cn } from '@/lib/utils';

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
  /** 所属会话标识:入场动画抑制的重估边界(跨会话实例复用时解冻) */
  sessionKey: string;
  /** 跳过入场动画:该消息刚从 live 流式气泡接管(内容此前已可见),重播入场动画会"闪一下"。
      会话为界的实例内冻结——同会话内 live→物化→finalize 的对象替换不重估,抑制态保持;
      跨会话实例复用时按新会话重估,入场动画正常播放 */
  suppressEntryAnimation?: boolean;
  /** 编辑并重发用户消息回调(以原消息 timestamp 为定位键, 传入新编辑文本) */
  onEditResend?: (messageTimestamp: number, newText: string) => void;
  /** 外部编辑使能状态(非流式、非门控、非压缩时允许编辑) */
  canEdit?: boolean;
}

function formatTokens(count: number): string {
  if (!count) return '0';
  if (count >= 1000) {
    const k = (count / 1000).toFixed(1).replace(/\.0$/, '');
    return `${k}k`;
  }
  return `${count}`;
}

/**
 * 流式平滑揭示: 目标文本(store 80ms 节流批次) → rAF 逐帧追赶, 文字连续平滑流出而非整块蹦出。
 * 本地 state 驱动重渲染仅局限于当前组件自身, 不触发全局与全列表重绘。
 * 遵循系统 prefers-reduced-motion 约定, 减少动画时直接全量呈现。
 */
function useSmoothText(target: string, enabled: boolean): string {
  const prefersReducedMotion = typeof window !== 'undefined'
    ? window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
    : false;

  const isSmooth = enabled && !prefersReducedMotion;
  const shownLenRef = useRef(isSmooth ? 0 : target.length);
  const [shownLen, setShownLen] = useState(shownLenRef.current);
  const targetRef = useRef(target);
  targetRef.current = target;
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isSmooth) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      shownLenRef.current = target.length;
      setShownLen(target.length);
      return;
    }

    const tick = () => {
      const full = targetRef.current;
      if (shownLenRef.current > full.length) {
        shownLenRef.current = full.length;
      }
      const remaining = full.length - shownLenRef.current;
      if (remaining <= 0) {
        rafRef.current = null;
        return; // 已追平, 待目标下一次变长时由 effect 触发重新调度
      }
      // 动态步长: 剩余字数多时自适应加速, 接近终点时平缓递增(每帧最少 1 字符)
      const step = Math.max(1, Math.ceil(remaining / 8));
      shownLenRef.current = Math.min(full.length, shownLenRef.current + step);
      setShownLen(shownLenRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };

    if (targetRef.current.length > shownLenRef.current) {
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [target, isSmooth]);

  return isSmooth ? target.slice(0, shownLen) : target;
}

/** 流式末段平滑揭示: 仅在流式末尾文本段用已揭示前缀渲染 Markdown; 物化后自动走 MarkdownView 全量直渲 */
function SmoothMarkdown({ text, className }: { text: string; className?: string }) {
  const shown = useSmoothText(text, true);
  return <MarkdownView content={shown} className={className} />;
}

function renderUserMessageText(text: string, elementById?: Map<number, RefElementMeta> | null) {
  return renderMarkersInText(text, elementById);
}

function UserRefSnapshot({ refs }: { refs: PageRefs }) {
  const [open, setOpen] = useState(false);
  const tabs = refs.tabs ?? [];
  const elements = refs.elements ?? [];
  const total = tabs.length + elements.length;

  if (total === 0) return null;

  const isMany = total > 2;

  const renderItems = () => (
    <TooltipProvider delay={200}>
      <div className="space-y-1">
        {tabs.map((tab, idx) => (
          <Tooltip key={`tab-${idx}`}>
            <TooltipTrigger
              render={
                <Badge
                  variant="outline"
                  className="h-auto max-w-full justify-start rounded px-1.5 py-0.5 text-[10px] font-normal leading-normal gap-1.5 text-foreground/90 bg-foreground/5 border-foreground/10 select-none hover:bg-foreground/10"
                />
              }
            >
              <Globe className="size-2.5 shrink-0 text-muted-foreground" />
              <span className="truncate max-w-full">{tab.title || tab.url}</span>
              {tab.focused && (
                <Badge
                  variant="secondary"
                  className="h-auto shrink-0 rounded bg-foreground/8 px-1 py-0 text-[9px] leading-[14px] text-foreground font-medium border-transparent"
                >
                  当前
                </Badge>
              )}
            </TooltipTrigger>
            <TooltipContent side="top">
              {`${tab.url} · #${tab.tabId}`}
            </TooltipContent>
          </Tooltip>
        ))}
        {elements.map((elem) => (
          <Tooltip key={`elem-${elem.id}`}>
            <TooltipTrigger
              render={
                <Badge
                  variant="outline"
                  className="h-auto max-w-full justify-start rounded px-1.5 py-0.5 text-[10px] font-normal leading-normal gap-1.5 text-foreground/90 bg-foreground/5 border-foreground/10 select-none hover:bg-foreground/10"
                />
              }
            >
              <span className="font-mono text-muted-foreground shrink-0">{elem.id}.</span>
              <SquareMousePointer className="size-2.5 shrink-0 text-muted-foreground" />
              <span className="truncate max-w-full">{elementListLabel(elem)}</span>
            </TooltipTrigger>
            <TooltipContent side="top">
              {`#${elem.id}${elem.tagName ? ` · <${elem.tagName.toLowerCase()}>` : ''} · ${elem.selector}`}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );

  return (
    <div className="pt-1 mt-1 border-t border-foreground/10 text-xs w-full">
      {isMany ? (
        <Collapsible open={open} onOpenChange={setOpen} className="space-y-1">
          <CollapsibleTrigger
            render={
              <button
                type="button"
                className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground select-none transition-colors py-0.5"
              />
            }
          >
            <span>{i18n.t('messages.refCount', { total })}</span>
            {open ? <ChevronDown className="size-2.5" /> : <ChevronRight className="size-2.5" />}
          </CollapsibleTrigger>
          <CollapsibleContent className="animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none">
            {renderItems()}
          </CollapsibleContent>
        </Collapsible>
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
  // 流式思考过程中逐帧平滑揭示文字; 物化完成后直接全量显示
  const shownThinking = useSmoothText(thinking, isGenerating);

  // Extract latest 3 non-empty lines for collapsed preview(useMemo 必须在条件 return 之前)
  const previewText = useMemo(() => {
    const trimmed = thinking.trim();
    const lines = trimmed.split('\n').filter((l) => l.trim().length > 0);
    return lines.slice(-3).join('\n');
  }, [thinking]);

  if (!thinking || !thinking.trim()) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="my-1 text-xs w-full">
      <CollapsibleTrigger
        render={
          <button
            type="button"
            className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground select-none transition-colors py-0.5"
          />
        }
      >
        {isGenerating ? (
          <Spinner className="size-3 text-muted-foreground shrink-0" />
        ) : (
          <Brain className="size-3 shrink-0" />
        )}
        <span>{isGenerating ? i18n.t('messages.thinking') : i18n.t('messages.thinkingDone')}</span>
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
      </CollapsibleTrigger>

      {!open && (
        <TooltipProvider delay={200}>
          <Tooltip>
            <TooltipTrigger
              render={
                <div
                  onClick={() => setOpen(true)}
                  className="group/preview relative mt-0.5 border-l-2 border-border/60 pl-2.5 hover:border-border transition-colors select-none"
                  aria-label={i18n.t('messages.thinkingExpand')}
                />
              }
            >
              <p className="line-clamp-3 whitespace-pre-wrap break-all text-[11px] leading-relaxed text-muted-foreground/75 group-hover/preview:text-muted-foreground transition-colors">
                {previewText}
              </p>
            </TooltipTrigger>
            <TooltipContent side="top">
              {i18n.t('messages.thinkingExpand')}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      <CollapsibleContent>
        <div className="mt-1 whitespace-pre-wrap break-all border-l-2 border-border pl-2.5 text-[11px] leading-relaxed text-muted-foreground animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none">
          {shownThinking}
        </div>
      </CollapsibleContent>
    </Collapsible>
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
    if (isDenied) return i18n.t('messages.denied');
    return result.content
      .map((c) => (c.type === 'text' ? c.text : ''))
      .join('');
  }, [result, isDenied]);

  const isTruncated = resultText.length > 500;
  const displayResultText = isTruncated ? `${resultText.slice(0, 500)}...` : resultText;

  // 边框和背景调优: 等待确认/回复时用主题 token 强调
  const cardBorderClass = isWaitingConfirmation
    ? gateKind === 'ask'
      ? 'border-primary/30 bg-primary/5'
      : 'border-border/80 bg-muted/40'
    : 'border-border/60 bg-muted/20';

  const isAskGate = gateKind === 'ask';

  // 参数简要摘要 (单参数提炼或 JSON 截断)
  const argsSummary = useMemo(() => {
    if (!args || Object.keys(args).length === 0) return '';
    const keys = Object.keys(args);
    if (keys.length === 1) {
      const key = keys[0];
      if (key === undefined) return '';
      const val = args[key];
      if (typeof val === 'string') return val.trim().slice(0, 70);
      if (typeof val === 'number' || typeof val === 'boolean') return `${key}: ${val}`;
    }
    const str = JSON.stringify(args);
    return str.length > 70 ? `${str.slice(0, 70)}…` : str;
  }, [args]);

  const statusIcon = isWaitingConfirmation ? (
    isAskGate ? (
      <HelpCircle className="size-3.5 shrink-0 text-primary" />
    ) : (
      <ShieldAlert className="size-3.5 shrink-0 text-muted-foreground" />
    )
  ) : isQueued ? (
    <ShieldAlert className="size-3.5 shrink-0 text-muted-foreground/70" />
  ) : isExecuting ? (
    <Spinner className="size-3.5 shrink-0 text-muted-foreground" />
  ) : isError ? (
    <Wrench className="size-3.5 shrink-0 text-destructive" />
  ) : (
    <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
  );

  const statusText = isWaitingConfirmation ? (
    isAskGate ? (
      <span className="text-[10px] text-primary font-medium animate-pulse">
        {i18n.t('messages.waitingReply')}
      </span>
    ) : (
      <span className="text-[10px] text-muted-foreground font-medium animate-pulse">
        {i18n.t('messages.waitingConfirm')}
      </span>
    )
  ) : isQueued ? (
    <span className="text-[10px] text-muted-foreground/80 font-normal">
      {i18n.t('messages.queued')}
    </span>
  ) : isExecuting ? (
    <span className="text-[10px] text-primary font-medium animate-pulse">
      {i18n.t('messages.executing')}
    </span>
  ) : isDenied ? (
    <span className="text-[10px] text-destructive font-medium">
      {i18n.t('messages.userDenied')}
    </span>
  ) : isError ? (
    <span className="text-[10px] text-destructive font-medium">
      {i18n.t('messages.failed')}
    </span>
  ) : isDone ? (
    <span className="text-[10px] text-muted-foreground/70">
      {i18n.t('messages.completed')}
    </span>
  ) : (
    <span className="text-[10px] text-muted-foreground/70">
      {i18n.t('messages.invoked')}
    </span>
  );

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="my-1.5 w-full max-w-full"
    >
      <Item
        variant="outline"
        size="xs"
        className={cn(
          'w-full flex-col items-stretch p-2 text-xs text-foreground transition-all duration-150 animate-in fade-in-0 motion-reduce:animate-none',
          cardBorderClass
        )}
      >
        {/* Header row (Click to toggle expand) */}
        <CollapsibleTrigger
          nativeButton={false}
          render={
            <div
              role="button"
              tabIndex={0}
              className="flex w-full items-center justify-between gap-2 text-left select-none outline-none hover:opacity-85 transition-opacity"
            />
          }
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <ItemMedia variant="icon" className="shrink-0">
              {statusIcon}
            </ItemMedia>
            <ItemContent className="min-w-0 flex-1 gap-0.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <ItemTitle className="font-medium text-[11px] truncate text-foreground leading-none">
                  {label}
                </ItemTitle>
                <span className="text-[10px] text-muted-foreground font-mono truncate leading-none">
                  ({name})
                </span>
                {isWaitingConfirmation && pendingGateTotal && pendingGateTotal > 1 ? (
                  <span className="text-[10px] text-muted-foreground font-normal shrink-0 leading-none">
                    {i18n.t('messages.pendingGates', { total: pendingGateTotal })}
                  </span>
                ) : null}
              </div>
              {argsSummary ? (
                <ItemDescription className="text-[10px] font-mono text-muted-foreground truncate line-clamp-1 leading-tight">
                  {argsSummary}
                </ItemDescription>
              ) : null}
            </ItemContent>
          </div>

          <ItemActions className="shrink-0 gap-1.5">
            {statusText}
            {open ? (
              <ChevronDown className="size-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-3 text-muted-foreground" />
            )}
          </ItemActions>
        </CollapsibleTrigger>

        {/* 状态化卡:交互审批统一渲染在 App 的审批槽位,卡内只有状态与参数/结果展开 */}

        {/* Expanded details (参数与历史结果) */}
        <CollapsibleContent className="w-full">
          <div className="mt-2 pt-2 border-t border-border/40 space-y-2 text-[11px] animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none">
            {/* Parameters */}
            {args && Object.keys(args).length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] font-medium text-muted-foreground">{i18n.t('messages.callArgs')}</div>
                <pre className="font-mono text-[10px] bg-background/80 rounded p-1.5 border border-border/40 overflow-x-auto whitespace-pre-wrap break-all max-h-36">
                  {JSON.stringify(args, null, 2)}
                </pre>
              </div>
            )}

            {/* Result */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] font-medium text-muted-foreground">
                <span>{i18n.t('messages.result')}</span>
                {isTruncated && (
                  <span className="text-[9px] text-muted-foreground/70">
                    {i18n.t('messages.resultTruncated', { total: resultText.length })}
                  </span>
                )}
              </div>

              {isWaitingConfirmation ? (
                <div className="text-[10px] text-muted-foreground italic py-0.5">
                  {i18n.t('messages.waitingUserConfirm')}
                </div>
              ) : isQueued ? (
                <div className="text-[10px] text-muted-foreground italic py-0.5">
                  {i18n.t('messages.queuedBehind')}
                </div>
              ) : isExecuting ? (
                <div className="text-[10px] text-muted-foreground italic py-0.5">
                  {i18n.t('messages.waitingResult')}
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
                  {i18n.t('messages.completedNoOutput')}
                </div>
              ) : (
                <div className="text-[10px] text-muted-foreground italic py-0.5">
                  {i18n.t('messages.waitingResultMore')}
                </div>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </Item>
    </Collapsible>
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
  sessionKey,
  suppressEntryAnimation,
  onEditResend,
  canEdit: canEditProp,
}: MessageItemProps) {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const rawText = messageText(message);
  const [editText, setEditText] = useState(rawText);

  // 入场动画抑制:重估以会话为界——同会话内 live→物化→finalize 的对象替换不重估
  // (抑制态冻结,避免 finalize 时抑制解除导致动画重播闪烁);跨会话实例复用
  // (位置键跨会话命中)时按新会话重估,入场动画正常播放
  const suppressAnimRef = useRef(Boolean(suppressEntryAnimation));
  const lastSessionKeyRef = useRef(sessionKey);
  if (lastSessionKeyRef.current !== sessionKey) {
    lastSessionKeyRef.current = sessionKey;
    suppressAnimRef.current = Boolean(suppressEntryAnimation);
    if (isEditing) setIsEditing(false);
  }

  // 外部传入优先, 否则从流式和待处理门控状态推导
  const canEdit = canEditProp ?? (!isStreaming && !activeGateRequest);

  // 当外部进入不可编辑态(流式启动或弹出门控)且正在编辑时, 自动平稳收起
  useEffect(() => {
    if (!canEdit && isEditing) {
      setIsEditing(false);
    }
  }, [canEdit, isEditing]);

  const handleStartEdit = () => {
    if (!canEdit) return;
    setEditText(rawText);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditText(rawText);
  };

  const handleConfirmResend = () => {
    const trimmed = editText.trim();
    if (!trimmed || !canEdit || !onEditResend) return;
    setIsEditing(false);
    onEditResend(message.timestamp, trimmed);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelEdit();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleConfirmResend();
    }
  };

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

    if (isEditing) {
      return (
        <Message
          align="end"
          className="group px-3 py-1 animate-in fade-in-0 duration-150 motion-reduce:animate-none"
        >
          <MessageContent className="w-full max-w-[85%] items-end gap-1.5">
            <div className="w-full rounded-xl border border-border/80 bg-card p-2.5 shadow-xs flex flex-col gap-2">
              <Textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={handleEditKeyDown}
                className="w-full text-xs leading-relaxed min-h-[72px] resize-y bg-background"
                placeholder={i18n.t('composer.placeholder')}
                autoFocus
              />
              <div className="flex items-center gap-1.5 pt-0.5">
                {pageRefs && (pageRefs.tabs.length > 0 || pageRefs.elements.length > 0) && (
                  <HoverCard>
                    <HoverCardTrigger
                      delay={200}
                      closeDelay={150}
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground gap-1 font-normal select-none"
                        />
                      }
                    >
                      <Link2 className="size-3 shrink-0" />
                      <span>
                        {i18n.t('messages.refCount', {
                          total: pageRefs.tabs.length + pageRefs.elements.length,
                        })}
                      </span>
                    </HoverCardTrigger>
                    <HoverCardContent side="top" align="start" className="w-64 p-2 text-xs">
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        <TooltipProvider delay={200}>
                          {pageRefs.tabs.map((tab, idx) => (
                            <Tooltip key={`edit-tab-${idx}`}>
                              <TooltipTrigger
                                render={
                                  <div className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] hover:bg-muted transition-colors cursor-default select-none min-w-0" />
                                }
                              >
                                <Globe className="size-3 shrink-0 text-muted-foreground" />
                                <span className="truncate flex-1 text-foreground">
                                  {tab.title || tab.url}
                                </span>
                                {tab.focused && (
                                  <Badge
                                    variant="secondary"
                                    className="h-auto shrink-0 rounded px-1 py-0 text-[9px] leading-[14px] font-medium"
                                  >
                                    {i18n.t('messages.current')}
                                  </Badge>
                                )}
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                {`${tab.url} · #${tab.tabId}`}
                              </TooltipContent>
                            </Tooltip>
                          ))}
                          {pageRefs.elements.map((elem) => (
                            <Tooltip key={`elem-${elem.id}`}>
                              <TooltipTrigger
                                render={
                                  <div className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] hover:bg-muted transition-colors cursor-default select-none min-w-0" />
                                }
                              >
                                <span className="font-mono text-muted-foreground shrink-0">
                                  {elem.id}.
                                </span>
                                <SquareMousePointer className="size-3 shrink-0 text-muted-foreground" />
                                <span className="truncate flex-1 text-foreground">
                                  {elementListLabel(elem)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                {`#${elem.id}${elem.tagName ? ` · <${elem.tagName.toLowerCase()}>` : ''} · ${elem.selector}`}
                              </TooltipContent>
                            </Tooltip>
                          ))}
                        </TooltipProvider>
                      </div>
                    </HoverCardContent>
                  </HoverCard>
                )}
                <div className="flex-1" />
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={handleCancelEdit}
                  className="h-6 px-2 text-xs"
                >
                  {i18n.t('messages.cancelResend')}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  disabled={!canEdit || !editText.trim()}
                  onClick={handleConfirmResend}
                  className="h-6 px-2.5 text-xs gap-1"
                >
                  {i18n.t('messages.confirmResend')}
                </Button>
              </div>
            </div>
          </MessageContent>
        </Message>
      );
    }

    return (
      <Message
        align="end"
        className="group px-3 py-1 animate-in fade-in-0 slide-in-from-bottom-1 duration-150 motion-reduce:animate-none"
      >
        <MessageContent className="max-w-[85%] items-end gap-0.5">
          <Bubble variant="secondary" align="end" className="max-w-full">
            <BubbleContent className="rounded-lg px-3 py-1.5 text-sm shadow-xs">
              {/* rawText 已经过 messageText 剥离 <page-refs> 块,正文不泄漏 JSON;标记渲染为内容预览 chip(新旧标记兼容) */}
              <p className="whitespace-pre-wrap break-all leading-relaxed">
                {renderUserMessageText(rawText, elementById)}
              </p>
              {pageRefs && <UserRefSnapshot refs={pageRefs} />}
            </BubbleContent>
          </Bubble>
          <MessageFooter className="px-1 py-0 justify-end gap-1">
            {onEditResend && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={!canEdit}
                onClick={handleStartEdit}
                className="h-5 px-1.5 opacity-0 group-hover:opacity-100 transition-opacity text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 font-normal disabled:opacity-40 disabled:pointer-events-none"
                aria-label={i18n.t('messages.editResend')}
              >
                <Pencil className="size-3" />
                <span>{i18n.t('messages.editResend')}</span>
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={handleCopy}
              className="h-5 px-1.5 opacity-0 group-hover:opacity-100 transition-opacity text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 font-normal"
              aria-label={i18n.t('messages.copy')}
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              <span>{copied ? i18n.t('messages.copied') : i18n.t('messages.copy')}</span>
            </Button>
          </MessageFooter>
        </MessageContent>
      </Message>
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
        <Bubble variant="destructive" align="start" className="mt-1 max-w-full">
          <BubbleContent className="text-xs italic leading-relaxed break-all whitespace-pre-wrap rounded-md px-2 py-1">
            {errorMessage}
          </BubbleContent>
        </Bubble>
      )}
      {isCancelled && (
        <div className="mt-1.5 text-xs text-muted-foreground">{i18n.t('messages.stopped')}</div>
      )}
      {emptyReply && (
        <div className="text-xs text-muted-foreground italic">{i18n.t('messages.emptyReply')}</div>
      )}
    </>
  );

  if (!shouldRenderRow) return null;

  const renderToolCard = (block: (typeof toolCallBlocks)[number], i: number) => {
    const result = block.id ? toolResults?.get(block.id) : null;
    const hasResult = Boolean(result);

    // 状态判定顺序(块卡):结果(终态)→ 等待审批(toolCallId 精确匹配,退化首张未决议同名卡)
    // → {i18n.t('messages.queued')}(同轮同名其余未决议;判定优先于执行中,未轮到的调用绝不显示执行中)
    // → 执行中(结果未返回但该工具正在执行:恢复执行窗口的 spinner,不落到兜底"已调用")
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
      <Message
        align="start"
        className={cn(
          "group flex flex-col gap-1.5 py-0.5",
          suppressAnimRef.current
            ? ''
            : 'animate-in fade-in-0 slide-in-from-bottom-1 duration-150 motion-reduce:animate-none'
        )}
      >
        <MessageAvatar className="size-6 min-w-6 self-start rounded-md border bg-muted text-muted-foreground">
          <Bot className="size-3.5" />
        </MessageAvatar>

        <MessageContent className="min-w-0 w-full items-start gap-1 overflow-hidden">
          {/* 块序还原:thinking → text → toolCall 按 content 原始顺序渲染 */}
          {segments.map((seg, i) =>
            seg.kind === 'tool' ? (
              renderToolCard(seg.block, i)
            ) : (
              <MessageContent
                key={i}
                className="relative min-w-0 w-full max-w-full"
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
                      i === lastBubbleIndex && j === seg.items.length - 1 && isStreaming && rawText ? (
                        <SmoothMarkdown
                          key={j}
                          text={item.text}
                          /* 流式光标:内联 ::after 贴在本段最后一个文本块末行(条件与旧光标一致:流式中有文本) */
                          className="md-caret"
                        />
                      ) : (
                        <MarkdownView
                          key={j}
                          content={item.text}
                        />
                      )
                    ) : null
                  )}

                  {/* 状态节点附在最后一个气泡段内;无气泡段时独立壳渲染 */}
                  {i === lastBubbleIndex && hasStatus && statusNodes}
                </MessageContent>
            )
          )}

          {/* Live executing tool calls during streaming(块卡未物化前的过渡卡;物化后由 MessageList 过滤。
              置于内容序末尾 = 即将出现的 toolCall 块的位置) */}
          {liveToolLabels && liveToolLabels.length > 0 && (
            <div className="w-full space-y-1">
              {liveToolLabels.map((toolName, i) => {
                // 状态判定顺序(live 卡):等待审批(仅无 toolCallId 的退化名匹配)→ {i18n.t('messages.queued')} → 执行中。
                // 有门控挂起而非门控目标时一律排队,绝不显示执行中({i18n.t('messages.queued')}判定优先于执行中)
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
              仅 thinking 时此前整列无气泡壳 → 气泡"消失"空档;此处保证壳连续 */}
          {!hasBubble && (hasStatus || liveThinking) && (
            <Bubble
              variant="tinted"
              align="start"
              className="w-fit max-w-full"
            >
              <BubbleContent className="relative min-w-0 w-fit max-w-full rounded-lg border border-border/60 p-2.5 text-card-foreground overflow-hidden">
                {liveThinking && (
                  <ThinkingBlock
                    thinking={liveThinking}
                    isGenerating={Boolean(isStreaming) && !rawText}
                  />
                )}
                {statusNodes}
              </BubbleContent>
            </Bubble>
          )}

          {/* Action & Usage bar (Only shown when text or usage exists) */}
          {(hasVisibleTextOrThinking || hasUsage) && (
            <MessageFooter className="w-full justify-between px-0.5 py-0 text-[11px] text-muted-foreground">
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
                <TooltipProvider delay={200}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={handleCopy}
                          className="size-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0"
                        />
                      }
                    >
                      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                      <span className="sr-only">{i18n.t('messages.copy')}</span>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {copied ? i18n.t('messages.copied') : i18n.t('messages.copy')}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </MessageFooter>
          )}
        </MessageContent>
      </Message>
    </div>
  );
}
