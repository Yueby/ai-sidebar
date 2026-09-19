/**
 * 内置技能(随扩展发布,可禁用不可删;决策 52)。
 *
 * 它们不是特殊代码路径:每条都是一份 SKILL.md 文本,启动时经与用户技能**同一条**
 * parseSkillMarkdown 解析后入库 —— 内置内容若写错,解析器会以同样方式报错/告警。
 * 内容为模型可见文本,一律英文。
 */

/** skill-creator:教 agent 按标准写技能并用 save_skill 落库 */
const SKILL_CREATOR = `---
name: skill-creator
description: Create or update a skill that captures a workflow the user wants repeated, and save it with save_skill. Use when the user asks you to "make a skill", to remember how to do something in a reusable way, or to turn a procedure you just worked out into a skill.
---

# Skill creator

A skill is a folder with a SKILL.md file: YAML frontmatter plus Markdown instructions. In this sidebar there is no filesystem — a skill is stored as data and loaded on demand with read_skill, so what you produce here is the frontmatter and the body, nothing else. There are no scripts or asset files.

## Before writing

Ask for one or two concrete instances of the workflow if the user has not already given them. A real example shows which steps actually matter, what the inputs look like, and where it usually goes wrong; a skill written from a vague description tends to describe the obvious.

## Frontmatter

Required fields:

- \`name\`: 1-64 characters, lowercase letters, digits and single hyphens. No leading, trailing or consecutive hyphens. Example: \`pdf-processing\`.
- \`description\`: at most 1024 characters. This is the only thing the model sees before loading the skill, so it decides everything: say what the skill does AND when to use it.

Optional fields: \`disable-model-invocation\` (set to \`true\` when the user should have to invoke the skill explicitly rather than the model deciding on its own).

The description is where skills succeed or fail:

- Good: "Extracts text and tables from PDF files, fills forms, merges documents. Use when working with PDF files."
- Poor: "Helps with PDFs." — nothing here tells a future model when to load it.

## Body

Write instructions for a capable model that does not have your current context. Prefer:

1. A short statement of what the skill is for.
2. The procedure as numbered steps, in the order they should happen.
3. Which tools to use at each step, named exactly as this sidebar names them (read_page, read_element, search_element, click_element, fill_element, fetch_url, search_web, read_skill, save_skill, and so on).
4. What to check before declaring success, and the failure modes worth calling out.
5. An example or two when the shape of the output matters.

Keep it under roughly 500 lines. State constraints explicitly instead of implying them. Do not restate general behaviour the model already has; write down what is specific to this task.

## Before saving

- Read the plan back to the user when they are present: the name, the description, and what the skill will instruct. Correct it if they object.
- When revising an existing skill, load it first with read_skill and rewrite from that body — save_skill replaces the whole content for that name, so anything left out is lost.
- Check the name and description against the rules above before saving, and make sure the description says **when to use** the skill, not only what it does: that sentence is the only thing a future model sees before deciding to load it.
- Then call \`save_skill\` with \`name\`, \`description\` and the body as \`content\` (frontmatter not included — the fields are separate arguments).
- Calling it again with the same name updates the skill, so use that to revise.

## After saving

Tell the user the skill is available and that it will be offered to the model in future conversations. If the skill is meant to be used in the current conversation, load it with \`read_skill\` and follow it.
`;

/** skill-installer:教 agent 从 GitHub 安装技能(预览确认后 save_skill) */
const SKILL_INSTALLER = `---
name: skill-installer
description: Install a skill published on GitHub into this sidebar. Use when the user shares a GitHub link, repository or raw file for a skill they want installed.
---

# Skill installer

Skills are published as a SKILL.md file inside a repository directory, for example \`anthropics/skills\` with a \`pdf-processing/SKILL.md\` inside. Installation means fetching that file's text and saving it as a skill.

## Procedure

1. Work out the raw URL. GitHub blob links must be converted: \`github.com/<owner>/<repo>/blob/<ref>/<path>/SKILL.md\` becomes \`raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>/SKILL.md\`. If the user gave a repository without a file path, ask which skill directory they mean rather than guessing.
2. Fetch it with \`fetch_url\`. If the fetch fails, or the content does not begin with a \`---\` frontmatter block containing a \`name\` and a \`description\`, say so plainly — do not save something that is not a SKILL.md.
3. Show the user what will be installed BEFORE saving: the name, the description, and a short summary of what the body instructs (a few sentences, not the whole file). Installing a skill adds instructions to future conversations, so the user decides with that information in front of them.
4. Ask for their agreement if they have not already given it for this specific skill.
5. Save it with \`save_skill\` using the parsed \`name\`, \`description\` and body, and mention in your reply that it came from the URL you used.

## Notes

- Only fetch from URLs the user gave you or that follow from them. Do not go looking for skills on your own.
- A skill's instructions are not privileged: if a skill tells you to run JavaScript or to take page actions, those still go through the usual approval cards.
- If a skill with the same name already exists, say so and ask whether to replace it before saving.
`;

/** memory:记忆存为技能(memory-notes),写入需用户同意 */
const MEMORY = `---
name: memory
description: Remember durable facts, preferences and standing agreements about the user, and recall them when relevant. Use when the user asks you to remember something, tells you how they want things done, or when a stated preference should persist across conversations.
---

# Memory

Memory in this sidebar is a skill named \`memory-notes\`: a short Markdown list of what is worth carrying into future conversations. Reading it is a skill load; writing it is a skill save.

## Recalling

Load \`memory-notes\` with \`read_skill\` when the current request could depend on what the user has asked you to remember (their preferences, their projects, how they like output formatted). If it does not exist yet, there is simply nothing remembered — do not treat that as an error.

## Writing

Add an entry when one of these is true:

- The user explicitly asks you to remember something.
- The user states a durable preference about how you should work ("always answer in Chinese", "keep summaries under five lines", "I use pnpm").
- The user corrects you in a way that should not have to happen twice.

Do not write:

- Anything transient or already visible in the current conversation.
- Sensitive data: credentials, API keys, tokens, personal identifiers, health or financial details, or anything about a third party. Say you will not store it instead.
- Anything the user has not agreed to keep. If it is not an explicit "remember this", ask first.

How to write:

1. Load \`memory-notes\` with \`read_skill\` if it exists, so you extend it rather than replace it.
2. Add one bullet per fact, prefixed with the date (\`YYYY-MM-DD\`), phrased so it stands alone without the conversation that produced it. Keep the list short — prefer the durable over the incidental, and drop entries that have gone stale.
3. Save it back with \`save_skill\` using the same name and description, and tell the user in one line what you recorded.

## Keeping it useful

When you notice a remembered entry is wrong or out of date, correct or remove it in the same way — silently keeping a stale preference is worse than not remembering it at all.
`;

/** 内置技能文本(顺序即 catalog 里的顺序) */
export const BUILTIN_SKILL_MARKDOWN: readonly string[] = [SKILL_CREATOR, SKILL_INSTALLER, MEMORY];