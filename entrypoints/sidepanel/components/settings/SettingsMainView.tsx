import React, { useState, useMemo } from 'react';
import { i18n } from '#i18n';
import {
  ArrowLeft,
  Plus,
  Bot,
  Zap,
  Pencil,
  Trash2,
  Loader2,
  ShieldCheck,
  Languages,
  Sparkles,
  Layers,
} from 'lucide-react';
import type { Settings, ProviderConfig, AuxThinkingLevel, ReasoningLevel } from '@/lib/types';
import { REASONING_LEVEL_LABELS } from '@/lib/types';
import { apiTypeLabel, getModelReasoningLevels, resolveReasoningLevel } from '@/lib/providers';
import { toast } from 'sonner';
import { testConnection } from '@/lib/models';
import { SearchSettingsView } from './SearchSettingsView';
import { SettingsPromptView } from './SettingsPromptView';
import { SettingsBackupView } from './SettingsBackupView';
import { InfoTip } from './InfoTip';
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
import { Card } from '@/components/ui/card';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsPermissionsView } from './SettingsPermissionsView';
import { Button } from '@/components/ui/button';
import { cn, getErrorMessage } from '@/lib/utils';

interface SettingsMainViewProps {
  settings: Settings;
  onUpdateSettings: (settings: Settings) => void;
  onBack: () => void;
  onAddProvider: () => void;
  onEditProvider: (provider: ProviderConfig) => void;
  /** WebDAV 恢复:全量落盘(IDB+设置)与 store 刷新由 App 编排 */
  onRestoreAll: (bundle: import('@/lib/syncPayload').SyncBundle) => void;
  /** 本地最新会话时间(恢复冲突对比展示) */
  latestLocalSessionAt: number | null;
  /** 当前激活会话(上传快照元数据) */
  activeSessionId: string | null;
}

type SettingsTab = 'providers' | 'models' | 'prompt' | 'search' | 'permissions' | 'backup' | 'about';

const AUX_THINKING_OPTIONS: { value: AuxThinkingLevel; label: string }[] = [
  { value: 'off', label: REASONING_LEVEL_LABELS.off.full },
  { value: 'low', label: REASONING_LEVEL_LABELS.low.full },
  { value: 'medium', label: REASONING_LEVEL_LABELS.medium.full },
  { value: 'high', label: REASONING_LEVEL_LABELS.high.full },
];

const REASONING_DISPLAY_ORDER: ReasoningLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

const sortReasoningLevels = (levels: ReasoningLevel[]): ReasoningLevel[] =>
  [...levels].sort(
    (a, b) =>
      (REASONING_DISPLAY_ORDER.indexOf(a) + 1 || 99) -
      (REASONING_DISPLAY_ORDER.indexOf(b) + 1 || 99),
  );

export function SettingsMainView({
  settings,
  onUpdateSettings,
  onBack,
  onAddProvider,
  onEditProvider,
  onRestoreAll,
  latestLocalSessionAt,
  activeSessionId,
}: SettingsMainViewProps) {
  const [currentTab, setCurrentTab] = useState<SettingsTab>('providers');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteProviderTarget, setDeleteProviderTarget] = useState<ProviderConfig | null>(null);
  /** 自定义语言草稿(选「自定义」但尚未输入时不落库;null = 不在编辑态) */
  const [langDraft, setLangDraft] = useState<string | null>(null);

  // 所有提供商已导入的模型列表（用于模型分工下拉选择）
  const allModelOptions = useMemo(() => {
    return settings.providers.flatMap((p) =>
      p.models.map((m) => ({
        providerId: p.id,
        modelId: m.id,
        value: `${p.id}::${m.id}`,
        label: `${p.name || i18n.t('settings.providers.unnamed')} / ${m.displayName || m.id}`,
      }))
    );
  }, [settings.providers]);

  // 包含可用模型的提供商列表（用于模型分工按提供商分组展示）
  const providersWithModels = useMemo(() => {
    return settings.providers.filter((p) => p.models.length > 0);
  }, [settings.providers]);

  // 渲染按提供商分组的模型选项
  const renderModelGroups = () => {
    return providersWithModels.map((p, idx) => (
      <React.Fragment key={p.id}>
        {idx > 0 && <SelectSeparator />}
        <SelectGroup>
          <SelectLabel className="text-[11px] text-muted-foreground font-normal px-2 py-1">
            {p.name || i18n.t('settings.providers.unnamed')}
          </SelectLabel>
          {p.models.map((m) => (
            <SelectItem
              key={`${p.id}::${m.id}`}
              value={`${p.id}::${m.id}`}
              className="text-xs"
            >
              {m.displayName || m.id}
            </SelectItem>
          ))}
        </SelectGroup>
      </React.Fragment>
    ));
  };

  // 对话模型受控值：未选或模型已不在列表时为 '__none__'
  const chatModelValue =
    settings.activeProviderId && settings.activeModelId
      ? `${settings.activeProviderId}::${settings.activeModelId}`
      : '__none__';

  // 标题生成模型受控值：null 或失效时跟随对话模型
  const titleModelValue =
    settings.titleModel &&
    allModelOptions.some(
      (o) =>
        o.providerId === settings.titleModel?.providerId &&
        o.modelId === settings.titleModel?.modelId
    )
      ? `${settings.titleModel.providerId}::${settings.titleModel.modelId}`
      : 'follow';

  // 快捷指令模型受控值：null 或失效时跟随对话模型
  const quickPromptModelValue =
    settings.quickPromptModel &&
    allModelOptions.some(
      (o) =>
        o.providerId === settings.quickPromptModel?.providerId &&
        o.modelId === settings.quickPromptModel?.modelId
    )
      ? `${settings.quickPromptModel.providerId}::${settings.quickPromptModel.modelId}`
      : 'follow';

  // 当前生效的对话模型配置
  const chatModel = useMemo(() => {
    if (!settings.activeProviderId || !settings.activeModelId) return null;
    const provider = settings.providers.find((p) => p.id === settings.activeProviderId);
    return provider?.models.find((m) => m.id === settings.activeModelId) ?? null;
  }, [settings.providers, settings.activeProviderId, settings.activeModelId]);

  // 对话模型支持的思考档位（与 ChatInput 保持一致：模型未配置 reasoning 时为空列表）
  const chatModelSupportsReasoning = chatModel?.reasoning === true;
  const chatSupportedLevels = useMemo(() => {
    if (!chatModel || !chatModelSupportsReasoning) return [];
    return sortReasoningLevels(getModelReasoningLevels(chatModel));
  }, [chatModel, chatModelSupportsReasoning]);

  // 对话模型思考受控值（与输入框保持一致：不支持思考时回退 off）
  const effectiveChatReasoningLevel = useMemo(() => {
    if (!chatModel || !chatModelSupportsReasoning) return 'off';
    return resolveReasoningLevel(chatModel, settings.reasoningLevel);
  }, [chatModel, chatModelSupportsReasoning, settings.reasoningLevel]);

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
      toast.success(i18n.t('settings.providers.testSuccess', { name: p.name || i18n.t('settings.providers.defaultProviderName'), msg }));
    } catch (err: unknown) {
      toast.error(i18n.t('settings.providers.testFailed', { name: p.name || i18n.t('settings.providers.defaultProviderName'), error: getErrorMessage(err) || i18n.t('settings.providers.defaultTestFailed') }));
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
          <span className="sr-only">{i18n.t('settings.backToChat')}</span>
        </Button>

        {/* Tab Switcher in Header (Controlled Tabs) */}
        <Tabs
          value={currentTab}
          onValueChange={(val) => setCurrentTab(val as SettingsTab)}
          className="flex-1 min-w-0"
        >
          <TabsList
            aria-label={i18n.t('settings.navAria')}
            className="w-full group-data-horizontal/tabs:h-8 h-8 p-0.5"
          >
            {[
              { id: 'providers', label: i18n.t('settings.tabs.providers') },
              { id: 'models', label: i18n.t('settings.tabs.models') },
              { id: 'prompt', label: i18n.t('settings.tabs.prompt') },
              { id: 'search', label: i18n.t('settings.tabs.search') },
              { id: 'permissions', label: i18n.t('settings.tabs.permissions') },
              { id: 'backup', label: i18n.t('settings.tabs.backup') },
              { id: 'about', label: i18n.t('settings.tabs.about') },
            ].map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="h-7 px-1 text-[11px] sm:text-xs cursor-pointer min-w-0 truncate"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
        {/* VIEW 1: Providers List */}
        {currentTab === 'providers' && (
          <div className="space-y-3.5 animate-in fade-in-0 duration-150 motion-reduce:animate-none">
            {/* 节标题行 */}
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Bot className="size-3.5 text-muted-foreground" />
                <span>{i18n.t('settings.providers.title', { count: settings.providers.length })}</span>
                <InfoTip content={i18n.t('settings.providers.emptyDesc')} />
              </h2>
              <Button
                type="button"
                size="sm"
                onClick={onAddProvider}
                className="gap-1 h-7 text-xs px-2.5 shrink-0 cursor-pointer"
              >
                <Plus className="size-3" />
                <span>{i18n.t('settings.providers.addProvider')}</span>
              </Button>
            </div>

            {settings.providers.length === 0 ? (
              /* Empty state */
              <Empty className="border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Bot className="size-5" />
                  </EmptyMedia>
                  <EmptyTitle>{i18n.t('settings.providers.emptyTitle')}</EmptyTitle>
                  <EmptyDescription>{i18n.t('settings.providers.emptyDesc')}</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onAddProvider}
                    className="h-7 text-xs gap-1.5 cursor-pointer"
                  >
                    <Plus className="size-3" />
                    <span>{i18n.t('settings.providers.emptyAction')}</span>
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <Card className="gap-0 py-0 divide-y divide-border/60 overflow-hidden">
                {settings.providers.map((p) => {
                  const isActive = p.id === settings.activeProviderId;
                  const isTesting = testingId === p.id;

                  return (
                    <div
                      key={p.id}
                      className={cn(
                        'flex items-center justify-between gap-2.5 p-2.5 transition-colors cursor-pointer group',
                        isActive ? 'bg-primary/5 dark:bg-primary/10' : 'hover:bg-muted/40',
                      )}
                      onClick={() => handleSetActiveProvider(p.id)}
                      title={isActive ? undefined : i18n.t('settings.providers.clickToActivate')}
                    >
                      {/* ① 前置控件槽: w-6 flex items-center justify-center shrink-0 */}
                      <div className="w-6 flex items-center justify-center shrink-0">
                        <span
                          className={cn(
                            'size-2 rounded-full transition-colors',
                            isActive ? 'bg-primary ring-2 ring-primary/20' : 'bg-muted-foreground/30 group-hover:bg-muted-foreground/60',
                          )}
                        />
                      </div>

                      {/* ② 文本块: flex-1 min-w-0 */}
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className={cn('font-medium text-[11px] truncate', isActive ? 'text-foreground font-semibold' : 'text-foreground')}>
                          {p.name || i18n.t('settings.providers.unnamed')}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate leading-tight font-mono">
                          {apiTypeLabel(p.api)} · {p.baseUrl || i18n.t('settings.providers.noBaseUrl')} · {i18n.t('settings.providers.modelsCount', { count: p.models.length })}
                        </div>
                      </div>

                      {/* ③ 右侧操作钮: flex items-center gap-1 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity */}
                      <div
                        className="flex items-center gap-1 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={isTesting}
                          onClick={() => handleTestProvider(p)}
                          className="size-6 text-muted-foreground hover:text-foreground cursor-pointer"
                          title={i18n.t('settings.providers.test')}
                        >
                          {isTesting ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3" />}
                          <span className="sr-only">{i18n.t('settings.providers.test')}</span>
                        </Button>

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => onEditProvider(p)}
                          className="size-6 text-muted-foreground hover:text-foreground cursor-pointer"
                          title={i18n.t('settings.providers.editTitle')}
                        >
                          <Pencil className="size-3" />
                          <span className="sr-only">{i18n.t('settings.providers.editTitle')}</span>
                        </Button>

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteProviderTarget(p)}
                          className="size-6 text-muted-foreground hover:text-destructive cursor-pointer"
                          title={i18n.t('settings.providers.deleteTitle')}
                        >
                          <Trash2 className="size-3" />
                          <span className="sr-only">{i18n.t('settings.providers.deleteTitle')}</span>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </Card>
            )}
          </div>
        )}

        {/* VIEW 1b: 模型分工 + 偏好(与提供商 CRUD 分页) */}
        {currentTab === 'models' && (
          <div className="space-y-4 animate-in fade-in-0 duration-150 motion-reduce:animate-none">
            {/* 1. 偏好节 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Languages className="size-3.5 text-muted-foreground" />
                  <span>{i18n.t('settings.pref.title')}</span>
                  <InfoTip content={i18n.t('settings.pref.desc')} />
                </h2>
              </div>

              <Card className="gap-0 py-0 divide-y divide-border/60 overflow-hidden">
                <div className="flex items-center justify-between gap-2 p-2.5">
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="font-medium text-foreground text-[11px]">{i18n.t('settings.pref.langLabel')}</span>
                    <InfoTip content={i18n.t('settings.pref.langDesc')} />
                  </div>
                  <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
                    <div className={cn((langDraft !== null || settings.language) ? 'w-20 shrink-0' : 'w-28 shrink-0')}>
                      <Select
                        value={settings.language || langDraft !== null ? 'custom' : 'auto'}
                        onValueChange={(val) => {
                          if (val === 'custom') {
                            // 进入编辑态:预填已有值,输入非空才落库
                            setLangDraft(settings.language ?? '');
                          } else {
                            setLangDraft(null);
                            onUpdateSettings({ ...settings, language: null });
                          }
                        }}
                      >
                        <SelectTrigger className="h-7 text-xs w-full">
                          <SelectValue placeholder={i18n.t('settings.pref.langAuto')} />
                        </SelectTrigger>
                        <SelectContent align="end">
                          <SelectItem value="auto" className="text-xs font-medium">
                            {i18n.t('settings.pref.langAuto')}
                          </SelectItem>
                          <SelectItem value="custom" className="text-xs">
                            {i18n.t('settings.pref.langCustom')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {(langDraft !== null || settings.language) && (
                      <Input
                        value={langDraft ?? settings.language ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setLangDraft(v);
                          onUpdateSettings({ ...settings, language: v.trim() || null });
                        }}
                        placeholder={i18n.t('settings.pref.langCustomPlaceholder')}
                        className="h-7 text-xs flex-1 min-w-0 bg-background"
                      />
                    )}
                  </div>
                </div>
              </Card>
            </div>

            {/* 2. 模型分工节 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-muted-foreground" />
                  <span>{i18n.t('settings.assignment.title')}</span>
                  <InfoTip content={i18n.t('settings.assignment.desc')} />
                </h2>
              </div>

              <Card className="gap-0 py-0 divide-y divide-border/60 overflow-hidden">
                {/* 1. 对话模型 */}
                <div className="flex items-center justify-between gap-2 p-2.5">
                  <div className="flex items-center gap-1.5 shrink-0 min-w-0">
                    <span className="font-medium text-foreground text-[11px] truncate">
                      {i18n.t('settings.assignment.chatModel')}
                    </span>
                    <InfoTip content={i18n.t('settings.assignment.chatModelDesc')} />
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="w-28 shrink-0">
                      <Select
                        value={chatModelValue}
                        onValueChange={(val) => {
                          if (val === '__none__') return;
                          const [pId, mId] = val.split('::');
                          if (pId && mId) {
                            onUpdateSettings({
                              ...settings,
                              activeProviderId: pId,
                              activeModelId: mId,
                            });
                          }
                        }}
                        disabled={allModelOptions.length === 0}
                      >
                        <SelectTrigger className="h-7 text-xs w-full">
                          <SelectValue placeholder={allModelOptions.length === 0 ? i18n.t('settings.assignment.noModelsAvailable') : i18n.t('settings.assignment.notSelected')} />
                        </SelectTrigger>
                        <SelectContent align="end" className="max-w-[280px] max-h-72 overflow-y-auto">
                          <SelectItem value="__none__" disabled className="hidden">
                            {allModelOptions.length === 0 ? i18n.t('settings.assignment.noModelsAvailable') : i18n.t('settings.assignment.notSelected')}
                          </SelectItem>
                          {renderModelGroups()}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-20 shrink-0">
                      <Select
                        value={effectiveChatReasoningLevel}
                        onValueChange={(val) => {
                          onUpdateSettings({
                            ...settings,
                            reasoningLevel: val as ReasoningLevel,
                          });
                        }}
                        disabled={!chatModel}
                      >
                        <SelectTrigger
                          className="h-7 text-xs w-full px-2 bg-muted/30 border-border/60 text-muted-foreground hover:text-foreground"
                          title={chatModel && chatModelSupportsReasoning ? i18n.t('settings.assignment.chatReasoningTitle') : i18n.t('settings.assignment.unsupportedReasoning')}
                        >
                          <SelectValue placeholder={i18n.t('settings.assignment.thinkingOff')} />
                        </SelectTrigger>
                        <SelectContent align="end" className="w-28">
                          <SelectItem value="off" className="text-xs">
                            {i18n.t('settings.assignment.thinkingOff')}
                          </SelectItem>
                          {chatSupportedLevels.map((lvl) => (
                            <SelectItem key={lvl} value={lvl} className="text-xs">
                              {REASONING_LEVEL_LABELS[lvl]?.full || lvl}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* 2. 标题生成模型 */}
                <div className="flex items-center justify-between gap-2 p-2.5">
                  <div className="flex items-center gap-1.5 shrink-0 min-w-0">
                    <span className="font-medium text-foreground text-[11px] truncate">
                      {i18n.t('settings.assignment.titleModel')}
                    </span>
                    <InfoTip content={i18n.t('settings.assignment.titleModelDesc')} />
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="w-28 shrink-0">
                      <Select
                        value={titleModelValue}
                        onValueChange={(val) => {
                          if (val === 'follow') {
                            onUpdateSettings({ ...settings, titleModel: null });
                          } else {
                            const [pId, mId] = val.split('::');
                            if (pId && mId) {
                              onUpdateSettings({
                                ...settings,
                                titleModel: { providerId: pId, modelId: mId },
                              });
                            }
                          }
                        }}
                      >
                        <SelectTrigger className="h-7 text-xs w-full">
                          <SelectValue placeholder={i18n.t('settings.assignment.followChatModel')} />
                        </SelectTrigger>
                        <SelectContent align="end" className="max-w-[280px] max-h-72 overflow-y-auto">
                          <SelectItem value="follow" className="text-xs font-medium">
                            {i18n.t('settings.assignment.followChatModel')}
                          </SelectItem>
                          {providersWithModels.length > 0 && <SelectSeparator />}
                          {renderModelGroups()}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-20 shrink-0">
                      <Select
                        value={settings.titleThinking}
                        onValueChange={(val) => {
                          onUpdateSettings({
                            ...settings,
                            titleThinking: val as AuxThinkingLevel,
                          });
                        }}
                      >
                        <SelectTrigger
                          className="h-7 text-xs w-full px-2 bg-muted/30 border-border/60 text-muted-foreground hover:text-foreground"
                          title={i18n.t('settings.assignment.titleReasoningTitle')}
                        >
                          <SelectValue placeholder={i18n.t('settings.assignment.thinkingOff')} />
                        </SelectTrigger>
                        <SelectContent align="end" className="w-28">
                          {AUX_THINKING_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value} className="text-xs">
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* 3. 快捷指令生成模型 */}
                <div className="flex items-center justify-between gap-2 p-2.5">
                  <div className="flex items-center gap-1.5 shrink-0 min-w-0">
                    <span className="font-medium text-foreground text-[11px] truncate">
                      {i18n.t('settings.assignment.promptModel')}
                    </span>
                    <InfoTip content={i18n.t('settings.assignment.promptModelDesc')} />
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="w-28 shrink-0">
                      <Select
                        value={quickPromptModelValue}
                        onValueChange={(val) => {
                          if (val === 'follow') {
                            onUpdateSettings({ ...settings, quickPromptModel: null });
                          } else {
                            const [pId, mId] = val.split('::');
                            if (pId && mId) {
                              onUpdateSettings({
                                ...settings,
                                quickPromptModel: { providerId: pId, modelId: mId },
                              });
                            }
                          }
                        }}
                      >
                        <SelectTrigger className="h-7 text-xs w-full">
                          <SelectValue placeholder={i18n.t('settings.assignment.followChatModel')} />
                        </SelectTrigger>
                        <SelectContent align="end" className="max-w-[280px] max-h-72 overflow-y-auto">
                          <SelectItem value="follow" className="text-xs font-medium">
                            {i18n.t('settings.assignment.followChatModel')}
                          </SelectItem>
                          {providersWithModels.length > 0 && <SelectSeparator />}
                          {renderModelGroups()}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-20 shrink-0">
                      <Select
                        value={settings.quickPromptThinking}
                        onValueChange={(val) => {
                          onUpdateSettings({
                            ...settings,
                            quickPromptThinking: val as AuxThinkingLevel,
                          });
                        }}
                      >
                        <SelectTrigger
                          className="h-7 text-xs w-full px-2 bg-muted/30 border-border/60 text-muted-foreground hover:text-foreground"
                          title={i18n.t('settings.assignment.promptReasoningTitle')}
                        >
                          <SelectValue placeholder={i18n.t('settings.assignment.thinkingOff')} />
                        </SelectTrigger>
                        <SelectContent align="end" className="w-28">
                          {AUX_THINKING_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value} className="text-xs">
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* VIEW: Prompt Settings (规则 / 技能 / 记忆) */}
        {currentTab === 'prompt' && (
          <SettingsPromptView settings={settings} onUpdateSettings={onUpdateSettings} />
        )}

        {/* VIEW 2: Search Settings */}
        {currentTab === 'search' && (
          <SearchSettingsView settings={settings} onUpdateSettings={onUpdateSettings} />
        )}

        {/* VIEW: Backup (导出/导入配置文件) */}
        {currentTab === 'backup' && (
          <SettingsBackupView
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            onRestoreAll={onRestoreAll}
            latestLocalSessionAt={latestLocalSessionAt}
            activeSessionId={activeSessionId}
          />
        )}

        {/* VIEW 3: Permissions Management */}
        {currentTab === 'permissions' && (
          <SettingsPermissionsView />
        )}

        {/* VIEW 5: About Page */}
        {currentTab === 'about' && (
          <div className="space-y-4 text-left animate-in fade-in-0 duration-150 motion-reduce:animate-none">
            {/* Section 1: Basic Info */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Bot className="size-3.5 text-muted-foreground" />
                  <span>{i18n.t('settings.about.extInfo')}</span>
                </h2>
                <span className="text-[10px] text-muted-foreground font-mono">
                  v{appVersion}
                </span>
              </div>

              <Card className="gap-1 p-3">
                <div className="text-xs font-semibold text-foreground">{appName}</div>
                <div className="text-[11px] text-muted-foreground">{i18n.t('settings.about.extDesc')}</div>
                <p className="text-[11px] text-muted-foreground leading-relaxed pt-1">
                  {i18n.t('settings.about.extIntro')}
                </p>
              </Card>
            </div>

            {/* Section 2: Supported Protocols */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Layers className="size-3.5 text-muted-foreground" />
                  <span>{i18n.t('settings.about.protocolsTitle')}</span>
                </h2>
                <span className="text-[10px] text-muted-foreground font-mono">{i18n.t('settings.about.protocolsCount')}</span>
              </div>

              <Card className="gap-0 py-0 divide-y divide-border/60 overflow-hidden">
                <div className="p-2.5 space-y-0.5">
                  <div className="font-medium text-foreground text-[11px]">{i18n.t('settings.about.chatCompletionsTitle')}</div>
                  <div className="text-[10px] text-muted-foreground leading-relaxed">
                    <code className="font-mono bg-muted px-1 py-0.2 rounded text-[10px]">/v1/chat/completions</code> {i18n.t('settings.about.chatCompletionsDesc')}
                  </div>
                </div>

                <div className="p-2.5 space-y-0.5">
                  <div className="font-medium text-foreground text-[11px]">{i18n.t('settings.about.responsesTitle')}</div>
                  <div className="text-[10px] text-muted-foreground leading-relaxed">
                    <code className="font-mono bg-muted px-1 py-0.2 rounded text-[10px]">/v1/responses</code> {i18n.t('settings.about.responsesDesc')}
                  </div>
                </div>

                <div className="p-2.5 space-y-0.5">
                  <div className="font-medium text-foreground text-[11px]">Anthropic Messages</div>
                  <div className="text-[10px] text-muted-foreground leading-relaxed">
                    <code className="font-mono bg-muted px-1 py-0.2 rounded text-[10px]">/v1/messages</code> {i18n.t('settings.about.messagesDesc')}
                  </div>
                </div>
              </Card>
            </div>

            {/* Section 3: Security & Privacy */}
            <Card className="p-3 flex-row items-start gap-2 text-muted-foreground text-[11px] leading-relaxed">
              <ShieldCheck className="size-3.5 shrink-0 mt-0.5 text-muted-foreground/80" />
              <div>
                <span className="font-medium text-foreground">{i18n.t('settings.about.dataSecurityTitle')}</span>
                {i18n.t('settings.about.dataSecurityDesc')}
              </div>
            </Card>
          </div>
        )}
        {/* 删除提供商二次确认(dialog 统一删除语义) */}
        <AlertDialog
          open={deleteProviderTarget !== null}
          onOpenChange={(open) => !open && setDeleteProviderTarget(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{i18n.t('settings.deleteConfirm.title')}</AlertDialogTitle>
              <AlertDialogDescription>
                {i18n.t('settings.deleteConfirm.desc', { name: deleteProviderTarget?.name || i18n.t('settings.providers.unnamed'), count: deleteProviderTarget?.models.length ?? 0 })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setDeleteProviderTarget(null)}>
                {i18n.t('settings.deleteConfirm.cancel')}
              </AlertDialogCancel>
              <AlertDialogAction
                className={buttonVariants({ variant: 'destructive' })}
                onClick={() => {
                  if (deleteProviderTarget) handleDeleteProvider(deleteProviderTarget.id);
                  setDeleteProviderTarget(null);
                }}
              >
                {i18n.t('settings.deleteConfirm.deleteAction')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
