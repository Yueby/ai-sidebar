# ai-sidebar 交接文档

> 写给下一个接手的 AI agent(opencode 或其他)。本文档是当前唯一权威现状说明;根目录 `AGENTS.md` 已与本文同步。

## 0. 三句话速读

1. **UI 已全部实现,agent 运行时已升级到 pi-agent-core,引用架构为 `<page-refs>` 元数据块 + `extract_page`/`read_element` 工具按需读取**;聊天组件在 `entrypoints/sidepanel/components/chat/`,设置组件在 `components/settings/`,务必先做用户手动回归(见 §8)。
2. **AI 通信一律走 `@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`**(同版本 ^0.84.4),严禁手写 SSE/协议适配;`lib/agent.ts` 的 `runAgentTurn()` 是唯一发送入口;唯一例外是"拉模型列表"两个 GET(已在 `lib/models.ts`)。
3. 每步验收:`pnpm compile && pnpm build` 必须全绿;改 content.ts/消息协议/权限后必须完整重启 `pnpm dev` 并刷新页面(见 §9)。

## 1. 项目定位

开源 **BYOK 浏览器 AI 侧边栏扩展**(Chromium:Chrome/Edge/Brave),对标 Chrome 内置 Gemini 侧边栏,用用户自己的 API Key。`ai-sidebar` 是永久内部代号(目录/包名不改,改的只是产品名)。

- MVP(已完成,待手动回归):sidePanel 聊天(流式/Markdown/工具卡片/思考折叠区/token 脚注/多会话/会话草稿)+ 读取当前网页(`extract_page`/`read_element` 工具按需读取,框选元素 + vision 读图)+ BYOK 多提供商(三种协议)
- 二期:划词快捷提问、多模型快捷切换、会话重命名/导出
- 三期:agent 页面操作工具层(参考 Nanobrowser 的 chrome.debugger/CDP 动作层,只借鉴不依赖;browser-use/Stagehand/LaVague 服务端形态不可用)

## 2. 技术栈与硬约定

| 项 | 约定 |
|---|---|
| 框架 | WXT 0.21 + React 19 + TypeScript,包管理 pnpm |
| 样式 | Tailwind v4(`@tailwindcss/vite`)+ shadcn/ui(new-york),token 在 `sidepanel/style.css` |
| 深浅色 | 自动跟随系统(`sidepanel/theme.ts` 渲染前切 `.dark`) |
| 加 shadcn 组件 | `pnpm dlx shadcn@latest add <name> -y -o`;已装:badge/button/checkbox/dialog/dropdown-menu/input/label/scroll-area/select/separator/switch/textarea/tooltip;**`components/ui/` 保持官方原样,严禁自定义组件/样式/变体** |
| AI 请求 | **`@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`**(见 §6/§7),sidepanel 直连,BYOK |
| 存储 | 设置/API Key → chrome.storage.local(`local:settings`);会话历史+草稿 → **IndexedDB**(`lib/sessionStore.ts`,`idb` 封装,旧 `local:sessions` 启动时一次性迁移);activeSessionId → chrome.storage.local;不引状态库;消息按 pi 消息联合形状持久化 |
| 页面引用 | 引用元数据 = user 消息 content 内嵌 `<page-refs>{JSON}</page-refs>` 块(唯一事实源:LLM 直读 + UI 解析同源,`lib/pageRefs.ts`);实时内容经 `extract_page`(tabId 句柄)/`read_element`(引用页内任意 CSS selector)工具按需读取 |
| manifest 权限 | `storage` / `sidePanel` / `unlimitedStorage` / `scripting` / `activeTab`(+ host_permissions http/https) |
| Markdown | react-markdown + remark-gfm + rehype-highlight + highlight.js(样式已在 style.css 引入) |
| 路径别名 | `@/*` → 项目根 |
| Shell | Git Bash;**context-mode 工具(ctx_batch_execute)实际跑 PowerShell,POSIX 语法会炸,多命令一律用 `bash` 工具** |
| 密钥 | 只存 `chrome.storage.local`;不打印/不提交任何 API Key |

## 3. 用户已拍板的决策(按时间序,勿推翻)

1. **提供商不搞预设列表**(旧的 DeepSeek/OpenRouter 预设已废弃)。多提供商管理,每个提供商独立配置。
2. 每个提供商选择接口协议 `api` 三选一,UI 命名:**OpenAI 兼容 · Chat Completions / OpenAI 兼容 · Responses / Anthropic Messages**(`openai-completions` / `openai-responses` / `anthropic-messages`);**anthropic baseUrl 按裸域名约定**(SDK 路径自带 /v1),`normalizeBaseUrl` 剥用户多填的尾部 `/v1`。
3. 支持从端点**拉取模型列表**、**测试连接**(复用拉取)、**手动添加模型**;每个模型可配参数:上下文窗口 / 最大输出 / 工具调用 / 图像识别 / 推理。
4. 模型参数用 **models.dev 自动预填**(`api.json` 免费无鉴权),不覆盖用户手填值,查不到留空。
5. **AI 请求用 `@earendil-works/pi-ai` + pi-agent-core**,不手写 SSE(曾实现过 `lib/stream.ts`/`lib/ai.ts`,均已删除)。
6. **设置页 = 整页视图切换**,点 Header 齿轮进入、Header 内切换 提供商/关于 两个视图(无 Tabs 组件);添加/编辑提供商 = **ProviderDialog 弹窗**(非整页 DetailView);拉取模型 = 弹窗内联勾选导入区(非独立 FetchModelsDialog)+ 独立「同步」按钮(models.dev 补全已有模型参数)。
7. **历史会话 = Header 内 DropdownMenu**(非 Dialog);页面上下文**默认开启**,引用 chip 在 Composer 上方管理;模型/思考等级切换在 Composer 内;Composer 工具栏 `[+ ▾]` = 框选元素/引用页面统一入口;tab chip 带元素 DropdownMenu。
8. **UI 禁用紫色/violet,一律 shadcn 默认中性样式**;严禁自定义组件/样式/变体(button.tsx 曾被加 xs/icon-xs,已重置;`components/ui/` 必须保持官方原样)。
9. **UI 由 designer 角色负责,主 agent 不擅自设计**(设计稿先行、确认后再实现;§5 保留当年的设计稿仅作历史参考,实际实现以代码为准)。
10. **agent 编排用 pi-agent-core**(`Agent` + `streamSimple`),页面操作工具自研(AgentTool);三期参考 Nanobrowser 的 chrome.debugger/CDP 动作层,只借鉴不依赖。
11. 聊天页功能基线(回归清单,不可丢):流式输出、停止按钮(取消保留已生成部分)、Enter 发送/Shift+Enter 换行/IME 组合词不误发、历史会话切换/删除/新建、消息复制、自动滚动(用户上翻不打断)、错误/取消的 UI 呈现、工具调用卡片、思考折叠区、token 脚注、会话草稿。
12. **引用架构定稿 = `<page-refs>` 块**:引用元数据发送时序列化进 user 消息 content,此后永不改变;无 refSnapshot 字段、无 convertToLlm、system prompt 不注入引用目录(只放协议常量规则);`ChatMessage` 回归纯 pi 联合,零自定义字段。
13. **会话草稿**:`Session.draft { input, refTabs, pickedElements }` 随会话持久化(IndexedDB 防抖落盘);新会话自动引用当前页;空会话离开即回收;发送即清空草稿。
14. **工具安全边界 = tab 级白名单**(tabId ∈ 草稿引用 ∪ 历史 `<page-refs>` 块);selector 不设白名单(框选元素是提示,AI 可在引用页内自行探索);vision 门控:`model.input` 含 image 才产 ImageContent 块;工具中文文案单一来源 `TOOL_LABELS`(读取网页内容/读取页面元素)。

## 4. 当前代码状态

lib 层 + sidepanel 全部 UI 已完成(含 page-refs 引用架构、read_element/框选、vision 读图);工作区未提交(git 仅一条 scaffold 基线提交)。

| 文件 | 状态 | 说明 |
|---|---|---|
| `lib/types.ts` | ✅ 完成 | `ApiType`/`ModelConfig`(含 `reasoningLevels`)/`ReasoningLevel`(`REASONING_LEVELS`/`REASONING_LEVEL_LABELS`)/`TOOL_LABELS`+`toolLabel`(中文单一来源)/`Settings`(含 `reasoningLevel`)/`RefTabMeta`/`RefElementMeta`/`PageRefs`/`ChatMessage`(纯 pi 联合)/`SessionDraft`/`Session`(含 draft)/`PickedElement`/`EXTRACT_PAGE_MESSAGE` |
| `lib/providers.ts` | ✅ 完成 | `API_TYPE_OPTIONS`(三协议+默认 baseUrl)、`normalizeBaseUrl`(anthropic 剥尾 /v1)、`apiTypeLabel`、`createProviderDraft`、`findActiveModel`、`getModelReasoningLevels`(空回退 low/medium/high)、`resolveReasoningLevel` |
| `lib/storage.ts` | ✅ 完成 | `settingsItem`/`activeSessionIdItem` + `sanitizeSettings`/`sanitizeSessions`(旧扁平消息结构按 pi 形状迁移)+ `uid/createSession(含 draft)/createUserMessage(text, refs?)/messageText/titleFromText/EMPTY_USAGE` |
| `lib/sessionStore.ts` | ✅ 完成 | 会话历史唯一读写层(IndexedDB,`idb` 封装):`listSessions`(按 updatedAt 降序)/`saveSession`/`deleteSession`/`migrateLegacySessions`(旧 `local:sessions` 一次性迁移后删除旧 key);草稿随 Session 一起存 |
| `lib/pageRefs.ts` | ✅ 完成 | `<page-refs>` 块纯函数:`renderPageRefsBlock`(序列化拼进 user content)/`parsePageRefs`(UI 解析渲染)/`stripPageRefs`(展示时剥块)/`collectPageRefs`(聚合历史块引用,做工具白名单) |
| `lib/agent.ts` | ✅ 完成 | pi-agent-core 桥接:`runAgentTurn()`(唯一发送入口:工具循环/abort/事件透出;白名单=草稿∪历史块;tabs 非空注入 extract_page,有可读 tab 注入 read_element)、`toPiModel`、`buildSystemPrompt()`(身份/语言 + `<page-refs>` 协议常量规则,不注入引用目录)、`createReadElementTool`(tab 级白名单 + vision 门控取图) |
| `lib/models.ts` | ✅ 完成 | `fetchProviderModels`(openai 兼容 Bearer / anthropic x-api-key+version,路径 openai=`/models`、anthropic=`/v1/models`)、`fetchModelsDevMeta`、`applyModelMeta`、`syncModelsWithModelsDev`(「同步」按钮:为已有模型补全参数)、`testConnection` |
| `lib/pageContext.ts` | ✅ 完成 | tab 级读取原语:`getActiveTabMeta`/`getTabMeta`/`listCandidateTabs`/`extractFromTab`/`renderPageContext`(content.ts 截 12000 字,本层透传)/`createExtractPageTool`;框选与元素解析:`startPickElement`(`ai-sidebar/pick-element`)、`resolveElement`(`ai-sidebar/resolve-element`,返回 markdown+images+dpr) |
| `lib/imageFetch.ts` | ✅ 完成 | read_element 取图管道:`fetchImageForModel`(fetch 主取)→ `captureCropForModel`(captureVisibleTab 按 rect×DPR 裁剪兜底,防盗链/403);canvas 降采样对齐 pi 上游:≤2000×2000、JPEG q0.8 起逐级降质、PNG/JPEG 取小、base64 ≤4.5MB |
| `lib/utils.ts` | ✅ 完成 | cn() |
| `entrypoints/content.ts` | ✅ 完成 | 结构化提取(article/main/[role=main] 优先,截 12000 字)+ 框选元素模式(@medv/finder 生成唯一 selector,结果经 `ai-sidebar/pick-element-result` 广播)+ 元素解析应答(`pick-element` 消息 `action:'resolve'`) |
| `entrypoints/background.ts` | ✅ 完成 | 点击图标打开侧边栏 |
| `entrypoints/sidepanel/App.tsx` | ✅ 完成 | ChatView ⇄ Settings 视图切换、runAgentTurn 编排、会话/草稿持久化(IndexedDB 防抖 400ms)、新会话自动引用、空会话回收、in-flight 消息列表 |
| `entrypoints/sidepanel/components/chat/` | ✅ 完成 | ChatHeader(模型/历史 DropdownMenu/设置入口)、MessageList(ResizeObserver 自动跟底)、MessageItem(引用 chip 解析渲染 `parsePageRefs`、ToolCallCard 四态+参数/结果展开、思考折叠区默认折叠+最新3行预览+思考中动画、token 脚注)、MarkdownView、ChatInput(Composer `[+ ▾]` 框选/引用入口、tab chip 带元素 DropdownMenu、模型+思考等级切换) |
| `entrypoints/sidepanel/components/settings/` | ✅ 完成 | SettingsMainView(提供商列表/关于)、ProviderDialog(增改提供商 + 内联拉取勾选导入 + 「同步」按钮)、ModelConfigDialog |
| `entrypoints/sidepanel/style.css` | ✅ 完成 | 主题 token + markdown 排版(`.md-*`)+ hljs 主题 + 6px 细滚动条 |
| `entrypoints/sidepanel/theme.ts` / `main.tsx` / `index.html` | ✅ 完成 | 不用动 |
| `components/ui/` | ✅ shadcn 官方原样 | **严禁自定义**;button.tsx 曾被加 xs/icon-xs,已重置 |

UI 细节基调:顶/底渐变遮罩衔接滚动区、用户气泡 `bg-secondary`、三点打字动画。

依赖:`@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`(^0.84.4)、`@medv/finder`(框选 selector)、`highlight.js`(11.x)、`idb`。pnpm 曾提示 `@google/genai`/`protobufjs` 构建脚本被忽略,无害。

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
const TOOL_LABELS: Record<string, string>;             // 工具中文名单一来源(extract_page=读取网页内容, read_element=读取页面元素)
interface ModelConfig { id: string; displayName?: string; contextWindow?: number;
  maxTokens?: number; tools?: boolean; vision?: boolean; reasoning?: boolean;
  reasoningLevels?: ReasoningLevel[];                  // 该模型支持的档位(不含 off;空回退 low/medium/high)
  prefilled?: boolean; }
interface ProviderConfig { id: string; name: string; api: ApiType; baseUrl: string;
  apiKey: string; models: ModelConfig[]; }
interface Settings { providers: ProviderConfig[]; activeProviderId: string | null;
  activeModelId: string | null; includePageContext: boolean; reasoningLevel: ReasoningLevel; }
// 引用元数据(user 消息 content 内嵌 <page-refs> 块的 JSON,发送后不可变):
interface RefTabMeta { tabId: number; title: string; url: string; focused?: boolean }
interface RefElementMeta { tabId: number; selector: string; tagName: string; preview: string }
interface PageRefs { tabs: RefTabMeta[]; elements: RefElementMeta[] }
type ChatMessage = UserMessage | AssistantMessage | ToolResultMessage;  // 纯 pi 联合,零自定义字段
interface SessionDraft { input: string; refTabs: RefTab[]; pickedElements: PickedElement[] }
interface Session { id; title; messages: ChatMessage[]; createdAt; updatedAt; draft?: SessionDraft }
interface PickedElement { id; tabId; selector; tagName; preview }       // 框选元素(@medv/finder 唯一 selector)

// lib/providers.ts
API_TYPE_OPTIONS: { value: ApiType; label: string; defaultBaseUrl: string }[]
normalizeBaseUrl(api: ApiType, url: string): string    // 去尾斜杠;anthropic 另剥尾部 /v1(裸域名约定)
apiTypeLabel(api: ApiType): string
createProviderDraft(): ProviderConfig
findActiveModel(settings): { provider; model } | null
getModelReasoningLevels(m: ModelConfig): ReasoningLevel[]   // 空/缺省回退 ['low','medium','high']
resolveReasoningLevel(m: ModelConfig, level: ReasoningLevel): ReasoningLevel

// lib/storage.ts(wxt storage item)
settingsItem        // 'local:settings',fallback DEFAULT_SETTINGS
activeSessionIdItem // 'local:activeSessionId'
sanitizeSettings(unknown): Settings
sanitizeSessions(unknown): Session[]            // 旧扁平消息 {id,role,content} → pi 形状(sessionStore 迁移用)
uid(): string; createSession(title?, draft?); createUserMessage(text, refs?): UserMessage  // refs 序列化进 <page-refs> 块
messageText(m: ChatMessage): string             // 提取纯文本(各消息类型归一;UI 展示文本用 stripPageRefs 再剥块)
titleFromText(text): string; EMPTY_USAGE

// lib/pageRefs.ts(<page-refs> 块纯函数,唯一事实源)
renderPageRefsBlock(refs: PageRefs): string     // 拼进 user content 的 JSON 块
parsePageRefs(content: unknown): PageRefs | null // UI 解析渲染 chip
stripPageRefs(content: string): string          // 展示时剥块
collectPageRefs(messages): PageRefs             // 聚合历史块引用 → 工具 tab 白名单

// lib/sessionStore.ts —— 会话历史唯一读写层(IndexedDB 'ai-sidebar' / store 'sessions',idb 封装;草稿随 Session 存)
listSessions(): Promise<Session[]>              // getAll,按 updatedAt 降序
saveSession(s: Session)                         // put
deleteSession(id: string)                       // delete
migrateLegacySessions(): Promise<Session[]>     // 旧 local:sessions 非空则清洗写入后删旧 key(只迁一次)
// 注意:IndexedDB 无跨上下文 watch;sidepanel 是会话历史唯一写方

// lib/agent.ts —— 发消息唯一入口
toPiModel(p: ProviderConfig, m: ModelConfig): Model<KnownApi>   // 缺失参数保守默认(128000/4096)
buildSystemPrompt(): string                     // 身份/语言 + <page-refs> 协议常量规则(不注入引用目录)
createReadElementTool(refTabs, pickedElements, canUseImage): AgentTool  // tab 级白名单;vision 门控取图
runAgentTurn({ provider; modelId; history: ChatMessage[]; userMessage: UserMessage;  // content 已内嵌 <page-refs> 块
  refTabs?: RefTab[]; pickedElements?: PickedElement[];                              // 当前草稿引用(App 已按开关过滤)
  thinkingLevel: ReasoningLevel; sessionId?; signal?; onEvent?: (e: AgentEvent) => void;
}): Promise<RunAgentResult>
// RunAgentResult { messages(完整转录); newMessages(本轮新增,含 toolResult); errorMessage? }
// 语义:工具白名单 = 草稿引用 ∪ collectPageRefs(history);tabs 非空注入 extract_page,
// 有可读 tab 注入 read_element;内部 new Agent({ streamFn: models.streamSimple, toolExecution:'sequential' });
// 失败经协议事件编码(stopReason='error');中止时已生成部分保留在转录中;onEvent 透出供 UI 流式渲染

// lib/models.ts —— 模型列表/预填/同步/测试(全项目唯一手写 fetch 的地方)
fetchProviderModels({ api, baseUrl, apiKey }, signal?): Promise<string[]>  // anthropic:x-api-key 头 + /v1/models
fetchModelsDevMeta(signal?): Promise<Map<string, ModelMeta>>
applyModelMeta(m: ModelConfig, meta?: ModelMeta): ModelConfig  // 不覆盖手填值,置 prefilled
syncModelsWithModelsDev(models, signal?): Promise<{ models; updatedCount }>  // 「同步」按钮
testConnection({ api, baseUrl, apiKey }): Promise<string>      // 复用拉取;成功返回提示文案,失败 throw

// lib/pageContext.ts(tab 级读取原语)
getActiveTabMeta(): Promise<RefTab | null>; getTabMeta(tabId): Promise<RefTab | null>
listCandidateTabs(): Promise<RefTab[]>        // 候选引用页(排除扩展自身等)
extractFromTab(tabId): Promise<ExtractedPage | null>  // sendMessage ai-sidebar/extract-page,失败 null 不阻塞
renderPageContext(page): string               // extract_page 工具回传给模型的正文文本
createExtractPageTool(refTabs): AgentTool     // 'extract_page':tabId 句柄读引用页正文
startPickElement(tabId): Promise<void>        // 广播 ai-sidebar/pick-element 进框选模式,结果经 pick-element-result 回传
resolveElement(tabId, selector): Promise<ResolvedElement | null>  // 元素解析(markdown+images+dpr),read_element 底层;复用 pick-element 消息 action:'resolve'

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
5. 消息历史:会话直接按 pi 消息联合(`ChatMessage`)持久化(存 IndexedDB,见 `lib/sessionStore.ts`),agent 回放零转换;引用信息不是自定义字段,而是 `<page-refs>` 块随 user content 原样抵达 LLM(无任何剥离/转换中间层);assistant 消息自带 thinking 块/toolCall/usage;旧扁平结构经 `sanitizeSessions` 在迁移时清洗(usage 补 `EMPTY_USAGE`)。
6. pi-ai 内部已设 `dangerouslyAllowBrowser: true`,官方支持浏览器端;Anthropic 的 `anthropic-version` 头由 pi-ai 处理;图像编码约定对齐 pi 上游 `image-resize-core.ts`(≤2000²/q0.8 起/4.5MB)。
7. **不要**给 pi-ai 传自定义 fetch、不要绕过它手写协议;模型列表拉取是全项目唯一手写 fetch 的地方(已在 lib/models.ts)。

## 8. 待办(按序)

1. **用户手动回归**(`pnpm dev` 自动拉起 Chrome 加载扩展):重点 = 普通对话、extract_page/read_element 工具触发、框选元素 + vision 读图、思考折叠区、token 脚注、流式中途停止、旧会话数据迁移;另过一遍设置页全流程(添加提供商→测试→拉模型→同步→改参数→设为当前→聊天)。
2. 剩余 quick wins:`err: any` → `unknown`;highlight.js 语言包裁剪(约 10 语言,主 chunk 941KB → 约 650KB);dev 可观测性(未知 `ai-sidebar/` 消息 console.warn)。
3. websearch / fetch_url 工具(读链接目标内容)。
4. 多语言:TOOL_LABELS 等文案收敛到 i18n(WXT 内建)。
5. 三期页面操作:授权门控 `createGatedTool` 先行 → screenshot → scripting 写动作 → 反馈闭环 → debugger 最后手段(参考 Nanobrowser 的 chrome.debugger/CDP 动作层,只借鉴不依赖)。
6. 发布:图标 + `wxt zip`。

## 9. 环境备注

- 无残留 dev 进程;直接 `pnpm dev`(自动拉 Chrome,扩展目录 `.output/chrome-mv3-dev`)。
- **改 content.ts/消息协议/权限后必须完整重启 `pnpm dev` 并刷新页面**:sidepanel 热更新 ≠ content script 更新,旧 content script 会继续应答过期协议。
- 浏览器 local storage 里可能残留旧结构 `local:settings`(须过 `sanitizeSettings`)与 `local:sessions`(启动时 `migrateLegacySessions()` 自动迁入 IndexedDB 并删除旧 key,只迁一次)。
- 本文档与工具无关(原在 pi 中编写,已去除 pi 专属工具链说明);Windows 下注意确认 agent 实际使用的 shell,POSIX 语法按实际情况调整。
