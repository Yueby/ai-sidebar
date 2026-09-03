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
  { value: 'duckduckgo', label: 'DuckDuckGo(免费,无需 Key)' },
  { value: 'searxng', label: 'SearXNG(免费,需实例地址)' },
  { value: 'brave', label: 'Brave Search(API Key)' },
  { value: 'tavily', label: 'Tavily(API Key)' },
];

/** 网络搜索设置:搜索源选择 + 条件字段(修改即经 updateSettings 持久化) */
export function SearchSettingsView({ settings, onUpdateSettings }: SearchSettingsViewProps) {
  const webSearch = settings.webSearch;
  const [showKey, setShowKey] = useState(false);

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
      </div>

      {/* Card: 说明 */}
      <div className="rounded-lg border bg-card p-3.5 space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Globe className="size-3.5 text-muted-foreground" />
          <span>说明</span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          DuckDuckGo 与 SearXNG 走页面解析,源站改版可能临时失效;Brave 与 Tavily 走官方
          API,更稳定但需要 Key。搜索请求由浏览器直接发起,不经过任何中间服务器。
        </p>
      </div>
    </div>
  );
}
