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
import { toast } from 'sonner';
import { testConnection } from '@/lib/models';
import { SearchSettingsView } from './SearchSettingsView';
import { SettingsBackupView } from './SettingsBackupView';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteProviderTarget, setDeleteProviderTarget] = useState<ProviderConfig | null>(null);

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
    try {
      const msg = await testConnection({
        api: p.api,
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
      });
      toast.success(`${p.name || '提供商'}: ${msg}`);
    } catch (err: unknown) {
      toast.error(`${p.name || '提供商'}: ${getErrorMessage(err) || '连接失败，请检查配置'}`);
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
      <header className="flex h-11 shrink-0 items-center border-b bg-background px-2.5 select-none gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <ArrowLeft className="size-4" />
          <span className="sr-only">返回聊天</span>
        </Button>

        {/* Tab Switcher in Header (Segmented Control) */}
        <nav
          aria-label="设置导航"
          className="flex items-center rounded-lg border border-border/60 bg-muted/50 p-0.5 text-xs"
        >
          {[
            { id: 'providers', label: '提供商' },
            { id: 'search', label: '搜索' },
            { id: 'permissions', label: '权限' },
            { id: 'backup', label: '备份' },
            { id: 'about', label: '关于' },
          ].map((tab) => {
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCurrentTab(tab.id as SettingsTab)}
                className={cn(
                  'h-6 px-2 text-[11px] font-medium rounded-md transition-all cursor-pointer whitespace-nowrap',
                  isActive
                    ? 'bg-background text-foreground shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
        {/* VIEW 1: Providers List */}
        {currentTab === 'providers' && (
          <div className="space-y-3.5 animate-in fade-in-0 duration-150 motion-reduce:animate-none">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Bot className="size-3.5 text-muted-foreground" />
                <span>AI 提供商 ({settings.providers.length})</span>
              </h2>
              <Button
                type="button"
                size="sm"
                onClick={onAddProvider}
                className="gap-1 h-7 text-xs px-2.5 shrink-0 cursor-pointer"
              >
                <Plus className="size-3" />
                <span>添加提供商</span>
              </Button>
            </div>

            {settings.providers.length === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center space-y-3">
                <div className="flex size-10 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                  <Bot className="size-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold text-foreground">尚未配置 AI 提供商</h3>
                  <p className="text-[11px] text-muted-foreground max-w-[240px] leading-relaxed">
                    支持 OpenAI 兼容、Responses 协议及 Anthropic 格式
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={onAddProvider}
                  className="h-7 text-xs gap-1.5 cursor-pointer"
                >
                  <Plus className="size-3" />
                  <span>立即添加提供商</span>
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {settings.providers.map((p) => {
                  const isActive = p.id === settings.activeProviderId;
                  const isTesting = testingId === p.id;
                  const isConfirmingDelete = deletingId === p.id;

                  return (
                    <div
                      key={p.id}
                      className={cn(
                        'rounded-lg border p-3 text-left space-y-2.5 transition-colors',
                        isActive
                          ? 'border-primary/40 bg-primary/5 dark:bg-primary/10 shadow-2xs'
                          : 'border-border bg-card hover:border-border/80'
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
                      {isTesting && (
                        <span className="text-[11px] text-muted-foreground">测试中…</span>
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

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteProviderTarget(p)}
                            className="size-6 text-muted-foreground hover:text-destructive"
                            title="删除提供商"
                          >
                            <Trash2 className="size-3" />
                          </Button>
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

        {/* VIEW 5: About Page */}
        {currentTab === 'about' && (
          <div className="space-y-3.5 text-left animate-in fade-in-0 duration-150 motion-reduce:animate-none">
            {/* Section 1: Basic Info */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Bot className="size-3.5 text-muted-foreground" />
                  <span>扩展信息</span>
                </h2>
                <Badge variant="outline" className="text-[10px] h-4.5 px-1.5 font-mono">
                  v{appVersion}
                </Badge>
              </div>

              <div className="rounded-lg border bg-card p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex size-7 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                    <Bot className="size-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-foreground">{appName}</h3>
                    <p className="text-[11px] text-muted-foreground">BYOK 浏览器 AI 侧边栏</p>
                  </div>
                </div>

                <p className="text-[11px] text-muted-foreground leading-relaxed pt-1.5 border-t border-border/50">
                  开源自带 API Key（BYOK）浏览器侧边栏扩展，使用您自己的 API 密钥连接各大模型端点，提供网页上下文感知、页面动作与流式对话能力。
                </p>
              </div>
            </div>

            {/* Section 2: Supported Protocols */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Layers className="size-3.5 text-muted-foreground" />
                  <span>支持的接口协议</span>
                </h2>
                <span className="text-[10px] text-muted-foreground font-mono">3 类协议</span>
              </div>

              <div className="rounded-lg border bg-card p-3 space-y-2">
                <div className="rounded-md border bg-muted/20 p-2 space-y-0.5">
                  <div className="font-medium text-foreground text-xs">OpenAI 兼容 · Chat Completions</div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    标准 <code className="font-mono bg-muted px-1 py-0.5 rounded text-[10px] border border-border/40">/v1/chat/completions</code> 接口，支持 OpenAI、DeepSeek、OpenRouter、Ollama、Kimi、GLM 等主流端点。
                  </div>
                </div>

                <div className="rounded-md border bg-muted/20 p-2 space-y-0.5">
                  <div className="font-medium text-foreground text-xs">OpenAI 兼容 · Responses</div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    标准 <code className="font-mono bg-muted px-1 py-0.5 rounded text-[10px] border border-border/40">/v1/responses</code> 接口协议。
                  </div>
                </div>

                <div className="rounded-md border bg-muted/20 p-2 space-y-0.5">
                  <div className="font-medium text-foreground text-xs">Anthropic Messages</div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    标准 <code className="font-mono bg-muted px-1 py-0.5 rounded text-[10px] border border-border/40">/v1/messages</code> 接口，支持 Claude 官方 API 及兼容格式。
                  </div>
                </div>
              </div>
            </div>

            {/* Section 3: Security & Privacy */}
            <div className="rounded-lg border bg-muted/20 p-3 flex items-start gap-2 text-muted-foreground text-[11px] leading-relaxed">
              <ShieldCheck className="size-3.5 shrink-0 mt-0.5 text-muted-foreground/80" />
              <div>
                <span className="font-medium text-foreground">数据与安全：</span>
                API 请求直接由浏览器发起连接至目标端点，不经过任何第三方代理服务器；API Key 仅保存在本地浏览器扩展存储中。
              </div>
            </div>
          </div>
        )}
        {/* 删除提供商二次确认(dialog 统一删除语义) */}
        <AlertDialog
          open={deleteProviderTarget !== null}
          onOpenChange={(open) => !open && setDeleteProviderTarget(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除提供商</AlertDialogTitle>
              <AlertDialogDescription>
                将删除「{deleteProviderTarget?.name || '未命名提供商'}」及其 {deleteProviderTarget?.models.length ?? 0} 个模型的配置，此操作不可撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setDeleteProviderTarget(null)}>
                取消
              </AlertDialogCancel>
              <AlertDialogAction
                className={buttonVariants({ variant: 'destructive' })}
                onClick={() => {
                  if (deleteProviderTarget) handleDeleteProvider(deleteProviderTarget.id);
                  setDeleteProviderTarget(null);
                }}
              >
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
