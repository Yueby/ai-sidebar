import React, { useState } from 'react';
import { Globe, ChevronDown, ChevronUp, X } from 'lucide-react';
import type { RefTab } from '@/lib/pageContext';
import { faviconUrl } from '@/lib/favicon';

interface TabRefBarProps {
  refTabs: RefTab[];
  onRemoveRefTab: (id: number) => void;
}

/** 单个网站图标(加载失败自动回退 Globe) */
function FaviconIcon({ url, className = 'size-3.5' }: { url: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || !url) {
    return <Globe className={`${className} text-muted-foreground shrink-0`} />;
  }
  return (
    <img
      src={faviconUrl(url, 32)}
      alt=""
      onError={() => setFailed(true)}
      className={`${className} rounded-[2px] shrink-0 object-contain`}
      loading="lazy"
    />
  );
}

/**
 * 标签页引用区 (参考 Gemini 侧边栏三态设计):
 * 1. 单引用态: 正在引用「页面标题」标签页 + X 移除
 * 2. 多引用折叠态: 多个网站 favicon + 正在引用 N 个标签页 + 展开箭头
 * 3. 展开态: 标题条 + 逐行引用列表(favicon + 标题 + X), hover 悬浮
 */
export function TabRefBar({ refTabs, onRemoveRefTab }: TabRefBarProps) {
  const [expanded, setExpanded] = useState(false);

  if (!refTabs || refTabs.length === 0) return null;

  const count = refTabs.length;

  // 1. 单引用态: 极简通栏条目
  if (count === 1) {
    const tab = refTabs[0]!;
    return (
      <div className="w-full select-none animate-in fade-in-0 duration-150 motion-reduce:animate-none">
        <div
          className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-t-lg border-b border-border/50 bg-muted/40 text-xs text-foreground group/single transition-colors hover:bg-muted/60"
          title={tab.url}
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <FaviconIcon url={tab.url} className="size-3.5" />
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

  // 2 & 3. 多引用态 (折叠 / 展开)
  return (
    <div className="w-full select-none rounded-t-lg border-b border-border/50 bg-muted/40 text-xs text-foreground animate-in fade-in-0 duration-150 motion-reduce:animate-none">
      {/* 头部摘要栏 (点击可展开/收起) */}
      <div
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center justify-between gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-muted/60 transition-colors"
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {/* 多 Favicon 紧凑堆叠 / 并排 */}
          <div className="flex items-center -space-x-1 shrink-0 pr-0.5">
            {refTabs.slice(0, 4).map((t) => (
              <div
                key={t.id}
                className="relative ring-1 ring-background rounded-[2px] bg-background"
              >
                <FaviconIcon url={t.url} className="size-3.5" />
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
      {expanded && (
        <div className="px-1.5 pb-1.5 pt-0.5 space-y-0.5 max-h-40 overflow-y-auto border-t border-border/30 animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none">
          {refTabs.map((t, idx) => (
            <div
              key={t.id}
              className="group/item flex items-center justify-between gap-2 px-2 py-1 rounded-md hover:bg-background/80 transition-colors text-[11px]"
              title={t.url}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <FaviconIcon url={t.url} className="size-3.5" />
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
      )}
    </div>
  );
}
