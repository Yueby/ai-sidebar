# ai-sidebar 交接文档

> 写给下一个接手的 AI agent。本文档是当前唯一权威现状说明;根目录 `AGENTS.md` 已与本文同步。

## 0. 三句话速读

1. **UI 已全部实现,agent 运行时为 pi-agent-core,引用架构 = `<page-refs>` 元数据块(tabs)+ 消息文本内嵌 `<picked-element …/>` 自闭合块(元素引用单一表示)+ `read_page`/`read_element`/`fetch_url`/`search_web` 工具**;聊天组件在 `entrypoints/sidepanel/components/chat/`,设置组件在 `components/settings/`(提供商/搜索/关于三页签),务必先做用户手动回归(见 §8)。
2. **AI 通信一律走 `@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`**(同版本 ^0.84.4),严禁手写 SSE/协议适配;`lib/agent.ts` 的 `runAgentTurn()` 是唯一发送入口;唯一例外是"拉模型列表"两个 GET(已在 `lib/models.ts`)。
3. 每步验收:`pnpm compile && pnpm build` 必须全绿;改 content.ts/消息协议/权限后必须完整重启 `pnpm dev` 并刷新页面(见 §9)。

## 1. 项目定位

开源 **BYOK 浏览器 AI 侧边栏扩展**(Chromium:Chrome/Edge/Brave),对标 Chrome 内置 Gemini 侧边栏,用用户自己的 API Key。`ai-sidebar` 是永久内部代号(目录/包名不改,改的只是产品名)。

**产品北极星:浏览器 Agentic 侧边栏**——从聊天助手演进为能在浏览器里自治完成多步任务的 agent。六大支柱:感知(read_page/read_element/框选→三期 search_element/screenshot/页面版本指纹)、动作(execute_js→三期 click/fill/scroll)、自治(gate→会话级 grant)、获取(**websearch 十源 + fetch_url 已落地**)、记忆(compact_context 已落地)、底座(i18n/发布)。

- MVP(已完成,待手动回归):sidePanel 聊天(流式/Markdown/工具卡片/思考折叠区/token 脚注/多会话/会话草稿/上下文占用环)+ 读取当前网页(`<page-refs>` 块 + 消息内 `<picked-element …/>` 块 + `read_page`/`read_element` 按需读取,框选元素 + vision 读图)+ BYOK 多提供商(三种协议)
- 增补批次(已完成):websearch 十源(设置页"搜索"页签,search_web 条件注册)、fetch_url(自主取回任意公开 URL)、compact_context(模型申请压缩)
- 二期:划词快捷提问、多模型快捷切换、会话重命名/导出
- 三期(规格 v2,见 §8.4):ARIA 定位与页面动作原语——search/click/fill/scroll/screenshot 五工具 + 会话级 grant + Before/After 反馈;未实施

**当前位置:MVP + 获取支柱已全部落地并提交(见 §4/§6),质量基线 = 每批代码审查 + 构建全绿;卡点 = 用户手动回归未完成(清单见 §8.1),回归绿灯前不开新功能。**

**接下来(按序)**:①完成手动回归 → ②三期步 1-2(search_element 发现层 → click/fill/scroll 动作原语 + 会话级 grant,ARIA 定位规格见 §8.4)→ ③三期步 3-4(screenshot_page 视觉反馈 → 动作返回模板 v2)→ ④i18n → ⑤发布(图标 + wxt zip)。

**以后(backlog,已拍板方向,按需启动)**:二期(划词快捷提问/多模型快捷切换/会话重命名/导出);动作矩阵扩展(hover/select/submit/back/goto——实测需要再议,execute_js 逃生舱已覆盖);多标签管理(open_tab 等);记忆便签工具(新存储域,与页面动作主题无关);chrome.debugger 特权层(isTrusted 拒绝率构成实际阻断或 closed shadow DOM 真实需求时才启动);无 Key 搜索源新路线观察(如 Exa keyless MCP)。

## 2. 技术栈与硬约定

| 项 | 约定 |
|---|---|
| 框架 | WXT 0.21 + React 19 + TypeScript,包管理 pnpm |
| 样式 | Tailwind v4(`@tailwindcss/vite`)+ shadcn/ui(new-york),token 在 `sidepanel/style.css` |
| 深浅色 | 自动跟随系统(`sidepanel/theme.ts` 渲染前切 `.dark`) |
| 加 shadcn 组件 | `pnpm dlx shadcn@latest add <name> -y -o`;已装:badge/button/checkbox/dialog/dropdown-menu/input/label/scroll-area/select/separator/switch/textarea/tooltip;**`components/ui/` 保持官方原样,严禁自定义组件/样式/变体** |
| AI 请求 | **`@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`**(见 §6/§7),sidepanel 直连,BYOK |
| 存储 | 设置/API Key → chrome.storage.local(`local:settings`);会话历史+草稿 → **IndexedDB**(`lib/sessionStore.ts`,`idb` 封装,旧 `local:sessions` 启动时一次性迁移);activeSessionId → chrome.storage.local;UI 共享状态 → **zustand v5 单 store 五切片**(`entrypoints/sidepanel/store/`:gate/error/session/settings/chat;devtools 仅 DEV 构建),**显式 IndexedDB 持久化,不用 persist 中间件**(persist 会退化草稿防抖写序与非破坏压缩精细写序);消息按 pi 消息联合形状持久化 |
| 页面引用 | **元素引用单一表示 = 自闭合 `<picked-element elementId tabId selector tagName label />` 块**,草稿(TipTap 原子徽章节点)/存储消息/LLM 视图三处同串(属性值经 `&quot;` 转义);`<page-refs>{JSON}</page-refs>` 块仅承载 tabs 元数据(LLM 视图剥 elements 留 tabs,存储层保留供 UI chip 查表),两块皆在发送时序列化进 user content 此后不可变(`lib/pageRefs.ts`);元素内容按需经 `read_element`(块属性 tabId+selector 即句柄)获取 |
| manifest 权限 | `storage` / `sidePanel` / `unlimitedStorage` / `scripting` / `activeTab` / `userScripts`(+ host_permissions http/https);`minimum_chrome_version: "135"`(userScripts.execute 门槛;Chrome 138+ 需用户在扩展详情页开启 Allow User Scripts) |
| Markdown | react-markdown + remark-gfm + rehype-highlight + highlight.js(样式已在 style.css 引入) |
| 路径别名 | `@/*` → 项目根 |
| Shell | Windows 环境;编写多命令/shell 片段时先确认实际使用的 shell 类型(POSIX vs PowerShell),语法按实际情况调整 |
| 密钥 | 只存 `chrome.storage.local`;不打印/不提交任何 API Key |
| 模型可见文本 | **一律英文**(Model-facing text):工具 description/参数 description、返回模板与截断标注、错误分支文本、非 vision 图片描述、system prompt 全文;UI 显示文案(TOOL_LABELS 中文值、ToolCallCard 等)保持中文,以后收敛 i18n |

## 3. 用户已拍板的决策(按时间序,勿推翻)

1. **提供商不搞预设列表**(旧的 DeepSeek/OpenRouter 预设已废弃)。多提供商管理,每个提供商独立配置。
2. 每个提供商选择接口协议 `api` 三选一,UI 命名:**OpenAI 兼容 · Chat Completions / OpenAI 兼容 · Responses / Anthropic Messages**(`openai-completions` / `openai-responses` / `anthropic-messages`);**anthropic baseUrl 按裸域名约定**(SDK 路径自带 /v1),`normalizeBaseUrl` 剥用户多填的尾部 `/v1`。
3. 支持从端点**拉取模型列表**、**测试连接**(复用拉取)、**手动添加模型**;每个模型可配参数:上下文窗口 / 最大输出 / 工具调用 / 图像识别 / 推理。
4. 模型参数用 **models.dev 自动预填**(`api.json` 免费无鉴权),不覆盖用户手填值,查不到留空。
5. **AI 请求用 `@earendil-works/pi-ai` + pi-agent-core**,不手写 SSE(曾实现过 `lib/stream.ts`/`lib/ai.ts`,均已删除)。
6. **设置页 = 整页视图切换**,点 Header 齿轮进入、Header 内切换 提供商/关于 两个视图(无 Tabs 组件);添加/编辑提供商 = **ProviderDialog 弹窗**(非整页 DetailView);拉取模型 = 弹窗内联勾选导入区(非独立 FetchModelsDialog)+ 独立「同步」按钮(models.dev 补全已有模型参数)。
7. **历史会话 = Header 内 DropdownMenu**(非 Dialog);页面上下文**默认开启**,引用 chip 在 Composer 上方管理;模型/思考等级切换在 Composer 内;Composer 工具栏 `[+ ▾]` = 框选元素/引用页面统一入口;tab chip 带元素 DropdownMenu。
8. **UI 禁用紫色/violet,一律 shadcn 默认中性样式**;严禁自定义组件/样式/变体(button.tsx 曾被加 xs/icon-xs,已重置;`components/ui/` 必须保持官方原样)。
9. **UI 设计变更先与用户确认设计再实现**(§5 保留早期设计稿仅作历史参考,实际实现以代码为准)。
10. **agent 编排用 pi-agent-core**(`Agent` + `streamSimple`),页面操作工具自研(AgentTool);三期规格 v2 = ARIA 定位与页面动作原语(见 §8.4),chrome.debugger 仅条件触发、不排期。
11. 聊天页功能基线(回归清单,不可丢):流式输出、停止按钮(取消保留已生成部分)、Enter 发送/Shift+Enter 换行/IME 组合词不误发、历史会话切换/删除/新建、消息复制、自动滚动(用户上翻不打断)、错误/取消的 UI 呈现、工具调用卡片、思考折叠区、token 脚注、会话草稿。
12. **引用架构定稿 = `<page-refs>` 块**:引用元数据发送时序列化进 user 消息 content,此后永不改变;无 refSnapshot 字段、无 convertToLlm、system prompt 不注入引用目录(只放协议常量规则);`ChatMessage` 回归纯 pi 联合,零自定义字段。
13. **会话草稿**:`Session.draft { input, refTabs, pickedElements }` 随会话持久化(IndexedDB 防抖落盘);新会话自动引用当前页;空会话离开即回收;发送即清空草稿。
14. **工具安全边界 = tab 级白名单**(tabId ∈ 草稿引用 ∪ 历史 `<page-refs>` 块);selector 不设白名单(框选元素是提示,AI 可在引用页内自行探索);vision 门控:`model.input` 含 image 才产 ImageContent 块;工具中文文案单一来源 `TOOL_LABELS`(读取网页内容/读取页面元素)。
15. **工具命名规范 = `<动词>_<域词>`**:动词集 {read, search, fetch, click, fill, scroll, screenshot, execute, ask} × 域词集 {page, element, url, web, js, user, time},新工具只许集合内组合(`extract_page` 已改名 `read_page`;`TOOL_LABELS` 保留旧 key extract_page 兼容历史会话 ToolCallCard)。协议字符串已随名同步(`ai-sidebar/read-page` 等,常量单一来源 lib/types.ts,content.ts 只 import 纯常量)。
16. **模型可见文本一律英文**(Model-facing text):工具 description/参数 description、返回模板与截断标注、错误分支文本、非 vision 图片描述、system prompt 全文;UI 显示文案保持中文(TOOL_LABELS 中文值、ToolCallCard 等),以后收敛 i18n。
17. **工具门控契约 = `lib/gate.ts`**:`GateRequest`(confirm 弹卡 / ask 提问)+ `setGateHandler`(App 注册 UI 处理器;**未注册时门控请求快速 deny/cancelled,安全默认**)、`flushPendingGates`(停止/中止生成时冲销 pending)、`requestGate`(handler 抛异常按 deny);`createGatedTool(tool, summary, detail?, detailFromArgs?)` 为 confirm 路径包装,detail 支持按调用参数动态生成(`detailFromArgs(args): string`,空串回退静态 detail,execute_js 用它预览待执行代码),denied 返回英文 "User denied permission to run this tool."(正常 tool result,模型可继续);ask_user 走 ask 路径,挂起阻塞工具循环属预期(无超时)。
18. **execute_js = userScripts.execute 主路线 + scripting MAIN world 兜底**(`lib/pageScripting.ts`):Chrome 135+ 才有 `chrome.userScripts.execute`(manifest 已设 `minimum_chrome_version: "135"`);Chrome 138+ 需用户在扩展详情页开启 **Allow User Scripts**(未开时命名空间缺失或 getScripts() throw);userScripts 不可用时降级 `scripting.executeScript` MAIN world(func 包装 eval,严格 CSP 站点会失败),降级在返回文本里注明、全链失败返回可行动英文错误文本;结果 JSON.stringify 后截断 8000 字符;一切错误转英文文本不 throw。
19. **元素引用 = 单一表示 `<picked-element …/>` 块**(标记协议 [element:N]/[元素:N] 已废除):块在消息文本内**原位**承载引用,草稿/存储/LLM 三处同串零转换;块属性 = elementId(1 起单调递增,随草稿持久化)+ tabId/selector/tagName/label(内容预览截断 ~24 视觉单位,`lib/elementLabel.ts`);LLM 请求副本仅把 refs 块剥 elements 留 tabs(`agent.ts toLlmMessage`);兼容层已删——normalizePickedElements/旧双正则/旧草稿转换全移除,**旧格式元素丢弃、旧标记按裸文本显示**(dev 阶段未发布,数据可弃;发布前如需兼容再补)。
20. **websearch 十源 + fetch_url**:源集 = duckduckgo/searxng(免费)/brave/tavily/bocha/serper/exa/zhipu/metaso(API Key)/bing(无 Key HTML 抓取,稳定性不保证),设置页"搜索"页签配置,`search_web` 仅在源可用时注册(守卫单一来源 `isWebSearchConfigured`);统一结果形状 `{title,url,snippet}[]`,错误前缀 `search_failed:`/`not_configured:`;`fetch_url` = sidepanel 直连 GET + Readability 提取(与 content.ts 同库),**私有/内网地址拒绝且重定向复检**(防提示注入探测内网),2MB/12000 字上限,错误前缀 `fetch_failed:`/`http_error:`/`not_html:`/`too_large:`/`extract_failed:`。

## 4. 当前代码状态

lib 层 + sidepanel 全部 UI 已完成(含 picked-element 块协议、read_element/框选、vision 读图、websearch 十源、fetch_url、compact_context);已提交至 `8d3e67d`(websearch 十源)。

| 文件 | 状态 | 说明 |
|---|---|---|
| `lib/types.ts` | ✅ 完成 | `ApiType`/`ModelConfig`(含 `reasoningLevels`)/`ReasoningLevel`(`REASONING_LEVELS`/`REASONING_LEVEL_LABELS`)/`TOOL_LABELS`+`toolLabel`(中文单一来源)/`WebSearchProvider`+`WebSearchConfig`/`Settings`(含 `reasoningLevel`+`webSearch`)/`RefTabMeta`/`RefElementMeta`(id/tabId/selector/tagName/preview)/`PageRefs`/`ChatMessage`(纯 pi 联合)/`SessionDraft`/`Session`(含 draft+compaction)/`PickedElement`(含 elementId)/`READ_PAGE_MESSAGE`+`PICK_ELEMENT_MESSAGE`+`PICK_ELEMENT_RESULT_MESSAGE`(消息协议常量单一来源) |
| `lib/providers.ts` | ✅ 完成 | `API_TYPE_OPTIONS`(三协议+默认 baseUrl)、`normalizeBaseUrl`(anthropic 剥尾 /v1)、`apiTypeLabel`、`createProviderDraft`、`findActiveModel`、`getModelReasoningLevels`(空回退 low/medium/high)、`resolveReasoningLevel`、`DEFAULT_SETTINGS`(含 webSearch 默认) |
| `lib/storage.ts` | ✅ 完成 | `settingsItem`/`activeSessionIdItem` + `sanitizeSettings`(含 `sanitizeWebSearch`:provider 白名单 11 值)/`sanitizeSessions`(旧扁平消息结构按 pi 形状迁移)+ `uid/createSession(含 draft)/createUserMessage(text, refs?)/messageText/titleFromText/EMPTY_USAGE`;sanitizeDraft 丢弃无 elementId 的旧格式元素 |
| `lib/sessionStore.ts` | ✅ 完成 | 会话历史唯一读写层(IndexedDB,`idb` 封装):`listSessions`(按 updatedAt 降序)/`saveSession`/`deleteSession`/`migrateLegacySessions`(旧 `local:sessions` 一次性迁移后删除旧 key);草稿随 Session 一起存 |
| `lib/pageRefs.ts` | ✅ 完成 | `<page-refs>` 块纯函数:`renderPageRefsBlock`(序列化拼进 user content;elements 含 id/preview)/`parsePageRefs`(UI 解析渲染,旧消息无 id 按数组序补齐)/`stripPageRefs`(展示时剥块)/`collectPageRefs`(聚合历史块引用,做工具白名单);`ELEMENT_PREVIEW_LIMIT` 常量 |
| `lib/agent.ts` | ✅ 完成 | pi-agent-core 桥接:`runAgentTurn()`(唯一发送入口:工具循环/abort/事件透出;白名单=草稿∪历史块;工具数组经 `tools/registry.ts` 的 `getTools` 组装;**LLM 请求副本 `toLlmMessage` 把 refs 块剥 elements 留 tabs** —— `<picked-element>` 块已是元素内容载体,存储/LLM 同串)、`toPiModel`、`buildSystemPrompt()`(身份 + 本地日期时间行 + 压缩版 `<page-refs>` 协议规则,不注入引用目录);工具工厂已全部移至 `lib/tools/` |
| `lib/models.ts` | ✅ 完成 | `fetchProviderModels`(openai 兼容 Bearer / anthropic x-api-key+version,路径 openai=`/models`、anthropic=`/v1/models`)、`fetchModelsDevMeta`、`applyModelMeta`、`syncModelsWithModelsDev`(「同步」按钮:为已有模型补全参数)、`testConnection` |
| `lib/pageContext.ts` | ✅ 完成 | tab 级读取原语(仅读取,不含工具工厂):`getActiveTabMeta`/`getTabMeta`/`listCandidateTabs`/`extractFromTab`/`renderPageContext`(content.ts 截 12000 字,本层透传);框选与元素解析:`startPickElement`(`ai-sidebar/pick-element`)、`resolveElement`(复用 `ai-sidebar/pick-element` + `action:'resolve'`,返回 outerHTML+truncated+preview+images+dpr) |
| `lib/imageFetch.ts` | ✅ 完成 | read_element 取图管道:`fetchImageForModel`(fetch 主取)→ `captureCropForModel`(captureVisibleTab 按 rect×DPR 裁剪兜底,防盗链/403);canvas 降采样对齐 pi 上游:≤2000×2000、JPEG q0.8 起逐级降质、PNG/JPEG 取小、base64 ≤4.5MB |
| `lib/gate.ts` | ✅ 完成 | 工具门控契约:`GateRequest`(confirm/ask)/`GateResponse`、`setGateHandler`(未注册=快速 deny/cancelled,安全默认)、`flushPendingGates`(停止/中止冲销 pending)、`requestGate`(handler 异常按 deny)、`createGatedTool`(confirm 包装,detail 支持按参数动态生成,denied 英文拒绝文本;execute_js 已用) |
| `lib/pageScripting.ts` | ✅ 完成 | execute_js 注入原语:`isUserScriptsAvailable`(userScripts 存在 + getScripts() 探测不 throw)、`executePageScript(tabId, code, world)`(userScripts.execute 主路线 → scripting.executeScript MAIN world func 包装兜底,JSON.stringify 后 8000 字符截断,降级在返回文本注明,一切错误转英文不 throw) |
| `lib/fetchPage.ts` | ✅ 完成 | fetch_url 抓取管线:sidepanel 直连 GET + 动态 `@mozilla/readability` 提取(与 content.ts 同库);**私有/内网地址拒绝 + 重定向复检**(防提示注入探测内网);2MB(Content-Length 与读入后双检)/content-type 限 HTML/正文 12000 字截断;错误英文文本规范化前缀 `fetch_failed:`/`http_error:`/`not_html:`/`too_large:`/`extract_failed:` |
| `lib/webSearch.ts` | ✅ 完成 | websearch 十源适配器(duckduckgo/searxng HTML 解析 + brave/tavily/bocha/serper/exa/zhipu/metaso JSON API + bing 无 Key HTML 抓取):统一 `{title,url,snippet}[]`、10s 超时、截 8 条、错误 throw `search_failed:` 前缀族;`isWebSearchConfigured`(注册/运行守卫单一来源)、`searchWeb(config, query)` 分发 |
| `lib/elementLabel.ts` | ✅ 完成 | 元素 chip label 构造:`elementChipLabel`(24 视觉单位,chip/气泡)/`elementListLabel`(48 视觉单位,引用列表);CJK 视觉宽度加权,空 preview 回退 `<tagName>`→"页面元素" |
| `lib/compaction.ts` | ✅ 完成 | compact_context 压缩管线:生效历史序列化 → pi completeSimple 生成结构化摘要(KEEP_RECENT_TOKENS=12000 与 read_element 截断同值);`findCutIndex`/`runCompact`;摘要消息由调用方拼装落盘 |
| `lib/tools/` | ✅ 完成 | 工具注册表(pi 一工具一文件 + 集合函数):`registry.ts` = 唯一组装点 `getTools(GetToolsOptions{refTabs,pickedElements,canUseImage,onCompactContext,webSearch})`,组装序 **utility(read_time/ask_user/compact_context)→ web(search_web 条件)→ read(read_page/read_element)→ fetch(fetch_url)→ gated(execute_js)**;`read-page`/`read-element`/`fetch-url`/`web-search`/`compact-context`/`execute-js`/`read-time`/`ask-user` 各导出 `createXxxToolDefinition`;`time.ts` = 本地时间助手 |
| `lib/utils.ts` | ✅ 完成 | cn()/getErrorMessage |
| `entrypoints/content.ts` | ✅ 完成 | 结构化提取(article/main/[role=main] 优先,截 12000 字)+ 框选元素模式(@medv/finder 生成唯一 selector,结果经 `ai-sidebar/pick-element-result` 广播)+ 元素解析应答(`pick-element` 消息 `action:'resolve'`) |
| `entrypoints/background.ts` | ✅ 完成 | 点击图标打开侧边栏 |
| `entrypoints/sidepanel/App.tsx` | ✅ 完成(组合层) | store selector 订阅 + 五域编排 hook 组装(useGate/useSessionManager/useChatTurn/usePageContextRefs/useCompact)+ ChatView ⇄ Settings 视图骨架 + gatePagination/quietTailCount/contextData 派生(useMemo 就地);无业务逻辑 |
| `entrypoints/sidepanel/store/` | ✅ 完成 | zustand v5 单 store(单一状态树按域分组,非分列 store)五切片:`gateSlice`(activeGate/resolvedGateCount/pushGate/4 应答/dismissPendingGates/resetGates;handler 模块级注册,StrictMode 免疫)、`errorSlice`(errorMessage)、`sessionSlice`(sessions/activeSessionId/loaded/commitSessions/patchDraftOf/patchActiveDraft + 草稿防抖队列模块级 flushDraftSaves/dropPendingDraftSave)、`settingsSlice`(settings/setSettings/updateSettings)、`chatSlice`(isStreaming/streamingContent/streamingThinking/activeToolNames/isCancelled/inFlight);devtools 仅 `wxt dev` 运行模式(构建产物恒为零引入;devtools 面板需装 Redux DevTools 浏览器扩展手动冒烟验证一次) |
| `entrypoints/sidepanel/hooks/` | ✅ 完成(编排层,状态全在 store) | `useGate`(gateSlice 消费层:4 应答回调薄层/dismiss/resetGates)、`useSessionManager`(增删切/AI 命名/重命名 + 原子 init:storage 读取+迁移+watch 接 store action)、`useChatTurn`(send/stop 编排:turnSeqRef R-1 守卫/abortControllerRef/compactRequestedRef ephemeral ref;B-1 生效历史/非破坏落盘语义原样)、`usePageContextRefs`(refTabs/pickedElements 读写经 patchActiveDraft、tabs.onUpdated/onRemoved 同步、框选 startPickElement+pendingPick、runtime.onMessage 框选结果回传)、`useCompact`(压缩编排:互斥守卫/非破坏落盘);跨域归属备案:gatePagination/quietTailCount/contextData 留 App 组合层 useMemo,runtime.onMessage 框选监听归 usePageContextRefs;三边界:store=共享状态唯一家 / 编排 hook=异步流程+ephemeral ref / 派生=消费点就地 useMemo |
| `entrypoints/sidepanel/components/chat/` | ✅ 完成 | ChatHeader(模型/历史 DropdownMenu/设置入口)、MessageList(**overflow-anchor 哨兵钉底为主 + RO 瞬时兜底**;空态/错误横幅/锚点)、MessageItem(分段渲染:思考/文本/工具卡按 content 块序;ToolCallCard 四态+参数/结果展开;用户消息 chip = `<picked-element>` 块解析渲染 + 旧标记裸文本兜底;token 脚注)、MarkdownView、CompactionRow(压缩摘要分隔线卡)、SlashMenu(斜杠命令浮层)、ApprovalSection(审批槽位,唯一交互渲染位)、elementMarkerText(chip 渲染 helper)、extensions/(TipTap InlineBadge 原子徽章节点 + BadgeNodeView + editorSerialize 序列化) |
| `entrypoints/sidepanel/components/chat/ChatInput.tsx` | ✅ 完成 | **Composer = TipTap 3**(inlineBadge 原子节点:框选完成 insertContent;删除=叉号整块删/PM 原生退格;粘贴=纯文本/单一 URL 转 url 徽章;草稿恢复=setContent+parseHTML 还原);斜杠命令(/compact /clear /help,浮层+键位导航);上下文占用环 ContextRing/详情 ContextPanel(压缩入口);tab chip 带元素 DropdownMenu + 清除已选元素;模型+思考等级切换 |
| `entrypoints/sidepanel/components/settings/` | ✅ 完成 | SettingsMainView(提供商/搜索/关于三页签)、SearchSettingsView(搜索源 Select + 条件字段:searxng 实例地址/各 API Key 密码输入 + 申请地址;修改即 updateSettings 持久化)、ProviderDialog(增改提供商 + 内联拉取勾选导入 + 「同步」按钮)、ModelConfigDialog |
| `entrypoints/sidepanel/style.css` | ✅ 完成 | 主题 token + markdown 排版(`.md-*`)+ hljs 主题 + 6px 细滚动条 + element-chip 族(元素预览 chip)+ messages-anchor/viewport(跟底锚点)+ composer-editor(TipTap) |
| `entrypoints/sidepanel/theme.ts` / `main.tsx` / `index.html` | ✅ 完成 | 不用动 |
| `components/ui/` | ✅ shadcn 官方原样 | **严禁自定义**;button.tsx 曾被加 xs/icon-xs,已重置 |

UI 细节基调:顶/底渐变遮罩衔接滚动区、用户气泡 `bg-secondary`、三点打字动画。

依赖:`@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`(^0.84.4)、`@tiptap/*` v3.31(Composer)、`@mozilla/readability` + `dom-to-semantic-markdown`(提取,content.ts 与 fetchPage 共用)、`@medv/finder`(框选 selector)、`highlight.js`(11.x)、`idb`、`zustand` v5。pnpm 曾提示 `@google/genai`/`protobufjs` 构建脚本被忽略,无害。

## 5. UI 设计稿(designer 当年产出的历史稿,实际实现以代码为准)

> **注意**:本节是 UI 实现前的设计稿,与最终实现有偏差——ProviderDetailView 改为 ProviderDialog 弹窗、FetchModelsDialog 并入 ProviderDialog 内联导入区、历史会话由 Dialog 改为 DropdownMenu、思考等级/模型切换落在 Composer、无 violet 点缀。交互细节(§5.4/5.5)与样式 token(§5.6)大部分仍适用;新增 UI 时以现状代码风格为准。

设计基准:360px 宽(适配 320–400px),高 ~600px,shadcn new-york + Tailwind v4,深浅色自动,文案 zh-CN。

### 5.1 信息架构(设计稿;实际为 ChatView ⇄ SettingsMainView 两视图 + ProviderDialog/ModelConfigDialog 弹窗)

```
ChatView(聊天主页)
   │ 点 ⚙ 设置 / 点 Model Badge
   ▼
SettingsMainView(设置主页 - 提供商列表)
   │ 点「+ 添加」或卡片「编辑」
   ▼
ProviderDetailView(提供商配置 + 模型管理)
   │                    │
   │ 点「拉取模型」      │ 点「添加/编辑模型」
   ▼                    ▼
FetchModelsDialog    ModelConfigDialog
(多选批量导入)       (参数与能力开关)
```

### 5.2 视图与组件映射(设计稿)

| 视图 | 职责 | 组件 |
|---|---|---|
| ChatView Header | 当前 Provider/Model 展示,快捷切模型/进设置 | Button(ghost), Badge, DropdownMenu, Tooltip |
| SettingsMainView | 提供商列表、设为当前、增删改入口、全局开关 | ScrollArea, Button, Badge, Switch, Separator |
| ProviderDetailView | 单提供商草稿表单(URL/Key/协议/模型列表) | Input, Label, Select, Button, ScrollArea, Separator |
| ModelConfigDialog | 模型参数与能力开关 | Dialog, Input, Label, Switch, Badge |
| FetchModelsDialog | 远程拉取模型勾选导入 | Dialog, ScrollArea, Input(过滤), Badge |

### 5.3 线框(360px)

**ChatView Header**(标题区与当前模型融合,点击快捷响应):

```text
┌────────────────────────────────────────┐
│ [AI] gpt-4o-mini · DeepSeek ▾   [🌐][+]│
│                                 [📜][⚙]│
├────────────────────────────────────────┤
│ (消息流保持现状)                        │
└────────────────────────────────────────┘
```
- 左侧 Pill:`h-7 px-2 text-xs font-medium rounded-full bg-secondary/80 hover:bg-secondary flex items-center gap-1.5`
- 点击弹 DropdownMenu:当前 Provider 的模型列表 + 底部「管理提供商…」直达设置

**SettingsMainView**:

```text
┌────────────────────────────────────────┐
│ ← 设置                       [+ 添加]  │ Header: h-12, border-b
├────────────────────────────────────────┤
│ 页面上下文                             │
│ ┌────────────────────────────────────┐ │
│ │ 🌐 发送时读取当前网页      [ Switch ]│ │ Global Card
│ └────────────────────────────────────┘ │
│ 提供商 (3)                             │
│ ┌────────────────────────────────────┐ │
│ │ ● DeepSeek               [已激活]  │ │ Active Card
│ │   api.deepseek.com                 │ │ border-primary/40 bg-primary/5
│ │   OpenAI 兼容 · 3 个模型           │ │
│ │   [测试]                  [✎] [🗑] │ │
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │
│ │ ○ OpenAI Official                  │ │ Inactive
│ │   api.openai.com                   │ │ border-border hover:bg-muted/40
│ │   OpenAI Responses · 2 个模型      │ │
│ │   [设为当前]              [✎] [🗑] │ │
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

**ProviderDetailView**:

```text
┌────────────────────────────────────────┐
│ ← DeepSeek 配置               [保存]  │ Header(返回 & 保存)
├────────────────────────────────────────┤
│ 提供商名称  [DeepSeek               ] │ Input h-8 text-sm
│ 接口协议    [OpenAI 兼容 · Chat     ▾] │ Select(切换联动默认 baseUrl)
│ Base URL    [https://api.deepseek…  ] │ Input text-xs font-mono
│ API Key     [sk-•••••••••••••    [👁]] │ password + Eye 切换
│ [ ⚡ 测试连通性 ]  ✓ 连通正常 (12 模型) │ 测试中 Loader2 旋转
│ ────────────────────────────────────── │ Separator
│ 模型列表 (3)          [拉取] [+ 手动] │
│ ┌────────────────────────────────────┐ │
│ │ ● deepseek-chat            [默认]  │ │ Model Row
│ │   128k 上下文 · 4k 输出   [V] [R]  │ │ Badge: V=Vision R=Reason
│ │                           [✎] [✕] │ │
│ ├────────────────────────────────────┤ │
│ │ ○ deepseek-reasoner                │ │
│ │   64k 上下文 · 8k 输出        [R]  │ │
│ │   [设为默认]              [✎] [✕] │ │
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

**FetchModelsDialog**:

```text
┌────────────────────────────────────────┐
│ 导入模型 (已拉取 15 个)            [✕] │
├────────────────────────────────────────┤
│ [ 🔍 搜索模型名称/ID...              ] │
├────────────────────────────────────────┤
│ [✓] 全选所有                           │
│ ┌────────────────────────────────────┐ │
│ │ [✓] deepseek-chat                  │ │
│ │     128k ctx · 4k out · models.dev │ │
│ │ [✓] deepseek-reasoner              │ │
│ │     64k ctx · 8k out · 推理        │ │
│ │ [ ] deepseek-coder (已废弃)        │ │
│ └────────────────────────────────────┘ │
├────────────────────────────────────────┤
│ [ 取消 ]              [ 导入已选 (2) ] │
└────────────────────────────────────────┘
```

**ModelConfigDialog**:

```text
┌────────────────────────────────────────┐
│ 配置模型参数                       [✕] │
├────────────────────────────────────────┤
│ 模型 ID (必填)      [deepseek-chat   ] │(编辑态只读)
│ 显示别名 (可选)     [DeepSeek V3     ] │
│ 上下文窗口            最大输出         │
│ [128000    ]          [4096      ]     │ 双列 Input(tokens)
│ ✦ 参数已由 models.dev 自动匹配预填     │ text-[11px] text-primary
│ 工具调用 (Tools)              [ 开关 ] │
│ 图像识别 (Vision)             [ 开关 ] │
│ 思考/推理 (Reasoning)         [ 开关 ] │
├────────────────────────────────────────┤
│ [ 取消 ]                        [ 确定 ]│
└────────────────────────────────────────┘
```

### 5.4 核心交互流(设计稿)

1. **新建/编辑提供商**:设置主页 `+ 添加` → ProviderDetailView(新 id,默认 `openai-completions`);**切协议联动**:自动填默认 baseUrl,模型列表清空;**草稿隔离**:所有输入/拉取/改参数操作本地 draft,只有点顶部 `保存` 才写 storage;`← 返回` 有未保存改动弹轻量确认。(实际实现:ProviderDialog 弹窗,草稿隔离原则保留)
2. **测试连通性 & 拉取模型**:填 baseUrl+Key 后点测试 → `lib/models.ts` 的 `testConnection`;Loading=Loader2「测试中...」,成功=绿字 `✓ 连通正常 (共 N 个可用模型)`,失败=红字(含 HTTP 码与详情)。点 `拉取` → 并发拉端点列表 + models.dev 元数据,按 ID 匹配预填;勾选导入,合并进 draft(按模型 id 去重)。
3. **激活态**:`activeProviderId` / `activeModelId` 全局唯一;列表页点 `设为当前` 立即高亮并写 storage;**删除当前激活的提供商** → activeProviderId 指向剩余第一个,全删完置 null。

### 5.5 状态设计(设计稿,仍适用)

- **空状态(无提供商)**:居中 `PlugZap` 图标 + 「尚未配置 AI 提供商」+ 副文案「支持 OpenAI 兼容格式、Responses 格式及 Anthropic 格式」+ 主按钮 `[+ 立即添加提供商]`。
- **提供商无模型**:虚线边框卡片「暂无模型,请点击『拉取』或『+ 手动添加』」。
- **models.dev 匹配不到**:参数留空、能力位 false,不显示 `✦ 自动匹配` 标。
- **320px 极窄**:中间长文本 `truncate`,操作按钮固定尺寸。

### 5.6 样式 Token 约定(仍适用)

| 元素 | 类 |
|---|---|
| 页面容器 | `flex h-dvh flex-col bg-background text-foreground` |
| 顶部 Header | `h-11 px-3 border-b flex items-center justify-between` |
| 区块标题 | `text-xs font-medium text-muted-foreground mb-1.5` |
| 卡片 | `rounded-lg border bg-card p-3 shadow-xs` |
| 激活卡片 | `border-primary/50 bg-primary/5 dark:bg-primary/10` |
| 表单控件 | `h-8 text-sm px-2.5 rounded-md` |
| 能力徽章 | `text-[10px] h-4 px-1.5 font-normal rounded-sm bg-secondary` |

### 5.7 避坑(仍适用)

1. 拉取/模型参数用 Dialog 居中覆盖,**不要**在页内塞深层 Accordion(360px 下滚动体验差)。
2. Base URL/API Key 必须 `truncate`,严禁横向滚动条。
3. API Key 默认 `type="password"`,右侧绝对定位 Eye/EyeOff ghost 按钮。

## 6. lib API 参考(UI 只许对着这些写)

```ts
// lib/types.ts
type ApiType = 'openai-completions' | 'openai-responses' | 'anthropic-messages';
type ReasoningLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const REASONING_LEVELS: ReasoningLevel[];              // off~max 全档
const REASONING_LEVEL_LABELS: Record<ReasoningLevel, { short: string; full: string }>;
const TOOL_LABELS: Record<string, string>;             // 工具中文名单一来源(read_page=读取网页内容, 旧 key extract_page 兼容历史会话, read_element/fetch_url=抓取网页内容/search_web=网络搜索/execute_js/compact_context/read_time/ask_user)
interface ModelConfig { id: string; displayName?: string; contextWindow?: number;
  maxTokens?: number; tools?: boolean; vision?: boolean; reasoning?: boolean;
  reasoningLevels?: ReasoningLevel[];                  // 该模型支持的档位(不含 off;空回退 low/medium/high)
  prefilled?: boolean; }
interface ProviderConfig { id: string; name: string; api: ApiType; baseUrl: string;
  apiKey: string; models: ModelConfig[]; }
type WebSearchProvider = 'none' | 'duckduckgo' | 'searxng' | 'brave' | 'tavily'
  | 'bocha' | 'serper' | 'exa' | 'zhipu' | 'bing' | 'metaso';
interface WebSearchConfig { provider: WebSearchProvider; searxngBaseUrl: string; apiKey: string }
interface Settings { providers: ProviderConfig[]; activeProviderId: string | null;
  activeModelId: string | null; includePageContext: boolean; reasoningLevel: ReasoningLevel;
  webSearch: WebSearchConfig; }
// 引用元数据(user 消息 content 内嵌 <page-refs> 块的 JSON,发送后不可变;LLM 视图剥 elements 留 tabs):
interface RefTabMeta { tabId: number; title: string; url: string; focused?: boolean }
interface RefElementMeta { id: number; tabId: number; selector: string; tagName: string; preview: string }
interface PageRefs { tabs: RefTabMeta[]; elements: RefElementMeta[] }
type ChatMessage = UserMessage | AssistantMessage | ToolResultMessage;  // 纯 pi 联合,零自定义字段
interface SessionDraft { input: string; refTabs: RefTab[]; pickedElements: PickedElement[] }
interface Session { id; title; messages: ChatMessage[]; createdAt; updatedAt; draft?: SessionDraft;
  compaction?: { summaryTimestamp; tokensBefore; compactedAt } }
interface PickedElement { id; elementId; tabId; selector; tagName; preview }  // elementId 随草稿持久化,与块属性一致

// lib/providers.ts
API_TYPE_OPTIONS: { value: ApiType; label: string; defaultBaseUrl: string }[]
normalizeBaseUrl(api: ApiType, url: string): string    // 去尾斜杠;anthropic 另剥尾部 /v1(裸域名约定)
apiTypeLabel(api: ApiType): string
createProviderDraft(): ProviderConfig
findActiveModel(settings): { provider; model } | null
getModelReasoningLevels(m: ModelConfig): ReasoningLevel[]   // 空/缺省回退 ['low','medium','high']
resolveReasoningLevel(m: ModelConfig, level: ReasoningLevel): ReasoningLevel

// lib/storage.ts(wxt storage item)
settingsItem        // 'local:settings',fallback DEFAULT_SETTINGS(含 webSearch)
activeSessionIdItem // 'local:activeSessionId'
sanitizeSettings(unknown): Settings                // 含 sanitizeWebSearch(provider 白名单 11 值)
sanitizeSessions(unknown): Session[]            // 旧扁平消息 {id,role,content} → pi 形状(sessionStore 迁移用)
uid(): string; createSession(title?, draft?); createUserMessage(text, refs?): UserMessage  // refs 序列化进 <page-refs> 块
messageText(m: ChatMessage): string             // 提取纯文本(各消息类型归一;UI 展示文本用 stripPageRefs 再剥块)
titleFromText(text): string; EMPTY_USAGE

// lib/pageRefs.ts(<page-refs> 块纯函数;ELEMENT_PREVIEW_LIMIT=300)
renderPageRefsBlock(refs: PageRefs): string     // 拼进 user content 的 JSON 块(elements 含 id/preview)
parsePageRefs(content: unknown): PageRefs | null // UI 解析渲染 chip;旧消息无元素 id 按数组序补齐
stripPageRefs(content: string): string          // 展示时剥块
collectPageRefs(messages): PageRefs             // 聚合历史块引用(同字段后者覆盖前者)→ 工具 tab 白名单

// ── 元素引用协议(单一表示):user 消息文本内嵌自闭合块,三处同串 ──
// <picked-element elementId="N" tabId="N" selector="…" tagName="…" label="预览截断24视觉单位" />
// 属性值经 &quot;/&lt;/&gt; 转义;序列化 = extensions/editorSerialize.ts serializePickedElementBlock
// LLM 请求副本(agent.ts toLlmMessage)把 refs 块剥 elements 留 tabs,块原样保留(存储/LLM 同串)

// lib/sessionStore.ts —— 会话历史唯一读写层(IndexedDB 'ai-sidebar' / store 'sessions',idb 封装;草稿随 Session 存)
listSessions(): Promise<Session[]>              // getAll,按 updatedAt 降序
saveSession(s: Session)                         // put
deleteSession(id: string)                       // delete
migrateLegacySessions(): Promise<Session[]>     // 旧 local:sessions 非空则清洗写入后删旧 key(只迁一次)
// 注意:IndexedDB 无跨上下文 watch;sidepanel 是会话历史唯一写方

// lib/agent.ts —— 发消息唯一入口(工具组装已移至 lib/tools/registry.ts)
toPiModel(p: ProviderConfig, m: ModelConfig): Model<KnownApi>   // 缺失参数保守默认(128000/4096)
buildSystemPrompt(): string                     // 身份 + 本地日期行 + 压缩版 <page-refs> 协议规则(不注入引用目录)
runAgentTurn({ provider; modelId; history: ChatMessage[]; userMessage: UserMessage;  // content 已内嵌块
  refTabs?: RefTab[]; pickedElements?: PickedElement[];                              // 当前草稿引用(App 已按开关过滤)
  thinkingLevel: ReasoningLevel; sessionId?; signal?; onEvent?: (e: AgentEvent) => void;
  onCompactContext?: () => void; webSearch?: WebSearchConfig | null;
}): Promise<RunAgentResult>                     // LLM 请求副本经 toLlmMessage:refs 块剥 elements 留 tabs
// RunAgentResult { messages(完整转录); newMessages(本轮新增,含 toolResult); errorMessage? }
// 语义:工具白名单 = 草稿引用 ∪ collectPageRefs(history);内部 new Agent({ streamFn: models.streamSimple, toolExecution:'sequential' });
// 失败经协议事件编码(stopReason='error');中止时已生成部分保留在转录中;onEvent 透出供 UI 流式渲染

// lib/tools/registry.ts —— 工具注册表(唯一组装点;一工具一文件见同目录)
interface GetToolsOptions { refTabs?: RefTab[]; pickedElements?: PickedElement[]; canUseImage?: boolean;
  onCompactContext?: () => void; webSearch?: WebSearchConfig | null }
getTools(options): AgentTool[]                  // 组装序:utility(read_time/ask_user/compact_context)→ web(search_web 条件)→ read(read_page/read_element)→ fetch(fetch_url)→ gated(execute_js)
// createWebSearchTools(config) / createPageReadTools(options) / createFetchTools() / createGatedTools(options) /
// createUtilityTools(onCompactContext):分组集合函数(search_web 仅在 isWebSearchConfigured(config) 时注册)
// 各工具文件导出 createXxxToolDefinition;新增工具 = 新文件 + 在 registry 登记分组

// lib/fetchPage.ts(fetch_url 抓取管线)
FETCH_CONTENT_LIMIT = 12000                     // 正文截断上限(与 read_element 同值)
fetchAndExtractPage(url): Promise<{ok:true;page:{title;url;content;truncated}}|{ok:false;error:string}>
// sidepanel 直连 GET + 动态 @mozilla/readability 提取;私有/内网地址拒绝+重定向复检;
// 2MB(Content-Length+读入后双检)/content-type 限 HTML;错误前缀 fetch_failed:/http_error:/not_html:/too_large:/extract_failed:

// lib/webSearch.ts(十源搜索适配器)
isWebSearchConfigured(config): boolean          // provider 非 none 且必填字段齐备(注册/运行守卫单一来源)
searchWeb(config, query): Promise<WebSearchResult[]>  // 统一 {title,url,snippet}[];10s 超时;截 8 条
// duckduckgo/searxng=HTML 解析(class 名脆弱) / bing=无 Key HTML(被拦即 fail) / 其余=官方 JSON API
// 错误 throw 'search_failed: <platform> returned <status>' / 'not_configured: …'

// lib/elementLabel.ts(元素 chip label)
elementChipLabel(el): string                    // 24 视觉单位(chip/气泡;CJK×2 加权)
elementListLabel(el): string                    // 48 视觉单位(引用列表);空 preview 回退 <tagName>→页面元素

// lib/compaction.ts(compact_context 压缩管线)
runCompact({ provider; modelId; messages; signal?; customInstructions? }): Promise<{ summaryContent; tokensBefore }>
findCutIndex(messages): number                  // 生效历史切点(KEEP_RECENT_TOKENS=12000)

// lib/models.ts —— 模型列表/预填/同步/测试(全项目唯一手写 fetch 的地方)
fetchProviderModels({ api, baseUrl, apiKey }, signal?): Promise<string[]>  // anthropic:x-api-key 头 + /v1/models
fetchModelsDevMeta(signal?): Promise<Map<string, ModelMeta>>
applyModelMeta(m: ModelConfig, meta?: ModelMeta): ModelConfig  // 不覆盖手填值,置 prefilled
syncModelsWithModelsDev(models, signal?): Promise<{ models; updatedCount }>  // 「同步」按钮
testConnection({ api, baseUrl, apiKey }): Promise<string>      // 复用拉取;成功返回提示文案,失败 throw

// lib/pageContext.ts(tab 级读取原语,不含工具工厂)
getActiveTabMeta(): Promise<RefTab | null>; getTabMeta(tabId): Promise<RefTab | null>
listCandidateTabs(): Promise<RefTab[]>        // 候选引用页(排除扩展自身等)
extractFromTab(tabId): Promise<ExtractedPage | null>  // sendMessage READ_PAGE_MESSAGE('ai-sidebar/read-page'),失败 null 不阻塞
renderPageContext(page): string               // read_page 工具回传给模型的正文文本(英文,Model-facing)
startPickElement(tabId): Promise<void>        // 广播 ai-sidebar/pick-element 进框选模式,结果经 pick-element-result 回传
resolveElement(tabId, selector): Promise<ResolvedElement | null>  // 元素解析(outerHTML+truncated+preview+images+dpr),read_element 底层;复用 pick-element 消息 action:'resolve'

// lib/pageScripting.ts(execute_js 注入原语;userScripts 类型未在 @wxt-dev/browser 声明,内部已 cast)
isUserScriptsAvailable(): boolean               // chrome.userScripts 存在 + getScripts() 探测不 throw(138+ 开关探测)
executePageScript(tabId, code, world): Promise<{ok:true;result:string}|{ok:false;error:string}>
// world: 'user_script'(默认,USER_SCRIPT 隔离豁免页面 CSP)| 'main'(页面主世界,可访问页面 JS 状态)
// 主路线 chrome.userScripts.execute(135+);不可用降级 scripting.executeScript MAIN world(func 包装 eval,
// 严格 CSP 站点失败),降级在结果文本注明;全链失败返回可行动英文错误文本(Allow User Scripts / 120-137 开发者模式)
// 结果 JSON.stringify 后截断 8000 字符;一切错误转英文文本不 throw

// lib/gate.ts(工具门控契约;UI 车道经 setGateHandler 注册处理器)
type GateRequest  = { kind:'confirm'; toolName; label; summary; detail? } | { kind:'ask'; question; options? };
type GateResponse = { kind:'confirm'; approved } | { kind:'ask'; answer; cancelled? }
setGateHandler(h: GateHandler | null); flushPendingGates()   // 未注册=快速 deny/cancelled(安全默认);flush 供停止/中止冲销
requestGate(req): Promise<GateResponse>                      // 挂起等 UI 应答(无超时);handler 异常按 deny
createGatedTool(tool, summary, detail?, detailFromArgs?)     // confirm 包装:detailFromArgs(args)=>string 按调用参数动态生成
// detail(空串回退静态 detail,execute_js 预览 code);approved 才执行原工具,denied 返回英文拒绝文本

// lib/tools/time.ts(本地时间助手;system prompt 与 read_time 共用)
localDate(now?): string; localTime(now?): string; utcOffsetLabel(now?): string; weekdayName(now?): string
// 'YYYY-MM-DD' / 'HH:MM:SS' / 'UTC+8' / 英文星期名

// lib/tools/read-time.ts / ask-user.ts / fetch-url.ts / web-search.ts(工具定义;组装见 registry)
createReadTimeToolDefinition(): AgentTool             // 'read_time':date/weekday/time/timezone/iso(UTC) 英文块,免弹卡
createAskUserToolDefinition(): AgentTool              // 'ask_user':requestGate ask 路径(≤6 options);cancelled → 'User dismissed the question (no answer).'
createFetchUrlToolDefinition(): AgentTool             // 'fetch_url':safe;GET 任意公开 URL → Title/URL/<content>;私有网拒绝;错误前缀族见 lib/fetchPage.ts
createWebSearchToolDefinition(config): AgentTool      // 'search_web':safe;编号结果清单 + "Use fetch_url … follow up";错误前缀 search_failed:/not_configured:

// lib/imageFetch.ts(read_element 取图管道)
fetchImageForModel(src): Promise<ModelImage | null>            // fetch 主取
captureCropForModel(tabId, rect, dpr): Promise<ModelImage | null>  // captureVisibleTab 裁剪兜底(仅活动 tab)
// 编码:canvas 降采样 ≤2000×2000、JPEG q0.8 起逐级降质、PNG/JPEG 取小、base64 ≤4.5MB
```

## 7. pi-ai / pi-agent-core 使用要点(踩过的坑,勿重复踩)

1. 协议实现用 **`.lazy` 导入**(树摇友好,SDK 按需 chunk):`@earendil-works/pi-ai/api/openai-completions.lazy` 等,工厂函数 `openAICompletionsApi()` / `openAIResponsesApi()` / `anthropicMessagesApi()`;三种实现已在 `lib/agent.ts` 的 `API_IMPLEMENTATIONS` 组装好。
2. `createProvider({ id, name, baseUrl, auth: { apiKey: { name, resolve: async () => ({ auth: { apiKey } } }) }, models, api })`;BYOK 场景在 resolve 闭包里给 key,每次请求前重建 provider(对象创建很便宜)。
3. `Model` 必填字段:`{ id, name, api, provider, baseUrl, reasoning, input: ('text'|'image')[], cost(全 0 即可), contextWindow, maxTokens }`——`toPiModel` 已处理缺失参数的保守默认(128000/4096);`input` 含 image 与否是 read_element 产图块的 vision 门控同源(`model.input.includes('image')`),pi-ai `downgradeUnsupportedImages` 是双保险。
4. **agent 编排不要直接调 `models.stream`,一律走 pi-agent-core 的 `Agent`**(`streamFn: (m, ctx, o) => models.streamSimple(m, ctx, o)`);`runAgentTurn` 已封装工具调用循环/中止/事件透出,UI 只消费 `AgentEvent`。
5. 消息历史:会话直接按 pi 消息联合(`ChatMessage`)持久化(存 IndexedDB,见 `lib/sessionStore.ts`),agent 回放零转换;元素引用以 `<picked-element …/>` 块内嵌 user content 原样抵达 LLM(存储/LLM 同串,唯一差异 = LLM 请求副本把 `<page-refs>` 块剥 elements 留 tabs,`agent.ts toLlmMessage`);assistant 消息自带 thinking 块/toolCall/usage;旧扁平结构经 `sanitizeSessions` 在迁移时清洗(usage 补 `EMPTY_USAGE`)。
6. pi-ai 内部已设 `dangerouslyAllowBrowser: true`,官方支持浏览器端;Anthropic 的 `anthropic-version` 头由 pi-ai 处理;图像编码约定对齐 pi 上游 `image-resize-core.ts`(≤2000²/q0.8 起/4.5MB)。
7. **不要**给 pi-ai 传自定义 fetch、不要绕过它手写协议;模型列表拉取是全项目唯一手写 fetch 的地方(已在 lib/models.ts)。

## 8. 待办(按序)

1. **用户手动回归**(`pnpm dev` 自动拉起 Chrome 加载扩展):重点 = 普通对话、read_page/read_element/fetch_url/search_web(需在设置"搜索"页签启用)工具触发、框选元素(TipTap 徽章)+ vision 读图、压缩摘要分隔线卡、上下文占用环、思考折叠区、token 脚注、流式中途停止、自动跟底(流式无跳动)、旧会话数据迁移(旧格式元素/标记按裸文本丢弃,dev 数据可弃);另过一遍设置页全流程(添加提供商→测试→拉模型→同步→改参数→设为当前→聊天;搜索页签四类源配置)。
2. ~~websearch / fetch_url 工具~~ **已完成**(2026-09,十源 + fetch_url;见 §4 状态表与 §6 API 参考)。
3. 多语言:TOOL_LABELS 等文案收敛到 i18n(WXT 内建)。
4. **三期规格 v2:ARIA 定位与页面动作原语**(原"页面操作"粗粒度条目替换;chrome.debugger 条件触发行保留,见 ⑤):
   - **引库决策**:唯一新依赖 `dom-accessibility-api`(~12KB gzip,零依赖,114M/周)——getRole(含隐式 role,原生反射不算)/computeAccessibleName(AccName 全算法)/isDisabled;aria-query/axe-core/@testing-library/原生反射全否决;交互判定白名单自研 ~30 行(button/link/input/select/textarea/combobox/slider/tab 等 role 子集 + tabIndex≥0)
   - **五个新工具**(命名矩阵内):
     1. `search_element`(safe,发现层):交互元素清单,ARIA role+可访问名称+disabled+可见性,重名 `[2]` 序号消歧,截断 80 条;**返回格式 = AI 友好紧凑行式**(`- button "Sign in" [enabled, visible]`,AhYi8/ariaSnapshot 系已验证对 LLM 最优);实现 = dom-accessibility-api + content script 侧计算(无 CDP/无新权限)
     2. `click_element`(confirm+会话 grant):合成事件序列(untrusted;React/Vue 兼容) + 遮挡命中检测 + 固定 fallback 序列;受控组件 fill 法(focus→全选→native setter→flush input/change)
     3. `fill_element`(confirm+会话 grant):分类 fill(text/select/checkbox/toggle,照 AhYi8 actions.ts:250-518 模式)
     4. `scroll_page`(safe):scrollBy/scrollIntoView
     5. `screenshot_page`(confirm,视觉反馈):captureVisibleTab(仅活动 tab,明示限制)
   - **时序等待**:不设独立工具——动作内置有界 settle(readyState+rAF settle ≤3s;MutationObserver 100ms 静默 + 3s 天花板模式,参考 AhYi8 waitForStableDom)
   - **反馈**:动作返回 Before/After 段(元素文本 delta/可见性),结构化错误前缀(`tab_closed:`/`element_not_found:`/`ambiguous_locator (N matches):`/`navigation_started:`)
   - **页面版本指纹**(实施序列 ④ 内):read_page/read_element 返回体附带页面状态指纹(URL+title+内容长度的 hash)——模型对比两次读取的指纹即可判断页面是否/如何变化,为跨读取的 change-detection 提供地基(外部 agent 实测需求:确认动作是否生效的另一半)
   - **会话级 grant 扩展**(gate.ts):confirm 卡加"本会话内允许此类操作"复选框 → grant 存运行时切片(面板关闭即失效);requestGate 查 grant 短路;execute_js 永不可 grant
   - **动作前反馈**:目标元素 400ms 轮廓闪烁(高亮)
   - **寻址双轨**:用户框选 = CSS selector(picked-element 块,不变);模型动作 = ARIA role+name locator(新);默认目标 = focused tab(tabId 可选)
   - **实施序列**:①search_element → ②click/fill + scroll + grant 扩展 + 高亮 → ③screenshot_page → ④返回模板 v2(Before/After) → ⑤chrome.debugger(条件触发:isTrusted 拒绝率构成实际阻断或 closed shadow DOM 真实需求;不排期)
   - **参考**:AhYi8/browser-ai-assistant(CDP 驱动,特权层不可移植;可搬=AX 行格式/噪点过滤/预算截断/受控 fill 法/遮挡检测/wait_for_state 有界轮询/fail-closed 校验——克隆在 `.slim/clonedeps/repos/AhYi8__browser-ai-assistant`,只读)
   - **验收标尺**:模型经 search→click 链完成真实登录页填字点按钮,全程零手写 JS
5. 发布:图标 + `wxt zip`。

> 已完成(2026-09-02):`err: any` → `unknown`(lib/utils.ts `getErrorMessage` helper,App/SettingsMainView/ProviderDialog 5 处收窄);dev 可观测性(content.ts 对未知 `ai-sidebar/` 消息 DEV 下 console.warn)。用户拍板不做:highlight.js 语言包裁剪(本地加载 941KB 不构成瓶颈;rehype-highlight@7 的 `languages` 选项可随时按需裁)。
>
> 已完成批次(2026-09,交接前):fetch_url 工具(`1422168`/`b7d0dd0`);**元素引用统一为 `<picked-element …/>` 块协议**(`f4f9ea3`,标记层废除);token 瘦身(`5f7d549`,块内嵌 300 字 preview → 后续收敛为 chip label,system prompt/工具描述压缩,单轮 ~17000→~500 token);兼容层删除(`1e5f5a2`,旧数据可弃);finalize 入场动画闪烁修复(`eadae82`,重估以 sessionKey 为界);流式跟底重做(`2213d61`,overflow-anchor 钉底为主);websearch 十源(`4f87b51`/`8d3e67d`);注释叙事清扫(`80145bf`)。

## 9. 环境备注

- 无残留 dev 进程;直接 `pnpm dev`(自动拉 Chrome,扩展目录 `.output/chrome-mv3-dev`)。
- **改 content.ts/消息协议/权限后必须完整重启 `pnpm dev` 并刷新页面**:sidepanel 热更新 ≠ content script 更新,旧 content script 会继续应答过期协议。
- 浏览器 local storage 里可能残留旧结构 `local:settings`(须过 `sanitizeSettings`)与 `local:sessions`(启动时 `migrateLegacySessions()` 自动迁入 IndexedDB 并删除旧 key,只迁一次)。
- 本文档与工具无关(原在 pi 中编写,已去除 pi 专属工具链说明);Windows 下注意确认 agent 实际使用的 shell,POSIX 语法按实际情况调整。
