import type { ChatMessage } from './types';

/**
 * 会话运行时**UI 投影层**(Agent 事件 → React 快照)+ 同步发送锁 + turn 所有权守卫。
 *
 * 职责边界(决策 36 第④步重新定义):
 * - **不是执行器**:run 生命周期、转录、队列(followUp/steer)均由 pi-agent-core 的 Agent 拥有;
 * - 本类只做三件事:① 把 Agent 事件节流成可渲染快照(runs[sessionId],经 sink 同步到 store);
 *   ② 同步发送锁(防同会话双击双开);③ turn 序号守卫(旧 run 回调不得写新 run 状态);
 * - 不能整体删除:React 需要快照投影层,pi 的 Agent 只提供事件流与 state(上游 TUI 直消费事件)。
 */
export interface SessionRunSnapshot {
  /** 流式正文(节流冲刷后的最新值) */
  content: string;
  /** 流式思考 */
  thinking: string;
  /** 正在执行的工具名 */
  toolNames: string[];
  /** 用户取消标记 */
  cancelled: boolean;
  /** 已 message_end 但尚未落盘的 in-flight 消息 */
  inFlight: ChatMessage[];
}

import type { AgentEvent } from '@earendil-works/pi-agent-core';

export type SessionRunListener = (snapshot: SessionRunSnapshot) => void;

const EMPTY_SNAPSHOT: SessionRunSnapshot = {
  content: '',
  thinking: '',
  toolNames: [],
  cancelled: false,
  inFlight: [],
};

export class SessionRuntime {
  readonly sessionId: string;

  private snapshot: SessionRunSnapshot = { ...EMPTY_SNAPSHOT };
  private readonly listeners = new Set<SessionRunListener>();

  /** turn 身份守卫:同会话打断重发后旧 turn 的拆卸链失效 */
  private seq = 0;
  /** 在途请求(停止按钮按会话中止) */
  private abortCtrl: AbortController | null = null;
  /** 流式增量节流(终值不丢;token 级直推 store 会让长对话卡顿) */
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingContent = '';
  private pendingThinking = '';
  /** AI 自主压缩标记(compact_context 工具置位;轮末消费) */
  private compactRequested = false;
  /** 同步发送锁:busy 状态在首个 await 之后才置位,并发调用会双开 turn */
  private sending = false;
  /** 已释放:删除会话后迟到的续体不得再写入/重启本实例 */
  private disposed = false;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  // ── 状态订阅(React useSyncExternalStore / 命令式订阅)────────────────────

  subscribe(listener: SessionRunListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): SessionRunSnapshot {
    return this.snapshot;
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.snapshot);
    runtimeStateSink?.(this.sessionId, this.snapshot, this.isStreaming);
  }

  private patch(patch: Partial<SessionRunSnapshot>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit();
  }

  // ── pi 对齐的公开状态 ──────────────────────────────────────────────────

  /** 当前 run 的序号(事件桥接用:常驻订阅时需要知道事件属于哪一轮) */
  get currentSeq(): number {
    return this.seq;
  }

  get isStreaming(): boolean {
    return !this.disposed && this.abortCtrl !== null;
  }

  get isSending(): boolean {
    return this.sending;
  }

  get isCompactionRequested(): boolean {
    return this.compactRequested;
  }

  // ── 运行生命周期(useChatTurn 内核调用)────────────────────────────────

  /** 开始一轮 run:领取 turn 序号与 AbortSignal。
   *  已运行/已释放时抛错(对齐 pi 的并发 prompt guard:调用方必须先 abort+等 idle,不得静默覆盖) */
  beginRun(): { seq: number; signal: AbortSignal } {
    if (this.disposed) throw new Error(`session runtime ${this.sessionId} was disposed`);
    if (this.abortCtrl !== null) {
      throw new Error(`session ${this.sessionId} is already streaming; abort and wait for idle first`);
    }
    const seq = ++this.seq;
    this.abortCtrl = new AbortController();
    this.pendingContent = '';
    this.pendingThinking = '';
    this.compactRequested = false;
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    if (import.meta.env?.DEV) {
      // P0 诊断:beginRun 会把快照重置为空(含 inFlight)。若重置前 inFlight 非空且这些消息
      // 还没进 store,屏幕上就会“整轮消失、只剩刚发出的用户消息”。
      console.info(
        `[p0:run] begin ${this.sessionId} seq=${seq} 重置前 inFlight=${this.snapshot.inFlight.length} liveChars=${this.snapshot.content.length}`,
      );
    }
    this.snapshot = { ...EMPTY_SNAPSHOT };
    this.emit();
    return { seq, signal: this.abortCtrl.signal };
  }

  /** 当前 run 是否仍持有所有权(旧 run 的所有异步回调必须先校验) */
  isOwner(seq: number): boolean {
    return !this.disposed && seq === this.seq && this.abortCtrl !== null;
  }

  /** 结束一轮 run(仅所有者可拆卸);返回是否为本轮所有者 */
  endRun(seq: number): boolean {
    if (seq !== this.seq) return false;
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.abortCtrl = null;
    this.pendingContent = '';
    this.pendingThinking = '';
    if (import.meta.env?.DEV) {
      // P0 诊断:endRun 同样清空快照。正常情况下此刻 store 已含本轮全部消息(finalize 在前)。
      console.info(
        `[p0:run] end ${this.sessionId} seq=${seq} 清空前 inFlight=${this.snapshot.inFlight.length} liveChars=${this.snapshot.content.length}`,
      );
    }
    this.snapshot = { ...EMPTY_SNAPSHOT };
    this.emit();
    return true;
  }

  /** 中止在途请求(停止按钮) */
  abort(): void {
    this.abortCtrl?.abort();
  }

  /** 释放实例:置失效、中止、清队列与定时器;此后所有写入/重启被拒 */
  dispose(): void {
    this.disposed = true;
    this.abortCtrl?.abort();
    this.abortCtrl = null;
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.listeners.clear();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  // ── 流式写入(节流)────────────────────────────────────────────────────

  /** 收到 assistant message_update:攒最新值,节流冲刷到快照 */
  pushStreamDelta(seq: number, content: string, thinking: string, flushMs: number): void {
    if (!this.isOwner(seq)) return;
    this.pendingContent = content;
    this.pendingThinking = thinking;
    if (this.throttleTimer) return;
    this.throttleTimer = setTimeout(() => {
      this.throttleTimer = null;
      if (!this.isOwner(seq)) return;
      this.patch({ content: this.pendingContent, thinking: this.pendingThinking });
    }, flushMs);
  }

  /** assistant/toolResult message_end:整体入 in-flight,并清空 live 流式态(交接无闪烁) */
  pushInFlight(seq: number, message: ChatMessage): void {
    if (!this.isOwner(seq)) return;
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.pendingContent = '';
    this.pendingThinking = '';
    if (import.meta.env?.DEV) {
      // P0 诊断:live→in-flight 换手点(工具回合最频繁)。此行之后这段文本由 in-flight 那条承载,
      // 若 in-flight 因任何原因没渲染出来,屏幕上就会当场整段消失。
      console.info(
        `[p0:handoff] ${this.sessionId} role=${message.role} liveChars=${this.snapshot.content.length}→0 inFlight=${this.snapshot.inFlight.length}→${this.snapshot.inFlight.length + 1}`,
      );
    }
    this.patch({ content: '', thinking: '', inFlight: [...this.snapshot.inFlight, message] });
  }

  clearInFlight(seq: number): void {
    if (!this.isOwner(seq)) return;
    if (import.meta.env?.DEV && this.snapshot.inFlight.length > 0) {
      // P0 诊断:回合中途清空 in-flight 会让尚未落盘的回复当场消失(若 live 也为空)
      console.info(
        `[p0:clear] ${this.sessionId} inFlight ${this.snapshot.inFlight.length}→0 liveChars=${this.snapshot.content.length}`,
      );
    }
    this.patch({ inFlight: [] });
  }

  /**
   * 仅追加 in-flight、**不动 live 流式态**:用于被注入消费的 user 消息。
   * (不能用 pushInFlight——它会清空 content/thinking,steering 注入时会掉掉正在输出的助手文本)
   */
  pushUserInFlight(seq: number, message: ChatMessage): void {
    if (!this.isOwner(seq)) return;
    if (this.snapshot.inFlight.includes(message)) return;
    this.patch({ inFlight: [...this.snapshot.inFlight, message] });
  }

  addTool(seq: number, toolName: string): void {
    if (!this.isOwner(seq)) return;
    if (this.snapshot.toolNames.includes(toolName)) return;
    this.patch({ toolNames: [...this.snapshot.toolNames, toolName] });
  }

  removeTool(seq: number, toolName: string): void {
    if (!this.isOwner(seq)) return;
    this.patch({ toolNames: this.snapshot.toolNames.filter((n) => n !== toolName) });
  }

  markCancelled(seq: number): void {
    if (!this.isOwner(seq)) return;
    this.patch({ cancelled: true });
  }

  // ── 压缩标记(compact_context 工具置位;轮末由内核消费)──────────────────

  requestCompaction(seq: number): void {
    if (!this.isOwner(seq)) return;
    this.compactRequested = true;
  }

  consumeCompactionRequest(): boolean {
    const requested = this.compactRequested;
    this.compactRequested = false;
    return requested;
  }

  // ── 发送锁(同步,首个 await 之前领取)──────────────────────────────────

  tryAcquireSendLock(): boolean {
    if (this.sending) return false;
    this.sending = true;
    return true;
  }

  releaseSendLock(): void {
    this.sending = false;
  }

  // ── pi 语义队列已移入 Agent ─────────────────────────────────────────
  // followUp/steer/清空由 pi-agent-core 的 Agent 原生持有(agent.followUp/steer/clearAllQueues),
  // 本投影层不再维护队列副本(避免双源)。
}

/**
 * 会话运行时注册表:每个会话一个实例,面板生命周期内存活。
 * 切换会话 = 切换视图;实例保留,后台继续运行(与 pi 的 session 生命周期一致)。
 */
const runtimes = new Map<string, SessionRuntime>();

/**
 * 运行态出口(依赖注入):React 层把 runtime 快照同步到 store 作为渲染镜像,
 * lib 层因此不依赖 entrypoints。参数 active=false 表示该会话已无活动 run。
 */
export type RuntimeStateSink = (
  sessionId: string,
  snapshot: SessionRunSnapshot,
  active: boolean,
) => void;

let runtimeStateSink: RuntimeStateSink | null = null;

export function setRuntimeStateSink(sink: RuntimeStateSink | null): void {
  runtimeStateSink = sink;
}

export function runtimeFor(sessionId: string): SessionRuntime {
  let rt = runtimes.get(sessionId);
  if (!rt) {
    rt = new SessionRuntime(sessionId);
    runtimes.set(sessionId, rt);
  }
  return rt;
}

/** 当前有运行态或发送准备的会话(后台指示用) */
export function activeRuntimeSessionIds(): string[] {
  const ids: string[] = [];
  for (const [id, rt] of runtimes) {
    if (rt.isStreaming || rt.isSending) ids.push(id);
  }
  return ids;
}

/** 会话删除时释放实例(停止其运行并丢弃排队) */
export function disposeRuntime(sessionId: string): void {
  const rt = runtimes.get(sessionId);
  if (!rt) return;
  // 置失效后再清理:迟到的续体(isOwner=false / patch 被拒)无法再回写镜像或重启实例
  rt.dispose();
  runtimes.delete(sessionId);
  runtimeStateSink?.(sessionId, { ...EMPTY_SNAPSHOT }, false);
}

/** 只读查找:不重建实例(清理续体用,避免 dispose 后 runtimeFor 复活) */
export function existingRuntime(sessionId: string): SessionRuntime | undefined {
  return runtimes.get(sessionId);
}

/** 全量释放(恢复/导入替换全部会话数据时调用) */
export function disposeAllRuntimes(): void {
  for (const [id, rt] of runtimes) {
    rt.dispose();
    runtimeStateSink?.(id, { ...EMPTY_SNAPSHOT }, false);
  }
  runtimes.clear();
}

// ── Agent 事件桥接(常驻订阅;pi 的 AgentSession 同款做法)──────────────────

/** 流式冲刷间隔:token 级增量直推 store 会让长对话全列表重绘卡顿 */
const STREAM_FLUSH_INTERVAL_MS = 50;

/**
 * 把 pi Agent 的生命周期事件写入对应会话的 runtime。
 * 由 entrypoints 层经 agent.ts 的 setAgentEventSink 注入;
 * runtime 不存在(非面板会话)或事件属于已被接管的旧 run 时丢弃。
 */
export function bridgeAgentEvent(sessionId: string, event: AgentEvent): void {
  const rt = runtimes.get(sessionId);
  if (!rt) return;
  const seq = rt.currentSeq;
  if (event.type === 'message_update' && event.message.role === 'assistant') {
    if (!rt.isOwner(seq)) return;
    // content 形状防御:某些 provider/阶段的 message_update 可能不带数组 content,
    // 直接 .filter 会抛 TypeError 并沿事件链炸掉整轮。
    const content = Array.isArray(event.message.content) ? event.message.content : [];
    const text = content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const thinking = content
      .filter((b) => b.type === 'thinking')
      .map((b) => b.thinking)
      .join('');
    rt.pushStreamDelta(seq, text, thinking, STREAM_FLUSH_INTERVAL_MS);
  } else if (event.type === 'message_end' && event.message.role === 'assistant') {
    if (!rt.isOwner(seq)) return;
    rt.pushInFlight(seq, event.message as ChatMessage);
  } else if (event.type === 'message_end' && event.message.role === 'toolResult') {
    if (!rt.isOwner(seq)) return;
    rt.pushInFlight(seq, event.message as ChatMessage);
  } else if (event.type === 'message_end' && event.message.role === 'user') {
    // 排队 user 消息被 Agent 注入消费:展示镜像随即被移除、而它尚未进入 session.messages,
    // 若不补一个可见载体就会“凭空消失”直到 finalize 落盘(回归 G1 的最佳解释)。
    // 直发路径的 user 消息早已在 session.messages 里——由消费侧(App.displayedMessages)按对象身份去重兜住。
    if (!rt.isOwner(seq)) return;
    rt.pushUserInFlight(seq, event.message as ChatMessage);
  } else if (event.type === 'tool_execution_start') {
    if (!rt.isOwner(seq)) return;
    rt.addTool(seq, event.toolName);
  } else if (event.type === 'tool_execution_end') {
    if (!rt.isOwner(seq)) return;
    rt.removeTool(seq, event.toolName);
  }
}
