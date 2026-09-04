/**
 * 会话导出为 Markdown(反馈/归档用):用户把导出文件发给他人做总结反馈,或回传修复。
 *
 * 设计:
 * - 人类可读优先:正文平铺;思考/工具调用收进 <details> 折叠块(GitHub 等 MD 渲染器可展开)
 * - <page-refs> 元数据块剥除,引用页面聚合为顶部折叠清单;picked-element 内联块转可读行
 * - 工具结果文本截断(TOOL_OUTPUT_LIMIT),图片块以 [图片] 占位
 * - 纯函数 buildSessionMarkdown + downloadSessionMarkdown(Blob 触发浏览器下载)
 */
import type { Session } from '@/lib/types';
import type { AssistantMessage, ToolResultMessage, UserMessage } from '@earendil-works/pi-ai';
import { collectPageRefs } from './pageRefs';

/** 单个工具结果文本上限(反馈可读性 vs 完整性折中) */
const TOOL_OUTPUT_LIMIT = 1500;

/** 本地时间格式化:YYYY-MM-DD HH:mm */
function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 用户消息文本:string / blocks;剥 page-refs、picked-element 转可读行、图片占位 */
function userContentText(m: UserMessage): string {
  const raw =
    typeof m.content === 'string'
      ? m.content
      : m.content
          .map((b) => {
            if (b.type === 'text') return b.text;
            if (b.type === 'image') return '[图片]';
            return '';
          })
          .join('\n');
  return raw
    .replace(/<page-refs>[\s\S]*?<\/page-refs>/g, '')
    .replace(/<picked-element\b[^>]*\/>/g, (block) => {
      const attr = (name: string) => block.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '';
      const label = attr('label');
      const tagName = attr('tagName');
      const tabId = attr('tabId');
      return `📎 引用元素:${label || tagName || '未知元素'}${tabId ? `(tab ${tabId})` : ''}`;
    })
    .trim();
}

/** 折叠 <details> 块(GitHub 风格 MD 可展开) */
function details(summary: string, body: string): string {
  return `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
}

/** 文本截断并标注 */
function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…(截断,共 ${text.length} 字符)`;
}

/** 工具调用折叠段:参数 JSON + 结果文本 */
function toolCallSection(call: { name: string; arguments: Record<string, unknown> }, result: ToolResultMessage | undefined): string {
  const args = JSON.stringify(call.arguments, null, 2) ?? '{}';
  let body = `**参数**\n\n\`\`\`json\n${truncate(args, 800)}\n\`\`\``;
  if (result) {
    const text = result.content
      .map((b) => (b.type === 'text' ? b.text : '[图片]'))
      .join('\n')
      .trim();
    body += `\n\n**结果**${result.isError ? '(错误)' : ''}\n\n\`\`\`\n${truncate(text || '(空)', TOOL_OUTPUT_LIMIT)}\n\`\`\``;
  } else {
    body += '\n\n**结果**:无对应结果消息';
  }
  return details(`🔧 工具调用:${call.name}`, body);
}

/** 助手消息正文:文本平铺;思考/工具调用折叠 */
function assistantSections(m: AssistantMessage, resultsByCallId: Map<string, ToolResultMessage>): string[] {
  const sections: string[] = [];
  const thinking = m.content
    .filter((b) => b.type === 'thinking' && typeof (b as { thinking?: string }).thinking === 'string')
    .map((b) => (b as { thinking: string }).thinking.trim())
    .filter(Boolean)
    .join('\n\n');
  const text = m.content
    .filter((b) => b.type === 'text' && typeof (b as { text?: string }).text === 'string')
    .map((b) => (b as { text: string }).text.trim())
    .filter(Boolean)
    .join('\n\n');

  if (text) sections.push(text);
  if (thinking) sections.push(details('💭 思考过程', thinking));

  const calls = m.content.filter((b) => b.type === 'toolCall') as Array<{
    type: 'toolCall';
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  for (const call of calls) {
    sections.push(toolCallSection(call, resultsByCallId.get(call.id)));
    resultsByCallId.delete(call.id);
  }

  if (m.stopReason === 'error' && m.errorMessage) {
    sections.push(`> ⚠️ 本轮出错:${m.errorMessage}`);
  }
  return sections;
}

/** 会话 → Markdown 全文 */
export function buildSessionMarkdown(session: Session): string {
  // 工具结果按 toolCallId 索引,渲染时挂到对应调用下;余下的独立渲染(兜底不丢内容)
  const resultsByCallId = new Map<string, ToolResultMessage>();
  for (const m of session.messages) {
    if (m.role === 'toolResult') resultsByCallId.set(m.toolCallId, m);
  }

  const refs = collectPageRefs(session.messages);
  const lines: string[] = [
    `# ${session.title || '未命名会话'}`,
    '',
    `- 导出时间:${fmtTime(Date.now())}`,
    `- 会话创建:${fmtTime(session.createdAt)}`,
    `- 消息数:${session.messages.length}`,
  ];
  if (session.compaction) {
    lines.push('- 注:此会话经过上下文压缩,较早内容以摘要形式存在,未包含在导出中');
  }
  lines.push('', '---');

  const refTabs = [...refs.tabs.values()];
  if (refTabs.length > 0) {
    const refList = refTabs.map((t) => `- Tab ${t.tabId}:${t.title || '(无标题)'} — ${t.url}`).join('\n');
    lines.push('', details('📎 本会话引用的页面', refList));
  }

  let lastModel = '';
  for (const m of session.messages) {
    if (m.role === 'user') {
      const text = userContentText(m);
      if (!text) continue;
      lines.push('', `## 🧑 用户`, '', text);
    } else if (m.role === 'assistant') {
      const modelLabel = `${m.provider}/${m.model}`;
      if (modelLabel !== lastModel) {
        lines.push('', `## 🤖 助手`, '', `*模型:${modelLabel}*`, '');
        lastModel = modelLabel;
      } else {
        lines.push('', `## 🤖 助手`, '');
      }
      const sections = assistantSections(m, resultsByCallId);
      lines.push(sections.length > 0 ? sections.join('\n\n') : '*(空回复)*');
    } else if (m.role === 'toolResult' && resultsByCallId.has(m.toolCallId)) {
      // 已挂到对应调用下,跳过;只有找不到主的孤儿结果才独立渲染
      continue;
    } else if (m.role === 'toolResult') {
      const text = m.content.map((b) => (b.type === 'text' ? b.text : '[图片]')).join('\n').trim();
      lines.push('', details(`🔧 工具结果:${m.toolName}${m.isError ? '(错误)' : ''}`, `\`\`\`\n${truncate(text || '(空)', TOOL_OUTPUT_LIMIT)}\n\`\`\``));
    }
  }

  return lines.join('\n') + '\n';
}

/** 导出文件名:标题净化(非法字符/长度) + 日期 */
function exportFilename(session: Session): string {
  const safe = (session.title || '未命名会话').replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 40) || '会话';
  const d = new Date(session.updatedAt);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${safe}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.md`;
}

/** 触发浏览器下载 .md(sidepanel 页面上下文,Blob + 隐形锚点) */
export function downloadSessionMarkdown(session: Session): void {
  const blob = new Blob([buildSessionMarkdown(session)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFilename(session);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
