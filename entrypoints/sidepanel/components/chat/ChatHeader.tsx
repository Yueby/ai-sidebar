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
  Loader2,
} from 'lucide-react';
import type { Session } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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
    setEditTitleValue(s.title || '新会话');
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
        <TooltipProvider delayDuration={300}>
          {/* New Chat Session */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onNewSession}
                className="size-7"
              >
                <Plus className="size-3.5" />
                <span className="sr-only">新建会话</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              <p>新建会话</p>
            </TooltipContent>
          </Tooltip>

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
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                  >
                    <History className="size-3.5" />
                    <span className="sr-only">历史会话</span>
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                <p>历史会话</p>
              </TooltipContent>
            </Tooltip>

            <DropdownMenuContent align="end" className="w-64 max-h-80 overflow-y-auto">
              <DropdownMenuItem
                onClick={onNewSession}
                className="text-xs cursor-pointer gap-2"
              >
                <Plus className="size-3.5" />
                <span>新建会话</span>
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                历史会话 ({sessions.length})
              </DropdownMenuLabel>

              {sortedSessions.length === 0 ? (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground italic">
                  暂无历史会话
                </div>
              ) : (
                sortedSessions.map((s) => {
                  const isActive = s.id === activeSessionId;
                  const isConfirming = deletingId === s.id;
                  const isEditing = editingId === s.id;
                  const isAiTitling = titlingSessionIds?.has(s.id);

                  if (isConfirming) {
                    return (
                      <div
                        key={s.id}
                        className="flex items-center justify-between px-2 py-1.5 text-xs bg-destructive/10 rounded-sm animate-in fade-in-0 duration-100"
                      >
                        <span className="text-destructive font-medium truncate">确认删除?</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteSession(s.id);
                              setDeletingId(null);
                            }}
                            className="px-1.5 py-0.5 rounded text-[11px] bg-destructive text-destructive-foreground hover:bg-destructive/90 cursor-pointer"
                          >
                            删除
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingId(null);
                            }}
                            className="px-1.5 py-0.5 rounded text-[11px] bg-secondary text-secondary-foreground hover:bg-secondary/80 cursor-pointer"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    );
                  }

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
                          title="保存 (Enter)"
                        >
                          <Check className="size-3 text-foreground" />
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelRename}
                          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-background transition-colors cursor-pointer"
                          title="取消 (Esc)"
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
                      <span className="truncate flex-1 pr-1.5" title={s.title || '新会话'}>
                        {s.title || '新会话'}
                      </span>

                      <div className="flex items-center gap-0.5 shrink-0">
                        {isAiTitling ? (
                          <span className="p-0.5 text-muted-foreground" title="AI 正在生成标题…">
                            <Loader2 className="size-3 animate-spin" />
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
                                title="AI 生成标题"
                              >
                                <Sparkles className="size-3" />
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
                                title="重命名会话"
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
                            setDeletingId(s.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-destructive text-muted-foreground rounded hover:bg-muted/60 cursor-pointer"
                          title="删除会话"
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
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onOpenSettings}
                className="size-7"
              >
                <SettingsIcon className="size-3.5" />
                <span className="sr-only">设置</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              <p>设置</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </header>
  );
}
