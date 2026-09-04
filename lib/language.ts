/**
 * AI 生成内容语言:全局设定(默认自动 = 浏览器语言),除非用户消息明确指定其他语言。
 *
 * UI 展示用原生语言名(label),prompt 注入用英文名(english,Model-facing 规范);
 * 无法映射的浏览器语言直接用 BCP-47 tag(模型可理解)。
 */

export interface LanguageOption {
  /** BCP-47 tag(settings.language 存储值) */
  tag: string;
  /** 设置页展示名(原生书写) */
  label: string;
  /** prompt 注入用英文名(Model-facing) */
  english: string;
}

/** 语言白名单:常见语言 + 自动检测(设置里 null 表示自动,不入列) */
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

/** 由 BCP-47 tag 找白名单项(精确) */
function findByTag(tag: string): LanguageOption | undefined {
  const lower = tag.toLowerCase();
  return AI_LANGUAGES.find((l) => l.tag.toLowerCase() === lower);
}

/**
 * 解析 AI 生成语言(英文名,注入 prompt):
 * - 设置了 language → 白名单英文名;非白名单 tag 原样返回(模型可理解)
 * - null(自动)→ 浏览器语言:精确命中白名单用英文名,主子标签命中用之,否则原样 tag
 */
export function resolveAiLanguage(language: string | null): string {
  if (language) {
    return findByTag(language)?.english ?? language;
  }
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  const exact = findByTag(nav);
  if (exact) return exact.english;
  const primary = nav.split('-')[0]!.toLowerCase();
  const loose = AI_LANGUAGES.find((l) => l.tag.toLowerCase() === primary);
  return loose?.english ?? nav;
}
