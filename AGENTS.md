# ai-sidebar — 项目代号

> **交接注(2026-09)**:UI 已全部实现,agent 运行时为 pi-agent-core;引用架构 = `<page-refs>` 元数据块(tabs)+ 用户消息内嵌 `<picked-element …/>` 自闭合块(元素引用单一表示)+ `read_page`/`read_element`/`fetch_url`/`search_web` 工具。当前唯一权威现状、最新决策与 API 契约见 **`HANDOFF.md`**,以它为准;本文件与它已同步。

开源 **BYOK 浏览器 AI 侧边栏扩展**(Chromium 系:Chrome/Edge/Brave),对标 Chrome 内置 Gemini 侧边栏,但用你自己的 API Key、UI 现代化。

**产品北极星:浏览器 Agentic 侧边栏**——从聊天助手演进为能在浏览器里自治完成多步任务的 agent(六大支柱:感知/动作/自治/获取/记忆/底座,详见 HANDOFF.md)。

> 命名约定:`ai-sidebar` 是**永久内部代号**(目录名/包名),不要改目录名——pi 的会话历史按工作目录存储,改目录会"丢"对话。以后要改的只是产品名(`package.json` name、manifest name、商店上架名),这些随时可改、零影响。

## 产品范围(已确认)

- **MVP(已完成,待手动回归)**
  - sidePanel 聊天:流式输出、Markdown/代码高亮、工具调用卡片、思考折叠区、token 脚注、多会话历史管理、会话草稿(输入/引用随会话走)、上下文占用环
  - 读取当前网页:引用以 `<page-refs>` 块(tabs 元数据)+ 消息内 `<picked-element …/>` 自闭合块(元素引用单一表示)内嵌 user 消息,AI 经 `read_page`(tabId 句柄读整页正文)/`read_element`(CSS selector 句柄,返回 outerHTML)按需读取;支持框选元素(TipTap 原子徽章),vision 模型可读框选图片
  - 通用工具:read_time(设备本地时间,免弹卡)/ ask_user(经 UI 门控向用户提问,未注册 UI 处理器时快速 cancelled)/ execute_js(confirm 型,在引用页执行 JS:主路线 `chrome.userScripts.execute`,降级 scripting MAIN world)/ fetch_url(抓取任意公开 URL 正文,私有内网拒绝)/ compact_context(模型申请压缩)
  - 网络搜索:设置页"搜索"页签配置十源(duckduckgo/searxng/brave/tavily/bocha/serper/exa/zhipu/metaso/bing),`search_web` 条件注册(未配置不占工具面)
  - BYOK 多提供商:三种协议 —— **OpenAI 兼容 · Chat Completions / OpenAI 兼容 · Responses / Anthropic Messages**(OpenAI / DeepSeek / OpenRouter / Kimi / GLM / Ollama / 自定义 baseUrl+key+model)
- **二期**:划词快捷提问(选中文字弹快捷操作)、多模型快捷切换、会话重命名/导出
- **三期(规格 v2,详见 HANDOFF.md §8.4)**:ARIA 定位与页面动作原语——search/click/fill/scroll/screenshot 五工具 + 会话级 grant + Before/After 反馈;未实施

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
| 加 shadcn 组件 | `pnpm dlx shadcn@latest add <name> -y -o`(components.json 已配好,已装 badge/button/checkbox/dialog/dropdown-menu/input/label/popover/scroll-area/select/separator/switch/textarea/tooltip) |
| AI 请求 | **`@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`**(同版本 ^0.84.4),严禁手写 SSE/协议适配;`lib/agent.ts` 的 `runAgentTurn()` 是唯一发送入口(工具调用循环/abort/事件透出);唯一例外是"拉模型列表"两个 GET(在 `lib/models.ts`) |
| 存储 | 设置/API Key → chrome.storage.local(`local:settings`,manifest 已加 `unlimitedStorage`);会话历史+草稿 → **IndexedDB**(`lib/sessionStore.ts`,用 `idb`,旧 `local:sessions` 启动时一次性迁移);activeSessionId → chrome.storage.local;UI 共享状态 → **zustand v5 单 store 五切片**(`entrypoints/sidepanel/store/`:gate/error/session/settings/chat),**显式 IndexedDB 持久化,不用 persist 中间件**(persist 会退化草稿防抖写序与非破坏压缩精细写序);消息按 pi 消息联合形状持久化,旧扁平结构由 `sanitizeSessions/sanitizeMessage` 迁移 |
| 页面提取 | 引用元数据以 `<page-refs>{JSON}</page-refs>` 块(tabs)与 `<picked-element …/>` 自闭合块(元素引用单一表示,`elementId/tabId/selector/tagName/label` 属性,内容预览)内嵌 user 消息 content,草稿/存储/LLM 三处同串(唯一差异 = LLM 请求副本把 refs 块剥 elements 留 tabs,`lib/agent.ts toLlmMessage`);内容按需经 `read_page`(tabId 句柄读整页正文)/`read_element`(CSS selector 句柄,返回 outerHTML 12000 字符截断;tab 级白名单=草稿∪历史块)读取;消息协议 `ai-sidebar/read-page`、`ai-sidebar/pick-element(-result)` 由 content.ts 应答(常量单一来源 `lib/types.ts`,content.ts 只 import 纯常量);图像经 `lib/imageFetch.ts`(fetch 主取 + captureVisibleTab 裁剪兜底 + canvas 降采样) |
| Markdown | react-markdown + remark-gfm + rehype-highlight(已装) |
| 权限 | manifest:`storage` / `sidePanel` / `unlimitedStorage` / `scripting` / `activeTab` / `userScripts`(+ host_permissions http/https);`minimum_chrome_version: "135"`(userScripts.execute 门槛);Chrome 138+ 需用户在扩展详情页开启 Allow User Scripts |
| 路径别名 | `@/*` → 项目根 |
| 工具命名 | `<动词>_<域词>`:动词集 {read, search, fetch, click, fill, scroll, screenshot, execute, ask} × 域词集 {page, element, url, web, js, user, time},新工具只许集合内组合(`extract_page` 已改名 `read_page`;`TOOL_LABELS` 保留旧 key 兼容历史会话;协议字符串已随名同步,常量单一来源 lib/types.ts) |
| 模型可见文本 | **一律英文**(Model-facing text):工具 description/参数 description、返回模板与截断标注、错误分支、非 vision 图片描述、system prompt 全文;UI 显示文案(TOOL_LABELS 中文值等)保持中文,以后收敛 i18n |

## 关键 UI 决策(已实现)

- 历史会话 = Header 内 DropdownMenu(非 Dialog);设置页 = Header 内切换 提供商/搜索/关于 三个视图(无 Tabs 组件;搜索视图含十源 Select + 条件字段)
- 添加/编辑提供商 = ProviderDialog 弹窗;拉取模型 = 弹窗内联勾选导入区;models.dev 同步(`syncModelsWithModelsDev`)是独立「同步」按钮
- Composer = **TipTap 3**:框选元素为原子徽章节点(`<picked-element>` 块单一表示,删除=整块删/粘贴=纯文本/单一 URL 转 url 徽章);斜杠命令(/compact /clear /help)
- 页面上下文默认开启,引用 chip 在 Composer 上方管理;模型/思考等级切换在 Composer 内
- 工具调用 = 独立 ToolCallCard(四态 + 参数/结果展开);思考折叠区默认折叠 + 最新3行预览 + 思考中动画;in-flight 消息列表保证多轮工具循环不闪没;自动跟底 = **overflow-anchor 哨兵钉底 + RO 瞬时兜底**(流式零跳动)
- 压缩摘要 = 消息流内分隔线卡(CompactionRow);工具确认 = 独立审批槽位(ApprovalSection,消息流内工具卡零交互控件)

## 目录结构

```
entrypoints/
  sidepanel/          # 侧边栏 UI(index.html / main.tsx / theme.ts / style.css)
    App.tsx             # 组合层:store selector 订阅 + 五域编排 hook 组装 + 视图骨架(481 行,无业务逻辑)
    store/              # zustand v5 单 store 五切片:gateSlice/errorSlice/sessionSlice(含草稿防抖队列模块级)/settingsSlice/chatSlice;devtools 仅 DEV 构建
    hooks/              # 编排层(状态在 store):useGate(切片消费)/ useSessionManager(增删切+AI 命名+原子 init)/ useChatTurn(发送/停止+turnSeq 守卫)/ usePageContextRefs(引用+框选)/ useCompact(压缩)
    components/chat/      # ChatHeader / MessageList / MessageItem(分段渲染+ToolCallCard/思考折叠)/ MarkdownView / ChatInput(TipTap)/ ApprovalSection(审批槽位)/ CompactionRow(压缩摘要卡)/ SlashMenu(斜杠命令)/ ContextRing+ContextPanel(上下文占用)/ elementMarkerText(chip 渲染)/ extensions/(InlineBadge+BadgeNodeView+editorSerialize)
    components/settings/  # SettingsMainView(提供商/搜索/关于)/ ProviderDialog / ModelConfigDialog / SearchSettingsView(十源搜索配置)
  background.ts       # 点击工具栏图标打开侧边栏
  content.ts          # 结构化提取(Readability+语义 markdown)+ 框选元素(@medv/finder 生成唯一 selector)+ 元素解析
lib/
  types.ts            # ApiType/ModelConfig(reasoningLevels)/Settings(reasoningLevel+webSearch)/ChatMessage(pi 联合)/PageRefs/SessionDraft/PickedElement(elementId)/WebSearchConfig/TOOL_LABELS(中文单一来源)/消息协议常量
  storage.ts          # settingsItem/activeSessionIdItem + sanitizeSettings(含 webSearch)/sanitizeSessions 迁移 + createUserMessage(带 refs)/messageText/EMPTY_USAGE
  sessionStore.ts     # 会话历史唯一读写层(IndexedDB,idb 封装):listSessions/saveSession/deleteSession/migrateLegacySessions
  providers.ts        # DEFAULT_SETTINGS/API_TYPE_OPTIONS(三协议+默认 baseUrl)、normalizeBaseUrl(anthropic 剥尾 /v1)、getModelReasoningLevels/resolveReasoningLevel
  agent.ts            # pi-agent-core 桥接:runAgentTurn(唯一发送入口)/toLlmMessage(refs 剥 elements)/toPiModel/buildSystemPrompt(压缩版)
  models.ts           # fetchProviderModels/fetchModelsDevMeta/applyModelMeta/syncModelsWithModelsDev/testConnection
  pageRefs.ts         # renderPageRefsBlock/parsePageRefs/stripPageRefs/collectPageRefs(纯函数,<page-refs> 块)
  elementLabel.ts     # elementChipLabel/elementListLabel(元素预览 chip label,CJK 视觉宽度加权)
  pageContext.ts      # tab 级读取原语(getActiveTabMeta/getTabMeta/listCandidateTabs/extractFromTab/renderPageContext)+ startPickElement/resolveElement(框选/元素解析)
  fetchPage.ts        # fetch_url 抓取管线:直连 GET + Readability 提取(私有内网拒绝+重定向复检;2MB/12000 上限;错误前缀族)
  webSearch.ts        # websearch 十源适配器(统一 {title,url,snippet})+ isWebSearchConfigured(注册/运行守卫单一来源)
  compaction.ts       # compact_context 压缩管线(runCompact/findCutIndex)
  pageScripting.ts    # execute_js 注入原语:isUserScriptsAvailable/executePageScript(userScripts.execute 主路线 + scripting MAIN world 兜底,8000 截断)
  imageFetch.ts       # fetchImageForModel/captureCropForModel(≤2000²、JPEG q80 逐级降质、base64 ≤4.5MB)
  gate.ts             # 工具门控契约:GateRequest(confirm/ask)/setGateHandler/flushPendingGates/requestGate/createGatedTool
  tools/              # 工具注册表(pi 一工具一文件 + 集合函数模式):registry.ts = 唯一组装点 getTools(GetToolsOptions{refTabs,pickedElements,canUseImage,onCompactContext,webSearch},组装序 utility→web→read→fetch→gated);read-page/read-element/fetch-url/web-search/compact-context/execute-js/read-time/ask-user 各导出 createXxxToolDefinition;time.ts = 本地时间助手
  utils.ts            # cn()/getErrorMessage
components/ui/        # shadcn 组件(保持官方原样)
```

## 待办(按序)

> **当前阶段**:MVP + 获取支柱落地,手动回归中(回归绿灯前不开新功能);接下来 = websearch/fetch_url(已完成)→ 三期 v2(§8.4 步 1-2 起步)→ i18n → 发布。

1. **用户手动回归**(`pnpm dev` 自动拉起 Chrome):重点 = 普通对话、read_page/read_element/fetch_url/search_web(需在设置"搜索"页签启用)工具触发、框选元素(TipTap 徽章)+ vision 读图、压缩摘要分隔线卡、上下文占用环、思考折叠区、token 脚注、流式中途停止、自动跟底(流式无跳动)、旧会话数据迁移(旧格式元素/标记按裸文本丢弃,dev 数据可弃)
2. 多语言:TOOL_LABELS 等文案收敛到 i18n(WXT 内建)
3. 三期规格 v2(全文见 HANDOFF.md §8.4):**ARIA 定位与页面动作原语**——引库唯一新依赖 `dom-accessibility-api`;五新工具 `search_element`(safe,AX 交互元素清单紧凑行式)/ `click_element` / `fill_element`(confirm+会话 grant)/ `scroll_page`(safe)/ `screenshot_page`(confirm);时序等待内置有界 settle 不设独立工具;反馈 Before/After + 结构化错误前缀;寻址双轨(用户框选 = picked-element 块 CSS selector 不变,模型动作 = ARIA role+name locator,默认 focused tab);会话级 grant 扩展进 gate.ts(execute_js 永不可 grant);实施序列 ①search → ②click/fill+scroll+grant+高亮 → ③screenshot → ④返回模板 v2 → ⑤chrome.debugger(条件触发,不排期);验收标尺 = search→click 链完成登录页填字点按钮零手写 JS(execute_js 已完成:lib/pageScripting.ts + lib/tools/execute-js.ts,registry.ts 登记)
4. 发布:图标 + `wxt zip`

> 已完成(2026-09-02):`err: any` → `unknown`(getErrorMessage helper);dev 可观测性(未知 `ai-sidebar/` 消息 console.warn);execute_js 工具(userScripts.execute 主路线 + scripting MAIN world 兜底,confirm 门控动态预览代码,Chrome 135+ / Allow User Scripts 开关引导)。用户拍板不做:highlight.js 语言包裁剪(本地加载,941KB 不构成瓶颈;rehype-highlight@7 的 `languages` 选项可随时按需裁)。
>
> 已完成批次(2026-09,交接前):fetch_url(私有内网拒绝+重定向复检);**元素引用统一 `<picked-element …/>` 块协议**(标记层废除,旧数据可弃);token 瘦身(system prompt/工具描述压缩,单轮 ~17000→~500);finalize 闪烁修复(sessionKey 重估);流式跟底重做(overflow-anchor 钉底);**websearch 十源**(设置"搜索"页签,search_web 条件注册);注释叙事清扫。详见 HANDOFF.md。

## 约定

- 每步完成跑 `pnpm compile && pnpm build`,必须全绿
- 手动验收:`pnpm dev` 会自动拉起 Chrome 并加载扩展;或 `chrome://extensions` 加载 `.output/chrome-mv3`;改 content.ts/消息协议/权限后必须完整重启 dev + 刷新页面(sidepanel 热更新 ≠ content script 更新)
- 不打印/提交任何 API Key;密钥只存 `chrome.storage.local`
- 改动保持克制:不做待办外的重构和依赖引入;`components/ui/` 保持 shadcn 官方原样

## Cloned Dependency Source

Read-only dependency source repositories are available under
`.slim/clonedeps/repos/` for inspection. Do not edit these clones.

- `.slim/clonedeps/repos/earendil-works__pi/` - `earendil-works/pi` at `main`; pi 上游 monorepo(pi-ai / pi-agent-core / pi-coding-agent),对齐 BYOK 模型 compat(如 `supportsDeveloperRole`)、agent 循环与 compaction 的上游做法时查这里。
- `.slim/clonedeps/repos/AhYi8__browser-ai-assistant/` - `AhYi8/browser-ai-assistant`(CDP 驱动的浏览器自动化助手);三期页面动作工具的参考仓(AX 行格式/受控 fill 法/遮挡检测/有界轮询——搬模式不搬特权层),三期规格见 HANDOFF.md §8.4。
