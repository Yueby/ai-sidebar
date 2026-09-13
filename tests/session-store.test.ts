/**
 * sessionStore(IndexedDB + JSONL 记录)自动化覆盖。
 *
 * 用 fake-indexeddb 在 node 里跑真实 IDB 语义(openDB/事务/put/getAll),把落盘往返与容错
 * 钉住——落盘往返与容错因此可在 node 里重复验证。
 *
 * 覆盖契约:往返无损 / 幂等 / 排序 / 坏行容错(不炸全表) / 单事务原子替换 / 单条删除。
 */
import './helpers/browser-stub';
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDB } from 'idb';
import { listSessions, saveSession, deleteSession, replaceAllSessions } from '../lib/sessionStore';
import { createUserMessage } from '../lib/storage';
import { renderPageRefsBlock } from '../lib/pageRefs';
import type { ChatMessage, Session, SessionDraft } from '../lib/types';

/** 构造一份**形状完整**的会话:含带引用块的 user 消息、assistant(含 thinking/toolCall 块)、toolResult */
function makeSession(id: string, updatedAt: number, over: Partial<Session> = {}): Session {
  const refsBlock = renderPageRefsBlock({
    tabs: [{ tabId: 42, title: '示例页', url: 'https://example.com/a' }],
    elements: [],
  });
  const messages: ChatMessage[] = [
    createUserMessage('这是什么页面?' + refsBlock) as ChatMessage,
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '先看看页面' },
        { type: 'text', text: '让我读一下。' },
        { type: 'toolCall', id: 'call-1', name: 'read_page', arguments: { tabId: 42 } },
      ],
      api: 'openai-completions',
      provider: 'test',
      model: 'test-model',
      stopReason: 'toolUse',
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      timestamp: updatedAt + 1,
    } as ChatMessage,
    {
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'read_page',
      content: [{ type: 'text', text: '页面正文' }],
      isError: false,
      timestamp: updatedAt + 2,
    } as ChatMessage,
  ];
  const draft: SessionDraft = {
    input: '草稿内容',
    refTabs: [{ id: 42, title: '示例页', url: 'https://example.com/a' }],
    pickedElements: [
      { elementId: 7, tabId: 42, selector: '#main', tagName: 'div', preview: '主要内容' },
    ] as SessionDraft['pickedElements'],
  };
  return {
    id,
    title: '测试会话',
    messages,
    createdAt: updatedAt - 1000,
    updatedAt,
    draft,
    ...over,
  };
}

/** 每个用例从干净状态开始(不删库:模块级 dbPromise 会留下陈旧句柄) */
async function resetStore(): Promise<void> {
  await replaceAllSessions([]);
}

test('往返无损:saveSession → listSessions 保留消息/引用块/草稿/压缩标记', async () => {
  await resetStore();
  const base = 1_700_000_000_000;
  const summaryTs = base + 100;
  const session = makeSession('rt-1', base, {
    compaction: { summaryTimestamp: summaryTs, tokensBefore: 12345, compactedAt: base + 150 },
    customTitle: true,
  });
  // 压缩摘要**由一条 user 消息承载**(types.ts 的约定):写入端会把它转成 compaction entry,
  // 解析端再从 entry 还原成消息。缺这条消息时标记会被归一化丢弃(见下一条测试)。
  session.messages.push({ role: 'user', content: '【摘要】此前对话的要点……', timestamp: summaryTs } as ChatMessage);
  await saveSession(session);

  const [got] = await listSessions();
  assert.ok(got, '应能读回会话');
  assert.equal(got.id, session.id);
  assert.equal(got.title, session.title);
  assert.equal(got.customTitle, true);
  assert.equal(got.createdAt, session.createdAt);
  assert.equal(got.updatedAt, session.updatedAt);
  assert.equal(got.messages.length, 4, 'user + assistant + toolResult + 摘要消息 都必须保留');

  const [user, assistant, toolResult] = got.messages;
  assert.equal(user!.role, 'user');
  assert.ok(String((user as { content: string }).content).includes('<page-refs>'), '引用块原样往返');
  assert.equal(assistant!.role, 'assistant');
  const blocks = (assistant as { content: Array<{ type: string }> }).content.map((b) => b.type);
  assert.deepEqual(blocks, ['thinking', 'text', 'toolCall'], '块顺序与种类不得丢失');
  assert.equal(toolResult!.role, 'toolResult', 'toolResult 形状不全会被 sanitize 丢弃,故需存活');

  assert.equal(got.draft?.input, '草稿内容');
  assert.equal(got.draft?.refTabs.length, 1);
  assert.equal(got.draft?.refTabs[0]?.id, 42);
  // sanitizeDraft 会归一化元素引用:elementId 必须是正整数才保留,并补齐 id(=tabId:selector)与 preview
  const picked = got.draft?.pickedElements[0];
  assert.equal(got.draft?.pickedElements.length, 1);
  assert.equal(picked?.elementId, 7);
  assert.equal(picked?.selector, '#main');
  assert.equal(picked?.id, '42:#main', '缺失的 id 由 tabId:selector 派生');
  assert.equal(got.compaction?.tokensBefore, 12345);
  assert.equal(got.compaction?.summaryTimestamp, summaryTs, '摘要定位键必须原样往返');
  assert.equal(got.compaction?.compactedAt, base + 150);
  const rebuiltSummary = got.messages.find((m) => m.timestamp === summaryTs);
  assert.equal(rebuiltSummary?.role, 'user', '摘要消息由 compaction entry 还原');
  assert.ok(String((rebuiltSummary as { content: string }).content).includes('【摘要】'), '摘要正文不得丢');
});

test('悬空压缩标记:摘要消息不存在时,标记被归一化丢弃(不留指向空处的指针)', async () => {
  await resetStore();
  // compaction 指向一条**不存在**的消息:写入端不产出 compaction entry,
  // 因此重载后不应出现无内容的压缩标记(否则 effectiveMessages 会按它裁掉真实历史)
  await saveSession(
    makeSession('dangling', 700, {
      compaction: { summaryTimestamp: 123, tokensBefore: 999, compactedAt: 456 },
    }),
  );
  const [got] = await listSessions();
  assert.equal(got?.compaction, undefined, '无摘要内容的标记不得复活');
  assert.equal(got?.messages.length, 3, '消息本身不受影响');
});

test('幂等:同一会话重复保存只有一个条目,且以最后一次为准', async () => {
  await resetStore();
  await saveSession(makeSession('idem-1', 100));
  await saveSession(makeSession('idem-1', 200, { title: '改过的标题' }));

  const all = await listSessions();
  assert.equal(all.length, 1, '同 id 重复保存不得产生第二行');
  assert.equal(all[0]!.title, '改过的标题');
  assert.equal(all[0]!.updatedAt, 200);
});

test('排序:listSessions 按 updatedAt 降序', async () => {
  await resetStore();
  await saveSession(makeSession('s-old', 100));
  await saveSession(makeSession('s-new', 300));
  await saveSession(makeSession('s-mid', 200));

  const ids = (await listSessions()).map((s) => s.id);
  assert.deepEqual(ids, ['s-new', 's-mid', 's-old']);
});

test('坏行容错:单行损坏不炸全表,健康会话仍返回并留下告警', async () => {
  await resetStore();
  await saveSession(makeSession('healthy', 500));

  // 直接往同一个 store 塞两类坏行:非法 JSON / 缺 header 的合法 JSON
  const db = await openDB('ai-sidebar-sessions', 1);
  await db.put('sessions', { id: 'bad-json', jsonl: 'not-json-at-all', updatedAt: 999 });
  await db.put('sessions', {
    id: 'bad-no-header',
    jsonl: '{"type":"message","id":"x","parentId":null,"timestamp":"t"}',
    updatedAt: 998,
  });
  db.close();

  const warns: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(args.map(String).join(' '));
  };
  let sessions: Session[];
  try {
    sessions = await listSessions();
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(sessions.map((s) => s.id), ['healthy'], '坏行被跳过,健康会话必须在');
  assert.equal(warns.length, 2, '两条坏行各告警一次(证明真的走了容错分支而非侥幸通过)');
  assert.ok(warns.every((w) => w.includes('skipping corrupted session row')));
});

test('原子替换:replaceAllSessions 清空后写入,旧内容不残留', async () => {
  await resetStore();
  await saveSession(makeSession('stale-1', 100));
  await saveSession(makeSession('stale-2', 200));

  await replaceAllSessions([makeSession('fresh-1', 300)]);
  assert.deepEqual((await listSessions()).map((s) => s.id), ['fresh-1'], '替换后旧会话不得残留');

  await replaceAllSessions([]);
  assert.deepEqual(await listSessions(), [], '替换为空集即清库(恢复前清场用)');
});

test('删除:deleteSession 只移除目标会话', async () => {
  await resetStore();
  await saveSession(makeSession('keep', 100));
  await saveSession(makeSession('drop', 200));

  await deleteSession('drop');
  assert.deepEqual((await listSessions()).map((s) => s.id), ['keep']);
  // 重复删除同一 id 不抛错(幂等)
  await deleteSession('drop');
  assert.deepEqual((await listSessions()).map((s) => s.id), ['keep']);
});
