import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { toolLabel, type ToolRisk } from '../types';
import type { RefTab } from '../pageContext';
import { executePageScript, isUserScriptsAvailable, type PageScriptWorld } from '../pageScripting';
import { createGatedTool } from '../gate';

const EXECUTE_JS_PARAMS = Type.Object({
  tabId: Type.Number({ description: 'Id of the tab to run the script in (referenced tabs are annotated with tabId in the <page-refs> block of user messages)' }),
  code: Type.String({ description: 'JavaScript source code to execute in the page. The completion value of the last statement is returned as JSON — end with a small expression (e.g. `({title: document.title, count: results.length})`) instead of relying on console output.' }),
  world: Type.Optional(
    Type.Union([Type.Literal('user_script'), Type.Literal('main')], {
      description: "Execution world. 'user_script' (default) runs in an isolated user-script world with full DOM access but without JavaScript globals defined by the page; 'main' runs in the page's main world and can access page-defined JS state, which is more privileged — use it only when the page's own state is needed.",
    }),
  ),
});

/**
 * execute_js 工具定义(confirm 型):在用户引用的标签页执行任意 JS,经 createGatedTool
 * 包装(确认卡动态预览待执行代码)。安全边界 = tab 级白名单(与 read_page 一致)。
 * 底层经 lib/pageScripting.ts:主路线 chrome.userScripts.execute,不可用时降级
 * scripting.executeScript MAIN world。
 */
export function createExecuteJsToolDefinition(
  refTabs: RefTab[],
): AgentTool<typeof EXECUTE_JS_PARAMS> & { risk: ToolRisk } {
  const validTabIds = new Set<number>(refTabs.map((t) => t.id));
  const base: AgentTool<typeof EXECUTE_JS_PARAMS> & { risk: ToolRisk } = {
    name: 'execute_js',
    label: toolLabel('execute_js'),
    risk: 'confirm',
    description:
      'Execute JavaScript in a user-referenced tab and return the result — use it to read or compute page data that read_page / read_element cannot provide (e.g. state defined by the page itself, computed values), or to manipulate page state when the user asks for it. This tool runs arbitrary code in the page and can be destructive: every run requires explicit user approval via a confirmation card showing your code, so keep the code minimal and explain your intent before calling. Prefer read_page / read_element for plain content extraction; use this tool only when they are insufficient. Worlds: `user_script` (default) is isolated — it has DOM access but cannot see JavaScript globals defined by the page; `main` runs in the main world and can access page-defined JS state, but is more privileged.',
    parameters: EXECUTE_JS_PARAMS,
    execute: async (_toolCallId, args) => {
      const tabId = args?.tabId;
      if (typeof tabId !== 'number' || !validTabIds.has(tabId)) {
        return {
          content: [
            {
              type: 'text',
              text: `Invalid tabId: ${JSON.stringify(tabId ?? null)}. Executable tabs: ${
                [...validTabIds].map((id) => `#${id}`).join(', ') || '(none)'
              }.`,
            },
          ],
          details: null,
        };
      }
      const code = typeof args?.code === 'string' ? args.code : '';
      if (!code.trim()) {
        return {
          content: [
            { type: 'text', text: 'Invalid code: a non-empty JavaScript source string is required.' },
          ],
          details: null,
        };
      }
      const world: PageScriptWorld = args?.world === 'main' ? 'main' : 'user_script';
      const res = await executePageScript(tabId, code, world);
      return {
        content: [{ type: 'text', text: res.ok ? res.result : res.error }],
        details: { tabId, world },
      };
    },
  };
  return createGatedTool(base, '在页面中执行 JavaScript 代码', undefined, (params) => {
    const p = (params ?? {}) as { code?: unknown; tabId?: unknown };
    const code = typeof p.code === 'string' ? p.code : '';
    const tabId = typeof p.tabId === 'number' ? p.tabId : (p.tabId ?? 'unknown');
    const ref = refTabs.find((t) => t.id === p.tabId);
    const target = ref
      ? `Target tab: #${tabId} "${ref.title}" (${ref.url})`
      : `Target tab: #${tabId}`;
    return [
      // 未开 Allow User Scripts 时降级 MAIN world(权限更强),确认卡上提前告知
      ...(isUserScriptsAvailable()
        ? []
        : ["Note: the userScripts API is unavailable — the code will run in the page's MAIN world as a fallback."]),
      code,
      target,
    ].join('\n');
  });
}
