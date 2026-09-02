export interface ErrorSlice {
  /** 错误横幅文本(会话域切换/新建清空,对话/压缩/框选域写入) */
  errorMessage: string | null;
  setErrorMessage: (message: string | null) => void;
}

type SliceSet = (partial: Partial<ErrorSlice>) => void;

export function createErrorSlice(set: SliceSet): ErrorSlice {
  return {
    errorMessage: null,
    setErrorMessage: (errorMessage) => set({ errorMessage }),
  };
}
