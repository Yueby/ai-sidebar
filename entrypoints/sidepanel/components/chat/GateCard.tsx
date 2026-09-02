import React, { useState } from 'react';
import {
  ShieldAlert,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  Bot,
} from 'lucide-react';
import type { GateRequest } from '@/entrypoints/sidepanel/gateAdapter';
import { toolLabel } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface GateCardProps {
  request: GateRequest;
  onApprove: () => void;
  onDeny: () => void;
  onAnswer: (answer: string) => void;
  onCancel: () => void;
}

export function GateCard({
  request,
  onApprove,
  onDeny,
  onAnswer,
  onCancel,
}: GateCardProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [inputText, setInputText] = useState('');

  if (request.kind === 'confirm') {
    const displayName = request.label || toolLabel(request.toolName) || request.toolName;

    return (
      <div className="sticky top-0 z-30 m-2 rounded-lg border border-border bg-card/95 backdrop-blur-xs p-3 shadow-md space-y-2.5 text-xs text-foreground animate-in fade-in-0 slide-in-from-top-2 duration-150 motion-reduce:animate-none">
        {/* Header */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
              <ShieldAlert className="size-3.5 text-amber-500" />
            </div>
            <span className="font-semibold text-xs truncate">
              {displayName}
            </span>
            {request.toolName && request.toolName !== displayName && (
              <span className="text-[10px] text-muted-foreground font-mono truncate">
                ({request.toolName})
              </span>
            )}
          </div>

          <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground shrink-0">
            需要确认
          </Badge>
        </div>

        {/* Prompt Hint */}
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Bot className="size-3 shrink-0" />
          <span>AI 正在等待你的确认以继续执行</span>
        </div>

        {/* Summary */}
        <p className="text-xs text-foreground leading-relaxed break-all font-medium">
          {request.summary}
        </p>

        {/* Optional Collapsible Detail (code/arguments/selector preview) */}
        {request.detail && (
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setDetailOpen((prev) => !prev)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground select-none transition-colors py-0.5 cursor-pointer"
            >
              {detailOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              <span>{detailOpen ? '收起详情' : '查看详情'}</span>
            </button>

            {detailOpen && (
              <pre className="font-mono text-[10px] bg-muted/40 p-2 rounded border border-border/50 max-h-36 overflow-x-auto whitespace-pre-wrap break-all text-muted-foreground leading-relaxed animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none">
                {request.detail}
              </pre>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/40">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onDeny}
            className="h-7 text-xs px-3"
          >
            拒绝
          </Button>

          <Button
            type="button"
            size="sm"
            variant="default"
            onClick={onApprove}
            className="h-7 text-xs px-3"
          >
            允许
          </Button>
        </div>
      </div>
    );
  }

  // Kind: 'ask'
  return (
    <div className="sticky top-0 z-30 m-2 rounded-lg border border-border bg-card/95 backdrop-blur-xs p-3 shadow-md space-y-2.5 text-xs text-foreground animate-in fade-in-0 slide-in-from-top-2 duration-150 motion-reduce:animate-none">
      {/* Header */}
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
            <HelpCircle className="size-3.5 text-blue-500" />
          </div>
          <span className="font-semibold text-xs truncate">AI 提问</span>
        </div>

        <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground shrink-0">
          等待回复
        </Badge>
      </div>

      {/* Prompt Hint */}
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Bot className="size-3 shrink-0" />
        <span>AI 正在等待你的回答以继续操作</span>
      </div>

      {/* Question Text */}
      <p className="text-xs text-foreground leading-relaxed break-all font-medium whitespace-pre-wrap">
        {request.question}
      </p>

      {/* Quick options if available */}
      {request.options && request.options.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {request.options.map((opt, i) => (
            <Button
              key={i}
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onAnswer(opt)}
              className="h-6.5 text-xs px-2.5 font-normal max-w-full truncate"
            >
              {opt}
            </Button>
          ))}
        </div>
      )}

      {/* Free text input form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = inputText.trim();
          if (trimmed) {
            onAnswer(trimmed);
            setInputText('');
          }
        }}
        className="flex items-center gap-1.5 pt-1 border-t border-border/40"
      >
        <Input
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="输入你的回答..."
          className="h-7 text-xs flex-1 min-w-0"
          autoFocus
        />

        <Button
          type="submit"
          size="sm"
          disabled={!inputText.trim()}
          className="h-7 text-xs px-2.5 shrink-0"
        >
          提交
        </Button>

        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCancel}
          className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground shrink-0"
        >
          跳过
        </Button>
      </form>
    </div>
  );
}

