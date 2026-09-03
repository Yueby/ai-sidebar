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

const PROVIDER_OPTIONS: { value: WebSearchProvider; label: string; hint: string }[] = [
  { value: 'none', label: '不启用', hint: '' },
  { value: 'duckduckgo', label: 'DuckDuckGo', hint: '免 Key 直连;HTML 解析,稳定性不保证' },
  { value: 'searxng', label: 'SearXNG', hint: '免 Key;需自备允许外部访问的 SearXNG 实例地址' },
  { value: 'brave', label: 'Brave Search', hint: '免费层每月 2000 次;Key 在 api.brave.com/search 申请' },
  { value: 'tavily', label: 'Tavily', hint: '免费层每月 1000 credits;Key 在 tavily.com 申请' },
  { value: 'bocha', label: '博查', hint: '国内 agent 搜索事实标准;注册 api.bochaai.com 送免费额度(超出按量计费)' },
  { value: 'serper', label: 'Serper', hint: 'Google 索引;新户免费 2500 次,之后约 $3/千次(google.serper.dev)' },
  { value: 'exa', label: 'Exa', hint: '语义搜索;注册送 $10(约 2800 次),每月叠加 $10(exa.ai)' },
  { value: 'zhipu', label: '智谱', hint: '智谱开放平台 bigmodel.cn 申请;注册赠送额度(search_std 0.01 元/次起)' },
  { value: 'metaso', label: '秘塔', hint: '秘塔搜索,metaso.cn 申请(计费)' },
  { value: 'bing', label: 'Bing', hint: '免 Key HTML 抓取,稳定性不保证' },
];

/** 网络搜索设置:搜索源选择 + 条件字段(修改即经 updateSettings 持久化) */
export function SearchSettingsView({ settings, onUpdateSettings }: SearchSettingsViewProps) {
  const webSearch = settings.webSearch;
  const [showKey, setShowKey] = useState(false);
  const selectedOption = PROVIDER_OPTIONS.find((opt) => opt.value === webSearch.provider);

  const update = (patch: Partial<Settings['webSearch']>) => {
    onUpdateSettings({ ...settings, webSearch: { ...webSearch, ...patch } });
  };

  return (
    <div className="space-y-3.5 text-left animate-in fade-in-0 duration-150 motion-reduce:animate-none">
      {/* Card: 搜索源 */}
      <div className="rounded-lg border bg-card p-3.5 space-y-2.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Globe className="size-3.5 text-muted-foreground" />
          <span>搜索源</span>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[11px] text-muted-foreground">搜索提供商</Label>
          <Select
            value={webSearch.provider}
            onValueChange={(value) => update({ provider: value as WebSearchProvider })}
          >
            <SelectTrigger className="h-8 text-sm w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedOption?.hint && (
            <p className="text-[11px] text-muted-foreground leading-relaxed">{selectedOption.hint}</p>
          )}
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            启用后对话内提供 search_web 工具,模型可搜索 web 并用 fetch_url 深取结果。
          </p>
        </div>

        {webSearch.provider === 'searxng' && (
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">SearXNG 实例地址</Label>
            <Input
              value={webSearch.searxngBaseUrl}
              onChange={(e) => update({ searxngBaseUrl: e.target.value })}
              placeholder="https://searx.example.com"
              className="h-8 text-sm font-mono"
            />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              自托管或公共实例的根地址(不含 /search 路径)。
            </p>
          </div>
        )}

        {(webSearch.provider === 'brave' || webSearch.provider === 'tavily') && (
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">API Key</Label>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                value={webSearch.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
                placeholder={webSearch.provider === 'brave' ? 'Brave Search API Key' : 'Tavily API Key'}
                className="h-8 text-sm pr-8"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-1 top-1/2 -translate-y-1/2 size-6 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              申请地址:{' '}
              {webSearch.provider === 'brave' ? (
                <a
                  href="https://brave.com/search/api/"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary underline"
                >
                  brave.com/search/api
                </a>
              ) : (
                <a
                  href="https://tavily.com"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary underline"
                >
                  tavily.com
                </a>
              )}
              ;Key 仅保存在本地浏览器扩展存储中。
            </p>
          </div>
        )}

        {(webSearch.provider === 'bocha' ||
          webSearch.provider === 'serper' ||
          webSearch.provider === 'exa' ||
          webSearch.provider === 'zhipu' ||
          webSearch.provider === 'metaso') && (
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">API Key</Label>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                value={webSearch.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
                placeholder="API Key"
                className="h-8 text-sm pr-8"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-1 top-1/2 -translate-y-1/2 size-6 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Key 仅保存在本地浏览器扩展存储中。
            </p>
          </div>
        )}
      </div>

      {/* Card: 说明 */}
      <div className="rounded-lg border bg-card p-3.5 space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Globe className="size-3.5 text-muted-foreground" />
          <span>说明</span>
        </div>
        {selectedOption?.hint && (
          <p className="text-[11px] text-muted-foreground leading-relaxed">{selectedOption.hint}</p>
        )}
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          搜索请求由浏览器直接发起,不经过任何中间服务器。
        </p>
      </div>
    </div>
  );
}
