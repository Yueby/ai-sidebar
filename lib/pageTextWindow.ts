/**
 * 长文续读的纯逻辑(可单测):窗口切分 + 续读提示文案。
 *
 * 背景:content 侧把正文截到 12000 字符(块边界),超出部分此前无法取回——
 * 真机上表现为"Cognition 那篇在公式推导处被截断,附录没读到"。
 * 这里给出 offset 窗口的唯一算法与模型可见的续读指引(模型可见文本一律英文)。
 */

export interface TextWindow {
  /** 窗口内文本(offset>0 时按换行对齐,避免从句子中段开始) */
  text: string;
  /** 本窗口在全文中的真实起始位置(对齐后) */
  start: number;
  /** 是否还有未返回的内容(offset 之前或窗口之后) */
  truncated: boolean;
  /** 该页全文长度,供上层计算下一次 offset(远超 12000 时不要指望一次读完) */
  totalLength: number;
  /** 下一次续读的 offset;无剩余时为 null */
  nextOffset: number | null;
  /** 本段之前还有内容被省略(尾窗/中段阅读时成立):应提示如何往回读 */
  omittedBefore?: boolean;
}

/** 按 offset 取窗口(段落边界对齐);offset<=0 时退化为普通头部窗口 */
export function textWindow(full: string, offset: number, limit: number): TextWindow {
  const total = full.length;
  const requested = Math.max(0, Math.min(Math.round(offset) || 0, total));
  const raw = full.slice(requested, requested + limit);
  let text = raw;
  let start = requested;
  if (requested > 0) {
    // 从整段首行可能被截断:对齐到下一个换行,避免返回半句话
    const nl = raw.indexOf('\n');
    if (nl >= 0 && nl < raw.length - 1) {
      text = raw.slice(nl + 1);
      start = requested + nl + 1;
    }
  }
  const consumed = start + text.length;
  const hasMore = consumed < total;
  return {
    text,
    start,
    truncated: requested > 0 || hasMore,
    totalLength: total,
    nextOffset: hasMore ? consumed : null,
  };
}

/**
 * 下一次续读的 offset(纯函数)。
 * 只有知道**截断前全文长度**时才能判断“还有没有后半段”——初版 H3 因为 totalLength
 * 报的是截断后长度,导致续读提示永远不出现(工具在真机上不会主动续读)。
 */
export function nextOffsetFor(
  offset: number,
  returnedLength: number,
  totalLength: number | null | undefined,
): number | null {
  if (!totalLength || totalLength <= 0) return null;
  const consumed = offset + returnedLength;
  return consumed < totalLength ? consumed : null;
}

/**
 * 模型可见的续读指引(英文)。
 * 只在确实被截断时给出,并带上可直接照用的一次调用——否则模型会像真机记录里
 * 那样自己摸索"再读一次能不能拿到后半段"。
 */
export function continuationHint(tabId: number, window: TextWindow): string {
  const head =
    `(Note: the page content above is truncated — showing characters ` +
    `${window.start}-${window.start + window.text.length} of ${window.totalLength}.)`;
  const earlier =
    window.omittedBefore || window.start > 0
      ? ` Characters before ${window.start} were omitted; pass a smaller offset (e.g. 0) to read them.`
      : '';
  if (window.nextOffset === null) return head + earlier;
  return (
    `${head}${earlier}\n` +
    `To read the rest, call read_page with the same tabId and offset: ` +
    `${JSON.stringify({ tabId, offset: window.nextOffset })} ` +
    `(offset reads forward from that character position; section is ignored when offset is set).`
  );
}

/** 抽取"过薄"的阈值(空壳页/骨架屏/加载中文案):低于它一律视为尚未渲染完 */
export const THIN_TEXT_CHARS = 200;

/** 正文是否过薄(纯判定) */
export function isThinText(text: string, threshold = THIN_TEXT_CHARS): boolean {
  return text.trim().length < threshold;
}

/**
 * 过薄结果的模型可见提示(英文)。
 * 真机实测:前端渲染页首次读取常只剩"加载中"空壳,而旧实现把它当正文返回、不给任何信号,
 * 模型只能自己猜"再等等"或误以为页面就这么点内容。这里明确给出两个可用的旋钮。
 */
export function thinResultNote(charCount: number): string {
  return (
    `(Note: only ${charCount} characters were extracted and the text looks like a loading shell. ` +
    `This page appears to be client-rendered and may not have finished. ` +
    `Call read_page again with waitStableMs (up to 15000) or waitText — waiting is skipped early ` +
    `when the page still looks empty, so a longer wait is meaningful here.)`
  );
}
