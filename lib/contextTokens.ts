import type { AssistantMessage, ChatMessage, SessionCompaction } from './types';

/**
 * 上下文容量估算:纯计算,无 I/O。
 * 锚点策略对齐 pi 上游 compaction.ts:自后向前找最近一条有效 usage 的 assistant
 * (stopReason ∉ {aborted, error} 且折算 > 0)作为真实基数,其后的消息走字符估算。
 */

/** 图片块按 pi 惯例估 4800 字符(≈1200 token) */
const IMAGE_ESTIMATE_CHARS = 4800;

/** 视为 1 token/字的 CJK 码位范围(汉字 + 假名 + 谚文 + 全角符号;单次 charCodeAt 扫描,无需正则) */
const CJK_RANGES: readonly (readonly [number, number])[] = [
  [0x3000, 0x303f], // CJK 符号与标点(全角)
  [0x3040, 0x30ff], // 平假名/片假名
  [0x1100, 0x11ff], // 谚文字母(Hangul Jamo)
  [0x3130, 0x318f], // 谚文兼容字母(Compatibility Jamo)
  [0x3400, 0x4dbf], // CJK 扩展 A
  [0x4e00, 0x9fff], // CJK 统一表意文字
  [0xac00, 0xd7ff], // 谚文音节(Hangul Syllables)
  [0xf900, 0xfaff], // CJK 兼容表意文字
  [0xff00, 0xffef], // 全角形式
];

function isCjkCode(code: number): boolean {
  for (const [lo, hi] of CJK_RANGES) {
    if (code >= lo && code <= hi) return true;
  }
  return false;
}

/** 单段文本估算:CJK 字符 ×1.0,其余字符 ÷4(单遍扫描,消息可能很长) */
function estimateTextTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    if (isCjkCode(text.charCodeAt(i))) cjk++;
    else other++;
  }
  return cjk + other / 4;
}

interface TextLikeBlock {
  type: string;
  text?: string;
}

function estimateContentTokens(content: string | readonly ContentLike[]): number {
  if (typeof content === 'string') return estimateTextTokens(content);
  let tokens = 0;
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      tokens += estimateTextTokens(block.text);
    } else if (block.type === 'image') {
      tokens += IMAGE_ESTIMATE_CHARS / 4;
    }
  }
  return tokens;
}

type ContentLike = TextLikeBlock & { thinking?: string; arguments?: unknown; name?: string };

/** 单条消息 token 估算(CJK 加权 + 字符 ÷4 启发式,保守偏高) */
export function estimateTokens(msg: ChatMessage): number {
  if (msg.role === 'user') {
    return Math.ceil(estimateContentTokens(msg.content));
  }
  if (msg.role === 'assistant') {
    const a = msg as AssistantMessage;
    let tokens = 0;
    for (const block of a.content) {
      if (block.type === 'text') {
        tokens += estimateTextTokens(block.text);
      } else if (block.type === 'thinking') {
        tokens += estimateTextTokens(block.thinking);
      } else if (block.type === 'toolCall') {
        tokens += estimateTextTokens(block.name + JSON.stringify(block.arguments ?? {}));
      }
    }
    return Math.ceil(tokens);
  }
  // toolResult:content 为 (Text|Image)Content 块数组
  return Math.ceil(estimateContentTokens(msg.content));
}

export interface ContextUsage {
  tokens: number;
  usageTokens: number;
  trailingTokens: number;
  hasUsageAnchor: boolean;
  window: number;
  /** tokens 占 window 的百分比(0~100+,UI 自行格式化) */
  pct: number;
}

/** usage 折算上下文 token:totalTokens 优先,缺失回退四分量之和 */
function usageContextTokens(usage: { totalTokens: number; input: number; output: number; cacheRead: number; cacheWrite: number }): number {
  return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

/**
 * 估算当前上下文 token 占用:锚点 usage + 其后消息估算和;无锚点则全量估算。
 */
export function estimateContextTokens(messages: ChatMessage[], window: number): ContextUsage {
  let anchorIndex = -1;
  let usageTokens = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== 'assistant') continue;
    const a = m as AssistantMessage;
    if (a.stopReason === 'aborted' || a.stopReason === 'error') continue;
    if (!a.usage) continue;
    const t = usageContextTokens(a.usage);
    if (t > 0) {
      anchorIndex = i;
      usageTokens = t;
      break;
    }
  }

  let trailingTokens = 0;
  for (let i = anchorIndex + 1; i < messages.length; i++) {
    trailingTokens += estimateTokens(messages[i]!);
  }

  const tokens = anchorIndex >= 0 ? usageTokens + trailingTokens : trailingTokens;
  return {
    tokens,
    usageTokens: anchorIndex >= 0 ? usageTokens : 0,
    trailingTokens,
    hasUsageAnchor: anchorIndex >= 0,
    window,
    pct: window > 0 ? (tokens / window) * 100 : 0,
  };
}

/**
 * 压缩后的有效消息视图:compaction 为空返回原数组;
 * 有则返回 [摘要 user 消息, ...其后消息](摘要按 summaryTimestamp 定位,找不到则回退原数组)。
 */
export function effectiveMessages(messages: ChatMessage[], compaction?: SessionCompaction): ChatMessage[] {
  if (!compaction) return messages;
  const idx = messages.findIndex(
    (m) => m.role === 'user' && m.timestamp === compaction.summaryTimestamp,
  );
  if (idx < 0) return messages;
  return [messages[idx]!, ...messages.slice(idx + 1)];
}

/** 压缩预留预算:min(16384, window×0.15) */
function reserveTokens(window: number): number {
  return Math.min(16384, window * 0.15);
}

/** 是否应当压缩:tokens > window − reserveTokens */
export function shouldCompact(usage: ContextUsage): boolean {
  return usage.tokens > usage.window - reserveTokens(usage.window);
}
