/**
 * 选择器分段(跨 shadow 下潜的分段依据)纯逻辑回归。
 *
 * 契约:引号/括号内的空白**不得**作为后代组合器切分 —— 否则属性值含空格的选择器
 * (`[aria-label="Save changes"]`)会被切成两段,在影子树内永远匹配不到。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSelectorSegments } from '../lib/domSelector';

test('常规后代选择器按空白切分', () => {
  assert.deepEqual(splitSelectorSegments('#host p'), ['#host', 'p']);
  assert.deepEqual(splitSelectorSegments('  main   .card  '), ['main', '.card']);
  assert.deepEqual(splitSelectorSegments(''), []);
});

test('引号内的空格不切(属性值含空格)', () => {
  assert.deepEqual(splitSelectorSegments('[aria-label="Save changes"]'), [
    '[aria-label="Save changes"]',
  ]);
  assert.deepEqual(splitSelectorSegments('#shadow-host [aria-label="Save changes"]'), [
    '#shadow-host',
    '[aria-label="Save changes"]',
  ]);
  assert.deepEqual(splitSelectorSegments("a[title='two words'] span"), [
    "a[title='two words']",
    'span',
  ]);
});

test('括号内的空格不切(:is/:not/:nth-child 的参数)', () => {
  assert.deepEqual(splitSelectorSegments(':is(.a .b) .c'), [':is(.a .b)', '.c']);
  assert.deepEqual(splitSelectorSegments(':not([data-x="a b"]) > i'), [
    ':not([data-x="a b"])',
    '>',
    'i',
  ]);
});

test('转义引号不误判引号状态', () => {
  assert.deepEqual(splitSelectorSegments('[data-x="a\\" b"] span'), ['[data-x="a\\" b"]', 'span']);
});

test('切分结果可直接交给 querySelector 解析(引号闭合)', () => {
  // 分段本身不得吞掉引号/括号字符 —— 否则下潜时每段都是非法选择器
  for (const selector of ['#h [aria-label="Save changes"]', ":is(.a .b) [data-y='c d']"]) {
    for (const segment of splitSelectorSegments(selector)) {
      const open = (segment.match(/\[/g) ?? []).length;
      const close = (segment.match(/\]/g) ?? []).length;
      assert.equal(open, close, `方括号必须闭合: ${segment}`);
      const quotes = (segment.match(/"/g) ?? []).length;
      assert.equal(quotes % 2, 0, `引号必须成对: ${segment}`);
    }
  }
});
