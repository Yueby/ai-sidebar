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
import { mergeTranscriptKeepingHistory } from '@/lib/sessionRecord';
import { findActiveModel, resolveReasoningLevel } from '@/lib/providers';
import { continueAgentTurn, hasSessionAgent, runAgentTurn, sessionAgentFor } from '@/lib/agent';
import { getErrorMessage } from '@/lib/utils';
import { i18n } from '#i18n';
import { effectiveMessages } from '@/lib/contextTokens';
import { getActiveTabMeta, getTabMeta, type RefTab } from '@/lib/pageContext';
import { parsePageRefs } from '@/lib/pageRefs';
import { clearLoadedSkills } from '@/lib/skillRuntime';
import { draftAfterSend } from '@/lib/refGroups';
import { activeRuntimeSessionIds, runtimeFor } from '@/lib/sessionRuntime';
import type { SessionRuntime } from '@/lib/sessionRuntime';
import { useAppStore, selectCurrentSession } from '../store';
import { dropPendingDraftSave, EMPTY_DRAFT } from '../store/sessionSlice';

/** 冻结的入队负载(队列出队重放用:不读会话后续被编辑的草稿) */
interface FrozenPayload {
  refTabs: RefTab[];
  pickedElements: PickedElement[];
}

/**
 * 落盘前的转录守卫(防“整轮回复被静默丢掉”):
 * finalize 以前无条件用 Agent 转录覆盖 store——一旦某条路径递过来较旧/较短的快照
 * (播种自旧 store 副本、dispose 后重建、编辑重发索引算错等),本轮乃至之前的回复就会凭空消失。
 * 上游除 reset() 外不缩转录(本仓零调用点),所以任何“变短”都是缺陷:不覆盖,仅追加缺失部分,
 * 并把现场信息抛到日志以便定位真正成因。
 */
function mergeFinalizedMessages(
  latest: Session,
  result: { messages: ChatMessage[]; newMessages: ChatMessage[] },
  site: string,
): ChatMessage[] {
  const { messages, shrank } = mergeTranscriptKeepingHistory(
    latest.messages,
    result.messages,
    result.newMessages,
  );
  if (shrank) {
    console.error(
      `[turn:${latest.id}] ${site}: Agent transcript shrank ` +
        `(${latest.messages.length} → ${result.messages.length}); kept existing and appended ` +
        `${messages.length - latest.messages.length} missing. Report this line — it identifies the bad seeding path.`,
    );
  }
  return messages;
}

/**
 * 异常/中止路径的转录保全。
 *
 * 旧行为是 catch 里直接 rt.clearInFlight(seq):整轮 Agent 转录(历史 + 本轮已完成的助手消息)
 * 被当垃圾丢掉,store 里只剩发送时写入的那条用户消息 —— 用户可见症状正是“AI 说着说着,
 * 这一阶段的回复全没了,只剩我刚发出去的用户消息”。Agent 自持转录即真相源,错误不是丢数据的理由。
 */
function persistTranscriptAfterFailure(sid: string, seq: number, rt: SessionRuntime): void {
  const latest = useAppStore.getState().sessions.find((s) => s.id === sid);
  const transcript = sessionAgentFor(sid)?.state.messages as ChatMessage[] | undefined;
  if (!latest || !transcript?.length) {
    // 拿不到转录(会话已被删/替换)时维持旧行为:清空 in-flight,避免悬空气泡
    rt.clearInFlight(seq);
    return;
  }
  const { messages, shrank } = mergeTranscriptKeepingHistory(latest.messages, transcript);
  if (shrank) {
    console.error(
      `[turn:${sid}] failure-finalize: Agent transcript shrank ` +
        `(${latest.messages.length} → ${transcript.length}); kept existing.`,
    );
  }
  const finalized: Session = { ...latest, messages, updatedAt: Date.now() };
  const latestDraft = useAppStore.getState().sessions.find((s) => s.id === sid)?.draft;
  if (latestDraft) finalized.draft = latestDraft;
  dropPendingDraftSave(sid);
  useAppStore.getState().setSessions(
    useAppStore.getState().sessions.map((s) => (s.id === sid ? finalized : s)),
  );
  rt.clearInFlight(seq);
  void persistFinalizedSession(finalized);
}

/**
 * 回合中途的落盘兜底(面板即将隐藏/关闭时由 App 调用)。
 *
 * 助手回复与工具结果在 finalize 前只存在于 Agent 转录(内存)，面板文档一旦被销毁
 * (关侧边栏 / Chrome 回收 / dev 重载)就丢掉整轮——重开后只剩发送时写入的那条用户消息。
 * 此处把进行中会话的转录按单调守卫规则补落盘;幂等,与 finalize 路径不冲突。
 */
export function flushActiveTranscripts(): void {
  // 只遍历“确有活动 run/发送准备”的会话:activeRuntimeSessionIds 读已有实例,
  // 不会为闲置会话凭空 new 出 runtime(本函数挂在面板隐藏的生命周期上,不该有副作用)。
  const activeIds = activeRuntimeSessionIds();
  if (activeIds.length === 0) return;
  const state = useAppStore.getState();
  const updated = new Map<string, Session>();
  for (const id of activeIds) {
    const session = state.sessions.find((s) => s.id === id);
    if (!session) continue;
    const transcript = sessionAgentFor(id)?.state.messages as ChatMessage[] | undefined;
    if (!transcript?.length) continue;
    const { messages } = mergeTranscriptKeepingHistory(session.messages, transcript);
    if (messages.length <= session.messages.length) continue;
    // 不改 updatedAt:这是一次保全写入,不是新的会话活动,不应把会话顶到列表最前
    updated.set(id, { ...session, messages });
  }
  if (updated.size === 0) return;
  useAppStore
    .getState()
    .setSessions(useAppStore.getState().sessions.map((s) => updated.get(s.id) ?? s));
  for (const session of updated.values()) void persistFinalizedSession(session);
  console.info(`[flush] 面板隐藏前补落盘 ${updated.size} 个进行中会话的转录`);
}

/**
 * 落盘已 finalize 的会话。失败不得伪装成“请求失败”:内存已有、IDB 未写时,
 * 用户重开面板就表现为“内容突然消失”。单独捕获并给出可行动的**持久化**告警,
 * 不把已成功的轮次误判为失败。
 */
async function persistFinalizedSession(finalized: Session): Promise<void> {
  try {
    await saveSession(finalized);
  } catch (err: unknown) {
    useAppStore.getState().setErrorMessage(
      `${i18n.t('app.persistFailed')}${getErrorMessage(err) ? `: ${getErrorMessage(err)}` : ''}`,
      finalized.id,
    );
  }
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
  /** 轮末自主压缩触发(按运行会话;返回 Promise 时队列在其结束后再调度) */
  onAutoCompact: (sessionId: string) => Promise<unknown> | void;
  /** 首轮对话结束后自动 AI 命名回调(若未手动命名) */
  onAutoAiTitle?: (sessionId: string) => void;
  /** 轮次正常成功完成回调(非打断、非错误、无本会话队列积压) */
  onTurnSuccess?: (sessionId: string, session: Session) => void;
}) {
  const { isCompacting, compactingSessionId, onAutoCompact, onAutoAiTitle, onTurnSuccess } = params;

  const setErrorMessage = useAppStore((s) => s.setErrorMessage);

  // per-session 运行状态全部移入 SessionRuntime(lib/sessionRuntime.ts,pi AgentSession 对齐):
  // turn 序号/在途请求/流式节流/压缩标记/发送锁/队列 由 runtime 按会话持有。
  // Agent 事件经常驻订阅(agent.ts setAgentEventSink)直接写入 runtime,本 hook 不再逐轮桥接。

  // 引用稳定的 handleSendMessage 指针(避免循环依赖,供出队延后调用;可指定目标会话后台发送)
  const handleSendMessageRef = useRef<
    (text: string, targetSessionId?: string, frozen?: FrozenPayload) => Promise<void>
  >(async () => {});

  /** 某会话当前是否忙(自身有 run/门控/准备中/压缩中) */
  const isSessionBusy = useCallback(
    (sessionId: string): boolean => {
      const s = useAppStore.getState();
      const rt = runtimeFor(sessionId);
      return (
        rt.isStreaming ||
        !!s.gates[sessionId] ||
        rt.isSending ||
        // store 真值(非闭包 props):压缩刚开始的一帧内也能正确判忙
        s.compactingSessionId === sessionId
      );
    },
    [],
  );

  // 出队/继续消费互相引用(dispatchQueueFor ↔ runContinueTurn):用 ref 解耦声明顺序
  const runContinueTurnRef = useRef<(sessionId: string) => void>(() => {});
  const dispatchQueueForRef = useRef<(sessionId: string) => void>(() => {});

  /** 出队指定会话的排队消息(该会话空闲时;不切换当前视图) */
  const dispatchQueueFor = useCallback(
    (sessionId: string) => {
      if (isSessionBusy(sessionId)) return;
      const s = useAppStore.getState();
      // 主路径:Agent 原生队列非空(入队即 followUp)→ 空闲窗口用 continue 消费。
      // Agent 自身在 run 内会自动消费 followUp,这里只负责“run 已结束但队列还有”的窗口。
      const agent = sessionAgentFor(sessionId);
      if (agent?.hasQueuedMessages()) {
        void runContinueTurnRef.current(sessionId);
        return;
      }
      // 降级条目兜底:无 Agent 时入队的镜像条目(message 为空)不在 Agent 队列里,
      // 以前会被永久滞留(注释声称的“等待重建后补发”并未实现)——现按冻结载荷重发。
      const mirror = s.queuedMessages.find((q) => q.sessionId === sessionId && !q.message);
      if (mirror) {
        s.removeQueuedMessage(mirror.id);
        void handleSendMessageRef.current(mirror.text, sessionId, {
          refTabs: mirror.refTabs ?? [],
          pickedElements: mirror.pickedElements ?? [],
        });
      }
      // 无队列也无降级条目:无事可做(store.queuedMessages 是展示镜像而非执行器)
    },
    [isSessionBusy],
  );
  dispatchQueueForRef.current = dispatchQueueFor;

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

  /**
   * 空闲窗口消费原生队列:Agent 已 idle 但 followUp 队列非空(压缩/门控结束后滞留)时,
   * 用 continueAgentTurn 启动一轮 run 把队列排空(与 executeTurn 同一套落盘/守卫时序)。
   */
  const runContinueTurn = useCallback(
    async (sid: string) => {
      const store = useAppStore.getState();
      const session = store.sessions.find((s) => s.id === sid);
      const active = findActiveModel(store.settings);
      const agent = sessionAgentFor(sid);
      if (!session || !active || !agent?.hasQueuedMessages()) return;

      const rt = runtimeFor(sid);
      let seq: number;
      let signal: AbortSignal;
      try {
        ({ seq, signal } = rt.beginRun());
      } catch {
        return;
      }
      useAppStore.getState().resetResolvedGateCount(sid);
      let autoCompactPending = false;
      try {
        const result = await continueAgentTurn({
          provider: active.provider,
          modelId: active.model.id,
          thinkingLevel: resolveReasoningLevel(active.model, useAppStore.getState().settings.reasoningLevel),
          language: useAppStore.getState().settings.language,
          rules: useAppStore.getState().settings.rules,
          systemPrompt: useAppStore.getState().settings.systemPrompt,
          sessionId: sid,
          signal,
          webSearch: useAppStore.getState().settings.webSearch,
          compaction: session.compaction,
          onCompactContext: () => rt.requestCompaction(seq),
        });
        if (!rt.isOwner(seq)) return;
        autoCompactPending = rt.consumeCompactionRequest();
        const latest = useAppStore.getState().sessions.find((s) => s.id === sid);
        if (latest) {
          const finalizedSession: Session = {
            ...latest,
            messages: mergeFinalizedMessages(latest, result, 'continue-finalize'),
            updatedAt: Date.now(),
          };
          const latestDraft = useAppStore.getState().sessions.find((s) => s.id === sid)?.draft;
          if (latestDraft) finalizedSession.draft = latestDraft;
          dropPendingDraftSave(sid);
          useAppStore.getState().setSessions(
            useAppStore.getState().sessions.map((s) => (s.id === sid ? finalizedSession : s)),
          );
          rt.clearInFlight(seq);
          await persistFinalizedSession(finalizedSession);
        } else {
          rt.clearInFlight(seq);
        }
        if (signal.aborted) {
          rt.markCancelled(seq);
        } else if (result.errorMessage) {
          setErrorMessage(result.errorMessage, sid);
        }
      } catch (err: unknown) {
        if (!rt.isOwner(seq)) return;
        autoCompactPending = false;
        // 异常同样不得丢本轮转录:以 Agent 转录落盘(旧行为直接清空 → 整轮回复消失)
        persistTranscriptAfterFailure(sid, seq, rt);
        if (signal.aborted) rt.markCancelled(seq);
        else setErrorMessage(getErrorMessage(err) || i18n.t('errors.requestFailed'), sid);
      } finally {
        if (rt.endRun(seq)) {
          if (autoCompactPending) {
            void Promise.resolve(onAutoCompact(sid)).finally(() => {
              setTimeout(() => dispatchQueueForRef.current(sid), 0);
            });
          } else {
            setTimeout(() => dispatchQueueForRef.current(sid), 0);
          }
        }
      }
    },
    [onAutoCompact, setErrorMessage],
  );
  runContinueTurnRef.current = runContinueTurn;

  // 共享转录执行内核:runAgentTurn 流式循环、事件透出、in-flight 物化、非破坏落盘与异常清理。
  // handleSendMessage 与 handleEditResend 共用本逻辑，保证 turn 身份守卫与时序一致。
  const executeTurn = useCallback(
    async (args: {
      session: Session;
      /** 覆盖 Agent 自持转录(可选):首次初始化 / 编辑重发截断 / 恢复导入 */
      replaceHistory?: ChatMessage[];
      userMessage: UserMessage;
      refTabs?: RefTab[];
      pickedElements?: PickedElement[];
      /** 压缩元数据:请求面裁剪(transformContext),转录本体不变 */
      compaction?: SessionCompaction;
      shouldTriggerAutoAiTitle: boolean;
      active: { provider: ProviderConfig; model: ModelConfig };
    }) => {
      const {
        session,
        replaceHistory,
        userMessage,
        refTabs,
        pickedElements,
        compaction,
        shouldTriggerAutoAiTitle,
        active,
      } = args;
      const sid = session.id;

      // turn 身份守卫(按会话,由 SessionRuntime 持有):自此新 turn 接管,同会话旧 turn 的拆卸链全部失效
      const rt = runtimeFor(sid);
      let seq: number;
      let signal: AbortSignal;
      try {
        ({ seq, signal } = rt.beginRun());
      } catch {
        // 同会话已有活动 run(调用方均有 busy 守卫,理论不可达):放弃本轮,不动他人状态
        return;
      }
      const st = useAppStore.getState();
      st.resetResolvedGateCount(sid);
      // 只清归属本会话或全局的错误;别的会话的错误保留(分流提醒仍在)
      const errOwner = useAppStore.getState().errorSessionId;
      if (errOwner === null || errOwner === sid) setErrorMessage(null);
      // AI 自主压缩标记(try 块内置位消费;finally 需访问,故提升到 try 外)
      let autoCompactPending = false;

      try {
        const result = await runAgentTurn({
          provider: active.provider,
          modelId: active.model.id,
          // 转录真源 = Agent 自持(见 lib/agent.ts ensureSessionAgent);
          // replaceHistory 仅覆盖(首次/编辑重发);压缩经 transformContext 裁剪请求面
          history: replaceHistory,
          compaction,
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
          signal,
          // search_web 工具注册配置:设置里配置了可用搜索源才下发
          webSearch: useAppStore.getState().settings.webSearch,
          // compact_context 工具 execute 只置标记;轮末由本 hook 消费
          onCompactContext: () => {
            // 同会话旧 run 无权置位新 run 的压缩请求(runtime.isOwner 校验)
            rt.requestCompaction(seq);
          },
        });

        // 用完整转录落盘(含 assistant/toolResult,回放零转换;user 消息带 refSnapshot)。
        // 基于该会话的「最新」内存副本:流式期间用户可能已在草稿中添加新引用,不能覆盖。
        // 若会话已被删除(流式中途删掉当前会话),不复活,丢弃本轮转录。
        if (!rt.isOwner(seq)) {
          // 旧 run 被同会话新 turn 接管:不得触碰新 run 的压缩标记/运行态
          return;
        }
        // AI 自主压缩标记:本 turn 置位的消费归属本 turn
        autoCompactPending = rt.consumeCompactionRequest();
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
            // Agent 自持转录 = 原始全量(含 refs 块与本轮全部消息);变短时走守卫,不丢已存消息
            messages: mergeFinalizedMessages(latest, result, 'turn-finalize'),
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
          rt.clearInFlight(seq);
          await persistFinalizedSession(finalizedSession);

          // 首轮对话成功完成:尝试静默自动 AI 命名一次(若失败则保持目前的截断标题)
          if (shouldTriggerAutoAiTitle && onAutoAiTitle && !signal.aborted && !result.errorMessage) {
            setTimeout(() => {
              onAutoAiTitle(finalizedSession.id);
            }, 100);
          }

          // 轮次成功完成且无打断、无错误、无本会话排队积压: 触发跟进建议生成
          const hasQueue = useAppStore
            .getState()
            .queuedMessages.some((q) => q.sessionId === finalizedSession.id);
          if (!signal.aborted && !result.errorMessage && !hasQueue && onTurnSuccess) {
            setTimeout(() => {
              onTurnSuccess(finalizedSession.id, finalizedSession);
            }, 50);
          }
        } else {
          rt.clearInFlight(seq);
        }
        if (signal.aborted) {
          rt.markCancelled(seq);
        } else if (result.errorMessage) {
          setErrorMessage(result.errorMessage, sid);
        }
      } catch (err: unknown) {
        if (!rt.isOwner(seq)) {
          return;
        }
        autoCompactPending = false;
        // 异常路径保全 Agent 已产出的转录:旧行为在此直接清空 in-flight、不落盘,
        // 于是“这一阶段的回复”整段消失、只剩发送时的用户消息。
        persistTranscriptAfterFailure(sid, seq, rt);
        if (signal.aborted) {
          rt.markCancelled(seq);
        } else {
          setErrorMessage(getErrorMessage(err) || i18n.t('errors.requestFailed'), sid);
        }
      } finally {
        // 仅当前 turn 的所有者才能拆卸本会话运行态(不弄坏同会话新 turn)
        if (rt.endRun(seq)) {
          // 轮末自主压缩:清理完成后再触发(endRun 已复位,互斥守卫可通过)
          if (autoCompactPending) {
            // 压缩尝试结束后必调度(宏任务:此时 handleSendMessage 的 send lock 已释放,
            // 否则补调度会被自己的锁挡住而永久停摆)
            void Promise.resolve(onAutoCompact(sid)).finally(() => {
              setTimeout(() => dispatchQueueFor(sid), 0);
            });
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
      if (isSessionBusy(target.id) || !runtimeFor(target.id).tryAcquireSendLock()) {
        const owner = target.id;
        const ownerSession = store.sessions.find((s) => s.id === owner);
        const draftAtEnqueue = ownerSession?.draft ?? EMPTY_DRAFT;
        // 构造完整 user 消息(含 refs 块,与直发同一表示)后入 Agent 原生队列:
        // run 内自动消费(followUp 在 agent 本要停止时轮询);run 已结束时由出队器 continue 消费
        const snapTabs = frozen
          ? frozen.refTabs
          : draftAtEnqueue.pageContextEnabled === false
            ? []
            : draftAtEnqueue.refTabs;
        const snapElements = frozen
          ? frozen.pickedElements
          : draftAtEnqueue.pageContextEnabled === false
            ? []
            : draftAtEnqueue.pickedElements;
        let queuedRefs: PageRefs | undefined;
        if (snapTabs.length > 0 || snapElements.length > 0) {
          const focusedTabId = (await getActiveTabMeta().catch(() => null))?.id;
          const refreshedTabs = await Promise.all(
            snapTabs.map(async (t) => (await getTabMeta(t.id).catch(() => null)) ?? t),
          );
          queuedRefs = {
            tabs: refreshedTabs.map((t) => ({
              tabId: t.id,
              title: t.title,
              url: t.url,
              ...(t.id === focusedTabId ? { focused: true } : {}),
            })),
            elements: snapElements.map((e) => ({
              id: e.elementId,
              tabId: e.tabId,
              selector: e.selector,
              tagName: e.tagName,
              preview: e.preview,
            })),
          };
        }
        const queuedMessage = createUserMessage(trimmed, queuedRefs);
        const queueId = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const ownerAgent = sessionAgentFor(owner);
        // 目标会话忙 ⇒ 其 Agent 必已存在(有 run/门控/压缩都源于先前的 turn);
        // 无实例属异常路径(恢复导入后挂起门控):降级入镜像等待 Agent 重建后由出队器补发,不丢消息
        if (ownerAgent) {
          ownerAgent.followUp(queuedMessage);
        }
        store.enqueueMessage({
          id: queueId,
          sessionId: owner,
          text: trimmed,
          message: ownerAgent ? queuedMessage : undefined,
          refTabs: [...snapTabs],
          pickedElements: [...snapElements],
        });
        if (import.meta.env.DEV && !ownerAgent) {
          console.warn(`[turn] busy enqueue without Agent instance (session ${owner}) — queued for re-dispatch`);
        }
        if (!frozen && owner === useAppStore.getState().activeSessionId) {
          // 元素引用随该条消息消费(与直发路径一致);refTabs 保留为会话上下文
          useAppStore.getState().patchActiveDraft((d) => ({ ...d, pickedElements: [] }));
        }
        if (import.meta.env.DEV) {
          console.log(`[turn] enqueue message -> session ${owner}: "${trimmed.slice(0, 30)}..."`);
        }
        return;
      }

      useAppStore.getState().setPreparing(target.id, true);
      try {
        // 仅当目标就是当前视图时才持久化 active id:storage watch 会广播回写入方自身,
        // 后台出队(切到别的会话时)写它会把用户视图拽到目标会话
        if (target.id === useAppStore.getState().activeSessionId) {
          await activeSessionIdItem.setValue(target.id);
        }
        if (import.meta.env.DEV) {
          console.log(
            `[turn] handleSendMessage enter: target=${target.id} activeId=${store.activeSessionId}`,
          );
        }

        const active = findActiveModel(store.settings);
        if (!active) {
          setErrorMessage(i18n.t('errors.noProvider'));
          // 保留该条(不逐条丢弃);模型配置恢复后由下一次轮末/手动发送重新触发调度
          return;
        }

        const session = target;
        // 默认标题来自 i18n(创建时写入),此处必须用同一来源比较——写死字面量会在非中文界面下失效。
        // 另兼容已落库的历史默认标题:标题是**持久化数据**,换语言后旧会话不应失配而漏掉自动命名。
        const DEFAULT_SESSION_TITLES = new Set([i18n.t('sessionTitle.default'), '新会话']);
        const isFirstMessage =
          session.messages.length === 0 || DEFAULT_SESSION_TITLES.has(session.title);
        // 发送瞬间把草稿引用做成 <page-refs> 块内嵌进 user 消息 content。
        // 逐 tab 刷新元信息(getTabMeta 失败回退草稿值,绝不丢引用);focused 标注发送时刻的活动 tab。
        const draftAtSend = session.draft ?? EMPTY_DRAFT;
        // frozen(跨会话队列出队)= 入队时刻的快照;否则取发送时会话草稿
        const snapTabs = frozen
          ? frozen.refTabs
          : draftAtSend.pageContextEnabled === false
            ? []
            : draftAtSend.refTabs;
        const snapElements = frozen
          ? frozen.pickedElements
          : draftAtSend.pageContextEnabled === false
            ? []
            : draftAtSend.pickedElements;
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
          // 保留 base.draft 的其余字段(refTabs 跨消息存活;pageContextEnabled = 本会话开关,
          // 不能因一次发送就复位成"开"——那会让"删掉最后一个引用 = 关闭本会话引用"失效)
          draft: frozen ? (base.draft ?? EMPTY_DRAFT) : draftAfterSend(base.draft ?? EMPTY_DRAFT),
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
          // 首次(尚无自持 Agent)以会话转录初始化;已有 Agent 则自持,不再每轮覆盖
          replaceHistory: hasSessionAgent(session.id) ? undefined : session.messages,
          userMessage,
          refTabs: refreshedTabs,
          pickedElements: snapElements,
          compaction: session.compaction,
          shouldTriggerAutoAiTitle: isFirstMessage && !session.customTitle,
          active,
        });
      } finally {
        runtimeFor(target.id).releaseSendLock();
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
        setErrorMessage(i18n.t('errors.noProvider'));
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

      if (!runtimeFor(session.id).tryAcquireSendLock()) return;
      useAppStore.getState().setPreparing(session.id, true);
      try {
        const nextSessions = useAppStore
          .getState()
          .sessions.map((s) => (s.id === session.id ? updatedSession : s));
        useAppStore.getState().setSessions(nextSessions);
        dropPendingDraftSave(session.id);
        // 转录被截断了:被截掉的工具结果可能带着技能正文,已载入记录随之作废 ——
        // 否则模型再调 read_skill 只会拿到 "already loaded",而上下文里已经没有任何指令
        clearLoadedSkills(session.id);
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
          // 覆盖前缀(不含新 userMessage):prompt 会追加它,避免重复;旧回复已丢弃
          replaceHistory: historyBeforeUser,
          userMessage,
          refTabs: refreshedTabs,
          pickedElements,
          compaction: updatedSession.compaction,
          shouldTriggerAutoAiTitle: isFirstUserMessage && !session.customTitle,
          active,
        });
      } finally {
        runtimeFor(session.id).releaseSendLock();
        useAppStore.getState().setPreparing(session.id, false);
      }
    },
    [executeTurn, isSessionBusy, setErrorMessage],
  );

  // Stop generation: 中止指定会话的在途请求并冲销其门控(缺省 = 当前活跃会话)
  const handleStopGeneration = useCallback((sessionId?: string) => {
    const sid = sessionId ?? useAppStore.getState().activeSessionId;
    if (!sid) return;
    runtimeFor(sid).abort();
    // Agent.abort() 不清队列:残留的 steering/followUp 会在下一次 run 的初始轮询/停止点
    // 被注入(陈旧乱序)——停止时一并清空并同步 UI 镜像
    sessionAgentFor(sid)?.clearAllQueues();
    useAppStore.getState().removeQueuedMessagesForSession(sid);
    useAppStore.getState().dismissPendingGates(sid);
  }, []);

  return {
    handleSendMessage,
    handleStopGeneration,
    handleEditResend,
  };
}
