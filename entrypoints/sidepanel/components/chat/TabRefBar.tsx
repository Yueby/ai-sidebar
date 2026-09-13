import React, { useState } from 'react';
import { i18n } from '#i18n';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import type { RefTab } from '@/lib/pageContext';
import { cn } from '@/lib/utils';
import { FaviconIcon } from './FaviconIcon';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface TabRefBarProps {
  refTabs: RefTab[];
  onRemoveRefTab: (id: number) => void;
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
      <TooltipProvider delay={200}>
        <div className="relative z-0 w-full select-none animate-in fade-in-0 duration-150 motion-reduce:animate-none">
          <div
            className="flex items-center justify-between gap-2 px-2.5 pt-1.5 pb-3 rounded-t-lg border border-b-0 border-border/70 bg-[color-mix(in_srgb,var(--color-muted)_40%,var(--color-background))] text-xs text-foreground group/single transition-colors hover:bg-[color-mix(in_srgb,var(--color-muted)_60%,var(--color-background))]"
          >
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <FaviconIcon url={tab.url} tabId={tab.id} className="size-3.5" />
              <span className="text-[11px] text-muted-foreground shrink-0 font-normal">
                {i18n.t('refBar.referencing')}
              </span>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="font-medium truncate text-[11px] text-foreground max-w-[calc(100%-90px)] cursor-default">
                      “{tab.title || tab.url}”
                    </span>
                  }
                />
                <TooltipContent side="top">
                  {tab.url}
                </TooltipContent>
              </Tooltip>
              <span className="text-[11px] text-muted-foreground shrink-0 font-normal">
                标签页
              </span>
            </div>

            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveRefTab(tab.id);
                    }}
                    className="text-muted-foreground/70 hover:text-foreground rounded p-0.5 hover:bg-background/80 transition-colors shrink-0"
                    aria-label={i18n.t('refBar.removeRefTitle')}
                  >
                    <X className="size-3" />
                  </button>
                }
              />
              <TooltipContent side="top">
                {i18n.t('refBar.removeRefTitle')}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </TooltipProvider>
    );
  }

  // 2 & 3. 多引用态 (折叠 / 展开): 独立卡片控件
  return (
    <TooltipProvider delay={200}>
      <div className="relative z-0 w-full select-none rounded-t-lg border border-b-0 border-border/70 bg-[color-mix(in_srgb,var(--color-muted)_40%,var(--color-background))] text-xs text-foreground animate-in fade-in-0 duration-150 motion-reduce:animate-none">
        {/* 头部摘要栏 (点击可展开/收起) */}
        <div
          onClick={() => setExpanded((prev) => !prev)}
          className={`flex items-center justify-between gap-2 px-2.5 pt-1.5  hover:bg-[color-mix(in_srgb,var(--color-muted)_60%,var(--color-background))] transition-colors ${
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
                  <FaviconIcon url={t.url} tabId={t.id} className="size-3.5" />
                </div>
              ))}
              {count > 4 && (
                <span className="text-[9px] text-muted-foreground font-mono pl-1.5">
                  +{count - 4}
                </span>
              )}
            </div>

            <span className="text-[11px] text-foreground font-medium truncate">
              {i18n.t('refBar.referencingCount', { count })}
            </span>
          </div>

          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded((prev) => !prev);
                  }}
                  className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors shrink-0"
                  aria-label={i18n.t(expanded ? 'refBar.collapseList' : 'refBar.expandList')}
                >
                  {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                </button>
              }
            />
            <TooltipContent side="top">
              {i18n.t(expanded ? 'refBar.collapseList' : 'refBar.expandList')}
            </TooltipContent>
          </Tooltip>
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
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <FaviconIcon url={t.url} tabId={t.id} className="size-3.5" />
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span className="truncate font-normal text-foreground cursor-default">
                            {t.title || t.url}
                          </span>
                        }
                      />
                      <TooltipContent side="top">
                        {t.url}
                      </TooltipContent>
                    </Tooltip>
                    {idx === 0 && (
                      <span className="shrink-0 text-[9px] font-normal px-1 py-0.2 rounded bg-secondary text-muted-foreground">
                        当前页
                      </span>
                    )}
                  </div>

                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          onClick={() => onRemoveRefTab(t.id)}
                          className="opacity-60 group-hover/item:opacity-100 text-muted-foreground hover:text-foreground p-0.5 hover:bg-muted rounded transition-colors shrink-0"
                          aria-label={i18n.t('refBar.removeRefTitle')}
                        >
                          <X className="size-3" />
                        </button>
                      }
                    />
                    <TooltipContent side="top">
                      {i18n.t('refBar.removeRefTitle')}
                    </TooltipContent>
                  </Tooltip>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
