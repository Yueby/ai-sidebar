import React, { useState } from 'react';
import { Globe, ChevronDown, ChevronUp, X } from 'lucide-react';
import type { RefTab } from '@/lib/pageContext';
import { faviconUrl } from '@/lib/favicon';
import { cn } from '@/lib/utils';

interface TabRefBarProps {
  refTabs: RefTab[];
  onRemoveRefTab: (id: number) => void;
}

/**
 * 单个网站图标(多级回退:标签条实时 favIconUrl → 现场按 tabId 重查(事件时序竞态自愈) → _favicon 服务 → Globe):
 * _favicon 只在页面提交进历史后才有条目(不实时、时有时无);新开 tab 激活瞬间 favIconUrl 常未生成,
 * 数据链路任何环节漏掉实时值,渲染层按 tabId 自行补偿一次(决策:导出反馈修复)
 */
export function FaviconIcon({
  url,
  favIconUrl,
  tabId,
  className = 'size-3.5',
}: {
  url: string;
  favIconUrl?: string;
  tabId?: number;
  className?: string;
}) {
  const [live, setLive] = useState<string | undefined>(favIconUrl);
  const [stage, setStage] = useState<'live' | 'service' | 'failed'>(favIconUrl ? 'live' : 'service');
  useEffect(() => {
    setLive(favIconUrl);
    setStage(favIconUrl ? 'live' : 'service');
    // 数据链路缺实时值时自愈(新开 tab 的 favicon 异步生成,事件时序无保证):
    // (a) 订阅本 tabId 的 onUpdated——任意 changeInfo(含 status:'complete')都读第三参实时值,就绪即升级;
    // (b) 1s/2s/4s 退避重试 tabs.get 兜底(Chromium 不保证发 favIconUrl changeInfo);tab 关闭即停
    if (favIconUrl || tabId === undefined) return;
    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const readLive = (t: { favIconUrl?: string } | undefined): string | undefined =>
      typeof t?.favIconUrl === 'string' && /^https?:/i.test(t.favIconUrl) ? t.favIconUrl : undefined;
    const upgrade = (fav: string) => {
      if (!alive) return;
      setLive(fav);
      setStage('live');
      stop();
    };
    const onUpdated = (updatedTabId: number, _ci: unknown, tab?: { favIconUrl?: string }) => {
      if (updatedTabId !== tabId) return;
      const fav = readLive(tab);
      if (fav) upgrade(fav);
    };
    const checkOnce = () => {
      void browser.tabs
        .get(tabId)
        .then((t) => {
          const fav = readLive(t);
          if (alive && fav) upgrade(fav);
        })
        .catch(() => stop());
    };
    const stop = () => {
      timers.forEach((t) => clearTimeout(t));
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
    browser.tabs.onUpdated.addListener(onUpdated);
    [1000, 2000, 4000].forEach((delay) => timers.push(setTimeout(checkOnce, delay)));
    return () => {
      alive = false;
      stop();
    };
  }, [tabId, favIconUrl, url]);
  const src = stage === 'live' && live ? live : faviconUrl(url, 32);
  if (stage === 'failed' || !src) {
    return <Globe className={`${className} text-muted-foreground shrink-0`} />;
  }
  return (
    <img
      src={src}
      alt=""
      onError={() => setStage((s) => (s === 'live' ? 'service' : 'failed'))}
      className={`${className} rounded-[2px] shrink-0 object-contain`}
      loading="lazy"
    />
  );
}

/**
 * 标签页引用区 (独立小控件，位于输入框卡片上方，底部被输入框压住呈现 Gemini 式层叠):
 * 1. 单引用态: 独立小卡片，顶部圆角 + 边框，底部留出空间由输入框卡片向上负 margin 压住
 * 2. 多引用折叠态: 多个网站 favicon + 正在引用 N 个标签页 + 展开箭头
 * 3. 展开态: 标题条 + 逐行引用列表(favicon + 标题 + X)
 */
export function TabRefBar({ refTabs, onRemoveRefTab }: TabRefBarProps) {
  const [expanded, setExpanded] = useState(false);

  if (!refTabs || refTabs.length === 0) return null;

  const count = refTabs.length;

  // 1. 单引用态: 独立卡片控件，底部垫高 pb-3 供输入框 -mt-2 压住
  if (count === 1) {
    const tab = refTabs[0]!;
    return (
      <div className="relative z-0 w-full select-none animate-in fade-in-0 duration-150 motion-reduce:animate-none">
        <div
          className="flex items-center justify-between gap-2 px-2.5 pt-1.5 pb-3 rounded-t-lg border border-b-0 border-border/70 bg-muted/40 text-xs text-foreground group/single transition-colors hover:bg-muted/60"
          title={tab.url}
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <FaviconIcon url={tab.url} favIconUrl={tab.favIconUrl} tabId={tab.id} className="size-3.5" />
            <span className="text-[11px] text-muted-foreground shrink-0 font-normal">
              正在引用
            </span>
            <span className="font-medium truncate text-[11px] text-foreground max-w-[calc(100%-90px)]">
              “{tab.title || tab.url}”
            </span>
            <span className="text-[11px] text-muted-foreground shrink-0 font-normal">
              标签页
            </span>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemoveRefTab(tab.id);
            }}
            className="text-muted-foreground/70 hover:text-foreground rounded p-0.5 hover:bg-background/80 transition-colors shrink-0 cursor-pointer"
            title="移除该标签页引用"
          >
            <X className="size-3" />
          </button>
        </div>
      </div>
    );
  }

  // 2 & 3. 多引用态 (折叠 / 展开): 独立卡片控件
  return (
    <div className="relative z-0 w-full select-none rounded-t-lg border border-b-0 border-border/70 bg-muted/40 text-xs text-foreground animate-in fade-in-0 duration-150 motion-reduce:animate-none">
      {/* 头部摘要栏 (点击可展开/收起) */}
      <div
        onClick={() => setExpanded((prev) => !prev)}
        className={`flex items-center justify-between gap-2 px-2.5 pt-1.5 cursor-pointer hover:bg-muted/60 transition-colors ${
          expanded ? 'pb-1.5' : 'pb-3'
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {/* 多 Favicon 紧凑堆叠 / 并排 */}
          <div className="flex items-center -space-x-1 shrink-0 pr-0.5">
            {refTabs.slice(0, 4).map((t) => (
              <div
                key={t.id}
                className="relative ring-1 ring-background rounded-[2px] bg-background"
              >
                <FaviconIcon url={t.url} favIconUrl={t.favIconUrl} tabId={t.id} className="size-3.5" />
              </div>
            ))}
            {count > 4 && (
              <span className="text-[9px] text-muted-foreground font-mono pl-1.5">
                +{count - 4}
              </span>
            )}
          </div>

          <span className="text-[11px] text-foreground font-medium truncate">
            正在引用 {count} 个标签页
          </span>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((prev) => !prev);
          }}
          className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors shrink-0 cursor-pointer"
          title={expanded ? '收起引用列表' : '展开引用列表'}
        >
          {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        </button>
      </div>

      {/* 展开列表 */}
      {/* 展开列表:grid-rows 技巧实现高度双向平滑动画(条件渲染只能做进场,收起会瞬关) */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="px-1.5 pb-3 pt-0.5 space-y-0.5 max-h-40 overflow-y-auto border-t border-border/30">
            {refTabs.map((t, idx) => (
              <div
                key={t.id}
                className="group/item flex items-center justify-between gap-2 px-2 py-1 rounded-md hover:bg-background/80 transition-colors text-[11px]"
                title={t.url}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <FaviconIcon url={t.url} favIconUrl={t.favIconUrl} tabId={t.id} className="size-3.5" />
                  <span className="truncate font-normal text-foreground">
                    {t.title || t.url}
                  </span>
                  {idx === 0 && (
                    <span className="shrink-0 text-[9px] font-normal px-1 py-0.2 rounded bg-secondary text-muted-foreground">
                      当前页
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => onRemoveRefTab(t.id)}
                  className="opacity-60 group-hover/item:opacity-100 text-muted-foreground hover:text-foreground p-0.5 hover:bg-muted rounded transition-colors shrink-0 cursor-pointer"
                  title="移除此标签页"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
