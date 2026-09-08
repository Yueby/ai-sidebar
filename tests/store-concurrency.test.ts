/**
 * 并发隔离最小回归:store.runs 渲染镜像(syncRun)+ 队列归属。
 * 运行:pnpm dlx tsx --test tests/store-concurrency.test.ts
 * 注:runs 的真源是 SessionRuntime(tests/session-runtime.test.ts 覆盖);
 * 本文件验证镜像接缝 syncRun 的写入/清理语义。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatSlice, type QueuedMessage, type SessionRun } from '../entrypoints/sidepanel/store/chatSlice';
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

const run = (content: string): SessionRun => ({
  content,
  thinking: '',
  toolNames: [],
  cancelled: false,
  inFlight: [],
});

const assistantMsg = (text: string): ChatMessage =>
  ({ role: 'assistant', content: [{ type: 'text', text }], api: 'openai-completions', provider: 'p', model: 'm', stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: Date.now() }) as ChatMessage;

test('syncRun(active=true) 按会话写入镜像,互不覆盖', () => {
  const { slice, getState } = createHarness();
  slice.syncRun('A', run('A-text'), true);
  slice.syncRun('B', run('B-text'), true);
  const st = getState();
  assert.equal(st.runs.A?.content, 'A-text');
  assert.equal(st.runs.B?.content, 'B-text');
});

test('syncRun(active=false) 只移除目标会话', () => {
  const { slice, getState } = createHarness();
  slice.syncRun('A', run('a'), true);
  slice.syncRun('B', run('b'), true);
  slice.syncRun('A', run('a'), false);
  const st = getState();
  assert.equal(st.runs.A, undefined);
  assert.ok(st.runs.B);
});

test('syncRun 快照按引用替换:后续更新覆盖旧值', () => {
  const { slice, getState } = createHarness();
  slice.syncRun('A', run('v1'), true);
  const snapshot: SessionRun = { ...run('v2'), inFlight: [assistantMsg('m1')], toolNames: ['read_page'] };
  slice.syncRun('A', snapshot, true);
  const st = getState();
  assert.equal(st.runs.A?.content, 'v2');
  assert.equal(st.runs.A?.inFlight.length, 1);
  assert.deepEqual(st.runs.A?.toolNames, ['read_page']);
});

test('未激活的会话不产生幽灵运行态', () => {
  const { slice, getState } = createHarness();
  slice.syncRun('X', run('ghost'), false);
  assert.equal(getState().runs.X, undefined);
});

test('队列按会话归属:FIFO 出队不阻塞其他会话', () => {
  const { slice, getState } = createHarness();
  slice.enqueueMessage(q('a1', 'A'));
  slice.enqueueMessage(q('b1', 'B'));
  slice.enqueueMessage(q('a2', 'A'));
  // 生产出队 = 按会话 find 队首 + 按 id 移除
  const forA = getState().queuedMessages.find((x) => x.sessionId === 'A');
  assert.equal(forA?.id, 'a1');
  slice.removeQueuedMessage('a1');
  assert.equal(getState().queuedMessages[0]?.id, 'b1');
  assert.equal(getState().queuedMessages.find((x) => x.sessionId === 'A')?.id, 'a2');
});

test('preparingSessionIds 支持多会话并发准备', () => {
  const { slice, getState } = createHarness();
  slice.setPreparing('A', true);
  slice.setPreparing('B', true);
  assert.deepEqual(getState().preparingSessionIds.sort(), ['A', 'B']);
  slice.setPreparing('A', false);
  assert.deepEqual(getState().preparingSessionIds, ['B']);
});
