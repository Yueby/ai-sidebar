/**
 * 站点图标 URL(chrome://favicon 的官方扩展版)。
 * 需 manifest 声明 "favicon" 权限(无安装警告);本地生成,不依赖外部服务。
 */
export function faviconUrl(pageUrl: string, size: 16 | 32 = 32): string {
  // WXT 对 getURL 参数有类型强校验(PublicPath),/_favicon 是 Chrome 内置动态路由,需 cast
  return (browser.runtime.getURL as (path: string) => string)(
    `/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`,
  );
}
