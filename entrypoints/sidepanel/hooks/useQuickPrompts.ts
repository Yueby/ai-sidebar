import { useCallback, useEffect, useRef, useState } from 'react';
import type { Settings } from '@/lib/types';
import { FALLBACK_PROMPTS, generateQuickPrompts, type QuickPrompt } from '@/lib/quickPrompts';
import { getActiveTabMeta } from '@/lib/pageContext';

/**
 * 新会话推荐快捷指令:空会话可见时用辅助模型异步生成,失败静默回退静态四条。
 *
 * 生命周期:
 * - active(空会话可见)翻转时触发一次生成;消息出现 → 中止在途请求
 * - regenerate() 重新生成(换个角度:上下文不变,模型随机性天然带来差异)
 * - settings 经 ref 读取,配置变更不触发重新生成(避免打字式刷新建议)
 * - 面板无模型时直接用兜底,不发请求
 */
export interface QuickPromptsState {
  /** 当前展示的建议;loading 期间为 [](UI 显示骨架) */
  items: QuickPrompt[];
  loading: boolean;
  regenerate: () => void;
}

export function useQuickPrompts(settings: Settings, active: boolean): QuickPromptsState {
  const [items, setItems] = useState<QuickPrompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [seed, setSeed] = useState(0);

  // settings 走 ref:生成时机只由 active/seed 驱动
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const activeRef = useRef(active);

  useEffect(() => {
    activeRef.current = active;
    if (!active) {
      // 空会话不可见:中止在途生成并复位,下次进入重新生成
      setItems([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const meta = await getActiveTabMeta();
        if (cancelled || controller.signal.aborted) return;
        const generated = await generateQuickPrompts(
          settingsRef.current,
          { pageTitle: meta?.title, url: meta?.url },
          controller.signal,
        );
        if (!cancelled) setItems(generated);
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

  const regenerate = useCallback(() => setSeed((s) => s + 1), []);

  return { items, loading, regenerate };
}
