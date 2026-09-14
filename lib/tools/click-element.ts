import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { i18n } from '#i18n';
import { toolLabel } from '../toolLabels';
import { type ToolRisk } from '../types';
import { performPageAction, snapshotTabs, describeTabChanges } from '../pageContext';
import { requestGate } from '../gate';
import {
  actionAddressing,
  formatActionTarget,
  parseActionTarget,
  renderActionFailure,
  renderActionSuccess,
  resolveActionTab,
} from './page-action-shared';

const LOCATOR_PARAMS = Type.Object({
  role: Type.String({
    description:
      'ARIA role of the element, exactly as listed by search_element (e.g. button, textbox, link). Role `clickable` means an element that has no ARIA role but responds to clicks (image cards, tiles) — address it with the name and ordinal search_element shows for it.',
  }),
  name: Type.String({
    description:
      'Accessible name of the element exactly as listed by search_element; use an empty string for unnamed elements (an empty name matches the first nameless element of that role — pass ordinal when several share the role)',
  }),
  ordinal: Type.Optional(
    Type.Number({
      description: 'Ordinal among elements sharing the same role and accessible name (the [2]/[3] markers in search_element output); default 1',
    }),
  ),
});

const CLICK_ELEMENT_PARAMS = Type.Object({
  locator: Type.Optional(LOCATOR_PARAMS),
  selector: Type.Optional(
    Type.String({
      description:
        'CSS selector of the element, for elements that have no ARIA role or accessible name in search_element / read_page mode="tree" (image cards, custom clickable containers). Pierces open shadow roots. Mutually exclusive with locator.',
    }),
  ),
  tabId: Type.Optional(
    Type.Number({
      description: 'Id of the tab to act on; omit to use the currently focused tab',
    }),
  ),
});

/**
 * click_element 工具定义(confirm 型 + 会话级 grant):按 ARIA locator 点击页面元素。
 * 执行前先在 content 侧解析 locator(确认卡展示真实命中的元素),再经 requestGate
 * 确认(grantScope = click_element@tabId,工具+tab 粒度);content 侧完成
 * scrollIntoView → 400ms 高亮 → 遮挡检测 → 合成鼠标序列(遮挡时 fallback 直发)→ settle。
 */
export function createClickElementToolDefinition(sessionId?: string): AgentTool<typeof CLICK_ELEMENT_PARAMS> & {
  risk: ToolRisk;
} {
  const gateForRun = (req: Parameters<typeof requestGate>[0]) => requestGate(req, sessionId ?? '');
  return {
    name: 'click_element',
    label: toolLabel('click_element'),
    risk: 'confirm',
    description:
      'Click an interactive element on a web page, addressed either by its ARIA locator (role + accessible name + optional ordinal, exactly as listed by search_element) or by a CSS selector (for elements that have no role or accessible name — image cards, custom clickable containers). The element is scrolled into view, flashed with an outline for feedback, then clicked with a synthetic (untrusted) mouse event sequence — most sites and frameworks respond to it, but a few may require a real user click. If the element is covered by another element, the events are dispatched directly on the target and the result says so. Defaults to the currently focused tab; pass tabId to act on another tab. Every call requires explicit user approval via a confirmation card unless the user granted this session for this tool and tab.',
    parameters: CLICK_ELEMENT_PARAMS,
    execute: async (toolCallId, args) => {
      const target = parseActionTarget(args);
      if (target.kind === 'error') {
        return { content: [{ type: 'text', text: target.message }], details: null };
      }
      const addressing = actionAddressing(target);
      const tab = await resolveActionTab(args?.tabId);
      if ('errorText' in tab) {
        return { content: [{ type: 'text', text: tab.errorText }], details: null };
      }
      const { tabId } = tab;

      const resolved = await performPageAction(tabId, 'resolve', addressing);
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
          content: [{ type: 'text', text: renderActionFailure(tabId, resolved, target) }],
          details: { tabId, target },
        };
      }

      const approved = await gateForRun({
        kind: 'confirm',
        toolName: 'click_element',
        label: toolLabel('click_element'),
        summary: i18n.t('gateCard.clickElement.summary'),
        detail: `Click [${formatActionTarget(target)}] on tab #${tabId} (${resolved.url})\nResolved: <${resolved.element?.tagName}> ${resolved.element?.preview}`,
        toolCallId,
        grantable: true,
        grantScope: `click_element@${tabId}`,
      });
      if (!(approved.kind === 'confirm' && approved.approved)) {
        return {
          content: [{ type: 'text', text: 'User denied permission to run this tool.' }],
          details: { denied: true, tabId, target },
        };
      }

      // target=_blank 链接会开新 tab:前后对比,把新页/焦点变化写进结果,模型不必再猜
      const tabsBefore = await snapshotTabs();
      const result = await performPageAction(tabId, 'click', addressing);
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
          content: [{ type: 'text', text: renderActionFailure(tabId, result, target) }],
          details: { tabId, target },
        };
      }
      const { note: tabNote } = await describeTabChanges(tabsBefore);
      return {
        content: [{ type: 'text', text: renderActionSuccess('Clicked', formatActionTarget(target), tabId, result) + (tabNote ? `\n${tabNote}` : '') }],
        details: { tabId, target },
      };
    },
  };
}
