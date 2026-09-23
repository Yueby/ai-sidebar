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
  executeSessionCreation,
  isBlankDraft,
  isSessionReusable,
  nextElementId,
  planSessionTarget,
  shouldNavigateToSkillSession,
  type SessionCreationStoreAdapter,
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

test('isBlankDraft:只有无输入、无引用、无框选元素时为 true', () => {
  assert.equal(isBlankDraft(), true);
  assert.equal(isBlankDraft(null), true);
  assert.equal(isBlankDraft(draft()), true);
  assert.equal(isBlankDraft(draft({ input: '   ' })), true, '纯空白字符串视为空草稿');

  assert.equal(isBlankDraft(draft({ input: 'hello' })), false, '有文本输入视为非空');
  assert.equal(isBlankDraft(draft({ refTabs: [tab(1)] })), false, '有网页引用视为非空');
  assert.equal(isBlankDraft(draft({ pickedElements: [element(1, 1)] })), false, '有框选元素视为非空');
});

test('isSessionReusable:空闲且按需检查白板草稿', () => {
  // 无会话不可复用
  assert.equal(isSessionReusable(null), false);

  // 有历史消息不可复用
  assert.equal(isSessionReusable({ messages: [{ role: 'user' }], draft: draft() }), false);

  // 有后台进行中任务不可复用
  assert.equal(isSessionReusable({ messages: [], draft: draft() }, { hasPendingWork: true }), false);

  // 常规新建(未要求纯白板草稿):即使草稿有输入,也算空消息空闲会话
  assert.equal(
    isSessionReusable({ messages: [], draft: draft({ input: 'unsent' }) }),
    true,
    '常规新建逻辑保持兼容',
  );

  // 技能创作要求纯白板草稿(requireBlankDraft: true):
  assert.equal(
    isSessionReusable({ messages: [], draft: draft() }, { requireBlankDraft: true }),
    true,
    '纯白板空闲会话可直接复用',
  );
  assert.equal(
    isSessionReusable({ messages: [], draft: draft({ input: 'draft text' }) }, { requireBlankDraft: true }),
    false,
    '有草稿输入不可复用,必须开新会话防冲掉',
  );
  assert.equal(
    isSessionReusable({ messages: [], draft: draft({ refTabs: [tab(1)] }) }, { requireBlankDraft: true }),
    false,
    '有网页引用不可复用,必须开新会话防冲掉',
  );
  assert.equal(
    isSessionReusable({ messages: [], draft: draft({ pickedElements: [element(1, 1)] }) }, { requireBlankDraft: true }),
    false,
    '有框选元素不可复用,必须开新会话防冲掉',
  );
});

test('planSessionTarget:入口编排纯决策(老会话保留、空闲复用、忙会话新建、异步目标锁定)', () => {
  const idleEmptySession = { id: 's-empty', messages: [], draft: draft() };
  const busySession = { id: 's-busy', messages: [], draft: draft() };
  const sessionWithDraft = { id: 's-draft', messages: [], draft: draft({ input: 'unsent text' }) };
  const sessionWithRefs = { id: 's-refs', messages: [], draft: draft({ refTabs: [tab(1)] }) };
  const activeChatSession = { id: 's-chat', messages: [{ role: 'user' }], draft: draft() };

  // 1. 空闲白板复用:复用目标会话,且 initialInput 在返回值中直接就绪
  const plan1 = planSessionTarget({
    currentSession: idleEmptySession,
    hasPendingWork: false,
    options: { requireBlankDraft: true, initialInput: '创作技能A' },
  });
  assert.equal(plan1.action, 'reuse');
  if (plan1.action === 'reuse') {
    assert.equal(plan1.targetId, 's-empty');
    assert.deepEqual(plan1.draftPatch, { input: '创作技能A' });
  }

  // 2. 老会话保留:当前会话有历史消息时,必须新建,不修改且保留原会话
  const plan2 = planSessionTarget({
    currentSession: activeChatSession,
    hasPendingWork: false,
    options: { requireBlankDraft: true, initialInput: '创作技能B' },
  });
  assert.equal(plan2.action, 'create');
  if (plan2.action === 'create') {
    assert.deepEqual(plan2.initialDraft, { input: '创作技能B', refTabs: [], pickedElements: [] });
  }

  // 3. 技能创作严格保护未发草稿与网页引用:若要求 requireBlankDraft,有草稿或引用时必须新建
  const planDraft = planSessionTarget({
    currentSession: sessionWithDraft,
    hasPendingWork: false,
    options: { requireBlankDraft: true, initialInput: '创作技能C' },
  });
  assert.equal(planDraft.action, 'create', '有未发草稿文本时不可冲掉,必须新建');

  const planRefs = planSessionTarget({
    currentSession: sessionWithRefs,
    hasPendingWork: false,
    options: { requireBlankDraft: true, initialInput: '创作技能D' },
  });
  assert.equal(planRefs.action, 'create', '有网页引用时不可冲掉,必须新建');

  // 4. 忙会话新建:当前会话虽空但有后台任务(排队/运行/门控),必须新建
  const planBusy = planSessionTarget({
    currentSession: busySession,
    hasPendingWork: true,
    options: { requireBlankDraft: true, initialInput: '创作技能E' },
  });
  assert.equal(planBusy.action, 'create', '忙碌会话不可复用,必须新建');

  // 5. 常规新建保持兼容:未开启 requireBlankDraft 时可复用带草稿的空会话
  const planNormal = planSessionTarget({
    currentSession: sessionWithDraft,
    hasPendingWork: false,
  });
  assert.equal(planNormal.action, 'reuse');
  if (planNormal.action === 'reuse') {
    assert.equal(planNormal.targetId, 's-draft');
    assert.equal(planNormal.draftPatch, null);
  }
});

test('shouldNavigateToSkillSession:目标消失或用户切走时不继续导航', () => {
  const sessions = [{ id: 's-1' }, { id: 's-2' }];

  // 1. 目标会话存在且仍为活动会话 -> 允许继续收尾导航
  assert.equal(
    shouldNavigateToSkillSession({
      targetSessionId: 's-1',
      activeSessionId: 's-1',
      sessions,
    }),
    true,
  );

  // 2. 异步完成时用户已经切去其它会话 -> 不得继续收尾导航
  assert.equal(
    shouldNavigateToSkillSession({
      targetSessionId: 's-1',
      activeSessionId: 's-2',
      sessions,
    }),
    false,
  );

  // 3. 目标会话在异步期间被删除/不存在 -> 不得继续收尾导航
  assert.equal(
    shouldNavigateToSkillSession({
      targetSessionId: 's-deleted',
      activeSessionId: 's-deleted',
      sessions,
    }),
    false,
  );

  // 4. 空值安全
  assert.equal(
    shouldNavigateToSkillSession({
      targetSessionId: null,
      activeSessionId: 's-1',
      sessions,
    }),
    false,
  );
});

test('executeSessionCreation:受控延迟保存期间切走,失败不抢夺当前活动 ID', async () => {
  let activeId: string = 's-orig';
  let storageSavedActiveId: string | null = null;
  let sessions: Array<{ id: string; messages: any[]; draft?: SessionDraft }> = [
    { id: 's-orig', messages: [{ role: 'user' }], draft: draft() },
    { id: 's-other', messages: [], draft: draft() },
  ];
  let droppedDraftId: string | null = null;

  // 构造受控延迟与拒绝的 adapter
  const adapter: SessionCreationStoreAdapter = {
    getSessions: () => sessions,
    getActiveSessionId: () => activeId,
    setSessions: (next) => {
      sessions = next;
    },
    setActiveSessionId: (id) => {
      activeId = id;
    },
    patchDraftOf: (id, patch) => {
      const s = sessions.find((x) => x.id === id);
      if (s) s.draft = patch(s.draft ?? draft());
    },
    dropPendingDraftSave: (id) => {
      droppedDraftId = id;
    },
    flushDraftSaves: () => {},
    createSession: (initialDraft) => ({
      id: 's-new-1',
      title: '新会话',
      messages: [],
      draft: initialDraft ?? draft(),
    }),
    // 模拟可控延迟并在 15ms 后失败抛错
    saveSession: async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      throw new Error('Disk IO error');
    },
    setActiveSessionIdStorage: async (id) => {
      storageSavedActiveId = id;
    },
  };

  // 发起创建任务(老会话有消息,触发新建)
  const createPromise = executeSessionCreation(adapter, {
    requireBlankDraft: true,
    initialInput: '模板输入',
  });

  // 在保存完成前,验证首个 await 前新会话的 draft 已同步注入
  assert.equal(sessions[0]?.id, 's-new-1');
  assert.equal(sessions[0]?.draft?.input, '模板输入');
  assert.equal(activeId, 's-new-1', '创建瞬间同步切至新会话');

  // 模拟用户在保存期间主动切到另一个会话 s-other
  await new Promise((resolve) => setTimeout(resolve, 5));
  activeId = 's-other';

  // 等待保存失败抛出
  await assert.rejects(createPromise, /Disk IO error/);

  // 关键断言 1:保存失败回滚后,绝不抢夺用户已经切走的 s-other!
  assert.equal(activeId, 's-other', '保存失败绝不得将 activeId 抢夺回 s-orig');

  // 关键断言 2:失败目标的待写草稿被清理
  assert.equal(droppedDraftId, 's-new-1', '失败目标的防抖草稿被清除');

  // 关键断言 3:未持久化成功的 s-new-1 已被回滚剔除
  assert.equal(sessions.some((s) => s.id === 's-new-1'), false, '失败会话被回滚移除');

  // 关键断言 4:storage 不会被错误回写为失败的 ID
  assert.equal(storageSavedActiveId, null, 'storage 未被写为已失败的会话 ID');
});

test('executeSessionCreation:保存期间若会话产生了工作内容,失败不删除该会话', async () => {
  let activeId: string = 's-orig';
  let sessions: Array<{ id: string; messages: any[]; draft?: SessionDraft }> = [
    { id: 's-orig', messages: [{ role: 'user' }], draft: draft() },
  ];

  const adapter: SessionCreationStoreAdapter = {
    getSessions: () => sessions,
    getActiveSessionId: () => activeId,
    setSessions: (next) => {
      sessions = next;
    },
    setActiveSessionId: (id) => {
      activeId = id;
    },
    patchDraftOf: () => {},
    dropPendingDraftSave: () => {},
    flushDraftSaves: () => {},
    createSession: (initialDraft) => ({
      id: 's-new-busy',
      title: '新会话',
      messages: [],
      draft: initialDraft ?? draft(),
    }),
    saveSession: async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      throw new Error('Save failed');
    },
    setActiveSessionIdStorage: async () => {},
  };

  const createPromise = executeSessionCreation(adapter);

  // 模拟在保存等待期间,用户向该会话注入了一条消息
  await new Promise((resolve) => setTimeout(resolve, 5));
  const createdSess = sessions.find((s) => s.id === 's-new-busy');
  assert.ok(createdSess);
  createdSess.messages.push({ role: 'user', content: '用户急切发送的内容' });

  await assert.rejects(createPromise, /Save failed/);

  // 关键断言:因为产生了用户消息,回滚时不删除此会话
  assert.equal(sessions.some((s) => s.id === 's-new-busy'), true, '已产生用户内容的会话保留');
});