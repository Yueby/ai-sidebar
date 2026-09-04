import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { i18n } from '#i18n';
import type { ImageContent } from '@earendil-works/pi-ai';
import { toolLabel } from '../toolLabels';
import { type ToolRisk } from '../types';
import { getActiveTabMeta, getTabMeta, type RefTab } from '../pageContext';
import { captureVisibleForModel } from '../imageFetch';
import { requestGate } from '../gate';

const SCREENSHOT_PAGE_PARAMS = Type.Object({
  tabId: Type.Optional(
    Type.Number({
      description:
        'Id of the tab to capture; omit to use the currently focused tab. Only the ACTIVE tab of its window can be captured (a browser limitation) — background tabs are rejected.',
    }),
  ),
});

/**
 * screenshot_page 工具定义(confirm 型 + 会话级 grant):captureVisibleTab 截取
 * 目标 tab 所在窗口的可见区,以 ImageContent 附回(视觉反馈;仅 vision 模型注册,见 registry)。
 * 仅活动 tab 可截(浏览器限制,描述明示);grantScope = screenshot_page@tabId。
 */
export function createScreenshotPageToolDefinition(
  refTabs: RefTab[],
): AgentTool<typeof SCREENSHOT_PAGE_PARAMS> & { risk: ToolRisk } {
  const refTabsById = new Map(refTabs.map((t) => [t.id, t]));
  return {
    name: 'screenshot_page',
    label: toolLabel('screenshot_page'),
    risk: 'confirm',
    description:
      'Capture the visible viewport of a browser tab and attach it as an image — use it for visual feedback: checking how a page looks, layouts and styles the user refers to, or verifying the visual result of a previous action. Only the ACTIVE tab of its window can be captured (a browser limitation); bring a background tab to the front first. Captures the viewport only, not the full scrollable page. Every call requires explicit user approval via a confirmation card unless the user granted this session for this tool and tab.',
    parameters: SCREENSHOT_PAGE_PARAMS,
    execute: async (toolCallId, args) => {
      const rawTabId = args?.tabId;
      let tabId: number;
      if (rawTabId === undefined) {
        const active = await getActiveTabMeta();
        if (!active) {
          return {
            content: [
              {
                type: 'text',
                text: 'Could not determine the focused tab: the active tab is not a regular web page (http/https), or no window has an active page. Ask the user to open a web page, or pass an explicit tabId.',
              },
            ],
            details: null,
          };
        }
        tabId = active.id;
      } else if (typeof rawTabId === 'number' && Number.isFinite(rawTabId)) {
        tabId = rawTabId;
      } else {
        return {
          content: [
            {
              type: 'text',
              text: `Invalid tabId: ${JSON.stringify(rawTabId ?? null)}. Omit tabId to use the focused tab, or pass a numeric tab id.`,
            },
          ],
          details: null,
        };
      }

      // http(s) 守卫 + url 元信息(确认卡展示);与 read_page 同一守卫语义
      const meta = await getTabMeta(tabId);
      if (!meta) {
        return {
          content: [
            {
              type: 'text',
              text: `Tab #${tabId} cannot be captured: it may have been closed or is not a regular web page (http/https).`,
            },
          ],
          details: null,
        };
      }
      // 后台 tab 计时器节流 + captureVisibleTab 仅活动 tab:截图前自动激活目标页
      await browser.tabs.update(tabId, { active: true }).catch(() => {});
      const refInfo = refTabsById.get(tabId);

      const approved = await requestGate({
        kind: 'confirm',
        toolName: 'screenshot_page',
        label: toolLabel('screenshot_page'),
        summary: i18n.t('gateCard.screenshotPage.summary'),
        detail: `Capture the visible viewport of tab #${tabId} (${meta.url}) and attach it as an image.\nPage: ${refInfo?.title ?? meta.title}`,
        toolCallId,
        grantable: true,
        grantScope: `screenshot_page@${tabId}`,
      });
      if (!(approved.kind === 'confirm' && approved.approved)) {
        return {
          content: [{ type: 'text', text: 'User denied permission to run this tool.' }],
          details: { denied: true, tabId },
        };
      }

      const result = await captureVisibleForModel(tabId);
      if (!result.ok) {
        const text =
          result.reason === 'inactive'
            ? `Tab #${tabId} cannot be captured: only the ACTIVE tab of its window can be captured. Ask the user to bring that tab to the front, then retry.`
            : `Failed to capture tab #${tabId}: the browser refused the capture.${result.detail ? ` Browser said: ${result.detail}` : ''} If this is a permissions error, retrying after a short wait may also help (captures are rate-limited to 2 per second).`;
        return { content: [{ type: 'text', text }], details: { tabId } };
      }
      const content: (ImageContent | { type: 'text'; text: string })[] = [
        {
          type: 'text',
          text: `Screenshot of tab #${tabId} (${meta.url}) — visible viewport only, not the full scrollable page.`,
        },
        { type: 'image', data: result.image.data, mimeType: result.image.mimeType },
      ];
      return {
        content,
        details: { tabId, url: meta.url },
      };
    },
  };
}
