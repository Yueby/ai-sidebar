import { useState } from 'react';
import { Eye, EyeOff, Globe } from 'lucide-react';
import type { Settings, WebSearchProvider } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { i18n } from '#i18n';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface SearchSettingsViewProps {
  settings: Settings;
  onUpdateSettings: (settings: Settings) => void;
}

const getProviderOptions = (): { value: WebSearchProvider; label: string }[] => [
  { value: 'none', label: i18n.t('search.providerNone') },
  { value: 'duckduckgo', label: 'DuckDuckGo' },
  { value: 'searxng', label: 'SearXNG' },
  { value: 'brave', label: 'Brave Search' },
  { value: 'tavily', label: 'Tavily' },
  { value: 'bocha', label: i18n.t('search.providerBocha') },
  { value: 'serper', label: 'Serper' },
  { value: 'exa', label: 'Exa' },
  { value: 'zhipu', label: i18n.t('search.providerZhipu') },
  { value: 'metaso', label: i18n.t('search.providerMetaso') },
  { value: 'bing', label: 'Bing' },
];

type KeyBasedProvider = 'brave' | 'tavily' | 'bocha' | 'serper' | 'exa' | 'zhipu' | 'metaso';

const KEY_BASED_PROVIDERS: readonly KeyBasedProvider[] = [
  'brave',
  'tavily',
  'bocha',
  'serper',
  'exa',
  'zhipu',
  'metaso',
];

function isKeyBasedProvider(provider: WebSearchProvider): provider is KeyBasedProvider {
  return (KEY_BASED_PROVIDERS as readonly string[]).includes(provider);
}

const getProviderConfig = (): Record<
  KeyBasedProvider,
  {
    placeholder: string;
    applyUrl?: { url: string; label: string };
  }
> => ({
  brave: {
    placeholder: 'Brave Search API Key',
    applyUrl: { url: 'https://brave.com/search/api/', label: 'brave.com/search/api' },
  },
  tavily: {
    placeholder: 'Tavily API Key',
    applyUrl: { url: 'https://tavily.com', label: 'tavily.com' },
  },
  bocha: {
    placeholder: i18n.t('search.keyPlaceholder', { name: i18n.t('search.providerBocha') }),
    applyUrl: { url: 'https://open.bochaai.com', label: 'open.bochaai.com' },
  },
  serper: {
    placeholder: 'Serper API Key',
    applyUrl: { url: 'https://serper.dev', label: 'serper.dev' },
  },
  exa: {
    placeholder: 'Exa API Key',
    applyUrl: { url: 'https://exa.ai', label: 'exa.ai' },
  },
  zhipu: {
    placeholder: i18n.t('search.keyPlaceholder', { name: i18n.t('search.providerZhipu') }),
    applyUrl: { url: 'https://open.bigmodel.cn', label: 'open.bigmodel.cn' },
  },
  metaso: {
    placeholder: i18n.t('search.keyPlaceholder', { name: i18n.t('search.providerMetaso') }),
    applyUrl: { url: 'https://metaso.cn', label: 'metaso.cn' },
  },
});

/** 网络搜索设置:搜索源选择 + 条件字段(修改即经 updateSettings 持久化) */
export function SearchSettingsView({ settings, onUpdateSettings }: SearchSettingsViewProps) {
  const webSearch = settings.webSearch;
  const [showKey, setShowKey] = useState(false);

  const update = (patch: Partial<Settings['webSearch']>) => {
    onUpdateSettings({ ...settings, webSearch: { ...webSearch, ...patch } });
  };

  const updateApiKey = (provider: KeyBasedProvider, key: string) => {
    update({
      apiKeys: {
        ...webSearch.apiKeys,
        [provider]: key,
      },
    });
  };

  const currentProvider = webSearch.provider;
  const providerOptions = getProviderOptions();
  const providerConfig = getProviderConfig();
  const keyConfig = isKeyBasedProvider(currentProvider) ? providerConfig[currentProvider] : null;

  return (
    <div className="space-y-3.5 text-left animate-in fade-in-0 duration-150 motion-reduce:animate-none">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Globe className="size-3.5 text-muted-foreground" />
            <span>{i18n.t('search.title')}</span>
          </h2>
          <span className="text-[10px] text-muted-foreground font-mono">
            {currentProvider === 'none' ? i18n.t('search.providerNone') : providerOptions.find((p) => p.value === currentProvider)?.label}
          </span>
        </div>

        <div className="rounded-lg border bg-card p-3 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">{i18n.t('search.providerLabel')}</Label>
            <Select
              value={webSearch.provider}
              onValueChange={(value) => update({ provider: value as WebSearchProvider })}
            >
              <SelectTrigger className="h-8 text-xs w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providerOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {webSearch.provider === 'searxng' && (
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">{i18n.t('search.searxngLabel')}</Label>
              <Input
                value={webSearch.searxngBaseUrl}
                onChange={(e) => update({ searxngBaseUrl: e.target.value })}
                placeholder="https://searx.example.com"
                className="h-8 text-xs font-mono"
              />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {i18n.t('search.searxngHelp')}
              </p>
            </div>
          )}

          {isKeyBasedProvider(currentProvider) && keyConfig && (
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">API Key</Label>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={webSearch.apiKeys[currentProvider] ?? ''}
                  onChange={(e) => updateApiKey(currentProvider, e.target.value)}
                  placeholder={keyConfig.placeholder}
                  className="h-8 text-xs pr-8 font-mono"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 size-6 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {keyConfig.applyUrl && (
                  <>
                    {i18n.t('search.applyUrlPrefix')}
                    <a
                      href={keyConfig.applyUrl.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-primary underline hover:opacity-80 transition-opacity"
                    >
                      {keyConfig.applyUrl.label}
                    </a>
                    ；
                  </>
                )}
                {i18n.t('search.keyStorageNote')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
