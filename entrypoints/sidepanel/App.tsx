import React, { useState, useMemo, useRef, useCallback } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import type { Settings, ProviderConfig, ReasoningLevel, ChatMessage } from '@/lib/types';
import { settingsItem } from '@/lib/storage';
import { DEFAULT_SETTINGS, findActiveModel } from '@/lib/providers';
import { effectiveMessages, estimateContextTokens, estimateTokens, shouldCompact } from '@/lib/contextTokens';
import { SLASH_COMMANDS } from '@/lib/slashCommands';
import { EMPTY_USAGE } from '@/lib/storage';

import { useGate } from './hooks/useGate';
import { useSessionManager } from './hooks/useSessionManager';
import { useChatTurn } from './hooks/useChatTurn';
import { usePageContextRefs } from './hooks/usePageContextRefs';
import { useCompact } from './hooks/useCompact';

// Components
import { ChatHeader } from './components/chat/ChatHeader';
import { MessageList } from './components/chat/MessageList';
import { ChatInput } from './components/chat/ChatInput';
import { ApprovalSection } from './components/chat/ApprovalSection';
import { SettingsMainView } from './components/settings/SettingsMainView';
import { ProviderDialog } from './components/settings/ProviderDialog';
import { Button } from '@/components/ui/button';

type ViewMode = 'chat' | 'settings';

export default function App() {
  // ── Settings & View Routing(App 域)─────────────────────────────
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [currentView, setCurrentView] = useState<ViewMode>('chat');
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [selectedProviderForEdit, setSelectedProviderForEdit] = useState<ProviderConfig | null>(null);
  const [isCreatingNewProvider, setIsCreatingNewProvider] = useState(false);

  // errorMessage:会话域(切换/新建清空)与对话域(发送失败写入)共同消费,状态提升到组合层
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const clearErrorMessage = useCallback(() => setErrorMessage(null), []);

  // ── 门控域 ──────────────────────────────────────────────────────
  const gate = useGate();

  // ── 会话域(sessions/activeSessionId/loaded/草稿持久化核心/增删切)─────────
  const session = useSessionManager({
    setSettings,
    settingsRef,
    resetGates: gate.resetGates,
    clearErrorMessage,
  });

  // Model & Provider Helpers
  const activeModelInfo = useMemo(() => {
    return findActiveModel(settings);
  }, [settings]);

  // Settings update helper
  const updateSettings = useCallback(async (newSettings: Settings) => {
    setSettings(newSettings);
    await settingsItem.setValue(newSettings);
  }, []);

  // Quick switch active model
  const handleSelectModel = useCallback(
    async (providerId: string, modelId: string) => {
      const updated: Settings = {
        ...settings,
        activeProviderId: providerId,
        activeModelId: modelId,
      };
      await updateSettings(updated);
    },
    [settings, updateSettings]
  );

  // Switch reasoning level
  const handleChangeReasoningLevel = useCallback(
    async (level: ReasoningLevel) => {
      const updated: Settings = {
        ...settings,
        reasoningLevel: level,
      };
      await updateSettings(updated);
    },
    [settings, updateSettings]
  );

  // Toggle page context
  const handleTogglePageContext = useCallback(
    async (enabled: boolean) => {
      const updated: Settings = {
        ...settings,
        includePageContext: enabled,
      };
      await updateSettings(updated);
    },
    [settings, updateSettings]
  );

  // ── 上下文压缩域(先于对话轮次域:isCompacting 作为 boolean 传入发送互斥)─────────
  // isStreamingRef:对话域 state 的镜像(下方渲染体同步),互斥守卫取用时读实时值
  const isStreamingRef = useRef(false);
  // AI 自主压缩:compact_context 工具置位标记(App 持有),turn finalize 后触发 handleCompact
  const compactRequestedRef = useRef(false);
  const compact = useCompact({
    settingsRef,
    currentSession: session.currentSession,
    sessionsRef: session.sessionsRef,
    setSessions: session.setSessions,
    pendingDraftSavesRef: session.pendingDraftSavesRef,
    pendingGateActive: gate.activeGate !== null,
    isStreamingRef,
    setErrorMessage,
  });
  const onAutoCompact = useCallback(() => {
    void compact.handleCompact();
  }, [compact.handleCompact]);

  // ── 对话轮次域 ──────────────────────────────────────────────────
  const chat = useChatTurn({
    settingsRef,
    currentSession: session.currentSession,
    sessionsRef: session.sessionsRef,
    setSessions: session.setSessions,
    setActiveSessionId: session.setActiveSessionId,
    draftRef: session.draftRef,
    pendingDraftSavesRef: session.pendingDraftSavesRef,
    pendingGateActive: gate.activeGate !== null,
    dismissPendingGates: gate.dismissPendingGates,
    resetResolvedGateCount: gate.resetResolvedGateCount,
    setErrorMessage,
    isCompacting: compact.isCompacting,
    compactRequestedRef,
    onAutoCompact,
    onAutoAiTitle: (sessionId) => {
      void session.handleAiTitleSession(sessionId, true);
    },
  });
  // 流式状态镜像(互斥守卫取实时值)
  isStreamingRef.current = chat.isStreaming;

  // ── 页面引用域 ──────────────────────────────────────────────────
  const pageRefs = usePageContextRefs({
    settingsRef,
    updateSettings,
    handleTogglePageContext,
    patchActiveDraft: session.patchActiveDraft,
    draftRef: session.draftRef,
    commitSessions: session.commitSessions,
    sessionsRef: session.sessionsRef,
    setErrorMessage,
  });

  // 斜杠命令分发:/compact(可附补充重点)→ 压缩;/clear → 复用新建会话;/help → 浮层列命令
  const [slashHelpOpen, setSlashHelpOpen] = useState(false);
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

  // Navigation & Provider Dialog Handlers
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

      const updated: Settings = {
        ...settings,
        providers: existing,
        activeProviderId,
        activeModelId,
      };

      await updateSettings(updated);
    },
    [settings, updateSettings]
  );

  // Quick prompt chip click:预设问题并入 draft.input(规则 5)。
  // ChatInput 以 key 重挂载读取新 initialInput(nonce 仅在外部注入文本时递增,逐键输入不重挂载)。
  const [composerNonce, setComposerNonce] = useState(0);
  const handleSelectPrompt = useCallback(
    (promptText: string) => {
      session.patchActiveDraft((d) => ({ ...d, input: promptText }));
      setComposerNonce((n) => n + 1);
    },
    [session.patchActiveDraft]
  );

  // ChatInput 上报输入变化 → 写入当前会话 draft(会话域防抖落盘,见 commitSessions)
  const handleDraftInput = useCallback(
    (text: string) => {
      session.patchActiveDraft((d) => (d.input === text ? d : { ...d, input: text }));
    },
    [session.patchActiveDraft]
  );

  // 统计本轮 in-flight / live 消息中需要门控确认的工具调用总数(支持分页 1/N 呈现)
  const gatePagination = useMemo(() => {
    if (!gate.activeGate) return { step: 1, total: 1 };
    let confirmCallCount = 0;
    // 检查 in-flight 消息中的 confirm 工具调用（如 execute_js）
    if (chat.inFlight && chat.inFlight.messages) {
      for (const m of chat.inFlight.messages) {
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
    if (chat.activeToolNames.includes('execute_js') && confirmCallCount === 0) {
      confirmCallCount = 1;
    }
    const currentStep = gate.resolvedGateCount + 1;
    const totalCount = Math.max(currentStep, confirmCallCount);
    return { step: currentStep, total: totalCount };
  }, [gate.activeGate, chat.inFlight, chat.activeToolNames, gate.resolvedGateCount]);

  // 上下文占用派生:有效历史(压缩过 = [摘要]+之后)× 当前模型窗口 + 三角色占比(lib estimateTokens 统一口径)。
  // S-5:in-flight 消息与流式 live 文本一并计入尾部,环随流式增长
  const contextData = useMemo(() => {
    const model = activeModelInfo?.model;
    if (!model) return null;
    const liveInFlight =
      chat.inFlight && chat.inFlight.sessionId === session.currentSession?.id
        ? chat.inFlight.messages
        : [];
    const all = [...(session.currentSession?.messages ?? []), ...liveInFlight];
    const effective = effectiveMessages(all, session.currentSession?.compaction);
    // 流式中的 live 文本(尚未 message_end 物化)计入尾部
    if (chat.isStreaming && chat.streamingContent) {
      effective.push({
        role: 'assistant',
        content: [{ type: 'text', text: chat.streamingContent }],
        api: 'openai-completions',
        provider: '',
        model: '',
        stopReason: 'stop',
        usage: EMPTY_USAGE,
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
  }, [activeModelInfo, session.currentSession, chat.inFlight, chat.isStreaming, chat.streamingContent]);

  // 模型切换溢出建议:当前上下文超出新模型窗口(shouldCompact)→ 建议压缩,不自动执行
  // 用户可手动关闭本次提示(切会话或会话更新后若依然超出可再次自然产生或关闭)
  const [dismissedOverflowSessionId, setDismissedOverflowSessionId] = useState<string | null>(null);
  const isOverflowDismissed = dismissedOverflowSessionId === session.currentSession?.id;

  const overflowSuggest =
    !isOverflowDismissed &&
    !!contextData &&
    !compact.isCompacting &&
    shouldCompact(contextData.usage);

  if (!session.loaded) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-muted-foreground text-xs">
        加载中...
      </div>
    );
  }

  // 渲染源 = 会话转录 + 本次运行的 in-flight assistant 消息(仅当归属当前会话;
  // 流式中途切到别的会话时不串显)。live 气泡仍由 MessageList 追加在最后。
  const displayedMessages =
    chat.inFlight && chat.inFlight.sessionId === session.currentSession?.id && chat.inFlight.messages.length > 0
      ? [...(session.currentSession?.messages ?? []), ...chat.inFlight.messages]
      : (session.currentSession?.messages ?? []);
  // 尾部 in-flight 消息刚从 live 流式气泡接管:跳过入场动画,交接不闪
  const quietTailCount =
    chat.inFlight && chat.inFlight.sessionId === session.currentSession?.id
      ? chat.inFlight.messages.length
      : 0;

  return (
    <main className="flex h-dvh w-full flex-col bg-background text-foreground overflow-hidden select-text font-sans antialiased">
      {/* VIEW: Chat */}
      {currentView === 'chat' && (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden animate-in fade-in-0 duration-150 motion-reduce:animate-none">
          {/* Header with History Dropdown */}
          <ChatHeader
            sessions={session.sessions}
            activeSessionId={session.activeSessionId}
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
            isStreaming={chat.isStreaming}
            streamingContent={chat.streamingContent}
            streamingThinking={chat.streamingThinking}
            activeToolLabels={chat.activeToolNames}
            gateRequest={gate.activeGate?.request ?? null}
            pendingGateTotal={gatePagination.total}
            quietTailCount={quietTailCount}
            compaction={
              session.currentSession?.compaction
                ? {
                    summaryTimestamp: session.currentSession.compaction.summaryTimestamp,
                    tokensBefore: session.currentSession.compaction.tokensBefore,
                  }
                : null
            }
            isCancelled={chat.isCancelled}
            errorMessage={errorMessage}
            onDismissError={() => setErrorMessage(null)}
            onSelectPrompt={handleSelectPrompt}
            hasProvider={settings.providers.length > 0}
            hasModel={Boolean(activeModelInfo)}
            activeModelName={
              activeModelInfo?.model.displayName || activeModelInfo?.model.id
            }
            onOpenSettings={handleOpenSettings}
          />

          {/* 槽位区:溢出建议 → 压缩状态条 → 审批槽位 → /help 卡(均为 in-flow,挤压列表零遮挡) */}

          {/* 模型切换溢出建议条:不静默自动压缩,一键交给用户;支持关闭 */}
          {overflowSuggest && (
            <div className="w-full shrink-0 px-2 pb-1.5 animate-in fade-in-0 slide-in-from-bottom-2 duration-150 motion-reduce:animate-none">
              <div className="flex items-center gap-2 rounded-md border border-amber-600/30 bg-amber-500/10 dark:border-amber-500/30 dark:bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-foreground shadow-2xs">
                <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="min-w-0 flex-1 truncate">
                  当前上下文超出模型窗口，建议压缩
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px] border-amber-600/40 hover:bg-amber-500/20 text-foreground cursor-pointer"
                    disabled={compact.isCompacting}
                    onClick={() => {
                      void compact.handleCompact();
                    }}
                  >
                    压缩
                  </Button>
                  <button
                    type="button"
                    onClick={() => setDismissedOverflowSessionId(session.currentSession?.id ?? 'temp')}
                    className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    title="忽略建议"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 压缩状态条(轻量) */}
          {compact.isCompacting && (
            <div className="w-full shrink-0 px-2 pb-1.5 animate-in fade-in-0 slide-in-from-bottom-2 duration-150 motion-reduce:animate-none">
              <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/70 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-2xs">
                <Loader2 className="size-3.5 animate-spin shrink-0 text-foreground" />
                <span className="font-medium text-foreground">正在压缩上下文…</span>
              </div>
            </div>
          )}

          {/* 审批槽位:交互审批 UI 的唯一渲染位(消息流内工具卡一律状态化,零交互控件)。
              in-flow flex 子节点,出现时挤压列表;卡片框架永不滚动,高度由内容决定。 */}
          {gate.activeGate && (
            <div className="w-full shrink-0 px-2 pb-1.5 animate-in fade-in-0 slide-in-from-bottom-2 duration-150 motion-reduce:animate-none">
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
            <div className="w-full shrink-0 px-2 pb-1.5 animate-in fade-in-0 slide-in-from-bottom-2 duration-150 motion-reduce:animate-none">
              <div className="space-y-2 rounded-lg border border-border bg-card p-3 text-xs shadow-xs">
                <div className="flex items-center justify-between border-b border-border/50 pb-1.5">
                  <span className="text-[11px] font-semibold text-foreground">可用快捷命令</span>
                  <button
                    type="button"
                    onClick={() => setSlashHelpOpen(false)}
                    className="text-muted-foreground transition-colors hover:text-foreground cursor-pointer rounded p-0.5"
                    title="关闭"
                  >
                    <X className="size-3.5" />
                  </button>
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
            key={`${session.activeSessionId ?? 'none'}#${composerNonce}`}
            onSend={chat.handleSendMessage}
            onStop={chat.handleStopGeneration}
            isStreaming={chat.isStreaming}
            settings={settings}
            onSelectModel={handleSelectModel}
            onChangeReasoningLevel={handleChangeReasoningLevel}
            refTabs={settings.includePageContext ? session.draft.refTabs : []}
            pickedElements={settings.includePageContext ? session.draft.pickedElements : []}
            onAddCurrentTab={pageRefs.handleAddCurrentTab}
            onAddRefTab={pageRefs.addRefTab}
            onRemoveRefTab={pageRefs.handleRemoveRefTab}
            onStartPickElement={pageRefs.handleStartPickElement}
            onRemovePickedElement={pageRefs.handleRemovePickedElement}
            onOpenSettings={handleOpenSettings}
            disabled={!activeModelInfo || compact.isCompacting}
            placeholder={compact.isCompacting ? '正在压缩上下文…' : undefined}
            initialInput={session.draft.input}
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
      )}

      {/* VIEW: Settings Main */}
      {currentView === 'settings' && (
        <SettingsMainView
          settings={settings}
          onUpdateSettings={updateSettings}
          onBack={handleBackToChat}
          onAddProvider={handleAddProvider}
          onEditProvider={handleEditProvider}
        />
      )}

      {/* Dialog: Add/Edit Provider */}
      <ProviderDialog
        open={providerDialogOpen}
        onOpenChange={setProviderDialogOpen}
        provider={selectedProviderForEdit}
        isNew={isCreatingNewProvider}
        onSave={handleSaveProvider}
      />
    </main>
  );
}
