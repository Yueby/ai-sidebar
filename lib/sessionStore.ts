import { openDB, type IDBPDatabase } from 'idb';
import { storage } from 'wxt/utils/storage';
import type { Session } from './types';
import { sanitizeSessions } from './storage';
import {
  sessionToJsonl,
  jsonlToSession,
  migrateSessionToJsonl,
} from './sessionRecord';

/**
 * 会话持久化(决策 36 task-2):**JSONL 记录**为唯一执行格式。
 *
 * 存储演进链(每级迁移后清理上游,旧级保留只读作为回滚点):
 *   local:sessions(最旧,内存数组) → sessions(对象) → sessions_v2(JSONL 文本)
 *
 * 公开 API 签名与重构前一致(消费方面对 Session 对象,零改动);
 * JSONL 序列化/解析封装在本层内部(lib/sessionRecord.ts)。
 */

const DB_NAME = 'ai-sidebar';
const DB_VERSION = 2;
const SESSION_STORE = 'sessions'; // 旧对象格式(仅迁移读取,不再写入)
const SESSION_STORE_V2 = 'sessions_v2'; // JSONL 文本(当前格式)
const LEGACY_KEY = 'local:sessions'; // 最旧的内存数组格式
const FORMAT_FLAG = 'local:sessionFormat'; // 'jsonl' = 已迁移到 v2

/** v2 行:JSONL 文本 + 冗余 updatedAt(排序用,免解析) */
interface SessionRecordRow {
  id: string;
  jsonl: string;
  updatedAt: number;
}

/** 模块级惰性单例 */
let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore(SESSION_STORE, { keyPath: 'id' });
        }
        if (oldVersion < 2) {
          db.createObjectStore(SESSION_STORE_V2, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

// ── JSONL 行 ↔ Session(封装在本层,消费方零感知)────────────────────────

function toRow(session: Session): SessionRecordRow {
  return {
    id: session.id,
    jsonl: sessionToJsonl(session),
    updatedAt: session.updatedAt,
  };
}

function fromRow(row: SessionRecordRow): Session {
  const parsed = jsonlToSession(row.jsonl);
  return {
    id: parsed.id,
    title: parsed.title,
    customTitle: parsed.customTitle,
    messages: parsed.messages,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt ?? row.updatedAt,
    compaction: parsed.compaction,
    draft: parsed.draft,
  };
}

// ── 迁移链 ─────────────────────────────────────────────────────────────

/** 旧对象行 → v2 JSONL 行(migrateSessionToJsonl 处理摘要消息 → compaction entry) */
function legacyToRow(s: Session): SessionRecordRow {
  return {
    id: s.id,
    jsonl: migrateSessionToJsonl(s),
    updatedAt: s.updatedAt,
  };
}

/**
 * 全量迁移链(启动时调用一次,幂等):
 * 1. local:sessions(最旧)→ sessions 对象 store;
 * 2. sessions 对象 store → sessions_v2 JSONL(逐会话,含摘要消息 → compaction entry 转换)。
 * 迁移后清理上游(旧 local key 删除;旧对象 store 保留只读作为回滚点)。
 * 返回 v2 的全部会话(按 updatedAt 降序)。
 */
export async function migrateAllSessions(): Promise<Session[]> {
  const db = await getDB();

  // 1) local:sessions → 对象 store(旧迁移,保持原语义)
  const legacy = await storage.getItem<unknown[]>(LEGACY_KEY);
  if (Array.isArray(legacy) && legacy.length > 0) {
    for (const s of sanitizeSessions(legacy)) {
      await db.put(SESSION_STORE, s);
    }
    await storage.removeItem(LEGACY_KEY);
  }

  // 2) 对象 store → v2 JSONL(逐会话;已迁移则跳过)
  const flag = await storage.getItem<string>(FORMAT_FLAG);
  if (flag !== 'jsonl') {
    const legacyRows = (await db.getAll(SESSION_STORE)) as Session[];
    const tx = db.transaction(SESSION_STORE_V2, 'readwrite');
    for (const s of legacyRows) {
      // 幂等:同 id 已在 v2 则跳过(重复迁移不产生重复条目)
      const existing = await tx.store.get(s.id);
      if (!existing) void tx.store.put(legacyToRow(s));
    }
    await tx.done;
    await storage.setItem(FORMAT_FLAG, 'jsonl');
  }

  return listSessions();
}

// ── 公开 API(签名与重构前一致)────────────────────────────────────────

/** 全部会话,按 updatedAt 降序;读取路径统一过 sanitize(旧格式迁移 + pi 形状透传归一) */
export async function listSessions(): Promise<Session[]> {
  const db = await getDB();
  const rows = (await db.getAll(SESSION_STORE_V2)) as SessionRecordRow[];
  const sessions = rows
    .map(fromRow)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  // 读取路径统一过 sanitize(旧格式迁移 + pi 形状透传归一)——与旧路径同款防御
  return sanitizeSessions(sessions);
}

export async function saveSession(session: Session): Promise<void> {
  const db = await getDB();
  await db.put(SESSION_STORE_V2, toRow(session));
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(SESSION_STORE_V2, id);
  // 旧对象 store 一并清(防御:迁移窗口内的残留)
  await db.delete(SESSION_STORE, id).catch(() => {});
}

/** 全量替换(WebDAV 恢复用):v2 单事务 clear+put 全部(JSONL),旧对象 store 一并清空 */
export async function replaceAllSessions(sessions: Session[]): Promise<void> {
  const db = await getDB();
  // 单事务 clear+put:IDB 事务原子性保证不会出现"旧会话已清、新会话未落"的丢失窗口
  const tx = db.transaction(SESSION_STORE_V2, 'readwrite');
  await tx.store.clear();
  for (const s of sessions) void tx.store.put(toRow(s));
  await tx.done;
  // 旧对象 store 一并清空(防止恢复后旧数据残留/回读)
  const txOld = db.transaction(SESSION_STORE, 'readwrite');
  await txOld.store.clear();
  await txOld.done;
  await storage.setItem(FORMAT_FLAG, 'jsonl');
}
