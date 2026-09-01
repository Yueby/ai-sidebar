# ai-sidebar — 项目代号

开源 **BYOK 浏览器 AI 侧边栏扩展**(Chromium 系:Chrome/Edge/Brave),对标 Chrome 内置 Gemini 侧边栏,但用你自己的 API Key、UI 现代化。

> 命名约定:`ai-sidebar` 是**永久内部代号**(目录名/包名),不要改目录名——pi 的会话历史按工作目录存储,改目录会"丢"对话。以后要改的只是产品名(`package.json` name、manifest name、商店上架名),这些随时可改、零影响。

## 产品范围(已确认)

- **MVP(当前目标)**
  - sidePanel 聊天:流式输出、Markdown/代码高亮、多会话历史管理
  - 读取当前网页:content script 提取标题/URL/正文,一键注入对话上下文(header 开关)
  - BYOK:统一走 **OpenAI 兼容协议**(OpenAI / DeepSeek / OpenRouter / Kimi / GLM / Ollama / 自定义 baseUrl+key+model)
- **二期**:划词快捷提问(选中文字弹快捷操作)、多模型快捷切换、会话重命名/导出
- **三期**:agent 页面操作(参考 Nanobrowser 的多 agent 思路),暂不做

## UI 方向(已确认)

- shadcn/ui(new-york)+ Tailwind v4,**自动跟随系统深浅色**(`sidepanel/theme.ts` 在渲染前切 `.dark`)
- 中性底色 + violet 点缀色;现代、不死板;组件按需用 shadcn,不重复造轮子
- 窄侧边栏(~320-400px)优先:图标按钮 + tooltip,信息密度适中

## 既定技术决策(不要推翻)

| 项 | 决策 |
|---|---|
| 框架 | WXT 0.21 + React 19 + TypeScript,包管理 pnpm |
| 样式 | Tailwind v4(`@tailwindcss/vite`)+ shadcn/ui,token 在 `sidepanel/style.css` |
| 加 shadcn 组件 | `pnpm dlx shadcn@latest add <name> -y -o`(components.json 已配好,已装 button/input/textarea/dialog/dropdown-menu/scroll-area/select/separator/switch/tooltip/badge/label) |
| API 请求 | sidepanel 页面直接 `fetch`(host_permissions 已放行 http/https,绕过 CORS),SSE 流式解析,支持 AbortController |
| 存储 | wxt `storage`(`local:settings`、`local:sessions`),storage 为唯一数据源,**不引状态库** |
| 页面提取 | 消息协议 `{type:'ai-sidebar/extract-page'}` → `{title,url,text}`,由 content.ts 应答 |
| Markdown | react-markdown + remark-gfm + rehype-highlight(已装) |
| 路径别名 | `@/*` → 项目根 |

## 目录结构

```
entrypoints/
  sidepanel/          # 侧边栏 UI(index.html / main.tsx / theme.ts / App.tsx / style.css)
  background.ts       # 点击工具栏图标打开侧边栏
  content.ts          # 页面文本提取(当前为 innerText 临时实现,待换结构化提取)
lib/
  utils.ts            # cn()
  (待建) types.ts storage.ts providers.ts stream.ts
components/ui/        # shadcn 组件
```

## Roadmap(下个会话按序实现)

1. **lib 核心**:`types.ts`(Message/Session/Settings)、`storage.ts`(defineItem + 默认值)、`providers.ts`(预设列表含默认 baseUrl/model)、`stream.ts`(`streamChat()` SSE 流式 + 错误信息可读化)
2. **sidepanel UI**:消息流 + composer(Enter 发送 / Shift+Enter 换行 / 流式中的停止按钮)+ 会话历史 dialog + 设置 dialog(provider 选择联动 baseUrl/model、API Key、测试连接)
3. **页面上下文**:header 开关(持久化到 settings)→ 发送前 `tabs.query` + `tabs.sendMessage` 提取 → 以 system 消息注入(带截断上限)
4. **体验收尾**:空状态引导(总结此页/提取要点等预设问题)、消息复制、自动滚动(用户上翻时不打断)、错误/取消的 UI 呈现、content.ts 换可读性优先的结构化提取
5. **发布**:图标替换、`wxt zip`

## 约定

- 每步完成跑 `pnpm compile && pnpm build`,必须全绿
- 手动验收:`pnpm dev` 会自动拉起 Chrome 并加载扩展;或 `chrome://extensions` 加载 `.output/chrome-mv3`
- 不打印/提交任何 API Key;密钥只存 `chrome.storage.local`
- 改动保持克制:不做 Roadmap 外的重构和依赖引入
