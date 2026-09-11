import { i18n } from '#i18n';
import type { ModelConfig, ProviderConfig } from './types';
import { normalizeBaseUrl } from './providers';

/** 拉取端点可用模型 ID 列表(openai 兼容与 anthropic 两种鉴权) */
export async function fetchProviderModels(
  p: Pick<ProviderConfig, 'api' | 'baseUrl' | 'apiKey'>,
  signal?: AbortSignal,
): Promise<string[]> {
  const base = normalizeBaseUrl(p.api, p.baseUrl);
  // openai SDK 路径不含 /v1(/models);anthropic SDK 路径自带 /v1(/v1/models)
  const modelsPath = p.api === 'anthropic-messages' ? '/v1/models' : '/models';
  const headers: Record<string, string> =
    p.api === 'anthropic-messages'
      ? { 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01' }
      : p.apiKey
        ? { Authorization: `Bearer ${p.apiKey}` }
        : {};
  const res = await fetch(`${base}${modelsPath}`, { headers, signal });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      // 无响应体
    }
    throw new Error(`${i18n.t('errors.modelsFetchFailed', { status: res.status })}${detail ? `: ${detail}` : ''}`);
  }
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  return (json.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/** models.dev 模型元数据(api.json 免费无鉴权) */
export interface ModelMeta {
  /** models.dev 官方显示名,可作 displayName 预填 */
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  tools?: boolean;
  vision?: boolean;
  reasoning?: boolean;
}

interface ModelsDevModel {
  name?: string;
  reasoning?: boolean;
  tool_call?: boolean;
  modalities?: { input?: string[] };
  limit?: { context?: number; output?: number };
}

export async function fetchModelsDevMeta(signal?: AbortSignal): Promise<Map<string, ModelMeta>> {
  const map = new Map<string, ModelMeta>();
  try {
    const res = await fetch('https://models.dev/api.json', { signal });
    if (!res.ok) return map;
    const json = (await res.json()) as Record<string, { models?: Record<string, ModelsDevModel> }>;
    for (const provider of Object.values(json)) {
      for (const [id, m] of Object.entries(provider.models ?? {})) {
        if (map.has(id)) continue;
        map.set(id, {
          name: m.name,
          contextWindow: m.limit?.context,
          maxTokens: m.limit?.output,
          tools: m.tool_call || undefined,
          vision: m.modalities?.input?.includes('image') || undefined,
          reasoning: m.reasoning || undefined,
        });
      }
    }
  } catch {
    // 预填失败不阻塞导入,返回空表
  }
  return map;
}

/** 用元数据填充模型参数(已有的用户手填值不覆盖) */
export function applyModelMeta(m: ModelConfig, meta: ModelMeta | undefined): ModelConfig {
  if (!meta) return m;
  return {
    ...m,
    displayName: m.displayName ?? meta.name,
    contextWindow: m.contextWindow ?? meta.contextWindow,
    maxTokens: m.maxTokens ?? meta.maxTokens,
    tools: m.tools ?? meta.tools,
    vision: m.vision ?? meta.vision,
    reasoning: m.reasoning ?? meta.reasoning,
    prefilled:
      (meta.contextWindow != null || meta.maxTokens != null || meta.vision || meta.reasoning) &&
      (m.contextWindow == null || m.maxTokens == null),
  };
}

/** 用 models.dev 元数据补全已有模型的缺失参数(displayName/上下文/输出/能力位),不覆盖手填值 */
export async function syncModelsWithModelsDev(
  models: ModelConfig[],
  signal?: AbortSignal,
): Promise<{ models: ModelConfig[]; updatedCount: number }> {
  const metaMap = await fetchModelsDevMeta(signal);
  let updatedCount = 0;
  const next = models.map((m) => {
    const enriched = applyModelMeta(m, metaMap.get(m.id));
    if (enriched !== m) updatedCount++;
    return enriched;
  });
  return { models: next, updatedCount };
}

/** 测试连通性 = 拉取模型列表成功 */
export async function testConnection(
  p: Pick<ProviderConfig, 'api' | 'baseUrl' | 'apiKey'>,
): Promise<string> {
  const ids = await fetchProviderModels(p);
  return i18n.t('errors.modelsFetchOk', { count: ids.length });
}
