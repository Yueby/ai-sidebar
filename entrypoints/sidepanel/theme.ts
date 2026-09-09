import type { AppearanceMode } from '@/lib/types';

// 外观主题管理:跟随系统(默认) / 强制浅色 / 强制深色
let currentMode: AppearanceMode = 'system';

const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;

function apply() {
  if (typeof document === 'undefined') return;
  const isDark = currentMode === 'system'
    ? (media ? media.matches : false)
    : currentMode === 'dark';
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
}

// 初始立即执行一次(在 React 渲染前执行,避免闪烁)
apply();

if (media) {
  media.addEventListener('change', () => {
    if (currentMode === 'system') {
      apply();
    }
  });
}

/** 切换外观模式:设置加载完成/修改设置时调用 */
export function setAppearance(mode: AppearanceMode): void {
  currentMode = mode;
  apply();
}
