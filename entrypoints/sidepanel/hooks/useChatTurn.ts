import { useCallback, useEffect, useRef } from 'react';
import type {
  ChatMessage,
  ModelConfig,
  PageRefs,
  PickedElement,
  ProviderConfig,
  Session,
  SessionCompaction,
  SessionDraft,
  Settings,
  UserMessage,
} from '@/lib/types';
import { activeSessionIdItem, createSession, createUserMessage, titleFromText } from '@/lib/storage';
import { saveSession } from '@/lib/sessionStore';
import { findActiveModel, resolveReasoningLevel } from '@/lib/providers';
import { runAgentTurn } from '@/lib/agent';
import { getErrorMessage } from '@/lib/utils';
import { effectiveMessages } from '@/lib/contextTokens';
import { getActiveTabMeta, getTabMeta, type RefTab } from '@/lib/pageContext';
import { parsePageRefs } from '@/lib/pageRefs';
import { useAppStore, selectCurrentSession } from '../store';
import { dropPendingDraftSave, EMPTY_DRAFT } from '../store/sessionSlice';

/** 冻结的入队负载(队列出队重放用:不读会话后续被编辑的草稿) */
interface FrozenPayload {
  refTabs: RefTab[];
  pickedElements: PickedElement[];
}

/**
 * 对话轮次域 hook(编排层):handleSendMessage(唯一发送入口)/handleStopGeneration/handleEditResend。
 *
 * 并发模型:每个会话独立运行(runs[sessionId]),turn 守卫/abort/节流/发送锁/压缩标记全部按会话隔离。
 * A 会话流式期间,B 会话发送**立即执行**,互不干扰;仅当目标会话自身忙时才入队(该会话轮末出队)。
 */
export function useChatTurn(params: {
  /** 压缩进行中(全局互斥:同一时刻至多一个压缩) */
  isCompacting: boolean;
  /** 压缩目标会话(压缩期间该会话不可发送;其他会话不受影响) */
  compactingSessionId?: string | null;
  /** 轮末自主压缩触发(按运行会话) */
  onAutoCompact: (sessionId: string) => void;
  /** 首轮对话结束后自动 AI 命名回调(若未手动命名) */
  onAutoAiTitle?: (sessionId: string) => void;
  /** 轮次正常成功完成回调(非打断、非错误、无本会话队列积压) */
  onTurnSuccess?: (sessionId: string, session: Session) => void;
}) {
  const { isCompacting, compactingSessionId, onAutoCompact, onAutoAiTitle, onTurnSuccess } = params;

  const setErrorMessage = useAppStore((s) => s.setErrorMessage);

  // ── per-session 临时状态(React ref,不入 store)──────────────────────────
  /** turn 身份守卫:同会话打断重发后旧 turn 的拆卸链失效(按会话独立) */
  const turnSeqRef = useRef<Record<string, number>>({});
  /** 各会话的在途请求(停止按钮按会话中止) */
  const abortControllersRef = useRef<Record<string, AbortController>>({});
  // 流式增量节流(token 级增量直推 store 会让长对话全列表重绘卡顿)
  const STREAM_FLUSH_INTERVAL_MS = 50;
  const streamThrottleRef = useRef<
    Record<string, { text: string; thinking: string; timer: ReturnType<typeof setTimeout> | null }>
  >({});
  /** AI 自主压缩标记(compact_context 工具置位;按会话,轮末消费) */
  const compactRequestedRef = useRef<Record<string, boolean>>({});
  /** 同步发送锁(按会话):busy 状态在首个 await 之后才置位,并发调用会双开 turn */
  const sendingRef = useRef<Set<string>>(new Set());

  // 引用稳定的 handleSendMessage 指针(避免循环依赖,供出队延后调用;可指定目标会话后台发送)
  const handleSendMessageRef = useRef<
    (text: string, targetSessionId?: string, frozen?: FrozenPayload) => Promise<void>
  >(async () => {});

  /** 某会话当前是否忙(自身有 run/门控/准备中/压缩中) */
  const isSessionBusy = useCallback(
    (sessionId: string): boolean => {
      const s = useAppStore.getState();
      return (
        !!s.runs[sessionId] ||
        !!s.gates[sessionId] ||
        sendingRef.current.has(sessionId) ||
        (isCompacting && compactingSessionId === sessionId)
      );
    },
    [isCompacting, compactingSessionId],
  );

  /** 出队指定会话的排队消息(该会话空闲时;不切换当前视图) */
  const dispatchQueueFor = useCallback(
    (sessionId: string) => {
      if (isSessionBusy(sessionId)) return;
      const s = useAppStore.getState();
      const item = s.queuedMessages.find((q) => q.sessionId === sessionId);
      if (!item) return;
      s.removeQueuedMessage(item.id);
      if (import.meta.env.DEV) {
        console.log(`[turn] dispatch queued message -> session ${sessionId}: "${item.text.slice(0, 30)}..."`);
      }
      void handleSendMessageRef.current(item.text, sessionId, {
        refTabs: item.refTabs ?? [],
        pickedElements: item.pickedElements ?? [],
      });
    },
    [isSessionBusy],
  );

  /** 压缩结束后补出队(压缩可能压住了该会话的排队消息)。
   *  注意:isCompacting 变 false 时 compactingSessionId 已被 useCompact 置 null,
   *  因此必须记住「上一个压缩 owner」。 */
  const prevCompactingRef = useRef<{ active: boolean; sessionId: string | null }>({
    active: isCompacting,
    sessionId: compactingSessionId ?? null,
  });
  useEffect(() => {
    const prev = prevCompactingRef.current;
    if (prev.active && !isCompacting && prev.sessionId) {
      const target = prev.sessionId;
      setTimeout(() => dispatchQueueFor(target), 0);
    }
    prevCompactingRef.current = { active: isCompacting, sessionId: compactingSessionId ?? null };
  }, [isCompacting, compactingSessionId, dispatchQueueFor]);

  // 共享转录执行内核:runAgentTurn 流式循环、事件透出、in-flight 物化、非破坏落盘与异常清理。
  // handleSendMessage 与 handleEditResend 共用本逻辑，保证 turn 身份守卫与时序一致。
  const executeTurn = useCallback(
    async (args: {
      session: Session;
      historyBeforeUser: ChatMessage[];
      userMessage: UserMessage;
      refTabs?: RefTab[];
      pickedElements?: PickedElement[];
      effectiveCompaction?: SessionCompaction;
      shouldTriggerAutoAiTitle: boolean;
      active: { provider: ProviderConfig; model: ModelConfig };
    }) => {
      const {
        session,
        historyBeforeUser,
        userMessage,
        refTabs,
        pickedElements,
        effectiveCompaction,
        shouldTriggerAutoAiTitle,
        active,
      } = args;
      const sid = session.id;

      // turn 身份守卫(按会话):自此新 turn 接管,同会话旧 turn 的拆卸链全部失效
      const seq = (turnSeqRef.current[sid] = (turnSeqRef.current[sid] ?? 0) + 1);
      const st = useAppStore.getState();
      st.startRun(sid);
      st.resetResolvedGateCount(sid);
      // 只清归属本会话或全局的错误;别的会话的错误保留(分流提醒仍在)
      const errOwner = useAppStore.getState().errorSessionId;
      if (errOwner === null || errOwner === sid) setErrorMessage(null);
      // 上一轮遗留的节流定时器作废(终值已随 message_end 物化或被轮末清空)
      const prevThrottle = streamThrottleRef.current[sid];
      if (prevThrottle?.timer) clearTimeout(prevThrottle.timer);
      streamThrottleRef.current[sid] = { text: '', thinking: '', timer: null };

      const abortCtrl = new AbortController();
      abortControllersRef.current[sid] = abortCtrl;
      // AI 自主压缩标记(try 块内置位消费;finally 需访问,故提升到 try 外)
      let autoCompactPending = false;

      try {
        const result = await runAgentTurn({
          provider: active.provider,
          modelId: active.model.id,
          // 发送消费「生效历史」(压缩过 = [摘要]+之后),否则压缩对对话零效果;
          // messagesWithUser 预落盘保持全量(非破坏契约,见 finalize)
          history: effectiveMessages(historyBeforeUser, effectiveCompaction),
          userMessage,
          // 实时引用(含 tabId)供本轮 read_page/read_element 工具用;agent 侧再并入历史块
          refTabs,
          pickedElements,
          thinkingLevel: resolveReasoningLevel(active.model, useAppStore.getState().settings.reasoningLevel),
          // AI 生成内容语言(设置全局语言;null = 跟随用户消息语言)
          language: useAppStore.getState().settings.language,
          // 用户自定义规则(启用中的常驻注入 system prompt)
          rules: useAppStore.getState().settings.rules,
          // 用户自定义系统提示词(常驻注入)
          systemPrompt: useAppStore.getState().settings.systemPrompt,
          sessionId: sid,
          signal: abortCtrl.signal,
          // search_web 工具注册配置:设置里配置了可用搜索源才下发
          webSearch: useAppStore.getState().settings.webSearch,
          // compact_context 工具 execute 只置标记;轮末由本 hook 消费
          onCompactContext: () => {
            // 同会话旧 run 无权置位新 run 的压缩请求
            if (seq !== turnSeqRef.current[sid]) return;
            compactRequestedRef.current[sid] = true;
          },
          onEvent: (event) => {
            if (event.type === 'message_update' && event.message.role === 'assistant') {
              // 同会话旧 turn(打断重发)的 aborted partial 事件流必须静默
              if (seq !== turnSeqRef.current[sid]) return;
              const text = event.message.content
                .filter((b) => b.type === 'text')
                .map((b) => b.text)
                .join('');
              const thinking = event.message.content
                .filter((b) => b.type === 'thinking')
                .map((b) => b.thinking)
                .join('');
              const th = streamThrottleRef.current[sid] ?? { text: '', thinking: '', timer: null };
              streamThrottleRef.current[sid] = th;
              th.text = text;
              th.thinking = thinking;
              if (!th.timer) {
                th.timer = setTimeout(() => {
                  th.timer = null;
                  // 旧 run 的迟到冲刷不得写新 run 的流式态
                  if (seq !== turnSeqRef.current[sid]) return;
                  useAppStore.getState().patchRun(sid, { content: th.text, thinking: th.thinking });
                }, STREAM_FLUSH_INTERVAL_MS);
              }
            } else if (event.type === 'message_end' && event.message.role === 'assistant') {
              if (seq !== turnSeqRef.current[sid]) return;
              if (import.meta.env.DEV) {
                const prevLen = useAppStore.getState().runs[sid]?.inFlight.length ?? -1;
                console.log(`[turn:${sid}] msg_end assistant: inFlight ${prevLen}->+1 (seq ${seq})`);
              }
              // 一条 assistant 完成:整体进 in-flight(思考/toolCall/正文齐全),
              // 同批重置 live 流式态,准备承载下一 turn —— 交接无闪烁
              useAppStore.getState().appendRunInFlight(sid, event.message as ChatMessage);
              const th = streamThrottleRef.current[sid];
              if (th?.timer) clearTimeout(th.timer);
              streamThrottleRef.current[sid] = { text: '', thinking: '', timer: null };
              useAppStore.getState().patchRun(sid, { content: '', thinking: '' });
            } else if (event.type === 'message_end' && event.message.role === 'toolResult') {
              // 工具结果即时入 in-flight:工具卡立刻显示返回结果,不等整轮结束
              if (seq !== turnSeqRef.current[sid]) return;
              useAppStore.getState().appendRunInFlight(sid, event.message as ChatMessage);
            } else if (event.type === 'tool_execution_start') {
              if (seq !== turnSeqRef.current[sid]) return;
              useAppStore.getState().addRunTool(sid, event.toolName);
            } else if (event.type === 'tool_execution_end') {
              if (seq !== turnSeqRef.current[sid]) return;
              useAppStore.getState().removeRunTool(sid, event.toolName);
            }
          },
        });

        // 用完整转录落盘(含 assistant/toolResult,回放零转换;user 消息带 refSnapshot)。
        // 基于该会话的「最新」内存副本:流式期间用户可能已在草稿中添加新引用,不能覆盖。
        // 若会话已被删除(流式中途删掉当前会话),不复活,丢弃本轮转录。
        if (seq !== turnSeqRef.current[sid]) {
          // 旧 run 被同会话新 turn 接管:不得触碰新 run 的压缩标记/运行态
          return;
        }
        // AI 自主压缩标记:本 turn 置位的消费归属本 turn
        autoCompactPending = compactRequestedRef.current[sid] === true;
        compactRequestedRef.current[sid] = false;
        const latest = useAppStore.getState().sessions.find((s) => s.id === sid);
        if (import.meta.env.DEV) {
          console.log(
            `[turn:${sid}] finalize: latest msgs=${latest?.messages.length ?? '?'} result.newMessages=${result.newMessages.length} stopReason=${result.errorMessage ? 'error' : 'ok'} inFlight=${useAppStore.getState().runs[sid]?.inFlight.length ?? null}`,
          );
        }
        if (latest) {
          // 非破坏落盘 = 全量历史 + 本轮新增(newMessages 基于「生效历史」,
          // 直接落 result.messages 会丢被压缩截断的前缀消息)
          const finalizedSession: Session = {
            ...latest,
            // 落盘用原始 userMessage(newMessages[0] 是 toLlmMessage 剥过
            // elements 的请求副本,泄入存储会丢 refs.elements——引用列表消失+白名单退化)
            messages: [...historyBeforeUser, userMessage, ...result.newMessages.slice(1)],
            updatedAt: Date.now(),
          };
          // 草稿以内存最新副本为准(后台出队落盘期间用户可能已在编辑该会话草稿)
          const latestDraft = useAppStore.getState().sessions.find((s) => s.id === sid)?.draft;
          if (latestDraft) finalizedSession.draft = latestDraft;
          dropPendingDraftSave(sid);
          useAppStore.getState().setSessions(
            useAppStore.getState().sessions.map((s) => (s.id === sid ? finalizedSession : s)),
          );
          // 完整转录已含 in-flight 各条 assistant → 同批清空该会话 inFlight,避免重复渲染闪烁
          useAppStore.getState().clearRunInFlight(sid);
          await saveSession(finalizedSession);

          // 首轮对话成功完成:尝试静默自动 AI 命名一次(若失败则保持目前的截断标题)
          if (shouldTriggerAutoAiTitle && onAutoAiTitle && !abortCtrl.signal.aborted && !result.errorMessage) {
            setTimeout(() => {
              onAutoAiTitle(finalizedSession.id);
            }, 100);
          }

          // 轮次成功完成且无打断、无错误、无本会话排队积压: 触发跟进建议生成
          const hasQueue = useAppStore
            .getState()
            .queuedMessages.some((q) => q.sessionId === finalizedSession.id);
          if (!abortCtrl.signal.aborted && !result.errorMessage && !hasQueue && onTurnSuccess) {
            setTimeout(() => {
              onTurnSuccess(finalizedSession.id, finalizedSession);
            }, 50);
          }
        } else {
          useAppStore.getState().clearRunInFlight(sid);
        }
        if (abortCtrl.signal.aborted) {
          useAppStore.getState().patchRun(sid, { cancelled: true });
        } else if (result.errorMessage) {
          setErrorMessage(result.errorMessage, sid);
        }
      } catch (err: unknown) {
        if (seq !== turnSeqRef.current[sid]) {
          return;
        }
        autoCompactPending = false;
        // 异常路径不落盘转录,in-flight 无处可归 → 清空避免残留悬空气泡
        useAppStore.getState().clearRunInFlight(sid);
        if (abortCtrl.signal.aborted) {
          useAppStore.getState().patchRun(sid, { cancelled: true });
        } else {
          setErrorMessage(getErrorMessage(err) || '请求失败，请检查网络或提供商配置', sid);
        }
      } finally {
        // 仅当前 turn 的所有者才能拆卸本会话运行态(不弄坏同会话新 turn)
        if (seq === turnSeqRef.current[sid]) {
          const teardown = useAppStore.getState();
          teardown.endRun(sid);
          delete abortControllersRef.current[sid];
          const th = streamThrottleRef.current[sid];
          if (th?.timer) clearTimeout(th.timer);
          delete streamThrottleRef.current[sid];
          // 轮末自主压缩:清理完成后再触发(endRun 已复位,互斥守卫可通过)
          if (autoCompactPending) {
            setTimeout(() => onAutoCompact(sid), 0);
          } else {
            // 出队时机:本会话轮次彻底结束后,尝试发送该会话排队中的下一条
            setTimeout(() => dispatchQueueFor(sid), 0);
          }
        }
      }
    },
    [dispatchQueueFor, onAutoCompact, onAutoAiTitle, onTurnSuccess, setErrorMessage],
  );

  // AI Chat & Agent Loop (新消息发送入口;targetSessionId = 跨会话队列出队的归属会话,
  // 后台发送不切换当前视图)
  const handleSendMessage = useCallback(
    async (userText: string, targetSessionId?: string, frozen?: FrozenPayload) => {
      const trimmed = userText.trim();
      if (!trimmed) return;

      const store = useAppStore.getState();

      // 0. 目标会话解析前移:显式指定(跨会话队列)优先;未指定且无活跃会话 → 同步创建并登记
      let target = targetSessionId
        ? store.sessions.find((s) => s.id === targetSessionId)
        : selectCurrentSession(store);
      if (!target && targetSessionId) {
        // 排队目标已被删除:丢弃该条目并继续调度该会话队列(不让队列停摆)
        if (import.meta.env.DEV) {
          console.log(`[turn] queued target session ${targetSessionId} was deleted; drop`);
        }
        setTimeout(() => dispatchQueueFor(targetSessionId), 0);
        return;
      }
      if (!target) {
        // 同步登记(渲染可见),持久化 activeSessionId 在领取执行权之后
        target = createSession(titleFromText(trimmed));
        useAppStore.getState().setSessions([target, ...useAppStore.getState().sessions]);
        useAppStore.getState().setActiveSessionId(target.id);
      }

      // 1. 目标会话自身忙(有 run/门控/准备中/压缩中)或发送竞态 = 入队。
      // 其他会话的 run 与本会话无关(并发隔离):B 在 A 流式期间发送会立即执行
      if (isSessionBusy(target.id) || sendingRef.current.has(target.id)) {
        const owner = target.id;
        const ownerSession = store.sessions.find((s) => s.id === owner);
        const draftAtEnqueue = ownerSession?.draft ?? EMPTY_DRAFT;
        // 冻结副本:frozen(出队重入)优先,否则快照入队时刻的草稿引用
        const frozenTabs = frozen
          ? [...frozen.refTabs]
          : store.settings.includePageContext
            ? [...draftAtEnqueue.refTabs]
            : [];
        const frozenElements = frozen
          ? [...frozen.pickedElements]
          : store.settings.includePageContext
            ? [...draftAtEnqueue.pickedElements]
            : [];
        store.enqueueMessage({
          id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          sessionId: owner,
          text: trimmed,
          refTabs: frozenTabs,
          pickedElements: frozenElements,
        });
        if (!frozen && owner === useAppStore.getState().activeSessionId) {
          // 元素引用随该条消息消费(与直发路径一致);refTabs 保留为会话上下文
          useAppStore.getState().patchActiveDraft((d) => ({ ...d, pickedElements: [] }));
        }
        if (import.meta.env.DEV) {
          console.log(`[turn] enqueue message -> session ${owner}: "${trimmed.slice(0, 30)}..."`);
        }
        return;
      }

      sendingRef.current.add(target.id);
      useAppStore.getState().setPreparing(target.id, true);
      try {
        await activeSessionIdItem.setValue(target.id);
        if (import.meta.env.DEV) {
          console.log(
            `[turn] handleSendMessage enter: target=${target.id} activeId=${store.activeSessionId}`,
          );
        }

        const active = findActiveModel(store.settings);
        if (!active) {
          setErrorMessage('请先在设置中配置可用的 AI 提供商与模型');
          setTimeout(() => dispatchQueueFor(target!.id), 0);
          return;
        }

        const session = target;
        const isFirstMessage = session.messages.length === 0 || session.title === '新会话';
        // 发送瞬间把草稿引用做成 <page-refs> 块内嵌进 user 消息 content。
        // 逐 tab 刷新元信息(getTabMeta 失败回退草稿值,绝不丢引用);focused 标注发送时刻的活动 tab。
        const draftAtSend = session.draft ?? EMPTY_DRAFT;
        // frozen(跨会话队列出队)= 入队时刻的快照;否则取发送时会话草稿
        const snapTabs = frozen
          ? frozen.refTabs
          : store.settings.includePageContext
            ? draftAtSend.refTabs
            : [];
        const snapElements = frozen
          ? frozen.pickedElements
          : store.settings.includePageContext
            ? draftAtSend.pickedElements
            : [];
        let refreshedTabs = snapTabs;
        let pageRefs: PageRefs | undefined;
        if (snapTabs.length > 0 || snapElements.length > 0) {
          const focusedTabId = (await getActiveTabMeta().catch(() => null))?.id;
          refreshedTabs = await Promise.all(
            snapTabs.map(async (t) => (await getTabMeta(t.id).catch(() => null)) ?? t),
          );
          const tabs = refreshedTabs.map((t) => ({
            tabId: t.id,
            title: t.title,
            url: t.url,
            ...(t.id === focusedTabId ? { focused: true } : {}),
          }));
          const elements = snapElements.map((e) => ({
            id: e.elementId,
            tabId: e.tabId,
            selector: e.selector,
            tagName: e.tagName,
            preview: e.preview,
          }));
          pageRefs = { tabs, elements };
        }
        const userMessage = createUserMessage(trimmed, pageRefs);
        const messagesWithUser: ChatMessage[] = [...session.messages, userMessage];

        // 先落盘用户消息,长对话中断也不丢;发送即清空该会话草稿
        const nextTitle =
          session.customTitle
            ? session.title
            : isFirstMessage
              ? titleFromText(trimmed)
              : session.title;

        // 提交基于「最新」目标会话(await 期间用户可能已切回编辑草稿):只覆盖消息与必要字段。
        // 目标在准备期间被删除 → 取消本轮,不复活(即使本轮刚创建)
        const latestTarget = useAppStore.getState().sessions.find((s) => s.id === session.id);
        if (!latestTarget) {
          setTimeout(() => dispatchQueueFor(session.id), 0);
          return;
        }
        const base = latestTarget;
        const updatedSession: Session = {
          ...base,
          title: nextTitle,
          messages: messagesWithUser,
          // 发送后保留 refTabs(决策 13 修订);frozen(队列出队)= 用户后来编辑的草稿原样保留
          draft: frozen
            ? (base.draft ?? EMPTY_DRAFT)
            : { input: '', refTabs: base.draft?.refTabs ?? [], pickedElements: [] },
          updatedAt: Date.now(),
        };
        // 原子 upsert:新建会话不在列表时插入(只 map 会丢掉刚创建的首轮会话)
        const currentSessions = useAppStore.getState().sessions;
        const nextSessions = currentSessions.some((s) => s.id === session.id)
          ? currentSessions.map((s) => (s.id === session.id ? updatedSession : s))
          : [updatedSession, ...currentSessions];
        useAppStore.getState().setSessions(nextSessions);
        if (!frozen) dropPendingDraftSave(session.id);
        await saveSession(updatedSession);

        await executeTurn({
          session: updatedSession,
          historyBeforeUser: session.messages,
          userMessage,
          refTabs: refreshedTabs,
          pickedElements: snapElements,
          effectiveCompaction: session.compaction,
          shouldTriggerAutoAiTitle: isFirstMessage && !session.customTitle,
          active,
        });
      } finally {
        sendingRef.current.delete(target.id);
        useAppStore.getState().setPreparing(target.id, false);
      }
    },
    [dispatchQueueFor, executeTurn, isSessionBusy, setErrorMessage],
  );

  handleSendMessageRef.current = handleSendMessage;

  // 编辑历史用户消息并重发:截断目标消息后的全部内容,保留原引用,重新触发生成
  const handleEditResend = useCallback(
    async (messageTimestamp: number, newText: string) => {
      const trimmed = newText.trim();
      if (!trimmed) return;

      const store = useAppStore.getState();
      const session = selectCurrentSession(store);
      if (!session) return;

      // 双保险守卫:该会话非流式/非门控/非压缩/无并发发送时才允许(与按钮使能一致)
      if (isSessionBusy(session.id)) {
        return;
      }

      if (import.meta.env.DEV) {
        console.log(
          `[turn] handleEditResend enter: ts=${messageTimestamp} text="${trimmed.slice(0, 30)}..."`,
        );
      }

      const active = findActiveModel(store.settings);
      if (!active) {
        setErrorMessage('请先在设置中配置可用的 AI 提供商与模型');
        return;
      }

      // 1. 定位目标用户消息
      const targetIndex = session.messages.findIndex(
        (m) => m.timestamp === messageTimestamp && m.role === 'user',
      );
      if (targetIndex === -1) return;
      const targetMessage = session.messages[targetIndex] as UserMessage;

      // 2. 从原 content 提取 refs 块 (lib/pageRefs parsePageRefs)
      const originalRefs = parsePageRefs(targetMessage.content);

      // 3. 重建用户消息 (引用保留, 时间戳更新为当前时刻)
      const userMessage = createUserMessage(trimmed, originalRefs ?? undefined);

      // 4. 截断: 保留该消息之前的所有历史, 丢弃该消息及之后的所有消息
      const historyBeforeUser = session.messages.slice(0, targetIndex);
      const truncatedMessages: ChatMessage[] = [...historyBeforeUser, userMessage];

      // 5. 压缩标记处理: 若摘要处在被截断区域内 → 清空 compaction
      const shouldKeepCompaction = Boolean(
        session.compaction &&
        session.compaction.summaryTimestamp < targetMessage.timestamp &&
        historyBeforeUser.some(
          (m) => m.role === 'user' && m.timestamp === session.compaction?.summaryTimestamp,
        ),
      );

      // 6. 标题更新: 若编辑的是首条用户消息且未手动命名, 更新标题
      const isFirstUserMessage = targetIndex === 0;
      const nextTitle =
        session.customTitle
          ? session.title
          : isFirstUserMessage
            ? titleFromText(trimmed)
            : session.title;

      const updatedSession: Session = {
        ...session,
        title: nextTitle,
        messages: truncatedMessages,
        updatedAt: Date.now(),
      };
      if (shouldKeepCompaction) {
        updatedSession.compaction = session.compaction;
      } else {
        delete updatedSession.compaction;
      }

      sendingRef.current.add(session.id);
      useAppStore.getState().setPreparing(session.id, true);
      try {
        const nextSessions = useAppStore
          .getState()
          .sessions.map((s) => (s.id === session.id ? updatedSession : s));
        useAppStore.getState().setSessions(nextSessions);
        dropPendingDraftSave(session.id);
        await saveSession(updatedSession);

        // 7. 转换原引用为 refTabs / pickedElements (若标签页存活则刷新实时元信息)
        let refreshedTabs: RefTab[] = (originalRefs?.tabs ?? []).map((t) => ({
          id: t.tabId,
          title: t.title,
          url: t.url,
        }));
        if (refreshedTabs.length > 0) {
          refreshedTabs = await Promise.all(
            refreshedTabs.map(async (t) => (await getTabMeta(t.id).catch(() => null)) ?? t),
          );
        }
        const pickedElements: PickedElement[] = (originalRefs?.elements ?? []).map((e) => ({
          id: `${e.tabId}:${e.selector}`,
          elementId: e.id,
          tabId: e.tabId,
          selector: e.selector,
          tagName: e.tagName,
          preview: e.preview,
        }));

        // 8. 触发重发链路
        await executeTurn({
          session: updatedSession,
          historyBeforeUser,
          userMessage,
          refTabs: refreshedTabs,
          pickedElements,
          effectiveCompaction: updatedSession.compaction,
          shouldTriggerAutoAiTitle: isFirstUserMessage && !session.customTitle,
          active,
        });
      } finally {
        sendingRef.current.delete(session.id);
        useAppStore.getState().setPreparing(session.id, false);
      }
    },
    [executeTurn, isSessionBusy, setErrorMessage],
  );

  // Stop generation: 中止指定会话的在途请求并冲销其门控(缺省 = 当前活跃会话)
  const handleStopGeneration = useCallback((sessionId?: string) => {
    const sid = sessionId ?? useAppStore.getState().activeSessionId;
    if (!sid) return;
    abortControllersRef.current[sid]?.abort();
    useAppStore.getState().dismissPendingGates(sid);
  }, []);

  return {
    handleSendMessage,
    handleStopGeneration,
    handleEditResend,
  };
}
