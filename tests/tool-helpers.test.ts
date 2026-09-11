/**
 * 续读窗口 / 截图路径 / 抽取厚薄判定的纯逻辑回归。
 * 这三处都是"工具在真机上表现不好"的直接产物(见 HANDOFF 回归记录):
 * ①长文被 12000 截断后无法取回后半段;②后台标签截图被浏览器 API 限制;
 * ③SPA 首次抽取过薄时模型只能自己摸索"再等等"。
 */
import './helpers/browser-stub';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  textWindow,
  continuationHint,
  nextOffsetFor,
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

// 初版 H3 的失效点:续读提示依赖“截断前全文长度”,报错长度 → 提示永不出现(真机上模型不会续读)。
test('nextOffsetFor:只有知道全文长度时才给下一次 offset', () => {
  assert.equal(nextOffsetFor(0, 12000, 30000), 12000, '有后半段 → 给出下一个 offset');
  assert.equal(nextOffsetFor(12000, 12000, 30000), 24000, '续读到底前一直前进');
  assert.equal(nextOffsetFor(24000, 6000, 30000), null, '读到末尾 → 不再引导续读');
  assert.equal(nextOffsetFor(0, 500, 400), null, '长度自洽异常时不虚报');
  assert.equal(nextOffsetFor(0, 12000, undefined), null, '拿不到全文长度 → 不给调用指引');
  assert.equal(nextOffsetFor(0, 12000, 0), null, '空页同理');
});

// close_page 曾谎报成功:closeTab 返回 false(浏览器拒绝关闭)时仍回 “Closed tab #N.”,
// 并把该 tab 从 agent-opened 注册表删掉 → 模型以为关掉了,实际还开着。
test('close_page:浏览器拒绝关闭时不得谎报成功', async () => {
  const { createClosePageToolDefinition } = await import('../lib/tools/close-page');
  const { markAgentCreatedTab, registerAgentOpenedTab, getAgentOpenedTabs } = await import(
    '../lib/pageContext'
  );
  const { setGateHandler } = await import('../lib/gate');
  const stub = (globalThis as unknown as { browser: { tabs: Record<string, unknown> } }).browser;

  const originalRemove = stub.tabs.remove;
  const originalGet = stub.tabs.get;
  registerAgentOpenedTab(4242);
  markAgentCreatedTab(4242);
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

// 真机踩到的回归(用户实测 2026-09-11):对 19500 字长页请求 section:'tail',
// 返回的却是**头部**内容且在 12000 处静默截断(truncated 被覆盖成 false)→ 文末标记丢失且无续读提示,
// 模型只好改走 execute_js 兜底。根因:先按头部截断、再对截断结果做尾切片。
test('尾窗必须落在文末且标记可见(先截断再切片会丢文末)', () => {
  const LIMIT = 12000;
  const full = 'A'.repeat(13000) + '\n文末标记：ZEBRA-7391';
  assert.ok(full.length > LIMIT, '前提:全文超过上限');

  // 正确做法:在**全文**上取尾窗
  const tail = textWindow(full, Math.max(0, full.length - LIMIT), LIMIT);
  assert.ok(tail.text.includes('ZEBRA-7391'), '尾窗必须包含文末标记');
  assert.equal(tail.truncated, true, '被省略了开头 → 必须标记为截断(旧 bug 在此报 false)');
  assert.ok(tail.start > 0, '尾窗起点不为 0');
  assert.equal(tail.nextOffset, null, '尾窗已到文末,无“向后读”指引');

  // 错误做法(旧实现)会让标记丢失:截断到 12000 后再尾切同一长度 → 仍是那 12000
  const headTruncated = full.slice(0, LIMIT);
  const stale = textWindow(headTruncated, 0, LIMIT);
  assert.ok(!stale.text.includes('ZEBRA-7391'), '这正是旧实现丢标记的原因');
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

// 真机实测的安全边界破口:用户自己开的标签页被 open_page **复用认领**后,
// close_page 对它弹了确认卡(说明注册表检查通过)——"用户自己的页面不可关闭"被绕过。
// 约定:认领(opened)只给读权限;关闭权只属于 agent **创建/造成出现**的 tab。
test('close_page:被认领的用户标签页必须拒绝关闭(认领 ≠ 可关)', async () => {
  const { createClosePageToolDefinition } = await import('../lib/tools/close-page');
  const { registerAgentOpenedTab, isAgentCreatedTab } = await import('../lib/pageContext');
  const { setGateHandler } = await import('../lib/gate');

  const userTabId = 555001;
  registerAgentOpenedTab(userTabId); // 仅认领为可读(open_page 复用路径的行为)
  assert.ok(!isAgentCreatedTab(userTabId), '认领不得授予关闭权');

  let gateCalls = 0;
  setGateHandler(async () => {
    gateCalls += 1;
    return { kind: 'confirm', approved: true } as never;
  });
  try {
    const tool = createClosePageToolDefinition('s');
    const res = await tool.execute('call-x', { tabId: userTabId });
    const text = String((res.content[0] as { text: string }).text);
    assert.ok(/Refusing to close/.test(text), `必须直接拒绝,实际: ${text}`);
    assert.equal(gateCalls, 0, '拒绝必须发生在弹卡之前(不给用户误关的机会)');
  } finally {
    setGateHandler(null);
  }
});

// 真机实测(2026-09-11):前端渲染页首次读取只剩“加载中”空壳,旧实现把它当正文返回且不给任何信号,
// 模型先试 waitStableMs=15000 也没用(空壳长度天生"稳定"→等待循环立刻跳出),最后靠 waitText 才拿到内容。
test('过薄结果必须带可行动的提示(且阈值单一来源)', () => {
  assert.equal(isThinExtraction(''), true);
  assert.equal(isThinExtraction('加载中……正文由外链脚本在 1.2 秒后注入。'), true);
  assert.equal(isThinText('x'.repeat(THIN_TEXT_CHARS)), false, '阈值边界:达到阈值即不算薄');
  assert.equal(isThinExtraction('x'.repeat(THIN_TEXT_CHARS)), false);

  const note = thinResultNote(48);
  assert.ok(/loading shell/.test(note), '明确说明这不是正文');
  assert.ok(/waitStableMs/.test(note) && /waitText/.test(note), '给出两个可用旋钮');
  assert.ok(/15000/.test(note), '给出上限值,便于模型直接用');
});
