import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { toolLabel, SEARCH_ELEMENT_LIMIT, type ToolRisk } from '../types';
import {
  getActiveTabMeta,
  searchElementsInTab,
  type InteractiveElementInfo,
} from '../pageContext';

const SEARCH_ELEMENT_PARAMS = Type.Object({
  tabId: Type.Optional(
    Type.Number({
      description:
        'Id of the tab to inspect; omit to use the currently focused tab. Referenced tabs are annotated with tabId in the <page-refs> block of user messages',
    }),
  ),
});

/** 单条清单行:role + "可访问名称" + 稀疏旗标(序号>1 / disabled / hidden 仅在非默认时标注) */
function renderElementLine(el: InteractiveElementInfo): string {
  const flags: string[] = [];
  if (el.ordinal > 1) flags.push(String(el.ordinal));
  if (el.disabled) flags.push('disabled');
  if (!el.visible) flags.push('hidden');
  const name = el.name ? ` ${JSON.stringify(el.name)}` : '';
  return `- ${el.role}${name}${flags.length > 0 ? ` [${flags.join(', ')}]` : ''}`;
}

/**
 * search_element 工具定义(safe):ARIA 定位发现层(三期步①)。
 * 列出标签页的交互元素(role + 可访问名称 + disabled/可见性 + 重名序号消歧),
 * 每个元素以 role + accessible name + ordinal 唯一可寻址 —— 步② click/fill 的 locator 协议。
 * 寻址 = 默认 focused tab,tabId 可选(用户拍板:自动化任务可不引用页,故不设 tab 白名单)。
 */
export function createSearchElementToolDefinition(): AgentTool<
  typeof SEARCH_ELEMENT_PARAMS
> & { risk: ToolRisk } {
  return {
    name: 'search_element',
    label: toolLabel('search_element'),
    risk: 'safe',
    description:
      'List the interactive elements of a web page tab — buttons, links, text fields, selects, checkboxes, tabs, sliders and similar — one per line with their ARIA role and accessible name, e.g. `- button "Sign in"`. Non-default state is flagged (`[disabled]`, `[hidden]`) and duplicate role+name pairs get an ordinal (`[2]`), so each element is uniquely addressable by role + accessible name + ordinal. When the list is truncated, visible elements are listed before hidden ones. Defaults to the currently focused tab; pass tabId to inspect another tab. Use it to discover what can be acted on and how to address each element, when full page text is not needed (read_page returns the page text instead).',
    parameters: SEARCH_ELEMENT_PARAMS,
    execute: async (_toolCallId, args) => {
      const rawTabId = args?.tabId;
      let tabId: number;
      if (rawTabId === undefined) {
        const active = await getActiveTabMeta();
        if (!active) {
          return {
            content: [
              {
                type: 'text',
                text: 'Could not determine the focused tab: the active tab is not a regular web page (http/https), or no window has an active page. Ask the user to open a web page, or pass an explicit tabId.',
              },
            ],
            details: null,
          };
        }
        tabId = active.id;
      } else if (typeof rawTabId === 'number' && Number.isFinite(rawTabId)) {
        tabId = rawTabId;
      } else {
        return {
          content: [
            {
              type: 'text',
              text: `Invalid tabId: ${JSON.stringify(rawTabId ?? null)}. Omit tabId to use the focused tab, or pass a numeric tab id.`,
            },
          ],
          details: null,
        };
      }
      const startedAt = performance.now();
      const result = await searchElementsInTab(tabId);
      const totalMs = Math.round(performance.now() - startedAt);
      if (!result) {
        if (import.meta.env.DEV) {
          console.log(`[ai-sidebar] search_element: total ${totalMs}ms (failed: no response from content script)`);
        }
        return {
          content: [
            {
              type: 'text',
              text: `Failed to list interactive elements in tab #${tabId}: the tab may have been closed, may not be a regular web page (e.g. a browser settings page), may still be loading, or its page analysis may have failed unexpectedly. Adjust accordingly.`,
            },
          ],
          details: null,
        };
      }
      if (import.meta.env.DEV) {
        console.log(
          `[ai-sidebar] search_element: total ${totalMs}ms (content ${result.durationMs}ms, ${result.total} elements, truncated=${result.truncated})`,
        );
      }
      if (result.elements.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No interactive elements found in tab #${tabId} (${result.url}).`,
            },
          ],
          details: { tabId, url: result.url },
        };
      }
      const lines = [
        `Interactive elements in tab #${tabId} (${result.url})${result.title ? ` — ${result.title}` : ''}:`,
        '',
        ...result.elements.map(renderElementLine),
      ];
      if (result.truncated) {
        lines.push(
          '',
          `(Showing ${result.elements.length} of ${result.total} interactive elements; visible elements are prioritized, hidden ones may be omitted. The list is capped at ${SEARCH_ELEMENT_LIMIT} entries.)`,
        );
      }
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: { tabId, url: result.url, total: result.total, truncated: result.truncated },
      };
    },
  };
}
