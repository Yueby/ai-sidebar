import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// 项目代号 ai-sidebar(内部用,产品名后续再定)
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'AI Sidebar',
    description: 'BYOK AI sidebar — chat with any page using your own API key.',
    // scripting: 程序化注入 content script(兜底扩展加载前已存在的标签页)+ execute_js 降级路线(MAIN world)
    // activeTab: 用户点击工具栏图标时临时授权,便于对未持 host 权限的页面执行注入
    // userScripts: execute_js 主路线 chrome.userScripts.execute(Chrome 135+;138+ 需在扩展详情页开 Allow User Scripts)
    permissions: ['storage', 'sidePanel', 'unlimitedStorage', 'scripting', 'activeTab', 'userScripts'],
    // userScripts.execute 自 Chrome 135 起可用
    minimum_chrome_version: '135',
    host_permissions: ['http://*/*', 'https://*/*'],
  },
  vite: () => ({
    plugins: [tailwindcss()],
    resolve: {
      alias: { '@': path.resolve() },
    },
  }),
});
