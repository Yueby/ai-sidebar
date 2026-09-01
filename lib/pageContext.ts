import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { PageContext } from './types';
import { EXTRACT_PAGE_MESSAGE, toolLabel } from './types';

/**
 * content 侧提取应答:PageContext + 截断标记。
 * 正文长度上限由 content script 控制(12000,块边界截断),本层透传不二次截断。
 */
export interface ExtractedPage extends PageContext {
  /** content 侧已按块边界截断过正文 */
  truncated?: boolean;
}

/** 被引用的标签页(实时元信息,不含正文) */
export interface RefTab {
  id: number;
  title: string;
  url: string;
}

/** 只取标签页标题/URL(不触发 content script 提取) */
async function tabToRefTab(tabId: number): Promise<RefTab | null> {
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab?.url?.startsWith('http')) return null;
    return { id: tabId, title: tab.title ?? '', url: tab.url };
  } catch {
    return null;
  }
}

/** 当前活动标签页(仅 http/https);失败返回 null */
export async function getActiveTabMeta(): Promise<RefTab | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  return tabToRefTab(tab.id);
}

/** 指定标签页的实时元信息;不可达或非 http/https 返回 null */
export async function getTabMeta(tabId: number): Promise<RefTab | null> {
  return tabToRefTab(tabId);
}

/** 所有 http/https 标签页(供"添加标签页引用"候选列表) */
export async function listCandidateTabs(): Promise<RefTab[]> {
  const tabs = await browser.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  const result: RefTab[] = [];
  for (const tab of tabs) {
    if (tab?.id) {
      const meta = await tabToRefTab(tab.id);
      if (meta) result.push(meta);
    }
  }
  return result;
}

/** 向指定标签页请求页面内容;失败或不可提取时返回 null(不阻塞发送) */
export async function extractFromTab(tabId: number): Promise<ExtractedPage | null> {
  let url: string;
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab?.url?.startsWith('http')) return null;
    url = tab.url;
  } catch {
    return null;
  }
  try {
    const res = (await browser.tabs.sendMessage(tabId, {
      type: EXTRACT_PAGE_MESSAGE,
    })) as Partial<ExtractedPage> | undefined;
    if (!res || (!res.title && !res.text)) return null;
    return {
      title: res.title ?? '',
      url: res.url ?? url,
      text: res.text ?? '',
      truncated: res.truncated === true,
    };
  } catch {
    // 该页没有 content script(如刚加载的 chrome:// 页)或提取失败
    return null;
  }
}

export function renderPageContext(page: ExtractedPage): string {
  const lines = [
    '以下是用户当前浏览的网页内容,回答时可参考:',
    '',
    `<title>${page.title}`,
    `<url>${page.url}`,
    `<content>`,
    page.text,
    `</content>`,
  ];
  if (page.truncated) lines.push('', '(注:以上网页内容因过长已被截断,可能不完整,请据此调整回答。)');
  return lines.join('\n');
}

const EXTRACT_PAGE_PARAMS = Type.Object({
  tabId: Type.Number({ description: '要读取的标签页 id(用户消息 <page-refs> 块中以 tabId 标注)' }),
});

/** extract_page 工具:AI 按需读取某个被引用标签页的当前正文 */
export function createExtractPageTool(refTabs: RefTab[]): AgentTool<typeof EXTRACT_PAGE_PARAMS> {
  const validIds = refTabs.map((t) => t.id);
  return {
    name: 'extract_page',
    label: toolLabel('extract_page'),
    description:
      '读取用户引用的某个浏览器标签页的标题、URL 与正文内容。当用户的提问可能与被引用网页相关、或需要引用页面内容时,调用该工具并传入对应的 tabId。',
    parameters: EXTRACT_PAGE_PARAMS,
    execute: async (_toolCallId, args) => {
      const tabId = args?.tabId;
      if (typeof tabId !== 'number' || !validIds.includes(tabId)) {
        return {
          content: [
            {
              type: 'text',
              text: `无效的 tabId: ${JSON.stringify(tabId ?? null)}。可读取的标签页: ${
                validIds.map((id) => `#${id}`).join(', ') || '(无)'
              }。`,
            },
          ],
          details: null,
        };
      }
      const page = await extractFromTab(tabId);
      if (!page) {
        return {
          content: [
            {
              type: 'text',
              text: `无法读取标签页 #${tabId}:可能已被用户关闭、不是普通网页(如浏览器设置页)、页面尚未加载完成或内容不可提取。请据此调整回答。`,
            },
          ],
          details: null,
        };
      }
      return {
        content: [{ type: 'text', text: renderPageContext(page) }],
        details: { title: page.title, url: page.url },
      };
    },
  };
}

/** 元素选择消息协议:action 'start' 进入选择模式,'resolve' 按 selector 读取元素 */
export const PICK_ELEMENT_MESSAGE = 'ai-sidebar/pick-element' as const;
/** content script 框选完成后的结果广播(经 runtime.sendMessage 发给 sidepanel) */
export const PICK_ELEMENT_RESULT_MESSAGE = 'ai-sidebar/pick-element-result' as const;

/**
 * 程序化注入 content script。
 * MV3 声明式 content script 不会注入扩展加载/重载之前就打开的标签页,
 * tabs.sendMessage 会抛 "Receiving end does not exist",此处兜底补注入。
 */
async function ensureContentScript(tabId: number): Promise<boolean> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ['/content-scripts/content.js'],
    });
    return true;
  } catch {
    // 受限页面(chrome://、商店页等)或无宿主权限:注入失败
    return false;
  }
}

/** 发送框选 start 消息;无接收方时抛错由调用方决定是否注入兜底 */
async function sendPickStart(tabId: number): Promise<void> {
  await browser.tabs.sendMessage(tabId, { type: PICK_ELEMENT_MESSAGE, action: 'start' });
}

/** 读取标签页当前 URL;失败返回 null */
async function getTabUrl(tabId: number): Promise<string | null> {
  try {
    const tab = await browser.tabs.get(tabId);
    return tab?.url ?? null;
  } catch {
    return null;
  }
}

/** Chrome 禁止扩展注入脚本的受限地址:'internal' = 浏览器内部页,'webstore' = Chrome 应用商店,其余 null */
function classifyRestrictedUrl(
  url: string,
): 'internal' | 'webstore' | null {
  if (/^(chrome|edge|about):/i.test(url)) return 'internal';
  try {
    const u = new URL(url);
    if (u.hostname === 'chromewebstore.google.com') return 'webstore';
    if (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore')) return 'webstore';
  } catch {
    return null;
  }
  return null;
}

/**
 * 在指定标签页进入元素选择模式;失败时抛出带原因的错误(不静默)。
 * 优先直接发消息;content script 不在(扩展加载前已存在的标签页)时程序化注入后重试一次。
 */
export async function startPickElement(tabId: number): Promise<void> {
  try {
    await sendPickStart(tabId);
  } catch {
    // 注入前先按 URL 区分两类 Chrome 禁止注入的页面,给出准确文案
    const url = await getTabUrl(tabId);
    const restricted = url ? classifyRestrictedUrl(url) : null;
    if (restricted === 'internal') {
      throw new Error('无法在该页面启动元素选择:浏览器内部页面无法注入扩展脚本');
    }
    if (restricted === 'webstore') {
      throw new Error('无法在该页面启动元素选择:Chrome 应用商店页面受 Chrome 保护,禁止扩展注入');
    }
    const injected = await ensureContentScript(tabId);
    if (!injected) {
      throw new Error('无法在该页面启动元素选择:此页面不允许扩展注入脚本');
    }
    try {
      await sendPickStart(tabId);
    } catch {
      throw new Error('无法在该页面启动元素选择:页面尚未加载完成或已被关闭');
    }
  }
}

/** content 返回的元素图片信息(宽松透传,消费方经 rect 兜底截图裁剪) */
export interface ElementImage {
  src: string;
  alt: string;
  naturalWidth: number;
  naturalHeight: number;
  /** 视口 CSS 像素(×DPR 前) */
  rect: { x: number; y: number; w: number; h: number };
}

export interface ResolvedElement {
  tagName: string;
  /** 该元素的 Markdown 渲染(实时) */
  markdown: string;
  preview: string;
  /** 元素为 IMG 或包含 IMG(前 3 张)时的图片列表;read_element 交给 vision 模型 */
  images: ElementImage[];
  /** 页面 devicePixelRatio(captureCrop 裁剪用) */
  dpr: number;
}

/** 按 selector 实时读取指定标签页中的元素;元素不存在或失败返回 null */
export async function resolveElement(
  tabId: number,
  selector: string,
): Promise<ResolvedElement | null> {
  try {
    const res = (await browser.tabs.sendMessage(tabId, {
      type: PICK_ELEMENT_MESSAGE,
      action: 'resolve',
      selector,
    })) as
      | {
          found?: boolean;
          tagName?: string;
          markdown?: string;
          preview?: string;
          images?: unknown;
          dpr?: unknown;
        }
      | undefined;
    if (!res?.found || typeof res.markdown !== 'string') return null;
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const images: ElementImage[] = Array.isArray(res.images)
      ? res.images.flatMap((i): ElementImage[] => {
          if (!i || typeof i !== 'object') return [];
          const x = i as Record<string, unknown>;
          if (typeof x.src !== 'string' || !x.src) return [];
          const r = (x.rect && typeof x.rect === 'object' ? x.rect : {}) as Record<string, unknown>;
          return [{
            src: x.src,
            alt: typeof x.alt === 'string' ? x.alt : '',
            naturalWidth: num(x.naturalWidth),
            naturalHeight: num(x.naturalHeight),
            rect: { x: num(r.x), y: num(r.y), w: num(r.w), h: num(r.h) },
          }];
        })
      : [];
    return {
      tagName: res.tagName ?? '',
      markdown: res.markdown,
      preview: res.preview ?? '',
      images,
      dpr: typeof res.dpr === 'number' && res.dpr > 0 ? res.dpr : 1,
    };
  } catch {
    // 该页没有 content script(如导航中/chrome:// 页)或读取失败
    return null;
  }
}
