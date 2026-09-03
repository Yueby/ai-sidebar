import { useCallback, useEffect, useRef } from 'react';
import type { Settings, Session, SessionDraft } from '@/lib/types';
import { PICK_ELEMENT_RESULT_MESSAGE } from '@/lib/types';
import {
  getActiveTabMeta,
  getTabMeta,
  startPickElement,
  type RefTab,
} from '@/lib/pageContext';
import { useAppStore, selectCurrentSession } from '../store';

/**
 * 页面引用域 hook(编排层):refTabs/pickedElements 读写(经 store patchActiveDraft)、
 * tabs.onUpdated/onRemoved 实时同步、元素框选(startPickElement + pendingPick 兜底)、
 * runtime.onMessage 框选结果回传。会话/草稿状态在 store,getState() 取最新值。
 *
 * 域服务边界:store=共享状态唯一家(草稿经 sessionSlice.patchActiveDraft 写入);
 * 编排 hook=异步流程(框选/同步时序)+ ephemeral ref(pendingPickRef);派生值=消费点就地 useMemo。
 */
export function usePageContextRefs(params: {
  handleTogglePageContext: (enabled: boolean) => Promise<void>;
}) {
  const { handleTogglePageContext } = params;
  const setErrorMessage = useAppStore((s) => s.setErrorMessage);
  const patchActiveDraft = useAppStore((s) => s.patchActiveDraft);
  const commitSessions = useAppStore((s) => s.commitSessions);
  const updateSettings = useAppStore((s) => s.updateSettings);

  // 进行中的框选:结果回传时归属 tab;并保留启动时的页面元信息作兜底
  // (回传时 tabs 实时查询可能失败/URL 不可见,此时仍需能加引用,不能静默丢弃)
  const pendingPickRef = useRef<{ tabId: number; meta: RefTab } | null>(null);

  // 引用标签页的实时同步:导航更新 title/url、重载清该 tab 元素框选、关闭移除。
  // 草稿按会话持久化后,非活动会话的草稿也可能引用同一 tab,
  // 故对所有会话草稿做内存同步,并把有变化的会话一起排进防抖写盘队列。
  useEffect(() => {
    if (typeof browser === 'undefined' || !browser.tabs?.onUpdated) return;
    const patchAllDrafts = (mutator: (d: SessionDraft) => SessionDraft | null) => {
      const prev = useAppStore.getState().sessions;
      const next: Session[] = [];
      const changedIds: string[] = [];
      for (const s of prev) {
        if (!s.draft) {
          next.push(s);
          continue;
        }
        const mutated = mutator(s.draft);
        if (!mutated || mutated === s.draft) {
          next.push(s);
          continue;
        }
        next.push({ ...s, draft: mutated });
        changedIds.push(s.id);
      }
      if (changedIds.length > 0) commitSessions(next, changedIds);
    };
    const onUpdated = (
      tabId: number,
      changeInfo: { title?: string; url?: string; status?: string }
    ) => {
      // 导航/重载完成:清空该 tab 的元素选择记录(页面引用保留,title/url 继续同步)
      const clearPicked = changeInfo.status === 'complete';
      const syncMeta = Boolean(changeInfo.title || changeInfo.url);
      if (!clearPicked && !syncMeta) return;
      patchAllDrafts((d) => {
        let nd = d;
        if (clearPicked && nd.pickedElements.some((p) => p.tabId === tabId)) {
          nd = { ...nd, pickedElements: nd.pickedElements.filter((p) => p.tabId !== tabId) };
        }
        if (syncMeta && nd.refTabs.some((t) => t.id === tabId)) {
          nd = {
            ...nd,
            refTabs: nd.refTabs.map((t) =>
              t.id === tabId
                ? { ...t, title: changeInfo.title ?? t.title, url: changeInfo.url ?? t.url }
                : t
            ),
          };
        }
        return nd === d ? null : nd;
      });
    };
    const onRemoved = (tabId: number) => {
      patchAllDrafts((d) => {
        if (
          !d.refTabs.some((t) => t.id === tabId) &&
          !d.pickedElements.some((p) => p.tabId === tabId)
        ) {
          return null;
        }
        return {
          ...d,
          refTabs: d.refTabs.filter((t) => t.id !== tabId),
          pickedElements: d.pickedElements.filter((p) => p.tabId !== tabId),
        };
      });
    };
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(onRemoved);
    return () => {
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onRemoved.removeListener(onRemoved);
    };
  }, [commitSessions]);

  // Ref tab management(写入当前会话草稿,addRefTab 语义不变:按 tab id 去重)
  const addRefTab = useCallback(
    (tab: RefTab) => {
      patchActiveDraft((d) =>
        d.refTabs.some((t) => t.id === tab.id) ? d : { ...d, refTabs: [...d.refTabs, tab] }
      );
    },
    [patchActiveDraft]
  );

  const handleAddCurrentTab = useCallback(async () => {
    if (!useAppStore.getState().settings.includePageContext) {
      await handleTogglePageContext(true);
    }
    const meta = await getActiveTabMeta().catch(() => null);
    if (meta) addRefTab(meta);
  }, [addRefTab, handleTogglePageContext]);

  const handleRemoveRefTab = useCallback(
    (id: number) => {
      const currentSession = selectCurrentSession(useAppStore.getState());
      const remaining = (currentSession?.draft?.refTabs ?? []).filter((t) => t.id !== id);
      patchActiveDraft((d) => ({
        ...d,
        refTabs: d.refTabs.filter((t) => t.id !== id),
        // 同步清掉该标签页上的元素框选引用
        pickedElements: d.pickedElements.filter((p) => p.tabId !== id),
      }));
      // 移除最后一个引用时同步关闭总开关,保持「X = 关闭网页引用」的心智
      if (remaining.length === 0 && useAppStore.getState().settings.includePageContext) {
        handleTogglePageContext(false);
      }
    },
    [patchActiveDraft, handleTogglePageContext]
  );

  // 元素框选模式:不带 tabId 时作用于当前活动标签页;带 tabId 时先激活该标签页(框选必须可见)
  const handleStartPickElement = useCallback(
    async (tabId?: number) => {
      let meta: RefTab | null = null;
      if (typeof tabId === 'number') {
        const currentSession = selectCurrentSession(useAppStore.getState());
        meta =
          (currentSession?.draft?.refTabs ?? []).find((t) => t.id === tabId) ??
          (await getTabMeta(tabId).catch(() => null));
        if (!meta) {
          setErrorMessage('无法在该标签页启动元素选择:找不到该标签页');
          return;
        }
        try {
          await browser.tabs.update(tabId, { active: true });
        } catch {
          // 标签页可能已被关闭
          setErrorMessage('无法激活该标签页,元素选择已取消');
          return;
        }
      } else {
        meta = await getActiveTabMeta().catch(() => null);
      }
      if (!meta) {
        // 目标页不是普通网页(chrome:// 等),无法框选
        setErrorMessage('当前页面不是普通网页,无法框选元素');
        return;
      }
      // 框选启动时不自动加引用;框选成功返回时才「引用页面 + 元素 chip」
      try {
        await startPickElement(meta.id);
        pendingPickRef.current = { tabId: meta.id, meta };
      } catch (err) {
        // 兜底注入失败/页面不可达:给用户可见的错误反馈,不无声失败
        setErrorMessage(err instanceof Error ? err.message : '启动元素选择失败,请重试');
      }
    },
    [setErrorMessage]
  );

  const handleRemovePickedElement = useCallback(
    (id: string) => {
      patchActiveDraft((d) => ({
        ...d,
        pickedElements: d.pickedElements.filter((p) => p.id !== id),
      }));
    },
    [patchActiveDraft]
  );

  // 接收 content script 的框选结果广播(runtime.sendMessage)
  useEffect(() => {
    if (typeof browser === 'undefined' || !browser.runtime?.onMessage) return;
    const onMessage = (
      message: {
        type?: string;
        selector?: string;
        tagName?: string;
        preview?: string;
      },
      sender: { tab?: { id?: number } },
    ) => {
      if (message?.type !== PICK_ELEMENT_RESULT_MESSAGE) return;
      // 结果归属:优先用发送方 tab id(权威,避免多 tab 框选的单槽竞态),
      // 兜底用启动框选时记录的 tabId
      const selector = message.selector;
      if (typeof selector !== 'string' || !selector) {
        setErrorMessage('元素选择返回结果无效,请重新框选');
        return;
      }
      const tabId = typeof sender?.tab?.id === 'number' ? sender.tab.id : pendingPickRef.current?.tabId;
      if (typeof tabId !== 'number') {
        setErrorMessage('无法确定元素所属标签页,请重新框选');
        return;
      }
      const startMeta = pendingPickRef.current?.tabId === tabId ? pendingPickRef.current.meta : null;
      pendingPickRef.current = null;
      // 选中成功 = 此刻才自动引用该页面(启动框选时不加),再追加元素记录
      void (async () => {
        // 实时元信息优先;tabs 查询失败或 URL 不可见时退回启动框选时记录的元信息,
        // 避免结果已回传却因一次查询失败而静默丢掉引用与元素
        const meta = (await getTabMeta(tabId).catch(() => null)) ?? startMeta;
        if (!meta) {
          setErrorMessage('添加元素引用失败:无法获取该标签页信息,可能已被关闭');
          return;
        }
        try {
          if (!useAppStore.getState().settings.includePageContext) {
            await updateSettings({ ...useAppStore.getState().settings, includePageContext: true });
          }
        } catch {
          setErrorMessage('添加元素引用失败:写入设置时出错,请重试');
          return;
        }
        // 「引用页面 + 元素 chip」一次性写入当前会话草稿(原子,避免两次 commit)。
        // elementId 单调递增:取现有元素与草稿文本内块标记号的最大值 +1(防撞号);
        // 存 draft 即随草稿持久化,页面刷新后继续递增
        patchActiveDraft((d) => {
          const refTabs = d.refTabs.some((t) => t.id === tabId)
            ? d.refTabs
            : [...d.refTabs, meta];
          const alreadyPicked = d.pickedElements.some(
            (p) => p.tabId === tabId && p.selector === selector
          );
          const nextElementId =
            Math.max(
              0,
              ...d.pickedElements.map((p) =>
                typeof p.elementId === 'number' && p.elementId > 0 ? p.elementId : 0,
              ),
              ...Array.from(d.input.matchAll(/elementId="(\d+)"/g), (m) =>
                parseInt(m[1]!, 10),
              ),
            ) + 1;
          const pickedElements = alreadyPicked
            ? d.pickedElements
            : [
                ...d.pickedElements,
                {
                  id: `${tabId}:${selector}`,
                  elementId: nextElementId,
                  tabId,
                  selector,
                  tagName: message.tagName ?? '',
                  preview: message.preview ?? '',
                },
              ];
          if (refTabs === d.refTabs && pickedElements === d.pickedElements) return d;
          return { ...d, refTabs, pickedElements };
        });
      })();
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, [patchActiveDraft, updateSettings, setErrorMessage]);

  return {
    addRefTab,
    handleAddCurrentTab,
    handleRemoveRefTab,
    handleStartPickElement,
    handleRemovePickedElement,
  };
}
