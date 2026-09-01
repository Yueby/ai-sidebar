export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  main() {
    /** 正文长度上限(块边界截断,而非硬切) */
    const TEXT_LIMIT = 12000;
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

    /** 按 selector 定位元素并块级 Markdown 化(复用手写流水线);不存在返回 null */
    function resolveElementPayload(selector: string): {
      found: boolean;
      tagName: string;
      markdown: string;
      preview: string;
      /** 元素为 IMG 或包含 IMG(取前 3 张)时的图片列表;markdown 之外并列返回 */
      images: ReturnType<typeof elementImagePayload>[];
      /** 页面 devicePixelRatio(截图裁剪用) */
      dpr: number;
    } | null {
      const el = document.querySelector(selector);
      if (!el) return null;
      // 单元素不走 Readability:直接用手写块级 Markdown 化
      const markdown = renderBlock(el) || elementPreview(el);
      const imgEls: HTMLImageElement[] =
        el.tagName === 'IMG'
          ? [el as HTMLImageElement]
          : Array.from(el.querySelectorAll('img')).slice(0, 3);
      const images = imgEls.map(elementImagePayload).filter((i) => i.src.length > 0);
      return {
        found: true,
        tagName: el.tagName.toLowerCase(),
        markdown,
        preview: elementPreview(el),
        images,
        dpr: window.devicePixelRatio || 1,
      };
    }

    /** 框选结果回传给 sidepanel(无接收方时静默失败,不影响页面) */
    async function reportPick(el: Element, finder: (input: Element) => string): Promise<void> {
      try {
        await browser.runtime.sendMessage({
          type: 'ai-sidebar/pick-element-result',
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

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'ai-sidebar/pick-element') {
        if (message.action === 'start') {
          void enterPickMode();
        } else if (message.action === 'resolve' && typeof message.selector === 'string') {
          sendResponse(resolveElementPayload(message.selector));
        }
        return;
      }
      if (message?.type !== 'ai-sidebar/extract-page') return;
      // 异步提取:返回 true 保持消息通道开放,完成后 sendResponse
      extractStable().then(sendResponse);
      return true;
    });
  },
});
