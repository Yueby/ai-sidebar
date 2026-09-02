import { create } from 'zustand';
import { setGateHandler, type GateRequest, type GateResponse } from '../gateAdapter';
import { createGateSlice, type GateSlice } from './gateSlice';
import { createErrorSlice, type ErrorSlice } from './errorSlice';

export type AppStore = GateSlice & ErrorSlice;

/**
 * sidepanel 全局 store(一期:gate 切片 + error 切片;后续切片按域渐进迁入)。
 * 切片创建器以 Partial<AppStore> 读写,组合时天然获得完整类型。
 */
export const useAppStore = create<AppStore>()((set, get) => ({
  ...createGateSlice(set, get),
  ...createErrorSlice(set),
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
