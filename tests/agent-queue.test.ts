/**
 * 原生队列时序集成测试(决策 36 第③步前置):
 * 用真实 pi-agent-core Agent + pi-ai faux provider 验证 followUp/steer 的消费时点、
 * 单次 prompt 语义、refs 原始转录保留与请求面转换。
 * 运行:pnpm dlx tsx --test tests/agent-queue.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/browser-stub';
import { createFauxCore, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import type { Context } from '@earendil-works/pi-ai';
import {
  runAgentTurn,
  setAgentOverrides,
  setAgentEventSink,
  sessionAgentFor,
  disposeAllSessionAgents,
} from '../lib/agent';
import { createUserMessage, messageText } from '../lib/storage';
import { renderPageRefsBlock } from '../lib/pageRefs';
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

const capturedContexts: Context[] = [];

function installFaux(): void {
  setAgentOverrides({
    resolveModel: () => faux.getModel() as never,
    streamFn: (async (model: never, context: Context) => {
      capturedContexts.push(context);
      return faux.streamSimple(model as never, context, undefined as never);
    }) as never,
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
  capturedContexts.length = 0;
  disposeAllSessionAgents();
});

test('followUp 在同一次 prompt 内消费:一次 agent_end、顺序正确', async () => {
  installFaux();
  const events: string[] = [];
  setAgentEventSink((sid, event) => {
    events.push(event.type);
  });

  let releaseFirst: (() => void) | null = null;
  let firstStarted: (() => void) | null = null;
  const firstStartedPromise = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  faux.setResponses([
    async () => {
      firstStarted!();
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return fauxAssistantMessage('reply-1');
    },
    fauxAssistantMessage('reply-2'),
  ]);

  const run = runAgentTurn({ ...baseOptions('q1', createUserMessage('first')), history: [] });
  await firstStartedPromise;

  // 第一轮仍在途:把后续消息排入原生队列(生产路径的目标形态)
  const agent = sessionAgentFor('q1');
  assert.ok(agent, 'Agent 已创建');
  assert.equal(agent.state.isStreaming, true, '第一轮在途时 isStreaming 为 true');
  agent.followUp(createUserMessage('queued'));
  assert.equal(agent.hasQueuedMessages(), true);

  releaseFirst!();
  const result = await run;

  const texts = result.messages.map((m) => (m.role === 'user' ? messageText(m) : `[${m.role}]`));
  assert.deepEqual(texts, ['first', '[assistant]', 'queued', '[assistant]'], 'followUp 作为下一个 user turn 被消费');
  assert.equal(events.filter((e) => e === 'agent_end').length, 1, '队列消费不产生额外的 run 生命周期');
  assert.equal(agent.hasQueuedMessages(), false, '队列已排空');
});

test('原始转录保留 refs 块,请求面经 convertToLlm 剥离 elements', async () => {
  installFaux();
  faux.setResponses([fauxAssistantMessage('ok')]);

  const refs = {
    tabs: [{ tabId: 7, title: 'Page', url: 'https://example.com', focused: true }],
    elements: [{ id: 1, tabId: 7, selector: '#btn', tagName: 'BUTTON', preview: 'Submit' }],
  };
  const userMessage = createUserMessage('with refs', refs);
  const storedContent = typeof userMessage.content === 'string' ? userMessage.content : '';
  assert.ok(storedContent.includes('<page-refs>'), '存储转录含 refs 块');

  const result = await runAgentTurn({ ...baseOptions('q2', userMessage), history: [] });

  // 落盘转录 = 原始(含 elements)
  const stored = result.messages[0]!;
  assert.ok(typeof stored.content === 'string' && stored.content.includes('"elements"'), '转录保留 elements');

  // 请求面 = 剥离 elements(convertToLlm)
  const sent = capturedContexts[0]?.messages?.[0];
  const sentText = typeof sent?.content === 'string' ? sent.content : JSON.stringify(sent?.content);
  assert.ok(sentText.includes('<page-refs>'), '请求面仍带 refs 块(tabs)');
  assert.ok(sentText.includes('"elements":[]'), '请求面 elements 已清空');
  assert.ok(!sentText.includes('Submit'), '请求面不含元素内容');

});

test('steer 与 followUp 的消费点不同:steer 先注入,队列先后清空', async () => {
  installFaux();
  let releaseFirst: (() => void) | null = null;
  let firstStarted: (() => void) | null = null;
  const firstStartedPromise = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  faux.setResponses([
    async () => {
      firstStarted!();
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return fauxAssistantMessage('reply-1');
    },
    fauxAssistantMessage('reply-steer'),
    fauxAssistantMessage('reply-follow'),
  ]);

  const run = runAgentTurn({ ...baseOptions('q3', createUserMessage('first')), history: [] });
  await firstStartedPromise;
  const agent = sessionAgentFor('q3')!;
  // pi 语义:steer 在当前 assistant turn 结束后注入;followUp 在 agent 本来要停止时执行
  agent.steer(createUserMessage('steer-msg'));
  agent.followUp(createUserMessage('follow-msg'));
  assert.equal(agent.hasQueuedMessages(), true);

  releaseFirst!();
  const result = await run;
  const texts = result.messages.map((m) => (m.role === 'user' ? messageText(m) : `[${m.role}]`));
  assert.deepEqual(
    texts,
    ['first', '[assistant]', 'steer-msg', '[assistant]', 'follow-msg', '[assistant]'],
    'steer 先于 followUp 被消费',
  );
  assert.equal(agent.hasQueuedMessages(), false);
});

test('dispose 期间的迟到流:旧 Agent 事件不进入 sink,重建后恢复', async () => {
  installFaux();
  const events: string[] = [];
  setAgentEventSink((sid, event) => {
    // 带上 assistant 文本:旧流的回复文本能直接被抓到(而非仅事件类型)
    const label =
      event.type === 'message_end' && event.message.role === 'assistant'
        ? `msg:${event.message.content.map((b) => (b.type === 'text' ? b.text : '')).join('')}`
        : event.type;
    events.push(`${sid}:${label}`);
  });

  let releaseOld: (() => void) | null = null;
  let oldStarted: (() => void) | null = null;
  const oldStartedPromise = new Promise<void>((resolve) => {
    oldStarted = resolve;
  });
  faux.setResponses([
    async () => {
      oldStarted!();
      await new Promise<void>((resolve) => {
        releaseOld = resolve;
      });
      return fauxAssistantMessage('old-reply');
    },
    fauxAssistantMessage('new-reply'),
  ]);

  const oldRun = runAgentTurn({ ...baseOptions('q4', createUserMessage('old')), history: [] }).catch(() => undefined);
  await oldStartedPromise;

  // 释放旧实例(abort + epoch 失效),重建同 id
  disposeAllSessionAgents();
  events.length = 0;
  const newRun = runAgentTurn({ ...baseOptions('q4', createUserMessage('new')), history: [] });

  // 放行旧流:其事件必须被 epoch 校验丢弃。
  // 断言必须能区分新旧:旧流若未被丢弃,会额外产生一次 agent_end 与 old-reply 文本。
  releaseOld!();
  await oldRun;
  await newRun;

  assert.equal(
    events.filter((e) => e === 'q4:agent_end').length,
    1,
    `旧实例的 agent_end 必须被 epoch 丢弃(实际事件:${events.join(',')})`,
  );
  assert.ok(
    !events.some((e) => e.includes('old-reply')),
    `旧实例的 message_end 文本不得进入 sink(实际:${events.join(',')})`,
  );
  assert.ok(
    events.some((e) => e.includes('new-reply')),
    '新实例事件正常透出',
  );
});
