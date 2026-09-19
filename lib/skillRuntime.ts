/**
 * 技能运行时状态:某会话已载入过哪些技能的**哪个版本**。
 *
 * 记录内容指纹而不是布尔:技能在会话中途被编辑后旧正文已过时,必须重新注入当前版本,
 * 否则模型会继续照着被替换掉的指令行事(布尔标记看不出这一点)。
 * 面板生命周期内的模块级状态(新对话 = 新 sessionId),不参与持久化;
 * 两条激活路径(斜杠命令与 `read_skill`)共用这一份记录,避免同一会话重复注入。
 */

const loadedBySession = new Map<string, Map<string, string>>();

/** 正文指纹:长度 + 头尾片段,足以识别"这份技能正文换了" */
function contentFingerprint(content: string): string {
  return `${content.length}:${content.slice(0, 48)}:${content.slice(-48)}`;
}

/**
 * 记录某会话已载入某技能的**当前版本**;返回"此前是否已载入同一版本"。
 * 返回 true 时调用方应告知"已载入"而不是再注入一份正文。
 */
export function markSkillLoaded(sessionId: string, name: string, content: string): boolean {
  const key = sessionId || '';
  const byName = loadedBySession.get(key) ?? new Map<string, string>();
  const fingerprint = contentFingerprint(content);
  const seen = byName.get(name) === fingerprint;
  byName.set(name, fingerprint);
  loadedBySession.set(key, byName);
  return seen;
}

/** 清掉某会话的记录(转录被替换/截断时调用:旧正文已不在上下文里) */
export function clearLoadedSkills(sessionId: string): void {
  loadedBySession.delete(sessionId);
}
