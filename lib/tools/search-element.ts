import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { toolLabel } from '../toolLabels';
import { SEARCH_ELEMENT_LIMIT, type ToolRisk } from '../types';
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
  query: Type.Optional(
      Type.Union(
        [
          Type.String(),
          Type.Array(Type.String({ description: 'Substring of role or accessible name' })),
        ],
        {
          description:
            'One or more substrings to filter by (case-insensitive, matched against role or accessible name; ANY match counts — OR semantics). Pass a string (e.g. "submit") or an array for multiple kinds at once (e.g. ["button", "textbox"]). Use it when your target is not in the default list — the unfiltered list is capped at 80 entries.',
        },
      ),
    ),
  includeHidden: Type.Optional(
    Type.Boolean({
      description:
        'Include hidden elements (collapsed menus/popovers keep their buttons in the DOM but hidden). Default false — hidden rows are noise unless you specifically need them.',
    }),
  ),
});

/**
 * 单条清单行:role + "可访问名称" + 稀疏旗标(序号>1 / type / disabled / checked / hidden),
 * 并附上决定动作的两个事实:输入框当前值与链接去向(否则模型得先点开才知道)。
 */
export function renderElementLine(el: InteractiveElementInfo): string {
  const flags: string[] = [];
  if (el.ordinal > 1) flags.push(String(el.ordinal));
  if (el.inputType) flags.push(`type=${el.inputType}`);
  if (el.disabled) flags.push('disabled');
  if (el.checked === true) flags.push('checked');
  else if (el.checked === false) flags.push('unchecked');
  if (!el.visible) flags.push('hidden');
  const name = el.name ? ` ${JSON.stringify(el.name)}` : '';
  const value = el.value ? ` = ${JSON.stringify(el.value)}` : '';
  const href = el.href ? ` → ${el.href}` : '';
  return `- ${el.role}${name}${flags.length > 0 ? ` [${flags.join(', ')}]` : ''}${value}${href}`;
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
      'List the interactive elements of a web page tab — buttons, links, text fields, selects, checkboxes, tabs, sliders and similar — one per line with their ARIA role and accessible name, e.g. `- button "Sign in"`. Non-default state is flagged (`[disabled]`, `[hidden]`) and duplicate role+name pairs get an ordinal (`[2]`), so each element is uniquely addressable by role + accessible name + ordinal — click_element and fill_element accept exactly these rows as their locator. Text-like inputs may carry a `[type=x]` hint (e.g. `[type=password]` for password fields) and their current value (`= "…"`), checkboxes/radios their `[checked]`/`[unchecked]` state, links their destination (`→ /path`) — so you can decide what to click or fill without opening it first. placeholder-only fields use their placeholder as the accessible name, and icon buttons surface their title/shortcut as a hint. Same-origin iframe content is included; a cross-origin iframe is reported as a note with its URL instead, since its content is not reachable from this page. Hidden elements (collapsed menus/popovers) are EXCLUDED by default — pass includeHidden: true to include them. The unfiltered list is capped at 80 entries (visible elements first); pass `query` to filter by a case-insensitive substring of role or accessible name when your target is not shown. Defaults to the currently focused tab; pass tabId to inspect another tab. Prefer this tool over execute_js whenever you need to locate or verify page elements.',
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
      const rawQuery = args?.query;
      const includeHidden = args?.includeHidden === true;
      const result = await searchElementsInTab(tabId, rawQuery, includeHidden);
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
        // 空结果最需要帧说明:页面交互项全在 iframe 里时,"没找到"本身毫无行动线索
        const emptyLines = [`No interactive elements found in tab #${tabId} (${result.url}).`];
        if (result.frames && result.frames.length > 0) {
          emptyLines.push('', ...result.frames.map((note) => `(Note: ${note})`));
        }
        return {
          content: [{ type: 'text', text: emptyLines.join('\n') }],
          details: { tabId, url: result.url },
        };
      }
      const lines = [
        `Interactive elements in tab #${tabId} (${result.url})${result.title ? ` — ${result.title}` : ''}:`,
        '',
        ...result.elements.map(renderElementLine),
      ];
      if (result.frames && result.frames.length > 0) {
        lines.push('', ...result.frames.map((note) => `(Note: ${note})`));
      }
      if (result.truncated) {
        lines.push(
          '',
          `(Showing ${result.elements.length} of ${result.total} interactive elements; visible elements are prioritized, hidden ones may be omitted. The list is capped at ${SEARCH_ELEMENT_LIMIT} entries.${
            rawQuery
              ? ' Narrow the query further if your target is not listed.'
              : ' Pass the query parameter to filter by role or accessible name if your target is not listed.'
          })`,
        );
      }
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: { tabId, url: result.url, total: result.total, truncated: result.truncated },
      };
    },
  };
}
