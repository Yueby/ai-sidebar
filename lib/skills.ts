import { storage } from 'wxt/utils/storage';
import type { Skill } from './types';
import { BUILTIN_SKILL_MARKDOWN } from './builtinSkills';

/**
 * 技能:纯逻辑(SKILL.md 解析/校验/catalog 渲染,可单测)+ 存储读写(chrome.storage.local 的 `skills` 键)。
 *
 * 存与 Settings 分开:技能正文可能较长,而设置每次都要整体读写。
 * 校验遵循 Agent Skills 标准的**宽松**要求:名字不合规只告警仍载入,description 缺失才拒绝
 * (没有它 catalog 无法工作,模型也不知道何时该用这个技能)。
 */

export const SKILL_NAME_MAX = 64;
export const SKILL_DESCRIPTION_MAX = 1024;
/** 正文上限:存储与注入的硬边界(标准建议单个技能正文 < 5000 tokens) */
export const SKILL_CONTENT_MAX = 100_000;

/** frontmatter 里我们认的字段;其余按标准忽略(未知字段是合法的) */
const KNOWN_FIELDS = new Set(['name', 'description', 'disable-model-invocation']);

/** 名字合规问题清单(空数组 = 合规);不合规不拒绝载入,只作为告警 */
export function validateSkillName(name: string): string[] {
  const issues: string[] = [];
  if (!name) {
    issues.push('name is empty');
    return issues;
  }
  if (name.length > SKILL_NAME_MAX) issues.push(`name is longer than ${SKILL_NAME_MAX} characters`);
  if (!/^[a-z0-9-]+$/.test(name)) issues.push('name may only contain lowercase letters, digits and hyphens');
  if (name.startsWith('-') || name.endsWith('-')) issues.push('name must not start or end with a hyphen');
  if (name.includes('--')) issues.push('name must not contain consecutive hyphens');
  return issues;
}

export type SkillParseResult =
  | {
      ok: true;
      name: string;
      description: string;
      content: string;
      disableModelInvocation: boolean;
      /** 宽松校验的告警(载入成功但值得让调用方知道的偏差) */
      diagnostics: string[];
    }
  | { ok: false; reason: string };

/**
 * 解析 SKILL.md:frontmatter 取 name/description(可选 disable-model-invocation),其余为正文。
 *
 * 兼容性:值里未加引号却含冒号(`description: Use this when: the user asks about PDFs`)按 YAML 是非法的,
 * 但其它客户端的解析器接受它 —— 只取**第一个**冒号作分隔符即可原样保留整行剩余部分,并记一条告警。
 */
export function parseSkillMarkdown(raw: string): SkillParseResult {
  const text = (raw ?? '').replace(/\r\n?/g, '\n');
  const diagnostics: string[] = [];
  // frontmatter 必须自文件首行开始
  const firstBreak = text.indexOf('\n');
  if (firstBreak < 0 || text.slice(0, firstBreak).trim() !== '---') {
    return { ok: false, reason: 'frontmatter-missing' };
  }
  const close = text.indexOf('\n---', firstBreak);
  if (close < 0) return { ok: false, reason: 'frontmatter-unterminated' };
  const front = text.slice(firstBreak + 1, close);
  const content = text.slice(close + 4).replace(/^\n+/, '').trimEnd();

  const fields = new Map<string, string>();
  for (const line of front.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const sep = trimmed.indexOf(':');
    if (sep <= 0) {
      diagnostics.push(`ignored a frontmatter line without a key: ${trimmed.slice(0, 40)}`);
      continue;
    }
    const key = trimmed.slice(0, sep).trim().toLowerCase();
    let value = trimmed.slice(sep + 1).trim();
    const quoted =
      value.length > 1 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")));
    if (quoted) value = value.slice(1, -1);
    else if (value.includes(':')) {
      diagnostics.push(`value of "${key}" contains an unquoted colon; the whole remainder was taken as the value`);
    }
    if (!KNOWN_FIELDS.has(key)) continue;
    fields.set(key, value.trim());
  }

  const name = fields.get('name') ?? '';
  const description = fields.get('description') ?? '';
  if (!description) return { ok: false, reason: 'description-required' };
  if (!name) return { ok: false, reason: 'name-required' };
  for (const issue of validateSkillName(name)) {
    diagnostics.push(`${issue} (loaded anyway: the standard is applied leniently here)`);
  }
  if (description.length > SKILL_DESCRIPTION_MAX) {
    diagnostics.push(`description is longer than ${SKILL_DESCRIPTION_MAX} characters and was truncated`);
  }
  if (content.length > SKILL_CONTENT_MAX) {
    diagnostics.push(`body is longer than ${SKILL_CONTENT_MAX} characters and was truncated`);
  }
  return {
    ok: true,
    name,
    description: description.slice(0, SKILL_DESCRIPTION_MAX),
    content: content.slice(0, SKILL_CONTENT_MAX),
    disableModelInvocation: (fields.get('disable-model-invocation') ?? '').toLowerCase() === 'true',
    diagnostics,
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 模型可见的技能目录(catalog,渐进披露第一层);没有可展示的技能时返回空串(调用方据此整层省略) */
export function renderSkillsCatalog(skills: readonly Skill[]): string {
  const visible = skills.filter(
    (skill) => skill.enabled && !skill.disableModelInvocation && skill.name && skill.description.trim(),
  );
  if (visible.length === 0) return '';
  const lines = ['<available_skills>'];
  for (const skill of visible) {
    lines.push('  <skill>');
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push('  </skill>');
  }
  lines.push('</available_skills>');
  return lines.join('\n');
}

/** 存储里的条目 → Skill(坏条目返回 null 由调用方丢弃) */
export function sanitizeSkill(raw: unknown): Skill | null {
  if (!raw || typeof raw !== 'object') return null;
  const x = raw as Record<string, unknown>;
  const name = typeof x.name === 'string' ? x.name.trim() : '';
  const description = typeof x.description === 'string' ? x.description.trim() : '';
  const content = typeof x.content === 'string' ? x.content : '';
  if (!name || !description || !content.trim()) return null;
  const source = x.source === 'builtin' || x.source === 'github' ? x.source : 'user';
  return {
    id: typeof x.id === 'string' && x.id ? x.id : name,
    name,
    description: description.slice(0, SKILL_DESCRIPTION_MAX),
    content: content.slice(0, SKILL_CONTENT_MAX),
    source,
    enabled: x.enabled !== false,
    createdAt: typeof x.createdAt === 'number' && Number.isFinite(x.createdAt) ? x.createdAt : Date.now(),
    ...(x.disableModelInvocation === true ? { disableModelInvocation: true } : {}),
  };
}

const skillsItem = storage.defineItem<unknown[]>('local:skills', { fallback: [] });

async function writeSkills(skills: Skill[]): Promise<void> {
  await skillsItem.setValue(skills);
}

/**
 * 内置技能合并(纯函数):按 id 匹配合并,用户对内置技能的启用状态保留;
 * 同名用户/安装技能**优先**(内置不覆盖它,只告警);内置正文随代码升级刷新。
 */
export function mergeBuiltinSkills(existing: Skill[]): { skills: Skill[]; changed: boolean } {
  const out = [...existing];
  let changed = false;
  for (const markdown of BUILTIN_SKILL_MARKDOWN) {
    const parsed = parseSkillMarkdown(markdown);
    if (!parsed.ok) continue; // 内置内容写错:构建期就该发现,这里只是不炸
    const id = `builtin:${parsed.name}`;
    const current = out.find((skill) => skill.name.toLowerCase() === parsed.name.toLowerCase());
    if (!current) {
      out.push({
        id,
        name: parsed.name,
        description: parsed.description,
        content: parsed.content,
        source: 'builtin',
        enabled: true,
        createdAt: Date.now(),
        ...(parsed.disableModelInvocation ? { disableModelInvocation: true } : {}),
      });
      changed = true;
      continue;
    }
    if (current.source !== 'builtin' || current.id !== id) {
      // 同名技能由用户/安装而来:它优先,内置缺席
      // 注:lib 模块不加 import.meta.env.DEV 守卫(node 测试里它不存在),与 sessionRecord 同惯例
      console.warn(`[skills] built-in "${parsed.name}" is shadowed by another skill of the same name`);
      continue;
    }
    if (current.content !== parsed.content || current.description !== parsed.description) {
      const idx = out.findIndex((skill) => skill.id === id);
      out[idx] = { ...current, description: parsed.description, content: parsed.content };
      changed = true;
    }
  }
  return { skills: out, changed };
}

/** 全部技能(读取 → 清洗 → 合并内置);内置变更会顺带落盘 */
export async function listSkills(): Promise<Skill[]> {
  const stored = await skillsItem.getValue().catch(() => [] as unknown[]);
  const skills: Skill[] = [];
  let dropped = 0;
  for (const entry of Array.isArray(stored) ? stored : []) {
    const skill = sanitizeSkill(entry);
    if (!skill) {
      dropped += 1;
      continue;
    }
    if (skills.some((s) => s.name.toLowerCase() === skill.name.toLowerCase())) {
      dropped += 1; // 同名条目:先到先得(存储由我们单写,重复即异常)
      continue;
    }
    skills.push(skill);
  }
  if (dropped > 0) {
    console.warn(`[skills] dropped ${dropped} invalid or duplicate stored skill entr(ies)`);
  }
  const merged = mergeBuiltinSkills(skills);
  if (merged.changed) await writeSkills(merged.skills).catch(() => undefined);
  return merged.skills;
}

export interface SaveSkillInput {
  name: string;
  description: string;
  content: string;
  /** 安装来源(github)与用户手写(user);内置不可写 */
  source?: 'user' | 'github';
}

/** 保存(按名字 upsert):内置技能不可被覆盖(它随代码升级,改写会被冲掉) */
export async function saveSkill(
  input: SaveSkillInput,
): Promise<{ ok: true; skill: Skill } | { ok: false; error: string }> {
  const name = input.name.trim();
  const description = input.description.trim();
  const content = input.content.trim();
  if (!name) return { ok: false, error: 'Invalid skill: a non-empty name is required.' };
  if (!description) {
    return {
      ok: false,
      error:
        'Invalid skill: a non-empty description is required — it is the only thing the model sees when deciding whether to load the skill.',
    };
  }
  if (!content) return { ok: false, error: 'Invalid skill: the instruction body must not be empty.' };
  const issues = validateSkillName(name);
  if (issues.length > 0) {
    return {
      ok: false,
      error: `Invalid skill name: ${issues.join('; ')}. Use 1-${SKILL_NAME_MAX} lowercase letters, digits and single hyphens.`,
    };
  }
  const existing = await listSkills();
  const current = existing.find((skill) => skill.name.toLowerCase() === name.toLowerCase());
  if (current?.source === 'builtin') {
    return {
      ok: false,
      error: `"${current.name}" is a built-in skill and cannot be overwritten. Save it under a different name, or disable the built-in one with a name of your own.`,
    };
  }
  const skill: Skill = current
    ? { ...current, name, description, content }
    : {
        id: `skill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        description,
        content,
        source: input.source ?? 'user',
        enabled: true,
        createdAt: Date.now(),
      };
  const next = current ? existing.map((s) => (s.id === current.id ? skill : s)) : [...existing, skill];
  await writeSkills(next);
  return { ok: true, skill };
}

/** 删除:内置技能只能禁用(随扩展发布,删掉下次启动还会回来) */
export async function deleteSkill(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await listSkills();
  const target = existing.find((skill) => skill.id === id);
  if (!target) return { ok: false, error: `No skill with id ${JSON.stringify(id)}.` };
  if (target.source === 'builtin') {
    return {
      ok: false,
      error: `"${target.name}" is a built-in skill and cannot be deleted — disable it instead.`,
    };
  }
  await writeSkills(existing.filter((skill) => skill.id !== id));
  return { ok: true };
}

/** 启用/禁用(对内置技能同样有效,且升级时保留) */
export async function setSkillEnabled(
  id: string,
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await listSkills();
  const target = existing.find((skill) => skill.id === id);
  if (!target) return { ok: false, error: `No skill with id ${JSON.stringify(id)}.` };
  await writeSkills(existing.map((skill) => (skill.id === id ? { ...skill, enabled } : skill)));
  return { ok: true };
}

/** 模型可自行载入的技能集(= catalog 可见集):禁用与"仅手动唤起"都不在其中 */
export function modelFacingSkills(skills: readonly Skill[]): Skill[] {
  return skills.filter((skill) => skill.enabled && !skill.disableModelInvocation);
}

/** 按名字查(大小写不敏感) */
export function findSkillByName(skills: readonly Skill[], name: string): Skill | undefined {
  const wanted = name.trim().toLowerCase();
  return skills.find((skill) => skill.name.toLowerCase() === wanted);
}