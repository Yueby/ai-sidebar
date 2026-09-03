import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import {
  createModels,
  createProvider,
  type Model,
  type KnownApi,
} from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { ChatMessage, ModelConfig, ProviderConfig, ReasoningLevel, PickedElement, PageRefs, UserMessage, WebSearchConfig } from './types';
import { normalizeBaseUrl } from './providers';
import type { RefTab } from './pageContext';
import { localDate, utcOffsetLabel, weekdayName } from './tools/time';
import { getTools } from './tools/registry';
import { collectPageRefs, PAGE_REFS_TAG, parsePageRefs, renderPageRefsBlock } from './pageRefs';

export type { AgentEvent } from '@earendil-works/pi-agent-core';

// ── 元素引用单一表示:存储 user content 内嵌自闭合 <picked-element …/> 块,LLM 视图与存储一致 ──

/**
 * user 消息 LLM 请求副本:refs 块剥除 elements 数组(元素已由消息文本内的
 * <picked-element …/> 块内联承载,元数据仅存储层/UI 需要,块内只留 tabs);
 * 无块/无元素的纯文本消息原样返回(保持引用稳定,避免无谓副本)。
 */
function toLlmMessage(m: ChatMessage): ChatMessage {
  if (m.role !== 'user' || typeof m.content !== 'string') return m;
  const blockStart = m.content.indexOf(`<${PAGE_REFS_TAG}>`);
  if (blockStart < 0) return m;
  const refs = parsePageRefs(m.content);
  if (!refs || refs.elements.length === 0) return m;
  const text = m.content.slice(0, blockStart).replace(/\n+$/, '');
  return { ...m, content: text + renderPageRefsBlock({ tabs: refs.tabs, elements: [] }) };
}

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

/** 组装 provider 实例(压缩等旁路请求复用;runAgentTurn 内部亦经此构建) */
export function buildProvider(p: ProviderConfig) {
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
 * 组装 system prompt:身份 + <page-refs> 块协议的常量使用规则(压缩版,省 token)。
 * Model-facing 文本一律英文;注释是给开发者看的,保持中文。
 */
export function buildSystemPrompt(): string {
  const now = new Date();
  const parts = [
    "You are an AI assistant living in the user's browser sidebar. Respond in the same language the user writes in.",
    // 不带时刻(精确时刻由 read_time 工具覆盖):system prompt 保持跨轮稳定,前缀缓存不失效
    `Today is ${weekdayName(now)}, ${localDate(now)} (${utcOffsetLabel(now)}).`,
  ];
  parts.push(
    '',
    'User messages may carry a <page-refs> block — the browser context referenced at send time:',
    '- tabs lists referenced tabs; tabId is the read handle; focused = the tab the user was viewing (context, not the referent).',
    "- <picked-element …> blocks in message text mark an element the user deliberately picked; their attributes (tabId/selector) are the handle — call read_element with them to read the element's content when your answer needs it. Full-page content is read via read_page.",
    '- Inline tokens like [url: example.com] are URLs the user pasted as references — self-describing; treat them as plain links, not element markers.',
    '- Tool results are live and win over the block metadata when they conflict.',
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
  /** compact_context 工具触发回调(模型申请压缩;轮结束后由调用方执行 runCompact 并落盘) */
  onCompactContext?: () => void;
  /** 网络搜索源配置(设置里配置了可用搜索源才注册 search_web) */
  webSearch?: WebSearchConfig | null;
}

export interface RunAgentResult {
  /** 运行结束后的完整转录(历史 + 本轮全部消息,含 toolResult) */
  messages: ChatMessage[];
  /** 本轮新增的消息 */
  newMessages: ChatMessage[];
  /** 最后一条 assistant 消息的错误信息(仅 stopReason==='error' 时) */
  errorMessage?: string;
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
      elementId: e.id,
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

  // 工具组装唯一入口:注册表(分组 + 白名单条件)产出最终数组,顺序与重构前一致。
  // vision 门控在协议层同源:toPiModel 的 input 由 ModelConfig.vision 决定,
  // model.input 含 image 才允许 read_element 产 ImageContent 块(省 token + 非 vision 走文字描述);
  // pi-ai transform-messages 的 downgradeUnsupportedImages 是双保险(不支持时块降为占位文本)。
  const tools = getTools({
    refTabs,
    pickedElements,
    canUseImage: model.input.includes('image'),
    onCompactContext: options.onCompactContext,
    webSearch: options.webSearch ?? null,
  });

  const agent = new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(),
      model,
      thinkingLevel: options.thinkingLevel,
      tools,
      // 请求副本:user 消息的元素标记在请求时原位展开为 <picked-element> 块
      // (内容取自该消息自身 refs 块);转录外副本 —— 持久化仍是标记 + refs 块
      messages: options.history.map(toLlmMessage),
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
    // 请求副本:本轮 user 消息同样经 toLlmMessage 展开(元素内容内嵌;悬空标记剥除)
    await agent.prompt(toLlmMessage(options.userMessage) as UserMessage);
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
