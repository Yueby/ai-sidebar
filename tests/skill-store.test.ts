/**
 * 技能**存储层与工具形状**回归(`lib/skillStore.ts` / `read_skill`)。
 *
 * 这些用例要读写 chrome.storage.local,故必须加载浏览器 stub;纯格式规则见 `skill-format.test.ts`,
 * 已载入记录的规则见 `skill-runtime.test.ts`。
 *
 * 契约:
 * ①存储 upsert/删除/启用切换,内置技能不可覆盖、不可删除;
 * ②并发保存不丢更新(读-改-写串行化);
 * ③安装路径按标准规范化名字,手写路径仍严格;
 * ④read_skill 返回 <skill_content> 包裹的正文;禁用或"仅手动唤起"的给 skill_not_available;
 * ⑤已载入记录随转录截断清空,且按内容指纹判断(正文变了必须重新注入)。
 */
import './helpers/browser-stub';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Skill } from '../lib/types';
import { deleteSkill, listSkills, saveSkill, setSkillEnabled } from '../lib/skillStore';
import { createReadSkillToolDefinition } from '../lib/tools/read-skill';
import { clearLoadedSkills } from '../lib/skillRuntime';

const skill = (over: Partial<Skill> = {}): Skill => ({
  id: 's1',
  name: 'demo',
  description: 'Does demo things. Use when demoing.',
  content: 'Step 1.',
  source: 'user',
  enabled: true,
  createdAt: 1,
  ...over,
});

test('read_skill:返回 <skill_content> 包裹的正文,未知名字给可行动错误', async () => {
  const tool = createReadSkillToolDefinition([skill({ name: 'demo', content: 'Do the thing.' })], 'sess-1');
  const first = await tool.execute('c1', { name: 'demo' });
  const text = String((first.content as { type: string; text: string }[])[0]?.text ?? '');
  assert.ok(text.startsWith('<skill_content name="demo">'), '正文必须被 skill_content 包裹(压缩豁免靠它识别)');
  assert.ok(text.includes('Do the thing.'));
  assert.ok(text.includes('</skill_content>'));

  const missing = await tool.execute('c2', { name: 'nope' });
  const missingText = String((missing.content as { type: string; text: string }[])[0]?.text ?? '');
  assert.ok(missingText.startsWith('skill_not_found:'), '未安装:结构化前缀');
  assert.ok(missingText.includes('demo'), '错误里要列出可用技能名');
});

test('read_skill:同一会话第二次调用不重复注入正文', async () => {
  const skills = [skill({ name: 'once', content: 'UNIQUE-BODY-MARKER' })];
  const tool = createReadSkillToolDefinition(skills, 'sess-dedupe');
  const first = await tool.execute('c1', { name: 'once' });
  assert.ok(String((first.content as { type: string; text: string }[])[0]?.text).includes('UNIQUE-BODY-MARKER'));
  const second = await tool.execute('c2', { name: 'once' });
  const secondText = String((second.content as { type: string; text: string }[])[0]?.text ?? '');
  assert.ok(!secondText.includes('UNIQUE-BODY-MARKER'), '重复调用不再注入正文');
  assert.ok(secondText.includes('already loaded'));
});

test('read_skill:未启用/仅手动唤起的技能不可由模型自行载入', async () => {
  const tool = createReadSkillToolDefinition(
    [skill({ name: 'off', enabled: false }), skill({ name: 'manual', disableModelInvocation: true })],
    'sess-guard',
  );
  for (const name of ['off', 'manual']) {
    const res = await tool.execute('c1', { name });
    const text = String((res.content as { type: string; text: string }[])[0]?.text ?? '');
    assert.ok(text.startsWith('skill_not_available:'), `${name} 必须被挡住且说明原因`);
  }
});

test('存储:并发保存不丢更新(读-改-写串行化)', async () => {
  // 两个写者同时基于同一份旧列表改:未串行化时后写者会把先写者抹掉
  const [a, b] = await Promise.all([
    saveSkill({ name: 'race-a', description: 'A skill', content: 'BODY-A' }),
    saveSkill({ name: 'race-b', description: 'B skill', content: 'BODY-B' }),
  ]);
  assert.ok(a.ok && b.ok, '两次保存都成功');
  const names = (await listSkills()).map((skill) => skill.name);
  assert.ok(
    names.includes('race-a') && names.includes('race-b'),
    `两个技能都必须存在,实际: ${names.join(', ')}`,
  );
});

test('安装:不合标准的名字被规范化后保存(手写路径仍严格)', async () => {
  const installed = await saveSkill({
    name: 'PDF_Processing',
    description: 'A skill',
    content: 'BODY',
    source: 'github',
    allowNonStandardName: true,
  });
  assert.ok(installed.ok, '外部导入不因名字被拒');
  if (installed.ok) {
    assert.equal(installed.skill.name, 'pdf-processing', '规范化到标准形状');
    assert.equal(installed.renamedFrom, 'PDF_Processing', '回报被规范化的原名');
  }

  const handwritten = await saveSkill({ name: 'PDF_Processing', description: 'A skill', content: 'BODY' });
  assert.equal(handwritten.ok, false, '手写/编辑路径仍然严格');
});

test('保存:disable-model-invocation 只在明确传值时才改变', async () => {
  const created = await saveSkill({
    name: 'manual-skill',
    description: 'A skill',
    content: 'BODY',
    disableModelInvocation: true,
  });
  assert.ok(created.ok);

  const kept = await saveSkill({ name: 'manual-skill', description: 'Updated', content: 'BODY2' });
  assert.ok(kept.ok);
  if (kept.ok) assert.equal(kept.skill.disableModelInvocation, true, '未传 = 保留原值');

  const cleared = await saveSkill({
    name: 'manual-skill',
    description: 'Updated',
    content: 'BODY3',
    disableModelInvocation: false,
  });
  assert.ok(cleared.ok);
  if (cleared.ok) assert.equal(cleared.skill.disableModelInvocation, undefined, '明确 false = 清掉');
});

test('read_skill:转录被截断后清掉已载入记录,正文可以再次载入', async () => {
  const skills = [skill({ name: 'reloadable', content: 'RELOAD-BODY-MARKER' })];
  const tool = createReadSkillToolDefinition(skills, 'sess-reload');
  const textOf = (res: { content: unknown }) =>
    String((res.content as { type: string; text: string }[])[0]?.text ?? '');

  assert.ok(textOf(await tool.execute('c1', { name: 'reloadable' })).includes('RELOAD-BODY-MARKER'));
  assert.ok(
    !textOf(await tool.execute('c2', { name: 'reloadable' })).includes('RELOAD-BODY-MARKER'),
    '未清之前不重复注入',
  );

  // 编辑重发截断了转录 → 旧正文已不在上下文里,去重记录必须失效
  clearLoadedSkills('sess-reload');
  assert.ok(
    textOf(await tool.execute('c3', { name: 'reloadable' })).includes('RELOAD-BODY-MARKER'),
    '清掉之后必须能再次拿到正文',
  );
});

test('read_skill:技能正文被改动后必须重新注入(去重按内容指纹,不是布尔)', async () => {
  // 会话中途在设置里改了正文:旧指令已过时,再调必须拿到新版本
  const before = [skill({ name: 'mutable', content: 'OLD-INSTRUCTIONS' })];
  const t1 = createReadSkillToolDefinition(before, 'sess-fingerprint');
  const first = await t1.execute('c1', { name: 'mutable' });
  assert.ok(String((first.content as { type: string; text: string }[])[0]?.text).includes('OLD-INSTRUCTIONS'));

  const after = [skill({ name: 'mutable', content: 'NEW-INSTRUCTIONS' })];
  const t2 = createReadSkillToolDefinition(after, 'sess-fingerprint');
  const second = await t2.execute('c2', { name: 'mutable' });
  const text = String((second.content as { type: string; text: string }[])[0]?.text ?? '');
  assert.ok(text.includes('NEW-INSTRUCTIONS'), '正文变了就要给新的');
  assert.ok(!text.includes('already loaded'), '不能拿旧记录挡住新正文');
});

test('存储:内置技能不可覆盖、不可删除;用户技能可删', async () => {
  const all = await listSkills();
  const builtin = all.find((entry) => entry.source === 'builtin');
  assert.ok(builtin, '至少有一个内置技能');

  const overwrite = await saveSkill({
    name: builtin.name,
    description: '试图覆盖内置技能',
    content: 'hijacked',
  });
  assert.equal(overwrite.ok, false, '内置技能不可被同名覆盖');
  const removeBuiltin = await deleteSkill(builtin.id);
  assert.equal(removeBuiltin.ok, false, '内置技能不可删除(可禁用)');
  const stillThere = (await listSkills()).find((entry) => entry.id === builtin.id);
  assert.ok(stillThere, '两次拒绝之后内置技能仍在');

  const created = await saveSkill({ name: 'deletable', description: '可删', content: 'BODY' });
  assert.ok(created.ok);
  if (created.ok) {
    assert.equal((await deleteSkill(created.skill.id)).ok, true, '用户技能可删除');
    assert.ok(
      !(await listSkills()).some((entry) => entry.name === 'deletable'),
      '删除后列表里不再有它',
    );
  }
});

test('存储:启用切换落盘,且禁用后不再面向模型', async () => {
  const all = await listSkills();
  const target = all[0]!;
  assert.equal((await setSkillEnabled(target.id, false)).ok, true);
  const after = (await listSkills()).find((entry) => entry.id === target.id);
  assert.equal(after?.enabled, false, '禁用状态必须落盘');
  assert.equal((await setSkillEnabled(target.id, true)).ok, true);
  assert.equal((await listSkills()).find((entry) => entry.id === target.id)?.enabled, true, '可再启用');
  assert.equal((await setSkillEnabled('no-such-id', false)).ok, false, '未知 id 给出失败而非静默成功');
});
