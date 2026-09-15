# 当前阶段 / 开放项

> 决策史见 `docs/decisions.md`,避坑见 `docs/pitfalls.md`,手动回归见 `docs/regression.md`,会话存储格式见 `docs/session-jsonl-format.md`。
> 本文件只保留**当前状态**与**尚未收尾的事**;历史批次已完成,记录在 git 与决策日志里。

## 当前阶段(2026-09)

产品已可用并已产出发布包(`0.1.0`,`.output/ai-sidebar-0.1.0-chrome.zip`)。三期(ARIA 定位与页面动作原语)步①-⑤全部落地:发现层 `search_element`、动作原语 `click_element`/`fill_element`/`scroll_page`/`screenshot_page` + 会话级 grant、返回模板 v2(页面指纹 + after 注记)、`chrome.debugger` 可信滚轮兜底。四期步①(自定义规则 + 提示词注入架构)已落地。i18n 已收敛(决策 45)。会话运行时对齐 pi Agent(决策 36)、JSONL 存储(决策 38)、压缩预算自适应(决策 39)、聊天视觉改版(决策 40)。

## 待办

1. **手动回归**(`docs/regression.md`):按域抽取,重点 A 组引用与页面上下文、C 组页面动作、F 组性能观感。
2. **发布收尾**:图标已完成;剩余 = 商店 listing(截图 + 文案)。用户决定暂缓上架。
3. **开放项(需拍板)**:
   - 跨源 iframe 读取的 CDP 兜底:`Accessibility.getFullAXTree`(逐 frame 取),经 `lib/cdp.ts` 白名单启用;代价 = 期间显示"正在调试"横幅,建议仅在显式请求时启用。
   - Defuddle 作为第二抽取器与 Readability A/B(1 个新依赖)。
   - 四期后续(规格见决策/历史):**技能核心已落地**(决策 52:存储 + catalog 注入 + `read_skill`/`save_skill` + 三个内置技能);**剩余 = 压缩豁免(含 `<skill_content` 的消息不得被摘要扫走)+ `/skill:name` 斜杠命令 + 设置页技能视图 + 自造/安装的交互层 + 同步纳入 rules/skills**;再往后是自动反思。
4. **性能残留(已量化,未定位)**:流式 + 40 条消息时约 140 renders/s(全量重渲约 580,即每次 flush 仍重渲 3-7 条);工具循环阶段为 10/s 与 2/s,已在理论下限。剩余嫌疑:新消息追加时 `quietFrom` 位移导致尾部若干项 props 变化。要继续压则加 per-item 诊断(打印哪一项、因哪个 prop 变化)。
5. **观察项**:工具 grant 当前是**面板级**(决策 22,关面板失效),与引用/开关的"会话级"不同域;如需一致再做。

### 已知限制(有意保留)

- **`read_element` 原样返回 `outerHTML`**:页面若把密钥写进 HTML 属性(`value`/`data-*` 等)会随之带出。这是页面自身把值写进了标记,而非我们渲染了输入框的值(`a11yValue` 对密码字段**始终不回传**);如需彻底避免,只能改为不回传任何属性,代价是元素结构信息大幅减少。
- **坐标点击不做元素校验**:`click_element` 的 `x`/`y` 路径按视口 CSS 像素直接派发受信点击,**不做元素解析、不滚动、不高亮、不判遮挡** —— 点到什么就是什么(这正是它的用途,也是它的风险)。它与其它寻址方式**共用同一 grant**(`click_element@<tabId>`):一旦用户勾选"本会话内允许",坐标点击也免确认。截图结果会附带视口尺寸与设备像素比,用于把截图像素换算成坐标。
- **选择符组合器**(`>`/`+`/`~`)在**影子树内**不支持:跨 shadow 下潜是按后代空格逐段查,`>` 段无法相对求解(光 DOM 仍由原生 `querySelector` 回退覆盖)。需要时可扩为相对查询。

## P0:消息消失(未复现,取证清单保留)

近几轮(含多会话并发、页面读取、动作压测)均未复现。插桩留在代码里(**勿删**),再现时收集下面任一行:

- `[p0:run] begin <sid> seq=N 重置前 inFlight=… liveChars=…` / `[p0:run] end …`(`sessionRuntime.ts`)——运行时快照重置的那一刻,及重置前还有多少内容未落盘;
- `[p0:run] runs[<sid>] removed after run end (store msgs=N)`(`chatSlice.ts`)——dispose 路径删掉整条 run(会让 live 与 in-flight 同时消失);N=0 才是真凭证;
- `[p0] <sid> | live 被清空但 in-flight 未接管 / in-flight 减少 / 会话转录减少`(`App.tsx` / `MessageList.tsx`)——渲染源掉了哪一个;
- `[agent] event sink failed: <事件类型>`(`agent.ts`)——订阅者异常(生命周期事件上抛会逃出 agent loop);
- `Agent transcript shrank (N → M)`(`sessionRecord.ts` 单调守卫)——有人试图用更短转录覆盖 store(已被拦下并保留原内容)。

**没有这些行**说明丢的不是这几条路径,应转向渲染层(scroll/过滤)排查。

**领先候选(待验证)**:助记/工具结果只进内存 `runs[sid].inFlight`,直到 finalize 才落盘;回合中途面板文档被销毁(关闭侧边栏 / Chrome 回收)则这部分内容随之丢失。兜底已加:`flushActiveTranscripts()`(visibilitychange/pagehide,幂等)。

**历史排查记录**:投影异常逃逸与更短转录覆盖两条假设都用探针实测**证伪**了(详见 `docs/decisions.md`);`message_update` 上抛会被 `runWithLifecycle` 吞成 `stopReason:'error'` 的助手消息,只有生命周期事件(agent_start/turn_start)上抛才逃逸整轮。

## 页面读取能力(v2)验证记录(2026-09,fixtures/page-read)

| 契约 | 结论 | 证据 |
|---|---|---|
| `read_page mode=tree` 名价成组 | ✅ 已验证 | 模型自述"顺序是 `img(封面) → link(游戏名) → text(价格)`,三组依次排列,数量一一对应,没有错配" |
| 树输出 `#id` 句柄 | ✅ 已验证 | 树里出现 `#deals-title`/`#shadow-text` 等 28 处,模型照抄 `#shadow-text` 一次命中 |
| role+name 穿透开放 shadow root | ✅ 已验证 | 模型结论"role+name 能穿透 open shadow root,selector 之前全败,而 role+name 一次读到" |
| `read_element` 双轨寻址 | ✅ 已验证 | `region "今日特惠"` 命中;`selector: "#shadow-host p"` 返回 `<p id="shadow-text">…ZEBRA-SHADOW-1</p>` |
| `search_element` 值/状态/链接去向 | ✅ 已验证 | 出现 `= "prefilled@example.com"`、`[checked]`、`[unchecked]`、`[disabled]`、`→ ./child.html` |
| iframe:同源可读 + 跨源被明说 | ✅ 已验证 | 同源读到 `TIGER-CHILD-9`;跨源以说明节点报出并建议 `open_page` |
| 树不泄漏 script/style 源码 | ✅ 已修(代码级) | 曾泄漏(`<script>` 被当无角色叶子),现排除非内容标签与不可见元素 |

## 自动化测试

```bash
npx tsx --test "tests/*.test.ts"
```

覆盖:会话 JSONL 记录往返/幂等/坏行容错(`session-store`)、转录单调守卫(`agent-transcript`)、Agent 队列(`agent-queue`)、运行时投影(`session-runtime`)、store 并发与队列(`store-concurrency`/`store-queue`)、工具注册面与工具助手(`tool-registry`/`tool-helpers`)、同步 bundle(`sync-bundle`)、可访问性树序列化(`a11y-tree`)、**网页引用决策纯逻辑(`ref-groups`)**。

引用/会话这块的规则此后由 `lib/refGroups.ts`(纯函数)+ `ref-groups` 测试钉住:新增规则请优先写成纯函数并补测试,不要在 hook 的 effect/async 里就地判断——历史上一连多轮缺陷都出在那里。
