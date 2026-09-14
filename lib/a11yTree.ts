/**
 * 可访问性树的序列化(纯函数,node 可测)。
 *
 * content 侧负责遍历 DOM 产出**扁平前序**节点(带 depth),本模块负责:
 * ①过滤噪音角色 ②给交互节点编序号(与 click_element 的 ordinal 同口径)
 * ③渲染成缩进文本(Playwright ARIA snapshot 兼容语法)④按行数/深度截断。
 *
 * **交互节点的 ordinal 不由本模块计算**:它必须与 click_element/fill_element 的动作侧枚举完全同口径,
 * 而本模块只看到(可能被 root 裁剪、预算截断、帧穿透改变的)子集 —— 在此重编号会让模型照抄到错元素。
 * 序号由 content 侧采集时从动作枚举回填(见 entrypoints/content.ts collectA11yTree)。
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
  /** 无名元素的定位线索(img 文件名 / 容器文本等):清单与树都得显示,否则多个无名同类节点无法区分 */
  hint?: string;
  /** 元素的 id:无名元素唯一的稳定 CSS 句柄(read_element 可照抄) */
  id?: string;
  /** 是否可被 click_element/fill_element 寻址(决定是否编序号) */
  interactive?: boolean;
  /** (role,name) 组内的序号;由采集侧从动作枚举回填,仅第 2 个及以后渲染标记 */
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
    const hasPayload = Boolean(node.name || node.text || node.value || node.href || node.note || node.hint);
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
  // 可操作节点的名字**不得改写**:模型会把它原样交给 click_element/fill_element,而动作侧是精确匹配
  if (node.name) parts.push(` ${quote(node.name, node.interactive ? 0 : 160)}`);
  if (node.id) parts.push(` #${node.id}`);
  if (node.states && node.states.length > 0) {
    parts.push(` ${node.states.map((s) => `[${s}]`).join('')}`);
  }
  // 序号:与 search_element 同约定——只有第 2 个及以后带标记
  if (node.interactive && (node.ordinal ?? 1) > 1) parts.push(` [${node.ordinal}]`);
  if (node.value) parts.push(`: ${quote(node.value)}`);
  else if (node.text) parts.push(`: ${quote(node.text)}`);
  if (node.href) parts.push(` /url: ${node.href}`);
  if (node.hint) parts.push(` (${node.hint})`);
  if (node.note) parts.push(` (${node.note})`);
  return parts.join('');
}

/** max=0 表示不改写(可操作名);其余超过 max 时截断并留痕 */
function quote(value: string, max = 160): string {
  return JSON.stringify(max > 0 && value.length > max ? `${value.slice(0, max - 1)}…` : value);
}
