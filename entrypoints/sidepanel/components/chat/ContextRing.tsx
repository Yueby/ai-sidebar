import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { i18n } from '#i18n';
import type { ContextUsage } from '@/lib/contextTokens';

/** token 缩写(146K 风格);非有限值(缺字段/坏数据)兜底为 0,杜绝空白数值 */
export function formatTokensShort(n: number): string {
  if (!Number.isFinite(n)) return '0';
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

/** 上下文占用环:size-5 SVG 进度环;<60% 中性 / 60-85% warning / ≥85% destructive;hover 时以官方 HoverCard 展示明细 */
export function ContextRing({ usage, isStreaming, modelName, showTooltip = true }: ContextRingProps) {
  const C = 2 * Math.PI * 7.5;
  const clampedPct = Math.max(0, Math.min(100, usage.pct));
  // 极小正占比(如 1%~3%)给予视觉保底(至少 4% 弧段)确保在 strokeLinecap="round" 下清晰可见
  const effectivePct = clampedPct > 0 ? Math.max(clampedPct, 4) : 0;
  const ringColorClass =
    usage.pct >= 85
      ? 'stroke-destructive'
      : usage.pct >= 60
        ? 'stroke-warning'
        : 'stroke-foreground/75 dark:stroke-foreground/80';

  const ringNode = (
    <span
      className={`relative inline-flex size-5 items-center justify-center ${isStreaming ? 'animate-pulse' : ''}`}
      aria-label={i18n.t('context.aria', { pct: usage.pct })}
    >
      <svg viewBox="0 0 20 20" className="size-5 -rotate-90">
        <circle
          cx="10"
          cy="10"
          r="7.5"
          fill="none"
          strokeWidth="2.2"
          className="stroke-muted/80 dark:stroke-muted/50"
        />
        {effectivePct > 0 && (
          <circle
            cx="10"
            cy="10"
            r="7.5"
            fill="none"
            strokeWidth="2.2"
            strokeLinecap="round"
            className={`${ringColorClass} transition-[stroke-dashoffset,stroke] duration-500 ease-out`}
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
    <HoverCard>
      <HoverCardTrigger delay={200} closeDelay={150} render={ringNode} />
      <HoverCardContent
        side="top"
        align="center"
        className="w-56 space-y-1.5 p-2.5 text-xs"
      >
        <div className="flex items-baseline justify-between gap-2 border-b border-border/50 pb-1">
          <span className="font-semibold text-foreground text-xs font-mono">
            {formatTokensShort(usage.tokens ?? 0)}{' '}
            <span className="text-[10px] font-normal text-muted-foreground font-sans">
              / {formatTokensShort(usage.window ?? 0)}
            </span>
          </span>
          <span className="font-mono text-[10px] font-semibold text-foreground">
            {(usage.pct ?? 0).toFixed(2)}%
          </span>
        </div>
        {usage.hasUsageAnchor ? (
          <div className="space-y-0.5 text-[10px] text-muted-foreground">
            <div className="flex justify-between items-center">
              <span>{i18n.t('context.anchor')}</span>
              <span className="font-mono text-foreground/80">{formatTokensShort(usage.usageTokens ?? 0)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span>{i18n.t('context.tail')}</span>
              <span className="font-mono text-foreground/80">{formatTokensShort(usage.trailingTokens ?? 0)}</span>
            </div>
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground italic">{i18n.t('context.estimateOnlyRing')}</p>
        )}
        {modelName && (
          <p className="truncate text-[9px] text-muted-foreground/80 pt-1 border-t border-border/40 font-mono">
            {modelName}
          </p>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
