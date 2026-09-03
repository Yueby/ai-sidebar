/**
 * 权限声明与展示(设置「权限」页签的数据层)。
 *
 * 权限架构(用户拍板):全部权限随安装授予——
 * - host <all_urls> 为 screenshot_page(captureVisibleTab)的硬要求(Chrome 只认 <all_urls>/activeTab,
 *   站点级通配不够);read/click/fill 依赖的 content_scripts 宿主访问本就随安装自动授予
 * - 「允许运行用户脚本」开关(Chrome 138+)无 API 可代开,仅能检测+引导(设置页签直达详情页)
 *
 * 扩展新权限 = 在对应表加定义,设置页签自动跟随;不采用运行时授权流程(2026-09 备案)。
 */

/** 权限定义(UI 展示 + 可扩展注册表) */
export interface PermissionDef {
  id: string;
  /** 权限清单中的字面量(展示用,如 userScripts / <all_urls>) */
  raw: string;
  /** 用户可见名称 */
  name: string;
  /** 用途说明(为什么需要) */
  description: string;
}

/** 随扩展安装自动授予的权限(信息展示,无交互) */
export const INSTALL_PERMISSIONS: PermissionDef[] = [
  {
    id: 'storage',
    raw: 'storage',
    name: '本地存储',
    description: '保存你的提供商配置与 API Key(仅存本机,不上传)',
  },
  {
    id: 'sidePanel',
    raw: 'sidePanel',
    name: '侧边栏',
    description: '在浏览器侧边栏展示对话界面',
  },
  {
    id: 'scripting',
    raw: 'scripting',
    name: '脚本注入',
    description: '向网页注入读取与交互脚本(页面读取、元素点击/填充的执行基础)',
  },
  {
    id: 'activeTab',
    raw: 'activeTab',
    name: '当前标签页',
    description: '你点击工具栏图标时,对当前标签页的临时访问授权',
  },
  {
    id: 'userScripts',
    raw: 'userScripts',
    name: '用户脚本',
    description: 'execute_js 工具的隔离执行通道(Chrome 135+;需在扩展详情页开启 Allow User Scripts)',
  },
  {
    id: 'unlimitedStorage',
    raw: 'unlimitedStorage',
    name: '无限存储',
    description: '本地会话历史不设容量上限',
  },
];

/** 网页访问(host <all_urls>,随安装授予):screenshot_page 与 read_element 图片兜底的硬依赖 */
export const WEB_ACCESS_PERMISSION: PermissionDef = {
  id: 'web-access',
  raw: '<all_urls>',
  name: '网页访问',
  description:
    '读取与操作网页的宿主权限:页面截图与图片兜底取图的硬依赖;页面读取、元素清单、点击/填充由 content_scripts 声明同样随安装授予。',
};
