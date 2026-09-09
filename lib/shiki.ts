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
    createHighlighter({ themes: ['github-light', 'github-dark'], langs: [...LANGS] })
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
 */
export function highlightToHtml(code: string, lang: string): string | null {
  if (!highlighter) return null;
  try {
    return highlighter.codeToHtml(code, {
      lang: lang as BundledLanguage,
      themes: { light: 'github-light', dark: 'github-dark' } satisfies Record<string, BundledTheme>,
      defaultColor: false,
    });
  } catch {
    return null;
  }
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
