/**
 * 会话 Agent 转录迁移集成测试(决策 36 第②步):
 * 用 pi-ai 自带的 faux provider 驱动**真实 Agent**(无网络),验证转录自持/覆盖/隔离。
 * 运行:pnpm dlx tsx --test tests/agent-transcript.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
// 副作用导入:定义测试环境的 browser 全局(必须先于被测模块)
import './helpers/browser-stub';
import { createFauxCore, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import {
  runAgentTurn,
  setAgentOverrides,
  setAgentEventSink,
  disposeAllSessionAgents,
  disposeSessionAgent,
  hasSessionAgent,
} from '../lib/agent';
import { createUserMessage, messageText } from '../lib/storage';
import type { ProviderConfig } from '../lib/types';

const faux = createFauxCore({ tokensPerSecond: 0 });

const FAKE_PROVIDER: ProviderConfig = {
  id: 'faux-provider',
  name: 'Faux',
  api: 'openai-completions',
  baseUrl: 'https://example.invalid/v1',
  apiKey: 'test-key',
  models: [{ id: 'faux-model', displayName: 'Faux', reasoning: false, vision: false }],
};

function installFaux(): void {
  setAgentOverrides({
    // 测试注入:模型解析与流函数都走 faux(不发网络请求);tools 为空避开 WXT 虚拟模块 i18n
    resolveModel: () => faux.getModel() as never,
    streamFn: faux.streamSimple as never,
    tools: [],
  });
}

const baseOptions = (sessionId: string, userMessage: ReturnType<typeof createUserMessage>) => ({
  provider: FAKE_PROVIDER,
  modelId: 'faux-model',
  userMessage,
  thinkingLevel: 'off' as const,
  sessionId,
});

test.afterEach(() => {
  setAgentOverrides(null);
  setAgentEventSink(null);
  disposeAllSessionAgents();
});

test('两轮普通 prompt:Agent 自持转录,第二轮不传 history 也不丢不重', async () => {
  installFaux();
  faux.setResponses([fauxAssistantMessage('reply-1'), fauxAssistantMessage('reply-2')]);

  const u1 = createUserMessage('hello-1');
  const r1 = await runAgentTurn({ ...baseOptions('t1', u1), history: [] });
  assert.deepEqual(
    r1.messages.map((m) => m.role),
    ['user', 'assistant'],
  );
  assert.equal(messageText(r1.messages[0]!), 'hello-1');

  // 第二轮:不传 history(Agent 自持转录)
  const u2 = createUserMessage('hello-2');
  const r2 = await runAgentTurn({ ...baseOptions('t1', u2) });
  assert.deepEqual(
    r2.messages.map((m) => m.role),
    ['user', 'assistant', 'user', 'assistant'],
  );
  const userTexts = r2.messages.filter((m) => m.role === 'user').map((m) => messageText(m));
  assert.deepEqual(userTexts, ['hello-1', 'hello-2'], '用户消息不重复不丢失');
});

test('history 覆盖语义:编辑重发截断后旧回复消失且新 user 只出现一次', async () => {
  installFaux();
  faux.setResponses([fauxAssistantMessage('old reply'), fauxAssistantMessage('new reply')]);

  const u1 = createUserMessage('original');
  await runAgentTurn({ ...baseOptions('t2', u1), history: [] });

  // 编辑重发:前缀为空(目标消息之前无历史),prompt 追加新 user
  const edited = createUserMessage('edited');
  const r2 = await runAgentTurn({ ...baseOptions('t2', edited), history: [] });
  assert.deepEqual(
    r2.messages.map((m) => m.role),
    ['user', 'assistant'],
    '旧 assistant 被截断,只剩新 user + 新回复',
  );
  assert.equal(messageText(r2.messages[0]!), 'edited');
});

test('多会话并发:两个 sessionId 的 Agent 转录互不污染', async () => {
  installFaux();
  faux.setResponses([fauxAssistantMessage('reply-a'), fauxAssistantMessage('reply-b')]);

  const [ra, rb] = await Promise.all([
    runAgentTurn({ ...baseOptions('A', createUserMessage('msg-a')), history: [] }),
    runAgentTurn({ ...baseOptions('B', createUserMessage('msg-b')), history: [] }),
  ]);
  assert.equal(messageText(ra.messages[0]!), 'msg-a');
  assert.equal(messageText(rb.messages[0]!), 'msg-b');
  assert.equal(ra.messages.length, 2);
  assert.equal(rb.messages.length, 2);
  assert.ok(hasSessionAgent('A') && hasSessionAgent('B'));
});

test('常驻订阅:Agent 生命周期事件经 sink 透出(含 agent_start/agent_end)', async () => {
  installFaux();
  const seen: string[] = [];
  setAgentEventSink((sessionId, event) => {
    seen.push(`${sessionId}:${event.type}`);
  });
  faux.setResponses([fauxAssistantMessage('hello')]);

  await runAgentTurn({ ...baseOptions('t3', createUserMessage('hi')), history: [] });
  assert.ok(seen.includes('t3:agent_start'), 'agent_start 经常驻订阅透出');
  assert.ok(seen.includes('t3:agent_end'), 'agent_end 经常驻订阅透出');
  assert.ok(seen.some((e) => e.startsWith('t3:message_end')), 'message_end 经常驻订阅透出');
});

test('dispose 后旧 Agent 事件不再透出(epoch 失效)', async () => {
  installFaux();
  const seen: string[] = [];
  setAgentEventSink((sessionId, event) => {
    seen.push(`${sessionId}:${event.type}`);
  });
  faux.setResponses([fauxAssistantMessage('r1'), fauxAssistantMessage('r2')]);

  await runAgentTurn({ ...baseOptions('t4', createUserMessage('first')), history: [] });
  disposeSessionAgent('t4');
  assert.equal(hasSessionAgent('t4'), false);

  // 重新创建(新 epoch):事件必须来自新实例
  seen.length = 0;
  await runAgentTurn({ ...baseOptions('t4', createUserMessage('second')), history: [] });
  assert.ok(seen.includes('t4:agent_start'));
  assert.equal(hasSessionAgent('t4'), true);
});
