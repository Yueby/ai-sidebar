import React, { useState } from 'react';
import { ChevronDown, ChevronRight, FoldVertical } from 'lucide-react';
import { MarkdownView } from './MarkdownView';
import { formatTokensShort } from './ContextRing';

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

/** 压缩分隔线卡(Cline 风格):默认收起徽标,可展开看摘要全文(六段 markdown) */
export function CompactionRow({ tokensBefore, summary }: CompactionRowProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="px-3 py-2">
      <div className="my-1 flex items-center gap-2">
        <div className="h-px flex-1 bg-border/80" />
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex max-w-[85%] items-center gap-1.5 rounded-full border border-border bg-muted/60 hover:bg-accent px-2.5 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground cursor-pointer select-none shadow-2xs"
          title={open ? '收起摘要全文' : '展开摘要全文'}
        >
          <FoldVertical className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate">
            上下文已压缩 <strong className="font-mono font-medium text-foreground">{formatTokensShort(tokensBefore)}</strong> → 摘要
          </span>
          {open ? (
            <ChevronDown className="size-3 shrink-0 opacity-70" />
          ) : (
            <ChevronRight className="size-3 shrink-0 opacity-70" />
          )}
        </button>
        <div className="h-px flex-1 bg-border/80" />
      </div>

      {open && (
        <div className="mx-auto mt-2 max-w-[95%] rounded-lg border border-border/80 bg-card p-3 shadow-xs animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none">
          <div className="flex items-center justify-between border-b border-border/50 pb-1.5 mb-2">
            <span className="text-[11px] font-semibold text-foreground">压缩摘要全文</span>
            <span className="text-[10px] text-muted-foreground font-mono">
              原 {formatTokensShort(tokensBefore)} tokens
            </span>
          </div>
          <MarkdownView content={stripSummaryWrapper(summary)} />
        </div>
      )}
    </div>
  );
}
