import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { toolLabel } from '../toolLabels';
import { type ToolRisk } from '../types';
import { requestGate } from '../gate';

const ASK_USER_PARAMS = Type.Object({
  question: Type.String({
    description: 'The question to ask the user; make it specific and self-contained',
  }),
  options: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Up to 6 suggested answer options for the user to pick from',
    }),
  ),
});

/**
 * ask_user 工具定义:经 lib/gate.ts 的 ask 路径向用户提问并等待答复。
 * 挂起期间 agent 工具循环阻塞属预期行为(无超时);无 UI 处理器时快速 cancelled。
 */
export function createAskUserToolDefinition(): AgentTool<typeof ASK_USER_PARAMS> & { risk: ToolRisk } {
  return {
    name: 'ask_user',
    label: toolLabel('ask_user'),
    risk: 'safe',
    description:
      'Ask the user a clarifying question and wait for their reply. Use it when the request is ambiguous, you need a user preference, or a destructive/irreversible action needs explicit approval. Do not overuse it for things you can reasonably infer. Provide `options` (max 6) when suitable answers are enumerable.',
    parameters: ASK_USER_PARAMS,
    execute: async (toolCallId, args) => {
      const question = typeof args?.question === 'string' ? args.question : '';
      if (!question.trim()) {
        return {
          content: [
            { type: 'text', text: 'Invalid question: a non-empty string is required.' },
          ],
          details: null,
        };
      }
      const rawOptions: unknown = args?.options;
      const options = Array.isArray(rawOptions)
        ? rawOptions
            .filter((o): o is string => typeof o === 'string' && o.length > 0)
            .slice(0, 6)
        : undefined;
      const res = await requestGate({
        kind: 'ask',
        question,
        options: options && options.length > 0 ? options : undefined,
        toolCallId,
      });
      if (res.kind !== 'ask' || res.cancelled) {
        return {
          content: [{ type: 'text', text: 'User dismissed the question (no answer).' }],
          details: { question },
        };
      }
      const fromOptions = options?.includes(res.answer) ?? false;
      return {
        content: [
          {
            type: 'text',
            text: fromOptions ? `${res.answer} (chosen from options)` : res.answer,
          },
        ],
        details: { question, fromOptions },
      };
    },
  };
}
