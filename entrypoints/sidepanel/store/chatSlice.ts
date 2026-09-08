import type { ChatMessage, PickedElement } from '@/lib/types';
import type { RefTab } from '@/lib/pageContext';

/**
 * 单个会话的运行态(存在 key = 该会话有活动 run)。
 * 多会话可并发运行,各自独立——切换会话/别的会话运行都不影响本会话的流式、工具与取消状态。
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
  /** 会话运行态(按 sessionId 隔离;多会话并发 run 互不干扰) */
  runs: Record<string, SessionRun>;
  /** 发送准备中会话(首个 await 到落盘之间;空会话回收需避让,否则刚发的话被回收) */
  preparingSessionIds: string[];
  /** 消息队列:目标会话忙时排队的消息(仅内存,FIFO;按归属会话出队) */
  queuedMessages: QueuedMessage[];

  startRun: (sessionId: string) => void;
  endRun: (sessionId: string) => void;
  /** 更新流式正文/思考/取消标记(工具名用 addRunTool/removeRunTool) */
  patchRun: (sessionId: string, patch: Partial<Pick<SessionRun, 'content' | 'thinking' | 'cancelled'>>) => void;
  addRunTool: (sessionId: string, toolName: string) => void;
  removeRunTool: (sessionId: string, toolName: string) => void;
  appendRunInFlight: (sessionId: string, message: ChatMessage) => void;
  clearRunInFlight: (sessionId: string) => void;
  setPreparing: (sessionId: string, preparing: boolean) => void;

  enqueueMessage: (item: QueuedMessage) => void;
  /** 取队首(全局 FIFO);出队方按 item.sessionId 调度 */
  dequeueMessage: () => QueuedMessage | undefined;
  removeQueuedMessage: (id: string) => void;
  /** 删除指定会话的排队条目(会话删除时) */
  removeQueuedMessagesForSession: (sessionId: string) => void;
  clearQueue: () => void;
}

type SliceSet = (
  partial: Partial<ChatSlice> | ((state: ChatSlice) => Partial<ChatSlice>),
) => void;

export function createChatSlice(set: SliceSet): ChatSlice {
  return {
    runs: {},
    preparingSessionIds: [],
    queuedMessages: [],

    startRun: (sessionId) =>
      set((s) => ({
        runs: {
          ...s.runs,
          [sessionId]: { content: '', thinking: '', toolNames: [], cancelled: false, inFlight: [] },
        },
      })),
    endRun: (sessionId) =>
      set((s) => {
        if (!(sessionId in s.runs)) return s;
        const next = { ...s.runs };
        delete next[sessionId];
        return { runs: next };
      }),
    patchRun: (sessionId, patch) =>
      set((s) => {
        const run = s.runs[sessionId];
        if (!run) return s;
        return { runs: { ...s.runs, [sessionId]: { ...run, ...patch } } };
      }),
    addRunTool: (sessionId, toolName) =>
      set((s) => {
        const run = s.runs[sessionId];
        if (!run || run.toolNames.includes(toolName)) return s;
        return { runs: { ...s.runs, [sessionId]: { ...run, toolNames: [...run.toolNames, toolName] } } };
      }),
    removeRunTool: (sessionId, toolName) =>
      set((s) => {
        const run = s.runs[sessionId];
        if (!run) return s;
        return {
          runs: {
            ...s.runs,
            [sessionId]: { ...run, toolNames: run.toolNames.filter((n) => n !== toolName) },
          },
        };
      }),
    appendRunInFlight: (sessionId, message) =>
      set((s) => {
        const run = s.runs[sessionId];
        if (!run) return s;
        return { runs: { ...s.runs, [sessionId]: { ...run, inFlight: [...run.inFlight, message] } } };
      }),
    clearRunInFlight: (sessionId) =>
      set((s) => {
        const run = s.runs[sessionId];
        if (!run) return s;
        return { runs: { ...s.runs, [sessionId]: { ...run, inFlight: [] } } };
      }),
    setPreparing: (sessionId, preparing) =>
      set((s) => ({
        preparingSessionIds: preparing
          ? s.preparingSessionIds.includes(sessionId)
            ? s.preparingSessionIds
            : [...s.preparingSessionIds, sessionId]
          : s.preparingSessionIds.filter((id) => id !== sessionId),
      })),

    enqueueMessage: (item) => set((s) => ({ queuedMessages: [...(s.queuedMessages ?? []), item] })),
    dequeueMessage: () => {
      let item: QueuedMessage | undefined;
      set((s) => {
        const queue = s.queuedMessages ?? [];
        if (queue.length === 0) return s;
        const [first, ...rest] = queue;
        item = first;
        return { queuedMessages: rest };
      });
      return item;
    },
    removeQueuedMessage: (id) =>
      set((s) => ({ queuedMessages: (s.queuedMessages ?? []).filter((q) => q.id !== id) })),
    removeQueuedMessagesForSession: (sessionId) =>
      set((s) => ({
        queuedMessages: (s.queuedMessages ?? []).filter((q) => q.sessionId !== sessionId),
      })),
    clearQueue: () => set({ queuedMessages: [] }),
  };
}
