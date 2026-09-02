import { flushPendingGates, type GateRequest, type GateResponse } from '../gateAdapter';

/** 挂起中的门控请求(lib/gate requestGate → store.pushGate;resolve 由 UI 应答调用) */
export interface ActiveGate {
  request: GateRequest;
  resolve: (res: GateResponse) => void;
}

export interface GateSlice {
  activeGate: ActiveGate | null;
  /** 本轮已应答门控数(分页 1/N 用;冲销路径不计数) */
  resolvedGateCount: number;
  /** lib/gate handler 入口(模块级注册一次) */
  pushGate: (request: GateRequest, resolve: (res: GateResponse) => void) => void;
  /** 四类应答:计数 +1、resolve、收卡 */
  approveGate: () => void;
  denyGate: () => void;
  answerGate: (answer: string) => void;
  cancelGate: () => void;
  /** 冲销挂起门控(安全拒绝),不重置计数:停止生成/打断重发/进设置视图用 */
  dismissPendingGates: () => void;
  /** 冲销 + 重置计数:会话切换/新建/删除用 */
  resetGates: () => void;
  resetResolvedGateCount: () => void;
}

type SliceSet = (
  partial: Partial<GateSlice> | ((state: GateSlice) => Partial<GateSlice>),
) => void;
type SliceGet = () => GateSlice;

/** 应答公共体:无挂起门控则忽略;否则计数 +1、resolve、收卡 */
function respond(get: SliceGet, set: SliceSet, resp: GateResponse): void {
  const gate = get().activeGate;
  if (!gate) return;
  set((s) => ({ resolvedGateCount: s.resolvedGateCount + 1, activeGate: null }));
  gate.resolve(resp);
}

export function createGateSlice(set: SliceSet, get: SliceGet): GateSlice {
  return {
    activeGate: null,
    resolvedGateCount: 0,

    pushGate: (request, resolve) => set({ activeGate: { request, resolve } }),

    approveGate: () => respond(get, set, { kind: 'confirm', approved: true }),
    denyGate: () => respond(get, set, { kind: 'confirm', approved: false }),
    answerGate: (answer) => respond(get, set, { kind: 'ask', answer }),
    cancelGate: () => respond(get, set, { kind: 'ask', answer: '', cancelled: true }),

    dismissPendingGates: () => {
      flushPendingGates();
      set({ activeGate: null });
    },

    resetGates: () => {
      flushPendingGates();
      set({ activeGate: null, resolvedGateCount: 0 });
    },

    resetResolvedGateCount: () => set({ resolvedGateCount: 0 }),
  };
}
