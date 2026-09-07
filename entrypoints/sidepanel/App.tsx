import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { i18n } from '#i18n';
import { X } from 'lucide-react';
import type {
  ProviderConfig,
  ReasoningLevel,
  ChatMessage,
} from '@/lib/types';
import { DEFAULT_SETTINGS, findActiveModel } from '@/lib/providers';
import { effectiveMessages, estimateContextTokens, estimateTokens, shouldCompact } from '@/lib/contextTokens';
import { SLASH_COMMANDS } from '@/lib/slashCommands';

import { useGate } from './hooks/useGate';
import { useSessionManager } from './hooks/useSessionManager';
import { useChatTurn } from './hooks/useChatTurn';
import { usePageContextRefs } from './hooks/usePageContextRefs';
import { useCompact } from './hooks/useCompact';
import { useQuickPrompts } from './hooks/useQuickPrompts';
import { clearPendingDraftSaves } from './store/sessionSlice';
import { replaceAllSessions } from '@/lib/sessionStore';
import { activeSessionIdItem, sanitizeSessions, sanitizeSettings } from '@/lib/storage';
import type { SyncBundle } from '@/lib/syncPayload';
import { useAppStore, selectCurrentSession } from './store';
import { EMPTY_DRAFT } from './store/sessionSlice';

// Components
import { ChatHeader } from './components/chat/ChatHeader';
import { MessageList } from './components/chat/MessageList';
import { ChatInput } from './components/chat/ChatInput';
import { ApprovalSection } from './components/chat/ApprovalSection';
import { SettingsMainView } from './components/settings/SettingsMainView';
import { ProviderDialog } from './components/settings/ProviderDialog';
import { UserScriptsGateDialog } from './components/UserScriptsGateDialog';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer';
import { toast } from '@/components/ui/toast';

type ViewMode = 'chat' | 'settings';

export default function App() {
  // ── store 订阅(selector 置顶)──────────────────────────────────
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const errorMessage = useAppStore((s) => s.errorMessage);
  const setErrorMessage = useAppStore((s) => s.setErrorMessage);
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const loaded = useAppStore((s) => s.loaded);
  const patchActiveDraft = useAppStore((s) => s.patchActiveDraft);
  const currentSession = useAppStore(selectCurrentSession);
  const isStreaming = useAppStore((s) => s.isStreaming);
  const streamingContent = useAppStore((s) => s.streamingContent);
  const streamingThinking = useAppStore((s) => s.streamingThinking);
  const activeToolNames = useAppStore((s) => s.activeToolNames);
  const isCancelled = useAppStore((s) => s.isCancelled);
  const inFlight = useAppStore((s) => s.inFlight);

  // ── View Routing(App 域)───────────────────────────────────────
  const [currentView, setCurrentView] = useState<ViewMode>('chat');
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [selectedProviderForEdit, setSelectedProviderForEdit] = useState<ProviderConfig | null>(null);
  const [isCreatingNewProvider, setIsCreatingNewProvider] = useState(false);
  const [slashHelpOpen, setSlashHelpOpen] = useState(false);
  const [dismissedOverflowSessionId, setDismissedOverflowSessionId] = useState<string | null>(null);
  // ChatInput 以 key 重挂载读取新 initialInput(nonce 仅在外部注入文本时递增,逐键输入不重挂载)
  const [composerNonce, setComposerNonce] = useState(0);

  // ── 门控域 ──────────────────────────────────────────────────────
  const gate = useGate();

  // ── 会话域(编排层)─────────────────────────────────────────────
  const session = useSessionManager();

  // ── 上下文压缩域(先于对话轮次域:isCompacting 作为 boolean 传入发送互斥)─────────
  const compact = useCompact();
  const onAutoCompact = useCallback(() => {
    void compact.handleCompact();
  }, [compact.handleCompact]);

  // ── 对话轮次域 ──────────────────────────────────────────────────
  const chat = useChatTurn({
    isCompacting: compact.isCompacting,
    onAutoCompact,
    onAutoAiTitle: (sessionId) => {
      void session.handleAiTitleSession(sessionId, true);
    },
  });

  // ── Settings 处理器 ────────────────────────────────────────────
  // Model & Provider Helpers
  const activeModelInfo = useMemo(() => {
    return findActiveModel(settings);
  }, [settings]);

  // Quick switch active model
  const handleSelectModel = useCallback(
    async (providerId: string, modelId: string) => {
      await updateSettings({
        ...useAppStore.getState().settings,
        activeProviderId: providerId,
        activeModelId: modelId,
      });
    },
    [updateSettings]
  );

  // Switch reasoning level
  const handleChangeReasoningLevel = useCallback(
    async (level: ReasoningLevel) => {
      await updateSettings({ ...useAppStore.getState().settings, reasoningLevel: level });
    },
    [updateSettings]
  );

  // Toggle page context
  const handleTogglePageContext = useCallback(
    async (enabled: boolean) => {
      await updateSettings({ ...useAppStore.getState().settings, includePageContext: enabled });
    },
    [updateSettings]
  );

  // ── 页面引用域 ──────────────────────────────────────────────────
  const pageRefs = usePageContextRefs({ handleTogglePageContext });

  const handleSaveProvider = useCallback(
    async (savedProvider: ProviderConfig) => {
      const existing = [...settings.providers];
      const idx = existing.findIndex((p) => p.id === savedProvider.id);

      if (idx >= 0) {
        existing[idx] = savedProvider;
      } else {
        existing.push(savedProvider);
      }

      let activeProviderId = settings.activeProviderId;
      let activeModelId = settings.activeModelId;

      if (!activeProviderId || activeProviderId === savedProvider.id) {
        activeProviderId = savedProvider.id;
        if (!activeModelId || !savedProvider.models.some((m) => m.id === activeModelId)) {
          activeModelId = savedProvider.models[0]?.id || null;
        }
      }

      await updateSettings({
        ...settings,
        providers: existing,
        activeProviderId,
        activeModelId,
      });
    },
    [settings, updateSettings]
  );

  // ── 斜杠命令分发 ────────────────────────────────────────────────
  const handleCommand = useCallback(
    (name: string, args: string) => {
      if (name === 'compact') {
        void compact.handleCompact(args ? { customInstructions: args } : {});
      } else if (name === 'clear') {
        void session.handleNewSession();
      } else if (name === 'help') {
        setSlashHelpOpen(true);
      }
    },
    [compact.handleCompact, session.handleNewSession]
  );

  // ── Navigation & Provider Dialog Handlers ──────────────────────
  const handleOpenSettings = useCallback(() => {
    // 离开聊天视图时冲销挂起门控(与停止生成同款处理;deny 后模型收到拒绝文本收尾,无需恢复)
    gate.dismissPendingGates();
    setCurrentView('settings');
  }, [gate.dismissPendingGates]);

  const handleBackToChat = useCallback(() => {
    setCurrentView('chat');
  }, []);

  const handleAddProvider = useCallback(() => {
    setSelectedProviderForEdit(null);
    setIsCreatingNewProvider(true);
    setProviderDialogOpen(true);
  }, []);

  const handleEditProvider = useCallback((provider: ProviderConfig) => {
    setSelectedProviderForEdit(provider);
    setIsCreatingNewProvider(false);
    setProviderDialogOpen(true);
  }, []);

  // ── Composer 草稿 ──────────────────────────────────────────────
  const draft = currentSession?.draft ?? EMPTY_DRAFT;
  const handleSelectPrompt = useCallback(
    (promptText: string) => {
      patchActiveDraft((d) => ({ ...d, input: promptText }));
      setComposerNonce((n) => n + 1);
    },
    [patchActiveDraft]
  );

  // ChatInput 上报输入变化 → 写入当前会话 draft(会话域防抖落盘,见 commitSessions)
  const handleDraftInput = useCallback(
    (text: string) => {
      patchActiveDraft((d) => (d.input === text ? d : { ...d, input: text }));
    },
    [patchActiveDraft]
  );

  // 统计本轮 in-flight / live 消息中需要门控确认的工具调用总数(支持分页 1/N 呈现)
  const gatePagination = useMemo(() => {
    if (!gate.activeGate) return { step: 1, total: 1 };
    let confirmCallCount = 0;
    // 检查 in-flight 消息中的 confirm 工具调用（如 execute_js）
    if (inFlight && inFlight.messages) {
      for (const m of inFlight.messages) {
        if (m.role === 'assistant' && Array.isArray(m.content)) {
          for (const block of m.content) {
            if (block.type === 'toolCall' && block.name === 'execute_js') {
              confirmCallCount++;
            }
          }
        }
      }
    }
    // 包含当前活跃工具调用列表中待确认的工具
    if (activeToolNames.includes('execute_js') && confirmCallCount === 0) {
      confirmCallCount = 1;
    }
    const currentStep = gate.resolvedGateCount + 1;
    const totalCount = Math.max(currentStep, confirmCallCount);
    return { step: currentStep, total: totalCount };
  }, [gate.activeGate, inFlight, activeToolNames, gate.resolvedGateCount]);

  // 上下文占用派生:有效历史(压缩过 = [摘要]+之后)× 当前模型窗口 + 三角色占比(lib estimateTokens 统一口径)。
  // in-flight 消息与流式 live 文本一并计入尾部,环随流式增长
  const contextData = useMemo(() => {
    const model = activeModelInfo?.model;
    if (!model) return null;
    const liveInFlight =
      inFlight && inFlight.sessionId === currentSession?.id ? inFlight.messages : [];
    const all = [...(currentSession?.messages ?? []), ...liveInFlight];
    const effective = effectiveMessages(all, currentSession?.compaction);
    // 流式中的 live 文本(尚未 message_end 物化)计入尾部
    if (isStreaming && streamingContent) {
      effective.push({
        role: 'assistant',
        content: [{ type: 'text', text: streamingContent }],
        api: 'openai-completions',
        provider: '',
        model: '',
        stopReason: 'stop',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        timestamp: 0,
      } as ChatMessage);
    }
    const usage = estimateContextTokens(effective, model.contextWindow ?? 128000);
    const roleShares = { user: 0, assistant: 0, toolResult: 0 };
    for (const m of effective) {
      const t = estimateTokens(m);
      if (m.role === 'user') roleShares.user += t;
      else if (m.role === 'assistant') roleShares.assistant += t;
      else if (m.role === 'toolResult') roleShares.toolResult += t;
    }
    return { usage, roleShares };
  }, [activeModelInfo, currentSession, inFlight, isStreaming, streamingContent]);

  // 模型切换溢出建议:当前上下文超出新模型窗口(shouldCompact)→ 建议压缩,不自动执行
  // 用户可手动关闭本次提示(切会话或会话更新后若依然超出可再次自然产生或关闭)
  const isOverflowDismissed = dismissedOverflowSessionId === currentSession?.id;

  const overflowSuggest =
    !isOverflowDismissed &&
    !!contextData &&
    !compact.isCompacting &&
    shouldCompact(contextData.usage);

  // WebDAV 恢复编排:IDB 全量替换 → store 刷新 → 设置持久化 → 激活会话校正。
  // 流式进行中拒绝恢复(在途写入会与全量替换互相覆盖)。
  const handleSyncRestore = useCallback(
    async (bundle: SyncBundle) => {
      if (isStreaming || (inFlight && inFlight.messages.length > 0)) {
        throw new Error(i18n.t('sync.error.streaming'));
      }
      // 防 400ms 防抖窗口内的旧会话对象在恢复后落盘回滚(major-4)
      clearPendingDraftSaves();
      const store = useAppStore.getState();
      // 远端文件可能被手改/损坏:入库前与本地入口同标准清洗
      const sessions = sanitizeSessions(bundle.sessions);
      await replaceAllSessions(sessions);
      store.setSessions(sessions);
      await store.updateSettings(sanitizeSettings(bundle.settings));
      const restoredActive =
        bundle.activeSessionId && sessions.some((s) => s.id === bundle.activeSessionId)
          ? bundle.activeSessionId
          : (sessions[0]?.id ?? null);
      store.setActiveSessionId(restoredActive);
      void activeSessionIdItem.setValue(restoredActive);
    },
    [inFlight, isStreaming],
  );
  const latestLocalSessionAt = sessions.reduce((max, s) => Math.max(max, s.updatedAt), 0);

  // 渲染源 = 会话转录 + 本次运行的 in-flight assistant 消息(仅当归属当前会话;
  // 流式中途切到别的会话时不串显)。live 气泡仍由 MessageList 追加在最后。
  const displayedMessages =
    inFlight && inFlight.sessionId === currentSession?.id && inFlight.messages.length > 0
      ? [...(currentSession?.messages ?? []), ...inFlight.messages]
      : (currentSession?.messages ?? []);
  // 尾部 in-flight 消息刚从 live 流式气泡接管:跳过入场动画,交接不闪
  // (toolResult 不渲染独立气泡,不计入手数,避免过度抑制动画)
  const quietTailCount =
    inFlight && inFlight.sessionId === currentSession?.id
      ? inFlight.messages.filter((m) => m.role !== 'toolResult').length
      : 0;

  // 新会话快捷指令:空会话展示时异步生成(模型失败静默回退静态四条)
  const quickPrompts = useQuickPrompts(
    settings,
    displayedMessages.length === 0 && !isStreaming,
  );

  // 错误状态收敛至 toast: errorMessage 变化且非空时触发常驻通知
  useEffect(() => {
    if (errorMessage) {
      toast.add({
        id: 'chat-error',
        type: 'error',
        description: errorMessage,
        timeout: 0,
        onClose: () => setErrorMessage(null),
      });
    }
  }, [errorMessage, setErrorMessage]);

  // 溢出建议收敛至 toast: 条件 false → true 跳变时触发一次常驻警告(带压缩动作与关闭忽略)
  const prevOverflowSuggestRef = useRef(false);
  const prevSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    const sessionChanged = prevSessionIdRef.current !== currentSession?.id;
    prevSessionIdRef.current = currentSession?.id ?? null;

    if (overflowSuggest && (!prevOverflowSuggestRef.current || sessionChanged)) {
      toast.add({
        id: 'overflow-suggest',
        type: 'warning',
        description: i18n.t('app.overflowSuggest'),
        timeout: 0,
        actionProps: {
          children: i18n.t('app.compact'),
          onClick: () => {
            void compact.handleCompact();
          },
        },
        onClose: () => {
          setDismissedOverflowSessionId(currentSession?.id ?? 'temp');
        },
      });
    } else if (!overflowSuggest && (prevOverflowSuggestRef.current || sessionChanged)) {
      toast.close('overflow-suggest');
    }
    prevOverflowSuggestRef.current = overflowSuggest;
  }, [overflowSuggest, compact.handleCompact, currentSession?.id]);

  // 压缩状态收敛至 toast: isCompacting true → toast.loading; false → toast.success
  const prevCompactingRef = useRef(false);
  useEffect(() => {
    if (compact.isCompacting) {
      toast.add({
        id: 'compaction',
        type: 'loading',
        description: i18n.t('app.compacting'),
        timeout: 0,
      });
    } else if (prevCompactingRef.current) {
      if (useAppStore.getState().errorMessage) {
        toast.close('compaction');
      } else {
        toast.update('compaction', {
          type: 'success',
          description: i18n.t('app.compactSuccess'),
          timeout: 3000,
        });
      }
    }
    prevCompactingRef.current = compact.isCompacting;
  }, [compact.isCompacting]);

  if (!loaded) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-muted-foreground text-xs">
        {i18n.t('app.loading')}
      </div>
    );
  }

  return (
    <main className="flex h-dvh w-full flex-col bg-background text-foreground overflow-hidden select-text font-sans antialiased">
      {/* VIEW: Chat — 常驻挂载,保持消息流与输入草稿不丢失 */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden animate-in fade-in-0 duration-150 motion-reduce:animate-none">
        {/* Header with History Dropdown */}
          <ChatHeader
            sessions={sessions}
            activeSessionId={activeSessionId}
            titlingSessionIds={session.titlingSessionIds}
            onSelectSession={session.handleSelectSession}
            onDeleteSession={session.handleDeleteSession}
            onRenameSession={session.handleRenameSession}
            onAiTitleSession={session.handleAiTitleSession}
            onNewSession={session.handleNewSession}
            onOpenSettings={handleOpenSettings}
          />

          {/* Messages */}
          <MessageList
            messages={displayedMessages}
            isStreaming={isStreaming}
            streamingContent={streamingContent}
            streamingThinking={streamingThinking}
            activeToolLabels={activeToolNames}
            gateRequest={gate.activeGate?.request ?? null}
            pendingGateTotal={gatePagination.total}
            quietTailCount={quietTailCount}
            sessionKey={currentSession?.id ?? 'empty'}
            compaction={
              currentSession?.compaction
                ? {
                    summaryTimestamp: currentSession.compaction.summaryTimestamp,
                    tokensBefore: currentSession.compaction.tokensBefore,
                  }
                : null
            }
            isCancelled={isCancelled}
            onSelectPrompt={handleSelectPrompt}
            hasProvider={settings.providers.length > 0}
            hasModel={Boolean(activeModelInfo)}
            activeModelName={
              activeModelInfo?.model.displayName || activeModelInfo?.model.id
            }
            onOpenSettings={handleOpenSettings}
            quickPrompts={quickPrompts}
          />

          {/* 槽位区:审批槽位 → /help 卡(均为 in-flow,挤压列表零遮挡) */}

          {/* 审批槽位:交互审批 UI 的唯一渲染位(消息流内工具卡一律状态化,零交互控件)。
              in-flow flex 子节点,出现时挤压列表;卡片框架永不滚动,高度由内容决定。 */}
          {gate.activeGate && (
            <div className="w-full shrink-0 px-2.5 pb-1 animate-in fade-in-0 slide-in-from-bottom-2 duration-150 motion-reduce:animate-none">
              <ApprovalSection
                request={gate.activeGate.request}
                onApprove={gate.handleGateApprove}
                onDeny={gate.handleGateDeny}
                onAnswer={gate.handleGateAnswer}
                onCancel={gate.handleGateCancel}
              />
            </div>
          )}

          {/* 斜杠 /help 卡 */}
          {slashHelpOpen && (
            <div className="w-full shrink-0 px-2.5 pb-1 animate-in fade-in-0 slide-in-from-bottom-2 duration-150 motion-reduce:animate-none">
              <div className="space-y-2 rounded-lg border border-border bg-card p-3 text-xs shadow-xs">
                <div className="flex items-center justify-between border-b border-border/50 pb-1.5">
                  <span className="text-[11px] font-semibold text-foreground">{i18n.t('app.helpTitle')}</span>
                  <TooltipProvider delay={200}>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            onClick={() => setSlashHelpOpen(false)}
                            className="text-muted-foreground transition-colors hover:text-foreground rounded p-0.5"
                            aria-label={i18n.t('app.close')}
                          >
                            <X className="size-3.5" />
                          </button>
                        }
                      />
                      <TooltipContent side="left">
                        {i18n.t('app.close')}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="space-y-1.5">
                  {SLASH_COMMANDS.map((cmd) => (
                    <div key={cmd.name} className="flex items-baseline justify-between gap-2 text-[11px]">
                      <code className="shrink-0 font-mono font-medium text-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                        /{cmd.name}
                        {cmd.argumentHint ? <span className="text-muted-foreground font-normal"> {cmd.argumentHint}</span> : ''}
                      </code>
                      <span className="min-w-0 flex-1 text-right text-muted-foreground">{cmd.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Composer:按会话重挂载(key),草稿输入/引用派生自当前会话 draft */}
          <ChatInput
            key={`${activeSessionId ?? 'none'}#${composerNonce}`}
            onSend={chat.handleSendMessage}
            onStop={chat.handleStopGeneration}
            isStreaming={isStreaming}
            settings={settings}
            onSelectModel={handleSelectModel}
            onChangeReasoningLevel={handleChangeReasoningLevel}
            refTabs={settings.includePageContext ? draft.refTabs : []}
            pickedElements={settings.includePageContext ? draft.pickedElements : []}
            onAddCurrentTab={pageRefs.handleAddCurrentTab}
            onAddRefTab={pageRefs.addRefTab}
            onRemoveRefTab={pageRefs.handleRemoveRefTab}
            onStartPickElement={pageRefs.handleStartPickElement}
            onRemovePickedElement={pageRefs.handleRemovePickedElement}
            onOpenSettings={handleOpenSettings}
            disabled={!activeModelInfo || compact.isCompacting}
            placeholder={compact.isCompacting ? i18n.t('app.compacting') : undefined}
            initialInput={draft.input}
            onInputChange={handleDraftInput}
            contextUsage={contextData?.usage ?? null}
            roleShares={contextData?.roleShares ?? null}
            isCompacting={compact.isCompacting}
            onCompact={(instructions) => {
              void compact.handleCompact(instructions ? { customInstructions: instructions } : {});
            }}
            onCommand={handleCommand}
          />
        </div>

      {/* VIEW: Settings Drawer */}
      <Drawer
        open={currentView === 'settings'}
        onOpenChange={(open) => {
          if (!open) handleBackToChat();
        }}
        showSwipeHandle
      >
        <DrawerContent className="h-dvh">
          <DrawerTitle className="sr-only">{i18n.t('app.settingsSr')}</DrawerTitle>
          <DrawerDescription className="sr-only">
            {i18n.t('app.settingsDesc')}
          </DrawerDescription>
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <SettingsMainView
              settings={settings}
              onUpdateSettings={updateSettings}
              onBack={handleBackToChat}
              onAddProvider={handleAddProvider}
              onEditProvider={handleEditProvider}
              onRestoreAll={handleSyncRestore}
              latestLocalSessionAt={latestLocalSessionAt}
              activeSessionId={activeSessionId}
            />
          </div>
        </DrawerContent>
      </Drawer>

      {/* Dialog: Add/Edit Provider */}
      <ProviderDialog
        open={providerDialogOpen}
        onOpenChange={setProviderDialogOpen}
        provider={selectedProviderForEdit}
        isNew={isCreatingNewProvider}
        onSave={handleSaveProvider}
      />

      {/* 允许用户脚本 (userScripts) 强引导弹窗 */}
      <UserScriptsGateDialog />
    </main>
  );
}
