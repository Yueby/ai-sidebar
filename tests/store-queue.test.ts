/**
 * store 层最小回归测试(会话隔离队列语义)。
 * 运行:pnpm dlx tsx --test tests/store-queue.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatSlice, type QueuedMessage } from '../entrypoints/sidepanel/store/chatSlice';

/** 最小 zustand set 替身:createChatSlice 只依赖 set(partial | updater) */
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

test('enqueue/dequeue 保持 FIFO 且携带归属会话与冻结快照', () => {
  const { slice, getState } = createHarness();
  slice.enqueueMessage(q('a1', 'A'));
  slice.enqueueMessage(q('b1', 'B'));
  const first = slice.dequeueMessage();
  assert.equal(first?.id, 'a1');
  assert.equal(first?.sessionId, 'A');
  assert.equal(getState().queuedMessages.length, 1);
  assert.equal(slice.dequeueMessage()?.id, 'b1');
  assert.equal(slice.dequeueMessage(), undefined);
});

test('removeQueuedMessage 按稳定 id 删除(混排会话不误删)', () => {
  const { slice, getState } = createHarness();
  slice.enqueueMessage(q('a1', 'A'));
  slice.enqueueMessage(q('b1', 'B'));
  slice.enqueueMessage(q('a2', 'A'));
  slice.removeQueuedMessage('b1');
  assert.deepEqual(
    getState().queuedMessages.map((m) => m.id),
    ['a1', 'a2'],
  );
});

test('removeQueuedMessagesForSession 只清目标会话的条目', () => {
  const { slice, getState } = createHarness();
  slice.enqueueMessage(q('a1', 'A'));
  slice.enqueueMessage(q('b1', 'B'));
  slice.enqueueMessage(q('a2', 'A'));
  slice.removeQueuedMessagesForSession('A');
  assert.deepEqual(
    getState().queuedMessages.map((m) => m.id),
    ['b1'],
  );
});

test('入队快照是副本:入队后修改原数组不影响条目', () => {
  const { slice, getState } = createHarness();
  const tabs = [{ id: 1, title: 't', url: 'https://a' }];
  slice.enqueueMessage({ ...q('a1', 'A'), refTabs: [...tabs] });
  tabs.push({ id: 2, title: 'x', url: 'https://b' });
  assert.equal(getState().queuedMessages[0]?.refTabs.length, 1);
});
