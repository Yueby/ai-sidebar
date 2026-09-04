import React, { useState } from 'react';
import { i18n } from '#i18n';
import {
  ShieldAlert,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  SendHorizontal,
  PenLine,
} from 'lucide-react';
import type { GateRequest } from '@/entrypoints/sidepanel/gateAdapter';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

interface ApprovalSectionProps {
  request: GateRequest;
  /** grant:确认卡上“暂时允许”勾选态(仅 grantable 的 confirm 会传;工具+当前页粒度,关面板失效) */
  onApprove: (grant?: boolean) => void;
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
  // 代码详情默认展开(用户点「允许」前看到完整代码);保留手动折叠开关
  const [detailOpen, setDetailOpen] = useState(true);
  const [inputText, setInputText] = useState('');
  const [isCustomInputOpen, setIsCustomInputOpen] = useState(false);
  // 点击审批就地 loading 态 (Cline 模式防重)
  const [pendingAction, setPendingAction] = useState<'approve' | 'deny' | 'answer' | 'cancel' | null>(null);
  const [activeOptionAnswer, setActiveOptionAnswer] = useState<string | null>(null);
  // 会话级 grant 勾选(仅 grantable 的 confirm;勾选后允许 = 记录工具+tab 范围,同类后续免确认)
  const [grantChecked, setGrantChecked] = useState(false);

  const handleApproveClick = () => {
    if (pendingAction) return;
    setPendingAction('approve');
    onApprove(grantChecked || undefined);
  };

  const handleDenyClick = () => {
    if (pendingAction) return;
    setPendingAction('deny');
    onDeny();
  };

  const handleOptionClick = (answer: string) => {
    if (pendingAction) return;
    setPendingAction('answer');
    setActiveOptionAnswer(answer);
    onAnswer(answer);
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed || pendingAction) return;
    setPendingAction('answer');
    setActiveOptionAnswer(trimmed);
    onAnswer(trimmed);
  };

  const handleCancelClick = () => {
    if (pendingAction) return;
    setPendingAction('cancel');
    onCancel();
  };

  const isConfirm = request.kind === 'confirm';
  const headerIcon = isConfirm ? (
    <ShieldAlert className="size-3.5 text-amber-500 shrink-0 mt-0.5" />
  ) : (
    <HelpCircle className="size-3.5 text-blue-500 shrink-0 mt-0.5" />
  );

  const containerTheme = isConfirm
    ? 'border-amber-500/30 bg-amber-500/5'
    : 'border-blue-500/30 bg-blue-500/5';

  const dividerTheme = isConfirm
    ? 'border-amber-500/20'
    : 'border-blue-500/20';

  return (
    <div className={`rounded-md border p-2.5 space-y-2.5 text-xs text-foreground ${containerTheme}`}>
      {/* 1. 壳头部 + 内容主文案 (Summary 或 Question) */}
      <div className="flex items-start gap-1.5">
        {headerIcon}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-foreground leading-relaxed break-all font-medium whitespace-pre-wrap">
            {isConfirm ? request.summary : request.question}
          </p>
        </div>
      </div>

      {/* 2. 内容区: confirm 详情 (可选折叠代码) */}
      {isConfirm && request.detail && (
        <div className="space-y-1 pl-5">
          <button
            type="button"
            onClick={() => setDetailOpen((prev) => !prev)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground select-none transition-colors py-0.5 cursor-pointer"
          >
            {detailOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            <span>{detailOpen ? i18n.t('approval.hideCode') : i18n.t('approval.showCode')}</span>
          </button>

          {detailOpen && (
            <pre className="font-mono text-[10px] bg-background/90 p-2 rounded border border-border/50 max-h-48 overflow-y-auto overflow-x-auto whitespace-pre-wrap break-all text-muted-foreground leading-relaxed animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none">
              {request.detail}
            </pre>
          )}
        </div>
      )}

      {/* 2. 内容区: ask 选项列表 (全宽纵向排列 + 自定义回答作为最后一项) */}
      {!isConfirm && (
        <div className="space-y-1.5 pl-5">
          {/* 预设选项列表 (纵向从上往下排列，超过 6 项时内部限制高度滚动，保证头部与跳过按钮可见) */}
          {request.options && request.options.length > 0 && (
            <div className="space-y-1 max-h-52 overflow-y-auto pr-0.5">
              {request.options.map((opt, i) => {
                const isThisLoading = pendingAction === 'answer' && activeOptionAnswer === opt;
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={pendingAction !== null}
                    onClick={() => handleOptionClick(opt)}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border border-border/70 bg-background/80 hover:bg-accent hover:text-accent-foreground text-left text-xs font-normal transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed group/opt"
                  >
                    <span className="truncate flex-1 leading-snug">{opt}</span>
                    {isThisLoading ? (
                      <Loader2 className="size-3 animate-spin shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-3 text-muted-foreground group-hover/opt:translate-x-0.5 transition-transform shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* 自定义回答项 (融入选项列表，作为最后一项) */}
          <div className="pt-0.5">
            {!isCustomInputOpen && !inputText ? (
              <button
                type="button"
                disabled={pendingAction !== null}
                onClick={() => setIsCustomInputOpen(true)}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border border-dashed border-border/80 bg-background/50 hover:bg-background hover:border-border text-left text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <PenLine className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate text-[11px]">{i18n.t('approval.customAnswer')}</span>
                </div>
                <ChevronRight className="size-3 text-muted-foreground shrink-0" />
              </button>
            ) : (
              <form
                onSubmit={handleCustomSubmit}
                className="flex items-center gap-1.5 rounded-md border border-border/80 bg-background/90 p-1 animate-in fade-in-0 duration-150 motion-reduce:animate-none"
              >
                <Input
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  disabled={pendingAction !== null}
                  placeholder={i18n.t('approval.customPlaceholder')}
                  className="h-6.5 text-[11px] flex-1 min-w-0 border-0 shadow-none focus-visible:ring-0 px-1.5 bg-transparent"
                  autoFocus
                />

                <Button
                  type="submit"
                  size="sm"
                  disabled={!inputText.trim() || pendingAction !== null}
                  className="h-6 text-[11px] px-2 shrink-0 cursor-pointer gap-1"
                >
                  {pendingAction === 'answer' && activeOptionAnswer === inputText.trim() ? (
                    <Loader2 className="size-3 animate-spin shrink-0" />
                  ) : (
                    <SendHorizontal className="size-3 shrink-0" />
                  )}
                  <span>{i18n.t('approval.submit')}</span>
                </Button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* 3. 会话级 grant 复选框 (仅 grantable 的 confirm) */}
      {isConfirm && request.grantable && (
        <div className="pl-5">
          <label
            className={`group/grant flex items-center gap-2 px-2 py-1.5 rounded-md border transition-all select-none cursor-pointer ${
              grantChecked
                ? 'border-amber-500/35 bg-amber-500/10 text-amber-950 dark:text-amber-100 shadow-2xs'
                : 'border-border/40 bg-background/50 hover:bg-background/80 text-muted-foreground hover:text-foreground'
            } ${pendingAction !== null ? 'opacity-60 cursor-not-allowed pointer-events-none' : ''}`}
          >
            <Checkbox
              checked={grantChecked}
              onCheckedChange={(v) => setGrantChecked(v === true)}
              disabled={pendingAction !== null}
              className="size-3.5 rounded-[3px] border-amber-500/40 data-[state=checked]:border-amber-600 data-[state=checked]:bg-amber-600 dark:data-[state=checked]:bg-amber-500 dark:data-[state=checked]:border-amber-500 data-[state=checked]:text-white dark:data-[state=checked]:text-neutral-950"
            />
            <div className="flex-1 min-w-0 flex items-center justify-between gap-1.5">
              <span className="text-[11px] leading-snug font-normal truncate">
                {i18n.t('approval.grantLabel', { label: request.label })}
              </span>
              <span
                className={`text-[9px] shrink-0 font-medium px-1 py-0.2 rounded transition-colors ${
                  grantChecked
                    ? 'text-amber-700 dark:text-amber-300 bg-amber-500/15'
                    : 'text-muted-foreground/70 group-hover/grant:text-muted-foreground'
                }`}
              >
                {i18n.t('approval.grantHint')}
              </span>
            </div>
          </label>
        </div>
      )}

      {/* 4. 统一操作区 (底部分割线 + 动作按钮) */}
      <div className={`flex items-center justify-end gap-1.5 pt-1.5 border-t ${dividerTheme}`}>
        {isConfirm ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pendingAction !== null}
              onClick={handleDenyClick}
              className="h-6 text-[11px] px-2.5 cursor-pointer gap-1"
            >
              {pendingAction === 'deny' && <Loader2 className="size-3 animate-spin shrink-0" />}
              <span>{pendingAction === 'deny' ? i18n.t('approval.denying') : i18n.t('approval.deny')}</span>
            </Button>

            <Button
              type="button"
              size="sm"
              variant="default"
              disabled={pendingAction !== null}
              onClick={handleApproveClick}
              className={`h-6 text-[11px] px-2.5 cursor-pointer gap-1 transition-colors ${
                grantChecked
                  ? 'bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-500 dark:hover:bg-amber-600 dark:text-neutral-950 shadow-xs'
                  : ''
              }`}
            >
              {pendingAction === 'approve' && <Loader2 className="size-3 animate-spin shrink-0" />}
              <span>
                {pendingAction === 'approve'
                  ? i18n.t('approval.allowing')
                  : grantChecked
                    ? i18n.t('approval.allowRemember')
                    : i18n.t('approval.allow')}
              </span>
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pendingAction !== null}
            onClick={handleCancelClick}
            className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground cursor-pointer gap-1"
          >
            {pendingAction === 'cancel' && <Loader2 className="size-3 animate-spin shrink-0" />}
            <span>{pendingAction === 'cancel' ? i18n.t('approval.skipping') : i18n.t('approval.skip')}</span>
          </Button>
        )}
      </div>
    </div>
  );
}
