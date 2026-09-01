import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// 项目代号 ai-sidebar(内部用,产品名后续再定)
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'AI Sidebar',
    description: 'BYOK AI sidebar — chat with any page using your own API key.',
    permissions: ['storage', 'sidePanel'],
    host_permissions: ['http://*/*', 'https://*/*'],
  },
  vite: () => ({
    plugins: [tailwindcss()],
    resolve: {
      alias: { '@': path.resolve() },
    },
  }),
});
