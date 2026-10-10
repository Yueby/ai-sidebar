import React, { useEffect, useState } from 'react';
import { i18n } from '#i18n';
import type { UserRule } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Field, FieldGroup, FieldLabel, FieldError } from '@/components/ui/field';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface RuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: UserRule | null;
  onSave: (ruleData: { name: string; content: string; enabled: boolean }) => void;
}

const MAX_RULE_NAME_LENGTH = 100;
const MAX_RULE_CONTENT_LENGTH = 4000;

export function RuleDialog({ open, onOpenChange, rule, onSave }: RuleDialogProps) {
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      if (rule) {
        setName(rule.name);
        setContent(rule.content);
        setEnabled(rule.enabled);
      } else {
        setName('');
        setContent('');
        setEnabled(true);
      }
      setValidationError(null);
    }
  }, [open, rule]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmedName = name.trim();
    const trimmedContent = content.trim();

    if (!trimmedName) {
      setValidationError(i18n.t('settings.rules.validationNameRequired'));
      return;
    }
    if (!trimmedContent) {
      setValidationError(i18n.t('settings.rules.validationContentRequired'));
      return;
    }

    onSave({
      name: trimmedName.slice(0, MAX_RULE_NAME_LENGTH),
      content: trimmedContent.slice(0, MAX_RULE_CONTENT_LENGTH),
      enabled,
    });
    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>
            {rule ? i18n.t('settings.rules.edit') : i18n.t('settings.rules.addRule')}
          </DialogTitle>
        </DialogHeader>

        {/* 与底部操作栏保持间距:DialogFooter 在表单内部,拿不到官方 grid 的 gap-4 */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FieldGroup>
            {/* Rule Name */}
            <Field data-invalid={!!(validationError && !name.trim())}>
              <div className="flex items-center justify-between">
                <FieldLabel>{i18n.t('settings.rules.nameLabel')}</FieldLabel>
                <span
                  className={cn(
                    'font-mono text-xs',
                    name.length >= MAX_RULE_NAME_LENGTH
                      ? 'text-destructive font-medium'
                      : 'text-muted-foreground',
                  )}
                >
                  {name.length}/{MAX_RULE_NAME_LENGTH}
                </span>
              </div>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                maxLength={MAX_RULE_NAME_LENGTH}
                placeholder={i18n.t('settings.rules.namePlaceholder')}
                autoFocus
                aria-invalid={!!(validationError && !name.trim())}
              />
            </Field>

            {/* Rule Content */}
            <Field data-invalid={!!(validationError && !content.trim())}>
              <div className="flex items-center justify-between">
                <FieldLabel>{i18n.t('settings.rules.contentLabel')}</FieldLabel>
                <span
                  className={cn(
                    'font-mono text-xs',
                    content.length >= MAX_RULE_CONTENT_LENGTH
                      ? 'text-destructive font-medium'
                      : 'text-muted-foreground',
                  )}
                >
                  {content.length}/{MAX_RULE_CONTENT_LENGTH}
                </span>
              </div>
              <Textarea
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                maxLength={MAX_RULE_CONTENT_LENGTH}
                placeholder={i18n.t('settings.rules.contentPlaceholder')}
                rows={4}
                aria-invalid={!!(validationError && !content.trim())}
              />
            </Field>

            {/* 启用开关(表单最后一行) */}
            <Field orientation="horizontal">
              <FieldLabel htmlFor="rule-enabled">{i18n.t('settings.rules.enableHint')}</FieldLabel>
              <Switch
                id="rule-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </Field>

            {validationError && (
              <FieldError>{validationError}</FieldError>
            )}
          </FieldGroup>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {i18n.t('settings.rules.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || !content.trim()}
            >
              {i18n.t('settings.rules.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
