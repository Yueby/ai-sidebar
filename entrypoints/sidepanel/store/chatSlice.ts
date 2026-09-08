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

/** 排队消息:归属目标会话(会话自身忙时才入队,该会话空闲即出队);
 *  id 供 UI 稳定删除;refs/elements 为入队时刻快照(出队不读后续被改动的草稿) */
export interface QueuedMessage {
  id: string;
  sessionId: string;
  text: string;
  refTabs: RefTab[];
  pickedElements: PickedElement[];
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
  /** 删除指定会话的排队条目(会话删除时) */
  removeQueuedMessagesForSession: (sessionId: string) => void;
}

type SliceSet = (
  partial: Partial<ChatSlice> | ((state: ChatSlice) => Partial<ChatSlice>),
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
    removeQueuedMessagesForSession: (sessionId) =>
      set((s) => ({
        queuedMessages: (s.queuedMessages ?? []).filter((q) => q.sessionId !== sessionId),
      })),
  };
}
