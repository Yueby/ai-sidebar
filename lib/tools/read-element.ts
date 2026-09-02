import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import { toolLabel, type PickedElement, type ToolRisk } from '../types';
import { resolveElement, type RefTab } from '../pageContext';
import { fetchImageForModel, captureCropForModel } from '../imageFetch';

const READ_ELEMENT_PARAMS = Type.Object({
  tabId: Type.Number({ description: 'Id of the tab containing the element (referenced tabs are annotated with tabId in the <page-refs> block of user messages)' }),
  selector: Type.String({ description: 'Any CSS selector locating the element to read within the referenced page' }),
});

/**
 * read_element 工具定义(safe):AI 按需读取用户引用的某个标签页内任意元素的当前内容。
 * 安全边界是 tab 级白名单(tabId ∈ 引用标签页 ∪ 框选元素所在页);selector 不限制——
 * 框选元素只是提示,AI 可在引用页内自行探索其他元素(content.ts 的 resolve 直接 querySelector)。
 * vision 门控:仅当 `canUseImage`(当前模型 input 含 image)时,元素内的图片
 * 才会被取回并以 ImageContent 块并列返回;非 vision 模型只返回图片的文字描述。
 */
export function createReadElementToolDefinition(
  refTabs: RefTab[],
  pickedElements: PickedElement[],
  canUseImage: boolean,
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
      const selector = args?.selector;
      if (typeof tabId !== 'number' || !validTabIds.has(tabId)) {
        return {
          content: [
            {
              type: 'text',
              text: `Invalid tabId: ${JSON.stringify(tabId ?? null)}. Readable tabs: ${
                [...validTabIds].map((id) => `#${id}`).join(', ') || '(none)'
              }.`,
            },
          ],
          details: null,
        };
      }
      if (typeof selector !== 'string' || selector.length === 0) {
        return {
          content: [
            { type: 'text', text: 'Invalid selector: a non-empty CSS selector string is required.' },
          ],
          details: null,
        };
      }
      const element = await resolveElement(tabId, selector);
      if (!element) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to read element \`${selector}\` in tab #${tabId}: the page may have navigated, the element may no longer exist after a refresh, or the tab may have been closed. Respond accordingly.`,
            },
          ],
          details: null,
        };
      }
      const content: (TextContent | ImageContent)[] = [
        {
          type: 'text',
          text: [
            `Element <${element.tagName}> in tab #${tabId} (selector: \`${selector}\`), current content:`,
            '',
            '<element>',
            element.html,
            '</element>',
            ...(element.truncated ? ['', '(Element content truncated due to length)'] : []),
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
