import { create, type StateCreator } from 'zustand';
import { devtools } from 'zustand/middleware';
import { setGateHandler, type GateRequest, type GateResponse } from '../gateAdapter';
import { createGateSlice, type GateSlice } from './gateSlice';
import { createErrorSlice, type ErrorSlice } from './errorSlice';
import { createSessionSlice, selectCurrentSession, type SessionSlice } from './sessionSlice';
import { createSettingsSlice, type SettingsSlice } from './settingsSlice';
import { createChatSlice, type ChatSlice } from './chatSlice';

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
setGateHandler((req: GateRequest) => {
  return new Promise<GateResponse>((resolve) => {
    // 门控归属运行会话(inFlight 在 turn 开始时声明):后台会话的门控不弹当前视图,仅提醒
    const st = useAppStore.getState();
    st.pushGate(req, resolve, st.inFlight?.sessionId ?? st.activeSessionId ?? null);
  });
});
