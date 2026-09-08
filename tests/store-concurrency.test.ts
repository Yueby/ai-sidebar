/**
 * 并发隔离最小回归:per-session runs 与队列归属。
 * 运行:pnpm dlx tsx --test tests/store-concurrency.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatSlice, type QueuedMessage } from '../entrypoints/sidepanel/store/chatSlice';
import type { ChatMessage } from '../lib/types';

function createHarness() {
  let state = {} as Record<string, unknown>;
  const set = (partial: unknown) => {
    const patch =
      typeof partial === 'function'
        ? (partial as (s: Record<string, unknown>) => Record<string, unknown>)(state)
        : (partial as Record<string, unknown>);
    state = { ...state, ...patch };
  };
  const slice = createChatSlice(set as never);
  state = { ...slice };
  return { slice, getState: () => state as unknown as ReturnType<typeof createChatSlice> };
}

const q = (id: string, sessionId: string, text = id): QueuedMessage => ({
  id,
  sessionId,
  text,
  refTabs: [],
  pickedElements: [],
});

const assistantMsg = (text: string): ChatMessage =>
  ({ role: 'assistant', content: [{ type: 'text', text }], api: 'openai-completions', provider: 'p', model: 'm', stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: Date.now() }) as ChatMessage;

test('runs 按会话隔离:两个会话可同时运行,状态互不干扰', () => {
  const { slice, getState } = createHarness();
  slice.startRun('A');
  slice.startRun('B');
  slice.patchRun('A', { content: 'A-text' });
  slice.patchRun('B', { content: 'B-text' });
  slice.addRunTool('A', 'read_page');
  const st = getState();
  assert.equal(st.runs.A?.content, 'A-text');
  assert.equal(st.runs.B?.content, 'B-text');
  assert.deepEqual(st.runs.A?.toolNames, ['read_page']);
  assert.deepEqual(st.runs.B?.toolNames, []);
});

test('endRun 只结束目标会话,其他会话继续运行', () => {
  const { slice, getState } = createHarness();
  slice.startRun('A');
  slice.startRun('B');
  slice.endRun('A');
  const st = getState();
  assert.equal(st.runs.A, undefined);
  assert.ok(st.runs.B);
});

test('appendRunInFlight/patchRun 只写目标会话', () => {
  const { slice, getState } = createHarness();
  slice.startRun('A');
  slice.startRun('B');
  slice.appendRunInFlight('A', assistantMsg('a1'));
  slice.patchRun('B', { cancelled: true });
  const st = getState();
  assert.equal(st.runs.A?.inFlight.length, 1);
  assert.equal(st.runs.B?.inFlight.length, 0);
  assert.equal(st.runs.B?.cancelled, true);
  assert.equal(st.runs.A?.cancelled, false);
});

test('未 startRun 的会话:patch/append 不产生幽灵运行态', () => {
  const { slice, getState } = createHarness();
  slice.patchRun('X', { content: 'ghost' });
  slice.appendRunInFlight('X', assistantMsg('ghost'));
  assert.equal(getState().runs.X, undefined);
});

test('队列按会话归属:FIFO 出队不阻塞其他会话', () => {
  const { slice, getState } = createHarness();
  slice.enqueueMessage(q('a1', 'A'));
  slice.enqueueMessage(q('b1', 'B'));
  slice.enqueueMessage(q('a2', 'A'));
  // 模拟按会话出队:找 A 的第一条
  const forA = getState().queuedMessages.find((x) => x.sessionId === 'A');
  assert.equal(forA?.id, 'a1');
  slice.removeQueuedMessage('a1');
  // B 的条目不受影响,仍在队首
  assert.equal(getState().queuedMessages[0]?.id, 'b1');
  const forA2 = getState().queuedMessages.find((x) => x.sessionId === 'A');
  assert.equal(forA2?.id, 'a2');
});

test('preparingSessionIds 支持多会话并发准备', () => {
  const { slice, getState } = createHarness();
  slice.setPreparing('A', true);
  slice.setPreparing('B', true);
  assert.deepEqual(getState().preparingSessionIds.sort(), ['A', 'B']);
  slice.setPreparing('A', false);
  assert.deepEqual(getState().preparingSessionIds, ['B']);
});
