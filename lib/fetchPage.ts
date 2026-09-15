/**
 * fetch_url 抓取管线:sidepanel 直连 fetch 任意公开 URL(host_permissions http/https 已有)。
 * 自包含实现(与 content.ts 的页面提取管线暂不共享代码);错误一律英文文本 + 规范化前缀,
 * 前缀族与页面动作工具约定一致(fetch_failed/http_error/not_html/too_large/extract_failed)。
 */

/** 抓取正文截断上限(与 read_element 同值) */
export const FETCH_CONTENT_LIMIT = 12000;

/** 抓取体积守卫(字节上限;响应头缺失时按读入后的字符数复核) */
const FETCH_MAX_BYTES = 2_000_000;

/** 由 HTML 抽取正文纯文本:剥 script/style,块级元素按行聚合(保留段落/列表结构) */
function htmlToReadableText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,svg,template').forEach((el) => el.remove());
  const blocks = doc.querySelectorAll(
    'p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td,th,figcaption,dd,dt',
  );
  if (blocks.length === 0) {
    return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
  }
  const lines: string[] = [];
  const taken = new Set<Element>();
  for (const block of Array.from(blocks)) {
    // 嵌套块(li > p 等)只取外层一次,避免同文重复
    let ancestor = block.parentElement;
    let nested = false;
    while (ancestor) {
      if (taken.has(ancestor)) {
        nested = true;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    if (nested) continue;
    const text = (block.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    taken.add(block);
    lines.push(text);
  }
  return lines.join('\n');
}

/** IPv4 私有/保留段判定 */
function isPrivateIPv4(host: string): boolean {
  return /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}

/** IPv6 全展开为 8 组 4 位十六进制串(拼接后 32 字符);含非法组或多次 '::' 返回 null(由调用方 fail-closed) */
function expandIPv6(host: string): string | null {
  if ((host.match(/::/g) ?? []).length > 1) return null;
  const halves = host.split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  if (fill < 0 || (halves.length === 1 && fill !== 0)) return null;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  const expanded = groups.map((g) => (g.length >= 1 && g.length <= 4 ? g.padStart(4, '0') : ''));
  if (expanded.some((g) => !/^[0-9a-f]{4}$/.test(g))) return null;
  return expanded.join('');
}

/** 私有/内网地址判定(localhost/环回/未指定/链路本地/ULA/组播/.local/内网 IPv4)。
 *  WHATWG URL 的 IPv6 hostname 带方括号,需剥壳后统一判定 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.startsWith('[') ? hostname.slice(1, -1).toLowerCase() : hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) return true;
  if (!host.includes(':')) {
    return host === '0.0.0.0' || isPrivateIPv4(host);
  }
  // IPv6 字面量:展开失败一律拒绝;可展开则按段分类(expanded 恒为 32 字符,用切片避免下标 undefined)
  const expanded = expandIPv6(host);
  if (!expanded) return true;
  if (expanded.slice(0, 20) === '0'.repeat(20)) {
    // ::/96 前缀全零:环回(::1)、未指定(::)、v4 映射(::ffff:16 位十六进制)
    if (expanded.slice(20, 24) === 'ffff') {
      return isPrivateIPv4(v4FromHexGroups(expanded.slice(24, 28), expanded.slice(28, 32)));
    }
    return true;
  }
  const first16 = parseInt(expanded.slice(0, 4), 16);
  return (
    (first16 >= 0xfc00 && first16 <= 0xfdff) || // ULA fc00::/7
    (first16 >= 0xfe80 && first16 <= 0xfebf) || // 链路本地 fe80::/10
    first16 >= 0xff00 // 组播 ff00::/8
  );
}

/** 两个 16 位十六进制组解码为点分 IPv4(如 0a00,0001 → 10.0.0.1) */
function v4FromHexGroups(a: string, b: string): string {
  return [a.slice(0, 2), a.slice(2, 4), b.slice(0, 2), b.slice(2, 4)]
    .map((h) => parseInt(h, 16))
    .join('.');
}

export interface FetchedPage {
  title: string;
  url: string;
  content: string;
  truncated: boolean;
}

export type FetchPageResult =
  | { ok: true; page: FetchedPage }
  | { ok: false; error: string };

/** GitHub URL 归一化:blob 链接自动转为 raw.githubusercontent.com 直链 */
export function normalizeGitHubRawUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  const m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i.exec(trimmed);
  if (m) {
    return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
  }
  return trimmed;
}

/** 抓取公开 URL 的纯文本内容(带私有网络地址防御与重定向复检,供 GitHub 安装技能等安全使用) */
export async function fetchRawText(
  url: string,
  maxBytes = FETCH_MAX_BYTES,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, error: `Invalid URL: "${url}".` };
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return {
      ok: false,
      error: `Unsupported protocol "${parsedUrl.protocol}" — only http/https URLs can be fetched.`,
    };
  }
  if (isPrivateHost(parsedUrl.hostname)) {
    return {
      ok: false,
      error: 'Private/internal network addresses are not allowed.',
    };
  }

  let response: Response;
  try {
    response = await fetch(url, { redirect: 'follow' });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Network request failed: ${reason}` };
  }

  try {
    if (isPrivateHost(new URL(response.url).hostname)) {
      return {
        ok: false,
        error: 'Redirect to a private/internal address was blocked.',
      };
    }
  } catch {
    return { ok: false, error: 'Invalid redirect target.' };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `HTTP ${response.status} ${response.statusText || 'request failed'}.`,
    };
  }

  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (declaredLength > maxBytes) {
    return {
      ok: false,
      error: `Content is too large (${declaredLength} bytes, limit ${maxBytes}).`,
    };
  }

  const text = await response.text();
  if (text.length > maxBytes) {
    return {
      ok: false,
      error: `Content is too large (${text.length} characters, limit ${maxBytes}).`,
    };
  }

  return { ok: true, text };
}

/** 抓取并提取任意 URL 的网页正文;一切失败返回英文错误文本(规范化前缀),不抛出 */
export async function fetchAndExtractPage(url: string): Promise<FetchPageResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, error: `fetch_failed: invalid URL "${url}".` };
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { ok: false, error: `fetch_failed: unsupported protocol "${parsedUrl.protocol}" — only http/https URLs can be fetched.` };
  }
  // 私有/内网地址拒绝:防提示注入诱导模型探测用户内网服务(路由器面板/localhost 端口等)
  if (isPrivateHost(parsedUrl.hostname)) {
    return {
      ok: false,
      error: 'fetch_failed: private/internal network addresses are not allowed.',
    };
  }

  let response: Response;
  try {
    response = await fetch(url, { redirect: 'follow' });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `fetch_failed: ${reason}` };
  }
  // 重定向跟随后的终态地址复检:公开短链 302 到内网同样拦下
  if (isPrivateHost(new URL(response.url).hostname)) {
    return {
      ok: false,
      error: 'fetch_failed: redirect to a private/internal address was blocked.',
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `http_error: (${response.status}) ${response.statusText || 'request failed'} — the page could not be retrieved.`,
    };
  }

  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (declaredLength > FETCH_MAX_BYTES) {
    return {
      ok: false,
      error: `too_large: content is ${declaredLength} bytes (limit ${FETCH_MAX_BYTES}) — fetch a more specific URL instead.`,
    };
  }

  const body = await response.text();
  if (body.length > FETCH_MAX_BYTES) {
    return {
      ok: false,
      error: `too_large: content is ${body.length} characters (limit ${FETCH_MAX_BYTES}) — fetch a more specific URL instead.`,
    };
  }

  if (!contentType.includes('text/html') && !contentType.includes('xhtml')) {
    return {
      ok: false,
      error: `not_html: content-type is "${contentType || 'unknown'}" — only HTML pages can be extracted.`,
    };
  }

  try {
    const { Readability, isProbablyReaderable } = await import('@mozilla/readability');
    const doc = new DOMParser().parseFromString(body, 'text/html');
    if (isProbablyReaderable(doc)) {
      // Readability 会改写传入的 DOM,必须传克隆
      const article = new Readability(doc.cloneNode(true) as Document).parse();
      const text = article?.content ? htmlToReadableText(article.content) : '';
      if (text) {
        const truncated = text.length > FETCH_CONTENT_LIMIT;
        return {
          ok: true,
          page: {
            title: article?.title?.trim() || url,
            url,
            content: truncated ? text.slice(0, FETCH_CONTENT_LIMIT) : text,
            truncated,
          },
        };
      }
    }
    return {
      ok: false,
      error: 'extract_failed: no readable article could be extracted — the page may require JavaScript rendering or is not an article page.',
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `extract_failed: ${reason}` };
  }
}
