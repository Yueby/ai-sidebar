import React, { useMemo, useState } from 'react';
import { i18n } from '#i18n';
import {
  ShieldAlert,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  PenLine,
} from 'lucide-react';
import type { GateRequest } from '@/entrypoints/sidepanel/gateAdapter';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Switch } from '@/components/ui/switch';
import {
  Item,
  ItemMedia,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
  ItemFooter,
} from '@/components/ui/item';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import {
  Questionnaire,
  QuestionnaireItem,
  QuestionnaireTitle,
  QuestionnaireChoices,
  QuestionnaireChoice,
  QuestionnaireChoiceInput,
  QuestionnaireChoiceLabel,
  QuestionnaireChoiceShortcut,
  QuestionnaireInput,
  QuestionnaireActions,
  QuestionnaireSkip,
  QuestionnaireSubmit,
} from '@/components/ui/questionnaire';
import { cn } from '@/lib/utils';

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
  // ask 自由文本状态
  const [customText, setCustomText] = useState('');
  const [isCustomInput, setIsCustomInput] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);

  // 点击审批就地 loading 态 (Cline 模式防重)
  const [pendingAction, setPendingAction] = useState<'approve' | 'deny' | 'answer' | 'cancel' | null>(null);

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

  const handleCancelClick = (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    if (pendingAction) return;
    setPendingAction('cancel');
    onCancel();
  };

  const handleFormSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (pendingAction) return;
    const answer = (isCustomInput || !selectedChoice ? customText.trim() : selectedChoice) || customText.trim();
    if (!answer) return;
    setPendingAction('answer');
    onAnswer(answer);
  };

  const isConfirm = request.kind === 'confirm';

  // 1. 确认门控卡 (confirm 门控): 官方 Item + ButtonGroup 范式
  if (isConfirm) {
    const isDanger = request.toolName === 'execute_js';

    return (
      <Item
        variant="outline"
        className={cn(
          'flex-col items-stretch gap-2.5 p-3 text-xs rounded-lg transition-colors border shadow-2xs',
          isDanger
            ? 'border-destructive/40 bg-destructive/5 dark:bg-destructive/10 text-foreground'
            : 'border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/10 text-foreground'
        )}
      >
        {/* 头部行: ItemMedia 图标 + ItemContent (工具名 ItemTitle + 参数摘要 ItemDescription) */}
        <div className="flex items-start gap-2.5 min-w-0">
          <ItemMedia
            variant="icon"
            className={cn(
              'size-7 rounded-md shrink-0 mt-0.5',
              isDanger
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
            )}
          >
            <ShieldAlert className="size-4" />
          </ItemMedia>

          <ItemContent className="min-w-0 flex-1 gap-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <ItemTitle className="text-xs font-semibold text-foreground truncate">
                {request.label || request.toolName}
              </ItemTitle>
              {isDanger && (
                <span className="text-[9px] px-1 py-0.2 rounded bg-destructive/15 text-destructive font-medium shrink-0 leading-none">
                  High Risk
                </span>
              )}
            </div>
            <ItemDescription className="text-xs text-foreground/90 font-normal leading-relaxed break-all whitespace-pre-wrap line-clamp-none">
              {request.summary}
            </ItemDescription>
          </ItemContent>
        </div>

        {/* 代码详情展开区 (Collapsible) */}
        {request.detail && (
          <Collapsible open={detailOpen} onOpenChange={setDetailOpen} className="space-y-1 pl-9">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground select-none transition-colors py-0.5 cursor-pointer"
              >
                {detailOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                <span>{detailOpen ? i18n.t('approval.hideCode') : i18n.t('approval.showCode')}</span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="font-mono text-[10px] bg-background/90 p-2 rounded border border-border/50 max-h-48 overflow-y-auto overflow-x-auto whitespace-pre-wrap break-all text-muted-foreground leading-relaxed animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none">
                {request.detail}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* 会话级 grant 勾选 (Switch 保持决策 22 会话级契约) */}
        {request.grantable && (
          <div className="pl-9">
            <label
              className={cn(
                'group/grant flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border transition-all select-none cursor-pointer text-xs',
                grantChecked
                  ? 'border-amber-500/35 bg-amber-500/10 text-amber-950 dark:text-amber-100 shadow-2xs'
                  : 'border-border/50 bg-background/60 hover:bg-background text-muted-foreground hover:text-foreground',
                pendingAction !== null && 'opacity-60 cursor-not-allowed pointer-events-none'
              )}
            >
              <span className="text-[11px] leading-snug font-normal truncate min-w-0 flex-1">
                {i18n.t('approval.grantLabel', { label: request.label })}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={cn(
                    'text-[9px] font-medium px-1 py-0.2 rounded transition-colors',
                    grantChecked
                      ? 'text-amber-700 dark:text-amber-300 bg-amber-500/15'
                      : 'text-muted-foreground/70 group-hover/grant:text-muted-foreground'
                  )}
                >
                  {i18n.t('approval.grantHint')}
                </span>
                <Switch
                  size="sm"
                  checked={grantChecked}
                  onCheckedChange={setGrantChecked}
                  disabled={pendingAction !== null}
                  className="cursor-pointer"
                />
              </div>
            </label>
          </div>
        )}

        {/* 底部操作区: ItemFooter + ItemActions 包 ButtonGroup */}
        <ItemFooter className="flex items-center justify-end pt-1.5 border-t border-border/40">
          <ItemActions>
            <ButtonGroup>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pendingAction !== null}
                onClick={handleDenyClick}
                className="h-6.5 text-[11px] px-2.5 cursor-pointer gap-1"
              >
                {pendingAction === 'deny' && <Loader2 className="size-3 animate-spin shrink-0" />}
                <span>{pendingAction === 'deny' ? i18n.t('approval.denying') : i18n.t('approval.deny')}</span>
              </Button>
              <Button
                type="button"
                size="sm"
                variant={isDanger ? 'destructive' : 'default'}
                disabled={pendingAction !== null}
                onClick={handleApproveClick}
                className={cn(
                  'h-6.5 text-[11px] px-2.5 cursor-pointer gap-1 transition-colors',
                  grantChecked && !isDanger
                    ? 'bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-500 dark:hover:bg-amber-600 dark:text-neutral-950 shadow-xs'
                    : ''
                )}
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
            </ButtonGroup>
          </ItemActions>
        </ItemFooter>
      </Item>
    );
  }

  // 2. 提问卡 (ask_user): 官方 Questionnaire 单问题子集
  const hasChoices = Boolean(request.options && request.options.length > 0);
  const questionnaireItems = useMemo(
    () => [
      {
        name: 'answer',
        required: false,
        choices: request.options?.map((opt) => ({ value: opt })),
      },
    ],
    [request.options]
  );

  return (
    <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 dark:bg-blue-500/10 p-3 text-xs text-foreground shadow-2xs">
      <Questionnaire
        items={questionnaireItems}
        shortcuts={hasChoices ? 'numbers' : undefined}
        onSubmit={handleFormSubmit}
        className="gap-2.5"
      >
        <QuestionnaireItem name="answer" required={false}>
          {/* 标题栏: 图标 + 问题 (QuestionnaireTitle) */}
          <div className="flex items-start gap-2 min-w-0">
            <div className="size-7 rounded-md border border-blue-500/30 bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5 text-blue-600 dark:text-blue-400">
              <HelpCircle className="size-4" />
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <QuestionnaireTitle className="text-xs font-semibold text-foreground leading-relaxed break-all whitespace-pre-wrap">
                {request.question}
              </QuestionnaireTitle>
            </div>
          </div>

          {/* 选项模式 (choices 存在时: QuestionnaireChoices / QuestionnaireChoice) */}
          {hasChoices ? (
            <div className="space-y-2 pl-9">
              <QuestionnaireChoices className="max-h-52 overflow-y-auto pr-0.5 gap-1.5">
                {request.options!.map((opt, i) => {
                  const isChecked = selectedChoice === opt && !isCustomInput;
                  return (
                    <QuestionnaireChoice
                      key={i}
                      value={opt}
                      checked={isChecked}
                      onChange={() => {
                        setSelectedChoice(opt);
                        setIsCustomInput(false);
                      }}
                      onDoubleClick={() => {
                        if (pendingAction) return;
                        setPendingAction('answer');
                        onAnswer(opt);
                      }}
                      className={cn(
                        'px-2.5 py-1.5 text-xs transition-colors',
                        isChecked && 'border-blue-500/50 bg-blue-500/10 text-foreground font-medium'
                      )}
                    >
                      <QuestionnaireChoiceInput />
                      <QuestionnaireChoiceLabel className="text-xs">
                        {opt}
                      </QuestionnaireChoiceLabel>
                      <QuestionnaireChoiceShortcut />
                    </QuestionnaireChoice>
                  );
                })}
              </QuestionnaireChoices>

              {/* 选项模式下的自定义补充输入 */}
              <div className="pt-0.5">
                {!isCustomInput && !customText ? (
                  <button
                    type="button"
                    disabled={pendingAction !== null}
                    onClick={() => {
                      setIsCustomInput(true);
                      setSelectedChoice(null);
                    }}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border border-dashed border-border/80 bg-background/50 hover:bg-background hover:border-border text-left text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <PenLine className="size-3 shrink-0 text-muted-foreground" />
                      <span className="truncate text-[11px]">{i18n.t('approval.customAnswer')}</span>
                    </div>
                    <ChevronRight className="size-3 text-muted-foreground shrink-0" />
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 rounded-md border border-border/80 bg-background/90 p-1 animate-in fade-in-0 duration-150">
                    <QuestionnaireInput
                      value={customText}
                      onChange={(e) => {
                        setCustomText(e.target.value);
                        setIsCustomInput(true);
                        setSelectedChoice(null);
                      }}
                      disabled={pendingAction !== null}
                      placeholder={i18n.t('approval.customPlaceholder')}
                      className="h-6.5 text-[11px] flex-1 min-w-0 border-0 shadow-none focus-visible:ring-0 px-1.5 bg-transparent"
                      autoFocus
                    />
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* 自由输入模式 (无 choices 时: QuestionnaireInput) */
            <div className="pl-9">
              <QuestionnaireInput
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                disabled={pendingAction !== null}
                placeholder={i18n.t('approval.customPlaceholder')}
                className="h-7 text-xs bg-background/90"
                autoFocus
              />
            </div>
          )}

          {/* 操作区: QuestionnaireActions 布局 QuestionnaireSkip + QuestionnaireSubmit */}
          <QuestionnaireActions className="border-t border-blue-500/20 pt-1.5">
            <QuestionnaireSkip
              size="sm"
              variant="ghost"
              disabled={pendingAction !== null}
              onClick={handleCancelClick}
              className="h-6.5 text-[11px] px-2 text-muted-foreground hover:text-foreground cursor-pointer gap-1"
            >
              {pendingAction === 'cancel' && <Loader2 className="size-3 animate-spin shrink-0" />}
              <span>{pendingAction === 'cancel' ? i18n.t('approval.skipping') : i18n.t('approval.skip')}</span>
            </QuestionnaireSkip>

            <QuestionnaireSubmit
              size="sm"
              variant="default"
              disabled={
                pendingAction !== null ||
                (hasChoices ? !selectedChoice && !customText.trim() : !customText.trim())
              }
              className="h-6.5 text-[11px] px-2.5 cursor-pointer gap-1"
            >
              {pendingAction === 'answer' && <Loader2 className="size-3 animate-spin shrink-0" />}
              <span>{i18n.t('approval.submit')}</span>
            </QuestionnaireSubmit>
          </QuestionnaireActions>
        </QuestionnaireItem>
      </Questionnaire>
    </div>
  );
}
