import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { i18n } from '#i18n';
import { toolLabel } from '../toolLabels';
import type { ToolRisk } from '../types';
import { createGatedTool } from '../gate';
import { saveSkill } from '../skillStore';

const SAVE_SKILL_PARAMS = Type.Object({
  name: Type.String({
    description:
      'Skill name: 1-64 characters, lowercase letters, digits and single hyphens (e.g. "pdf-processing"). Saving again with the same name updates that skill.',
  }),
  description: Type.String({
    description:
      'What the skill does and when to use it (max 1024 characters). This is the only text the model sees before loading the skill, so be specific about the situations it applies to.',
  }),
  content: Type.String({
    description:
      'The instruction body (Markdown), without frontmatter — the name and description are separate arguments. Write the steps a capable model should follow, naming the tools to use.',
  }),
});

/**
 * save_skill 工具定义(confirm 型):把技能写回存储(创作/安装的落库端;决策 52)。
 *
 * 经 createGatedTool 包装且**不带 grantScope** —— 与 execute_js 同待遇:写技能会改变模型
 * 未来每个会话持有的指令,属"永不进 grant"的动作。确认卡展示名字与体积,便于用户判断。
 */
export function createSaveSkillToolDefinition(sessionId?: string): AgentTool<typeof SAVE_SKILL_PARAMS> & {
  risk: ToolRisk;
} {
  const base: AgentTool<typeof SAVE_SKILL_PARAMS> & { risk: ToolRisk } = {
    name: 'save_skill',
    label: toolLabel('save_skill'),
    risk: 'confirm',
    description:
      'Create or update a skill — a reusable set of instructions that appears in this sidebar\'s skill catalog for future conversations. Use it when the user asks you to remember how to do something in a reusable way, or to install a skill they pointed you at (fetch its SKILL.md first and show the user what it says). Saving a skill changes what future conversations are told, so every save needs explicit user approval via a confirmation card; show the user the plan before calling. Passing an existing name updates that skill. Built-in skills cannot be overwritten.',
    parameters: SAVE_SKILL_PARAMS,
    execute: async (_toolCallId, args) => {
      const name = typeof args?.name === 'string' ? args.name : '';
      const description = typeof args?.description === 'string' ? args.description : '';
      const content = typeof args?.content === 'string' ? args.content : '';
      const res = await saveSkill({ name, description, content, source: 'user' });
      if (!res.ok) {
        return { content: [{ type: 'text', text: res.error }], details: null };
      }
      return {
        content: [
          {
            type: 'text',
            text:
              `Saved the "${res.skill.name}" skill (${res.skill.content.length} characters of instructions). ` +
              (res.bodyTruncated
                ? `The body was longer than the limit and was truncated, with a note left at the end of it. `
                : '') +
              'It is offered to the model in future conversations; load it now with read_skill if it should apply to the current one.',
          },
        ],
        details: { skill: res.skill.name, id: res.skill.id },
      };
    },
  };
  return createGatedTool(
    base,
    i18n.t('gateCard.saveSkill.summary'),
    undefined,
    (params) => {
      const p = (params ?? {}) as { name?: unknown; description?: unknown; content?: unknown };
      const name = typeof p.name === 'string' ? p.name.trim() : '(missing)';
      const description = typeof p.description === 'string' ? p.description.trim() : '';
      const content = typeof p.content === 'string' ? p.content : '';
      const preview = content.replace(/\s+/g, ' ').slice(0, 160);
      return [
        `Skill name: ${name}`,
        description ? `Description: ${description}` : 'Description: (missing)',
        `Body: ${content.length} characters`,
        preview ? `Preview: ${preview}${content.length > 160 ? '…' : ''}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    },
    sessionId,
  );
}