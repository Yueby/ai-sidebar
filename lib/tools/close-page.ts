import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { toolLabel } from '../toolLabels';
import { type ToolRisk } from '../types';
import {
  closeTab,
  getAgentOpenedTabs,
  unregisterAgentOpenedTab,
} from '../pageContext';
import { requestGate } from '../gate';

const CLOSE_PAGE_PARAMS = Type.Object({
  tabId: Type.Number({
    description: 'Id of the tab to close',
  }),
});

/**
 * close_page 工具定义(confirm):关闭本 agent 开启的标签页(任务完成后的清理)。
 * 安全边界:仅限运行时注册表内的 tab(agent 自己开的);用户手动打开的标签页拒绝关闭。
 */
export function createClosePageToolDefinition(): AgentTool<
  typeof CLOSE_PAGE_PARAMS
> & { risk: ToolRisk } {
  return {
    name: 'close_page',
    label: toolLabel('close_page'),
    risk: 'confirm',
    description:
      'Close a browser tab that this agent opened earlier (via open_page) — use it for cleanup when a working tab is no longer needed. Tabs the USER opened cannot be closed with this tool (refused). Requires user approval unless granted this session.',
    parameters: CLOSE_PAGE_PARAMS,
    execute: async (toolCallId, args) => {
      const tabId = args?.tabId;
      if (typeof tabId !== 'number' || !Number.isFinite(tabId)) {
        return {
          content: [{ type: 'text', text: 'Invalid tabId: a numeric tab id is required.' }],
          details: null,
        };
      }
      if (!getAgentOpenedTabs().has(tabId)) {
        return {
          content: [
            {
              type: 'text',
              text: `Refusing to close tab #${tabId}: it was not opened by this agent (only tabs created via open_page can be closed).`,
            },
          ],
          details: { tabId, denied: true },
        };
      }

      const approved = await requestGate({
        kind: 'confirm',
        toolName: 'close_page',
        label: toolLabel('close_page'),
        summary: '关闭本 agent 打开的标签页',
        detail: `Close tab #${tabId}`,
        toolCallId,
      });
      if (!(approved.kind === 'confirm' && approved.approved)) {
        return {
          content: [{ type: 'text', text: 'User denied permission to run this tool.' }],
          details: { denied: true, tabId },
        };
      }

      try {
        await closeTab(tabId);
        unregisterAgentOpenedTab(tabId);
        return {
          content: [{ type: 'text', text: `Closed tab #${tabId}.` }],
          details: { tabId },
        };
      } catch {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to close tab #${tabId}: it may already have been closed.`,
            },
          ],
          details: null,
        };
      }
    },
  };
}
