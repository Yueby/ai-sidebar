# AI Sidebar

[English](README.md) · **简体中文**

一个**开源**的 BYOK(Bring Your Own Key,自带密钥)浏览器 AI 侧边栏。类似"侧边栏里的 ChatGPT",区别在于:密钥是你自己的、模型由你选、而且 agent 真的**能读、能操作**你正在看的那个页面。

基于 [WXT](https://wxt.dev) + React 19 构建,全部在你的机器上运行:除了向你自己配置的服务商发起请求,API Key 与会话数据不出浏览器。

> `ai-sidebar` 是永久内部代号,商店名为 **AI Sidebar**。

---

## 它能做什么

**不打扰你的对话**

- 原生 `sidePanel`:流式回答、Markdown 渲染、代码高亮(Shiki,亮/暗双主题)、思考过程折叠区、工具调用卡片
- 会话历史:AI 自动命名、行内改名、导出 Markdown、跟进建议
- Composer 支持斜杠命令(`/compact`、`/clear`、`/help`)、快捷指令,以及**跟随会话**的草稿
- 上下文占用环(看得见模型窗口还剩多少)+ 一键压缩

**你的服务商、你的密钥**

- 三种协议:**OpenAI 兼容 · Chat Completions**、**OpenAI 兼容 · Responses**、**Anthropic Messages**
- 适配 OpenAI / DeepSeek / OpenRouter / Kimi / GLM / Ollama,或任意自定义 `baseUrl` + key + 模型
- 可从端点拉取模型列表、与 models.dev 同步元信息、测试连接,或手动添加模型
- **模型分工**:主模型负责对话,轻量模型负责辅助任务(命名、快捷指令),各自可配思考档位

**页面上下文:按需读取**

- 引用的标签页以 `<page-refs>` 元数据块随消息发出——模型知道**你指的是哪些页**,但不会自动拿到正文
- 可视化**框选元素**:选中的元素成为消息里的内联徽章,模型需要时再去读它
- `read_page` / `read_element` / `search_page` 只在模型主动请求时抓取内容;图片可交给 vision 模型
- 长文**分窗**:截断时明确告知"本次拿到的是全文哪个区间、下一次该用哪个 offset",长文可跨多次调用读完,而不是静默截掉

**会动手的 agent**

- `search_element` 按 ARIA role + 可访问名称列出可交互元素,模型无需猜 selector
- `click_element`、`fill_element`、`scroll_page`、`screenshot_page`、`open_page`、`activate_page`、`close_page`
- `execute_js` 兜底长尾场景,`fetch_url` / `search_web` 把触角伸出当前标签页
- `read_time` 用设备本地时间回答与时间相关的问题;`ask_user` 让模型直接把结构化问题抛给你,而不是自己猜
- **特权动作默认全部走确认卡**(或由你在本会话内授权),并附带动作前后的反馈与结构化错误
- 后台标签截图走 CDP:**截别的标签不会把你的视图切走**

**网络搜索**

- 十种可互换搜索源:DuckDuckGo、SearXNG、Brave、Tavily、Bocha、Serper、Exa、Zhipu、Metaso、Bing——需要 key 的按你自备

**一切本地化**

- 设置与 API Key 存 `chrome.storage.local`
- 会话以 **JSONL 记录**存 IndexedDB,对齐 pi 的 session 格式(条目 id + 线性 parent 链)
- 可选 WebDAV 备份,上传前在客户端加密(AES-GCM + PBKDF2)

---

## 环境要求

- Chromium 系浏览器,**Chrome 135+**(Edge/Brave 同代即可)
- Node.js 20+ 与 pnpm(仅从源码构建需要)
- 至少一个服务商的 API Key(或本地 Ollama / 任意 OpenAI 兼容端点)
- **Chrome 138+**:使用 `execute_js` 需在扩展详情页打开 **Allow User Scripts**(Chrome 对用户脚本的强制开关,扩展首次启动会引导你开启)

---

## 安装

### 从源码运行

```bash
pnpm install
pnpm dev          # 启动 WXT、构建,并自动拉起装好扩展的 Chrome
```

手动加载方式:

```bash
pnpm build        # 产物在 .output/chrome-mv3
```

然后打开 `chrome://extensions` → 开启**开发者模式** → **加载已解压的扩展程序** → 选择 `.output/chrome-mv3`。

### 打包 zip

```bash
pnpm zip          # .output/ai-sidebar-<版本>-chrome.zip
```

---

## 权限说明(为什么需要它们)

| 权限 | 用途 |
|---|---|
| `storage`、`unlimitedStorage` | 设置、API Key、会话数据库 |
| `sidePanel` | 侧边栏本体 |
| `scripting` | 声明式注入未覆盖时补注入 content script |
| `activeTab` | 在你调用扩展后操作当前页面 |
| `userScripts` | 在页面自身世界执行 `execute_js`(Chrome 135+,需用户开关) |
| `debugger` | 可信滚轮滚动兜底、后台标签截图(附加期间 Chrome 会显示"正在调试"横幅;闲置 60s 自动 detach) |
| `favicon` | 引用栏里的标签页图标 |
| `<all_urls>` | 读取被引用的页面、截取可见标签页 |

本项目的**服务端不存在**——没有任何数据发往本项目拥有的服务器;请求只去你自己配置的服务商与搜索端点。

---

## 页面上下文是怎么工作的

扩展**刻意不**把整页塞进每次请求:

1. 被引用的标签页以元数据(`tabId`/标题/URL)挂在 `<page-refs>` 块里,框选元素以自闭合 `<picked-element …/>` 块内嵌在消息文本中;
2. 系统提示词告知模型这些"句柄"存在;
3. 模型需要正文时自己调 `read_page` / `read_element` / `search_page` / `search_element`,只有该次结果进入上下文窗口。

读取是有界的(单次 12,000 字符、按块边界对齐);被截断时结果里会写明全文长度与**继续读的精确 offset**,所以长文能分多次读完,而不会被静默砍掉。

---

## 技术栈

| 领域 | 选择 |
|---|---|
| 框架 | WXT 0.21、React 19、TypeScript、pnpm |
| UI | Tailwind v4、shadcn/ui(Base UI 原语)、lucide 图标 |
| 状态 | zustand v5(单 store,显式 IndexedDB 持久化) |
| AI | `@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`(agent 循环、工具调用、压缩均为上游实现,不自研) |
| 存储 | IndexedDB(`idb`)+ JSONL 记录;Markdown 导出 |
| 页面提取 | Mozilla Readability + 语义化 Markdown,ARIA 元数据用 `dom-accessibility-api` |
| 输入区 | TipTap 3(引用与元素内联徽章) |
| 代码高亮 | Shiki + JavaScript 正则引擎(不依赖 WASM,因此在 MV3 默认 CSP 下可用) |

---

## 目录结构

```
entrypoints/
  background.ts        点击工具栏图标打开侧边栏
  content.ts           页面提取、框选元素、ARIA 发现、页面动作执行
  sidepanel/           UI(App、store 切片、hooks、聊天与设置组件)
lib/
  agent.ts             pi Agent 接线:会话 Agent、发送/续跑、事件桥
  sessionRuntime.ts    UI 投影层(Agent 事件 → 可渲染状态)
  sessionStore.ts      IndexedDB 中的 JSONL 会话记录
  tools/               一工具一文件 + 唯一注册表组装
docs/                  决策、避坑、现状、回归清单、测试脚本
fixtures/              手动测试用的本地页面(long-page、page-actions)
tests/                 node:test 测试
```

---

## 开发备注

```bash
pnpm compile      # tsc --noEmit
pnpm build        # 生产构建
pnpm zip          # 商店包

npx tsx --test "tests/*.test.ts"    # 测试(node:test)
```

- 改动 `entrypoints/content.ts`、消息协议或权限后,**必须完整重启 `pnpm dev` 并刷新目标页面**——侧边栏热更新不等于 content script 更新。
- dev 浏览器 profile 已持久化(`.wxt/chrome-data`),登录态与测试数据跨重启保留。
- 本地测试页:`npx http-server fixtures/page-actions -p 8788`、`npx http-server fixtures/long-page -p 8789`。

---

## 文档

| 文件 | 内容 |
|---|---|
| [docs/decisions.md](docs/decisions.md) | 决策日志——为什么是现在这样 |
| [docs/pitfalls.md](docs/pitfalls.md) | UI/React/Tailwind 与上游库的坑、环境备注 |
| [docs/status-and-open-issues.md](docs/status-and-open-issues.md) | 当前阶段、待办、开放问题及取证方法 |
| [docs/regression.md](docs/regression.md) | 手动回归清单与提示词 |
| [docs/session-jsonl-format.md](docs/session-jsonl-format.md) | 会话记录格式规格 |
| [AGENTS.md](AGENTS.md) | 项目约定与硬约束 |

---

## 状态

规划范围内的功能已完整实现,当前版本 `0.1.0`。工具面、性能、i18n 与存储路径的手动回归已通过;**仍未验证的项与开放问题**如实记录在 [docs/status-and-open-issues.md](docs/status-and-open-issues.md)。

## 许可

[MIT](LICENSE) © 2026 Yueby。
