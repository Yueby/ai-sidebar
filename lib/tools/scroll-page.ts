import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { toolLabel } from '../toolLabels';
import { type ToolRisk } from '../types';
import { performPageAction, type ActionLocator } from '../pageContext';
import { renderActionFailure, renderActionSuccess, resolveActionTab } from './page-action-shared';

const SCROLL_PAGE_PARAMS = Type.Object({
  direction: Type.Union([Type.Literal('up'), Type.Literal('down'), Type.Literal('left'), Type.Literal('right')], {
    description: 'Direction to scroll the viewport',
  }),
  amount: Type.Optional(
    Type.Number({
      description: 'Distance in pixels; defaults to about 80% of the viewport height (or width for left/right)',
    }),
  ),
  locator: Type.Optional(
    Type.Object({
      role: Type.String({
        description: 'ARIA role of the element to scroll into view, exactly as listed by search_element',
      }),
      name: Type.String({
        description: 'Accessible name of the element exactly as listed by search_element; use an empty string for unnamed elements',
      }),
      ordinal: Type.Optional(
        Type.Number({
          description: 'Ordinal among elements sharing the same role and accessible name; default 1',
        }),
      ),
    }),
  ),
  tabId: Type.Optional(
    Type.Number({
      description: 'Id of the tab to scroll; omit to use the currently focused tab',
    }),
  ),
});

function parseLocatorArgs(args: unknown): ActionLocator | null {
  const raw = (args as { locator?: unknown } | undefined)?.locator;
  if (!raw || typeof raw !== 'object') return null;
  const x = raw as Record<string, unknown>;
  if (typeof x.role !== 'string' || typeof x.name !== 'string') return null;
  return {
    role: x.role,
    name: x.name,
    ordinal: typeof x.ordinal === 'number' && x.ordinal > 0 ? x.ordinal : undefined,
  };
}

/**
 * scroll_page 工具定义(safe):视口 scrollBy 或按 locator scrollIntoView(免确认)。
 * 用于把目标元素/页面区域带入视野,配合 read_element / click_element 使用。
 */
export function createScrollPageToolDefinition(): AgentTool<typeof SCROLL_PAGE_PARAMS> & {
  risk: ToolRisk;
} {
  return {
    name: 'scroll_page',
    label: toolLabel('scroll_page'),
    risk: 'safe',
    description:
      'Scroll a web page tab: by viewport in one of four directions (defaults to about 80% of the viewport), or scroll a specific element into view by passing its locator (role + accessible name + optional ordinal, exactly as listed by search_element). Defaults to the currently focused tab; pass tabId to scroll another tab.',
    parameters: SCROLL_PAGE_PARAMS,
    execute: async (_toolCallId, args) => {
      const direction = typeof args?.direction === 'string' ? args.direction : '';
      if (direction !== 'up' && direction !== 'down' && direction !== 'left' && direction !== 'right') {
        return {
          content: [
            {
              type: 'text',
              text: 'Invalid direction: must be one of "up", "down", "left", "right".',
            },
          ],
          details: null,
        };
      }
      const tab = await resolveActionTab(args?.tabId);
      if ('errorText' in tab) {
        return { content: [{ type: 'text', text: tab.errorText }], details: null };
      }
      const { tabId } = tab;
      const locator = parseLocatorArgs(args);
      const result = await performPageAction(tabId, 'scroll', {
        direction,
        amount: typeof args?.amount === 'number' ? args.amount : undefined,
        locator: locator ?? undefined,
      });
      if (!result) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to reach tab #${tabId}: it may have been closed, may not be a regular web page (e.g. a browser settings page), or may still be loading. Adjust accordingly.`,
            },
          ],
          details: null,
        };
      }
      if (!result.ok) {
        return {
          content: [{ type: 'text', text: renderActionFailure(tabId, result) }],
          details: { tabId, direction },
        };
      }
      return {
        content: [{ type: 'text', text: renderActionSuccess('Scrolled', locator, tabId, result) }],
        details: { tabId, direction },
      };
    },
  };
}
