/** 本地时间助手:供 buildSystemPrompt 与 read_time 工具共用 */

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

/** 星期英文名(供 system prompt 日期行) */
export function weekdayName(now: Date = new Date()): string {
  return WEEKDAY_NAMES[now.getDay()] ?? 'Sunday';
}
