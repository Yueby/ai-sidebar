# 会话 JSONL 记录格式（当前实现）

> 目标 mttk9xo5 task-2。对齐 pi-coding-agent 的 session-format v3，**线性** id/parentId（决策 37：不做分支/fork/clone UI）。
> 状态：**设计定稿（2026-09 用户拍板）**。实施前不得改动生产读写路径。

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

## 5. WebDAV 同步影响（task-3 输入）

- 快照内容从"`Session[]` JSON"改为**每会话一条 JSONL 文本的集合**（bundle 结构：`{ version: 1, sessions: { [id]: "<jsonl>" } }` 或保持单文件多行）。
- 旧快照（`Session[]` JSON）**必须可读**：下载时按旧结构解析后走同一迁移函数转 JSONL。
- 恢复仍为单事务原子替换（先写新 store 全部，再切换标记）。

## 6. 已定决策（2026-09 拍板）

1. **压缩摘要：保留现有语义**——摘要仍作为 user 消息存在 messages（`summaryTimestamp` 定位键不变，消费方零改动）；JSONL 序列化时把它表示为 `compaction` entry（含 `summary` + `summaryTimestamp` + `firstKeptEntryId`，与 pi 格式同形），解析时重建为 user 消息。**完全对齐 pi（摘要不进 messages）列为后续独立任务**——需一并改 compaction/useCompact/contextTokens/导出/渲染。
2. **草稿 entry：覆盖式**——同 `customType: ai-sidebar/draft` 只保留最后一条，解析时取最后一条。
3. **cwd：写固定值 `"ai-sidebar"`**（保持与 pi header 结构兼容）。
4. **message entry id：确定性顺序编号**（`e-1, e-2, …`，迁移可重放——同输入产出逐字节一致的 JSONL）。
