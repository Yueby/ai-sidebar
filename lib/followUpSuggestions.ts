/**
 * 对话结束推荐跟进建议生成 (Follow-up Suggestions)。
 *
 * 在一轮对话正常完成(非打断、非错误、无队列积压)后，使用辅助模型(默认跟随对话模型)
 * 基于最近一轮问答(最后一条助手回复 + 其前面的用户输入)静默生成 3 条跟进建议；
 * 任何失败(无可用模型、超时、格式解析错误等)静默失败，不产生错误 UI。
 * Model-facing 文本一律英文，建议正文语言跟随全局语言偏好或对话语言。
 */
import {
  createModels,
  type AssistantMessage,
  type Context,
  type SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import type { Settings } from '@/lib/types';
import { resolveAuxModel } from '@/lib/providers';
import { buildProvider } from '@/lib/agent';
import { resolveAiLanguage } from '@/lib/language';

/** 单条跟进建议: title 用于 chip 展示, prompt 为点击后填入输入框的完整内容 */
export interface FollowUpSuggestion {
  title: string;
  prompt: string;
}

/** Model-facing 英文规范: JSON 数组输出，生成 3 条跟进建议 */
const FOLLOW_UP_SYSTEM_PROMPT = (language: string) =>
  `You generate follow-up conversation suggestions for a browser AI assistant sidebar. Based on the user's latest query and the assistant's response, suggest exactly 3 logical, short, relevant follow-up questions or next steps the user might want to ask.

Output format: a JSON array of exactly 3 objects, each with keys "title" and "prompt":
- "title": concise label for a chip button (max 20 characters, or max 12 CJK characters)
- "prompt": a natural, complete message the user could send as the follow-up (1-2 sentences)

Write all values in ${language}. Output ONLY the JSON array, no markdown fences, no commentary.`;

/** 建议请求 token 上限: 3 条短建议 350 tokens 足够 */
const MAX_TOKENS = 350;

/**
 * 解析模型输出: 剥除 code fence, 取首个 JSON 数组, 逐条形状校验, 最多取 3 条
 */
function parseFollowUpSuggestions(raw: string): FollowUpSuggestion[] {
  const cleaned = raw.replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) throw new Error('No JSON array in response');

  const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('Response is not an array');

  const items = parsed
    .slice(0, 3)
    .map((item): FollowUpSuggestion | null => {
      if (!item || typeof item !== 'object') return null;
      const r = item as { title?: unknown; prompt?: unknown };
      if (typeof r.title !== 'string' || typeof r.prompt !== 'string') return null;
      const title = r.title.trim();
      const prompt = r.prompt.trim();
      if (!title || !prompt) return null;
      return { title, prompt };
    })
    .filter((x): x is FollowUpSuggestion => x !== null);

  if (items.length === 0) throw new Error('No valid suggestions');
  return items;
}

/**
 * 生成跟进建议: 任何失败 throw，由调用层静默捕获。
 */
export async function generateFollowUpSuggestions(
  settings: Settings,
  pair: { userText: string; assistantText: string },
  signal?: AbortSignal,
): Promise<FollowUpSuggestion[]> {
  const auxModel = settings.quickPromptModel ?? settings.titleModel;
  const active = resolveAuxModel(settings, auxModel);
  if (!active) throw new Error('No model available');

  const userSnippet = pair.userText.trim().slice(0, 1000);
  const assistantSnippet = pair.assistantText.trim().slice(0, 2000);
  if (!assistantSnippet) throw new Error('No assistant text to follow up on');

  const conversationText = userSnippet
    ? `User query:\n${userSnippet}\n\nAssistant reply:\n${assistantSnippet}\n\nFollow-up suggestions:`
    : `Assistant reply:\n${assistantSnippet}\n\nFollow-up suggestions:`;

  const models = createModels();
  models.setProvider(buildProvider(active.provider));
  const model = models.getModel(active.provider.id, active.model.id);
  if (!model) throw new Error(`Model ${active.model.id} not found`);

  const context: Context = {
    systemPrompt: FOLLOW_UP_SYSTEM_PROMPT(resolveAiLanguage(settings.language)),
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: conversationText }],
        timestamp: Date.now(),
      },
    ],
  };

  const thinking = settings.quickPromptThinking ?? settings.titleThinking ?? 'off';
  const options: SimpleStreamOptions = {
    maxTokens: MAX_TOKENS,
    signal,
    cacheRetention: 'none',
    reasoning: thinking === 'off' ? undefined : thinking,
  };

  const response: AssistantMessage = await models.completeSimple(model, context, options);
  if (response.stopReason === 'error') {
    throw new Error(response.errorMessage || 'Follow-up suggestions generation error');
  }

  const raw = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return parseFollowUpSuggestions(raw);
}
