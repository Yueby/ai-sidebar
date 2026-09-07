import React, { useEffect, useRef, useState } from 'react';
import { i18n } from '#i18n';
import type { Settings, UserRule } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { Plus, Pencil, Trash2, PenLine, ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InfoTip } from './InfoTip';
import { RuleDialog } from './RuleDialog';

interface SettingsPromptViewProps {
  settings: Settings;
  onUpdateSettings: (settings: Settings) => void;
}

const MAX_RULES_COUNT = 20;
const MAX_SYSTEM_PROMPT_LENGTH = 4000;
const SYSTEM_PROMPT_SAVE_DELAY = 500;

export function SettingsPromptView({ settings, onUpdateSettings }: SettingsPromptViewProps) {
  const rules = settings.rules || [];

  // 系统提示词: 本地草稿 + 防抖落库 (避免逐键写 chrome.storage)
  const [promptDraft, setPromptDraft] = useState(settings.systemPrompt || '');
  const [promptSaved, setPromptSaved] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const handlePromptChange = (value: string) => {
    setPromptDraft(value);
    setPromptSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      onUpdateSettings({ ...settings, systemPrompt: value.trim().slice(0, MAX_SYSTEM_PROMPT_LENGTH) });
      setPromptSaved(true);
    }, SYSTEM_PROMPT_SAVE_DELAY);
  };

  // 规则弹窗状态 (null 表示关闭; 空对象/无 id 表示新建, 否则为编辑)
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<UserRule | null>(null);
  const [deleteRuleTarget, setDeleteRuleTarget] = useState<UserRule | null>(null);

  const startCreating = () => {
    if (rules.length >= MAX_RULES_COUNT) return;
    setEditingRule(null);
    setDialogOpen(true);
  };

  const startEditing = (rule: UserRule) => {
    setEditingRule(rule);
    setDialogOpen(true);
  };

  const handleToggleRule = (id: string, enabled: boolean) => {
    const updated = rules.map((r) => (r.id === id ? { ...r, enabled } : r));
    onUpdateSettings({ ...settings, rules: updated });
  };

  const handleSaveRule = ({ name, content, enabled }: { name: string; content: string; enabled: boolean }) => {
    if (editingRule) {
      const updated = rules.map((r) =>
        r.id === editingRule.id
          ? { ...r, name, content, enabled }
          : r,
      );
      onUpdateSettings({ ...settings, rules: updated });
    } else {
      if (rules.length >= MAX_RULES_COUNT) return;
      const newRule: UserRule = {
        id: crypto.randomUUID(),
        name,
        content,
        enabled,
      };
      onUpdateSettings({ ...settings, rules: [...rules, newRule] });
    }
    setEditingRule(null);
  };

  const handleDeleteRule = (id: string) => {
    const updated = rules.filter((r) => r.id !== id);
    onUpdateSettings({ ...settings, rules: updated });
  };

  return (
    <div className="space-y-4 animate-in fade-in-0 duration-150 motion-reduce:animate-none">
      {/* 1. 系统提示词节 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <PenLine className="size-3.5 text-muted-foreground" />
            <span>{i18n.t('settings.systemPrompt.title')}</span>
            <InfoTip content={i18n.t('settings.systemPrompt.desc')} />
          </h2>
          <span
            aria-live="polite"
            className="text-[10px] text-muted-foreground select-none"
          >
            {promptSaved ? i18n.t('settings.systemPrompt.saved') : ''}
          </span>
        </div>

        <Card className="gap-1.5 p-3">
          <Textarea
            value={promptDraft}
            onChange={(e) => handlePromptChange(e.target.value)}
            maxLength={MAX_SYSTEM_PROMPT_LENGTH}
            placeholder={i18n.t('settings.systemPrompt.placeholder')}
            className="text-xs min-h-[96px] leading-relaxed resize-y"
            rows={4}
          />
          <div className="flex items-center justify-end text-[10px] text-muted-foreground">
            <span
              className={cn(
                'font-mono select-none',
                promptDraft.length >= MAX_SYSTEM_PROMPT_LENGTH ? 'text-warning font-semibold' : '',
              )}
            >
              {promptDraft.length}/{MAX_SYSTEM_PROMPT_LENGTH}
            </span>
          </div>
        </Card>
      </div>

      {/* 2. 规则节 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <ScrollText className="size-3.5 text-muted-foreground" />
            <span>{i18n.t('settings.rules.title', { count: rules.length })}</span>
            <InfoTip content={i18n.t('settings.rules.desc')} />
          </h2>

          <Button
            type="button"
            size="sm"
            onClick={startCreating}
            disabled={rules.length >= MAX_RULES_COUNT}
            className="gap-1 h-7 text-xs px-2.5 shrink-0"
          >
            <Plus className="size-3" />
            <span>{i18n.t('settings.rules.addRule')}</span>
          </Button>
        </div>

        {/* 规则列表 / 空态 */}
        {rules.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ScrollText className="size-5" />
              </EmptyMedia>
              <EmptyTitle>{i18n.t('settings.rules.emptyTitle')}</EmptyTitle>
              <EmptyDescription>{i18n.t('settings.rules.emptyDesc')}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={startCreating}
                className="h-7 text-xs gap-1.5"
              >
                <Plus className="size-3" />
                <span>{i18n.t('settings.rules.emptyAction')}</span>
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <Card className="gap-0 py-0 divide-y divide-border/60 overflow-hidden">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className={cn(
                  'flex items-center justify-between gap-2.5 p-2.5 transition-colors group',
                  rule.enabled
                    ? 'hover:bg-muted/40'
                    : 'opacity-60 hover:opacity-100',
                )}
                onClick={() => startEditing(rule)}
              >
                {/* ① 前置控件槽: w-6 flex items-center justify-center shrink-0 */}
                <div
                  className="w-6 flex items-center justify-center shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Switch
                    size="sm"
                    checked={rule.enabled}
                    onCheckedChange={(checked) => handleToggleRule(rule.id, checked)}
                    aria-label={
                      rule.enabled
                        ? i18n.t('settings.rules.disableHint')
                        : i18n.t('settings.rules.enableHint')
                    }
                    className=""
                  />
                </div>

                {/* ② 文本块: flex-1 min-w-0 */}
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className={cn('font-medium text-[11px] truncate', rule.enabled ? 'text-foreground' : 'text-muted-foreground')}>
                    {rule.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate leading-tight">
                    {rule.content}
                  </div>
                </div>

                {/* ③ 右侧操作钮: flex items-center gap-1 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity */}
                <TooltipProvider delay={200}>
                  <div
                    className="flex items-center gap-1 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => startEditing(rule)}
                            aria-label={i18n.t('settings.rules.edit')}
                            className="size-6 text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="size-3" />
                            <span className="sr-only">{i18n.t('settings.rules.edit')}</span>
                          </Button>
                        }
                      />
                      <TooltipContent side="top">
                        {i18n.t('settings.rules.edit')}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteRuleTarget(rule)}
                            aria-label={i18n.t('settings.rules.delete')}
                            className="size-6 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="size-3" />
                            <span className="sr-only">{i18n.t('settings.rules.delete')}</span>
                          </Button>
                        }
                      />
                      <TooltipContent side="top">
                        {i18n.t('settings.rules.delete')}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </TooltipProvider>
              </div>
            ))}
          </Card>
        )}
      </div>

      {/* 预留：四期步② 技能区块 (Agent Skills) */}
      {/* 预留：四期步③ 记忆区块 (Memory / self-improving) */}

      {/* 新建/编辑规则 Dialog */}
      <RuleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        rule={editingRule}
        onSave={handleSaveRule}
      />

      {/* 删除规则确认弹窗 (统一 AlertDialog) */}
      <AlertDialog
        open={deleteRuleTarget !== null}
        onOpenChange={(open) => !open && setDeleteRuleTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{i18n.t('settings.rules.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {i18n.t('settings.rules.deleteConfirmDesc', { name: deleteRuleTarget?.name || '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row justify-end gap-2">
            <AlertDialogCancel onClick={() => setDeleteRuleTarget(null)}>
              {i18n.t('settings.rules.deleteConfirmCancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() => {
                if (deleteRuleTarget) {
                  handleDeleteRule(deleteRuleTarget.id);
                }
                setDeleteRuleTarget(null);
              }}
            >
              {i18n.t('settings.rules.deleteConfirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
