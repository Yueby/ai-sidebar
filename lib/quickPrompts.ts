/**
 * 新会话推荐快捷指令生成(参考 rikkahub suggestionModel 的异步+静默兜底模式)。
 *
 * 用辅助模型(默认跟随对话模型,见 resolveAuxModel)按当前页面上文生成 4 条对话
 * 起步建议;任何失败(无模型/请求失败/解析失败)由调用方回退 FALLBACK_PROMPTS,
 * 不产生错误 UI。Model-facing 文本一律英文,建议正文语言跟随页面语言(由模型决定)。
 */
import { createModels, type AssistantMessage, type Context, type SimpleStreamOptions } from '@earendil-works/pi-ai';
import type { Settings } from '@/lib/types';
import { resolveAuxModel } from '@/lib/providers';
import { buildProvider } from '@/lib/agent';
import { resolveAiLanguage } from '@/lib/language';

/** 单条快捷建议:title/desc 用于卡片展示,prompt 为点击后填入输入框的完整消息 */
export interface QuickPrompt {
  title: string;
  desc: string;
  prompt: string;
}

/** 生成失败/无模型时的静态兜底(原固定四条) */
export const FALLBACK_PROMPTS: QuickPrompt[] = [
  {
    title: '总结此网页',
    desc: '提炼 3-5 个核心要点',
    prompt: '请用清晰结构总结当前网页的核心内容,列出 3-5 个关键要点。',
  },
  {
    title: '提炼核心观点',
    desc: '分析论点与核心逻辑',
    prompt: '提炼当前网页的核心观点和结论,分析其主要论据与支持论点。',
  },
  {
    title: '通俗解释概念',
    desc: '用平实语言拆解内容',
    prompt: '用通俗易懂、生动的语言解释当前网页所讨论的主题和关键概念。',
  },
  {
    title: '提取行动建议',
    desc: '提炼可落地的待办事项',
    prompt: '根据当前网页的内容,提取出可以落地的实用行动建议或待办清单。',
  },
];

/** Model-facing 英文规范:JSON 数组输出,建议语言跟随页面语言 */
const QUICK_PROMPT_SYSTEM_PROMPT = (language: string) => `You generate conversation starter suggestions for a browser AI sidebar. Based on the provided page context, generate exactly 4 short, distinct, actionable suggestions the user might want to ask about the current page. If no page context is provided, generate 4 useful generic suggestions for browsing with an AI assistant.

Output format: a JSON array of exactly 4 objects, each with keys "title", "desc", "prompt":
- "title": very short label (max 12 characters)
- "desc": one-line description (max 24 characters)
- "prompt": a complete message the user could send (one sentence)

Write all values in ${language}. Output ONLY the JSON array, no markdown fences, no commentary.`;

/** 生成请求上限:4 条短文本绰绰有余,防失控输出 */
const MAX_TOKENS = 500;

/**
 * 当前页面是否值得出推荐指令:仅 http(s) 算正常页面。
 * chrome://、新标签页、about:blank、file:// 等非 http(s) 页面 → false(整体隐藏,不生成)。
 */
export function isPromptWorthyUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * 生成快捷建议;任何失败 throw,由调用方(hook)回退 FALLBACK_PROMPTS。
 * context 取当前活动 tab 的 title/url(可选,缺省时生成通用建议)。
 */
export async function generateQuickPrompts(
  settings: Settings,
  context: { pageTitle?: string; url?: string },
  signal?: AbortSignal,
): Promise<QuickPrompt[]> {
  const active = resolveAuxModel(settings, settings.quickPromptModel);
  if (!active) throw new Error('No model available');

  const models = createModels();
  models.setProvider(buildProvider(active.provider));
  const model = models.getModel(active.provider.id, active.model.id);
  if (!model) throw new Error(`Model ${active.model.id} not found`);

  const contextDesc =
    [
      context.pageTitle ? `Page title: ${context.pageTitle}` : null,
      context.url ? `Page URL: ${context.url}` : null,
    ]
      .filter(Boolean)
      .join('\n') || 'No page context available.';

  const context_: Context = {
    systemPrompt: QUICK_PROMPT_SYSTEM_PROMPT(resolveAiLanguage(settings.language)),
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: `${contextDesc}\n\nSuggestions:` }],
        timestamp: Date.now(),
      },
    ],
  };

  const options: SimpleStreamOptions = {
    maxTokens: MAX_TOKENS,
    signal,
    cacheRetention: 'none',
    // 辅助任务思考等级:off = 不发 reasoning 参数(pi-ai 语义 = 关闭/模型默认)
    reasoning: settings.auxThinking === 'off' ? undefined : settings.auxThinking,
  };

  const response: AssistantMessage = await models.completeSimple(model, context_, options);
  if (response.stopReason === 'error') {
    throw new Error(response.errorMessage || 'Quick prompts generation error');
  }

  const raw = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return parseQuickPrompts(raw);
}

/** 解析模型输出:剥 code fence,取首个 JSON 数组,逐条形状校验,最多 4 条 */
function parseQuickPrompts(raw: string): QuickPrompt[] {
  const cleaned = raw.replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) throw new Error('No JSON array in response');

  const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('Response is not an array');

  const items = parsed
    .slice(0, 4)
    .map((item): QuickPrompt | null => {
      if (!item || typeof item !== 'object') return null;
      const r = item as { title?: unknown; desc?: unknown; prompt?: unknown };
      if (typeof r.title !== 'string' || typeof r.prompt !== 'string') return null;
      const title = r.title.trim();
      const prompt = r.prompt.trim();
      if (!title || !prompt) return null;
      return { title, desc: typeof r.desc === 'string' ? r.desc.trim() : '', prompt };
    })
    .filter((x): x is QuickPrompt => x !== null);

  if (items.length === 0) throw new Error('No valid suggestions');
  return items;
}
