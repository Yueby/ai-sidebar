import { i18n } from '#i18n';

/**
 * 极简 WebDAV 客户端(备份同步用):Basic 认证 + PUT/GET/PROPFIND/MKCOL。
 * 兼容坚果云等国内服务(无 OAuth、无 CORS 问题——扩展宿主发起的请求不受页面同源限制)。
 * 所有网络错误转用户可见文本(中文,经 i18n);超时有界(20s),不挂死 UI。
 */

export interface WebdavConfig {
  url: string;
  username: string;
  password: string;
}

/** 规范化:base 去尾斜杠 + 远端路径去头斜杠与 `..`/`.` 段(防路径穿越),拼接成完整 URL */
export function joinDavUrl(base: string, remotePath: string): string {
  const segments = remotePath
    .replace(/^\/+/, '')
    .split('/')
    .filter((s) => s.length > 0 && s !== '.' && s !== '..');
  return `${base.replace(/\/+$/, '')}/${segments.join('/')}`;
}

/** UTF-8 安全的 Basic 认证头(btoa 对非 Latin1 字符直接抛异常,中文密码必触发) */
function authHeader(cfg: WebdavConfig): string {
  const bytes = new TextEncoder().encode(`${cfg.username}:${cfg.password}`);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `Basic ${btoa(binary)}`;
}

function isHttpError(status: number): string | null {
  if (status === 401) return i18n.t('sync.error.auth');
  if (status === 403) return i18n.t('sync.error.forbidden');
  if (status === 507) return i18n.t('sync.error.quota');
  return null;
}

/** 带 20s 超时与统一错误转换的 fetch;ok=false 时抛出可行动错误文本 */
async function davFetch(
  cfg: WebdavConfig,
  path: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const url = joinDavUrl(cfg.url, path);
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: authHeader(cfg),
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(init.timeoutMs ?? 20000),
  });
  const errText = isHttpError(res.status);
  if (errText) throw new Error(errText);
  return res;
}

/** 解析配置;空地址/凭证返回错误文本(调用方 toast) */
export function validateConfig(cfg: WebdavConfig): string | null {
  if (!cfg.url.trim() || !/^https?:\/\//i.test(cfg.url)) return i18n.t('sync.error.needUrl');
  if (!cfg.username.trim() || !cfg.password) return i18n.t('sync.error.needCredentials');
  return null;
}

/** 连接测试:PROPFIND Depth:0 于 base 集合(会校验认证);207/200 = 成功 */
export async function webdavProbe(cfg: WebdavConfig): Promise<{ ok: boolean; error?: string }> {
  const invalid = validateConfig(cfg);
  if (invalid) return { ok: false, error: invalid };
  try {
    const res = await davFetch(cfg, '', {
      method: 'PROPFIND',
      headers: { Depth: '0' },
      timeoutMs: 15000,
    });
    if (res.status === 207 || res.ok) return { ok: true };
    return { ok: false, error: i18n.t('sync.error.http', { status: res.status }) };
  } catch (err) {
    return { ok: false, error: errorToText(err) };
  }
}

/** 逐级创建远端集合(已存在时 MKCOL 返回 405/301,忽略) */
async function mkdirP(cfg: WebdavConfig, remotePath: string): Promise<void> {
  const segments = remotePath
    .split('/')
    .filter((s) => s.length > 0 && s !== '.' && s !== '..')
    .slice(0, -1);
  let prefix = '';
  for (const seg of segments) {
    prefix = `${prefix}/${seg}`;
    try {
      await davFetch(cfg, prefix, { method: 'MKCOL' });
    } catch {
      /* 已存在(405)/重定向(301):集合已就绪,忽略 */
    }
  }
}

/** 上传二进制;父目录不存在时自动逐级创建 */
export async function webdavPut(
  cfg: WebdavConfig,
  remotePath: string,
  data: Uint8Array,
): Promise<void> {
  await mkdirP(cfg, remotePath);
  // PUT 响应必须校验:409/5xx/423 等失败若当成功,用户以为有备份、换机才发现没有(隐性数据丢失)
  const res = await davFetch(cfg, remotePath, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Blob([data as BlobPart], { type: 'application/octet-stream' }),
  });
  if (!res.ok) throw new Error(i18n.t('sync.error.http', { status: res.status }));
}

/** 下载二进制;远端不存在返回 null,其余错误抛出文本 */
export async function webdavGet(
  cfg: WebdavConfig,
  remotePath: string,
): Promise<Uint8Array | null> {
  const res = await davFetch(cfg, remotePath, { method: 'GET' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(i18n.t('sync.error.http', { status: res.status }));
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

function errorToText(err: unknown): string {
  if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return i18n.t('sync.error.timeout');
  }
  // fetch 网络层失败(TypeError: Failed to fetch)给友好文案,不透传浏览器原文
  if (err instanceof TypeError) return i18n.t('sync.error.network');
  if (err instanceof Error && err.message) return err.message;
  return i18n.t('sync.error.network');
}
