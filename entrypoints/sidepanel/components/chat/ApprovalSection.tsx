import React, { useState } from 'react';
import {
  ShieldAlert,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import type { GateRequest } from '@/entrypoints/sidepanel/gateAdapter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ApprovalSectionProps {
  request: GateRequest;
  onApprove: () => void;
  onDeny: () => void;
  onAnswer: (answer: string) => void;
  onCancel: () => void;
}

export function ApprovalSection({
  request,
  onApprove,
  onDeny,
  onAnswer,
  onCancel,
}: ApprovalSectionProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  // 点击审批就地 loading 态 (Cline 模式防重)
  const [pendingAction, setPendingAction] = useState<'approve' | 'deny' | 'answer' | 'cancel' | null>(null);

  const handleApproveClick = () => {
    if (pendingAction) return;
    setPendingAction('approve');
    onApprove();
  };

  const handleDenyClick = () => {
    if (pendingAction) return;
    setPendingAction('deny');
    onDeny();
  };

  const handleAnswerClick = (answer: string) => {
    if (pendingAction) return;
    setPendingAction('answer');
    onAnswer(answer);
  };

  const handleCancelClick = () => {
    if (pendingAction) return;
    setPendingAction('cancel');
    onCancel();
  };

  if (request.kind === 'confirm') {
    return (
      <div className="mt-2.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-2 text-xs text-foreground animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none">
        {/* Summary */}
        <div className="flex items-start gap-1.5">
          <ShieldAlert className="size-3.5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-foreground leading-relaxed break-all font-medium flex-1">
            {request.summary}
          </p>
        </div>

        {/* Optional Collapsible Detail (code/arguments/selector preview) */}
        {request.detail && (
          <div className="space-y-1 pl-5">
            <button
              type="button"
              onClick={() => setDetailOpen((prev) => !prev)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground select-none transition-colors py-0.5 cursor-pointer"
            >
              {detailOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              <span>{detailOpen ? '收起代码详情' : '查看代码详情'}</span>
            </button>

            {detailOpen && (
              <pre className="font-mono text-[10px] bg-background/90 p-2 rounded border border-border/50 max-h-36 overflow-x-auto whitespace-pre-wrap break-all text-muted-foreground leading-relaxed animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none">
                {request.detail}
              </pre>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-1.5 pt-1.5 border-t border-amber-500/20">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pendingAction !== null}
            onClick={handleDenyClick}
            className="h-6 text-[11px] px-2.5 cursor-pointer gap-1"
          >
            {pendingAction === 'deny' && <Loader2 className="size-3 animate-spin shrink-0" />}
            <span>{pendingAction === 'deny' ? '拒绝中…' : '拒绝'}</span>
          </Button>

          <Button
            type="button"
            size="sm"
            variant="default"
            disabled={pendingAction !== null}
            onClick={handleApproveClick}
            className="h-6 text-[11px] px-2.5 cursor-pointer gap-1"
          >
            {pendingAction === 'approve' && <Loader2 className="size-3 animate-spin shrink-0" />}
            <span>{pendingAction === 'approve' ? '允许中…' : '允许'}</span>
          </Button>
        </div>
      </div>
    );
  }

  // Kind: 'ask'
  return (
    <div className="mt-2.5 rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 space-y-2 text-xs text-foreground animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none">
      {/* Question Text */}
      <div className="flex items-start gap-1.5">
        <HelpCircle className="size-3.5 text-blue-500 shrink-0 mt-0.5" />
        <p className="text-xs text-foreground leading-relaxed break-all font-medium whitespace-pre-wrap flex-1">
          {request.question}
        </p>
      </div>

      {/* Quick options if available */}
      {request.options && request.options.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pl-5 pt-0.5">
          {request.options.map((opt, i) => (
            <Button
              key={i}
              type="button"
              size="sm"
              variant="secondary"
              disabled={pendingAction !== null}
              onClick={() => handleAnswerClick(opt)}
              className="h-6 text-[11px] px-2 font-normal max-w-full truncate cursor-pointer"
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
          if (trimmed && !pendingAction) {
            handleAnswerClick(trimmed);
            setInputText('');
          }
        }}
        className="flex items-center gap-1.5 pt-1.5 border-t border-blue-500/20"
      >
        <Input
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          disabled={pendingAction !== null}
          placeholder="输入你的回答..."
          className="h-6.5 text-[11px] flex-1 min-w-0 bg-background/90"
          autoFocus
        />

        <Button
          type="submit"
          size="sm"
          disabled={!inputText.trim() || pendingAction !== null}
          className="h-6.5 text-[11px] px-2.5 shrink-0 cursor-pointer"
        >
          {pendingAction === 'answer' ? '提交中…' : '提交'}
        </Button>

        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pendingAction !== null}
          onClick={handleCancelClick}
          className="h-6.5 text-[11px] px-1.5 text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
        >
          跳过
        </Button>
      </form>
    </div>
  );
}
