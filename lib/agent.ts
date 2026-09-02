import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentEvent, AgentTool } from '@earendil-works/pi-agent-core';
import {
  createModels,
  createProvider,
  type Model,
  type KnownApi,
} from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { Type } from '@earendil-works/pi-ai';
import type { AssistantMessage, ImageContent, TextContent, UserMessage } from '@earendil-works/pi-ai';
import type { ChatMessage, ModelConfig, ProviderConfig, ReasoningLevel, PickedElement } from './types';
import { toolLabel, type ToolRisk } from './types';
import { normalizeBaseUrl } from './providers';
import { createReadPageTool, resolveElement, type RefTab } from './pageContext';
import { executePageScript, isUserScriptsAvailable, type PageScriptWorld } from './pageScripting';
import { createGatedTool } from './gate';
import { createReadTimeTool, createAskUserTool, localDate, utcOffsetLabel } from './tools';
import { collectPageRefs } from './pageRefs';
import { fetchImageForModel, captureCropForModel } from './imageFetch';

export type { AgentEvent } from '@earendil-works/pi-agent-core';
export { createReadPageTool } from './pageContext';

const API_IMPLEMENTATIONS = {
  'openai-completions': openAICompletionsApi(),
  'openai-responses': openAIResponsesApi(),
  'anthropic-messages': anthropicMessagesApi(),
};

/** 把本地 ModelConfig 映射成 pi-ai 的 Model(缺失参数用保守默认值) */
export function toPiModel(p: ProviderConfig, m: ModelConfig): Model<KnownApi> {
  return {
    id: m.id,
    name: m.displayName?.trim() || m.id,
    api: p.api,
    provider: p.id,
    baseUrl: normalizeBaseUrl(p.api, p.baseUrl),
    reasoning: m.reasoning ?? false,
    input: m.vision ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: m.contextWindow ?? 128000,
    maxTokens: m.maxTokens ?? 4096,
    // 对齐 pi 上游模型目录做法(上游 deepseek.json 等均显式设 supportsDeveloperRole:false):
    // BYOK 自定义端点兼容面最广的是 system role;禁用 developer role 探测,
    // 否则 reasoning 模型的 systemPrompt 会发成 role:'developer' 导致部分中转 400
    compat: { supportsDeveloperRole: false },
  } as Model<KnownApi>;
}

function buildProvider(p: ProviderConfig) {
  return createProvider({
    id: p.id,
    name: p.name || p.id,
    baseUrl: normalizeBaseUrl(p.api, p.baseUrl),
    auth: {
      apiKey: {
        name: `${p.name || 'Provider'} API Key`,
        resolve: async () => ({ auth: p.apiKey ? { apiKey: p.apiKey } : {} }),
      },
    },
    models: p.models.map((m) => toPiModel(p, m)),
    api: API_IMPLEMENTATIONS,
  });
}

/**
 * 组装 system prompt:身份/语言 + <page-refs> 块协议的常量使用规则。
 * 定稿方案:引用清单不再进 system prompt(零中间层)——块随 user 消息 content 原样抵达 LLM,
 * 这里只解释协议;实时内容一律经 read_page / read_element 工具获取。
 * Model-facing 文本一律英文(硬约束);注释是给开发者看的,保持中文。
 * 回复语言动态注入:sidepanel 上下文直读 navigator.language,异常时省略该行。
 */
export function buildSystemPrompt(): string {
  const now = new Date();
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const parts = [
    "You are an AI assistant living in the user's browser sidebar. Respond in the same language the user writes in.",
    // 不带时刻(精确时刻由 read_time 工具覆盖):system prompt 保持跨轮稳定,前缀缓存不失效
    `Today is ${weekday}, ${localDate(now)} (${utcOffsetLabel(now)}).`,
  ];
  try {
    const lang = navigator.language;
    if (lang) {
      parts.push(
        `The user's browser language is ${lang}; if the user's message language is unclear, prefer it.`,
      );
    }
  } catch {
    // navigator.language 不可用:省略该行
  }
  parts.push(
    '',
    'User messages may carry a <page-refs> block — the browser context referenced at send time (metadata only):',
    '- `tabs` lists the referenced tabs; `tabId` is the read handle. The `focused` flag marks the tab the user was viewing when sending; when the user says "this page" or "this one", they mean that tab by default.',
    '- `elements` lists elements the user picked on a page (read them with tabId + selector); they are hints about what the user cares about. You may also explore other elements yourself with any CSS selector via read_element.',
    '- When you need the actual content of a page or element, call the read_page / read_element tools; tool results are live and win over the block metadata when they conflict.',
    '- If the reference is ambiguous (no focused flag, or multiple refs without a clear target), ask a clarifying question first — do not guess or probe with repeated tool calls.',
    '- A tool result saying unreadable / element not found usually means the tab was closed or has navigated away; respond accordingly and never retry with the exact same arguments.',
  );
  return parts.join('\n');
}

export interface RunAgentOptions {
  provider: ProviderConfig;
  modelId: string;
  /** 本轮之前的会话历史(不含本轮用户消息);user 消息 content 可含 <page-refs> 块,参与工具白名单聚合 */
  history: ChatMessage[];
  /** 本轮用户消息(content 已内嵌 <page-refs> 块);与历史同形状,无任何自定义字段 */
  userMessage: UserMessage;
  /** 当前草稿中被引用的标签页(App 侧已按 includePageContext 门槛过滤) */
  refTabs?: RefTab[];
  /** 当前草稿中用户框选的页面元素(App 侧已按 includePageContext 门槛过滤) */
  pickedElements?: PickedElement[];
  thinkingLevel: ReasoningLevel;
  /** 会话 id,转发给支持提示缓存的提供商 */
  sessionId?: string;
  signal?: AbortSignal;
  /** Agent 事件透出(message_update/tool_execution_* 等),供 UI 流式渲染 */
  onEvent?: (event: AgentEvent) => void;
}

export interface RunAgentResult {
  /** 运行结束后的完整转录(历史 + 本轮全部消息,含 toolResult) */
  messages: ChatMessage[];
  /** 本轮新增的消息 */
  newMessages: ChatMessage[];
  /** 最后一条 assistant 消息的错误信息(仅 stopReason==='error' 时) */
  errorMessage?: string;
}

const READ_ELEMENT_PARAMS = Type.Object({
  tabId: Type.Number({ description: 'Id of the tab containing the element (referenced tabs are annotated with tabId in the <page-refs> block of user messages)' }),
  selector: Type.String({ description: 'Any CSS selector locating the element to read within the referenced page' }),
});

/**
 * read_element 工具:AI 按需读取用户引用的某个标签页内任意元素的当前内容。
 * 安全边界是 tab 级白名单(tabId ∈ 引用标签页);selector 不限制——
 * 框选元素只是提示,AI 可在引用页内自行探索其他元素(content.ts 的 resolve 直接 querySelector)。
 * vision 门控:仅当 `canUseImage`(当前模型 input 含 image)时,元素内的图片
 * 才会被取回并以 ImageContent 块并列返回;非 vision 模型只返回图片的文字描述。
 */
export function createReadElementTool(
  refTabs: RefTab[],
  pickedElements: PickedElement[],
  canUseImage: boolean,
): AgentTool<typeof READ_ELEMENT_PARAMS> & { risk: ToolRisk } {
  // tab 级白名单 = 引用标签页 ∪ 框选元素所在标签页(历史上引用过元素的 tab 必可读)
  const validTabIds = new Set<number>([
    ...refTabs.map((t) => t.id),
    ...pickedElements.map((p) => p.tabId),
  ]);
  return {
    name: 'read_element',
    label: toolLabel('read_element'),
    risk: 'safe',
    description:
      'Read the element matching a CSS selector inside a user-referenced tab and return its outerHTML (raw HTML with tags, attributes and structure — useful for understanding interactive elements; image blocks are attached when the element contains images and the model supports them). tabId must come from the <page-refs> block in the user message; selector can be any valid CSS selector — elements in <page-refs> are user-picked highlights, but you may also explore other elements on the page. For a full-page overview use read_page.',
    parameters: READ_ELEMENT_PARAMS,
    execute: async (_toolCallId, args) => {
      const tabId = args?.tabId;
      const selector = args?.selector;
      if (typeof tabId !== 'number' || !validTabIds.has(tabId)) {
        return {
          content: [
            {
              type: 'text',
              text: `Invalid tabId: ${JSON.stringify(tabId ?? null)}. Readable tabs: ${
                [...validTabIds].map((id) => `#${id}`).join(', ') || '(none)'
              }.`,
            },
          ],
          details: null,
        };
      }
      if (typeof selector !== 'string' || selector.length === 0) {
        return {
          content: [
            { type: 'text', text: 'Invalid selector: a non-empty CSS selector string is required.' },
          ],
          details: null,
        };
      }
      const element = await resolveElement(tabId, selector);
      if (!element) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to read element \`${selector}\` in tab #${tabId}: the page may have navigated, the element may no longer exist after a refresh, or the tab may have been closed. Respond accordingly.`,
            },
          ],
          details: null,
        };
      }
      const content: (TextContent | ImageContent)[] = [
        {
          type: 'text',
          text: [
            `Element <${element.tagName}> in tab #${tabId} (selector: \`${selector}\`), current content:`,
            '',
            '<element>',
            element.html,
            '</element>',
            ...(element.truncated ? ['', '(Element content truncated due to length)'] : []),
          ].join('\n'),
        },
      ];

      if (element.images.length > 0) {
        if (!canUseImage) {
          // 非 vision 模型:只给文字说明(src/alt/尺寸),不产图
          const lines = element.images.map(
            (im) =>
              `- Image (${im.naturalWidth}×${im.naturalHeight}${im.alt ? `, alt: ${im.alt}` : ''}): ${im.src}`,
          );
          content.push({
            type: 'text',
            text: `The element contains images, but the current model does not support image input. Image info only:\n${lines.join('\n')}`,
          });
        } else {
          // 取图兜底链:fetch(不受页面 CORS 限制)→ 截图裁剪(仅活动 tab)→ 文字说明
          const failed: string[] = [];
          for (const im of element.images) {
            const encoded =
              (await fetchImageForModel(im.src)) ??
              (await captureCropForModel(tabId, im.rect, element.dpr));
            if (encoded) {
              content.push({ type: 'image', data: encoded.data, mimeType: encoded.mimeType });
            } else {
              failed.push(im.src);
            }
          }
          if (failed.length > 0) {
            content.push({
              type: 'text',
              text: failed.map((s) => `[Image unavailable: ${s}]`).join('\n'),
            });
          }
        }
      }

      return { content, details: { tabId, selector } };
    },
  };
}

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
 * execute_js 工具:在用户引用的标签页执行任意 JS,confirm 型(经 createGatedTool
 * 包装,确认卡动态预览待执行代码)。安全边界 = tab 级白名单(与 read_page 一致)。
 * 底层经 lib/pageScripting.ts:主路线 chrome.userScripts.execute,不可用时降级
 * scripting.executeScript MAIN world。
 */
export function createExecuteJsTool(
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

/**
 * 基于 pi-agent-core 的 Agent 跑一轮对话(可能包含多轮工具调用循环)。
 * 失败经 Agent 协议事件编码(stopReason='error'),取消经 signal 注入;
 * 中止时已生成的部分保留在转录中。
 */
export async function runAgentTurn(options: RunAgentOptions): Promise<RunAgentResult> {
  const models = createModels();
  models.setProvider(buildProvider(options.provider));
  const model = models.getModel(options.provider.id, options.modelId);
  if (!model) throw new Error(`模型 ${options.modelId} 不存在,请检查提供商配置`);

  // 工具白名单 = 当前草稿引用 ∪ 历史 <page-refs> 块引用。
  // 后者保证「追问旧页面」时(草稿已清空)工具句柄仍在,LLM 能读此前引用的标签页/元素。
  const currentTabs = options.refTabs ?? [];
  const currentElements = options.pickedElements ?? [];
  const historical = collectPageRefs(options.history);

  const tabById = new Map<number, RefTab>();
  for (const t of historical.tabs) {
    tabById.set(t.tabId, { id: t.tabId, title: t.title, url: t.url });
  }
  // 当前草稿优先(实时 title/url 覆盖历史块元数据)
  for (const t of currentTabs) {
    tabById.set(t.id, t);
  }
  const refTabs = [...tabById.values()];

  const elementByKey = new Map<string, PickedElement>();
  for (const e of historical.elements) {
    const key = `${e.tabId}:${e.selector}`;
    elementByKey.set(key, {
      id: key,
      tabId: e.tabId,
      selector: e.selector,
      tagName: e.tagName,
      preview: e.preview,
    });
  }
  for (const e of currentElements) {
    elementByKey.set(`${e.tabId}:${e.selector}`, e);
  }
  const pickedElements = [...elementByKey.values()];

  const tools: AgentTool[] = [];
  // tabs 非空注入 read_page / execute_js;有可读 tab(引用页或框选元素所在页)即注入 read_element
  // (selector 不设白名单,tab 级即安全边界;elements 元数据仅作提示,定稿方案,system prompt 不列清单)。
  // vision 门控在协议层同源:toPiModel 的 input 由 ModelConfig.vision 决定,
  // model.input 含 image 才允许 read_element 产 ImageContent 块(省 token + 非 vision 走文字描述);
  // pi-ai transform-messages 的 downgradeUnsupportedImages 是双保险(不支持时块降为占位文本)。
  const canUseImage = model.input.includes('image');
  // 安全通用工具常驻:read_time 免弹卡;ask_user 经 gate ask 路径(无 UI 处理器时快速 cancelled)
  tools.push(createReadTimeTool(), createAskUserTool());
  if (refTabs.length > 0) tools.push(createReadPageTool(refTabs));
  if (refTabs.length > 0 || pickedElements.length > 0) {
    tools.push(createReadElementTool(refTabs, pickedElements, canUseImage));
  }
  // execute_js:confirm 型(createGatedTool 包装),tab 句柄同 read_page 白名单
  if (refTabs.length > 0) tools.push(createExecuteJsTool(refTabs));

  const agent = new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(),
      model,
      thinkingLevel: options.thinkingLevel,
      tools,
      messages: options.history,
    },
    streamFn: (m, ctx, o) => models.streamSimple(m, ctx, o),
    sessionId: options.sessionId,
    toolExecution: 'sequential',
  });

  let newMessages: ChatMessage[] = [];
  const unsubscribe = agent.subscribe((event) => {
    if (event.type === 'agent_end') {
      newMessages = event.messages as ChatMessage[];
    }
    options.onEvent?.(event);
  });

  const signal = options.signal;
  const onAbort = () => agent.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    // 以消息对象进入转录:content 内的 <page-refs> 块随消息原样抵达 LLM,无需任何剥离层
    await agent.prompt(options.userMessage);
  } finally {
    unsubscribe();
    signal?.removeEventListener('abort', onAbort);
  }

  const messages = [...agent.state.messages] as ChatMessage[];
  const lastAssistant = [...messages]
    .reverse()
    .find((m): m is AssistantMessage => m.role === 'assistant');
  const errorMessage =
    lastAssistant?.stopReason === 'error'
      ? lastAssistant.errorMessage || '请求失败,请检查提供商配置'
      : undefined;

  return { messages, newMessages, errorMessage };
}
