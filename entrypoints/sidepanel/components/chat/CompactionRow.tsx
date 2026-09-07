import React, { useState } from 'react';
import { i18n } from '#i18n';
import { ChevronDown, ChevronRight, FoldVertical } from 'lucide-react';
import { MarkdownView } from './MarkdownView';
import { formatTokensShort } from './ContextRing';
import { Marker, MarkerContent } from '@/components/ui/marker';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';

/** 剥掉摘要消息的 <context-summary> 包裹(展示摘要正文;<page-refs> 块由 messageText 剥离) */
function stripSummaryWrapper(text: string): string {
  return text
    .replace(/^\s*<context-summary>\s*\n?/, '')
    .replace(/\n?\s*<\/context-summary>\s*$/, '')
    .trim();
}

interface CompactionRowProps {
  tokensBefore: number;
  /** 摘要 user 消息的 content(rawText) */
  summary: string;
}

/** 压缩分隔线卡(Cline 风格):官方 Marker separator 样式,可展开看摘要全文 */
export function CompactionRow({ tokensBefore, summary }: CompactionRowProps) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="px-3 py-2">
      <Marker variant="separator" className="my-1">
        <MarkerContent>
          <CollapsibleTrigger
            render={
              <button
                type="button"
                className="flex max-w-[85%] items-center gap-1.5 rounded-full border border-border bg-muted/60 hover:bg-accent px-2.5 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground cursor-pointer select-none shadow-2xs"
                title={i18n.t(open ? 'compaction.collapse' : 'compaction.expand')}
              />
            }
          >
            <FoldVertical className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {i18n.t('compaction.title', { before: formatTokensShort(tokensBefore) })}
            </span>
            {open ? (
              <ChevronDown className="size-3 shrink-0 opacity-70" />
            ) : (
              <ChevronRight className="size-3 shrink-0 opacity-70" />
            )}
          </CollapsibleTrigger>
        </MarkerContent>
      </Marker>

      <CollapsibleContent>
        <div className="mx-auto mt-2 max-w-[95%] rounded-lg border border-border/80 bg-card p-3 shadow-xs animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none">
          <div className="flex items-center justify-between border-b border-border/50 pb-1.5 mb-2">
            <span className="text-[11px] font-semibold text-foreground">{i18n.t('compaction.fullTitle')}</span>
            <span className="text-[10px] text-muted-foreground font-mono">
              {i18n.t('compaction.originalTokens', { tokens: formatTokensShort(tokensBefore) })}
            </span>
          </div>
          <MarkdownView content={stripSummaryWrapper(summary)} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
