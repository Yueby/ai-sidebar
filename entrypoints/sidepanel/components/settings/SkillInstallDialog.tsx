import React, { useEffect, useState, useMemo } from 'react';
import { i18n } from '#i18n';
import type { Skill } from '@/lib/types';
import { parseSkillMarkdown, type SkillParseResult } from '@/lib/skills';
import { fetchRawText, normalizeGitHubRawUrl } from '@/lib/fetchPage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { AlertCircle, AlertTriangle, CheckCircle2, Download } from 'lucide-react';

interface SkillInstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstall: (data: { name: string; description: string; content: string }) => Promise<void> | void;
  existingSkills: Skill[];
}

export function SkillInstallDialog({
  open,
  onOpenChange,
  onInstall,
  existingSkills,
}: SkillInstallDialogProps) {
  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Extract<SkillParseResult, { ok: true }> | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (open) {
      setUrl('');
      setFetching(false);
      setFetchError(null);
      setParseError(null);
      setPreview(null);
      setInstalling(false);
    }
  }, [open]);

  // 检查名字冲突
  const collision = useMemo(() => {
    if (!preview) return null;
    const name = preview.name.toLowerCase();
    const match = existingSkills.find((s) => s.name.toLowerCase() === name);
    if (!match) return null;
    if (match.source === 'builtin') {
      return { type: 'builtin', message: i18n.t('skillInstallDialog.cannotOverwriteBuiltin', { name: preview.name }) };
    }
    return { type: 'overwrite', message: i18n.t('skillInstallDialog.willOverwriteWarning') };
  }, [preview, existingSkills]);

  const handleFetch = async () => {
    const raw = url.trim();
    if (!raw) {
      setFetchError(i18n.t('skillInstallDialog.errorEmptyUrl'));
      return;
    }
    const normalized = normalizeGitHubRawUrl(raw);
    if (normalized !== raw) {
      setUrl(normalized);
    }

    setFetching(true);
    setFetchError(null);
    setParseError(null);
    setPreview(null);

    try {
      const res = await fetchRawText(normalized);
      if (!res.ok) {
        setFetchError(i18n.t('skillInstallDialog.errorFetchFailed', { error: res.error }));
        return;
      }

      const parsed = parseSkillMarkdown(res.text);
      if (!parsed.ok) {
        let reasonMsg = parsed.reason;
        if (parsed.reason === 'frontmatter-missing') {
          reasonMsg = i18n.t('skillInstallDialog.parseReasonFrontmatterMissing');
        } else if (parsed.reason === 'frontmatter-unterminated') {
          reasonMsg = i18n.t('skillInstallDialog.parseReasonFrontmatterUnterminated');
        } else if (parsed.reason === 'description-required') {
          reasonMsg = i18n.t('skillInstallDialog.parseReasonDescriptionRequired');
        } else if (parsed.reason === 'name-required') {
          reasonMsg = i18n.t('skillInstallDialog.parseReasonNameRequired');
        }
        setParseError(i18n.t('skillInstallDialog.errorParseFailed', { error: reasonMsg }));
        return;
      }

      setPreview(parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFetchError(i18n.t('skillInstallDialog.errorFetchFailed', { error: msg }));
    } finally {
      setFetching(false);
    }
  };

  const handleConfirmInstall = async () => {
    if (!preview || collision?.type === 'builtin' || installing) return;
    setInstalling(true);
    try {
      await onInstall({
        name: preview.name,
        description: preview.description,
        content: preview.content,
      });
      onOpenChange(false);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{i18n.t('skillInstallDialog.title')}</DialogTitle>
          <DialogDescription className="text-xs">
            {i18n.t('skillInstallDialog.subtitle')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5 pt-1">
          <FieldGroup className="gap-2">
            <Field data-invalid={Boolean(fetchError)}>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <FieldLabel className="text-[11px] font-medium">{i18n.t('skillInstallDialog.urlLabel')}</FieldLabel>
                <span className="text-[10px] opacity-70">{i18n.t('skillInstallDialog.urlHint')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleFetch();
                    }
                  }}
                  placeholder={i18n.t('skillInstallDialog.urlPlaceholder')}
                  className="h-8 text-xs font-mono flex-1 min-w-0"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={fetching || !url.trim()}
                  onClick={() => void handleFetch()}
                  className="h-8 shrink-0 text-xs px-2.5 gap-1.5"
                >
                  {fetching ? <Spinner className="size-3.5" /> : <Download className="size-3.5" />}
                  <span>{fetching ? i18n.t('skillInstallDialog.fetching') : i18n.t('skillInstallDialog.fetchAction')}</span>
                </Button>
              </div>
            </Field>
          </FieldGroup>

          {/* 抓取或解析错误 */}
          {fetchError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1 leading-relaxed break-all">{fetchError}</div>
            </div>
          )}
          {parseError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1 leading-relaxed break-all">{parseError}</div>
            </div>
          )}

          {/* 预览区域 (仅抓取解析成功后呈现) */}
          {preview && (
            <div className="space-y-2.5 rounded-lg border border-border/80 bg-muted/20 p-3 animate-in fade-in-0 duration-150 motion-reduce:animate-none">
              <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                  <span className="font-mono text-xs font-semibold text-foreground truncate">
                    {preview.name}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0 uppercase tracking-wider font-medium">
                  {i18n.t('skillInstallDialog.previewTitle')}
                </span>
              </div>

              {collision && (
                <div
                  className={`flex items-start gap-2 rounded-md p-2 text-xs border ${
                    collision.type === 'builtin'
                      ? 'border-destructive/40 bg-destructive/10 text-destructive'
                      : 'border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300'
                  }`}
                >
                  <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                  <span className="min-w-0 flex-1 leading-tight">{collision.message}</span>
                </div>
              )}

              {/* 描述 */}
              <div className="text-xs text-muted-foreground leading-relaxed bg-background/80 p-2 rounded border border-border/50">
                {preview.description}
              </div>

              {/* 告警信息 */}
              {preview.diagnostics.length > 0 && (
                <div className="space-y-1 rounded border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
                  <div className="font-medium flex items-center gap-1">
                    <AlertTriangle className="size-3 shrink-0" />
                    <span>{i18n.t('skillInstallDialog.diagnosticsTitle')}</span>
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 pl-1 opacity-90">
                    {preview.diagnostics.map((d, idx) => (
                      <li key={idx} className="break-all">{d}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 正文摘要 */}
              <div className="space-y-1">
                <div className="text-[10px] text-muted-foreground font-medium">{i18n.t('messages.skillInstructions')}</div>
                <pre className="max-h-32 overflow-y-auto rounded border border-border/50 bg-background/90 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground whitespace-pre-wrap select-text">
                  {preview.content.slice(0, 1000)}
                  {preview.content.length > 1000 ? '\n…' : ''}
                </pre>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 pt-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {i18n.t('skillInstallDialog.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!preview || collision?.type === 'builtin' || installing}
              onClick={() => void handleConfirmInstall()}
            >
              {installing ? i18n.t('app.loading') : i18n.t('skillInstallDialog.installAction')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
