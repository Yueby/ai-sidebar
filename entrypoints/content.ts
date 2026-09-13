import {
  PAGE_ACTION_MESSAGE,
  PICK_ELEMENT_MESSAGE,
  PICK_ELEMENT_RESULT_MESSAGE,
  READ_PAGE_MESSAGE,
  SEARCH_ELEMENT_MESSAGE,
  SEARCH_ELEMENT_LIMIT,
} from '@/lib/types';
import { isThinText, textWindow } from '@/lib/pageTextWindow';
// type-only:编译期擦除(树节点形状与 sidepanel 侧同源)
import type { A11yNode } from '@/lib/a11yTree';
// type-only:编译期擦除,不引入运行时代码(载荷形状与 sidepanel 侧同源)
import type { PageActionResult, ResolvedActionElement, SearchElementsResult } from '@/lib/pageContext';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  main() {
    /** 正文长度上限(块边界截断,而非硬切) */
    const TEXT_LIMIT = 12000;
    /** read_element 返回的 outerHTML 字符上限(超出截断并标记) */
    const ELEMENT_HTML_LIMIT = 12000;
    /** 首提结果低于该长度视为 SPA 未渲染完,等待后重试一次 */
    const SHORT_THRESHOLD = 200;
    /** document.readyState === 'complete' 的最长等待 */
    const READY_TIMEOUT = 2000;
    /** 过短重试前的等待 */
    const RETRY_DELAY = 500;

    /** 结构性噪音容器(可见性过滤之外,按标签直接剔除) */
    const SKIP_TAGS = new Set([
      'SCRIPT',
      'STYLE',
      'NOSCRIPT',
      'TEMPLATE',
      'NAV',
      'FOOTER',
      'HEADER',
      'ASIDE',
      'FORM',
      'IFRAME',
    ]);
    const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

    /** 计算样式可见性缓存:保证每个元素只调一次 getComputedStyle */
    const visibilityCache = new WeakMap<Element, boolean>();

    /** 隐藏判定:祖先链上的结构性隐藏([hidden]/[aria-hidden] 等)+ 计算样式 */
    function isHidden(el: Element): boolean {
      const cached = visibilityCache.get(el);
      if (cached !== undefined) return cached;
      let hidden =
        el.closest('script, style, template, noscript, [hidden], [aria-hidden="true"]') !== null;
      if (!hidden) {
        const style = getComputedStyle(el);
        hidden = style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
      }
      visibilityCache.set(el, hidden);
      return hidden;
    }

    /** 行内空白坍缩:连续空格/Tab 坍缩为一个空格,保留换行(不跨行坍缩) */
    function collapseInline(text: string): string {
      return text
        .replace(/[ \t\f\v\r]+/g, ' ')
        .replace(/ ?\n ?/g, '\n')
        .trim();
    }

    /** 行内内容转 Markdown:strong/em → 强调,br → 换行,跳过隐藏/噪音元素 */
    function inlineText(node: Node): string {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const el = node as Element;
      if (isHidden(el) || SKIP_TAGS.has(el.tagName)) return '';
      if (el.tagName === 'BR') return '\n';
      const inner = inlineOf(el);
      if (el.tagName === 'STRONG' || el.tagName === 'B') {
        const text = inner.trim();
        return text ? `**${text}**` : inner;
      }
      if (el.tagName === 'EM' || el.tagName === 'I') {
        const text = inner.trim();
        return text ? `*${text}*` : inner;
      }
      return inner;
    }

    /** 元素的全部行内内容 */
    function inlineOf(el: Element): string {
      return Array.from(el.childNodes)
        .map(inlineText)
        .join('');
    }

    /** pre → 围栏代码块,保留内部换行与缩进(不坍缩) */
    function renderPre(pre: Element): string {
      const code = (pre.textContent ?? '').replace(/\n+$/, '');
      if (!code.trim()) return '';
      const lang = pre.querySelector('code')?.className.match(/language-([\w#+.-]+)/)?.[1] ?? '';
      // 代码里出现连续反引号时加长围栏,避免提前闭合
      const fence = '`'.repeat(Math.max(3, (code.match(/`{3,}/)?.[0].length ?? 0) + 1));
      return `${fence}${lang}\n${code}\n${fence}`;
    }

    /** ul/ol → Markdown 列表(嵌套列表缩进两格) */
    function renderList(list: Element, indent: string): string {
      const ordered = list.tagName === 'OL';
      const lines: string[] = [];
      let index = 1;
      for (const li of Array.from(list.children)) {
        if (li.tagName !== 'LI' || isHidden(li)) continue;
        const nestedLists = Array.from(li.children).filter(
          (c) => c.tagName === 'UL' || c.tagName === 'OL',
        );
        let inline = '';
        li.childNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = (node as Element).tagName;
            if (tag === 'UL' || tag === 'OL') return;
          }
          inline += inlineText(node);
        });
        const text = collapseInline(inline);
        if (text) lines.push(`${indent}${ordered ? `${index}. ` : '- '}${text}`);
        for (const nested of nestedLists) {
          lines.push(renderList(nested, `${indent}  `));
        }
        index += 1;
      }
      return lines.filter(Boolean).join('\n');
    }

    /** table → 管道表格(首行视为表头) */
    function renderTable(table: Element): string {
      const rows = Array.from(table.querySelectorAll('tr')).filter(
        (tr) => tr.closest('table') === table && !isHidden(tr),
      );
      const data = rows
        .map((tr) =>
          Array.from((tr as HTMLTableRowElement).cells).map((cell) =>
            collapseInline(inlineOf(cell)),
          ),
        )
        .filter((cells) => cells.some((c) => c.length > 0));
      if (data.length === 0) return '';
      const width = Math.max(...data.map((row) => row.length));
      const renderRow = (cells: string[]) => {
        const padded = [...cells];
        while (padded.length < width) padded.push('');
        return `| ${padded.join(' | ')} |`;
      };
      const header = data[0];
      if (!header) return '';
      const body = data.slice(1);
      return [
        renderRow(header),
        `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
        ...body.map(renderRow),
      ].join('\n');
    }

    /** 递归渲染容器子节点为块列表(含容器内的散落文本) */
    function renderChildren(el: Element): string[] {
      const blocks: string[] = [];
      el.childNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const block = renderBlock(node as Element);
          if (block) blocks.push(block);
        } else if (node.nodeType === Node.TEXT_NODE) {
          const text = collapseInline(node.textContent ?? '');
          if (text) blocks.push(text);
        }
      });
      return blocks;
    }

    /** 块级元素 → Markdown 块;未知容器标签递归其子节点 */
    function renderBlock(el: Element): string {
      if (isHidden(el) || SKIP_TAGS.has(el.tagName)) return '';
      const tag = el.tagName;
      if (HEADING_TAGS.has(tag)) {
        const text = collapseInline(inlineOf(el));
        return text ? `${'#'.repeat(Number(tag[1]))} ${text}` : '';
      }
      switch (tag) {
        case 'P':
          return collapseInline(inlineOf(el));
        case 'PRE':
          return renderPre(el);
        case 'UL':
        case 'OL':
          return renderList(el, '');
        case 'TABLE':
          return renderTable(el);
        case 'HR':
          return '---';
        case 'BLOCKQUOTE': {
          const inner = renderChildren(el);
          return inner
            .map((block) =>
              block
                .split('\n')
                .map((line) => `> ${line}`)
                .join('\n'),
            )
            .join('\n>\n');
        }
        default:
          return renderChildren(el).join('\n\n');
      }
    }

    /** 可读性优先:article/main/[role=main](可见时)兜底 body */
    function selectRoot(): Element {
      const candidate = document.querySelector('article, main, [role="main"]');
      return candidate && !isHidden(candidate) ? candidate : (document.body ?? candidate);
    }

    /** 块边界截断:达到上限时停在块尾,不切句子中段 */
    function truncateBlocks(
      blocks: string[],
      limit: number,
      anchor: 'head' | 'tail' = 'head',
    ): { text: string; truncated: boolean } {
      if (anchor === 'tail') {
        // 聊天页/长对话页:最新内容在尾部,反向保留尾部窗口
        let total = 0;
        const kept: string[] = [];
        for (let i = blocks.length - 1; i >= 0; i--) {
          const block = blocks[i]!;
          const cost = block.length + (kept.length > 0 ? 2 : 0);
          if (total + cost > limit) break;
          kept.unshift(block);
          total += cost;
        }
        if (kept.length === 0) {
          const last = blocks[blocks.length - 1] ?? '';
          return {
            text: `…(前段内容已截断)\n\n${last.slice(Math.max(0, last.length - limit))}`,
            truncated: true,
          };
        }
        return { text: `…(前段内容已截断)\n\n${kept.join('\n\n')}`, truncated: true };
      }
      let size = 0;
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (block === undefined) break;
        const next = size + (i > 0 ? 2 : 0) + block.length;
        if (next > limit) {
          // 首块即超限时只能硬切该块,否则保留到上一个块尾
          const head = i === 0 ? block.slice(0, limit) : blocks.slice(0, i).join('\n\n');
          return { text: `${head}\n\n…(内容过长已截断)`, truncated: true };
        }
        size = next;
      }
      return { text: blocks.join('\n\n'), truncated: false };
    }


    /** 提取流水线:选根 → 块级遍历 → 轻量 Markdown → 块边界截断 */
    function extractMarkdown(section: 'head' | 'tail', full = false): {
      text: string;
      truncated: boolean;
      /** 全文长度(截断前) */
      totalLength: number;
    } {
      const root = selectRoot();
      if (!root) return { text: '', truncated: false, totalLength: 0 };
      const blocks = renderChildren(root);
      const joined = blocks.join('\n\n');
      // full=true 供续读窗口:返回全文,由调用方按 offset 取窗口后再截断
      if (full) return { text: joined, truncated: false, totalLength: joined.length };
      return { ...truncateBlocks(blocks, TEXT_LIMIT, section), totalLength: joined.length };
    }

    /** 页面状态指纹(步④):URL+标题+正文规模+正交采样的 FNV-1a;模型跨两次读取比对即可判断页面是否/如何变化 */
    function pageFingerprint(): string {
      const text = document.body?.innerText ?? '';
      const material = `${location.href}|${document.title}|${text.length}|${text.slice(0, 400)}`;
      let hash = 0x811c9dc5;
      for (let i = 0; i < material.length; i++) {
        hash ^= material.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(36);
    }

    /** 等 document.readyState === 'complete'(上限 READY_TIMEOUT) */
    function waitForComplete(timeoutMs: number): Promise<void> {
      if (document.readyState === 'complete') return Promise.resolve();
      return new Promise((resolve) => {
        const cleanup = () => {
          clearTimeout(timer);
          document.removeEventListener('readystatechange', check);
        };
        const check = () => {
          if (document.readyState === 'complete') {
            cleanup();
            resolve();
          }
        };
        const timer = setTimeout(() => {
          cleanup();
          resolve();
        }, timeoutMs);
        document.addEventListener('readystatechange', check);
      });
    }

    /** 语义提取依赖缓存:任一库加载失败则缓存降级(之后一直走手写兜底) */
    let semanticLibsPromise: Promise<{
      isProbablyReaderable: (doc: Document) => boolean;
      parseReadable: (doc: Document) => { content: string } | null;
      convertElementToMarkdown: (el: Element) => string;
    } | null> | null = null;

    /** 动态加载语义提取库(仅首次调用加载,冷启动零成本) */
    function loadSemanticLibs(): Promise<{
      isProbablyReaderable: (doc: Document) => boolean;
      parseReadable: (doc: Document) => { content: string } | null;
      convertElementToMarkdown: (el: Element) => string;
    } | null> {
      if (!semanticLibsPromise) {
        semanticLibsPromise = (async () => {
          const [{ Readability, isProbablyReaderable }, { convertElementToMarkdown }] =
            await Promise.all([import('@mozilla/readability'), import('dom-to-semantic-markdown')]);
          return {
            isProbablyReaderable,
            parseReadable: (doc: Document) => {
              const parsed = new Readability(doc).parse();
              return parsed?.content ? { content: parsed.content } : null;
            },
            convertElementToMarkdown,
          };
        })();
        semanticLibsPromise = semanticLibsPromise.catch(() => null);
      }
      return semanticLibsPromise;
    }

    /**
     * 语义提取路径:Readability 正文抽取 + dom-to-semantic-markdown 转 Markdown。
     * 门控不过/库加载失败/解析失败返回 null,由调用方走手写兜底,提取永不挂掉。
     */
    async function extractSemanticMarkdown(full = false): Promise<{
      text: string;
      truncated: boolean;
      /** 全文长度(截断前);续读提示需要它判断“还有没有后半段” */
      totalLength: number;
    } | null> {
      try {
        const libs = await loadSemanticLibs();
        if (!libs) return null;
        if (!libs.isProbablyReaderable(document)) return null;
        // Readability 会改写传入的 DOM,必须传克隆
        const parsed = libs.parseReadable(document.cloneNode(true) as Document);
        if (!parsed?.content) return null;
        const doc = new DOMParser().parseFromString(parsed.content, 'text/html');
        const root = doc.body.firstElementChild ?? doc.body;
        if (!root) return null;
        const markdown = libs.convertElementToMarkdown(root).trim();
        if (!markdown) return null;
        // full=true 供续读窗口:返回全文,由调用方按 offset 取窗口后再截断
        if (full) return { text: markdown, truncated: false, totalLength: markdown.length };
        return { ...truncateMarkdownText(markdown, TEXT_LIMIT), totalLength: markdown.length };
      } catch {
        return null;
      }
    }

    /** Markdown 文本的行级截断:块=段落/标题/围栏行,不切行中段 */
    function truncateMarkdownText(
      text: string,
      limit: number,
    ): { text: string; truncated: boolean } {
      if (text.length <= limit) return { text, truncated: false };
      const lines = text.split('\n');
      let size = 0;
      const kept: string[] = [];
      for (const line of lines) {
        const cost = line.length + (kept.length > 0 ? 1 : 0);
        if (size + cost > limit) break;
        kept.push(line);
        size += cost;
      }
      const first = kept[0] ?? lines[0];
      // 全部行都放不下时只能硬切首行
      const head = kept.length > 0 ? kept.join('\n') : (first ?? '').slice(0, limit);
      return { text: `${head}\n\n…(内容过长已截断)`, truncated: true };
    }

    /** SPA 稳定化:等加载完成;首提过短则等待后重试一次 */
    async function extractStable(
      section: 'head' | 'tail',
      waitStableMs = 0,
      waitText?: string,
      offset = 0,
    ): Promise<{
      title: string;
      url: string;
      text: string;
      truncated: boolean;
      fingerprint?: string;
      /** 全文长度(仅续读窗口请求时回报) */
      totalLength?: number;
      /** 窗口在全文中的真实起点(尾窗不为 0):供上层如实告知“展示的是哪一段” */
      windowStart?: number;
    }> {
      await waitForComplete(READY_TIMEOUT);
      // tail 与 offset 都必须在**未截断全文**上取窗口:先截断再取窗口会让 tail 拿到中段、
      // 让 offset 取不到 12000 之后的内容,且 truncated 会被误报为 false
      // (静默丢末尾、不给续读提示)。
      const wantFull = offset > 0 || section === 'tail';
      // 语义路径优先;门控不过/库不可用则手写兜底(含 isHidden 可见性过滤)
      let result = (await extractSemanticMarkdown(wantFull)) ?? extractMarkdown(section, wantFull);
      if (result.text.length < SHORT_THRESHOLD) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
        // 必须同样传 wantFull:否则过薄重试会把全文覆盖成截断版
        result = (await extractSemanticMarkdown(wantFull)) ?? extractMarkdown(section, wantFull);
      }
      // 有界稳定等待:文本长度连续两次采样一致才算稳定(流式输出/迟到的渲染);后台 tab 节流由 deadline 兜底
      if (waitStableMs > 0) {
        const deadline = Date.now() + waitStableMs;
        let lastLen = result.text.length;
        const needle = waitText?.trim().toLowerCase();
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          result = (await extractSemanticMarkdown(wantFull)) ?? extractMarkdown(section, wantFull);
          const found = needle ? result.text.toLowerCase().includes(needle) : false;
          // 过薄(空壳/骨架)不算“稳定”:否则 length 相同会立刻跳出,waitStableMs 对前端渲染页形同虚设
          const settled = result.text.length === lastLen && !isThinText(result.text);
          if (found || settled) break;
          lastLen = result.text.length;
        }
      }
      // 窗口化统一走 textWindow(尾窗 = 从 max(0,total-limit) 起取),并回报**真实窗口起点**:
      // 上层要据此告诉模型“展示的是全文哪一段、还有多少没给”。
      const total = result.totalLength;
      if (offset > 0) {
        const w = textWindow(result.text, offset, TEXT_LIMIT);
        return {
          title: document.title,
          url: location.href,
          fingerprint: pageFingerprint(),
          text: w.text,
          truncated: w.truncated,
          totalLength: w.totalLength,
          windowStart: w.start,
        };
      }
      if (section === 'tail') {
        const w = textWindow(result.text, Math.max(0, total - TEXT_LIMIT), TEXT_LIMIT);
        return {
          title: document.title,
          url: location.href,
          fingerprint: pageFingerprint(),
          text: w.text,
          truncated: w.truncated,
          totalLength: w.totalLength,
          windowStart: w.start,
        };
      }
      // totalLength 恒回报(截断前真实长度):否则工具侧算不出“还有没有后半段”,续读提示不会出现
      return {
        title: document.title,
        url: location.href,
        fingerprint: pageFingerprint(),
        text: result.text,
        truncated: result.truncated,
        totalLength: result.totalLength,
        windowStart: 0,
      };
    }

    // ===== 页面元素选择模式 =====

    let pickActive = false;

    /** 元素可见文本预览(截 100 字) */
    function elementPreview(el: Element): string {
      return collapseInline(el.textContent ?? '').slice(0, 100);
    }

    /** 元素图片信息(供 read_element 交给 vision 模型):src 用实际渲染源,currentSrc||src;rect 为视口 CSS 像素(×DPR 前) */
    function elementImagePayload(img: HTMLImageElement): {
      src: string;
      alt: string;
      naturalWidth: number;
      naturalHeight: number;
      rect: { x: number; y: number; w: number; h: number };
    } {
      const r = img.getBoundingClientRect();
      return {
        src: img.currentSrc || img.src || '',
        alt: img.alt || '',
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      };
    }

    /** 收集一个子树内所有元素,含其后代的开放 shadow root(选择器匹配要跨边界) */
    function queryWithin(root: ParentNode, selector: string): Element[] {
      const out: Element[] = [];
      const collect = (node: ParentNode): void => {
        // 入参自身可能就是 shadow 宿主:它的 querySelectorAll 只看光 DOM 子节点,
        // 宿主光 DOM 为空时(常见)不显式下潜就永远查不到 shadow 内部(曾致 #host p 全败)
        const ownRoot = (node as Element).shadowRoot;
        if (ownRoot) collect(ownRoot);
        for (const el of Array.from(node.querySelectorAll('*'))) {
          if (el.matches(selector)) out.push(el);
          if (el.shadowRoot) collect(el.shadowRoot);
        }
      };
      collect(root);
      return out;
    }

    /**
     * 深度查询:支持 `#shadow-host p` 这类**跨 shadow 边界**的后代选择器。
     * 朴素的 `el.matches('#host p')` 在 shadow 内部恒为 false——选择器引擎不会把
     * light DOM 的祖先与 shadow 内的元素链成一条路径,因此必须按段逐层下潜。
     */
    function querySelectorDeep(selector: string): Element | null {
      try {
        const direct = document.querySelector(selector);
        if (direct) return direct;
      } catch {
        return null; // 非法 selector:按 not-found 处理
      }
      const segments = selector.trim().split(/\s+/).filter(Boolean);
      if (segments.length < 2) {
        // 单段:可能是 shadow 内部的元素
        const inShadow = queryWithin(document, selector);
        return inShadow[0] ?? null;
      }
      let scopes: ParentNode[] = [document];
      let matched: Element[] = [];
      for (const segment of segments) {
        matched = [];
        for (const scope of scopes) {
          try {
            matched.push(...queryWithin(scope, segment));
          } catch {
            return null;
          }
        }
        if (matched.length === 0) return null;
        scopes = matched;
      }
      return matched[0] ?? null;
    }

    /**
     * 定位元素并返回 outerHTML(原始 HTML,字符上限 12000);不存在返回 null。
     * 双轨寻址:locator(role+name+ordinal,与动作侧同一套解析与序号口径)优先;
     * 否则 CSS selector(**穿开放 shadow root**)。
     */
    async function resolveElementPayload(target: {
      selector?: string;
      role?: string;
      name?: string;
      ordinal?: number;
    }): Promise<{
      found: boolean;
      tagName: string;
      html: string;
      truncated: boolean;
      preview: string;
      /** 元素为 IMG 或包含 IMG(取前 3 张)时的图片列表;html 之外并列返回 */
      images: ReturnType<typeof elementImagePayload>[];
      /** 页面 devicePixelRatio(截图裁剪用) */
      dpr: number;
      /** 页面状态指纹(步④) */
      fingerprint?: string;
    } | null> {
      let el: Element | null = null;
      if (typeof target.role === 'string' && target.role.trim()) {
        const libs = await loadAccessibilityLibs();
        if (!libs) return null;
        const locator = parseLocator({
          role: target.role,
          name: typeof target.name === 'string' ? target.name : '',
          ordinal: target.ordinal,
        });
        if (!locator) return null;
        const resolved = resolveLocator(enumerateInteractiveElements(libs), locator);
        if (resolved.status !== 'ok') return null;
        el = resolved.hit.el;
      } else if (typeof target.selector === 'string' && target.selector.trim()) {
        el = querySelectorDeep(target.selector);
      }
      if (!el) return null;
      const rawHtml = el.outerHTML;
      const truncated = rawHtml.length > ELEMENT_HTML_LIMIT;
      const imgEls: HTMLImageElement[] =
        el.tagName === 'IMG'
          ? [el as HTMLImageElement]
          : Array.from(el.querySelectorAll('img')).slice(0, 3);
      const images = imgEls.map(elementImagePayload).filter((i) => i.src.length > 0);
      return {
        found: true,
        tagName: el.tagName.toLowerCase(),
        html: truncated ? rawHtml.slice(0, ELEMENT_HTML_LIMIT) : rawHtml,
        truncated,
        preview: elementPreview(el),
        images,
        dpr: window.devicePixelRatio || 1,
        fingerprint: pageFingerprint(),
      };
    }

    /** 框选结果回传给 sidepanel(无接收方时静默失败,不影响页面) */
    async function reportPick(el: Element, finder: (input: Element) => string): Promise<void> {
      try {
        await browser.runtime.sendMessage({
          type: PICK_ELEMENT_RESULT_MESSAGE,
          selector: finder(el),
          tagName: el.tagName.toLowerCase(),
          snippet: el.outerHTML.slice(0, 500),
          preview: elementPreview(el),
        });
      } catch {
        // sidepanel 未开启等:忽略
      }
    }

    /** 进入选择模式:overlay 高亮 + window capture 拦截;点击回传结果,ESC 退出 */
    async function enterPickMode(): Promise<void> {
      if (pickActive) return;
      let finder: (input: Element) => string;
      try {
        ({ finder } = await import('@medv/finder'));
      } catch {
        return; // selector 生成库加载失败:不进入选择模式
      }
      if (pickActive) return;
      pickActive = true;

      // overlay 容器与高亮框:pointer-events:none 保证不挡页面交互(elementFromPoint 也会跳过)
      const container = document.createElement('div');
      container.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
      const box = document.createElement('div');
      box.style.cssText =
        'position:fixed;display:none;outline:2px solid #2563eb;outline-offset:0;'
        + 'border-radius:6px;background:rgba(37,99,235,0.12);pointer-events:none;';
      container.appendChild(box);
      document.documentElement.appendChild(container);

      let currentTarget: Element | null = null;

      const updateBox = () => {
        if (!currentTarget) {
          box.style.display = 'none';
          return;
        }
        const rect = currentTarget.getBoundingClientRect();
        box.style.display = 'block';
        box.style.left = `${rect.left}px`;
        box.style.top = `${rect.top}px`;
        box.style.width = `${Math.max(rect.width, 0)}px`;
        box.style.height = `${Math.max(rect.height, 0)}px`;
      };

      const cleanup = () => {
        if (!pickActive) return;
        pickActive = false;
        currentTarget = null;
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('mousedown', onSwallow, true);
        window.removeEventListener('mouseup', onSwallow, true);
        window.removeEventListener('click', onClick, true);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('scroll', updateBox, true);
        window.removeEventListener('resize', updateBox);
        container.remove();
      };

      const onMove = (e: MouseEvent) => {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        currentTarget = el instanceof Element ? el : null;
        updateBox();
      };
      // 点击盲区:吞掉按下/抬起,避免页面聚焦/选区变化(click 单独处理)
      const onSwallow = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
      };
      const onClick = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const el = document.elementFromPoint(e.clientX, e.clientY);
        cleanup();
        if (el instanceof Element) void reportPick(el, finder);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        cleanup();
      };

      // 全部挂 window capture:先于页面自身监听执行,滚动/resize 被动刷新高亮位置
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('mousedown', onSwallow, true);
      window.addEventListener('mouseup', onSwallow, true);
      window.addEventListener('click', onClick, true);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('scroll', updateBox, { capture: true, passive: true });
      window.addEventListener('resize', updateBox, { passive: true });
    }

    // ===== 交互元素发现(search_element;三期步① ARIA 定位发现层)=====

    /** 交互 ARIA role 白名单(规格 8.4 自研 role 子集;自定义 listbox 的 li[role=option] 亦在此) */
    const INTERACTIVE_ROLES = new Set([
      'button',
      'link',
      'textbox',
      'searchbox',
      'combobox',
      'checkbox',
      'radio',
      'switch',
      'slider',
      'spinbutton',
      'tab',
      'menuitem',
      'menuitemcheckbox',
      'menuitemradio',
      'option',
      'treeitem',
      'listbox',
    ]);

    /** 不下钻的子树:原生 <select>/<datalist> 的选项由外层 combobox 代表,避免吃掉预算 */
    const SEARCH_SKIP_SUBTREE_SELECTOR = 'option, optgroup, datalist';

    /** dom-accessibility-api 模块类型(运行时经动态导入加载,冷启动零成本) */
    type AccessibilityLibs = typeof import('dom-accessibility-api');

    /** 可访问性库缓存:加载失败则缓存降级(之后一直返回错误载荷) */
    let accessibilityLibsPromise: Promise<AccessibilityLibs | null> | null = null;

    function loadAccessibilityLibs(): Promise<AccessibilityLibs | null> {
      if (!accessibilityLibsPromise) {
        accessibilityLibsPromise = import('dom-accessibility-api').catch(() => null);
      }
      return accessibilityLibsPromise;
    }

    /** DOM 标签启发:getRole 未映射但可交互的 HTML(input 含 password/date 等无隐式 ARIA role 的类型) */
    function isDomInteractive(el: Element): boolean {
      switch (el.localName) {
        case 'input': {
          const type = (el as HTMLInputElement).type;
          return type !== 'hidden' && type !== 'file';
        }
        case 'textarea':
        case 'select':
        case 'button':
        case 'summary':
          return true;
        case 'a':
        case 'area':
          return el.hasAttribute('href');
        default:
          return (el as HTMLElement).isContentEditable;
      }
    }

    /** 候选判定:DOM 标签启发 ∪ tabIndex≥0(规格白名单语义,自定义可焦容器) ∪ 交互 role 白名单 */
    function isInteractiveCandidate(el: Element, getRole: AccessibilityLibs['getRole']): boolean {
      if (isDomInteractive(el)) return true;
      const tabIndex = (el as HTMLElement).tabIndex;
      if (typeof tabIndex === 'number' && tabIndex >= 0) return true;
      // ARIA role 大小写不敏感;库对显式 role 属性原样返回,统一小写后匹配
      const role = getRole(el)?.toLowerCase() ?? null;
      return role !== null && INTERACTIVE_ROLES.has(role);
    }

    /**
     * 生效 role = getRole(显式 role 属性 + 隐式映射),另兑底无隐式 ARIA role 的交互 HTML
     * (password/date 等文本类 input、contenteditable → textbox);presentation/none 与 file
     * input 视为不可寻址直接丢弃;tabIndex-only 纯容器 → generic。
     * 步② click/fill 的 locator 解析必须复用同一函数,保证 [N] 序号与 role 值可重现。
     */
    function effectiveRole(el: Element, getRole: AccessibilityLibs['getRole']): string | null {
      // ARIA role 大小写不敏感;库对显式 role 属性原样返回,统一小写(白名单匹配与输出同此)
      const role = getRole(el)?.toLowerCase() ?? null;
      if (role === 'presentation' || role === 'none') return null;
      if (role) return role;
      if ((el as HTMLElement).isContentEditable) return 'textbox';
      if (el.localName === 'input') {
        // file input 无法以 role+name 语义寻址,兑现“不可寻址直接丢弃”(否则 tabIndex 分支会把它
        // 以假 textbox 入列,污染无名文本框序号组)
        return (el as HTMLInputElement).type === 'file' ? null : 'textbox';
      }
      if (el.localName === 'textarea') return 'textbox';
      return 'generic';
    }

    /** 可见性 = 未被 AX 排除(aria-hidden 子树)+ 渲染可见(checkVisibility:display:none 祖先/visibility/opacity)+ 非零尺寸 */
    function isElementVisible(el: Element): boolean {
      if (el.closest('[aria-hidden="true"]')) return false;
      // checkVisibility 自 Chrome 105 起可用(manifest 已钉 135+):覆盖 display:none 祖先/visibility/opacity
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0;
    }

    /** 收集 body + 开放 shadow root 内的全部元素(文档序;跳过 option/optgroup/datalist 子树,iframe 内容不穿透) */
    function collectWalkableElements(): Element[] {
      const out: Element[] = [];
      const visit = (root: ParentNode): void => {
        const scope = root === document ? document.body : root;
        if (!scope) return;
        for (const el of scope.querySelectorAll('*')) {
          if (el.closest(SEARCH_SKIP_SUBTREE_SELECTOR)) continue;
          out.push(el);
          if (el.shadowRoot) visit(el.shadowRoot);
          // 同源 iframe 内容(跨源取 contentDocument 会抛,故 try)
          if (el.tagName === 'IFRAME') {
            try {
              const doc = (el as HTMLIFrameElement).contentDocument;
              if (doc?.body) visit(doc.body);
            } catch {
              /* 跨源 frame:不可达,由 collectFrameNotes 报告 */
            }
          }
        }
      };
      visit(document);
      return out;
    }

    /** 全量交互元素(search 输出与步② locator 解析的单一来源;文档序,序号在 role+name 组内全量计数) */
    interface EnumeratedElement {
      el: Element;
      role: string;
      name: string;
      ordinal: number;
      disabled: boolean;
      visible: boolean;
      /** 文本型 input 的真实 type(password/email/tel/url/日期族等,与 role 冗余时有区分价值) */
      inputType?: string;
      /** 无名元素的定位提示(title/data-testid/aria-keyshortcuts/placeholder,首一个非空) */
      hint?: string;
      /** 链接目标 */
      href?: string;
      /** 当前值(密码字段不回传) */
      value?: string;
      /** 复选框/单选框选中态 */
      checked?: boolean;
    }

    /** 对输入类元素,名称/预览优先用 placeholder/value(大量真实表单只有 placeholder 没有 label) */
    function elementActionPreview(el: Element): string {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const hint = el.placeholder || el.value;
        if (hint) return hint.slice(0, 80);
      }
      return elementPreview(el).slice(0, 80);
 }

    function enumerateInteractiveElements(libs: AccessibilityLibs): EnumeratedElement[] {
      const { getRole, computeAccessibleName, isDisabled } = libs;
      const ordinals = new Map<string, number>();
      const out: EnumeratedElement[] = [];
      for (const el of collectWalkableElements()) {
        if (!isInteractiveCandidate(el, getRole)) continue;
        const role = effectiveRole(el, getRole);
        if (!role) continue;
        let name = '';
        try {
          name = computeAccessibleName(el) ?? '';
        } catch {
          name = '';
        }
        name = name.replace(/\s+/g, ' ').trim();
        // placeholder 兑底名称:真实网站大量字段只有 placeholder 没有 label,无名会导致无法寻址
        if (!name && (isInputEl(el) || isTextareaEl(el))) {
          const placeholder = (el as HTMLInputElement | HTMLTextAreaElement).placeholder;
          if (placeholder) name = placeholder.replace(/\s+/g, ' ').trim();
        }
        // 降噪:非交互 role 且无名且非 DOM 交互标签(tabIndex≥0 带进来的纯容器)对 role+name 寻址无意义
        if (!INTERACTIVE_ROLES.has(role) && !name && !isDomInteractive(el)) continue;
        const key = `${role}\u0000${name}`;
        const ordinal = (ordinals.get(key) ?? 0) + 1;
        ordinals.set(key, ordinal);
        // 文本型 input 的真实 type 提示(密码框直接现形;排除已被 role 表达的类型)
        const genericTypes = [
          'text', 'hidden', 'checkbox', 'radio', 'button', 'submit', 'reset',
          'image', 'file', 'search', 'range', 'number',
        ];
        const inputType =
          isInputEl(el) && !genericTypes.includes(inputTypeOf(el)) ? inputTypeOf(el) : undefined;
        out.push({
          el,
          role,
          name,
          ordinal,
          disabled: isDisabled(el),
          visible: isElementVisible(el),
          inputType,
          href: isAnchorEl(el) ? el.getAttribute('href') ?? undefined : undefined,
          value: a11yValue(el),
          checked:
            inputTypeOf(el) === 'checkbox' || inputTypeOf(el) === 'radio'
              ? (el as HTMLInputElement).checked
              : undefined,
        });
      }
      return out;
    }

    /**
     * 元素类型判定**必须跨 realm 安全**:同源 iframe 里的元素不是本窗口构造器的实例,
     * `el instanceof HTMLInputElement` 会漏判 —— 后果不只是丢字段,而是密码保护被整个跳过
     * (例如 iframe 内 `type=password` 的框会落到 aria-valuetext 分支把值回传)。
     */
    const isInputEl = (el: Element): boolean => el.localName === 'input';
    const isTextareaEl = (el: Element): boolean => el.localName === 'textarea';
    const isSelectEl = (el: Element): boolean => el.localName === 'select';
    const isAnchorEl = (el: Element): boolean => el.localName === 'a';
    const inputTypeOf = (el: Element): string =>
      isInputEl(el) ? (((el as HTMLInputElement).type || 'text') as string).toLowerCase() : '';
    const isPasswordEl = (el: Element): boolean => inputTypeOf(el) === 'password';

    /** 截断留痕:模型必须能区分"原文到底"与"被截断"(静默 slice 会让它以为内容完整) */
    function clipMarked(value: string, max: number): string {
      return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
    }

    interface FrameInfo {
      src: string;
      label?: string;
      sameOrigin: boolean;
      doc: Document | null;
    }

    /** iframe 的三态判定(同源可读 / 同源未加载 / 跨源);树与其说明节点共用这一份 */
    function frameInfo(el: Element): FrameInfo {
      const rawSrc = el.getAttribute('src') ?? '';
      // 相对 URL 按**该元素所在文档**的 base 解析(嵌套 frame 与 <base> 才正确)
      const base = el.ownerDocument?.baseURI ?? location.href;
      let src = rawSrc;
      try {
        src = rawSrc ? new URL(rawSrc, base).href : '';
      } catch {
        src = rawSrc;
      }
      let sameOrigin = false;
      try {
        sameOrigin = Boolean(src) && new URL(src, base).origin === location.origin;
      } catch {
        sameOrigin = false;
      }
      let doc: Document | null = null;
      try {
        doc = (el as HTMLIFrameElement).contentDocument;
      } catch {
        doc = null;
      }
      const label = el.getAttribute('title') || undefined;
      return { src, label, sameOrigin, doc };
    }

    function frameNote(info: FrameInfo): string {
      const who = `iframe${info.label ? ` ${JSON.stringify(info.label)}` : ''} (${info.src || '(no src)'})`;
      return info.sameOrigin
        ? `same-origin ${who} — not loaded yet, read again after it finishes loading`
        : `cross-origin ${who} — its content is not accessible from this page; open_page that URL to read it.`;
    }

    /** 不可读 iframe 说明(同源可读的由树/枚举遍历覆盖):让模型知道内容在哪、怎么拿到 */
    function collectFrameNotes(): string[] {
      const notes: string[] = [];
      for (const frame of Array.from(document.querySelectorAll('iframe'))) {
        const info = frameInfo(frame);
        if (info.doc?.body) continue;
        notes.push(frameNote(info));
      }
      return notes;
    }

    /**
     * 交互元素清单(search_element 内容侧计算):全量枚举 → 可见优先预算截断。
     * 序号在全量上计数,输出选集不影响 [N] 与步② locator 解析的一致性。
     */
    async function collectInteractiveElements(
      rawQuery: unknown,
      includeHidden = false,
    ): Promise<SearchElementsResult | { error: string }> {
      const libs = await loadAccessibilityLibs();
      if (!libs) return { error: 'Failed to load the accessibility analysis library.' };

      const computeStartedAt = performance.now();
      let all = enumerateInteractiveElements(libs);
      // 跨源 iframe:显式报告而不是让调用方困惑于"为什么读不到"
      const frames = collectFrameNotes();
      // query 过滤:单串或多串数组(OR 语义,任一命中即保留),role/可访问名称的大小写不敏感子串匹配,
      // 先于预算截断(目标不在默认清单时的定位出路)
      const terms = (Array.isArray(rawQuery) ? rawQuery : [rawQuery])
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      if (terms.length > 0) {
        all = all.filter((e) => terms.some((t) => e.role.includes(t) || e.name.toLowerCase().includes(t)));
      }
      // hidden 默认排除(隐藏按钮噪音大);includeHidden 时保留并带 [hidden] 旗标
      if (!includeHidden) all = all.filter((e) => e.visible);
      const total = all.length;
      // 预算优先给可见元素(隐藏项多为折叠菜单/重复入口,行动价值低),组内保持文档序
      const visibleFirst = [
        ...all.filter((e) => e.visible),
        ...all.filter((e) => !e.visible),
      ];
      return {
        url: location.href,
        title: document.title,
        total,
        truncated: total > SEARCH_ELEMENT_LIMIT,
        durationMs: Math.round(performance.now() - computeStartedAt),
        elements: visibleFirst.slice(0, SEARCH_ELEMENT_LIMIT).map(({ el: _el, ...info }) => info),
        ...(frames.length > 0 ? { frames } : {}),
      };
    }

    // ===== 可访问性树(read_page mode='tree' 的内容侧采集)=====

    /** 承载语义的叶子角色:这些角色的短文本对"读懂页面"有直接价值(价格/说明等) */
    /** 不可作为结构文本输出的标签:script/style 源码既非页面内容又会误导模型 */
    const TREE_SKIP_TEXT_TAGS = new Set([
      'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE', 'BASE',
    ]);

    const TREE_TEXT_ROLES = new Set([
      'paragraph', 'text', 'statictext', 'listitem', 'cell', 'heading', 'term', 'definition', 'blockquote', 'caption',
    ]);

    /** 状态旗标:只取少量对理解/操作有意义的字段,避免输出膨胀 */
    function a11yStates(el: Element, disabled: boolean): string[] {
      const states: string[] = [];
      if (disabled) states.push('disabled');
      if (isInputEl(el) || isTextareaEl(el)) {
        const field = el as HTMLInputElement | HTMLTextAreaElement;
        if (field.required) states.push('required');
        if (field.readOnly) states.push('readonly');
        if (isPasswordEl(el)) states.push('password');
        const type = inputTypeOf(el);
        if (type === 'checkbox' || type === 'radio') {
          states.push((el as HTMLInputElement).checked ? 'checked' : 'unchecked');
        }
      }
      for (const attr of ['aria-checked', 'aria-expanded', 'aria-selected', 'aria-pressed'] as const) {
        const value = el.getAttribute(attr);
        if (value) states.push(`${attr.replace('aria-', '')}=${value}`);
      }
      const level = el.getAttribute('aria-level') ?? (/^H[1-6]$/.test(el.tagName) ? el.tagName.slice(1) : null);
      if (level) states.push(`level=${level}`);
      return states;
    }

    /** 表单值/aria-valuetext;密码字段**绝不回传值**(只留 password 旗标) */
    function a11yValue(el: Element): string | undefined {
      if (isInputEl(el)) {
        // 密码绝不回传(跨 realm 判定,iframe 内同样生效)
        if (isPasswordEl(el)) return undefined;
        const value = (el as HTMLInputElement).value;
        return value ? clipMarked(value, 60) : undefined;
      }
      if (isTextareaEl(el)) {
        const value = (el as HTMLTextAreaElement).value;
        return value ? clipMarked(value, 60) : undefined;
      }
      if (isSelectEl(el)) {
        const text = (el as HTMLSelectElement).selectedOptions[0]?.textContent
          ?.replace(/\s+/g, ' ')
          .trim();
        return text ? clipMarked(text, 60) : undefined;
      }
      const valueText = el.getAttribute('aria-valuetext');
      return valueText ? clipMarked(valueText, 60) : undefined;
    }

    interface CollectedTree {
      url: string;
      title: string;
      nodes: A11yNode[];
      total: number;
      truncated: boolean;
    }

    /**
     * 采集可访问性树(扁平前序,带 depth)。
     * 穿透:开放 shadow root + **同源 iframe**;跨源 iframe 至少产出说明节点并给出 src,
     * 让模型知道"内容在那边的 frame 里",而不是静默读空。
     */
    async function collectA11yTree(rawRoot: unknown, maxNodes = 2000): Promise<CollectedTree | { error: string }> {
      const libs = await loadAccessibilityLibs();
      if (!libs) return { error: 'Failed to load the accessibility analysis library.' };
      const selector = typeof rawRoot === 'string' && rawRoot.trim() ? rawRoot.trim() : '';
      // 与 read_element 同一寻址能力:直接 document.querySelector 穿不过开放 shadow root,
      // 而树本身是穿透采集的 —— root 若只认光 DOM,等于"能读到影子里的内容却指定不了它"
      const rootEl = selector ? querySelectorDeep(selector) : document.body;
      if (!rootEl) return { error: `No element matches root selector ${JSON.stringify(selector)}.` };

      const nodes: A11yNode[] = [];
      let total = 0;
      let truncated = false;
      const STATUS_LIMIT = 32;
      // 交互节点的**名字与序号必须与动作工具完全同口径**:模型会把树里的名字/[n] 直接抄进
      // click_element/fill_element。故不按本棵树重编号(root 裁剪、预算截断、帧穿透都会改变计数),
      // 而是取动作侧同一份枚举的真实值 —— 抄下来即可命中。
      const actionByEl = new Map<Element, EnumeratedElement>();
      // 用**内部形状**的枚举器(带元素引用):collectInteractiveElements 的返回会剥掉 el(传输形状),
      // 无法据此给树节点回填真实序号
      for (const entry of enumerateInteractiveElements(libs)) actionByEl.set(entry.el, entry);

      const push = (node: A11yNode): void => {
        total += 1;
        if (nodes.length >= maxNodes) {
          truncated = true;
          return;
        }
        nodes.push(node);
      };

      const visitIframe = (el: Element, depth: number): void => {
        // 三态判定与说明文案与 search_element 共用同一份(frameInfo/frameNote)
        const info = frameInfo(el);
        const label = info.label || info.src || undefined;
        if (info.doc?.body) {
          push({ depth, role: 'iframe', name: label, note: 'same-origin frame', interactive: false });
          for (const child of Array.from(info.doc.body.children)) visit(child, depth + 1);
          return;
        }
        push({ depth, role: 'iframe', name: label, note: frameNote(info), interactive: false });
      };

      const visit = (el: Element, depth: number): void => {
        // iframe 分派在入口:原先只在遍历孩子时特判,body 直属 iframe(常见写法)会当成普通元素走过,
        // 内容既不展开也不出说明 —— 树少一整块,而动作枚举却进入帧,序号从此错位
        if (el.tagName === 'IFRAME') {
          visitIframe(el, depth);
          return;
        }
        if (total > maxNodes + STATUS_LIMIT) {
          truncated = true;
          return;
        }
        const role = (effectiveRole(el, libs.getRole) || 'generic').toLowerCase();
        let name = '';
        try {
          name = libs.computeAccessibleName(el) ?? '';
        } catch {
          name = '';
        }
        name = name.replace(/\s+/g, ' ').trim();
        if (!name && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.placeholder) {
          name = el.placeholder.replace(/\s+/g, ' ').trim();
        }
        const disabled = libs.isDisabled(el);
        const interactive = isInteractiveCandidate(el, libs.getRole) && Boolean(role);
        const leafText = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        // 无角色的**叶子**必须保留文本:价格、标签这类内容常写在 <span class=price> 里,
        // 它们没有 role/name,若只按 TREE_TEXT_ROLES 输出,"名称与价格相邻"这条信息会整段消失。
        const isWrapperRole = role === 'generic' || role === 'none' || role === 'presentation';
        const isContentless = TREE_SKIP_TEXT_TAGS.has(el.tagName) || !isElementVisible(el);
        if (
          isWrapperRole &&
          !name &&
          !el.shadowRoot &&
          el.children.length === 0 &&
          leafText &&
          !isContentless
        ) {
          push({ depth, role: 'text', text: clipMarked(leafText, 160) });
          return;
        }
        // 语义叶子同样要过可见性/非内容标签:否则 `<p hidden>…` 会把隐藏文本当正常段落输出
        const text =
          TREE_TEXT_ROLES.has(role) && !name && leafText && !isContentless
            ? clipMarked(leafText, 160)
            : undefined;
        const href = isAnchorEl(el) ? el.getAttribute('href') ?? undefined : undefined;
        // 可操作节点:名字与序号取动作枚举(与 click_element 精确匹配的那个字符串,零改写)
        const actionHit = interactive ? actionByEl.get(el) : undefined;
        push({
          depth,
          role,
          name: (actionHit?.name || name) || undefined,
          text,
          // id 是无名元素唯一的稳定 CSS 句柄(read_element 可照抄),过长则省略
          id: el.id && el.id.length <= 48 ? el.id : undefined,
          value: a11yValue(el),
          states: a11yStates(el, disabled),
          href,
          interactive,
          ordinal: actionHit?.ordinal,
        });

        if (el.shadowRoot) {
          for (const child of Array.from(el.shadowRoot.children)) visit(child, depth + 1);
        }
        for (const child of Array.from(el.children)) {
          if (child.closest(SEARCH_SKIP_SUBTREE_SELECTOR)) continue;
          visit(child, depth + 1); // iframe 由 visit 入口统一分派
        }
      };

      // body 本身是无形载体:直接从其子节点起算 depth 0,避免整棵树多一层缩进
      const startChildren = rootEl === document.body ? Array.from(rootEl.children) : [rootEl];
      for (const child of startChildren) {
        if (child.closest(SEARCH_SKIP_SUBTREE_SELECTOR)) continue;
        visit(child, 0);
      }

      return { url: location.href, title: document.title, nodes, total, truncated };
    }

    // ===== 页面动作(click/fill/scroll;三期步②,与 search_element 同源寻址)=====

    interface LocatorSpec {
      role: string;
      name: string;
      ordinal?: number;
    }

    /** 宽松解析 locator;name 允许空串(清单里的无名元素同样可寻址) */
    function parseLocator(v: unknown): LocatorSpec | null {
      if (!v || typeof v !== 'object') return null;
      const x = v as Record<string, unknown>;
      if (typeof x.role !== 'string' || !x.role.trim() || typeof x.name !== 'string') return null;
      if (x.name.trim() === '' && x.name !== '') return null;
      return {
        role: x.role,
        name: x.name,
        ordinal: typeof x.ordinal === 'number' && x.ordinal > 0 ? Math.floor(x.ordinal) : undefined,
      };
    }

    /** locator 解析:role 小写 + name 精确匹配(与清单同枚举同序号语义);not_found 附同 role 现有目标 */
    function resolveLocator(
      all: EnumeratedElement[],
      locator: LocatorSpec,
    ):
      | { status: 'ok'; hit: EnumeratedElement }
      | { status: 'not_found'; alternatives: string[] }
      | { status: 'ambiguous'; matches: { ordinal: number; tagName: string; preview: string }[] } {
      const role = locator.role.trim().toLowerCase();
      const name = locator.name.trim();
      const wanted = locator.ordinal ?? 1;
      const sameKey = all.filter((e) => e.role === role && e.name === name);
      if (sameKey.length === 0) {
        const alternatives = [
          ...new Set(
            all
              .filter((e) => e.role === role)
              .map((e) => `${e.role} ${JSON.stringify(e.name)}`),
          ),
        ].slice(0, 8);
        return { status: 'not_found', alternatives };
      }
      if (wanted > sameKey.length) {
        return {
          status: 'ambiguous',
          matches: sameKey.map((e) => ({
            ordinal: e.ordinal,
            tagName: e.el.tagName.toLowerCase(),
            preview: elementActionPreview(e.el),
          })),
        };
      }
      // wanted ∈ [1, sameKey.length] 已由上方检查保证
      return { status: 'ok', hit: sameKey[wanted - 1]! };
    }

    function elementSummary(e: EnumeratedElement): {
      role: string;
      name: string;
      ordinal: number;
      tagName: string;
      preview: string;
    } {
      return {
        role: e.role,
        name: e.name,
        ordinal: e.ordinal,
        tagName: e.el.tagName.toLowerCase(),
        preview: elementActionPreview(e.el),
      };
    }

    /** 动作前反馈:固定定位轮廓高亮 400ms(pointer-events:none,不影响命中测试与页面交互) */
    function highlightElement(el: Element): void {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const box = document.createElement('div');
      box.style.cssText =
        `position:fixed;left:${rect.left - 2}px;top:${rect.top - 2}px;width:${rect.width + 4}px;` +
        `height:${rect.height + 4}px;outline:2px solid #2563eb;outline-offset:0;border-radius:4px;` +
        'background:rgba(37,99,235,0.12);z-index:2147483646;pointer-events:none;';
      document.documentElement.appendChild(box);
      setTimeout(() => box.remove(), 400);
    }

    /**
     * 有界 settle:readyState complete(短上限)→ MutationObserver 100ms 静默(天花板 maxMs)→ 一帧 rAF。
     * 动作内置等待,不设独立等待工具(规格 8.4)。
     */
    async function waitForSettle(maxMs = 3000): Promise<string[]> {
      if (document.readyState !== 'complete') {
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            document.removeEventListener('readystatechange', check);
            resolve();
          };
          const check = () => {
            if (document.readyState === 'complete') done();
          };
          const timer = setTimeout(done, 1500);
          document.addEventListener('readystatechange', check);
        });
      }
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          mo.disconnect();
          resolve();
        };
        let timer = setTimeout(finish, 100);
        const mo = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(finish, 100);
        });
        mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
        setTimeout(() => {
          mo.disconnect();
          resolve();
        }, maxMs);
      });
      // 隐藏 tab 的 rAF 完全暂停(不是节流):尾帧等待会永不 resolve → 工具永久挂死。
      // 已隐藏直接跳过;可见时与 visibilitychange 竞速(焦点被 _blank 新页抢走的瞬间迁移也能毫秒级短路)。
      if (document.hidden) {
        return ['settle_skipped: the tab lost focus (background tabs pause rendering); the post-action state could not be confirmed.'];
      }
      let hiddenMidway = false;
      await Promise.race([
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
        new Promise<void>((resolve) => {
          document.addEventListener(
            'visibilitychange',
            () => {
              if (document.hidden) {
                hiddenMidway = true;
                resolve();
              }
            },
            { once: true },
          );
        }),
      ]);
      return hiddenMidway
        ? ['settle_skipped: the tab lost focus (background tabs pause rendering); the post-action state could not be confirmed.']
        : [];
    }

    /**
     * 合成点击:scrollIntoView 居中 → 400ms 高亮 → 遮挡命中检测;
     * 命中失败走固定 fallback(直接在元素上派发事件序列,拍板:结果里注明)。
     * 事件为 untrusted(chrome.debugger 特权层条件触发,不排期)。返回注记(英文)。
     */
    function performClick(el: Element): string[] {
      const notes: string[] = [];
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      highlightElement(el);
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      const clear = !!hit && (hit === el || el.contains(hit) || hit.contains(el));
      if (!clear && hit) {
        notes.push(
          `Element was occluded by <${hit.localName.toLowerCase()}>; the event sequence was dispatched directly on the element.`,
        );
      }
      for (const type of ['mouseover', 'mousedown', 'mouseup', 'click']) {
        el.dispatchEvent(
          new MouseEvent(type, {
            view: window,
            bubbles: true,
            cancelable: true,
            composed: true,
            buttons: 1,
            clientX: x,
            clientY: y,
          }),
        );
      }
      if (typeof (el as HTMLElement).focus === 'function') (el as HTMLElement).focus();
      return notes;
    }

    function isToggleElement(el: Element): boolean {
      if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) return true;
      const role = el.getAttribute('role');
      return (
        role === 'switch' ||
        role === 'checkbox' ||
        role === 'radio' ||
        el.hasAttribute('aria-checked') ||
        el.hasAttribute('aria-pressed')
      );
    }

    /** 文本类:input(非按钮型/非日期/范围/色彩等非文本输入)/textarea/contenteditable;checkbox/radio 已被 toggle 分支接走 */
    function isTextLikeElement(el: Element): boolean {
      if (el instanceof HTMLTextAreaElement) return true;
      if ((el as HTMLElement).isContentEditable) return true;
      if (el instanceof HTMLInputElement) {
        return ![
          'button', 'submit', 'reset', 'image', 'file', 'hidden', 'checkbox', 'radio',
          'date', 'datetime-local', 'month', 'time', 'week', 'range', 'color',
        ].includes(el.type);
      }
      return false;
    }

    function dispatchInputAndChange(el: Element): void {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    /**
     * 受控填充(AhYi8 模式,无 CDP 特权层):
     * select 按 value/text 匹配选项;toggle 只收 true/false(原生 click() 切换);
     * 文本类 = focus → 全选 → 原生 prototype setter(绕 React/Vue 值跟踪)→ input/change;
     * contenteditable = 全选后 execCommand('insertText')(富文本编辑器兼容)。空串 = 明确清空语义。
     */
    /** 合成 Enter 键序列(fill submit 用;untrusted,与 click 同哲学) */
    function dispatchEnter(el: Element): void {
      for (const type of ['keydown', 'keypress', 'keyup']) {
        el.dispatchEvent(
          new KeyboardEvent(type, {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    }

    function performFill(
      el: Element,
      value: string,
      submit?: 'enter',
    ): { notes: string[] } | { fail: { reason: 'option_not_found' | 'unsupported_element' | 'invalid_value'; options?: string[] } } {
      const notes: string[] = [];
      if (el instanceof HTMLSelectElement) {
        const target = Array.from(el.options).find(
          (o) => o.value === value || o.text.trim() === value,
        );
        if (!target) {
          return {
            fail: {
              reason: 'option_not_found',
              options: Array.from(el.options)
                .map((o) => o.text.trim())
                .slice(0, 20),
            },
          };
        }
        el.value = target.value;
        dispatchInputAndChange(el);
        return { notes };
      }
      if (isToggleElement(el)) {
        const normalized = value.trim().toLowerCase();
        if (normalized !== 'true' && normalized !== 'false') {
          return { fail: { reason: 'invalid_value' } };
        }
        const target = normalized === 'true';
        if (el instanceof HTMLInputElement) {
          if (el.type === 'radio' && !target && el.checked) {
            notes.push('Radio buttons cannot be unchecked directly; select another option instead.');
            return { notes };
          }
          if (el.checked === target) {
            notes.push('The element was already in the requested state; nothing changed.');
            return { notes };
          }
          el.click();
          if (el.checked !== target) {
            el.checked = target;
            dispatchInputAndChange(el);
          }
          return { notes };
        }
        const nextValue = target ? 'true' : 'false';
        if (el.hasAttribute('aria-checked')) el.setAttribute('aria-checked', nextValue);
        if (el.hasAttribute('aria-pressed')) el.setAttribute('aria-pressed', nextValue);
        if (typeof (el as HTMLElement).click === 'function') (el as HTMLElement).click();
        dispatchInputAndChange(el);
        return { notes };
      }
      if (isTextLikeElement(el)) {
        (el as HTMLElement).focus();
        if ((el as HTMLElement).isContentEditable) {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          selection?.removeAllRanges();
          selection?.addRange(range);
          if (value) {
            document.execCommand('insertText', false, value);
          } else {
            document.execCommand('delete');
          }
          if ((el.textContent ?? '') !== value) {
            // execCommand 失败或未生效的兑底:直接改写文本(富文本格式会丢失,但值语义保住)
            el.textContent = value;
          }
          dispatchInputAndChange(el);
          if (submit === 'enter') dispatchEnter(el);
          return { notes };
        }
        if (typeof (el as HTMLInputElement).select === 'function') (el as HTMLInputElement).select();
        const proto =
          el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc?.set) desc.set.call(el, value);
        else (el as HTMLInputElement).value = value;
        dispatchInputAndChange(el);
        if (submit === 'enter') dispatchEnter(el);
        return { notes };
      }
      return { fail: { reason: 'unsupported_element' } };
    }

    /** 真实滚轮单 tick ≈ 120px;amount(px)折算 tick 数(1-12),缺省 3 tick ≈ 轻滚一下 */
    const WHEEL_TICK_PX = 120;
    function wheelTickCount(amount: number | undefined): number {
      if (typeof amount === 'number' && amount > 0) {
        return Math.min(12, Math.max(1, Math.round(amount / WHEEL_TICK_PX)));
      }
      return 3;
    }

    /** 视口中心内容指纹(tagName+className+短文本):横向切卡/变换切换页 rect 不动也能检出内容变化 */
    function contentFingerprintAtCenter(): string {
      const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      if (!(el instanceof Element)) return '';
      const c = typeof el.className === 'string' ? el.className.slice(0, 60) : '';
      return `${el.tagName}.${c}#${(el.textContent ?? '').slice(0, 120)}`;
    }

    /** 在目标上 scrollBy 并返回实际移动量(像素,横纵合计);不可滚目标无副作用 */
    function applyScroll(target: Element, dx: number, dy: number): number {
      const beforeX = target.scrollLeft;
      const beforeY = target.scrollTop;
      target.scrollBy({ left: dx, top: dy, behavior: 'instant' });
      return Math.abs(target.scrollLeft - beforeX) + Math.abs(target.scrollTop - beforeY);
    }

    /** 最近的可滚动祖先(含自身):overflow 可滚且确有真实滚动态(余量 ≥ 50px)。html/body 主滚动不归此 */
    function findScrollableAncestor(start: Element | null, vertical: boolean): Element | null {
      let node: Element | null = start;
      while (node && node !== document.documentElement && node !== document.body) {
        if (node instanceof HTMLElement) {
          const style = getComputedStyle(node);
          const ov = vertical ? style.overflowY : style.overflowX;
          const scrollSize = vertical ? node.scrollHeight : node.scrollWidth;
          const clientSize = vertical ? node.clientHeight : node.clientWidth;
          if ((ov === 'auto' || ov === 'scroll' || ov === 'overlay') && scrollSize > clientSize + 50) {
            return node;
          }
        }
        node = node.parentElement;
      }
      return null;
    }

        /** 滚动劫持/画廊页兜底:连发合成 wheel ticks(真实滚轮惯性)。合成事件不触发浏览器默认滚动
     *  (no isTrusted),但页面自身的 wheel 监听器(翻页/切卡)照常收到——对原生滚动页零副作用。
     *  返回是否观察到中心内容变化(指纹对比,横向切换同样检出)。 */
    async function dispatchWheelTicks(center: Element | null, vertical: boolean, signed: number, ticks: number): Promise<boolean> {
      const targetEl = center instanceof Element ? center : document.documentElement;
      const before = contentFingerprintAtCenter();
      for (let i = 0; i < ticks; i++) {
        targetEl.dispatchEvent(
          new WheelEvent('wheel', {
            deltaX: vertical ? 0 : signed,
            deltaY: vertical ? signed : 0,
            deltaMode: 0,
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 30));
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 400));
      return contentFingerprintAtCenter() !== before;
    }

    /** 滚动:mode='wheel' = 模拟鼠标滚轮(合成 wheel ticks,页面自行响应——原生滚动/snap/劫持切卡/画廊全部一致;
     *  合成不触发浏览器默认滚动,原生滚动页返回 moved:false,由 sidepanel 侧 CDP 可信滚轮接管);
     *  mode='js' = CDP 不可用时的滚动条快路径(不经过页面监听,行为与真实鼠标不一致,仅兜底)。 */
    async function performScroll(
      el: Element | null,
      direction: string,
      amount: number | undefined,
      mode: 'wheel' | 'js',
    ): Promise<{ notes: string[]; moved: boolean }> {
      if (el) {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        highlightElement(el);
        const rect = el.getBoundingClientRect();
        const inView =
          rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
        return {
          moved: true,
          notes: inView
            ? [`Scrolled the target element into view.`]
            : [`Scrolled toward the target element, but it may still be out of view.`],
        };
      }
      const vertical = direction === 'up' || direction === 'down';

      // 0) 模拟鼠标滚轮:合成 wheel ticks(页面自己的监听/默认滚动/snap 决定行为)。
      // 原生可滚页(document 有余量)直接跳过合成:合成不触发浏览器默认滚动,只有 CDP 手势等效
      if (mode === 'wheel') {
        const scroller = document.scrollingElement || document.documentElement;
        if (scroller.scrollHeight > scroller.clientHeight + 50) {
          return {
            moved: false,
            notes: ['Viewport is natively scrollable; wheel ticks alone cannot trigger default scrolling.'],
          };
        }
        const center = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
        const dirSign = direction === 'up' || direction === 'left' ? -1 : 1;
        const moved = await dispatchWheelTicks(
          center instanceof Element ? center : null,
          vertical,
          dirSign * WHEEL_TICK_PX,
          wheelTickCount(amount),
        );
        return {
          moved,
          notes: moved
            ? [`Dispatched wheel ticks; the page responded (content changed).`]
            : [`Dispatched wheel ticks to the page; content did not change measurably.`],
        };
      }

      // js 模式:滚动条快路径(CDP 不可用时)
      const viewport = vertical
        ? document.documentElement.clientHeight || window.innerHeight
        : document.documentElement.clientWidth || window.innerWidth;
      const delta =
        typeof amount === 'number' && amount > 0
          ? Math.min(Math.round(amount), 10000)
          : Math.min(120, Math.max(40, Math.round(viewport * 0.12)));
      const signed = direction === 'up' || direction === 'left' ? -delta : delta;
      const dx = vertical ? 0 : signed;
      const dy = vertical ? signed : 0;

      // 1) 主滚动视口(document.scrollingElement 兼容 quirks/标准模式;注记报告实际位移而非请求量)
      const scroller = document.scrollingElement || document.documentElement;
      const mainMoved = applyScroll(scroller, dx, dy);
      if (mainMoved > 2) {
        return { moved: true, notes: [`Scrolled ${direction} by ${mainMoved}px (requested ${delta}px).`] };
      }
      // 2) 视口中心元素的最近可滚容器(覆盖 main/面板/聊天窗等内嵌滚动)
      const center = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      const container = findScrollableAncestor(center instanceof Element ? center : null, vertical);
      let containerEdge = false;
      if (container) {
        const containerMoved = applyScroll(container, dx, dy);
        if (containerMoved > 2) {
          return { moved: true, notes: [`Scrolled ${direction} by ${containerMoved}px (requested ${delta}px) inside a scrollable container.`] };
        }
        containerEdge = true;
      }
      if (containerEdge) {
        return {
          moved: false,
          notes: [`Viewport is not scrollable in this direction; the scrollable container is at its edge.`],
        };
      }
      return { moved: false, notes: [`Viewport is not scrollable in this direction; no scrollable content found in the page.`] };
    }

    async function runPageAction(message: {
      action?: unknown;
      locator?: unknown;
      value?: unknown;
      direction?: unknown;
      amount?: unknown;
      submit?: unknown;
      mode?: unknown;
      beforeSummary?: unknown;
      beforeUrl?: unknown;
    }): Promise<PageActionResult> {
      const libs = await loadAccessibilityLibs();
      if (!libs) return { ok: false, url: location.href, reason: 'not_found' };
      const urlBefore = location.href;
      const action = message.action;

      if (action === 'scroll') {
        const direction = typeof message.direction === 'string' ? message.direction : '';
        if (direction !== 'up' && direction !== 'down' && direction !== 'left' && direction !== 'right') {
          return { ok: false, url: urlBefore, reason: 'invalid_value' };
        }
        const amount = typeof message.amount === 'number' && message.amount > 0 ? message.amount : undefined;
        let target: Element | null = null;
        let summary: ResolvedActionElement | undefined;
        const locator = parseLocator(message.locator);
        if (locator) {
          const res = resolveLocator(enumerateInteractiveElements(libs), locator);
          if (res.status === 'not_found') return { ok: false, url: urlBefore, reason: 'not_found', alternatives: res.alternatives };
          if (res.status === 'ambiguous') return { ok: false, url: urlBefore, reason: 'ambiguous', matches: res.matches };
          target = res.hit.el;
          summary = elementSummary(res.hit);
        }
        const mode = message.mode === 'js' ? 'js' : 'wheel';
        const { notes, moved } = await performScroll(target, direction, amount, mode);
        notes.push(...(await waitForSettle(1500)));
        return {
          ok: true,
          url: location.href,
          title: document.title,
          element: summary,
          notes,
          ...(moved ? {} : { moved: false as const }),
          ...(moved ? {} : { viewport: { width: window.innerWidth, height: window.innerHeight } }),
        };
      }

      // after = CDP 可信动作执行后的后置观察:不要求 locator 仍解析成功——
      // 元素消失本身就是重要的动作生效信号,必须能作为注记返回而非 not_found 错误
      if (action === 'after') {
        const locator = parseLocator(message.locator);
        if (!locator) return { ok: false, url: urlBefore, reason: 'invalid_value' };
        const notes: string[] = [];
        // 导航检测:与「动作前」URL 比对(后置请求到达时页面可能已是新文档)
        const beforeUrl = typeof message.beforeUrl === 'string' ? message.beforeUrl : location.href;
        notes.push(...(await waitForSettle()));
        if (location.href !== beforeUrl) {
          notes.push(`navigation_started: the page navigated to ${location.href}; element state may have changed.`);
        } else {
          try {
            const after = resolveLocator(enumerateInteractiveElements(libs), locator);
            if (after.status === 'not_found') {
              notes.push('after: the locator no longer resolves — the element is gone (often a strong signal the action took effect).');
            } else if (after.status === 'ok') {
              const afterSummary = elementSummary(after.hit);
              const before = (message.beforeSummary ?? null) as ResolvedActionElement | null;
              if (before && afterSummary.preview === before.preview) {
                notes.push(`after: locator still resolves to <${afterSummary.tagName}> "${afterSummary.preview}" — element state unchanged.`);
              } else {
                notes.push(`after: locator now resolves to <${afterSummary.tagName}> "${afterSummary.preview}" (was "${before?.preview ?? '?'}").`);
              }
              // 提交事实信号:回读输入框(仅 Enter 提交场景;元素消失时跳过)
              if (message.submit === 'enter') {
                try {
                  const elNow = after.hit.el as HTMLElement;
                  const still =
                    elNow instanceof HTMLInputElement || elNow instanceof HTMLTextAreaElement
                      ? elNow.value
                      : (elNow.textContent ?? '');
                  if (still.trim() === '') {
                    notes.push('Input is now empty — the Enter key likely submitted the text.');
                  } else {
                    notes.push(
                      'Note: the text is still in the input field — the Enter key may NOT have submitted it. Consider clicking the send button instead.',
                    );
                  }
                } catch {
                  /* 无法回读,跳过 */
                }
              }
            }
          } catch {
            /* After 检查失败不影响动作结果 */
          }
        }
        return { ok: true, url: location.href, title: document.title, notes };
      }

      if (action === 'resolve' || action === 'click' || action === 'fill') {
        const locator = parseLocator(message.locator);
        if (!locator) return { ok: false, url: urlBefore, reason: 'invalid_value' };
        const res = resolveLocator(enumerateInteractiveElements(libs), locator);
        if (res.status === 'not_found') {
          return { ok: false, url: urlBefore, reason: 'not_found', alternatives: res.alternatives };
        }
        if (res.status === 'ambiguous') {
          return { ok: false, url: urlBefore, reason: 'ambiguous', matches: res.matches };
        }
        const summary = elementSummary(res.hit);
        if (action === 'resolve') {
          // CDP 可信执行前置:元素中心视口坐标(仅当中心落在视口内,视口外 CDP 点击无意义) + 遮挡旗标 + 状态旗标
          const rect = res.hit.el.getBoundingClientRect();
          const hasRect = rect.width > 0 && rect.height > 0;
          const cx = Math.round(rect.left + rect.width / 2);
          const cy = Math.round(rect.top + rect.height / 2);
          const inViewport =
            hasRect && cx >= 0 && cy >= 0 && cx < window.innerWidth && cy < window.innerHeight;
          const hitTest = inViewport ? document.elementFromPoint(cx, cy) : null;
          const occluded = !!(hitTest && !(hitTest === res.hit.el || res.hit.el.contains(hitTest) || hitTest.contains(res.hit.el)));
          return {
            ok: true,
            url: urlBefore,
            title: document.title,
            element: summary,
            notes: [],
            ...(inViewport ? { centerPoint: { x: cx, y: cy }, occluded } : {}),
            canTextInput: isTextLikeElement(res.hit.el),
            disabled: res.hit.disabled === true,
            hidden: res.hit.visible === false,
          };
        }

        const notes: string[] = [];
        if (res.hit.disabled) {
          notes.push('Note: the target element is disabled; the browser may ignore the interaction.');
        }
        if (!res.hit.visible) {
          notes.push('Note: the target element is currently not visible.');
        }
        let fail: { reason: 'option_not_found' | 'unsupported_element' | 'invalid_value'; options?: string[] } | undefined;
        const value = typeof message.value === 'string' ? message.value : '';
        const submit = message.submit === 'enter' ? ('enter' as const) : undefined;

        if (action === 'click') {
          notes.push(...performClick(res.hit.el));
        } else {
          const filled = performFill(res.hit.el, value, submit);
          if ('fail' in filled) fail = filled.fail;
          else notes.push(...filled.notes);
        }
        if (fail) return { ok: false, url: location.href, reason: fail.reason, options: fail.options };
        const urlAfterAct = location.href;
        notes.push(...(await waitForSettle()));
        if (location.href !== urlAfterAct) {
          notes.push(`navigation_started: the page navigated to ${location.href}; element state may have changed.`);
        } else if (!notes.some((n) => n.startsWith('navigation_started'))) {
          // 步④ Before/After:re-resolve locator 对比动作后的元素状态。
          // 仅同 tab 导航时跳过(上下文已重建);settle_skipped(失焦)不跳——后台 DOM 查询正常可用
          try {
            const after = resolveLocator(enumerateInteractiveElements(libs), locator);
            if (after.status === 'not_found') {
              notes.push('after: the locator no longer resolves — the element is gone (often a strong signal the action took effect).');
            } else if (after.status === 'ok') {
              const afterSummary = elementSummary(after.hit);
              if (afterSummary.preview === summary.preview) {
                notes.push(`after: locator still resolves to <${afterSummary.tagName}> "${afterSummary.preview}" — element state unchanged.`);
              } else {
                notes.push(`after: locator now resolves to <${afterSummary.tagName}> "${afterSummary.preview}" (was "${summary.preview}").`);
              }
            }
            // ambiguous:同名元素变多,语义不明,不注记(避免误导)
          } catch {
            /* After 检查失败不影响动作结果 */
          }
        }
        // 提交事实信号:回读输入框(不可跨站判定"已提交",但值变化是强信号——
        // 大多数聊天站发送后会清空输入框;残留全文 = Enter 大概率未生效)
        if (action === 'fill' && submit === 'enter') {
          try {
            const elNow = res.hit.el as HTMLElement;
            // 页面重渲染替换节点后游离节点的 value 不可信(会产生假阳性/假阴性)
            if (!elNow.isConnected) return { ok: true, url: location.href, title: document.title, element: summary, notes };
            const still =
              elNow instanceof HTMLInputElement || elNow instanceof HTMLTextAreaElement
                ? elNow.value
                : (elNow.textContent ?? '');
            if (still.trim() === '') {
              notes.push('Input is now empty — the Enter key likely submitted the text.');
            } else {
              notes.push(
                'Note: the text is still in the input field — the Enter key may NOT have submitted it. Consider clicking the send button instead.',
              );
            }
          } catch {
            /* 元素已被页面重渲染替换:无法回读,跳过 */
          }
        }
        return { ok: true, url: location.href, title: document.title, element: summary, notes };
      }

      return { ok: false, url: urlBefore, reason: 'invalid_value' };
    }

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === PICK_ELEMENT_MESSAGE) {
        if (message.action === 'start') {
          void enterPickMode();
        } else if (
          message.action === 'resolve' &&
          (typeof message.selector === 'string' ||
            (message.locator && typeof message.locator === 'object'))
        ) {
          // 异步:locator 路径要动态导入可访问性库
          resolveElementPayload({
            selector: typeof message.selector === 'string' ? message.selector : undefined,
            role: message.locator?.role,
            name: message.locator?.name,
            ordinal: message.locator?.ordinal,
          })
            .then(sendResponse)
            .catch(() => sendResponse(null));
          return true;
        }
        return;
      }
      if (message?.type === SEARCH_ELEMENT_MESSAGE) {
        // 异步计算(动态导入 dom-accessibility-api):返回 true 保持消息通道开放
        collectInteractiveElements(message.query, message.includeHidden === true)
          .then(sendResponse)
          .catch(() => sendResponse({ error: 'Unexpected failure while collecting interactive elements.' }));
        return true;
      }
      if (message?.type === PAGE_ACTION_MESSAGE) {
        runPageAction(message)
          .then(sendResponse)
          .catch(() => sendResponse({ ok: false, url: location.href, reason: 'not_found' }));
        return true;
      }
      if (message?.type !== READ_PAGE_MESSAGE) {
        // dev 可观测性:未知协议消息告警,便于排查协议漂移(生产零开销)
        if (import.meta.env.DEV) {
          const type: unknown = message?.type;
          if (typeof type === 'string' && type.startsWith('ai-sidebar/')) {
            console.warn(`[ai-sidebar] content script 收到未知消息类型: ${type}`);
          }
        }
        return;
      }
      // 异步提取:返回 true 保持消息通道开放,完成后 sendResponse
      // 树模式:结构读取(与文本模式共用同一条 read-page 消息)
      if (message.mode === 'tree') {
        collectA11yTree(message.root).then(sendResponse);
        return true;
      }
      extractStable(
        message.section === 'tail' ? 'tail' : 'head',
        typeof message.waitStableMs === 'number' ? message.waitStableMs : 0,
        typeof message.waitText === 'string' ? message.waitText : undefined,
        typeof message.offset === 'number' && message.offset > 0 ? Math.round(message.offset) : 0,
      ).then(sendResponse);
      return true;
    });
  },
});
