import { storage } from 'wxt/utils/storage';
import type { AssistantMessage, ToolResultMessage, UserMessage } from '@earendil-works/pi-ai';
import type { RefTab } from './pageContext';
import type {
  ChatMessage,
  PageRefs,
  PickedElement,
  Session,
  SessionCompaction,
  SessionDraft,
  Settings,
} from './types';
import { REASONING_LEVELS } from './types';
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

function sanitizeWebSearch(value: unknown): Settings['webSearch'] {
  const raw = (value ?? {}) as Partial<Settings['webSearch']>;
  const provider = WEB_SEARCH_PROVIDERS.includes(raw.provider as never)
    ? (raw.provider as Settings['webSearch']['provider'])
    : 'none';
  return {
    provider,
    searxngBaseUrl: typeof raw.searxngBaseUrl === 'string' ? raw.searxngBaseUrl : '',
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
  };
}

export function sanitizeSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object') return DEFAULT_SETTINGS;
  const v = value as Partial<Settings>;
  return {
    providers: Array.isArray(v.providers) ? v.providers : [],
    activeProviderId: typeof v.activeProviderId === 'string' ? v.activeProviderId : null,
    activeModelId: typeof v.activeModelId === 'string' ? v.activeModelId : null,
    includePageContext: v.includePageContext === true,
    reasoningLevel: REASONING_LEVELS.includes(v.reasoningLevel as never)
      ? (v.reasoningLevel as Settings['reasoningLevel'])
      : 'off',
    webSearch: sanitizeWebSearch(v.webSearch),
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
 * 旧中间格式(自定义字段 refSnapshot:{tabs:[{title,url}],elements:[{preview,tagName,selector?}]})
 * → <page-refs> 块的 PageRefs 结构。旧字段不携带 tabId/元素 selector 归属,
 * 句柄以 0 占位(工具侧读取自然失败,不崩渲染)。
 */
function legacyRefSnapshotToPageRefs(v: unknown): PageRefs | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  const tabs = Array.isArray(s.tabs)
    ? s.tabs.flatMap((t): PageRefs['tabs'][number][] => {
        if (!t || typeof t !== 'object') return [];
        const x = t as Record<string, unknown>;
        return [{
          tabId: 0,
          title: typeof x.title === 'string' ? x.title : '',
          url: typeof x.url === 'string' ? x.url : '',
        }];
      })
    : [];
  const elements = Array.isArray(s.elements)
    ? s.elements.flatMap((e): PageRefs['elements'][number][] => {
        if (!e || typeof e !== 'object') return [];
        const x = e as Record<string, unknown>;
        return [{
          id: typeof x.id === 'number' && Number.isInteger(x.id) && x.id > 0 ? x.id : 0,
          tabId: 0,
          selector: typeof x.selector === 'string' ? x.selector : '',
          tagName: typeof x.tagName === 'string' ? x.tagName : '',
          preview: typeof x.preview === 'string' ? x.preview : '',
        }];
      }).map((e, i) => (e.id === 0 ? { ...e, id: i + 1 } : e))
    : [];
  if (tabs.length === 0 && elements.length === 0) return null;
  return { tabs, elements };
}

/**
 * 旧版扁平消息 {id?, role:'user'|'assistant', content:string, createdAt} → pi 消息;
 * 已是 pi 形状的消息**原样透传**(assistant 的 thinking 块/toolCall/usage、
 * toolResult 的 toolCallId/content 数组等,重建会打平丢失 —— 回放正确性的关键)。
 */
function sanitizeMessage(v: unknown): ChatMessage | null {
  if (!v || typeof v !== 'object') return null;
  const m = v as Record<string, unknown>;
  const ts =
    typeof m.createdAt === 'number' ? m.createdAt : typeof m.timestamp === 'number' ? m.timestamp : Date.now();
  if (m.role === 'user') {
    // 旧中间格式:带 refSnapshot 自定义字段且 content 尚无块 → 块内嵌,字段丢弃
    if (m.refSnapshot && typeof m.content === 'string' && !m.content.includes('<page-refs>')) {
      const legacy = legacyRefSnapshotToPageRefs(m.refSnapshot);
      if (legacy) {
        return { role: 'user', content: m.content + renderPageRefsBlock(legacy), timestamp: ts };
      }
    }
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
