/**
 * 续读窗口 / 截图路径 / 抽取厚薄判定的纯逻辑回归。
 * 各自的契约:①长文被 12000 截断后必须能取回后半段;
 * ②后台标签截图不受浏览器 API 限制(走 CDP);③SPA 首次抽取过薄时必须给出可行动提示。
 */
import './helpers/browser-stub';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  textWindow,
  continuationHint,
  isThinText,
  thinResultNote,
  THIN_TEXT_CHARS,
} from '../lib/pageTextWindow';
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

// 续读提示依赖“截断前全文长度”:传入截断后的长度会得出“没有后半段”的错误结论 → 指引永不出现。
// offset 只在 continuationHint 里算一次(与 textWindow 同规则),此测试钉住模型可见的那份文本。
test('continuationHint:只在确有剩余时给出下一次 offset', () => {
  const withMore = continuationHint(7, {
    text: 'x'.repeat(12000),
    start: 0,
    truncated: true,
    totalLength: 30000,
  });
  assert.match(withMore, /"offset":12000/, '有后半段 → 给出可直接照用的下一次调用');
  assert.doesNotMatch(withMore, /Characters before/, '从头读不提示“前面被省略”');

  const atEnd = continuationHint(7, {
    text: 'x'.repeat(6000),
    start: 24000,
    truncated: true,
    totalLength: 30000,
  });
  assert.doesNotMatch(atEnd, /call read_page with the same tabId and offset/, '读到末尾不再引导续读');
  assert.match(atEnd, /Characters before 24000 were omitted/, '尾窗要说明前面还有内容');

  const midWindow = continuationHint(7, {
    text: 'x'.repeat(1000),
    start: 5000,
    truncated: true,
    totalLength: 30000,
  });
  assert.match(midWindow, /"offset":6000/, '从窗口真实起点继续前进');

  const unknownTotal = continuationHint(7, {
    text: 'x'.repeat(12000),
    start: 0,
    truncated: true,
    totalLength: 0,
  });
  assert.doesNotMatch(unknownTotal, /call read_page with the same tabId and offset/, '空页 → 不虚报后续内容');

  const inconsistent = continuationHint(7, {
    text: 'x'.repeat(500),
    start: 0,
    truncated: true,
    totalLength: 400,
  });
  assert.doesNotMatch(
    inconsistent,
    /call read_page with the same tabId and offset/,
    '长度不自洽(窗口比全文还长)→ 不虚报',
  );

  const missingTotal = continuationHint(7, {
    text: 'x'.repeat(12000),
    start: 0,
    truncated: true,
    totalLength: undefined as unknown as number,
  });
  assert.doesNotMatch(
    missingTotal,
    /call read_page with the same tabId and offset/,
    '拿不到全文长度 → 不虚报',
  );
});

// close_page 曾谎报成功:closeTab 返回 false(浏览器拒绝关闭)时仍回 “Closed tab #N.”,
// 并把该 tab 从 agent-opened 注册表删掉 → 模型以为关掉了,实际还开着。
test('close_page:浏览器拒绝关闭时不得谎报成功', async () => {
  const { createClosePageToolDefinition } = await import('../lib/tools/close-page');
  const { registerAgentOpenedTab, getAgentOpenedTabs } = await import('../lib/pageContext');
  const { setGateHandler } = await import('../lib/gate');
  const stub = (globalThis as unknown as { browser: { tabs: Record<string, unknown> } }).browser;

  const originalRemove = stub.tabs.remove;
  const originalGet = stub.tabs.get;
  registerAgentOpenedTab(4242);
  // 用户批准关闭
  setGateHandler(async () => ({ kind: 'confirm', approved: true }) as never);
  try {
    // 场景一:关闭失败且 tab 仍在 → 必须报失败,且不得注销注册表
    stub.tabs.remove = async () => {
      throw new Error('browser refused');
    };
    stub.tabs.get = async () => ({ id: 4242, url: 'https://x.example/' });
    const tool = createClosePageToolDefinition('s');
    const res = await tool.execute('call-1', { tabId: 4242 });
    const text = String((res.content[0] as { text: string }).text);
    assert.ok(!/^Closed tab/.test(text), `不得报成功,实际: ${text}`);
    assert.ok(/still open/.test(text), '必须明确说明还开着');
    assert.ok(getAgentOpenedTabs().has(4242), '关闭失败时不得注销(否则后续误判)');

    // 场景二:tab 已经不存在(目标已达成)→ 报成功并注销
    stub.tabs.remove = async () => {
      throw new Error('no such tab');
    };
    stub.tabs.get = async () => {
      throw new Error('no such tab');
    };
    const res2 = await tool.execute('call-2', { tabId: 4242 });
    const text2 = String((res2.content[0] as { text: string }).text);
    assert.ok(/^Closed tab/.test(text2), `已不存在应视为成功,实际: ${text2}`);
    assert.ok(!getAgentOpenedTabs().has(4242), '成功关闭后应注销');
  } finally {
    stub.tabs.remove = originalRemove;
    stub.tabs.get = originalGet;
    setGateHandler(null);
  }
});

// H5 能成立依赖一个隐式契约:getAgentOpenedTabs() 返回**活引用**(不是拷贝),
// 因此 click 登记的新 tab 在同一轮就能被 read_page 的白名单工具看到。
// 若将来有人改成返回副本,读取会在当轮失效而不会报错——这里把它钉住。
test('getAgentOpenedTabs 返回活引用(登记后当轮即可见)', async () => {
  const { getAgentOpenedTabs, registerAgentOpenedTab, unregisterAgentOpenedTab } = await import(
    '../lib/pageContext'
  );
  const view = getAgentOpenedTabs();
  registerAgentOpenedTab(777001);
  assert.ok(view.has(777001), '登记必须对已持有的集合视图可见(工具在轮内捕获的正是它)');
  unregisterAgentOpenedTab(777001);
  assert.ok(!view.has(777001), '注销同样即时可见');
});

// 对长页请求 section:'tail' 时,若先按头部截断再做尾切片,返回的是**头部**内容且在 12000 处静默截断
// (truncated 被误报为 false)→ 文末标记丢失且无续读提示。尾窗必须在全文上取。
test('尾窗必须落在文末且标记可见(先截断再切片会丢文末)', () => {
  const LIMIT = 12000;
  const full = 'A'.repeat(13000) + '\n文末标记：ZEBRA-7391';
  assert.ok(full.length > LIMIT, '前提:全文超过上限');

  // 正确做法:在**全文**上取尾窗
  const tail = textWindow(full, Math.max(0, full.length - LIMIT), LIMIT);
  assert.ok(tail.text.includes('ZEBRA-7391'), '尾窗必须包含文末标记');
  assert.equal(tail.truncated, true, '被省略了开头 → 必须标记为截断');
  assert.ok(tail.start > 0, '尾窗起点不为 0');
  assert.equal(tail.nextOffset, null, '尾窗已到文末,无“向后读”指引');

  // 反例:截断到 12000 后再尾切同一长度 → 仍是那 12000,标记必丢(说明本断言能抓到该缺陷)
  const headTruncated = full.slice(0, LIMIT);
  const stale = textWindow(headTruncated, 0, LIMIT);
  assert.ok(!stale.text.includes('ZEBRA-7391'), '先截断再尾切必然丢标记');
});

test('续读提示:尾窗要说明“前面被省略”以及怎么往回读', () => {
  const LIMIT = 200;
  const full = 'x'.repeat(500) + '\n文末标记：ZEBRA-7391';
  const tail = textWindow(full, Math.max(0, full.length - LIMIT), LIMIT);
  const hint = continuationHint(7, { ...tail, omittedBefore: tail.start > 0 });
  assert.ok(/showing characters \d+-\d+ of \d+/.test(hint), '必须如实告知展示的是哪一段');
  assert.ok(/Characters before \d+ were omitted/.test(hint), '必须说明前面还有内容');
  assert.ok(/pass a smaller offset/.test(hint), '必须告诉怎么往回读');
});

// 用户拍板(2026-09-11):「AI 可以自由调用所有工具」——close_page 不再按 tab 来源硬拒绝,
// 护栏是**确认卡本身**(用户逐次审批)。此处钉住:任意 tab 都会走卡、卡上写明在关哪个页、
// 未批准则绝不关闭。
test('close_page:任意标签页都可被请求关闭,但必须经确认卡(批准前不得关)', async () => {
  const { createClosePageToolDefinition } = await import('../lib/tools/close-page');
  const { setGateHandler } = await import('../lib/gate');
  const stub = (globalThis as unknown as { browser: { tabs: Record<string, unknown> } }).browser;
  const originalRemove = stub.tabs.remove;
  const originalGet = stub.tabs.get;

  let removed = 0;
  stub.tabs.remove = async () => {
    removed += 1;
  };
  stub.tabs.get = async () => ({ id: 555002, title: '用户自己打开的页面', url: 'https://user.example/x' });

  const tool = createClosePageToolDefinition('s');
  try {
    // 1) 未批准 → 不得关闭
    let cardDetail = '';
    setGateHandler(async (req) => {
      cardDetail = String((req as { detail?: string }).detail ?? '');
      return { kind: 'confirm', approved: false } as never;
    });
    const denied = await tool.execute('call-1', { tabId: 555002 });
    assert.ok(/denied/i.test(String((denied.content[0] as { text: string }).text)), '未批准需如实回报');
    assert.equal(removed, 0, '未批准时绝不能关');

    // 2) 批准 → 关闭;卡上必须写明标题/URL(知情同意)
    setGateHandler(async (req) => {
      cardDetail = String((req as { detail?: string }).detail ?? '');
      return { kind: 'confirm', approved: true } as never;
    });
    const ok = await tool.execute('call-2', { tabId: 555002 });
    assert.equal(removed, 1, '批准后应真的关闭');
    assert.ok(/Closed tab #555002/.test(String((ok.content[0] as { text: string }).text)));
    assert.ok(cardDetail.includes('用户自己打开的页面') && cardDetail.includes('user.example'), `卡上需写明标题与 URL,实际: ${cardDetail}`);
  } finally {
    stub.tabs.remove = originalRemove;
    stub.tabs.get = originalGet;
    setGateHandler(null);
  }
});

// search_element 行是模型唯一的"清单真相":序号决定 click_element 的 ordinal,
// 值/去向决定要不要点。这里把格式钉住,避免无意改坏寻址契约。
test('search_element 行渲染:序号/状态/值/链接去向', async () => {
  const { renderElementLine } = await import('../lib/tools/search-element');
  const line = (over: Record<string, unknown>) =>
    renderElementLine({ role: 'button', name: '提交', ordinal: 1, disabled: false, visible: true, ...over } as never);

  assert.equal(line({}), '- button "提交"');
  assert.equal(line({ ordinal: 2 }), '- button "提交" [2]', '同名第 2 个带序号(click_element 的 ordinal)');
  assert.equal(line({ disabled: true }), '- button "提交" [disabled]');
  assert.equal(line({ checked: true, role: 'checkbox' }), '- checkbox "提交" [checked]');
  assert.equal(line({ checked: false, role: 'checkbox' }), '- checkbox "提交" [unchecked]');
  assert.equal(line({ value: 'abc', role: 'textbox' }), '- textbox "提交" = "abc"');
  assert.equal(line({ href: '/cart', role: 'link' }), '- link "提交" → /cart');
  assert.equal(line({ visible: false }), '- button "提交" [hidden]');
});

// 动作目标二选一(locator 或 selector):selector 是无 role/名称元素的唯一寻址路。
// 解析必须是纯函数且把三种非法形状都拦下 —— 否则会带着半个目标进 content 侧,错误被推迟到动作阶段。
test('parseActionTarget:两种目标互斥,缺参与非法形状都给出可行动错误', async () => {
  const { parseActionTarget, formatActionTarget, actionAddressing } = await import(
    '../lib/tools/page-action-shared'
  );

  assert.deepEqual(parseActionTarget(undefined), {
    kind: 'error',
    message:
      'Provide a target: either a locator object (role + name, from search_element) or a selector string (CSS selector, for elements without an ARIA role or accessible name).',
  });

  const both = parseActionTarget({
    locator: { role: 'button', name: 'ok' },
    selector: '.card',
  });
  assert.equal(both.kind, 'error');
  assert.match((both as { message: string }).message, /not both/);

  for (const bad of [
    { selector: '   ' },
    { locator: {} },
    { locator: { role: '', name: 'x' } },
    { locator: { role: 'button' } },
    { locator: 'button' },
  ]) {
    const parsed = parseActionTarget(bad);
    assert.equal(parsed.kind, 'error', `应被拦下: ${JSON.stringify(bad)}`);
  }

  const byLocator = parseActionTarget({ locator: { role: 'button', name: '提交', ordinal: 2.7 } });
  assert.deepEqual(byLocator, {
    kind: 'locator',
    locator: { role: 'button', name: '提交', ordinal: 2 },
  });

  const bySelector = parseActionTarget({ selector: '  .role-item-box img  ' });
  assert.deepEqual(bySelector, { kind: 'selector', selector: '.role-item-box img' });

  // 展示串与寻址参数必须与目标类型一一对应(确认卡与结果文本共用展示串)
  assert.equal(formatActionTarget(byLocator as never), 'button "提交" #2');
  assert.equal(formatActionTarget(bySelector as never), '".role-item-box img"');
  assert.deepEqual(actionAddressing(byLocator as never), {
    locator: { role: 'button', name: '提交', ordinal: 2 },
  });
  assert.deepEqual(actionAddressing(bySelector as never), { selector: '.role-item-box img' });
});

test('renderActionFailure:selector 目标的 not_found 说明选择器而非 locator', async () => {
  const { renderActionFailure } = await import('../lib/tools/page-action-shared');
  const failure = { ok: false as const, url: 'https://x.example/', reason: 'not_found' as const };

  assert.match(renderActionFailure(7, failure), /no element matches the locator in tab #7/);
  assert.match(
    renderActionFailure(7, failure, { kind: 'selector', selector: '.card img' }),
    /no element matches the selector "\.card img" in tab #7/,
  );
  // ambiguous 附带候选列表保持不变
  const ambiguous = renderActionFailure(7, {
    ok: false,
    url: 'u',
    reason: 'ambiguous',
    matches: [{ ordinal: 2, tagName: 'button', preview: '删除' }],
  });
  assert.match(ambiguous, /ambiguous_locator \(1 matches\)/);
  assert.match(ambiguous, /- \[2\] <button> 删除/);
});
