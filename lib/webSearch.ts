import type { WebSearchConfig } from './types';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

const SEARCH_TIMEOUT_MS = 10_000;
const MAX_RESULTS = 8;

/** content script 同域:sidepanel 发起的 fetch 默认 UA 会被部分源拒绝,带浏览器 UA 提高兼容 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** 源是否可用(provider 已选且必填字段齐备);工具注册与运行时守卫共用 */
export function isWebSearchConfigured(config: WebSearchConfig): boolean {
  switch (config.provider) {
    case 'duckduckgo':
    case 'bing':
      return true;
    case 'searxng':
      return config.searxngBaseUrl.trim() !== '';
    case 'brave':
    case 'tavily':
    case 'bocha':
    case 'serper':
    case 'exa':
    case 'zhipu':
    case 'metaso':
      return (config.apiKeys[config.provider] ?? '').trim() !== '';
    default:
      return false;
  }
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function collapseWhitespace(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** DDG 结果链接是 //duckduckgo.com/l/?uddg=<encoded> 重定向壳;还原真实 URL */
function decodeDdgHref(href: string): string {
  const marker = 'uddg=';
  const idx = href.indexOf(marker);
  if (idx < 0) return href.startsWith('//') ? `https:${href}` : href;
  try {
    return decodeURIComponent(href.slice(idx + marker.length).split('&')[0] ?? href);
  } catch {
    return href;
  }
}

/** DuckDuckGo(免费):HTML 端点解析;解析依赖 class 名,源站改版会失效(已知脆弱) */
async function searchDuckDuckGo(query: string): Promise<WebSearchResult[]> {
  const response = await fetchWithTimeout(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    { headers: { 'User-Agent': USER_AGENT } },
  );
  if (!response.ok) {
    throw new Error(`search_failed: DuckDuckGo returned ${response.status}`);
  }
  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  const results: WebSearchResult[] = [];
  for (const block of doc.querySelectorAll('.result')) {
    const anchor = block.querySelector('a.result__a');
    const href = anchor?.getAttribute('href') ?? '';
    const title = collapseWhitespace(anchor?.textContent);
    if (!href || !title) continue;
    results.push({
      title,
      url: decodeDdgHref(href),
      snippet: collapseWhitespace(block.querySelector('.result__snippet')?.textContent),
    });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

/** SearXNG(免费):公共/自托管实例的 HTML 端点(JSON API 多数实例默认关闭,不走) */
async function searchSearXNG(config: WebSearchConfig, query: string): Promise<WebSearchResult[]> {
  const base = config.searxngBaseUrl.trim().replace(/\/+$/, '');
  const response = await fetchWithTimeout(`${base}/search?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`search_failed: SearXNG instance returned ${response.status}`);
  }
  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  const results: WebSearchResult[] = [];
  for (const article of doc.querySelectorAll('article.result')) {
    const anchor =
      article.querySelector('h3 > a') ?? article.querySelector('a.url_wrapper') ?? article.querySelector('a[href]');
    const href = anchor?.getAttribute('href') ?? '';
    const title = collapseWhitespace(anchor?.textContent);
    if (!href || !title) continue;
    results.push({
      title,
      url: href,
      snippet: collapseWhitespace(article.querySelector('p.content')?.textContent),
    });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

/** Brave Search(API Key;免费层每月 2000 次) */
async function searchBrave(config: WebSearchConfig, query: string): Promise<WebSearchResult[]> {
  const apiKey = (config.apiKeys.brave ?? '').trim();
  const response = await fetchWithTimeout(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${MAX_RESULTS}`,
    {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey,
        'User-Agent': USER_AGENT,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`search_failed: Brave returned ${response.status}`);
  }
  const data = (await response.json()) as {
    web?: { results?: { title: string; url: string; description?: string }[] };
  };
  return (data.web?.results ?? [])
    .slice(0, MAX_RESULTS)
    .map((r) => ({ title: r.title, url: r.url, snippet: (r.description ?? '').replace(/<[^>]+>/g, '') }));
}

/** Tavily(API Key;面向 AI 的搜索聚合) */
async function searchTavily(config: WebSearchConfig, query: string): Promise<WebSearchResult[]> {
  const apiKey = (config.apiKeys.tavily ?? '').trim();
  const response = await fetchWithTimeout('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: MAX_RESULTS }),
  });
  if (!response.ok) {
    throw new Error(`search_failed: Tavily returned ${response.status}`);
  }
  const data = (await response.json()) as {
    results?: { title: string; url: string; content?: string }[];
  };
  return (data.results ?? [])
    .slice(0, MAX_RESULTS)
    .map((r) => ({ title: r.title, url: r.url, snippet: collapseWhitespace(r.content) }));
}

/** 博查(国内 agent 搜索事实标准;text 摘要) */
async function searchBocha(config: WebSearchConfig, query: string): Promise<WebSearchResult[]> {
  const apiKey = (config.apiKeys.bocha ?? '').trim();
  const response = await fetchWithTimeout('https://api.bochaai.com/v1/web-search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, summary: false, count: MAX_RESULTS }),
  });
  if (!response.ok) {
    throw new Error(`search_failed: Bocha returned ${response.status}`);
  }
  const data = (await response.json()) as {
    data?: { webPages?: { value?: { name: string; url: string; snippet?: string; summary?: string }[] } };
  };
  return (data.data?.webPages?.value ?? [])
    .slice(0, MAX_RESULTS)
    .map((r) => ({
      title: r.name,
      url: r.url,
      snippet: collapseWhitespace(r.snippet || r.summary),
    }));
}

/** Serper(Google SERP;免费层每月 2500 次) */
async function searchSerper(config: WebSearchConfig, query: string): Promise<WebSearchResult[]> {
  const apiKey = (config.apiKeys.serper ?? '').trim();
  const response = await fetchWithTimeout('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
    },
    body: JSON.stringify({ q: query, num: MAX_RESULTS }),
  });
  if (!response.ok) {
    throw new Error(`search_failed: Serper returned ${response.status}`);
  }
  const data = (await response.json()) as {
    organic?: { title: string; link: string; snippet?: string }[];
  };
  return (data.organic ?? [])
    .slice(0, MAX_RESULTS)
    .map((r) => ({ title: r.title, url: r.link, snippet: collapseWhitespace(r.snippet) }));
}

/** Exa(语义搜索;注册送额度) */
async function searchExa(config: WebSearchConfig, query: string): Promise<WebSearchResult[]> {
  const apiKey = (config.apiKeys.exa ?? '').trim();
  const response = await fetchWithTimeout('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ query, numResults: MAX_RESULTS }),
  });
  if (!response.ok) {
    throw new Error(`search_failed: Exa returned ${response.status}`);
  }
  const data = (await response.json()) as {
    results?: { title: string; url: string; text?: string; summary?: string; highlights?: string[] }[];
  };
  return (data.results ?? [])
    .slice(0, MAX_RESULTS)
    .map((r) => ({
      title: r.title,
      url: r.url,
      snippet: collapseWhitespace(r.text || (r.highlights ?? []).join('\n') || r.summary),
    }))
    .map((r) => ({ ...r, snippet: r.snippet.replace(/<[^>]+>/g, '') }));
}

/** 智谱(bigmodel.cn 开放平台 web_search) */
async function searchZhipu(config: WebSearchConfig, query: string): Promise<WebSearchResult[]> {
  const apiKey = (config.apiKeys.zhipu ?? '').trim();
  const response = await fetchWithTimeout('https://open.bigmodel.cn/api/paas/v4/web_search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ search_query: query, search_engine: 'search_std', count: MAX_RESULTS }),
  });
  if (!response.ok) {
    throw new Error(`search_failed: Zhipu returned ${response.status}`);
  }
  const data = (await response.json()) as {
    search_result?: { title: string; link: string; content?: string }[];
  };
  return (data.search_result ?? [])
    .slice(0, MAX_RESULTS)
    .map((r) => ({ title: r.title, url: r.link, snippet: collapseWhitespace(r.content) }));
}

/** 秘塔(metaso.cn 开放 API) */
async function searchMetaso(config: WebSearchConfig, query: string): Promise<WebSearchResult[]> {
  const apiKey = (config.apiKeys.metaso ?? '').trim();
  const response = await fetchWithTimeout('https://metaso.cn/api/v1/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ q: query, scope: 'webpage', size: MAX_RESULTS }),
  });
  if (!response.ok) {
    throw new Error(`search_failed: Metaso returned ${response.status}`);
  }
  const data = (await response.json()) as {
    webpages?: { title: string; link: string; snippet?: string }[];
  };
  return (data.webpages ?? [])
    .slice(0, MAX_RESULTS)
    .map((r) => ({ title: r.title, url: r.link, snippet: collapseWhitespace(r.snippet) }));
}

/** Bing(无 Key HTML 抓取;解析依赖 class 名,被拦/改版会失效) */
async function searchBing(query: string): Promise<WebSearchResult[]> {
  const response = await fetchWithTimeout(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': USER_AGENT, Referer: 'https://www.bing.com/' },
  });
  if (!response.ok) {
    throw new Error(`search_failed: Bing returned ${response.status}`);
  }
  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  const results: WebSearchResult[] = [];
  for (const block of doc.querySelectorAll('li.b_algo')) {
    const anchor = block.querySelector('h2 > a');
    const href = anchor?.getAttribute('href') ?? '';
    const title = collapseWhitespace(anchor?.textContent);
    if (!href || !title) continue;
    results.push({
      title,
      url: href,
      snippet: collapseWhitespace(block.querySelector('.b_caption p')?.textContent),
    });
    if (results.length >= MAX_RESULTS) break;
  }
  if (results.length === 0) {
    throw new Error('search_failed: Bing HTML endpoint returned no results (may be rate-limited)');
  }
  return results;
}

/** 按配置分发;错误以规范化前缀英文文本抛出(search_failed/not_configured),由工具层转 tool result */
export async function searchWeb(config: WebSearchConfig, query: string): Promise<WebSearchResult[]> {
  switch (config.provider) {
    case 'duckduckgo':
      return searchDuckDuckGo(query);
    case 'searxng':
      return searchSearXNG(config, query);
    case 'brave':
      return searchBrave(config, query);
    case 'tavily':
      return searchTavily(config, query);
    case 'bocha':
      return searchBocha(config, query);
    case 'serper':
      return searchSerper(config, query);
    case 'exa':
      return searchExa(config, query);
    case 'zhipu':
      return searchZhipu(config, query);
    case 'bing':
      return searchBing(query);
    case 'metaso':
      return searchMetaso(config, query);
    default:
      throw new Error('not_configured: no web search provider is configured in settings.');
  }
}
