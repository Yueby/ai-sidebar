/**
 * CDP 特权层(chrome.debugger):极简白名单,仅暴露可信输入原语。
 *
 * 动机:合成事件(WheelEvent/MouseEvent/KeyboardEvent)无 isTrusted,浏览器默认
 * 行为(滚动/导航)不响应,校验 isTrusted 的页面监听器也会拒绝。CDP Input.*
 * 产生与真实鼠标/键盘等价的可信输入(Playwright 底层同机制)。
 *
 * 边界:白名单仅 Input 域输入方法(dispatchMouseEvent/synthesizeScrollGesture/
 * insertText/dispatchKeyEvent);按需 attach,60s 闲置自动 detach,不留常驻附加;
 * 附加失败(chrome:// 页、已有调试器、DevTools 占用)返回 not_dispatched,由上层
 * 降级合成/JS 路径。
 *
 * 三态契约:原语区分「未派发任何输入」与「已派发但后续失败」。仅前者允许调用方
 * 降级到合成路径(重发安全);后者必须停止追加动作并如实报告执行状态未确认。
 */
import { browser } from 'wxt/browser';

/** 输入派发状态:not_dispatched = 确认未派发任何输入(可安全换路径重试);
 *  dispatched = 全部派发成功;partial_or_unknown = 已派发部分输入,后续失败,禁止重发。 */
export type InputDispatchState = 'not_dispatched' | 'dispatched' | 'partial_or_unknown';

let attachedTabId: number | null = null;
let detachTimer: ReturnType<typeof setTimeout> | null = null;
let listenersInstalled = false;

function clearAttachState(): void {
  attachedTabId = null;
  if (detachTimer) {
    clearTimeout(detachTimer);
    detachTimer = null;
  }
}

function installLifecycleListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;
  // 仅当前附加目标被接管/断开时同步状态;其他 tab 的 detach 事件与本连接无关
  browser.debugger.onDetach.addListener((source) => {
    if (attachedTabId !== null && source.tabId === attachedTabId) clearAttachState();
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    if (attachedTabId === tabId) clearAttachState();
  });
}

async function ensureAttached(tabId: number): Promise<boolean> {
  installLifecycleListeners();
  if (attachedTabId === tabId) return true;
  try {
    if (attachedTabId !== null) {
      await browser.debugger.detach({ tabId: attachedTabId }).catch(() => {});
      attachedTabId = null;
    }
    await browser.debugger.attach({ tabId }, '1.3');
    attachedTabId = tabId;
    return true;
  } catch {
    return false;
  }
}

function scheduleDetach(idleMs: number): void {
  if (detachTimer) clearTimeout(detachTimer);
  detachTimer = setTimeout(() => {
    detachTimer = null;
    const tabId = attachedTabId;
    attachedTabId = null;
    if (tabId !== null) void browser.debugger.detach({ tabId }).catch(() => {});
  }, idleMs);
}

/**
 * 发送单条白名单 CDP 命令。
 * 失败仅表示本条命令未确认成功——连接可能仍然存活(超时/参数错等),因此不清除
 * 附加状态;空闲 60s 后统一 detach。返回 false 时调用方按「本条未确认」处理。
 */
async function sendCommand(
  tabId: number,
  method: 'Input.dispatchMouseEvent' | 'Input.synthesizeScrollGesture' | 'Input.insertText' | 'Input.dispatchKeyEvent',
  params: Record<string, unknown>,
): Promise<boolean> {
  const attached = await ensureAttached(tabId);
  if (!attached) return false;
  try {
    await browser.debugger.sendCommand({ tabId }, method, params);
    scheduleDetach(60_000);
    return true;
  } catch {
    return false;
  }
}

/**
 * 可信滚动手势:CDP Input.synthesizeScrollGesture 生成连续的平滑滚动流
 * (浏览器按 speed 插值出滚动帧,页面收到与真实触控板一致的输入)。
 * ⚠ CDP 方向语义与 wheel 相反:yDistance 正 = 向上滚,负 = 向下(调用方取反);
 * gestureSourceType 显式 'mouse'(桌面滚轮语义)。
 */
export async function synthesizeTrustedScrollGesture(
  tabId: number,
  x: number,
  y: number,
  xDistance: number,
  yDistance: number,
  speed = 800,
): Promise<InputDispatchState> {
  const ok = await sendCommand(tabId, 'Input.synthesizeScrollGesture', {
    x: Math.round(x),
    y: Math.round(y),
    xDistance: Math.round(xDistance),
    yDistance: Math.round(yDistance),
    speed,
    gestureSourceType: 'mouse',
  });
  return ok ? 'dispatched' : 'not_dispatched';
}

/**
 * 可信点击:CDP Input.dispatchMouseEvent(mouseMoved + mousePressed + mouseReleased),
 * 坐标 = viewport CSS 像素。与真实鼠标等价(含页面校验 isTrusted 的监听器)。
 * mouseMoved 失败 = 未开始(可重试);按下/抬起任一失败 = 已派发部分输入,禁止重发。
 */
export async function dispatchTrustedMouseClick(tabId: number, x: number, y: number): Promise<InputDispatchState> {
  const cx = Math.round(x);
  const cy = Math.round(y);
  const moved = await sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy });
  if (!moved) return 'not_dispatched';
  const pressed = await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: cx,
    y: cy,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  if (!pressed) return 'partial_or_unknown';
  const released = await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: cx,
    y: cy,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  return released ? 'dispatched' : 'partial_or_unknown';
}

/** 可信文本插入:CDP Input.insertText(需先聚焦,由调用方以可信点击完成)。生成可信 beforeinput/input。 */
export async function insertTrustedText(tabId: number, text: string): Promise<InputDispatchState> {
  const ok = await sendCommand(tabId, 'Input.insertText', { text });
  return ok ? 'dispatched' : 'partial_or_unknown';
}

/** 可信按键:CDP Input.dispatchKeyEvent(rawKeyDown + keyUp)。keyDown 失败 = 未派发;keyUp 失败 = 部分派发。 */
export async function dispatchTrustedKey(
  tabId: number,
  key: string,
  code: string,
  virtualKeyCode: number,
  modifiers: 0 | 1 | 2 | 4 | 8 = 0,
): Promise<InputDispatchState> {
  const base = { key, code, modifiers, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode };
  const down = await sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  if (!down) return 'not_dispatched';
  return (await sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base }))
    ? 'dispatched'
    : 'partial_or_unknown';
}
