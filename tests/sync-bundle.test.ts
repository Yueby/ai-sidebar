/**
 * WebDAV 同步 bundle 往返回归(决策 36 task-3):
 * JSONL 存储切换后,同步 bundle 仍是 Session[] 形状(JSONL 化只在存储层内部)——
 * 验证序列化/解析往返无损、旧 Session 形状兼容、加密路径可用。
 * 运行:pnpm dlx tsx --test tests/sync-bundle.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
// 副作用导入:测试环境的 browser 全局
import './helpers/browser-stub';
import { serializeSyncBundle, parseSyncBlob, decryptSyncBlob } from '../lib/syncPayload';
import { sanitizeSessions } from '../lib/storage';
import type { Session, Settings } from '../lib/types';

const settings: Settings = {
  providerId: 'p1',
  providers: [],
  modelByRole: {},
  includePageContext: true,
  language: null,
  rules: [],
  systemPrompt: '',
  webSearch: { provider: 'none' },
} as unknown as Settings;

const session: Session = {
  id: 's1',
  title: '测试会话',
  messages: [
    { role: 'user', content: 'q1', timestamp: 1 } as Session['messages'][number],
    { role: 'assistant', content: [{ type: 'text', text: 'a1' }], api: 'openai-completions', provider: 'p', model: 'm', stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: 2 } as Session['messages'][number],
  ],
  createdAt: 1000,
  updatedAt: 2000,
};

const bundle = {
  version: 1 as const,
  exportedAt: 12345,
  settings,
  sessions: [session],
  activeSessionId: 's1',
};

test('bundle 序列化/解析往返无损(不加密)', async () => {
  const blob = await serializeSyncBundle(bundle as never);
  const parsed = await parseSyncBlob(blob);
  assert.equal(parsed.kind, 'bundle');
  if (parsed.kind !== 'bundle') return;
  assert.deepEqual(parsed.bundle.sessions, bundle.sessions);
  assert.equal(parsed.bundle.activeSessionId, 's1');
  assert.equal(parsed.bundle.version, 1);
});

test('加密往返:序列化(带密码)→ parse(encrypted) → 解密无损', async () => {
  const blob = await serializeSyncBundle(bundle as never, 'secret-password');
  const parsed = await parseSyncBlob(blob);
  assert.equal(parsed.kind, 'encrypted');
  if (parsed.kind !== 'encrypted') return;
  const decrypted = await decryptSyncBlob(parsed.blob, 'secret-password');
  assert.equal(decrypted.sessions[0]?.id, 's1');
  assert.deepEqual(decrypted.sessions, bundle.sessions);
});

test('旧 Session 形状兼容:缺 draft/compaction 的 bundle 解析后经 sanitize 可用', () => {
  // 旧版数据(无 draft/compaction 字段)在恢复路径经 sanitizeSessions 清洗
  const legacy = [
    {
      id: 'old-1',
      title: '旧会话',
      messages: [{ role: 'user', content: 'legacy', timestamp: 1 }],
      createdAt: 1,
      updatedAt: 2,
    },
  ];
  const sanitized = sanitizeSessions(legacy as never);
  assert.equal(sanitized.length, 1);
  assert.deepEqual(sanitized[0]?.messages, legacy[0]!.messages);
});

test('坏数据 fail-fast:截断的 gzip 被拒绝(WXT i18n 在 Node 下文案构建会额外报错,两者都算通过)', async () => {
  await assert.rejects(() => parseSyncBlob(new Uint8Array([0x1f, 0x8b, 0x00, 0x01])));
});
