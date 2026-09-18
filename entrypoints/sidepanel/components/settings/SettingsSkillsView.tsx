import React, { useEffect, useState, useCallback } from 'react';
import { i18n } from '#i18n';
import type { Skill } from '@/lib/types';
import { listSkills, saveSkill, deleteSkill, setSkillEnabled } from '@/lib/skills';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty';
import { toast } from '@/components/ui/toast';
import { Plus, Pencil, Trash2, Sparkles, Download, Info, Layers, GitBranch, User } from 'lucide-react';
import { SkillDialog } from './SkillDialog';
import { SkillInstallDialog } from './SkillInstallDialog';
import { cn } from '@/lib/utils';

interface SettingsSkillsViewProps {
  onBack: () => void;
  onPrefillPrompt?: (promptText: string) => void;
}

export function SettingsSkillsView({ onBack, onPrefillPrompt }: SettingsSkillsViewProps) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  // 弹窗状态
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null);

  const loadSkillsList = useCallback(async () => {
    try {
      const list = await listSkills();
      setSkills(list);
    } catch {
      toast.error(i18n.t('settings.skills.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSkillsList();
  }, [loadSkillsList]);

  // 启用/停用切换
  const handleToggle = async (id: string, enabled: boolean) => {
    const target = skills.find((s) => s.id === id);
    if (!target) return;

    // 乐观更新
    setSkills((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));

    const res = await setSkillEnabled(id, enabled);
    if (res.ok) {
      toast.success(
        enabled
          ? i18n.t('settings.skills.toggleSuccessEnabled', { name: target.name })
          : i18n.t('settings.skills.toggleSuccessDisabled', { name: target.name }),
      );
    } else {
      toast.error(res.error || i18n.t('settings.skills.toggleFailed'));
      void loadSkillsList(); // 回滚
    }
  };

  // 保存技能 (新增或编辑)
  const handleSave = async (data: { name: string; description: string; content: string }) => {
    const res = await saveSkill({
      ...data,
      source: editingSkill?.source === 'github' ? 'github' : 'user',
      // 编辑既有技能时保留“仅手动唤起”这一选择(它不属手写对话框的字段)
      disableModelInvocation: editingSkill?.disableModelInvocation,
    });
    if (res.ok) {
      toast.success(i18n.t('settings.skills.saveSuccess', { name: res.skill.name }));
      await loadSkillsList();
    } else {
      toast.error(res.error || i18n.t('settings.skills.saveFailed'));
      throw new Error(res.error);
    }
  };

  // GitHub 安装完成
  const handleInstall = async (data: {
    name: string;
    description: string;
    content: string;
    disableModelInvocation?: boolean;
  }) => {
    const res = await saveSkill({
      ...data,
      source: 'github',
      // 外部仓库的名字不受我们控制:不合标准就规范化后保存,而不是拒装
      allowNonStandardName: true,
    });
    if (res.ok) {
      toast.success(
        res.renamedFrom
          ? i18n.t('skillInstallDialog.installSuccessRenamed', {
              name: res.skill.name,
              from: res.renamedFrom,
            })
          : i18n.t('skillInstallDialog.installSuccess', { name: res.skill.name }),
      );
      await loadSkillsList();
    } else {
      toast.error(res.error || i18n.t('settings.skills.saveFailed'));
      throw new Error(res.error);
    }
  };

  // 删除技能
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const res = await deleteSkill(deleteTarget.id);
    if (res.ok) {
      toast.success(i18n.t('settings.skills.deleteSuccess', { name: deleteTarget.name }));
      setDeleteTarget(null);
      await loadSkillsList();
    } else {
      toast.error(res.error || i18n.t('settings.skills.deleteFailed'));
    }
  };

  // 让 AI 创作: 关闭设置 Drawer, 并预填提示词至 Composer
  const handleCreateWithAi = () => {
    const template = i18n.t('settings.skills.createPromptText');
    onPrefillPrompt?.(template);
    onBack();
  };

  return (
    <div className="space-y-3.5">
      {/* 头部标题与快捷操作 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-foreground">
            {i18n.t('settings.skills.title', { count: skills.length })}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            {i18n.t('settings.skills.desc')}
          </p>
        </div>

        {/* 顶部操作按钮 */}
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={handleCreateWithAi}
            className="h-7 px-2 text-xs gap-1"
          >
            <Sparkles className="size-3 text-muted-foreground" />
            <span>{i18n.t('settings.skills.createWithAi')}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => setInstallDialogOpen(true)}
            className="h-7 px-2 text-xs gap-1"
          >
            <Download className="size-3 text-muted-foreground" />
            <span>{i18n.t('settings.skills.installFromGithub')}</span>
          </Button>
          <Button
            type="button"
            size="xs"
            onClick={() => {
              setEditingSkill(null);
              setDialogOpen(true);
            }}
            className="h-7 px-2 text-xs gap-1"
          >
            <Plus className="size-3" />
            <span>{i18n.t('settings.skills.addSkill')}</span>
          </Button>
        </div>
      </div>

      {/* 技能列表 */}
      {skills.length === 0 && !loading ? (
        <Card className="p-4 border-dashed">
          <Empty className="p-2">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Layers className="size-6 text-muted-foreground/60" />
              </EmptyMedia>
              <EmptyTitle className="text-xs">{i18n.t('settings.skills.emptyTitle')}</EmptyTitle>
              <EmptyDescription className="text-[11px]">
                {i18n.t('settings.skills.emptyDesc')}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="pt-2 flex items-center justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingSkill(null);
                  setDialogOpen(true);
                }}
              >
                {i18n.t('settings.skills.emptyAction')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleCreateWithAi}
                className="gap-1"
              >
                <Sparkles className="size-3.5" />
                <span>{i18n.t('settings.skills.createWithAi')}</span>
              </Button>
            </EmptyContent>
          </Empty>
        </Card>
      ) : (
        <div className="space-y-2">
          {skills.map((skill) => {
            const isBuiltin = skill.source === 'builtin';
            const isGithub = skill.source === 'github';

            return (
              <Card
                key={skill.id}
                className={cn(
                  'p-2.5 transition-colors',
                  !skill.enabled && 'opacity-60 bg-muted/20',
                )}
              >
                {/* 顶栏: 来源标签、名字、启用开关、编辑与删除 */}
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1 flex-wrap">
                    {/* 来源图标与徽标 */}
                    {isBuiltin && (
                      <Badge variant="secondary" className="text-[10px] h-4 px-1 py-0 gap-0.5 shrink-0">
                        <Layers className="size-2.5" />
                        <span>{i18n.t('settings.skills.sourceBuiltin')}</span>
                      </Badge>
                    )}
                    {isGithub && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1 py-0 gap-0.5 shrink-0 text-muted-foreground">
                        <GitBranch className="size-2.5" />
                        <span>{i18n.t('settings.skills.sourceGithub')}</span>
                      </Badge>
                    )}
                    {!isBuiltin && !isGithub && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1 py-0 gap-0.5 shrink-0 text-muted-foreground">
                        <User className="size-2.5" />
                        <span>{i18n.t('settings.skills.sourceUser')}</span>
                      </Badge>
                    )}

                    {/* 仅手动唤起徽标 */}
                    {skill.disableModelInvocation && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] h-4 px-1 py-0 shrink-0 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50"
                      >
                        {i18n.t('settings.skills.manualOnlyBadge')}
                      </Badge>
                    )}

                    {/* 技能名称 */}
                    <span className="font-mono text-xs font-semibold text-foreground truncate">
                      {skill.name}
                    </span>
                  </div>

                  {/* 状态开关与操作区 */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Switch
                      checked={skill.enabled}
                      onCheckedChange={(val) => handleToggle(skill.id, val)}
                      aria-label={skill.name}
                    />

                    {/* 编辑按钮 */}
                    {isBuiltin ? (
                      <TooltipProvider delay={200}>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span className="inline-flex">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  disabled
                                  className="size-6 text-muted-foreground/40 disabled:opacity-40"
                                >
                                  <Pencil className="size-3" />
                                </Button>
                              </span>
                            }
                          />
                          <TooltipContent side="top">
                            {i18n.t('settings.skills.builtinCannotEdit')}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditingSkill(skill);
                          setDialogOpen(true);
                        }}
                        className="size-6 text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="size-3" />
                        <span className="sr-only">{i18n.t('settings.skills.editSkill')}</span>
                      </Button>
                    )}

                    {/* 删除按钮 */}
                    {isBuiltin ? (
                      <TooltipProvider delay={200}>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span className="inline-flex">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  disabled
                                  className="size-6 text-muted-foreground/40 disabled:opacity-40"
                                >
                                  <Trash2 className="size-3" />
                                </Button>
                              </span>
                            }
                          />
                          <TooltipContent side="top">
                            {i18n.t('settings.skills.builtinCannotDelete')}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteTarget(skill)}
                        className="size-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="size-3" />
                        <span className="sr-only">{i18n.t('settings.skills.deleteSkill')}</span>
                      </Button>
                    )}
                  </div>
                </div>

                {/* 描述 (1-2 行截断) */}
                <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed mt-1.5">
                  {skill.description}
                </p>

                {/* 状态与唤起提示 */}
                {!skill.enabled && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded border border-border/40">
                    <Info className="size-3 shrink-0 text-muted-foreground/70" />
                    <span className="truncate leading-tight">
                      {i18n.t('settings.skills.disabledHint', { name: skill.name })}
                    </span>
                  </div>
                )}

                {skill.enabled && skill.disableModelInvocation && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50/50 dark:bg-amber-950/20 px-2 py-0.5 rounded border border-amber-200/50 dark:border-amber-900/40">
                    <Info className="size-3 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span className="truncate leading-tight">
                      {i18n.t('settings.skills.manualOnlyHint', { name: skill.name })}
                    </span>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* 新建/编辑技能弹窗 */}
      <SkillDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        skill={editingSkill}
        onSave={handleSave}
        existingSkills={skills}
      />

      {/* 从 GitHub 安装技能弹窗 */}
      <SkillInstallDialog
        open={installDialogOpen}
        onOpenChange={setInstallDialogOpen}
        onInstall={handleInstall}
        existingSkills={skills}
      />

      {/* 删除二次确认 */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{i18n.t('settings.skills.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && i18n.t('settings.skills.deleteConfirmDesc', { name: deleteTarget.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{i18n.t('settings.skills.deleteConfirmCancel')}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={handleConfirmDelete}
            >
              {i18n.t('settings.skills.deleteConfirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
