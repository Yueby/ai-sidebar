import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, Session, Settings } from '@/lib/types';
import { messageText } from '@/lib/storage';
import {
  generateFollowUpSuggestions,
  type FollowUpSuggestion,
} from '@/lib/followUpSuggestions';
import { useAppStore } from '../store';

export interface UseFollowUpSuggestionsOptions {
  settings: Settings;
  currentSessionId: string | null;
  draftInput: string;
}

export interface FollowUpSuggestionsState {
  suggestions: FollowUpSuggestion[];
  loading: boolean;
  clearSuggestions: () => void;
  triggerGeneration: (sessionId: string, session: Session) => void;
}

/**
 * 消息引导 hook: 在一轮对话正常结束后使用辅助模型静默生成 3 条跟进建议。
 *
 * 消失时机:
 * - 会话切换时立即清空并中止请求
 * - 用户在输入框开始打字时立即清空
 * - 用户发送新消息或编辑重发时立即清空
 * - 用户点击某条建议(填入输入框)时立即清空
 *
 * 守卫机制:
 * - 独立 AbortController 与 genId 代次守卫, 避免异步竞态覆盖
 * - 流式中 / 门控挂起 / 队列积压 / 输入框有内容时拒绝生成
 * - 静默失败, 不展示错误 UI
 */
export function useFollowUpSuggestions({
  settings,
  currentSessionId,
  draftInput,
}: UseFollowUpSuggestionsOptions): FollowUpSuggestionsState {
  const [suggestions, setSuggestions] = useState<FollowUpSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const currentSessionIdRef = useRef(currentSessionId);
  currentSessionIdRef.current = currentSessionId;

  const draftInputRef = useRef(draftInput);
  draftInputRef.current = draftInput;

  const abortControllerRef = useRef<AbortController | null>(null);
  const genIdRef = useRef(0);

  const clearSuggestions = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setSuggestions([]);
    setLoading(false);
  }, []);

  // 1. 会话切换: 立即清空并中止在途生成
  useEffect(() => {
    clearSuggestions();
  }, [currentSessionId, clearSuggestions]);

  // 2. 开始输入: 用户打字时立即清空
  useEffect(() => {
    if (draftInput.trim().length > 0) {
      clearSuggestions();
    }
  }, [draftInput, clearSuggestions]);

  // 组件卸载时中止在途请求
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  // 3. 轮次成功完成时触发生成
  const triggerGeneration = useCallback(
    (sessionId: string, session: Session) => {
      // 必须归属当前激活会话
      if (sessionId !== currentSessionIdRef.current) return;

      const store = useAppStore.getState();
      // 守卫: 流式中 / 有队列积压 / 门控挂起 / 压缩中 / 用户正在输入 时不生成
      if (
        store.isStreaming ||
        store.activeGate !== null ||
        (store.queuedMessages && store.queuedMessages.length > 0) ||
        draftInputRef.current.trim().length > 0
      ) {
        return;
      }

      // 提取最后一轮问答: 最后一条 assistant 消息及其前面的 user 消息
      const messages = session.messages ?? [];
      let lastAssistantIndex = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m && m.role === 'assistant') {
          lastAssistantIndex = i;
          break;
        }
      }
      if (lastAssistantIndex === -1) return;

      const assistantMsg = messages[lastAssistantIndex];
      if (!assistantMsg) return;

      // 助手消息出错时不生成
      if (
        (assistantMsg as { stopReason?: string }).stopReason === 'error' ||
        (assistantMsg as { errorMessage?: string }).errorMessage
      ) {
        return;
      }

      let userMsg: ChatMessage | null = null;
      for (let i = lastAssistantIndex - 1; i >= 0; i--) {
        const m = messages[i];
        if (m && m.role === 'user') {
          userMsg = m;
          break;
        }
      }

      const assistantText = messageText(assistantMsg).trim();
      const userText = userMsg ? messageText(userMsg).trim() : '';
      if (!assistantText) return;

      // 中止前序并启动新一代生成
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const genId = ++genIdRef.current;

      setLoading(true);
      setSuggestions([]);

      void (async () => {
        try {
          const items = await generateFollowUpSuggestions(
            settingsRef.current,
            { userText, assistantText },
            controller.signal,
          );
          if (controller.signal.aborted || genId !== genIdRef.current) return;
          if (sessionId !== currentSessionIdRef.current) return;

          const currentStore = useAppStore.getState();
          if (
            currentStore.isStreaming ||
            currentStore.activeGate !== null ||
            (currentStore.queuedMessages && currentStore.queuedMessages.length > 0) ||
            draftInputRef.current.trim().length > 0
          ) {
            return;
          }

          setSuggestions(items);
        } catch {
          // 静默失败, 不展示错误 UI
        } finally {
          if (genId === genIdRef.current) {
            setLoading(false);
          }
        }
      })();
    },
    []
  );

  return {
    suggestions,
    loading,
    clearSuggestions,
    triggerGeneration,
  };
}
