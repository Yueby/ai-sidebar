import { openDB, type IDBPDatabase } from 'idb';
import { storage } from 'wxt/utils/storage';
import type { Session } from './types';
import { sanitizeSessions } from './storage';

const DB_NAME = 'ai-sidebar';
const SESSION_STORE = 'sessions';

/** 模块级惰性单例 */
let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore(SESSION_STORE, { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

/** 全部会话,按 updatedAt 降序;读取路径统一过 sanitize(旧格式迁移 + pi 形状透传归一) */
export async function listSessions(): Promise<Session[]> {
  const db = await getDB();
  const all = (await db.getAll(SESSION_STORE)) as unknown[];
  return sanitizeSessions(all).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveSession(session: Session): Promise<void> {
  const db = await getDB();
  await db.put(SESSION_STORE, session);
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(SESSION_STORE, id);
}

/**
 * 一次性迁移旧版 local:sessions → IndexedDB:
 * 旧 key 非空则逐条清洗后写入,然后删除旧 key(删掉即不会重复迁移)。
 * 返回迁移后的完整会话列表。
 */
export async function migrateLegacySessions(): Promise<Session[]> {
  const legacy = await storage.getItem<unknown[]>('local:sessions');
  if (Array.isArray(legacy) && legacy.length > 0) {
    for (const s of sanitizeSessions(legacy)) {
      await saveSession(s);
    }
    await storage.removeItem('local:sessions');
  }
  return listSessions();
}
