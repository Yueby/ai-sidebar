import type { PageContext } from './types';
import { PICK_ELEMENT_MESSAGE, READ_PAGE_MESSAGE, SEARCH_ELEMENT_MESSAGE } from './types';

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
      type: READ_PAGE_MESSAGE,
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
    'Below is the current content of a web page the user is browsing, for reference:',
    '',
    `<title>${page.title}`,
    `<url>${page.url}`,
    '<content>',
    page.text,
    '</content>',
  ];
  if (page.truncated) {
    lines.push('', '(Note: the page content above was truncated due to length and may be incomplete. Adjust your answer accordingly.)');
  }
  return lines.join('\n');
}

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
  /** 该元素的 outerHTML(原始 HTML,实时;content 侧 12000 字符截断) */
  html: string;
  /** content 侧已因超长截断 */
  truncated: boolean;
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
          html?: string;
          truncated?: boolean;
          preview?: string;
          images?: unknown;
          dpr?: unknown;
        }
      | undefined;
    if (!res?.found || typeof res.html !== 'string') return null;
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
      html: res.html,
      truncated: res.truncated === true,
      preview: res.preview ?? '',
      images,
      dpr: typeof res.dpr === 'number' && res.dpr > 0 ? res.dpr : 1,
    };
  } catch {
    // 该页没有 content script(如导航中/chrome:// 页)或读取失败
    return null;
  }
}

// ===== 交互元素发现(search_element;三期步① ARIA 定位发现层)=====

/** search_element 清单条目(ARIA role+可访问名称+状态;步② click/fill 的 locator 以此为寻址协议) */
export interface InteractiveElementInfo {
  /** 生效 ARIA role(getRole 显式+隐式;password 等无隐式 role 的 input 与 contenteditable 兑底 textbox) */
  role: string;
  /** 可访问名称(AccName 全算法,空白已坍缩;可为空串) */
  name: string;
  /** 同 role+name 组内 1 起文档序序号(首现 1 不输出,后续输出 [2]/[3]);全量计数与输出截断解耦 */
  ordinal: number;
  disabled: boolean;
  /** 未被 AX 排除且渲染可见且非零尺寸(不可见时输出 [hidden] 旗标) */
  visible: boolean;
}

/** content.ts 交互元素清单应答载荷 */
export interface SearchElementsResult {
  url: string;
  title: string;
  /** 全量交互元素数(截断前真实总数) */
  total: number;
  truncated: boolean;
  /** content 侧收集耗时(ms;性能打点,工具日志用) */
  durationMs: number;
  elements: InteractiveElementInfo[];
}

/**
 * 列出指定标签页的交互元素清单(search_element 底层)。
 * 失败返回 null(不可达/非 http(s)/导航中/无 content script 且补注入失败);
 * content script 不在(扩展加载前已存在的标签页)时补注入后重试一次(动作链路健壮性)。
 */
export async function searchElementsInTab(tabId: number): Promise<SearchElementsResult | null> {
  let url: string;
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab?.url?.startsWith('http')) return null;
    url = tab.url;
  } catch {
    return null;
  }
  const request = async (): Promise<SearchElementsResult | { error: string } | undefined> => {
    const res = (await browser.tabs.sendMessage(tabId, { type: SEARCH_ELEMENT_MESSAGE })) as
      | SearchElementsResult
      | { error: string }
      | undefined;
    return res;
  };
  let res = await request().catch(() => undefined);
  if (!res) {
    const injected = await ensureContentScript(tabId);
    if (!injected) return null;
    res = await request().catch(() => undefined);
  }
  if (!res || typeof res !== 'object' || 'error' in res || !Array.isArray(res.elements)) return null;
  const elements = res.elements.flatMap((e): InteractiveElementInfo[] => {
    if (!e || typeof e !== 'object') return [];
    const x = e as unknown as Record<string, unknown>;
    if (typeof x.role !== 'string' || x.role.length === 0) return [];
    return [{
      role: x.role,
      name: typeof x.name === 'string' ? x.name : '',
      ordinal:
        typeof x.ordinal === 'number' && Number.isInteger(x.ordinal) && x.ordinal > 0 ? x.ordinal : 1,
      disabled: x.disabled === true,
      visible: x.visible !== false,
    }];
  });
  return {
    url: typeof res.url === 'string' ? res.url : url,
    title: typeof res.title === 'string' ? res.title : '',
    total: typeof res.total === 'number' ? res.total : elements.length,
    truncated: res.truncated === true,
    durationMs: typeof res.durationMs === 'number' && res.durationMs >= 0 ? res.durationMs : 0,
    elements,
  };
}
