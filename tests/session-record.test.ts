/**
 * 会话 JSONL 记录格式回归(决策 36 task-2 格式层)。
 * 运行:pnpm dlx tsx --test tests/session-record.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
// 副作用导入:定义测试环境的 browser 全局(必须先于被测模块)
import './helpers/browser-stub';
import { sessionToJsonl, jsonlToSession, SESSION_RECORD_VERSION } from '../lib/sessionRecord';
import { messageText } from '../lib/storage';
import type { Session } from '../lib/types';

const baseSession = (): Session => ({
  id: 'sess-1',
  title: '测试会话',
  messages: [],
  createdAt: Date.parse('2026-09-09T03:00:00.000Z'),
  updatedAt: Date.parse('2026-09-09T04:00:00.000Z'),
});

test('header/session_info/线性 parentId 链', () => {
  const s = baseSession();
  s.messages = [
    { role: 'user', content: 'q1', timestamp: 1 } as Session['messages'][number],
    { role: 'assistant', content: [{ type: 'text', text: 'a1' }], api: 'openai-completions', provider: 'p', model: 'm', stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: 2 } as Session['messages'][number],
  ];
  const jsonl = sessionToJsonl(s);
  const lines = jsonl.split('\n');
  const header = JSON.parse(lines[0]!);
  assert.equal(header.type, 'session');
  assert.equal(header.version, SESSION_RECORD_VERSION);
  assert.equal(header.id, 'sess-1');
  assert.equal(header.cwd, 'ai-sidebar');
  const entries = lines.slice(1).map((l) => JSON.parse(l));
  // session_info → message → message,线性链
  assert.equal(entries[0].type, 'session_info');
  assert.equal(entries[1].parentId, entries[0].id);
  assert.equal(entries[2].parentId, entries[1].id);
});

test('往返:标题/消息/草稿/压缩 无损(摘要消息转为 compaction entry)', () => {
  const s = baseSession();
  s.customTitle = true;
  s.draft = { input: 'draft-text', refTabs: [{ id: 1, title: 't', url: 'https://a' }], pickedElements: [] };
  const summaryText = '<context-summary>摘要内容</context-summary>';
  s.messages = [
    { role: 'user', content: 'q1', timestamp: 1 } as Session['messages'][number],
    { role: 'user', content: summaryText, timestamp: 2 } as Session['messages'][number],
    { role: 'assistant', content: [{ type: 'text', text: 'a2' }], api: 'x', provider: 'p', model: 'm', stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: 3 } as Session['messages'][number],
  ];
  s.compaction = { summaryTimestamp: 2, tokensBefore: 12345, compactedAt: 4 };

  const jsonl = sessionToJsonl(s);
  const parsed = jsonlToSession(jsonl);

  assert.equal(parsed.id, 'sess-1');
  assert.equal(parsed.title, '测试会话');
  assert.equal(parsed.customTitle, true);
  // 摘要消息重建为普通 user 消息(与旧语义一致):messages = q1 + 摘要 + a2
  assert.equal(parsed.messages.length, 3);
  assert.equal(messageText(parsed.messages[1]!), summaryText);
  // 压缩标记保留旧形状(summaryTimestamp 定位键不变,消费方零改动)
  assert.ok(parsed.compaction);
  assert.equal(parsed.compaction?.summaryTimestamp, 2);
  assert.equal(parsed.compaction?.tokensBefore, 12345);
  // 草稿保留
  assert.equal(parsed.draft?.input, 'draft-text');
  assert.equal(parsed.draft?.refTabs.length, 1);
});

test('无压缩/无草稿:不产生 compaction 与 draft entry', () => {
  const s = baseSession();
  s.messages = [{ role: 'user', content: 'q1', timestamp: 1 } as Session['messages'][number]];
  const jsonl = sessionToJsonl(s);
  const types = jsonl.split('\n').map((l) => JSON.parse(l).type);
  assert.equal(types.includes('compaction'), false);
  assert.equal(types.includes('custom'), false);
});

test('幂等:同输入同输出;重解析稳定', () => {
  const s = baseSession();
  s.messages = [
    { role: 'user', content: 'q1', timestamp: 1 } as Session['messages'][number],
    { role: 'user', content: '<context-summary>x</context-summary>', timestamp: 2 } as Session['messages'][number],
    { role: 'assistant', content: [{ type: 'text', text: 'a' }], api: 'x', provider: 'p', model: 'm', stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: 3 } as Session['messages'][number],
  ];
  s.compaction = { summaryTimestamp: 2, tokensBefore: 999, compactedAt: 5 };
  const j1 = sessionToJsonl(s);
  const parsed = jsonlToSession(j1);
  // 二次序列化(把解析结果当 Session 再序列化)逐行一致
  const asSession: Session = { ...s, ...parsed, compaction: parsed.compaction ? { summaryTimestamp: 2, tokensBefore: parsed.compaction.tokensBefore, compactedAt: parsed.compaction.compactedAt } : s.compaction };
  const j2 = sessionToJsonl(asSession);
  assert.equal(j1, j2);
});

test('非法输入 fail-fast', () => {
  assert.throws(() => jsonlToSession(''), /empty session record/);
  assert.throws(() => jsonlToSession('{"type":"message","id":"x","parentId":null,"timestamp":"t"}'), /missing header/);
  assert.throws(() => jsonlToSession('not-json'), /invalid JSON line/);
});
