/**
 * read_element 的取图管道(sidepanel 扩展页上下文运行)。
 *
 * 主路径 fetchImageForModel:扩展页在 http/https host 权限下 fetch 图片 URL
 * 不受被引用页面的 CORS 限制;先 fetch 到 blob 再 createImageBitmap 解码
 * (顺序关键:直接 drawImage 跨域 <img> 元素会污染 canvas 导致 toDataURL 抛错,
 * 而 blob 解码不污染)。
 * 兜底路径 captureCropForModel:防盗链/403 时用 chrome.tabs.captureVisibleTab
 * 截当前活动标签页再按 rect×DPR canvas 裁剪(仅目标 tab 处于活动态可截,否则 null)。
 *
 * 编码约定对齐 pi 上游 image-resize-core.ts:≤2000×2000、JPEG q0.8 起逐级降质、
 * PNG/JPEG 取小、base64 ≤4.5MB(Anthropic 5MB 限额下留余量)、仍超则按 0.75 逐级缩维。
 * 不引任何新库,纯 canvas 手写。
 */

const MAX_DIM = 2000;
/** base64 字符数上限(pi 上游同款:4.5MB payload) */
const MAX_B64_LEN = 4.5 * 1024 * 1024;
const JPEG_QUALITIES = [0.8, 0.7, 0.55, 0.4];
/** 逐级缩维系数与下限(到下限仍超预算则放弃返回 null) */
const DIM_SHRINK = 0.75;
const MIN_DIM = 32;

/** 无 data: 前缀的 base64 图片数据 + MIME(与 pi-ai ImageContent 对接) */
export interface ModelImage {
  data: string;
  mimeType: string;
}

/** 视口 CSS 像素矩形(content.ts resolve 返回的 rect) */
export interface ImageCropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 从 data:/http(s): URL fetch 并解码为 ImageBitmap;失败 null */
async function decodeToBitmap(url: string): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size === 0) return null;
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/**
 * canvas 重绘 + 编码预算控制:
 * 每轮尺寸下产出 PNG 与各级 JPEG,取首个「预算内且最小」的;
 * 全部超预算则尺寸 ×0.75 重来,缩到下限仍超 → null。
 */
function encodeWithinBudget(source: ImageBitmap | HTMLCanvasElement): ModelImage | null {
  let width = source.width;
  let height = source.height;
  if (width <= 0 || height <= 0) return null;

  // 初始等比缩到 2000×2000 以内
  const fit = Math.min(1, MAX_DIM / width, MAX_DIM / height);
  if (fit < 1) {
    width = Math.max(1, Math.round(width * fit));
    height = Math.max(1, Math.round(height * fit));
  }

  for (;;) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, width, height);

    const candidates: ModelImage[] = [];
    const png = canvas.toDataURL('image/png');
    candidates.push({ data: png.slice(png.indexOf(',') + 1), mimeType: 'image/png' });
    for (const q of JPEG_QUALITIES) {
      const jpg = canvas.toDataURL('image/jpeg', q);
      candidates.push({ data: jpg.slice(jpg.indexOf(',') + 1), mimeType: 'image/jpeg' });
    }
    // PNG/JPEG 取小:预算内挑最小者
    const within = candidates
      .filter((c) => c.data.length <= MAX_B64_LEN)
      .sort((a, b) => a.data.length - b.data.length);
    if (within.length > 0) return within[0]!;

    if (width <= MIN_DIM || height <= MIN_DIM) return null;
    width = Math.max(MIN_DIM, Math.floor(width * DIM_SHRINK));
    height = Math.max(MIN_DIM, Math.floor(height * DIM_SHRINK));
  }
}

/**
 * 主路径:按图片 URL 取模型可用图。
 * 失败(fetch 不通/解码不了/预算内压不下)返回 null,由调用方决定兜底。
 */
/**
 * screenshot_page 主路径:captureVisibleTab 截目标 tab 所在窗口的可见区整屏。
 * 仅当该 tab 是所在窗口的活动标签才可截(浏览器限制);非活动 → inactive,任何失败 → failed。
 * 编码管线与 read_element 取图同源(≤2000²、JPEG 逐级降质、base64 预算)。
 */
export type CaptureVisibleResult =
  | { ok: true; image: ModelImage }
  | { ok: false; reason: 'inactive' | 'failed'; /** 浏览器拒绝原因原文(权限/限流等,用于精确错误提示) */
      detail?: string };

export async function captureVisibleForModel(tabId: number): Promise<CaptureVisibleResult> {
  try {
    const tab = await browser.tabs.get(tabId);
    if (typeof tab.windowId !== 'number' || tab.active !== true) return { ok: false, reason: 'inactive' };
    const shot = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const bitmap = await decodeToBitmap(shot);
    if (!bitmap) return { ok: false, reason: 'failed' };
    try {
      const image = encodeWithinBudget(bitmap);
      return image ? { ok: true, image } : { ok: false, reason: 'failed' };
    } finally {
      bitmap.close();
    }
  } catch (err) {
    // captureVisibleTab 的拒绝原因(权限要求/2次每秒限流/受保护页)全在错误消息里,透出供精确提示
    const detail = String(err).slice(0, 200);
    return { ok: false, reason: 'failed', detail };
  }
}

export async function fetchImageForModel(src: string): Promise<ModelImage | null> {
  if (!/^(https?|data):/i.test(src)) return null;
  const bitmap = await decodeToBitmap(src);
  if (!bitmap) return null;
  try {
    return encodeWithinBudget(bitmap);
  } finally {
    bitmap.close();
  }
}

/**
 * 兜底:captureVisibleTab 截目标 tab 所在窗口的可见区,按 rect×DPR 裁剪。
 * 仅当该 tab 是所在窗口的活动标签才可截;非活动/任何失败 → null。
 * (缩放/滚动误差下裁剪可能略偏,属尽力而为的兜底,可接受)
 */
export async function captureCropForModel(
  tabId: number,
  rect: ImageCropRect,
  dpr: number,
): Promise<ModelImage | null> {
  try {
    const tab = await browser.tabs.get(tabId);
    if (typeof tab.windowId !== 'number' || tab.active !== true) return null;
    const shot = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const bitmap = await decodeToBitmap(shot);
    if (!bitmap) return null;
    try {
      const scale = dpr > 0 ? dpr : 1;
      const x = Math.max(0, Math.round(rect.x * scale));
      const y = Math.max(0, Math.round(rect.y * scale));
      const w = Math.round(rect.w * scale);
      const h = Math.round(rect.h * scale);
      const cropW = Math.min(w, bitmap.width - x);
      const cropH = Math.min(h, bitmap.height - y);
      if (cropW <= 0 || cropH <= 0) return null;
      const canvas = document.createElement('canvas');
      canvas.width = cropW;
      canvas.height = cropH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, x, y, cropW, cropH, 0, 0, cropW, cropH);
      return encodeWithinBudget(canvas);
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}
