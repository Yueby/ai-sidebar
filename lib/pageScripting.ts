/**
 * execute_js 的脚本注入原语。
 *
 * 主路线 `chrome.userScripts.execute()`(Chrome 135+,manifest 需 userScripts 权限):
 * js:[{code}] 直传任意字符串,返回 InjectionResult[](result/error 互斥,脚本返回
 * Promise 会等 settle);world 支持 'USER_SCRIPT'(默认,豁免页面 CSP 的隔离环境)
 * 与 'MAIN'。Chrome 138+ 要求用户在扩展详情页开启一次 "Allow User Scripts" 开关,
 * 未开启时 chrome.userScripts 缺失(或 getScripts() 调用 throw)。
 *
 * 兜底路线(仅当 userScripts 不可用):`scripting.executeScript` MAIN world +
 * func 包装(eval 执行 code)。严格 CSP 站点会失败,失败时返回可行动的英文错误文本。
 *
 * Model-facing 文本一律英文;一切错误转文本返回,不 throw 给调用方。
 */

/** 结果上限(与 read_element 截断同一量级,防大对象刷爆上下文) */
const RESULT_LIMIT = 8000;

/** userScripts.execute 的注入结果(result/error 互斥) */
interface UserScriptsInjectionResult {
  result?: string;
  error?: string;
}

/** chrome.userScripts 命名空间(类型层未声明,@wxt-dev/browser 类型未含 userScripts) */
interface UserScriptsApi {
  getScripts(): unknown;
  execute(details: {
    target: { tabId: number };
    js: { code: string }[];
    world: 'USER_SCRIPT' | 'MAIN';
  }): Promise<UserScriptsInjectionResult[]>;
}

function getUserScripts(): UserScriptsApi | null {
  const api = (browser as unknown as { userScripts?: Partial<UserScriptsApi> }).userScripts;
  return api && typeof api.getScripts === 'function' && typeof api.execute === 'function'
    ? (api as UserScriptsApi)
    : null;
}

/**
 * userScripts 是否可用:命名空间存在 + getScripts() 探测不 throw
 * (Chrome 138+ 未开 Allow User Scripts 时命名空间缺失;部分版本调用即 throw)。
 */
export function isUserScriptsAvailable(): boolean {
  try {
    const api = getUserScripts();
    if (!api) return false;
    void api.getScripts();
    return true;
  } catch {
    return false;
  }
}

export type PageScriptWorld = 'user_script' | 'main';

export type PageScriptResult =
  | { ok: true; result: string }
  | { ok: false; error: string };

/** 结果序列化:JSON 优先,循环引用等 stringify 失败回退 String() */
function stringifyResult(value: unknown): string {
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function truncateResult(text: string): string {
  if (text.length <= RESULT_LIMIT) return text;
  return `${text.slice(0, RESULT_LIMIT)}\n(Result truncated: showing first ${RESULT_LIMIT} of ${text.length} characters)`;
}

/** 一切错误转英文文本(不 throw 给调用方) */
function errorToText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

/** userScripts 与兜底全部不可用时的可行动错误文本 */
function unavailableError(reason: string): string {
  return [
    'Failed to execute script: the userScripts API is unavailable, and the scripting fallback failed.',
    `Reason: ${reason}.`,
    "The page's Content Security Policy may block extension scripts in the MAIN world, or 'Allow User Scripts' is not enabled.",
    "Ask the user to open the extension details page (chrome://extensions) and enable 'Allow User Scripts' for this extension (required on Chrome 138+; on Chrome 120-137 the equivalent is enabling Developer mode on that page), then retry.",
  ].join(' ');
}

/**
 * 在指定标签页执行任意 JS 并返回结果文本。
 * 主路线 userScripts.execute(按 world 直传);userScripts 不可用时降级
 * scripting.executeScript MAIN world(无论请求的 world,兜底只能 MAIN),
 * 并在返回文本里注明降级;降级也失败时返回可行动的错误文本。
 */
export async function executePageScript(
  tabId: number,
  code: string,
  world: PageScriptWorld,
): Promise<PageScriptResult> {
  const userScripts = getUserScripts();
  if (userScripts) {
    try {
      const results = await userScripts.execute({
        target: { tabId },
        js: [{ code }],
        world: world === 'main' ? 'MAIN' : 'USER_SCRIPT',
      });
      const first = results?.[0];
      if (first?.error) {
        return { ok: false, error: `Script error in tab #${tabId}: ${first.error}` };
      }
      return { ok: true, result: truncateResult(stringifyResult(first?.result)) };
    } catch (err) {
      return { ok: false, error: `Failed to execute script in tab #${tabId}: ${errorToText(err)}` };
    }
  }

  // 兜底:scripting.executeScript MAIN world(func 序列化后在页面求值,args 只传字符串)
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (userCode: string): unknown => (0, eval)(userCode),
      args: [code],
    });
    const first = results?.[0];
    return {
      ok: true,
      result: [
        '(Note: the userScripts API was unavailable, so the script ran via the scripting fallback in the MAIN world regardless of the requested world.)',
        '',
        truncateResult(stringifyResult(first?.result)),
      ].join('\n'),
    };
  } catch (err) {
    return { ok: false, error: unavailableError(errorToText(err)) };
  }
}
