import React, { useState } from 'react';
import {
  Plus,
  History,
  Settings as SettingsIcon,
  Trash2,
  Check,
  X,
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
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onNewSession: () => void;
  onOpenSettings: () => void;
}

export function ChatHeader({
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onNewSession,
  onOpenSettings,
}: ChatHeaderProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const sortedSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

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
          <DropdownMenu onOpenChange={(open) => !open && setDeletingId(null)}>
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

            <DropdownMenuContent align="end" className="w-60 max-h-80 overflow-y-auto">
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

                  if (isConfirming) {
                    return (
                      <div
                        key={s.id}
                        className="flex items-center justify-between px-2 py-1.5 text-xs bg-destructive/10 rounded-sm"
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
                            className="px-1.5 py-0.5 rounded text-[11px] bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            删除
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingId(null);
                            }}
                            className="px-1.5 py-0.5 rounded text-[11px] bg-secondary text-secondary-foreground"
                          >
                            取消
                          </button>
                        </div>
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
                      <span className="truncate flex-1 pr-2">
                        {s.title || '新会话'}
                      </span>

                      <div className="flex items-center gap-1 shrink-0">
                        {isActive && <Check className="size-3 text-muted-foreground" />}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeletingId(s.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:text-destructive text-muted-foreground"
                          title="删除会话"
                        >
                          <Trash2 className="size-3" />
                        </button>
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
