import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { toolLabel, type ToolRisk } from '../types';
import { fetchAndExtractPage, FETCH_CONTENT_LIMIT } from '../fetchPage';

const FETCH_URL_PARAMS = Type.Object({
  url: Type.String({ description: 'The absolute http/https URL of the page to fetch' }),
});

/**
 * fetch_url 工具定义(safe):sidepanel 直连 GET 任意公开 URL,提取标题+正文纯文本
 * (Readability,与 content script 的页面提取同源同版本);只读、跟随重定向、零新权限。
 */
export function createFetchUrlToolDefinition(): AgentTool<typeof FETCH_URL_PARAMS> & {
  risk: ToolRisk;
} {
  return {
    name: 'fetch_url',
    label: toolLabel('fetch_url'),
    risk: 'safe',
    description:
      'Fetch the content of any public web page by URL and return its title and main text — use it when the user message contains a link, when a referenced page links to further material, or when external information is needed to answer. Extraction targets HTML article pages; non-HTML responses and pages over 2 MB are rejected with an explanatory error. Private and localhost addresses are blocked.',
    parameters: FETCH_URL_PARAMS,
    execute: async (_toolCallId, args) => {
      const url = typeof args?.url === 'string' ? args.url.trim() : '';
      if (!url) {
        return {
          content: [
            { type: 'text', text: 'Invalid url: a non-empty http/https URL is required.' },
          ],
          details: null,
        };
      }
      const result = await fetchAndExtractPage(url);
      if (!result.ok) {
        return { content: [{ type: 'text', text: result.error }], details: { url } };
      }
      const { title, url: finalUrl, content, truncated } = result.page;
      const lines = [`Title: ${title}`, `URL: ${finalUrl}`, '', '<content>', content, '</content>'];
      if (truncated) {
        lines.push(
          '',
          `(Note: the page content above was truncated to ${FETCH_CONTENT_LIMIT} characters and may be incomplete. Adjust your answer accordingly.)`,
        );
      }
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: { url: finalUrl, truncated },
      };
    },
  };
}
