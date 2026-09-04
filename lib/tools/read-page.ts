import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { toolLabel, type ToolRisk } from '../types';
import { extractFromTab, renderPageContext, type RefTab } from '../pageContext';

const READ_PAGE_PARAMS = Type.Object({
  tabId: Type.Number({ description: 'Id of the tab to read (referenced tabs are annotated with tabId in the <page-refs> block of user messages)' }),
  section: Type.Optional(
    Type.Union([Type.Literal('head'), Type.Literal('tail')], {
      description:
        "Which part of long pages to keep when truncating (default 'head'). Use 'tail' for chat/message pages — the latest messages live at the end.",
    }),
  ),
});

/** read_page 工具定义(safe):AI 按需读取某个被引用标签页的当前正文(执行体消费 pageContext 的 extractFromTab) */
export function createReadPageToolDefinition(
  refTabs: RefTab[],
  dynamicTabs?: ReadonlySet<number>,
): AgentTool<typeof READ_PAGE_PARAMS> & { risk: ToolRisk } {
  const validIds = refTabs.map((t) => t.id);
  return {
    name: 'read_page',
    label: toolLabel('read_page'),
    risk: 'safe',
    description:
      "Read the title, URL and main text content of a user-referenced browser tab. Call this with the corresponding tabId when the user's question may relate to a referenced page or needs its content. Long pages are truncated from the head by default — pass section: 'tail' to keep the END of the content (e.g. the latest messages in a chat). If the user's message contains a picked element and the question points at it, prefer read_element; an unreadable result usually means the tab was closed or navigated — do not retry the same tabId.",
    parameters: READ_PAGE_PARAMS,
    execute: async (_toolCallId, args) => {
      const tabId = args?.tabId;
      if (
        typeof tabId !== 'number' ||
        (!validIds.includes(tabId) && !(dynamicTabs?.has(tabId) ?? false))
      ) {
        return {
          content: [
            {
              type: 'text',
              text: `Invalid tabId: ${JSON.stringify(tabId ?? null)}. Readable tabs: ${
                validIds.map((id) => `#${id}`).join(', ') || '(none)'
              }.`,
            },
          ],
          details: null,
        };
      }
      const section = args?.section === 'tail' ? 'tail' : 'head';
      const page = await extractFromTab(tabId, section);
      if (!page) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to read tab #${tabId}: it may have been closed, may not be a regular web page (e.g. a browser settings page), may still be loading, or its content may not be extractable. Adjust your answer accordingly.`,
            },
          ],
          details: null,
        };
      }
      return {
        content: [{ type: 'text', text: renderPageContext(page) }],
        details: { title: page.title, url: page.url },
      };
    },
  };
}
