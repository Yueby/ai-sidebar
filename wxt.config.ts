import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// 项目代号 ai-sidebar(内部用,产品名后续再定)
export default defineConfig({
  modules: ['@wxt-dev/module-react', '@wxt-dev/i18n/module', '@wxt-dev/auto-icons'],
  // 扩展图标:assets/icon.png(512²)自动生成全套尺寸并写入 manifest.icons
  // developmentIndicator: false —— 模块默认在 dev 构建把图标灰度化当“开发版”标记,关掉以显示真实颜色
  autoIcons: { developmentIndicator: false },
  // 扩展图标:assets/icon.png(512²)自动生成全套尺寸并写入 manifest.icons
  // locales 目录(默认 <srcDir>/locales)自动发现语言;默认语言 = manifest.default_locale(zh_CN)
  // dev 文件监听在部分 Windows 会话下静默失效(chokidar 事件丢失):强制 1s 轮询保证 rebuild 可靠
  watchOptions: { usePolling: true, interval: 1000 },
  manifest: {
    name: 'AI Sidebar',
    description: 'BYOK AI sidebar — chat with any page using your own API key.',
    // chrome.i18n 必需,@wxt-dev/i18n 也以它为开关(未设置时模块自我禁用)
    default_locale: 'zh_CN',
    // scripting: 程序化注入 content script(兜底扩展加载前已存在的标签页)+ execute_js 降级路线(MAIN world)
    // activeTab: 用户点击工具栏图标时临时授权,便于对未持 host 权限的页面执行注入
    // userScripts: execute_js 主路线 chrome.userScripts.execute(Chrome 135+;138+ 需在扩展详情页开 Allow User Scripts)
    permissions: ['storage', 'sidePanel', 'unlimitedStorage', 'scripting', 'activeTab', 'userScripts', 'favicon'],
    // userScripts.execute 自 Chrome 135 起可用
    minimum_chrome_version: '135',
    // host_permissions: <all_urls> 为 captureVisibleTab(截图)硬要求(Chrome 只认 <all_urls>/activeTab,
    // 站点级通配不够);content_scripts 声明的 http/https 宿主访问本就随安装授予,安装警告文案无升级
    host_permissions: ['<all_urls>'],
  },
  vite: () => ({
    plugins: [tailwindcss()],
    resolve: {
      alias: { '@': path.resolve() },
    },
    // dev 产物不清空:重建后旧 hash chunk 保留,长活侧边栏页面的动态 import 不断链
    // (发布前需手动清 .output/chrome-mv3,避免旧 chunk 混入 zip)
    build: { emptyOutDir: false },
    // dev server 层的文件监听同样强制轮询(watchOptions 只覆盖部分监听层)
    server: { watch: { usePolling: true, interval: 500 } },
  }),
});
