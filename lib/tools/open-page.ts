import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { i18n } from '#i18n';
import { toolLabel } from '../toolLabels';
import { type ToolRisk } from '../types';
import { openTab, findTabByUrl, registerAgentOpenedTab } from '../pageContext';
import { requestGate } from '../gate';

const OPEN_PAGE_PARAMS = Type.Object({
  url: Type.String({
    description: 'The absolute http/https URL to open in a new tab',
  }),
  background: Type.Optional(
    Type.Boolean({
      description: 'Open in a background tab without switching to it (default: false, opens focused)',
    }),
  ),
});

/**
 * open_page 工具定义(confirm 型 + 会话级 grant):在浏览器中打开新标签页。
 * 新 tabId 注册进 agent 开启标签页注册表(白名单三源之一),后续 read_page/
 * fill_element(tabId) 可直接寻址;grantScope = open_page@*(勾选一次本会话开页免确认)。
 */
export function createOpenPageToolDefinition(sessionId?: string): AgentTool<typeof OPEN_PAGE_PARAMS> & {
  risk: ToolRisk;
} {
  const gateForRun = (req: Parameters<typeof requestGate>[0]) => requestGate(req, sessionId ?? '');
  return {
    name: 'open_page',
    label: toolLabel('open_page'),
    risk: 'confirm',
    description:
      'Open a URL in a browser tab — use it to bring up a page the task needs (e.g. open an AI chat site, a docs page, or a link found in content). If a tab with the same URL already exists it is reused (activated and registered as readable) instead of duplicated. The returned tabId is addressable: read_page / click_element / fill_element. Multi-tab workflows: open several sites with background: true and address each by its returned tabId — note that sites may redirect after loading (re-check identity with search_page if a title looks wrong). Every call requires explicit user approval via a confirmation card unless the user granted this session.',
    parameters: OPEN_PAGE_PARAMS,
    execute: async (toolCallId, args) => {
      const url = typeof args?.url === 'string' ? args.url.trim() : '';
      if (!/^https?:\/\//i.test(url)) {
        return {
          content: [
            {
              type: 'text',
              text: 'Invalid url: an absolute http/https URL is required.',
            },
          ],
          details: null,
        };
      }
      const background = args?.background === true;

      // 同 URL 复用:已存在同页 tab 时激活并注册为可读,不再开重复页(反馈:click 开新页后
      // open_page 同 URL 曾叠加出第二个重复 tab)
      const existing = await findTabByUrl(url);

      const approved = await gateForRun({
        kind: 'confirm',
        toolName: 'open_page',
        label: toolLabel('open_page'),
        summary: existing
          ? i18n.t('gateCard.openPage.summaryReuse')
          : i18n.t('gateCard.openPage.summaryOpen'),
        detail: `${existing ? `Reuse existing tab #${existing.id}` : `Open ${url}`}${background ? ' (background tab)' : ' (focused)'}`,
        toolCallId,
        grantable: true,
        grantScope: 'open_page@*',
      });
      if (!(approved.kind === 'confirm' && approved.approved)) {
        return {
          content: [{ type: 'text', text: 'User denied permission to run this tool.' }],
          details: { denied: true, url },
        };
      }

      if (existing) {
        // 复用=**认领为可读**,不是 agent 创建 → 不授予关闭权(用户自己的 tab 仍不可被 close_page 关闭)
        registerAgentOpenedTab(existing.id);
        let activated = true;
        if (!background) {
          try {
            await browser.tabs.update(existing.id, { active: true });
          } catch {
            // 激活失败(如刚被关闭):落入下方新建路径
            activated = false;
          }
        }
        if (activated) {
          return {
            content: [{
              type: 'text',
              text: `Reused existing tab #${existing.id} (${existing.url || url})${background ? ' (left in background)' : ' — it is now the focused tab'}. Its tabId is readable (read_page / click_element / fill_element); this tab already existed, so closing it needs the user's approval like any other tab.`,
            }],
            details: { tabId: existing.id, url: existing.url || url, reused: true },
          };
        }
      }

      const meta = await openTab(url, !background);
      if (!meta) {
        return {
          content: [{ type: 'text', text: `Failed to open ${url}: the browser rejected tabs.create.` }],
          details: { url },
        };
      }
      registerAgentOpenedTab(meta.id);
      return {
        content: [
          {
            type: 'text',
            text: `Opened tab #${meta.id} (${meta.url})${background ? ' in the background' : ' — it is now the focused tab'}. Its tabId is registered: read_page / click_element / fill_element can address it via tabId.`,
          },
        ],
        details: { tabId: meta.id, url: meta.url },
      };
    },
  };
}
