import type { PickedElement, RefElementMeta } from './types';

/**
 * 元素徽章 label 构造(拍板版):徽章/气泡/引用列表统一显示内容预览,"元素 N"字样
 * 从人类可见界面消失;编号只保留在引用列表行首前缀与 tooltip(#{N} · selector)。
 */

/** chip 上限(视觉单位):24 视觉单位 ≈ 12 个汉字 / 24 个拉丁字符 */
export const CHIP_LABEL_MAX = 24;
/** 引用列表上限(视觉单位):48 视觉单位 ≈ 24 个汉字 / 48 个拉丁字符 */
export const LIST_LABEL_MAX = 48;

/** CJK 视觉宽度加权:CJK(汉字/假名/谚文/全角)记 2,拉丁记 1 */
function charWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x3130 && code <= 0x318f) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7ff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef)
  ) {
    return 2;
  }
  return 1;
}

/** 按视觉宽度截断,超出部分以 … 结尾(换行已折叠为空格) */
function truncateVisual(text: string, maxUnits: number): string {
  let units = 0;
  let out = '';
  for (const ch of text) {
    const w = charWidth(ch);
    if (units + w > maxUnits) return `${out}…`;
    units += w;
    out += ch;
  }
  return out;
}

/** 预览基底:换行折叠为空格 + trim;空预览回退 <tagName>,再回退"页面元素" */
function basePreview(el: { preview?: string; tagName?: string }): string {
  const collapsed = (el.preview ?? '').replace(/\s+/g, ' ').trim();
  if (collapsed) return collapsed;
  if (el.tagName) return `<${el.tagName}>`;
  return '页面元素';
}

/** 元素内容预览(徽章/气泡 chip 用,24 视觉单位) */
export function elementChipLabel(el: Pick<PickedElement, 'preview' | 'tagName'> | Pick<RefElementMeta, 'preview' | 'tagName'>): string {
  return truncateVisual(basePreview(el), CHIP_LABEL_MAX);
}

/** 元素内容预览(引用列表用,同构 48 视觉单位) */
export function elementListLabel(el: Pick<PickedElement, 'preview' | 'tagName'> | Pick<RefElementMeta, 'preview' | 'tagName'>): string {
  return truncateVisual(basePreview(el), LIST_LABEL_MAX);
}
