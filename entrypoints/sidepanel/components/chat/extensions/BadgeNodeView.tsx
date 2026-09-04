import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper } from '@tiptap/react';
import { Link, SquareMousePointer, X } from 'lucide-react';
import { i18n } from '#i18n';

/**
 * inlineBadge 节点的 React NodeView:
 * NodeViewWrapper as="span" 内联渲染;叉号 = 整块删除并连带尾随空格(deleteBadgeWithSpace);
 * url 徽章用 Link 图标、element 徽章用框选图标;handleUnlink/URL 菜单按移植清单省略。
 */
export function BadgeNodeView({ node, editor, getPos, deleteNode }: NodeViewProps) {
  const { label, badgeType, elementId, selector } = node.attrs as {
    label: string;
    badgeType: string;
    elementId: number;
    selector: string;
  };
  const Icon = badgeType === 'url' ? Link : SquareMousePointer;
  const title = badgeType === 'url' ? label : `#${elementId} · ${selector}`;

  /** 整块删除:节点 + 紧随其后的一个空白字符(若为文本且以空白开头) */
  const deleteBadgeWithSpace = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const pos = getPos();
    if (typeof pos !== 'number') {
      deleteNode();
      return;
    }

    const nodeEnd = pos + node.nodeSize;
    const afterNode = editor.state.doc.nodeAt(nodeEnd);
    const deleteEnd =
      afterNode?.isText && /^[\s\u00a0]/.test(afterNode.text || '') ? nodeEnd + 1 : nodeEnd;

    editor.chain().focus().deleteRange({ from: pos, to: deleteEnd }).run();
  };

  return (
    <NodeViewWrapper as="span" className="element-chip" title={title}>
      <button
        type="button"
        className="element-chip-delete"
        onMouseDown={(e) => e.preventDefault()}
        onClick={deleteBadgeWithSpace}
        title={i18n.t('refBar.removeElementRefTitle')}
      >
        <X className="size-2.5" />
      </button>
      <Icon className="size-3 shrink-0 text-muted-foreground" />
      <span className="element-chip-label">{label}</span>
    </NodeViewWrapper>
  );
}
