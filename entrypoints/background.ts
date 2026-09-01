export default defineBackground(() => {
  // 点击工具栏图标即打开侧边栏(Chromium 116+)
  void browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});
