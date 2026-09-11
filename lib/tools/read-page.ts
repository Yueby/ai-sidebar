import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { toolLabel } from '../toolLabels';
import { type ToolRisk } from '../types';
import { extractFromTab, renderPageContext, buildUnreadableTabError, type RefTab } from '../pageContext';
import { continuationHint, nextOffsetFor } from '../pageTextWindow';

/** 首次抽取过薄(SPA 未渲染完)时的自动重试节奏:有界、总时长封顶,避免模型自己摸索“再等等再读” */
const THIN_RETRY_WAITS_MS = [1200, 2500];
const THIN_TEXT_CHARS = 200;

/** 抽取是否过薄(纯判定,便于单测):前端渲染页首次读取常见“只剩骨架/空白” */
export function isThinExtraction(text: string): boolean {
  return text.trim().length < THIN_TEXT_CHARS;
}

const READ_PAGE_PARAMS = Type.Object({
  tabId: Type.Number({ description: 'Id of the tab to read (referenced tabs are annotated with tabId in the <page-refs> block of user messages)' }),
  section: Type.Optional(
    Type.Union([Type.Literal('head'), Type.Literal('tail')], {
      description:
        "Which part of long pages to keep when truncating (default 'head'). Use 'tail' for chat/message pages — the latest messages live at the end.",
    }),
  ),
  waitStableMs: Type.Optional(
    Type.Number({
      description:
        'Wait up to this many milliseconds for the page content to stabilize before extracting (text length unchanged across samples). Use after actions that trigger streaming updates (e.g. submitting a chat message); cap ~15000.',
    }),
  ),
  waitText: Type.Optional(
    Type.String({
      description:
        'Wait (up to waitStableMs) until the extracted text CONTAINS this substring (case-insensitive) — e.g. wait for an AI reply to mention a keyword before reading. Requires waitStableMs > 0; returns as soon as it matches or the timeout expires.',
    }),
  ),
  offset: Type.Optional(
    Type.Number({
      description:
        'Character offset to read from (for long pages whose output was truncated). A truncated result tells you the exact offset to use next; pass it here to read forward without re-reading the beginning. When set, section is ignored.',
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
      "Read the title, URL and main text content of a user-referenced browser tab. Call this with the corresponding tabId when the user's question may relate to a referenced page or needs its content. Long pages are truncated from the head by default — pass section: 'tail' to keep the END of the content (e.g. the latest messages in a chat), or use the offset reported in a truncated result to read further. If the content comes back nearly empty the tool retries briefly by itself (client-rendered pages); if it stays empty, the page may still be loading or not extractable — say so rather than retrying the same tabId repeatedly. If the user's message contains a picked element and the question points at it, prefer read_element.",
    parameters: READ_PAGE_PARAMS,
    execute: async (_toolCallId, args) => {
      const tabId = args?.tabId;
      if (
        typeof tabId !== 'number' ||
        (!validIds.includes(tabId) && !(dynamicTabs?.has(tabId) ?? false))
      ) {
        return {
          content: [{ type: 'text', text: await buildUnreadableTabError(tabId, validIds, dynamicTabs) }],
          details: null,
        };
      }
      const section = args?.section === 'tail' ? 'tail' : 'head';
      const waitStableMs =
        typeof args?.waitStableMs === 'number' && args.waitStableMs > 0
          ? Math.min(Math.round(args.waitStableMs), 30000)
          : 0;
      const waitText = typeof args?.waitText === 'string' && args.waitText.trim() ? args.waitText.trim() : undefined;
      const requestedOffset =
        typeof args?.offset === 'number' && args.offset > 0 ? Math.round(args.offset) : 0;
      let page = await extractFromTab(tabId, section, waitStableMs, waitText, requestedOffset);
      let autoRetried = false;
      // 首次读到空白/骨架且调用方没要求等待:自动有界重试(前端渲染页的常见情形)。
      // 不回退到空结果让模型自己猜“等 8 秒再读”——真机记录里就是这么浪费掉一轮的。
      if (page && waitStableMs === 0 && isThinExtraction(page.text)) {
        for (const waitMs of THIN_RETRY_WAITS_MS) {
          const retry = await extractFromTab(tabId, section, waitMs, waitText, requestedOffset);
          if (!retry) break;
          if (retry.text.trim().length > page.text.trim().length) {
            page = retry;
            autoRetried = true;
          }
          if (!isThinExtraction(page.text)) break;
        }
      }
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
      const waitNote =
        waitText && !page.text.toLowerCase().includes(waitText.toLowerCase())
          ? `Note: waitText "${waitText}" was not found within the wait window — the page may not have reached the expected state.`
          : '';
      // 登录/注册页启发式:URL 特征提示(让模型直接告知用户需要登录,而不是白跑)
      const authNote = /(log[-_]?in|sign[-_]?in|sign[-_]?up|register|authenticate)/i.test(page.url)
        ? 'Note: this page appears to be a login/signup flow — the site may require authentication before it can be used.'
        : '';
      // 续读指引:截断时给出下一次调用所需的 offset(不再让模型自己摸索后半段怎么取)
      // 起点取 content 侧回报的**真实窗口起点**(尾窗不为 0)——否则提示会说错“展示的是哪一段”
      const shownFrom = page.windowStart ?? requestedOffset;
      const shownTo = shownFrom + page.text.length;
      const truncationNote = page.truncated
        ? continuationHint(tabId, {
            text: page.text,
            start: shownFrom,
            truncated: true,
            totalLength: page.totalLength ?? shownTo,
            nextOffset: nextOffsetFor(shownFrom, page.text.length, page.totalLength),
            omittedBefore: shownFrom > 0,
          })
        : '';
      const retryNote = autoRetried
        ? 'Note: the first extraction came back nearly empty, so the page was read again after a short wait (it appears to be client-rendered).'
        : '';
      return {
        content: [
          {
            type: 'text',
            text:
              renderPageContext(page, { truncationNote: !truncationNote }) +
              (retryNote ? `\n\n${retryNote}` : '') +
              (waitNote ? `\n\n${waitNote}` : '') +
              (authNote ? `\n\n${authNote}` : '') +
              (truncationNote ? `\n\n${truncationNote}` : ''),
          },
        ],
        details: { title: page.title, url: page.url },
      };
    },
  };
}
