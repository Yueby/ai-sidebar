import { create, type StateCreator } from 'zustand';
import { devtools } from 'zustand/middleware';
import { setGateHandler, type GateRequest, type GateResponse } from '../gateAdapter';
import { createGateSlice, type GateSlice } from './gateSlice';
import { createErrorSlice, type ErrorSlice } from './errorSlice';
import { createSessionSlice, selectCurrentSession, type SessionSlice } from './sessionSlice';
import { createSettingsSlice, type SettingsSlice } from './settingsSlice';
import { createChatSlice, type ChatSlice } from './chatSlice';
import { setRuntimeStateSink, bridgeAgentEvent } from '@/lib/sessionRuntime';
import { setAgentEventSink } from '@/lib/agent';

export type AppStore = GateSlice & ErrorSlice & SessionSlice & SettingsSlice & ChatSlice;
export { selectCurrentSession };

const createAppSlices: StateCreator<AppStore> = (set, get) => ({
  ...createGateSlice(set, get),
  ...createErrorSlice(set),
  ...createSessionSlice(set, get),
  ...createSettingsSlice(set),
  ...createChatSlice(set),
});

/**
 * sidepanel 全局 store(gate/error/session/settings/chat 五切片)。
 * devtools 中间件仅 DEV 构建引入(import.meta.env.DEV 守卫,生产分支被静态消除,零引入),
 * dev 下可在 Redux DevTools 观察五切片状态流转。
 */
export const useAppStore = create<AppStore>()(
  import.meta.env.DEV
    ? // devtools 分支的 mutator 元组类型与无中间件分支不同,此处收窄为普通 creator
      (devtools(createAppSlices, { name: 'ai-sidebar' }) as unknown as StateCreator<AppStore>)
    : createAppSlices,
);

/**
 * gate handler 模块级注册(去 React 化):
 * - setGateHandler 为覆盖式注册,handler 是纯 store 调用,StrictMode 双挂载天然免疫;
 * - 无卸载清理(setGateHandler(null) + flushPendingGates 均省去):面板销毁即整层失效,
 *   清理无观察差异。
 */
// SessionRuntime 状态出口:runtime 是会话运行态唯一源,store.runs 为渲染镜像
setRuntimeStateSink((sessionId, snapshot, active) => {
  useAppStore.getState().syncRun(sessionId, snapshot, active);
});

// Agent 事件出口:每个会话 Agent 常驻订阅一次,事件写入该会话 runtime(pi 设计)
setAgentEventSink((sessionId, event) => {
  bridgeAgentEvent(sessionId, event);
  // 队列镜像同步:排队 user 消息被 Agent 消费(注入并 message_end)时按对象身份移除镜像条目
  if (event.type === 'message_end' && event.message.role === 'user') {
    useAppStore.getState().removeQueuedMessageByMessage(event.message);
  }
});

setGateHandler((req: GateRequest, sessionId: string) => {
  return new Promise<GateResponse>((resolve) => {
    // 门控归属由工具层透传的 run 会话决定(并发 run 各自独立);无归属 = 异常调用,安全拒绝
    if (!sessionId) {
      resolve(
        req.kind === 'confirm'
          ? { kind: 'confirm', approved: false }
          : { kind: 'ask', answer: '', cancelled: true },
      );
      return;
    }
    useAppStore.getState().pushGate(req, resolve, sessionId);
  });
});
