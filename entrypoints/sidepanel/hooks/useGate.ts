import { useCallback } from 'react';
import { useAppStore } from '../store';

/**
 * 门控域 hook(store 切片消费层):
 * - activeGate/resolvedGateCount 从 store 读取(useStore selector);
 * - 4 个应答回调 = store action 薄层(签名与重构前一致,App/ApprovalSection 零改动);
 * - dismissPendingGates/resetGates/resetResolvedGateCount 直通 store;
 * - handler 注册已模块化(store/index.ts 模块级 setGateHandler),本 hook 无 effect。
 */
export function useGate() {
  const activeGate = useAppStore((s) => s.activeGate);
  const resolvedGateCount = useAppStore((s) => s.resolvedGateCount);
  const approveGate = useAppStore((s) => s.approveGate);
  const denyGate = useAppStore((s) => s.denyGate);
  const answerGate = useAppStore((s) => s.answerGate);
  const cancelGate = useAppStore((s) => s.cancelGate);
  const dismissPendingGates = useAppStore((s) => s.dismissPendingGates);
  const resetGates = useAppStore((s) => s.resetGates);
  const resetResolvedGateCount = useAppStore((s) => s.resetResolvedGateCount);

  // 门控响应回调(store action 薄层)
  const handleGateApprove = useCallback(() => approveGate(), [approveGate]);
  const handleGateDeny = useCallback(() => denyGate(), [denyGate]);
  const handleGateAnswer = useCallback((answer: string) => answerGate(answer), [answerGate]);
  const handleGateCancel = useCallback(() => cancelGate(), [cancelGate]);

  return {
    activeGate,
    resolvedGateCount,
    handleGateApprove,
    handleGateDeny,
    handleGateAnswer,
    handleGateCancel,
    dismissPendingGates,
    resetGates,
    resetResolvedGateCount,
  };
}
