/**
 * 技能(Skills)纯逻辑与工具形状回归(决策 52)。
 *
 * 契约:
 * ①SKILL.md 解析:frontmatter 取 name/description,正文剥掉 frontmatter;
 * ②宽松校验 —— 名字不合规只告警仍载入,description 缺失/空白才拒绝(没有它 catalog 无从工作);
 * ③跨客户端兼容 —— 值里未加引号却含冒号时整行剩余部分就是值(按 YAML 非法,但别人这么写);
 * ④catalog 只含启用且非"仅手动唤起"的技能,且必须做 XML 转义;
 * ⑤read_skill 返回 <skill_content> 包裹的正文,同一会话第二次调用不重复注入,未知名字给可行动错误。
 */
import './helpers/browser-stub';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Skill } from '../lib/types';
import {
  findSkillByName,
  listSkills,
  saveSkill,
  SKILL_CONTENT_MAX,
  mergeBuiltinSkills,
  modelFacingSkills,
  parseSkillMarkdown,
  renderSkillsCatalog,
  sanitizeSkill,
  validateSkillName,
} from '../lib/skills';
import { createReadSkillToolDefinition } from '../lib/tools/read-skill';
import { BUILTIN_SKILL_MARKDOWN } from '../lib/builtinSkills';

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

test('解析:frontmatter 取字段,正文剥掉 frontmatter', () => {
  const raw = [
    '---',
    'name: pdf-processing',
    'description: Extracts text from PDFs. Use when handling PDFs.',
    '---',
    '',
    '# PDF processing',
    '',
    'Run the extractor.',
  ].join('\n');
  const parsed = parseSkillMarkdown(raw);
  assert.ok(parsed.ok);
  assert.equal(parsed.name, 'pdf-processing');
  assert.equal(parsed.description, 'Extracts text from PDFs. Use when handling PDFs.');
  assert.ok(parsed.content.startsWith('# PDF processing'), '正文不含 frontmatter');
  assert.ok(!parsed.content.includes('name:'), 'frontmatter 字段不得留在正文里');
  assert.equal(parsed.diagnostics.length, 0);
});

test('解析:未知 frontmatter 字段忽略,disable-model-invocation 认 true', () => {
  const raw = ['---', 'name: a', 'description: b', 'license: MIT', 'metadata:', '  x: 1', 'disable-model-invocation: true', '---', 'body'].join('\n');
  const parsed = parseSkillMarkdown(raw);
  assert.ok(parsed.ok);
  assert.equal(parsed.disableModelInvocation, true);
  assert.equal(parsed.content, 'body');
});

test('解析:值里未加引号却含冒号时整行剩余部分作值(带告警)', () => {
  const raw = ['---', 'name: a', 'description: Use this when: the user asks about PDFs', '---', 'body'].join('\n');
  const parsed = parseSkillMarkdown(raw);
  assert.ok(parsed.ok, '别人写得出这种 frontmatter,不能因此装不进来');
  assert.equal(parsed.description, 'Use this when: the user asks about PDFs');
  assert.ok(parsed.diagnostics.some((d) => d.includes('unquoted colon')));
});

test('解析:description 缺失或空白 → 拒绝(没有它就无从判断何时使用)', () => {
  assert.deepEqual(parseSkillMarkdown(['---', 'name: a', '---', 'body'].join('\n')), {
    ok: false,
    reason: 'description-required',
  });
  assert.equal(
    parseSkillMarkdown(['---', 'name: a', 'description: "   "', '---', 'body'].join('\n')).ok,
    false,
  );
});

test('解析:没有 frontmatter 块 → 拒绝', () => {
  const parsed = parseSkillMarkdown('# Just markdown\n\nnothing else');
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.reason, 'frontmatter-missing');
});

test('校验:名字不合规只告警,技能仍然载入(标准的宽松要求)', () => {
  assert.deepEqual(validateSkillName('pdf-processing'), []);
  assert.ok(validateSkillName('PDF_Processing').length > 0);
  assert.ok(validateSkillName('-pdf').length > 0);
  assert.ok(validateSkillName('pdf--tools').length > 0);
  assert.ok(validateSkillName('x'.repeat(65)).length > 0);

  const parsed = parseSkillMarkdown(['---', 'name: Bad Name', 'description: d', '---', 'body'].join('\n'));
  assert.ok(parsed.ok, '名字不合规不拒绝载入');
  assert.ok(parsed.diagnostics.some((d) => d.includes('name')), '但必须留下告警');
});

test('catalog:只含启用且非仅手动唤起的技能,并做 XML 转义', () => {
  const catalog = renderSkillsCatalog([
    skill({ name: 'a', description: 'A & B <tag> "q"' }),
    skill({ name: 'off', enabled: false }),
    skill({ name: 'manual', disableModelInvocation: true }),
  ]);
  assert.ok(catalog.includes('<name>a</name>'));
  assert.ok(catalog.includes('A &amp; B &lt;tag&gt; &quot;q&quot;'), '描述必须转义');
  assert.ok(!catalog.includes('off') && !catalog.includes('manual'), '禁用/仅手动的不进 catalog');
  assert.equal(renderSkillsCatalog([skill({ enabled: false })]), '', '没有可见技能时返回空串(调用方整层省略)');
  assert.ok(!catalog.includes('<location>'), '我们没有文件系统:不输出 location(加载靠 read_skill)');
});

test('存储条目清洗:缺字段/类型不对的条目被丢弃', () => {
  assert.equal(sanitizeSkill({ name: 'a', description: 'd', content: 'c' })?.source, 'user');
  assert.equal(sanitizeSkill({ name: 'a', description: 'd' }), null, '缺正文 → 丢弃');
  assert.equal(sanitizeSkill({ name: '', description: 'd', content: 'c' }), null);
  assert.equal(sanitizeSkill(null), null);
  assert.equal(sanitizeSkill({ name: 'a', description: 'd', content: 'c', enabled: false })?.enabled, false);
});

test('内置技能合并:缺失则补上,用户的启用状态保留,同名非内置技能优先', () => {
  const fresh = mergeBuiltinSkills([]);
  assert.ok(fresh.changed);
  assert.equal(fresh.skills.length, BUILTIN_SKILL_MARKDOWN.length);
  assert.ok(fresh.skills.every((s) => s.source === 'builtin' && s.id.startsWith('builtin:')));
  assert.ok(fresh.skills.some((s) => s.name === 'memory'));

  // 用户把内置技能禁用 → 再次合并不该把它复位
  const disabled = fresh.skills.map((s) => (s.name === 'memory' ? { ...s, enabled: false } : s));
  const again = mergeBuiltinSkills(disabled);
  assert.equal(again.skills.find((s) => s.name === 'memory')?.enabled, false, '用户的禁用状态必须保留');

  // 同名用户技能优先:内置不覆盖它
  const shadowed = mergeBuiltinSkills([
    skill({ id: 'mine', name: 'memory', description: 'my own memory skill', source: 'user' }),
  ]);
  const memory = shadowed.skills.filter((s) => s.name === 'memory');
  assert.equal(memory.length, 1);
  assert.equal(memory[0]?.source, 'user', '同名用户技能胜出');
});

test('内置技能文本本身必须能被解析(它们走的是同一条解析路径)', () => {
  for (const markdown of BUILTIN_SKILL_MARKDOWN) {
    const parsed = parseSkillMarkdown(markdown);
    assert.ok(parsed.ok, `内置技能解析失败: ${parsed.ok ? '' : parsed.reason}`);
    if (parsed.ok) {
      assert.equal(parsed.diagnostics.length, 0, `内置技能不该有校验告警: ${parsed.diagnostics.join('; ')}`);
      assert.ok(parsed.content.length > 200, '内置技能正文要有实际内容');
      assert.ok(parsed.description.length <= 1024);
    }
  }
});

test('模型可见技能集:禁用与仅手动唤起都排除在外', () => {
  const list = [
    skill({ name: 'a' }),
    skill({ name: 'off', enabled: false }),
    skill({ name: 'manual', disableModelInvocation: true }),
  ];
  assert.deepEqual(modelFacingSkills(list).map((s) => s.name), ['a']);
  assert.equal(findSkillByName(list, 'OFF')?.name, 'off', '查名字大小写不敏感');
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

test('解析:正文超长时截断,并在正文里留痕', () => {
  const body = 'x'.repeat(SKILL_CONTENT_MAX + 50);
  const parsed = parseSkillMarkdown(`---\nname: big-body\ndescription: A skill\n---\n${body}`);
  assert.ok(parsed.ok, '可解析');
  if (parsed.ok) {
    assert.ok(parsed.content.length <= SKILL_CONTENT_MAX + 150, '截断后长度受限');
    assert.ok(
      parsed.content.includes('truncated at'),
      '正文里必须带截断说明 —— 模型看不出自己拿到的指令被切过',
    );
    assert.ok(
      parsed.diagnostics.some((d) => d.includes('body is longer')),
      '解析告警仍要保留',
    );
  }
});
