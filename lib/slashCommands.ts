/**
 * 斜杠命令目录(UI 消费;description 为 UI 显示文案,保持中文)。
 * 具体执行由 UI 层对接;compact 的补充重点参数透传 runCompact.customInstructions。
 */
export interface SlashCommand {
  name: string;
  description: string;
  /** 参数提示(输入框占位展示) */
  argumentHint?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'compact',
    description: '压缩上下文:把较早的对话折叠成结构化摘要',
    argumentHint: '[补充重点]',
  },
  {
    name: 'clear',
    description: '清空当前会话的全部消息',
  },
  {
    name: 'help',
    description: '显示可用的斜杠命令',
  },
];
