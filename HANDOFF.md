# ai-sidebar 交接文档

> 写给下一个接手的 AI agent。本文档是当前唯一权威现状说明;根目录 `AGENTS.md` 已与本文同步。

## 0. 三句话速读

1. **UI 已全部实现,agent 运行时为 pi-agent-core,引用架构 = `<page-refs>` 元数据块(tabs)+ 消息文本内嵌 `<picked-element …/>` 自闭合块(元素引用单一表示)+ `read_page`/`read_element`/`search_element`/`search_page`/`click_element`/`fill_element`/`scroll_page`/`screenshot_page`/`open_page`/`activate_page`/`close_page`/`fetch_url`/`search_web`/`execute_js`/`compact_context`/`read_time`/`ask_user` 工具**;聊天组件在 `entrypoints/sidepanel/components/chat/`,设置组件在 `components/settings/`(提供商/搜索/权限/备份/关于五视图,以全高 Drawer 滑出),务必先做用户手动回归(见 §8)。
2. **AI 通信一律走 `@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`**(同版本 ^0.84.4),严禁手写 SSE/协议适配;会话运行时 = pi-agent-core 的 `Agent`(决策 36,每会话一实例自持转录),发送入口 `runAgentTurn()`/`continueAgentTurn()`;唯一例外是"拉模型列表"两个 GET(已在 `lib/models.ts`)。
3. 每步验收:`pnpm compile && pnpm build` 必须全绿;改 content.ts/消息协议/权限后必须完整重启 `pnpm dev` 并刷新页面(见 §9)。

## 1. 项目定位

开源 **BYOK 浏览器 AI 侧边栏扩展**(Chromium:Chrome/Edge/Brave),对标 Chrome 内置 Gemini 侧边栏,用用户自己的 API Key。`ai-sidebar` 是永久内部代号(目录/包名不改,改的只是产品名)。

**产品北极星:浏览器 Agentic 侧边栏**——从聊天助手演进为能在浏览器里自治完成多步任务的 agent。六大支柱:感知(read_page/read_element/框选→三期 search_element/screenshot/页面版本指纹)、动作(execute_js + 三期 click/fill/scroll 已落地)、自治(gate→会话级 grant 已落地)、获取(**websearch 十源 + fetch_url 已落地**)、记忆(compact_context 已落地)、底座(i18n/发布)。

- MVP(已完成,回归通过):sidePanel 聊天(流式/Markdown/工具卡片/思考折叠区/token 脚注/多会话/会话草稿/上下文占用环)+ 读取当前网页(`<page-refs>` 块 + 消息内 `<picked-element …/>` 块 + `read_page`/`read_element` 按需读取,框选元素 + vision 读图)+ BYOK 多提供商(三种协议)
- 增补批次(已完成):websearch 十源(设置页"搜索"页签,search_web 条件注册)、fetch_url(自主取回任意公开 URL)、compact_context(模型申请压缩)
- 二期(已完成):会话重命名(AI 命名 + 行内改名)、多模型快捷切换(输入框模型菜单)、**会话导出**(历史行 hover 下载 Markdown);划词快捷提问未做(backlog)
- 增补体验批次(已完成):统一删除确认 AlertDialog、设置页全高 Drawer、userScripts 强引导弹窗、模型分工卡(per-role 思考档)、全局语言偏好、新会话动态快捷指令、Base UI toast、备份页签
- 三期(规格 v2,见 §8.4):ARIA 定位与页面动作原语——search/click/fill/scroll/screenshot 五工具 + 会话级 grant + Before/After 反馈;①②③已落地,④未做

**当前位置:三期步①②③已落地且回归通过;导出反馈驱动的动作可靠性修复(click tab 变化报告/open_page 同 URL 复用/settle 隐藏短路 + 8s 看门狗)已落地并验收(见 §4/§6),质量基线 = 每批代码审查 + 构建全绿。**

**接下来(按序)**:①三期步 4(动作返回模板 v2:Before/After + 页面版本指纹,规格见 §8.4)→ ②i18n → ③发布(图标 + wxt zip)。

**以后(backlog,已拍板方向,按需启动)**:划词快捷提问;动作矩阵扩展(hover/select/submit/back/goto——实测需要再议,execute_js 逃生舱已覆盖);多标签管理(open_tab 等);记忆便签工具(新存储域,与页面动作主题无关);chrome.debugger 特权层(✅ 已启用 2026-09:scroll_page JS 链失败时 CDP Input.dispatchMouseEvent 可信滚轮兜底,lib/cdp.ts 白名单单方法 + 60s 闲置 detach,新决策 28);无 Key 搜索源新路线观察(如 Exa keyless MCP);停止按钮中断挂死工具(上游无工具超时,工具侧 signal 未消费——settle 短路 + 看门狗后基本不可达,留档)。

## 2. 技术栈与硬约定

| 项 | 约定 |
|---|---|
| 框架 | WXT 0.21 + React 19 + TypeScript,包管理 pnpm |
| 样式 | Tailwind v4(`@tailwindcss/vite`)+ shadcn/ui(new-york),token 在 `sidepanel/style.css` |
| 深浅色 | 自动跟随系统(`sidepanel/theme.ts` 渲染前切 `.dark`) |
| 加 shadcn 组件 | `pnpm dlx shadcn@latest add <name> -y -o`;已装:alert-dialog/badge/button/checkbox/dialog/drawer/dropdown-menu/input/label/scroll-area/select/separator/switch/textarea/tooltip/toast;**`components/ui/` 保持官方原样,严禁自定义组件/样式/变体** |
| 抽屉 | 设置页 = 全高 Drawer(vaul ^1.1.2,93dvh,聊天常驻挂载);删确认 = AlertDialog(会话/提供商) |
| AI 请求 | **`@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`**(见 §6/§7),sidepanel 直连,BYOK |
| 存储 | 设置/API Key → chrome.storage.local(`local:settings`);会话历史+草稿 → **IndexedDB JSONL 记录**(`lib/sessionStore.ts` 库 `ai-sidebar-sessions` v1 单 store + `lib/sessionRecord.ts` 序列化,决策 38 零旧版兼容);activeSessionId → chrome.storage.local;UI 共享状态 → **zustand v5 单 store 五切片**(`entrypoints/sidepanel/store/`:gate/error/session/settings/chat;devtools 仅 DEV 构建),**显式 IndexedDB 持久化,不用 persist 中间件**(persist 会退化草稿防抖写序与非破坏压缩精细写序);消息按 pi 消息联合形状持久化 |
| 页面引用 | **元素引用单一表示 = 自闭合 `<picked-element elementId tabId selector tagName label />` 块**,草稿(TipTap 原子徽章节点)/存储消息/LLM 视图三处同串(属性值经 `&quot;` 转义);`<page-refs>{JSON}</page-refs>` 块仅承载 tabs 元数据(LLM 视图剥 elements 留 tabs,存储层保留供 UI chip 查表),两块皆在发送时序列化进 user content 此后不可变(`lib/pageRefs.ts`);元素内容按需经 `read_element`(块属性 tabId+selector 即句柄)获取 |
| manifest 权限 | `storage` / `sidePanel` / `unlimitedStorage` / `scripting` / `activeTab` / `userScripts` + host_permissions **`<all_urls>`**(截图 captureVisibleTab 硬要求,Chrome 只认 <all_urls>/activeTab;content_scripts 的 http/https 宿主访问随安装授予);`minimum_chrome_version: "135"`(userScripts.execute 门槛;Chrome 138+ 需用户在扩展详情页开启 Allow User Scripts,无 API 可代开仅能引导) |
| Markdown | react-markdown + remark-gfm + **shiki**(github-light/github-dark 双主题 CSS 变量跟随 .dark,`lib/shiki.ts` 懒初始化;决策 40 ⑤。旧 rehype-highlight + highlight.js 已移除)。**✅ 已修 `5ae17e2`(P1-1,待用户目视)**::shiki 默认引擎是 Oniguruma **WASM**(`bundle-full.mjs:21`),而 MV3 扩展页默认 CSP `script-src 'self'` **禁用 WASM 代码生成**(Chrome 官方文档要求显式加 `'wasm-unsafe-eval'`)且本项目 manifest 无 CSP 字段 → `createHighlighter` 被拒 → `lib/shiki.ts` 的 catch 静默降级,**代码高亮实际从未生效**(亮色下变得可读是因为 `--code-background` 底色 token 被修)。修法二选一待拍板:①manifest 加 `content_security_policy.extension_pages = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"`(保留完整 Onig 语法保真度,但拓宽 CSP);②改用 `createJavaScriptRegexEngine`(零 CSP 改动、零权限面,部分语法保真度略降) |
| 路径别名 | `@/*` → 项目根 |
| Shell | Windows 环境;编写多命令/shell 片段时先确认实际使用的 shell 类型(POSIX vs PowerShell),语法按实际情况调整 |
| 密钥 | 只存 `chrome.storage.local`;不打印/不提交任何 API Key |
| 模型可见文本 | **一律英文**(Model-facing text):工具 description/参数 description、返回模板与截断标注、错误分支文本、非 vision 图片描述、system prompt 全文;UI 显示文案(TOOL_LABELS 中文值、ToolCallCard 等)保持中文,以后收敛 i18n(REASONING_LEVEL_LABELS 已是唯一标签源,i18n-ready) |
| 语言偏好 | `Settings.language`(BCP-47,null = 自动→浏览器语言):注入 system prompt/标题/快捷指令生成;12 语言白名单 + 非白名单 tag 直传(lib/language.ts);用户消息明确要求其它语言时以用户为准 |

## 3. 用户已拍板的决策(按时间序,勿推翻)

1. **提供商不搞预设列表**(旧的 DeepSeek/OpenRouter 预设已废弃)。多提供商管理,每个提供商独立配置。
2. 每个提供商选择接口协议 `api` 三选一,UI 命名:**OpenAI 兼容 · Chat Completions / OpenAI 兼容 · Responses / Anthropic Messages**(`openai-completions` / `openai-responses` / `anthropic-messages`);**anthropic baseUrl 按裸域名约定**(SDK 路径自带 /v1),`normalizeBaseUrl` 剥用户多填的尾部 `/v1`。
3. 支持从端点**拉取模型列表**、**测试连接**(复用拉取)、**手动添加模型**;每个模型可配参数:上下文窗口 / 最大输出 / 工具调用 / 图像识别 / 推理。
4. 模型参数用 **models.dev 自动预填**(`api.json` 免费无鉴权),不覆盖用户手填值,查不到留空。
5. **AI 请求用 `@earendil-works/pi-ai` + pi-agent-core**,不手写 SSE(曾实现过 `lib/stream.ts`/`lib/ai.ts`,均已删除)。
6. **设置页 = 全高 Drawer(vaul)覆盖在常驻聊天上**(最初为整页视图切换,2026-09 改 Drawer):点 Header 齿轮滑出(93dvh,顶部露聊天 Header 条),返回箭头/Escape/下滑把手/点遮罩四路关闭;内部五视图:提供商/搜索/权限/备份/关于(Header 内 Segmented 切换,无 Tabs 组件);添加/编辑提供商 = **ProviderDialog 弹窗**(非整页 DetailView);拉取模型 = 弹窗内联勾选导入区(非独立 FetchModelsDialog)+ 独立「同步」按钮(models.dev 补全已有模型参数)。
7. **历史会话 = Header 内 DropdownMenu**(非 Dialog);页面上下文**默认开启**,引用 chip 在 Composer 上方管理;模型/思考等级切换在 Composer 内;Composer 工具栏 `[+ ▾]` = 框选元素/引用页面统一入口;tab chip 带元素 DropdownMenu。
8. **UI 禁用紫色/violet,一律 shadcn 默认中性样式**;严禁自定义组件/样式/变体(button.tsx 曾被加 xs/icon-xs,已重置;`components/ui/` 必须保持官方原样)。
9. **UI 设计变更先与用户确认设计再实现**(§5 保留早期设计稿仅作历史参考,实际实现以代码为准)。
10. **agent 编排用 pi-agent-core**(`Agent` + `streamSimple`),页面操作工具自研(AgentTool);三期规格 v2 = ARIA 定位与页面动作原语(见 §8.4),chrome.debugger 仅条件触发、不排期。
11. 聊天页功能基线(回归清单,不可丢):流式输出、停止按钮(取消保留已生成部分)、Enter 发送/Shift+Enter 换行/IME 组合词不误发、历史会话切换/删除/新建、消息复制、自动滚动(用户上翻不打断)、错误/取消的 UI 呈现、工具调用卡片、思考折叠区、token 脚注、会话草稿。
12. **引用架构定稿 = `<page-refs>` 块**:引用元数据发送时序列化进 user 消息 content,此后永不改变;无 refSnapshot 字段、无 convertToLlm、system prompt 不注入引用目录(只放协议常量规则);`ChatMessage` 回归纯 pi 联合,零自定义字段。
13. **会话草稿**:`Session.draft { input, refTabs, pickedElements }` 随会话持久化(IndexedDB 防抖落盘);当前页以「动态芯片」自动引用(随焦点更新、透明可移除——决策 26);空会话离开即回收;发送即清空草稿。
14. **工具安全边界 = tab 级白名单**(tabId ∈ 草稿引用 ∪ 历史 `<page-refs>` 块);selector 不设白名单(框选元素是提示,AI 可在引用页内自行探索);vision 门控:`model.input` 含 image 才产 ImageContent 块;工具中文文案单一来源 `TOOL_LABELS`(读取网页内容/读取页面元素)。
15. **工具命名规范 = `<动词>_<域词>`**:动词集 {read, search, fetch, click, fill, scroll, screenshot, execute, ask, open} × 域词集 {page, element, url, web, js, user, time},新工具只许集合内组合(`extract_page` 已改名 `read_page`;`TOOL_LABELS` 保留旧 key extract_page 兼容历史会话 ToolCallCard)。协议字符串已随名同步(`ai-sidebar/read-page` 等,常量单一来源 lib/types.ts,content.ts 只 import 纯常量)。
16. **模型可见文本一律英文**(Model-facing text):工具 description/参数 description、返回模板与截断标注、错误分支文本、非 vision 图片描述、system prompt 全文;UI 显示文案保持中文(TOOL_LABELS 中文值、ToolCallCard 等),以后收敛 i18n。
17. **工具门控契约 = `lib/gate.ts`**:`GateRequest`(confirm 弹卡 / ask 提问)+ `setGateHandler`(App 注册 UI 处理器;**未注册时门控请求快速 deny/cancelled,安全默认**)、`flushPendingGates`(停止/中止生成时冲销 pending)、`requestGate`(handler 抛异常按 deny);`createGatedTool(tool, summary, detail?, detailFromArgs?)` 为 confirm 路径包装,detail 支持按调用参数动态生成(`detailFromArgs(args): string`,空串回退静态 detail,execute_js 用它预览待执行代码),denied 返回英文 "User denied permission to run this tool."(正常 tool result,模型可继续);ask_user 走 ask 路径,挂起阻塞工具循环属预期(无超时)。
18. **execute_js = userScripts.execute 主路线 + scripting MAIN world 兜底**(`lib/pageScripting.ts`):Chrome 135+ 才有 `chrome.userScripts.execute`(manifest 已设 `minimum_chrome_version: "135"`);Chrome 138+ 需用户在扩展详情页开启 **Allow User Scripts**(未开时命名空间缺失或 getScripts() throw);userScripts 不可用时降级 `scripting.executeScript` MAIN world(func 包装 eval,严格 CSP 站点会失败),降级在返回文本里注明、全链失败返回可行动英文错误文本;结果 JSON.stringify 后截断 8000 字符;一切错误转英文文本不 throw。
19. **元素引用 = 单一表示 `<picked-element …/>` 块**(标记协议 [element:N]/[元素:N] 已废除):块在消息文本内**原位**承载引用,草稿/存储/LLM 三处同串零转换;块属性 = elementId(1 起单调递增,随草稿持久化)+ tabId/selector/tagName/label(内容预览截断 ~24 视觉单位,`lib/elementLabel.ts`);LLM 请求副本仅把 refs 块剥 elements 留 tabs(`agent.ts toLlmMessage`);兼容层已删——normalizePickedElements/旧双正则/旧草稿转换全移除,**旧格式元素丢弃、旧标记按裸文本显示**(dev 阶段未发布,数据可弃;发布前如需兼容再补)。
20. **websearch 十源 + fetch_url**:源集 = duckduckgo/searxng(免费)/brave/tavily/bocha/serper/exa/zhipu/metaso(API Key)/bing(无 Key HTML 抓取,稳定性不保证),设置页"搜索"页签配置,`search_web` 仅在源可用时注册(守卫单一来源 `isWebSearchConfigured`);统一结果形状 `{title,url,snippet}[]`,错误前缀 `search_failed:`/`not_configured:`;`fetch_url` = sidepanel 直连 GET + Readability 提取(与 content.ts 同库),**私有/内网地址拒绝且重定向复检**(防提示注入探测内网),2MB/12000 字上限,错误前缀 `fetch_failed:`/`http_error:`/`not_html:`/`too_large:`/`extract_failed:`。
21. **search_element 寻址 = 默认 focused tab,tabId 可选,不设 tab 白名单**(2026-09,三期步①):自动化任务可能不给引用,静默读的暴露面仅交互元素名(role+可访问名称+状态),可接受;read_page/read_element 的 tab 级白名单不变;发现层自此确立 focused tab 默认,步② click/fill 寻址延续此拍板。
22. **步②会话级 grant = 工具+tab 粒度,生命周期 = 侧边栏面板**(2026-09,三期步②):切对话/新建对话不清除,关面板即失效;确认卡文案「暂时允许对当前页执行…/关面板后恢复询问」+勾选后「允许并记住」;gate.ts 模块级 grantedScopes 短路(命中直接 approved 不弹卡,应答带 grant 记录);execute_js 永不可 grant。
23. **动作遮挡 = fallback 直接在元素上派发事件序列并注明**(2026-09,三期步②):scrollIntoView 居中重试仍被遮挡时不中断动作链,结果注记被何元素遮挡;untrusted 合成事件,chrome.debugger 特权层已启用(仅滚动兜底,见决策 28)。
24. **search_element query 支持单串或数组 OR**(2026-09):role/可访问名称大小写不敏感子串,任一命中即保留,过滤先于 80 条预算;截断注记引导用 query;定位/验证元素优先用 search_element 而非 execute_js(描述双向引导)。
25. **权限架构 = 全部随安装授予,无运行时授权流程**(2026-09,步③;曾实施 optional_host_permissions+request/remove 后回退——content_scripts 关联 origins 本就随安装授予,运行时授权只门槛截图且安装警告无差异):host **`<all_urls>`** 为 screenshot_page(captureVisibleTab)硬要求;设置「权限」页签 = 透明说明(网页访问/6 项安装权限用途 + userScripts 开关状态检测与直达详情页引导——Chrome 无 API 可代开)。
26. **引用组 = 随焦点切换的工作集**(2026-09,取代隐式注意力注入与累积式自动芯片;借鉴 Gemini 标签页组模型适配 agent):每个 tab 记住其所属引用组快照(refTabs+pickedElements,面板生命周期);焦点切换即恢复该 tab 所属组;**未分组页 = 隐式「当前页」芯片自动跟随焦点**(单例,切页即更新);用户手动添加引用才固定为一组(加/删引用即改当前组并同步组内成员);refs 块 focused 标记发送时刻活动 tab;总开关关闭冻结切换。
27. **agent 开启 tab 的运行时注册表**(2026-09,③⑤):open_page 开出的 tabId 注册进 agentOpenedTabs(面板生命周期,内存态);read_page/read_element/execute_js 的白名单 = 草稿引用 ∪ 历史 refs 块 ∪ 本注册表三源合并;tab 关闭残留条目无害(读 closed tab 走可行动错误文本)。
28. **统一删除确认 = AlertDialog**(2026-09):会话(header 下拉)与提供商(设置卡)删除一律弹 AlertDialog 二次确认(目标名 + 不可撤销警示 + destructive 按钮);引用芯片 X(低风险)与 close_page 工具(已是 gate 卡)不变。
29. **userScripts 强引导**(2026-09):面板启动 + focus/visibilitychange/1.5s 轮询检测 isUserScriptsAvailable(),未开启弹强引导 AlertDialog(Esc/遮罩拦截,主按钮直达详情页,开启后自动闭环);「暂时跳过」仅本次面板会话;execute_js 的 scripting 兜底保留(AI 能力不倒退);权限页签文案如实标注「面板启动时会引导开启;未开启时自动降级执行」。
30. **模型分工卡 + per-role 思考档**(2026-09):设置提供商视图顶部「模型分工」卡三行(对话/标题生成/快捷指令生成),每行 = 模型 Select + 思考 Select 并排;辅助模型 null = 跟随对话模型(resolveAuxModel,引用失效同样回退);titleThinking/quickPromptThinking 独立配置(旧共享 auxThinking 由 sanitize 迁移);对话模型思考框与输入框选择器同字段双向同步,选项按模型能力过滤;下拉按提供商 SelectGroup 分组。
31. **全局语言偏好**(2026-09):`Settings.language`(BCP-47,null = 自动→浏览器语言)注入 system prompt/标题/快捷指令生成三处;用户消息明确要求其它语言时以用户为准;12 语言白名单(lib/language.ts)。
32. **新会话快捷指令 = 辅助模型动态生成**(2026-09):空会话按聚焦页 title/url 生成 4 条(JSON 输出 + 形状校验),失败静默回退静态四条(lib/quickPrompts FALLBACK_PROMPTS);同 URL 内存缓存(空态期间),「换一批」绕过;聚焦 tab 导航/切换自动重生成;非 http(s) 页( chrome://、新标签页)整区块隐藏;无任何可用模型不生成。
33. **会话导出 = Markdown**(2026-09):历史行 hover 下载(lib/sessionExport);正文平铺,思考/工具调用收 <details> 折叠,引用页面聚合清单,picked-element 转可读行,工具结果截 1500 字,assistant 消息标注 provider/model;consumed 集合去重(结果不双渲染)。
34. **动作可靠性三件套**(2026-09,导出反馈驱动):①click_element 结果带 tab 变化报告(动作前后快照对比:新开 tab/焦点切换,附可读化路径);②open_page 同 URL 复用(hash 不敏感:激活现存 tab + 注册可读,确认卡标「复用」,不再开重复页);③隐藏 tab 的 rAF 完全暂停(不是节流)曾致 settle 永久挂死——content 侧 settle 尾帧与 visibilitychange 竞速短路 + sidepanel 8s 看门狗降级成功(动作已派发一次绝不重发;reject+URL 变化 = 导航守卫,不在新页面重跑动作)。
35. **CDP 特权层 = 滚动可信输入兜底**(2026-09,`lib/cdp.ts`):scroll_page 的 JS 链(主滚动/容器探测/合成 wheel)全部无位移时才 attach chrome.debugger,`Input.dispatchMouseEvent(mouseWheel)` 派发可信滚轮(同时驱动原生滚动与滚动劫持监听,Playwright 底层同机制);**白名单仅此一个 CDP 方法**;按需 attach + 60s 闲置自动 detach,不留常驻附加;attach 失败(浏览器内页/DevTools 占用)静默回退并注明;`debugger` 权限随安装授予,权限页签文案已注明。
36. **会话运行时直接采用 pi-agent-core 的 Agent**(2026-09,拍板;取代自研 SessionRuntime):调查确认 `@earendil-works/pi-agent-core` 的 `Agent` 本身就是会话运行时——`state{systemPrompt,model,thinkingLevel,tools,messages,isStreaming,streamingMessage,pendingToolCalls,errorMessage}` + `prompt()/continue()/steer()/followUp()/clearSteeringQueue()/clearFollowUpQueue()/hasQueuedMessages()/steeringMode/followUpMode/abort()/signal/waitForIdle()/subscribe()/reset()` + `convertToLlm`/`transformContext`/`sessionId`/`toolExecution` 选项。pi-coding-agent 的 AgentSession 只是在其上加持久化/扩展/压缩/重试。**迁移计划**(分步可提交):①`lib/agent.ts` 会话 Agent 工厂(✅ 已完成 2026-09 `db6db42`:`buildAgentInputs` + `ensureSessionAgent` 每会话一实例、复用轮刷新 streamFunction/tools/systemPrompt/model;`runAgentTurn` 对外签名不变、仍以调用方 history 覆盖 `state.messages`——行为等价于重建;`disposeSessionAgent` 接入会话删除)→ ②**Agent 自持转录**(✅ 已完成 2026-09 `98f685b`:`ensureSessionAgent` 存**原始转录** + `convertToLlm: toLlmMessage` 请求时展开;`RunAgentOptions.history` 可选(提供=覆盖:首次初始化/编辑重发截断/恢复导入;省略=用 Agent 自持),`hasSessionAgent()` 供调用方判定;压缩改 `transformContext` 裁剪(非破坏,不动转录)+ 压缩后 `disposeSessionAgent` 下次以最新 store 重建;finalize 直接落 `result.messages`;工具白名单 = Agent 转录 ∪ 当前草稿 refs ∪ openedTabs;恢复/导入 `disposeAllSessionAgents/disposeAllRuntimes`、空会话回收同步释放)→ ③队列改用 `agent.followUp/steer`(**✅ 已完成 2026-09**:入队即 `agent.followUp`(构造完整 user 消息含 refs 块)、store 仅存展示镜像(按对象身份在 message_end 移除)、空闲窗口 `continueAgentTurn` 消费、stop→`clearAllQueues`、followUpMode 显式 one-at-a-time;前置 2026-09:continue 泵 + newMessages 累加 `58558fb`、每轮工具重建 `prepareNextTurn` `5a106a4`、31 测试;核实限制:prepareNextTurn 在 followUp 注入**之前**调用(agent-loop.js:90 vs :112)→ queued 消息的 refs 白名单滞后一轮,tabs 由入队保留的草稿 refTabs 兜底、**elements 需入队时预聚合**;**剩余**:生产入队改 followUp、UI 只读镜像、逐条删除受控适配、stop→clearAllQueues、followUpMode 显式 one-at-a-time;pi 语义:steer = 当前 assistant turn 结束后注入、**不等于 abort**,停止按钮仍是显式 abort)→ ④**精简 `lib/sessionRuntime.ts`**(✅ 已完成 2026-09):实测**不能整体删除**——它是 React 的 UI 投影层(Agent 事件 → 可渲染快照,经 sink 同步 store.runs)+ 同步发送锁 + turn 所有权守卫;Agent 只提供事件流与 state(上游 TUI 直消费事件,无 React 快照层)。已删除的是**队列骨架死代码**(followUp/steer/shiftPending/pendingMessageCount/clearPending——队列归 Agent 原生持有)。**收益**:删掉流式循环/事件桥接/节流/in-flight/所有权守卫等自研代码,行为与 pi 一致。
37. **sidebar 不需要回溯/分支/fork;JSONL 保留线性 id/parentId**(2026-09,目标 mttk9xo5 论证;用户已拍板采纳):pi-coding-agent 的 `/tree`(树形回溯并分支)、`/fork`(从历史消息建新会话)、`/clone`(复制活动分支)面向**探索式编码工作流**;sidebar 是“随手问/页面辅助”场景——①「改了再问」高频需求已由**编辑重发**(截断该消息之后+重发,丢弃旧分支)覆盖;②「另起话题」由**新建会话**覆盖;③「保留两条分支做对比」无对应 sidebar 工作流;④ JSONL 会话记录仍保留 `id/parentId` **线性**结构——与 pi 格式一致、零交互成本、未来若要分支数据已就绪(编辑重发后 parentId 重连即可)。**边界**:不做分支/fork/clone 的 UI 与交互(目标 Out scope)。
38. **开发阶段零旧版兼容**(2026-09,用户拍板「所有东西不做任何旧版兼容,直接重构」;**该拍板推翻了目标 mttk9xo5 原成功标准中「旧 IndexedDB 数据自动迁移、零丢失、迁移前后逐一比对」一项**——迁移链不再存在,比对证据无从谈起,旧会话数据按用户决定直接丢弃):删除全部旧格式迁移链——`local:sessions` 旧 key 步骤、对象 store→v2 迁移、格式 flag、`migrateAllSessions`/`migrateSessionToJsonl`、sanitize 的旧扁平消息/refSnapshot/共享 auxThinking 分支。会话存储 = 全新 IndexedDB 库 `ai-sidebar-sessions` v1 单 store(JSONL 行);`sanitizeSessions` 只保留防御清洗(非法形状丢弃、pi 形状透传);WebDAV bundle 仍 `Session[]` 形状天然兼容。**代价如实**:旧会话数据不带过来(开发阶段可接受,回归用新数据)。
39. **压缩预算随窗口自适应**(2026-09,回归发现 8k 模型压缩永报 Nothing to compact):固定 keepRecentTokens=12000 在小窗口下切点永远落在首条(可压缩前缀恒空)。`runCompact` 改:保留预算 = min(12000, 窗口×15%) 下限 2000;摘要输入序列化截断至窗口 45%(头部截+显式标注);生成上限加窗口 35% 约束。pi 固定值假设大窗口,BYOK 小模型必须本地化(语义不变:历史太小不值得压缩仍报 Nothing to compact)。
40. **聊天视觉改版**(2026-09,用户验收驱动,全走官方语义):①AI 回复**去气泡平铺**(官方 `MessageContent`,主流 agent 形态;错误气泡 destructive 保留);②**头像行在内容上方**(垂直布局;官方 `self-end` 与 Nova `-translate-y-8` 是水平布局残留,消费处 className `self-start min-w-6` 经 tailwind-merge 去重覆盖);③用户气泡 `Bubble variant="secondary"`(亮浅灰/暗深灰;内嵌 chip 前景层级换算为 foreground 系);④**亮色 `--primary` 调柔** oklch 0.205→0.4(主题层,所有 default 按钮同步变中灰;暗色不动——官方 primary 翻转在亮色聊天面过硬);⑤**代码块换 shiki**(VS Code 引擎,github-light/github-dark 双主题 `--shiki-*` 变量跟随 `.dark`;`lib/shiki.ts` 模块级懒初始化 + 同步访问 + 就绪订阅重渲染,未就绪/未知语言降级纯文本;`--code-background` 补亮色浅灰值;产物 12.5MB 全懒加载 chunk 主包不变);⑥**composer 四层堆叠**(自上而下:推荐 chips 轻量文本 → 队列卡 → 引用栏 → 输入框;卡片族同构 `rounded-t-lg border-b-0 bg-muted/40`+官方 Badge 列表行,下层 `-mt-2` 压上层、z 0/10/20,输入框位置永不动;引用卡半透明叠压发黑 → `color-mix` 实色等效修)。设置页:新增**外观 tab**(`Settings.appearance` system/light/dark,theme.ts 双轨 + settingsSlice 全链路应用)、**删权限 tab**(视图文件删,lib/permissions.ts 留引导弹窗用)、**Toast z-60**(style.css 覆盖,浮于全高 Drawer)。队列卡折叠与引用栏同构(默认收起,grid-rows 动画,composer.expandQueue/collapseQueue 双语 key)。

41. **工具面可靠性批次**(2026-09,依据用户导出的真实对话记录逐条坐实):①**`activate_page`/`close_page` 从未接线**(`a8b2bda` 只加了文件与 pageContext 支持、提交里没有注册表;全历史 `git log -S` 零引用)→ agent 实际没有关/切标签页的能力,真机表现=自己开的重复页关不掉、只能请用户 Ctrl+W、后台标签永远截不到图;两者接入动作组,并新增 `tests/tool-registry.test.ts` 断言文档宣称的工具面全部在册(回退接线该测试会打印真实工具面并失败);②**`read_page` 过薄自动重试**(前端渲染页首次常只剩骨架:模型当时自己睡 8 秒再读)→ 工具层有界重试 1.2s/2.5s 并注明;`waitStableMs/waitText` 仍在,描述同步改写;③**长文可续读**(12000 字符截断此前是死路,真机=“公式处截断、附录没读到”)→ content 侧接受 `offset` 并回报 `totalLength`,截断时工具给出可直接照用的下一次调用;窗口算法与文案在 `lib/pageTextWindow.ts`(纯函数,单测);④**后台标签截图走 CDP**(`captureVisibleTab` 只能截活动标签,旧实现靠“静默激活”绕开=抢用户前台)→ 非活动标签改走 CDP `Page.captureScreenshot`(只读命令,不抢焦点),debugger 不可用时才降级激活;CDP 白名单收敛为单一导出常量 `CDP_ALLOWED_METHODS`;⑤**click 开出的新标签页登记为 agent-opened**(此前只有 `open_page` 登记 → 模型点搜索结果链接开出的页**自己既读不了也关不掉**)→ `describeTabChanges` 返回 `{note, openedTabIds}` 并顺带登记(close_page 仍需确认卡,安全边界不变);⑥`fetch_url` 描述明示“纯 GET:JS 渲染页基本取不到,请改走 open_page + read_page”。**注**:content.ts 协议新增 `offset` 字段,生效需完整重启 dev + 刷新页面。

42. **流式渲染性能**(2026-09,用户报「AI 回复时 UI 全卡、帧率下降,不回复时正常」):三个成本叠在热路径上——①`MessageItem` 内 `useSmoothText` 是 **rAF ~60fps** 逐字揭示循环 → 每帧用新文本重解析整棵 markdown;②`highlightToHtml` **零缓存** → 每个代码块每帧重新 shiki 分词(对块长度 O(n²));③`MessageItem` **未 memo** 而 store 流式期每 50ms flush 一次 → 列表每条消息全量重渲染(每条还急切跑 `messageText()`)。另有 `App` 的 `onEditResend` 是内联箭头函数 → 即便加 memo 也会被击穿。**修法**:`memo(MessageItem)`;App 用 latest-ref 包裹 edit-resend(身份永久稳定、无失效风险);shiki 结果 **300 条 FIFO 缓存** + `shikiStats` 计数;**逐字揭示期间不做高亮**(`MarkdownView highlight` 开关),回复定型时一次性着色——**取舍**:代码块在流式期间显示为纯文本,回复结束才上色(若用户更看重边说边着色,可改回只靠缓存兜)。**验证手段**:DEV 每 2s 打印 `[perf] 流式 2s 压力 {items, rendersIn2s, shikiCalls, shikiHits, shikiMs}`,预期 `rendersIn2s` 只随单个 live 项走、揭示期 `shikiCalls≈0`。

43. **官方 questionnaire 的 44px 触控尺寸撑爆 ask_user 卡**(2026-09,用户报「提问面板被拉长、控件都变高」):官方 `components/ui/questionnaire.tsx`(`f8067c7` 引入)在 Choice/Input/Actions/Skip/Submit **5 处写死 `min-h-11`**(移动端触控规范),部分配 `sm:min-h-0` 但 **Tailwind `sm`=640px、侧边栏仅 320-400px → 永不生效**;调用处传的 `h-6.5`(26px)在盒模型里**被 min-height 压过** → 控件全变 44px。另 `.cn-questionnaire-title` 在“标题无 description 兄弟节点”时注入 `mb-4`(本场景恒成立),叠加 item `gap-4` → 标题下 32px 空白。**修法**(只在使用处 `ApprovalSection.tsx`,官方组件零改动):`min-h-0` 恢复 26-30px、标题 `!mb-0` + `max-h-24 overflow-y-auto` 限高内滚、间距收 10px 与 confirm 卡一致;confirm 卡长摘要同样限高防拉伸。**教训**:`min-h-*`/`sm:` 这类组件内建约束在窄侧边栏里必须在使用处显式解除——`sm:` 前缀在此尺寸下等于“永不生效”。

## 4. 当前代码状态

lib 层 + sidepanel 全部 UI 已完成(含 picked-element 块协议、read_element/框选、vision 读图、websearch 十源、fetch_url、compact_context、三期步①②③、设置抽屉/引导弹窗/模型分工/语言/导出);最新提交见 `git log`(本文档与 2026-09 同步)。

| 文件 | 状态 | 说明 |
|---|---|---|
| `lib/types.ts` | ✅ 完成 | `ApiType`/`ModelConfig`(含 `reasoningLevels`)/`ReasoningLevel`(`REASONING_LEVELS`/`REASONING_LEVEL_LABELS`,i18n-ready 唯一标签源)/`AuxThinkingLevel`+`AUX_THINKING_LEVELS`/`TOOL_LABELS`+`toolLabel`(中文单一来源)/`WebSearchProvider`+`WebSearchConfig`/`Settings`(含 `language`+`reasoningLevel`+`appearance`(system/light/dark,`APPEARANCE_MODES`)+`titleThinking`/`quickPromptThinking`+`webSearch`)/`AuxModelRef`(辅助模型引用,null = 跟随对话模型)/`RefTabMeta`/`RefElementMeta`(id/tabId/selector/tagName/preview)/`PageRefs`/`ChatMessage`(纯 pi 联合)/`SessionDraft`/`Session`(含 draft+compaction)/`PickedElement`(含 elementId)/消息协议常量单一来源 |
| `lib/providers.ts` | ✅ 完成 | `API_TYPE_OPTIONS`(三协议+默认 baseUrl)、`normalizeBaseUrl`(anthropic 剥尾 /v1)、`apiTypeLabel`、`createProviderDraft`、`findActiveModel`、`resolveAuxModel`(辅助模型解析,null/失效回退对话模型)、`getModelReasoningLevels`(空回退 low/medium/high)、`resolveReasoningLevel`、`DEFAULT_SETTINGS`(含 language/appearance/titleThinking/quickPromptThinking 默认) |
| `lib/storage.ts` | ✅ 完成 | `settingsItem`/`activeSessionIdItem` + `sanitizeSettings`(含 `sanitizeWebSearch`/`sanitizeAuxModelRef`/`sanitizeAppearance`/语言与思考档校验)/`sanitizeSessions`(**纯防御清洗**,决策 38:非法形状丢弃、pi 形状原样透传)+ `uid/createSession(含 draft)/createUserMessage(text, refs?)/messageText/titleFromText/EMPTY_USAGE`;sanitizeDraft 丢弃无 elementId 的结构元素 |
| `lib/sessionRecord.ts` | ✅ 完成 | JSONL 会话记录格式层(对齐 pi session-format v3 线性链):header/compaction/消息/标题/草稿 entry 类型,`sessionToJsonl`(幂等序列化,compaction 摘要按 summaryTimestamp 转 compaction entry 只认第一条)/`jsonlToSession`(解析重建,摘要=content+summaryTimestamp+firstKeptEntryId 消费键保留)/`SESSION_RECORD_VERSION`;格式文档 `docs/session-jsonl-format.md` |
| `lib/sessionStore.ts` | ✅ 完成 | 会话历史唯一读写层(IndexedDB,`idb` 封装,库 `ai-sidebar-sessions` v1 单 store `sessions`,JSONL 文本行 + 冗余 updatedAt 排序列):`listSessions`(逐行容错跳坏行,按 updatedAt 降序)/`saveSession`/`deleteSession`/`replaceAllSessions`(WebDAV 恢复,单事务 clear+put);**零迁移链**(决策 38);消费方面对 Session 对象,序列化封在本层。**测试边界(诚实记账)**:格式层 `sessionRecord` 有 5 个 node 测试(往返/幂等/fail-fast),但**本层 IndexedDB 读写路径零自动化覆盖**(无测试 import `sessionStore`,不碰 IndexedDB)——行读写/坏行跳过/`replaceAllSessions` 原子性/草稿覆盖式落盘仅靠 `docs/regression-jsonl.md` A 组手动验证;若要降级为自动化需引入 `fake-indexeddb`(devDependency,待用户拍板)。切勿把格式层测试当作存储层已验 |
| `lib/sessionRuntime.ts` | ✅ 完成 | React UI 投影层(决策 36 ④,非 Agent 替代品):Agent 事件→可渲染快照(`bridgeAgentEvent` 常驻订阅经 sink 同步 `store.runs[sessionId]`,流式 50ms 节流)+ 同步发送锁(`tryAcquireSendLock`)+ turn 所有权守卫(`isOwner(seq)` 旧 run 迟到事件丢弃);`disposeRuntime`/`disposeAllRuntimes`/`activeRuntimeSessionIds` |
| `lib/pageRefs.ts` | ✅ 完成 | `<page-refs>` 块纯函数:`renderPageRefsBlock`(序列化拼进 user content;elements 含 id/preview)/`parsePageRefs`(UI 解析渲染,旧消息无 id 按数组序补齐)/`stripPageRefs`(展示时剥块)/`collectPageRefs`(聚合历史块引用,做工具白名单);`ELEMENT_PREVIEW_LIMIT` 常量 |
| `lib/agent.ts` | ✅ 完成 | pi-agent-core 桥接(决策 36):**会话 Agent 工厂** `ensureSessionAgent`(每会话一实例 Map 持有,长期存活支持多会话并发;自持原始转录 + `convertToLlm: toLlmMessage` 请求展开 + `transformContext` 压缩裁剪 + `prepareNextTurn` 每轮工具重建;`followUpMode/steeringMode: one-at-a-time`);常驻订阅 `setAgentEventSink` 事件→投影层;`runAgentTurn()`/`continueAgentTurn()`(发送/队列泵内核,白名单=Agent 转录∪草稿∪openedTabs;**LLM 请求副本 `toLlmMessage` 剥 elements 留 tabs**)、`sessionAgentFor`/`hasSessionAgent`/`disposeSessionAgent`/`disposeAllSessionAgents`、`toPiModel`、`buildSystemPrompt()`;工具工厂已全部移至 `lib/tools/` |
| `lib/shiki.ts` | ✅ 完成 | 代码高亮引擎单例(决策 40 ⑤):模块级后台 `import('shiki')` 懒初始化(29 语言+github-light/dark 全 code-split),`highlightToHtml` 同步双主题 CSS 变量输出(未就绪/未知语言 null 降级),`onShikiReady` 订阅重渲染,`normalizeShikiLang` 别名归一;消费方 `MarkdownView` |
| `lib/models.ts` | ✅ 完成 | `fetchProviderModels`(openai 兼容 Bearer / anthropic x-api-key+version,路径 openai=`/models`、anthropic=`/v1/models`)、`fetchModelsDevMeta`、`applyModelMeta`、`syncModelsWithModelsDev`(「同步」按钮:为已有模型补全参数)、`testConnection` |
| `lib/pageContext.ts` | ✅ 完成 | tab 级读取原语(仅读取,不含工具工厂):`getActiveTabMeta`/`getTabMeta`/`listCandidateTabs`/`findTabByUrl`(hash 不敏感,open_page 复用)/`extractFromTab`/`renderPageContext`(content.ts 截 12000 字,本层透传);框选与元素解析:`startPickElement`(`ai-sidebar/pick-element`)、`resolveElement`(复用 `ai-sidebar/pick-element` + `action:'resolve'`,返回 outerHTML+truncated+preview+images+dpr);交互元素发现:`searchElementsInTab`(`ai-sidebar/search-element`,search_element 底层,无 content script 时补注入重试一次)+ 类型;页面动作原语:`performPageAction`(`ai-sidebar/page-action`,resolve/click/fill/scroll,http 守卫+**8s 看门狗竞速(超时/reject 分流:URL 变化 = 导航降级成功绝不重发;未变 = 补注入重试)**)+ `ActionLocator`/`ResolvedActionElement`/`PageActionResult` 类型;tab 变化报告:`snapshotTabs`/`describeTabChanges`(click_element 前后对比,新开 tab/焦点切换注记);引用对账:`liveTabIds()`(现存 tab id 集,**查询失败返回 null 而非空集**,供草稿僵尸引用清理用);可读性错误:`buildUnreadableTabError`(read_page/read_element/execute_js 共用:非数字/tab 已关闭/存在但不在可读集三分支,可行动文本,noun 参数区分 readable/executable);agent 开启注册表:`openTab`/`registerAgentOpenedTab`/`getAgentOpenedTabs`/`unregisterAgentOpenedTab`(决策 27) |
| `lib/imageFetch.ts` | ✅ 完成 | read_element 取图管道:`fetchImageForModel`(fetch 主取)→ `captureCropForModel`(captureVisibleTab 按 rect×DPR 裁剪兜底,防盗链/403);canvas 降采样对齐 pi 上游:≤2000×2000、JPEG q0.8 起逐级降质、PNG/JPEG 取小、base64 ≤4.5MB |
| `lib/permissions.ts` | ✅ 完成 | 权限声明与展示(设置权限 tab 已删,决策 40;本层供 userScripts 强引导弹窗):INSTALL_PERMISSIONS(6 项安装权限用途说明;userScripts 行状态徽章 + 可选增强文案)/ WEB_ACCESS_PERMISSION(host <all_urls> 随安装授予,截图与取图兜底的硬依赖)/ `openExtensionDetails`(直达详情页,引导弹窗用);无运行时授权流程(决策 25) |
| `lib/quickPrompts.ts` | ✅ 完成 | 新会话快捷指令生成(参考 rikkahub suggestionModel):`QuickPrompt`/`FALLBACK_PROMPTS`(静态四条兜底)/`isPromptWorthyUrl`(仅 http(s) 算正常页)/`generateQuickPrompts(settings, {pageTitle,url}, signal)`(辅助模型 completeSimple,JSON 数组解析 + 形状校验截 4 条,失败 throw 由 hook 回退);消费方 hooks/useQuickPrompts |
| `lib/gate.ts` | ✅ 完成 | 工具门控契约:`GateRequest`(confirm/ask)/`GateResponse`、`setGateHandler`(未注册=快速 deny/cancelled,安全默认)、`flushPendingGates`(停止/中止冲销 pending)、`requestGate`(handler 异常按 deny)、`createGatedTool`(confirm 包装,detail 支持按参数动态生成,denied 英文拒绝文本;execute_js 已用) |
| `lib/pageScripting.ts` | ✅ 完成 | execute_js 注入原语:`isUserScriptsAvailable`(userScripts 存在 + getScripts() 探测不 throw)、`executePageScript(tabId, code, world)`(userScripts.execute 主路线 → scripting.executeScript MAIN world func 包装兜底,JSON.stringify 后 8000 字符截断,降级在返回文本注明,一切错误转英文不 throw) |
| `lib/fetchPage.ts` | ✅ 完成 | fetch_url 抓取管线:sidepanel 直连 GET + 动态 `@mozilla/readability` 提取(与 content.ts 同库);**私有/内网地址拒绝 + 重定向复检**(防提示注入探测内网);2MB(Content-Length 与读入后双检)/content-type 限 HTML/正文 12000 字截断;错误英文文本规范化前缀 `fetch_failed:`/`http_error:`/`not_html:`/`too_large:`/`extract_failed:` |
| `lib/webSearch.ts` | ✅ 完成 | websearch 十源适配器(duckduckgo/searxng HTML 解析 + brave/tavily/bocha/serper/exa/zhipu/metaso JSON API + bing 无 Key HTML 抓取):统一 `{title,url,snippet}[]`、10s 超时、截 8 条、错误 throw `search_failed:` 前缀族;`isWebSearchConfigured`(注册/运行守卫单一来源)、`searchWeb(config, query)` 分发 |
| `lib/elementLabel.ts` | ✅ 完成 | 元素 chip label 构造:`elementChipLabel`(24 视觉单位,chip/气泡)/`elementListLabel`(48 视觉单位,引用列表);CJK 视觉宽度加权,空 preview 回退 `<tagName>`→"页面元素" |
| `lib/compaction.ts` | ✅ 完成 | compact_context 压缩管线:生效历史序列化 → pi completeSimple 生成结构化摘要(KEEP_RECENT_TOKENS=12000 与 read_element 截断同值);`findCutIndex`/`runCompact`;摘要消息由调用方拼装落盘 |
| `lib/sessionExport.ts` | ✅ 完成 | 会话导出 Markdown(历史行 hover 下载):`buildSessionMarkdown(session)`(正文平铺/思考与工具调用 `<details>` 折叠/引用页面聚合清单/picked-element 转可读行/工具结果截 1500 字/assistant 标注 provider+model/consumed 集合去重防双渲染)+ `downloadSessionMarkdown`(Blob 触发,文件名 = 净化标题_日期.md) |
| `lib/language.ts` | ✅ 完成 | AI 生成内容语言:`AI_LANGUAGES`(12 语言白名单 tag/label/english)+ `resolveAiLanguage(settings.language)`(null → navigator.language 精确/前缀映射,非白名单 tag 直传);注入 system prompt/标题/快捷指令生成三处 |
| `lib/tools/` | ✅ 完成 | 工具注册表(pi 一工具一文件 + 集合函数):`registry.ts` = 唯一组装点 `getTools(GetToolsOptions{refTabs,pickedElements,canUseImage,onCompactContext,webSearch,dynamicTabs})`,组装序 **utility(read_time/ask_user/compact_context)→ web(search_web 条件)→ read(read_page/read_element,invalid-tabId 错误走 buildUnreadableTabError)→ discovery(search_element 无条件;search_page 全提供商枚举 + [readable]/[external] 可读性标注)→ action(click/fill/scroll,无条件;open_page 同 URL 复用;screenshot_page 仅 vision 模型注册)→ fetch(fetch_url)→ gated(execute_js,executable 错误同 helper)**;`read-page`/`read-element`/`search-element`/`search-page`/`click-element`/`fill-element`/`scroll-page`/`screenshot-page`/`open-page`/`activate-page`/`close-page`/`page-action-shared`/`fetch-url`/`web-search`/`compact-context`/`execute-js`/`read-time`/`ask-user` 各导出 `createXxxToolDefinition`;`time.ts` = 本地时间助手 |
| `lib/utils.ts` | ✅ 完成 | cn()/getErrorMessage |
| `entrypoints/content.ts` | ✅ 完成 | 结构化提取(article/main/[role=main] 优先,截 12000 字)+ 框选元素模式(@medv/finder 生成唯一 selector,结果经 `ai-sidebar/pick-element-result` 广播)+ 交互元素发现(`search-element` 消息;dom-accessibility-api 交互元素清单:role 白名单+DOM 标签启发+tabIndex≥0 候选、effectiveRole 兜底、开放 shadow root、option/optgroup/datalist 子树跳过、aria-hidden+checkVisibility+零尺寸可见性、同 role+name 序号全量计数后截 80 条;placeholder 兑底名称+inputType 线索;枚举共享内核供 locator 解析同源)+ 页面动作执行器(`page-action` 消息 resolve/click/fill/scroll:locator 解析(not_found 附同 role alternatives/ambiguous 附 matches)、400ms 轮廓高亮、点击(scrollIntoView 居中→遮挡检测→fallback 直发注记)、受控填充(select/toggle/文本类原生 setter+input/change、contenteditable execCommand、空串清空)、scroll(视口 0.8/locator scrollIntoView)、有界 settle(**尾帧 rAF 与 visibilitychange 竞速:tab 失焦毫秒级短路返回 settle_skipped 注记——隐藏 tab rAF 完全暂停,原实现曾致工具永久挂死**)、navigation_started 注记) |
| `entrypoints/background.ts` | ✅ 完成 | 点击图标打开侧边栏 |
| `entrypoints/sidepanel/App.tsx` | ✅ 完成(组合层) | store selector 订阅 + 五域编排 hook 组装(useGate/useSessionManager/useChatTurn/usePageContextRefs/useQuickPrompts/useCompact)+ 聊天常驻挂载 + 设置全高 Drawer(vaul,open = currentView === 'settings')+ UserScriptsGateDialog 强引导 + gatePagination/quietTailCount/contextData 派生(useMemo 就地);无业务逻辑 |
| `entrypoints/sidepanel/store/` | ✅ 完成 | zustand v5 单 store(单一状态树按域分组,非分列 store)五切片:`gateSlice`(activeGate/resolvedGateCount/pushGate/4 应答/dismissPendingGates/resetGates;handler 模块级注册,StrictMode 免疫)、`errorSlice`(errorMessage)、`sessionSlice`(sessions/activeSessionId/loaded/commitSessions/patchDraftOf/patchActiveDraft + 草稿防抖队列模块级 flushDraftSaves/dropPendingDraftSave)、`settingsSlice`(settings/setSettings/updateSettings)、`chatSlice`(isStreaming/streamingContent/streamingThinking/activeToolNames/isCancelled/inFlight);devtools 仅 `wxt dev` 运行模式(构建产物恒为零引入;devtools 面板需装 Redux DevTools 浏览器扩展手动冒烟验证一次) |
| `entrypoints/sidepanel/hooks/` | ✅ 完成(编排层,状态全在 store) | `useGate`(gateSlice 消费层:4 应答回调薄层/dismiss/resetGates)、`useSessionManager`(增删切/AI 命名/重命名 + 原子 init:storage 读取+迁移+watch 接 store action;标题生成用 resolveAuxModel + titleThinking)、`useChatTurn`(send/stop 编排:turnSeqRef R-1 守卫/abortControllerRef/compactRequestedRef ephemeral ref;B-1 生效历史/非破坏落盘语义原样;流式节流 STREAM_FLUSH_INTERVAL_MS=50 攒最新值定期冲刷,message_end/轮末/新轮清定时器)、`usePageContextRefs`(refTabs/pickedElements 读写经 patchActiveDraft、tabs.onUpdated/onRemoved 同步、框选 startPickElement+pendingPick、runtime.onMessage 框选结果回传)、`useQuickPrompts`(空会话动态快捷指令:辅助模型生成/导航跟随/同 URL 缓存/非正常页隐藏/失败回退静态四条)、`useCompact`(压缩编排:互斥守卫/非破坏落盘);跨域归属备案:gatePagination/quietTailCount/contextData 留 App 组合层 useMemo,runtime.onMessage 框选监听归 usePageContextRefs;三边界:store=共享状态唯一家 / 编排 hook=异步流程+ephemeral ref / 派生=消费点就地 useMemo |
| `entrypoints/sidepanel/components/chat/` | ✅ 完成 | ChatHeader(模型/历史 DropdownMenu/设置入口;会话行 hover 导出 Markdown/重命名/删除确认)、MessageList(**单一 `itemsToRender` 数组不变式**:流式 live 项作为末位并入同一数组,key/messageId = 其未来物化位置,**绝不得改回 `map()` + `{isStreaming && ...}` 条件兄弟槽**(React 不跨槽复用实例 → 物化时整条重挂载、输出完闪一下,见 §5.7.5);**overflow-anchor 哨兵钉底为主 + RO 瞬时兜底**;空态/错误横幅/锚点;确认卡/工具卡挂载强制钉底+钉底后 150ms 抖动忽略;动态快捷指令卡:骨架/换一批/按聚焦页生成,非 http(s) 或无模型隐藏)、MessageItem(分段渲染:思考/文本/工具卡按 content 块序,**子块 key 按类型不按位置**(`thinking-${j}`/`text-${j}`——流式 `[text]` 变物化 `[thinking, text]` 时位置 key 整体会位移重建 markdown);ToolCallCard 四态+参数/结果展开;用户消息 chip = `<picked-element>` 块解析渲染 + 旧标记裸文本兜底;token 脚注;useSmoothText/SmoothMarkdown rAF 流式平滑揭示,**组件身份恒定**(用 `animate` flag 切换而非更换组件类型))、MarkdownView、CompactionRow(压缩摘要分隔线卡)、SlashMenu(斜杠命令浮层)、ApprovalSection(审批槽位,唯一交互渲染位;会话级 grant 勾选「暂时允许对当前页执行…/关面板后恢复询问」,勾选后允许钮变「允许并记住」)、elementMarkerText(chip 渲染 helper)、extensions/(TipTap InlineBadge 原子徽章节点 + BadgeNodeView + editorSerialize 序列化) |
| `entrypoints/sidepanel/components/chat/ChatInput.tsx` | ✅ 完成 | **Composer = TipTap 3**(inlineBadge 原子节点:框选完成 insertContent;删除=叉号整块删/PM 原生退格;粘贴=纯文本/单一 URL 转 url 徽章;草稿恢复=setContent+parseHTML 还原);斜杠命令(/compact /clear /help,浮层+键位导航);上下文占用环 ContextRing/详情 ContextPanel(压缩入口);tab chip 带元素 DropdownMenu + 清除已选元素;模型+思考等级切换 |
| `entrypoints/sidepanel/components/settings/` | ✅ 完成 | SettingsMainView(**提供商/搜索/权限/备份/关于五视图,Drawer 承载**;提供商列表上方「模型分工」卡:对话/标题/快捷指令三行各带模型 Select(按提供商 SelectGroup 分组)+ 思考 Select,对话模型行与输入框同字段双向同步;「偏好」卡:语言 Select 自动/12 白名单)、SearchSettingsView(搜索源 Select + 条件字段:searxng 实例地址/各 API Key 密码输入 + 申请地址;修改即 updateSettings 持久化)、SettingsPermissionsView(透明说明 + userScripts 状态徽章 + 直达详情页引导)、SettingsBackupView(配置导出/导入 JSON,含 API Key 明文,UI 警示)、ProviderDialog(增改提供商 + 内联拉取勾选导入 + 「同步」按钮)、ModelConfigDialog |
| `entrypoints/sidepanel/components/UserScriptsGateDialog.tsx` | ✅ 完成 | userScripts 强引导 AlertDialog(挂载/focus/visibilitychange/1.5s 轮询四重检测;Esc/遮罩拦截;前往扩展详情页 + 暂时跳过仅本会话;开启后自动消失,跳过后监听全停) |
| `entrypoints/sidepanel/style.css` | ✅ 完成 | 主题 token + markdown 排版(`.md-*`)+ hljs 主题 + 6px 细滚动条 + element-chip 族(元素预览 chip)+ messages-anchor/viewport(跟底锚点)+ composer-editor(TipTap) |
| `entrypoints/sidepanel/theme.ts` / `main.tsx` / `index.html` | ✅ 完成 | 不用动 |
| `components/ui/` | ✅ shadcn 官方原样 | **严禁自定义**;含 alert-dialog/drawer/toast(@base-ui/react);button.tsx 曾被加 xs/icon-xs,已重置 |

UI 细节基调:顶/底渐变遮罩衔接滚动区、用户气泡 `bg-secondary`、三点打字动画。

依赖:`@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`(^0.84.4)、`@tiptap/*` v3.31(Composer)、`@mozilla/readability` + `dom-to-semantic-markdown`(提取,content.ts 与 fetchPage 共用)、`@medv/finder`(框选 selector)、`shiki`(代码高亮,双主题;旧 `highlight.js`/`rehype-highlight` 已移除)、`idb`、`zustand` v5、`@base-ui/react` 1.8(Drawer/Toast等)、`@shadcn/react`(MessageScroller等)。pnpm 曾提示 `@google/genai`/`protobufjs` 构建脚本被忽略,无害。

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
4. **项目级样式覆盖不得与元素自带的 utility 类争同一属性**(Tailwind v4 层序 theme < base < components < **utilities**,`@layer components` 里的 `@apply`/声明永远输给写在 JSX className 上的 utility → 静默失效)。要覆盖官方组件 className 已有的属性(宽/高/self-*/translate-*/z-*/margin/圆角等),只有两条路:**加 `!important`**,或**把规则移到所有 `@layer` 之外**(未分层高于任何分层)。已踩两次:头像 `self-start`(`components/ui/message.tsx` 自带 `self-end`)、toast viewport 宽度(官方 `w-auto`);两处均靠消费处 className 覆盖(tailwind-merge 去重)或 `!important` 生效。
5. **React 不跨 JSX 子节点槽位复用实例**——同一个元素数组与一个条件兄弟节点即使写了**完全相同的 key**,协调时也不会复用(旧代码注释曾声称“live 槽键 = 未来物化位置 → 零重挂载”,该断言本身就是错的)。流式末条与物化消息必须活在**同一个数组**里才能原键协调;同时子项 key 要按**类型**而非位置(`thinking-${j}`/`text-${j}`),否则流式 content `[text]` 变物化 `[thinking, text]` 时索引位移会整块重建 markdown。另:注释与断言不算证据,改动靠生成产物/代码路径取证。

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
sanitizeSessions(unknown): Session[]            // 纯防御清洗(非法形状丢弃,pi 形状原样透传;决策 38 无旧格式迁移)
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

// lib/sessionStore.ts —— 会话历史唯一读写层(IndexedDB 'ai-sidebar-sessions' v1 / store 'sessions',idb 封装;JSONL 文本行 + 冗余 updatedAt;草稿随 Session 存)
listSessions(): Promise<Session[]>              // getAll 逐行容错跳坏行,按 updatedAt 降序
saveSession(s: Session)                         // put(JSONL 序列化在本层,消费方只见 Session 对象)
deleteSession(id: string)                       // delete
replaceAllSessions(sessions: Session[])         // WebDAV 恢复:单事务 clear+put
// 零迁移链(决策 38);注意:IndexedDB 无跨上下文 watch;sidepanel 是会话历史唯一写方

// lib/agent.ts —— 会话 Agent 工厂 + 发送入口(工具组装已移至 lib/tools/registry.ts;决策 36)
// 每会话一个 pi-agent-core Agent 实例(Map 长期持有,多会话并发);自持原始转录 + convertToLlm(toLlmMessage)+ transformContext(压缩裁剪)+ prepareNextTurn(每轮工具重建)
ensureSessionAgent(options): Agent              // 创建/复用;buildAgentInputs 每轮刷新 model/tools/systemPrompt/streamFn
hasSessionAgent(sessionId) / sessionAgentFor(sessionId) / disposeSessionAgent(sessionId) / disposeAllSessionAgents()  // 会话删除/恢复导入释放
setAgentEventSink(sink | null)                  // 常驻订阅出口(entrypoints 注入 → 投影层 → store.runs)
runAgentTurn(options) / continueAgentTurn(options): Promise<RunAgentResult>  // 发送/队列泵内核;userMessage 仅前者需要
// RunAgentOptions: provider/modelId/history?(提供=覆盖转录)/compaction?/userMessage?/refTabs?/pickedElements?/thinkingLevel/language?/rules?/systemPrompt?/sessionId?/signal?/onEvent?/onCompactContext?/webSearch?/dynamicTabs?
toPiModel(p: ProviderConfig, m: ModelConfig): Model<KnownApi>   // 缺失参数保守默认(128000/4096)
buildSystemPrompt(): string                     // 身份 + 本地日期行 + 压缩版 <page-refs> 协议规则(不注入引用目录)
// RunAgentResult { messages(完整转录); newMessages(本轮新增,含 toolResult); errorMessage? }
// 语义:工具白名单 = Agent 转录 ∪ 草稿引用 ∪ openedTabs;LLM 请求副本经 toLlmMessage(refs 块剥 elements 留 tabs);失败经协议事件编码(stopReason='error');中止时已生成部分保留在转录中

// lib/tools/registry.ts —— 工具注册表(唯一组装点;一工具一文件见同目录)
interface GetToolsOptions { refTabs?: RefTab[]; pickedElements?: PickedElement[]; canUseImage?: boolean;
  onCompactContext?: () => void; webSearch?: WebSearchConfig | null }
getTools(options): AgentTool[]                  // 组装序:utility(read_time/ask_user/compact_context)→ web(search_web 条件)→ read(read_page/read_element)→ discovery(search_element 无条件,无 tab 白名单)→ action(click/fill/scroll,无条件;screenshot_page 仅 vision 模型注册)→ fetch(fetch_url)→ gated(execute_js)
// createWebSearchTools(config) / createPageReadTools(options) / createPageDiscoveryTools() / createFetchTools() / createGatedTools(options) /
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
searchElementsInTab(tabId, query?): Promise<SearchElementsResult | null>  // 交互元素清单(search_element 底层;'ai-sidebar/search-element' 消息;query 单串/数组 OR 子串过滤,先于预算;无 content script 时补注入重试一次;失败 null)
SEARCH_ELEMENT_LIMIT = 80                        // 清单输出上限(单一来源 lib/types.ts;content 侧全量计数序号后截断)
// InteractiveElementInfo { role; name(可访问名称,可空时 input/textarea 兑底 placeholder); ordinal(同 role+name 组内 1 起文档序,首现 1 不输出); disabled; visible; inputType?(password/email/tel/url/日期族) }
// SearchElementsResult { url; title; total; truncated; durationMs(DEV 打点); elements }
performPageAction(tabId, 'resolve'|'click'|'fill'|'scroll', params): Promise<PageActionResult | null>  // 页面动作原语(步②;http 守卫+补注入重试+宽松透传;结构化失败 reason: not_found/ambiguous/option_not_found/unsupported_element/invalid_value)
// ActionLocator { role; name(可空); ordinal? } / ResolvedActionElement { role; name; ordinal; tagName; preview } / PageActionResult { ok, url, title, element?, notes[](遮挡 fallback/navigation_started) }

// lib/pageScripting.ts(execute_js 注入原语;userScripts 类型未在 @wxt-dev/browser 声明,内部已 cast)
isUserScriptsAvailable(): boolean               // chrome.userScripts 存在 + getScripts() 探测不 throw(138+ 开关探测)
executePageScript(tabId, code, world): Promise<{ok:true;result:string}|{ok:false;error:string}>
// world: 'user_script'(默认,USER_SCRIPT 隔离豁免页面 CSP)| 'main'(页面主世界,可访问页面 JS 状态)
// 主路线 chrome.userScripts.execute(135+);不可用降级 scripting.executeScript MAIN world(func 包装 eval,
// 严格 CSP 站点失败),降级在结果文本注明;全链失败返回可行动英文错误文本(Allow User Scripts / 120-137 开发者模式)
// 结果 JSON.stringify 后截断 8000 字符;一切错误转英文文本不 throw

// lib/gate.ts(工具门控契约;UI 车道经 setGateHandler 注册处理器)
type GateRequest  = { kind:'confirm'; toolName; label; summary; detail?; grantable?; grantScope? } | { kind:'ask'; question; options? };
type GateResponse = { kind:'confirm'; approved; grant? } | { kind:'ask'; answer; cancelled? }
setGateHandler(h: GateHandler | null); flushPendingGates()   // 未注册=快速 deny/cancelled(安全默认);flush 供停止/中止冲销
requestGate(req): Promise<GateResponse>                      // 挂起等 UI 应答(无超时);handler 异常按 deny
// 会话级 grant:confirm 带 grantScope(工具+tab 如 click_element@12)命中 grantedScopes 直接 approved;UI 应答 grant=true 记录;面板生命周期;execute_js 永不可 grant
createGatedTool(tool, summary, detail?, detailFromArgs?)     // confirm 包装:detailFromArgs(args)=>string 按调用参数动态生成
// detail(空串回退静态 detail,execute_js 预览 code);approved 才执行原工具,denied 返回英文拒绝文本

// lib/tools/time.ts(本地时间助手;system prompt 与 read_time 共用)
localDate(now?): string; localTime(now?): string; utcOffsetLabel(now?): string; weekdayName(now?): string
// 'YYYY-MM-DD' / 'HH:MM:SS' / 'UTC+8' / 英文星期名

// lib/tools/read-time.ts / ask-user.ts / fetch-url.ts / web-search.ts / search-element.ts(工具定义;组装见 registry)
createReadTimeToolDefinition(): AgentTool             // 'read_time':date/weekday/time/timezone/iso(UTC) 英文块,免弹卡
createAskUserToolDefinition(): AgentTool              // 'ask_user':requestGate ask 路径(≤6 options);cancelled → 'User dismissed the question (no answer).'
createFetchUrlToolDefinition(): AgentTool             // 'fetch_url':safe;GET 任意公开 URL → Title/URL/<content>;私有网拒绝;错误前缀族见 lib/fetchPage.ts
createWebSearchToolDefinition(config): AgentTool      // 'search_web':safe;编号结果清单 + "Use fetch_url … follow up";错误前缀 search_failed:/not_configured:
createSearchElementToolDefinition(): AgentTool        // 'search_element':safe;交互元素紧凑行式(- button "Sign in";[2]/[type=x]/[disabled]/[hidden] 稀疏旗标)默认 focused tab,tabId 可选(决策 21);query 单串/数组 OR 过滤
createClickElementToolDefinition(): AgentTool         // 'click_element':confirm+grant(自门控:先解析 locator 再 requestGate,detail 预览真实元素;遮挡 fallback 直发;untrusted 合成事件)
createFillElementToolDefinition(): AgentTool          // 'fill_element':confirm+grant;分类填充(select/toggle true-false/文本类原生 setter+input-change;contenteditable execCommand;空串清空)
createScrollPageToolDefinition(): AgentTool           // 'scroll_page':safe;视口 scrollBy(默认 0.8 视口)/locator scrollIntoView
createScreenshotPageToolDefinition(): AgentTool      // 'screenshot_page':confirm+grant;captureVisibleTab 仅活动 tab 可视区(错误透传 Browser said);仅 vision 模型注册
// lib/permissions.ts(权限声明与展示)INSTALL_PERMISSIONS(6 项安装权限用途)/WEB_ACCESS_PERMISSION(<all_urls> 随安装授予)——无运行时授权流程(决策 25);userScripts 开关无 API 代开,页签直达详情页引导
// page-action-shared.ts:formatLocator/resolveActionTab(缺省 focused tab)/renderActionFailure(element_not_found 等前缀族)/renderActionSuccess

// lib/imageFetch.ts(read_element 取图管道)
fetchImageForModel(src): Promise<ModelImage | null>            // fetch 主取
captureCropForModel(tabId, rect, dpr): Promise<ModelImage | null>  // captureVisibleTab 裁剪兜底(仅活动 tab)
captureVisibleForModel(tabId): Promise<CaptureVisibleResult>      // screenshot_page 主路径:活动 tab 整屏;非活动→inactive,浏览器拒绝原文透传
// 编码:canvas 降采样 ≤2000×2000、JPEG q0.8 起逐级降质、PNG/JPEG 取小、base64 ≤4.5MB

// lib/tools/search-page.ts / open-page.ts / activate-page.ts / close-page.ts(③⑤多标签寻址)
createSearchPageToolDefinition(refTabs, dynamicTabs?)  // 'search_page':safe;全提供商枚举 + [readable]/[external] 可读性标注(决策 34);query 过滤
createOpenPageToolDefinition(): AgentTool              // 'open_page':confirm+grant open_page@*;同 URL 复用(激活现存 tab + 注册可读,不开重复页);background 可选
createActivatePageToolDefinition(): AgentTool          // 'activate_page':activate+grant;切到指定 tab
createClosePageToolDefinition(): AgentTool             // 'close_page':gate 卡确认后关闭指定 tab

// lib/quickPrompts.ts(新会话动态快捷指令)
FALLBACK_PROMPTS: QuickPrompt[]                        // 静态四条兑底
isPromptWorthyUrl(url): boolean                        // 仅 http(s) 算正常页
generateQuickPrompts(settings, {pageTitle?, url?}, signal?): Promise<QuickPrompt[]>  // 辅助模型生成 4 条;失败 throw → hook 回退

// lib/sessionExport.ts(会话导出)
buildSessionMarkdown(session): string                  // Markdown 全文(思考/工具调用 <details> 折叠,consumed 去重)
downloadSessionMarkdown(session): void                 // Blob 触发下载(文件名 = 净化标题_日期.md)

// lib/language.ts(语言偏好)
AI_LANGUAGES: LanguageOption[]                         // 12 白名单 {tag,label,english}
resolveAiLanguage(language): string                    // null → navigator.language;英文名注入 prompt

// lib/pageContext.ts(新增,接前文 pageContext 行)
findTabByUrl(url): Promise<RefTab | null>              // hash 不敏感同 URL 查找(open_page 复用)
snapshotTabs(): Promise<TabSnapshot>; describeTabChanges(before): Promise<string | null>  // click 前后对比注记
liveTabIds(): Promise<Set<number> | null>  // 草稿引用对账用;**查询失败返回 null**(=未知);不得改用 snapshotTabs——它把错误吞成空集,用作清理会误删全部引用
buildUnreadableTabError(tabId, validIds, dynamicTabs?, noun?): Promise<string>  // 三分支可行动错误(noun = readable|executable)
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

0. **当前阶段(2026-09,决策 36-40 全部落地)**:会话运行时对齐 pi Agent(四步全完成)+ JSONL 存储(无兼容重构,决策 38)+ 压缩预算自适应(决策 39)+ 多会话并发隔离 + 聊天视觉改版(决策 40)+ 代码块 shiki 双主题 + 页面动作测试台(`fixtures/page-actions`,C 组验收工具)。自动化:40 测试全绿、compile/build 绿;独立 reviewer 两轮报告已全部处理。**回归进度**:清单六组(A/B/C/D/E/F)已全部真机通过并勾选(含 A 组新库往返——dev profile 持久化后可测,见 §9)。**但收尾被一个新报 P0 挡住(清单 G1)**:AI 回复突然消失、只剩刚发出的那条用户消息。**根因仍未定性**。已做的工作:①修掉三处真实但各自独立的缺陷——投影桥对非数组 content 的 `.filter` TypeError、事件 sink 无兜底(生命周期事件上抛异常确实会逃出 agent loop)、异常路径 `clearInFlight` 丢弃整轮转录而不落盘;②写边界加转录单调守卫(`mergeTranscriptKeepingHistory`,变短则保留已存 + 只补缺失 + 告警);③排队消息可见性、镜像队列补发、落盘失败文案。**已证伪的假设(探针实测,2026-09)**:订阅者在 `message_update` 抛异常**不会**逃进 `runAgentTurn` 的 catch——pi 的 `runWithLifecycle` 把它吞成 `stopReason:"error"` 的助手消息,走正常 finalize(结果是“回复没了 + 错误横幅”,不是“store 只剩用户消息”)。早期的“最终触发链”叙述与其一并作废;逃逸只在生命周期事件(`agent_start`/`turn_start` 等)上抛时发生,是更宽的假想场景。**当前领先候选(待真机验证,复审 P1)**:助记/工具结果只进内存 `runs[sid].inFlight`,**直到 finalize 才落盘**;回合中途面板文档被销毁(关闭侧边栏/Chrome 回收/dev 重载)即丢掉整轮,重开后只剩发送时写入的那条用户消息——与症状高度吻合。**待真机确认**:G1 是否复现 + 代码块着色。确认通过后接:i18n 收敛 → 发布(图标 + `wxt zip`)。

1. **用户手动回归** —— ✅ 已完成(2026-09,覆盖:普通对话、read/search/fetch/click 全链、点击 _blank 跳转修复、导出、设置抽屉/模型分工/语言/思考档、引导弹窗、删除确认);后续每次新功能按验收标准随批回归。
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
   - **实施序列**:①search_element(✅ 已完成 2026-09:dom-accessibility-api 0.7.1 + content script 侧计算、稀疏旗标行式、80 条预算(可见优先,隐藏项只填剩余名额)、序号全量计数保证步② locator 可重现、默认 focused tab 无白名单、打点 content durationMs + 工具 totalMs(仅 DEV console);实测 baidu 91 元素全链 5ms)→ ②click/fill + scroll + grant 扩展 + 高亮(✅ 已完成 2026-09:自门控先解析后确认、grant 工具+tab 面板生命周期、遮挡 fallback 直发、受控填充原生 setter、settle 内置、高亮 400ms、search_element query 数组 OR)→ ③screenshot_page(✅ 已完成 2026-09:仅活动 tab 可截(浏览器硬限制,描述明示)、仅 vision 模型注册(canUseImage)、confirm+grant 工具@tabId、拒绝原因原文透传 Browser said;权限前置 = host <all_urls>)→ ④返回模板 v2(✅ 已完成 2026-09:read_page/read_element 附页面指纹 FNV-1a(url|title|正文规模|正文采样),跨读取比对判变化;click/fill 结果附 after 注记——settle 后 re-resolve locator 比对元素状态,导航/失焦短路时跳过)→ ⑤chrome.debugger(✅ 已启用 2026-09:滚动可信输入兜底,lib/cdp.ts;不做常驻附加)
   - **参考**:AhYi8/browser-ai-assistant(CDP 驱动,特权层不可移植;可搬=AX 行格式/噪点过滤/预算截断/受控 fill 法/遮挡检测/wait_for_state 有界轮询/fail-closed 校验——克隆在 `.slim/clonedeps/repos/AhYi8__browser-ai-assistant`,只读)
   - **验收标尺**:模型经 search→click 链完成真实登录页填字点按钮,全程零手写 JS
5. **四期规格 v1:自定义规则 / 技能 / 记忆与自改进**(自定义系统提示词扩展;调研对齐:pi/Agent Skills 标准(agentskills.io)+ OpenClaw 三层文件记忆 + Hermes 自改进循环 + Cline/Roo 具名规则列表;用户已拍板:规则列表形态、自动+手动双触发、memory 常驻注入、分三步实施):
   - **注入架构(buildSystemPrompt v2)**:五层注入 + 字符预算——⓪自定义系统提示词(独立文本框,常驻,≤4000;用户拍板:独立入口,非规则替代)①启用中的规则(总 ≤6000 字符,超限按序丢弃整条)②memory.md 常驻(≤2000)③技能索引(name+description,≤3000)④技能正文按需(`read_skill` 工具取);注入头 model-facing 一律英文,明示"用户设定,优先级高于默认风格、低于当轮用户指令"
   - **规则(UserRule)**:`{ id, name, content, enabled }[]` 存 `Settings.rules`;sanitize(uuid、name ≤100、content ≤4000、条数 ≤20);设置新「提示词」页签(步②扩技能/记忆区);UI = 列表(开关/内联编辑/删除走统一 AlertDialog)
   - **技能(Agent Skills 标准)**:SKILL.md 格式(name 小写连字符 ≤64/description ≤1024);存 chrome.storage.local `skills` 键:`{ id, name, description, content, source, createdAt }[]`;v1 纯指令 markdown,无脚本/引用文件(无文件系统,天然安全);新工具 `read_skill`(safe)/ `save_skill`(upsert,confirm);设置技能区 = 列表 + textarea 编辑 + .md 文件导入;`/skill:name` 斜杠命令(步③)
   - **记忆(memory.md)**:单文件常驻注入(≤2000),存 chrome.storage.local;`save_memory`(confirm)工具供 agent 沉淀;设置页可查看/编辑/重置
   - **内置三技能**(打包内置,可禁用不可删,variant=builtin):`skill-creator`(Anthropic 模式,教 agent 按 frontmatter 规范与描述最佳实践写技能,落 save_skill)/ `skill-installer`(OpenClaw 模式,fetch_url 抓 GitHub raw/gist → 解析 frontmatter → 预览确认落库)/ `self-improving-agent`(Hermes 模式:`/improve` 触发会话复盘——**先列用户纠正与失败**(补 Hermes 只学成功的已知短板)→ 提议 save_skill/save_memory 逐条审批)
   - **自动反思(v1 范围)**:会话中出现用户纠正强信号或工具连续失败时,agent_end 后辅助模型后台生成记忆提议 → toast 提醒用户确认后落库;不做无人值守静默写入
   - **同步**:WebDAV bundle 纳入 rules/skills/memory(version bump)
   - **实施序列**:①规则+注入架构骨架 → ②技能存储/工具/设置 UI → ③三内置技能+记忆+自动反思+同步
   - **安全**:技能/规则 = 提示注入面;安装必经预览确认;save_skill/save_memory 全程 confirm(永不进 grant);存储内容设置页全程可查可改
   - **验收标尺**:①规则开关下轮对话即时生效 ②经 skill-installer 从 GitHub 装真实技能并生效 ③/improve 从含纠错会话沉淀记忆且下轮生效
6. **UI 官方化专项:聊天渲染全量迁移 shadcn 官方件**(✅ 已完成 2026-09:小件批一 1a8628a(Tabs/Bubble/Message/Collapsible/Marker/Spinner)、小件批二 481f6a6(Item/ButtonGroup 审批卡 + Questionnaire ask_user)、大件批 b945ef6(MessageScroller 替换 overflow-anchor 钉底体系 + shadcn/tailwind.css utilities import + Skeleton);评估保留:ToolCallCard 内容体/ApprovalSection 交互体/ContextRing/元素 chip/md-body(无官方对应)、Attachment(无上传流)、Empty/Field(与现有范式等价))(用户拍板「全部换官方」;scout 调研报告见 subagent-artifacts/outputs/790c6362…/context.md):
   - **底座结论**:bubble/message/attachment/marker 基于 radix-ui(Slot)+ 标准 new-york-v4 token,零主题改动;message-scroller 依赖新包 @shadcn/react(v0.3.1,peer react 19);prompt-input/response/reasoning/tool 官方不存在(404)—— TipTap Composer(元素 chip + 斜杠 cmdk)与 MarkdownView(react-markdown)保留自造
   - **小件批(designer)**:`add bubble message spinner marker collapsible tabs` → 设置页签换 Tabs;消息行布局换 Message/Bubble(用户=default end、AI=ghost/tinted、错误=destructive);token 脚注进 MessageFooter;CompactionRow 换 Marker separator;思考折叠/工具卡展开换 Collapsible;流式 50ms 节流与状态流不动
   - **小件批二(designer,等批一落地)**:`add questionnaire item button-group` → ApprovalSection 审批卡换 Item+ButtonGroup(工具信息 ItemContent、允许/拒绝 ItemActions、会话级 grant Switch 保留);ask_user 提问卡换 Questionnaire(单问题子集:choices/freeform/skip/submit);gate 状态流与 grant 语义零改动
   - **大件批(独立 milestone,开发者自己做)**:MessageScroller 替换 overflow-anchor 钉底 —— 每轮首条用户消息标 scrollAnchor、启 autoScroll(上翻自动退避)、preserveScrollOnPrepend、defaultScrollPosition=last-anchor 恢复会话;数据流把 turnSeq/滚动协议对齐 messageId;窄栏流式+多轮工具循环回归
   - **保留自造**:ToolCallCard 内容体、ApprovalSection、ContextRing/ContextPanel、元素 chip、md-body 排版
   - **验收标尺**:流式追加零跳动、上翻挂起/回到底、会话重开滚动位置正确、窄栏 360px 密度不退化
7. 发布:图标 + `wxt zip`。

> 已完成(2026-09-02):`err: any` → `unknown`(lib/utils.ts `getErrorMessage` helper,App/SettingsMainView/ProviderDialog 5 处收窄);dev 可观测性(content.ts 对未知 `ai-sidebar/` 消息 DEV 下 console.warn)。用户拍板不做:highlight.js 语言包裁剪(当时本地加载 941KB 不构成瓶颈;rehype-highlight@7 的 `languages` 选项可随时按需裁)。**该条已被取代**:决策 40 换 shiki 双主题后,`highlight.js`/`rehype-highlight` 已整体移除(`517648c`)。
>
> 已完成批次(2026-09,交接前):fetch_url 工具(`1422168`/`b7d0dd0`);**元素引用统一为 `<picked-element …/>` 块协议**(`f4f9ea3`,标记层废除);token 瘦身(`5f7d549`,块内嵌 300 字 preview → 后续收敛为 chip label,system prompt/工具描述压缩,单轮 ~17000→~500 token);兼容层删除(`1e5f5a2`,旧数据可弃);finalize 入场动画闪烁修复(`eadae82`,重估以 sessionKey 为界);流式跟底重做(`2213d61`,overflow-anchor 钉底为主);websearch 十源(`4f87b51`/`8d3e67d`);注释叙事清扫(`80145bf`);UI 精修(`b7d0dd0`/`595b242`/`2bf6f2e`/`c4ee901`/`e160214`:registry fetch 组重组/徽章 label 裸名/hint 精简/说明卡删除/思考菜单排序);交接文档基线 `0b515b3`。
>
> 已完成批次(2026-09,三期步①):**search_element 工具**——引库 `dom-accessibility-api` 0.7.1(getRole/computeAccessibleName/isDisabled,动态导入内联进 content.js);content.ts 交互元素收集器(role 白名单+DOM 启发+tabIndex≥0 候选/effectiveRole 兜底/开放 shadow root/option 子树跳过/aria-hidden+checkVisibility 可见性/序号全量计数截 80 条);`searchElementsInTab` 原语(补注入重试);`search-element` 工具 + registry discovery 组(无条件注册,默认 focused tab 无白名单——决策 21);可见优先预算 + content durationMs/工具 totalMs 打点(仅 DEV console,实测 baidu 91 元素全链 5ms);pnpm-workspace.yaml allowBuilds 落定('@google/genai'/protobufjs 显式 false,修 pnpm 11 install 报错)。
>
> 已完成批次(2026-09,三期步③):**screenshot_page + 权限架构定案**——screenshot_page(confirm+grant,仅 vision 模型注册,captureVisibleTab 仅活动 tab 可视区,错误原文透传 Browser said);host <all_urls> 随安装授予(截图硬要求;曾试 optional_host_permissions 运行时授权后回退——content_scripts 关联 origins 本就随安装授予,安装警告无差异);设置「权限」页签(透明说明+userScripts 开关检测与详情页引导,designer);lib/permissions.ts;工具结果即时入 in-flight(toolResult message_end 处理,quietTailCount 过滤);截图视觉地标测试区(fixture 第 8 节)。
>
> 
>
> 已完成批次(2026-09,引用组):参考 Gemini 标签页组模型适配 agent——每个 tab 记住所属引用工作集(refTabs+pickedElements 快照,面板生命周期),焦点切换即非破坏恢复(切未引用页=新单例、切组成员=恢复组、手动引用=入组);refs 块所见即所发(focused 标记活动 tab);多窗口 windows.onFocusChanged 兑底;switchRefGroup 快速连切竞态守卫。已完成批次(2026-09,三期步②):**页面动作原语**——click_element/fill_element(confirm+会话级 grant,工具+tab 粒度,面板生命周期)/scroll_page(safe)三工具 + registry action 组;content.ts 动作执行器(locator 解析同源 search_element、400ms 高亮、遮挡 fallback 直发、受控填充原生 setter、settle、navigation_started);gate.ts grantedScopes 短路 + grantable/grantScope 契约;search_element query 数组 OR 与 [type=x]/placeholder 名称兑底;流式 50ms 节流(STREAM_FLUSH_INTERVAL_MS)+ MessageItem rAF 平滑揭示(designer);卡片期跟底修复(强制钉底+抖动忽略);12 项提示词回归 + 真实登录页验收(零手写 JS)通过。
>
> 已完成批次(2026-09,交接收官,共 24 提交):**统一删除确认 AlertDialog**(会话/提供商);**设置页全高 Drawer**(vaul,聊天常驻挂载,四路关闭);**userScripts 强引导弹窗**(四重检测/Esc 拦截/开启自动闭环/跳过仅本会话);**模型分工卡**(三行各带模型+思考 Select,对话模型与输入框同字段互绑)+ **per-role 思考档**(titleThinking/quickPromptThinking,旧 auxThinking sanitize 迁移)+ 思考标签去英文注记;**全局语言偏好**(null=自动→浏览器语言,注入 system prompt/标题/快捷指令三处);**新会话动态快捷指令**(辅助模型按聚焦页生成,导航跟随/同 URL 缓存/非 http(s) 隐藏/失败回退静态四条);**会话导出 Markdown**(思考/工具调用折叠、引用页聚合、consumed 去重);**分组模型下拉**(输入框全提供商分组跨提供商直切 + 设置三行 SelectGroup);**导出反馈驱动修复**:unreadable-tab 可行动错误(helper 三分支)、search_page [readable]/[external] 标注、execute_js 同 helper、**click_element tab 变化报告**、**open_page 同 URL 复用**、**settle 隐藏短路(rAF 暂停根因)+ 8s 看门狗降级成功**;sonner toast 体系;语言选项文案简化。审查记录:分组/思考档/删除确认均过 designer+reviewer 双审。

## 9. 环境备注

- **本环境的 dev watcher 曾不可靠**(chokidar 在 agent 后台会话静默失效):已改 wxt.config `server.watch` 轮询(1s)后基本稳定;仍偶发失效——若改代码不生效,先查 `.output/chrome-mv3-dev` mtime 再重启 `pnpm dev`(交互会话约 25 分钟上限,后台 dispatch 用显式长 timeout,单位毫秒)。
- **dev 产物配置 `emptyOutDir: false`**(wxt.config vite.build):重建不清空输出目录——旧 hash chunk 保留,长活侧边栏页面的动态 import 不会 404 断链(曾导致多标签测试中回合中断、未落盘消息全部丢失)。**发布打包前手动清一次 `.output/chrome-mv3`**,避免旧 chunk 混入 zip。
- 无残留 dev 进程;直接 `pnpm dev`(自动拉 Chrome,扩展目录 `.output/chrome-mv3-dev`)。
- **改 content.ts/消息协议/权限后必须完整重启 `pnpm dev` 并刷新页面**:sidepanel 热更新 ≠ content script 更新,旧 content script 会继续应答过期协议。
- **dev 浏览器 profile 已持久化**(`wxt.config.ts` 的 `webExt.chromiumProfile = .wxt/chrome-data` + `keepProfileChanges`):重启 `pnpm dev` **不再清空 IndexedDB/登录**,所以“重启后数据还在吗”这类回归(A 组)可以真机验证。两个约束不得回退:①目录必须在配置加载时 `mkdirSync` 自建(chrome-launcher 要在里面写 `chrome-out.log`,不存在直接 ENOENT 启动失败);②不要改回默认临时 profile——那会让所有依赖重启的持久化测试不可测。副作用:dev 登录态/扩展设置会跳会话保留(属预期;profile 住在 `.wxt` 不入库)。
- 浏览器 local storage 里可能残留旧结构 `local:settings`(须过 `sanitizeSettings`);会话存储已无兼容重构(决策 38):旧 `local:sessions`/对象 store/旧库 `ai-sidebar` 均不再读写,新数据全在库 `ai-sidebar-sessions`,旧数据要么丢弃要么手动导出。
- 本文档与工具无关(原在 pi 中编写,已去除 pi 专属工具链说明);Windows 下注意确认 agent 实际使用的 shell,POSIX 语法按实际情况调整。
