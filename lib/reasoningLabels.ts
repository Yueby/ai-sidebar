import { i18n } from '#i18n';
import { REASONING_LEVEL_LABELS, type ReasoningLevel } from './types';

/**
 * 思考等级展示文案(单一来源收敛 i18n;范式同 lib/toolLabels.ts)。
 *
 * 注意:`REASONING_LEVEL_LABELS` 必须留在 types.ts——**types.ts 会被 content script 引用**,
 * 那边绝不能出现 `#i18n`。此处只负责按当前语言取文案,缺失时回退表内默认值。
 */
export function reasoningLabel(level: ReasoningLevel): { short: string; full: string } {
  const fallback = REASONING_LEVEL_LABELS[level] ?? REASONING_LEVEL_LABELS.medium;
  const pick = (kind: 'short' | 'full'): string => {
    const key = `reasoning.${level}.${kind}`;
    const text = i18n.t(key as Parameters<typeof i18n.t>[0]);
    return text && text !== key ? text : fallback[kind];
  };
  return { short: pick('short'), full: pick('full') };
}

/**
 * 按档位名取文案;未知档位(旧数据/自定义值)**原样返回**。
 * 消费处以前写 `REASONING_LEVEL_LABELS[lvl]?.full || lvl`——直接调 reasoningLabel 会把未知值
 * 回退成 medium 的文案(显示错档位),这里保留旧语义只换文案源。
 */
export function reasoningLabelText(level: string, kind: 'short' | 'full' = 'full'): string {
  if (!(level in REASONING_LEVEL_LABELS)) return level;
  return reasoningLabel(level as ReasoningLevel)[kind];
}
