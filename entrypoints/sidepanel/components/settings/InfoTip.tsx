import React from 'react';
import { Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface InfoTipProps {
  content: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  iconClassName?: string;
}

/**
 * 设置页通用提示按钮:
 * 用于替换卡片/行级副标题,hover 弹出 Tooltip 展示原 desc 说明。
 */
export function InfoTip({
  content,
  side = 'left',
  className,
  iconClassName,
}: InfoTipProps) {
  if (!content) return null;

  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className={cn(
                'inline-flex size-4 items-center justify-center rounded text-muted-foreground/80 hover:text-foreground cursor-pointer transition-colors shrink-0',
                className,
              )}
              onClick={(e) => e.stopPropagation()}
              aria-label="Info"
            />
          }
        >
          <Info className={cn('size-3', iconClassName)} />
        </TooltipTrigger>
        <TooltipContent
          side={side}
          className="max-w-[260px] leading-normal"
        >
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
