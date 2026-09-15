/**
 * 压缩切点保护(决策 52)纯逻辑回归。
 *
 * 契约:技能正文(`<skill_content>` 包裹)是持久行为指导,**不得被摘要扫走**——
 * 丢掉它会让 agent 悄悄退化且无任何可见错误(Agent Skills 标准明确要求客户端保住)。
 * 切点夹紧到区域内最早一条技能消息之前;夹紧只缩小被摘区,绝不把新内容卷进摘要;
 * 夹紧后为 0 即"无可压缩内容"(由调用方按既有 Nothing to compact 语义处理)。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { findCutIndex, protectSkillContent, SKILL_CONTENT_MARKER } from '../lib/compaction';
import type { ChatMessage } from '../lib/types';

const skillText = (name: string, body = 'do the thing'): string =>
  `<skill_content name="${name}">\n${body}\n</skill_content>`;

const user = (text: string): ChatMessage =>
  ({ role: 'user', content: text, timestamp: 1700000000000 }) as ChatMessage;

const assistant = (text: string): ChatMessage =>
  ({
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-completions',
    provider: 'p',
    model: 'm',
    stopReason: 'stop',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    timestamp: 1700000000001,
  }) as ChatMessage;

const toolResult = (text: string): ChatMessage =>
  ({
    role: 'toolResult',
    toolCallId: 'call-1',
    toolName: 'read_skill',
    isError: false,
    content: [{ type: 'text', text }],
    timestamp: 1700000000002,
  }) as ChatMessage;

test('无技能消息:切点原样返回', () => {
  const messages = [user('a'), assistant('b'), user('c')];
  assert.equal(protectSkillContent(messages, 2), 2);
  assert.equal(protectSkillContent(messages, 0), 0);
});

test('技能消息在切点之后:不受影响(本就不在被摘区)', () => {
  const messages = [user('a'), user('b'), user(skillText('pdf-tools'))];
  assert.equal(protectSkillContent(messages, 2), 2);
});

test('技能消息在被摘区内:切点前移到它之前', () => {
  const messages = [user('a'), user(skillText('pdf-tools')), user('b'), user('c')];
  assert.equal(protectSkillContent(messages, 4), 1);
  assert.equal(protectSkillContent(messages, 2), 1);
});

test('多条技能消息:取最早那条(后续自然一起留在保留区)', () => {
  const messages = [
    user('a'),
    user(skillText('one')),
    user('b'),
    toolResult(skillText('two')),
    user('c'),
  ];
  assert.equal(protectSkillContent(messages, 5), 1);
});

test('技能消息位于首位:夹紧为 0(无可压缩内容,不强压)', () => {
  const messages = [user(skillText('pdf-tools')), user('a'), user('b')];
  assert.equal(protectSkillContent(messages, 3), 0);
  assert.equal(protectSkillContent(messages, 1), 0);
});

test('夹紧不得让 toolResult 成为首条保留消息:再往前挪一格', () => {
  const messages = [user('a'), assistant('calling read_skill'), toolResult(skillText('pdf-tools')), user('tail')];
  // 目标切点 3 → 区域内最早技能消息是下标 2 的 toolResult → 前移到其 toolCall(下标 1)
  assert.equal(protectSkillContent(messages, 3), 1);
  // toolResult 处于首位时无法再前移,停在 0
  const headless = [toolResult(skillText('pdf-tools')), user('tail')];
  assert.equal(protectSkillContent(headless, 1), 0);
});

test('切点越界(负数/超长)按边界夹紧', () => {
  const messages = [user('a'), user('b')];
  assert.equal(protectSkillContent(messages, -5), 0);
  assert.equal(protectSkillContent(messages, 99), 2);
});

test('findCutIndex:端到端——被摘区含技能消息时切点被夹紧', () => {
  const messages = [user('one'), user(skillText('pdf-tools')), user('three'), user('four')];
  // keepRecentTokens=1 → 目标切点落在最后一条(只保留它);技能消息在下标 1 → 夹紧到 1
  assert.equal(findCutIndex(messages, 1), 1);
  // 技能消息只在保留区里时不受影响:目标切点 2 与技能消息(下标 2)重合 → 保持 2
  const tailSkill = [user('one'), user('two'), user(skillText('pdf-tools'))];
  assert.equal(findCutIndex(tailSkill, 1), 2);
});

test('标记常量与 read_skill 输出同形(压缩识别的唯一依据)', () => {
  assert.ok(skillText('x').includes(SKILL_CONTENT_MARKER));
  assert.ok(SKILL_CONTENT_MARKER.startsWith('<skill_content'));
});