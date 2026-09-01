export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  main() {
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== 'ai-sidebar/extract-page') return;

      // TODO(下一步): 换成可读性优先的结构化提取(article/main 优先,剔除导航/页脚/脚本)
      sendResponse({
        title: document.title,
        url: location.href,
        text: (document.body?.innerText ?? '').slice(0, 12000),
      });
    });
  },
});
