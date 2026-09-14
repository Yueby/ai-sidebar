import type { PickedElement, RefElementMeta } from './types';
import { i18n } from '#i18n';

/**
 * 元素徽章 label 构造:徽章/气泡/引用列表统一显示内容预览,"元素 N"字样
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
  return i18n.t('refBar.defaultElementLabel');
}

/** 元素内容预览(徽章/气泡 chip 用,24 视觉单位) */
export function elementChipLabel(el: Pick<PickedElement, 'preview' | 'tagName'> | Pick<RefElementMeta, 'preview' | 'tagName'>): string {
  return truncateVisual(basePreview(el), CHIP_LABEL_MAX);
}

/** 元素内容预览(引用列表用,同构 48 视觉单位) */
export function elementListLabel(el: Pick<PickedElement, 'preview' | 'tagName'> | Pick<RefElementMeta, 'preview' | 'tagName'>): string {
  return truncateVisual(basePreview(el), LIST_LABEL_MAX);
}

/**
 * "无 ARIA 角色的可点容器"(真实网站的图片卡片,如 `<div class="role-item-box"><img></div>`)
 * 的模型可见线索:
 * - name:优先 img 的 alt/title,其次容器自身的可见文本 —— 有 name 才能用 role+name 寻址;
 * - hint:img 文件名(去路径/查询串),用于区分一批**同名甚至无名**的卡片
 *   (24 个角色的入口长得一模一样,文件名是页面上唯一稳定的区分线索)。
 * 纯函数,便于单测;content 侧采集与清单/树渲染共用同一份判定。
 */
export function clickableCardLabel(input: {
  imgAlt?: string | null;
  imgTitle?: string | null;
  imgSrc?: string | null;
  text?: string | null;
}): { name: string; hint: string } {
  const clean = (v?: string | null): string => (v ?? '').replace(/\s+/g, ' ').trim();
  const alt = clean(input.imgAlt);
  const title = clean(input.imgTitle);
  const own = clean(input.text).slice(0, 40);
  const file = clean(input.imgSrc).split(/[?#]/)[0]?.split('/').pop() ?? '';
  return {
    name: alt || title || own,
    hint: file ? `img ${file}` : alt ? `img ${alt}` : 'clickable container',
  };
}
