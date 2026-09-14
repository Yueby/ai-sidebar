/**
 * "无 ARIA 角色的可点容器"线索构造(纯函数)回归。
 *
 * 契约:①name 依次取 img alt → img title → 容器可见文本,全空则为空串(仍可凭 ordinal 寻址)
 * ②hint 取 img 文件名(去路径与查询串),无 img 时退化为 `img <alt>` 或 `clickable container`
 * ③空白折叠与截断不得产生前导/尾随空格(否则清单行会出现多余引号与空格)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { clickableCardLabel } from '../lib/clickableCards';

test('name 优先 img alt,其次 title,再次容器文本', () => {
  assert.equal(clickableCardLabel({ imgAlt: '阿尔法', text: '阿尔法' }).name, '阿尔法');
  assert.equal(clickableCardLabel({ imgTitle: '贝塔', text: '贝塔' }).name, '贝塔');
  assert.equal(clickableCardLabel({ text: '  伽马  角色卡  ' }).name, '伽马 角色卡');
  assert.equal(clickableCardLabel({}).name, '', '无线索时 name 为空(仍可用 ordinal 寻址)');
});

test('hint 取 img 文件名,去路径与查询串', () => {
  assert.equal(clickableCardLabel({ imgSrc: './thumb-1.png' }).hint, 'img thumb-1.png');
  assert.equal(
    clickableCardLabel({ imgSrc: 'https://cdn.example.com/a/b/card.webp?v=3#x' }).hint,
    'img card.webp',
  );
  // 无 img 时:有 alt 用 alt,否则给通用说明
  assert.equal(clickableCardLabel({ imgAlt: '阿尔法' }).hint, 'img 阿尔法');
  assert.equal(clickableCardLabel({ text: '只有文本' }).hint, 'clickable container');
});

test('文本折叠与截断不留空白残渣', () => {
  const long = '甲'.repeat(80);
  const out = clickableCardLabel({ text: `  ${long}  ` });
  assert.equal(out.name.length, 40);
  assert.ok(!out.name.startsWith(' ') && !out.name.endsWith(' '));
  assert.ok(!out.hint.includes('\n'));
});
