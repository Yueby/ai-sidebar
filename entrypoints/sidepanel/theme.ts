// 跟随系统深浅色(在 React 渲染前执行,避免闪烁)
const media = matchMedia('(prefers-color-scheme: dark)');

function apply() {
  document.documentElement.classList.toggle('dark', media.matches);
  document.documentElement.style.colorScheme = media.matches ? 'dark' : 'light';
}

apply();
media.addEventListener('change', apply);
