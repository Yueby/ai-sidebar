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
import type { ChatMessage, ModelConfig, ProviderConfig, ReasoningLevel, PickedElement, PageRefs, UserMessage } from './types';
import { normalizeBaseUrl } from './providers';
import type { RefTab } from './pageContext';
import { localDate, utcOffsetLabel, weekdayName } from './tools/time';
import { getTools } from './tools/registry';
import { collectPageRefs, PAGE_REFS_TAG, parsePageRefs } from './pageRefs';

export type { AgentEvent } from '@earendil-works/pi-agent-core';

// ── 请求时元素内容内嵌(拍板协议;存储仍为 [element:N] 标记 + refs 块)─────────────────

const ELEMENT_MARKER_TEST_RE = /\[(?:element|元素):\d+\]/;
const ELEMENT_MARKER_GLOBAL_RE = /\[(?:element|元素):(\d+)\]/g;

type RefElement = PageRefs['elements'][number];

/**
 * user 消息文本段 → LLM 请求文本:元素标记([element:N],兼容旧 [元素:N])用该消息
 * 自身 refs 块中对应元素**原位展开**为 <picked-element> 块(content 优先,缺省降级 preview);
 * 无对应 id 的伪造/悬空标记剥除。只处理 <page-refs> 之前的文本段,
 * refs JSON 原样保留(元数据 + 工具白名单语义),不触碰块内页面内容。
 */
function toLlmUserText(content: string): string {
  if (!ELEMENT_MARKER_TEST_RE.test(content)) return content;
  const blockStart = content.indexOf(`<${PAGE_REFS_TAG}>`);
  const textPart = blockStart >= 0 ? content.slice(0, blockStart) : content;
  const blockPart = blockStart >= 0 ? content.slice(blockStart) : '';
  const elementsById = new Map<number, RefElement>();
  for (const e of parsePageRefs(content)?.elements ?? []) {
    elementsById.set(e.id, e);
  }
  const expanded = textPart.replace(ELEMENT_MARKER_GLOBAL_RE, (marker, idStr: string) => {
    const el = elementsById.get(parseInt(idStr, 10));
    if (!el) return ''; // 伪造/悬空标记:剥除
    const body = el.content ?? el.preview ?? '';
    // 属性转义:防病态 selector/tagName 中的引号破坏 picked-element 标签结构
    const esc = (v: string) => v.replace(/"/g, '&quot;');
    return `<picked-element tabId="${el.tabId}" selector="${esc(el.selector)}" tagName="${esc(el.tagName)}">\n${body}\n</picked-element>`;
  });
  return expanded + blockPart;
}

/** user 消息请求副本:仅变换文本段,不改消息形状;转录外副本,持久化仍是标记 + refs 块 */
function toLlmMessage(m: ChatMessage): ChatMessage {
  if (m.role !== 'user' || typeof m.content !== 'string') return m;
  return { ...m, content: toLlmUserText(m.content) };
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
 * 组装 system prompt:身份/语言 + <page-refs> 块协议的常量使用规则。
 * 定稿方案:引用清单不再进 system prompt(零中间层)——块随 user 消息 content 原样抵达 LLM,
 * 这里只解释协议;实时内容一律经 read_page / read_element 工具获取。
 * Model-facing 文本一律英文(硬约束);注释是给开发者看的,保持中文。
 * 回复语言动态注入:sidepanel 上下文直读 navigator.language,异常时省略该行。
 */
export function buildSystemPrompt(): string {
  const now = new Date();
  const parts = [
    "You are an AI assistant living in the user's browser sidebar. Respond in the same language the user writes in.",
    // 不带时刻(精确时刻由 read_time 工具覆盖):system prompt 保持跨轮稳定,前缀缓存不失效
    `Today is ${weekdayName(now)}, ${localDate(now)} (${utcOffsetLabel(now)}).`,
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
    'User messages may carry a <page-refs> block — the browser context referenced at send time:',
    '- `tabs` lists the referenced tabs; `tabId` is the read handle. The `focused` flag marks the tab the user was viewing when sending — useful background, but NOT by itself the referent of a question.',
    "- `elements` lists the elements the user picked (metadata only; each element's content is embedded inline in the message text as a <picked-element> block).",
    "- Some user messages embed picked element content inline inside <picked-element> blocks at the exact point of reference (attributes carry tabId/selector/tagName for re-reads). Answer questions about that content directly from the block; call read_element with the block's tabId+selector only when you need to re-read fresh content (the page may have changed).",
    '- Inline tokens like [url: example.com] are URLs the user pasted as references — they are self-describing; treat them as plain links, not element markers.',
    '- When you need the actual content of a referenced tab, call the read_page tool; tool results are live and win over the block metadata when they conflict.',
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
  /** compact_context 工具触发回调(模型申请压缩;轮结束后由调用方执行 runCompact 并落盘) */
  onCompactContext?: () => void;
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
