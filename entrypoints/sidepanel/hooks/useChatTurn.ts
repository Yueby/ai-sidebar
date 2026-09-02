import { useCallback, useRef, useState } from 'react';
import type { ChatMessage, PageRefs, Session, SessionDraft, Settings } from '@/lib/types';
import { activeSessionIdItem, createSession, createUserMessage, titleFromText } from '@/lib/storage';
import { saveSession } from '@/lib/sessionStore';
import { findActiveModel, resolveReasoningLevel } from '@/lib/providers';
import { runAgentTurn } from '@/lib/agent';
import { getErrorMessage } from '@/lib/utils';
import { effectiveMessages } from '@/lib/contextTokens';
import { resolveElement, getActiveTabMeta, getTabMeta } from '@/lib/pageContext';
import { normalizePickedElements } from '@/lib/types';
import { useAppStore, selectCurrentSession } from '../store';
import { dropPendingDraftSave, EMPTY_DRAFT } from '../store/sessionSlice';

/**
 * 对话轮次域 hook(编排层):handleSendMessage(唯一发送入口)/handleStopGeneration。
 * turnSeqRef(R-1 身份守卫)/abortControllerRef/compactRequestedRef 留本 hook;
 * 流式状态/in-flight 在 store/chatSlice,门控与错误在 store 直读,会话经 getState() 取最新值。
 *
 * 域服务边界:store=共享状态唯一家(流式态/in-flight 在 chatSlice,activeGate 在 gateSlice);
 * 编排 hook=异步流程(runAgentTurn/saveSession 时序)+ ephemeral ref(turnSeqRef/abortControllerRef/
 * compactRequestedRef);派生值=消费点就地 useMemo。
 */
export function useChatTurn(params: {
  /** 上下文压缩进行中(压缩/发送互斥) */
  isCompacting: boolean;
  /** 轮末自主压缩触发(互斥守卫在 useCompact) */
  onAutoCompact: () => void;
  /** 首轮对话结束后自动 AI 命名回调(若未手动命名) */
  onAutoAiTitle?: (sessionId: string) => void;
}) {
  const { isCompacting, onAutoCompact, onAutoAiTitle } = params;

  // 门控/错误域:store 直读(一期收敛);isStreaming 参与守卫判定,需响应式订阅
  const isStreaming = useAppStore((s) => s.isStreaming);
  const hasPendingGate = useAppStore((s) => s.activeGate !== null);
  const dismissPendingGates = useAppStore((s) => s.dismissPendingGates);
  const resetResolvedGateCount = useAppStore((s) => s.resetResolvedGateCount);
  const setErrorMessage = useAppStore((s) => s.setErrorMessage);

  // turn 身份守卫:打断重发后旧 turn 的拆卸链与新 turn 并发,seq 不匹配者不得触碰共享状态
  const turnSeqRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  // 发送解析窗口守卫:resolveElement 期间(非流式)防双击双发
  const sendInFlightRef = useRef(false);
  // AI 自主压缩标记:compact_context 工具(A 道注册,safe)execute 只置位;轮末由本 hook 消费
  const compactRequestedRef = useRef(false);

  // AI Chat & Agent Loop
  const handleSendMessage = useCallback(
    async (userText: string) => {
      // resolve 解析窗口防双击:窗口内(非流式)的第二次点击静默忽略,
      // 避免 resolveElement 耗时期间双发(BYOK 双倍计费);流式中的打断重发不受影响
      if (sendInFlightRef.current) return;
      const store = useAppStore.getState();
      // 若当前正在流式/有 pending 门控/压缩中，按发送视为用户打断当前轮次
      if (isStreaming || hasPendingGate || isCompacting) {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
        dismissPendingGates();
      }

      const active = findActiveModel(store.settings);
      if (!active) {
        setErrorMessage('请先在设置中配置可用的 AI 提供商与模型');
        return;
      }

      let session = selectCurrentSession(store);
      let allSessions = [...store.sessions];

      if (!session) {
        session = createSession(titleFromText(userText));
        allSessions = [session, ...allSessions];
        useAppStore.getState().setActiveSessionId(session.id);
        await activeSessionIdItem.setValue(session.id);
      }

      const isFirstMessage = session.messages.length === 0 || session.title === '新会话';
      // 规则 3(定稿):发送瞬间把草稿引用做成 <page-refs> 块内嵌进 user 消息 content。
      // 逐 tab 刷新元信息(getTabMeta 失败回退草稿值,绝不丢引用);focused 仅标注
      // 「发送时刻活动且在该引用列表内」的 tab;无引用则消息与朴素文本逐字节一致。
      const draftAtSend = session.draft ?? EMPTY_DRAFT;
      const snapTabs = store.settings.includePageContext ? draftAtSend.refTabs : [];
      // B-1:存量草稿兼容(无 elementId 按数组序补齐),编号单源于数据侧
      const snapElements = store.settings.includePageContext
        ? normalizePickedElements(draftAtSend.pickedElements)
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
        // B-1:id = 数据侧 elementId(与 ChatInput 插入的 [element:N] 标记永久对齐)。
        // 请求时内容内嵌:并行解析每个元素的当前 outerHTML(resolveElement 与 read_element
        // 同源,content.ts 截 12000);失败 → 不设 content(请求展开时降级 preview),不阻塞发送。
        // 解析窗口置位守卫,完成后立即复位(此后由 isStreaming 接管)
        sendInFlightRef.current = true;
        const resolved = await Promise.all(
          snapElements.map(async (e) => {
            const el = await resolveElement(e.tabId, e.selector).catch(() => null);
            return { element: e, content: el?.html };
          }),
        );
        sendInFlightRef.current = false;
        const elements = resolved.map(({ element, content }) => ({
          id: element.elementId,
          tabId: element.tabId,
          selector: element.selector,
          tagName: element.tagName,
          preview: element.preview,
          ...(content ? { content } : {}),
        }));
        pageRefs = { tabs, elements };
      }
      const userMessage = createUserMessage(userText, pageRefs);
      const messagesWithUser: ChatMessage[] = [...session.messages, userMessage];

      // 先落盘用户消息,长对话中断也不丢;规则 4:发送即清空该会话草稿
      // (流式期间用户可继续为新消息添加引用,故清空在此刻完成而非转录落盘时)
      // 若该会话此前已手动重命名过(customTitle: true),则自动截断命名不覆盖其已有标题
      const nextTitle =
        session.customTitle
          ? session.title
          : isFirstMessage
            ? titleFromText(userText)
            : session.title;

      const updatedSession: Session = {
        ...session,
        title: nextTitle,
        messages: messagesWithUser,
        draft: { input: '', refTabs: [], pickedElements: [] },
        updatedAt: Date.now(),
      };
      const nextSessions = allSessions.map((s) => (s.id === session!.id ? updatedSession : s));
      useAppStore.getState().setSessions(nextSessions);
      // 该会话未落盘的草稿编辑已被「清空草稿」取代,丢弃待发项避免旧对象复活引用
      dropPendingDraftSave(session.id);
      await saveSession(updatedSession);

      // turn 身份守卫:自此新 turn 接管,旧 turn 拆卸链的 setInFlight(null)/落盘/finally 全部失效
      const seq = ++turnSeqRef.current;
      const { setIsStreaming, setStreamingContent, setStreamingThinking, setActiveToolNames, setIsCancelled, setInFlight } = useAppStore.getState();
      setIsStreaming(true);
      setStreamingContent('');
      setStreamingThinking('');
      setActiveToolNames([]);
      setIsCancelled(false);
      setErrorMessage(null);
      resetResolvedGateCount();
      // 新一轮运行:清空 in-flight 并声明归属会话
      setInFlight({ sessionId: session.id, messages: [] });

      const abortCtrl = new AbortController();
      abortControllerRef.current = abortCtrl;
      // AI 自主压缩标记(try 块内置位消费;finally 需访问,故提升到 try 外)
      let autoCompactPending = false;
      // 记录是否应在完成轮次后尝试一次静默自动 AI 命名(仅首轮对话且非手动命名)
      const shouldTriggerAutoAiTitle = isFirstMessage && !session.customTitle;

      try {
        const result = await runAgentTurn({
          provider: active.provider,
          modelId: active.model.id,
          // B-1:发送消费「生效历史」(压缩过 = [摘要]+之后),否则压缩对对话零效果;
          // messagesWithUser 预落盘保持全量(非破坏契约,见 finalize)
          history: effectiveMessages(session.messages, session.compaction),
          userMessage,
          // 实时引用(含 tabId)供本轮 read_page/read_element 工具用;
          // agent 侧再并入历史块,追问旧页面时句柄不丢
          refTabs: refreshedTabs,
          pickedElements: snapElements,
          thinkingLevel: resolveReasoningLevel(active.model, useAppStore.getState().settings.reasoningLevel),
          sessionId: session.id,
          signal: abortCtrl.signal,
          // compact_context 工具(A 道注册,safe)execute 只置标记;轮末由本 hook 消费
          onCompactContext: () => {
            compactRequestedRef.current = true;
          },
          onEvent: (event) => {
            if (event.type === 'message_update' && event.message.role === 'assistant') {
              // S-1:打断重发后,旧 turn 的 aborted partial 事件流必须静默——
              // 同会话守卫拦不住跨 turn,ghost 半截回答会悬空 + finalize 索引回移重挂载
              if (seq !== turnSeqRef.current) return;
              const { setStreamingContent: setStreamText, setStreamingThinking: setStreamThink } = useAppStore.getState();
              const text = event.message.content
                .filter((b) => b.type === 'text')
                .map((b) => b.text)
                .join('');
              const thinking = event.message.content
                .filter((b) => b.type === 'thinking')
                .map((b) => b.thinking)
                .join('');
              setStreamText(text);
              setStreamThink(thinking);
            } else if (event.type === 'message_end' && event.message.role === 'assistant') {
              // S-1:同上,旧 turn 的 message_end 不得进新 turn 的 in-flight
              if (seq !== turnSeqRef.current) return;
              // 一条 assistant 完成:整体进 in-flight(思考/toolCall/正文齐全),
              // 同一批 setState 里重置 live 流式态,准备承载下一 turn —— 交接无闪烁
              const done = event.message;
              useAppStore.getState().setInFlight((prev) =>
                prev && prev.sessionId === session!.id
                  ? { ...prev, messages: [...prev.messages, done as ChatMessage] }
                  : prev
              );
              const { setStreamingContent: setStreamText, setStreamingThinking: setStreamThink } = useAppStore.getState();
              setStreamText('');
              setStreamThink('');
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
        // R-1:已被新 turn 接管(打断重发)时,旧转录不落盘、不清理新 turn 的 in-flight;
        // S-3:被打断轮的压缩请求标记作废,不得在下一轮末触发付费压缩
        if (seq !== turnSeqRef.current) {
          compactRequestedRef.current = false;
          return;
        }
        // AI 自主压缩标记:本 turn 置位的消费归属本 turn(新 turn 的标记留给新 turn)
        autoCompactPending = compactRequestedRef.current;
        compactRequestedRef.current = false;
        const latest = useAppStore.getState().sessions.find((s) => s.id === session!.id);
        if (latest) {
          // B-1:非破坏落盘 = 全量历史 + 本轮新增(newMessages 基于「生效历史」,
          // 直接落 result.messages 会丢被压缩截断的前缀消息)
          const finalizedSession: Session = {
            ...latest,
            messages: [...session.messages, ...result.newMessages],
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
        } else {
          useAppStore.getState().setInFlight(null);
        }
        if (abortCtrl.signal.aborted) {
          useAppStore.getState().setIsCancelled(true);
        } else if (result.errorMessage) {
          setErrorMessage(result.errorMessage);
        }
      } catch (err: unknown) {
        // R-1:旧 turn 已被接管时不清理新 turn 的 in-flight;
        // S-3:出错轮的压缩请求标记作废
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
          setErrorMessage(getErrorMessage(err) || '请求失败，请检查网络或提供商配置');
        }
      } finally {
        // R-1:仅当前 turn 的所有者才能拆卸 streaming/abort 状态(不弄坏新 turn 的停止按钮)
        if (seq === turnSeqRef.current) {
          const teardown = useAppStore.getState();
          teardown.setIsStreaming(false);
          teardown.setActiveToolNames([]);
          abortControllerRef.current = null;
          // 轮末自主压缩:finally 清理完成后再触发(isStreaming 已复位,互斥守卫可通过);
          // setTimeout 0 = 完全脱离本链,handleCompact 的守卫与错误处理自洽
          if (autoCompactPending) {
            setTimeout(() => onAutoCompact(), 0);
          }
        }
      }
    },
    [
      isStreaming,
      hasPendingGate,
      isCompacting,
      dismissPendingGates,
      resetResolvedGateCount,
      setErrorMessage,
      onAutoCompact,
      onAutoAiTitle,
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
  };
}
