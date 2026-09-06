import React, { useEffect, useRef, useState } from 'react';
import { i18n } from '#i18n';
import type { Settings, UserRule } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
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
import { ScrollText, Plus, Pencil, Trash2, PenLine } from 'lucide-react';
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
    <div className="space-y-3.5 animate-in fade-in-0 duration-150 motion-reduce:animate-none">
      {/* 1. 自定义系统提示词卡 (常驻注入, 独立于规则) */}
      <div className="rounded-lg border bg-card p-3 space-y-2.5 text-xs shadow-2xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            <PenLine className="size-3.5 text-muted-foreground" />
            <span>{i18n.t('settings.systemPrompt.title')}</span>
            <InfoTip content={i18n.t('settings.systemPrompt.desc')} />
          </div>
          <span
            aria-live="polite"
            className="text-[10px] text-muted-foreground select-none"
          >
            {promptSaved ? i18n.t('settings.systemPrompt.saved') : ''}
          </span>
        </div>

        <div className="space-y-1">
          <Textarea
            value={promptDraft}
            onChange={(e) => handlePromptChange(e.target.value)}
            maxLength={MAX_SYSTEM_PROMPT_LENGTH}
            placeholder={i18n.t('settings.systemPrompt.placeholder')}
            className="text-xs bg-background min-h-[96px] leading-relaxed resize-y"
            rows={4}
          />
          <div className="flex items-center justify-end text-[10px] text-muted-foreground">
            <span
              className={cn(
                'font-mono select-none',
                promptDraft.length >= MAX_SYSTEM_PROMPT_LENGTH ? 'text-amber-500 font-semibold' : '',
              )}
            >
              {promptDraft.length}/{MAX_SYSTEM_PROMPT_LENGTH}
            </span>
          </div>
        </div>
      </div>

      {/* 2. 规则卡片 */}
      <div className="rounded-lg border bg-card p-3 space-y-2.5 text-xs shadow-2xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            <ScrollText className="size-3.5 text-muted-foreground" />
            <span>{i18n.t('settings.rules.title', { count: rules.length })}</span>
            <InfoTip content={i18n.t('settings.rules.desc')} />
          </div>

          {rules.length > 0 && rules.length < MAX_RULES_COUNT && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={startCreating}
              className="gap-1 h-6 text-xs px-2 cursor-pointer text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3" />
              <span>{i18n.t('settings.rules.addRule')}</span>
            </Button>
          )}
        </div>

        {/* 规则列表 / 空态 */}
        {rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-md border border-dashed p-5 text-center space-y-2.5 bg-background/30">
            <div className="flex size-8 items-center justify-center rounded-md border bg-muted/60 text-muted-foreground">
              <ScrollText className="size-4" />
            </div>
            <div className="space-y-0.5">
              <div className="text-xs font-medium text-foreground">{i18n.t('settings.rules.emptyTitle')}</div>
              <p className="text-[11px] text-muted-foreground max-w-[260px] leading-normal">
                {i18n.t('settings.rules.emptyDesc')}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={startCreating}
              className="h-7 text-xs gap-1.5 cursor-pointer hover:bg-background"
            >
              <Plus className="size-3" />
              <span>{i18n.t('settings.rules.emptyAction')}</span>
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="divide-y divide-border/60 rounded-md border bg-background/50 overflow-hidden">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className={cn(
                    'flex items-center justify-between gap-2.5 p-2.5 transition-colors cursor-pointer group',
                    rule.enabled
                      ? 'hover:bg-muted/40'
                      : 'bg-muted/15 hover:bg-muted/30 opacity-75 hover:opacity-100',
                  )}
                  onClick={() => startEditing(rule)}
                >
                  {/* Left: Switch + Name + Content */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center shrink-0"
                    >
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={(checked) => handleToggleRule(rule.id, checked)}
                        aria-label={
                          rule.enabled
                            ? i18n.t('settings.rules.disableHint')
                            : i18n.t('settings.rules.enableHint')
                        }
                        className="cursor-pointer"
                      />
                    </div>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={cn(
                            'font-medium text-[11px] truncate',
                            rule.enabled ? 'text-foreground' : 'text-muted-foreground',
                          )}
                        >
                          {rule.name}
                        </span>
                        {!rule.enabled && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-muted/80 text-muted-foreground font-normal shrink-0 leading-none">
                            {i18n.t('settings.rules.disabledBadge')}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate leading-tight">
                        {rule.content}
                      </p>
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div
                    className="flex items-center gap-1 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => startEditing(rule)}
                      title={i18n.t('settings.rules.edit')}
                      className="size-6 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <Pencil className="size-3" />
                      <span className="sr-only">{i18n.t('settings.rules.edit')}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteRuleTarget(rule)}
                      title={i18n.t('settings.rules.delete')}
                      className="size-6 text-muted-foreground hover:text-destructive cursor-pointer"
                    >
                      <Trash2 className="size-3" />
                      <span className="sr-only">{i18n.t('settings.rules.delete')}</span>
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* 20条上限提示 */}
            {rules.length >= MAX_RULES_COUNT && (
              <div title={i18n.t('settings.rules.maxLimitHint')} className="w-full">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled
                  className="w-full h-8 text-xs gap-1.5 border border-dashed border-border/40 text-muted-foreground/50 cursor-not-allowed"
                >
                  <Plus className="size-3.5" />
                  <span>{i18n.t('settings.rules.maxLimitReached', { max: MAX_RULES_COUNT })}</span>
                </Button>
              </div>
            )}
          </div>
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
          <AlertDialogFooter>
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
