import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { toolLabel, type ToolRisk } from '../types';
import { localDate, localTime, utcOffsetLabel, weekdayName } from './time';

const READ_TIME_PARAMS = Type.Object({});

/** read_time 工具定义(safe,不弹卡):设备本地时间的精确读数 */
export function createReadTimeToolDefinition(): AgentTool<typeof READ_TIME_PARAMS> & { risk: ToolRisk } {
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
        `weekday: ${weekdayName(now)}`,
        `time: ${localTime(now)}`,
        `timezone: ${utcOffsetLabel(now)}`,
        `iso (UTC): ${now.toISOString()}`,
      ].join('\n');
      return { content: [{ type: 'text', text }], details: null };
    },
  };
}
