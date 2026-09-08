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
import { existingRuntime } from '@/lib/sessionRuntime';
import { useAppStore, selectCurrentSession } from '../store';
import { dropPendingDraftSave } from '../store/sessionSlice';
import { i18n } from '#i18n';

/**
 * 上下文压缩域 hook(编排层):isCompacting 状态 + handleCompact(互斥守卫 → runCompact →
 * 非破坏性落盘)。非破坏性存储:Session.messages 全保留,摘要 user 消息追加尾部
 * (content = <context-summary> 块 + 被压缩范围 page-refs 并集块,拼装为调用方职责,
 * 契约见 lib/types.ts SessionCompaction);Session.compaction.summaryTimestamp 指向摘要消息,
 * 生效历史 = effectiveMessages() = [摘要] + 之后。错误走 errorMessage 横幅不落盘。
 *
 * 域服务边界:store=共享状态唯一家(读 chatSlice.isStreaming/gateSlice.activeGate/sessionSlice);
 * 编排 hook=异步流程(runCompact/saveSession 时序)+ ephemeral ref(compactAbortRef);
 * 派生值=消费点就地 useMemo。
 */
export function useCompact() {
  const [isCompacting, setIsCompacting] = useState(false);
  /** 同步互斥真值(React state 有闭包滞后:并发会话轮末可同时通过守卫) */
  const compactingRef = useRef(false);
  /** 压缩目标会话(后台轮末压缩时不锁当前会话编辑器) */
  const [compactingSessionId, setCompactingSessionId] = useState<string | null>(null);
  const compactAbortRef = useRef<AbortController | null>(null);
  // 门控/错误域:store 直读(一期收敛)
  const setErrorMessage = useAppStore((s) => s.setErrorMessage);

  const handleCompact = useCallback(
    async ({
      customInstructions,
      targetSessionId,
    }: { customInstructions?: string; targetSessionId?: string } = {}): Promise<boolean> => {
      // 互斥守卫(同步真值,非闭包态):同一时刻至多一个压缩;目标会话自身在跑/挂门控时拒绝
      const store = useAppStore.getState();
      if (compactingRef.current) return false;
      // 压缩目标:后台轮末自动压缩 = 运行会话(targetSessionId);手动压缩 = 当前活跃会话。
      // 按 store 取最新会话副本(压缩发起与落盘间可能有切换/同步,避免 stale 覆盖)
      const latestCurrent = selectCurrentSession(store);
      const session: Session | undefined = targetSessionId
        ? store.sessions.find((s) => s.id === targetSessionId)
        : (store.sessions.find((s) => s.id === latestCurrent?.id) ?? latestCurrent ?? undefined);
      if (!session || session.messages.length === 0) return false;
      // 目标会话自身在跑/挂门控/发送准备中时拒绝(压缩与发送竞争同一会话)
      if (store.runs[session.id] || store.gates[session.id]) return false;
      if (store.preparingSessionIds.includes(session.id) || existingRuntime(session.id)?.isSending) {
        return false;
      }
      const active = findActiveModel(store.settings);
      if (!active) {
        setErrorMessage(i18n.t('compaction.toast.noModel'), session.id);
        return false;
      }

      // 压缩范围 = 当前生效历史(压缩过则 [摘要]+之后)
      const effective = effectiveMessages(session.messages, session.compaction);

      const abortCtrl = new AbortController();
      compactAbortRef.current = abortCtrl;
      compactingRef.current = true;
      setIsCompacting(true);
      setCompactingSessionId(session.id);
      // store 真值:跨 hook 的忙判定(useChatTurn.isSessionBusy)读它,不受 React 闭包滞后影响
      useAppStore.getState().setCompactingSession(session.id);
      try {
        const result = await runCompact({
          provider: buildProvider(active.provider),
          modelId: active.model.id,
          messages: effective,
          signal: abortCtrl.signal,
          customInstructions,
        });

        // 压缩期间会话可能已被删除——不复活,静默丢弃(对照 useChatTurn finalize 的 latest 守卫)
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

        // 落盘基于最新内存副本(压缩窗口内用户消息/草稿写入不能被进入时快照回滚)
        const latestSession = useAppStore.getState().sessions.find((s) => s.id === session.id);
        if (!latestSession) return false;
        const updated: Session = {
          ...latestSession,
          messages: [...latestSession.messages, summaryMessage],
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
        setErrorMessage(getErrorMessage(err) || i18n.t('compaction.toast.failed'));
        return false;
      } finally {
        compactingRef.current = false;
        setIsCompacting(false);
        setCompactingSessionId(null);
        useAppStore.getState().setCompactingSession(null);
        compactAbortRef.current = null;
      }
    },
    [setErrorMessage]
  );

  /** 取消进行中的压缩(预留) */
  const cancelCompact = useCallback(() => {
    compactAbortRef.current?.abort();
  }, []);

  return { isCompacting, compactingSessionId, handleCompact, cancelCompact };
}
