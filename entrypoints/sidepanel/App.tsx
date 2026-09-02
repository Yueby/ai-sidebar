import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Settings, Session, SessionDraft, ChatMessage, ProviderConfig, ReasoningLevel, PageRefs, RefTabMeta, RefElementMeta } from '@/lib/types';
import {
  settingsItem,
  activeSessionIdItem,
  sanitizeSettings,
  createSession,
  createUserMessage,
  titleFromText,
} from '@/lib/storage';
import { migrateLegacySessions, saveSession, deleteSession } from '@/lib/sessionStore';
import { DEFAULT_SETTINGS, findActiveModel, resolveReasoningLevel } from '@/lib/providers';
import { runAgentTurn } from '@/lib/agent';
import { getErrorMessage } from '@/lib/utils';
import {
  getActiveTabMeta,
  getTabMeta,
  startPickElement,
  PICK_ELEMENT_RESULT_MESSAGE,
  type RefTab,
} from '@/lib/pageContext';
import {
  type GateRequest,
  type GateResponse,
  setGateHandler,
  flushPendingGates,
} from './gateAdapter';

// Components
import { ChatHeader } from './components/chat/ChatHeader';
import { MessageList } from './components/chat/MessageList';
import { ChatInput } from './components/chat/ChatInput';
import { ApprovalSection } from './components/chat/ApprovalSection';
import { SettingsMainView } from './components/settings/SettingsMainView';
import { ProviderDialog } from './components/settings/ProviderDialog';

type ViewMode = 'chat' | 'settings';

/** 空草稿(每次新建对象,避免共享可变引用) */
const cloneEmptyDraft = (): SessionDraft => ({ input: '', refTabs: [], pickedElements: [] });
const EMPTY_DRAFT: SessionDraft = { input: '', refTabs: [], pickedElements: [] };

/** 草稿持久化防抖窗口(ms):逐键输入只进内存,合并写 IndexedDB */
const DRAFT_SAVE_DEBOUNCE_MS = 400;

/** 新会话草稿预填(规则 1):includePageContext 开启时自动引用当前活动标签页 */
async function buildInitialDraft(includePageContext: boolean): Promise<SessionDraft | undefined> {
  if (!includePageContext) return undefined;
  const meta = await getActiveTabMeta().catch(() => null);
  return meta ? { input: '', refTabs: [meta], pickedElements: [] } : undefined;
}

export default function App() {
  // Global Settings & Sessions State
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // View Routing State
  const [currentView, setCurrentView] = useState<ViewMode>('chat');
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [selectedProviderForEdit, setSelectedProviderForEdit] = useState<ProviderConfig | null>(null);
  const [isCreatingNewProvider, setIsCreatingNewProvider] = useState(false);

  // Chat & Streaming State
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const [activeToolNames, setActiveToolNames] = useState<string[]>([]);
  const [isCancelled, setIsCancelled] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // 多 turn agent 循环的 in-flight 消息:已 message_end 但尚未进转录(finalize 才落)的
  // 完整 assistant 消息。渲染源 = 会话转录 + 本列表,live 气泡只承载「正在流的那条」,
  // 否则 turn1 完成到 finalize 之间无处渲染 → 气泡闪没/错乱。
  const [inFlight, setInFlight] = useState<{ sessionId: string; messages: ChatMessage[] } | null>(null);

  // 本轮会话中已完成处理的门控次数（用于分页序号与总数统计）
  const [resolvedGateCount, setResolvedGateCount] = useState(0);

  // 工具门控请求(confirm/ask)
  const [activeGate, setActiveGate] = useState<{
    request: GateRequest;
    resolve: (res: GateResponse) => void;
  } | null>(null);

  // 门控响应回调封装
  const handleGateApprove = useCallback(() => {
    if (activeGate) {
      setResolvedGateCount((c) => c + 1);
      activeGate.resolve({ kind: 'confirm', approved: true });
      setActiveGate(null);
    }
  }, [activeGate]);

  const handleGateDeny = useCallback(() => {
    if (activeGate) {
      setResolvedGateCount((c) => c + 1);
      activeGate.resolve({ kind: 'confirm', approved: false });
      setActiveGate(null);
    }
  }, [activeGate]);

  const handleGateAnswer = useCallback((answer: string) => {
    if (activeGate) {
      setResolvedGateCount((c) => c + 1);
      activeGate.resolve({ kind: 'ask', answer });
      setActiveGate(null);
    }
  }, [activeGate]);

  const handleGateCancel = useCallback(() => {
    if (activeGate) {
      setResolvedGateCount((c) => c + 1);
      activeGate.resolve({ kind: 'ask', answer: '', cancelled: true });
      setActiveGate(null);
    }
  }, [activeGate]);

  // 挂载时向 gateAdapter 注册 UI 处理函数
  useEffect(() => {
    setGateHandler((req: GateRequest) => {
      return new Promise<GateResponse>((resolve) => {
        setActiveGate({ request: req, resolve });
      });
    });
    return () => {
      setGateHandler(null);
      flushPendingGates();
    };
  }, []);

  // 每会话草稿:输入文本 / 引用标签页 / 框选元素不再是全局 state,
  // 一律派生自当前会话的 Session.draft(唯一事实来源,IndexedDB 持久化)。

  // Refs for managing streaming abort and latest values
  const abortControllerRef = useRef<AbortController | null>(null);
  // turn 身份守卫:打断重发后旧 turn 的拆卸链与新 turn 并发,seq 不匹配者不得触碰共享状态
  const turnSeqRef = useRef(0);
  const streamingContentRef = useRef('');
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  // 进行中的框选:结果回传时归属 tab;并保留启动时的页面元信息作兜底
  // (回传时 tabs 实时查询可能失败/URL 不可见,此时仍需能加引用,不能静默丢弃)
  const pendingPickRef = useRef<{ tabId: number; meta: RefTab } | null>(null);

  // Initialize and subscribe to Storage
  useEffect(() => {
    let unwatchSettings: (() => void) | undefined;
    let unwatchActiveId: (() => void) | undefined;

    async function initStorage() {
      const [rawSettings, rawActiveId] = await Promise.all([
        settingsItem.getValue(),
        activeSessionIdItem.getValue(),
      ]);

      const cleanSettings = sanitizeSettings(rawSettings);
      setSettings(cleanSettings);

      let initialSessions = await migrateLegacySessions();
      let initialActiveId = rawActiveId;

      if (initialSessions.length === 0) {
        // 首个会话 = 新会话:草稿预填当前活动页(规则 1)
        const newSess = createSession('新会话', await buildInitialDraft(cleanSettings.includePageContext));
        initialSessions = [newSess];
        initialActiveId = newSess.id;
        await saveSession(newSess);
        await activeSessionIdItem.setValue(initialActiveId);
      } else if (!initialActiveId || !initialSessions.some((s) => s.id === initialActiveId)) {
        initialActiveId = initialSessions[0]!.id;
        await activeSessionIdItem.setValue(initialActiveId);
      }

      // 启动时活动会话仍为空(上次没发消息):补引用当前活动页
      // (替代旧「autoAddedRef 每个开关周期自动加一次」的全局 effect)
      const initialActive = initialSessions.find((s) => s.id === initialActiveId);
      if (
        initialActive &&
        initialActive.messages.length === 0 &&
        cleanSettings.includePageContext &&
        (initialActive.draft?.refTabs.length ?? 0) === 0
      ) {
        const meta = await getActiveTabMeta().catch(() => null);
        if (meta) {
          initialActive.draft = { ...(initialActive.draft ?? cloneEmptyDraft()), refTabs: [meta] };
          await saveSession(initialActive);
        }
      }

      setSessions(initialSessions);
      setActiveSessionId(initialActiveId);
      setLoaded(true);

      // Watch for background or other window changes
      // (IndexedDB 无跨上下文 watch,sidepanel 是会话历史唯一写方)
      unwatchSettings = settingsItem.watch((newVal) => {
        setSettings(sanitizeSettings(newVal));
      });
      unwatchActiveId = activeSessionIdItem.watch((newVal) => {
        setActiveSessionId(newVal);
      });
    }

    initStorage();

    return () => {
      unwatchSettings?.();
      unwatchActiveId?.();
    };
  }, []);

  // Active session helper
  const currentSession = useMemo(() => {
    return sessions.find((s) => s.id === activeSessionId) || sessions[0] || null;
  }, [sessions, activeSessionId]);

  // ── 草稿读写:派生值 + 防抖持久化 ─────────────────────────────
  // 读:draft 派生自 currentSession(渲染期),所有 handler 只读 draftRef/sessionsRef。
  // 写:patchActiveDraft → sessionsRef 同步更新 + setSessions + pending map,
  //     400ms 防抖后 saveSession;切换/新建/删除/发送/卸载前 flushDraftSaves() 立即落盘。
  const draft = currentSession?.draft ?? EMPTY_DRAFT;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const pendingDraftSavesRef = useRef<Map<string, Session>>(new Map());
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushDraftSaves = useCallback(() => {
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    const pending = pendingDraftSavesRef.current;
    if (pending.size === 0) return;
    pendingDraftSavesRef.current = new Map();
    for (const s of pending.values()) {
      void saveSession(s).catch(() => {});
    }
  }, []);

  /** 提交会话数组变更并把涉及会话的最新对象放入防抖写盘队列 */
  const commitSessions = useCallback(
    (next: Session[], changedIds: string[]) => {
      sessionsRef.current = next;
      setSessions(next);
      for (const id of changedIds) {
        const s = next.find((x) => x.id === id);
        if (s) pendingDraftSavesRef.current.set(id, s);
      }
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = setTimeout(flushDraftSaves, DRAFT_SAVE_DEBOUNCE_MS);
    },
    [flushDraftSaves]
  );

  const patchDraftOf = useCallback(
    (sessionId: string, mutator: (d: SessionDraft) => SessionDraft) => {
      const prev = sessionsRef.current;
      const idx = prev.findIndex((s) => s.id === sessionId);
      if (idx < 0) return;
      const session = prev[idx]!;
      const nextDraft = mutator(session.draft ?? cloneEmptyDraft());
      if (nextDraft === session.draft) return; // 无变化:不渲染不落盘
      const next = [...prev];
      next[idx] = { ...session, draft: nextDraft };
      commitSessions(next, [sessionId]);
    },
    [commitSessions]
  );

  const patchActiveDraft = useCallback(
    (mutator: (d: SessionDraft) => SessionDraft) => {
      const id = activeSessionIdRef.current;
      if (id) patchDraftOf(id, mutator);
    },
    [patchDraftOf]
  );

  // 面板关闭(组件卸载)前把未落盘的草稿立即写回
  useEffect(() => () => flushDraftSaves(), [flushDraftSaves]);

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

  // Ref tab management(写入当前会话草稿,addRefTab 语义不变:按 tab id 去重)
  const addRefTab = useCallback(
    (tab: RefTab) => {
      patchActiveDraft((d) =>
        d.refTabs.some((t) => t.id === tab.id) ? d : { ...d, refTabs: [...d.refTabs, tab] }
      );
    },
    [patchActiveDraft]
  );

  // 新会话自动引用当前页(规则 1)已改由「创建/初始化时预填 draft」实现
  // (见 initStorage / handleNewSession / handleDeleteSession / buildInitialDraft),
  // 不再用全局 autoAddedRef effect。

  // 引用标签页的实时同步:导航更新 title/url、重载清该 tab 元素框选、关闭移除。
  // 草稿按会话持久化后,非活动会话的草稿也可能引用同一 tab,
  // 故对所有会话草稿做内存同步,并把有变化的会话一起排进防抖写盘队列。
  useEffect(() => {
    if (typeof browser === 'undefined' || !browser.tabs?.onUpdated) return;
    const patchAllDrafts = (mutator: (d: SessionDraft) => SessionDraft | null) => {
      const prev = sessionsRef.current;
      const next: Session[] = [];
      const changedIds: string[] = [];
      for (const s of prev) {
        if (!s.draft) {
          next.push(s);
          continue;
        }
        const mutated = mutator(s.draft);
        if (!mutated || mutated === s.draft) {
          next.push(s);
          continue;
        }
        next.push({ ...s, draft: mutated });
        changedIds.push(s.id);
      }
      if (changedIds.length > 0) commitSessions(next, changedIds);
    };
    const onUpdated = (
      tabId: number,
      changeInfo: { title?: string; url?: string; status?: string }
    ) => {
      // 导航/重载完成:清空该 tab 的元素选择记录(页面引用保留,title/url 继续同步)
      const clearPicked = changeInfo.status === 'complete';
      const syncMeta = Boolean(changeInfo.title || changeInfo.url);
      if (!clearPicked && !syncMeta) return;
      patchAllDrafts((d) => {
        let nd = d;
        if (clearPicked && nd.pickedElements.some((p) => p.tabId === tabId)) {
          nd = { ...nd, pickedElements: nd.pickedElements.filter((p) => p.tabId !== tabId) };
        }
        if (syncMeta && nd.refTabs.some((t) => t.id === tabId)) {
          nd = {
            ...nd,
            refTabs: nd.refTabs.map((t) =>
              t.id === tabId
                ? { ...t, title: changeInfo.title ?? t.title, url: changeInfo.url ?? t.url }
                : t
            ),
          };
        }
        return nd === d ? null : nd;
      });
    };
    const onRemoved = (tabId: number) => {
      patchAllDrafts((d) => {
        if (
          !d.refTabs.some((t) => t.id === tabId) &&
          !d.pickedElements.some((p) => p.tabId === tabId)
        ) {
          return null;
        }
        return {
          ...d,
          refTabs: d.refTabs.filter((t) => t.id !== tabId),
          pickedElements: d.pickedElements.filter((p) => p.tabId !== tabId),
        };
      });
    };
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(onRemoved);
    return () => {
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onRemoved.removeListener(onRemoved);
    };
  }, [commitSessions]);

  const handleAddCurrentTab = useCallback(async () => {
    if (!settingsRef.current.includePageContext) {
      await handleTogglePageContext(true);
    }
    const meta = await getActiveTabMeta().catch(() => null);
    if (meta) addRefTab(meta);
  }, [addRefTab, handleTogglePageContext]);

  const handleRemoveRefTab = useCallback(
    (id: number) => {
      const remaining = draftRef.current.refTabs.filter((t) => t.id !== id);
      patchActiveDraft((d) => ({
        ...d,
        refTabs: d.refTabs.filter((t) => t.id !== id),
        // 同步清掉该标签页上的元素框选引用
        pickedElements: d.pickedElements.filter((p) => p.tabId !== id),
      }));
      // 移除最后一个引用时同步关闭总开关,保持「X = 关闭网页引用」的心智
      if (remaining.length === 0 && settingsRef.current.includePageContext) {
        handleTogglePageContext(false);
      }
    },
    [patchActiveDraft, handleTogglePageContext]
  );

  // 元素框选模式:不带 tabId 时作用于当前活动标签页;带 tabId 时先激活该标签页(框选必须可见)
  const handleStartPickElement = useCallback(
    async (tabId?: number) => {
      let meta: RefTab | null = null;
      if (typeof tabId === 'number') {
        meta =
          draftRef.current.refTabs.find((t) => t.id === tabId) ??
          (await getTabMeta(tabId).catch(() => null));
        if (!meta) {
          setErrorMessage('无法在该标签页启动元素选择:找不到该标签页');
          return;
        }
        try {
          await browser.tabs.update(tabId, { active: true });
        } catch {
          // 标签页可能已被关闭
          setErrorMessage('无法激活该标签页,元素选择已取消');
          return;
        }
      } else {
        meta = await getActiveTabMeta().catch(() => null);
      }
      if (!meta) {
        // 目标页不是普通网页(chrome:// 等),无法框选
        setErrorMessage('当前页面不是普通网页,无法框选元素');
        return;
      }
      // 启动时不再自动加引用;框选成功返回时才「引用页面 + 元素 chip」
      try {
        await startPickElement(meta.id);
        pendingPickRef.current = { tabId: meta.id, meta };
      } catch (err) {
        // 兜底注入失败/页面不可达:给用户可见的错误反馈,不无声失败
        setErrorMessage(err instanceof Error ? err.message : '启动元素选择失败,请重试');
      }
    },
    []
  );

  const handleRemovePickedElement = useCallback(
    (id: string) => {
      patchActiveDraft((d) => ({
        ...d,
        pickedElements: d.pickedElements.filter((p) => p.id !== id),
      }));
    },
    [patchActiveDraft]
  );

  // 接收 content script 的框选结果广播(runtime.sendMessage)
  useEffect(() => {
    if (typeof browser === 'undefined' || !browser.runtime?.onMessage) return;
    const onMessage = (
      message: {
        type?: string;
        selector?: string;
        tagName?: string;
        preview?: string;
      },
      sender: { tab?: { id?: number } },
    ) => {
      if (message?.type !== PICK_ELEMENT_RESULT_MESSAGE) return;
      // 结果归属:优先用发送方 tab id(权威,避免多 tab 框选的单槽竞态),
      // 兜底用启动框选时记录的 tabId
      const selector = message.selector;
      if (typeof selector !== 'string' || !selector) {
        setErrorMessage('元素选择返回结果无效,请重新框选');
        return;
      }
      const tabId = typeof sender?.tab?.id === 'number' ? sender.tab.id : pendingPickRef.current?.tabId;
      if (typeof tabId !== 'number') {
        setErrorMessage('无法确定元素所属标签页,请重新框选');
        return;
      }
      const startMeta = pendingPickRef.current?.tabId === tabId ? pendingPickRef.current.meta : null;
      pendingPickRef.current = null;
      // 选中成功 = 此刻才自动引用该页面(启动框选时不加),再追加元素记录
      void (async () => {
        // 实时元信息优先;tabs 查询失败或 URL 不可见时退回启动框选时记录的元信息,
        // 避免结果已回传却因一次查询失败而静默丢掉引用与元素
        const meta = (await getTabMeta(tabId).catch(() => null)) ?? startMeta;
        if (!meta) {
          setErrorMessage('添加元素引用失败:无法获取该标签页信息,可能已被关闭');
          return;
        }
        try {
          if (!settingsRef.current.includePageContext) {
            await updateSettings({ ...settingsRef.current, includePageContext: true });
          }
        } catch {
          setErrorMessage('添加元素引用失败:写入设置时出错,请重试');
          return;
        }
        // 「引用页面 + 元素 chip」一次性写入当前会话草稿(原子,避免两次 commit)
        patchActiveDraft((d) => {
          const refTabs = d.refTabs.some((t) => t.id === tabId)
            ? d.refTabs
            : [...d.refTabs, meta];
          const alreadyPicked = d.pickedElements.some(
            (p) => p.tabId === tabId && p.selector === selector
          );
          const pickedElements = alreadyPicked
            ? d.pickedElements
            : [
                ...d.pickedElements,
                {
                  id: `${tabId}:${selector}`,
                  tabId,
                  selector,
                  tagName: message.tagName ?? '',
                  preview: message.preview ?? '',
                },
              ];
          if (refTabs === d.refTabs && pickedElements === d.pickedElements) return d;
          return { ...d, refTabs, pickedElements };
        });
      })();
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, [patchActiveDraft, updateSettings]);

  // 会话切换时冲销未处理门控请求并重置门控统计
  const handleSelectSession = useCallback(
    async (id: string) => {
      const leavingId = activeSessionIdRef.current;
      if (leavingId === id) return;
      // 切换会话冲销所有 pending 门控(安全拒绝)
      flushPendingGates();
      setActiveGate(null);
      setResolvedGateCount(0);
      const leaving = leavingId
        ? sessionsRef.current.find((s) => s.id === leavingId) ?? null
        : null;
      const recycle = !!leaving && leaving.messages.length === 0;
      // 回收前先摘除离开会话的待发草稿,避免 flush 把它写回后与 deleteSession 竞态复活
      if (recycle) pendingDraftSavesRef.current.delete(leaving!.id);
      // 其余会话的待落盘草稿立即写入(切换是自然 flush 边界)
      flushDraftSaves();
      if (recycle) {
        const remaining = sessionsRef.current.filter((s) => s.id !== leaving!.id);
        sessionsRef.current = remaining;
        setSessions(remaining);
        await deleteSession(leaving!.id);
      }
      setActiveSessionId(id);
      await activeSessionIdItem.setValue(id);
      setErrorMessage(null);
    },
    [flushDraftSaves]
  );

  const handleNewSession = useCallback(async () => {
    // 规则 2:当前会话已是空的 → 直接复用不叠加
    const cur = activeSessionIdRef.current
      ? sessionsRef.current.find((s) => s.id === activeSessionIdRef.current) ?? null
      : null;
    if (cur && cur.messages.length === 0) {
      setErrorMessage(null);
      return;
    }
    // 新建会话冲销所有 pending 门控
    flushPendingGates();
    setActiveGate(null);
    setResolvedGateCount(0);
    flushDraftSaves();
    // 规则 1:新会话草稿预填当前活动页
    const newSess = createSession(
      '新会话',
      await buildInitialDraft(settingsRef.current.includePageContext)
    );
    const next = [newSess, ...sessionsRef.current];
    sessionsRef.current = next;
    setSessions(next);
    setActiveSessionId(newSess.id);
    await saveSession(newSess);
    await activeSessionIdItem.setValue(newSess.id);
    setErrorMessage(null);
  }, [flushDraftSaves]);

  const handleDeleteSession = useCallback(
    async (id: string) => {
      // 若删除当前会话，冲销 pending 门控
      if (activeSessionIdRef.current === id) {
        flushPendingGates();
        setActiveGate(null);
        setResolvedGateCount(0);
      }
      // 防止被删会话的待发草稿在 flush 时复活它;删除是自然 flush 边界
      pendingDraftSavesRef.current.delete(id);
      flushDraftSaves();
      const remaining = sessionsRef.current.filter((s) => s.id !== id);
      let nextActiveId = activeSessionIdRef.current;

      if (nextActiveId === id) {
        if (remaining.length > 0) {
          nextActiveId = remaining[0]!.id;
        } else {
          // 删空后自动补一个新会话(规则 2),并按规则 1 预填当前活动页
          const fresh = createSession(
            '新会话',
            await buildInitialDraft(settingsRef.current.includePageContext)
          );
          remaining.push(fresh);
          nextActiveId = fresh.id;
          await saveSession(fresh);
        }
      }

      sessionsRef.current = remaining;
      setSessions(remaining);
      setActiveSessionId(nextActiveId);
      await deleteSession(id);
      await activeSessionIdItem.setValue(nextActiveId);
    },
    [flushDraftSaves]
  );

  // Navigation & Provider Dialog Handlers
  const handleOpenSettings = useCallback(() => {
    // 离开聊天视图时冲销挂起门控(与停止生成同款处理;deny 后模型收到拒绝文本收尾,无需恢复)
    flushPendingGates();
    setActiveGate(null);
    setCurrentView('settings');
  }, []);

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

  // AI Chat & Agent Loop
  const handleSendMessage = useCallback(
    async (userText: string) => {
      // 若当前正在流式或有 pending 门控，按发送视为用户打断当前轮次
      if (isStreaming || activeGate !== null) {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
        flushPendingGates();
        setActiveGate(null);
      }

      const active = findActiveModel(settingsRef.current);
      if (!active) {
        setErrorMessage('请先在设置中配置可用的 AI 提供商与模型');
        return;
      }

      let session = currentSession;
      let allSessions = [...sessionsRef.current];

      if (!session) {
        session = createSession(titleFromText(userText));
        allSessions = [session, ...allSessions];
        setActiveSessionId(session.id);
        await activeSessionIdItem.setValue(session.id);
      }

      const isFirstMessage = session.messages.length === 0 || session.title === '新会话';
      // 规则 3(定稿):发送瞬间把草稿引用做成 <page-refs> 块内嵌进 user 消息 content。
      // 逐 tab 刷新元信息(getTabMeta 失败回退草稿值,绝不丢引用);focused 仅标注
      // 「发送时刻活动且在该引用列表内」的 tab;无引用则消息与朴素文本逐字节一致。
      const draftAtSend = session.draft ?? EMPTY_DRAFT;
      const snapTabs = settingsRef.current.includePageContext ? draftAtSend.refTabs : [];
      const snapElements = settingsRef.current.includePageContext
        ? draftAtSend.pickedElements
        : [];
      let pageRefs: PageRefs | undefined;
      let refreshedTabs = snapTabs;
      if (snapTabs.length > 0 || snapElements.length > 0) {
        const focusedTabId = (await getActiveTabMeta().catch(() => null))?.id;
        refreshedTabs = await Promise.all(
          snapTabs.map(async (t) => (await getTabMeta(t.id).catch(() => null)) ?? t)
        );
        const tabs: RefTabMeta[] = refreshedTabs.map((t) => ({
          tabId: t.id,
          title: t.title,
          url: t.url,
          ...(t.id === focusedTabId ? { focused: true } : {}),
        }));
        const elements: RefElementMeta[] = snapElements.map((e) => ({
          tabId: e.tabId,
          selector: e.selector,
          tagName: e.tagName,
          preview: e.preview,
        }));
        pageRefs = { tabs, elements };
      }
      const userMessage = createUserMessage(userText, pageRefs);
      const messagesWithUser: ChatMessage[] = [...session.messages, userMessage];

      // 先落盘用户消息,长对话中断也不丢;规则 4:发送即清空该会话草稿
      // (流式期间用户可继续为新消息添加引用,故清空在此刻完成而非转录落盘时)
      const updatedSession: Session = {
        ...session,
        title: isFirstMessage ? titleFromText(userText) : session.title,
        messages: messagesWithUser,
        draft: cloneEmptyDraft(),
        updatedAt: Date.now(),
      };
      const nextSessions = allSessions.map((s) => (s.id === session!.id ? updatedSession : s));
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);
      // 该会话未落盘的草稿编辑已被「清空草稿」取代,丢弃待发项避免旧对象复活引用
      pendingDraftSavesRef.current.delete(session.id);
      await saveSession(updatedSession);

      // turn 身份守卫:自此新 turn 接管,旧 turn 拆卸链的 setInFlight(null)/落盘/finally 全部失效
      const seq = ++turnSeqRef.current;
      setIsStreaming(true);
      setStreamingContent('');
      setStreamingThinking('');
      setActiveToolNames([]);
      streamingContentRef.current = '';
      setIsCancelled(false);
      setErrorMessage(null);
      setResolvedGateCount(0);
      // 新一轮运行:清空 in-flight 并声明归属会话
      setInFlight({ sessionId: session.id, messages: [] });

      const abortCtrl = new AbortController();
      abortControllerRef.current = abortCtrl;

      try {
        const result = await runAgentTurn({
          provider: active.provider,
          modelId: active.model.id,
          history: session.messages,
          userMessage,
          // 实时引用(含 tabId)供本轮 read_page/read_element 工具用;
          // agent 侧再并入历史块,追问旧页面时句柄不丢
          refTabs: refreshedTabs,
          pickedElements: snapElements,
          thinkingLevel: resolveReasoningLevel(active.model, settingsRef.current.reasoningLevel),
          sessionId: session.id,
          signal: abortCtrl.signal,
          onEvent: (event) => {
            if (event.type === 'message_update' && event.message.role === 'assistant') {
              const text = event.message.content
                .filter((b) => b.type === 'text')
                .map((b) => b.text)
                .join('');
              const thinking = event.message.content
                .filter((b) => b.type === 'thinking')
                .map((b) => b.thinking)
                .join('');
              streamingContentRef.current = text;
              setStreamingContent(text);
              setStreamingThinking(thinking);
            } else if (event.type === 'message_end' && event.message.role === 'assistant') {
              // 一条 assistant 完成:整体进 in-flight(思考/toolCall/正文齐全),
              // 同一批 setState 里重置 live 流式态,准备承载下一 turn —— 交接无闪烁
              const done = event.message;
              setInFlight((prev) =>
                prev && prev.sessionId === session!.id
                  ? { ...prev, messages: [...prev.messages, done as ChatMessage] }
                  : prev
              );
              streamingContentRef.current = '';
              setStreamingContent('');
              setStreamingThinking('');
            } else if (event.type === 'tool_execution_start') {
              setActiveToolNames((prev) =>
                prev.includes(event.toolName) ? prev : [...prev, event.toolName]
              );
            } else if (event.type === 'tool_execution_end') {
              setActiveToolNames((prev) => prev.filter((n) => n !== event.toolName));
            }
          },
        });

        // 用完整转录落盘(含 assistant/toolResult,回放零转换;user 消息带 refSnapshot)。
        // 基于该会话的「最新」内存副本:流式期间用户可能已在草稿中添加新引用,不能覆盖。
        // 若会话已被删除(流式中途删掉当前会话),不复活,丢弃本轮转录。
        // R-1:已被新 turn 接管(打断重发)时,旧转录不落盘、不清理新 turn 的 in-flight
        if (seq !== turnSeqRef.current) return;
        const latest = sessionsRef.current.find((s) => s.id === session!.id);
        if (latest) {
          const finalizedSession: Session = { ...latest, messages: result.messages, updatedAt: Date.now() };
          pendingDraftSavesRef.current.delete(finalizedSession.id);
          sessionsRef.current = sessionsRef.current.map((s) =>
            s.id === finalizedSession.id ? finalizedSession : s
          );
          setSessions(sessionsRef.current);
          // 完整转录已含 in-flight 各条 assistant → 同批清空 inFlight,避免重复渲染闪烁
          setInFlight(null);
          await saveSession(finalizedSession);
        } else {
          setInFlight(null);
        }
        if (abortCtrl.signal.aborted) {
          setIsCancelled(true);
        } else if (result.errorMessage) {
          setErrorMessage(result.errorMessage);
        }
      } catch (err: unknown) {
        // R-1:旧 turn 已被接管时不清理新 turn 的 in-flight
        if (seq !== turnSeqRef.current) return;
        // 异常路径不落盘转录,in-flight 无处可归 → 清空避免残留悬空气泡
        setInFlight(null);
        if (abortCtrl.signal.aborted) {
          setIsCancelled(true);
        } else {
          setErrorMessage(getErrorMessage(err) || '请求失败，请检查网络或提供商配置');
        }
      } finally {
        // R-1:仅当前 turn 的所有者才能拆卸 streaming/abort 状态(不弄坏新 turn 的停止按钮)
        if (seq === turnSeqRef.current) {
          setIsStreaming(false);
          setActiveToolNames([]);
          abortControllerRef.current = null;
        }
      }
    },
    [isStreaming, activeGate, currentSession]
  );

  // Stop generation: 中止流式请求并冲销 pending 门控
  const handleStopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    flushPendingGates();
    setActiveGate(null);
  }, []);

  // Quick prompt chip click:预设问题并入 draft.input(规则 5)。
  // ChatInput 以 key 重挂载读取新 initialInput(nonce 仅在外部注入文本时递增,逐键输入不重挂载)。
  const [composerNonce, setComposerNonce] = useState(0);
  const handleSelectPrompt = useCallback(
    (promptText: string) => {
      patchActiveDraft((d) => ({ ...d, input: promptText }));
      setComposerNonce((n) => n + 1);
    },
    [patchActiveDraft]
  );

  // ChatInput 上报输入变化 → 写入当前会话 draft(App 侧防抖落盘,见 commitSessions)
  const handleDraftInput = useCallback(
    (text: string) => {
      patchActiveDraft((d) => (d.input === text ? d : { ...d, input: text }));
    },
    [patchActiveDraft]
  );

  // 统计本轮 in-flight / live 消息中需要门控确认的工具调用总数(支持分页 1/N 呈现)
  const gatePagination = useMemo(() => {
    if (!activeGate) return { step: 1, total: 1 };
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
    const currentStep = resolvedGateCount + 1;
    const totalCount = Math.max(currentStep, confirmCallCount);
    return { step: currentStep, total: totalCount };
  }, [activeGate, inFlight, activeToolNames, resolvedGateCount]);

  if (!loaded) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-muted-foreground text-xs">
        加载中...
      </div>
    );
  }

  // 渲染源 = 会话转录 + 本次运行的 in-flight assistant 消息(仅当归属当前会话;
  // 流式中途切到别的会话时不串显)。live 气泡仍由 MessageList 追加在最后。
  const displayedMessages =
    inFlight && inFlight.sessionId === currentSession?.id && inFlight.messages.length > 0
      ? [...(currentSession?.messages ?? []), ...inFlight.messages]
      : (currentSession?.messages ?? []);
  // 尾部 in-flight 消息刚从 live 流式气泡接管:跳过入场动画,交接不闪
  const quietTailCount =
    inFlight && inFlight.sessionId === currentSession?.id ? inFlight.messages.length : 0;

  return (
    <main className="flex h-dvh w-full flex-col bg-background text-foreground overflow-hidden select-text font-sans antialiased">
      {/* VIEW: Chat */}
      {currentView === 'chat' && (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden animate-in fade-in-0 duration-150 motion-reduce:animate-none">
          {/* Header with History Dropdown */}
          <ChatHeader
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
            onNewSession={handleNewSession}
            onOpenSettings={handleOpenSettings}
          />

          {/* Messages */}
          <MessageList
            messages={displayedMessages}
            isStreaming={isStreaming}
            streamingContent={streamingContent}
            streamingThinking={streamingThinking}
            activeToolLabels={activeToolNames}
            gateRequest={activeGate?.request ?? null}
            pendingGateTotal={gatePagination.total}
            quietTailCount={quietTailCount}
            isCancelled={isCancelled}
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
          {activeGate && (
            <div className="w-full shrink-0 px-2 pb-2 animate-in fade-in-0 slide-in-from-bottom-2 duration-150 motion-reduce:animate-none">
              <ApprovalSection
                request={activeGate.request}
                onApprove={handleGateApprove}
                onDeny={handleGateDeny}
                onAnswer={handleGateAnswer}
                onCancel={handleGateCancel}
              />
            </div>
          )}

          {/* Composer:按会话重挂载(key),草稿输入/引用派生自当前会话 draft */}
          <ChatInput
            key={`${activeSessionId ?? 'none'}#${composerNonce}`}
            onSend={handleSendMessage}
            onStop={handleStopGeneration}
            isStreaming={isStreaming}
            settings={settings}
            onSelectModel={handleSelectModel}
            onChangeReasoningLevel={handleChangeReasoningLevel}
            refTabs={settings.includePageContext ? draft.refTabs : []}
            pickedElements={settings.includePageContext ? draft.pickedElements : []}
            onAddCurrentTab={handleAddCurrentTab}
            onAddRefTab={addRefTab}
            onRemoveRefTab={handleRemoveRefTab}
            onStartPickElement={handleStartPickElement}
            onRemovePickedElement={handleRemovePickedElement}
            onOpenSettings={handleOpenSettings}
            disabled={!activeModelInfo}
            initialInput={draft.input}
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
