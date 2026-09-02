import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { toolLabel, type ToolRisk } from '../types';

const COMPACT_CONTEXT_PARAMS = Type.Object({});

/**
 * compact_context 工具定义(safe,常驻):模型主动申请压缩上下文。
 * execute 不做压缩本体 —— 仅调 onRequest() 通知调用方(Agent 轮结束后由其执行
 * runCompact 并落盘),返回英文确认文本。
 */
export function createCompactContextToolDefinition(
  onRequest: () => void,
): AgentTool<typeof COMPACT_CONTEXT_PARAMS> & { risk: ToolRisk } {
  return {
    name: 'compact_context',
    label: toolLabel('compact_context'),
    risk: 'safe',
    description:
      'Schedule a context compaction for this conversation. Call it when the conversation has grown long, earlier details are no longer needed, or the user asks to compact/clear context. The compaction runs after this turn finishes: older history is replaced with a structured summary, so do not call it to preserve details — instead mention in your reply that earlier details will be summarized.',
    parameters: COMPACT_CONTEXT_PARAMS,
    execute: async () => {
      onRequest();
      return {
        content: [
          {
            type: 'text',
            text: 'Context compaction scheduled. The conversation will be summarized into a compact checkpoint after this turn completes; earlier details may be dropped from the context.',
          },
        ],
        details: null,
      };
    },
  };
}
