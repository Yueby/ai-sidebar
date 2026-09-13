/**
 * 网页引用决策逻辑的回归(纯函数,`lib/refGroups.ts`)。
 *
 * 这些规则此前全部长在 `usePageContextRefs` 的 effect/async 里,node 测不到,
 * 于是同一类缺陷(跨会话串味、切 tab 不跟随、新会话不入住、开关被发送复位)
 * 连续多轮靠真机实测才收敛。此处把每一条规则钉成测试。
 *
 * 契约:
 * ①初同步只服务全新会话(有历史的对话保留自己的引用集)
 * ②焦点切换:无组则入住当前页 / 有组则整组恢复 / 不可引用页清空 —— 三者都幂等
 * ③组记忆按会话分桶:某会话的归属状态与引用集绝不落到别的会话
 * ④添加引用开启本会话,删掉最后一个引用关闭本会话
 * ⑤发送只消费输入与框选元素,保留引用集与本会话开关
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PickedElement, SessionDraft } from '../lib/types';
import type { RefTab } from '../lib/pageContext';
import {
  addRefTabToDraft,
  decideFocusSwitch,
  draftAfterSend,
  getBucket,
  groupSnapshotTargets,
  nextElementId,
  removeRefTabFromDraft,
  shouldSeedCurrentPage,
  type RefGroupBuckets,
} from '../lib/refGroups';

const tab = (id: number, title = `page-${id}`, url = `https://example.com/${id}`): RefTab => ({
  id,
  title,
  url,
});

const draft = (over: Partial<SessionDraft> = {}): SessionDraft => ({
  input: '',
  refTabs: [],
  pickedElements: [],
  ...over,
});

const element = (elementId: number, tabId: number, selector = `.e${elementId}`): PickedElement => ({
  id: `${tabId}:${selector}`,
  elementId,
  tabId,
  selector,
  tagName: 'button',
  preview: `元素 ${elementId}`,
});

test('shouldSeedCurrentPage:只给全新会话入住当前页', () => {
  assert.equal(shouldSeedCurrentPage({ messages: [], draft: draft() }), true);
  // 有历史的对话:保留它自己的引用集,不凭空引用"当前页"
  assert.equal(shouldSeedCurrentPage({ messages: [{ role: 'user' }], draft: draft() }), false);
  // 草稿已有引用:不动
  assert.equal(
    shouldSeedCurrentPage({ messages: [], draft: draft({ refTabs: [tab(1)] }) }),
    false,
  );
  assert.equal(shouldSeedCurrentPage(null), false);
});

test('decideFocusSwitch:不可引用页清空当前页引用(幂等)', () => {
  const withRefs = draft({ refTabs: [tab(1)], pickedElements: [element(1, 1)] });
  const cleared = decideFocusSwitch({ draft: withRefs, groups: new Map(), tabId: 9, meta: null });
  // 先查开关(deepEqual 是断言函数,会把变量窄化成字面量类型,之后access 别的字段会报错)
  assert.equal(cleared?.pageContextEnabled, undefined, '开关不因"焦点落到不可引用页"而改变:它不是用户动作');
  assert.deepEqual(cleared, { input: '', refTabs: [], pickedElements: [] });
  // 已空 → 不动草稿(避免无意义渲染与落盘)
  assert.equal(
    decideFocusSwitch({ draft: draft(), groups: new Map(), tabId: 9, meta: null }),
    null,
  );
});

test('decideFocusSwitch:有组记忆则整组恢复,已是该组则不动', () => {
  const snapshot = { refTabs: [tab(1), tab(2)], pickedElements: [element(1, 1)] };
  const groups = new Map([[7, snapshot]]);
  const next = decideFocusSwitch({ draft: draft({ refTabs: [tab(3)] }), groups, tabId: 7, meta: tab(7) });
  assert.deepEqual(next?.refTabs, snapshot.refTabs);
  assert.deepEqual(next?.pickedElements, snapshot.pickedElements);
  // 幂等:草稿里的 refTabs 就是该快照的同一个数组引用时不产生新草稿
  assert.equal(
    decideFocusSwitch({ draft: draft({ refTabs: snapshot.refTabs }), groups, tabId: 7, meta: tab(7) }),
    null,
  );
});

test('decideFocusSwitch:无组记忆则隐式当前页芯片入住', () => {
  const next = decideFocusSwitch({ draft: draft(), groups: new Map(), tabId: 5, meta: tab(5) });
  assert.deepEqual(next?.refTabs.map((t) => t.id), [5]);
  assert.deepEqual(next?.pickedElements, []);
  // 已是该单例 → 不动
  assert.equal(
    decideFocusSwitch({ draft: draft({ refTabs: [tab(5)] }), groups: new Map(), tabId: 5, meta: tab(5) }),
    null,
  );
});

test('组记忆归属:只在同一会话内计入"草稿已反映的焦点 tab"', () => {
  const refTabs = [tab(1), tab(2)];
  assert.deepEqual([...groupSnapshotTargets(refTabs, { sessionId: 's1', tabId: 9 }, 's1')], [1, 2, 9]);
  // 另一会话的归属状态不得把本会话的引用集记到该 tab 名下(否则切到该 tab 会恢复出本会话的旧引用集)
  assert.deepEqual([...groupSnapshotTargets(refTabs, { sessionId: 's1', tabId: 9 }, 's2')], [1, 2]);
  assert.deepEqual([...groupSnapshotTargets(refTabs, null, 's1')], [1, 2]);
});

test('组记忆按会话分桶:同名 tab 在不同会话互不影响', () => {
  const buckets: RefGroupBuckets = new Map();
  const s1 = getBucket(buckets, 's1');
  const s2 = getBucket(buckets, 's2');
  assert.notEqual(s1, s2);
  // 会话 A 在 tab 7 上的工作集是 [tab(1)]
  s1.set(7, { refTabs: [tab(1)], pickedElements: [] });

  // 实测回归:某会话在 tab 7 的引用集,不得被新会话当成"7 的组"恢复
  const seeded = decideFocusSwitch({ draft: draft(), groups: s2, tabId: 7, meta: tab(7) });
  assert.deepEqual(seeded?.refTabs.map((t) => t.id), [7]);
  assert.deepEqual(s1.get(7)?.refTabs.map((t) => t.id), [1], '会话 A 的记忆未被改动');

  // 新会话自己也留下记忆后,切走再切回 tab 7 恢复它自己的引用集
  for (const id of groupSnapshotTargets(seeded!.refTabs, { sessionId: 's2', tabId: 7 }, 's2')) {
    s2.set(id, { refTabs: seeded!.refTabs, pickedElements: [] });
  }
  const back = decideFocusSwitch({
    draft: draft({ refTabs: [tab(8)] }),
    groups: s2,
    tabId: 7,
    meta: tab(7),
  });
  assert.deepEqual(back?.refTabs.map((t) => t.id), [7]);
});

test('添加引用:去重并开启本会话引用', () => {
  const off = draft({ pageContextEnabled: false });
  assert.equal(addRefTabToDraft(off, tab(1)).pageContextEnabled, true);
  const added = addRefTabToDraft(draft(), tab(1));
  assert.deepEqual(added.refTabs.map((t) => t.id), [1]);
  assert.equal(added.pageContextEnabled, true);
  // 已存在:不重复追加
  assert.deepEqual(addRefTabToDraft(added, tab(1)).refTabs.map((t) => t.id), [1]);
  // 已存在且开关为开:原样返回(不产生新草稿对象)
  const on = addRefTabToDraft(draft({ refTabs: [tab(1)] }), tab(1));
  assert.equal(on.pageContextEnabled, undefined);
});

test('移除引用:删掉最后一个 = 关闭本会话引用', () => {
  const two = draft({ refTabs: [tab(1), tab(2)], pickedElements: [element(1, 1), element(2, 2)] });
  const one = removeRefTabFromDraft(two, 1);
  assert.deepEqual(one.refTabs.map((t) => t.id), [2]);
  // 该 tab 上的框选元素一并移除,另一个 tab 的保留
  assert.deepEqual(one.pickedElements.map((p) => p.tabId), [2]);
  assert.equal(one.pageContextEnabled, undefined, '非最后一个不动开关');
  const none = removeRefTabFromDraft(one, 2);
  assert.deepEqual(none.refTabs, []);
  assert.equal(none.pageContextEnabled, false);
});

test('发送保留引用集与本会话开关,只消费输入与框选元素', () => {
  const before = draft({
    input: '带 <picked-element elementId="1" tabId="1" selector=".e1" tagName="button" label="x" /> 的文字',
    refTabs: [tab(1)],
    pickedElements: [element(1, 1)],
    pageContextEnabled: false,
  });
  const after = draftAfterSend(before);
  assert.equal(after.input, '');
  assert.deepEqual(after.pickedElements, []);
  assert.deepEqual(after.refTabs.map((t) => t.id), [1], '引用集跨消息存活');
  assert.equal(after.pageContextEnabled, false, '一次发送不得把"本会话已关闭引用"复位成开');
});

test('元素标记号:取现有元素与正文块标记号的最大值 +1', () => {
  assert.equal(nextElementId(draft()), 1);
  assert.equal(nextElementId(draft({ pickedElements: [element(3, 1)] })), 4);
  // 正文里的块标记号也计入(编辑器重建/草稿恢复后继续递增,防撞号)
  const withText = draft({
    pickedElements: [element(2, 1)],
    input: 'A <picked-element elementId="7" tabId="1" selector=".e7" tagName="a" label="x" /> B',
  });
  assert.equal(nextElementId(withText), 8);
});
