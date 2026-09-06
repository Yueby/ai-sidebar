import type { ApiType, ModelConfig, ProviderConfig, ReasoningLevel, Settings } from './types';
import { REASONING_LEVELS } from './types';

export const API_TYPE_OPTIONS: Array<{
  value: ApiType;
  label: string;
  defaultBaseUrl: string;
}> = [
  {
    value: 'openai-completions',
    label: 'OpenAI 兼容 · Chat Completions',
    defaultBaseUrl: 'https://api.openai.com/v1',
  },
  {
    value: 'openai-responses',
    label: 'OpenAI 兼容 · Responses',
    defaultBaseUrl: 'https://api.openai.com/v1',
  },
  {
    value: 'anthropic-messages',
    label: 'Anthropic Messages',
    defaultBaseUrl: 'https://api.anthropic.com',
  },
];

/**
 * 归一化用户输入的 baseUrl:去首尾空白与尾斜杠;
 * anthropic 的官方 SDK 会在资源路径里自带 /v1(/v1/messages、/v1/models),
 * 用户按 OpenAI 惯例多填的 /v1 必须剥掉,否则请求会打成 /v1/v1/messages。
 */
export function normalizeBaseUrl(api: ApiType, url: string): string {
  let base = url.trim().replace(/\/+$/, '');
  if (api === 'anthropic-messages') {
    base = base.replace(/\/v1$/, '');
  }
  return base;
}

export function apiTypeLabel(api: ApiType): string {
  return API_TYPE_OPTIONS.find((o) => o.value === api)?.label ?? api;
}

export const DEFAULT_SETTINGS: Settings = {
  providers: [],
  activeProviderId: null,
  activeModelId: null,
  titleModel: null,
  quickPromptModel: null,
  language: null,
  rules: [],
  titleThinking: 'off',
  quickPromptThinking: 'off',
  includePageContext: true,
  reasoningLevel: 'off',
  webSearch: { provider: 'none', searxngBaseUrl: '', apiKeys: {} },
  webdav: { url: '', username: '', password: '', remotePath: 'ai-sidebar/backup.dat', encrypt: false, encryptPassword: '' },
};

export function createProviderDraft(): ProviderConfig {
  return {
    id: crypto.randomUUID(),
    name: '',
    api: 'openai-completions',
    baseUrl: API_TYPE_OPTIONS[0]!.defaultBaseUrl,
    apiKey: '',
    models: [],
  };
}

/** 当前生效的 provider+model;任一缺失返回 null */
export function findActiveModel(
  settings: Settings,
): { provider: ProviderConfig; model: ModelConfig } | null {
  const provider = settings.providers.find((p) => p.id === settings.activeProviderId);
  const model = provider?.models.find((m) => m.id === settings.activeModelId);
  if (!provider || !model) return null;
  return { provider, model };
}

/** 解析辅助模型引用(标题/快捷指令生成):null 或引用失效均回退对话模型 */
export function resolveAuxModel(
  settings: Settings,
  aux: Settings['titleModel'],
): { provider: ProviderConfig; model: ModelConfig } | null {
  if (aux) {
    const provider = settings.providers.find((p) => p.id === aux.providerId);
    const model = provider?.models.find((m) => m.id === aux.modelId);
    if (provider && model) return { provider, model };
  }
  return findActiveModel(settings);
}

/** 模型支持的思考等级(不含 off);未配置/非法值回退默认三档 low/medium/high */
export function getModelReasoningLevels(m: ModelConfig): ReasoningLevel[] {
  const valid = (m.reasoningLevels ?? []).filter(
    (l): l is ReasoningLevel => REASONING_LEVELS.includes(l) && l !== 'off',
  );
  return valid.length > 0 ? valid : ['low', 'medium', 'high'];
}

/** 全局思考等级对该模型的生效值:不支持则回退 off */
export function resolveReasoningLevel(m: ModelConfig, level: ReasoningLevel): ReasoningLevel {
  return getModelReasoningLevels(m).includes(level) ? level : 'off';
}
