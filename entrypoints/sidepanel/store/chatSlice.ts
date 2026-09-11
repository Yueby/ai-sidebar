import type { ChatMessage, PickedElement } from '@/lib/types';
import type { RefTab } from '@/lib/pageContext';

/**
 * 单个会话的运行态(存在 key = 该会话有活动 run)。
 * 由 SessionRuntime(lib/sessionRuntime.ts)通过状态出口同步而来,本 slice 仅作渲染镜像。
 */
export interface SessionRun {
  /** 流式正文(节流冲刷) */
  content: string;
  /** 流式思考 */
  thinking: string;
  /** 正在执行的工具名 */
  toolNames: string[];
  /** 用户取消标记 */
  cancelled: boolean;
  /** 已 message_end 但尚未落盘的 in-flight 消息(渲染尾部 + finalize 落盘) */
  inFlight: ChatMessage[];
}

/** 排队消息镜像:归属目标会话 + 展示文本;`message` 为入 Agent 原生队列的同一对象引用,
 *  被消费(message_end)时按身份移除。本 slice 仅作 UI 镜像,不参与发送(执行器 = Agent 队列)。 */
export interface QueuedMessage {
  id: string;
  sessionId: string;
  text: string;
  /** 入队时构造的完整 user 消息(含 refs 块;与 Agent 队列同一引用) */
  message?: ChatMessage;
  /** 兑底路径(Agent 不存在的理论情形)携带的 refs 快照 */
  refTabs?: RefTab[];
  pickedElements?: PickedElement[];
}

export interface ChatSlice {
  /** 会话运行态渲染镜像(真源在 SessionRuntime;按 sessionId 隔离) */
  runs: Record<string, SessionRun>;
  /** 发送准备中会话(首个 await 到落盘之间;空会话回收需避让,否则刚发的话被回收) */
  preparingSessionIds: string[];
  /** 压缩目标会话(全局单例压缩;store 真值供跨 hook 的忙判定,不受 React 闭包滞后影响) */
  compactingSessionId: string | null;
  /** 消息队列:目标会话忙时排队的消息(仅内存,FIFO;按归属会话出队) */
  queuedMessages: QueuedMessage[];

  /** 由 SessionRuntime 状态出口同步渲染镜像(active=false 时移除该会话运行态) */
  syncRun: (sessionId: string, snapshot: SessionRun, active: boolean) => void;
  setPreparing: (sessionId: string, preparing: boolean) => void;
  setCompactingSession: (sessionId: string | null) => void;

  enqueueMessage: (item: QueuedMessage) => void;
  removeQueuedMessage: (id: string) => void;
  /** 按对象身份移除镜像条目(Agent 消费该条时由事件钩子调用) */
  removeQueuedMessageByMessage: (message: ChatMessage) => void;
  /** 删除指定会话的排队条目(会话删除时) */
  removeQueuedMessagesForSession: (sessionId: string) => void;
}

// 诊断需要读跨切片字段(如 sessions):ChatSlice 自身不含 sessions,故显式声明所需视图
type SliceState = ChatSlice & { sessions: { id: string; messages: unknown[] }[] };
type SliceSet = (
  partial: Partial<ChatSlice> | ((state: SliceState) => Partial<ChatSlice>),
) => void;

export function createChatSlice(set: SliceSet): ChatSlice {
  return {
    runs: {},
    preparingSessionIds: [],
    compactingSessionId: null,
    queuedMessages: [],

    syncRun: (sessionId, snapshot, active) =>
      set((s) => {
        if (!active) {
          if (!(sessionId in s.runs)) return s;
          if (import.meta.env?.DEV) {
            // P0 诊断:run 结束会删除 run 条目(live 与 in-flight 同时消失)。正常顺序是
            // finalize 先落盘、再清空、最后删条目——所以此刻 store 应当已有本轮消息;
            // 这里把条数打出来,若为 0 才是“整轮消失”的真凭证(旧版无条件打警告,真出事时被淹掉)。
            const stored = s.sessions.find((x) => x.id === sessionId)?.messages.length ?? 0;
            console.info(`[p0:run] runs[${sessionId}] removed after run end (store msgs=${stored})`);
          }
          const next = { ...s.runs };
          delete next[sessionId];
          return { runs: next };
        }
        return { runs: { ...s.runs, [sessionId]: snapshot } };
      }),
    setPreparing: (sessionId, preparing) =>
      set((s) => ({
        preparingSessionIds: preparing
          ? s.preparingSessionIds.includes(sessionId)
            ? s.preparingSessionIds
            : [...s.preparingSessionIds, sessionId]
          : s.preparingSessionIds.filter((id) => id !== sessionId),
      })),

    setCompactingSession: (sessionId) => set({ compactingSessionId: sessionId }),

    enqueueMessage: (item) => set((s) => ({ queuedMessages: [...(s.queuedMessages ?? []), item] })),
    removeQueuedMessage: (id) =>
      set((s) => ({ queuedMessages: (s.queuedMessages ?? []).filter((q) => q.id !== id) })),
    removeQueuedMessageByMessage: (message) =>
      set((s) => ({
        queuedMessages: (s.queuedMessages ?? []).filter((q) => q.message !== message),
      })),
    removeQueuedMessagesForSession: (sessionId) =>
      set((s) => ({
        queuedMessages: (s.queuedMessages ?? []).filter((q) => q.sessionId !== sessionId),
      })),
  };
}
