import { openDB, type IDBPDatabase } from 'idb';
import type { Session } from './types';
import { sanitizeSessions } from './storage';
import { sessionToJsonl, jsonlToSession } from './sessionRecord';

/**
 * 会话持久化:**JSONL 记录**为唯一执行格式。
 *
 * 开发阶段决策:不做任何旧版兼容——不设旧格式迁移链,全新安装即 v2 格式。
 * 唯一存储 = IndexedDB 库 'ai-sidebar-sessions' 的 'sessions' store(JSONL 文本行)。
 *
 * 公开 API 签名与重构前一致(消费方面对 Session 对象,零改动);
 * JSONL 序列化/解析封装在本层内部(lib/sessionRecord.ts)。
 */

const DB_NAME = 'ai-sidebar-sessions';
const DB_VERSION = 1;
const SESSION_STORE = 'sessions'; // JSONL 文本行

/** 行:JSONL 文本 + 冗余 updatedAt(排序用,免解析) */
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
      upgrade(db) {
        db.createObjectStore(SESSION_STORE, { keyPath: 'id' });
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
    updatedAt: row.updatedAt,
    compaction: parsed.compaction,
    draft: parsed.draft,
  };
}

// ── 公开 API ──────────────────────────────────────────────────────────

/** 全部会话,按 updatedAt 降序;读取路径统一过 sanitize(防御清洗,pi 形状归一) */
export async function listSessions(): Promise<Session[]> {
  const db = await getDB();
  const rows = (await db.getAll(SESSION_STORE)) as SessionRecordRow[];
  // 容错:单行损坏(外部改写/未来格式漂移)不得炸全表——坏行丢弃并告警
  const sessions: Session[] = [];
  for (const row of rows) {
    try {
      sessions.push(fromRow(row));
    } catch (err) {
      console.warn('[sessionStore] skipping corrupted session row:', row.id, err);
    }
  }
  return sanitizeSessions(sessions.sort((a, b) => b.updatedAt - a.updatedAt));
}

export async function saveSession(session: Session): Promise<void> {
  const db = await getDB();
  await db.put(SESSION_STORE, toRow(session));
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(SESSION_STORE, id);
}

/** 全量替换(WebDAV 恢复用):单事务 clear+put 全部,IDB 事务原子性保证无丢失窗口 */
export async function replaceAllSessions(sessions: Session[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(SESSION_STORE, 'readwrite');
  await tx.store.clear();
  for (const s of sessions) void tx.store.put(toRow(s));
  await tx.done;
}
