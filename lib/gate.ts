import type { AgentTool, AgentToolUpdateCallback } from '@earendil-works/pi-agent-core';
import { toolLabel, type ToolRisk } from './types';

/**
 * 工具门控契约:UI 确认卡(confirm)与向用户提问(ask)的统一通道。
 * App(侧)经 setGateHandler 注册处理器;未注册期间所有门控请求以 deny/cancelled
 * 快速返回(安全默认,工具在无 UI 时可静默降级)。模型可见文本一律英文。
 */
export type GateRequest =
  | {
      kind: 'confirm';
      toolName: string;
      label: string;
      summary: string;
      detail?: string;
      toolCallId?: string;
      /** 会话级 grant:传了 grantScope 才允许用户勾“本会话内允许此类操作” */
      grantable?: boolean;
      /** grant 免确认范围键(如 `click_element@12`,工具+tab 粒度;由调用方在解析出真实目标后计算) */
      grantScope?: string;
    }
  | {
      kind: 'ask';
      question: string;
      options?: string[];
      toolCallId?: string;
    };

export type GateResponse =
  | { kind: 'confirm'; approved: boolean; /** 用户勾了会话级 grant(UI 侧应只在 grantable 时提供) */ grant?: boolean }
  | { kind: 'ask'; answer: string; cancelled?: boolean };

export type GateHandler = (req: GateRequest) => Promise<GateResponse>;

let activeHandler: GateHandler | null = null;

/**
 * 会话级 grant 记录(工具+tab 粒度,如 `click_element@12`)。
 * 模块级 Set 存活于侧边栏 JS 上下文:面板关闭即整体失效(拍板语义,无需持久化)。
 */
const grantedScopes = new Set<string>();

interface PendingGate {
  req: GateRequest;
  resolve: (res: GateResponse) => void;
}
const pending = new Set<PendingGate>();

/** 门控的否定应答:confirm → deny,ask → cancelled(安全默认) */
function denyResponse(req: GateRequest): GateResponse {
  return req.kind === 'confirm'
    ? { kind: 'confirm', approved: false }
    : { kind: 'ask', answer: '', cancelled: true };
}

/** App 注册 UI 门控处理器;传 null 注销 */
export function setGateHandler(handler: GateHandler | null): void {
  activeHandler = handler;
}

/** 冲销所有 pending 门控请求(confirm→deny,ask→cancelled)。App 在停止/中止生成时调用 */
export function flushPendingGates(): void {
  for (const entry of pending) {
    entry.resolve(denyResponse(entry.req));
  }
  pending.clear();
}

/**
 * 发起门控请求并等待 UI 应答(挂起 agent 工具循环属预期行为,无超时)。
 * handler 未注册或执行抛异常 → 按 deny/cancelled 快速返回。
 * 会话级 grant:命中已记录 scope 时直接 approved(不弹卡、不经 handler);
 * 应答携带 grant 时记录 scope,供同类后续调用短路。
 */
export function requestGate(req: GateRequest): Promise<GateResponse> {
  if (req.kind === 'confirm') {
    const scope = req.grantScope;
    if (scope && grantedScopes.has(scope)) {
      return Promise.resolve({ kind: 'confirm', approved: true });
    }
  }
  const h = activeHandler;
  if (!h) return Promise.resolve(denyResponse(req));
  return new Promise<GateResponse>((resolve) => {
    const entry: PendingGate = { req, resolve };
    pending.add(entry);
    h(req)
      .then((res) => {
        const scope = req.kind === 'confirm' ? req.grantScope : undefined;
        if (res.kind === 'confirm' && res.grant && scope) grantedScopes.add(scope);
        resolve(res);
      })
      .catch(() => resolve(denyResponse(req)))
      .finally(() => pending.delete(entry));
  });
}

/**
 * confirm 路径包装:执行前发 confirm 门控,approved 才执行原工具;
 * denied/未注册 → 返回英文拒绝文本(作为正常 tool result,模型可继续)。
 * detail 默认静态串;传 detailFromArgs 可按本次调用参数动态生成
 * (如 execute_js 预览待执行代码),返回空串时回退静态 detail。
 */
export function createGatedTool<T extends { name: string }>(
  tool: T,
  summary: string,
  detail?: string,
  detailFromArgs?: (args: unknown) => string,
): T & { risk: ToolRisk } {
  const base = tool as unknown as AgentTool;
  return {
    ...tool,
    risk: 'confirm',
    execute: async (
      toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback,
    ) => {
      const res = await requestGate({
        kind: 'confirm',
        toolName: base.name,
        label: toolLabel(base.name),
        summary,
        detail: (detailFromArgs?.(params) ?? detail) || undefined,
        toolCallId,
      });
      if (!(res.kind === 'confirm' && res.approved)) {
        return {
          content: [{ type: 'text', text: 'User denied permission to run this tool.' }],
          // 结构化拒绝标志(UI 用它替代文本嗅探;历史消息无此标志仍走嗅探兜底)
          details: { denied: true },
        };
      }
      return base.execute(toolCallId, params, signal, onUpdate);
    },
  } as T & { risk: ToolRisk };
}
