import { i18n } from '#i18n';
import type { Session, Settings } from '@/lib/types';
import { listSessions } from '@/lib/sessionStore';

/**
 * 同步载荷(审计拍板:全量快照单文件,不做增量合并):
 *   JSON(设置 + 全部会话)→ gzip(zstd 可用时用,回退 gzip)→ 可选 AES-GCM 加密 → 二进制
 * 文件格式:
 *   明文:gzip 字节(魔数 0x1f8b 天然可识别)
 *   加密:'AISYN1' + salt(16) + iv(12) + AES-GCM 密文(密码 PBKDF2-SHA256 150k 派生)
 */

const MAGIC_ENC = new TextEncoder().encode('AISYN1');
const PBKDF2_ITERATIONS = 150000;

export interface SyncBundle {
  version: 1;
  exportedAt: number;
  settings: Settings;
  sessions: Session[];
  activeSessionId: string | null;
}

/** 收集本地全量数据(settings 由调用方传入当前 store 值) */
export async function buildSyncBundle(settings: Settings, activeSessionId: string | null): Promise<SyncBundle> {
  const sessions = await listSessions();
  return { version: 1, exportedAt: Date.now(), settings, sessions, activeSessionId };
}

/** 压缩:zstd 可用则用(更省 ~20%),回退 gzip */
async function compress(data: Uint8Array): Promise<Uint8Array> {
  const format: CompressionFormat = (() => {
    try {
      // zstd 在 Chrome 135+ 可用;探测失败回退 gzip
      new CompressionStream('zstd' as CompressionFormat);
      return 'zstd' as CompressionFormat;
    } catch {
      return 'gzip';
    }
  })();
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decompress(data: Uint8Array): Promise<Uint8Array> {
  const format: CompressionFormat = (() => {
    try {
      new DecompressionStream('zstd' as CompressionFormat);
      return 'zstd' as CompressionFormat;
    } catch {
      return 'gzip';
    }
  })();
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** 打包:JSON → 压缩 → (可选加密);encryptPassword 非空时启用加密 */
export async function serializeSyncBundle(
  bundle: SyncBundle,
  encryptPassword?: string,
): Promise<Uint8Array> {
  const json = new TextEncoder().encode(JSON.stringify(bundle));
  const compressed = await compress(json);
  if (!encryptPassword) return compressed;

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(encryptPassword, salt);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, compressed as BufferSource),
  );
  const out = new Uint8Array(MAGIC_ENC.length + salt.length + iv.length + cipher.length);
  out.set(MAGIC_ENC, 0);
  out.set(salt, MAGIC_ENC.length);
  out.set(iv, MAGIC_ENC.length + salt.length);
  out.set(cipher, MAGIC_ENC.length + salt.length + iv.length);
  return out;
}

export type ParsedSyncBlob =
  | { kind: 'bundle'; bundle: SyncBundle }
  | { kind: 'encrypted'; blob: Uint8Array }
  | { kind: 'invalid'; error: string };

/** 识别并解析远端二进制:加密文件返回 encrypted(需调用方提供密码后走 decryptSyncBlob) */
export async function parseSyncBlob(blob: Uint8Array): Promise<ParsedSyncBlob> {
  const magic = new TextDecoder().decode(blob.slice(0, MAGIC_ENC.length));
  if (magic === 'AISYN1') return { kind: 'encrypted', blob };
  try {
    const json = JSON.parse(new TextDecoder().decode(await decompress(blob))) as SyncBundle;
    if (json?.version !== 1 || !Array.isArray(json.sessions) || typeof json.settings !== 'object') {
      return { kind: 'invalid', error: i18n.t('sync.error.invalidFile') };
    }
    return { kind: 'bundle', bundle: json };
  } catch {
    return { kind: 'invalid', error: i18n.t('sync.error.corruptFile') };
  }
}

/** 解密加密备份(密码错误时 GCM 校验失败 → 抛出可行动文本) */
export async function decryptSyncBlob(blob: Uint8Array, password: string): Promise<SyncBundle> {
  const magic = new TextDecoder().decode(blob.slice(0, MAGIC_ENC.length));
  if (magic !== 'AISYN1') throw new Error(i18n.t('sync.error.notEncrypted'));
  const salt = blob.slice(MAGIC_ENC.length, MAGIC_ENC.length + 16);
  const iv = blob.slice(MAGIC_ENC.length + 16, MAGIC_ENC.length + 28);
  const cipher = blob.slice(MAGIC_ENC.length + 28);
  const key = await deriveKey(password, salt);
  let compressed: Uint8Array;
  try {
    compressed = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, cipher as BufferSource),
    );
  } catch {
    throw new Error(i18n.t('sync.error.decryptFailed'));
  }
  const json = JSON.parse(new TextDecoder().decode(await decompress(compressed))) as SyncBundle;
  if (json?.version !== 1 || !Array.isArray(json.sessions)) throw new Error(i18n.t('sync.error.corruptFile'));
  return json;
}

/** 打包体大小的可读标注(UI 展示压缩效果) */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

