import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { toolLabel } from '../toolLabels';
import { type ToolRisk } from '../types';
import { performPageAction, type ActionLocator } from '../pageContext';
import { requestGate } from '../gate';
import { formatLocator, renderActionFailure, renderActionSuccess, resolveActionTab } from './page-action-shared';

const LOCATOR_PARAMS = Type.Object({
  role: Type.String({
    description: 'ARIA role of the element, exactly as listed by search_element (e.g. textbox, combobox, checkbox)',
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

const FILL_ELEMENT_PARAMS = Type.Object({
  locator: LOCATOR_PARAMS,
  value: Type.String({
    description:
      'Value to fill. Text fields and textareas: the text to enter (an empty string clears the field). Selects: the option value or its visible text. Checkboxes, radios and switches: "true" or "false".',
  }),
  submit: Type.Optional(
    Type.Union([Type.Literal('enter')], {
      description:
        "After filling a TEXT field, dispatch an Enter key press to submit (e.g. chat/message boxes). Ignored for selects and toggles. Synthetic (untrusted) key events work with most frameworks; if a site ignores them, fill without submit and click its send button instead.",
    }),
  ),
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
 * fill_element 工具定义(confirm 型 + 会话级 grant):按 ARIA locator 填充页面元素。
 * content 侧按元素分类执行:select(选项匹配)/ toggle(true/false)/ 文本类
 * (原生 prototype setter + input/change 事件,React/Vue 兼容;空串=清空)。
 * grantScope = fill_element@tabId(工具+tab 粒度)。
 */
export function createFillElementToolDefinition(): AgentTool<typeof FILL_ELEMENT_PARAMS> & {
  risk: ToolRisk;
} {
  return {
    name: 'fill_element',
    label: toolLabel('fill_element'),
    risk: 'confirm',
    description:
      'Fill an interactive element on a web page by its ARIA locator (role + accessible name + optional ordinal), exactly as listed by search_element. The element kind is detected automatically: text fields and textareas receive the text via native setter + input/change events (works with React and Vue), selects are matched by option value or visible text, checkboxes/radios/switches accept "true" or "false". An empty string clears a text field. The element is scrolled into view and flashed with an outline for feedback. Defaults to the currently focused tab; pass tabId to act on another tab. Every call requires explicit user approval via a confirmation card showing the target element and the value, unless the user granted this session for this tool and tab.',
    parameters: FILL_ELEMENT_PARAMS,
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
      const value = typeof args?.value === 'string' ? args.value : '';
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

      const valuePreview = value.length > 200 ? `${value.slice(0, 200)}… (${value.length} chars)` : value;
      const approved = await requestGate({
        kind: 'confirm',
        toolName: 'fill_element',
        label: toolLabel('fill_element'),
        summary: '在页面中填写元素',
        detail: `Fill [${formatLocator(locator)}] on tab #${tabId} (${resolved.url}) with:\n${JSON.stringify(valuePreview)}\nResolved: <${resolved.element?.tagName}> ${resolved.element?.preview}`,
        toolCallId,
        grantable: true,
        grantScope: `fill_element@${tabId}`,
      });
      if (!(approved.kind === 'confirm' && approved.approved)) {
        return {
          content: [{ type: 'text', text: 'User denied permission to run this tool.' }],
          details: { denied: true, tabId, locator },
        };
      }

      const submit = args?.submit === 'enter' ? 'enter' : undefined;
      const result = await performPageAction(tabId, 'fill', { locator, value, submit });
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
      return {
        content: [{ type: 'text', text: renderActionSuccess('Filled', locator, tabId, result) }],
        details: { tabId, locator },
      };
    },
  };
}
