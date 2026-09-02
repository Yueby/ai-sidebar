/**
 * Tool Gating Contract Types & UI Adapter
 * 重新导出 lib/gate.ts 的正式契约签名与调度函数，供 sidepanel UI 统一消费
 */

export type {
  GateRequest,
  GateResponse,
  GateHandler,
} from '@/lib/gate';

export {
  setGateHandler,
  flushPendingGates,
  requestGate,
  createGatedTool,
} from '@/lib/gate';

