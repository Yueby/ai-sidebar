import type { ChatMessage } from './types';

/**
 * 会话运行时(对齐 pi-coding-agent 的 AgentSession 设计,client 版)。
 *
 * 每个会话一个实例,持有该会话的全部运行状态:turn 身份序号、在途请求、
 * 流式节流、压缩请求标记、发送锁、steering/followUp 队列。
 * 实例由模块级注册表按 sessionId 持有——切换会话只是切换视图,实例继续在后台运行。
 *
 * 并发语义(与 pi 一致):
 * - 同一会话同时只允许一个 run(重复 prompt 由调用方按 streamingBehavior 处理);
 * - steer = 打断当前轮并注入消息(停止按钮/打断语义);
 * - followUp = 排队,当前轮结束后按 FIFO 发送;
 * - pendingMessageCount = 两种队列之和。
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
  /** followUp 队列(排队等当前轮结束;pi 语义) */
  private followUps: string[] = [];
  /** steering 队列(pi 语义:当前 assistant turn 结束后注入,不 abort 在途请求) */
  private steering: string[] = [];
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

  get pendingMessageCount(): number {
    return this.followUps.length + this.steering.length;
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
    this.followUps = [];
    this.steering = [];
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
    this.patch({ content: '', thinking: '', inFlight: [...this.snapshot.inFlight, message] });
  }

  clearInFlight(seq: number): void {
    if (!this.isOwner(seq)) return;
    this.patch({ inFlight: [] });
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

  // ── pi 语义队列(steer = 打断注入;followUp = 排队等待)─────────────────

  /** 排队一条 followUp(当前轮结束后按 FIFO 发送) */
  followUp(text: string): void {
    this.followUps.push(text);
  }

  /** 入队一条 steering(调用方负责中止当前轮后立即消费) */
  steer(text: string): void {
    this.steering.push(text);
  }

  /** 取出下一条待发送消息(steering 优先于 followUp;pi 语义) */
  shiftPending(): string | undefined {
    return this.steering.shift() ?? this.followUps.shift();
  }

  /** 丢弃全部排队消息(会话删除等) */
  clearPending(): void {
    this.followUps = [];
    this.steering = [];
  }
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

/** 当前有运行态或排队消息的会话(后台指示用) */
export function activeRuntimeSessionIds(): string[] {
  const ids: string[] = [];
  for (const [id, rt] of runtimes) {
    if (rt.isStreaming || rt.isSending || rt.pendingMessageCount > 0) ids.push(id);
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
    const text = event.message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const thinking = event.message.content
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
  } else if (event.type === 'tool_execution_start') {
    if (!rt.isOwner(seq)) return;
    rt.addTool(seq, event.toolName);
  } else if (event.type === 'tool_execution_end') {
    if (!rt.isOwner(seq)) return;
    rt.removeTool(seq, event.toolName);
  }
}
