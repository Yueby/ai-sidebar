export interface ErrorSlice {
  /** 错误横幅文本(会话域切换/新建清空,对话/压缩/框选域写入) */
  errorMessage: string | null;
  /** 错误归属会话(null = 全局提示,始终显示;非当前会话的错误走后台提醒而不弹当前横幅) */
  errorSessionId: string | null;
  setErrorMessage: (message: string | null, sessionId?: string) => void;
}

type SliceSet = (partial: Partial<ErrorSlice>) => void;

export function createErrorSlice(set: SliceSet): ErrorSlice {
  return {
    errorMessage: null,
    errorSessionId: null,
    setErrorMessage: (errorMessage, sessionId) =>
      set({ errorMessage, errorSessionId: errorMessage === null ? null : (sessionId ?? null) }),
  };
}
