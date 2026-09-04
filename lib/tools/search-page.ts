import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { toolLabel, type ToolRisk } from '../types';
import { listCandidateTabs } from '../pageContext';

const SEARCH_PAGE_PARAMS = Type.Object({
  query: Type.Optional(
    Type.String({
      description:
        'Filter tabs by a case-insensitive substring of title or URL (e.g. "gemini", "github"). Omit to list all http(s) tabs.',
    }),
  ),
});

/**
 * search_page 工具定义(safe):枚举当前窗口所有 http(s) 标签页(tabId/标题/URL/活动标记),
 * 是 open_page / fill_element(tabId) 等多标签编排的寻址入口。
 */
export function createSearchPageToolDefinition(): AgentTool<
  typeof SEARCH_PAGE_PARAMS
> & { risk: ToolRisk } {
  return {
    name: 'search_page',
    label: toolLabel('search_page'),
    risk: 'safe',
    description:
      'List the browser tabs that are currently open (http/https pages only): one row per tab with its tabId, title and URL, the currently active tab flagged. Pass `query` to filter by a case-insensitive substring of title or URL. Use it to discover tabs before reading or acting on a specific one (pass its tabId), or to check what the user has open.',
    parameters: SEARCH_PAGE_PARAMS,
    execute: async (_toolCallId, args) => {
      const query = typeof args?.query === 'string' ? args.query.trim().toLowerCase() : '';
      const tabs = await listCandidateTabs().catch(() => []);
      const filtered =
        query.length > 0
          ? tabs.filter(
              (t) =>
                t.title.toLowerCase().includes(query) || t.url.toLowerCase().includes(query),
            )
          : tabs;
      if (filtered.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text:
                query.length > 0
                  ? `No open tab matches "${query}". Call this tool without query to list all http(s) tabs.`
                  : 'No http(s) tabs are currently open.',
            },
          ],
          details: null,
        };
      }
      const lines = filtered.map(
        (t) => `- #${t.id} ${t.active ? '[active] ' : ''}${t.title} — ${t.url}`,
      );
      return {
        content: [
          {
            type: 'text',
            text: `Open browser tabs (${filtered.length}):\n${lines.join('\n')}\n\nUse the tabId with read_page / click_element / fill_element / scroll_page (pass tabId explicitly) to act on a specific tab.`,
          },
        ],
        details: { count: filtered.length },
      };
    },
  };
}
