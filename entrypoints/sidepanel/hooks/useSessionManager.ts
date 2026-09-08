import { useCallback, useEffect, useRef, useState } from 'react';
import { createModels, type AssistantMessage, type Context, type SimpleStreamOptions } from '@earendil-works/pi-ai';
import type { Session, SessionDraft, Settings } from '@/lib/types';
import { settingsItem, activeSessionIdItem, sanitizeSettings, createSession } from '@/lib/storage';
import { migrateLegacySessions, saveSession, deleteSession } from '@/lib/sessionStore';
import { resolveAuxModel } from '@/lib/providers';
import { resolveAiLanguage } from '@/lib/language';
import { buildProvider } from '@/lib/agent';
import { useAppStore } from '../store';
import { flushDraftSaves, dropPendingDraftSave } from '../store/sessionSlice';

/** AI 标题生成 System Prompt (Model-facing 英文规范;语言由设置注入) */
const TITLE_GENERATION_SYSTEM_PROMPT = (language: string) => `You are a concise title generator. Generate a very short title (max 20 characters) for a conversation based on the user's initial messages and assistant's response.
Write the title in ${language}. Output ONLY the plain text title, no quotes, no markdown, no punctuation at the end.`;

/**
 * 轻量生成会话短标题(AI 命名)
 * thinking off, maxTokens 32, 失败抛出由调用方捕获兜底
 */
async function generateTitleWithAi(
  settings: Settings,
  messages: Session['messages'],
  signal?: AbortSignal,
): Promise<string> {
  const active = resolveAuxModel(settings, settings.titleModel);
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
    systemPrompt: TITLE_GENERATION_SYSTEM_PROMPT(resolveAiLanguage(settings.language)),
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
    // 辅助任务思考等级:off = 不发 reasoning 参数(pi-ai 语义 = 关闭/模型默认)
    reasoning: settings.titleThinking === 'off' ? undefined : settings.titleThinking,
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

/**
 * 会话域 hook(编排层):会话增删切/AI 命名/重命名 + 原子 init effect
 * (storage 读取+迁移+watch 注册时序原样保留,watch 回调接 store action)。
 * 注:新会话不再预填当前页——每次发送时聚焦 tab 由 useChatTurn 注入 refs 块(决策 13 修订),
 * 引用栏仅承载用户主动策展的持久引用。
 * sessions/activeSessionId/loaded 状态与草稿防抖队列在 store/sessionSlice。
 *
 * 域服务边界:store=共享状态唯一家(sessions/activeSessionId/loaded 在 sessionSlice,
 * 防抖队列为模块级变量);编排 hook=异步流程(saveSession/deleteSession 时序)+ ephemeral ref
 * (titlingSessionIdsRef);派生值=消费点就地 useMemo/selectCurrentSession。
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
        // 首个会话 = 新会话(当前页由发送时聚焦注入承载,决策 13 修订)
        const newSess = createSession('新会话');
        initialSessions = [newSess];
        initialActiveId = newSess.id;
        await saveSession(newSess);
        await activeSessionIdItem.setValue(initialActiveId);
      } else if (!initialActiveId || !initialSessions.some((s) => s.id === initialActiveId)) {
        initialActiveId = initialSessions[0]!.id;
        await activeSessionIdItem.setValue(initialActiveId);
      }

      // 启动时活动会话仍为空:不再预填当前页(当前页由发送时聚焦注入承载,决策 13 修订)
      const initialActive = initialSessions.find((s) => s.id === initialActiveId);

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
      // 会话隔离:切换仅切换视图。后台运行/门控/队列按会话归属继续,不冲销不清空
      const leaving = leavingId
        ? sessions.find((s) => s.id === leavingId) ?? null
        : null;
      // 回收空会话仅当它没有任何后台遗留(队列/运行/门控);否则切走会杀掉其排队消息
      const st = useAppStore.getState();
      const recycle =
        !!leaving &&
        leaving.messages.length === 0 &&
        !st.queuedMessages.some((q) => q.sessionId === leaving.id) &&
        !st.runs[leaving.id] &&
        !st.preparingSessionIds.includes(leaving.id) &&
        !st.gates[leaving.id];
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
      // 不再清空错误:错误按归属分流(App),后台错误需在切回时仍可见
    },
    [resetGates, setErrorMessage, setActiveSessionId, setSessions]
  );

  const handleNewSession = useCallback(async () => {
    // 规则 2:当前会话已是空的 → 直接复用不叠加
    const { sessions, activeSessionId } = useAppStore.getState();
    const cur = activeSessionId
      ? sessions.find((s) => s.id === activeSessionId) ?? null
      : null;
    // 复用仅当空会话且无后台遗留(排队/运行/门控);否则新建,不把用户留在有任务的会话
    const st0 = useAppStore.getState();
    const idleEmpty =
      !!cur &&
      cur.messages.length === 0 &&
      !st0.queuedMessages.some((q) => q.sessionId === cur.id) &&
      !st0.runs[cur.id] &&
      !st0.preparingSessionIds.includes(cur.id) &&
      !st0.gates[cur.id];
    if (idleEmpty) {
      setErrorMessage(null);
      return;
    }
    // 会话隔离:新建仅新增视图,后台门控/队列按会话归属保留
    flushDraftSaves();
    // 删空后自动补一个新会话(当前页由发送时聚焦注入承载)
    const newSess = createSession('新会话');
    const next = [newSess, ...useAppStore.getState().sessions];
    setSessions(next);
    setActiveSessionId(newSess.id);
    await saveSession(newSess);
    await activeSessionIdItem.setValue(newSess.id);
  }, [setActiveSessionId, setSessions]);

  const handleDeleteSession = useCallback(
    async (id: string) => {
      // 被删会话的遗留物按归属清理:其排队条目;其挂起门控(无论是否当前视图)冲销
      useAppStore.getState().removeQueuedMessagesForSession(id);
      if (useAppStore.getState().gates[id]) {
        resetGates(id);
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
          // 删空后自动补一个新会话(当前页由发送时聚焦注入承载)
          const fresh = createSession('新会话');
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
