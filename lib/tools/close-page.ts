import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { i18n } from '#i18n';
import { toolLabel } from '../toolLabels';
import { type ToolRisk } from '../types';
import {
  closeTab,
  getTabMeta,
  unregisterAgentOpenedTab,
} from '../pageContext';
import { requestGate } from '../gate';

const CLOSE_PAGE_PARAMS = Type.Object({
  tabId: Type.Number({
    description: 'Id of the tab to close',
  }),
});

/**
 * close_page 工具定义(confirm):关闭指定标签页(任务完成后的清理)。
 *
 * **不按 tab 来源硬拒绝**(用户拍板 2026-09-11:“AI 可以自由调用所有工具”):模型可对任意
 * 标签页发起关闭请求,护栏是**确认卡本身**——用户逐次审批。卡上展示标题+URL,便于判断在关什么。
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
      'Close a browser tab — use it for cleanup when a working tab is no longer needed. Any tab can be requested, including ones the user opened; every call shows a confirmation card naming the tab, and nothing is closed unless the user approves it. If a tab should stay open, do not call this tool.',
    parameters: CLOSE_PAGE_PARAMS,
    execute: async (toolCallId, args) => {
      const tabId = args?.tabId;
      if (typeof tabId !== 'number' || !Number.isFinite(tabId)) {
        return {
          content: [{ type: 'text', text: 'Invalid tabId: a numeric tab id is required.' }],
          details: null,
        };
      }
      // 关闭权不再按来源判定(用户设计意图:模型可自由调用所有工具,确认卡就是护栏)。
      // 卡上带上标题/URL,让审批是“知情同意”而不是盲批。
      const meta = await getTabMeta(tabId).catch(() => null);
      const approved = await gateForRun({
        kind: 'confirm',
        toolName: 'close_page',
        label: toolLabel('close_page'),
        summary: i18n.t('gateCard.closePage.summary'),
        detail: `Close tab #${tabId}${meta?.title ? ` — ${meta.title}` : ''}${meta?.url ? `\n${meta.url}` : ''}`,
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
