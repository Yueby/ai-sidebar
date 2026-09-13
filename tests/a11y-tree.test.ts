/**
 * 可访问性树序列化的纯逻辑回归。
 *
 * 契约:①包装角色无载荷时不占行(子节点视觉上提),避免输出膨胀
 * ②交互节点按 (role,name) 编号,只有第 2 个及以后带 [n],与 click_element 的 ordinal 同口径
 * ③链接内联 /url:、表单内联 value、状态旗标 [checked]/[disabled] 可见
 * ④maxLines / maxDepth 截断必须带可行动提示,且不得静默丢内容
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderA11yTree, type A11yNode } from '../lib/a11yTree';

const node = (over: Partial<A11yNode> & { role: string }): A11yNode => ({ depth: 0, ...over });

test('渲染:结构缩进 + 名字引号 + 状态旗标 + 链接内联 url', () => {
  const nodes: A11yNode[] = [
    node({ role: 'main', depth: 0 }),
    node({ role: 'heading', depth: 1, name: '今日特惠', states: ['level=2'] }),
    node({ role: 'link', depth: 2, name: "No Man's Sky", href: '/app/275850', interactive: true }),
    node({ role: 'text', depth: 2, text: '¥26.00（-60%）' }),
  ];
  const out = renderA11yTree(nodes);
  assert.equal(
    out,
    [
      '- main',
      '  - heading "今日特惠" [level=2]',
      '    - link "No Man\'s Sky" /url: /app/275850',
      '    - text: "¥26.00（-60%）"',
    ].join('\n'),
  );
});

test('包装角色无载荷时不占行,有载荷时保留(避免输出膨胀)', () => {
  const nodes: A11yNode[] = [
    node({ role: 'generic', depth: 0 }), // 纯包装:不占行
    node({ role: 'button', depth: 1, name: '保存', interactive: true }),
    node({ role: 'group', depth: 0, name: '组织' }), // 有名字:保留
  ];
  const out = renderA11yTree(nodes);
  assert.equal(out, ['  - button "保存"', '- group "组织"'].join('\n'));
});

test('截断:maxLines 与 maxDepth 都必须给出可行动提示', () => {
  const many: A11yNode[] = Array.from({ length: 10 }, (_, i) => node({ role: 'link', name: `l${i}`, interactive: true }));
  const limited = renderA11yTree(many, { maxLines: 3 });
  assert.equal(limited.split('\n').length, 3 + 2, '3 行正文 + 空行 + 提示');
  assert.match(limited, /tree truncated at 3 lines/);
  assert.match(limited, /pass root to scope a subtree/);

  const deep: A11yNode[] = [node({ role: 'main' }), node({ role: 'link', depth: 9, name: 'deep', interactive: true })];
  const shallow = renderA11yTree(deep, { maxDepth: 5 });
  assert.ok(!/link "deep"/.test(shallow), '超深节点不得出现在输出里');
  assert.match(shallow, /1 deeper node\(s\) beyond maxDepth=5 omitted/);
});

test('长文本截断到 160 字符并保留省略号(不吞掉整行)', () => {
  const long = 'x'.repeat(400);
  const out = renderA11yTree([node({ role: 'text', text: long })]);
  assert.match(out, /…"/);
  assert.ok(out.length < 200, `输出应被截断,实际 ${out.length}`);
});

// 可操作节点的名字会被模型原样交给 click_element/fill_element(动作侧精确匹配)→ 渲染不得改写
test('可操作节点的名字不做截断改写,非可操作名才截断留痕', () => {
  const long = 'x'.repeat(220);
  const interactive = renderA11yTree([{ depth: 0, role: 'button', name: long, interactive: true }]);
  assert.ok(interactive.includes(long), '可操作名必须原样呈现');
  assert.ok(!interactive.includes('…'), '不得给可操作名加省略号(模型会照抄这个字符串)');
  const plain = renderA11yTree([{ depth: 0, role: 'region', name: long }]);
  assert.ok(plain.includes('…'), '非可操作名可以截断,但必须留痕');
  assert.ok(plain.length < interactive.length, '截断确实缩短了输出');
});

// 序号来自动作侧同一枚举:渲染只如实呈现,绝不按本棵树重编号
test('序号如实呈现:第 1 个不带标记,采集侧给的 [n] 原样输出', () => {
  const out = renderA11yTree([
    { depth: 0, role: 'button', name: 'Delete', interactive: true, ordinal: 1 },
    { depth: 0, role: 'button', name: 'Delete', interactive: true, ordinal: 2 },
    { depth: 0, role: 'button', name: 'Delete', interactive: true, ordinal: 5 },
  ]);
  const lines = out.split('\n');
  assert.ok(!lines[0]!.includes('[1]'), '第 1 个不标记');
  assert.ok(lines[1]!.includes('[2]'), '第 2 个按采集侧的序号');
  assert.ok(lines[2]!.includes('[5]'), '跨子树/裁剪后仍保留采集侧真实序号(不重编号为 3)');
});

test('renderA11yTree:输出 id 句柄(无名元素唯一的稳定 CSS 句柄)', () => {
  const nodes: A11yNode[] = [
    node({ role: 'region', name: '今日特惠', id: 'deals-title' }),
    node({ role: 'text', depth: 1, text: '¥26.00（-60%）', id: 'price-1' }),
  ];
  const out = renderA11yTree(nodes).split('\n');
  assert.equal(out[0], '- region "今日特惠" #deals-title');
  assert.match(out[1]!, /#price-1/, '文本节点也能带 id');
});
