import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { toolLabel, type ToolRisk } from '../types';
import { openTab, registerAgentOpenedTab } from '../pageContext';
import { requestGate } from '../gate';

const OPEN_PAGE_PARAMS = Type.Object({
  url: Type.String({
    description: 'The absolute http/https URL to open in a new tab',
  }),
  background: Type.Optional(
    Type.Boolean({
      description: 'Open in a background tab without switching to it (default: false, opens focused)',
    }),
  ),
});

/**
 * open_page 工具定义(confirm 型 + 会话级 grant):在浏览器中打开新标签页。
 * 新 tabId 注册进 agent 开启标签页注册表(白名单三源之一),后续 read_page/
 * fill_element(tabId) 可直接寻址;grantScope = open_page@*(勾选一次本会话开页免确认)。
 */
export function createOpenPageToolDefinition(): AgentTool<typeof OPEN_PAGE_PARAMS> & {
  risk: ToolRisk;
} {
  return {
    name: 'open_page',
    label: toolLabel('open_page'),
    risk: 'confirm',
    description:
      'Open a URL in a new browser tab — use it to bring up a page the task needs (e.g. open an AI chat site, a docs page, or a link found in content). The new tab becomes addressable: its tabId is returned and can be used with read_page / click_element / fill_element. The new tab is focused unless background: true. Every call requires explicit user approval via a confirmation card unless the user granted this session.',
    parameters: OPEN_PAGE_PARAMS,
    execute: async (toolCallId, args) => {
      const url = typeof args?.url === 'string' ? args.url.trim() : '';
      if (!/^https?:\/\//i.test(url)) {
        return {
          content: [
            {
              type: 'text',
              text: 'Invalid url: an absolute http/https URL is required.',
            },
          ],
          details: null,
        };
      }
      const background = args?.background === true;

      const approved = await requestGate({
        kind: 'confirm',
        toolName: 'open_page',
        label: toolLabel('open_page'),
        summary: '在浏览器中打开新标签页',
        detail: `Open ${url}${background ? ' (background tab)' : ' (focused)'}`,
        toolCallId,
        grantable: true,
        grantScope: 'open_page@*',
      });
      if (!(approved.kind === 'confirm' && approved.approved)) {
        return {
          content: [{ type: 'text', text: 'User denied permission to run this tool.' }],
          details: { denied: true, url },
        };
      }

      const meta = await openTab(url, !background);
      if (!meta) {
        return {
          content: [{ type: 'text', text: `Failed to open ${url}: the browser rejected tabs.create.` }],
          details: { url },
        };
      }
      registerAgentOpenedTab(meta.id);
      return {
        content: [
          {
            type: 'text',
            text: `Opened tab #${meta.id} (${meta.url})${background ? ' in the background' : ' — it is now the focused tab'}. Its tabId is registered: read_page / click_element / fill_element can address it via tabId.`,
          },
        ],
        details: { tabId: meta.id, url: meta.url },
      };
    },
  };
}
