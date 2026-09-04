import { useCallback, useEffect, useRef, useState } from 'react';
import type { Settings } from '@/lib/types';
import {
  FALLBACK_PROMPTS,
  generateQuickPrompts,
  isPromptWorthyUrl,
  type QuickPrompt,
} from '@/lib/quickPrompts';
import { getActiveTabMeta } from '@/lib/pageContext';
import { resolveAuxModel } from '@/lib/providers';

/**
 * 新会话推荐快捷指令:空会话可见时用辅助模型异步生成,失败静默回退静态四条。
 *
 * 生命周期:
 * - active(空会话可见)翻转时触发一次生成;消息出现 → 中止在途请求
 * - **聚焦 tab 导航跟随**:空态期间聚焦 tab 换了地址(onUpdated url / onActivated),
 *   自动重新生成,建议始终对应当前页面;同 URL 结果走内存缓存,来回切 tab 不重复请求
 * - **非正常页面隐藏**:聚焦页非 http(s)(chrome://、新标签页、about:blank 等)→
 *   available=false 不生成,UI 侧隐藏区块
 * - regenerate() 手动换一批(同 URL 强制重新生成,绕过缓存)
 * - settings 经 ref 读取,配置变更不触发重新生成(避免打字式刷新建议)
 * - 无任何可用模型(对话+辅助均未配置)时不发请求,UI 侧由 hasModel 隐藏区块
 */
export interface QuickPromptsState {
  /** 当前展示的建议;loading 期间为 [](UI 显示骨架) */
  items: QuickPrompt[];
  loading: boolean;
  /** 当前聚焦页是否值得出指令(仅 http(s));false 时 UI 隐藏整个区块 */
  available: boolean;
  regenerate: () => void;
}

export function useQuickPrompts(settings: Settings, active: boolean): QuickPromptsState {
  const [items, setItems] = useState<QuickPrompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState(false);
  const [seed, setSeed] = useState(0);

  // settings 走 ref:生成时机只由 active/seed 驱动
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // 同 URL 生成结果缓存(hook 存续期 = 空态期间):聚焦 tab 来回切换不重复烧请求;
  // regenerate 绕过缓存。key = 页面 url。
  const cacheRef = useRef(new Map<string, QuickPrompt[]>());

  useEffect(() => {
    if (!active) {
      // 空会话不可见:中止在途生成并复位,下次进入重新生成
      setItems([]);
      setLoading(false);
      setAvailable(false);
      return;
    }

    // 无任何可用模型(对话+辅助均未配置):不生成不发请求,UI 侧由 hasModel 隐藏区块
    if (!resolveAuxModel(settingsRef.current, settingsRef.current.quickPromptModel)) {
      setItems([]);
      setLoading(false);
      setAvailable(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const meta = await getActiveTabMeta();
        if (cancelled || controller.signal.aborted) return;

        // 非正常页面(chrome://、新标签页等):不生成,区块隐藏
        if (!isPromptWorthyUrl(meta?.url)) {
          setAvailable(false);
          setItems([]);
          setLoading(false);
          return;
        }
        setAvailable(true);

        // 缓存命中:同 URL 已生成过,直接展示(不闪骨架)
        const url = meta?.url ?? null;
        const cached = url ? cacheRef.current.get(url) : undefined;
        if (cached) {
          setItems(cached);
          setLoading(false);
          return;
        }

        const generated = await generateQuickPrompts(
          settingsRef.current,
          { pageTitle: meta?.title, url: meta?.url },
          controller.signal,
        );
        if (cancelled) return;
        if (url) cacheRef.current.set(url, generated);
        setItems(generated);
      } catch {
        // 静默兜底:无模型/请求失败/解析失败都不打扰用户
        if (!cancelled) setItems(FALLBACK_PROMPTS);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [active, seed]);

  // 聚焦 tab 导航跟随:空态期间页面换了地址 → 自动重新生成(对新鲜度敏感,缓存只挡同 URL 重复);
  // 导航到非 http(s) 页面同样经由 seed 重估 → available=false → 区块隐藏
  useEffect(() => {
    if (!active) return;
    if (typeof browser === 'undefined' || !browser.tabs?.onUpdated) return;

    let cancelled = false;
    // undefined = 尚未初始化(首条事件只记录不触发)
    let lastUrl: string | null | undefined;

    void getActiveTabMeta().then((m) => {
      if (!cancelled) lastUrl = m?.url ?? null;
    });

    const regenIfUrlChanged = async () => {
      const meta = await getActiveTabMeta();
      if (cancelled) return;
      const url = meta?.url ?? null;
      if (lastUrl !== undefined && url !== lastUrl) {
        lastUrl = url;
        setSeed((s) => s + 1);
      } else if (lastUrl === undefined) {
        lastUrl = url;
      }
    };

    const onUpdated = (
      _tabId: number,
      changeInfo: { url?: string; status?: string },
      tab: { active?: boolean },
    ) => {
      // 仅聚焦 tab 的导航信号(纯 title 更新/后台 tab 忽略;reload 同 URL 由缓存挡住重复请求)
      if (!tab.active) return;
      if (changeInfo.url !== undefined || changeInfo.status === 'complete') {
        void regenIfUrlChanged();
      }
    };
    const onActivated = () => void regenIfUrlChanged();

    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onActivated.addListener(onActivated);
    return () => {
      cancelled = true;
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onActivated.removeListener(onActivated);
    };
  }, [active]);

  const regenerate = useCallback(() => {
    // 手动换一批:清当前 URL 缓存,强制重新生成
    void getActiveTabMeta().then((m) => {
      if (m?.url) cacheRef.current.delete(m.url);
      setSeed((s) => s + 1);
    });
  }, []);

  return { items, loading, available, regenerate };
}
