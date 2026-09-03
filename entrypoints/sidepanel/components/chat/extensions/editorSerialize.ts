import type { Editor } from '@tiptap/core';
import type { PickedElement } from '@/lib/types';
import { elementChipLabel } from '@/lib/elementLabel';
import type { InlineBadgeAttrs } from './InlineBadge';

/**
 * TipTap 编辑器状态序列化(单遍遍历):
 * inlineBadge → serialized(消息文本内的自闭合 <picked-element …/> 块,单一表示);
 * hardBreak → \n;段落尾追加 \n。
 */

/** 属性值 HTML 转义:防 selector/label 中的引号/尖括号破坏块结构与气泡渲染正则 */
function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 元素徽章的消息文本表示(自闭合块;与 InlineBadge parseHTML/renderHTML 同标签) */
export function serializePickedElementBlock(attrs: {
  elementId: number;
  tabId: number;
  selector: string;
  tagName: string;
  label: string;
}): string {
  return `<picked-element elementId="${attrs.elementId}" tabId="${attrs.tabId}" selector="${escapeAttr(
    attrs.selector,
  )}" tagName="${escapeAttr(attrs.tagName)}" label="${escapeAttr(attrs.label)}" />`;
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
    attrs?: { serialized?: string; elementId?: number };
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
      const id = Number(n.attrs.elementId);
      if (Number.isFinite(id) && id > 0) state.elementIds.add(id);
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

/** 由框选元素构造徽章 attrs(label = 内容预览;serialized = 自闭合块字符串) */
export function buildBadgeAttrs(element: PickedElement): InlineBadgeAttrs {
  const label = elementChipLabel(element);
  const core = {
    elementId: element.elementId,
    tabId: element.tabId,
    selector: element.selector,
    tagName: element.tagName,
    label,
  };
  return {
    badgeType: 'element',
    ...core,
    serialized: serializePickedElementBlock(core),
  };
}

const URL_PATTERN = /^https?:\/\/\S+$/i;

/** 粘贴文本是否为单一 URL(无空白/换行;多行或含空格走普通文本) */
export function isSingleUrlText(text: string): boolean {
  return URL_PATTERN.test(text.trim());
}

/** 由粘贴的 URL 构造 url 徽章 attrs(label = 去协议名/尾斜杠的展示名) */
export function buildUrlBadgeAttrs(url: string): InlineBadgeAttrs {
  const label = url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return {
    badgeType: 'url',
    elementId: 0,
    tabId: 0,
    selector: '',
    tagName: '',
    label,
    serialized: `[url: ${label}]`,
  };
}
