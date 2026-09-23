import type { PickedElement, SessionDraft } from './types';
// 仅类型导入(`pageContext` 会拉进浏览器 API/`#i18n`,类型层面被完全擦除,故本模块仍可在 node 里直接测)
import type { RefTab } from './pageContext';

/**
 * 网页引用的**纯决策逻辑**(引用组记忆、焦点切换、初同步资格、草稿改写)。
 *
 * 抽出来的理由:这些规则此前全部长在 `usePageContextRefs` 的 effect/async 里,
 * node 测不了,于是同一类缺陷(跨会话串味、切 tab 不跟随、新会话不入住)连续多轮靠实测才收敛。
 * 这里只做"给定输入算出新状态",不碰 store/浏览器 API/React —— hook 负责取输入与应用结果。
 *
 * 领域前提:
 * - 引用是**会话级**的:引用集与开关都在 SessionDraft 里(决策 48);
 * - 组记忆是"某会话在某 tab 上的引用工作集",必须按会话分桶(决策 49);
 * - 焦点切换即切换工作集,切走的工作集按 tab 存档,切回整组恢复(决策 26)。
 */

/** 某个 tab 上的引用工作集快照(按会话分桶存放) */
export interface RefGroupSnapshot {
  refTabs: RefTab[];
  pickedElements: PickedElement[];
}

/** 会话级组记忆:buckets.get(sessionId)?.get(tabId) */
export type RefGroupBuckets = Map<string, Map<number, RefGroupSnapshot>>;

/** 取某会话的组记忆桶(按需创建;桶内只含该会话的 tab 记忆,绝不跨会话复用) */
export function getBucket(buckets: RefGroupBuckets, sessionId: string): Map<number, RefGroupSnapshot> {
  const existing = buckets.get(sessionId);
  if (existing) return existing;
  const created = new Map<number, RefGroupSnapshot>();
  buckets.set(sessionId, created);
  return created;
}

/** 初同步是否应把当前焦点页纳入引用:只服务**全新会话**(有历史的对话保留它自己的引用集) */
export function shouldSeedCurrentPage(
  session: { messages: readonly unknown[]; draft?: SessionDraft } | null | undefined,
): boolean {
  if (!session) return false;
  if (session.messages.length > 0) return false;
  if ((session.draft?.refTabs.length ?? 0) > 0) return false;
  return true;
}

/**
 * 焦点落到 `tabId` 时草稿应有的样子;返回 null = 草稿无需变化(幂等,避免无意义渲染与落盘)。
 *
 * - 不可引用页(meta=null,如 chrome:// 新标签页):当前页引用必须消失(留着上一页的芯片
 *   等于告诉模型它还在读那一页);本 tab 导航到真实网站后会再次调用本函数并建组。
 * - 有该 tab 的组记忆:整组恢复(引用 + 框选元素)。
 * - 无组记忆:隐式「当前页」芯片入住(单例幂等)。
 */
export function decideFocusSwitch(params: {
  draft: SessionDraft;
  groups: Map<number, RefGroupSnapshot>;
  tabId: number;
  meta: RefTab | null;
}): SessionDraft | null {
  const { draft, groups, tabId, meta } = params;
  if (!meta) {
    if (draft.refTabs.length === 0 && draft.pickedElements.length === 0) return null;
    return { ...draft, refTabs: [], pickedElements: [] };
  }
  const snapshot = groups.get(tabId);
  if (snapshot) {
    if (draft.refTabs === snapshot.refTabs) return null; // 已是该组:幂等跳过
    return { ...draft, refTabs: snapshot.refTabs, pickedElements: snapshot.pickedElements };
  }
  if (draft.refTabs.length === 1 && draft.refTabs[0]?.id === tabId) return null; // 已是该单例
  return { ...draft, refTabs: [meta], pickedElements: [] };
}

/**
 * 工作集变化时要写入快照的 tab 集合:引用组内所有成员 + **草稿已反映的焦点 tab**。
 *
 * 焦点 tab 必须同时满足两点,否则会把别处的工作集记到本轮会话头上:
 * 1. 取「草稿已反映」的那个(而非最新焦点请求):切换尚未落地时二者不一致,
 *    用后者会把上一个页面的工作集记到刚切过去的 tab 头上,导致之后切到该 tab 不跟随;
 * 2. **所属会话必须与目标会话一致**:会话 A 的归属状态(P)不能把会话 B 的引用集
 *    记到 B/P 名下 —— 否则 B 里切到 P 会恢复出 B 的旧引用集,而不是给无记忆的 P 入住。
 */
export function groupSnapshotTargets(
  refTabs: RefTab[],
  applied: { sessionId: string; tabId: number } | null,
  targetSessionId: string,
): Set<number> {
  const ids = new Set(refTabs.map((t) => t.id));
  if (applied && applied.sessionId === targetSessionId) ids.add(applied.tabId);
  return ids;
}

/** 添加引用:去重;顺手开启本会话的网页引用(删最后一个芯片关掉的只是那个会话) */
export function addRefTabToDraft(draft: SessionDraft, tab: RefTab): SessionDraft {
  if (draft.refTabs.some((t) => t.id === tab.id)) {
    return draft.pageContextEnabled === false ? { ...draft, pageContextEnabled: true } : draft;
  }
  return { ...draft, refTabs: [...draft.refTabs, tab], pageContextEnabled: true };
}

/**
 * 移除引用:该 tab 连同其上的框选元素一起移除;
 * 删掉最后一个引用 = 关闭**本会话**的网页引用(决策 48,其它会话与新会话不受影响)。
 */
export function removeRefTabFromDraft(draft: SessionDraft, tabId: number): SessionDraft {
  const refTabs = draft.refTabs.filter((t) => t.id !== tabId);
  return {
    ...draft,
    refTabs,
    pickedElements: draft.pickedElements.filter((p) => p.tabId !== tabId),
    ...(refTabs.length === 0 ? { pageContextEnabled: false } : {}),
  };
}

/**
 * 直接发送后的草稿:消费掉输入与框选元素,**保留引用集与会话引用开关**。
 * 引用集跨消息存活(决策 13 修订);开关是本会话用户的选择,绝不能因一次发送就复位成"开"。
 */
export function draftAfterSend(draft: SessionDraft): SessionDraft {
  return { ...draft, input: '', pickedElements: [] };
}

/**
 * 下一个元素标记号:取现有元素与草稿文本内已有块标记号的最大值 +1(防撞号);
 * 文本内块计入,故页面刷新/编辑器重建后继续递增。
 */
export function nextElementId(draft: SessionDraft): number {
  return (
    Math.max(
      0,
      ...draft.pickedElements.map((p) =>
        typeof p.elementId === 'number' && p.elementId > 0 ? p.elementId : 0,
      ),
      ...Array.from(draft.input.matchAll(/elementId="(\d+)"/g), (m) => parseInt(m[1]!, 10)),
    ) + 1
  );
}

/**
 * 检查草稿是否为空(既无未发文本输入,也无网页引用与框选元素)。
 * 用于新建/复用会话决策:技能创作等入口要求目标会话是干净的,不能冲掉用户正在写的草稿或引用的网页。
 */
export function isBlankDraft(draft?: SessionDraft | null): boolean {
  if (!draft) return true;
  if (typeof draft.input === 'string' && draft.input.trim().length > 0) return false;
  if (Array.isArray(draft.refTabs) && draft.refTabs.length > 0) return false;
  if (Array.isArray(draft.pickedElements) && draft.pickedElements.length > 0) return false;
  return true;
}

/**
 * 检查会话是否可作为空闲空会话复用。
 *
 * @param session 当前会话对象
 * @param options.requireBlankDraft 是否要求草稿也是纯白板(技能创作传 true;常规 handleNewSession 传 false/undefined)
 * @param options.hasPendingWork 是否存在未完成的后台任务(排队消息、运行态、准备中、门控)
 */
export function isSessionReusable(
  session: { messages: readonly unknown[]; draft?: SessionDraft } | null | undefined,
  options?: { requireBlankDraft?: boolean; hasPendingWork?: boolean },
): boolean {
  if (!session) return false;
  if (session.messages.length > 0) return false;
  if (options?.hasPendingWork) return false;
  if (options?.requireBlankDraft && !isBlankDraft(session.draft)) return false;
  return true;
}

export interface PlanSessionTargetParams {
  currentSession: {
    id: string;
    messages: readonly unknown[];
    draft?: SessionDraft;
  } | null;
  hasPendingWork?: boolean;
  options?: {
    requireBlankDraft?: boolean;
    initialInput?: string;
  };
}

export type PlannedSessionTarget =
  | {
      action: 'reuse';
      targetId: string;
      draftPatch: { input: string } | null;
    }
  | {
      action: 'create';
      initialDraft: SessionDraft | undefined;
    };

/**
 * 纯决策函数:为会话新建/技能创作入口规划目标会话(复用现有空闲会话还是新建)。
 *
 * 契约:
 * ① 老会话保留:当前会话有历史消息，或 (requireBlankDraft 为 true 时) 草稿有未发输入/页面引用/框选元素，必须新建，绝不冲掉老会话。
 * ② 空闲复用:当前会话无消息、无后台任务、草稿满足白板要求，直接复用当前会话。
 * ③ 忙会话新建:当前会话虽无消息但有后台任务(排队/运行/门控)，必须新建，不把用户留在忙碌会话中。
 * ④ 异步目标锁定:若提供 initialInput，无论复用还是新建，目标会话在异步保存前就已确定其草稿载荷。
 */
export function planSessionTarget(params: PlanSessionTargetParams): PlannedSessionTarget {
  const { currentSession, hasPendingWork = false, options } = params;

  const reusable = isSessionReusable(currentSession, {
    requireBlankDraft: options?.requireBlankDraft,
    hasPendingWork,
  });

  if (reusable && currentSession) {
    return {
      action: 'reuse',
      targetId: currentSession.id,
      draftPatch: options?.initialInput !== undefined ? { input: options.initialInput } : null,
    };
  }

  return {
    action: 'create',
    initialDraft: options?.initialInput !== undefined
      ? { input: options.initialInput, refTabs: [], pickedElements: [] }
      : undefined,
  };
}

export interface SessionCreationStoreAdapter<TSession extends { id: string; messages: readonly unknown[]; draft?: SessionDraft } = any> {
  getSessions: () => TSession[];
  getActiveSessionId: () => string | null;
  setSessions: (sessions: TSession[]) => void;
  setActiveSessionId: (id: string) => void;
  patchDraftOf: (id: string, patch: (d: SessionDraft) => SessionDraft) => void;
  dropPendingDraftSave: (id: string) => void;
  flushDraftSaves: () => void;
  createSession: (initialDraft?: SessionDraft) => TSession;
  saveSession: (session: TSession) => Promise<void>;
  setActiveSessionIdStorage: (id: string) => Promise<void>;
  hasPendingWork?: (sessionId: string) => boolean;
}

/**
 * 校验目标会话在异步操作后是否仍具备继续导航资格:
 * 必须会话仍在列表中,且当前激活会话仍与目标一致。
 * 若用户在异步期间已切换至其它会话或目标被删,则不得触发界面切回或重绘。
 */
export function shouldNavigateToSkillSession(params: {
  targetSessionId: string | null | undefined;
  activeSessionId: string | null | undefined;
  sessions: Array<{ id: string }>;
}): boolean {
  const { targetSessionId, activeSessionId, sessions } = params;
  if (!targetSessionId) return false;
  if (activeSessionId !== targetSessionId) return false;
  return sessions.some((s) => s.id === targetSessionId);
}

/**
 * 异步会话创建与落盘编排核心(与 React 解耦,可完整受控测试)。
 *
 * 契约:
 * 1. 同步目标草稿锁定:在首个 await 前同步写入 initialInput / 生成带 draft 的 session;
 * 2. 存储回写防踩踏:若 await saveSession 期间 activeSessionId 已变,不向 storage 回写旧目标 ID;
 * 3. 失败回滚保护:saveSession 失败时,仅在用户仍停留在失败目标、且其间未产生消息或后台工作时才回滚剔除;若用户已切走,绝不抢夺切走后的 active ID;
 * 4. 清理待写草稿:失败时 dropPendingDraftSave,防防抖定时器复活该会话。
 */
export async function executeSessionCreation<TSession extends { id: string; messages: readonly unknown[]; draft?: SessionDraft }>(
  adapter: SessionCreationStoreAdapter<TSession>,
  options?: { requireBlankDraft?: boolean; initialInput?: string },
): Promise<string> {
  const currentId = adapter.getActiveSessionId();
  const sessions = adapter.getSessions();
  const cur = currentId ? sessions.find((s) => s.id === currentId) ?? null : null;

  const hasWork = cur ? (adapter.hasPendingWork ? adapter.hasPendingWork(cur.id) : false) : false;

  const plan = planSessionTarget({
    currentSession: cur,
    hasPendingWork: hasWork,
    options,
  });

  if (plan.action === 'reuse') {
    if (plan.draftPatch) {
      adapter.patchDraftOf(plan.targetId, (d) => ({
        ...d,
        ...plan.draftPatch,
      }));
    }
    return plan.targetId;
  }

  adapter.flushDraftSaves();

  const newSess = adapter.createSession(plan.initialDraft);
  const next = [newSess, ...adapter.getSessions()];
  adapter.setSessions(next);
  adapter.setActiveSessionId(newSess.id);

  try {
    await adapter.saveSession(newSess);
  } catch (err) {
    adapter.dropPendingDraftSave(newSess.id);
    const stNowSessions = adapter.getSessions();
    const latestSess = stNowSessions.find((s) => s.id === newSess.id);
    const hasWorkNow =
      !!latestSess &&
      (latestSess.messages.length > 0 ||
        (adapter.hasPendingWork ? adapter.hasPendingWork(newSess.id) : false));

    if (!hasWorkNow) {
      const rollbackSessions = stNowSessions.filter((s) => s.id !== newSess.id);
      adapter.setSessions(rollbackSessions);
      // 仅当前激活会话仍在失败目标时，且旧目标仍存在才恢复
      if (adapter.getActiveSessionId() === newSess.id) {
        const curStillExists = cur && rollbackSessions.some((s) => s.id === cur.id);
        if (curStillExists) {
          adapter.setActiveSessionId(cur.id);
        } else if (rollbackSessions.length > 0) {
          adapter.setActiveSessionId(rollbackSessions[0]!.id);
        }
      }
    }
    throw err;
  }

  // 避免较新切换被回写
  if (adapter.getActiveSessionId() === newSess.id) {
    await adapter.setActiveSessionIdStorage(newSess.id);
  }
  return newSess.id;
}
