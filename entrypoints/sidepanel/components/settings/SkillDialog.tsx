import React, { useEffect, useState, useMemo } from 'react';
import { i18n } from '#i18n';
import type { Skill } from '@/lib/types';
import { SKILL_DESCRIPTION_MAX, SKILL_NAME_MAX, validateSkillName } from '@/lib/skillFormat';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field, FieldGroup, FieldLabel, FieldError, FieldDescription } from '@/components/ui/field';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface SkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skill: Skill | null;
  onSave: (data: { name: string; description: string; content: string }) => Promise<void> | void;
  existingSkills: Skill[];
}

export function SkillDialog({
  open,
  onOpenChange,
  skill,
  onSave,
  existingSkills,
}: SkillDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const isEditing = Boolean(skill);

  useEffect(() => {
    if (open) {
      if (skill) {
        setName(skill.name);
        setDescription(skill.description);
        setContent(skill.content);
      } else {
        setName('');
        setDescription('');
        setContent('');
      }
      setSubmitted(false);
      setSaving(false);
    }
  }, [open, skill]);

  // 实时名字校验
  const nameIssues = useMemo(() => {
    const trimmed = name.trim();
    if (!trimmed) {
      return submitted ? [i18n.t('skillDialog.validationNameRequired')] : [];
    }
    return validateSkillName(trimmed);
  }, [name, submitted]);

  // 名字冲突检查 (如果编辑自身则不算冲突)
  const collision = useMemo(() => {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) return null;
    const match = existingSkills.find(
      (s) => s.name.toLowerCase() === trimmed && (!skill || s.id !== skill.id),
    );
    if (!match) return null;
    if (match.source === 'builtin') {
      return { type: 'builtin', message: i18n.t('skillDialog.collisionBuiltin') };
    }
    return { type: 'overwrite', message: i18n.t('skillDialog.collisionOverwriteWarning') };
  }, [name, existingSkills, skill]);

  const descEmpty = submitted && !description.trim();
  const contentEmpty = submitted && !content.trim();
  const descTooLong = description.length > SKILL_DESCRIPTION_MAX;

  const canSave =
    name.trim().length > 0 &&
    nameIssues.length === 0 &&
    collision?.type !== 'builtin' &&
    description.trim().length > 0 &&
    !descTooLong &&
    content.trim().length > 0 &&
    !saving;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSubmitted(true);

    if (!canSave) return;

    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        content: content.trim(),
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={handleKeyDown} className="max-h-[calc(100dvh-2rem)] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? i18n.t('skillDialog.editTitle') : i18n.t('skillDialog.addTitle')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            <FieldGroup>
              {/* Skill Name(编辑时锁定:改名 = 另一条技能,saveSkill 是按名字 upsert 的) */}
              <Field data-invalid={nameIssues.length > 0 || collision?.type === 'builtin'}>
                <div className="flex items-center justify-between">
                  <FieldLabel>{i18n.t('skillDialog.nameLabel')}</FieldLabel>
                  <span className="text-muted-foreground text-xs">
                    {isEditing ? i18n.t('skillDialog.nameLockedHint') : i18n.t('skillDialog.nameHint')}
                  </span>
                </div>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase())}
                  placeholder={i18n.t('skillDialog.namePlaceholder')}
                  maxLength={SKILL_NAME_MAX}
                  autoFocus={!isEditing}
                  disabled={isEditing}
                  className="font-mono"
                />
                {nameIssues.map((issue, idx) => (
                  <FieldError key={idx}>
                    {issue}
                  </FieldError>
                ))}
                {collision && (
                  collision.type === 'builtin' ? (
                    <FieldError>{collision.message}</FieldError>
                  ) : (
                    <FieldDescription>{collision.message}</FieldDescription>
                  )
                )}
              </Field>

              {/* Description */}
              <Field data-invalid={descEmpty || descTooLong}>
                <div className="flex items-center justify-between">
                  <FieldLabel>{i18n.t('skillDialog.descLabel')}</FieldLabel>
                  <span
                    className={cn(
                      'font-mono text-xs',
                      descTooLong ? 'text-destructive font-medium' : 'text-muted-foreground',
                    )}
                  >
                    {description.length} / {SKILL_DESCRIPTION_MAX}
                  </span>
                </div>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={i18n.t('skillDialog.descPlaceholder')}
                  rows={3}
                />
                {descEmpty && (
                  <FieldError>
                    {i18n.t('skillDialog.validationDescRequired')}
                  </FieldError>
                )}
              </Field>

              {/* Instruction Body */}
              <Field data-invalid={contentEmpty}>
                <FieldLabel>{i18n.t('skillDialog.contentLabel')}</FieldLabel>
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={i18n.t('skillDialog.contentPlaceholder')}
                  className="font-mono"
                  rows={6}
                />
                {contentEmpty && (
                  <FieldError>
                    {i18n.t('skillDialog.validationContentRequired')}
                  </FieldError>
                )}
              </Field>
            </FieldGroup>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {i18n.t('skillDialog.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={!canSave}
            >
              {saving ? i18n.t('app.loading') : i18n.t('skillDialog.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
