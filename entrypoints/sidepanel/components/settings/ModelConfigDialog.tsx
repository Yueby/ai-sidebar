import React, { useState, useEffect } from 'react';
import type { ModelConfig, ReasoningLevel } from '@/lib/types';
import { REASONING_LEVELS, REASONING_LEVEL_LABELS } from '@/lib/types';
import { i18n } from '#i18n';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';

interface ModelConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: ModelConfig | null;
  onSave: (model: ModelConfig) => void;
}

// 候选档位 = 除 off 外的全部等级,文案统一取自 lib 的 REASONING_LEVEL_LABELS
const CANDIDATE_REASONING_LEVELS: Array<{ value: ReasoningLevel; label: string }> = REASONING_LEVELS.filter(
  (l) => l !== 'off',
).map((value) => ({ value, label: REASONING_LEVEL_LABELS[value].full }));

export function ModelConfigDialog({
  open,
  onOpenChange,
  model,
  onSave,
}: ModelConfigDialogProps) {
  const isEditing = Boolean(model && model.id);

  const [id, setId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [contextWindow, setContextWindow] = useState<string>('');
  const [maxTokens, setMaxTokens] = useState<string>('');
  const [tools, setTools] = useState(false);
  const [vision, setVision] = useState(false);
  const [reasoning, setReasoning] = useState(false);
  const [reasoningLevels, setReasoningLevels] = useState<ReasoningLevel[]>([]);

  useEffect(() => {
    if (open) {
      if (model) {
        setId(model.id || '');
        setDisplayName(model.displayName || '');
        setContextWindow(model.contextWindow != null ? String(model.contextWindow) : '');
        setMaxTokens(model.maxTokens != null ? String(model.maxTokens) : '');
        setTools(model.tools ?? false);
        setVision(model.vision ?? false);
        setReasoning(model.reasoning ?? false);
        setReasoningLevels(model.reasoningLevels ?? []);
      } else {
        setId('');
        setDisplayName('');
        setContextWindow('128000');
        setMaxTokens('4096');
        setTools(false);
        setVision(false);
        setReasoning(false);
        setReasoningLevels([]);
      }
    }
  }, [open, model]);

  const handleToggleLevel = (level: ReasoningLevel) => {
    setReasoningLevels((prev) => {
      if (prev.includes(level)) {
        return prev.filter((l) => l !== level);
      }
      return [...prev, level];
    });
  };

  const handleSave = () => {
    const trimmedId = id.trim();
    if (!trimmedId) return;

    const config: ModelConfig = {
      id: trimmedId,
      displayName: displayName.trim() || undefined,
      contextWindow: contextWindow.trim() ? parseInt(contextWindow, 10) || undefined : undefined,
      maxTokens: maxTokens.trim() ? parseInt(maxTokens, 10) || undefined : undefined,
      tools,
      vision,
      reasoning,
      reasoningLevels: reasoning && reasoningLevels.length > 0 ? reasoningLevels : undefined,
      prefilled: model?.prefilled,
    };

    onSave(config);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEditing ? i18n.t('modelConfig.editTitle') : i18n.t('modelConfig.addTitle')}
          </DialogTitle>
          <DialogDescription>
            {i18n.t('modelConfig.subtitle')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1 max-h-[60vh] overflow-y-auto pr-0.5">
          {/* Model ID */}
          <div className="space-y-1">
            <Label className="text-xs">{i18n.t('modelConfig.modelIdLabel')}</Label>
            <Input
              value={id}
              onChange={(e) => setId(e.target.value)}
              disabled={isEditing}
              placeholder={i18n.t('modelConfig.modelIdPlaceholder')}
              className="h-8 text-xs font-mono"
            />
          </div>

          {/* Display Name */}
          <div className="space-y-1">
            <Label className="text-xs">{i18n.t('modelConfig.nameLabel')}</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={i18n.t('modelConfig.namePlaceholder')}
              className="h-8 text-xs"
            />
          </div>

          {/* Token limits: 2-column */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">{i18n.t('modelConfig.contextWindowLabel')}</Label>
              <Input
                type="number"
                value={contextWindow}
                onChange={(e) => setContextWindow(e.target.value)}
                placeholder="128000"
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{i18n.t('modelConfig.maxOutputLabel')}</Label>
              <Input
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                placeholder="4096"
                className="h-8 text-xs font-mono"
              />
            </div>
          </div>

          {/* Capability Switches */}
          <div className="rounded-lg border bg-muted/30 p-2.5 space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-foreground">{i18n.t('modelConfig.tools')}</span>
              <Switch checked={tools} onCheckedChange={setTools} size="sm" />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-foreground">{i18n.t('modelConfig.vision')}</span>
              <Switch checked={vision} onCheckedChange={setVision} size="sm" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-foreground">{i18n.t('modelConfig.reasoning')}</span>
                <Switch checked={reasoning} onCheckedChange={setReasoning} size="sm" />
              </div>

              {/* Reasoning Levels Multi-select */}
              {reasoning && (
                <div className="pt-2 border-t space-y-1.5 animate-in fade-in duration-150">
                  <div className="text-[11px] text-muted-foreground">
                    {i18n.t('modelConfig.supportedLevelsHint')}
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-0.5">
                    {CANDIDATE_REASONING_LEVELS.map((opt) => {
                      const isChecked = reasoningLevels.includes(opt.value);
                      return (
                        <Label
                          key={opt.value}
                          className="flex items-center gap-1.5 text-xs font-normal text-foreground cursor-pointer select-none"
                        >
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => handleToggleLevel(opt.value)}
                          />
                          <span className="text-[11px]">{opt.label}</span>
                        </Label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="flex-row justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-7 text-xs"
          >
            {i18n.t('modelConfig.cancel')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!id.trim()}
            onClick={handleSave}
            className="h-7 text-xs"
          >
            {i18n.t('modelConfig.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
