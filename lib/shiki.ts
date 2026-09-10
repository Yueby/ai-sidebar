/**
 * shiki 代码高亮单例(react-markdown 渲染是同步管线,这里提供同步访问 + 就绪订阅)。
 *
 * 模块加载即后台初始化(动态 import 语言/主题 chunk,bundle 友好);就绪前
 * highlightToHtml 返回 null,调用方降级纯文本;就绪事件通知订阅方重渲染升级。
 * 双主题 github-light/github-dark 输出 --shiki-light/--shiki-dark CSS 变量,
 * 消费见 style.css 的 .shiki span 规则(跟随 .dark 自动切换)。
 * 语言集 = AI 回答高频语言,未知语言回退 text。
 */
import type { BundledLanguage, BundledTheme, HighlighterGeneric } from 'shiki';
// 必须显式指定 JS 正则引擎:shiki 的默认引擎是 Oniguruma **WASM**,而 MV3 扩展页默认 CSP
// (`script-src 'self'`)禁用 WASM 代码生成(Chrome 文档要求显式加 'wasm-unsafe-eval'),
// 本项目 manifest 无 CSP 字段 → 默认引擎会被 CSP 拒掉、createHighlighter reject → 高亮静默
// 降级为纯文本。JS 引擎无 WASM、零 CSP 改动、零新增依赖(覆盖点已核:
// @shikijs/core createBundledHighlighter 内 `engine: options.engine ?? engine()`)。
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

const LANGS = [
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'python',
  'json',
  'html',
  'css',
  'scss',
  'sql',
  'bash',
  'shellscript',
  'powershell',
  'yaml',
  'toml',
  'markdown',
  'rust',
  'go',
  'java',
  'kotlin',
  'c',
  'cpp',
  'csharp',
  'php',
  'ruby',
  'swift',
  'diff',
  'ini',
  'xml',
] as const;

const LANG_SET: ReadonlySet<string> = new Set<string>(LANGS);

let highlighter: HighlighterGeneric<BundledLanguage, BundledTheme> | null = null;
const readyListeners = new Set<() => void>();

// 模块级后台初始化(动态 import:shiki 及语言 JSON 全部 code-split,不进主包)
void import('shiki')
  .then(({ createHighlighter }) =>
    createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: [...LANGS],
      engine: createJavaScriptRegexEngine(),
    })
  )
  .then((h) => {
    highlighter = h;
    for (const cb of [...readyListeners]) cb();
    readyListeners.clear();
  })
  .catch((err) => {
    console.warn('[shiki] init failed, code blocks render as plain text:', err);
  });

/** 高亮器是否已就绪 */
export function isShikiReady(): boolean {
  return highlighter !== null;
}

/** 订阅就绪事件(已就绪立即回调;返回退订函数) */
export function onShikiReady(cb: () => void): () => void {
  if (highlighter) {
    cb();
    return () => {};
  }
  readyListeners.add(cb);
  return () => {
    readyListeners.delete(cb);
  };
}

/**
 * 同步高亮为 HTML(双主题 CSS 变量模式)。
 * 未就绪 / 语言不支持 / 异常 → null(调用方降级纯文本渲染)。
 *
 * 结果缓存:流式期间消息列表会高频重渲染,已完成的代码块不该反复分词——
 * 无缓存时每个代码块每秒要被重新高亮 20 次(真机反馈:AI 回复时整体卡顿)。
 * 上限 300 条 FIFO;命中/未命中计数供 DEV 诊断观察缓存效果。
 */
const highlightCache = new Map<string, string | null>();
const HIGHLIGHT_CACHE_MAX = 300;
export const shikiStats = { calls: 0, hits: 0, ms: 0 };

export function highlightToHtml(code: string, lang: string): string | null {
  if (!highlighter) return null;
  shikiStats.calls += 1;
  const key = `${lang}\u0000${code}`;
  if (highlightCache.has(key)) {
    shikiStats.hits += 1;
    return highlightCache.get(key) ?? null;
  }
  const started = typeof performance !== 'undefined' ? performance.now() : 0;
  let html: string | null = null;
  try {
    html = highlighter.codeToHtml(code, {
      lang: lang as BundledLanguage,
      themes: { light: 'github-light', dark: 'github-dark' } satisfies Record<string, BundledTheme>,
      defaultColor: false,
    });
  } catch {
    html = null;
  }
  if (started) shikiStats.ms += performance.now() - started;
  if (highlightCache.size >= HIGHLIGHT_CACHE_MAX) {
    const oldest = highlightCache.keys().next().value;
    if (oldest !== undefined) highlightCache.delete(oldest);
  }
  highlightCache.set(key, html);
  return html;
}

/** 语言名归一(react-markdown className 的 language-xxx → shiki lang;未知回退 text) */
export function normalizeShikiLang(className: string | undefined): string {
  const raw = className?.match(/language-([\w+#-]+)/)?.[1];
  if (!raw) return 'text';
  const aliases: Record<string, string> = {
    js: 'javascript',
    ts: 'typescript',
    py: 'python',
    sh: 'bash',
    zsh: 'bash',
    shell: 'bash',
    ps1: 'powershell',
    'c++': 'cpp',
    'c#': 'csharp',
    md: 'markdown',
    yml: 'yaml',
    golang: 'go',
    rs: 'rust',
    kt: 'kotlin',
    text: 'text',
    txt: 'text',
    plaintext: 'text',
  };
  const lang = aliases[raw] ?? raw;
  return LANG_SET.has(lang) ? lang : 'text';
}
