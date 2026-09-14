/**
 * "无 ARIA 角色的可点容器"的线索构造(纯函数,可单测)。
 *
 * 真实网站的图片卡片(如 `<div class="role-item-box"><img></div>`)没有 role/name/href/tabindex,
 * 用户眼里的"入口"在语义世界里不存在 —— 采集侧靠 cursor:pointer 识别它,这里给出模型可见的线索:
 * - name:优先 img 的 alt/title,其次容器自身可见文本(有 name 才能用 role+name 寻址);
 * - hint:img 文件名(去路径/查询串),用于区分一批同名甚至无名的卡片
 *   (24 个角色入口长得一模一样,文件名是页面上唯一稳定的区分线索)。
 *
 * 本模块不得引入 `#i18n`/浏览器 API:它被 content script 侧引用。
 */
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
