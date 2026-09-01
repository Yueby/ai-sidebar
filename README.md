# ai-sidebar

开源 BYOK 浏览器 AI 侧边栏扩展(Chrome / Edge / Brave),对标 Chrome 内置 Gemini 侧边栏:把你的 API Key 带进来,在侧边栏里和当前网页对话。

> 内部代号 `ai-sidebar`,产品名待定。项目方向、技术决策与 Roadmap 见 [AGENTS.md](./AGENTS.md)。

## 特性(规划)

- 🧩 原生 `sidePanel` 侧边栏,流式对话 + Markdown/代码高亮 + 多会话历史
- 📄 读取当前网页内容,针对页面提问
- 🔑 BYOK:OpenAI 兼容协议(OpenAI / DeepSeek / OpenRouter / Kimi / GLM / Ollama / 自定义)
- 🌗 深浅色自动跟随系统,shadcn/ui 现代化界面
- 🔒 隐私:Key 与会话只存本地 `chrome.storage.local`,无中间服务器

## 开发

```bash
pnpm install
pnpm dev        # 开发模式,自动拉起 Chrome
pnpm build      # 产物在 .output/chrome-mv3
pnpm compile    # tsc 类型检查
```

手动加载:`chrome://extensions` → 开发者模式 → 加载已解压 → 选 `.output/chrome-mv3`。

## 技术栈

WXT · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui
