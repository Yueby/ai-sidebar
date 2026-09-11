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

import { i18n } from '#i18n';

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
    name: i18n.t('permissions.storage.name'),
    description: i18n.t('permissions.storage.description'),
  },
  {
    id: 'sidePanel',
    raw: 'sidePanel',
    name: i18n.t('permissions.sidePanel.name'),
    description: i18n.t('permissions.sidePanel.description'),
  },
  {
    id: 'scripting',
    raw: 'scripting',
    name: i18n.t('permissions.scripting.name'),
    description: i18n.t('permissions.scripting.description'),
  },
  {
    id: 'activeTab',
    raw: 'activeTab',
    name: i18n.t('permissions.activeTab.name'),
    description: i18n.t('permissions.activeTab.description'),
  },
  {
    id: 'userScripts',
    raw: 'userScripts',
    name: i18n.t('permissions.userScripts.name'),
    description: i18n.t('permissions.userScripts.description'),
  },
  {
    id: 'unlimitedStorage',
    raw: 'unlimitedStorage',
    name: i18n.t('permissions.unlimitedStorage.name'),
    description: i18n.t('permissions.unlimitedStorage.description'),
  },
];

/** 网页访问(host <all_urls>,随安装授予):screenshot_page 与 read_element 图片兜底的硬依赖 */
export const WEB_ACCESS_PERMISSION: PermissionDef = {
  id: 'web-access',
  raw: '<all_urls>',
  name: i18n.t('permissions.webAccess.name'),
  description: i18n.t('permissions.webAccess.description'),
};

/** 直达扩展详情页(「允许运行用户脚本」开关所在;Chrome 无 API 可代开,只能引导) */
export function openExtensionDetails(): void {
  void browser.tabs.create({ url: `chrome://extensions/?id=${browser.runtime.id}` });
}

