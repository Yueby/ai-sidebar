import React, { useState, useMemo, useRef, useCallback } from 'react';
import type { Settings, ProviderConfig, ReasoningLevel } from '@/lib/types';
import { settingsItem } from '@/lib/storage';
import { DEFAULT_SETTINGS, findActiveModel } from '@/lib/providers';

import { useGate } from './hooks/useGate';
import { useSessionManager } from './hooks/useSessionManager';
import { useChatTurn } from './hooks/useChatTurn';
import { usePageContextRefs } from './hooks/usePageContextRefs';

// Components
import { ChatHeader } from './components/chat/ChatHeader';
import { MessageList } from './components/chat/MessageList';
import { ChatInput } from './components/chat/ChatInput';
import { ApprovalSection } from './components/chat/ApprovalSection';
import { SettingsMainView } from './components/settings/SettingsMainView';
import { ProviderDialog } from './components/settings/ProviderDialog';

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
  });

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
            onSelectSession={session.handleSelectSession}
            onDeleteSession={session.handleDeleteSession}
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

          {/* 审批槽位:交互审批 UI 的唯一渲染位(消息流内工具卡一律状态化,零交互控件)。
              in-flow flex 子节点,出现时挤压列表;卡片框架永不滚动,高度由内容决定。 */}
          {gate.activeGate && (
            <div className="w-full shrink-0 px-2 pb-2 animate-in fade-in-0 slide-in-from-bottom-2 duration-150 motion-reduce:animate-none">
              <ApprovalSection
                request={gate.activeGate.request}
                onApprove={gate.handleGateApprove}
                onDeny={gate.handleGateDeny}
                onAnswer={gate.handleGateAnswer}
                onCancel={gate.handleGateCancel}
              />
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
            disabled={!activeModelInfo}
            initialInput={session.draft.input}
            onInputChange={handleDraftInput}
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
