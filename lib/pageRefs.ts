import type { PageRefs, RefElementMeta, RefTabMeta, ChatMessage } from './types';

/**
 * <page-refs> 块:引用元数据在发送时序列化为 JSON 拼进 user 消息 content,此后永不改变。
 * 一份 JSON、两个消费者 —— LLM 直接读 content 里的块(pi-ai 对 user 消息原样透传),
 * UI 用 parsePageRefs 从同一 content 解析渲染。本模块为纯函数,不触碰 browser API。
 */
export const PAGE_REFS_TAG = 'page-refs';

const BLOCK_RE = /<page-refs>\n([\s\S]*?)\n<\/page-refs>/;

/** 渲染为可直接追加到消息文本尾部的块(前导空行);JSON 单行紧凑 */
export function renderPageRefsBlock(refs: PageRefs): string {
  const tabs = refs.tabs.map((t) => ({
    tabId: t.tabId,
    title: t.title,
    url: t.url,
    // focused 只在此刻为 true 时写入,不做 "focused":false 噪音
    ...(t.focused === true ? { focused: true } : {}),
  }));
  const elements = refs.elements.map((e) => ({
    // id = 元素标记号,与用户消息文本内嵌 [element:N] 标记的 N 一致(冻结契约)
    id: e.id,
    tabId: e.tabId,
    selector: e.selector,
    tagName: e.tagName,
    preview: e.preview,
    // 请求时内容内嵌:发送时刻解析的元素 outerHTML;解析失败不设(展开时降级 preview)
    ...(e.content ? { content: e.content } : {}),
  }));
  return `\n\n<${PAGE_REFS_TAG}>\n${JSON.stringify({ tabs, elements })}\n</${PAGE_REFS_TAG}>`;
}

/** 从任意形状值宽松解析 user content 中已有的块(渲染消费端可能是字符串或 text 块数组) */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (b): b is { type: string; text: string } =>
          !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' &&
          typeof (b as { text?: unknown }).text === 'string',
      )
      .map((b) => b.text)
      .join('');
  }
  return '';
}

/**
 * 解析 user content 中的 <page-refs> 块。
 * regex + JSON.parse + 形状校验;无块/JSON 非法/结构不符 → null。
 */
export function parsePageRefs(content: unknown): PageRefs | null {
  const text = contentToText(content);
  if (!text.includes(`<${PAGE_REFS_TAG}>`)) return null;
  const m = BLOCK_RE.exec(text);
  const jsonText = m?.[1];
  if (typeof jsonText !== 'string') return null;
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.tabs) && !Array.isArray(d.elements)) return null;
  const tabs: RefTabMeta[] = Array.isArray(d.tabs)
    ? d.tabs.flatMap((t): RefTabMeta[] => {
        if (!t || typeof t !== 'object') return [];
        const x = t as Record<string, unknown>;
        if (typeof x.tabId !== 'number') return [];
        return [{
          tabId: x.tabId,
          title: typeof x.title === 'string' ? x.title : '',
          url: typeof x.url === 'string' ? x.url : '',
          ...(x.focused === true ? { focused: true } : {}),
        }];
      })
    : [];
  const elements: RefElementMeta[] = (Array.isArray(d.elements)
    ? d.elements.flatMap((e): RefElementMeta[] => {
        if (!e || typeof e !== 'object') return [];
        const x = e as Record<string, unknown>;
        if (typeof x.tabId !== 'number' || typeof x.selector !== 'string') return [];
        return [{
          // 旧消息无 id:置 0 占位,下方按数组序补 1..n(向后兼容)
          id: typeof x.id === 'number' && Number.isInteger(x.id) && x.id > 0 ? x.id : 0,
          tabId: x.tabId,
          selector: x.selector,
          tagName: typeof x.tagName === 'string' ? x.tagName : '',
          preview: typeof x.preview === 'string' ? x.preview : '',
          ...(typeof x.content === 'string' ? { content: x.content } : {}),
        }];
      })
    : []
  ).map((e, i) => (e.id === 0 ? { ...e, id: i + 1 } : e));
  return { tabs, elements };
}

/** 剥离块还原用户正文(UI 渲染正文用,防 JSON 泄漏) */
export function stripPageRefs(content: string): string {
  return content.replace(/\n*<page-refs>\n[\s\S]*?\n<\/page-refs>\n?/g, '');
}

/**
 * 扫描历史 user 消息中的块,聚合为工具白名单来源。
 * 后者覆盖前者:同字段(tabs/elements)以较新块为准。
 */
export function collectPageRefs(messages: readonly ChatMessage[]): PageRefs {
  const result: PageRefs = { tabs: [], elements: [] };
  for (const m of messages) {
    if (m.role !== 'user') continue;
    const parsed = parsePageRefs(m.content);
    if (!parsed) continue;
    if (parsed.tabs.length > 0) result.tabs = parsed.tabs;
    if (parsed.elements.length > 0) result.elements = parsed.elements;
  }
  return result;
}
