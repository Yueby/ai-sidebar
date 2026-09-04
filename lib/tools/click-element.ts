import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { toolLabel } from '../toolLabels';
import { type ToolRisk } from '../types';
import { performPageAction, snapshotTabs, describeTabChanges, type ActionLocator } from '../pageContext';
import { requestGate } from '../gate';
import { formatLocator, renderActionFailure, renderActionSuccess, resolveActionTab } from './page-action-shared';

const LOCATOR_PARAMS = Type.Object({
  role: Type.String({
    description: 'ARIA role of the element, exactly as listed by search_element (e.g. button, textbox, link)',
  }),
  name: Type.String({
    description: 'Accessible name of the element exactly as listed by search_element; use an empty string for unnamed elements',
  }),
  ordinal: Type.Optional(
    Type.Number({
      description: 'Ordinal among elements sharing the same role and accessible name (the [2]/[3] markers in search_element output); default 1',
    }),
  ),
});

const CLICK_ELEMENT_PARAMS = Type.Object({
  locator: LOCATOR_PARAMS,
  tabId: Type.Optional(
    Type.Number({
      description: 'Id of the tab to act on; omit to use the currently focused tab',
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
 * click_element 工具定义(confirm 型 + 会话级 grant):按 ARIA locator 点击页面元素。
 * 执行前先在 content 侧解析 locator(确认卡展示真实命中的元素),再经 requestGate
 * 确认(grantScope = click_element@tabId,工具+tab 粒度);content 侧完成
 * scrollIntoView → 400ms 高亮 → 遮挡检测 → 合成鼠标序列(遮挡时 fallback 直发)→ settle。
 */
export function createClickElementToolDefinition(): AgentTool<typeof CLICK_ELEMENT_PARAMS> & {
  risk: ToolRisk;
} {
  return {
    name: 'click_element',
    label: toolLabel('click_element'),
    risk: 'confirm',
    description:
      'Click an interactive element on a web page by its ARIA locator (role + accessible name + optional ordinal), exactly as listed by search_element. The element is scrolled into view, flashed with an outline for feedback, then clicked with a synthetic (untrusted) mouse event sequence — most sites and frameworks respond to it, but a few may require a real user click. If the element is covered by another element, the events are dispatched directly on the target and the result says so. Defaults to the currently focused tab; pass tabId to act on another tab. Every call requires explicit user approval via a confirmation card unless the user granted this session for this tool and tab.',
    parameters: CLICK_ELEMENT_PARAMS,
    execute: async (toolCallId, args) => {
      const locator = parseLocatorArgs(args);
      if (!locator) {
        return {
          content: [
            { type: 'text', text: 'Invalid locator: a locator object with role and name strings is required.' },
          ],
          details: null,
        };
      }
      const tab = await resolveActionTab(args?.tabId);
      if ('errorText' in tab) {
        return { content: [{ type: 'text', text: tab.errorText }], details: null };
      }
      const { tabId } = tab;

      const resolved = await performPageAction(tabId, 'resolve', { locator });
      if (!resolved) {
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
      if (!resolved.ok) {
        return {
          content: [{ type: 'text', text: renderActionFailure(tabId, resolved) }],
          details: { tabId, locator },
        };
      }

      const approved = await requestGate({
        kind: 'confirm',
        toolName: 'click_element',
        label: toolLabel('click_element'),
        summary: '在页面中点击元素',
        detail: `Click [${formatLocator(locator)}] on tab #${tabId} (${resolved.url})\nResolved: <${resolved.element?.tagName}> ${resolved.element?.preview}`,
        toolCallId,
        grantable: true,
        grantScope: `click_element@${tabId}`,
      });
      if (!(approved.kind === 'confirm' && approved.approved)) {
        return {
          content: [{ type: 'text', text: 'User denied permission to run this tool.' }],
          details: { denied: true, tabId, locator },
        };
      }

      // target=_blank 链接会开新 tab:前后对比,把新页/焦点变化写进结果,模型不必再猜
      const tabsBefore = await snapshotTabs();
      const result = await performPageAction(tabId, 'click', { locator });
      if (!result) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to reach tab #${tabId}: it may have been closed or navigated away. Adjust accordingly.`,
            },
          ],
          details: null,
        };
      }
      if (!result.ok) {
        return {
          content: [{ type: 'text', text: renderActionFailure(tabId, result) }],
          details: { tabId, locator },
        };
      }
      const tabNote = await describeTabChanges(tabsBefore);
      return {
        content: [{ type: 'text', text: renderActionSuccess('Clicked', locator, tabId, result) + (tabNote ? `\n${tabNote}` : '') }],
        details: { tabId, locator },
      };
    },
  };
}
