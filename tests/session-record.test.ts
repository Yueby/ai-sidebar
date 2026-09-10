/**
 * 会话 JSONL 记录格式回归(决策 36 task-2 格式层)。
 * 运行:pnpm dlx tsx --test tests/session-record.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
// 副作用导入:定义测试环境的 browser 全局(必须先于被测模块)
import './helpers/browser-stub';
import { sessionToJsonl, jsonlToSession, SESSION_RECORD_VERSION, mergeTranscriptKeepingHistory } from '../lib/sessionRecord';
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

// 回归:finalize 无条件覆盖曾导致“本轮乃至之前的回复凭空消失”——转录单调性守卫必须不丢已存历史
test('转录守卫:变长直用、变短不丢已存且只补缺失(按对象身份不重复)', () => {
  const a = { tag: 'a' };
  const b = { tag: 'b' };
  const c = { tag: 'c' };

  // 正常路径:Agent 转录只增 → 原样采用,不报警
  const grown = mergeTranscriptKeepingHistory([a], [a, b]);
  assert.equal(grown.shrank, false);
  assert.deepEqual(grown.messages, [a, b]);

  // 相等长度(编辑重发截断后同长)也不触发守卫
  assert.equal(mergeTranscriptKeepingHistory([a, b], [a, b]).shrank, false);

  // 变短:保留已存两条,补入 newMessages 里的 c,且不重复
  const shrunk = mergeTranscriptKeepingHistory([a, b], [a], [c, b]);
  assert.equal(shrunk.shrank, true);
  assert.deepEqual(shrunk.messages, [a, b, c], '已存历史不得丢失');
  assert.equal(shrunk.messages.filter((m) => m === b).length, 1, '同一引用不得重复补入');

  // 全部已存在时只报警不新增
  const noop = mergeTranscriptKeepingHistory([a, b], [a], [b]);
  assert.equal(noop.shrank, true);
  assert.deepEqual(noop.messages, [a, b]);
});

// 复审复现的缺陷:变短分支原先只按对象引用去重 → “内容相同、引用不同”的克隆来源
// 会被整段重复追加(用户可见 = 重复气泡)。改用内容签名后必须去重。
test('转录守卫:变短分支按内容签名去重(克隆体不得整段重复)', () => {
  type M = { role: string; timestamp: number; content: unknown };
  const m = (role: string, timestamp: number, content: unknown): M => ({ role, timestamp, content });
  const u1 = m('user', 1, [{ type: 'text', text: 'q1' }]);
  const a1 = m('assistant', 2, [{ type: 'text', text: 'a1' }]);
  const u2 = m('user', 3, [{ type: 'text', text: 'q2' }]);

  // 克隆体(deep-equal 但引用不同)与原件混排 → 不得重复
  const cloned: M[] = [
    { role: 'user', timestamp: 1, content: [{ type: 'text', text: 'q1' }] },
    { role: 'assistant', timestamp: 2, content: [{ type: 'text', text: 'a1' }] },
  ];
  const merged = mergeTranscriptKeepingHistory([u1, a1, u2], cloned);
  assert.equal(merged.shrank, true);
  assert.deepEqual(
    merged.messages.map((x) => x.timestamp),
    [1, 2, 3],
    '克隆体已被内容签名识别为已存在,不得追加到尾部',
  );

  // 真正缺失的一条(克隆来源)仍须补入 —— 不得因为去重而丢内容
  const missing = { role: 'user', timestamp: 9, content: [{ type: 'text', text: 'new' }] };
  const withMissing = mergeTranscriptKeepingHistory([u1, a1, u2], cloned, [missing]);
  assert.deepEqual(withMissing.messages.map((x) => x.timestamp), [1, 2, 3, 9]);

  // 同毫秒、不同内容的排队消息不得被误合并(仅 role+timestamp 作签名的陷阱)
  const sameMs1 = m('user', 5, [{ type: 'text', text: 'first' }]);
  const sameMs2 = m('user', 5, [{ type: 'text', text: 'second' }]);
  const merged2 = mergeTranscriptKeepingHistory([sameMs1], [], [sameMs2]);
  assert.equal(merged2.messages.length, 2, '同毫秒不同内容必须保留两条');
});
