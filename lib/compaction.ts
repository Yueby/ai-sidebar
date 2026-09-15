import {
  contentText,
  createModels,
  type AssistantMessage,
  type Context,
  type KnownApi,
  type Provider,
  type SimpleStreamOptions,
  type Usage,
} from '@earendil-works/pi-ai';
import { i18n } from '#i18n';
import type { ChatMessage } from './types';
import { estimateContextTokens, estimateTokens } from './contextTokens';

/**
 * 上下文压缩:照搬 pi coding-agent compaction.ts 的算法蓝本,本地化到 BYOK 单模型场景。
 * runCompact 只产出摘要文本与统计;摘要 user 消息的拼装(<context-summary> 块 +
 * page-refs 并集块)与 session.compaction 的落盘由调用方完成 —— 本层不触碰存储。
 * Model-facing 文本一律英文(硬约束)。
 */

/** 压缩请求用的 provider 实例(agent.ts buildProvider 的产物) */
export type ProviderInstance = Provider<KnownApi>;

/** 保守切点预算:自后向前累计到该值即停,预算内消息原样保留(与 read_element 截断同值) */
const KEEP_RECENT_TOKENS = 12000;
/** 小窗口模型的切点预算下限:窗口 < KEEP_RECENT_TOKENS 时按比例降级但不低于此值 */
const KEEP_RECENT_MIN_TOKENS = 2000;
/** 摘要生成预算基数(pi DEFAULT_COMPACTION_SETTINGS.reserveTokens) */
const RESERVE_TOKENS = 16384;
/** 摘要请求输入预算:序列化对话占窗口比例上限(BYOK 小窗口必需,否则请求直接超限) */
const SUMMARY_INPUT_WINDOW_RATIO = 0.45;
/** 摘要生成预算:占窗口比例上限(剩余留给输入) */
const SUMMARY_OUTPUT_WINDOW_RATIO = 0.35;
/** 序列化时单条 toolResult 截断上限(pi 同值) */
const TOOL_RESULT_MAX_CHARS = 2000;

/** 摘要 system prompt(pi utils.ts SUMMARIZATION_SYSTEM_PROMPT 原文) */
const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;

/** 摘要正文结构:pi 六段 + 本地化 ## Referenced Pages 段 */
const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

## Referenced Pages
- [Web pages (title + URL) or picked elements (tabId + selector) referenced in the conversation that may still matter after compaction]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact page URLs, CSS selectors, file paths, function names, and error messages.`;

/** 序列化时文本截断:保留开头 + 截断标记(pi truncateForSummary 同形) */
function truncateForSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncatedChars = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n\n[... ${truncatedChars} more characters truncated]`;
}

/**
 * 对话序列化为纯文本(pi serializeConversation 同构),防止模型把摘要请求当对话续写。
 * 本项目 ChatMessage 即 pi LLM 消息,无需 convertToLlm。
 */
function serializeConversation(messages: ChatMessage[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    if (msg.role === 'user') {
      const content = contentText(msg.content, '');
      if (content) parts.push(`[User]: ${content}`);
    } else if (msg.role === 'assistant') {
      const thinkingParts: string[] = [];
      const toolCalls: string[] = [];
      for (const block of msg.content) {
        if (block.type === 'thinking') {
          thinkingParts.push(block.thinking);
        } else if (block.type === 'toolCall') {
          const argsStr = Object.entries(block.arguments ?? {})
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join(', ');
          toolCalls.push(`${block.name}(${argsStr})`);
        }
      }
      if (thinkingParts.length > 0) {
        parts.push(`[Assistant thinking]: ${thinkingParts.join('\n')}`);
      }
      if (msg.content.some((block) => block.type === 'text')) {
        parts.push(`[Assistant]: ${contentText(msg.content)}`);
      }
      if (toolCalls.length > 0) {
        parts.push(`[Assistant tool calls]: ${toolCalls.join('; ')}`);
      }
    } else {
      // toolResult:正文截断,摘要不需要全文
      const content = contentText(msg.content, '');
      if (content) {
        parts.push(`[Tool result]: ${truncateForSummary(content, TOOL_RESULT_MAX_CHARS)}`);
      }
    }
  }
  return parts.join('\n\n');
}

/** 技能正文标记:read_skill 的输出与 /skill:<name> 注入的用户消息都用它包裹(决策 52) */
export const SKILL_CONTENT_MARKER = '<skill_content';

/**
 * 技能正文的压缩豁免(纯函数,可单测;决策 52)。
 *
 * 技能指令是**持久行为指导**:被摘要扫走会让 agent 悄悄丢掉专门知识,而且没有任何可见错误
 * (标准明确要求客户端保住它)。做法是把切点夹紧到区域内最早一条含 <skill_content 的消息之前 ——
 * 该消息连同其后内容一起留在保留区。夹紧只缩小被摘范围,不会把新内容卷进摘要。
 *
 * 夹紧后为 0 = 无可压缩内容(调用方按既有 "Nothing to compact" 语义处理,不强行压缩)。
 * 夹紧时不得让 toolResult 成为首条保留消息(它必须跟随自己的 toolCall):必要时再往前挪一格。
 */
export function protectSkillContent(messages: ChatMessage[], cutIndex: number): number {
  const cut = Math.max(0, Math.min(cutIndex, messages.length));
  let target = cut;
  for (let i = 0; i < cut; i += 1) {
    if (contentText(messages[i]!.content, '').includes(SKILL_CONTENT_MARKER)) {
      target = i;
      break;
    }
  }
  if (target === cut) return cut;
  while (target > 0 && messages[target]!.role === 'toolResult') target -= 1;
  return target;
}

/**
 * 切点定位(pi findCutPoint 的扁平消息版):自后向前累计估算 token,
 * 达到 keepRecentTokens 后停在最近的有效切点;toolResult 永不作为切点
 * (必须跟随其 toolCall)。返回第一条保留消息的下标。
 * 技能正文受保护(protectSkillContent):带 <skill_content 的消息不会被摘要扫走。
 * 导出给调用方按同一确定性规则计算保留区(拼装摘要消息 + 保留消息)。
 */
export function findCutIndex(messages: ChatMessage[], keepRecentTokens = KEEP_RECENT_TOKENS): number {
  const cutPoints: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.role !== 'toolResult') cutPoints.push(i);
  }
  if (cutPoints.length === 0) return 0;

  let accumulated = 0;
  let cutIndex = cutPoints[0]!;
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = estimateTokens(messages[i]!);
    if (t === 0) continue;
    accumulated += t;
    if (accumulated >= keepRecentTokens) {
      for (const c of cutPoints) {
        if (c >= i) {
          cutIndex = c;
          break;
        }
      }
      break;
    }
  }
  return protectSkillContent(messages, cutIndex);
}

/**
 * 执行压缩:对 messages(effectiveMessages 结果)按保守切点切分,
 * 被切下的前缀经同模型一次性调用生成六段结构摘要(英文,含 ## Referenced Pages 段)。
 * thinking off(不传 reasoning)、cacheRetention 'none'(一次性请求不写缓存)、可中止;
 * stopReason = length/error 视为失败抛 Error(调用方不落盘)。
 */
export async function runCompact(opts: {
  provider: ProviderInstance;
  modelId: string;
  /** 压缩范围消息(调用方传 effectiveMessages 结果) */
  messages: ChatMessage[];
  signal?: AbortSignal;
  /** 用户补充的摘要重点 */
  customInstructions?: string;
}): Promise<{ summaryContent: string; tokensBefore: number; usage?: Usage }> {
  const models = createModels();
  models.setProvider(opts.provider);
  const model = models.getModel(opts.provider.id, opts.modelId);
  if (!model) throw new Error(i18n.t('errors.modelMissing', { model: opts.modelId }));

  const window = model.contextWindow > 0 ? model.contextWindow : 128000;
  const tokensBefore = estimateContextTokens(opts.messages, window).tokens;

  // 切点预算随窗口自适应(pi 固定 20000 假设大窗口;BYOK 小窗口按比例降级,
  // 否则窗口 < keepRecent 时切点永远落在首条消息,压缩永远报 Nothing to compact)
  const keepRecent = Math.max(
    KEEP_RECENT_MIN_TOKENS,
    Math.min(KEEP_RECENT_TOKENS, Math.floor(window * 0.15))
  );
  const cutIndex = findCutIndex(opts.messages, keepRecent);
  const toSummarize = opts.messages.slice(0, cutIndex);
  if (toSummarize.length === 0) {
    throw new Error('Nothing to compact: the conversation is smaller than the recent-keep budget.');
  }

  // 摘要请求整体(输入+生成)必须塞进窗口:输入预算 = 窗口的 SUMMARY_INPUT_WINDOW_RATIO,
  // 序列化超限时从头部截断(被压缩的是最老前缀,丢头部合理),并显式标注
  const inputBudgetChars = Math.max(8000, Math.floor(window * SUMMARY_INPUT_WINDOW_RATIO) * 4);
  let serialized = serializeConversation(toSummarize);
  if (serialized.length > inputBudgetChars) {
    serialized = `[... earlier conversation truncated for summarization]\n\n${serialized.slice(
      serialized.length - inputBudgetChars
    )}`;
  }

  let prompt = `<conversation>\n${serialized}\n</conversation>\n\n${SUMMARIZATION_PROMPT}`;
  if (opts.customInstructions && opts.customInstructions.trim()) {
    prompt += `\n\nAdditional focus: ${opts.customInstructions.trim()}`;
  }

  const maxTokens = Math.min(
    Math.floor(0.8 * RESERVE_TOKENS),
    Math.floor(window * SUMMARY_OUTPUT_WINDOW_RATIO),
    model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
  );
  const context: Context = {
    systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: prompt }],
        timestamp: Date.now(),
      },
    ],
  };
  const options: SimpleStreamOptions = {
    maxTokens,
    signal: opts.signal,
    cacheRetention: 'none',
    // thinking off:不设置 reasoning 字段
  };

  const response: AssistantMessage = await models.completeSimple(model, context, options);
  if (response.stopReason === 'error') {
    throw new Error(`Compaction failed: ${response.errorMessage || 'Unknown error'}`);
  }
  if (response.stopReason === 'length') {
    throw new Error('Compaction failed: generation hit the token cap and the summary is incomplete');
  }
  if (response.content.some((block) => block.type === 'toolCall')) {
    throw new Error('Compaction attempted to call a tool');
  }

  return {
    summaryContent: contentText(response.content),
    tokensBefore,
    usage: response.usage,
  };
}
