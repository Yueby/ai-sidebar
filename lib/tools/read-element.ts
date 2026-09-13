import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import { toolLabel } from '../toolLabels';
import { type PickedElement, type ToolRisk } from '../types';
import { resolveElement, buildUnreadableTabError, type RefTab } from '../pageContext';
import { fetchImageForModel, captureCropForModel } from '../imageFetch';

const READ_ELEMENT_PARAMS = Type.Object({
  tabId: Type.Number({ description: 'Id of the tab containing the element (referenced tabs are annotated with tabId in the <page-refs> block of user messages)' }),
  selector: Type.Optional(
    Type.String({
      description:
        'CSS selector locating the element to read. Open shadow roots are searched as well, so selectors matching shadow content work here even though document.querySelector would not find them. Pass either selector, or role + name.',
    }),
  ),
  role: Type.Optional(
    Type.String({
      description:
        'ARIA role of the element, exactly as listed by search_element or read_page mode=tree (e.g. button, textbox, link). Use this instead of selector when the element has no stable CSS path — it resolves through the same role + name + ordinal index the action tools use.',
    }),
  ),
  name: Type.Optional(
    Type.String({
      description: 'Accessible name exactly as listed. Required together with role; use an empty string for unnamed elements.',
    }),
  ),
  ordinal: Type.Optional(
    Type.Number({
      description: 'Ordinal among elements sharing the same role and accessible name (the [2]/[3] markers), default 1.',
    }),
  ),
});

/**
 * read_element 工具定义(safe):AI 按需读取用户引用的某个标签页内任意元素的当前内容。
 * 安全边界是 tab 级白名单(tabId ∈ 引用标签页 ∪ 框选元素所在页)。
 * 双轨寻址:CSS selector(穿开放 shadow root)或 role+name+ordinal(与动作侧同一套解析)。
 * vision 门控:仅当 `canUseImage`(当前模型 input 含 image)时,元素内的图片
 * 才会被取回并以 ImageContent 块并列返回;非 vision 模型只返回图片的文字描述。
 */
export function createReadElementToolDefinition(
  refTabs: RefTab[],
  pickedElements: PickedElement[],
  canUseImage: boolean,
  dynamicTabs?: ReadonlySet<number>,
): AgentTool<typeof READ_ELEMENT_PARAMS> & { risk: ToolRisk } {
  // tab 级白名单 = 引用标签页 ∪ 框选元素所在标签页(历史上引用过元素的 tab 必可读)
  const validTabIds = new Set<number>([
    ...refTabs.map((t) => t.id),
    ...pickedElements.map((p) => p.tabId),
  ]);
  return {
    name: 'read_element',
    label: toolLabel('read_element'),
    risk: 'safe',
    description:
      "Re-read the fresh content of a picked element. Its preview is embedded in <picked-element> blocks at the point of reference in the user message; use the block's tabId and selector here when the current content is needed (the page may have changed). Any CSS selector on a referenced tab may be explored. Returns the element's outerHTML; image blocks are attached when the element contains images and the model supports them. For full-page content use read_page. An unreadable result usually means the tab was closed or navigated — do not retry the same arguments.",
    parameters: READ_ELEMENT_PARAMS,
    execute: async (_toolCallId, args) => {
      const tabId = args?.tabId;
      const selector =
        typeof args?.selector === 'string' && args.selector.trim() ? args.selector.trim() : undefined;
      const useLocator = typeof args?.role === 'string' && args.role.trim().length > 0;
      if (
        typeof tabId !== 'number' ||
        (!validTabIds.has(tabId) && !(dynamicTabs?.has(tabId) ?? false))
      ) {
        return {
          content: [
            {
              type: 'text',
              text: await buildUnreadableTabError(tabId, [...validTabIds], dynamicTabs),
            },
          ],
          details: null,
        };
      }
      if (!useLocator && !selector) {
        return {
          content: [
            { type: 'text', text: 'Invalid arguments: pass either a non-empty CSS selector, or role + name.' },
          ],
          details: null,
        };
      }
      const targetLabel = useLocator
        ? `${args?.role} ${JSON.stringify(typeof args?.name === 'string' ? args.name : '')}${
            typeof args?.ordinal === 'number' && args.ordinal > 1 ? ` [${args.ordinal}]` : ''
          }`
        : `selector: ${selector}`;
      const element = await resolveElement(tabId, {
        selector,
        locator: useLocator
          ? {
              role: args?.role as string,
              name: typeof args?.name === 'string' ? args.name : '',
              ordinal: typeof args?.ordinal === 'number' ? args.ordinal : undefined,
            }
          : undefined,
      });
      if (!element) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to read element (${targetLabel}) in tab #${tabId}: the page may have navigated, the element may no longer exist after a refresh, the role+name may not match anymore (call search_element to refresh), or the tab may have been closed. Respond accordingly.`,
            },
          ],
          details: null,
        };
      }
      const content: (TextContent | ImageContent)[] = [
        {
          type: 'text',
          text: [
            `Element <${element.tagName}> in tab #${tabId} (${targetLabel}), current content:`,
            '',
            '<element>',
            element.html,
            '</element>',
            ...(element.truncated ? ['', '(Element content truncated due to length)'] : []),
            ...(element.fingerprint
              ? ['', `Page fingerprint: ${element.fingerprint} (compare across two reads to tell whether/how the page changed).`]
              : []),
          ].join('\n'),
        },
      ];

      if (element.images.length > 0) {
        if (!canUseImage) {
          // 非 vision 模型:只给文字说明(src/alt/尺寸),不产图
          const lines = element.images.map(
            (im) =>
              `- Image (${im.naturalWidth}×${im.naturalHeight}${im.alt ? `, alt: ${im.alt}` : ''}): ${im.src}`,
          );
          content.push({
            type: 'text',
            text: `The element contains images, but the current model does not support image input. Image info only:\n${lines.join('\n')}`,
          });
        } else {
          // 取图兜底链:fetch(不受页面 CORS 限制)→ 截图裁剪(仅活动 tab)→ 文字说明
          const failed: string[] = [];
          for (const im of element.images) {
            const encoded =
              (await fetchImageForModel(im.src)) ??
              (await captureCropForModel(tabId, im.rect, element.dpr));
            if (encoded) {
              content.push({ type: 'image', data: encoded.data, mimeType: encoded.mimeType });
            } else {
              failed.push(im.src);
            }
          }
          if (failed.length > 0) {
            content.push({
              type: 'text',
              text: failed.map((s) => `[Image unavailable: ${s}]`).join('\n'),
            });
          }
        }
      }

      return { content, details: { tabId, selector } };
    },
  };
}
