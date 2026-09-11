# 当前阶段 / 开放项 / 待办

> 由 HANDOFF.md §8 拆分而来(2026-09-11)。回归验收清单见 `docs/regression-jsonl.md`,测试脚本见 `docs/test-prompts.md`。


0. **当前阶段(2026-09,决策 36-40 全部落地)**:会话运行时对齐 pi Agent(四步全完成)+ JSONL 存储(无兼容重构,决策 38)+ 压缩预算自适应(决策 39)+ 多会话并发隔离 + 聊天视觉改版(决策 40)+ 代码块 shiki 双主题 + 页面动作测试台(`fixtures/page-actions`,C 组验收工具)。自动化:40 测试全绿、compile/build 绿;独立 reviewer 两轮报告已全部处理。**回归进度**:清单六组(A/B/C/D/E/F)已全部真机通过并勾选(含 A 组新库往返——dev profile 持久化后可测,见 §9)。**但收尾被一个新报 P0 挡住(清单 G1)**:AI 回复突然消失、只剩刚发出的那条用户消息。**根因仍未定性**。已做的工作:①修掉三处真实但各自独立的缺陷——投影桥对非数组 content 的 `.filter` TypeError、事件 sink 无兜底(生命周期事件上抛异常确实会逃出 agent loop)、异常路径 `clearInFlight` 丢弃整轮转录而不落盘;②写边界加转录单调守卫(`mergeTranscriptKeepingHistory`,变短则保留已存 + 只补缺失 + 告警);③排队消息可见性、镜像队列补发、落盘失败文案。**已证伪的假设(探针实测,2026-09)**:订阅者在 `message_update` 抛异常**不会**逃进 `runAgentTurn` 的 catch——pi 的 `runWithLifecycle` 把它吞成 `stopReason:"error"` 的助手消息,走正常 finalize(结果是“回复没了 + 错误横幅”,不是“store 只剩用户消息”)。早期的“最终触发链”叙述与其一并作废;逃逸只在生命周期事件(`agent_start`/`turn_start` 等)上抛时发生,是更宽的假想场景。**已排除的第三个候选(2026-09 读码核对)**:草稿防抖队列(`sessionSlice.pendingDraftSaves`)存的是**整个 Session 快照**,看似能把"缺少本轮回复的旧快照"写进 IDB;但①`saveSession` 是**按会话单键 put**(非整库重写),最多覆盖自己那一条;②发送 / 正常 finalize / 异常 finalize(`persistTranscriptAfterFailure`) / 队列泵 finalize **四处都 `dropPendingDraftSave(sid)`**,③`commitSessions` 保证"set 先于入队"(入队即内存最新对象)。三条合起来封死该路径。**已排除的第四个候选(2026-09 读码核对,持久化往返)**:"写进 IDB → 重开面板加载"是否可能丢消息——①`sanitizeMessage` 对 `user`/`assistant` **永不丢弃**(仅 `toolResult` 在缺 `toolCallId`/`toolName` 时丢弃,而 pi 必然带上);②`jsonlToSession` 对 `message` 条目**零校验原样 push**,header/entry 只要求 `type`+`id`,而我们写入时恒有;③`listSessions` 的行级容错是**整会话级**(坏行→丢整个会话,不是丢部分消息),与"会话仍在但回复没了"不符;④草稿防抖写与 finalize 的提交顺序由 IDB 事务创建序保证,且发送/两条 finalize/队列泵四处均 `dropPendingDraftSave`。
**顺带记录(非 P0)**:`listSessions` 对单行损坏采取"丢整个会话 + console 警告"的 fail-safe;行由我们自己原子写入,正常不会损坏,故不改。
**P0 再现时的取证清单(插桩已在代码里,勿删)**:
- `[p0:run] begin <sid> seq=N 重置前 inFlight=… liveChars=…` / `[p0:run] end …`(sessionRuntime.ts)——运行时快照被重置的那一刻,以及重置前还有多少内容没落盘;
- `[p0:run] 删除 runs[<sid>]`(chatSlice.ts)——dispose 路径删掉了整条 run(会让 live 与 in-flight 同时从屏幕消失);
- `[p0] <sid> | live 被清空但 in-flight 未接管 …` 与 `in-flight 减少 … / 会话转录减少 …`(App.tsx / MessageList.tsx)——渲染源掉了哪一个;
- `[agent] event sink failed: <事件类型>`(agent.ts)——订阅者异常(生命周期事件上的抛出会逃出 agent loop);
- `Agent transcript shrank (N → M)`(sessionRecord.ts 的单调守卫)——有人试图用更短转录覆盖 store(已被守卫拦下并保留原内容);
以上任一行出现即把原始行留档送修;**没有这些行**说明丢的不是这几条路径,应转向渲染层(scroll/过滤)排查。

**当前领先候选(待真机验证,复审 P1)**:助记/工具结果只进内存 `runs[sid].inFlight`,**直到 finalize 才落盘**;回合中途面板文档被销毁(关闭侧边栏/Chrome 回收/dev 重载)即丢掉整轮,重开后只剩发送时写入的那条用户消息——与症状高度吻合。**待真机确认**:G1 是否复现 + 代码块着色。确认通过后接:i18n 收敛 → 发布(图标 + `wxt zip`)。

1. **用户手动回归** —— ✅ 已完成(2026-09,覆盖:普通对话、read/search/fetch/click 全链、点击 _blank 跳转修复、导出、设置抽屉/模型分工/语言/思考档、引导弹窗、删除确认);后续每次新功能按验收标准随批回归。
1b. ~~fake-indexeddb 补 sessionStore 覆盖~~ ✅ **已完成(2026-09-11)**:`tests/session-store.test.ts` 用 `fake-indexeddb` 在 node 里跑真实 IDB 语义,覆盖六条契约——往返无损(消息/引用块/草稿/压缩标记)、幂等、updatedAt 降序、坏行容错(非法 JSON 与缺 header 各告警一次且不炸全表)、单事务原子替换、单条删除。**由此钉住两条原本只在代码里的契约**:①`sanitizeDraft` 要求 `elementId` 为**正整数**才保留元素引用,并自动补 `id`(tabId:selector)与 `preview`;②compaction 标记**必须由一条 user 摘要消息承载**才落盘,无该消息时标记被归一化丢弃(不留指向空处的指针)。**有效性经注入实验验证**:改坏 `fromRow` 的 compaction 映射,往返用例立即失败。A 组真机回归不再是唯一覆盖。
2. ~~websearch / fetch_url 工具~~ **已完成**(2026-09,十源 + fetch_url;见 §4 状态表与 §6 API 参考)。
3. ~~多语言:TOOL_LABELS 等文案收敛到 i18n~~ ✅ **已完成**(2026-09,决策 45:362 键 × 2 语言,剩余中文仅 DEV 日志/原生语言名/兜底表)。
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
   - **参考**:AhYi8/browser-ai-assistant(CDP 驱动,特权层不可移植;可搬=AX 行格式/噪点过滤/预算截断/受控 fill 法/遮挡检测/wait_for_state 有界轮询/fail-closed 校验——参考仓按需拉取(本地克隆已清理,见 AGENTS.md),只读)
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
7. 发布:图标 + `wxt zip` —— ✅ 包已产出(2026-09-11,`0.1.0`,`.output/ai-sidebar-0.1.0-chrome.zip`);剩余 = 商店 listing(截图 + 文案,用户决定暂缓)。

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
