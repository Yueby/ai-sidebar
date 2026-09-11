import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { i18n } from '#i18n';
import { toolLabel } from '../toolLabels';
import { type ToolRisk } from '../types';
import {
  closeTab,
  isAgentCreatedTab,
  unregisterAgentCreatedTab,
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
export function createClosePageToolDefinition(sessionId?: string): AgentTool<
  typeof CLOSE_PAGE_PARAMS
> & { risk: ToolRisk } {
  const gateForRun = (req: Parameters<typeof requestGate>[0]) => requestGate(req, sessionId ?? '');
  return {
    name: 'close_page',
    label: toolLabel('close_page'),
    risk: 'confirm',
    description:
      'Close a browser tab that this agent opened earlier (via open_page, or a tab a click opened) — use it for cleanup when a working tab is no longer needed. Tabs the USER opened cannot be closed with this tool (refused). Every call requires explicit user approval via a confirmation card.',
    parameters: CLOSE_PAGE_PARAMS,
    execute: async (toolCallId, args) => {
      const tabId = args?.tabId;
      if (typeof tabId !== 'number' || !Number.isFinite(tabId)) {
        return {
          content: [{ type: 'text', text: 'Invalid tabId: a numeric tab id is required.' }],
          details: null,
        };
      }
      // 关闭权 = agent **创建**的 tab(open_page 新建 / click 开出);
      // 仅“认领为可读”的用户 tab 不在内 —— 否则用户自己的页面会被误关。
      if (!isAgentCreatedTab(tabId)) {
        return {
          content: [
            {
              type: 'text',
              text: `Refusing to close tab #${tabId}: this agent did not create it. Only tabs it opened itself (open_page) or that a click opened can be closed; tabs the user opened stay off-limits even if the agent adopted them for reading.`,
            },
          ],
          details: { tabId, denied: true },
        };
      }

      const approved = await gateForRun({
        kind: 'confirm',
        toolName: 'close_page',
        label: toolLabel('close_page'),
        summary: i18n.t('gateCard.closePage.summary'),
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
        const ok = await closeTab(tabId);
        if (!ok) {
          // closeTab 失败可能是“已经不存在”(达成目标),也可能是浏览器拒绝关闭。
          // 旧写法忽略返回值、永远报成功,模型会以为关掉了而实际还开着——必须区分。
          let stillOpen = false;
          try {
            await browser.tabs.get(tabId);
            stillOpen = true;
          } catch {
            stillOpen = false;
          }
          if (stillOpen) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Failed to close tab #${tabId}: the browser refused to close it, so it is still open. Do not assume it is gone.`,
                },
              ],
              details: { tabId },
            };
          }
        }
        unregisterAgentOpenedTab(tabId);
        unregisterAgentCreatedTab(tabId);
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
