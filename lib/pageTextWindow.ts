/**
 * 长文续读的纯逻辑(可单测):窗口切分 + 续读提示文案。
 *
 * content 侧把正文按块边界截到 12000 字符;本模块给出 offset 窗口的唯一算法与模型可见的
 * 续读指引(模型可见文本一律英文),使长文能跨多次调用读完。
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
 * 模型可见的续读指引(英文)。
 * 只在确实被截断时给出,并带上可直接照用的一次调用,避免模型自己摸索
 * "再读一次能不能拿到后半段"。
 */
export function continuationHint(tabId: number, window: Omit<TextWindow, 'nextOffset'>): string {
  // 续读 offset 只在这里算一次(与 textWindow 同一规则):调用方无需自己推,避免两份实现漂移
  const consumed = window.start + window.text.length;
  const nextOffset = consumed < window.totalLength ? consumed : null;
  const head =
    `(Note: the page content above is truncated — showing characters ` +
    `${window.start}-${window.start + window.text.length} of ${window.totalLength}.)`;
  const earlier =
    window.omittedBefore || window.start > 0
      ? ` Characters before ${window.start} were omitted; pass a smaller offset (e.g. 0) to read them.`
      : '';
  if (nextOffset === null) return head + earlier;
  return (
    `${head}${earlier}\n` +
    `To read the rest, call read_page with the same tabId and offset: ` +
    `${JSON.stringify({ tabId, offset: nextOffset })} ` +
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
 * 过薄结果(典型是前端渲染页的"加载中"空壳)必须显式告知模型这不是正文,
 * 并给出两个可用的旋钮,否则模型只能自己猜或误以为页面就这么点内容。
 */
export function thinResultNote(charCount: number): string {
  return (
    `(Note: only ${charCount} characters were extracted. This page may be client-rendered and not ` +
    `finished yet, or it may genuinely be this short — do not assume the text above is incomplete. ` +
    `If you expected more content, call read_page again with waitStableMs (up to 15000) or waitText; ` +
    `waiting is skipped early while the page still looks empty, so a longer wait is meaningful.)`
  );
}
