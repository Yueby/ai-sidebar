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
import { renderA11yTree, assignOrdinals, type A11yNode } from '../lib/a11yTree';

const node = (over: Partial<A11yNode> & { role: string }): A11yNode => ({ depth: 0, ...over });

test('渲染:结构缩进 + 名字引号 + 状态旗标 + 链接内联 url', () => {
  const nodes: A11yNode[] = [
    node({ role: 'main', depth: 0 }),
    node({ role: 'heading', depth: 1, name: '今日特惠', states: ['level=2'] }),
    node({ role: 'link', depth: 2, name: "No Man's Sky", href: '/app/275850', interactive: true }),
    node({ role: 'text', depth: 2, text: '¥26.00（-60%）' }),
  ];
  const out = renderA11yTree(assignOrdinals(nodes));
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

test('交互节点编号:第 2 个及以后才带 [n](与 click_element 的 ordinal 同口径)', () => {
  const nodes: A11yNode[] = [
    node({ role: 'button', name: '删除', interactive: true }),
    node({ role: 'button', name: '删除', interactive: true }),
    node({ role: 'button', name: '删除', interactive: true }),
    node({ role: 'button', name: '复制', interactive: true }),
  ];
  const out = renderA11yTree(assignOrdinals(nodes)).split('\n');
  assert.equal(out[0]!.trim(), '- button "删除"', '首个不带标记(ordinal 默认 1)');
  assert.equal(out[1]!.trim(), '- button "删除" [2]');
  assert.equal(out[2]!.trim(), '- button "删除" [3]');
  assert.equal(out[3]!.trim(), '- button "复制"', '同名组独立编号,首个不带标记');
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

test('renderA11yTree:输出 id 句柄(无名元素唯一的稳定 CSS 句柄)', () => {
  const nodes: A11yNode[] = [
    node({ role: 'region', name: '今日特惠', id: 'deals-title' }),
    node({ role: 'text', depth: 1, text: '¥26.00（-60%）', id: 'price-1' }),
  ];
  const out = renderA11yTree(nodes).split('\n');
  assert.equal(out[0], '- region "今日特惠" #deals-title');
  assert.match(out[1]!, /#price-1/, '文本节点也能带 id');
});
