import type { ActionLocator, PageActionResult } from '../pageContext';
import { getActiveTabMeta } from '../pageContext';

/** locator 的展示形式(与 search_element 清单行同语义) */
export function formatLocator(locator: ActionLocator): string {
  const ordinal = locator.ordinal && locator.ordinal > 1 ? ` #${locator.ordinal}` : '';
  return `${locator.role.trim().toLowerCase()} ${JSON.stringify(locator.name.trim())}${ordinal}`;
}

/**
 * 动作目标:ARIA locator 或 CSS selector,二者互斥。
 * selector 用于**无 role/可访问名称**的可点元素(图片卡片、自绘按钮容器):
 * 模型能从 read_page(mode='tree') 或 read_element 看到它们,但无法用 role+name 寻址。
 */
export type ActionTarget =
  | { kind: 'locator'; locator: ActionLocator }
  | { kind: 'selector'; selector: string }
  | { kind: 'error'; message: string };

const SELECTOR_MAX = 1000;

/** 目标参数的纯解析(可单测):缺参/双给/形状不对都给出可行动的英文错误 */
export function parseActionTarget(args: unknown): ActionTarget {
  const raw = (args ?? {}) as { locator?: unknown; selector?: unknown };
  const hasLocator = raw.locator !== undefined && raw.locator !== null;
  const rawSelector = typeof raw.selector === 'string' ? raw.selector.trim() : '';
  const hasSelector = raw.selector !== undefined && raw.selector !== null;
  if (hasLocator && hasSelector) {
    return {
      kind: 'error',
      message: 'Provide either a locator (role + name) or a selector, not both.',
    };
  }
  if (!hasLocator && !hasSelector) {
    return {
      kind: 'error',
      message:
        'Provide a target: either a locator object (role + name, from search_element) or a selector string (CSS selector, for elements without an ARIA role or accessible name).',
    };
  }
  if (hasSelector) {
    if (!rawSelector) {
      return { kind: 'error', message: 'Invalid selector: a non-empty CSS selector string is required.' };
    }
    if (rawSelector.length > SELECTOR_MAX) {
      return {
        kind: 'error',
        message: `Invalid selector: it is longer than ${SELECTOR_MAX} characters. Narrow it down to the element itself.`,
      };
    }
    return { kind: 'selector', selector: rawSelector };
  }
  if (!raw.locator || typeof raw.locator !== 'object') {
    return {
      kind: 'error',
      message: 'Invalid locator: a locator object with role and name strings is required.',
    };
  }
  const x = raw.locator as Record<string, unknown>;
  if (typeof x.role !== 'string' || !x.role.trim() || typeof x.name !== 'string') {
    return {
      kind: 'error',
      message:
        'Invalid locator: role must be a non-empty string and name must be a string (use "" for an unnamed element).',
    };
  }
  return {
    kind: 'locator',
    locator: {
      role: x.role,
      name: x.name,
      ordinal: typeof x.ordinal === 'number' && x.ordinal > 0 ? Math.floor(x.ordinal) : undefined,
    },
  };
}

/** 目标的展示串(确认卡与结果文本共用;结果文本用它指明动作对象) */
export function formatActionTarget(target: Exclude<ActionTarget, { kind: 'error' }>): string {
  return target.kind === 'locator' ? formatLocator(target.locator) : JSON.stringify(target.selector);
}

/** 目标 → performPageAction 的定位参数 */
export function actionAddressing(
  target: Exclude<ActionTarget, { kind: 'error' }>,
): { locator: ActionLocator } | { selector: string } {
  return target.kind === 'locator' ? { locator: target.locator } : { selector: target.selector };
}

/**
 * 动作工具的 tab 解析:tabId 可选,缺省 = 当前聚焦标签页(决策 21 与 search_element 一致)。
 * 返回 null 表示无法确定目标(调用方返回英文错误文本)。
 */
export async function resolveActionTab(
  rawTabId: unknown,
): Promise<{ tabId: number } | { errorText: string }> {
  if (rawTabId === undefined) {
    const active = await getActiveTabMeta();
    if (!active) {
      return {
        errorText:
          'Could not determine the focused tab: the active tab is not a regular web page (http/https), or no window has an active page. Ask the user to open a web page, or pass an explicit tabId.',
      };
    }
    return { tabId: active.id };
  }
  if (typeof rawTabId === 'number' && Number.isFinite(rawTabId)) return { tabId: rawTabId };
  return {
    errorText: `Invalid tabId: ${JSON.stringify(rawTabId ?? null)}. Omit tabId to use the focused tab, or pass a numeric tab id.`,
  };
}

/** 结构化失败 → 模型可见英文文本(错误前缀族见规格 8.4)
 *  targetLabel 传入时按目标类型换措辞:selector 目标不说 "locator"(模型心里那是两条不同的路)
 */
export function renderActionFailure(
  tabId: number,
  result: Extract<PageActionResult, { ok: false }>,
  target?: Exclude<ActionTarget, { kind: 'error' }>,
): string {
  const notFound =
    target?.kind === 'selector'
      ? `element_not_found: no element matches the selector ${JSON.stringify(target.selector)} in tab #${tabId}.`
      : `element_not_found: no element matches the locator in tab #${tabId}.`;
  const head: string = {
    not_found: notFound,
    ambiguous: `ambiguous_locator (${result.matches?.length ?? 0} matches): the locator matches multiple elements in tab #${tabId}; pass an ordinal to disambiguate.`,
    option_not_found: `option_not_found: the select element has no option matching the provided value in tab #${tabId}.`,
    unsupported_element: `unsupported_element: the target element in tab #${tabId} cannot be filled by this tool (only text fields, selects, checkboxes, radios and switches are supported).`,
    invalid_value: `invalid_value: a parameter is invalid (toggles accept only "true"/"false"; scroll direction must be up, down, left or right).`,
  }[result.reason];
  const lines = [head];
  if (result.reason === 'ambiguous' && result.matches?.length) {
    lines.push(...result.matches.map((m) => `- [${m.ordinal}] <${m.tagName}> ${m.preview}`));
  }
  if (result.reason === 'option_not_found' && result.options?.length) {
    lines.push(`Available options: ${result.options.map((o) => JSON.stringify(o)).join(', ')}`);
  }
  if (result.reason === 'not_found' && result.alternatives?.length) {
    lines.push('Known targets with this role:', ...result.alternatives.map((a) => `- ${a}`));
  }
  return lines.join('\n');
}

/** 动作成功结果 → 模型可见英文文本(注记逐行附后);targetLabel 为 null 时表示作用对象是页面本身 */
export function renderActionSuccess(
  verb: string,
  targetLabel: string | null,
  tabId: number,
  result: Extract<PageActionResult, { ok: true }>,
): string {
  const target = targetLabel ? `[${targetLabel}]` : 'the page';
  const lines = [`${verb} ${target} on tab #${tabId} (${result.url}).`];
  lines.push(...result.notes);
  return lines.join('\n');
}
