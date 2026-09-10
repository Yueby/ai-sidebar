/**
 * 续读窗口 / 截图路径 / 抽取厚薄判定的纯逻辑回归。
 * 这三处都是"工具在真机上表现不好"的直接产物(见 HANDOFF 回归记录):
 * ①长文被 12000 截断后无法取回后半段;②后台标签截图被浏览器 API 限制;
 * ③SPA 首次抽取过薄时模型只能自己摸索"再等等"。
 */
import './helpers/browser-stub';
import test from 'node:test';
import assert from 'node:assert/strict';
import { textWindow, continuationHint } from '../lib/pageTextWindow';
import { capturePathFor } from '../lib/imageFetch';
import { isThinExtraction } from '../lib/tools/read-page';

test('textWindow:整段放得下时不标记截断,nextOffset 为 null', () => {
  const w = textWindow('short body', 0, 12000);
  assert.equal(w.text, 'short body');
  assert.equal(w.truncated, false);
  assert.equal(w.totalLength, 'short body'.length);
  assert.equal(w.nextOffset, null);
});

test('textWindow:超长时给出精确的下一次 offset,且能一路读到结尾', () => {
  const lines = Array.from({ length: 60 }, (_, i) => `line-${i}-${'x'.repeat(40)}`);
  const full = lines.join('\n');
  const limit = 200;

  const seen: string[] = [];
  let offset = 0;
  let guard = 0;
  let last: { start: number; text: string } | null = null;
  for (;;) {
    const w = textWindow(full, offset, limit);
    seen.push(w.text);
    assert.ok(w.text.length > 0, '窗口不得为空(否则续读会死循环)');
    last = { start: w.start, text: w.text };
    if (w.nextOffset === null) break;
    assert.ok(w.nextOffset > offset, 'offset 必须单调前进');
    offset = w.nextOffset;
    if (++guard > 200) throw new Error('续读未收敛');
  }
  // 精确属性:末窗恰好在全文长度处收口(确实读到了文末,而不是提前结束)
  assert.equal(last!.start + last!.text.length, full.length, '末窗应回到全文末尾');
  assert.ok(seen.length <= Math.ceil(full.length / limit) * 2, '跳数有界(不会碎片化)');
  const joined = seen.join('\n');
  assert.ok(joined.includes('line-0-'), '开头在内');
  assert.ok(joined.includes('line-59-'), '结尾也在内(续读确实能读到文末)');
});

test('textWindow:offset 落在行中时对齐到下一行,start 反映真实位置', () => {
  const full = 'aaa\nbbb\nccc';
  const w = textWindow(full, 2, 100);
  assert.equal(w.start, 4, '对齐到第 2 行行首');
  assert.equal(w.text, 'bbb\nccc');
  assert.equal(w.truncated, true, '前面丢掉了内容也要标记截断');
});

test('continuationHint:给出可直接照用的 offset 调用;无剩余时不给调用指引', () => {
  const mid = textWindow('a'.repeat(500), 0, 200);
  const hint = continuationHint(42, mid);
  assert.ok(hint.includes('"tabId":42'), '带上 tabId');
  assert.ok(hint.includes(`"offset":${mid.nextOffset}`), '带上精确的下一次 offset');

  const done = textWindow('small', 0, 12000);
  const endHint = continuationHint(42, done);
  assert.ok(!endHint.includes('To read the rest'), '读完就不该再引导续读');
});

test('isThinExtraction:空白/骨架判为过薄,正常正文不判', () => {
  assert.equal(isThinExtraction(''), true);
  assert.equal(isThinExtraction('   \n  \t '), true);
  assert.equal(isThinExtraction('Loading…'), true);
  assert.equal(isThinExtraction('x'.repeat(200)), false);
});

test('capturePathFor:活动标签走扩展 API,后台优先 CDP,CDP 不可用才要求切前台', () => {
  assert.equal(capturePathFor(true, true), 'visible');
  assert.equal(capturePathFor(true, false), 'visible');
  assert.equal(capturePathFor(false, true), 'cdp');
  assert.equal(capturePathFor(false, false), 'needs-activation');
});

// 真机记录:模型点搜索结果链接开了新 tab,事后既读不了也关不掉(只能请用户 Ctrl+W)。
// 约定:点击造成的新开页按 agent-opened 登记 → 立即可读(read_page 白名单三源之一)
// 且可由 close_page 清理(仍走确认卡,安全边界不变)。
test('click 开出的新 tab 被登记为 agent-opened(可读可关)', async () => {
  const { describeTabChanges, getAgentOpenedTabs } = await import('../lib/pageContext');
  const stub = (globalThis as unknown as { browser: { tabs: { query: unknown } } }).browser;
  const original = stub.tabs.query;
  stub.tabs.query = async () => [
    { id: 1, url: 'https://a.example/', active: false },
    { id: 2, url: 'https://b.example/news', active: true },
  ];
  try {
    const before = { ids: new Set([1]), activeId: 1 };
    const report = await describeTabChanges(before);
    assert.deepEqual(report.openedTabIds, [2], '新开的 tab 2 应被报告');
    assert.ok(report.note?.includes('#2'), '说明里带上新 tab');
    assert.ok(!report.note?.includes('call open_page with its URL'), '不再要求额外认领一次');
    assert.ok(getAgentOpenedTabs().has(2), 'tab 2 应已登记为 agent-opened(从而可读可关)');
  } finally {
    stub.tabs.query = original;
  }
});
