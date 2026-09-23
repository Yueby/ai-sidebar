import React, { useEffect, useState, useMemo } from 'react';
import { i18n } from '#i18n';
import type { Skill } from '@/lib/types';
import {
  normalizeSkillName,
  parseSkillMarkdown,
  validateSkillName,
  type SkillParseResult,
} from '@/lib/skillFormat';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { AlertCircle, AlertTriangle, CheckCircle2, Download, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SkillInstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstall: (data: {
    name: string;
    description: string;
    content: string;
    disableModelInvocation?: boolean;
  }) => Promise<void> | void;
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

  // 名字不合标准 → 安装时会被规范化(外部仓库无法要求改名),预览里先说清楚会存成什么
  const normalizedName = preview ? normalizeSkillName(preview.name) : '';
  const willRename = Boolean(preview) && validateSkillName(preview!.name).length > 0;

  // 检查名字冲突(按**实际会存下的名字**比较:规范化后的名字才是落库的那个)
  const collision = useMemo(() => {
    if (!preview) return null;
    const name = (willRename ? normalizedName : preview.name).toLowerCase();
    if (!name) return null;
    const match = existingSkills.find((s) => s.name.toLowerCase() === name);
    if (!match) return null;
    if (match.source === 'builtin') {
      return { type: 'builtin', message: i18n.t('skillInstallDialog.cannotOverwriteBuiltin', { name }) };
    }
    return { type: 'overwrite', message: i18n.t('skillInstallDialog.willOverwriteWarning') };
  }, [preview, existingSkills, willRename, normalizedName]);

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
    if (willRename && !normalizedName) return; // 规范化后为空:这个名字救不回来
    setInstalling(true);
    try {
      await onInstall({
        name: preview.name,
        description: preview.description,
        content: preview.content,
        // 仅手动唤起的技能装上后仍不进模型 catalog —— 这个字段必须完整传递
        ...(preview.disableModelInvocation ? { disableModelInvocation: true } : {}),
      });
      onOpenChange(false);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] flex flex-col">
        <DialogHeader>
          <DialogTitle>{i18n.t('skillInstallDialog.title')}</DialogTitle>
          <DialogDescription>
            {i18n.t('skillInstallDialog.subtitle')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          <div className="space-y-4">
            <FieldGroup>
              <Field data-invalid={Boolean(fetchError)}>
                <div className="flex items-center justify-between">
                  <FieldLabel>{i18n.t('skillInstallDialog.urlLabel')}</FieldLabel>
                  <span className="text-muted-foreground text-xs">{i18n.t('skillInstallDialog.urlHint')}</span>
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
                    className="font-mono flex-1"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={fetching || !url.trim()}
                    onClick={() => void handleFetch()}
                  >
                    {fetching ? <Spinner data-icon="inline-start" /> : <Download data-icon="inline-start" />}
                    <span>{fetching ? i18n.t('skillInstallDialog.fetching') : i18n.t('skillInstallDialog.fetchAction')}</span>
                  </Button>
                </div>
              </Field>
            </FieldGroup>

            {/* 抓取或解析错误 */}
            {fetchError && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription className="break-all">{fetchError}</AlertDescription>
              </Alert>
            )}
            {parseError && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription className="break-all">{parseError}</AlertDescription>
              </Alert>
            )}

            {/* 预览区域 (仅抓取解析成功后呈现) */}
            {preview && (
              <Card size="sm">
                <CardHeader className="flex flex-row items-center justify-between border-b">
                  <div className="flex items-center gap-2 min-w-0">
                    <CheckCircle2 className="text-emerald-500 shrink-0" />
                    <CardTitle className="font-mono text-xs truncate">
                      {willRename && normalizedName ? normalizedName : preview.name}
                    </CardTitle>
                  </div>
                  <Badge variant="outline">
                    {i18n.t('skillInstallDialog.previewTitle')}
                  </Badge>
                </CardHeader>

                <CardContent className="space-y-3 pt-3">
                  {collision && (
                    <Alert variant={collision.type === 'builtin' ? 'destructive' : 'default'}>
                      <AlertTriangle />
                      <AlertDescription>{collision.message}</AlertDescription>
                    </Alert>
                  )}

                  {/* 名字不合标准:会被规范化后保存(外部仓库无法要求改名) */}
                  {willRename && (
                    <Alert>
                      <Info />
                      <AlertDescription className="break-all">
                        {normalizedName
                          ? i18n.t('skillInstallDialog.renameNote', {
                              from: preview.name,
                              to: normalizedName,
                            })
                          : i18n.t('skillInstallDialog.renameImpossible', { from: preview.name })}
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* 描述 */}
                  <CardDescription className="text-xs">
                    {preview.description}
                  </CardDescription>

                  {/* 告警信息 */}
                  {preview.diagnostics.length > 0 && (
                    <Alert>
                      <AlertTriangle />
                      <AlertTitle>{i18n.t('skillInstallDialog.diagnosticsTitle')}</AlertTitle>
                      <AlertDescription>
                        <ul className="list-disc list-inside space-y-0.5">
                          {preview.diagnostics.map((d, idx) => (
                            <li key={idx} className="break-all">{d}</li>
                          ))}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* 正文摘要 */}
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground font-medium">{i18n.t('messages.skillInstructions')}</div>
                    <pre className="max-h-32 overflow-y-auto rounded-lg border bg-muted/40 p-2.5 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap select-text">
                      {preview.content.slice(0, 1000)}
                      {preview.content.length > 1000 ? '\n…' : ''}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {i18n.t('skillInstallDialog.cancel')}
          </Button>
          <Button
            type="button"
            disabled={
              !preview ||
              collision?.type === 'builtin' ||
              installing ||
              (willRename && !normalizedName)
            }
            onClick={() => void handleConfirmInstall()}
          >
            {installing ? i18n.t('app.loading') : i18n.t('skillInstallDialog.installAction')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
