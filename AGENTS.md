# ai-sidebar — 项目代号

> **交接注(2026-09,文档已同步)**:UI 已全部实现,agent 运行时 = pi-agent-core 会话 Agent(每会话一实例自持转录,决策 36);会话存储 = **JSONL 记录**(库 `ai-sidebar-sessions` 单 store,决策 38 零旧版兼容);引用架构 = `<page-refs>` 元数据块(tabs)+ 用户消息内嵌 `<picked-element …/>` 自闭合块(元素引用单一表示)+ 工具面(read/read_element/search_element/search_page/click/fill/scroll/screenshot/open/activate/close/fetch_url/search_web/execute_js/compact_context/read_time/ask_user)。**设置页 = 全高 Drawer**(七视图:提供商/模型/提示词/搜索/外观/备份/关于,权限 tab 已删);userScripts 强引导;模型分工卡(per-role 思考档)+ 全局语言偏好 + 动态快捷指令 + 会话导出 Markdown;动作可靠性三件套(click tab 变化报告/open_page 同 URL 复用/settle 隐藏短路 + 8s 看门狗);聊天视觉改版(决策 40:AI 平铺无气泡/头像顶部/用户气泡 secondary/代码块 shiki 双主题/composer 四层堆叠);页面动作测试台 `fixtures/page-actions`。当前唯一权威现状、最新决策与 API 契约见 **`HANDOFF.md`**,以它为准;本文件与它已同步。

开源 **BYOK 浏览器 AI 侧边栏扩展**(Chromium 系:Chrome/Edge/Brave),对标 Chrome 内置 Gemini 侧边栏,但用你自己的 API Key、UI 现代化。

**产品北极星:浏览器 Agentic 侧边栏**——从聊天助手演进为能在浏览器里自治完成多步任务的 agent(六大支柱:感知/动作/自治/获取/记忆/底座,详见 HANDOFF.md)。

> 命名约定:`ai-sidebar` 是**永久内部代号**(目录名/包名),不要改目录名——pi 的会话历史按工作目录存储,改目录会"丢"对话。以后要改的只是产品名(`package.json` name、manifest name、商店上架名),这些随时可改、零影响。

## 产品范围(已确认)

- **MVP(已完成,待手动回归)**
  - sidePanel 聊天:流式输出、Markdown/代码高亮、工具调用卡片、思考折叠区、token 脚注、多会话历史管理、会话草稿(输入/引用随会话走)、上下文占用环
  - 读取当前网页:引用以 `<page-refs>` 块(tabs 元数据)+ 消息内 `<picked-element …/>` 自闭合块(元素引用单一表示)内嵌 user 消息,AI 经 `read_page`(tabId 句柄读整页正文)/`read_element`(CSS selector 句柄,返回 outerHTML)按需读取;支持框选元素(TipTap 原子徽章),vision 模型可读框选图片
  - 通用工具:read_time(设备本地时间,免弹卡)/ ask_user(经 UI 门控向用户提问,未注册 UI 处理器时快速 cancelled)/ execute_js(confirm 型,在引用页执行 JS:主路线 `chrome.userScripts.execute`,降级 scripting MAIN world)/ fetch_url(抓取任意公开 URL 正文,私有内网拒绝)/ compact_context(模型申请压缩)/ search_element(交互元素清单,ARIA role+可访问名称+序号消歧,默认 focused tab)
  - 网络搜索:设置页"搜索"页签配置十源(duckduckgo/searxng/brave/tavily/bocha/serper/exa/zhipu/metaso/bing),`search_web` 条件注册(未配置不占工具面)
  - BYOK 多提供商:三种协议 —— **OpenAI 兼容 · Chat Completions / OpenAI 兼容 · Responses / Anthropic Messages**(OpenAI / DeepSeek / OpenRouter / Kimi / GLM / Ollama / 自定义 baseUrl+key+model)
- **二期**:划词快捷提问(未做);会话重命名(AI 命名 + 行内改名)、多模型快捷切换(输入框全提供商分组菜单)、会话导出 Markdown(历史行 hover)已完成
- **三期(规格 v2,详见 HANDOFF.md §8.4)**:ARIA 定位与页面动作原语——search/click/fill/scroll/screenshot 五工具 + 会话级 grant + Before/After 反馈;步①②③已实施(search_element 发现层 + click/fill/scroll/screenshot_page 页面动作原语 + 会话级 grant + 权限架构定案),步④返回模板 v2 待做

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
| 加 shadcn 组件 | `pnpm dlx shadcn@latest add <name> -y -o`(components.json 已配好,已装 alert-dialog/badge/button/checkbox/dialog/drawer/dropdown-menu/input/label/popover/scroll-area/select/separator/switch/textarea/tooltip/toast) |
| 设置页形态 | 全高 Drawer(vaul ^1.1.2)覆盖常驻聊天;四路关闭;内部七视图(提供商/模型/提示词/搜索/外观/备份/关于;权限 tab 已删,决策 40;外观 = 主题三选一 system/light/dark);删除确认统一 AlertDialog |
| 动作可靠性 | click 结果带 tab 变化报告;open_page 同 URL 复用;performPageAction 8s 看门狗(超时降级成功,绝不重发);content settle 失焦短路(隐藏 tab rAF 完全暂停) |
| UI 底座 | shadcn Base UI 变体(@base-ui/react 1.8;radix-ui 已卸载;多态用 render prop 非 asChild;新装组件须走 base registry) |
| AI 请求 | **`@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`**(同版本 ^0.84.4),严禁手写 SSE/协议适配;**会话运行时 = pi Agent**(决策 36:每会话一实例自持转录,`ensureSessionAgent` + 常驻事件订阅→投影层→store);发送入口 `runAgentTurn()`/`continueAgentTurn()`(`lib/agent.ts`);唯一例外是"拉模型列表"两个 GET(在 `lib/models.ts`) |
| 存储 | 设置/API Key → chrome.storage.local(`local:settings`,manifest 已加 `unlimitedStorage`);会话历史+草稿 → **IndexedDB JSONL 记录**(库 `ai-sidebar-sessions` v1 单 store;`lib/sessionStore.ts` + `lib/sessionRecord.ts`,决策 38 零旧版兼容);activeSessionId → chrome.storage.local;UI 共享状态 → **zustand v5 单 store 五切片**(`entrypoints/sidepanel/store/`:gate/error/session/settings/chat),**显式 IndexedDB 持久化,不用 persist 中间件**(persist 会退化草稿防抖写序与非破坏压缩精细写序);消息按 pi 消息联合形状持久化,`sanitizeSessions` 仅防御清洗 |
| 页面提取 | 引用元数据以 `<page-refs>{JSON}</page-refs>` 块(tabs)与 `<picked-element …/>` 自闭合块(元素引用单一表示,`elementId/tabId/selector/tagName/label` 属性,内容预览)内嵌 user 消息 content,草稿/存储/LLM 三处同串(唯一差异 = LLM 请求副本把 refs 块剥 elements 留 tabs,`lib/agent.ts toLlmMessage`);内容按需经 `read_page`(tabId 句柄读整页正文)/`read_element`(CSS selector 句柄,返回 outerHTML 12000 字符截断;tab 级白名单=草稿∪历史块)读取;消息协议 `ai-sidebar/read-page`、`ai-sidebar/pick-element(-result)` 由 content.ts 应答(常量单一来源 `lib/types.ts`,content.ts 只 import 纯常量);图像经 `lib/imageFetch.ts`(fetch 主取 + captureVisibleTab 裁剪兜底 + canvas 降采样) |
| Markdown | react-markdown + remark-gfm + **shiki**(VS Code 引擎,github-light/github-dark 双主题 CSS 变量跟随 .dark,`lib/shiki.ts` 懒初始化+降级纯文本);代码块官方 Badge 风复制按钮 |
| 权限 | manifest:`storage` / `sidePanel` / `unlimitedStorage` / `scripting` / `activeTab` / `userScripts` / `debugger`(+ host_permissions **`<all_urls>`**——captureVisibleTab 硬要求;决策 25);`minimum_chrome_version: "135"`(userScripts.execute 门槛);Chrome 138+ 需用户在扩展详情页开启 Allow User Scripts(强引导弹窗;设置页权限 tab 已删,决策 40) |
| 路径别名 | `@/*` → 项目根 |
| 工具命名 | `<动词>_<域词>`:动词集 {read, search, fetch, click, fill, scroll, screenshot, execute, ask, open} × 域词集 {page, element, url, web, js, user, time},新工具只许集合内组合(`extract_page` 已改名 `read_page`;`TOOL_LABELS` 保留旧 key 兼容历史会话;协议字符串已随名同步,常量单一来源 lib/types.ts) |
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
    hooks/              # 编排层(状态在 store):useGate(切片消费)/ useSessionManager(增删切+AI 命名+原子 init)/ useChatTurn(发送/停止+turnSeq 守卫)/ usePageContextRefs(引用组随焦点切换+框选)/ useQuickPrompts(动态快捷指令:导航跟随+缓存+回退)/ useCompact(压缩)
    components/chat/      # ChatHeader / MessageList / MessageItem(分段渲染+ToolCallCard/思考折叠)/ MarkdownView / ChatInput(TipTap)/ ApprovalSection(审批槽位)/ CompactionRow(压缩摘要卡)/ SlashMenu(斜杠命令)/ ContextRing+ContextPanel(上下文占用)/ elementMarkerText(chip 渲染)/ extensions/(InlineBadge+BadgeNodeView+editorSerialize)
    components/settings/  # SettingsMainView(提供商/模型/提示词/搜索/外观/备份/关于七视图,Drawer 承载;模型分工卡 + 偏好卡)/ ProviderDialog / ModelConfigDialog / SearchSettingsView / SettingsAppearanceView(主题三选一)/ SettingsBackupView
  UserScriptsGateDialog.tsx  # userScripts 强引导 AlertDialog(启动检测/自动闭环/跳过仅本会话)
  background.ts       # 点击工具栏图标打开侧边栏
  content.ts          # 结构化提取(Readability+语义 markdown)+ 框选元素(@medv/finder 生成唯一 selector)+ 元素解析 + 交互元素发现(search_element,content 侧 dom-accessibility-api)+ 页面动作执行器(click/fill/scroll:locator 解析/400ms 高亮/遮挡 fallback 直发/受控填充/settle/navigation_started)
lib/
  types.ts            # ApiType/ModelConfig(reasoningLevels)/Settings(reasoningLevel+webSearch)/ChatMessage(pi 联合)/PageRefs/SessionDraft/PickedElement(elementId)/WebSearchConfig/TOOL_LABELS(中文单一来源)/消息协议常量
  storage.ts          # settingsItem/activeSessionIdItem + sanitizeSettings(含 webSearch)/sanitizeSessions 迁移 + createUserMessage(带 refs)/messageText/EMPTY_USAGE
  sessionStore.ts     # 会话历史唯一读写层(IndexedDB 库 ai-sidebar-sessions 单 store,JSONL 行):listSessions(逐行容错)/saveSession/deleteSession/replaceAllSessions;零迁移链(决策 38)
  sessionRecord.ts    # JSONL 会话记录格式层(对齐 pi session-format v3 线性链):sessionToJsonl/jsonlToSession(幂等,摘要↔compaction entry)、SESSION_RECORD_VERSION;格式文档 docs/session-jsonl-format.md
  sessionRuntime.ts   # React UI 投影层(决策 36 ④):Agent 事件→可渲染快照(bridgeAgentEvent 经 sink 同步 store.runs,流式 50ms 节流)+ 发送锁 + turn 所有权守卫;非 Agent 替代品
  providers.ts        # DEFAULT_SETTINGS/API_TYPE_OPTIONS(三协议+默认 baseUrl)、normalizeBaseUrl(anthropic 剥尾 /v1)、getModelReasoningLevels/resolveReasoningLevel
  agent.ts            # pi-agent-core 桥接:会话 Agent 工厂(ensureSessionAgent 每会话一实例自持转录+convertToLlm/transformContext/prepareNextTurn)+ runAgentTurn/continueAgentTurn 发送内核 + setAgentEventSink 常驻订阅 + dispose 系;toLlmMessage(refs 剥 elements)/toPiModel/buildSystemPrompt
  shiki.ts            # 代码高亮单例(决策 40 ⑤):模块级懒初始化 29 语言+github-light/dark,highlightToHtml 同步双主题 CSS 变量输出(未就绪降级 null),onShikiReady 订阅重渲染,normalizeShikiLang 别名归一
  models.ts           # fetchProviderModels/fetchModelsDevMeta/applyModelMeta/syncModelsWithModelsDev/testConnection
  pageRefs.ts         # renderPageRefsBlock/parsePageRefs/stripPageRefs/collectPageRefs(纯函数,<page-refs> 块)
  elementLabel.ts     # elementChipLabel/elementListLabel(元素预览 chip label,CJK 视觉宽度加权)
  pageContext.ts      # tab 级读取原语(getActiveTabMeta/getTabMeta/listCandidateTabs/findTabByUrl/extractFromTab/renderPageContext)+ startPickElement/resolveElement(框选/元素解析)+ searchElementsInTab(交互元素清单,search_element 底层)+ performPageAction(页面动作原语 resolve/click/fill/scroll;8s 看门狗+导航守卫)+ snapshotTabs/describeTabChanges(click tab 变化报告)+ buildUnreadableTabError(可行动错误)+ agent 开启注册表(openTab/registerAgentOpenedTab,决策 27)
  fetchPage.ts        # fetch_url 抓取管线:直连 GET + Readability 提取(私有内网拒绝+重定向复检;2MB/12000 上限;错误前缀族)
  webSearch.ts        # websearch 十源适配器(统一 {title,url,snippet})+ isWebSearchConfigured(注册/运行守卫单一来源)
  compaction.ts       # compact_context 压缩管线(runCompact/findCutIndex)
  pageScripting.ts    # execute_js 注入原语:isUserScriptsAvailable/executePageScript(userScripts.execute 主路线 + scripting MAIN world 兜底,8000 截断)
  imageFetch.ts       # fetchImageForModel/captureCropForModel(≤2000²、JPEG q80 逐级降质、base64 ≤4.5MB)
  gate.ts             # 工具门控契约:GateRequest(confirm/ask)/setGateHandler/flushPendingGates/requestGate/createGatedTool + 会话级 grant(grantedScopes 短路,工具+tab 粒度,面板生命周期;execute_js 永不可 grant)
  tools/              # 工具注册表(pi 一工具一文件 + 集合函数模式):registry.ts = 唯一组装点 getTools(GetToolsOptions{refTabs,pickedElements,canUseImage,onCompactContext,webSearch,dynamicTabs},组装序 utility→web→read→discovery→action→fetch→gated);read-page/read-element/search-element/search-page/click-element/fill-element/scroll-page/screenshot-page/open-page/activate-page/close-page/page-action-shared/fetch-url/web-search/compact-context/execute-js/read-time/ask-user 各导出 createXxxToolDefinition;time.ts = 本地时间助手
  quickPrompts.ts     # 新会话动态快捷指令:FALLBACK_PROMPTS/isPromptWorthyUrl/generateQuickPrompts(辅助模型,失败 throw 由 hook 回退)
  sessionExport.ts    # 会话导出 Markdown:buildSessionMarkdown/downloadSessionMarkdown(思考/工具折叠,consumed 去重)
  language.ts         # AI 语言偏好:AI_LANGUAGES(12 白名单)/resolveAiLanguage(null→浏览器语言)
  permissions.ts      # 权限声明与展示(INSTALL_PERMISSIONS/WEB_ACCESS_PERMISSION)+ openExtensionDetails(设置页签与引导弹窗共用)
  utils.ts            # cn()/getErrorMessage
components/ui/        # shadcn 组件(保持官方原样)
```

## 待办(按序)

> **当前阶段**:三期步①-⑤全部落地(含④返回模板 v2、⑤CDP 滚动兜底)+ 四期步①规则/提示词 + 决策 36-40(会话运行时对齐 pi Agent、JSONL 存储零兼容、压缩预算自适应、聊天视觉改版、shiki 双主题代码块)+ 多会话并发隔离,自动化全绿;接下来 = 浏览器回归(`docs/regression-jsonl.md` 新数据版,C 组用 `fixtures/page-actions`)→ i18n → 发布。

1. **用户手动回归** —— 本轮(决策 36-40)清单 `docs/regression-jsonl.md`:A 组迁移项已随决策 38 作废(新库无旧数据),重点 B 组并发/队列、E 组压缩(8k 窗口预算自适应)、C 组动作(测试台 `fixtures/page-actions`,`npx http-server fixtures/page-actions -p 8788`)、F 组通用、D 组 WebDAV;历史批次(普通对话/read/search/fetch/click 全链/导出/设置抽屉/模型分工/语言/思考档/引导弹窗/删除确认)已随批回归
2. ~~多语言:TOOL_LABELS 等文案收敛到 i18n(WXT 内建)~~ ✅ 已完成(2026-09,决策 45:新增 91 键 ×2 语言、剩余仅 DEV 日志/原生语言名/兜底表)
3. 三期规格 v2(全文见 HANDOFF.md §8.4):**ARIA 定位与页面动作原语**——引库唯一新依赖 `dom-accessibility-api`;五新工具 `search_element`(safe,AX 交互元素清单紧凑行式)/ `click_element` / `fill_element`(confirm+会话 grant)/ `scroll_page`(safe)/ `screenshot_page`(confirm);时序等待内置有界 settle 不设独立工具;反馈 Before/After + 结构化错误前缀;寻址双轨(用户框选 = picked-element 块 CSS selector 不变,模型动作 = ARIA role+name locator,默认 focused tab;search_element 已按默认 focused tab、无白名单实施——用户拍板);会话级 grant 扩展进 gate.ts(execute_js 永不可 grant);实施序列 ①search(✅ 已完成 2026-09)→ ②click/fill+scroll+grant+高亮(✅ 已完成 2026-09)→ ③screenshot(✅ 已完成 2026-09)→ ④返回模板 v2(✅ 已完成 2026-09:页面指纹 + click/fill after 注记,lib/sessionExport 无关)→ ⑤chrome.debugger(✅ 已启用 2026-09:scroll_page JS 链无位移时 CDP 可信滚轮兜底,lib/cdp.ts 白名单单方法 + 60s 闲置 detach,见 HANDOFF 决策 35);验收标尺 = search→click 链完成登录页填字点按钮零手写 JS(✅ 真实登录页已通过;execute_js 已完成:lib/pageScripting.ts + lib/tools/execute-js.ts,registry.ts 登记)
4. 发布:图标 + `wxt zip`

> 已完成(2026-09-02):`err: any` → `unknown`(getErrorMessage helper);dev 可观测性(未知 `ai-sidebar/` 消息 console.warn);execute_js 工具(userScripts.execute 主路线 + scripting MAIN world 兜底,confirm 门控动态预览代码,Chrome 135+ / Allow User Scripts 开关引导)。用户拍板不做:highlight.js 语言包裁剪(当时本地加载 941KB 不构成瓶颈;rehype-highlight@7 的 `languages` 选项可随时按需裁)。**该条已被取代**:决策 40 改换 shiki 双主题后,`highlight.js` 与 `rehype-highlight` 已整体移除(`517648c`),无需再考虑裁剪。
>
> 已完成批次(2026-09,交接前):fetch_url(私有内网拒绝+重定向复检);**元素引用统一 `<picked-element …/>` 块协议**(标记层废除,旧数据可弃);token 瘦身(system prompt/工具描述压缩,单轮 ~17000→~500);finalize 闪烁修复(sessionKey 重估);流式跟底重做(overflow-anchor 钉底);**websearch 十源**(设置"搜索"页签,search_web 条件注册);注释叙事清扫。详见 HANDOFF.md。

## 约定

- 每步完成跑 `pnpm compile && pnpm build`,必须全绿
- 手动验收:`pnpm dev` 会自动拉起 Chrome 并加载扩展;或 `chrome://extensions` 加载 `.output/chrome-mv3`;改 content.ts/消息协议/权限后必须完整重启 dev + 刷新页面(sidepanel 热更新 ≠ content script 更新)
- 不打印/提交任何 API Key;密钥只存 `chrome.storage.local`
- 改动保持克制:不做待办外的重构和依赖引入;`components/ui/` 保持 shadcn 官方原样

## Cloned Dependency Source

Read-only dependency source repos are **not vendored in the working tree** — the clones that used to sit under
`.slim/clonedeps/repos/` were cleaned up (2026-09) to reclaim ~282MB. Pull them on demand with
oh-my-opencode-slim before aligning against upstream; the two that mattered were:

- `earendil-works/pi` — pi upstream monorepo (pi-ai / pi-agent-core / pi-coding-agent):对齐 BYOK 模型 compat(如 `supportsDeveloperRole`)、agent 循环与 compaction 的上游做法。
  **注意**:运行时依赖已装在 `node_modules/@earendil-works/pi-agent-core/dist/`(读 dist 即可核事件与循环语义),克隆只用于看源码。
- `AhYi8/browser-ai-assistant` — CDP 驱动的浏览器自动化助手;三期页面动作工具的参考仓(AX 行格式/受控 fill 法/遮挡检测/有界轮询——搬模式,特权层仅滚动可信滚轮白名单:lib/cdp.ts,三期规格见 HANDOFF.md §8.4)。
