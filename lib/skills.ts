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

/**
 * 把不合规的名字规范化到标准形状:小写、非字母数字转 `-`、去首尾与连续连字符、截到上限。
 * 用于**外部导入** —— 别人仓库里的 `PDF_Processing` 不该因为我们的严格保存策略而装不进来。
 * 规范化后为空串 = 这个名字救不回来(调用方报错)。
 */
export function normalizeSkillName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .slice(0, SKILL_NAME_MAX)
    .replace(/-+$/, '');
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

/** 块标量起始标记(`>` 折叠 / `|` 保留换行,含 `-`/`+` 修饰);其后缩进行属于它的值 */
const BLOCK_SCALAR = /^[>|][-+]?$/;

/**
 * 解析 frontmatter 的顶层字段。
 *
 * 缩进敏感:缩进行的键值属于**嵌套映射**(如 `metadata:` 的子键),绝不参与顶层收集 —— 否则
 * `metadata:` 里写一个 `disable-model-invocation: false` 就能把顶层的 true 覆盖掉。
 * 块标量(`description: >` / `|`)按 YAML 语义收敛:缩进行拼成值,`>` 折空格、`|` 保留换行。
 *
 * 兼容性:值里未加引号却含冒号(`description: Use this when: ...`)按 YAML 是非法的,但其它客户端的
 * 解析器接受它 —— 只取**第一个**冒号作分隔符即可原样保留整行剩余部分,并记一条告警。
 */
function parseFrontmatterFields(front: string, diagnostics: string[]): Map<string, string> {
  const fields = new Map<string, string>();
  let block: { key: string; folded: boolean; lines: string[] } | null = null;
  const flushBlock = (): void => {
    if (!block) return;
    const { key, folded, lines } = block;
    block = null;
    if (!KNOWN_FIELDS.has(key)) return;
    const joined = folded ? lines.join(' ').replace(/\s+/g, ' ').trim() : lines.join('\n').trim();
    if (joined) fields.set(key, joined);
  };

  for (const line of front.split('\n')) {
    // 块标量内的空行保留(段落分隔),但不要在它上面收尾
    if (block && !line.trim()) {
      block.lines.push('');
      continue;
    }
    if (/^\s/.test(line)) {
      // 缩进行:块标量的内容,或嵌套映射的键值(后者忽略,不参与顶层)
      if (block) block.lines.push(line.trim());
      continue;
    }
    flushBlock();
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const sep = trimmed.indexOf(':');
    if (sep <= 0) {
      diagnostics.push(`ignored a frontmatter line without a key: ${trimmed.slice(0, 40)}`);
      continue;
    }
    const key = trimmed.slice(0, sep).trim().toLowerCase();
    const rawValue = trimmed.slice(sep + 1).trim();
    if (BLOCK_SCALAR.test(rawValue)) {
      block = { key, folded: rawValue.startsWith('>'), lines: [] };
      continue;
    }
    let value = rawValue;
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
  flushBlock();
  return fields;
}

/**
 * 解析 SKILL.md:frontmatter 取 name/description(可选 disable-model-invocation),其余为正文。
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

  const fields = parseFrontmatterFields(front, diagnostics);
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
    content: withContentBudget(content),
    disableModelInvocation: (fields.get('disable-model-invocation') ?? '').toLowerCase() === 'true',
    diagnostics,
  };
}

/**
 * 正文预算的**唯一收尾函数**(幂等):超限则截到 `MAX` 再附英文截断提示,已带提示的不重复追加。
 *
 * 解析、保存、清洗三处必须共用:只在解析处加的提示会在读回时被清洗的 `slice` 抹掉,
 * 而模型看不出自己拿到的指令被切过 —— 截断必须在正文里留痕。
 */
export function withContentBudget(content: string): string {
  const note = `\n\n…(the rest of this skill's instructions was truncated at ${SKILL_CONTENT_MAX} characters)`;
  const marked = content.endsWith(note);
  const body = marked ? content.slice(0, -note.length) : content;
  if (body.length <= SKILL_CONTENT_MAX) return marked ? content : body;
  return `${body.slice(0, SKILL_CONTENT_MAX)}${note}`;
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
    content: withContentBudget(content),
    source,
    enabled: x.enabled !== false,
    createdAt: typeof x.createdAt === 'number' && Number.isFinite(x.createdAt) ? x.createdAt : Date.now(),
    ...(x.disableModelInvocation === true ? { disableModelInvocation: true } : {}),
  };
}

const skillsItem = storage.defineItem<unknown[]>('local:skills', { fallback: [] });

type SkillWriteResult = { ok: true } | { ok: false; error: string };

async function writeSkills(skills: Skill[]): Promise<SkillWriteResult> {
  try {
    await skillsItem.setValue(skills);
    return { ok: true };
  } catch (err) {
    // 存储写失败(配额/受限上下文)必须说出来:静默吞掉会让调用方以为已经保存
    return {
      ok: false,
      error: `Could not save skills: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 写入串行化:技能列表是"读-改-写"整体,两个写者并发(模型 save_skill 与设置页的开关/删除)
 * 会各自基于同一份旧列表写回,后写的把先写的抹掉。变更一律排进同一条链,链内重新读取最新状态。
 */
let skillWriteQueue: Promise<unknown> = Promise.resolve();
function serializeSkillWrite<T>(work: () => Promise<T>): Promise<T> {
  const run = skillWriteQueue.then(work, work);
  skillWriteQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
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

/** 全部技能(读取 → 清洗 → 合并内置)。
 *
 * 读**永不写盘**:合并只在内存生效(内置正文随代码刷新,每次读重新合并),写盘会绕过
 * serializeSkillWrite 并与并发的 save/setEnabled 相撞。
 * 已知残留:两个浏览器窗口各自持有一份模块级队列 —— 跨上下文的并发变更仍是
 * "后写覆盖先写"(chrome.storage 无 CAS)。单窗口内已避免,不再做跨上下文锁。
 */
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
  // 读**永不写盘**:合并只在内存生效(内置正文随代码刷新,每次读都会重新合并)。
  // 这里写盘会绕过 serializeSkillWrite,与并发的 save/setEnabled 相撞并把它们的更新抹掉
  // (实测:两次并发 saveSkill 后只剩内置技能)。下一次变更会把当前状态整体写下去。
  return merged.skills;
}

export interface SaveSkillInput {
  name: string;
  description: string;
  content: string;
  /** 安装来源(github)与用户手写(user);内置不可写 */
  source?: 'user' | 'github';
  /**
   * 标准字段:true = 不进模型 catalog,只允许用户 `/skill:<name>` 手动唤起。
   * 不传表示"不动这个字段"(编辑既有技能时保留原值)。
   */
  disableModelInvocation?: boolean;
  /**
   * 外部导入(安装)专用:名字不合标准时**规范化后保存**而不是拒绝。
   * 手写/编辑走严格校验(用户当场能改),别人的仓库没法要求他改名。
   */
  allowNonStandardName?: boolean;
}

/** 保存(按名字 upsert):内置技能不可被覆盖(它随代码升级,改写会被冲掉) */
export async function saveSkill(
  input: SaveSkillInput,
): Promise<
  | { ok: true; skill: Skill; renamedFrom?: string; bodyTruncated?: boolean }
  | { ok: false; error: string }
> {
  const requestedName = input.name.trim();
  const description = input.description.trim();
  const content = input.content.trim();
  if (!requestedName) return { ok: false, error: 'Invalid skill: a non-empty name is required.' };
  if (!description) {
    return {
      ok: false,
      error:
        'Invalid skill: a non-empty description is required — it is the only thing the model sees when deciding whether to load the skill.',
    };
  }
  if (!content) return { ok: false, error: 'Invalid skill: the instruction body must not be empty.' };
  // 外部导入:名字规范化到合法形状(小写/连字符);规范化后为空 = 这个名字救不回来
  let name = requestedName;
  let renamedFrom: string | undefined;
  if (input.allowNonStandardName && validateSkillName(requestedName).length > 0) {
    const normalized = normalizeSkillName(requestedName);
    if (!normalized) {
      return {
        ok: false,
        error: `Invalid skill name: ${JSON.stringify(
          requestedName,
        )} cannot be turned into a usable name (lowercase letters, digits and hyphens).`,
      };
    }
    name = normalized;
    renamedFrom = requestedName;
  }
  const issues = validateSkillName(name);
  if (issues.length > 0) {
    return {
      ok: false,
      error: `Invalid skill name: ${issues.join('; ')}. Use 1-${SKILL_NAME_MAX} lowercase letters, digits and single hyphens.`,
    };
  }
  return serializeSkillWrite(async () => {
    const existing = await listSkills();
    const current = existing.find((skill) => skill.name.toLowerCase() === name.toLowerCase());
    if (current?.source === 'builtin') {
      return {
        ok: false,
        error: `"${current.name}" is a built-in skill and cannot be overwritten. Save it under a different name, or disable the built-in one with a name of your own.`,
      };
    }
    // 正文超限:截断 + 在正文里留痕(不静默、不拒绝) —— 与解析/清洗共用同一条收尾
    const budgeted = withContentBudget(content);
    const bodyTruncated = budgeted !== content;
    const base = current
      ? { ...current, name, description, content: budgeted }
      : {
          id: `skill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          name,
          description,
          content: budgeted,
          source: input.source ?? 'user',
          enabled: true,
          createdAt: Date.now(),
        };
    // disable-model-invocation:只有调用方明确给出时才动(编辑既有技能时保留原值)
    const skill: Skill = { ...base };
    if (input.disableModelInvocation === true) skill.disableModelInvocation = true;
    else if (input.disableModelInvocation === false) delete skill.disableModelInvocation;
    const next = current ? existing.map((s) => (s.id === current.id ? skill : s)) : [...existing, skill];
    const wrote = await writeSkills(next);
    if (!wrote.ok) return { ok: false, error: wrote.error };
    return {
      ok: true,
      skill,
      ...(renamedFrom ? { renamedFrom } : {}),
      ...(bodyTruncated ? { bodyTruncated: true } : {}),
    };
  });
}

/** 删除:内置技能只能禁用(随扩展发布,删掉下次启动还会回来) */
export async function deleteSkill(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return serializeSkillWrite(async () => {
    const existing = await listSkills();
    const target = existing.find((skill) => skill.id === id);
    if (!target) return { ok: false, error: `No skill with id ${JSON.stringify(id)}.` };
    if (target.source === 'builtin') {
      return {
        ok: false,
        error: `"${target.name}" is a built-in skill and cannot be deleted — disable it instead.`,
      };
    }
    return writeSkills(existing.filter((skill) => skill.id !== id));
  });
}

/** 启用/禁用(对内置技能同样有效,且升级时保留) */
export async function setSkillEnabled(
  id: string,
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return serializeSkillWrite(async () => {
    const existing = await listSkills();
    const target = existing.find((skill) => skill.id === id);
    if (!target) return { ok: false, error: `No skill with id ${JSON.stringify(id)}.` };
    return writeSkills(existing.map((skill) => (skill.id === id ? { ...skill, enabled } : skill)));
  });
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