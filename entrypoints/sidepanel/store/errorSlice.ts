export interface ErrorSlice {
  /** 最近一条错误横幅文本 */
  errorMessage: string | null;
  /** 错误归属会话(null = 全局提示,始终显示;非当前会话的错误走后台提醒而不弹当前横幅) */
  errorSessionId: string | null;
  /** 每会话最近一条错误(切回时回看;新错误覆盖最近槽后旧会话错误不丢) */
  sessionErrors: Record<string, string>;
  setErrorMessage: (message: string | null, sessionId?: string) => void;
}

type SliceSet = (
  partial: Partial<ErrorSlice> | ((state: ErrorSlice) => Partial<ErrorSlice>),
) => void;

export function createErrorSlice(set: SliceSet): ErrorSlice {
  return {
    errorMessage: null,
    errorSessionId: null,
    sessionErrors: {},
    setErrorMessage: (errorMessage, sessionId) =>
      set((s) => {
        if (errorMessage === null) {
          // 清空:移除目标会话的回看条目(未指定时用当前归属),归属匹配时同步清最近槽
          const sid = sessionId ?? s.errorSessionId ?? undefined;
          const nextMap = { ...s.sessionErrors };
          if (sid) delete nextMap[sid];
          const clearLatest = !sid || s.errorSessionId === sid || s.errorSessionId === null;
          return {
            sessionErrors: nextMap,
            ...(clearLatest ? { errorMessage: null, errorSessionId: null } : {}),
          };
        }
        return {
          errorMessage,
          errorSessionId: sessionId ?? null,
          ...(sessionId ? { sessionErrors: { ...s.sessionErrors, [sessionId]: errorMessage } } : {}),
        };
      }),
  };
}
