/**
 * 工具面接线回归:防止「工具实现了、文档宣称存在,却忘了接进 registry」这类静默缺失。
 * 真实案例:`activate_page` / `close_page` 于 a8b2bda 实现(含 pageContext 支持),
 * 但从未出现在任何注册点 → agent 实际上没有关标签页/切前台的能力,
 * 直到用户在真机对话里问「我们没有关闭标签页的工具吗？」才暴露。
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
