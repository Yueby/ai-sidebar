# ai-sidebar — 项目代号

> **交接注(2026-09)**:UI 已全部实现,agent 运行时已升级到 pi-agent-core,引用架构为 `<page-refs>` 元数据块 + `read_page`/`read_element` 工具按需读取。当前唯一权威现状、最新决策与 API 契约见 **`HANDOFF.md`**,以它为准;本文件与它已同步。

开源 **BYOK 浏览器 AI 侧边栏扩展**(Chromium 系:Chrome/Edge/Brave),对标 Chrome 内置 Gemini 侧边栏,但用你自己的 API Key、UI 现代化。

> 命名约定:`ai-sidebar` 是**永久内部代号**(目录名/包名),不要改目录名——pi 的会话历史按工作目录存储,改目录会"丢"对话。以后要改的只是产品名(`package.json` name、manifest name、商店上架名),这些随时可改、零影响。

## 产品范围(已确认)

- **MVP(已完成,待手动回归)**
  - sidePanel 聊天:流式输出、Markdown/代码高亮、工具调用卡片、思考折叠区、token 脚注、多会话历史管理、会话草稿(输入/引用随会话走)
  - 读取当前网页:页面上下文默认开启,引用以 `<page-refs>` 元数据块内嵌 user 消息,AI 经 `read_page`(tabId 句柄读整页正文)/`read_element`(引用页内任意 CSS selector,返回 outerHTML)工具按需读取;支持框选元素,vision 模型可读框选图片
  - 通用工具:read_time(设备本地时间,免弹卡)/ ask_user(经 UI 门控向用户提问,未注册 UI 处理器时快速 cancelled)/ execute_js(confirm 型,在引用页执行 JS:主路线 `chrome.userScripts.execute`,降级 scripting MAIN world,`createGatedTool` 确认卡动态预览代码)
  - BYOK 多提供商:三种协议 —— **OpenAI 兼容 · Chat Completions / OpenAI 兼容 · Responses / Anthropic Messages**(OpenAI / DeepSeek / OpenRouter / Kimi / GLM / Ollama / 自定义 baseUrl+key+model)
- **二期**:划词快捷提问(选中文字弹快捷操作)、多模型快捷切换、会话重命名/导出
- **三期**:agent 页面操作工具层(参考 Nanobrowser 的 chrome.debugger/CDP 动作层,只借鉴不依赖),暂不做

## UI 方向(已确认)

- shadcn/ui(new-york)+ Tailwind v4,**自动跟随系统深浅色**(`sidepanel/theme.ts` 在渲染前切 `.dark`)
- **禁用紫色/violet,一律 shadcn 默认中性样式**;现代、不死板;组件按需用 shadcn,不重复造轮子
- 窄侧边栏(~320-400px)优先:图标按钮 + tooltip,信息密度适中
- `components/ui/` 必须保持 shadcn 官方原样,严禁自定义组件/样式/变体(button.tsx 曾被加 xs/icon-xs,已重置)

## 既定技术决策(不要推翻)

| 项 | 决策 |
|---|---|
| 框架 | WXT 0.21 + React 19 + TypeScript,包管理 pnpm |
| 样式 | Tailwind v4(`@tailwindcss/vite`)+ shadcn/ui,token 在 `sidepanel/style.css` |
| 加 shadcn 组件 | `pnpm dlx shadcn@latest add <name> -y -o`(components.json 已配好,已装 button/input/textarea/dialog/dropdown-menu/scroll-area/select/separator/switch/tooltip/badge/label/checkbox) |
| AI 请求 | **`@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`**(同版本 ^0.84.4),严禁手写 SSE/协议适配;`lib/agent.ts` 的 `runAgentTurn()` 是唯一发送入口(工具调用循环/abort/事件透出);唯一例外是"拉模型列表"两个 GET(在 `lib/models.ts`) |
| 存储 | 设置/API Key → chrome.storage.local(`local:settings`,manifest 已加 `unlimitedStorage`);会话历史+草稿 → **IndexedDB**(`lib/sessionStore.ts`,用 `idb`,旧 `local:sessions` 启动时一次性迁移);activeSessionId → chrome.storage.local;**不引状态库**;消息按 pi 消息联合形状持久化,旧扁平结构由 `sanitizeSessions/sanitizeMessage` 迁移 |
| 页面提取 | 引用元数据以 `<page-refs>{JSON}</page-refs>` 块内嵌 user 消息 content(唯一事实源,LLM 直读 + UI 解析同源,`lib/pageRefs.ts`);实时内容经 `read_page`(tabId 句柄读整页正文)/`read_element`(任意 CSS selector,返回 outerHTML 12000 字符截断;tab 级白名单=草稿∪历史块)工具按需读取,消息协议 `ai-sidebar/read-page`、`ai-sidebar/pick-element(-result)` 由 content.ts 应答(常量单一来源 `lib/types.ts`,content.ts 只 import 纯常量);图像经 `lib/imageFetch.ts`(fetch 主取 + captureVisibleTab 裁剪兜底 + canvas 降采样) |
| Markdown | react-markdown + remark-gfm + rehype-highlight(已装) |
| 权限 | manifest:`storage` / `sidePanel` / `unlimitedStorage` / `scripting` / `activeTab` / `userScripts`(+ host_permissions http/https);`minimum_chrome_version: "135"`(userScripts.execute 门槛);Chrome 138+ 需用户在扩展详情页开启 Allow User Scripts |
| 路径别名 | `@/*` → 项目根 |
| 工具命名 | `<动词>_<域词>`:动词集 {read, search, fetch, click, fill, scroll, screenshot, execute, ask} × 域词集 {page, element, url, web, js, user, time},新工具只许集合内组合(`extract_page` 已改名 `read_page`;`TOOL_LABELS` 保留旧 key 兼容历史会话;协议字符串已随名同步,常量单一来源 lib/types.ts) |
| 模型可见文本 | **一律英文**(Model-facing text):工具 description/参数 description、返回模板与截断标注、错误分支、非 vision 图片描述、system prompt 全文;UI 显示文案(TOOL_LABELS 中文值等)保持中文,以后收敛 i18n |

## 关键 UI 决策(已实现)

- 历史会话 = Header 内 DropdownMenu(非 Dialog);设置页 = Header 内切换 提供商/关于 两个视图(无 Tabs 组件)
- 添加/编辑提供商 = ProviderDialog 弹窗;拉取模型 = 弹窗内联勾选导入区;models.dev 同步(`syncModelsWithModelsDev`)是独立「同步」按钮
- 页面上下文默认开启,引用 chip 在 Composer 上方管理;模型/思考等级切换在 Composer 内
- Composer 工具栏 `[+ ▾]` = 框选元素/引用页面统一入口;tab chip 带元素 DropdownMenu;新会话自动引用当前页;空会话离开即回收;草稿(输入/引用/框选)随会话持久化(IndexedDB 防抖),发送即清空
- 工具调用 = 独立 ToolCallCard(四态 + 参数/结果展开);思考折叠区默认折叠 + 最新3行预览 + 思考中动画;in-flight 消息列表保证多轮工具循环不闪没;ResizeObserver 自动跟底

## 目录结构

```
entrypoints/
  sidepanel/          # 侧边栏 UI(index.html / main.tsx / theme.ts / style.css)
    App.tsx             # 组合层:四域 hook 组装 + 视图骨架(1077→340 行,无业务逻辑)
    hooks/              # useGate(门控)/ useSessionManager(会话+草稿持久化核心)/ useChatTurn(对话轮次+turnSeq 守卫)/ usePageContextRefs(引用+框选)
    components/chat/      # ChatHeader / MessageList / MessageItem(ToolCallCard/思考折叠)/ MarkdownView / ChatInput / ApprovalSection(审批槽位)
    components/settings/  # SettingsMainView / ProviderDialog / ModelConfigDialog
  background.ts       # 点击工具栏图标打开侧边栏
  content.ts          # 结构化提取 + 框选元素(@medv/finder 生成唯一 selector)+ 元素解析
lib/
  types.ts            # ApiType/ModelConfig(reasoningLevels)/Settings(reasoningLevel)/ChatMessage(pi 联合)/PageRefs/SessionDraft/PickedElement/TOOL_LABELS(中文单一来源)
  storage.ts          # settingsItem/activeSessionIdItem + sanitizeSettings/sanitizeSessions 迁移 + createUserMessage(带 refs)/messageText/EMPTY_USAGE
  sessionStore.ts     # 会话历史唯一读写层(IndexedDB,idb 封装):listSessions/saveSession/deleteSession/migrateLegacySessions
  providers.ts        # API_TYPE_OPTIONS(三协议+默认 baseUrl)、normalizeBaseUrl(anthropic 剥尾 /v1)、getModelReasoningLevels/resolveReasoningLevel
  agent.ts            # pi-agent-core 桥接(224 行):runAgentTurn(唯一发送入口)/toPiModel/buildSystemPrompt;工具组装移至 tools/registry.ts
  models.ts           # fetchProviderModels/fetchModelsDevMeta/applyModelMeta/syncModelsWithModelsDev/testConnection
  pageRefs.ts         # renderPageRefsBlock/parsePageRefs/stripPageRefs/collectPageRefs(纯函数,<page-refs> 块)
  pageContext.ts      # tab 级读取原语(getActiveTabMeta/getTabMeta/listCandidateTabs/extractFromTab/renderPageContext)+ startPickElement/resolveElement(框选/元素解析)
  pageScripting.ts    # execute_js 注入原语:isUserScriptsAvailable/executePageScript(userScripts.execute 主路线 + scripting MAIN world 兜底,8000 截断)
  imageFetch.ts       # fetchImageForModel/captureCropForModel(≤2000²、JPEG q80 逐级降质、base64 ≤4.5MB)
  gate.ts             # 工具门控契约:GateRequest(confirm/ask)/setGateHandler/flushPendingGates/requestGate/createGatedTool
  tools/              # 工具注册表(pi 一工具一文件 + 集合函数模式):registry.ts = 唯一组装点 getTools(GetToolsOptions{refTabs,pickedElements,canUseImage},组装序 utility→read_page→read_element→execute_js);read-page/read-element/execute-js/read-time/ask-user 各导出 createXxxToolDefinition;time.ts = 本地时间助手(localDate/localTime/utcOffsetLabel/weekdayName)
  utils.ts            # cn()
components/ui/        # shadcn 组件(保持官方原样)
```

## 待办(按序)

1. **用户手动回归**(`pnpm dev` 自动拉起 Chrome):重点 = 普通对话、read_page/read_element 工具触发、框选元素 + vision 读图、思考折叠区、token 脚注、流式中途停止、旧会话数据迁移
2. websearch / fetch_url 工具(读链接目标内容)
3. 多语言:TOOL_LABELS 等文案收敛到 i18n(WXT 内建)
4. 三期页面操作:screenshot → scripting 写动作 → 反馈闭环 → debugger 最后手段(参考 Nanobrowser 的 chrome.debugger/CDP 动作层,只借鉴不依赖;browser-use/Stagehand/LaVague 服务端形态不可用;execute_js 已完成:lib/pageScripting.ts + lib/tools/execute-js.ts,registry.ts 登记)
5. 发布:图标 + `wxt zip`

> 已完成(2026-09-02):`err: any` → `unknown`(getErrorMessage helper);dev 可观测性(未知 `ai-sidebar/` 消息 console.warn);execute_js 工具(userScripts.execute 主路线 + scripting MAIN world 兜底,confirm 门控动态预览代码,Chrome 135+ / Allow User Scripts 开关引导)。用户拍板不做:highlight.js 语言包裁剪(本地加载,941KB 不构成瓶颈;rehype-highlight@7 的 `languages` 选项可随时按需裁)。

## 约定

- 每步完成跑 `pnpm compile && pnpm build`,必须全绿
- 手动验收:`pnpm dev` 会自动拉起 Chrome 并加载扩展;或 `chrome://extensions` 加载 `.output/chrome-mv3`;改 content.ts/消息协议/权限后必须完整重启 dev + 刷新页面(sidepanel 热更新 ≠ content script 更新)
- 不打印/提交任何 API Key;密钥只存 `chrome.storage.local`
- 改动保持克制:不做待办外的重构和依赖引入;`components/ui/` 保持 shadcn 官方原样

## Cloned Dependency Source

Read-only dependency source repositories are available under
`.slim/clonedeps/repos/` for inspection. Do not edit these clones.

- `.slim/clonedeps/repos/earendil-works__pi/` - `earendil-works/pi` at `main`; pi 上游 monorepo(pi-ai / pi-agent-core / pi-coding-agent),对齐 BYOK 模型 compat(如 `supportsDeveloperRole`)、agent 循环与 compaction 的上游做法时查这里。
