import { i18n } from '#i18n';
import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentEvent, AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import {
  createModels,
  createProvider,
  type Model,
  type KnownApi,
} from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import type { AssistantMessage, Api } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { ChatMessage, ModelConfig, ProviderConfig, ReasoningLevel, PickedElement, PageRefs, SessionCompaction, Skill, UserMessage, UserRule, WebSearchConfig } from './types';
import { effectiveMessages } from './contextTokens';
import { normalizeBaseUrl } from './providers';
import type { RefTab } from './pageContext';
import { localDate, utcOffsetLabel, weekdayName } from './tools/time';
import { getTools } from './tools/registry';
import { getAgentOpenedTabs } from './pageContext';
import { collectPageRefs, PAGE_REFS_TAG, parsePageRefs, renderPageRefsBlock } from './pageRefs';
import { renderSkillsCatalog } from './skillFormat';
import { listSkills } from './skillStore';

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
export function buildSystemPrompt(
  language: string | null = null,
  /** 用户自定义规则(启用中的规则常驻注入;四期规格 v1) */
  rules: UserRule[] = [],
  /** 用户自定义系统提示词(常驻注入,独立于规则;四期规格 v1) */
  customPrompt = '',
  /** 已安装技能(渐进披露第一层:catalog 只给名字与描述;正文由 read_skill 按需载入) */
  skills: Skill[] = [],
): string {
  const now = new Date();
  // 语言策略:未设置 = 跟随用户消息语言(原行为);设置 = 全局语言优先,用户消息明确指定时以用户为准
  const languageDirective = language
    ? `Always respond in ${language} unless the user explicitly requests a different language in their message.`
    : "Respond in the same language the user writes in.";
  const parts = [
    `You are an AI assistant living in the user's browser sidebar. ${languageDirective}`,
    // 不带时刻(精确时刻由 read_time 工具覆盖):system prompt 保持跨轮稳定,前缀缓存不失效
    `Today is ${weekdayName(now)}, ${localDate(now)} (${utcOffsetLabel(now)}).`,
  ];
  parts.push(
    '',
    'User messages may carry a <page-refs> block — the browser context referenced at send time:',
    '- tabs lists referenced tabs; tabId is the read handle; focused = the tab the user is currently viewing (ambient context, not the referent). The focused tab may or may not be relevant to the request — read or act on it only when the request relates to it.',
    "- <picked-element …> blocks in message text mark an element the user deliberately picked; their attributes (tabId/selector) are the handle — call read_element with them to read the element's content when your answer needs it. Full-page content is read via read_page.",
    '- Inline tokens like [url: example.com] are URLs the user pasted as references — self-describing; treat them as plain links, not element markers.',
    '- Tool results are live and win over the block metadata when they conflict.',
  );
  // 用户自定义内容注入:系统提示词框在前(定义角色与行为),规则列表在后(分段补充)
  const promptBlock = renderCustomPromptBlock(customPrompt);
  if (promptBlock) parts.push('', promptBlock);
  // 规则注入:常驻,超预算按序丢整条(与 docs/status-and-open-issues.md 的四期规格预算一致)
  const rulesBlock = renderRulesBlock(rules);
  if (rulesBlock) parts.push('', rulesBlock);
  // 技能 catalog:无技能时整层省略(零 token);正文不在提示词里,加载靠 read_skill
  const skillsCatalog = renderSkillsCatalog(skills);
  if (skillsCatalog) {
    parts.push(
      '',
      'Skills may be available to you. Each entry below carries only a name and a description:',
      skillsCatalog,
      'When a task matches a skill description, load its full instructions with read_skill before proceeding. Skills provide instructions only — any tool they ask you to use still requires the user\'s approval as usual.',
    );
  }
  return parts.join('\n');
}

/** 自定义系统提示词预算(字符,独立于规则预算) */
const CUSTOM_PROMPT_MAX = 4000;

/** 自定义系统提示词块渲染:非空才注入 */
function renderCustomPromptBlock(customPrompt: string): string | null {
  const text = customPrompt.trim();
  if (!text) return null;
  return [
    'The user has written a custom system prompt defining your role and behavior for every conversation. Follow it; it takes precedence over your default style but never overrides the user\'s current request:',
    text.slice(0, CUSTOM_PROMPT_MAX),
  ].join('\n');
}

/** 规则注入总预算(字符) */
const RULES_TOTAL_BUDGET = 6000;

/** 规则块渲染:启用中的规则逐条注入,超预算按序丢整条;无启用规则返回 null 不占位 */
function renderRulesBlock(rules: UserRule[]): string | null {
  const enabled = rules.filter((r) => r.enabled && r.content.trim());
  if (enabled.length === 0) return null;
  const header =
    'The user has defined personal rules that apply to every conversation. Follow them; they take precedence over your default style but never override the user\'s current request:';
  const lines: string[] = [];
  let used = header.length;
  for (const rule of enabled) {
    const item = `- ${rule.name}: ${rule.content}`;
    if (used + item.length > RULES_TOTAL_BUDGET) break;
    lines.push(item);
    used += item.length;
  }
  return lines.length > 0 ? [header, ...lines].join('\n') : null;
}

export interface RunAgentOptions {
  provider: ProviderConfig;
  modelId: string;
  /** 本轮之前的会话历史(不含本轮用户消息);user 消息 content 可含 <page-refs> 块,参与工具白名单聚合 */
  /** 覆盖转录(可选):提供=覆盖 Agent 现有转录(首次初始化/编辑重发截断/恢复导入);省略=用 Agent 自持转录 */
  history?: ChatMessage[];
  /** 压缩元数据:非破坏裁剪请求面(transformContext),不改转录(可选) */
  compaction?: SessionCompaction;
  /** 本轮用户消息(content 已内嵌 <page-refs> 块);与历史同形状,无任何自定义字段 */
  /** 本轮 user 消息(runAgentTurn 必填;continueAgentTurn 不用) */
  userMessage?: UserMessage;
  /** 当前草稿中被引用的标签页(App 侧已按会话级引用开关过滤,见 SessionDraft.pageContextEnabled) */
  refTabs?: RefTab[];
  /** 当前草稿中用户框选的页面元素(App 侧已按会话级引用开关过滤) */
  pickedElements?: PickedElement[];
  thinkingLevel: ReasoningLevel;
  /** AI 生成内容语言(已解析英文名);null = 跟随用户消息语言 */
  language?: string | null;
  /** 用户自定义规则(启用中的常驻注入 system prompt;四期规格 v1) */
  rules?: UserRule[];
  /** 用户自定义系统提示词(常驻注入;四期规格 v1) */
  systemPrompt?: string;
  /** 已安装技能(调用方提供则直接用;省略时由 runTurnCore 每轮从存储读一次) */
  skills?: Skill[];
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
/** 会话 Agent 注册表(pi 设计:每会话一个 Agent 实例,持有转录与运行状态)。
 * 阶段①:每轮仍以调用方传入的 history 覆盖转录(与重建 Agent 等价,行为零变化);
 * 阶段②将改为 Agent 自持转录,调用方不再传 history。
 */
/** 会话 Agent 注册项:实例 + 连接代次(恢复/替换后旧实例的迟到事件必须丢弃) */
interface SessionAgentEntry {
  agent: Agent;
  epoch: number;
}

const sessionAgents = new Map<string, SessionAgentEntry>();
let agentEpoch = 0;

/**
 * Agent 生命周期事件出口(依赖注入):entrypoints 层注入后,每个会话 Agent 在创建时
 * 常驻订阅一次,把事件路由到该会话的运行时/UI(pi 的 AgentSession 同款做法)。
 */
export type AgentEventSink = (sessionId: string, event: AgentEvent) => void;
let agentEventSink: AgentEventSink | null = null;

export function setAgentEventSink(sink: AgentEventSink | null): void {
  agentEventSink = sink;
}

/**
 * 测试注入缝:让集成测试用 pi-ai 的 faux provider 驱动真实 Agent
 * (无需网络/真实 provider)。生产路径不设置时行为不变。
 */
export interface AgentTestOverrides {
  /** 覆盖模型解析(测试用 faux 模型) */
  resolveModel?: (options: RunAgentOptions) => Model<Api> | undefined;
  /** 覆盖 streamFn(测试用 faux streamSimple) */
  streamFn?: StreamFn;
  /** 覆盖工具集(测试环境无 WXT 虚拟模块 i18n,跳过 getTools) */
  tools?: AgentTool[];
  /** 每轮工具构建钩子(测试用:观察 prepareNextTurn 看到的转录) */
  buildTools?: (transcript: ChatMessage[]) => AgentTool[];
}

let agentOverrides: AgentTestOverrides | null = null;

export function setAgentOverrides(overrides: AgentTestOverrides | null): void {
  agentOverrides = overrides;
}

/** 构造每轮可变的 Agent 输入(provider/模型/工具白名单/系统提示词;并发 run 各自独立) */
function buildAgentInputs(options: RunAgentOptions, transcript: ChatMessage[]): {
  models: ReturnType<typeof createModels>;
  model: NonNullable<ReturnType<ReturnType<typeof createModels>['getModel']>>;
  tools: ReturnType<typeof getTools>;
  systemPrompt: string;
} {

  const models = createModels();
  models.setProvider(buildProvider(options.provider));
  const model = agentOverrides?.resolveModel?.(options) ?? models.getModel(options.provider.id, options.modelId);
  if (!model) throw new Error(i18n.t('errors.modelMissing', { model: options.modelId }));

  // 工具白名单 = 当前草稿引用 ∪ 历史 <page-refs> 块引用。
  // 后者保证「追问旧页面」时(草稿已清空)工具句柄仍在,LLM 能读此前引用的标签页/元素。
  const currentTabs = options.refTabs ?? [];
  const currentElements = options.pickedElements ?? [];
  const historical = collectPageRefs(transcript);

  const tabById = new Map<number, RefTab>();
  for (const t of historical.tabs) {
    tabById.set(t.tabId, { id: t.tabId, title: t.title, url: t.url });
  }
  // 当前草稿优先(实时 title/url 覆盖历史块元数据)
  for (const t of currentTabs) {
    tabById.set(t.id, t);
  }
  // agent 本回合开启的 tab(决策 27):运行时注册表并入白名单(元数据空,read_page 现场取)
  for (const id of getAgentOpenedTabs()) {
    if (!tabById.has(id)) tabById.set(id, { id, title: '', url: '' });
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
  const tools =
    agentOverrides?.buildTools?.(transcript) ??
    agentOverrides?.tools ??
    getTools({
      refTabs,
      pickedElements,
      canUseImage: model.input.includes('image'),
      onCompactContext: options.onCompactContext,
      webSearch: options.webSearch ?? null,
      // agent 本回合开启的 tab(动态注册表,面板生命周期):读工具 execute 时实时查询
      dynamicTabs: getAgentOpenedTabs(),
      // 门控归属会话(并发 run 各自独立,确认卡/提问按会话路由)
      sessionId: options.sessionId,
      // 技能:本轮快照(catalog 注入与 read_skill 同一份;无技能时 read_skill 不占工具面)
      skills: options.skills ?? [],
    });

  const systemPrompt = buildSystemPrompt(
    options.language ?? null,
    options.rules ?? [],
    options.systemPrompt ?? '',
    options.skills ?? [],
  );
  return { models, model, tools, systemPrompt };
}

/** 会话是否已有自持 Agent 实例(调用方据此决定是否传 history 初始化) */
export function hasSessionAgent(sessionId: string): boolean {
  return sessionAgents.has(sessionId);
}

/** 只读读取会话 Agent(不创建;诊断与集成测试用) */
export function sessionAgentFor(sessionId: string): Agent | undefined {
  return sessionAgents.get(sessionId)?.agent;
}

/**
 * 获取或创建会话 Agent(pi 设计:每会话一个实例,**自持转录**)。
 * - 转录真源 = agent.state.messages(原始格式,含 refs 块;请求经 convertToLlm 展开);
 * - 复用轮刷新每轮可变配置(provider/工具/系统提示词/模型/思考档/压缩裁剪);
 * - options.history 提供时覆盖转录(首次初始化/编辑重发截断/恢复导入)。
 */
function ensureSessionAgent(options: RunAgentOptions): Agent {
  const sid = options.sessionId;
  const existing = sid ? sessionAgents.get(sid) : undefined;
  // 白名单/初始化的转录来源:显式覆盖 > Agent 自持
  const transcript = (options.history ?? existing?.agent.state.messages ?? []) as ChatMessage[];
  const { models, model, tools, systemPrompt } = buildAgentInputs(options, transcript);
  const streamFn =
    agentOverrides?.streamFn ??
    ((
      m: Parameters<typeof models.streamSimple>[0],
      ctx: Parameters<typeof models.streamSimple>[1],
      o: Parameters<typeof models.streamSimple>[2],
    ) => models.streamSimple(m, ctx, o));
  // 压缩裁剪(非破坏):请求面 = [摘要]+之后,转录本体不变
  const transformContext = options.compaction
    ? async (msgs: Parameters<NonNullable<Agent['transformContext']>>[0]) =>
        effectiveMessages(msgs as ChatMessage[], options.compaction) as AgentMessage[]
    : undefined;
  const convertToLlm = (msgs: Parameters<NonNullable<Agent['convertToLlm']>>[0]) =>
    msgs.map((m) => toLlmMessage(m as ChatMessage));
  // 每轮请求前刷新上下文:工具白名单用**最新转录**重算——run 内消费的 followUp/steer
  // 携带的新 refs 也能进白名单(否则 read_page/read_element 会拒)。
  // messages 传副本:loop 会向该数组 push 注入消息,不能与 Agent 内部转录共用引用。
  const makePrepareNextTurn = (target: Agent) => async (): Promise<{
    context: { systemPrompt: string; messages: ChatMessage[]; tools: AgentTool[] };
  }> => {
    const latestTranscript = [...(target.state.messages as ChatMessage[])];
    const rebuilt = buildAgentInputs(options, latestTranscript);
    return {
      context: {
        systemPrompt: target.state.systemPrompt,
        messages: latestTranscript,
        tools: rebuilt.tools,
      },
    };
  };

  if (existing) {
    const agent = existing.agent;
    // 修改配置前必须确认 idle:活动 run 期间改写 model/tools/transcript 会污染在途请求
    if (agent.state.isStreaming) {
      throw new Error(`session ${sid} agent is streaming; refuse to mutate its configuration`);
    }
    agent.streamFunction = streamFn;
    agent.transformContext = transformContext;
    agent.prepareNextTurn = makePrepareNextTurn(agent);
    agent.state.tools = tools;
    agent.state.systemPrompt = systemPrompt;
    agent.state.model = model;
    agent.state.thinkingLevel = options.thinkingLevel;
    // 显式覆盖转录(编辑重发截断 / 恢复导入后重同步)
    if (options.history) agent.state.messages = options.history;
    return agent;
  }
  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: options.thinkingLevel,
      tools,
      // 原始转录(含 refs 块);请求时经 convertToLlm 展开元素
      messages: transcript,
    },
    streamFn,
    convertToLlm,
    transformContext,
    // 队列语义显式声明(不依赖上游默认):一次消费一条,保持 FIFO 与 UI 镜像一致
    followUpMode: 'one-at-a-time',
    steeringMode: 'one-at-a-time',
    sessionId: sid,
    toolExecution: 'sequential',
  });
  agent.prepareNextTurn = makePrepareNextTurn(agent);
  if (sid) {
    const entry: SessionAgentEntry = { agent, epoch: ++agentEpoch };
    sessionAgents.set(sid, entry);
    // 常驻订阅(构造时一次):事件路由到该会话 runtime——队列自动消费/外部触发的
    // run 同样能驱动 UI(与 pi 的 AgentSession._handleAgentEvent 同构)。
    // epoch 校验:实例被替换/释放后,旧实例的迟到事件直接丢弃。
    agent.subscribe((event) => {
      if (sessionAgents.get(sid) !== entry) return;
      try {
        agentEventSink?.(sid, event);
      } catch (err: unknown) {
        // 投影层出错绝不能回流进 Agent 循环:那样整轮(含已完成的回复)会被上层 catch 丢弃,
        // 用户看到的就是“AI 说着说着,这一阶段的回复全没了”。视图少更新一次是小事,丢内容不是。
        console.error('[agent] event sink failed:', event?.type, err);
      }
    });
  }
  return agent;
}

/** 会话删除/数据替换时释放 Agent 实例:先失效(epoch 校验丢弃迟到事件)再中止 */
export function disposeSessionAgent(sessionId: string): void {
  const entry = sessionAgents.get(sessionId);
  if (!entry) return;
  sessionAgents.delete(sessionId);
  entry.agent.abort();
}

/** 全量释放(恢复/导入替换全部会话数据时调用,防陈旧转录残留) */
export function disposeAllSessionAgents(): void {
  const entries = [...sessionAgents.values()];
  sessionAgents.clear();
  for (const entry of entries) entry.agent.abort();
}

/**
 * runAgentTurn 与 continueAgentTurn 的共享内核:常驻订阅已在外,这里只做本轮订阅(捕获 newMessages)、
 * 启动(kickoff)、队列泵与结果汇总。
 */
async function runTurnCore(
  options: RunAgentOptions,
  kickoff: (agent: Agent) => Promise<void>,
): Promise<RunAgentResult> {
  // 技能目录每轮读一次(存储往返便宜,且 round 中途新增的技能下一轮自然生效);
  // 显式传入时以调用方为准(测试与嵌入场景)
  const skills = options.skills ?? (await listSkills());
  const agent = ensureSessionAgent({ ...options, skills });

  let newMessages: ChatMessage[] = [];
  const unsubscribe = agent.subscribe((event) => {
    if (event.type === 'agent_end') {
      // 累加而非覆盖:continue 泵会触发多次 agent_end,覆盖语义会丢掉首轮消息
      newMessages = [...newMessages, ...(event.messages as ChatMessage[])];
    }
    try {
      options.onEvent?.(event);
    } catch (err: unknown) {
      // 与常驻 sink 同源的风险:订阅者抛异常在生命周期事件上会逃出 agent loop(emit 不吞异常),
      // 旧代码会因此丢弃整轮。调用方回调出错不该是对话的代价。
      console.error('[agent] onEvent failed:', event?.type, err);
    }
  });

  const signal = options.signal;
  const onAbort = () => agent.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    await kickoff(agent);
    // 泵:run 结束后仍有排队消息时用 continue() 消费。
    // followUp 只在“agent 本要停止”点被轮询(agent-loop.js:161),
    // run 结束后(包括 agent_end 时刻)入队的消息会滞留;与上游
    // AgentSession._runAgentPrompt 的 `while (await postRun()) await agent.continue()` 同构。
    while (!signal?.aborted && agent.hasQueuedMessages()) {
      await agent.continue();
    }
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
      ? lastAssistant.errorMessage || i18n.t('errors.requestFailed')
      : undefined;

  return { messages, newMessages, errorMessage };
}

/**
 * 基于 pi-agent-core 的 Agent 跑一轮对话(可能包含多轮工具调用循环)。
 * 失败经 Agent 协议事件编码(stopReason='error'),取消经 signal 注入;
 * 中止时已生成的部分保留在转录中。
 */
export async function runAgentTurn(options: RunAgentOptions): Promise<RunAgentResult> {
  if (!options.userMessage) throw new Error('runAgentTurn requires userMessage');
  return runTurnCore(options, (agent) => agent.prompt(options.userMessage as UserMessage));
}

/**
 * 继续当前转录(不追加新 user 消息):用于空闲窗口消费原生队列。
 * `Agent.continue()` 在末尾为 assistant 且队列非空时会 drain 队列并启动新 run
 * (agent.js:242-252),否则从末尾 user/toolResult 继续。
 */
export async function continueAgentTurn(options: RunAgentOptions): Promise<RunAgentResult> {
  return runTurnCore(options, (agent) => agent.continue());
}
