import { flushPendingGates, type GateRequest, type GateResponse } from '../gateAdapter';

/** 挂起中的门控请求(按会话隔离:并发 run 各自持有自己的门控) */
export interface ActiveGate {
  request: GateRequest;
  resolve: (res: GateResponse) => void;
  /** 归属会话(工具层透传,run 上下文内产生) */
  sessionId: string;
}

export interface GateSlice {
  /** 挂起门控按会话(gates[sessionId];多会话并发时各自独立,互不覆盖) */
  gates: Record<string, ActiveGate>;
  /** 每会话已应答门控数(分页 1/N 用;冲销路径不计数) */
  resolvedGateCounts: Record<string, number>;
  /** lib/gate handler 入口(模块级注册一次) */
  pushGate: (request: GateRequest, resolve: (res: GateResponse) => void, sessionId: string) => void;
  /** 四类应答:计数 +1、resolve、收卡;confirm 可携带会话级 grant */
  approveGate: (sessionId: string, grant?: boolean) => void;
  denyGate: (sessionId: string) => void;
  answerGate: (sessionId: string, answer: string) => void;
  cancelGate: (sessionId: string) => void;
  /** 冲销挂起门控(安全拒绝):无参 = 全部;传会话 = 仅该会话 */
  dismissPendingGates: (sessionId?: string) => void;
  /** 冲销 + 重置计数:无参 = 全部;传会话 = 仅该会话(会话切换/删除用) */
  resetGates: (sessionId?: string) => void;
  resetResolvedGateCount: (sessionId: string) => void;
}

type SliceSet = (
  partial: Partial<GateSlice> | ((state: GateSlice) => Partial<GateSlice>),
) => void;
type SliceGet = () => GateSlice;

/** 应答公共体:无挂起门控则忽略;否则计数 +1、resolve、收卡 */
function respond(get: SliceGet, set: SliceSet, sessionId: string, resp: GateResponse): void {
  const gate = get().gates[sessionId];
  if (!gate) return;
  set((s) => {
    const gates = { ...s.gates };
    delete gates[sessionId];
    return {
      gates,
      resolvedGateCounts: {
        ...s.resolvedGateCounts,
        [sessionId]: (s.resolvedGateCounts[sessionId] ?? 0) + 1,
      },
    };
  });
  gate.resolve(resp);
}

export function createGateSlice(set: SliceSet, get: SliceGet): GateSlice {
  return {
    gates: {},
    resolvedGateCounts: {},

    pushGate: (request, resolve, sessionId) =>
      set((s) => ({ gates: { ...s.gates, [sessionId]: { request, resolve, sessionId } } })),

    approveGate: (sessionId, grant?: boolean) =>
      respond(
        get,
        set,
        sessionId,
        grant ? { kind: 'confirm', approved: true, grant } : { kind: 'confirm', approved: true },
      ),
    denyGate: (sessionId) => respond(get, set, sessionId, { kind: 'confirm', approved: false }),
    answerGate: (sessionId, answer) => respond(get, set, sessionId, { kind: 'ask', answer }),
    cancelGate: (sessionId) => respond(get, set, sessionId, { kind: 'ask', answer: '', cancelled: true }),

    dismissPendingGates: (sessionId) => {
      if (sessionId === undefined) {
        flushPendingGates();
        set({ gates: {} });
        return;
      }
      const gate = get().gates[sessionId];
      if (!gate) return;
      set((s) => {
        const gates = { ...s.gates };
        delete gates[sessionId];
        return { gates };
      });
      gate.resolve(
        gate.request.kind === 'confirm'
          ? { kind: 'confirm', approved: false }
          : { kind: 'ask', answer: '', cancelled: true },
      );
    },

    resetGates: (sessionId) => {
      if (sessionId === undefined) {
        flushPendingGates();
        set({ gates: {}, resolvedGateCounts: {} });
        return;
      }
      const gate = get().gates[sessionId];
      if (gate) {
        gate.resolve(
          gate.request.kind === 'confirm'
            ? { kind: 'confirm', approved: false }
            : { kind: 'ask', answer: '', cancelled: true },
        );
      }
      set((s) => {
        const gates = { ...s.gates };
        delete gates[sessionId];
        const counts = { ...s.resolvedGateCounts };
        delete counts[sessionId];
        return { gates, resolvedGateCounts: counts };
      });
    },

    resetResolvedGateCount: (sessionId) =>
      set((s) => {
        if (!(sessionId in s.resolvedGateCounts)) return s;
        const counts = { ...s.resolvedGateCounts };
        delete counts[sessionId];
        return { resolvedGateCounts: counts };
      }),
  };
}
