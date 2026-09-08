/**
 * Node 测试环境的 WXT `browser` 全局最小 stub。
 * 必须在被测模块之前 import(ESM 按声明顺序求值):模块级/延迟调用会读取这些 API。
 * 仅覆盖测试路径实际触及的表面;缺失时测试会报出具体 API,按需补。
 */
const noop = () => {};
const asyncUndefined = async () => undefined;

const eventStub = { addListener: noop, removeListener: noop, hasListener: () => false };

(globalThis as Record<string, unknown>).browser = {
  runtime: {
    id: 'test-extension',
    getURL: (path: string) => `chrome-extension://test-extension${path}`,
    sendMessage: asyncUndefined,
    onMessage: eventStub,
    onConnect: eventStub,
  },
  tabs: {
    get: asyncUndefined,
    query: async () => [],
    update: asyncUndefined,
    create: asyncUndefined,
    sendMessage: asyncUndefined,
    onUpdated: eventStub,
    onRemoved: eventStub,
    onCreated: eventStub,
    onActivated: eventStub,
  },
  storage: {
    local: { get: async () => ({}), set: asyncUndefined, remove: asyncUndefined },
    onChanged: eventStub,
  },
  scripting: { executeScript: async () => [] },
  windows: { getCurrent: asyncUndefined, update: asyncUndefined },
  debugger: {
    attach: asyncUndefined,
    detach: asyncUndefined,
    sendCommand: asyncUndefined,
    onDetach: eventStub,
  },
  sidePanel: { setPanelBehavior: asyncUndefined },
};
