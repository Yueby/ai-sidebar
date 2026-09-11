import { i18n } from '#i18n';
import { useCallback, useEffect, useRef } from 'react';
import type { PickedElement, Settings, Session, SessionDraft } from '@/lib/types';
import { PICK_ELEMENT_RESULT_MESSAGE } from '@/lib/types';
import {
  getActiveTabMeta,
  getTabMeta,
  liveTabIds,
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
      changeInfo: { title?: string; url?: string; status?: string },
    ) => {
      // 导航/重载完成:清空该 tab 的元素选择记录(页面引用保留,title/url 继续同步;
      // favicon 已退出数据层,由 lib/tabMetaStore 单源提供)
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
      groupMapRef.current.delete(tabId); // tab 关闭:组记忆一并清理
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
    async (tab: RefTab) => {
      // 与 handleAddCurrentTab 对齐:总开关关闭时芯片栏不可见,先自动开启再添加(否则静默无效)
      if (!useAppStore.getState().settings.includePageContext) {
        await handleTogglePageContext(true);
      }
      patchActiveDraft((d) =>
        d.refTabs.some((t) => t.id === tab.id) ? d : { ...d, refTabs: [...d.refTabs, tab] }
      );
    },
    [patchActiveDraft, handleTogglePageContext]
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
      // 显式移除引用 = 该 tab 脱离当前引用组,组记忆一并作废
      groupMapRef.current.delete(id);
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

  // ===== 引用组(决策 26):每个 tab 记住它所属的引用工作集,焦点切换即切换工作集。
  // 非破坏:切走的工作集存档于旧焦点页,切回即恢复;组快照为面板生命周期(tab 关闭即清理)。
  const groupMapRef = useRef<Map<number, { refTabs: RefTab[]; pickedElements: PickedElement[] }>>(new Map());
  const focusedTabIdRef = useRef<number | null>(null);

  const activeDraftRefTabs = useAppStore((s) => selectCurrentSession(s)?.draft?.refTabs ?? null);
  const activeDraftPicked = useAppStore((s) => selectCurrentSession(s)?.draft?.pickedElements ?? null);
  const includePageContext = useAppStore((s) => s.settings.includePageContext);

  // 僵尸引用清理:草稿引用可能指向本会话从未存在过的 tabId——WebDAV 恢复自其它机器/上一次
  // profile 时,那些 tab 在本环境根本没存在过,tabs.onRemoved 永远不会为它们触发(面板存活期
  // 内的关闭已由 onRemoved 处理)。惰性对账:引用一变(切会话/恢复/初始化)就校验现存 tab,
  // 缺失者从草稿移除;查询失败(null)一律不动,防把“未知”当“全关”而误删全部引用。
  useEffect(() => {
    if (!activeDraftRefTabs?.length && !activeDraftPicked?.length) return;
    const refsAtEffect = activeDraftRefTabs;
    const pickedAtEffect = activeDraftPicked;
    let cancelled = false;
    void liveTabIds().then((ids) => {
      if (cancelled || !ids) return;
      const draft = selectCurrentSession(useAppStore.getState())?.draft;
      if (!draft) return;
      // 对账期间草稿已被改写 → 本次作废(下一次变化会重新对账)
      if (draft.refTabs !== refsAtEffect || draft.pickedElements !== pickedAtEffect) return;
      const hasDeadTab = draft.refTabs.some((t) => !ids.has(t.id));
      const hasDeadPick = draft.pickedElements.some((e) => !ids.has(e.tabId));
      if (!hasDeadTab && !hasDeadPick) return;
      patchActiveDraft((d) => ({
        ...d,
        refTabs: d.refTabs.filter((t) => ids.has(t.id)),
        pickedElements: d.pickedElements.filter((e) => ids.has(e.tabId)),
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [activeDraftRefTabs, activeDraftPicked, patchActiveDraft]);
  // 工作集变化 → 快照同步给组内所有成员 + 焦点页(引用组 = 共享记忆)。
  // 引用栏被用户删空 → 重置组记忆(陈旧快照不复活,回归纯跟随;
  // 发送不再清空 refTabs——决策 13 修订——故不会误伤跨消息的组存活)
  useEffect(() => {
    if (!activeDraftRefTabs || activeDraftRefTabs.length === 0) {
      groupMapRef.current.clear();
      return;
    }
    const ids = new Set(activeDraftRefTabs.map((t) => t.id));
    if (focusedTabIdRef.current !== null) ids.add(focusedTabIdRef.current);
    for (const id of ids) {
      groupMapRef.current.set(id, {
        refTabs: activeDraftRefTabs,
        pickedElements: activeDraftPicked ?? [],
      });
    }
  }, [activeDraftRefTabs, activeDraftPicked]);

  const switchRefGroup = useCallback(
    async (tabId: number) => {
      if (!includePageContext) return; // 总开关关闭:冻结切换,什么都不发
      const prev = focusedTabIdRef.current;
      focusedTabIdRef.current = tabId;
      const meta = await getTabMeta(tabId).catch(() => null);
      if (!meta) return; // 非 http(s) 页(如 chrome://新标签页):不建组,等导航后再触发重估
      if (focusedTabIdRef.current !== tabId) return; // 快速连切竞态:焦点已再变,本次作废
      const st = useAppStore.getState();
      const current = selectCurrentSession(st);
      if (!current) return;
      const snapshot = groupMapRef.current.get(tabId);
      if (snapshot) {
        // 恢复该 tab 所属引用组(引用 + 框选元素整组还原);已是该组则幂等跳过(重复触发不产生草稿抖动)
        if (current.draft?.refTabs === snapshot.refTabs) return;
        patchActiveDraft((d) => ({
          ...d,
          refTabs: snapshot.refTabs,
          pickedElements: snapshot.pickedElements,
        }));
        return;
      }
      // 新页无组:隐式「当前页」芯片入住并自动跟随焦点(旧工作集已由成员同步存档,非破坏);
      // 之后用户手动添加引用才会固定为一组。已是该单例则幂等跳过
      if (
        current.draft?.refTabs.length === 1 &&
        current.draft.refTabs[0]?.id === tabId
      ) {
        return;
      }
      // 隐式芯片全量快照(meta 来自 getTabMeta;favicon 已由 tabMetaStore 单源提供)
      const self: RefTab = { ...meta };
      groupMapRef.current.set(tabId, { refTabs: [self], pickedElements: [] });
      patchActiveDraft((d) => ({ ...d, refTabs: [self], pickedElements: [] }));
    },
    [includePageContext, patchActiveDraft]
  );

  // 焦点变化触发组切换(dock 侧边栏的主窗口内切换;多窗口经 windows.onFocusChanged 兜底)
  useEffect(() => {
    if (typeof browser === 'undefined' || !browser.tabs?.onActivated) return;
    const onActivated = (info: { tabId: number }) => void switchRefGroup(info.tabId);
    const onUpdated = (tabId: number, ci: { url?: string }) => {
      // 聚焦 tab 导航到可引用网址(如从新标签页进入真实网站)时立即建组/恢复组——
      // 否则非 http 阶段的早退没有重试机会,要切走再切回才识别
      if (ci.url && tabId === focusedTabIdRef.current) void switchRefGroup(tabId);
    };
    const onFocused = async (windowId: number) => {
      if (windowId === browser.windows.WINDOW_ID_NONE) return;
      const [tab] = await browser.tabs.query({ active: true, windowId }).catch(() => []);
      if (tab?.id != null) void switchRefGroup(tab.id);
    };
    browser.tabs.onActivated.addListener((info) => onActivated(info));
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.windows.onFocusChanged.addListener((wid) => void onFocused(wid));
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.windows.onFocusChanged.removeListener(onFocused);
    };
  }, [switchRefGroup]);
  // 总开关开启时立即切回当前焦点页的组
  useEffect(() => {
    if (includePageContext && focusedTabIdRef.current !== null) {
      void switchRefGroup(focusedTabIdRef.current);
    }
  }, [includePageContext, switchRefGroup]);

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
          setErrorMessage(i18n.t('pick.tabNotFound'));
          return;
        }
        try {
          await browser.tabs.update(tabId, { active: true });
        } catch {
          // 标签页可能已被关闭
          setErrorMessage(i18n.t('pick.activateFailed'));
          return;
        }
      } else {
        meta = await getActiveTabMeta().catch(() => null);
      }
      if (!meta) {
        // 目标页不是普通网页(chrome:// 等),无法框选
        setErrorMessage(i18n.t('pick.notRegularPage'));
        return;
      }
      // 框选启动时不自动加引用;框选成功返回时才「引用页面 + 元素 chip」
      try {
        await startPickElement(meta.id);
        pendingPickRef.current = { tabId: meta.id, meta };
      } catch (err) {
        // 兜底注入失败/页面不可达:给用户可见的错误反馈,不无声失败
        setErrorMessage(err instanceof Error ? err.message : i18n.t('pick.startFailed'));
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
        setErrorMessage(i18n.t('pick.invalidResult'));
        return;
      }
      const tabId = typeof sender?.tab?.id === 'number' ? sender.tab.id : pendingPickRef.current?.tabId;
      if (typeof tabId !== 'number') {
        setErrorMessage(i18n.t('pick.unknownTab'));
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
          setErrorMessage(i18n.t('pick.refMetaFailed'));
          return;
        }
        try {
          if (!useAppStore.getState().settings.includePageContext) {
            await updateSettings({ ...useAppStore.getState().settings, includePageContext: true });
          }
        } catch {
          setErrorMessage(i18n.t('pick.refSaveFailed'));
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
