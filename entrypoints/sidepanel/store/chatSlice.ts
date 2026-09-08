import type { ChatMessage, PickedElement } from '@/lib/types';
import type { RefTab } from '@/lib/pageContext';

/** 多 turn agent 循环的 in-flight 运行:已 message_end 但尚未进转录(finalize 才落)的消息 */
export interface InFlightRun {
  sessionId: string;
  messages: ChatMessage[];
}

/** 排队消息:归属目标会话(切换会话不影响,轮末自动发往归属会话);
 *  id 供 UI 稳定删除;refs/elements 为入队时刻快照(出队不读后续被改动的草稿) */
export interface QueuedMessage {
  id: string;
  sessionId: string;
  text: string;
  refTabs: RefTab[];
  pickedElements: PickedElement[];
}

export interface ChatSlice {
  isStreaming: boolean;
  streamingContent: string;
  streamingThinking: string;
  activeToolNames: string[];
  isCancelled: boolean;
  inFlight: InFlightRun | null;
  /** 运行中会话 id(整个 run 生命周期保持;finalize 落盘期间不闪断,供后台指示/隔离派生) */
  runningSessionId: string | null;
  /** 发送准备中会话 id(首个 await 到 setSessions 之间;空会话回收需避让,否则刚发的话被回收) */
  preparingSessionId: string | null;
  /** 消息队列:繁忙期间用户排队发送的消息(仅内存,FIFO;按目标会话归属,跨会话隔离) */
  queuedMessages: QueuedMessage[];

  setIsStreaming: (value: boolean) => void;
  setStreamingContent: (value: string) => void;
  setStreamingThinking: (value: string) => void;
  setActiveToolNames: (value: string[] | ((prev: string[]) => string[])) => void;
  setIsCancelled: (value: boolean) => void;
  setRunningSessionId: (value: string | null) => void;
  setPreparingSessionId: (value: string | null) => void;
  setInFlight: (
    value: InFlightRun | null | ((prev: InFlightRun | null) => InFlightRun | null),
  ) => void;
  enqueueMessage: (item: QueuedMessage) => void;
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
    isStreaming: false,
    streamingContent: '',
    streamingThinking: '',
    activeToolNames: [],
    isCancelled: false,
    inFlight: null,
    runningSessionId: null,
    preparingSessionId: null,
    queuedMessages: [],

    setIsStreaming: (isStreaming) => set({ isStreaming }),
    setStreamingContent: (streamingContent) => set({ streamingContent }),
    setStreamingThinking: (streamingThinking) => set({ streamingThinking }),
    setActiveToolNames: (value) =>
      set((s) => ({ activeToolNames: typeof value === 'function' ? value(s.activeToolNames) : value })),
    setIsCancelled: (isCancelled) => set({ isCancelled }),
    setRunningSessionId: (runningSessionId) => set({ runningSessionId }),
    setPreparingSessionId: (preparingSessionId) => set({ preparingSessionId }),
    setInFlight: (value) =>
      set((s) => ({ inFlight: typeof value === 'function' ? value(s.inFlight) : value })),
    enqueueMessage: (item) =>
      set((s) => ({ queuedMessages: [...(s.queuedMessages ?? []), item] })),
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
      set((s) => ({
        queuedMessages: (s.queuedMessages ?? []).filter((q) => q.id !== id),
      })),
    removeQueuedMessagesForSession: (sessionId) =>
      set((s) => ({
        queuedMessages: (s.queuedMessages ?? []).filter((q) => q.sessionId !== sessionId),
      })),
    clearQueue: () => set({ queuedMessages: [] }),
  };
}
