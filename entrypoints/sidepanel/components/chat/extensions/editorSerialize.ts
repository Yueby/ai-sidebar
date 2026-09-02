import type { Editor } from '@tiptap/core';
import type { PickedElement } from '@/lib/types';
import { makeElementMarker } from '@/lib/types';
import type { InlineBadgeAttrs } from './InlineBadge';

/**
 * TipTap 编辑器状态序列化(照抄 sanshu extractFromNode/extractEditorState,单遍遍历):
 * 徽章 → computeBadgeTag 文本(协议 = [元素:N],与 useChatTurn refs.elements 组装、
 * ELEMENT_MARKER_RE 消费完全一致);hardBreak → \n;段落尾追加 \n。
 */

export function computeBadgeTag(element: { elementId: number }): string {
  return makeElementMarker(element.elementId);
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

/** 由框选元素构造徽章 attrs(referenceData 存 PickedElement 全量,identity = elementId 字符串) */
export function buildBadgeAttrs(element: PickedElement): InlineBadgeAttrs {
  return {
    badgeType: 'element',
    identity: String(element.elementId),
    label: element.preview || `元素 ${element.elementId}`,
    kind: '元素',
    serialized: computeBadgeTag(element),
    referenceData: JSON.stringify(element),
    imageBadgeId: null,
    title: element.preview,
  };
}
