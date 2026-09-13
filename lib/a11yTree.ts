/**
 * 可访问性树的序列化(纯函数,node 可测)。
 *
 * content 侧负责遍历 DOM 产出**扁平前序**节点(带 depth),本模块负责:
 * ①过滤噪音角色 ②给交互节点编序号(与 click_element 的 ordinal 同口径)
 * ③渲染成缩进文本(Playwright ARIA snapshot 兼容语法)④按行数/深度截断。
 *
 * 为什么用这套语法:它是浏览器 agent 的事实标准(Playwright MCP / Playwright test /
 * Chrome DevTools MCP 同族),LLM 训练数据里最常见,解析最稳。
 */

/** content 侧采集的节点(扁平前序,depth 为相对请求根的层数) */
export interface A11yNode {
  depth: number;
  role: string;
  name?: string;
  /** 短文本内容(段落/列表项/单元格等承载语义的叶子) */
  text?: string;
  /** 表单值或 aria-valuetext(截断) */
  value?: string;
  /** 状态旗标:checked/disabled/expanded/selected/pressed/required/readonly/level=… */
  states?: string[];
  /** 链接目标(原样相对路径,模型可直接 open_page) */
  href?: string;
  /** 是否可被 click_element/fill_element 寻址(决定是否编序号) */
  interactive?: boolean;
  /** (role,name) 组内的序号;由 assignOrdinals 填,仅第 2 个及以后渲染标记 */
  ordinal?: number;
  /** 说明性节点:跨源 iframe 等无法展开处的提示 */
  note?: string;
}

/** 噪音角色:纯包装,无名字且不承载语义时透传(其子节点上提一层,避免输出膨胀) */
const WRAPPER_ROLES = new Set(['generic', 'group', 'none', 'presentation', 'inline', 'text']);

export interface RenderOptions {
  /** 最大输出行数(超出截断并提示);默认 300 */
  maxLines?: number;
  /** 最大深度;默认 8 */
  maxDepth?: number;
}

/**
 * 渲染为缩进树。
 *
 * 交互节点按 (role,name) 分组编号,与 click_element 的 ordinal 完全同口径:
 * 只有第 2 个及以后带 `[n]` 标记(默认 1),因此模型可以把行里的名字直接抄进
 * click_element,不需要任何额外的 ref 体系。
 */
export function renderA11yTree(nodes: readonly A11yNode[], options: RenderOptions = {}): string {
  const maxLines = options.maxLines ?? 300;
  const maxDepth = options.maxDepth ?? 8;
  const lines: string[] = [];
  let truncatedDepth = 0;

  for (const node of nodes) {
    if (node.depth > maxDepth) {
      truncatedDepth += 1;
      continue;
    }
    const wrapper = WRAPPER_ROLES.has(node.role);
    const hasPayload = Boolean(node.name || node.text || node.value || node.href || node.note);
    // 纯包装且无任何载荷 → 不占行(子节点会以其 depth 正常渲染,视觉上等价于上提)
    if (wrapper && !hasPayload) continue;

    if (lines.length >= maxLines) {
      break;
    }
    lines.push(renderLine(node));
  }

  const body = lines.join('\n');
  const notes: string[] = [];
  if (lines.length >= maxLines) {
    notes.push(
      `…(tree truncated at ${maxLines} lines — pass root to scope a subtree, or raise maxLines)`,
    );
  }
  if (truncatedDepth > 0) {
    notes.push(`…(${truncatedDepth} deeper node(s) beyond maxDepth=${maxDepth} omitted)`);
  }
  return notes.length > 0 ? `${body}\n\n${notes.join('\n')}` : body;
}

function renderLine(node: A11yNode): string {
  const indent = '  '.repeat(node.depth);
  const parts = [`${indent}- ${node.role}`];
  if (node.name) parts.push(` ${quote(node.name)}`);
  if (node.states && node.states.length > 0) {
    parts.push(` ${node.states.map((s) => `[${s}]`).join('')}`);
  }
  // 序号:与 search_element 同约定——只有第 2 个及以后带标记
  if (node.interactive && (node.ordinal ?? 1) > 1) parts.push(` [${node.ordinal}]`);
  if (node.value) parts.push(`: ${quote(node.value)}`);
  else if (node.text) parts.push(`: ${quote(node.text)}`);
  if (node.href) parts.push(` /url: ${node.href}`);
  if (node.note) parts.push(` (${node.note})`);
  return parts.join('');
}

function quote(value: string): string {
  return JSON.stringify(value.length > 160 ? `${value.slice(0, 157)}…` : value);
}

/** 交互节点序号计数(与 search_element 同一口径:全量枚举后按 (role,name) 顺序编号) */
export function assignOrdinals(nodes: readonly A11yNode[]): A11yNode[] {
  const counters = new Map<string, number>();
  return nodes.map((node) => {
    if (!node.interactive) return node;
    const key = `${node.role}\u0000${node.name ?? ''}`;
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    return { ...node, ordinal: next };
  });
}
