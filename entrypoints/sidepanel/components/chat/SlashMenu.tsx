import React from 'react';
import type { SlashCommand } from '@/lib/slashCommands';

interface SlashMenuProps {
  commands: SlashCommand[];
  /** 当前高亮项(键盘导航) */
  activeIndex: number;
  /** 鼠标点击执行(mousedown 防止 textarea 先失焦) */
  onSelect: (index: number) => void;
  /** 鼠标悬停同步高亮 */
  onHover: (index: number) => void;
}

/** 斜杠命令浮层:输入框上方 absolute,实时前缀过滤,↑↓ 高亮 */
export function SlashMenu({ commands, activeIndex, onSelect, onHover }: SlashMenuProps) {
  if (commands.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="快捷命令"
      className="absolute bottom-full left-0 right-0 z-30 mb-2 overflow-y-auto rounded-lg border border-border bg-popover/95 backdrop-blur-md p-1 shadow-md animate-in fade-in-0 slide-in-from-bottom-1 duration-150 motion-reduce:animate-none"
      style={{ maxHeight: 'min(200px, 50vh)' }}
    >
      <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground border-b border-border/40 mb-0.5">
        快捷命令
      </div>
      {commands.map((cmd, i) => (
        <button
          key={cmd.name}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(i);
          }}
          onMouseEnter={() => onHover(i)}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors cursor-pointer ${
            i === activeIndex ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-accent/60 text-foreground'
          }`}
        >
          <span className="shrink-0 font-mono text-[11px] font-semibold text-foreground">
            /{cmd.name}
            {cmd.argumentHint && (
              <span className="text-muted-foreground font-normal"> {cmd.argumentHint}</span>
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground text-right">
            {cmd.description}
          </span>
        </button>
      ))}
    </div>
  );
}
