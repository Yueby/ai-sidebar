import type { Session, SessionDraft } from '@/lib/types';
import { saveSession } from '@/lib/sessionStore';

/** 空草稿(每次新建对象,避免共享可变引用) */
export const cloneEmptyDraft = (): SessionDraft => ({
  input: '',
  refTabs: [],
  pickedElements: [],
});
export const EMPTY_DRAFT: SessionDraft = { input: '', refTabs: [], pickedElements: [] };

/** 草稿持久化防抖窗口(ms):逐键输入只进内存,合并写 IndexedDB */
const DRAFT_SAVE_DEBOUNCE_MS = 400;

// ── 草稿防抖队列(模块级;StrictMode 双挂载幂等:drain 即清、定时器重启式覆盖)──
const pendingDraftSaves = new Map<string, Session>();
let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;

/** 立即落盘所有待写草稿(五处边界调用:切换/新建/删除/发送/卸载) */
export function flushDraftSaves(): void {
  if (draftSaveTimer) {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
  }
  if (pendingDraftSaves.size === 0) return;
  const pending = new Map(pendingDraftSaves);
  pendingDraftSaves.clear();
  for (const s of pending.values()) {
    void saveSession(s).catch(() => {});
  }
}

/** 摘除某会话的待发草稿(删除会话/发送清空草稿前,防复活) */
export function dropPendingDraftSave(id: string): void {
  pendingDraftSaves.delete(id);
}

/** 清空全部待落盘草稿(WebDAV 恢复前调用:防 400ms 窗口内的旧会话对象回滚已恢复数据) */
export function clearPendingDraftSaves(): void {
	pendingDraftSaves.clear();
	if (draftSaveTimer != null) {
		clearTimeout(draftSaveTimer);
		draftSaveTimer = null;
	}
}

export interface SessionSlice {
  sessions: Session[];
  activeSessionId: string | null;
  loaded: boolean;
  setSessions: (sessions: Session[]) => void;
  setActiveSessionId: (id: string | null) => void;
  setLoaded: (loaded: boolean) => void;
  /** 提交会话数组变更并把涉及会话的最新对象放入防抖写盘队列(风险①:set 先于入队,顺序不可换) */
  commitSessions: (next: Session[], changedIds: string[]) => void;
  patchDraftOf: (sessionId: string, mutator: (d: SessionDraft) => SessionDraft) => void;
  patchActiveDraft: (mutator: (d: SessionDraft) => SessionDraft) => void;
}

type SliceSet = (
  partial: Partial<SessionSlice> | ((state: SessionSlice) => Partial<SessionSlice>),
) => void;
type SliceGet = () => SessionSlice;

/** 当前活动会话(渲染 selector 与命令代码 getState() 共用) */
export function selectCurrentSession(state: {
  sessions: Session[];
  activeSessionId: string | null;
}): Session | null {
  return state.sessions.find((s) => s.id === state.activeSessionId) ?? state.sessions[0] ?? null;
}

export function createSessionSlice(set: SliceSet, get: SliceGet): SessionSlice {
  return {
    sessions: [],
    activeSessionId: null,
    loaded: false,

    setSessions: (sessions) => set({ sessions }),
    setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
    setLoaded: (loaded) => set({ loaded }),

    commitSessions: (next, changedIds) => {
      // 风险①:先 set 后入队(渲染一致性依赖同步可见)
      set({ sessions: next });
      for (const id of changedIds) {
        const s = next.find((x) => x.id === id);
        if (s) pendingDraftSaves.set(id, s);
      }
      if (draftSaveTimer) clearTimeout(draftSaveTimer);
      draftSaveTimer = setTimeout(flushDraftSaves, DRAFT_SAVE_DEBOUNCE_MS);
    },

    patchDraftOf: (sessionId, mutator) => {
      const prev = get().sessions;
      const idx = prev.findIndex((s) => s.id === sessionId);
      if (idx < 0) return;
      const session = prev[idx]!;
      const nextDraft = mutator(session.draft ?? cloneEmptyDraft());
      if (nextDraft === session.draft) return; // 无变化:不渲染不落盘
      const next = [...prev];
      next[idx] = { ...session, draft: nextDraft };
      get().commitSessions(next, [sessionId]);
    },

    patchActiveDraft: (mutator) => {
      const id = get().activeSessionId;
      if (id) get().patchDraftOf(id, mutator);
    },
  };
}
