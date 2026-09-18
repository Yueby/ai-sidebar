import React, { useState, type ReactNode } from 'react';
import { i18n } from '#i18n';
import type { RefElementMeta } from '@/lib/types';
import { renderMarkersInText } from './elementMarkerText';
import { Sparkles, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SkillContentBlockProps {
  name: string;
  content: string;
}

/**
 * 用户消息内技能正文的折叠徽章:
 * 斜杠命令会将 `<skill_content name="x">...正文...</skill_content>` 写入消息,
 * 在气泡内将其渲染为紧凑徽章 + 可展开查看的折叠区, 避免长文本刷屏。
 * 只改渲染, 不影响存储与发给模型的真实文本。
 */
export function SkillContentBlock({ name, content }: SkillContentBlockProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(content.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="my-1 text-left w-full">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-border/70 bg-accent text-accent-foreground hover:bg-accent/80 transition-colors text-[11px] font-medium cursor-pointer select-none align-middle"
        aria-expanded={open}
      >
        <Sparkles className="size-3 text-muted-foreground shrink-0" />
        <span className="text-[10px] text-muted-foreground font-normal">
          {i18n.t('messages.skillBadge')}
        </span>
        <span className="font-mono text-foreground font-semibold truncate max-w-[160px]">
          {name}
        </span>
        <span className="text-[10px] text-muted-foreground/80 font-normal ml-0.5">
          {open ? i18n.t('messages.collapseSkill') : i18n.t('messages.expandSkill')}
        </span>
        {open ? (
          <ChevronDown className="size-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="size-3 text-muted-foreground shrink-0" />
        )}
      </button>

      {open && (
        <div className="mt-1.5 rounded-md border border-border/70 bg-background/95 p-2.5 shadow-2xs animate-in fade-in-0 duration-150 motion-reduce:animate-none">
          <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-1.5 mb-1.5">
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              <Sparkles className="size-2.5" />
              <span>{i18n.t('messages.skillInstructions')}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={handleCopy}
              className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              {copied ? <Check className="size-2.5" /> : <Copy className="size-2.5" />}
              <span>{copied ? i18n.t('messages.copied') : i18n.t('messages.copy')}</span>
            </Button>
          </div>
          <pre className="max-h-56 overflow-y-auto font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap select-text p-1">
            {content.trim()}
          </pre>
        </div>
      )}
    </div>
  );
}

/**
 * 把文本按代码围栏切成"围栏内 / 围栏外"的段(CommonMark:行首最多 3 个空格 + 3 个以上 ` 或 ~)。
 * 围栏内是用户粘贴的**示例文本**,里面的 `<skill_content>` 不该被折叠成徽章。
 */
function splitCodeFences(text: string): { text: string; code: boolean }[] {
  const segments: { text: string; code: boolean }[] = [];
  let buffer: string[] = [];
  let fenceChar: string | null = null;
  const flush = (code: boolean): void => {
    if (buffer.length === 0) return;
    segments.push({ text: buffer.join('\n'), code });
    buffer = [];
  };
  for (const line of text.split('\n')) {
    const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (!fenceChar && open) {
      flush(false);
      fenceChar = open[1]![0]!;
      buffer.push(line);
      continue;
    }
    if (fenceChar) {
      buffer.push(line);
      const closeRe = new RegExp(`^\\s{0,3}\\${fenceChar}{3,}\\s*$`);
      if (closeRe.test(line)) {
        flush(true);
        fenceChar = null;
      }
      continue;
    }
    buffer.push(line);
  }
  flush(fenceChar !== null);
  return segments;
}

/**
 * 解析并渲染用户消息文本:
 * 优先抽离 `<skill_content name="x">...</skill_content>`(非代码段内),
 * 其它文本段落按既有 renderMarkersInText 处理(支持元素引用 chip)。
 *
 * 正文取到本段**最后一个** `</skill_content>`:技能正文里出现同类字面量时,
 * 非贪婪匹配会提前结束并留下半截正文。
 */
export function renderUserContentWithSkills(
  text: string,
  elementById?: Map<number, RefElementMeta> | null,
  tabUrlById?: Map<number, string>,
): ReactNode[] {
  const parts: ReactNode[] = [];
  const segments = splitCodeFences(text);

  segments.forEach((segment, index) => {
    // 分段是按 '\n' 切的,拼回去要补上分隔符(原文逐字不变)
    if (index > 0) parts.push('\n');
    if (segment.code) {
      parts.push(...renderMarkersInText(segment.text, elementById, tabUrlById));
      return;
    }
    const regex = /<skill_content\s+name="([^"]*)">([\s\S]*)<\/skill_content>/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(segment.text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(
          ...renderMarkersInText(segment.text.slice(lastIndex, match.index), elementById, tabUrlById),
        );
      }
      parts.push(
        <SkillContentBlock
          key={`skill-${match[1] ?? ''}-${index}-${match.index}`}
          name={match[1] ?? ''}
          content={match[2] ?? ''}
        />,
      );
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < segment.text.length) {
      parts.push(...renderMarkersInText(segment.text.slice(lastIndex), elementById, tabUrlById));
    }
  });

  return parts;
}
