import React, { useRef, useEffect, useState, useCallback, type KeyboardEvent } from 'react';
import {
  ArrowUp,
  Square,
  Globe,
  Plus,
  X,
  Bot,
  Brain,
  ChevronDown,
  Check,
  Sliders,
  SquareMousePointer,
} from 'lucide-react';
import type { Settings, ReasoningLevel, PickedElement } from '@/lib/types';
import { REASONING_LEVEL_LABELS, makeElementMarker } from '@/lib/types';import { SLASH_COMMANDS, type SlashCommand } from '@/lib/slashCommands';
import type { ContextUsage } from '@/lib/contextTokens';
import { getModelReasoningLevels, resolveReasoningLevel } from '@/lib/providers';
import { listCandidateTabs, getActiveTabMeta, type RefTab } from '@/lib/pageContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ContextPanel, type RoleShares } from './ContextPanel';
import { SlashMenu } from './SlashMenu';

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  settings: Settings;
  onSelectModel: (providerId: string, modelId: string) => void;
  onChangeReasoningLevel: (level: ReasoningLevel) => void;
  /** 被引用的标签页 */
  refTabs: RefTab[];
  /** 用户框选的页面元素 */
  pickedElements: PickedElement[];
  onAddCurrentTab: () => void;
  onAddRefTab: (tab: RefTab) => void;
  onRemoveRefTab: (id: number) => void;
  onStartPickElement: (tabId?: number) => void;
  onRemovePickedElement?: (id: string) => void;
  onOpenSettings: () => void;
  disabled?: boolean;
  placeholder?: string;
  /** 会话草稿输入文本(挂载种子):按会话重挂载(key)读取,之后由内部 state 接管 */
  initialInput?: string;
  /** 输入变化上报 → App 写入当前会话 draft.input(防抖落盘) */
  onInputChange?: (text: string) => void;
  /** 上下文占用(组合层 useMemo 派生;缺省不渲染占用环) */
  contextUsage?: ContextUsage | null;
  /** 三角色 token 占比(本地估算,面板占比条用) */
  roleShares?: RoleShares | null;
  /** 上下文压缩进行中 */
  isCompacting?: boolean;
  /** 压缩上下文(可附补充重点) */
  onCompact?: (customInstructions?: string) => void;
  /** 斜杠命令分发:/compact /clear /help;命令文本不进草稿、不走 onSend */
  onCommand?: (name: string, args: string) => void;
}

const REASONING_LABEL_MAP = REASONING_LEVEL_LABELS;

export function ChatInput({
  onSend,
  onStop,
  isStreaming,
  settings,
  onSelectModel,
  onChangeReasoningLevel,
  refTabs,
  pickedElements,
  onAddCurrentTab,
  onAddRefTab,
  onRemoveRefTab,
  onStartPickElement,
  onRemovePickedElement,
  onOpenSettings,
  disabled = false,
  placeholder = '输入消息... (Enter 发送, Shift+Enter 换行, / 唤起命令)',
  initialInput = '',
  onInputChange,
  contextUsage,
  roleShares,
  isCompacting,
  onCompact,
  onCommand,
}: ChatInputProps) {
  // 输入文本内部 state:挂载时用会话草稿 seed(App 以 key=sessionId 重挂载);
  // 每次变化通过 onInputChange 上报给 App 写入 draft(防抖持久化),不回传 value,
  // 避免逐键受控重渲染打断输入法/光标。
  const [text, setText] = useState(initialInput);
  const [activeTabMeta, setActiveTabMeta] = useState<RefTab | null>(null);
  const [otherCandidateTabs, setOtherCandidateTabs] = useState<RefTab[]>([]);
  // 斜杠命令:输入以 '/' 开头且无空白 → 浮层;Esc 手动关;空格自然进参数模式
  const [slashClosed, setSlashClosed] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const isComposingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 记录上一帧的框选元素列表引用与数量,用于侦测「新框选完成」并向输入框光标处插入 [元素:N]
  const prevPickedRef = useRef<PickedElement[]>(pickedElements);

  const slashOpen = Boolean(onCommand) && !slashClosed && /^\/[^\s]*$/.test(text);
  const slashQuery = text.replace(/^\//, '').toLowerCase();
  const filteredCommands: SlashCommand[] = slashOpen
    ? SLASH_COMMANDS.filter((c) => c.name.startsWith(slashQuery))
    : [];
  const slashActiveIndex = Math.min(slashIndex, Math.max(0, filteredCommands.length - 1));

  const reportText = useCallback(
    (value: string) => {
      setText(value);
      // 斜杠命令文本不进草稿:以 '/' 开头的输入只在本地态流转
      if (!value.startsWith('/')) {
        onInputChange?.(value);
      }
    },
    [onInputChange]
  );

  // 侦测框选完成：当 pickedElements 增加时，自动向输入框光标处插入 [元素:N] 标记。
  // 编号单源于数据侧:使用新增元素的 elementId(草稿持久化,与 refs.elements.id 永久对齐);
  // 侦测保持 diff(上一帧引用对比,新增段 = 尾部切片,与分配端 append 顺序一致)
  useEffect(() => {
    const prev = prevPickedRef.current;
    prevPickedRef.current = pickedElements;

    // 仅在新增框选元素且增加时触发（排除挂载初态、会话切换等清空情况）
    if (pickedElements.length > prev.length) {
      const addedCount = pickedElements.length - prev.length;
      const newlyAdded = pickedElements.slice(-addedCount);

      const ta = textareaRef.current;
      const currentVal = ta ? ta.value : text;
      const start = ta ? ta.selectionStart : currentVal.length;
      const end = ta ? ta.selectionEnd : currentVal.length;

      // 生成待插入的标记文本（支持一次性处理多个新增，通常为1个）
      let insertedText = '';
      for (let i = 0; i < newlyAdded.length; i++) {
        const marker = makeElementMarker(newlyAdded[i]!.elementId);
        // 如果前面已有字符且非空白，前置补空格
        const charBefore = i === 0 ? currentVal.slice(0, start).slice(-1) : insertedText.slice(-1);
        const prefix = charBefore && !/\s/.test(charBefore) ? ' ' : '';
        insertedText += `${prefix}${marker}`;
      }

      const nextVal = currentVal.slice(0, start) + insertedText + currentVal.slice(end);
      const newCursorPos = start + insertedText.length;

      reportText(nextVal);

      // 保证插入后光标落在标记后面并聚焦
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.selectionStart = newCursorPos;
          textareaRef.current.selectionEnd = newCursorPos;
        }
      });
    }
  }, [pickedElements, text, reportText]);

  /** 执行斜杠命令:分发 App,清空输入(命令文本不进草稿) */
  const executeCommand = useCallback(
    (name: string, args: string) => {
      onCommand?.(name, args);
      setSlashClosed(false);
      setSlashIndex(0);
      setText('');
      onInputChange?.('');
    },
    [onCommand, onInputChange]
  );

  // Load candidate tabs when dropdown menu opens
  const handleDropdownOpenChange = useCallback(async (open: boolean) => {
    if (!open) return;
    try {
      const [activeMeta, allCandidates] = await Promise.all([
        getActiveTabMeta().catch(() => null),
        listCandidateTabs().catch(() => []),
      ]);
      setActiveTabMeta(activeMeta);

      const seen = new Set<number>();
      if (activeMeta) seen.add(activeMeta.id);

      const others = allCandidates.filter((t) => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
      setOtherCandidateTabs(others);
    } catch {
      setActiveTabMeta(null);
      setOtherCandidateTabs([]);
    }
  }, []);

  // 外部注入文本(预设问题 chip → draft.input → 本组件重挂载):聚焦并把光标放到末尾
  useEffect(() => {
    if (!initialInput) return;
    const ta = textareaRef.current;
    if (ta) {
      ta.focus();
      ta.selectionStart = ta.value.length;
      ta.selectionEnd = ta.value.length;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时执行(key 重挂载)
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingRef.current || e.nativeEvent.isComposing) {
      return;
    }

    // 斜杠命令浮层键盘导航(优先于常规快捷键)
    if (slashOpen) {
      if (e.key === 'ArrowDown' && filteredCommands.length > 0) {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % filteredCommands.length);
        return;
      }
      if (e.key === 'ArrowUp' && filteredCommands.length > 0) {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashClosed(true);
        return;
      }
      if (e.key === 'Enter' && filteredCommands.length > 0) {
        // Enter = 执行高亮命令(空参数;补充重点用 Tab 补全后追加)
        e.preventDefault();
        const cmd = filteredCommands[slashActiveIndex];
        if (cmd) executeCommand(cmd.name, '');
        return;
      }
      if (e.key === 'Tab' && filteredCommands.length > 0) {
        // Tab = 自动补全:填入高亮命令文本(尾随空格进入参数模式),光标到末尾;菜单自然关闭
        e.preventDefault();
        const cmd = filteredCommands[slashActiveIndex];
        if (cmd) {
          reportText(`/${cmd.name} `);
          requestAnimationFrame(() => {
            const ta = textareaRef.current;
            if (ta) {
              ta.selectionStart = ta.selectionEnd = ta.value.length;
            }
          });
        }
        return;
      }
      // 空格:不拦截,自然进参数模式(含空格后浮层条件失效自动关闭)
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  /** 斜杠命令识别:参数模式(浮层已关)与直接提交共用;/未知命令按普通文本发送 */
  const dispatchSlashCommand = (trimmed: string): boolean => {
    const m = /^\/([a-zA-Z]+)(?:\s+([\s\S]*))?$/.exec(trimmed);
    if (!m || !SLASH_COMMANDS.some((c) => c.name === m[1])) return false;
    executeCommand(m[1]!, (m[2] ?? '').trim());
    return true;
  };

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming || disabled) return;
    if (dispatchSlashCommand(trimmed)) return;
    onSend(trimmed);
    // 规则 4:发送后草稿清空(input 本地清零 + 上报 App 清 draft)
    reportText('');
  };

  const handleStop = (e: React.MouseEvent) => {
    e.preventDefault();
    onStop();
  };

  // Find active provider and model info
  const activeProvider = settings.providers.find((p) => p.id === settings.activeProviderId);
  const activeModel = activeProvider?.models.find((m) => m.id === settings.activeModelId);
  const modelDisplayName = activeModel?.displayName || activeModel?.id || '未选择模型';
  const providerName = activeProvider?.name || '未配置提供商';
  const supportsReasoning = activeModel?.reasoning === true;

  // Resolve dynamic reasoning levels supported by this model
  const supportedLevels: ReasoningLevel[] = activeModel ? getModelReasoningLevels(activeModel) : [];
  const effectiveReasoningLevel = activeModel
    ? resolveReasoningLevel(activeModel, settings.reasoningLevel)
    : 'off';
  const currentReasoningShort =
    REASONING_LABEL_MAP[effectiveReasoningLevel]?.short || '关';

  // Dropdown menu content for the unified [+] add menu
  const renderAddTabMenuContent = (align: 'start' | 'end' = 'start') => (
    <DropdownMenuContent align={align} className="w-64 max-h-72 overflow-y-auto">
      {/* 1. Pick Element Shortcut */}
      <DropdownMenuItem
        onClick={() => onStartPickElement()}
        className="flex items-center gap-2 text-xs cursor-pointer py-1.5"
      >
        <SquareMousePointer className="size-3.5 shrink-0 text-foreground" />
        <span className="font-medium text-foreground">框选页面元素</span>
      </DropdownMenuItem>

      {/* 1b. Clear picked elements(全清一行入口;仅在有元素时出现) */}
      {pickedElements.length > 0 && onRemovePickedElement && (
        <DropdownMenuItem
          onClick={() => {
            for (const p of pickedElements) onRemovePickedElement(p.id);
          }}
          className="flex items-center gap-2 text-xs cursor-pointer py-1.5 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5 shrink-0" />
          <span>清除已选元素 ({pickedElements.length})</span>
        </DropdownMenuItem>
      )}

      <DropdownMenuSeparator />

      {/* 2. Open Tabs List */}
      <DropdownMenuLabel className="text-[11px] text-muted-foreground font-normal">
        已打开的标签页
      </DropdownMenuLabel>

      {/* Current Active Tab */}
      {activeTabMeta && (
        (() => {
          const isCurrentAdded = refTabs.some((r) => r.id === activeTabMeta.id);
          return (
            <DropdownMenuItem
              onClick={() => !isCurrentAdded && onAddCurrentTab()}
              disabled={isCurrentAdded}
              className="flex items-start justify-between gap-1.5 text-xs cursor-pointer py-1.5"
            >
              <div className="flex flex-col min-w-0 pr-1 text-left">
                <div className="flex items-center gap-1 min-w-0">
                  <span className="font-medium text-foreground truncate">
                    {activeTabMeta.title || activeTabMeta.url}
                  </span>
                  <span className="shrink-0 rounded bg-secondary px-1 text-[9px] leading-[14px] text-secondary-foreground font-normal">
                    当前
                  </span>
                </div>
                <span className="truncate text-[10px] text-muted-foreground font-mono">
                  {activeTabMeta.url}
                </span>
              </div>
              {isCurrentAdded && <Check className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />}
            </DropdownMenuItem>
          );
        })()
      )}

      {/* Other Candidate Tabs */}
      {otherCandidateTabs.map((tab) => {
        const isAdded = refTabs.some((r) => r.id === tab.id);
        return (
          <DropdownMenuItem
            key={tab.id}
            onClick={() => !isAdded && onAddRefTab(tab)}
            disabled={isAdded}
            className="flex items-start justify-between gap-1.5 text-xs cursor-pointer py-1.5"
          >
            <div className="flex flex-col min-w-0 pr-1 text-left">
              <span className="truncate max-w-[190px] font-normal text-foreground">
                {tab.title || tab.url}
              </span>
              <span className="truncate max-w-[190px] text-[10px] text-muted-foreground font-mono">
                {tab.url}
              </span>
            </div>
            {isAdded && <Check className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />}
          </DropdownMenuItem>
        );
      })}

      {!activeTabMeta && otherCandidateTabs.length === 0 && (
        <div className="px-2 py-2 text-xs text-muted-foreground italic">
          无可用网页标签页
        </div>
      )}
    </DropdownMenuContent>
  );

  return (
    <div className="bg-background p-2.5 space-y-1.5 shrink-0">
      {/* Reference Zone: Rendered when there is at least 1 tab reference */}
      {refTabs.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 min-h-[26px]">
          {refTabs.map((tab) => (
            <div
              key={tab.id}
              className="inline-flex items-center gap-0.5 rounded-md border bg-muted/60 pl-0.5 pr-1 py-0.5 text-xs text-foreground max-w-[240px] shrink-0 animate-in fade-in-0 duration-150 motion-reduce:animate-none transition-colors"
              title={tab.url}
            >
              <div
                className="flex items-center gap-1 min-w-0 flex-1 px-1 py-0.5 text-left select-none"
                title={tab.url}
              >
                <Globe className="size-3 text-muted-foreground shrink-0" />
                <span className="truncate text-[11px] font-normal">
                  {tab.title || tab.url}
                </span>
              </div>

              {/* Remove whole tab reference */}
              <button
                type="button"
                onClick={() => onRemoveRefTab(tab.id)}
                className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors shrink-0 cursor-pointer"
                title="移除该标签页引用"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input container */}
      <div className="relative flex flex-col rounded-lg border bg-background focus-within:ring-1 focus-within:ring-ring">
        {/* 斜杠命令浮层:输入框上方 */}
        {slashOpen && onCommand && (
          <SlashMenu
            commands={filteredCommands}
            activeIndex={slashActiveIndex}
            onSelect={(i) => {
              const cmd = filteredCommands[i];
              if (cmd) executeCommand(cmd.name, '');
            }}
            onHover={setSlashIndex}
          />
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setSlashClosed(false);
            reportText(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          disabled={disabled}
          placeholder={disabled ? '请先配置 AI 提供商与模型...' : placeholder}
          rows={2}
          className="w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed max-h-36 min-h-[52px]"
        />

        {/* Toolbar row inside composer */}
        <div className="flex items-center justify-between px-2 pb-2 pt-0.5 gap-1">
          {/* Left: [+] Add menu (Far left), Model Switcher, Reasoning Level */}
          <div className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto">
            {/* 1. Permanent Unified Add [+] Menu on far left */}
            <DropdownMenu onOpenChange={handleDropdownOpenChange}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[11px] gap-0.5 text-muted-foreground hover:text-foreground shrink-0 font-normal"
                  title="添加引用或框选元素"
                >
                  <Plus className="size-3.5 shrink-0" />
                  <ChevronDown className="size-2.5 shrink-0 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              {renderAddTabMenuContent('start')}
            </DropdownMenu>

            {/* 2. Model Switcher Dropdown */}
            {activeProvider && activeModel ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-[11px] gap-1 text-muted-foreground hover:text-foreground max-w-[120px] justify-start font-normal shrink-0"
                  >
                    <Bot className="size-3.5 shrink-0" />
                    <span className="truncate">{modelDisplayName}</span>
                    <ChevronDown className="size-3 shrink-0 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56 max-h-72">
                  <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                    {providerName} 模型
                  </DropdownMenuLabel>
                  {activeProvider.models.length === 0 ? (
                    <div className="px-2 py-2 text-xs text-muted-foreground italic">
                      暂无模型，请在设置中添加
                    </div>
                  ) : (
                    activeProvider.models.map((m) => {
                      const isSelected = m.id === settings.activeModelId;
                      return (
                        <DropdownMenuItem
                          key={m.id}
                          onClick={() => onSelectModel(activeProvider.id, m.id)}
                          className="flex items-center justify-between text-xs cursor-pointer"
                        >
                          <div className="flex flex-col min-w-0 pr-2">
                            <span className="truncate">{m.displayName || m.id}</span>
                            {m.displayName && (
                              <span className="truncate text-[10px] text-muted-foreground font-mono">
                                {m.id}
                              </span>
                            )}
                          </div>
                          {isSelected && <Check className="size-3.5 shrink-0" />}
                        </DropdownMenuItem>
                      );
                    })
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onOpenSettings}
                    className="text-xs cursor-pointer gap-2"
                  >
                    <Sliders className="size-3.5" />
                    <span>管理提供商与模型...</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onOpenSettings}
                className="h-6 px-1.5 text-[11px] gap-1 text-muted-foreground hover:text-foreground shrink-0"
              >
                <Bot className="size-3.5" />
                <span>配置模型</span>
              </Button>
            )}

            {/* 3. Reasoning Level Dropdown (Only if model supports reasoning) */}
            {supportsReasoning && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-[11px] gap-1 text-muted-foreground hover:text-foreground shrink-0 font-normal"
                  >
                    <Brain className="size-3.5 shrink-0" />
                    <span>思考: {currentReasoningShort}</span>
                    <ChevronDown className="size-3 shrink-0 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-36">
                  <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                    思考深度
                  </DropdownMenuLabel>

                  {/* Off option */}
                  <DropdownMenuItem
                    onClick={() => onChangeReasoningLevel('off')}
                    className="flex items-center justify-between text-xs cursor-pointer"
                  >
                    <span>关闭</span>
                    {effectiveReasoningLevel === 'off' && <Check className="size-3.5 shrink-0" />}
                  </DropdownMenuItem>

                  {/* Supported levels */}
                  {supportedLevels.map((lvl) => {
                    const isSelected = effectiveReasoningLevel === lvl;
                    const label = REASONING_LABEL_MAP[lvl]?.full || lvl;
                    return (
                      <DropdownMenuItem
                        key={lvl}
                        onClick={() => onChangeReasoningLevel(lvl)}
                        className="flex items-center justify-between text-xs cursor-pointer"
                      >
                        <span>{label}</span>
                        {isSelected && <Check className="size-3.5 shrink-0" />}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Right: Context ring + Send / Stop button */}
          <div className="flex items-center gap-1 shrink-0">
            {contextUsage && (
              <ContextPanel
                usage={contextUsage}
                roleShares={roleShares}
                isStreaming={isStreaming}
                isCompacting={isCompacting}
                modelName={modelDisplayName}
                onCompact={onCompact}
              />
            )}
            {isStreaming ? (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="icon"
                      variant="destructive"
                      onClick={handleStop}
                      className="size-6"
                    >
                      <Square className="size-3 fill-current" />
                      <span className="sr-only">停止生成</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>停止生成 (保留已生成部分)</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="icon"
                      disabled={!text.trim() || disabled}
                      onClick={handleSubmit}
                      className="size-6"
                    >
                      <ArrowUp className="size-3.5" />
                      <span className="sr-only">发送</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>发送消息 (Enter)</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
