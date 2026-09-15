import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { PickedElement, Skill, WebSearchConfig } from '../types';
import type { RefTab } from '../pageContext';
import { createReadPageToolDefinition } from './read-page';
import { createReadElementToolDefinition } from './read-element';
import { createSearchElementToolDefinition } from './search-element';
import { createSearchPageToolDefinition } from './search-page';
import { createClickElementToolDefinition } from './click-element';
import { createFillElementToolDefinition } from './fill-element';
import { createScrollPageToolDefinition } from './scroll-page';
import { createOpenPageToolDefinition } from './open-page';
import { createActivatePageToolDefinition } from './activate-page';
import { createClosePageToolDefinition } from './close-page';
import { createScreenshotPageToolDefinition } from './screenshot-page';
import { createFetchUrlToolDefinition } from './fetch-url';
import { createWebSearchToolDefinition } from './web-search';
import { isWebSearchConfigured } from '../webSearch';
import { createExecuteJsToolDefinition } from './execute-js';
import { createReadSkillToolDefinition } from './read-skill';
import { createSaveSkillToolDefinition } from './save-skill';
import { modelFacingSkills } from '../skills';
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
  /** 网络搜索源配置(设置里 provider 非 none 且字段齐备才注册 search_web;未配置传 null) */
  webSearch?: WebSearchConfig | null;
  /** agent 开启标签页的运行时注册表(read_page/read_element/execute_js execute 时实时查询;决策 27) */
  dynamicTabs?: ReadonlySet<number>;
  /** 本次运行的归属会话(门控请求按会话隔离;agent.ts 组装时注入) */
  sessionId?: string;
  /** 已安装技能(本轮读一次):catalog 与 read_skill 都取这一份;无面向模型的技能时不注册 read_skill */
  skills?: Skill[];
}

/** 页面读取组(safe):read_page + read_element(tab 级白名单;selector 不设白名单) */
export function createPageReadTools(options: GetToolsOptions): AgentTool[] {
  const refTabs = options.refTabs ?? [];
  const pickedElements = options.pickedElements ?? [];
  // read_page/read_element 无条件注册:agent 开启的 tab(动态注册表)在 execute 时实时检查可达,
  // 回合中途 open_page 开出的 tab 也即刻可读(条件注册会让读工具在 agent 场景凭空消失)
  return [
    createReadPageToolDefinition(refTabs, options.dynamicTabs),
    createReadElementToolDefinition(
      refTabs,
      pickedElements,
      options.canUseImage ?? false,
      options.dynamicTabs,
    ),
  ];
}

/** 页面发现组(safe):search_element 列交互元素清单 —— 动作支柱的 ARIA 定位发现层;
 *  寻址 = 默认 focused tab、tabId 可选(用户拍板:自动化任务可不引用页),故不设 tab 白名单、无条件注册;
 *  search_page 枚举所有 http(s) tab 并标注可读性(需 refTabs/dynamicTabs 判断) */
export function createPageDiscoveryTools(options: GetToolsOptions): AgentTool[] {
  return [
    createSearchElementToolDefinition(),
    createSearchPageToolDefinition(options.refTabs, options.dynamicTabs),
  ];
}

/** 页面动作组:click/fill(confirm + 会话级 grant,grantScope=工具@tabId)+ scroll(safe);
 *  寻址与 search_element 同源(role+name+序号),默认 focused tab、无条件注册;
 *  open/activate/close = 标签页生命周期(open: safe;activate: safe,截图与前台读取的前置;
 *  close: confirm 且仅限本 agent 开启的 tab)。
 *  screenshot_page(confirm+grant)仅 vision 模型注册(非 vision 截图不可见,不占工具面) */
export function createPageActionTools(options: GetToolsOptions): AgentTool[] {
  const tools: AgentTool[] = [
    createClickElementToolDefinition(options.sessionId),
    createFillElementToolDefinition(options.sessionId),
    createScrollPageToolDefinition(),
    createOpenPageToolDefinition(options.sessionId),
    createActivatePageToolDefinition(),
    createClosePageToolDefinition(options.sessionId),
  ];
  if (options.canUseImage) {
    tools.push(createScreenshotPageToolDefinition(options.refTabs ?? [], options.sessionId));
  }
  return tools;
}

/** 网页抓取组(safe):fetch_url 自主取回任意公开 URL 的正文(无需 tab 引用) */
export function createFetchTools(): AgentTool[] {
  return [createFetchUrlToolDefinition()];
}

/** 网络搜索组(safe):search_web,仅在设置里配置了可用搜索源时注册(未配置不占工具面);守卫判定单一来源 lib/webSearch */
export function createWebSearchTools(config: WebSearchConfig | null | undefined): AgentTool[] {
  if (!config || !isWebSearchConfigured(config)) return [];
  return [createWebSearchToolDefinition(config)];
}

/** 确认型工具组(confirm):execute_js 经 createGatedTool 包装,tab 句柄同 read_page 白名单;
 *  save_skill 同为 confirm 且不带 grantScope(写技能改变模型未来每轮的指令,与 execute_js 同待遇) */
export function createGatedTools(options: GetToolsOptions): AgentTool[] {
  // execute_js 无条件注册:同 read 组,动态注册表的 tab 在 execute 时实时检查可达
  return [
    createExecuteJsToolDefinition(options.refTabs ?? [], options.dynamicTabs, options.sessionId),
    createSaveSkillToolDefinition(options.sessionId),
  ];
}

/** 常驻工具组:read_time 免弹卡;ask_user 经 gate ask 路径;compact_context 模型申请压缩;
 *  read_skill 仅在存在面向模型的技能时注册(条件注册省 token,与 search_web 同思路) */
export function createUtilityTools(
  onCompactContext?: () => void,
  sessionId?: string,
  skills?: Skill[],
): AgentTool[] {
  const readable = modelFacingSkills(skills ?? []);
  return [
    createReadTimeToolDefinition(),
    createAskUserToolDefinition(sessionId),
    createCompactContextToolDefinition(onCompactContext ?? (() => {})),
    ...(readable.length > 0 ? [createReadSkillToolDefinition(readable, sessionId)] : []),
  ];
}

/** 最终工具数组——唯一组装点(顺序:utility → web → read → discovery → action → fetch → gated) */
export function getTools(options: GetToolsOptions): AgentTool[] {
  return [
    ...createUtilityTools(options.onCompactContext, options.sessionId, options.skills),
    ...createWebSearchTools(options.webSearch),
    ...createPageReadTools(options),
    ...createPageDiscoveryTools(options),
    ...createPageActionTools(options),
    ...createFetchTools(),
    ...createGatedTools(options),
  ];
}
