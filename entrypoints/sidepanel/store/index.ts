import { create } from 'zustand';
import { setGateHandler, type GateRequest, type GateResponse } from '../gateAdapter';
import { createGateSlice, type GateSlice } from './gateSlice';
import { createErrorSlice, type ErrorSlice } from './errorSlice';
import { createSessionSlice, selectCurrentSession, type SessionSlice } from './sessionSlice';
import { createSettingsSlice, type SettingsSlice } from './settingsSlice';
import { createChatSlice, type ChatSlice } from './chatSlice';

export type AppStore = GateSlice & ErrorSlice & SessionSlice & SettingsSlice & ChatSlice;
export { selectCurrentSession };

/**
 * sidepanel 全局 store(二期:gate/error/session/settings/chat 五切片)。
 * 切片创建器以 Partial 各域类型读写,组合时获得完整 store 类型。
 */
export const useAppStore = create<AppStore>()((set, get) => ({
  ...createGateSlice(set, get),
  ...createErrorSlice(set),
  ...createSessionSlice(set, get),
  ...createSettingsSlice(set),
  ...createChatSlice(set),
}));

/**
 * gate handler 模块级注册(去 React 化):
 * - setGateHandler 为覆盖式注册,handler 是纯 store 调用,StrictMode 双挂载天然免疫;
 * - 原 useGate effect 的卸载清理(setGateHandler(null) + flushPendingGates)随面板销毁
 *   无观察差异,不再保留。
 */
setGateHandler((req: GateRequest) => {
  return new Promise<GateResponse>((resolve) => {
    useAppStore.getState().pushGate(req, resolve);
  });
});
