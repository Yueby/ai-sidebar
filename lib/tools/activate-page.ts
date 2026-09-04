import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { toolLabel, type ToolRisk } from '../types';
import { activateTab, getTabMeta } from '../pageContext';

const ACTIVATE_PAGE_PARAMS = Type.Object({
  tabId: Type.Number({
    description: 'Id of the tab to bring to the front',
  }),
});

/**
 * activate_page 工具定义(safe):把指定标签页切到前台。
 * 截图(captureVisibleTab)与页面计时器(后台节流)都依赖活动态——需要在后台页
 * 做长时间读取/操作前,先用它把页带到前台。会触发引用组切换(工作集跟随焦点)。
 */
export function createActivatePageToolDefinition(): AgentTool<
  typeof ACTIVATE_PAGE_PARAMS
> & { risk: ToolRisk } {
  return {
    name: 'activate_page',
    label: toolLabel('activate_page'),
    risk: 'safe',
    description:
      'Bring a browser tab to the front (make it the active tab). Use it before screenshot_page (which can only capture the active tab) or before long reads on a background page (background tabs have throttled timers). Switching focus also switches the reference working set to that tab, consistent with the reference bar. Fails if the tab no longer exists.',
    parameters: ACTIVATE_PAGE_PARAMS,
    execute: async (_toolCallId, args) => {
      const tabId = args?.tabId;
      if (typeof tabId !== 'number' || !Number.isFinite(tabId)) {
        return {
          content: [{ type: 'text', text: 'Invalid tabId: a numeric tab id is required.' }],
          details: null,
        };
      }
      try {
        const meta = await activateTab(tabId);
        if (!meta) throw new Error('tab not found');
        return {
          content: [
            {
              type: 'text',
              text: `Switched focus to tab #${tabId}${meta.title ? ` (${meta.title})` : ''}${meta.url ? ` — ${meta.url}` : ''}.`,
            },
          ],
          details: { tabId },
        };
      } catch {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to activate tab #${tabId}: it may have been closed.`,
            },
          ],
          details: null,
        };
      }
    },
  };
}
