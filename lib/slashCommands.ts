/**
 * 斜杠命令目录(UI 消费;description 为 UI 显示文案,已收敛 i18n 到 `slash.*`)。
 * 具体执行由 UI 层对接;compact 的补充重点参数透传 runCompact.customInstructions。
 */
import { i18n } from '#i18n';

export interface SlashCommand {
  name: string;
  description: string;
  /** 参数提示(输入框占位展示) */
  argumentHint?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'compact',
    description: i18n.t('slash.compact.description'),
    argumentHint: i18n.t('slash.compact.argumentHint'),
  },
  {
    name: 'clear',
    description: i18n.t('slash.clear.description'),
  },
  {
    name: 'help',
    description: i18n.t('slash.help.description'),
  },
];
