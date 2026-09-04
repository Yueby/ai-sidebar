import { useEffect, useSyncExternalStore } from 'react';

/**
 * tab 元数据单一读源(审计路线图第 1 项,窄版收敛):favIconUrl 是纯展示派生值,
 * 从 RefTab/draft 数据层全面退出,改为这里以 tabs API 事件为单写者的渲染层 store。
 *
 * 职责边界:title/url 在 draft/refs 块中仍有必要快照(关页兜底 + 发送定版,决策 12/26),不属本店职责;
 * 本店只服务"图标/实时标题"这类展示派生读取,以 tabs.onUpdated/onRemoved 为单写者,
 * 缓存未命中懒 hydrate 一次 tabs.get,favicon 未就绪时仅此一次延迟复查(有界,不轮询)。
 */

export interface TabMeta {
  id: number;
  title: string;
  url: string;
  favIconUrl?: string;
}

const store = new Map<number, TabMeta>();
const listeners = new Set<() => void>();
const hydrating = new Set<number>();
let writerInstalled = false;

function normalizeFav(v: unknown): string | undefined {
  return typeof v === 'string' && /^https?:/i.test(v) ? v : undefined;
}

function upsert(tab: { id?: number; title?: string; url?: string; favIconUrl?: string }): void {
  if (typeof tab.id !== 'number') return;
  const prev = store.get(tab.id);
  const fav = normalizeFav(tab.favIconUrl) ?? prev?.favIconUrl;
  const next: TabMeta = {
    id: tab.id,
    title: tab.title ?? prev?.title ?? '',
    url: tab.url ?? prev?.url ?? '',
    ...(fav !== undefined ? { favIconUrl: fav } : {}),
  };
  // 无实质变化不通知(无关 tab 的事件不刷渲染)
  if (prev && prev.title === next.title && prev.url === next.url && prev.favIconUrl === next.favIconUrl) {
    return;
  }
  store.set(tab.id, next);
  for (const l of listeners) l();
}

function ensureWriter(): void {
  if (writerInstalled) return;
  writerInstalled = true;
  // 单写者:任意 tab 的 onUpdated 都刷新已跟踪条目(favicon 常晚于 load 落地、title 高频变化均覆盖)
  browser.tabs.onUpdated.addListener((tabId, _changeInfo, tab) => {
    if (store.has(tabId)) {
      upsert({ id: tabId, title: tab?.title, url: tab?.url, favIconUrl: tab?.favIconUrl });
    }
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    if (store.delete(tabId)) {
      for (const l of listeners) l();
    }
  });
}

export function getTabMetaSnapshot(tabId: number | undefined): TabMeta | undefined {
  if (tabId === undefined) return undefined;
  ensureWriter();
  return store.get(tabId);
}

export function subscribeTabMeta(listener: () => void): () => void {
  ensureWriter();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 缓存未命中懒 hydrate;favicon 未就绪时仅此一次延迟复查(不轮询,后续变化由 onUpdated 覆盖) */
export function hydrateTabMeta(tabId: number): void {
  if (store.has(tabId) || hydrating.has(tabId)) return;
  hydrating.add(tabId);
  const pull = (): void => {
    void browser.tabs
      .get(tabId)
      .then((t) => {
        hydrating.delete(tabId);
        if (!t) return;
        upsert({ id: tabId, title: t.title, url: t.url, favIconUrl: t.favIconUrl });
        if (!normalizeFav(t.favIconUrl)) {
          setTimeout(() => {
            void browser.tabs
              .get(tabId)
              .then((t2) => {
                if (t2) upsert({ id: tabId, title: t2.title, url: t2.url, favIconUrl: t2.favIconUrl });
              })
              .catch(() => {});
          }, 3000);
        }
      })
      .catch(() => {
        hydrating.delete(tabId);
      });
  };
  pull();
}

/** 渲染层订阅 hook:缺条目自动 hydrate;快照对象引用稳定,仅实质变化触发重渲染 */
export function useTabMeta(tabId: number | undefined): TabMeta | undefined {
  const snapshot = useSyncExternalStore(subscribeTabMeta, () => getTabMetaSnapshot(tabId));
  const missing = snapshot === undefined;
  useEffect(() => {
    if (tabId !== undefined && missing) hydrateTabMeta(tabId);
  }, [tabId, missing]);
  return snapshot;
}
