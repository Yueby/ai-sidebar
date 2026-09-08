/**
 * CDP 特权层(chrome.debugger):极简白名单,仅暴露可信输入原语。
 *
 * 动机:合成事件(WheelEvent/MouseEvent/KeyboardEvent)无 isTrusted,浏览器默认
 * 行为(滚动/导航)不响应,校验 isTrusted 的页面监听器也会拒绝。CDP Input.*
 * 产生与真实鼠标/键盘等价的可信输入(Playwright 底层同机制)。
 *
 * 边界:白名单仅 Input 域输入方法(dispatchMouseEvent/synthesizeScrollGesture/
 * insertText/dispatchKeyEvent);按需 attach,60s 闲置自动 detach,不留常驻附加;
 * 附加失败(chrome:// 页、已有调试器、DevTools 占用)静默返回 false,由上层降级
 * 合成/JS 路径。
 */
import { browser } from 'wxt/browser';

let attachedTabId: number | null = null;
let detachTimer: ReturnType<typeof setTimeout> | null = null;
let listenersInstalled = false;

function installLifecycleListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;
  // 目标被其他调试器接管/DevTools 断开/tab 关闭时,协议侧自动 detach,同步本地状态
  browser.debugger.onDetach.addListener(() => {
    attachedTabId = null;
    if (detachTimer) {
      clearTimeout(detachTimer);
      detachTimer = null;
    }
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    if (attachedTabId === tabId) {
      attachedTabId = null;
      if (detachTimer) {
        clearTimeout(detachTimer);
        detachTimer = null;
      }
    }
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

/** 发送单条白名单 CDP 命令;未附加/发送失败统一返回 null(调用方降级) */
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
    attachedTabId = null;
    return false;
  }
}

/**
 * 可信滚动手势:CDP Input.synthesizeScrollGesture 生成连续的平滑滚动流
 * (浏览器按 speed 插值出 tick 序列,页面收到与真实触控板/触摸一致的输入)。
 * yDistance 正 = 向下,负 = 向上;默认 speed 800 px/s。
 */
export async function synthesizeTrustedScrollGesture(
  tabId: number,
  x: number,
  y: number,
  xDistance: number,
  yDistance: number,
  speed = 800,
): Promise<boolean> {
  return sendCommand(tabId, 'Input.synthesizeScrollGesture', {
    x: Math.round(x),
    y: Math.round(y),
    xDistance: Math.round(xDistance),
    yDistance: Math.round(yDistance),
    speed,
  });
}

/**
 * 可信点击:CDP Input.dispatchMouseEvent(mouseMoved + mousePressed + mouseReleased),
 * 坐标 = viewport CSS 像素。与真实鼠标等价(含页面校验 isTrusted 的监听器)。
 */
export async function dispatchTrustedMouseClick(tabId: number, x: number, y: number): Promise<boolean> {
  const cx = Math.round(x);
  const cy = Math.round(y);
  const moved = await sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy });
  if (!moved) return false;
  const pressed = await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: cx,
    y: cy,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  if (!pressed) return false;
  return sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: cx,
    y: cy,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
}

/** 可信文本插入:CDP Input.insertText(需先聚焦,由调用方以可信点击完成)。生成可信 beforeinput/input。 */
export async function insertTrustedText(tabId: number, text: string): Promise<boolean> {
  return sendCommand(tabId, 'Input.insertText', { text });
}

/** 可信按键(如 Enter 提交 / Ctrl+A 全选):CDP Input.dispatchKeyEvent(rawKeyDown + keyUp)。 */
export async function dispatchTrustedKey(
  tabId: number,
  key: string,
  code: string,
  virtualKeyCode: number,
  modifiers: 0 | 1 | 2 | 4 | 8 = 0,
): Promise<boolean> {
  const base = { key, code, modifiers, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode };
  const down = await sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  if (!down) return false;
  return sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}
