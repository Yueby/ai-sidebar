import { i18n } from '#i18n';
import type { A11yNode } from './a11yTree';
import type { PageContext } from './types';
import {
  PAGE_ACTION_MESSAGE,
  PICK_ELEMENT_MESSAGE,
  READ_PAGE_MESSAGE,
  SEARCH_ELEMENT_MESSAGE,
} from './types';
import {
  cdpLease,
  dispatchTrustedMouseClick,
  synthesizeTrustedScrollGesture,
  dispatchTrustedKey,
  insertTrustedText,
  withCdpInputLock,
} from './cdp';

/** macOS 上全选用 Cmd(CDP modifiers 4),其余平台 Ctrl(2) */
const IS_MAC = /Mac|iPhone|iPad/i.test(typeof navigator !== 'undefined' ? navigator.platform : '');

/**
 * content 侧提取应答:PageContext + 截断标记。
 * 正文长度上限由 content script 控制(12000,块边界截断),本层透传不二次截断。
 */
export interface ExtractedPage extends PageContext {
  /** content 侧已按块边界截断过正文 */
  truncated?: boolean;
  /** 该页全文长度(仅续读窗口请求时由 content 侧回报,用于告知还差多少) */
  totalLength?: number;
  /** 窗口在全文中的真实起点(尾窗不为 0) */
  windowStart?: number;
}

/** 被引用的标签页(实时元信息,不含正文) */
export interface RefTab {
  id: number;
  title: string;
  url: string;
  // favIconUrl 已退出数据层(审计窄版收敛):实时图标由 lib/tabMetaStore 渲染层单源提供
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

/**
 * 构造可行动的「tab 不可读」错误文本(read_page/read_element 共用):
 * 区分三种情况 —— 非数字 tabId / tab 不存在(已关闭) / tab 存在但不在可读白名单,
 * 并给出修复路径(open_page 拿可读句柄,或请用户引用页面)。
 * 背景(search_page 与 read 白名单脱节的反馈):search_page 能枚举任意 http(s) tab,
 * 但 read_page 只接受 <page-refs> 引用 + open_page 注册的 tab —— 错误文本必须讲清这一点。
 */
export async function buildUnreadableTabError(
  tabId: unknown,
  validIds: readonly number[],
  dynamicTabs?: ReadonlySet<number>,
  noun = 'readable',
): Promise<string> {
  // refTabs 已并入 agent-opened(agent.ts 组装时),Set 去重防 `#5, #5`
  const readable = [...new Set([...validIds, ...(dynamicTabs ?? [])])].map((id) => `#${id}`).join(', ') || '(none)';
  const Cap = noun[0]!.toUpperCase() + noun.slice(1);
  if (typeof tabId !== 'number' || !Number.isFinite(tabId)) {
    return `Invalid tabId: ${JSON.stringify(tabId ?? null)}. A finite numeric tab id is required. ${Cap} tabs: ${readable}.`;
  }
  let exists = false;
  try {
    const tab = await browser.tabs.get(tabId);
    exists = Boolean(tab?.id);
  } catch {
    exists = false;
  }
  if (!exists) {
    return `Tab #${tabId} does not exist (it may have been closed). ${Cap} tabs: ${readable}. Use search_page to list currently open tabs.`;
  }
  return `Tab #${tabId} exists but is not ${noun} in this conversation: only referenced tabs (from <page-refs>) and tabs opened via open_page are ${noun}; currently ${noun}: ${readable}. To use it, call open_page with its URL (the new tab becomes ${noun}), or ask the user to reference the page and resend.`;
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

/** 所有 http/https 标签页(供"添加引用"候选列表与 search_page 工具);active 标注当前活动 tab */
export async function listCandidateTabs(): Promise<(RefTab & { active?: boolean })[]> {
  const tabs = await browser.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  const result: (RefTab & { active?: boolean })[] = [];
  for (const tab of tabs) {
    if (!tab?.id) continue;
    const meta = await tabToRefTab(tab.id);
    if (meta) result.push({ ...meta, ...(tab.active ? { active: true } : {}) });
  }
  return result;
}

/**
 * 打开新标签页(open_page 底层);返回新 tab 元信息,失败 null。
 * 刚创建的 tab 标题为空(页面尚未加载完),直接回读会让模型拿到 "Opened tab #N ()" ——
 * 返回前**有界**等待标题就绪;已有标题/超时/查询失败一律返回当前已知值。
 */
export async function openTab(url: string, activate = true): Promise<RefTab | null> {
  try {
    const tab = await browser.tabs.create({ url, active: activate });
    if (!tab?.id) return null;
    const initial: RefTab = { id: tab.id, title: tab.title || '', url: tab.url || url };
    if (initial.title) return initial;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      try {
        const now = await browser.tabs.get(tab.id);
        // 新建 tab 的 url 字段可能为空串(不是 undefined)→ 用 `||` 回退到请求的 URL,
        // 否则成功文本会输出 "Opened tab #N ()"
        initial.url = now.url || initial.url;
        if (now.title) {
          initial.title = now.title;
          return initial;
        }
      } catch {
        return initial; // tab 已被关闭/不可达:返回已知信息
      }
    }
    return initial;
  } catch {
    return null;
  }
}

/** 按 URL 找现存 http(s) 标签页(忽略 #hash);open_page 同 URL 复用去重用 */
export async function findTabByUrl(url: string): Promise<RefTab | null> {
  try {
    const target = url.replace(/#.*$/, '');
    const tabs = await browser.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    const match = tabs.find((t) => t.id !== undefined && (t.url ?? '').replace(/#.*$/, '') === target);
    if (!match?.id) return null;
    return { id: match.id, title: match.title ?? '', url: match.url ?? url };
  } catch {
    return null;
  }
}

// ===== click_element 的 tab 变化报告(target=_blank 新开页不再让模型猜)=====

export interface TabSnapshot {
  ids: Set<number>;
  activeId?: number;
}

/**
 * 现存 tab id 集合(草稿引用对账用)。**查询失败返回 null** ——
 * 调用方必须把它当“未知”跳过清理,绝不可归零处理(`snapshotTabs` 的 catch 会返回空集,
 * 用于本场景会误删全部引用)。
 */
export async function liveTabIds(): Promise<Set<number> | null> {
  try {
    const tabs = await browser.tabs.query({});
    const ids = new Set<number>();
    for (const t of tabs) {
      if (t.id !== undefined) ids.add(t.id);
    }
    return ids;
  } catch {
    return null;
  }
}

/** 动作前快照:tab 集合 + 焦点 tab */
export async function snapshotTabs(): Promise<TabSnapshot> {
  const tabs = await browser.tabs.query({}).catch(() => []);
  const ids = new Set<number>();
  let activeId: number | undefined;
  for (const t of tabs) {
    if (t.id === undefined) continue;
    ids.add(t.id);
    if (t.active) activeId = t.id;
  }
  return { ids, activeId };
}

/**
 * 动作后对比:有新 tab(如点击 target=_blank 链接)或焦点切换时返回提示文本,
 * 无变化返回 null。新 tab 提示附带可读化路径(open_page 同 URL 复用,不再开重复页)。
 */
export interface TabChangeReport {
  /** 模型可见的变化说明(无变化为 null) */
  note: string | null;
  /** 本次动作新开出的 tab id(已登记为 agent-opened:可读、可由 close_page 清理) */
  openedTabIds: number[];
}

export async function describeTabChanges(before: TabSnapshot): Promise<TabChangeReport> {
  const tabs = await browser.tabs.query({}).catch(() => []);
  const opened = tabs.filter((t) => t.id !== undefined && !before.ids.has(t.id));
  const notes: string[] = [];
  const openedTabIds: number[] = [];
  for (const t of opened) {
    if (t.id === undefined) continue;
    // 点击导致的“新开页”由 agent 造成,登记为 agent-opened:该页随即成为可读句柄,也可被
    // close_page 关闭(关闭仍需用户确认)。未登记的页面读不到,只能交给用户手动处理。
    registerAgentOpenedTab(t.id);
    openedTabIds.push(t.id);
    notes.push(
      `The click opened new tab #${t.id}${t.url ? ` (${t.url})` : ''}${t.active ? ' — it is now the focused tab' : ''}. It is registered as readable and closable via its tabId (read_page / click_element / fill_element / close_page).`,
    );
  }
  const active = tabs.find((t) => t.active);
  if (opened.length === 0 && active?.id !== undefined && active.id !== before.activeId) {
    notes.push(`Focus moved to tab #${active.id}${active.url ? ` (${active.url})` : ''}. It is not readable unless it was referenced or opened via open_page.`);
  }
  return { note: notes.length > 0 ? notes.join(' ') : null, openedTabIds };
}

// ===== agent 开启标签页的运行时注册表(面板生命周期)=====
// open_page 开出的 tabId 注册于此;read_page/read_element/execute_js 的白名单
// 在草稿引用 ∪ 历史 refs 块 ∪ 本注册表三源合并(决策 27)。tab 关闭时残留条目
// 无害(读 closed tab 走可行动错误文本),不主动清理。
const agentOpenedTabs = new Set<number>();

export function registerAgentOpenedTab(tabId: number): void {
  agentOpenedTabs.add(tabId);
}

export function getAgentOpenedTabs(): ReadonlySet<number> {
  return agentOpenedTabs;
}

export function unregisterAgentOpenedTab(tabId: number): void {
  agentOpenedTabs.delete(tabId);
}


/** 把指定标签页切到前台(activate_page 底层);返回最新元信息,失败 null */
export async function activateTab(tabId: number): Promise<RefTab | null> {
  try {
    const tab = await browser.tabs.update(tabId, { active: true });
    if (!tab?.id) return null;
    return { id: tab.id, title: tab.title ?? '', url: tab.url ?? '' };
  } catch {
    return null;
  }
}

/** 关闭标签页(close_page 底层);已关闭/不存在时静默成功 */
export async function closeTab(tabId: number): Promise<boolean> {
  try {
    await browser.tabs.remove(tabId);
    return true;
  } catch {
    return false;
  }
}

/** 向指定标签页请求页面内容;失败或不可提取时返回 null(不阻塞发送) */
export async function extractFromTab(
  tabId: number,
  section: 'head' | 'tail' = 'head',
  waitStableMs = 0,
  waitText?: string,
  offset = 0,
): Promise<ExtractedPage | null> {
  let url: string;
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab?.url?.startsWith('http')) return null;
    url = tab.url;
  } catch {
    return null;
  }
  // 首次直连;无 content script(如刚授权网页访问后已打开的旧标签页)则补注入后重试一次
  const request = async (): Promise<Partial<ExtractedPage> | undefined> => {
    const res = (await browser.tabs.sendMessage(tabId, {
      type: READ_PAGE_MESSAGE,
      section,
      waitStableMs,
      waitText,
      offset,
    })) as Partial<ExtractedPage> | undefined;
    return res;
  };
  try {
    let res = await request().catch(() => undefined);
    if (!res) {
      const injected = await ensureContentScript(tabId);
      if (!injected) return null;
      res = await request().catch(() => undefined);
    }
    if (!res || (!res.title && !res.text)) return null;
    return {
      title: res.title ?? '',
      url: res.url ?? url,
      text: res.text ?? '',
      truncated: res.truncated === true,
      fingerprint: typeof res.fingerprint === 'string' ? res.fingerprint : undefined,
      totalLength: typeof res.totalLength === 'number' ? res.totalLength : undefined,
      windowStart: typeof res.windowStart === 'number' ? res.windowStart : undefined,
    };
  } catch {
    // 该页没有 content script(如刚加载的 chrome:// 页)或提取失败
    return null;
  }
}

export interface ExtractedTree {
  url: string;
  title: string;
  nodes: A11yNode[];
  total: number;
  truncated: boolean;
}

/**
 * 读取标签页的可访问性树(read_page mode='tree'):结构 + 名字 + 状态 + 值。
 * 与 extractFromTab 同一条消息协议(mode 区分),同样带"无 content script 时补注入重试"。
 */
export async function extractTreeFromTab(
  tabId: number,
  root?: string,
): Promise<ExtractedTree | { error: string } | null> {
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab?.url?.startsWith('http')) return null;
  } catch {
    return null;
  }
  const request = async (): Promise<ExtractedTree | { error: string } | undefined> =>
    (await browser.tabs.sendMessage(tabId, {
      type: READ_PAGE_MESSAGE,
      mode: 'tree',
      root,
    })) as ExtractedTree | { error: string } | undefined;
  try {
    let res = await request().catch(() => undefined);
    if (!res) {
      const injected = await ensureContentScript(tabId);
      if (!injected) return null;
      res = await request().catch(() => undefined);
    }
    return res ?? null;
  } catch {
    return null;
  }
}

export function renderPageContext(
  page: ExtractedPage,
  /** 置 false 时省略通用“被截断”提示(调用方会给出更精确的窗口说明,避免两条提示重复) */
  options: { truncationNote?: boolean } = {},
): string {
  const lines = [
    'Below is the current content of a web page the user is browsing, for reference:',
    '',
    `<title>${page.title}`,
    `<url>${page.url}`,
    '<content>',
    page.text,
    '</content>',
  ];
  if (page.truncated && options.truncationNote !== false) {
    lines.push('', '(Note: the page content above was truncated due to length and may be incomplete. Adjust your answer accordingly.)');
  }
  if (page.fingerprint) {
    lines.push('', `Page fingerprint: ${page.fingerprint} (compare across two reads to tell whether/how the page changed).`);
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
      throw new Error(i18n.t('pick.blockedInternal'));
    }
    if (restricted === 'webstore') {
      throw new Error(i18n.t('pick.blockedStore'));
    }
    const injected = await ensureContentScript(tabId);
    if (!injected) {
      throw new Error(i18n.t('pick.blockedPage'));
    }
    try {
      await sendPickStart(tabId);
    } catch {
      throw new Error(i18n.t('pick.pageNotReady'));
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
  /** 页面状态指纹(步④) */
  fingerprint?: string;
}

/** 按 selector 实时读取指定标签页中的元素;元素不存在或失败返回 null */
export async function resolveElement(
  tabId: number,
  target: { selector?: string; locator?: { role: string; name: string; ordinal?: number } },
): Promise<ResolvedElement | null> {
  // 首次直连;无 content script(如刚授权网页访问后已打开的旧标签页)则补注入后重试一次
  const request = async (): Promise<{
    found?: boolean;
    tagName?: string;
    html?: string;
    truncated?: boolean;
    preview?: string;
    images?: unknown;
    dpr?: unknown;
    fingerprint?: unknown;
  } | undefined> => {
    const res = (await browser.tabs.sendMessage(tabId, {
      type: PICK_ELEMENT_MESSAGE,
      action: 'resolve',
      selector: target.selector,
      locator: target.locator,
    })) as
      | {
          found?: boolean;
          tagName?: string;
          html?: string;
          truncated?: boolean;
          preview?: string;
          images?: unknown;
          dpr?: unknown;
          fingerprint?: unknown;
        }
      | undefined;
    return res;
  };
  try {
    let res = await request().catch(() => undefined);
    if (!res) {
      const injected = await ensureContentScript(tabId);
      if (!injected) return null;
      res = await request().catch(() => undefined);
    }
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
      fingerprint: typeof res.fingerprint === 'string' ? res.fingerprint : undefined,
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
  /** 可访问名称(AccName 全算法,空白已坍缩;可为空串时 input/textarea 兑底 placeholder) */
  name: string;
  /** 同 role+name 组内 1 起文档序序号(首现 1 不输出,后续输出 [2]/[3]);全量计数与输出截断解耦 */
  ordinal: number;
  disabled: boolean;
  /** 未被 AX 排除且渲染可见且非零尺寸(不可见时输出 [hidden] 旗标) */
  visible: boolean;
  /** 文本型 input 的真实 type(password/email/tel/url/日期族等,输出 [type=x] 旗标) */
  inputType?: string;
  /** 链接目标(动作前可先看清去向) */
  href?: string;
  /** 当前值(input/textarea/select 已选文本;密码字段不回传) */
  value?: string;
  /** 复选框/单选框选中态(true/false 都有信息量) */
  checked?: boolean;
  /** 无名节点的定位线索(img 文件名等):清单与树都渲染它,否则一批无名同类节点无法区分 */
  hint?: string;
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
  /** 跨源 iframe 说明(内容在本页不可达,需 open_page) */
  frames?: string[];
}

/**
 * 列出指定标签页的交互元素清单(search_element 底层)。
 * query 可选:role/可访问名称的大小写不敏感子串过滤(目标超出默认 80 条时的定位出路)。
 * 失败返回 null(不可达/非 http(s)/导航中/无 content script 且补注入失败);
 * content script 不在(扩展加载前已存在的标签页)时补注入后重试一次(动作链路健壮性)。
 */
export async function searchElementsInTab(
  tabId: number,
  query?: string | string[],
  includeHidden = false,
): Promise<SearchElementsResult | null> {
  let url: string;
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab?.url?.startsWith('http')) return null;
    url = tab.url;
  } catch {
    return null;
  }
  const request = async (): Promise<SearchElementsResult | { error: string } | undefined> => {
    const res = (await browser.tabs.sendMessage(tabId, {
      type: SEARCH_ELEMENT_MESSAGE,
      query,
      includeHidden,
    })) as SearchElementsResult | { error: string } | undefined;
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
      inputType: typeof x.inputType === 'string' && x.inputType ? x.inputType : undefined,
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

// ===== 页面动作(click/fill/scroll;三期步②,与 search_element 同源寻址)=====

/** ARIA locator:与 search_element 清单行同语义(role + 可访问名称 + 组内序号) */
export interface ActionLocator {
  role: string;
  name: string;
  /** 同 role+name 组内 1 起序号(缺省 1 = 首个) */
  ordinal?: number;
}

/** resolve/动作命中的元素摘要(确认卡预览 + 动作结果) */
export interface ResolvedActionElement {
  role: string;
  name: string;
  ordinal: number;
  tagName: string;
  /** 元素可见文本预览(截 ~80 字) */
  preview: string;
}

export type PageActionResult =
  | {
      ok: true;
      url: string;
      title: string;
      /** scroll 无定位时缺省 */
      element?: ResolvedActionElement;
      /** 动作注记(遮挡 fallback / navigation_started 等,英文,模型可见) */
      notes: string[];
      /** scroll 专用:JS 路径是否观察到位移;false 时 sidepanel 侧走 CDP 可信滚轮兜底 */
      moved?: boolean;
      /** scroll 专用:moved=false 时带视口尺寸(CDP 坐标中心用) */
      viewport?: { width: number; height: number };
      /** CDP 前置解析:元素中心视口坐标(可信点击/填充用) */
      centerPoint?: { x: number; y: number };
      /** CDP 前置解析:中心点被其他元素遮挡(命中测试;遮挡时不走可信点击,避免点到遮挡物上) */
      occluded?: boolean;
      /** CDP 前置解析:文本型元素(input/textarea/contenteditable;fill 的 insertText 仅此类) */
      canTextInput?: boolean;
      /** CDP 前置解析:元素状态旗标(供注记;合成路径在 content 内部产生同样注记) */
      disabled?: boolean;
      hidden?: boolean;
      /** viewport 动作专用:设备像素比(截图坐标换算;与上面的视口尺寸配套) */
      devicePixelRatio?: number;
    }
  | {
      ok: false;
      url: string;
      reason:
        | 'not_found'
        | 'ambiguous'
        | 'option_not_found'
        | 'unsupported_element'
        | 'invalid_value'
        /** 坐标点击专用:该视口坐标上没有可命中的元素 */
        | 'no_element_at_point';
      /** ambiguous 时的同名候选 */
      matches?: { ordinal: number; tagName: string; preview: string }[];
      /** option_not_found 时的选项文本(前 20) */
      options?: string[];
      /** not_found 时同 role 的现有目标(role "name" 行,帮助模型纠错) */
      alternatives?: string[];
    };

/**
 * 解析目标(动作前预览,确认卡用)或执行动作(点击/填充/滚动)。
 * 目标三选一:locator(role+name+序号)、selector(CSS,用于无 role/名称的元素)、
 * point(视口 CSS 像素坐标,用于只有截图可依赖的元素——如 canvas 或图像卡片网格)。
 * 失败返回 null(不可达/非 http(s)/导航中/补注入失败);结构化失败走 PageActionResult(ok:false)。
 */
export async function performPageAction(
  tabId: number,
  action: 'resolve' | 'click' | 'fill' | 'scroll' | 'viewport',
  params: {
    locator?: ActionLocator;
    selector?: string;
    /** 视口 CSS 像素坐标(仅 click 可用;与 locator/selector 互斥,由工具侧拦下) */
    point?: { x: number; y: number };
    value?: string;
    direction?: string;
    amount?: number;
    submit?: 'enter';
  } = {},
): Promise<PageActionResult | null> {
  let url: string;
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab?.url?.startsWith('http')) return null;
    url = tab.url;
    // 后台 tab 的计时器被 Chrome 节流(settle/高亮会冻结到分钟级):实际动作前自动激活目标页;
    // resolve/viewport 仅预览(确认卡展示 / 尺寸查询),不抢用户焦点
    if (action !== 'resolve' && action !== 'viewport' && tab.active !== true) {
      await browser.tabs.update(tabId, { active: true }).catch(() => {});
    }
  } catch {
    return null;
  }
  // scroll 模式轮次:wheel = 合成滚轮优先(模拟鼠标);CDP 附加失败才切 js = 滚动条快路径
  let currentMode: 'wheel' | 'js' = 'wheel';
  // click/fill CDP 优先编排:requestAction 可在 resolve/after 间切换;beforeSummary 供 after 注记
  let requestAction: 'resolve' | 'click' | 'fill' | 'scroll' | 'viewport' | 'after' = action;
  let nextBeforeSummary: unknown = undefined;
  let nextBeforeUrl: string | undefined = undefined;
  const request = async (): Promise<PageActionResult | undefined> => {
    const res = (await browser.tabs.sendMessage(tabId, {
      type: PAGE_ACTION_MESSAGE,
      action: requestAction,
      mode: currentMode,
      ...(requestAction === 'after' ? { beforeSummary: nextBeforeSummary, beforeUrl: nextBeforeUrl } : {}),
      ...params,
    })) as PageActionResult | undefined;
    return res;
  };
  // sidepanel 侧硬保险:content 侧响应不到(隐藏 tab rAF 暂停挂死/导航销毁上下文)时,
  // 上游 agent 无工具超时,裸 Promise 会拖死整轮对话(停止按钮也救不回)。
  const ACTION_TIMEOUT_MS = 8000; // 可见最坏 ~4.6s(1500+3000+尾帧)+ 节流余量
  type ActionOutcome =
    | { kind: 'response'; res: PageActionResult | undefined }
    | { kind: 'rejected' }
    | { kind: 'timeout' };
  const requestWithTimeout = async (): Promise<ActionOutcome> => {
    return await Promise.race([
      request().then(
        (r) => ({ kind: 'response', res: r } as const),
        () => ({ kind: 'rejected' } as const),
      ),
      new Promise<{ kind: 'timeout' }>((resolve) =>
        setTimeout(() => resolve({ kind: 'timeout' }), ACTION_TIMEOUT_MS),
      ),
    ]);
  };
  /** 降级成功:动作已派发但结果未确认。绝不能返回 ok:false(会诱导模型重试 = 双动作) */
  const degradedSuccess = (currentUrl: string, note: string): PageActionResult => ({
    ok: true,
    url: currentUrl,
    title: '',
    notes: [note],
  });

  // click/fill:CDP 可信输入优先(默认 = 模拟真实鼠标);resolve 拿坐标 → CDP 执行 → after 注记;
  // 三态:dispatched = 完成(after 注记);not_dispatched = 未派发任何输入,可安全降级合成;
  // partial_or_unknown = 已派发部分输入(可能已点击/已改值),禁止重发,如实返回未确认状态
  let cdpActed = false;
  let cdpFirstResult: PageActionResult | null = null;
  if (action === 'click' || action === 'fill') {
    const savedAction = requestAction;
    requestAction = 'resolve';
    const rOutcome = await requestWithTimeout();
    requestAction = savedAction;
    const rRes = rOutcome.kind === 'response' ? rOutcome.res : undefined;
    // 坐标点击:目标点由调用方给出(视口坐标),**不使用**元素中心 —— 大容器的中心往往打偏;
    // 也不做遮挡判定:「点到什么就是什么」正是这条路径的语义(模型看的是截图)
    const usePoint =
      action === 'click' && typeof params.point?.x === 'number' && typeof params.point?.y === 'number';
    if (
      rRes?.ok === true &&
      (usePoint ||
        (typeof rRes.centerPoint?.x === 'number' &&
          typeof rRes.centerPoint?.y === 'number' &&
          rRes.occluded !== true)) &&
      // fill 仅文本型元素可走 CDP(insertText);select/toggle 走合成(它们有自己的分支语义)
      (action === 'click' || rRes.canTextInput === true)
    ) {
      const cx = usePoint ? params.point!.x : rRes.centerPoint!.x;
      const cy = usePoint ? params.point!.y : rRes.centerPoint!.y;
      const fillValue = typeof params.value === 'string' ? params.value : '';
      // fill 序列状态:任一步派发成功后失败 → partial_or_unknown(禁止重发)
      let fillState: 'not_dispatched' | 'dispatched' | 'partial_or_unknown' = 'not_dispatched';
      let clickPartial = false;
      // 浏览器输入互斥(操作级):完整 click/fill 序列持锁串行;锁内领取连接租约
      // (中途用户解除调试/切 tab 则后续命令失败,不再自动重新附加)
      const runCdpSequence = async (): Promise<void> => {
        const lease = cdpLease();
        if (action === 'click') {
          const clickState = await dispatchTrustedMouseClick(tabId, cx, cy, lease);
          // not_dispatched = 点击尚未发生,可安全降级合成;partial = 按下已派发,禁止重发
          if (clickState === 'dispatched') cdpActed = true;
          else if (clickState === 'partial_or_unknown') {
            cdpActed = true;
            clickPartial = true;
          }
          return;
        }
        // fill:可信点击聚焦 → Ctrl+A 全选(Mac=Cmd) → Backspace 清空 → insertText(非空时) → (Enter 提交)。
        // 点击派发后序列中任何一步未达 → partial_or_unknown(整体未完成,禁止降级重发)
        const clickState = await dispatchTrustedMouseClick(tabId, cx, cy, lease);
        if (clickState === 'not_dispatched') {
          fillState = 'not_dispatched';
        } else {
          fillState = clickState === 'dispatched' ? 'dispatched' : 'partial_or_unknown';
          if (clickState === 'dispatched') {
            const selectAll = await dispatchTrustedKey(tabId, 'a', 'KeyA', 65, IS_MAC ? 4 : 2, lease);
            if (selectAll === 'dispatched') {
              const clear = await dispatchTrustedKey(tabId, 'Backspace', 'Backspace', 8, 0, lease);
              if (clear === 'dispatched') {
                if (fillValue !== '') {
                  const insert = await insertTrustedText(tabId, fillValue, lease);
                  if (insert !== 'dispatched') fillState = 'partial_or_unknown';
                }
                if (fillState === 'dispatched' && params.submit === 'enter') {
                  const enter = await dispatchTrustedKey(tabId, 'Enter', 'Enter', 13, 0, lease);
                  if (enter !== 'dispatched') fillState = 'partial_or_unknown';
                }
              } else fillState = 'partial_or_unknown';
            } else fillState = 'partial_or_unknown';
          }
        }
        cdpActed = fillState !== 'not_dispatched';
      };
      await withCdpInputLock(runCdpSequence);
      // 闭包内赋值的读取:显式函数避免 TS 控制流把 fillState 收窄回初始字面量
      const isFillPartial = (): boolean => fillState === 'partial_or_unknown';
      if (cdpActed) {
        // after 注记:content 侧 settle + before/after 对比 + submit 回读(与合成路径同一套)。
        // 坐标点击没有可重解析的元素(目标是画面上的一个点),故跳过 after 而不谎报状态。
        nextBeforeSummary = rRes.element ?? null;
        nextBeforeUrl = url;
        requestAction = 'after';
        const aOutcome = usePoint ? { kind: 'response' as const, res: undefined } : await requestWithTimeout();
        requestAction = savedAction;
        const aRes = aOutcome.kind === 'response' ? aOutcome.res : undefined;
        let aNotes = aRes?.ok === true && Array.isArray(aRes.notes) ? aRes.notes.filter((n): n is string => typeof n === 'string') : [];
        let actedUrl = aRes?.ok === true && typeof aRes.url === 'string' ? aRes.url : url;
        if (!aRes) {
          // after 请求被销毁/超时:常见于动作触发的同 tab 导航——补导航注记并采用新 URL
          try {
            const t = await browser.tabs.get(tabId);
            if (t?.url?.startsWith('http')) {
              actedUrl = t.url;
              if (t.url !== url) {
                aNotes = [
                  ...aNotes,
                  'navigation_started: the page navigated after the action; element state may have changed.',
                ];
              }
            }
          } catch {
            /* tab 已关闭:保留动作前 URL */
          }
        }
        const stateNotes =
          rRes.disabled === true || rRes.hidden === true
            ? [
                ...(rRes.disabled === true ? ['Note: the target element is disabled; the browser may ignore the interaction.'] : []),
                ...(rRes.hidden === true ? ['Note: the target element is currently not visible.'] : []),
              ]
            : [];
        const actNote =
          action === 'click'
            ? 'cdp_trusted_click: dispatched trusted mouse click via CDP (like a real mouse).'
            : 'cdp_trusted_fill: focused and typed via CDP (like a real keyboard).';
        const partialNote =
          action === 'fill' && isFillPartial()
            ? 'cdp_partial_dispatch: the input sequence was partially dispatched (value may be partially applied); do NOT retry the same fill — verify the field state first.'
            : clickPartial
              ? 'cdp_partial_dispatch: the mouse press was dispatched but the release was not confirmed; do NOT retry the same click — verify the page state first.'
              : null;
        cdpFirstResult = {
          ok: true,
          url: actedUrl,
          title: aRes?.ok === true && typeof aRes.title === 'string' ? aRes.title : '',
          element: normalizeActionElement(rRes.element),
          notes: [...stateNotes, actNote, ...(partialNote ? [partialNote] : []), ...aNotes],
        };
      }
    }
  }
  // P0:CDP 已派发输入时绝不能再发原合成动作(会双击/双填/双提交)——必须先返回
  if (cdpFirstResult) return cdpFirstResult;

  let outcome = await requestWithTimeout();
  if (outcome.kind === 'timeout') {
    // 挂死:动作已派发一次,绝不能重发;降级成功,状态由 click_element 的 tab 变化报告补足
    if (action === 'resolve') return null;
    let currentUrl = url;
    try {
      const tab = await browser.tabs.get(tabId);
      if (tab?.url?.startsWith('http')) currentUrl = tab.url;
    } catch {
      /* tab 已关闭:保留进入时 url */
    }
    outcome = {
      kind: 'response',
      res: degradedSuccess(
        currentUrl,
        'response_timeout: the page did not report back (it may have been backgrounded or navigated). The action was dispatched once; its final state is unconfirmed.',
      ),
    };
  } else if (outcome.kind === 'rejected') {
    // 接收方销毁:同 tab 导航(content 上下文随导航重建)= 动作已生效,不能重发;
    // URL 未变 = content script 缺失,走既有补注入重试
    let currentUrl: string | null = null;
    try {
      const tab = await browser.tabs.get(tabId);
      if (tab?.url?.startsWith('http')) currentUrl = tab.url;
    } catch {
      /* closed */
    }
    if (action !== 'resolve' && currentUrl && currentUrl !== url) {
      outcome = {
        kind: 'response',
        res: degradedSuccess(
          currentUrl,
          'navigation_confirmed: the page navigated before the action reported back (the content context is recreated per navigation). The action was dispatched once; its final state is unconfirmed.',
        ),
      };
    } else {
      const injected = await ensureContentScript(tabId);
      if (!injected) return null;
      const retry = await requestWithTimeout();
      if (retry.kind === 'timeout') {
        if (action === 'resolve') return null;
        outcome = {
          kind: 'response',
          res: degradedSuccess(
            currentUrl ?? url,
            'response_timeout: the page did not report back after script injection. The action was dispatched once; its final state is unconfirmed.',
          ),
        };
      } else if (retry.kind === 'rejected') {
        return null;
      } else {
        outcome = retry;
      }
    }
  }
  // CDP 可信执行成功链:直接返回(resolve → CDP act → after 已完成,notes 已含注记)
  const res = outcome.kind === 'response' ? outcome.res : undefined;
  if (
    !res ||
    typeof res !== 'object' ||
    typeof res.url !== 'string' ||
    typeof res.ok !== 'boolean'
  ) {
    return null;
  }
  if (res.ok) {
    const baseNotes = Array.isArray(res.notes) ? res.notes.filter((n): n is string => typeof n === 'string') : [];
    // scroll 专用:合成 wheel 未观察到位移 → CDP 平滑滚动手势(含原生默认滚动;合成被 isTrusted 拒时唯一真鼠标等价路径)。
    // ⚠ CDP yDistance 方向与 wheel 相反(正 = 向上):此处取反;缺省距离与合成路径统一(~360px)
    if (action === 'scroll' && res.moved === false) {
      const vw = res.viewport?.width ?? 800;
      const vh = res.viewport?.height ?? 600;
      const vertical = params.direction === 'up' || params.direction === 'down';
      const viewportPx = vertical ? vh : vw;
      const distance =
        typeof params.amount === 'number' && params.amount > 0
          ? Math.min(Math.round(params.amount), 10000)
          : Math.min(360, Math.max(120, Math.round(viewportPx * 0.3)));
      const dirSign = params.direction === 'up' || params.direction === 'left' ? 1 : -1;
      const cx = Math.max(1, Math.round(vw / 2));
      const cy = Math.max(1, Math.round(vh / 2));
      // 浏览器输入互斥(操作级):滚动手势持锁串行;锁内领取连接租约
      const gestureState = await withCdpInputLock(() =>
        synthesizeTrustedScrollGesture(
          tabId,
          cx,
          cy,
          vertical ? 0 : dirSign * distance,
          vertical ? dirSign * distance : 0,
          800,
          cdpLease(),
        ),
      );
      if (gestureState === 'dispatched') {
        await new Promise<void>((resolve) => setTimeout(resolve, 600));
        baseNotes.push(
          'cdp_trusted_scroll_gesture: dispatched a smooth scroll gesture via CDP (like a real trackpad swipe); the page should glide naturally.',
        );
      } else if (gestureState === 'partial_or_unknown') {
        // 命令已发出但结果未确认:禁止换路径重发(避免双滚)
        baseNotes.push(
          'cdp_scroll_unconfirmed: the scroll gesture command was sent but not confirmed; do NOT retry immediately — check the page state first.',
        );
      } else {
        baseNotes.push(
          'cdp_fallback_unavailable: could not attach the debugger (browser-internal page or already inspected by DevTools/another extension).',
        );
        // CDP 不可用 → JS 滚动条快路径(最后承底:chrome:// 页/DevTools 占用;行为与真实鼠标不一致)
        currentMode = 'js';
        const jsOutcome = await requestWithTimeout();
        const jsRes = jsOutcome.kind === 'response' ? jsOutcome.res : undefined;
        if (jsRes?.ok === true) {
          const jsNotes = Array.isArray(jsRes.notes)
            ? jsRes.notes.filter((n): n is string => typeof n === 'string')
            : [];
          return {
            ok: true,
            url: jsRes.url,
            title: typeof jsRes.title === 'string' ? jsRes.title : '',
            element: normalizeActionElement(jsRes.element),
            notes: [...baseNotes, ...jsNotes],
            moved: jsRes.moved,
          };
        }
      }
    }
    return {
      ok: true,
      url: res.url,
      title: typeof res.title === 'string' ? res.title : '',
      element: normalizeActionElement(res.element),
      notes: baseNotes,
    };
  }
  const reasons = ['not_found', 'ambiguous', 'option_not_found', 'unsupported_element', 'invalid_value'];
  return {
    ok: false,
    url: res.url,
    reason: reasons.includes(res.reason as never) ? res.reason : 'not_found',
    matches: Array.isArray(res.matches)
      ? res.matches.flatMap((m) => {
          if (!m || typeof m !== 'object') return [];
          const x = m as Record<string, unknown>;
          if (typeof x.tagName !== 'string') return [];
          return [{
            ordinal: typeof x.ordinal === 'number' && x.ordinal > 0 ? x.ordinal : 1,
            tagName: x.tagName,
            preview: typeof x.preview === 'string' ? x.preview : '',
          }];
        })
      : undefined,
    options: Array.isArray(res.options) ? res.options.filter((o): o is string => typeof o === 'string') : undefined,
    alternatives: Array.isArray(res.alternatives)
      ? res.alternatives.filter((a): a is string => typeof a === 'string')
      : undefined,
  };
}

/** 宽松透传元素摘要;字段不合格返回 undefined */
function normalizeActionElement(v: unknown): ResolvedActionElement | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const x = v as Record<string, unknown>;
  if (typeof x.role !== 'string' || x.role.length === 0 || typeof x.name !== 'string') return undefined;
  return {
    role: x.role,
    name: x.name,
    ordinal: typeof x.ordinal === 'number' && x.ordinal > 0 ? x.ordinal : 1,
    tagName: typeof x.tagName === 'string' ? x.tagName : '',
    preview: typeof x.preview === 'string' ? x.preview : '',
  };
}
