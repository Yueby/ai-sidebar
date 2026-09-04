import { useState } from 'react';
import { Eye, EyeOff, Globe } from 'lucide-react';
import type { Settings, WebSearchProvider } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

const PROVIDER_OPTIONS: { value: WebSearchProvider; label: string }[] = [
  { value: 'none', label: '不启用' },
  { value: 'duckduckgo', label: 'DuckDuckGo' },
  { value: 'searxng', label: 'SearXNG' },
  { value: 'brave', label: 'Brave Search' },
  { value: 'tavily', label: 'Tavily' },
  { value: 'bocha', label: '博查' },
  { value: 'serper', label: 'Serper' },
  { value: 'exa', label: 'Exa' },
  { value: 'zhipu', label: '智谱' },
  { value: 'metaso', label: '秘塔' },
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

const PROVIDER_CONFIG: Record<
  KeyBasedProvider,
  {
    placeholder: string;
    applyUrl?: { url: string; label: string };
  }
> = {
  brave: {
    placeholder: 'Brave Search API Key',
    applyUrl: { url: 'https://brave.com/search/api/', label: 'brave.com/search/api' },
  },
  tavily: {
    placeholder: 'Tavily API Key',
    applyUrl: { url: 'https://tavily.com', label: 'tavily.com' },
  },
  bocha: {
    placeholder: '博查 API Key',
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
    placeholder: '智谱 API Key',
    applyUrl: { url: 'https://open.bigmodel.cn', label: 'open.bigmodel.cn' },
  },
  metaso: {
    placeholder: '秘塔 API Key',
    applyUrl: { url: 'https://metaso.cn', label: 'metaso.cn' },
  },
};

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
  const keyConfig = isKeyBasedProvider(currentProvider) ? PROVIDER_CONFIG[currentProvider] : null;

  return (
    <div className="space-y-3.5 text-left animate-in fade-in-0 duration-150 motion-reduce:animate-none">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Globe className="size-3.5 text-muted-foreground" />
            <span>网络搜索设置</span>
          </h2>
          <span className="text-[10px] text-muted-foreground font-mono">
            {currentProvider === 'none' ? '未启用' : PROVIDER_OPTIONS.find((p) => p.value === currentProvider)?.label}
          </span>
        </div>

        <div className="rounded-lg border bg-card p-3 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">搜索提供商</Label>
            <Select
              value={webSearch.provider}
              onValueChange={(value) => update({ provider: value as WebSearchProvider })}
            >
              <SelectTrigger className="h-8 text-xs w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {webSearch.provider === 'searxng' && (
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">SearXNG 实例地址</Label>
              <Input
                value={webSearch.searxngBaseUrl}
                onChange={(e) => update({ searxngBaseUrl: e.target.value })}
                placeholder="https://searx.example.com"
                className="h-8 text-xs font-mono"
              />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                自托管或公共实例的根地址（不含 /search 路径）。
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
                    申请地址：{' '}
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
                Key 仅保存在本地浏览器扩展存储中。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
