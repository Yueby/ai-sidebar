import {
  PICK_ELEMENT_MESSAGE,
  PICK_ELEMENT_RESULT_MESSAGE,
  READ_PAGE_MESSAGE,
  SEARCH_ELEMENT_MESSAGE,
  SEARCH_ELEMENT_LIMIT,
} from '@/lib/types';
// type-only:编译期擦除,不引入运行时代码(载荷形状与 sidepanel 侧同源)
import type { SearchElementsResult } from '@/lib/pageContext';

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
    ): { text: string; truncated: boolean } {
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
    function extractMarkdown(): { text: string; truncated: boolean } {
      const root = selectRoot();
      if (!root) return { text: '', truncated: false };
      return truncateBlocks(renderChildren(root), TEXT_LIMIT);
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
    async function extractSemanticMarkdown(): Promise<{
      text: string;
      truncated: boolean;
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
        return truncateMarkdownText(markdown, TEXT_LIMIT);
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
    async function extractStable(): Promise<{
      title: string;
      url: string;
      text: string;
      truncated: boolean;
    }> {
      await waitForComplete(READY_TIMEOUT);
      // 语义路径优先;门控不过/库不可用则手写兜底(含 isHidden 可见性过滤)
      let result = (await extractSemanticMarkdown()) ?? extractMarkdown();
      if (result.text.length < SHORT_THRESHOLD) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
        result = (await extractSemanticMarkdown()) ?? extractMarkdown();
      }
      return { title: document.title, url: location.href, ...result };
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

    /** 按 selector 定位元素并返回 outerHTML(原始 HTML,字符上限 12000);不存在返回 null */
    function resolveElementPayload(selector: string): {
      found: boolean;
      tagName: string;
      html: string;
      truncated: boolean;
      preview: string;
      /** 元素为 IMG 或包含 IMG(取前 3 张)时的图片列表;html 之外并列返回 */
      images: ReturnType<typeof elementImagePayload>[];
      /** 页面 devicePixelRatio(截图裁剪用) */
      dpr: number;
    } | null {
      const el = document.querySelector(selector);
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
        }
      };
      visit(document);
      return out;
    }

    /**
     * 交互元素清单(search_element 内容侧计算):
     * 全量遍历 → 候选过滤 → 生效 role/可访问名称/状态 → 同 role+name 组内文档序编号(序号在截断前
     * 按全量计数,保证输出 [N] 与步② locator 解析一致)→ 截前 SEARCH_ELEMENT_LIMIT 条。
     */
    async function collectInteractiveElements(): Promise<SearchElementsResult | { error: string }> {
      const libs = await loadAccessibilityLibs();
      if (!libs) return { error: 'Failed to load the accessibility analysis library.' };
      const { getRole, computeAccessibleName, isDisabled } = libs;

      const computeStartedAt = performance.now();
      const ordinals = new Map<string, number>();
      const elements: SearchElementsResult['elements'] = [];
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
        // 降噪:非交互 role 且无名且非 DOM 交互标签(tabIndex≥0 带进来的纯容器)对 role+name 寻址无意义
        if (!INTERACTIVE_ROLES.has(role) && !name && !isDomInteractive(el)) continue;
        const key = `${role}\u0000${name}`;
        const ordinal = (ordinals.get(key) ?? 0) + 1;
        ordinals.set(key, ordinal);
        elements.push({
          role,
          name,
          ordinal,
          disabled: isDisabled(el),
          visible: isElementVisible(el),
        });
      }
      const total = elements.length;
      // 预算优先给可见元素(隐藏项多为折叠菜单/重复入口,行动价值低;序号已在全量上计数,选集不 影响 [N] 寻址),组内保持文档序
      const visibleFirst = [
        ...elements.filter((e) => e.visible),
        ...elements.filter((e) => !e.visible),
      ];
      return {
        url: location.href,
        title: document.title,
        total,
        truncated: total > SEARCH_ELEMENT_LIMIT,
        durationMs: Math.round(performance.now() - computeStartedAt),
        elements: visibleFirst.slice(0, SEARCH_ELEMENT_LIMIT),
      };
    }

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === PICK_ELEMENT_MESSAGE) {
        if (message.action === 'start') {
          void enterPickMode();
        } else if (message.action === 'resolve' && typeof message.selector === 'string') {
          sendResponse(resolveElementPayload(message.selector));
        }
        return;
      }
      if (message?.type === SEARCH_ELEMENT_MESSAGE) {
        // 异步计算(动态导入 dom-accessibility-api):返回 true 保持消息通道开放
        collectInteractiveElements()
          .then(sendResponse)
          .catch(() => sendResponse({ error: 'Unexpected failure while collecting interactive elements.' }));
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
      extractStable().then(sendResponse);
      return true;
    });
  },
});
