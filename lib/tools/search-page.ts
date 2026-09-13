import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { toolLabel } from '../toolLabels';
import { type ToolRisk } from '../types';
import { listCandidateTabs, type RefTab } from '../pageContext';

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
 * 行内标注可读性:[readable] = read_page 可直接读(<page-refs> 引用或 open_page 注册);
 * [external] = 可发现但不可读,需先 open_page 拿可读句柄。
 */
export function createSearchPageToolDefinition(
  refTabs: RefTab[] = [],
  dynamicTabs?: ReadonlySet<number>,
): AgentTool<typeof SEARCH_PAGE_PARAMS> & { risk: ToolRisk } {
  return {
    name: 'search_page',
    label: toolLabel('search_page'),
    risk: 'safe',
    description:
      'List the browser tabs that are currently open (http/https pages only): one row per tab with its tabId, title and URL, the currently active tab flagged. Rows are marked [readable] (read_page can read them: referenced tabs or tabs opened via open_page) or [external] (discoverable but NOT readable yet — use open_page with the URL to get a readable handle). Pass `query` to filter by a case-insensitive substring of title or URL.',
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
      const dynamicIds = dynamicTabs ?? new Set<number>();
      const lines = filtered.map((t) => {
        const readable = refTabs.some((r) => r.id === t.id) || dynamicIds.has(t.id);
        return `- #${t.id} ${t.active ? '[active] ' : ''}${readable ? '[readable]' : '[external]'} ${t.title} — ${t.url}`;
      });
      return {
        content: [
          {
            type: 'text',
            text: `Open browser tabs (${filtered.length}):\n${lines.join('\n')}\n\nread_page / read_element only work on [readable] tabs (pass tabId explicitly); click_element / fill_element / scroll_page accept any tabId (default: the focused tab). For [external] tabs, use open_page with the URL first to get a readable handle.`,
          },
        ],
        details: { count: filtered.length },
      };
    },
  };
}
