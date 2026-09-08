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

/**
 * 对话轮次域 hook(编排层):handleSendMessage(唯一发送入口)/handleStopGeneration/handleEditResend。
 * turnSeqRef(turn 身份守卫)/abortControllerRef/compactRequestedRef 留本 hook;
 * 流式状态/in-flight 在 store/chatSlice,门控与错误在 store 直读,会话经 getState() 取最新值。
 *
 * 域服务边界:store=共享状态唯一家(流式态/in-flight 在 chatSlice,activeGate 在 gateSlice);
 * 编排 hook=异步流程(runAgentTurn/saveSession 时序)+ ephemeral ref(turnSeqRef/abortControllerRef/
 * compactRequestedRef);派生值=消费点就地 useMemo。
 */
export function useChatTurn(params: {
  /** 上下文压缩进行中(压缩/发送互斥) */
  isCompacting: boolean;
  /** 轮末自主压缩触发(互斥守卫在 useCompact;后台轮传运行会话 id,压缩跟随归属) */
  onAutoCompact: (sessionId: string) => void;
  /** 首轮对话结束后自动 AI 命名回调(若未手动命名) */
  onAutoAiTitle?: (sessionId: string) => void;
  /** 轮次正常成功完成回调(非打断、非错误、无队列积压) */
  onTurnSuccess?: (sessionId: string, session: Session) => void;
}) {
  const { isCompacting, onAutoCompact, onAutoAiTitle, onTurnSuccess } = params;

  // 门控/错误域:store 直读(一期收敛);isStreaming 参与守卫判定,需响应式订阅
  const isStreaming = useAppStore((s) => s.isStreaming);
  const hasPendingGate = useAppStore((s) => s.activeGate !== null);
  const dismissPendingGates = useAppStore((s) => s.dismissPendingGates);
  const resetResolvedGateCount = useAppStore((s) => s.resetResolvedGateCount);
  const setErrorMessage = useAppStore((s) => s.setErrorMessage);

  // turn 身份守卫:打断重发后旧 turn 的拆卸链与新 turn 并发,seq 不匹配者不得触碰共享状态
  const turnSeqRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  // 流式增量节流:token 级 message_update 每次都全量渲染,长对话会卡;攒最新值定期冲刷,终值不丢
  const STREAM_FLUSH_INTERVAL_MS = 50;
  const streamThrottleRef = useRef<{ text: string; thinking: string; timer: ReturnType<typeof setTimeout> | null }>({
    text: '',
    thinking: '',
    timer: null,
  });
  // AI 自主压缩标记:compact_context 工具 execute 只置位;轮末由本 hook 消费
  const compactRequestedRef = useRef(false);

  // 引用稳定的 handleSendMessage 指针(避免循环依赖,供出队延后调用;可指定目标会话后台发送)
  const handleSendMessageRef = useRef<
    (text: string, targetSessionId?: string, frozen?: { refTabs: RefTab[]; pickedElements: PickedElement[] }) => Promise<void>
  >(async () => {});
  // 同步发送锁:busy 状态在首个 await 之后才置位,并发调用会双开 turn
  const sendingRef = useRef(false);

  // 检查并出队发送下一条排队消息(按条目归属会话后台发送,不切换当前视图)
  const checkAndDispatchQueue = useCallback(() => {
    const s = useAppStore.getState();
    if (s.queuedMessages.length === 0) return;
    // 若当前正在流式/门控挂起/压缩中，暂缓出队
    if (s.isStreaming || s.activeGate !== null || isCompacting) return;
    const next = s.dequeueMessage();
    if (next) {
      if (import.meta.env.DEV) {
        console.log(`[turn] dispatch queued message -> session ${next.sessionId}: "${next.text.slice(0, 30)}..."`);
      }
      void handleSendMessageRef.current(next.text, next.sessionId, {
        refTabs: next.refTabs ?? [],
        pickedElements: next.pickedElements ?? [],
      });
    }
  }, [isCompacting]);

  // 压缩结束后若有积压队列，自动尝试出队
  const prevCompactingRef = useRef(isCompacting);
  useEffect(() => {
    if (prevCompactingRef.current && !isCompacting) {
      setTimeout(() => {
        checkAndDispatchQueue();
      }, 0);
    }
    prevCompactingRef.current = isCompacting;
  }, [isCompacting, checkAndDispatchQueue]);

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

      // turn 身份守卫:自此新 turn 接管,旧 turn 拆卸链的 setInFlight(null)/落盘/finally 全部失效
      const seq = ++turnSeqRef.current;
      const { setIsStreaming, setStreamingContent, setStreamingThinking, setActiveToolNames, setIsCancelled, setInFlight } = useAppStore.getState();
      setIsStreaming(true);
      useAppStore.getState().setRunningSessionId(session.id);
      setStreamingContent('');
      setStreamingThinking('');
      setActiveToolNames([]);
      setIsCancelled(false);
      setErrorMessage(null);
      resetResolvedGateCount();
      // 上一轮遗留的节流定时器作废(终值已随 message_end 物化或被轮末清空)
      if (streamThrottleRef.current.timer) clearTimeout(streamThrottleRef.current.timer);
      streamThrottleRef.current = { text: '', thinking: '', timer: null };
      // 新一轮运行:清空 in-flight 并声明归属会话
      setInFlight({ sessionId: session.id, messages: [] });

      const abortCtrl = new AbortController();
      abortControllerRef.current = abortCtrl;
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
          // 实时引用(含 tabId)供本轮 read_page/read_element 工具用;
          // agent 侧再并入历史块,追问旧页面时句柄不丢
          refTabs,
          pickedElements,
          thinkingLevel: resolveReasoningLevel(active.model, useAppStore.getState().settings.reasoningLevel),
          // AI 生成内容语言(设置全局语言;null = 跟随用户消息语言)
          language: useAppStore.getState().settings.language,
          // 用户自定义规则(启用中的常驻注入 system prompt)
          rules: useAppStore.getState().settings.rules,
          // 用户自定义系统提示词(常驻注入)
          systemPrompt: useAppStore.getState().settings.systemPrompt,
          sessionId: session.id,
          signal: abortCtrl.signal,
          // search_web 工具注册配置:设置里配置了可用搜索源才下发
          webSearch: useAppStore.getState().settings.webSearch,
          // compact_context 工具 execute 只置标记;轮末由本 hook 消费
          onCompactContext: () => {
            compactRequestedRef.current = true;
          },
          onEvent: (event) => {
            if (event.type === 'message_update' && event.message.role === 'assistant') {
              // 打断重发后,旧 turn 的 aborted partial 事件流必须静默——
              // 同会话守卫拦不住跨 turn,ghost 半截回答会悬空 + finalize 索引回移重挂载
              if (seq !== turnSeqRef.current) return;
              const text = event.message.content
                .filter((b) => b.type === 'text')
                .map((b) => b.text)
                .join('');
              const thinking = event.message.content
                .filter((b) => b.type === 'thinking')
                .map((b) => b.thinking)
                .join('');
              // 攒最新值,定期冲刷(token 级增量直推 store 会让长对话全列表重绘卡顿)
              const st = streamThrottleRef.current;
              st.text = text;
              st.thinking = thinking;
              if (!st.timer) {
                st.timer = setTimeout(() => {
                  st.timer = null;
                  const { setStreamingContent: setStreamText, setStreamingThinking: setStreamThink } = useAppStore.getState();
                  setStreamText(st.text);
                  setStreamThink(st.thinking);
                }, STREAM_FLUSH_INTERVAL_MS);
              }
            } else if (event.type === 'message_end' && event.message.role === 'assistant') {
              // 同上,旧 turn 的 message_end 不得进新 turn 的 in-flight
              if (seq !== turnSeqRef.current) return;
              if (import.meta.env.DEV) {
                const prevLen = useAppStore.getState().inFlight?.messages.length ?? -1;
                console.log(`[turn] msg_end assistant: inFlight ${prevLen}->+1 (seq ${seq})`);
              }
              // 一条 assistant 完成:整体进 in-flight(思考/toolCall/正文齐全),
              // 同一批 setState 里重置 live 流式态,准备承载下一 turn —— 交接无闪烁
              const done = event.message;
              useAppStore.getState().setInFlight((prev) =>
                prev && prev.sessionId === session.id
                  ? { ...prev, messages: [...prev.messages, done as ChatMessage] }
                  : prev
              );
              if (streamThrottleRef.current.timer) clearTimeout(streamThrottleRef.current.timer);
              streamThrottleRef.current = { text: '', thinking: '', timer: null };
              const { setStreamingContent: setStreamText, setStreamingThinking: setStreamThink } = useAppStore.getState();
              setStreamText('');
              setStreamThink('');
            } else if (event.type === 'message_end' && event.message.role === 'toolResult') {
              // 工具结果即时入 in-flight:工具卡立刻显示返回结果,不等整轮结束
              // (转录落盘时同一消息对象引用已在 in-flight 中,零重挂载)
              if (seq !== turnSeqRef.current) return;
              if (import.meta.env.DEV) {
                console.log(
                  `[turn] msg_end toolResult: inFlight ${useAppStore.getState().inFlight?.messages.length ?? '?'}->+1 (seq ${seq})`,
                );
              }
              const done = event.message;
              useAppStore.getState().setInFlight((prev) =>
                prev && prev.sessionId === session.id
                  ? { ...prev, messages: [...prev.messages, done as ChatMessage] }
                  : prev
              );
            } else if (event.type === 'tool_execution_start') {
              useAppStore.getState().setActiveToolNames((prev) =>
                prev.includes(event.toolName) ? prev : [...prev, event.toolName]
              );
            } else if (event.type === 'tool_execution_end') {
              useAppStore.getState().setActiveToolNames((prev) => prev.filter((n) => n !== event.toolName));
            }
          },
        });

        // 用完整转录落盘(含 assistant/toolResult,回放零转换;user 消息带 refSnapshot)。
        // 基于该会话的「最新」内存副本:流式期间用户可能已在草稿中添加新引用,不能覆盖。
        // 若会话已被删除(流式中途删掉当前会话),不复活,丢弃本轮转录。
        // 已被新 turn 接管(打断重发)时,旧转录不落盘、不清理新 turn 的 in-flight;
        // 被打断轮的压缩请求标记作废,不得在下一轮末触发付费压缩
        if (seq !== turnSeqRef.current) {
          compactRequestedRef.current = false;
          return;
        }
        // AI 自主压缩标记:本 turn 置位的消费归属本 turn(新 turn 的标记留给新 turn)
        autoCompactPending = compactRequestedRef.current;
        compactRequestedRef.current = false;
        const latest = useAppStore.getState().sessions.find((s) => s.id === session.id);
        if (import.meta.env.DEV) {
          console.log(
            `[turn] finalize: latest msgs=${latest?.messages.length ?? '?'} result.newMessages=${result.newMessages.length} stopReason=${result.errorMessage ? 'error' : 'ok'} inFlight=${JSON.stringify(useAppStore.getState().inFlight?.messages.length ?? null)}`,
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
          dropPendingDraftSave(finalizedSession.id);
          useAppStore.getState().setSessions(
            useAppStore.getState().sessions.map((s) =>
              s.id === finalizedSession.id ? finalizedSession : s
            )
          );
          // 完整转录已含 in-flight 各条 assistant → 同批清空 inFlight,避免重复渲染闪烁
          useAppStore.getState().setInFlight(null);
          await saveSession(finalizedSession);

          // 首轮对话成功完成:尝试静默自动 AI 命名一次(若失败则保持目前的截断标题)
          if (shouldTriggerAutoAiTitle && onAutoAiTitle && !abortCtrl.signal.aborted && !result.errorMessage) {
            setTimeout(() => {
              onAutoAiTitle(finalizedSession.id);
            }, 100);
          }

          // 轮次成功完成且无打断、无错误、无排队积压: 触发跟进建议生成
          const hasQueue = useAppStore.getState().queuedMessages.length > 0;
          if (!abortCtrl.signal.aborted && !result.errorMessage && !hasQueue && onTurnSuccess) {
            setTimeout(() => {
              onTurnSuccess(finalizedSession.id, finalizedSession);
            }, 50);
          }
        } else {
          useAppStore.getState().setInFlight(null);
        }
        if (abortCtrl.signal.aborted) {
          useAppStore.getState().setIsCancelled(true);
        } else if (result.errorMessage) {
          // 后台会话错误归属该会话(App 按当前视图分流: here 弹横幅 toast,否则后台提醒)
          setErrorMessage(result.errorMessage, session.id);
        }
      } catch (err: unknown) {
        // 旧 turn 已被接管时不清理新 turn 的 in-flight;
        // 出错轮的压缩请求标记作废
        if (seq !== turnSeqRef.current) {
          compactRequestedRef.current = false;
          return;
        }
        autoCompactPending = false;
        // 异常路径不落盘转录,in-flight 无处可归 → 清空避免残留悬空气泡
        useAppStore.getState().setInFlight(null);
        if (abortCtrl.signal.aborted) {
          useAppStore.getState().setIsCancelled(true);
        } else {
          setErrorMessage(getErrorMessage(err) || '请求失败，请检查网络或提供商配置', session.id);
        }
      } finally {
        // 仅当前 turn 的所有者才能拆卸 streaming/abort 状态(不弄坏新 turn 的停止按钮)
        if (seq === turnSeqRef.current) {
          const teardown = useAppStore.getState();
          teardown.setIsStreaming(false);
          teardown.setRunningSessionId(null);
          teardown.setActiveToolNames([]);
          abortControllerRef.current = null;
          // 残余节流定时器作废(避免旧轮终值写进新轮的流式态)
          if (streamThrottleRef.current.timer) clearTimeout(streamThrottleRef.current.timer);
          streamThrottleRef.current = { text: '', thinking: '', timer: null };
          // 轮末自主压缩:finally 清理完成后再触发(isStreaming 已复位,互斥守卫可通过);
          // setTimeout 0 = 完全脱离本链,handleCompact 的守卫与错误处理自洽
          if (autoCompactPending) {
            setTimeout(() => onAutoCompact(session.id), 0);
          } else {
            // 出队时机: 轮次彻底结束后且无自动压缩，延迟一拍出队下一条排队消息
            setTimeout(() => {
              checkAndDispatchQueue();
            }, 0);
          }
        }
      }
    },
    [onAutoCompact, onAutoAiTitle, onTurnSuccess, resetResolvedGateCount, setErrorMessage, checkAndDispatchQueue]
  );

  // AI Chat & Agent Loop (新消息发送入口;targetSessionId = 跨会话队列出队的归属会话,
  // 后台发送不切换当前视图)
  const handleSendMessage = useCallback(
    async (
      userText: string,
      targetSessionId?: string,
      frozen?: { refTabs: RefTab[]; pickedElements: PickedElement[] },
    ) => {
      const trimmed = userText.trim();
      if (!trimmed) return;

      const store = useAppStore.getState();

      // 1. 繁忙(流式/门控/压缩)或发送竞态 = 入队(不打断;停止按钮 Square 是唯一打断入口)。
      // 条目归属目标会话并冻结引用快照:后台轮末自动发往归属会话,与当前视图/后续草稿编辑无关
      if (store.isStreaming || store.activeGate !== null || isCompacting || sendingRef.current) {
        const owner = targetSessionId ?? store.activeSessionId;
        if (!owner) return;
        const ownerSession = store.sessions.find((s) => s.id === owner);
        const draftAtEnqueue = ownerSession?.draft ?? EMPTY_DRAFT;
        // 冻结副本:frozen(出队重入)优先,否则快照入队时刻的草稿引用;此后用户编辑不影响该条目
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
        if (import.meta.env.DEV) {
          console.log(`[turn] enqueue message -> session ${owner}: "${trimmed.slice(0, 30)}..."`);
        }
        return;
      }

      sendingRef.current = true;
      try {
      if (import.meta.env.DEV) {
        console.log(
          `[turn] handleSendMessage enter: inFlight=${JSON.stringify(store.inFlight?.messages.length ?? null)} activeId=${store.activeSessionId}`,
        );
      }

      const active = findActiveModel(store.settings);
      if (!active) {
        setErrorMessage('请先在设置中配置可用的 AI 提供商与模型');
        return;
      }

      // 目标会话:显式指定(跨会话队列出队)优先,否则当前活跃会话(无会话则新建)
      let session = targetSessionId
        ? store.sessions.find((s) => s.id === targetSessionId)
        : selectCurrentSession(store);
      if (!session) {
        if (targetSessionId) {
          // 排队目标会话已被删除:丢弃该条目并继续调度后续队列(不让队列停摆)
          if (import.meta.env.DEV) {
            console.log(`[turn] queued target session ${targetSessionId} was deleted; drop`);
          }
          setTimeout(() => checkAndDispatchQueue(), 0);
          return;
        }
        session = createSession(titleFromText(trimmed));
        useAppStore.getState().setActiveSessionId(session.id);
        await activeSessionIdItem.setValue(session.id);
      }

      const isFirstMessage = session.messages.length === 0 || session.title === '新会话';
      // 发送瞬间把草稿引用做成 <page-refs> 块内嵌进 user 消息 content。
      // 逐 tab 刷新元信息(getTabMeta 失败回退草稿值,绝不丢引用);focused 仅标注
      // 「发送时刻活动且在该引用列表内」的 tab,由 usePageContextRefs 的「当前页」动态芯片随焦点
      // 自动维护(用户可移除;移除后面板级不再自动引用该 tab)。focused 标注发送时刻的活动 tab。
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
          snapTabs.map(async (t) => (await getTabMeta(t.id).catch(() => null)) ?? t)
        );
        const tabs = refreshedTabs.map((t) => ({
          tabId: t.id,
          title: t.title,
          url: t.url,
          ...(t.id === focusedTabId ? { focused: true } : {}),
        }));
        // id = 数据侧 elementId(与 ChatInput 插入的 [element:N] 标记永久对齐)。
        // 元素内容不随消息携带:模型按 refs 块内 tabId+selector 调 read_element 获取;
        // preview 保持框选时的 100 字存量(仅 UI chip label 用)
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

      // 先落盘用户消息,长对话中断也不丢;规则 4:发送即清空该会话草稿
      // (流式期间用户可继续为新消息添加引用,故清空在此刻完成而非转录落盘时)
      // 若该会话此前已手动重命名过(customTitle: true),则自动截断命名不覆盖其已有标题
      const nextTitle =
        session.customTitle
          ? session.title
          : isFirstMessage
            ? titleFromText(trimmed)
            : session.title;

      // 提交基于「最新」目标会话(await 期间用户可能已切回编辑草稿):只覆盖消息与必要字段
      const base = useAppStore.getState().sessions.find((s) => s.id === session!.id) ?? session;
      const updatedSession: Session = {
        ...base,
        title: nextTitle,
        messages: messagesWithUser,
        // 发送后保留 refTabs:会话的引用上下文跨消息存活(决策 13 修订;参考 google/llm-sidebar-with-context 的 pin 模型);
        // 输入与框选元素照常清空(元素是一次性指代,持续重发是噪音)。
        // frozen(队列出队)= 用户后来编辑的草稿必须原样保留
        draft: frozen
          ? (base.draft ?? EMPTY_DRAFT)
          : { input: '', refTabs: base.draft?.refTabs ?? [], pickedElements: [] },
        updatedAt: Date.now(),
      };
      // 原子 upsert:新建会话不在列表时插入(只 map 会丢掉刚创建的首轮会话)
      const currentSessions = useAppStore.getState().sessions;
      const nextSessions = currentSessions.some((s) => s.id === session!.id)
        ? currentSessions.map((s) => (s.id === session!.id ? updatedSession : s))
        : [updatedSession, ...currentSessions];
      useAppStore.getState().setSessions(nextSessions);
      // 非 frozen:草稿已被发送语义取代,丢弃待发项避免旧对象复活引用;
      // frozen(队列出队):用户后续草稿必须保留,不得冲销
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
        sendingRef.current = false;
      }
    },
    [
      isCompacting,
      setErrorMessage,
      executeTurn,
      checkAndDispatchQueue,
    ]
  );

  handleSendMessageRef.current = handleSendMessage;

  // 编辑历史用户消息并重发:截断目标消息后的全部内容,保留原引用,重新触发生成
  const handleEditResend = useCallback(
    async (messageTimestamp: number, newText: string) => {
      const trimmed = newText.trim();
      if (!trimmed) return;

      // 双保险守卫:编辑重发仅允许在非流式、非门控、非压缩时触发
      if (isStreaming || hasPendingGate || isCompacting) {
        return;
      }

      if (import.meta.env.DEV) {
        console.log(
          `[turn] handleEditResend enter: ts=${messageTimestamp} text="${trimmed.slice(0, 30)}..."`,
        );
      }

      const store = useAppStore.getState();
      const active = findActiveModel(store.settings);
      if (!active) {
        setErrorMessage('请先在设置中配置可用的 AI 提供商与模型');
        return;
      }

      const session = selectCurrentSession(store);
      if (!session) return;

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

      // 5. 压缩标记处理: 若 summaryTimestamp >= 截断点 (即摘要在被截断区域内) → 清空 compaction
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

      const nextSessions = store.sessions.map((s) => (s.id === session.id ? updatedSession : s));
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
          refreshedTabs.map(async (t) => (await getTabMeta(t.id).catch(() => null)) ?? t)
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
    },
    [
      isStreaming,
      hasPendingGate,
      isCompacting,
      setErrorMessage,
      executeTurn,
    ]
  );

  // Stop generation: 中止流式请求并冲销 pending 门控
  const handleStopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    useAppStore.getState().dismissPendingGates();
  }, []);

  return {
    handleSendMessage,
    handleStopGeneration,
    handleEditResend,
  };
}
