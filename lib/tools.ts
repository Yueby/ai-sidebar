import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { toolLabel, type ToolRisk } from './types';
import { requestGate } from './gate';

/**
 * 轻量通用工具的家:不依赖 tab/页面读取原语、与具体提供商无关的小工具。
 * Model-facing 文本一律英文(硬约束);注释保持中文。
 */

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 本地日期 YYYY-MM-DD */
export function localDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** 本地时间 HH:MM:SS */
export function localTime(now: Date = new Date()): string {
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
}

/** UTC 偏移标签(如 `UTC+8`、`UTC+5:30`),供系统提示与 read_time 共用 */
export function utcOffsetLabel(now: Date = new Date()): string {
  const mins = -now.getTimezoneOffset();
  const sign = mins >= 0 ? '+' : '-';
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  return `UTC${sign}${h}${m ? `:${pad2(m)}` : ''}`;
}

const READ_TIME_PARAMS = Type.Object({});

/** read_time 工具(safe,不弹卡):设备本地时间的精确读数 */
export function createReadTimeTool(): AgentTool<typeof READ_TIME_PARAMS> & { risk: ToolRisk } {
  return {
    name: 'read_time',
    label: toolLabel('read_time'),
    risk: 'safe',
    description:
      "Get the device's current local time. The system prompt already carries today's date; use this tool when you need the precise time at the moment you are acting (time math, timestamps, deadline checks).",
    parameters: READ_TIME_PARAMS,
    execute: async () => {
      const now = new Date();
      const text = [
        'Current device time:',
        `date: ${localDate(now)}`,
        `weekday: ${WEEKDAY_NAMES[now.getDay()]}`,
        `time: ${localTime(now)}`,
        `timezone: ${utcOffsetLabel(now)}`,
        `iso (UTC): ${now.toISOString()}`,
      ].join('\n');
      return { content: [{ type: 'text', text }], details: null };
    },
  };
}

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
 * ask_user 工具:经 lib/gate.ts 的 ask 路径向用户提问并等待答复。
 * 挂起期间 agent 工具循环阻塞属预期行为(无超时);无 UI 处理器时快速 cancelled。
 */
export function createAskUserTool(): AgentTool<typeof ASK_USER_PARAMS> & { risk: ToolRisk } {
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
