import type { ChatMessage } from '@/lib/types';

/** 多 turn agent 循环的 in-flight 运行:已 message_end 但尚未进转录(finalize 才落)的消息 */
export interface InFlightRun {
  sessionId: string;
  messages: ChatMessage[];
}

export interface ChatSlice {
  isStreaming: boolean;
  streamingContent: string;
  streamingThinking: string;
  activeToolNames: string[];
  isCancelled: boolean;
  inFlight: InFlightRun | null;
  /** 消息队列:流式期间用户排队发送的消息列表(仅内存,FIFO) */
  queuedMessages: string[];

  setIsStreaming: (value: boolean) => void;
  setStreamingContent: (value: string) => void;
  setStreamingThinking: (value: string) => void;
  setActiveToolNames: (value: string[] | ((prev: string[]) => string[])) => void;
  setIsCancelled: (value: boolean) => void;
  setInFlight: (
    value: InFlightRun | null | ((prev: InFlightRun | null) => InFlightRun | null),
  ) => void;
  enqueueMessage: (text: string) => void;
  dequeueMessage: () => string | undefined;
  removeQueuedMessage: (index: number) => void;
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
    enqueueMessage: (text) =>
      set((s) => ({ queuedMessages: [...(s.queuedMessages ?? []), text] })),
    dequeueMessage: () => {
      let item: string | undefined;
      set((s) => {
        const queue = s.queuedMessages ?? [];
        if (queue.length === 0) return s;
        const [first, ...rest] = queue;
        item = first;
        return { queuedMessages: rest };
      });
      return item;
    },
    removeQueuedMessage: (index) =>
      set((s) => ({
        queuedMessages: (s.queuedMessages ?? []).filter((_, i) => i !== index),
      })),
    clearQueue: () => set({ queuedMessages: [] }),
  };
}
