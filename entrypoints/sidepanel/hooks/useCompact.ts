import { useCallback, useRef, useState } from 'react';
import type { Session, SessionCompaction } from '@/lib/types';
import { createUserMessage } from '@/lib/storage';
import { saveSession } from '@/lib/sessionStore';
import { findActiveModel } from '@/lib/providers';
import { getErrorMessage } from '@/lib/utils';
import { effectiveMessages } from '@/lib/contextTokens';
import { findCutIndex, runCompact } from '@/lib/compaction';
import { buildProvider } from '@/lib/agent';
import { collectPageRefs, renderPageRefsBlock } from '@/lib/pageRefs';
import { useAppStore, selectCurrentSession } from '../store';
import { dropPendingDraftSave } from '../store/sessionSlice';

/**
 * 上下文压缩域 hook(编排层):isCompacting 状态 + handleCompact(互斥守卫 → runCompact →
 * 非破坏性落盘)。非破坏性存储:Session.messages 全保留,摘要 user 消息追加尾部
 * (content = <context-summary> 块 + 被压缩范围 page-refs 并集块,拼装为调用方职责,
 * 契约见 lib/types.ts SessionCompaction);Session.compaction.summaryTimestamp 指向摘要消息,
 * 生效历史 = effectiveMessages() = [摘要] + 之后。错误走 errorMessage 横幅不落盘。
 */
export function useCompact() {
  const [isCompacting, setIsCompacting] = useState(false);
  const compactAbortRef = useRef<AbortController | null>(null);
  // 门控/错误域:store 直读(一期收敛)
  const hasPendingGate = useAppStore((s) => s.activeGate !== null);
  const setErrorMessage = useAppStore((s) => s.setErrorMessage);

  const handleCompact = useCallback(
    async ({ customInstructions }: { customInstructions?: string } = {}): Promise<boolean> => {
      // 互斥守卫:流式/挂起门控/压缩中任一 true 则拒绝
      const store = useAppStore.getState();
      if (store.isStreaming || hasPendingGate || isCompacting) return false;
      // S-1:按 store 取最新会话副本(压缩发起与落盘间可能有切换/同步,避免 stale 覆盖)
      const latestCurrent = selectCurrentSession(store);
      const session: Session | undefined =
        store.sessions.find((s) => s.id === latestCurrent?.id) ?? latestCurrent ?? undefined;
      if (!session || session.messages.length === 0) return false;
      const active = findActiveModel(store.settings);
      if (!active) {
        setErrorMessage('请先在设置中配置可用的 AI 提供商与模型');
        return false;
      }

      // 压缩范围 = 当前生效历史(压缩过则 [摘要]+之后)
      const effective = effectiveMessages(session.messages, session.compaction);

      const abortCtrl = new AbortController();
      compactAbortRef.current = abortCtrl;
      setIsCompacting(true);
      try {
        const result = await runCompact({
          provider: buildProvider(active.provider),
          modelId: active.model.id,
          messages: effective,
          signal: abortCtrl.signal,
          customInstructions,
        });

        // S-6:压缩期间会话可能已被删除——不复活,静默丢弃(对照 useChatTurn finalize 的 latest 守卫)
        if (!useAppStore.getState().sessions.some((s) => s.id === session.id)) {
          return false;
        }

        // 摘要 user 消息拼装(调用方职责):<context-summary> 块 + 被压缩范围 page-refs
        // 并集块 —— 并集让后续轮 collectPageRefs 仍能拿到被截历史的 tab 句柄(read_page 等)
        const cutIndex = findCutIndex(effective);
        const refs = collectPageRefs(effective.slice(0, cutIndex));
        const refsBlock = renderPageRefsBlock(refs);
        const summaryText = `<context-summary>\n${result.summaryContent}\n</context-summary>${
          refsBlock ? `\n\n${refsBlock}` : ''
        }`;
        const summaryMessage = createUserMessage(summaryText);

        const updated: Session = {
          ...session,
          messages: [...session.messages, summaryMessage],
          updatedAt: Date.now(),
          compaction: {
            summaryTimestamp: summaryMessage.timestamp,
            tokensBefore: result.tokensBefore,
            compactedAt: Date.now(),
          } satisfies SessionCompaction,
        };
        useAppStore.getState().setSessions(
          useAppStore.getState().sessions.map((s) => (s.id === session.id ? updated : s))
        );
        dropPendingDraftSave(session.id);
        await saveSession(updated);
        return true;
      } catch (err: unknown) {
        if (abortCtrl.signal.aborted) return false; // 中止:静默,不落盘
        setErrorMessage(getErrorMessage(err) || '上下文压缩失败,请重试');
        return false;
      } finally {
        setIsCompacting(false);
        compactAbortRef.current = null;
      }
    },
    [hasPendingGate, isCompacting, setErrorMessage]
  );

  /** 取消进行中的压缩(预留) */
  const cancelCompact = useCallback(() => {
    compactAbortRef.current?.abort();
  }, []);

  return { isCompacting, handleCompact, cancelCompact };
}
