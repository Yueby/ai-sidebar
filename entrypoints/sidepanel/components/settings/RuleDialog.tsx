import React, { useEffect, useState } from 'react';
import { i18n } from '#i18n';
import type { UserRule } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
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
        <DialogHeader className="flex flex-row items-center justify-between space-y-0 pr-6">
          <DialogTitle>
            {rule ? i18n.t('settings.rules.edit') : i18n.t('settings.rules.addRule')}
          </DialogTitle>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="text-[11px] select-none">{i18n.t('settings.rules.enableHint')}</span>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              className="cursor-pointer"
            />
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3 pt-1">
          {/* Rule Name */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <Label className="font-medium text-foreground text-[10px]">{i18n.t('settings.rules.nameLabel')}</Label>
              <span
                className={cn(
                  'font-mono text-[10px]',
                  name.length >= MAX_RULE_NAME_LENGTH
                    ? 'text-warning font-semibold'
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
              className="h-7 text-xs"
              autoFocus
            />
          </div>

          {/* Rule Content */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <Label className="font-medium text-foreground text-[10px]">{i18n.t('settings.rules.contentLabel')}</Label>
              <span
                className={cn(
                  'font-mono text-[10px]',
                  content.length >= MAX_RULE_CONTENT_LENGTH
                    ? 'text-warning font-semibold'
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
              className="text-xs min-h-[110px] leading-relaxed resize-y"
              rows={4}
            />
          </div>

          {validationError && (
            <p className="text-[11px] text-destructive leading-tight">{validationError}</p>
          )}

          <DialogFooter className="flex-row items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-7 px-2.5 text-xs cursor-pointer"
            >
              {i18n.t('settings.rules.cancel')}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!name.trim() || !content.trim()}
              className="h-7 px-3 text-xs cursor-pointer"
            >
              {i18n.t('settings.rules.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
