import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createModels, type AssistantMessage, type Context, type SimpleStreamOptions } from '@earendil-works/pi-ai';
import type { Session, SessionDraft, Settings } from '@/lib/types';
import { settingsItem, activeSessionIdItem, sanitizeSettings, createSession } from '@/lib/storage';
import { migrateLegacySessions, saveSession, deleteSession } from '@/lib/sessionStore';
import { getActiveTabMeta } from '@/lib/pageContext';
import { findActiveModel } from '@/lib/providers';
import { buildProvider } from '@/lib/agent';

/** 空草稿(每次新建对象,避免共享可变引用) */
export const cloneEmptyDraft = (): SessionDraft => ({ input: '', refTabs: [], pickedElements: [] });
export const EMPTY_DRAFT: SessionDraft = { input: '', refTabs: [], pickedElements: [] };

/** 草稿持久化防抖窗口(ms):逐键输入只进内存,合并写 IndexedDB */
const DRAFT_SAVE_DEBOUNCE_MS = 400;

/** AI 标题生成 System Prompt (Model-facing 英文规范) */
const TITLE_GENERATION_SYSTEM_PROMPT = `You are a concise title generator. Generate a very short title (max 20 characters) for a conversation based on the user's initial messages and assistant's response.
Match the language of the conversation. Output ONLY the plain text title, no quotes, no markdown, no punctuation at the end.`;

/**
 * 轻量生成会话短标题(AI 命名)
 * thinking off, maxTokens 32, 失败抛出由调用方捕获兜底
 */
async function generateTitleWithAi(
  settings: Settings,
  messages: Session['messages'],
  signal?: AbortSignal,
): Promise<string> {
  const active = findActiveModel(settings);
  if (!active) throw new Error('No active model');

  // 取前几条关键消息(用户与助手)做上下文
  const sample = messages.slice(0, 4).map((m) => {
    let text = '';
    if (typeof m.content === 'string') {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      text = m.content
        .filter((b) => b.type === 'text' && typeof (b as { text: string }).text === 'string')
        .map((b) => (b as { text: string }).text)
        .join('');
    }
    // 过滤 page-refs 等结构
    text = text.replace(/<page-refs>[\s\S]*?<\/page-refs>/g, '').trim();
    return `[${m.role}]: ${text.slice(0, 300)}`;
  }).filter((s) => s.length > 5).join('\n\n');

  if (!sample) throw new Error('No content to title');

  const models = createModels();
  models.setProvider(buildProvider(active.provider));
  const model = models.getModel(active.provider.id, active.model.id);
  if (!model) throw new Error(`Model ${active.model.id} not found`);

  const context: Context = {
    systemPrompt: TITLE_GENERATION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: `Conversation excerpt:\n${sample}\n\nTitle:` }],
        timestamp: Date.now(),
      },
    ],
  };

  const options: SimpleStreamOptions = {
    maxTokens: 32,
    signal,
    cacheRetention: 'none',
  };

  const response: AssistantMessage = await models.completeSimple(model, context, options);
  if (response.stopReason === 'error') {
    throw new Error(response.errorMessage || 'AI titling error');
  }

  const raw = (response.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('')
    .replace(/^["'“”‘’`\s]+|["'“”‘’`\s]+$/g, '')
    .split('\n')[0]
    ?.trim() ?? '';

  if (!raw) throw new Error('Empty AI title response');
  // 长度保证 ≤ 20 字符
  return raw.length > 20 ? `${raw.slice(0, 20)}…` : raw;
}

/** 新会话草稿预填(规则 1):includePageContext 开启时自动引用当前活动标签页 */
async function buildInitialDraft(includePageContext: boolean): Promise<SessionDraft | undefined> {
  if (!includePageContext) return undefined;
  const meta = await getActiveTabMeta().catch(() => null);
  return meta ? { input: '', refTabs: [meta], pickedElements: [] } : undefined;
}

/**
 * 会话域 hook:sessions/activeSessionId/loaded 状态、原子初始化(storage 读取 + 迁移 +
 * settings 初值/watch 由本 effect 一并完成)、IndexedDB 持久化、会话增删切与命名。
 * 同时持有草稿持久化核心(commitSessions/patchActiveDraft/防抖队列)——草稿即 Session.draft,
 * 存储在会话对象上,故归会话域;其他域经参数消费,不建 Context。
 */
export function useSessionManager(params: {
  /** init effect 内写入 settings 初值与 watch(App 持有 settings state) */
  setSettings: (s: Settings) => void;
  settingsRef: React.RefObject<Settings>;
  /** 会话切换/新建/删除时冲销门控(门控域提供) */
  resetGates: () => void;
  /** 会话切换/新建时清错误(对话域提供) */
  clearErrorMessage: () => void;
}) {
  const { setSettings, settingsRef, resetGates, clearErrorMessage } = params;

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // 正在进行 AI 命名的会话 ID 集合(防并发重入与 UI loading 态)
  const [titlingSessionIds, setTitlingSessionIds] = useState<Set<string>>(new Set());

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const titlingSessionIdsRef = useRef(titlingSessionIds);
  titlingSessionIdsRef.current = titlingSessionIds;

  // Initialize and subscribe to Storage(原子 init:settings 初值/watch + 会话迁移/预填)
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
  }, [setSettings]);

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

  /** 手动重命名会话(标记 customTitle: true, 以后绝不被自动/AI 命名覆盖) */
  const handleRenameSession = useCallback(
    async (id: string, newTitle: string) => {
      const trimmed = newTitle.trim();
      if (!trimmed) return;
      const prev = sessionsRef.current;
      const idx = prev.findIndex((s) => s.id === id);
      if (idx < 0) return;
      const session = prev[idx]!;
      if (session.title === trimmed && session.customTitle) return;

      const updated: Session = {
        ...session,
        title: trimmed,
        customTitle: true,
        updatedAt: Date.now(),
      };
      const next = [...prev];
      next[idx] = updated;
      sessionsRef.current = next;
      setSessions(next);
      await saveSession(updated);
    },
    []
  );

  /** 手动触发或自动触发 AI 命名 */
  const handleAiTitleSession = useCallback(
    async (id: string, isAuto = false) => {
      const session = sessionsRef.current.find((s) => s.id === id);
      if (!session) return;
      // 若已手动命名过，AI 命名不执行
      if (session.customTitle) return;
      // 避免并发重入
      if (titlingSessionIdsRef.current.has(id)) return;

      // 仅当会话中有消息时才生成
      if (session.messages.length === 0) return;

      // 登记 loading 态
      setTitlingSessionIds((prev) => new Set(prev).add(id));

      try {
        const title = await generateTitleWithAi(settingsRef.current, session.messages);
        // 生成成功，更新会话标题(不标记 customTitle，方便后续再次 AI 命名，但已脱离默认状态)
        const currentList = sessionsRef.current;
        const targetIdx = currentList.findIndex((s) => s.id === id);
        if (targetIdx >= 0) {
          const currentTarget = currentList[targetIdx]!;
          // 若在生成期间用户进行了手动重命名，则不覆盖
          if (currentTarget.customTitle) return;

          const updated: Session = {
            ...currentTarget,
            title,
            updatedAt: Date.now(),
          };
          const next = [...currentList];
          next[targetIdx] = updated;
          sessionsRef.current = next;
          setSessions(next);
          await saveSession(updated);
        }
      } catch (err) {
        // AI 命名失败静默降级，如果是手动点击则保留原标题；自动命名已有截断兜底
        console.warn('AI titling failed, skipping or fallback retained:', err);
      } finally {
        setTitlingSessionIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [settingsRef]
  );

  // 会话切换时冲销未处理门控请求并重置门控统计
  const handleSelectSession = useCallback(
    async (id: string) => {
      const leavingId = activeSessionIdRef.current;
      if (leavingId === id) return;
      // 切换会话冲销所有 pending 门控(安全拒绝)
      resetGates();
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
      clearErrorMessage();
    },
    [flushDraftSaves, resetGates, clearErrorMessage]
  );

  const handleNewSession = useCallback(async () => {
    // 规则 2:当前会话已是空的 → 直接复用不叠加
    const cur = activeSessionIdRef.current
      ? sessionsRef.current.find((s) => s.id === activeSessionIdRef.current) ?? null
      : null;
    if (cur && cur.messages.length === 0) {
      clearErrorMessage();
      return;
    }
    // 新建会话冲销所有 pending 门控
    resetGates();
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
    clearErrorMessage();
  }, [flushDraftSaves, resetGates, clearErrorMessage, settingsRef]);

  const handleDeleteSession = useCallback(
    async (id: string) => {
      // 若删除当前会话，冲销 pending 门控
      if (activeSessionIdRef.current === id) {
        resetGates();
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
    [flushDraftSaves, resetGates, settingsRef]
  );

  return {
    loaded,
    sessions,
    activeSessionId,
    setActiveSessionId,
    setSessions,
    currentSession,
    sessionsRef,
    activeSessionIdRef,
    draft,
    draftRef,
    pendingDraftSavesRef,
    flushDraftSaves,
    commitSessions,
    patchActiveDraft,
    handleSelectSession,
    handleNewSession,
    handleDeleteSession,
    handleRenameSession,
    handleAiTitleSession,
    titlingSessionIds,
  };
}
