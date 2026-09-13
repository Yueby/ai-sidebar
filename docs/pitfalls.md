# 避坑与环境备注

> 由 HANDOFF.md §5.7 / §7 / §9 拆分而来(2026-09-11)。这些是踩过的坑,勿重复踩。

## UI / 样式 / React 渲染


1. 拉取/模型参数用 Dialog 居中覆盖,**不要**在页内塞深层 Accordion(360px 下滚动体验差)。
2. Base URL/API Key 必须 `truncate`,严禁横向滚动条。
3. API Key 默认 `type="password"`,右侧绝对定位 Eye/EyeOff ghost 按钮。
4. **项目级样式覆盖不得与元素自带的 utility 类争同一属性**(Tailwind v4 层序 theme < base < components < **utilities**,`@layer components` 里的 `@apply`/声明永远输给写在 JSX className 上的 utility → 静默失效)。要覆盖官方组件 className 已有的属性(宽/高/self-*/translate-*/z-*/margin/圆角等),只有两条路:**加 `!important`**,或**把规则移到所有 `@layer` 之外**(未分层高于任何分层)。已踩两次:头像 `self-start`(`components/ui/message.tsx` 自带 `self-end`)、toast viewport 宽度(官方 `w-auto`);两处均靠消费处 className 覆盖(tailwind-merge 去重)或 `!important` 生效。
5. **React 不跨 JSX 子节点槽位复用实例**——同一个元素数组与一个条件兄弟节点即使写了**完全相同的 key**,协调时也不会复用(旧代码注释曾声称“live 槽键 = 未来物化位置 → 零重挂载”,该断言本身就是错的)。流式末条与物化消息必须活在**同一个数组**里才能原键协调;同时子项 key 要按**类型**而非位置(`thinking-${j}`/`text-${j}`),否则流式 content `[text]` 变物化 `[thinking, text]` 时索引位移会整块重建 markdown。另:注释与断言不算证据,改动靠生成产物/代码路径取证。

## pi-ai / pi-agent-core 使用要点


1. 协议实现用 **`.lazy` 导入**(树摇友好,SDK 按需 chunk):`@earendil-works/pi-ai/api/openai-completions.lazy` 等,工厂函数 `openAICompletionsApi()` / `openAIResponsesApi()` / `anthropicMessagesApi()`;三种实现已在 `lib/agent.ts` 的 `API_IMPLEMENTATIONS` 组装好。
2. `createProvider({ id, name, baseUrl, auth: { apiKey: { name, resolve: async () => ({ auth: { apiKey } } }) }, models, api })`;BYOK 场景在 resolve 闭包里给 key,每次请求前重建 provider(对象创建很便宜)。
3. `Model` 必填字段:`{ id, name, api, provider, baseUrl, reasoning, input: ('text'|'image')[], cost(全 0 即可), contextWindow, maxTokens }`——`toPiModel` 已处理缺失参数的保守默认(128000/4096);`input` 含 image 与否是 read_element 产图块的 vision 门控同源(`model.input.includes('image')`),pi-ai `downgradeUnsupportedImages` 是双保险。
4. **agent 编排不要直接调 `models.stream`,一律走 pi-agent-core 的 `Agent`**(`streamFn: (m, ctx, o) => models.streamSimple(m, ctx, o)`);`runAgentTurn` 已封装工具调用循环/中止/事件透出,UI 只消费 `AgentEvent`。
5. 消息历史:会话直接按 pi 消息联合(`ChatMessage`)持久化(存 IndexedDB,见 `lib/sessionStore.ts`),agent 回放零转换;元素引用以 `<picked-element …/>` 块内嵌 user content 原样抵达 LLM(存储/LLM 同串,唯一差异 = LLM 请求副本把 `<page-refs>` 块剥 elements 留 tabs,`agent.ts toLlmMessage`);assistant 消息自带 thinking 块/toolCall/usage;旧扁平结构经 `sanitizeSessions` 在迁移时清洗(usage 补 `EMPTY_USAGE`)。
6. pi-ai 内部已设 `dangerouslyAllowBrowser: true`,官方支持浏览器端;Anthropic 的 `anthropic-version` 头由 pi-ai 处理;图像编码约定对齐 pi 上游 `image-resize-core.ts`(≤2000²/q0.8 起/4.5MB)。
7. **不要**给 pi-ai 传自定义 fetch、不要绕过它手写协议;模型列表拉取是全项目唯一手写 fetch 的地方(已在 lib/models.ts)。

## 环境备注

- **本环境的 dev watcher 曾不可靠**(chokidar 在 agent 后台会话静默失效):已改 wxt.config `server.watch` 轮询(1s)后基本稳定;仍偶发失效——若改代码不生效,先查 `.output/chrome-mv3-dev` mtime 再重启 `pnpm dev`(交互会话约 25 分钟上限,后台 dispatch 用显式长 timeout,单位毫秒)。
- **dev 产物配置 `emptyOutDir: false`**(wxt.config vite.build):重建不清空输出目录——旧 hash chunk 保留,长活侧边栏页面的动态 import 不会 404 断链(曾导致多标签测试中回合中断、未落盘消息全部丢失)。**发布打包前手动清一次 `.output/chrome-mv3`**,避免旧 chunk 混入 zip。
- 无残留 dev 进程;直接 `pnpm dev`(自动拉 Chrome,扩展目录 `.output/chrome-mv3-dev`)。
- **改 content.ts/消息协议/权限后必须完整重启 `pnpm dev` 并刷新页面**:sidepanel 热更新 ≠ content script 更新,旧 content script 会继续应答过期协议。
- **dev 浏览器 profile 已持久化**(`wxt.config.ts` 的 `webExt.chromiumProfile = .wxt/chrome-data` + `keepProfileChanges`):重启 `pnpm dev` **不再清空 IndexedDB/登录**,所以“重启后数据还在吗”这类回归(A 组)可以真机验证。两个约束不得回退:①目录必须在配置加载时 `mkdirSync` 自建(chrome-launcher 要在里面写 `chrome-out.log`,不存在直接 ENOENT 启动失败);②不要改回默认临时 profile——那会让所有依赖重启的持久化测试不可测。副作用:dev 登录态/扩展设置会跳会话保留(属预期;profile 住在 `.wxt` 不入库)。
- 浏览器 local storage 里可能残留旧结构 `local:settings`(须过 `sanitizeSettings`);会话存储已无兼容重构(决策 38):旧 `local:sessions`/对象 store/旧库 `ai-sidebar` 均不再读写,新数据全在库 `ai-sidebar-sessions`,旧数据要么丢弃要么手动导出。
- 本文档与工具无关(原在 pi 中编写,已去除 pi 专属工具链说明);Windows 下注意确认 agent 实际使用的 shell,POSIX 语法按实际情况调整。

## 初同步写成"依赖自己产出的状态"= 永不发生(2026-09,页面引用)

`usePageContextRefs` 里"总开关开启时切回当前焦点页"的 effect 判据是 `focusedTabIdRef.current !== null`,而该 ref **只在 `switchRefGroup` 内部被赋值** → 首次挂载时恒为 null,初同步永远不执行。症状:打开新会话后不点一下页面就不会引用当前页(要靠 `tabs.onActivated` 事件来"启动"),新建会话与重开总开关同样失效。修法:初同步**自己查** `getActiveTabMeta()`(空草稿才入住,已有引用不动)。

教训:任何"启动/首帧同步"逻辑,判据不能取自被启动的那个流程自身产出的状态;否则失败静默、且只在"用户恰好做了某个动作"时才看似正常。


## 一个 ref 兼两种语义 / 布尔闩守卫可重复流程(2026-09,页面引用跟随)

**症状**:正常网页之间切换 tab,引用栏**不跟随**(仍显示上一个页面);新建会话也不再自动引用当前页。

**形态一(切 tab 不跟随)**:`usePageContextRefs` 用同一个 ref 同时承担两种语义——「最新焦点请求」(防快速连切的竞态判据)与「草稿已反映的 tab」(组记忆归属判据)。二者在**切换窗口内**不一致(焦点已是 B、草稿还是 A),此时任何草稿变动(开面板时的初同步写入、tabMeta 的 title/url 同步等)都会把 A 的工作集记到 B 头上(`group[B] = [A]`);之后切到 B 时命中"已是该组"的幂等判定直接 `return` → 芯片永不更新。**修法**:拆成 `focusedTabIdRef`(请求)与 `appliedTabIdRef`(已落地),组记忆只认后者。

**形态二(新建会话不引用)**:初同步要"作废读取期间发生焦点事件的快照",一处实现写成布尔闩(`focusEventRef.current = true` 后永不复位)。而初同步在**每次会话切换**都会重跑 → 一旦切过 tab,之后所有初同步永久早退。**修法**:改世代号——读取前记下 `seq`,读取后比较,只作废本次读取期间发生的事件。

**教训**:①凡"发起"与"落地"是两个时刻的流程,判据必须按语义分开存,不要一个 ref 兼任;②用"曾经发生过某事"的布尔去守卫可重复执行的流程,必然闩死;要记录区间就用世代号/时间戳。

## 会话级状态被塞进全局设置 + 没有回程的自动关闭(2026-09,网页引用开关)

"删掉最后一个引用 = 关闭网页引用"这条心智把开关写进了全局 `Settings`:在某个会话里点掉最后一个芯片 → **新会话也不再自动引用当前页**,而全应用没有任何 UI 能把开关打开 → 用户看到的是"功能彻底坏了",重启面板也不恢复(值已落盘)。两条独立教训:

1. **与单个会话绑定的状态必须存在那个会话的数据里**(draft),不要放进全局设置。
2. **任何"自动关闭"都必须有一条显式回程**(能打开的 UI);没有回程的自动关闭就是单向陷阱,用户只能重置数据。

### 同一教训的第二处:面板级 Map 也会跨会话串味(2026-09,引用组记忆)

把会话级状态放进全局设置修掉后,同类错误又出现在**引用组记忆**上:它是面板级单 map(只按 tabId 索引),而引用是会话级的 → 旧会话的引用集被记到"当前 tab"名下,新会话入住同一 tab 时恢复成旧会话的引用(实测:新会话引用到旧会话的页面)。

判据:**凡是保存"某个会话在某 tab 上的工作集"这类记忆,键里必须带 sessionId**。跨会话共用任何按 tab 索引的缓存都要先问一句:这份记忆属于哪个会话?

## await 之后才解析"当前 X",等于把动作归给了错的对象(2026-09,引用切换)

`switchRefGroup` 先 await 取 tab 元信息,再 `selectCurrentSession(getState())` 决定往哪个会话写引用 —— 期间用户切了会话,
这次"当前 tab"就被写进了**另一个会话**的草稿(实测:切到旧对话时它引用了新对话的 tab)。同类:`for await` 循环里再读"当前选中项"。

判据:**凡是异步流程,上下文标识(会话 id、请求 id、tab 句柄)必须在入口处取快照**,await 之后要么用快照,要么校验未变再继续;绝不在 await 之后再问"现在是谁"。

