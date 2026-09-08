/**
 * SessionRuntime(pi AgentSession 对齐)最小回归:生命周期/所有权/队列/锁。
 * 运行:pnpm dlx tsx --test tests/session-runtime.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionRuntime } from '../lib/sessionRuntime';
import type { ChatMessage } from '../lib/types';

const assistantMsg = (text: string): ChatMessage =>
  ({ role: 'assistant', content: [{ type: 'text', text }], api: 'openai-completions', provider: 'p', model: 'm', stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: Date.now() }) as ChatMessage;

test('beginRun 进入运行态;endRun 仅所有者可拆卸', () => {
  const rt = new SessionRuntime('s1');
  assert.equal(rt.isStreaming, false);
  const { seq, signal } = rt.beginRun();
  assert.equal(rt.isStreaming, true);
  assert.equal(signal.aborted, false);
  assert.equal(rt.isOwner(seq), true);
  assert.equal(rt.endRun(seq + 1), false, '非所有者不能拆卸');
  assert.equal(rt.isStreaming, true);
  assert.equal(rt.endRun(seq), true);
  assert.equal(rt.isStreaming, false);
});

test('同会话已流式时 beginRun 抛错(不得静默覆盖);结束后可再开', () => {
  const rt = new SessionRuntime('s2');
  const first = rt.beginRun();
  assert.throws(() => rt.beginRun(), /already streaming/);
  assert.equal(rt.isOwner(first.seq), true, '拒绝覆盖后原 run 仍持有所有权');
  assert.equal(rt.endRun(first.seq), true);
  const second = rt.beginRun();
  assert.equal(rt.isOwner(second.seq), true);
  assert.equal(rt.isOwner(first.seq), false, '旧 seq 不再持有所有权');
});

test('dispose 后所有写入/重启失效(迟到续体无法回写镜像)', () => {
  const rt = new SessionRuntime('s2b');
  const { seq, signal } = rt.beginRun();
  rt.dispose();
  assert.equal(signal.aborted, true, 'dispose 会中止在途请求');
  assert.equal(rt.isStreaming, false);
  assert.equal(rt.isOwner(seq), false);
  rt.pushInFlight(seq, assistantMsg('late'));
  rt.pushStreamDelta(seq, 'late', '', 0);
  rt.addTool(seq, 'read_page');
  rt.markCancelled(seq);
  assert.equal(rt.getSnapshot().inFlight.length, 0);
  assert.equal(rt.getSnapshot().content, '');
  assert.deepEqual(rt.getSnapshot().toolNames, []);
  assert.equal(rt.getSnapshot().cancelled, false);
  assert.throws(() => rt.beginRun(), /disposed/);
});

test('pushInFlight 与 tool 状态按 run 所有权写入', () => {
  const rt = new SessionRuntime('s3');
  const { seq } = rt.beginRun();
  rt.pushInFlight(seq, assistantMsg('a1'));
  rt.addTool(seq, 'read_page');
  rt.addTool(seq, 'read_page');
  rt.removeTool(seq, 'read_page');
  rt.addTool(seq, 'click_element');
  const snap = rt.getSnapshot();
  assert.equal(snap.inFlight.length, 1);
  assert.deepEqual(snap.toolNames, ['click_element']);
  assert.equal(snap.content, '');
});

test('abort 中止在途请求;markCancelled 标记快照', () => {
  const rt = new SessionRuntime('s4');
  const { seq, signal } = rt.beginRun();
  rt.abort();
  assert.equal(signal.aborted, true);
  rt.markCancelled(seq);
  assert.equal(rt.getSnapshot().cancelled, true);
});

test('pi 队列语义:steer 优先于 followUp;pendingMessageCount 为两者之和', () => {
  const rt = new SessionRuntime('s5');
  assert.equal(rt.pendingMessageCount, 0);
  rt.followUp('f1');
  rt.followUp('f2');
  rt.steer('s1');
  assert.equal(rt.pendingMessageCount, 3);
  assert.equal(rt.shiftPending(), 's1');
  assert.equal(rt.shiftPending(), 'f1');
  assert.equal(rt.shiftPending(), 'f2');
  assert.equal(rt.shiftPending(), undefined);
  assert.equal(rt.pendingMessageCount, 0);
});

test('发送锁同步互斥;release 后可再次领取', () => {
  const rt = new SessionRuntime('s6');
  assert.equal(rt.tryAcquireSendLock(), true);
  assert.equal(rt.tryAcquireSendLock(), false, '锁被占用时不可重入');
  assert.equal(rt.isSending, true);
  rt.releaseSendLock();
  assert.equal(rt.tryAcquireSendLock(), true);
});

test('压缩请求标记按 run 所有权;消费后复位', () => {
  const rt = new SessionRuntime('s7');
  const { seq } = rt.beginRun();
  rt.requestCompaction(seq + 99);
  assert.equal(rt.isCompactionRequested, false, '非所有者不能置位');
  rt.requestCompaction(seq);
  assert.equal(rt.isCompactionRequested, true);
  assert.equal(rt.consumeCompactionRequest(), true);
  assert.equal(rt.consumeCompactionRequest(), false);
});

test('订阅者收到快照变更', () => {
  const rt = new SessionRuntime('s8');
  const seen: number[] = [];
  const unsub = rt.subscribe((snap) => seen.push(snap.inFlight.length));
  const { seq } = rt.beginRun();
  rt.pushInFlight(seq, assistantMsg('x'));
  unsub();
  rt.pushInFlight(seq, assistantMsg('y'));
  assert.deepEqual(seen, [0, 1]);
});
