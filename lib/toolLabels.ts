import { i18n } from '#i18n';

/**
 * 工具中文标签(单一来源收敛 i18n,审计:i18n-ready)。
 * key = 工具名(含旧名 extract_page,兼容历史会话持久化的 toolCall.name);
 * 文案在 locales/*.yml 的 toolLabels 段。动态 key 场景:缺失时回退工具原名。
 *
 * 注意:本模块仅 sidepanel 侧可用(#i18n);lib/tools 的 label 字段在 agent(= sidepanel)求值。
 */
export function toolLabel(name: string): string {
  const key = `toolLabels.${name}`;
  const text = i18n.t(key as Parameters<typeof i18n.t>[0]);
  return text && text !== key ? text : name;
}
