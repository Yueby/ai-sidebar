import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { toolLabel } from '../toolLabels';
import type { Skill, ToolRisk } from '../types';
import { findSkillByName, modelFacingSkills } from '../skillFormat';
import { markSkillLoaded } from '../skillRuntime';

const READ_SKILL_PARAMS = Type.Object({
  name: Type.String({
    description:
      'Name of the skill to load, exactly as listed in <available_skills> (case-insensitive).',
  }),
});

/**
 * read_skill 工具定义(safe):按需载入技能正文(渐进披露第二层;决策 52)。
 *
 * 技能是**纯指令**:载入不授予任何权限,技能里要求用的工具仍走各自的确认卡。
 * 只认"面向模型可见"的技能(启用且非仅手动唤起)—— 否则模型能绕过用户的选择。
 * 注:调用方传**完整**技能列表(不只是可见的那部分),这样禁用/仅手动技能能被
 * 如实挡下并说明原因(skill_not_available),而不是报成"不存在"。
 */
export function createReadSkillToolDefinition(
  skills: Skill[],
  sessionId?: string,
): AgentTool<typeof READ_SKILL_PARAMS> & { risk: ToolRisk } {
  return {
    name: 'read_skill',
    label: toolLabel('read_skill'),
    risk: 'safe',
    description:
      "Load the full instructions of a skill listed in <available_skills>. Call this when the task at hand matches a skill's description — the catalog only carries names and descriptions, so the instructions may be exactly what is needed. Skills are instructions, not permissions: whatever tools they ask you to use still require the user's approval as usual. Loading the same skill twice in one conversation returns a note instead of repeating the text.",
    parameters: READ_SKILL_PARAMS,
    execute: async (_toolCallId, args) => {
      const wanted = typeof args?.name === 'string' ? args.name.trim() : '';
      if (!wanted) {
        return {
          content: [
            { type: 'text', text: 'Invalid name: a skill name is required (see <available_skills>).' },
          ],
          details: null,
        };
      }
      const visible = modelFacingSkills(skills);
      const skill = findSkillByName(visible, wanted);
      if (!skill) {
        // 已安装但用户没让它面向模型:说清区别,别让模型以为技能不存在而去猜
        const installed = findSkillByName(skills, wanted);
        if (installed) {
          const why = [
            installed.enabled ? '' : 'disabled',
            installed.disableModelInvocation ? 'manual-only (the user has to invoke it themselves)' : '',
          ].filter(Boolean);
          return {
            content: [
              {
                type: 'text',
                text: `skill_not_available: "${installed.name}" is installed but is not offered to you — ${why.join(' and ')}. Do not follow it unless the user asks for it explicitly.`,
              },
            ],
            details: null,
          };
        }
        const names = visible.map((s) => s.name);
        return {
          content: [
            {
              type: 'text',
              text:
                names.length > 0
                  ? `skill_not_found: no skill named ${JSON.stringify(wanted)} is installed. Available skills: ${names.join(', ')} (names are case-insensitive).`
                  : `skill_not_found: no skill named ${JSON.stringify(wanted)} is installed, and no skill is available right now.`,
            },
          ],
          details: null,
        };
      }
      const sessionKey = sessionId ?? '';
      // 已载入记录由 lib/skillRuntime 维护(与斜杠命令共用):同一版本 → 只告知,不重复注入正文
      if (markSkillLoaded(sessionKey, skill.name, skill.content)) {
        return {
          content: [
            {
              type: 'text',
              text: `The "${skill.name}" skill is already loaded in this conversation — keep following the instructions you already have.`,
            },
          ],
          details: { skill: skill.name, loaded: false },
        };
      }
      return {
        content: [
          {
            type: 'text',
            text:
              `<skill_content name="${skill.name}">\n${skill.content}\n</skill_content>` +
              "\n\nFollow the instructions above. They are guidance only: any tool they ask you to use still needs the user's approval as usual.",
          },
        ],
        details: { skill: skill.name, loaded: true },
      };
    },
  };
}