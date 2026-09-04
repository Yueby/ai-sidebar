import type { AssistantMessage, ToolResultMessage, UserMessage } from '@earendil-works/pi-ai';
import type { RefTab } from './pageContext';

/** 接口协议类型,与 pi-ai 的 KnownApi 对齐 */
export type ApiType = 'openai-completions' | 'openai-responses' | 'anthropic-messages';

export interface ModelConfig {
  id: string;
  displayName?: string;
  contextWindow?: number;
  maxTokens?: number;
  /** 信息位:是否支持工具调用(pi-ai 要求模型支持工具,此字段供筛选/展示) */
  tools?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  /** 该模型支持的思考等级(不含 off;空/缺省回退默认三档 low/medium/high) */
  reasoningLevels?: ReasoningLevel[];
  /** 参数由 models.dev 自动预填过 */
  prefilled?: boolean;
}

export interface ProviderConfig {
  id: string;
  name: string;
  api: ApiType;
  baseUrl: string;
  apiKey: string;
  models: ModelConfig[];
}

/** 思考等级,与 pi-ai/pi-agent-core 的 ThinkingLevel 对齐(额外含 off) */
export type ReasoningLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const REASONING_LEVELS: ReasoningLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

/** 思考等级展示文案(short=按钮/紧凑位,full=下拉/完整位),UI 统一消费此处 */
export const REASONING_LEVEL_LABELS: Record<ReasoningLevel, { short: string; full: string }> = {
  off: { short: '关', full: '关闭' },
  minimal: { short: '极低', full: '极低 (minimal)' },
  low: { short: '低', full: '低 (low)' },
  medium: { short: '中', full: '中 (medium)' },
  high: { short: '高', full: '高 (high)' },
  xhigh: { short: '超高', full: '超高 (xhigh)' },
  max: { short: '最大', full: '最大 (max)' },
};

/**
 * Agent 工具展示文案的**唯一来源**(AgentTool.label / 流式执行 chip / 历史 toolCall chip 全部消费此处)。
 * 暂时统一中文;多语言以后再做。
 */
export const TOOL_LABELS: Record<string, string> = {
  read_page: '读取网页内容',
  // 旧名,兼容历史会话 ToolCallCard(旧持久化消息 toolCall.name 仍是 extract_page)
  extract_page: '读取网页内容',
  read_element: '读取页面元素',
  fetch_url: '抓取网页内容',
  read_time: '读取设备时间',
  ask_user: '询问用户',
  execute_js: '执行页面脚本',
  compact_context: '压缩上下文',
  search_web: '网络搜索',
  search_page: '查找标签页',
  open_page: '打开网页',
  activate_page: '切到标签页',
  close_page: '关闭标签页',
  search_element: '查找交互元素',
  click_element: '点击页面元素',
  fill_element: '填写页面元素',
  scroll_page: '滚动页面',
  screenshot_page: '截取页面画面',
};

/** 取工具展示文案:未知工具名原样返回 */
export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

/** Agent 工具风险元数据:safe=直接执行;confirm=执行前需经 lib/gate.ts 发 UI 确认(如 execute_js) */
export type ToolRisk = 'safe' | 'confirm';

/** 网络搜索源:none=未启用;duckduckgo/searxng 免费;brave/tavily 需 API Key */
export type WebSearchProvider =
  | 'none'
  | 'duckduckgo'
  | 'searxng'
  | 'brave'
  | 'tavily'
  | 'bocha'
  | 'serper'
  | 'exa'
  | 'zhipu'
  | 'bing'
  | 'metaso';

export interface WebSearchConfig {
  provider: WebSearchProvider;
  /** searxng 必填:实例 base_url(如 https://searx.example.org) */
  searxngBaseUrl: string;
  /** API Key 型搜索源独立 Key(敏感,与提供商 API Key 同级保管,不打印不上报) */
  apiKeys: Partial<
    Record<'brave' | 'tavily' | 'bocha' | 'serper' | 'exa' | 'zhipu' | 'metaso', string>
  >;
}

/** 辅助功能模型引用(标题/快捷指令生成);null = 跟随对话模型 */
export interface AuxModelRef {
  providerId: string;
  modelId: string;
}

export interface Settings {
  providers: ProviderConfig[];
  activeProviderId: string | null;
  activeModelId: string | null;
  /** 会话标题生成模型;null = 跟随对话模型 */
  titleModel: AuxModelRef | null;
  /** 新会话推荐快捷指令生成模型;null = 跟随对话模型 */
  quickPromptModel: AuxModelRef | null;
  /** 发送时启用页面上下文(引用当前标签页,AI 经 read_page 工具按需读取正文) */
  includePageContext: boolean;
  /** 思考等级,仅当激活模型 reasoning=true 时生效 */
  reasoningLevel: ReasoningLevel;
  /** 网络搜索源配置(provider 非 none 且字段齐备时才注册 search_web 工具) */
  webSearch: WebSearchConfig;
}

/**
 * user 消息 content 内嵌的 <page-refs> 块的结构(发送瞬间序列化为 JSON,此后永不改变):
 * 一份数据两个消费者 —— LLM 直接读 content 里的块,UI 从同一 content 解析渲染。
 */
export interface RefTabMeta {
  tabId: number;
  title: string;
  url: string;
  /** 发送时刻活动且在引用列表内的标签页(仅 true 时序列化进块) */
  focused?: boolean;
}

export interface RefElementMeta {
  /** 元素标记号(1 起整数,按消息内框选顺序;与文本内嵌 [element:N] 标记的 N 一致;旧消息由解析端按数组序补齐) */
  id: number;
  tabId: number;
  selector: string;
  tagName: string;
  preview: string;
}

export interface PageRefs {
  tabs: RefTabMeta[];
  elements: RefElementMeta[];
}

/**
 * 会话消息 = pi-ai 消息联合,直接按 pi 形状持久化。
 * 好处:agent 回放零转换;assistant 消息自带 thinking 块/toolCall/usage。
 * 旧版 {id, role:'user'|'assistant', content, createdAt} 结构由 storage.sanitizeMessage 迁移;
 * 引用信息不是自定义字段,而是序列化为 user 消息 content 内的 <page-refs> 块(lib/pageRefs.ts)。
 */
export type ChatMessage = UserMessage | AssistantMessage | ToolResultMessage;
export type { AssistantMessage, ToolResultMessage, UserMessage };

/** 每会话 composer 草稿(输入文本 + 引用标签页 + 框选元素),随会话持久化到 IndexedDB */
export interface SessionDraft {
  input: string;
  refTabs: RefTab[];
  pickedElements: PickedElement[];
}

/**
 * 会话压缩标记:压缩发生一次记一条。
 * 摘要内容不存此处 —— 写入 summaryTimestamp 对应的那条 user 消息 content
 * (含 <context-summary> 块 + 被压缩范围 page-refs 并集块,拼装在调用方),
 * effectiveMessages 据此 timestamp 定位摘要并截断其前历史。
 */
export interface SessionCompaction {
  /** 摘要所在 user 消息的 timestamp(定位键) */
  summaryTimestamp: number;
  /** 压缩前的上下文 token 估算 */
  tokensBefore: number;
  /** 压缩执行时刻 */
  compactedAt: number;
}

export interface Session {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  /** 是否为用户手动重命名(为 true 时后续静默 AI 自动命名绝不覆盖) */
  customTitle?: boolean;
  /** 会话草稿;旧数据缺省 undefined,由 UI 视为空草稿 */
  draft?: SessionDraft;
  /** 上下文压缩标记;旧数据缺省 undefined */
  compaction?: SessionCompaction;
}

/** content.ts 页面提取应答 */
export interface PageContext {
  title: string;
  url: string;
  text: string;
}

/** 用户在页面上框选的元素引用(selector 由 @medv/finder 生成,保证唯一) */
export interface PickedElement {
  id: string;
  /** 元素标记号(1 起单调递增,随草稿持久化,页面刷新后继续递增;与文本内嵌 <picked-element> 块的 elementId 一致) */
  elementId: number;
  tabId: number;
  selector: string;
  tagName: string;
  /** 元素可见文本预览(截 100 字) */
  preview: string;
}

/** 消息协议常量单一来源(与 entrypoints/content.ts 对应,content.ts 只 import 纯常量) */
/** 页面正文提取应答 */
export const READ_PAGE_MESSAGE = 'ai-sidebar/read-page' as const;
/** 元素选择消息协议:action 'start' 进入选择模式,'resolve' 按 selector 读取元素 */
export const PICK_ELEMENT_MESSAGE = 'ai-sidebar/pick-element' as const;
/** content script 框选完成后的结果广播(经 runtime.sendMessage 发给 sidepanel) */
export const PICK_ELEMENT_RESULT_MESSAGE = 'ai-sidebar/pick-element-result' as const;
/** 交互元素清单应答(search_element 发现层,content 侧用 dom-accessibility-api 计算) */
export const SEARCH_ELEMENT_MESSAGE = 'ai-sidebar/search-element' as const;
/** 页面动作消息协议:action 'resolve' 解析 locator,'click'/'fill'/'scroll' 执行动作(三期步②) */
export const PAGE_ACTION_MESSAGE = 'ai-sidebar/page-action' as const;
/** 交互元素清单输出上限(全量计数后截断;content.ts 与 search_element 工具共用,单一来源) */
export const SEARCH_ELEMENT_LIMIT = 80;
