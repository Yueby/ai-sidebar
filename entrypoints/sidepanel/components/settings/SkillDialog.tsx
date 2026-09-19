import React, { useEffect, useState, useMemo } from 'react';
import { i18n } from '#i18n';
import type { Skill } from '@/lib/types';
import { SKILL_DESCRIPTION_MAX, SKILL_NAME_MAX, validateSkillName } from '@/lib/skillFormat';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field, FieldGroup, FieldLabel, FieldError } from '@/components/ui/field';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

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
      <DialogContent onKeyDown={handleKeyDown} className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? i18n.t('skillDialog.editTitle') : i18n.t('skillDialog.addTitle')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3 pt-1">
          <FieldGroup className="gap-3">
            {/* Skill Name(编辑时锁定:改名 = 另一条技能,saveSkill 是按名字 upsert 的) */}
            <Field data-invalid={nameIssues.length > 0 || collision?.type === 'builtin'}>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <FieldLabel className="text-[11px] font-medium">{i18n.t('skillDialog.nameLabel')}</FieldLabel>
                <span className="text-[10px] opacity-70">
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
                className="h-8 font-mono text-xs disabled:opacity-60"
              />
              {nameIssues.map((issue, idx) => (
                <FieldError key={idx} className="text-[11px] text-destructive">
                  {issue}
                </FieldError>
              ))}
              {collision && (
                <div
                  className={`text-[11px] mt-1 ${
                    collision.type === 'builtin' ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {collision.message}
                </div>
              )}
            </Field>

            {/* Description */}
            <Field data-invalid={descEmpty || descTooLong}>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <FieldLabel className="text-[11px] font-medium">{i18n.t('skillDialog.descLabel')}</FieldLabel>
                <span className={`text-[10px] ${descTooLong ? 'text-destructive font-semibold' : 'opacity-70'}`}>
                  {description.length} / {SKILL_DESCRIPTION_MAX}
                </span>
              </div>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={i18n.t('skillDialog.descPlaceholder')}
                className="text-xs min-h-20 leading-relaxed resize-y"
              />
              {descEmpty && (
                <FieldError className="text-[11px] text-destructive">
                  {i18n.t('skillDialog.validationDescRequired')}
                </FieldError>
              )}
            </Field>

            {/* Instruction Body */}
            <Field data-invalid={contentEmpty}>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <FieldLabel className="text-[11px] font-medium">{i18n.t('skillDialog.contentLabel')}</FieldLabel>
              </div>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={i18n.t('skillDialog.contentPlaceholder')}
                className="font-mono text-[11px] min-h-36 max-h-64 leading-relaxed resize-y"
              />
              {contentEmpty && (
                <FieldError className="text-[11px] text-destructive">
                  {i18n.t('skillDialog.validationContentRequired')}
                </FieldError>
              )}
            </Field>
          </FieldGroup>

          <DialogFooter className="gap-2 pt-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {i18n.t('skillDialog.cancel')}
            </Button>
            <Button
              type="submit"
              size="sm"
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
