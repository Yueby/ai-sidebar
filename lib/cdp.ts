/**
 * CDP 特权层(chrome.debugger):极简白名单,仅暴露可信输入原语。
 *
 * 动机:合成 WheelEvent 无 isTrusted,浏览器默认滚动不响应;滚动劫持页
 * (翻页/切 view)监听 wheel 且可能校验 isTrusted。CDP Input.dispatchMouseEvent
 * 产生可信输入,同时驱动浏览器默认滚动与页面劫持逻辑(Playwright 底层同机制)。
 *
 * 边界:仅 Input.dispatchMouseEvent(mouseWheel)一个方法,按需 attach,
 * 闲置自动 detach(60s),不留常驻附加;附加失败(chrome:// 页、已有调试器、
 * DevTools 占用)静默返回 false,由上层走既有 JS 路径。
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

/**
 * 可信滚轮:CDP Input.dispatchMouseEvent(mouseWheel)。
 * 坐标 = viewport CSS 坐标;成功返回 true(事件已投递,不等动画/默认滚动完成)。
 */
export async function dispatchTrustedMouseWheel(
  tabId: number,
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
): Promise<boolean> {
  const attached = await ensureAttached(tabId);
  if (!attached) return false;
  try {
    await browser.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: Math.round(x),
      y: Math.round(y),
      deltaX: Math.round(deltaX),
      deltaY: Math.round(deltaY),
    });
    scheduleDetach(60_000);
    return true;
  } catch {
    attachedTabId = null;
    return false;
  }
}
