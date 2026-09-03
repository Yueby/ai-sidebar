import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { PickedElement } from '../types';
import type { RefTab } from '../pageContext';
import { createReadPageToolDefinition } from './read-page';
import { createReadElementToolDefinition } from './read-element';
import { createFetchUrlToolDefinition } from './fetch-url';
import { createExecuteJsToolDefinition } from './execute-js';
import { createReadTimeToolDefinition } from './read-time';
import { createAskUserToolDefinition } from './ask-user';
import { createCompactContextToolDefinition } from './compact-context';

/**
 * 工具注册表:lib 工具的单一目录与唯一组装点(pi 一工具一文件 + 集合函数模式)。
 * runAgentTurn 只经 getTools 拿最终数组;新增工具 = 新文件 + 在此登记分组。
 * 注:数组静态类型用 AgentTool[](与 Agent 注入形状一致,厂牌工具对象自带 risk 元数据);
 * 交叉类型 AgentTool & { risk } 会触发 execute 参数的严格逆变检查,与现注入路径不等价。
 */

export interface GetToolsOptions {
  /** 引用标签页(当前草稿 ∪ 历史块;tab 级白名单来源) */
  refTabs?: RefTab[];
  /** 框选元素(并入 read_element 的 tab 白名单;仅作提示) */
  pickedElements?: PickedElement[];
  /** 当前模型支持图像输入(决定 read_element 是否产 ImageContent 块) */
  canUseImage?: boolean;
  /** compact_context 触发回调(模型申请压缩 → Agent 轮结束后由调用方执行 runCompact) */
  onCompactContext?: () => void;
}

/** 页面读取组(safe):read_page + read_element(tab 级白名单;selector 不设白名单) */
export function createPageReadTools(options: GetToolsOptions): AgentTool[] {
  const refTabs = options.refTabs ?? [];
  const pickedElements = options.pickedElements ?? [];
  const tools: AgentTool[] = [];
  if (refTabs.length > 0) tools.push(createReadPageToolDefinition(refTabs));
  if (refTabs.length > 0 || pickedElements.length > 0) {
    tools.push(
      createReadElementToolDefinition(refTabs, pickedElements, options.canUseImage ?? false),
    );
  }
  return tools;
}

/** 网页抓取组(safe):fetch_url 自主取回任意公开 URL 的正文(无需 tab 引用) */
export function createFetchTools(): AgentTool[] {
  return [createFetchUrlToolDefinition()];
}

/** 确认型工具组(confirm):execute_js 经 createGatedTool 包装,tab 句柄同 read_page 白名单 */
export function createGatedTools(options: GetToolsOptions): AgentTool[] {
  const refTabs = options.refTabs ?? [];
  return refTabs.length > 0 ? [createExecuteJsToolDefinition(refTabs)] : [];
}

/** 常驻工具组:read_time 免弹卡;ask_user 经 gate ask 路径;compact_context 模型申请压缩 */
export function createUtilityTools(onCompactContext?: () => void): AgentTool[] {
  return [
    createReadTimeToolDefinition(),
    createAskUserToolDefinition(),
    createCompactContextToolDefinition(onCompactContext ?? (() => {})),
  ];
}

/** 最终工具数组——唯一组装点(顺序:utility → read_page → read_element → fetch_url → execute_js) */
export function getTools(options: GetToolsOptions): AgentTool[] {
  return [
    ...createUtilityTools(options.onCompactContext),
    ...createPageReadTools(options),
    ...createFetchTools(),
    ...createGatedTools(options),
  ];
}
