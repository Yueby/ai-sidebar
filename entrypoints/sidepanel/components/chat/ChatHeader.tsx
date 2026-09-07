import React, { useState, useRef, useEffect } from 'react';
import {
  Plus,
  History,
  Settings as SettingsIcon,
  Trash2,
  Check,
  X,
  Pencil,
  Sparkles,
  Download,
} from 'lucide-react';
import type { Session } from '@/lib/types';
import { i18n } from '#i18n';
import { downloadSessionMarkdown } from '@/lib/sessionExport';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ChatHeaderProps {
  title?: string;
  sessions: Session[];
  activeSessionId: string | null;
  titlingSessionIds?: Set<string>;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession?: (id: string, newTitle: string) => void;
  onAiTitleSession?: (id: string) => void;
  onNewSession: () => void;
  onOpenSettings: () => void;
}

export function ChatHeader({
  sessions,
  activeSessionId,
  titlingSessionIds,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onAiTitleSession,
  onNewSession,
  onOpenSettings,
}: ChatHeaderProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitleValue, setEditTitleValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  const sortedSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const handleStartRename = (s: Session) => {
    setDeletingId(null);
    setEditingId(s.id);
    setEditTitleValue(s.title || i18n.t('header.untitled'));
  };

  const handleSaveRename = (id: string) => {
    if (editTitleValue.trim()) {
      onRenameSession?.(id, editTitleValue.trim());
    }
    setEditingId(null);
  };

  const handleCancelRename = () => {
    setEditingId(null);
    setEditTitleValue('');
  };

  return (
    <header className="flex h-10 shrink-0 items-center justify-end bg-background px-3 select-none">
      {/* Right: Action Buttons Group */}
      <div className="flex items-center gap-1 shrink-0">
        <TooltipProvider delay={300}>
          {/* History Sessions Dropdown */}
          <DropdownMenu
            onOpenChange={(open) => {
              if (!open) {
                setDeletingId(null);
                setEditingId(null);
              }
            }}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                      >
                        <History className="size-3.5" />
                        <span className="sr-only">{i18n.t('header.history')}</span>
                      </Button>
                    }
                  />
                }
              />
              <TooltipContent side="bottom" className="text-xs">
                <p>{i18n.t('header.history')}</p>
              </TooltipContent>
            </Tooltip>

            <DropdownMenuContent align="end" className="w-64 max-h-80 overflow-y-auto">
              <DropdownMenuItem
                onClick={onNewSession}
                className="text-xs cursor-pointer gap-2"
              >
                <Plus className="size-3.5" />
                <span>{i18n.t('header.newSession')}</span>
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                {i18n.t('header.historyCount', { count: sessions.length })}
              </DropdownMenuLabel>

              {sortedSessions.length === 0 ? (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground italic">
                  {i18n.t('header.emptyHistory')}
                </div>
              ) : (
                sortedSessions.map((s) => {
                  const isActive = s.id === activeSessionId;
                  const isEditing = editingId === s.id;
                  const isAiTitling = titlingSessionIds?.has(s.id);

                  if (isEditing) {
                    return (
                      <div
                        key={s.id}
                        className="flex items-center gap-1 px-1.5 py-1 text-xs bg-accent/60 rounded-sm border border-border/40"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          ref={editInputRef}
                          type="text"
                          value={editTitleValue}
                          onChange={(e) => setEditTitleValue(e.target.value)}
                          onKeyDown={(e) => {
                            // Radix DropdownMenuContent 会捕获 ArrowUp/Down 劫持光标移动,
                            // 阻断冒泡让行内编辑框保有原生输入键位(Enter/Esc 处理保留在后)
                            e.stopPropagation();
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleSaveRename(s.id);
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              handleCancelRename();
                            }
                          }}
                          className="flex-1 min-w-0 bg-background/90 px-1.5 py-0.5 rounded text-xs border border-border outline-none focus:border-ring text-foreground font-normal"
                          maxLength={40}
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveRename(s.id)}
                          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-background transition-colors cursor-pointer"
                          title={i18n.t('header.saveTitle')}
                        >
                          <Check className="size-3 text-foreground" />
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelRename}
                          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-background transition-colors cursor-pointer"
                          title={i18n.t('header.cancelEdit')}
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={s.id}
                      className={cn(
                        'group flex items-center justify-between rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors',
                        isActive && 'bg-accent/70 font-medium'
                      )}
                      onClick={() => onSelectSession(s.id)}
                    >
                      <span className="truncate flex-1 pr-1.5" title={s.title || i18n.t('header.untitled')}>
                        {s.title || i18n.t('header.untitled')}
                      </span>

                      <div className="flex items-center gap-0.5 shrink-0">
                        {isAiTitling ? (
                          <span className="p-0.5 text-muted-foreground" title={i18n.t('header.aiTitling')}>
                            <Spinner className="size-3" />
                          </span>
                        ) : (
                          <>
                            {/* AI 命名按钮 (仅当有消息时显示 hover 入口) */}
                            {s.messages.length > 0 && onAiTitleSession && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onAiTitleSession(s.id);
                                }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-foreground text-muted-foreground rounded hover:bg-muted/60 cursor-pointer"
                                title={i18n.t('header.aiTitle')}
                              >
                                <Sparkles className="size-3" />
                              </button>
                            )}

                            {/* 导出会话按钮(空会话不导出:没有内容可导) */}
                            {s.messages.length > 0 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  downloadSessionMarkdown(s);
                                }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-foreground text-muted-foreground rounded hover:bg-muted/60 cursor-pointer"
                                title={i18n.t('header.exportMd')}
                                aria-label={i18n.t('header.exportMd')}
                              >
                                <Download className="size-3" />
                              </button>
                            )}

                            {/* 手动重命名按钮 */}
                            {onRenameSession && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStartRename(s);
                                }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-foreground text-muted-foreground rounded hover:bg-muted/60 cursor-pointer"
                                title={i18n.t('header.rename')}
                              >
                                <Pencil className="size-3" />
                              </button>
                            )}
                          </>
                        )}

                        {/* 删除会话按钮 */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget(s);
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-destructive text-muted-foreground rounded hover:bg-muted/60 cursor-pointer"
                          title={i18n.t('header.delete')}
                        >
                          <Trash2 className="size-3" />
                        </button>

                        {/* 活跃指示勾标 */}
                        {isActive && <Check className="size-3 text-muted-foreground ml-0.5" />}
                      </div>
                    </div>
                  );
                })
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Settings */}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onOpenSettings}
                  className="size-7"
                >
                  <SettingsIcon className="size-3.5" />
                  <span className="sr-only">{i18n.t('header.settings')}</span>
                </Button>
              }
            />
            <TooltipContent side="bottom" className="text-xs">
              <p>{i18n.t('header.settings')}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* 删除会话二次确认(dialog 统一删除语义) */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{i18n.t('header.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {i18n.t('header.deleteConfirmDesc', { title: deleteTarget?.title || i18n.t('header.untitled') })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTarget(null)}>{i18n.t('header.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() => {
                if (deleteTarget) onDeleteSession(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              {i18n.t('header.deleteAction')}
                        </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}
