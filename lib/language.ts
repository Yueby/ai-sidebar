/**
 * AI 生成内容语言:全局设定(默认自动 = 浏览器语言),除非用户消息明确指定其他语言。
 *
 * 设置里 null = 自动(按浏览器语言解析);非空 = 用户自定义的自由文本,原样注入 prompt。
 * 自动模式解析用英文名(Model-facing 规范):按 BCP-47 tag 查映射表,未命中直接用 tag(模型可理解)。
 */

export interface LanguageOption {
  /** BCP-47 tag(settings.language 存储值) */
  tag: string;
  /** 设置页展示名(原生书写) */
  label: string;
  /** prompt 注入用英文名(Model-facing) */
  english: string;
}

/** 自动模式的浏览器语言 → 英文名映射表(非设置白名单;设置项本身为自由文本) */
export const AI_LANGUAGES: LanguageOption[] = [
  { tag: 'zh-CN', label: '简体中文', english: 'Simplified Chinese' },
  { tag: 'zh-TW', label: '繁體中文', english: 'Traditional Chinese' },
  { tag: 'en', label: 'English', english: 'English' },
  { tag: 'ja', label: '日本語', english: 'Japanese' },
  { tag: 'ko', label: '한국어', english: 'Korean' },
  { tag: 'fr', label: 'Français', english: 'French' },
  { tag: 'de', label: 'Deutsch', english: 'German' },
  { tag: 'es', label: 'Español', english: 'Spanish' },
  { tag: 'pt', label: 'Português', english: 'Portuguese' },
  { tag: 'ru', label: 'Русский', english: 'Russian' },
  { tag: 'it', label: 'Italiano', english: 'Italian' },
  { tag: 'ar', label: 'العربية', english: 'Arabic' },
];

/** 由 BCP-47 tag 查自动模式映射表(精确) */
function findByTag(tag: string): LanguageOption | undefined {
  const lower = tag.toLowerCase();
  return AI_LANGUAGES.find((l) => l.tag.toLowerCase() === lower);
}

/**
 * 解析 AI 生成语言(注入 prompt):
 * - 设置了自定义 language → 原样注入(用户自填文本,模型可理解任意写法)
 * - null(自动)→ 浏览器语言:精确命中映射表用英文名,主子标签命中用之,否则原样 tag
 */
export function resolveAiLanguage(language: string | null): string {
  if (language) return language;
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  const exact = findByTag(nav);
  if (exact) return exact.english;
  const primary = nav.split('-')[0]!.toLowerCase();
  const loose = AI_LANGUAGES.find((l) => l.tag.toLowerCase() === primary);
  return loose?.english ?? nav;
}
