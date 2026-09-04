import React, { useState } from 'react';
import {
  ArrowLeft,
  Plus,
  Bot,
  Zap,
  Pencil,
  Trash2,
  Loader2,
  ShieldCheck,
  Layers,
} from 'lucide-react';
import type { Settings, ProviderConfig } from '@/lib/types';
import { apiTypeLabel } from '@/lib/providers';
import { testConnection } from '@/lib/models';
import { SearchSettingsView } from './SearchSettingsView';
import { SettingsBackupView } from './SettingsBackupView';
import { SettingsPermissionsView } from './SettingsPermissionsView';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn, getErrorMessage } from '@/lib/utils';

interface SettingsMainViewProps {
  settings: Settings;
  onUpdateSettings: (settings: Settings) => void;
  onBack: () => void;
  onAddProvider: () => void;
  onEditProvider: (provider: ProviderConfig) => void;
}

type SettingsTab = 'providers' | 'search' | 'permissions' | 'backup' | 'about';

export function SettingsMainView({
  settings,
  onUpdateSettings,
  onBack,
  onAddProvider,
  onEditProvider,
}: SettingsMainViewProps) {
  const [currentTab, setCurrentTab] = useState<SettingsTab>('providers');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { success: boolean; message: string }>
  >({});
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Read extension manifest info safely
  let appName = 'ai-sidebar';
  let appVersion = '0.0.0';
  try {
    const manifest = typeof browser !== 'undefined' ? browser.runtime?.getManifest?.() : null;
    if (manifest) {
      appName = manifest.name || appName;
      appVersion = manifest.version || appVersion;
    }
  } catch {
    // fallback
  }

  // Set active provider
  const handleSetActiveProvider = (providerId: string) => {
    const provider = settings.providers.find((p) => p.id === providerId);
    let activeModelId = settings.activeModelId;

    const hasModel = provider?.models.some((m) => m.id === activeModelId);
    if (!hasModel) {
      activeModelId = provider?.models[0]?.id || null;
    }

    onUpdateSettings({
      ...settings,
      activeProviderId: providerId,
      activeModelId,
    });
  };

  // Test provider connection
  const handleTestProvider = async (p: ProviderConfig) => {
    setTestingId(p.id);
    setTestResults((prev) => ({ ...prev, [p.id]: undefined as any }));
    try {
      const msg = await testConnection({
        api: p.api,
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
      });
      setTestResults((prev) => ({
        ...prev,
        [p.id]: { success: true, message: msg },
      }));
    } catch (err: unknown) {
      setTestResults((prev) => ({
        ...prev,
        [p.id]: {
          success: false,
          message: getErrorMessage(err) || '连接失败，请检查配置',
        },
      }));
    } finally {
      setTestingId(null);
    }
  };

  // Delete provider
  const handleDeleteProvider = (providerId: string) => {
    const remaining = settings.providers.filter((p) => p.id !== providerId);
    let activeProviderId = settings.activeProviderId;
    let activeModelId = settings.activeModelId;

    if (activeProviderId === providerId) {
      if (remaining.length > 0) {
        activeProviderId = remaining[0]!.id;
        activeModelId = remaining[0]!.models[0]?.id || null;
      } else {
        activeProviderId = null;
        activeModelId = null;
      }
    }

    onUpdateSettings({
      ...settings,
      providers: remaining,
      activeProviderId,
      activeModelId,
    });
    setDeletingId(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground overflow-hidden animate-in fade-in-0 duration-150 motion-reduce:animate-none">
      {/* Top Header with Tab Switcher */}
      <header className="flex h-11 shrink-0 items-center justify-between border-b bg-background px-3 select-none gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="size-7 shrink-0"
          >
            <ArrowLeft className="size-4" />
            <span className="sr-only">返回聊天</span>
          </Button>

          {/* Tab Switcher in Header */}
          <div className="flex items-center rounded-md border bg-muted/40 p-0.5 text-xs">
            <Button
              type="button"
              variant={currentTab === 'providers' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setCurrentTab('providers')}
              className="h-6 px-2 text-xs font-normal"
            >
              提供商
            </Button>
            <Button
              type="button"
              variant={currentTab === 'search' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setCurrentTab('search')}
              className="h-6 px-2 text-xs font-normal"
            >
              搜索
            </Button>
            <Button
              type="button"
              variant={currentTab === 'permissions' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setCurrentTab('permissions')}
              className="h-6 px-2 text-xs font-normal"
            >
              权限
            </Button>
            <Button
              type="button"
              variant={currentTab === 'backup' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setCurrentTab('backup')}
              className="h-6 px-2 text-xs font-normal"
            >
              备份
            </Button>
            <Button
              type="button"
              variant={currentTab === 'about' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setCurrentTab('about')}
              className="h-6 px-2 text-xs font-normal"
            >
              关于
            </Button>
          </div>
        </div>

        {/* Main Content Area */}
      </header>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
        {/* VIEW 1: Providers List */}
        {currentTab === 'providers' && (
          <div className="space-y-3 animate-in fade-in-0 duration-150 motion-reduce:animate-none">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium text-muted-foreground">
                AI 提供商 ({settings.providers.length})
              </h2>
              <Button
                type="button"
                size="sm"
                onClick={onAddProvider}
                className="gap-1 h-7 text-xs px-2.5 shrink-0"
              >
                <Plus className="size-3" />
                <span>添加提供商</span>
              </Button>
            </div>

            {settings.providers.length === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center">
                <div className="mb-2 flex size-10 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                  <Bot className="size-5" />
                </div>
                <h3 className="text-xs font-semibold text-foreground">尚未配置 AI 提供商</h3>
                <p className="mt-1 text-xs text-muted-foreground max-w-[240px] leading-relaxed">
                  支持 OpenAI 兼容、Responses 协议及 Anthropic 格式
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {settings.providers.map((p) => {
                  const isActive = p.id === settings.activeProviderId;
                  const isTesting = testingId === p.id;
                  const testResult = testResults[p.id];
                  const isConfirmingDelete = deletingId === p.id;

                  return (
                    <div
                      key={p.id}
                      className={cn(
                        'rounded-lg border p-3 text-left space-y-2',
                        isActive
                          ? 'border-foreground/30 bg-muted/30'
                          : 'border-border bg-card'
                      )}
                    >
                      {/* Header: Name + Protocol + Active Badge */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate text-xs font-semibold text-foreground">
                            {p.name || '未命名提供商'}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {isActive && (
                            <Badge variant="default" className="text-[10px] h-4.5 px-1.5 font-normal">
                              已激活
                            </Badge>
                          )}
                          <Badge variant="secondary" className="text-[10px] h-4.5 px-1.5 font-normal">
                            {apiTypeLabel(p.api)}
                          </Badge>
                        </div>
                      </div>

                      {/* Base URL and Models info */}
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        <div className="truncate font-mono text-[11px]">{p.baseUrl || '无 Base URL'}</div>
                        <div className="text-[11px]">
                          <span>{p.models.length} 个模型</span>
                          {p.models.length > 0 && (
                            <span className="ml-1">
                              ({p.models.map((m) => m.displayName || m.id).slice(0, 3).join(', ')}
                              {p.models.length > 3 ? '...' : ''})
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Test result banner */}
                      {testResult && (
                        <div
                          className={cn(
                            'text-[11px] rounded p-1.5 font-medium',
                            testResult.success
                              ? 'bg-muted text-foreground'
                              : 'bg-destructive/10 text-destructive'
                          )}
                        >
                          {testResult.message}
                        </div>
                      )}

                      {/* Action Bar */}
                      <div className="flex items-center justify-between pt-1 border-t">
                        {/* Left: Test */}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isTesting}
                          onClick={() => handleTestProvider(p)}
                          className="h-6 text-[11px] px-1.5 text-muted-foreground hover:text-foreground gap-1"
                        >
                          {isTesting ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Zap className="size-3" />
                          )}
                          <span>{isTesting ? '测试中' : '测试'}</span>
                        </Button>

                        {/* Right: Set Active / Edit / Delete */}
                        <div className="flex items-center gap-1">
                          {!isActive && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleSetActiveProvider(p.id)}
                              className="h-6 text-[11px] px-2"
                            >
                              设为当前
                            </Button>
                          )}

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => onEditProvider(p)}
                            className="size-6 text-muted-foreground hover:text-foreground"
                            title="编辑提供商"
                          >
                            <Pencil className="size-3" />
                          </Button>

                          {isConfirmingDelete ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleDeleteProvider(p.id)}
                                className="px-1.5 py-0.5 rounded text-[10px] bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                删除
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingId(null)}
                                className="px-1.5 py-0.5 rounded text-[10px] bg-secondary text-secondary-foreground"
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeletingId(p.id)}
                              className="size-6 text-muted-foreground hover:text-destructive"
                              title="删除提供商"
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* VIEW 2: Search Settings */}
        {currentTab === 'search' && (
          <SearchSettingsView settings={settings} onUpdateSettings={onUpdateSettings} />
        )}

        {/* VIEW: Backup (导出/导入配置文件) */}
        {currentTab === 'backup' && (
          <SettingsBackupView settings={settings} onUpdateSettings={onUpdateSettings} />
        )}

        {/* VIEW 3: Permissions Management */}
        {currentTab === 'permissions' && (
          <SettingsPermissionsView />
        )}

        {/* VIEW 4: About Page */}
        {currentTab === 'about' && (
          <div className="space-y-3 text-left animate-in fade-in-0 duration-150 motion-reduce:animate-none">
            {/* Card: Basic Info */}
            <div className="rounded-lg border bg-card p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex size-7 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                    <Bot className="size-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-foreground">{appName}</h3>
                    <p className="text-[11px] text-muted-foreground">BYOK 浏览器 AI 侧边栏</p>
                  </div>
                </div>
                <Badge variant="outline" className="text-[11px] font-mono">
                  v{appVersion}
                </Badge>
              </div>

              <Separator />

              <p className="text-xs text-muted-foreground leading-relaxed">
                开源自带 API Key（BYOK）浏览器侧边栏扩展，使用您自己的 API 密钥连接各大模型端点，提供网页上下文感知与流式对话能力。
              </p>
            </div>

            {/* Card: Supported Protocols */}
            <div className="rounded-lg border bg-card p-3.5 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <Layers className="size-3.5 text-muted-foreground" />
                <span>支持的接口协议</span>
              </div>

              <div className="space-y-2 pt-1 text-xs">
                <div className="rounded border bg-muted/20 p-2 space-y-0.5">
                  <div className="font-medium text-foreground">OpenAI 兼容 · Chat Completions</div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    标准 <code className="font-mono bg-muted px-1 rounded">/v1/chat/completions</code> 接口，支持 OpenAI、DeepSeek、OpenRouter、Ollama、Kimi、GLM 等主流端点。
                  </div>
                </div>

                <div className="rounded border bg-muted/20 p-2 space-y-0.5">
                  <div className="font-medium text-foreground">OpenAI 兼容 · Responses</div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    标准 <code className="font-mono bg-muted px-1 rounded">/v1/responses</code> 接口协议。
                  </div>
                </div>

                <div className="rounded border bg-muted/20 p-2 space-y-0.5">
                  <div className="font-medium text-foreground">Anthropic Messages</div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    标准 <code className="font-mono bg-muted px-1 rounded">/v1/messages</code> 接口，支持 Claude 官方 API 及兼容格式。
                  </div>
                </div>
              </div>
            </div>

            {/* Card: Security & Privacy */}
            <div className="rounded-lg border bg-card p-3.5 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <ShieldCheck className="size-3.5 text-muted-foreground" />
                <span>数据与安全</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                API 请求直接由浏览器发起连接至目标端点，不经过任何中间代理服务器；API Key 仅保存在本地浏览器扩展存储中。
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
