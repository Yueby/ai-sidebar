import { mergeAttributes, Node } from '@tiptap/core';
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { BadgeNodeView } from './BadgeNodeView';
import { serializePickedElementBlock } from './editorSerialize';

const badgeSelectionKey = new PluginKey('inlineBadgeSelection');

export interface InlineBadgeAttrs {
  badgeType: 'url' | 'element';
  /** element 徽章:数据侧标记号(与 refs.elements[].id 一致) */
  elementId: number;
  tabId: number;
  selector: string;
  tagName: string;
  label: string;
  /** 消息文本内的自闭合块字符串(单一表示;extract 直接消费) */
  serialized: string;
}

export const InlineBadge = Node.create({
  name: 'inlineBadge',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      badgeType: { default: 'element' },
      elementId: { default: 0 },
      tabId: { default: 0 },
      selector: { default: '' },
      tagName: { default: '' },
      label: { default: '' },
      serialized: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'picked-element',
        getAttrs: (el) => {
          const e = el as HTMLElement;
          const attrs = {
            badgeType: 'element' as const,
            elementId: parseInt(e.getAttribute('elementId') ?? '', 10) || 0,
            tabId: parseInt(e.getAttribute('tabId') ?? '', 10) || 0,
            selector: e.getAttribute('selector') ?? '',
            tagName: e.getAttribute('tagName') ?? '',
            label: e.getAttribute('label') ?? '',
          };
          return { ...attrs, serialized: serializePickedElementBlock(attrs) };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['picked-element', mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BadgeNodeView, {
      stopEvent: () => true,
    });
  },

  addProseMirrorPlugins() {
    const typeName = this.name;
    return [
      new Plugin({
        props: {
          handleKeyDown(view, event) {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return false;

            const { state } = view;
            const { selection } = state;
            const isLeft = event.key === 'ArrowLeft';

            if (selection instanceof NodeSelection && selection.node.type.name === typeName) {
              if (event.shiftKey) {
                const anchor = isLeft ? selection.to : selection.from;
                const head = isLeft ? selection.from : selection.to;
                view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, anchor, head)));
              } else {
                const pos = isLeft ? selection.from : selection.to;
                view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)));
              }
              return true;
            }

            if (event.shiftKey) return false;

            if (selection instanceof TextSelection && selection.empty) {
              const { $from } = selection;
              if (isLeft) {
                const before = $from.nodeBefore;
                if (before?.type.name === typeName) {
                  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, $from.pos - before.nodeSize)));
                  return true;
                }
              } else {
                const after = $from.nodeAfter;
                if (after?.type.name === typeName) {
                  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, $from.pos + after.nodeSize)));
                  return true;
                }
              }
            }

            return false;
          },
        },
      }),
      new Plugin({
        key: badgeSelectionKey,
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr, _oldDecos, _oldState, newState) {
            const { selection } = newState;
            if (selection.empty && !(selection instanceof NodeSelection)) return DecorationSet.empty;

            const decorations: Decoration[] = [];
            const { from, to } = selection;

            newState.doc.nodesBetween(from, to, (node, pos) => {
              if (node.type.name === typeName && pos >= from && pos + node.nodeSize <= to) {
                decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'badge-in-selection' }));
              }
            });

            return decorations.length ? DecorationSet.create(newState.doc, decorations) : DecorationSet.empty;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
