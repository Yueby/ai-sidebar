import type { Editor } from '@tiptap/core';
import type { PickedElement } from '@/lib/types';
import { makeElementMarker } from '@/lib/types';
import { elementChipLabel } from '@/lib/elementLabel';
import type { InlineBadgeAttrs } from './InlineBadge';

/**
 * TipTap 编辑器状态序列化(照抄 sanshu extractFromNode/extractEditorState,单遍遍历):
 * 徽章 → computeBadgeTag 文本(协议 = [元素:N],与 useChatTurn refs.elements 组装、
 * ELEMENT_MARKER_RE 消费完全一致);hardBreak → \n;段落尾追加 \n。
 */

/** 徽章 → 文本标记:sanshu 同形 —— element 输出 [元素:N](协议冻结),url 输出 [url: {label}](模型侧自描述) */
export function computeBadgeTag(attrs: { badgeType: string; label: string; elementId?: number }): string {
  if (attrs.badgeType === 'url') return `[url: ${attrs.label}]`;
  return makeElementMarker(attrs.elementId ?? 0);
}

export interface ExtractedEditorState {
  text: string;
  /** 文本内出现的元素标记号集合(诊断/归一化预留) */
  elementIds: Set<number>;
}

function extractFromNode(node: unknown, state: ExtractedEditorState): void {
  if (!node || typeof node !== 'object') return;
  const n = node as {
    type?: string;
    text?: string;
    content?: unknown[];
    attrs?: { serialized?: string; identity?: string };
  };
  if (n.type === 'text') {
    state.text += n.text || '';
    return;
  }
  if (n.type === 'hardBreak') {
    state.text += '\n';
    return;
  }
  if (n.type === 'inlineBadge') {
    if (n.attrs) {
      const id = Number(n.attrs.identity);
      if (Number.isFinite(id)) state.elementIds.add(id);
      state.text += n.attrs.serialized || '';
    }
    return;
  }
  if (Array.isArray(n.content)) {
    for (const child of n.content) extractFromNode(child, state);
  }
  if (n.type === 'paragraph') state.text += '\n';
}

export function extractEditorState(editor: Editor | null): ExtractedEditorState {
  const state: ExtractedEditorState = { text: '', elementIds: new Set<number>() };
  if (!editor) return state;
  extractFromNode(editor.getJSON(), state);
  state.text = state.text.replace(/\n$/, '');
  return state;
}

/** 由框选元素构造徽章 attrs(label = 内容预览;title = #{N} · selector;referenceData 存 PickedElement 全量) */
export function buildBadgeAttrs(element: PickedElement): InlineBadgeAttrs {
  const label = elementChipLabel(element);
  return {
    badgeType: 'element',
    identity: String(element.elementId),
    label,
    kind: '元素',
    serialized: computeBadgeTag({ badgeType: 'element', label, elementId: element.elementId }),
    referenceData: JSON.stringify(element),
    imageBadgeId: null,
    title: `#${element.elementId} · ${element.selector}`,
  };
}

const URL_PATTERN = /^https?:\/\/\S+$/i;

/** 粘贴文本是否为单一 URL(无空白/换行;多行或含空格走普通文本) */
export function isSingleUrlText(text: string): boolean {
  return URL_PATTERN.test(text.trim());
}

/** 由粘贴的 URL 构造 url 徽章 attrs(label = 去协议名/尾斜杠的展示名,referenceData 存完整 URL) */
export function buildUrlBadgeAttrs(url: string): InlineBadgeAttrs {
  const label = url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return {
    badgeType: 'url',
    identity: url.trim().toLowerCase(),
    label,
    kind: 'URL',
    serialized: computeBadgeTag({ badgeType: 'url', label }),
    referenceData: JSON.stringify({ type: 'url', url }),
    imageBadgeId: null,
    title: url,
  };
}
