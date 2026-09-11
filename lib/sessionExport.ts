/**
 * 会话导出为 Markdown(反馈/归档用):用户把导出文件发给他人做总结反馈,或回传修复。
 *
 * 设计:
 * - 人类可读优先:正文平铺;思考/工具调用收进 <details> 折叠块(GitHub 等 MD 渲染器可展开)
 * - <page-refs> 元数据块剥除,引用页面聚合为顶部折叠清单;picked-element 内联块转可读行
 * - 工具结果文本截断(TOOL_OUTPUT_LIMIT),图片块以 [图片] 占位
 * - 纯函数 buildSessionMarkdown + downloadSessionMarkdown(Blob 触发浏览器下载)
 */
import { i18n } from '#i18n';
import type { Session } from '@/lib/types';
import type { AssistantMessage, ToolResultMessage, UserMessage } from '@earendil-works/pi-ai';
import { collectPageRefs } from './pageRefs';

/** 单个工具结果文本上限;超限时保留头尾(尾部是指纹/状态等元数据行,反馈场景需要) */
const TOOL_OUTPUT_LIMIT = 1500;
const TOOL_OUTPUT_TAIL_KEEP = 400;

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
            if (b.type === 'image') return i18n.t('exportFile.image');
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
      return `${i18n.t('exportFile.pickedElement', { label: label || tagName || i18n.t('exportFile.unknownElement') })}${tabId ? ` (tab ${tabId})` : ''}`;
    })
    .trim();
}

/** 折叠 <details> 块(GitHub 风格 MD 可展开) */
function details(summary: string, body: string): string {
  return `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
}

/** 文本截断:超限保留头尾两段,中间以省略标注衔接(尾部常是指纹/状态行) */
function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const tailKeep = Math.min(TOOL_OUTPUT_TAIL_KEEP, Math.floor(limit / 4));
  const head = text.slice(0, limit - tailKeep);
  const tail = text.slice(-tailKeep);
  return `${head}\n${i18n.t('exportFile.omitted', { count: text.length })}\n${tail}`;
}

/** 工具调用折叠段:参数 JSON + 结果文本 */
function toolCallSection(call: { name: string; arguments: Record<string, unknown> }, result: ToolResultMessage | undefined): string {
  const args = JSON.stringify(call.arguments, null, 2) ?? '{}';
  let body = `${i18n.t('exportFile.args')}\n\n\`\`\`json\n${truncate(args, 800)}\n\`\`\``;
  if (result) {
    const text = result.content
      .map((b) => (b.type === 'text' ? b.text : i18n.t('exportFile.image')))
      .join('\n')
      .trim();
    body += `\n\n${i18n.t('exportFile.result')}${result.isError ? i18n.t('exportFile.errorSuffix') : ''}\n\n\`\`\`\n${truncate(text || i18n.t('exportFile.empty'), TOOL_OUTPUT_LIMIT)}\n\`\`\``;
  } else {
    body += `\n\n${i18n.t('exportFile.noResult')}`;
  }
  return details(i18n.t('exportFile.toolCall', { name: call.name }), body);
}

/** 助手消息正文:文本平铺;思考/工具调用折叠 */
function assistantSections(
  m: AssistantMessage,
  resultsByCallId: Map<string, ToolResultMessage>,
  consumedResults: Set<string>,
): string[] {
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
  if (thinking) sections.push(details(i18n.t('exportFile.thinking'), thinking));

  const calls = m.content.filter((b) => b.type === 'toolCall') as Array<{
    type: 'toolCall';
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  for (const call of calls) {
    sections.push(toolCallSection(call, resultsByCallId.get(call.id)));
    consumedResults.add(call.id);
  }

  if (m.stopReason === 'error' && m.errorMessage) {
    sections.push(i18n.t('exportFile.turnError', { message: m.errorMessage }));
  }
  return sections;
}

/** 会话 → Markdown 全文 */
export function buildSessionMarkdown(session: Session): string {
  // 工具结果按 toolCallId 索引,渲染时挂到对应调用下;余下的独立渲染(兜底不丢内容)。
  // consumed 标记已挂载的结果:不能 delete(map 还要用),否则孤儿判断失效 → 双重渲染。
  const resultsByCallId = new Map<string, ToolResultMessage>();
  for (const m of session.messages) {
    if (m.role === 'toolResult') resultsByCallId.set(m.toolCallId, m);
  }
  const consumedResults = new Set<string>();

  const refs = collectPageRefs(session.messages);
  const lines: string[] = [
    `# ${session.title || i18n.t('sessionTitle.untitled')}`,
    '',
    i18n.t('exportFile.exportedAt', { time: fmtTime(Date.now()) }),
    i18n.t('exportFile.createdAt', { time: fmtTime(session.createdAt) }),
    i18n.t('exportFile.messageCount', { count: session.messages.length }),
  ];
  if (session.compaction) {
    lines.push(i18n.t('exportFile.compactedNote'));
  }
  lines.push('', '---');

  const refTabs = [...refs.tabs.values()];
  if (refTabs.length > 0) {
    const refList = refTabs
      .map((t) =>
        i18n.t('exportFile.refTab', { id: t.tabId, title: t.title || i18n.t('exportFile.noTitle'), url: t.url }),
      )
      .join('\n');
    lines.push('', details(i18n.t('exportFile.refs'), refList));
  }

  let lastModel = '';
  for (const m of session.messages) {
    if (m.role === 'user') {
      const text = userContentText(m);
      if (!text) continue;
      lines.push('', i18n.t('exportFile.userRole'), '', text);
    } else if (m.role === 'assistant') {
      const modelLabel = `${m.provider}/${m.model}`;
      if (modelLabel !== lastModel) {
        lines.push('', i18n.t('exportFile.assistantRole'), '', i18n.t('exportFile.model', { model: modelLabel }), '');
        lastModel = modelLabel;
      } else {
        lines.push('', i18n.t('exportFile.assistantRole'), '');
      }
      const sections = assistantSections(m, resultsByCallId, consumedResults);
      lines.push(sections.length > 0 ? sections.join('\n\n') : i18n.t('exportFile.emptyReply'));
    } else if (m.role === 'toolResult' && consumedResults.has(m.toolCallId)) {
      // 已挂到对应调用下,跳过;只有找不到主的孤儿结果才独立渲染
      continue;
    } else if (m.role === 'toolResult') {
      const text = m.content.map((b) => (b.type === 'text' ? b.text : i18n.t('exportFile.image'))).join('\n').trim();
      lines.push('', details(`${i18n.t('exportFile.toolResult', { name: m.toolName })}${m.isError ? i18n.t('exportFile.errorSuffix') : ''}`, `\`\`\`\n${truncate(text || i18n.t('exportFile.empty'), TOOL_OUTPUT_LIMIT)}\n\`\`\``));
    }
  }

  return lines.join('\n') + '\n';
}

/** 导出文件名:标题净化(非法字符/长度) + 日期 */
function exportFilename(session: Session): string {
  const safe = (session.title || i18n.t('sessionTitle.untitled')).replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 40) || i18n.t('exportFile.filenameFallback');
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
