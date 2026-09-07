import React, { useState } from 'react';
import { i18n } from '#i18n';
import { FoldVertical } from 'lucide-react';
import type { ContextUsage } from '@/lib/contextTokens';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ContextRing, formatTokensShort } from './ContextRing';

/** 三角色 token 占比(本地估算,组合层传入) */
export interface RoleShares {
  user: number;
  assistant: number;
  toolResult: number;
}

interface ContextPanelProps {
  usage: ContextUsage;
  roleShares?: RoleShares | null;
  isStreaming?: boolean;
  isCompacting?: boolean;
  modelName?: string;
  /** 压缩上下文(可附补充重点) */
  onCompact?: (customInstructions?: string) => void;
}

const ROLE_SEGMENTS: { key: keyof RoleShares; label: string; className: string; dotClass: string }[] = [
  { key: 'user', label: i18n.t('context.roleUser'), className: 'bg-foreground', dotClass: 'bg-foreground' },
  { key: 'assistant', label: i18n.t('context.roleAssistant'), className: 'bg-foreground/50', dotClass: 'bg-foreground/50' },
  { key: 'toolResult', label: i18n.t('context.roleTool'), className: 'bg-foreground/20', dotClass: 'bg-foreground/20' },
];

/** 点击环弹出的上下文面板:大数字 + 分解 + 角色占比条 + 压缩操作 */
export function ContextPanel({
  usage,
  roleShares,
  isStreaming,
  isCompacting,
  modelName,
  onCompact,
}: ContextPanelProps) {
  const [instructions, setInstructions] = useState('');
  const [popoverOpen, setPopoverOpen] = useState(false);
  const shares = roleShares ?? { user: 0, assistant: 0, toolResult: 0 };
  const total = shares.user + shares.assistant + shares.toolResult;
  const pctOf = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0);

  const submitCompact = () => {
    if (isCompacting) return;
    onCompact?.(instructions.trim() || undefined);
    setInstructions('');
  };

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex items-center justify-center size-7 rounded-md outline-none transition-colors hover:bg-muted/70 text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
            aria-label={i18n.t('context.detailsTitle')}
          />
        }
      >
        {/* hover 简要 HoverCard 与点击面板并存:面板展开时收起 hover 卡避免重叠 */}
        <ContextRing
          usage={usage}
          isStreaming={isStreaming}
          modelName={modelName}
          showTooltip={!popoverOpen}
        />
      </PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={8} className="w-64 space-y-2.5 p-3 shadow-lg border-border">
        {/* 汇总大数字 */}
        <div className="flex items-baseline justify-between gap-2 border-b border-border/50 pb-2">
          <div>
            <p className="text-sm font-semibold tracking-tight text-foreground font-mono">
              {formatTokensShort(usage.tokens)}
              <span className="text-xs font-normal text-muted-foreground">
                {' '}
                / {formatTokensShort(usage.window)}
              </span>
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {i18n.t('context.usageLabel')} <span className="font-mono font-medium text-foreground">{usage.pct.toFixed(2)}%</span>
            </p>
          </div>
          {modelName && (
            <span className="max-w-[100px] truncate rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground text-right" title={modelName}>
              {modelName}
            </span>
          )}
        </div>

        {/* 精确锚点 / 估算尾部 分解 */}
        <div className="space-y-1 rounded-md bg-muted/40 p-2 text-[10px] text-muted-foreground">
          {usage.hasUsageAnchor ? (
            <>
              <div className="flex justify-between items-center">
                <span>{i18n.t('context.anchor')}</span>
                <span className="font-mono text-foreground/90 font-medium">{formatTokensShort(usage.usageTokens)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>{i18n.t('context.tail')}</span>
                <span className="font-mono text-foreground/90 font-medium">{formatTokensShort(usage.trailingTokens)}</span>
              </div>
            </>
          ) : (
            <p className="italic text-muted-foreground/90">{i18n.t('context.estimateOnlyPanel')}</p>
          )}
        </div>

        {/* 三角色占比条 */}
        {total > 0 && (
          <div className="space-y-1.5 pt-0.5">
            <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted/80">
              {ROLE_SEGMENTS.map((seg) => {
                const pct = pctOf(shares[seg.key]);
                if (pct <= 0) return null;
                return (
                  <div
                    key={seg.key}
                    className={seg.className}
                    style={{ width: `${pct}%` }}
                  />
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              {ROLE_SEGMENTS.map((seg) => (
                <span key={seg.key} className="flex items-center gap-1">
                  <span className={`inline-block size-1.5 rounded-full ${seg.dotClass}`} />
                  {seg.label} <span className="font-mono text-[9px] font-medium text-foreground/80">{pctOf(shares[seg.key])}%</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <Separator className="opacity-60" />

        {/* 压缩操作:可选补充重点 + 一键压缩 */}
        <div className="space-y-1.5">
          <Input
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            disabled={isCompacting}
            placeholder={i18n.t('context.compactPlaceholder')}
            className="h-7 text-[11px] bg-background/60 focus-visible:ring-1"
          />
          <Button
            type="button"
            size="sm"
            className="h-7 w-full gap-1.5 text-[11px] cursor-pointer font-medium"
            disabled={isCompacting}
            onClick={submitCompact}
          >
            {isCompacting ? (
              <>
                <Spinner className="size-3 shrink-0" />
                <span>{i18n.t('context.compacting')}</span>
              </>
            ) : (
              <>
                <FoldVertical className="size-3 shrink-0" />
                <span>{i18n.t('context.compactAction')}</span>
              </>
            )}
          </Button>
        </div>

        <p className="text-[10px] text-muted-foreground/75 leading-tight pt-0.5">
          {i18n.t('context.note')}
        </p>
      </PopoverContent>
    </Popover>
  );
}
