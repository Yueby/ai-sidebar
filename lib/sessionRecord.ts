import type { ChatMessage, Session, SessionCompaction, SessionDraft } from './types';

/**
 * 会话 JSONL 记录格式(对齐 pi-coding-agent session-format v3,**线性** id/parentId)。
 *
 * 存储介质:IndexedDB 中每会话存一条 JSONL 文本(`{ id, jsonl, updatedAt }`)——
 * 与 pi 会话文件逐行一致,WebDAV 可直接传文本。读写层负责序列化/解析,消费方面对 Session。
 *
 * 设计规格:docs/session-jsonl-format.md(决策 36/37;压缩摘要对齐 pi:
 * summary 由 compaction entry 承载,**不再作为 user 消息存在 messages**)。
 */

export const SESSION_RECORD_VERSION = 1;
/** header 的 cwd 占位(我们无工作目录概念,保持与 pi header 结构兼容) */
export const SESSION_RECORD_CWD = 'ai-sidebar';
/** 草稿 custom entry 的 customType */
export const DRAFT_CUSTOM_TYPE = 'ai-sidebar/draft';

// ── entry 类型(pi v3 对齐)────────────────────────────────────────────

export interface SessionRecordHeader {
  type: 'session';
  version: number;
  id: string;
  timestamp: string;
  cwd: string;
}

export interface SessionEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  /** entry 级 ISO 时间戳 */
  timestamp: string;
}

export interface SessionInfoEntry extends SessionEntryBase {
  type: 'session_info';
  name: string;
  /** 用户手动命名(customTitle) */
  custom: boolean;
}

export interface SessionMessageEntry extends SessionEntryBase {
  type: 'message';
  /** 原始 ChatMessage(含 refs 块与内联元素;请求面由 convertToLlm 展开) */
  message: ChatMessage;
}

export interface SessionCompactionEntry extends SessionEntryBase {
  type: 'compaction';
  /** 摘要正文(原压缩摘要 user 消息的 content,含 <context-summary> 块) */
  summary: string;
  /** 摘要消息的 timestamp(保留旧消费键:effectiveMessages 据此定位) */
  summaryTimestamp: number;
  /** 保留区首条 message entry 的 id */
  firstKeptEntryId: string;
  tokensBefore: number;
  compactedAt: number;
}

export interface SessionDraftEntry extends SessionEntryBase {
  type: 'custom';
  customType: 'ai-sidebar/draft';
  data: SessionDraft;
}

export type SessionEntry =
  | SessionInfoEntry
  | SessionMessageEntry
  | SessionCompactionEntry
  | SessionDraftEntry;

export interface SessionRecordFile {
  header: SessionRecordHeader;
  entries: SessionEntry[];
}

// ── 序列化:Session → JSONL ─────────────────────────────────────────────

/** 为一条 ChatMessage 生成 message entry(线性链) */
function messageEntry(id: string, parentId: string | null, msg: ChatMessage): SessionMessageEntry {
  return {
    type: 'message',
    id,
    parentId,
    timestamp: new Date(msg.timestamp).toISOString(),
    message: msg,
  };
}

/**
 * 把 Session 序列化为 JSONL 文本(每行一条 JSON)。
 * 摘要 user 消息(若 compaction.summaryTimestamp 指向它)**不**生成 message entry,
 * 而是生成 compaction entry(pi 语义:摘要由 entry 承载,不进转录)。
 */
export function sessionToJsonl(session: Session): string {
  const iso = (ms: number) => new Date(ms).toISOString();
  const header: SessionRecordHeader = {
    type: 'session',
    version: SESSION_RECORD_VERSION,
    id: session.id,
    timestamp: iso(session.createdAt),
    cwd: SESSION_RECORD_CWD,
  };
  const entries: SessionEntry[] = [];
  let prevId: string | null = null; // null = 挂 header
  // 确定性 id(顺序编号):迁移可重放——同输入产出逐字节一致的 JSONL
  let seq = 0;
  const nextId = () => `e-${++seq}`;

  // 会话信息(标题/手动命名)
  entries.push({
    type: 'session_info',
    id: nextId(),
    parentId: prevId,
    timestamp: iso(session.createdAt),
    name: session.title,
    custom: session.customTitle === true,
  });
  prevId = entries[entries.length - 1]!.id;

  // 消息流:摘要 user 消息(若 compaction 指向它)转为 compaction entry(只转第一条,防同毫秒撞车)
  let summaryTs = session.compaction?.summaryTimestamp;
  for (const msg of session.messages) {
    const isSummaryMessage = summaryTs !== undefined && msg.timestamp === summaryTs && msg.role === 'user';
    if (isSummaryMessage) {
      const content = typeof msg.content === 'string' ? msg.content : '';
      entries.push({
        type: 'compaction',
        id: nextId(),
        parentId: prevId,
        timestamp: iso(msg.timestamp),
        summary: content,
        summaryTimestamp: msg.timestamp,
        firstKeptEntryId: '', // 第二遍回填:指向保留区首条 message entry
        tokensBefore: session.compaction?.tokensBefore ?? 0,
        compactedAt: session.compaction?.compactedAt ?? Date.now(),
      });
      prevId = entries[entries.length - 1]!.id;
      continue;
    }
    const entry = messageEntry(nextId(), prevId, msg);
    entries.push(entry);
    prevId = entry.id;
  }

  // 回填 compaction 的 firstKeptEntryId = 摘要 entry 之后的第一条 message entry
  const compactionEntry = entries.find((e): e is Extract<SessionEntry, { type: 'compaction' }> => e.type === 'compaction');
  if (compactionEntry) {
    const idx = entries.indexOf(compactionEntry);
    const kept = entries
      .slice(idx + 1)
      .find((e): e is SessionMessageEntry => e.type === 'message');
    compactionEntry.firstKeptEntryId = kept?.id ?? compactionEntry.id;
  }

  // 草稿(非空才落,覆盖式:解析取最后一条)
  if (session.draft && (session.draft.input || session.draft.refTabs.length > 0 || session.draft.pickedElements.length > 0)) {
    entries.push({
      type: 'custom',
      id: nextId(),
      parentId: prevId,
      timestamp: iso(session.updatedAt),
      customType: DRAFT_CUSTOM_TYPE,
      data: session.draft,
    });
  }

  return [JSON.stringify(header), ...entries.map((e) => JSON.stringify(e))].join('\n');
}

// ── 解析:JSONL → Session ───────────────────────────────────────────────

/** 解析产生的会话(压缩语义已对齐 pi:summary 由 compaction 承载,不进 messages) */
export interface ParsedSessionRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  customTitle: boolean;
  /** 全部 message entries 的消息(线性链;含重建的摘要消息,消费方 effectiveMessages 照常工作) */
  messages: ChatMessage[];
  /** 压缩标记(与 Session.compaction 同形) */
  compaction?: SessionCompaction;
  draft?: SessionDraft;
}

/** 解析 JSONL 文本 → 会话对象;格式非法/缺 header 抛错 */
export function jsonlToSession(jsonl: string): ParsedSessionRecord {
  const lines = jsonl.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error('empty session record');
  let header: SessionRecordHeader | undefined;
  const entries: SessionEntry[] = [];
  for (const line of lines) {
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      throw new Error(`session record: invalid JSON line`);
    }
    const rec = obj as Record<string, unknown>;
    if (rec.type === 'session' && typeof rec.id === 'string') {
      header = rec as unknown as SessionRecordHeader;
      continue;
    }
    if (typeof rec.type !== 'string' || typeof rec.id !== 'string') {
      throw new Error(`session record: malformed entry`);
    }
    entries.push(rec as unknown as SessionEntry);
  }
  if (!header) throw new Error('session record: missing header');

  const messages: ChatMessage[] = [];
  let title = '';
  let customTitle = false;
  let draft: SessionDraft | undefined;
  let compaction: ParsedSessionRecord['compaction'] | undefined;
  let lastTs = Date.parse(header.timestamp);
  if (Number.isNaN(lastTs)) lastTs = Date.now();

  for (const e of entries) {
    const ts = Date.parse(e.timestamp);
    if (!Number.isNaN(ts) && ts > lastTs) lastTs = ts;
    if (e.type === 'session_info') {
      const info = e as Extract<SessionEntry, { type: 'session_info' }>;
      title = info.name ?? '';
      customTitle = info.custom === true;
    } else if (e.type === 'message') {
      messages.push((e as Extract<SessionEntry, { type: 'message' }>).message);
    } else if (e.type === 'compaction') {
      // 只认第一条 compaction entry(后续重复为脏数据,忽略)
      if (compaction) continue;
      const c = e as Extract<SessionEntry, { type: 'compaction' }>;
      // 重建摘要 user 消息(pi 语义:摘要由 entry 承载;解析时还原,消费方 effectiveMessages 照常工作)
      if (typeof c.summary === 'string') {
        messages.push({
          role: 'user',
          content: c.summary,
          timestamp: c.summaryTimestamp,
        } as ChatMessage);
      }
      // firstKeptEntryId → 保留区首条消息 timestamp(向后查找;找不到则全量保留)
      const kept = entries
        .slice(entries.indexOf(e) + 1)
        .find((x): x is Extract<SessionEntry, { type: 'message' }> => x.type === 'message' && x.id === c.firstKeptEntryId);
      const keptTs = kept ? Date.parse(kept.timestamp) : Number.MAX_SAFE_INTEGER;
      compaction = {
        summaryTimestamp: c.summaryTimestamp,
        tokensBefore: c.tokensBefore,
        compactedAt: c.compactedAt,
      };
    } else if (e.type === 'custom' && (e as { customType?: string }).customType === DRAFT_CUSTOM_TYPE) {
      draft = (e as Extract<SessionEntry, { type: 'custom' }>).data as SessionDraft;
    }
  }

  return {
    id: header.id,
    createdAt: Date.parse(header.timestamp) || lastTs,
    updatedAt: lastTs,
    title: title || '新会话',
    customTitle,
    messages,
    compaction,
    draft,
  };
}

// ── 迁移:旧 Session → JSONL(已移除:开发阶段无旧版兼容,唯一格式即 sessionToJsonl) ────────────────────────────────────

/**
 * finalize 落盘前的**转录单调性守卫**(纯函数,可单测)。
 *
 * Agent 自持转录只应增长(上游除 reset() 外不缩,本仓 reset() 零调用点)。一旦传入的
 * 转录比已存短,说明有路径递来了旧快照(播种自旧 store 副本 / dispose 后重建 / 编辑重发
 * 索引算错等)——直接覆盖会让“本轮乃至之前的回复”凭空消失。此处不丢已存历史,
 * 仅按对象身份补入缺失项,并回报 shrank 供上层告警定位真因。
 */
export function mergeTranscriptKeepingHistory<T>(
  existing: readonly T[],
  incoming: readonly T[],
  extra: readonly T[] = [],
): { messages: T[]; shrank: boolean } {
  if (incoming.length >= existing.length) return { messages: [...incoming], shrank: false };
  // 变短分支的去重不能只看引用(克隆来源会整段重复追加),也不能只看 role+timestamp
  // (同毫秒的两条排队消息会被误判为同一条 → 反而丢数据)。消息形状用 内容签名;
  // 非消息形状(测试/通用用法)回退到整体 JSON,避免所有普通对象退化成同一签名。
  const sig = (item: T): string => {
    const x = item as Record<string, unknown> | null;
    if (x && typeof x === 'object' && typeof x.role === 'string' && 'content' in x) {
      return `${x.role}|${String(x.timestamp ?? '')}|${JSON.stringify(x.content ?? null)}`;
    }
    return JSON.stringify(item ?? null);
  };
  const seen = new Set(existing.map(sig));
  const merged: T[] = [...existing];
  for (const item of [...incoming, ...extra]) {
    const key = sig(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return { messages: merged, shrank: true };
}
