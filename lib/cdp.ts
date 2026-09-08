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
 * 三态契约:not_dispatched = 确认未调用任何输入命令(可安全换路径重试);
 *  dispatched = 全部命令返回成功;partial_or_unknown = 已调用过输入命令但结果
 *  未确认(含 attach 后命令 reject、序列中途断开),禁止换路径重发。
 *  只有 attach 前置阶段失败才是 not_dispatched——命令一旦发出,失败一律按未确认。
 *
 * 序列一致性:每个多命令序列捕获 detach 代次;用户在序列执行中主动解除调试后,
 * 后续命令直接失败而不自动重新附加。
 */
import { browser } from 'wxt/browser';

/** 输入派发状态(见文件头三态契约) */
export type InputDispatchState = 'not_dispatched' | 'dispatched' | 'partial_or_unknown';

/** 单命令发送结果:not_attached = 附加前置失败(未发命令);sent = 成功;failed = 已尝试发送但未确认 */
type SendResult = 'not_attached' | 'sent' | 'failed';

let attachedTabId: number | null = null;
let detachTimer: ReturnType<typeof setTimeout> | null = null;
let listenersInstalled = false;
/** detach 代次:每次连接断开(用户解除调试/DevTools/tab 关闭)+1;序列中途断开则后续命令失败 */
let detachEpoch = 0;

function clearAttachState(): void {
  attachedTabId = null;
  detachEpoch++;
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
    if (tabId !== null) {
      attachedTabId = null;
      detachEpoch++;
      void browser.debugger.detach({ tabId }).catch(() => {});
    }
  }, idleMs);
}

/**
 * 发送单条白名单 CDP 命令(不自动重附加:epoch 不匹配直接失败)。
 * 失败仅表示本条未确认成功——连接可能仍存活,因此不清附加状态,由 60s 闲置统一 detach。
 */
async function sendCommand(
  tabId: number,
  method: 'Input.dispatchMouseEvent' | 'Input.synthesizeScrollGesture' | 'Input.insertText' | 'Input.dispatchKeyEvent',
  params: Record<string, unknown>,
  epoch?: number,
): Promise<SendResult> {
  if (epoch !== undefined && epoch !== detachEpoch) return 'failed';
  const attached = await ensureAttached(tabId);
  if (!attached) return 'not_attached';
  try {
    await browser.debugger.sendCommand({ tabId }, method, params);
    scheduleDetach(60_000);
    return 'sent';
  } catch {
    return 'failed';
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
  const epoch = detachEpoch;
  const result = await sendCommand(
    tabId,
    'Input.synthesizeScrollGesture',
    {
      x: Math.round(x),
      y: Math.round(y),
      xDistance: Math.round(xDistance),
      yDistance: Math.round(yDistance),
      speed,
      gestureSourceType: 'mouse',
    },
    epoch,
  );
  if (result === 'not_attached') return 'not_dispatched';
  return result === 'sent' ? 'dispatched' : 'partial_or_unknown';
}

/**
 * 可信点击:CDP Input.dispatchMouseEvent(mouseMoved + mousePressed + mouseReleased),
 * 坐标 = viewport CSS 像素。与真实鼠标等价(含页面校验 isTrusted 的监听器)。
 * 仅附加前置失败视为未派发;任何命令发出后的失败按未确认(mouseMoved 也可能触发 hover 副作用)。
 */
export async function dispatchTrustedMouseClick(tabId: number, x: number, y: number): Promise<InputDispatchState> {
  const epoch = detachEpoch;
  const cx = Math.round(x);
  const cy = Math.round(y);
  const moved = await sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy }, epoch);
  if (moved === 'not_attached') return 'not_dispatched';
  if (moved !== 'sent') return 'partial_or_unknown';
  const pressed = await sendCommand(
    tabId,
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 },
    epoch,
  );
  if (pressed !== 'sent') return 'partial_or_unknown';
  const released = await sendCommand(
    tabId,
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 0, clickCount: 1 },
    epoch,
  );
  return released === 'sent' ? 'dispatched' : 'partial_or_unknown';
}

/** 可信文本插入:CDP Input.insertText(需先聚焦,由调用方以可信点击完成)。生成可信 beforeinput/input。 */
export async function insertTrustedText(tabId: number, text: string): Promise<InputDispatchState> {
  const epoch = detachEpoch;
  const result = await sendCommand(tabId, 'Input.insertText', { text }, epoch);
  if (result === 'not_attached') return 'not_dispatched';
  return result === 'sent' ? 'dispatched' : 'partial_or_unknown';
}

/** 可信按键:CDP Input.dispatchKeyEvent(rawKeyDown + keyUp)。命令发出后的失败一律按未确认。 */
export async function dispatchTrustedKey(
  tabId: number,
  key: string,
  code: string,
  virtualKeyCode: number,
  modifiers: 0 | 1 | 2 | 4 | 8 = 0,
): Promise<InputDispatchState> {
  const epoch = detachEpoch;
  const base = { key, code, modifiers, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode };
  const down = await sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base }, epoch);
  if (down === 'not_attached') return 'not_dispatched';
  if (down !== 'sent') return 'partial_or_unknown';
  const up = await sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base }, epoch);
  return up === 'sent' ? 'dispatched' : 'partial_or_unknown';
}
