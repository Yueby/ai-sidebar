import type { ActionLocator, PageActionResult } from '../pageContext';
import { getActiveTabMeta } from '../pageContext';

/** locator 的展示形式(与 search_element 清单行同语义) */
export function formatLocator(locator: ActionLocator): string {
  const ordinal = locator.ordinal && locator.ordinal > 1 ? ` #${locator.ordinal}` : '';
  return `${locator.role.trim().toLowerCase()} ${JSON.stringify(locator.name.trim())}${ordinal}`;
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

/** 结构化失败 → 模型可见英文文本(错误前缀族见规格 8.4) */
export function renderActionFailure(tabId: number, result: Extract<PageActionResult, { ok: false }>): string {
  const head: string = {
    not_found: `element_not_found: no element matches the locator in tab #${tabId}.`,
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

/** 动作成功结果 → 模型可见英文文本(注记逐行附后) */
export function renderActionSuccess(
  verb: string,
  locator: ActionLocator | null,
  tabId: number,
  result: Extract<PageActionResult, { ok: true }>,
): string {
  const target = locator ? `[${formatLocator(locator)}]` : 'the page';
  const lines = [`${verb} ${target} on tab #${tabId} (${result.url}).`];
  lines.push(...result.notes);
  return lines.join('\n');
}
