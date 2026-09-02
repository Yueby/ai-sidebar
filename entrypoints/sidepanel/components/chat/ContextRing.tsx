import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { ContextUsage } from '@/lib/contextTokens';

/** token 缩写(146K 风格) */
export function formatTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

interface ContextRingProps {
  usage: ContextUsage;
  isStreaming?: boolean;
  modelName?: string;
  showTooltip?: boolean;
}

/** 上下文占用环:size-5 SVG 进度环;<60% 中性 / 60-85% amber / ≥85% destructive;hover tooltip */
export function ContextRing({ usage, isStreaming, modelName, showTooltip = true }: ContextRingProps) {
  const C = 2 * Math.PI * 7.5;
  const clampedPct = Math.max(0, Math.min(100, usage.pct));
  // 极小正占比(如 1%~3%)给予视觉保底(至少 offset 保留微小弧段)避免被 strokeLinecap="round" 截断不可见
  const effectivePct = clampedPct > 0 ? Math.max(clampedPct, 3) : 0;
  const ringColorClass =
    usage.pct >= 85
      ? 'stroke-destructive'
      : usage.pct >= 60
        ? 'stroke-amber-500 dark:stroke-amber-400'
        : 'stroke-muted-foreground/80';

  const ringNode = (
    <span
      className={`relative inline-flex size-5 items-center justify-center ${isStreaming ? 'animate-pulse' : ''}`}
      aria-label={`上下文占用 ${usage.pct}%`}
    >
      <svg viewBox="0 0 20 20" className="size-5 -rotate-90">
        <circle
          cx="10"
          cy="10"
          r="7.5"
          fill="none"
          strokeWidth="2.2"
          className="stroke-muted/60 dark:stroke-muted/40"
        />
        {effectivePct > 0 && (
          <circle
            cx="10"
            cy="10"
            r="7.5"
            fill="none"
            strokeWidth="2.2"
            strokeLinecap="round"
            className={`${ringColorClass} transition-[stroke-dashoffset,stroke] duration-300 ease-out`}
            strokeDasharray={C}
            strokeDashoffset={C * (1 - effectivePct / 100)}
          />
        )}
      </svg>
    </span>
  );

  if (!showTooltip) {
    return ringNode;
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          {ringNode}
        </TooltipTrigger>
        <TooltipContent side="top" align="center" className="max-w-56 space-y-1.5 p-2 text-xs">
          <div className="flex items-baseline justify-between gap-2 border-b border-border/50 pb-1">
            <span className="font-semibold text-foreground text-xs font-mono">
              {formatTokensShort(usage.tokens)}{' '}
              <span className="text-[10px] font-normal text-muted-foreground font-sans">
                / {formatTokensShort(usage.window)}
              </span>
            </span>
            <span className="font-mono text-[10px] font-semibold text-foreground">
              {usage.pct}%
            </span>
          </div>
          {usage.hasUsageAnchor ? (
            <div className="space-y-0.5 text-[10px] text-muted-foreground">
              <div className="flex justify-between items-center">
                <span>精确锚点:</span>
                <span className="font-mono text-foreground/80">{formatTokensShort(usage.usageTokens)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>估算尾部:</span>
                <span className="font-mono text-foreground/80">{formatTokensShort(usage.trailingTokens)}</span>
              </div>
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground italic">纯估算值(暂无模型精确返回)</p>
          )}
          {modelName && (
            <p className="truncate text-[9px] text-muted-foreground/80 pt-1 border-t border-border/40 font-mono" title={modelName}>
              {modelName}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
