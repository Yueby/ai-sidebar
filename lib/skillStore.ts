import { storage } from 'wxt/utils/storage';
import type { Skill } from './types';
import {
  mergeBuiltinSkills,
  normalizeSkillName,
  sanitizeSkill,
  SKILL_NAME_MAX,
  validateSkillName,
  withContentBudget,
} from './skillFormat';

/**
 * 技能存储层:chrome.storage.local 的 `skills` 键,以及"读-改-写"的串行化。
 *
 * 存与 Settings 分开:技能正文可能较长,而设置每次都要整体读写。
 * 纯解析/渲染见 `lib/skillFormat.ts`;会话内的已载入状态见 `lib/skillRuntime.ts`。
 */

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

