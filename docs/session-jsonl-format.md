# 会话 JSONL 记录格式（设计规格）

> 目标 mttk9xo5 task-2。对齐 pi-coding-agent 的 session-format v3，**线性** id/parentId（决策 37：不做分支/fork/clone UI）。
> 状态：**设计定稿待实施**。实施前不得改动生产读写路径。

## 1. 依据与范围

pi 的会话文件是 JSONL：每行一个 JSON 对象（`type` 字段区分），条目通过 `id`/`parentId` 组成树。我们采用同一记录格式，但保持**线性链**（`parentId` 指向上一 entry），不做分支语义。

pi v3 entry 类型（`packages/coding-agent/src/core/session-manager.ts`）：

| 类型 | 字段 | 我们是否采用 |
|---|---|---|
| `session`（header） | `version, id, timestamp, cwd, parentSession?` | ✅ 采用（`cwd` 写 `"ai-sidebar"` 占位） |
| `message` | `message: AgentMessage` | ✅ 采用（现有 `ChatMessage` 直接落） |
| `compaction` | `summary, firstKeptEntryId, tokensBefore, details?, usage?` | ✅ 采用（替代现有 `Session.compaction.summaryTimestamp`） |
| `session_info` | `name?` | ✅ 采用（承载 `title`/`customTitle`） |
| `custom` | `customType, data?` | ✅ 采用（承载草稿 `ai-sidebar/draft`） |
| `thinking_level_change` / `model_change` | — | ⬜ 暂不采用（我们的思考档/模型是全局设置，非会话内切换） |
| `branch_summary` / `label` | — | ⬜ 不采用（无分支/书签需求，决策 37） |

## 2. 存储介质

**IndexedDB 中每会话存一条 JSONL 文本**（`{ id, jsonl: string, updatedAt: number }`），而不是物理文件：

- MV3 无普通文件系统；OPFS 可用但引入额外异步层与 WebDAV 序列化复杂度，收益仅为"像文件"。
- JSONL 文本与 pi 文件内容**逐行一致**，WebDAV 可直接传文本、也可与 pi 互导。
- 读写层负责序列化/解析，消费方仍面对 `Session` 对象（零侵入迁移）。

## 3. 记录格式（我们的一版）

```jsonl
{"type":"session","version":1,"id":"<sessionId>","timestamp":"2026-09-09T03:00:00.000Z","cwd":"ai-sidebar"}
{"type":"session_info","id":"e1","parentId":null,"timestamp":"...","name":"会话标题","custom":true}
{"type":"message","id":"e2","parentId":"e1","timestamp":"...","message":{"role":"user","content":"…","timestamp":123}}
{"type":"message","id":"e3","parentId":"e2","timestamp":"...","message":{"role":"assistant","content":[…],…}}
{"type":"compaction","id":"e4","parentId":"e3","timestamp":"...","summary":"<摘要 user 消息 content>","firstKeptEntryId":"e2","tokensBefore":12345}
{"type":"custom","id":"e5","parentId":"e4","timestamp":"...","customType":"ai-sidebar/draft","data":{"input":"…","refTabs":[…],"pickedElements":[…]}}
```

要点：

- `id`：`uuidv7` 风格有序 id（或现有 `uid()`；只需同会话内唯一 + 可排序）。
- `parentId`：线性链（新 entry 指向上一 entry 的 id；首条为 header id）。
- `timestamp`：entry 级 ISO 字符串；`message.timestamp` 保留毫秒数（pi 形状不变）。
- **user 消息 content 保持现有单一表示**：纯文本 + `<page-refs>` 块 + 内联 `<picked-element …/>`（不拆成 entry 字段）。
- `session_info.name` 承载 `Session.title`；`custom: true` 表示用户手动命名（对应 `customTitle`）。
- `compaction.firstKeptEntryId` 指向保留区首条 message entry（等价现有 `summaryTimestamp`，但更稳：不依赖时间戳唯一性）；摘要正文即 pi 的 `summary`。
- 草稿（`draft`）作为 `custom` entry 追加在尾部；`data` 与 `SessionDraft` 同形。
- `updatedAt` 由最后一条 entry 的 `timestamp` 推导（避免额外字段）。

## 4. 迁移策略（旧 IndexedDB → JSONL）

1. 启动时检测新 store（`sessions_v2`）是否为空且旧 store（`sessions`）非空 → 执行一次性迁移。
2. 每个旧 `Session` 生成：header → `session_info`（title/customTitle）→ 按序 `message` entries（线性 parentId）→ 若 `compaction` 存在追加 `compaction` entry（`firstKeptEntryId` = 摘要消息对应的 entry id）→ 若有草稿追加 `custom` entry。
3. **旧 store 保留只读**（不删除）作为回滚点；迁移完成后写 `local:sessionFormat=v1` 标记避免重复迁移。
4. 迁移必须**幂等**：同一会话已在新 store 则跳过；比对证据 = 逐会话 `messages.length`、refs 块存在性、`compaction` 指针、草稿字段。
5. 回滚：删除新 store 内容 + 清标记即可回到旧路径（旧 store 未被改动）。

## 5. WebDAV 同步影响（task-3 输入）

- 快照内容从"`Session[]` JSON"改为**每会话一条 JSONL 文本的集合**（bundle 结构：`{ version: 1, sessions: { [id]: "<jsonl>" } }` 或保持单文件多行）。
- 旧快照（`Session[]` JSON）**必须可读**：下载时按旧结构解析后走同一迁移函数转 JSONL。
- 恢复仍为单事务原子替换（先写新 store 全部，再切换标记）。

## 6. 未决问题（实施前需确认）

1. **草稿 entry 的位置语义**：追加在尾部会随每条消息增长；是否改为"覆盖式"（同 customType 只保留最后一条）？倾向覆盖式（解析时取最后一条）。
2. **`cwd` 字段**：我们无工作目录概念，写固定 `"ai-sidebar"` 还是省略？倾向写固定值（与 pi 结构兼容）。
3. **`message` entry 的 id 来源**：现有消息无 id（只有 timestamp）。迁移时生成新 id 并写入；新消息在 `createUserMessage`/落盘时补 id？还是解析时按顺序生成？倾向**落盘时生成并持久化**（回放稳定）。
4. **压缩摘要消息与 `compaction` entry 的关系**：现有实现把摘要作为一条 user 消息存在 `messages` 里；对齐 pi 后摘要是否仍进 `messages`？pi 的做法是 `compaction` entry 承载摘要、`buildSessionContext` 时注入。倾向**对齐 pi**（摘要不再进 messages，由解析层注入）——但会改动压缩语义，需单独评审。
