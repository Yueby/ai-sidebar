import { useCallback, useEffect, useRef, useState } from 'react';
import { createModels, type AssistantMessage, type Context, type SimpleStreamOptions } from '@earendil-works/pi-ai';
import type { Session, SessionDraft, Settings } from '@/lib/types';
import { settingsItem, activeSessionIdItem, sanitizeSettings, createSession } from '@/lib/storage';
import { migrateLegacySessions, saveSession, deleteSession } from '@/lib/sessionStore';
import { getActiveTabMeta } from '@/lib/pageContext';
import { findActiveModel } from '@/lib/providers';
import { buildProvider } from '@/lib/agent';
import { useAppStore } from '../store';
import { cloneEmptyDraft, flushDraftSaves, dropPendingDraftSave } from '../store/sessionSlice';

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
 * 会话域 hook(编排层):会话增删切/AI 命名/重命名 + 原子 init effect
 * (storage 读取+迁移+watch 注册时序原样保留,watch 回调接 store action)。
 * sessions/activeSessionId/loaded 状态与草稿防抖队列在 store/sessionSlice。
 */
export function useSessionManager() {
  const resetGates = useAppStore((s) => s.resetGates);
  const setErrorMessage = useAppStore((s) => s.setErrorMessage);
  const setSessions = useAppStore((s) => s.setSessions);
  const setActiveSessionId = useAppStore((s) => s.setActiveSessionId);
  const setLoaded = useAppStore((s) => s.setLoaded);
  const setSettings = useAppStore((s) => s.setSettings);

  // 正在进行 AI 命名的会话 ID 集合(防并发重入与 UI loading 态;hook 本地 UI 态)
  const [titlingSessionIds, setTitlingSessionIds] = useState<Set<string>>(new Set());
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
  }, [setSettings, setSessions, setActiveSessionId, setLoaded]);

  /** 手动重命名会话(标记 customTitle: true, 以后绝不被自动/AI 命名覆盖) */
  const handleRenameSession = useCallback(
    async (id: string, newTitle: string) => {
      const trimmed = newTitle.trim();
      if (!trimmed) return;
      const prev = useAppStore.getState().sessions;
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
      setSessions(next);
      await saveSession(updated);
    },
    [setSessions]
  );

  /** 手动触发或自动触发 AI 命名 */
  const handleAiTitleSession = useCallback(
    async (id: string, isAuto = false) => {
      void isAuto;
      const { sessions, settings } = useAppStore.getState();
      const session = sessions.find((s) => s.id === id);
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
        const title = await generateTitleWithAi(settings, session.messages);
        // 生成成功，更新会话标题(不标记 customTitle，方便后续再次 AI 命名，但已脱离默认状态)
        const currentList = useAppStore.getState().sessions;
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
    [setSessions]
  );

  // 会话切换时冲销未处理门控请求并重置门控统计
  const handleSelectSession = useCallback(
    async (id: string) => {
      const { sessions, activeSessionId: leavingId } = useAppStore.getState();
      if (leavingId === id) return;
      // 切换会话冲销所有 pending 门控(安全拒绝)
      resetGates();
      const leaving = leavingId
        ? sessions.find((s) => s.id === leavingId) ?? null
        : null;
      const recycle = !!leaving && leaving.messages.length === 0;
      // 回收前先摘除离开会话的待发草稿,避免 flush 把它写回后与 deleteSession 竞态复活
      if (recycle) dropPendingDraftSave(leaving!.id);
      // 其余会话的待落盘草稿立即写入(切换是自然 flush 边界)
      flushDraftSaves();
      if (recycle) {
        const remaining = useAppStore.getState().sessions.filter((s) => s.id !== leaving!.id);
        setSessions(remaining);
        await deleteSession(leaving!.id);
      }
      setActiveSessionId(id);
      await activeSessionIdItem.setValue(id);
      setErrorMessage(null);
    },
    [resetGates, setErrorMessage, setActiveSessionId, setSessions]
  );

  const handleNewSession = useCallback(async () => {
    // 规则 2:当前会话已是空的 → 直接复用不叠加
    const { sessions, activeSessionId } = useAppStore.getState();
    const cur = activeSessionId
      ? sessions.find((s) => s.id === activeSessionId) ?? null
      : null;
    if (cur && cur.messages.length === 0) {
      setErrorMessage(null);
      return;
    }
    // 新建会话冲销所有 pending 门控
    resetGates();
    flushDraftSaves();
    // 规则 1:新会话草稿预填当前活动页
    const newSess = createSession(
      '新会话',
      await buildInitialDraft(useAppStore.getState().settings.includePageContext)
    );
    const next = [newSess, ...useAppStore.getState().sessions];
    setSessions(next);
    setActiveSessionId(newSess.id);
    await saveSession(newSess);
    await activeSessionIdItem.setValue(newSess.id);
    setErrorMessage(null);
  }, [resetGates, setErrorMessage, setActiveSessionId, setSessions]);

  const handleDeleteSession = useCallback(
    async (id: string) => {
      // 若删除当前会话，冲销 pending 门控
      if (useAppStore.getState().activeSessionId === id) {
        resetGates();
      }
      // 防止被删会话的待发草稿在 flush 时复活它;删除是自然 flush 边界
      dropPendingDraftSave(id);
      flushDraftSaves();
      const remaining = useAppStore.getState().sessions.filter((s) => s.id !== id);
      let nextActiveId = useAppStore.getState().activeSessionId;

      if (nextActiveId === id) {
        if (remaining.length > 0) {
          nextActiveId = remaining[0]!.id;
        } else {
          // 删空后自动补一个新会话(规则 2),并按规则 1 预填当前活动页
          const fresh = createSession(
            '新会话',
            await buildInitialDraft(useAppStore.getState().settings.includePageContext)
          );
          remaining.push(fresh);
          nextActiveId = fresh.id;
          await saveSession(fresh);
        }
      }

      setSessions(remaining);
      setActiveSessionId(nextActiveId);
      await deleteSession(id);
      await activeSessionIdItem.setValue(nextActiveId);
    },
    [resetGates, setActiveSessionId, setSessions]
  );

  // 面板卸载(dev HMR/StrictMode)前把未落盘草稿立即写回;生产面板关闭为上下文销毁,此为 dev 数据安全保证
  useEffect(() => () => flushDraftSaves(), []);

  return {
    handleSelectSession,
    handleNewSession,
    handleDeleteSession,
    handleRenameSession,
    handleAiTitleSession,
    titlingSessionIds,
  };
}
