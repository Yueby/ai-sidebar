import { useCallback } from 'react';
import { useAppStore } from '../store';

/**
 * 门控域 hook(store 切片消费层,按会话隔离):
 * - gates/resolvedGateCounts 从 store 读取(调用方按会话取);
 * - 4 个应答回调 = store action 薄层,携带归属会话 id;
 * - dismissPendingGates/resetGates/resetResolvedGateCount 直通 store(可选会话参数);
 * - handler 注册已模块化(store/index.ts 模块级 setGateHandler),本 hook 无 effect。
 */
export function useGate() {
  const gates = useAppStore((s) => s.gates);
  const resolvedGateCounts = useAppStore((s) => s.resolvedGateCounts);
  const approveGate = useAppStore((s) => s.approveGate);
  const denyGate = useAppStore((s) => s.denyGate);
  const answerGate = useAppStore((s) => s.answerGate);
  const cancelGate = useAppStore((s) => s.cancelGate);
  const dismissPendingGates = useAppStore((s) => s.dismissPendingGates);
  const resetGates = useAppStore((s) => s.resetGates);
  const resetResolvedGateCount = useAppStore((s) => s.resetResolvedGateCount);

  // 门控响应回调(store action 薄层,按会话);approve 携带会话级 grant 勾选态
  const handleGateApprove = useCallback(
    (sessionId: string, grant?: boolean) => approveGate(sessionId, grant),
    [approveGate],
  );
  const handleGateDeny = useCallback((sessionId: string) => denyGate(sessionId), [denyGate]);
  const handleGateAnswer = useCallback(
    (sessionId: string, answer: string) => answerGate(sessionId, answer),
    [answerGate],
  );
  const handleGateCancel = useCallback((sessionId: string) => cancelGate(sessionId), [cancelGate]);

  return {
    gates,
    resolvedGateCounts,
    handleGateApprove,
    handleGateDeny,
    handleGateAnswer,
    handleGateCancel,
    dismissPendingGates,
    resetGates,
    resetResolvedGateCount,
  };
}
