import type { ChatMessage } from '@/lib/types';

/** 多 turn agent 循环的 in-flight 运行:已 message_end 但尚未进转录(finalize 才落)的消息 */
export interface InFlightRun {
  sessionId: string;
  messages: ChatMessage[];
}

/** 排队消息:归属目标会话(切换会话不影响,轮末自动发往归属会话) */
export interface QueuedMessage {
  sessionId: string;
  text: string;
}

export interface ChatSlice {
  isStreaming: boolean;
  streamingContent: string;
  streamingThinking: string;
  activeToolNames: string[];
  isCancelled: boolean;
  inFlight: InFlightRun | null;
  /** 消息队列:繁忙期间用户排队发送的消息(仅内存,FIFO;按目标会话归属,跨会话隔离) */
  queuedMessages: QueuedMessage[];

  setIsStreaming: (value: boolean) => void;
  setStreamingContent: (value: string) => void;
  setStreamingThinking: (value: string) => void;
  setActiveToolNames: (value: string[] | ((prev: string[]) => string[])) => void;
  setIsCancelled: (value: boolean) => void;
  setInFlight: (
    value: InFlightRun | null | ((prev: InFlightRun | null) => InFlightRun | null),
  ) => void;
  enqueueMessage: (item: QueuedMessage) => void;
  dequeueMessage: () => QueuedMessage | undefined;
  removeQueuedMessage: (sessionId: string, index: number) => void;
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
    queuedMessages: [],

    setIsStreaming: (isStreaming) => set({ isStreaming }),
    setStreamingContent: (streamingContent) => set({ streamingContent }),
    setStreamingThinking: (streamingThinking) => set({ streamingThinking }),
    setActiveToolNames: (value) =>
      set((s) => ({ activeToolNames: typeof value === 'function' ? value(s.activeToolNames) : value })),
    setIsCancelled: (isCancelled) => set({ isCancelled }),
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
    removeQueuedMessage: (sessionId, index) =>
      set((s) => ({
        queuedMessages: (s.queuedMessages ?? []).filter(
          (q, i) => !(q.sessionId === sessionId && i === index),
        ),
      })),
    removeQueuedMessagesForSession: (sessionId) =>
      set((s) => ({
        queuedMessages: (s.queuedMessages ?? []).filter((q) => q.sessionId !== sessionId),
      })),
    clearQueue: () => set({ queuedMessages: [] }),
  };
}
