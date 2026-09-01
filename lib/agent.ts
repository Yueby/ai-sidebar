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
import { toolLabel } from './types';
import { normalizeBaseUrl } from './providers';
import { createExtractPageTool, resolveElement, type RefTab } from './pageContext';
import { collectPageRefs } from './pageRefs';
import { fetchImageForModel, captureCropForModel } from './imageFetch';

export type { AgentEvent } from '@earendil-works/pi-agent-core';
export { createExtractPageTool } from './pageContext';

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
 * 这里只解释协议;实时内容一律经 extract_page / read_element 工具获取。
 */
export function buildSystemPrompt(): string {
  return [
    '你是用户浏览器侧边栏中的 AI 助手,回答使用与用户一致的语言(默认中文)。',
    `今天是 ${new Date().toISOString().slice(0, 10)}。`,
    '',
    '用户消息可能携带 <page-refs> 块,是用户发送该消息时引用的浏览器上下文(仅元数据):',
    '- tabs 为引用的标签页列表,tabId 是读取句柄;focused 标记用户发送时正在查看的标签页,',
    '  用户说「这个页面/这个」时默认指它。',
    '- elements 为用户在页面上框选的元素,是其关注的重点提示(用 tabId + selector 读取);',
    '  你也可以在引用页内自行探索其他元素,用任意 CSS 选择器经 read_element 读取。',
    '- 需要页面或元素的实际内容时,调用 extract_page / read_element 工具;工具返回的是实时',
    '  内容,与块中元数据冲突时以工具为准。',
    '- 用户指代不明确时(无 focused 标记,或多个引用且指向不明),先追问确认,不要猜测,',
    '  也不要反复调用工具试探。',
    '- 工具返回无法读取/元素不存在,通常表示标签页已关闭或页面已导航,据此回应,不要原参数重试。',
  ].join('\n');
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
  tabId: Type.Number({ description: '元素所在标签页 id(用户引用的标签页在消息 <page-refs> 块中以 tabId 标注)' }),
  selector: Type.String({ description: '任意 CSS 选择器,定位引用页内要读取的元素' }),
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
): AgentTool<typeof READ_ELEMENT_PARAMS> {
  // tab 级白名单 = 引用标签页 ∪ 框选元素所在标签页(历史上引用过元素的 tab 必可读)
  const validTabIds = new Set<number>([
    ...refTabs.map((t) => t.id),
    ...pickedElements.map((p) => p.tabId),
  ]);
  return {
    name: 'read_element',
    label: toolLabel('read_element'),
    description:
      '读取用户引用的某个标签页内指定 CSS 选择器元素的内容(文字/Markdown,含图片时附图像块)。tabId 必须来自用户消息 <page-refs> 块;selector 可为任意合法 CSS 选择器——<page-refs> 中 elements 是用户框选的重点提示,但你也可以在页面内自行探索其他元素。',
    parameters: READ_ELEMENT_PARAMS,
    execute: async (_toolCallId, args) => {
      const tabId = args?.tabId;
      const selector = args?.selector;
      if (typeof tabId !== 'number' || !validTabIds.has(tabId)) {
        return {
          content: [
            {
              type: 'text',
              text: `无效的 tabId: ${JSON.stringify(tabId ?? null)}。可读取的标签页: ${
                [...validTabIds].map((id) => `#${id}`).join(', ') || '(无)'
              }。`,
            },
          ],
          details: null,
        };
      }
      if (typeof selector !== 'string' || selector.length === 0) {
        return {
          content: [
            { type: 'text', text: '无效的 selector:必须提供非空 CSS 选择器字符串。' },
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
              text: `无法读取标签页 #${tabId} 中的元素 \`${selector}\`:页面可能已导航、刷新导致元素不存在,或标签页已被关闭。请据此调整回答。`,
            },
          ],
          details: null,
        };
      }
      const content: (TextContent | ImageContent)[] = [
        {
          type: 'text',
          text: [
            `标签页 #${tabId} 中的元素 <${element.tagName}>(selector: \`${selector}\`)当前内容:`,
            '',
            '<element>',
            element.markdown,
            '</element>',
          ].join('\n'),
        },
      ];

      if (element.images.length > 0) {
        if (!canUseImage) {
          // 非 vision 模型:只给文字说明(src/alt/尺寸),不产图
          const lines = element.images.map(
            (im) =>
              `- 图片(${im.naturalWidth}×${im.naturalHeight}${im.alt ? `,alt: ${im.alt}` : ''}): ${im.src}`,
          );
          content.push({
            type: 'text',
            text: `该元素包含图片,但当前模型不支持图片输入,仅提供图片信息:\n${lines.join('\n')}`,
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
              text: failed.map((s) => `[图片无法读取: ${s}]`).join('\n'),
            });
          }
        }
      }

      return { content, details: { tabId, selector } };
    },
  };
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
  // tabs 非空注入 extract_page;有可读 tab(引用页或框选元素所在页)即注入 read_element
  // (selector 不设白名单,tab 级即安全边界;elements 元数据仅作提示,定稿方案,system prompt 不列清单)。
  // vision 门控在协议层同源:toPiModel 的 input 由 ModelConfig.vision 决定,
  // model.input 含 image 才允许 read_element 产 ImageContent 块(省 token + 非 vision 走文字描述);
  // pi-ai transform-messages 的 downgradeUnsupportedImages 是双保险(不支持时块降为占位文本)。
  const canUseImage = model.input.includes('image');
  if (refTabs.length > 0) tools.push(createExtractPageTool(refTabs));
  if (refTabs.length > 0 || pickedElements.length > 0) {
    tools.push(createReadElementTool(refTabs, pickedElements, canUseImage));
  }

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
