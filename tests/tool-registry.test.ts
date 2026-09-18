/**
 * 工具面接线回归:防止「工具实现了、文档宣称存在,却忘了接进 registry」这类静默缺失。
 * 接线缺失的表现是 agent 缺少对应能力(如关标签页 / 切前台),且不会有任何报错——
 * 因此必须由断言把"文档宣称的工具面"钉住。
 */
import './helpers/browser-stub';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getTools, createPageActionTools } from '../lib/tools/registry';

const baseOptions = (over: Record<string, unknown> = {}) =>
  ({
    sessionId: 'reg-test',
    refTabs: [],
    pickedElements: [],
    canUseImage: true,
    webSearch: null,
    dynamicTabs: [],
    ...over,
  }) as never;

test('无条件注册的工具全部在线(含标签页生命周期)', () => {
  const names = getTools(baseOptions()).map((t) => t.name);
  for (const required of [
    // utility
    'read_time',
    'ask_user',
    'compact_context',
    // read
    'read_page',
    'read_element',
    // discovery
    'search_element',
    'search_page',
    // action
    'click_element',
    'fill_element',
    'scroll_page',
    'open_page',
    'activate_page',
    'close_page',
    // fetch / gated
    'fetch_url',
    'execute_js',
  ]) {
    assert.ok(names.includes(required), `${required} 必须已接入工具面(当前: ${names.join(', ')})`);
  }
});

test('标签页生命周期三件套齐全且顺序在动作组内', () => {
  const names = createPageActionTools(baseOptions()).map((t) => t.name);
  for (const t of ['open_page', 'activate_page', 'close_page']) {
    assert.ok(names.includes(t), `${t} 未接入动作组`);
  }
});

test('条件注册:vision 才有 screenshot_page;未配置搜索源不占工具面', () => {
  assert.ok(getTools(baseOptions({ canUseImage: true })).some((t) => t.name === 'screenshot_page'));
  assert.ok(!getTools(baseOptions({ canUseImage: false })).some((t) => t.name === 'screenshot_page'));
  assert.ok(!getTools(baseOptions({ webSearch: null })).some((t) => t.name === 'search_web'));
});

test('技能工具:save_skill 常在;read_skill 仅在存在面向模型的技能时注册', () => {
  const none = getTools(baseOptions()).map((t) => t.name);
  assert.ok(none.includes('save_skill'), 'save_skill 无条件注册(创作/安装的落库端)');
  assert.ok(!none.includes('read_skill'), '没有技能时不占工具面(条件注册省 token)');

  const skill = (over: Record<string, unknown>) => ({
    id: 's1',
    name: 'demo',
    description: 'demo skill',
    content: 'body',
    source: 'user',
    enabled: true,
    createdAt: 1,
    ...over,
  });
  const withSkill = getTools(baseOptions({ skills: [skill({})] })).map((t) => t.name);
  assert.ok(withSkill.includes('read_skill'), '有可用技能时必须能载入');

  // 只有禁用/仅手动唤起的技能 → 对模型而言没有可载入项,不占工具面
  const hidden = getTools(
    baseOptions({ skills: [skill({ name: 'a', enabled: false }), skill({ name: 'b', disableModelInvocation: true })] }),
  ).map((t) => t.name);
  assert.ok(!hidden.includes('read_skill'));
});

test('read_skill 拿到完整列表:禁用/仅手动技能被如实挡下,而不是报成不存在', async () => {
  const skill = (over: Record<string, unknown>) => ({
    id: 's1',
    name: 'demo',
    description: 'demo skill',
    content: 'BODY',
    source: 'user',
    enabled: true,
    createdAt: 1,
    ...over,
  });
  const tools = getTools(
    baseOptions({
      skills: [
        skill({ id: 's1', name: 'usable' }),
        skill({ id: 's2', name: 'switched-off', enabled: false }),
        skill({ id: 's3', name: 'manual-only', disableModelInvocation: true }),
      ],
    }),
  );
  const readSkill = tools.find((t) => t.name === 'read_skill');
  assert.ok(readSkill, '有可用技能时必须注册 read_skill');

  const textOf = (res: { content: unknown }) =>
    String((res.content as { type: string; text: string }[])[0]?.text ?? '');

  const disabled = await readSkill!.execute('c1', { name: 'switched-off' });
  assert.ok(
    textOf(disabled).startsWith('skill_not_available:'),
    `禁用技能必须被如实挡下,实际: ${textOf(disabled).slice(0, 70)}`,
  );

  const manual = await readSkill!.execute('c2', { name: 'manual-only' });
  assert.ok(
    textOf(manual).startsWith('skill_not_available:'),
    `仅手动技能必须被如实挡下,实际: ${textOf(manual).slice(0, 70)}`,
  );

  const usable = await readSkill!.execute('c3', { name: 'usable' });
  assert.ok(textOf(usable).includes('BODY'), '可用技能正常载入');
});
