import React, { useCallback, useEffect, useRef, useState } from 'react';
import { i18n } from '#i18n';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
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
import { REASONING_LEVEL_LABELS } from '@/lib/types';
import { SLASH_COMMANDS, type SlashCommand } from '@/lib/slashCommands';
import type { ContextUsage } from '@/lib/contextTokens';
import { getModelReasoningLevels, resolveReasoningLevel } from '@/lib/providers';
import { listCandidateTabs, getActiveTabMeta, type RefTab } from '@/lib/pageContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ContextPanel, type RoleShares } from './ContextPanel';
import { SlashMenu } from './SlashMenu';
import { TabRefBar } from './TabRefBar';
import { InlineBadge } from './extensions/InlineBadge';
import { buildBadgeAttrs, buildUrlBadgeAttrs, extractEditorState, isSingleUrlText } from './extensions/editorSerialize';
import { FaviconIcon } from './TabRefBar';

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
  /** 会话草稿输入文本(挂载种子):按会话重挂载(key)读取,之后由编辑器接管 */
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

// 菜单展示顺序:按档位升序(能力数组顺序来自模型配置,不保证有序;未知档沉底)
const REASONING_DISPLAY_ORDER: ReasoningLevel[] = ['off', 'low', 'medium', 'high', 'max'];
const sortReasoningLevels = (levels: ReasoningLevel[]): ReasoningLevel[] =>
  [...levels].sort(
    (a, b) =>
      (REASONING_DISPLAY_ORDER.indexOf(a) + 1 || 99) - (REASONING_DISPLAY_ORDER.indexOf(b) + 1 || 99),
  );

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
  placeholder = i18n.t('composer.placeholder'),
  initialInput = '',
  onInputChange,
  contextUsage,
  roleShares,
  isCompacting,
  onCompact,
  onCommand,
}: ChatInputProps) {
  // 提取文本内部 state:由编辑器 onUpdate 驱动(序列化含 <picked-element …/> 块原文),
  // 挂载时用会话草稿 seed(App 以 key=sessionId 重挂载),变化经 onInputChange 写回草稿。
  const [text, setText] = useState(initialInput);
  const [activeTabMeta, setActiveTabMeta] = useState<RefTab | null>(null);
  const [otherCandidateTabs, setOtherCandidateTabs] = useState<RefTab[]>([]);
  // 斜杠命令:输入以 '/' 开头且无空白 → 浮层;Esc 手动关;空格自然进参数模式
  const [slashClosed, setSlashClosed] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  // 记录上一帧的框选元素列表引用与数量,用于侦测「新框选完成」并在光标处插入徽章节点
  const prevPickedRef = useRef<PickedElement[]>(pickedElements);
  // 草稿恢复只执行一次(编辑器就绪后)
  const restoredRef = useRef(false);

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

  /** 执行斜杠命令:分发 App,清空编辑器与文本(命令文本不进草稿) */
  const executeCommand = useCallback(
    (name: string, args: string) => {
      onCommand?.(name, args);
      setSlashClosed(false);
      setSlashIndex(0);
      editorRef.current?.commands.clearContent();
      reportText('');
    },
    [onCommand, reportText]
  );

  /** 斜杠命令识别:参数模式(浮层已关)与直接提交共用;/未知命令按普通文本发送 */
  const dispatchSlashCommand = (trimmed: string): boolean => {
    const m = /^\/([a-zA-Z]+)(?:\s+([\s\S]*))?$/.exec(trimmed);
    if (!m || !SLASH_COMMANDS.some((c) => c.name === m[1])) return false;
    executeCommand(m[1]!, (m[2] ?? '').trim());
    return true;
  };

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming || disabled) return;
    if (dispatchSlashCommand(trimmed)) return;
    onSend(trimmed);
    // 规则 4:发送后草稿清空(编辑器清空 + 上报 App 清 draft)
    editorRef.current?.commands.clearContent();
    reportText('');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dispatchSlashCommand 为组件内纯函数
  }, [text, isStreaming, disabled, onSend, reportText, onCommand, onInputChange]);

  // ── 编辑器回调经 ref 间接(useEditor options 只捕获稳定引用,回调取实时值)─────────
  const editorRef = useRef<Editor | null>(null);
  const sendRef = useRef<() => void>(() => {});
  const executeCommandRef = useRef<(name: string, args: string) => void>(() => {});
  const slashStateRef = useRef<{ open: boolean; commands: SlashCommand[]; activeIndex: number }>({
    open: false,
    commands: [],
    activeIndex: 0,
  });
  sendRef.current = handleSend;
  executeCommandRef.current = executeCommand;
  slashStateRef.current = { open: slashOpen, commands: filteredCommands, activeIndex: slashActiveIndex };

  const editor = useEditor({
    extensions: [
      // 最小化 StarterKit:纯文本 + 硬换行语义(关闭全部块级/标记扩展)
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        horizontalRule: false,
        bold: false,
        italic: false,
        strike: false,
        code: false,
      }),
      InlineBadge,
    ],
    content: '',
    editable: !disabled,
    editorProps: {
      attributes: {
        class: 'composer-editor',
      },
      handleKeyDown: (_view, event) => {
        // 斜杠命令浮层键盘导航(优先于常规快捷键)
        const s = slashStateRef.current;
        if (s.open && s.commands.length > 0) {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSlashIndex((i) => (i + 1) % s.commands.length);
            return true;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSlashIndex((i) => (i - 1 + s.commands.length) % s.commands.length);
            return true;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setSlashClosed(true);
            return true;
          }
          if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            const cmd = s.commands[s.activeIndex];
            if (cmd) executeCommandRef.current(cmd.name, '');
            return true;
          }
          if (event.key === 'Tab') {
            // Tab = 自动补全:填入高亮命令文本(尾随空格进参数模式,浮层自然关闭)
            event.preventDefault();
            const cmd = s.commands[s.activeIndex];
            if (cmd) editorRef.current?.commands.setContent(`/${cmd.name} `);
            return true;
          }
          // 空格:不拦截,自然进参数模式
        }

        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          // Enter / Ctrl+Enter / Cmd+Enter → 发送;Shift+Enter 换行(默认 hardBreak);
          // isComposing 守卫:中文 IME 选字确认的 Enter 不发送(旧 textarea isComposingRef 守卫的迁移等价物)
          event.preventDefault();
          sendRef.current();
          return true;
        }
        return false;
      },
      handlePaste: (view, event) => {
        const clipboardText = event.clipboardData?.getData('text/plain');
        if (!clipboardText) return false;
        // 单一 URL 粘贴 → url 徽章(多行/含空格走普通文本);
        // serialized = [url: label] 随 onUpdate 进草稿,模型侧自描述,不进 refs.elements
        if (isSingleUrlText(clipboardText)) {
          const badgeNode = view.state.schema.nodes.inlineBadge?.create(buildUrlBadgeAttrs(clipboardText.trim()));
          if (!badgeNode) return false;
          view.dispatch(view.state.tr.replaceSelectionWith(badgeNode));
          view.dispatch(view.state.tr.insertText(' '));
          return true;
        }
        // 其余粘贴:纯文本 insertText(屏蔽富文本/HTML)
        view.dispatch(view.state.tr.insertText(clipboardText));
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      // 序列化文本含 <picked-element …/> 块原文 → reportText 同步 state + 草稿链
      reportText(extractEditorState(ed).text);
    },
    // 中文 IME:ProseMirror 原生处理 composition,无需任何自定义代码
  });

  editorRef.current = editor;

  // 侦测框选完成:新元素在光标处插入徽章节点 + 尾随空格(替代旧文本标记插入;
  // onUpdate 自动把 serialized(自闭合块)同步进 text/草稿,协议不变)
  useEffect(() => {
    const prev = prevPickedRef.current;
    prevPickedRef.current = pickedElements;

    if (!editor || pickedElements.length <= prev.length) return;
    const addedCount = pickedElements.length - prev.length;
    const newlyAdded = pickedElements.slice(-addedCount);
    for (const element of newlyAdded) {
      editor.chain().focus().insertContent([
        { type: 'inlineBadge', attrs: buildBadgeAttrs(element) },
        { type: 'text', text: ' ' },
      ]).run();
    }
  }, [pickedElements, editor]);

  // 草稿恢复:setContent(含 <picked-element …/> 块的草稿文本)→ parseHTML 自动还原徽章节点;
  // 历史草稿的标记文本 [element:N]/[元素:N] 直接剥离(旧数据可弃);key=sessionId 重挂载保证会话切换重建。
  useEffect(() => {
    if (!editor || restoredRef.current) return;
    restoredRef.current = true;
    const cleaned = initialInput
      .replace(/\s*\[element:\d+\]/g, '')
      .replace(/\s*\[元素:\d+\]/g, '');
    if (cleaned.trim()) {
      editor.commands.setContent(cleaned);
    }
    if (initialInput) {
      editor.commands.focus('end');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时执行(key 重挂载)
  }, [editor]);

  // disabled(未配置模型/压缩中)→ 编辑器只读
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

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

  const handleStop = (e: React.MouseEvent) => {
    e.preventDefault();
    onStop();
  };

  // Find active provider and model info
  const activeProvider = settings.providers.find((p) => p.id === settings.activeProviderId);
  const activeModel = activeProvider?.models.find((m) => m.id === settings.activeModelId);
  const modelDisplayName = activeModel?.displayName || activeModel?.id || i18n.t('composer.modelNotSelected');
  const supportsReasoning = activeModel?.reasoning === true;
  // 所有包含可用模型的提供商列表（用于模型切换下拉分组）
  const providersWithModels = settings.providers.filter((p) => p.models.length > 0);

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
        className="flex items-center gap-2 text-xs py-1.5"
      >
        <SquareMousePointer className="size-3.5 shrink-0 text-foreground" />
        <span className="font-medium text-foreground">{i18n.t('composer.pickElement')}</span>
      </DropdownMenuItem>

      {/* 1b. Clear picked elements(全清一行入口;仅在有元素时出现) */}
      {pickedElements.length > 0 && onRemovePickedElement && (
        <DropdownMenuItem
          onClick={() => {
            for (const p of pickedElements) onRemovePickedElement(p.id);
          }}
          className="flex items-center gap-2 text-xs py-1.5 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5 shrink-0" />
          <span>{i18n.t('composer.clearPicked', { count: pickedElements.length })}</span>
        </DropdownMenuItem>
      )}

      <DropdownMenuSeparator />

      {/* 2. Open Tabs List */}
      <DropdownMenuGroup>
      <DropdownMenuLabel className="text-[11px] text-muted-foreground font-normal">
        {i18n.t('composer.openTabs')}
      </DropdownMenuLabel>
      </DropdownMenuGroup>

      {/* Current Active Tab */}
      {activeTabMeta && (
        (() => {
          const isCurrentAdded = refTabs.some((r) => r.id === activeTabMeta.id);
          return (
            <DropdownMenuItem
              onClick={() => !isCurrentAdded && onAddCurrentTab()}
              disabled={isCurrentAdded}
              className="flex items-start justify-between gap-2 text-xs py-1.5"
            >
              <div className="flex items-start gap-2 min-w-0 pr-1 text-left flex-1">
                <FaviconIcon
                  url={activeTabMeta.url}
                  tabId={activeTabMeta.id}
                  className="size-3.5 mt-0.5"
                />
                <div className="flex flex-col min-w-0 flex-1">
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
            className="flex items-start justify-between gap-2 text-xs py-1.5"
          >
            <div className="flex items-start gap-2 min-w-0 pr-1 text-left flex-1">
              <FaviconIcon
                url={tab.url}
                tabId={tab.id}
                className="size-3.5 mt-0.5"
              />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="truncate max-w-[190px] font-normal text-foreground">
                  {tab.title || tab.url}
                </span>
                <span className="truncate max-w-[190px] text-[10px] text-muted-foreground font-mono">
                  {tab.url}
                </span>
              </div>
            </div>
            {isAdded && <Check className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />}
          </DropdownMenuItem>
        );
      })}

      {!activeTabMeta && otherCandidateTabs.length === 0 && (
        <div className="px-2 py-2 text-xs text-muted-foreground italic">
          {i18n.t('composer.noTabs')}
        </div>
      )}
    </DropdownMenuContent>
  );

  return (
    <div className="bg-background p-2.5 shrink-0">
      {/* 标签页引用区 (独立小控件, 位于输入框卡片上方, 底部被输入框轻微压住层叠) */}
      <TabRefBar refTabs={refTabs} onRemoveRefTab={onRemoveRefTab} />

      {/* Input container (TipTap 编辑器 + 底部工具栏) */}
      <div
        className={`relative z-10 flex flex-col rounded-xl border border-border/60 bg-card shadow-xs transition-[box-shadow,border-color] duration-200 ease-out focus-within:ring-1 focus-within:ring-ring ${
          refTabs && refTabs.length > 0 ? '-mt-2' : ''
        }`}
      >

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
        {/* TipTap 编辑器:inline 徽章原子节点(Backspace/删除由 PM 原生处理);
            空文档占位用覆盖层(text 状态驱动,无额外依赖) */}
        <div className="relative w-full">
          {!text && (editor?.isEmpty ?? true) && (
            <div className="pointer-events-none absolute left-3 top-2.5 max-w-[calc(100%-24px)] truncate text-sm text-muted-foreground">
              {disabled ? i18n.t('composer.disabledPlaceholder') : placeholder}
            </div>
          )}
          <EditorContent editor={editor} />
        </div>

        {/* Toolbar row inside composer */}
        <TooltipProvider delay={200}>
        <div className="flex items-center justify-between px-2 pb-2 pt-0.5 gap-1">
          {/* Left: [+] Add menu (Far left), Model Switcher, Reasoning Level, Context Ring */}
          <div className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto">
            {/* 1. Permanent Unified Add [+] Menu on far left */}
            <DropdownMenu onOpenChange={handleDropdownOpenChange}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-[11px] gap-0.5 text-muted-foreground hover:text-foreground shrink-0 font-normal"
                          aria-label={i18n.t('composer.addRefTitle')}
                        />
                      }
                    />
                  }
                >
                  <Plus className="size-3.5 shrink-0" />
                  <ChevronDown className="size-2.5 shrink-0 opacity-50" />
                </TooltipTrigger>
                <TooltipContent side="top">
                  {i18n.t('composer.addRefTitle')}
                </TooltipContent>
              </Tooltip>
              {renderAddTabMenuContent('start')}
            </DropdownMenu>

            {/* 2. Model Switcher Dropdown */}
            {activeProvider && activeModel ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-[11px] gap-1 text-muted-foreground hover:text-foreground max-w-[120px] justify-start font-normal shrink-0"
                    />
                  }
                >
                  <Bot className="size-3.5 shrink-0" />
                  <span className="truncate">{modelDisplayName}</span>
                  <ChevronDown className="size-3 shrink-0 opacity-50" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64 max-h-80 overflow-y-auto">
                  {providersWithModels.length === 0 ? (
                    <div className="px-2 py-2 text-xs text-muted-foreground italic">
                      {i18n.t('composer.noModel')}
                    </div>
                  ) : (
                    providersWithModels.map((p, idx) => (
                      <React.Fragment key={p.id}>
                        {idx > 0 && <DropdownMenuSeparator />}
                        <DropdownMenuGroup>
                          <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                            {p.name || i18n.t('composer.unnamedProvider')}
                          </DropdownMenuLabel>
                          {p.models.map((m) => {
                            const isSelected =
                              p.id === settings.activeProviderId && m.id === settings.activeModelId;
                            return (
                              <DropdownMenuItem
                                key={m.id}
                                onClick={() => onSelectModel(p.id, m.id)}
                                className="flex items-center justify-between text-xs"
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
                          })}
                        </DropdownMenuGroup>
                      </React.Fragment>
                    ))
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onOpenSettings}
                    className="text-xs gap-2"
                  >
                    <Sliders className="size-3.5" />
                    <span>{i18n.t('composer.manageProviders')}</span>
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
                <span>{i18n.t('composer.configureModel')}</span>
              </Button>
            )}

            {/* 3. Reasoning Level Dropdown (Only if model supports reasoning) */}
            {supportsReasoning && (
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <DropdownMenuTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-1.5 text-[11px] gap-1 text-muted-foreground hover:text-foreground shrink-0 font-normal"
                            aria-label={i18n.t('composer.reasoningTitle', { level: currentReasoningShort })}
                          />
                        }
                      />
                    }
                  >
                    <Brain className="size-3.5 shrink-0" />
                    <span>{currentReasoningShort}</span>
                    <ChevronDown className="size-3 shrink-0 opacity-50" />
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {i18n.t('composer.reasoningTitle', { level: currentReasoningShort })}
                  </TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="start" className="w-36">
                  <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                    {i18n.t('composer.thinkingDepth')}
                  </DropdownMenuLabel>
                  </DropdownMenuGroup>

                  {/* Off option */}
                  <DropdownMenuItem
                    onClick={() => onChangeReasoningLevel('off')}
                    className="flex items-center justify-between text-xs"
                  >
                    <span>{i18n.t('composer.thinkingOff')}</span>
                    {effectiveReasoningLevel === 'off' && <Check className="size-3.5 shrink-0" />}
                  </DropdownMenuItem>

                  {/* Supported levels */}
                  {sortReasoningLevels(supportedLevels).map((lvl) => {
                    const isSelected = effectiveReasoningLevel === lvl;
                    const label = REASONING_LABEL_MAP[lvl]?.full || lvl;
                    return (
                      <DropdownMenuItem
                        key={lvl}
                        onClick={() => onChangeReasoningLevel(lvl)}
                        className="flex items-center justify-between text-xs"
                      >
                        <span>{label}</span>
                        {isSelected && <Check className="size-3.5 shrink-0" />}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* 4. Context Ring & Panel */}
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
          </div>

          {/* Right: Send / Stop button */}
          <div className="flex items-center gap-1 shrink-0">
            {isStreaming ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="icon"
                      variant="destructive"
                      onClick={handleStop}
                      className="size-6"
                    >
                      <Square className="size-3 fill-current" />
                      <span className="sr-only">{i18n.t('composer.stopSr')}</span>
                    </Button>
                  }
                />
                <TooltipContent side="top">
                  {i18n.t('composer.stopHint')}
                </TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="icon"
                      disabled={!text.trim() || disabled}
                      onClick={handleSend}
                      className="size-6"
                    >
                      <ArrowUp className="size-3.5" />
                      <span className="sr-only">{i18n.t('composer.sendSr')}</span>
                    </Button>
                  }
                />
                <TooltipContent side="top">
                  {i18n.t('composer.sendHint')}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        </TooltipProvider>
      </div>
    </div>
  );
}
