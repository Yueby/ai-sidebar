import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { toolLabel } from '../toolLabels';
import { type ToolRisk, type WebSearchConfig } from '../types';
import { searchWeb } from '../webSearch';

const SEARCH_WEB_PARAMS = Type.Object({
  query: Type.String({
    description:
      'The web search query. Use focused keyword phrases; refine and repeat the search if the first round is not enough.',
  }),
});

/** search_web 工具定义(safe,仅在设置里配置了可用搜索源时注册):返回编号结果清单,深取用 fetch_url */
export function createWebSearchToolDefinition(config: WebSearchConfig): AgentTool<
  typeof SEARCH_WEB_PARAMS
> & { risk: ToolRisk } {
  return {
    name: 'search_web',
    label: toolLabel('search_web'),
    risk: 'safe',
    description:
      'Search the web and return a numbered list of results (title, URL, snippet). Use this when you need current or external information the user has not provided. To read the full content of a promising result, follow up with fetch_url on its URL.',
    parameters: SEARCH_WEB_PARAMS,
    execute: async (_toolCallId, args) => {
      const query = typeof args?.query === 'string' ? args.query.trim() : '';
      if (!query) {
        return {
          content: [
            { type: 'text', text: 'Invalid query: a non-empty search query is required.' },
          ],
          details: null,
        };
      }
      try {
        const results = await searchWeb(config, query);
        if (results.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No results found. Try different or more general keywords.',
              },
            ],
            details: null,
          };
        }
        const lines = results.map(
          (r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`,
        );
        return {
          content: [
            {
              type: 'text',
              text: `${lines.join('\n\n')}\n\nUse fetch_url with one of the URLs above to read its full content.`,
            },
          ],
          details: { query, count: results.length },
        };
      } catch (e) {
        return {
          content: [
            { type: 'text', text: e instanceof Error ? e.message : `search_failed: ${String(e)}` },
          ],
          details: null,
        };
      }
    },
  };
}
