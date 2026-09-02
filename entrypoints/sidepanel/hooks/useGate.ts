import { useCallback, useEffect, useState } from 'react';
import { type GateRequest, type GateResponse, setGateHandler, flushPendingGates } from '../gateAdapter';

/**
 * 门控域 hook:activeGate 状态、UI 处理器注册(gateAdapter)、4 个应答回调、
 * 冲销工具(dismissPendingGates=仅冲销;resetGates=冲销+重置计数,会话切换/新建/删除用)。
 * gatePagination / quietTailCount 跨门控+对话+会话三域,由 App 组合层派生。
 */
export function useGate() {
  // 工具门控请求(confirm/ask)
  const [activeGate, setActiveGate] = useState<{
    request: GateRequest;
    resolve: (res: GateResponse) => void;
  } | null>(null);

  // 本轮会话中已完成处理的门控次数(用于分页序号与总数统计)
  const [resolvedGateCount, setResolvedGateCount] = useState(0);

  // 门控响应回调封装
  const handleGateApprove = useCallback(() => {
    if (activeGate) {
      setResolvedGateCount((c) => c + 1);
      activeGate.resolve({ kind: 'confirm', approved: true });
      setActiveGate(null);
    }
  }, [activeGate]);

  const handleGateDeny = useCallback(() => {
    if (activeGate) {
      setResolvedGateCount((c) => c + 1);
      activeGate.resolve({ kind: 'confirm', approved: false });
      setActiveGate(null);
    }
  }, [activeGate]);

  const handleGateAnswer = useCallback((answer: string) => {
    if (activeGate) {
      setResolvedGateCount((c) => c + 1);
      activeGate.resolve({ kind: 'ask', answer });
      setActiveGate(null);
    }
  }, [activeGate]);

  const handleGateCancel = useCallback(() => {
    if (activeGate) {
      setResolvedGateCount((c) => c + 1);
      activeGate.resolve({ kind: 'ask', answer: '', cancelled: true });
      setActiveGate(null);
    }
  }, [activeGate]);

  /** 冲销挂起门控(安全拒绝),不重置计数:停止生成/打断重发/进设置视图用 */
  const dismissPendingGates = useCallback(() => {
    flushPendingGates();
    setActiveGate(null);
  }, []);

  /** 冲销挂起门控并重置计数:会话切换/新建/删除用 */
  const resetGates = useCallback(() => {
    dismissPendingGates();
    setResolvedGateCount(0);
  }, [dismissPendingGates]);

  /** 仅重置门控计数:新一轮发送初始化时用 */
  const resetResolvedGateCount = useCallback(() => setResolvedGateCount(0), []);

  // 挂载时向 gateAdapter 注册 UI 处理函数
  useEffect(() => {
    setGateHandler((req: GateRequest) => {
      return new Promise<GateResponse>((resolve) => {
        setActiveGate({ request: req, resolve });
      });
    });
    return () => {
      setGateHandler(null);
      flushPendingGates();
    };
  }, []);

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
