import { storage } from 'wxt/utils/storage';
import type { AssistantMessage, ToolResultMessage, UserMessage } from '@earendil-works/pi-ai';
import type { RefTab } from './pageContext';
import type {
  AuxThinkingLevel,
  ChatMessage,
  PageRefs,
  PickedElement,
  Session,
  SessionCompaction,
  SessionDraft,
  Settings,
  UserRule,
} from './types';
import { REASONING_LEVELS, AUX_THINKING_LEVELS } from './types';
import { DEFAULT_SETTINGS } from './providers';
import { renderPageRefsBlock, stripPageRefs } from './pageRefs';

export const settingsItem = storage.defineItem<Settings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
});

export const activeSessionIdItem = storage.defineItem<string | null>(
  'local:activeSessionId',
  { fallback: null },
);

/** 兼容旧版 settings 结构(旧字段直接丢弃,回退默认值) */
const WEB_SEARCH_PROVIDERS = [
  'none',
  'duckduckgo',
  'searxng',
  'brave',
  'tavily',
  'bocha',
  'serper',
  'exa',
  'zhipu',
  'bing',
  'metaso',
] as const;

const KEY_BASED_WEB_SEARCH_PROVIDERS = [
  'brave',
  'tavily',
  'bocha',
  'serper',
  'exa',
  'zhipu',
  'metaso',
] as const;

/** WebDAV 同步配置清洗(v1 手动推拉;凭证/加密密码存本地,与 API Key 同信任域) */
function sanitizeWebdav(value: unknown): Settings['webdav'] {
  const fallback = DEFAULT_SETTINGS.webdav;
  if (!value || typeof value !== 'object') return fallback;
  const v = value as Record<string, unknown>;
  const str = (x: unknown, fb: string) => (typeof x === 'string' ? x : fb);
  return {
    url: str(v.url, ''),
    username: str(v.username, ''),
    password: str(v.password, ''),
    remotePath: str(v.remotePath, fallback.remotePath) || fallback.remotePath,
    encrypt: v.encrypt === true,
    encryptPassword: str(v.encryptPassword, ''),
  };
}

function sanitizeWebSearch(value: unknown): Settings['webSearch'] {
  const raw = (value ?? {}) as Partial<Settings['webSearch']>;
  const provider = WEB_SEARCH_PROVIDERS.includes(raw.provider as never)
    ? (raw.provider as Settings['webSearch']['provider'])
    : 'none';
  const apiKeys: Settings['webSearch']['apiKeys'] = {};
  if (raw.apiKeys && typeof raw.apiKeys === 'object') {
    const rawKeys = raw.apiKeys as Record<string, unknown>;
    for (const key of KEY_BASED_WEB_SEARCH_PROVIDERS) {
      if (typeof rawKeys[key] === 'string') {
        apiKeys[key] = rawKeys[key];
      }
    }
  }
  return {
    provider,
    searxngBaseUrl: typeof raw.searxngBaseUrl === 'string' ? raw.searxngBaseUrl : '',
    apiKeys,
  };
}

/** 字段预算(与 HANDOFF 四期规格一致) */
const SYSTEM_PROMPT_MAX = 4000;
const RULE_NAME_MAX = 100;
const RULE_CONTENT_MAX = 4000;
const RULE_COUNT_MAX = 20;

/** 用户规则数组清洗:逐条字段校验+截断,条数超限截断,非数组/非法条目丢弃 */
function sanitizeRules(value: unknown): UserRule[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      id: typeof r.id === 'string' && r.id ? r.id : '',
      name: typeof r.name === 'string' ? r.name.trim().slice(0, RULE_NAME_MAX) : '',
      content: typeof r.content === 'string' ? r.content.trim().slice(0, RULE_CONTENT_MAX) : '',
      enabled: r.enabled === true,
    }))
    .filter((r) => r.id && r.name && r.content)
    .slice(0, RULE_COUNT_MAX);
}

/** 辅助模型引用形状校验(引用失效不做深度校验,调用侧回退对话模型) */
function sanitizeAuxModelRef(v: unknown): Settings['titleModel'] {
  if (!v || typeof v !== 'object') return null;
  const r = v as { providerId?: unknown; modelId?: unknown };
  return typeof r.providerId === 'string' && typeof r.modelId === 'string'
    ? { providerId: r.providerId, modelId: r.modelId }
    : null;
}

/** 辅助任务思考等级:off = 不发 reasoning 参数(pi-ai 语义 = 关闭/模型默认) */
function sanitizeAuxThinking(v: unknown, fallback: AuxThinkingLevel): AuxThinkingLevel {
  return AUX_THINKING_LEVELS.includes(v as never) ? (v as AuxThinkingLevel) : fallback;
}

export function sanitizeSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object') return DEFAULT_SETTINGS;
  const v = value as Partial<Settings>;
  return {
    providers: Array.isArray(v.providers) ? v.providers : [],
    activeProviderId: typeof v.activeProviderId === 'string' ? v.activeProviderId : null,
    activeModelId: typeof v.activeModelId === 'string' ? v.activeModelId : null,
    titleModel: sanitizeAuxModelRef(v.titleModel),
    quickPromptModel: sanitizeAuxModelRef(v.quickPromptModel),
    language: typeof v.language === 'string' && v.language ? v.language : null,
    systemPrompt: typeof v.systemPrompt === 'string' ? v.systemPrompt.trim().slice(0, SYSTEM_PROMPT_MAX) : '',
    rules: sanitizeRules(v.rules),
    titleThinking: sanitizeAuxThinking(v.titleThinking, 'off'),
    quickPromptThinking: sanitizeAuxThinking(v.quickPromptThinking, 'off'),
    includePageContext: v.includePageContext === true,
    reasoningLevel: REASONING_LEVELS.includes(v.reasoningLevel as never)
      ? (v.reasoningLevel as Settings['reasoningLevel'])
      : 'off',
    webSearch: sanitizeWebSearch(v.webSearch),
    webdav: sanitizeWebdav(v.webdav),
  };
}

/** 全零用量(旧数据迁移/UI 占位用) */
export const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/**
 * 消息防御清洗:非法形状丢弃,合法 pi 形状**原样透传**(assistant 的 thinking 块/toolCall/usage、
 * toolResult 的 toolCallId/content 数组等,重建会打平丢失 —— 回放正确性的关键)。
 */
function sanitizeMessage(v: unknown): ChatMessage | null {
  if (!v || typeof v !== 'object') return null;
  const m = v as Record<string, unknown>;
  const ts =
    typeof m.timestamp === 'number' ? m.timestamp : Date.now();
  if (m.role === 'user') {
    return {
      role: 'user',
      content: typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? (m.content as UserMessage['content']) : '',
      timestamp: ts,
    };
  }
  if (m.role === 'assistant') {
    // pi 原生形状(content 为块数组)原样透传,保留 thinking/toolCall/usage/model 等
    if (Array.isArray(m.content)) return m as unknown as AssistantMessage;
    const msg: AssistantMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: typeof m.content === 'string' ? m.content : '' }],
      api: 'openai-completions',
      provider: '',
      model: '',
      stopReason: 'stop',
      usage: EMPTY_USAGE,
      timestamp: ts,
    };
    return msg;
  }
  if (m.role === 'toolResult') {
    // pi 原生形状透传(旧扁平格式不存在 toolResult,形状不符直接丢弃)
    if (
      Array.isArray(m.content) &&
      typeof m.toolCallId === 'string' &&
      typeof m.toolName === 'string'
    ) {
      return m as unknown as ToolResultMessage;
    }
    return null;
  }
  return null;
}

/** 草稿宽松校验:结构不符/缺省返回 undefined(旧数据无 draft 字段,不炸) */
function sanitizeDraft(v: unknown): SessionDraft | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const d = v as Record<string, unknown>;
  const refTabs = Array.isArray(d.refTabs)
    ? d.refTabs.flatMap((t): RefTab[] => {
        if (!t || typeof t !== 'object') return [];
        const x = t as Record<string, unknown>;
        if (typeof x.id !== 'number') return [];
        return [{ id: x.id, title: typeof x.title === 'string' ? x.title : '', url: typeof x.url === 'string' ? x.url : '' }];
      })
    : [];
  const pickedElements = Array.isArray(d.pickedElements)
    ? d.pickedElements.flatMap((p): PickedElement[] => {
        if (!p || typeof p !== 'object') return [];
        const x = p as Record<string, unknown>;
        if (typeof x.selector !== 'string' || typeof x.tabId !== 'number') return [];
        if (
          typeof x.elementId !== 'number' ||
          !Number.isInteger(x.elementId) ||
          x.elementId <= 0
        ) {
          return []; // 旧格式元素(无 elementId)直接丢弃
        }
        return [{
          id: typeof x.id === 'string' ? x.id : `${x.tabId}:${x.selector}`,
          elementId: x.elementId,
          tabId: x.tabId,
          selector: x.selector,
          tagName: typeof x.tagName === 'string' ? x.tagName : '',
          preview: typeof x.preview === 'string' ? x.preview : '',
        }];
      })
    : [];
  return { input: typeof d.input === 'string' ? d.input : '', refTabs, pickedElements };
}

/**
 * 压缩标记宽松校验:未知字段宽容(原样丢弃),缺字段补默认(0)。
 * summaryTimestamp 缺失时标记仍保留 —— effectiveMessages 定位失败会回退原消息数组,不炸。
 */
function sanitizeCompaction(v: unknown): SessionCompaction | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const c = v as Record<string, unknown>;
  return {
    summaryTimestamp: typeof c.summaryTimestamp === 'number' && Number.isFinite(c.summaryTimestamp) ? c.summaryTimestamp : 0,
    tokensBefore: typeof c.tokensBefore === 'number' && Number.isFinite(c.tokensBefore) ? c.tokensBefore : 0,
    compactedAt: typeof c.compactedAt === 'number' && Number.isFinite(c.compactedAt) ? c.compactedAt : 0,
  };
}

export function sanitizeSessions(value: unknown): Session[] {
  if (!Array.isArray(value)) return [];
  const out: Session[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    if (typeof s.id !== 'string') continue;
    const messages = Array.isArray(s.messages)
      ? s.messages.map(sanitizeMessage).filter((m): m is ChatMessage => m !== null)
      : [];
    const draft = sanitizeDraft(s.draft);
    const compaction = sanitizeCompaction(s.compaction);
    const customTitle = s.customTitle === true;
    out.push({
      id: s.id,
      title: typeof s.title === 'string' ? s.title : '新会话',
      messages,
      createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
      updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : Date.now(),
      ...(customTitle ? { customTitle: true } : {}),
      ...(draft ? { draft } : {}),
      ...(compaction ? { compaction } : {}),
    });
  }
  return out;
}

export function uid(): string {
  return crypto.randomUUID();
}

export function createSession(title = '新会话', draft?: SessionDraft): Session {
  const now = Date.now();
  return { id: uid(), title, messages: [], createdAt: now, updatedAt: now, ...(draft ? { draft } : {}) };
}

/**
 * 唯一序列化点:引用以 <page-refs> 块内嵌进 content 字符串(无引用则消息与朴素文本逐字节一致)。
 * content 一旦生成就永不改变,LLM 与 UI 是同一份字符串的两个消费者。
 */
export function createUserMessage(text: string, refs?: PageRefs): UserMessage {
  const hasRefs = !!refs && (refs.tabs.length > 0 || refs.elements.length > 0);
  return {
    role: 'user',
    content: hasRefs ? text + renderPageRefsBlock(refs!) : text,
    timestamp: Date.now(),
  };
}

/** 提取消息的纯文本(标题生成/UI 兜底渲染用),不包含 thinking 与 toolCall 块;user 消息剥离 <page-refs> 块 */
export function messageText(m: ChatMessage): string {
  const join = (blocks: Array<{ type: string; text?: string }>) =>
    blocks
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
  if (m.role === 'user') {
    return stripPageRefs(typeof m.content === 'string' ? m.content : join(m.content));
  }
  return join(m.content);
}

/** 用首条用户消息生成会话标题(截断到 24 字符) */
export function titleFromText(text: string): string {
  const first = text.trim().split('\n')[0]?.trim() ?? '';
  return first.length > 24 ? `${first.slice(0, 24)}…` : first || '新会话';
}
