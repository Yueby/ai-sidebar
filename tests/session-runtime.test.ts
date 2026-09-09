/**
 * SessionRuntime(pi AgentSession 对齐)最小回归:生命周期/所有权/队列/锁。
 * 运行:pnpm dlx tsx --test tests/session-runtime.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionRuntime, runtimeFor, bridgeAgentEvent, disposeRuntime } from '../lib/sessionRuntime';
import type { AgentEvent } from '../lib/agent';
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

test('pi 队列已移入 Agent:投影层不再持有队列副本', () => {
  const rt = new SessionRuntime('s5');
  // 队列 API(followUp/steer/shiftPending/pendingMessageCount)已删除——
  // 队列由 pi-agent-core 的 Agent 原生持有(见 tests/agent-queue.test.ts 的真实 Agent 时序测试)
  assert.equal('followUp' in rt, false);
  assert.equal('steer' in rt, false);
  assert.equal('pendingMessageCount' in rt, false);
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

// 回归 G1(排队消息被注入消费后“凭空消失”):user message_end 必须有一个可见载体,
// 直到 finalize 把它归入 session.messages(消费侧按对象身份去重)。
test('user message_end 经 bridgeAgentEvent 进入 in-flight 保持可见,同一对象不重复', () => {
  const sid = 'bridge-user-visibility';
  const rt = runtimeFor(sid);
  rt.beginRun();
  const user = { role: 'user', content: [{ type: 'text', text: 'queued msg' }], timestamp: Date.now() } as unknown as ChatMessage;

  bridgeAgentEvent(sid, { type: 'message_end', message: user } as unknown as AgentEvent);
  assert.equal(rt.getSnapshot().inFlight.length, 1, '注入的 user 消息应在 in-flight 可见');

  // 同一对象再次到达不双计(幂等)
  bridgeAgentEvent(sid, { type: 'message_end', message: user } as unknown as AgentEvent);
  assert.equal(rt.getSnapshot().inFlight.length, 1, '同一引用不得重复入 in-flight');

  // 不污染 live 流式态:后续 assistant 增量仍属同一快照字段
  disposeRuntime(sid);
});
