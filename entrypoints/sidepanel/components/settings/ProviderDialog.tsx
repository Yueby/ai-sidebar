import React, { useState, useEffect, useMemo } from 'react';
import { i18n } from '#i18n';
import {
  Eye,
  EyeOff,
  Zap,
  CheckCircle2,
  XCircle,
  Plus,
  CloudDownload,
  RefreshCw,
  Pencil,
  Trash2,
  Search,
  Check,
  X,
} from 'lucide-react';
import type { ProviderConfig, ModelConfig, ApiType } from '@/lib/types';
import { API_TYPE_OPTIONS, createProviderDraft } from '@/lib/providers';
import {
  testConnection,
  fetchProviderModels,
  fetchModelsDevMeta,
  applyModelMeta,
  syncModelsWithModelsDev,
  type ModelMeta,
} from '@/lib/models';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn, getErrorMessage } from '@/lib/utils';
import { ModelConfigDialog } from './ModelConfigDialog';

interface ProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: ProviderConfig | null;
  isNew: boolean;
  onSave: (provider: ProviderConfig) => void;
}

/** 名称自然序比较(大小写不敏感 + 数字数值序):已添加列表与拉取候选共用同一排序规则 */
function compareByName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

interface FetchedCandidate {
  id: string;
  meta?: ModelMeta;
  isExisting: boolean;
}

export function ProviderDialog({
  open,
  onOpenChange,
  provider,
  isNew,
  onSave,
}: ProviderDialogProps) {
  const [draft, setDraft] = useState<ProviderConfig>(() =>
    provider ? { ...provider, models: [...provider.models] } : createProviderDraft()
  );

  const [showApiKey, setShowApiKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Inline model fetch & candidate selection states
  const [fetchingModels, setFetchingModels] = useState(false);
  const [syncingModels, setSyncingModels] = useState(false);
  const [fetchResultMsg, setFetchResultMsg] = useState<string | null>(null);
  const [fetchErrorMsg, setFetchErrorMsg] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState('');

  // Candidate selection list (populated when user clicks "拉取")
  const [candidates, setCandidates] = useState<FetchedCandidate[] | null>(null);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set());
  const [candidateSearch, setCandidateSearch] = useState('');

  // Model config dialog
  const [modelConfigTarget, setModelConfigTarget] = useState<ModelConfig | null>(null);
  const [modelConfigOpen, setModelConfigOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(
        provider
          ? { ...provider, models: [...provider.models] }
          : createProviderDraft()
      );
      setShowApiKey(false);
      setTestResult(null);
      setFetchResultMsg(null);
      setFetchErrorMsg(null);
      setModelSearch('');
      setCandidates(null);
      setSelectedCandidateIds(new Set());
      setCandidateSearch('');
    }
  }, [open, provider]);

  // Protocol change
  const handleApiChange = (newApi: ApiType) => {
    const defaultUrl =
      API_TYPE_OPTIONS.find((o) => o.value === newApi)?.defaultBaseUrl || draft.baseUrl;
    setDraft((prev) => ({
      ...prev,
      api: newApi,
      baseUrl: defaultUrl,
    }));
    setTestResult(null);
    setCandidates(null);
  };

  // Test connection
  const handleTest = async () => {
    if (!draft.baseUrl) return;
    setTesting(true);
    setTestResult(null);
    try {
      const msg = await testConnection({
        api: draft.api,
        baseUrl: draft.baseUrl,
        apiKey: draft.apiKey,
      });
      setTestResult({ success: true, message: msg });
    } catch (err: unknown) {
      setTestResult({
        success: false,
        message: getErrorMessage(err) || i18n.t('providerDialog.defaultConnectFailed'),
      });
    } finally {
      setTesting(false);
    }
  };

  // Fetch models and show candidates selection list
  const handleFetchModels = async () => {
    if (!draft.baseUrl) return;
    setFetchingModels(true);
    setFetchResultMsg(null);
    setFetchErrorMsg(null);
    setCandidates(null);
    setSelectedCandidateIds(new Set());
    setCandidateSearch('');

    try {
      const [remoteIds, devMetaMap] = await Promise.all([
        fetchProviderModels({
          api: draft.api,
          baseUrl: draft.baseUrl,
          apiKey: draft.apiKey,
        }),
        fetchModelsDevMeta(),
      ]);

      if (remoteIds.length === 0) {
        setFetchResultMsg(i18n.t('providerDialog.noModelsFetched'));
        return;
      }

      const existingSet = new Set(draft.models.map((m) => m.id));
      const candidateList: FetchedCandidate[] = remoteIds.map((id) => ({
        id,
        meta: devMetaMap.get(id),
        isExisting: existingSet.has(id),
      }));

      setCandidates(candidateList);

      // Default select all newly discovered models
      const newIds = new Set(candidateList.filter((c) => !c.isExisting).map((c) => c.id));
      setSelectedCandidateIds(newIds);
    } catch (err: unknown) {
      setFetchErrorMsg(getErrorMessage(err) || i18n.t('providerDialog.fetchFailed'));
    } finally {
      setFetchingModels(false);
    }
  };

  // Toggle selection for candidate
  const toggleCandidateSelection = (id: string) => {
    setSelectedCandidateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Toggle select all filtered candidates
  const toggleSelectAllCandidates = (filtered: FetchedCandidate[]) => {
    const selectable = filtered.filter((c) => !c.isExisting);
    const allSelected = selectable.every((c) => selectedCandidateIds.has(c.id));

    setSelectedCandidateIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        selectable.forEach((c) => next.delete(c.id));
      } else {
        selectable.forEach((c) => next.add(c.id));
      }
      return next;
    });
  };

  // Import selected candidates
  const handleImportSelectedCandidates = () => {
    if (!candidates) return;

    const existingMap = new Map(draft.models.map((m) => [m.id, m]));
    let count = 0;

    for (const c of candidates) {
      if (selectedCandidateIds.has(c.id) && !c.isExisting && !existingMap.has(c.id)) {
        const enriched = applyModelMeta({ id: c.id }, c.meta);
        existingMap.set(c.id, enriched);
        count++;
      }
    }

    setDraft((prev) => ({ ...prev, models: Array.from(existingMap.values()) }));
    setCandidates(null);
    setFetchResultMsg(i18n.t('providerDialog.importedSuccess', { count }));
  };

  // Sync parameters with models.dev
  const handleSyncModels = async () => {
    if (draft.models.length === 0) return;
    setSyncingModels(true);
    setFetchResultMsg(null);
    setFetchErrorMsg(null);

    try {
      const { models: updatedModels, updatedCount } = await syncModelsWithModelsDev(draft.models);
      setDraft((prev) => ({ ...prev, models: updatedModels }));
      if (updatedCount > 0) {
        setFetchResultMsg(i18n.t('providerDialog.syncUpdated', { count: updatedCount }));
      } else {
        setFetchResultMsg(i18n.t('providerDialog.syncUpToDate'));
      }
    } catch (err: unknown) {
      setFetchErrorMsg(getErrorMessage(err) || i18n.t('providerDialog.syncFailed'));
    } finally {
      setSyncingModels(false);
    }
  };

  // Save model from config dialog
  const handleSaveModelConfig = (savedModel: ModelConfig) => {
    setDraft((prev) => {
      const idx = prev.models.findIndex((m) => m.id === savedModel.id);
      if (idx >= 0) {
        const nextModels = [...prev.models];
        nextModels[idx] = savedModel;
        return { ...prev, models: nextModels };
      }
      return { ...prev, models: [...prev.models, savedModel] };
    });
  };

  const handleDeleteModel = (modelId: string) => {
    setDraft((prev) => ({
      ...prev,
      models: prev.models.filter((m) => m.id !== modelId),
    }));
  };

  const handleSave = () => {
    const finalProvider: ProviderConfig = {
      ...draft,
      name: draft.name.trim() || i18n.t('providerDialog.unnamedProvider'),
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
    };
    onSave(finalProvider);
    onOpenChange(false);
  };

  const formatTokens = (n?: number) => {
    if (!n) return null;
    return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
  };

  // 模型列表按名称自然序排序(大小写不敏感;拉取与手动添加一视同仁)
  const sortedModels = useMemo(
    () =>
      [...draft.models].sort((a, b) =>
        compareByName(a.displayName || a.id, b.displayName || b.id),
      ),
    [draft.models],
  );

  const filteredModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    const base = sortedModels;
    if (!q) return base;
    return base.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        (m.displayName && m.displayName.toLowerCase().includes(q))
    );
  }, [sortedModels, modelSearch]);

  const filteredCandidates = useMemo(() => {
    if (!candidates) return [];
    const q = candidateSearch.trim().toLowerCase();
    // 与已添加列表同一自然序(先排序后过滤,保序;候选显示名 = models.dev meta.name ?? id)
    const sorted = [...candidates].sort((a, b) =>
      compareByName(a.meta?.name || a.id, b.meta?.name || b.id)
    );
    if (!q) return sorted;
    return sorted.filter(
      (c) =>
        c.id.toLowerCase().includes(q) ||
        (c.meta?.name && c.meta.name.toLowerCase().includes(q))
    );
  }, [candidates, candidateSearch]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[88vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {isNew ? i18n.t('providerDialog.addTitle') : i18n.t('providerDialog.editTitle')}
            </DialogTitle>
            <DialogDescription>
              {i18n.t('providerDialog.subtitle')}
            </DialogDescription>
          </DialogHeader>

          {/* Form Content */}
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {/* Provider Name */}
            <div className="space-y-1">
              <Label className="text-xs">{i18n.t('providerDialog.nameLabel')}</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                placeholder={i18n.t('providerDialog.namePlaceholder')}
                className="h-8 text-xs"
              />
            </div>

            {/* Protocol */}
            <div className="space-y-1">
              <Label className="text-xs">{i18n.t('providerDialog.apiLabel')}</Label>
              <Select items={API_TYPE_OPTIONS} value={draft.api} onValueChange={(v) => handleApiChange(v as ApiType)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={i18n.t('providerDialog.apiPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {API_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Base URL */}
            <div className="space-y-1">
              <Label className="text-xs">Base URL</Label>
              <Input
                value={draft.baseUrl}
                onChange={(e) => setDraft((p) => ({ ...p, baseUrl: e.target.value }))}
                placeholder="https://api.openai.com/v1"
                className="h-8 text-xs font-mono truncate"
              />
            </div>

            {/* API Key */}
            <div className="space-y-1">
              <Label className="text-xs">API Key</Label>
              <div className="relative">
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  value={draft.apiKey}
                  onChange={(e) => setDraft((p) => ({ ...p, apiKey: e.target.value }))}
                  placeholder="sk-..."
                  className="h-8 text-xs font-mono pr-8 truncate"
                />
                <TooltipProvider delay={200}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          onClick={() => setShowApiKey((v) => !v)}
                          className="absolute right-2 top-2 text-muted-foreground hover:text-foreground cursor-pointer"
                          aria-label={showApiKey ? i18n.t('providerDialog.hideApiKey') : i18n.t('providerDialog.showApiKey')}
                        >
                          {showApiKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                        </button>
                      }
                    />
                    <TooltipContent side="top">
                      {showApiKey ? i18n.t('providerDialog.hideApiKey') : i18n.t('providerDialog.showApiKey')}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>

            {/* Test Connection Button & Result */}
            <div className="flex items-center gap-2 pt-0.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={testing || !draft.baseUrl}
                onClick={handleTest}
                className="h-7 text-xs gap-1.5"
              >
                {testing ? (
                  <Spinner className="size-3" />
                ) : (
                  <Zap className="size-3" />
                )}
                <span>{testing ? i18n.t('providerDialog.testing') : i18n.t('providerDialog.testConnectivity')}</span>
              </Button>

              {testResult && (
                <div className="text-[11px] truncate flex-1 font-medium">
                  <span className={testResult.success ? 'text-foreground' : 'text-destructive'}>
                    {testResult.message}
                  </span>
                </div>
              )}
            </div>

            <Separator className="my-2" />

            {/* Inline Candidate Selection Box (Expanded when candidates is not null) */}
            {candidates ? (
              <div className="rounded-lg border bg-muted/20 p-2.5 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-1">
                  <div className="font-medium text-foreground text-xs flex items-center gap-1 min-w-0">
                    <span className="truncate">{i18n.t('providerDialog.pickModels')}</span>
                    <Badge variant="secondary" className="text-[10px] h-4 px-1 font-normal">
                      {candidates.length}
                    </Badge>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleSelectAllCandidates(filteredCandidates)}
                    className="h-6 text-[11px] px-1.5 font-normal"
                  >
                    {i18n.t('providerDialog.selectAll')}
                  </Button>
                </div>

                {/* Candidate filter input */}
                {candidates.length > 3 && (
                  <div className="relative">
                    <Search className="absolute left-2 top-2 size-3 text-muted-foreground" />
                    <Input
                      value={candidateSearch}
                      onChange={(e) => setCandidateSearch(e.target.value)}
                      placeholder={i18n.t('providerDialog.filterCandidatePlaceholder')}
                      className="h-7 pl-7 text-xs font-mono"
                    />
                  </div>
                )}

                {/* Candidate list items */}
                <div className="flex flex-col gap-1 max-h-44 overflow-y-auto pr-0.5">
                  {filteredCandidates.length === 0 ? (
                    <div className="py-4 text-center text-xs text-muted-foreground">
                      {i18n.t('providerDialog.noMatchingModels')}
                    </div>
                  ) : (
                    filteredCandidates.map((c) => {
                      const isChecked = selectedCandidateIds.has(c.id);
                      const isExisting = c.isExisting;
                      const ctx = formatTokens(c.meta?.contextWindow);
                      const out = formatTokens(c.meta?.maxTokens);

                      return (
                        <Label
                          key={c.id}
                          className={cn(
                            'flex items-start gap-2 rounded border bg-card p-1.5 text-left select-none transition-colors font-normal',
                            isExisting
                              ? 'opacity-50 border-border bg-muted/40 cursor-not-allowed'
                              : 'cursor-pointer hover:bg-accent/40'
                          )}
                        >
                          <Checkbox
                            checked={isChecked || isExisting}
                            disabled={isExisting}
                            onCheckedChange={() => !isExisting && toggleCandidateSelection(c.id)}
                            className="mt-0.5"
                          />

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="truncate font-mono text-xs font-medium text-foreground">
                                {c.id}
                              </span>
                              {c.meta?.name && (
                                <span className="truncate text-[10px] text-muted-foreground">
                                  ({c.meta.name})
                                </span>
                              )}
                              {isExisting && (
                                <Badge variant="secondary" className="text-[9px] h-3.5 px-1 font-normal">
                                  {i18n.t('providerDialog.added')}
                                </Badge>
                              )}
                            </div>

                            {c.meta && (
                              <div className="flex items-center gap-1 mt-0.5 flex-wrap text-[10px] text-muted-foreground">
                                {ctx && <span>{ctx} ctx</span>}
                                {out && <span>· {out} out</span>}
                                {c.meta.vision && (
                                  <Badge variant="outline" className="text-[9px] h-3.5 px-1 font-normal">
                                    Vision
                                  </Badge>
                                )}
                                {c.meta.reasoning && (
                                  <Badge variant="outline" className="text-[9px] h-3.5 px-1 font-normal">
                                    {i18n.t('providerDialog.badgeReasoning')}
                                  </Badge>
                                )}
                                {c.meta.tools && (
                                  <Badge variant="outline" className="text-[9px] h-3.5 px-1 font-normal">
                                    {i18n.t('providerDialog.badgeTools')}
                                  </Badge>
                                )}
                              </div>
                            )}
                          </div>
                        </Label>
                      );
                    })
                  )}
                </div>

                {/* Candidate actions */}
                <div className="flex items-center justify-between pt-1 border-t">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCandidates(null)}
                    className="h-6.5 text-xs px-2"
                  >
                    {i18n.t('providerDialog.cancel')}
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    disabled={selectedCandidateIds.size === 0}
                    onClick={handleImportSelectedCandidates}
                    className="h-6.5 text-xs px-2.5"
                  >
                    {i18n.t('providerDialog.importSelected', { count: selectedCandidateIds.size })}
                  </Button>
                </div>
              </div>
            ) : (
              /* Normal Model Management */
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium text-foreground flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{i18n.t('providerDialog.modelList')}</span>
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-normal">
                      {draft.models.length}
                    </Badge>
                  </div>

                  <TooltipProvider delay={200}>
                    <div className="flex items-center gap-1 shrink-0">
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span className="inline-flex">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={fetchingModels || syncingModels || !draft.baseUrl}
                                onClick={handleFetchModels}
                                className="h-6.5 text-xs gap-1 px-1.5"
                                aria-label={i18n.t('providerDialog.fetchModelsTitle')}
                              >
                                {fetchingModels ? (
                                  <Spinner className="size-3" />
                                ) : (
                                  <CloudDownload className="size-3" />
                                )}
                                <span>{fetchingModels ? i18n.t('providerDialog.fetching') : i18n.t('providerDialog.fetch')}</span>
                              </Button>
                            </span>
                          }
                        />
                        <TooltipContent side="top">
                          {i18n.t('providerDialog.fetchModelsTitle')}
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span className="inline-flex">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={syncingModels || fetchingModels || draft.models.length === 0}
                                onClick={handleSyncModels}
                                className="h-6.5 text-xs gap-1 px-1.5"
                                aria-label={i18n.t('providerDialog.syncModelsTitle')}
                              >
                                {syncingModels ? (
                                  <Spinner className="size-3" />
                                ) : (
                                  <RefreshCw className="size-3" />
                                )}
                                <span>{syncingModels ? i18n.t('providerDialog.syncing') : i18n.t('providerDialog.sync')}</span>
                              </Button>
                            </span>
                          }
                        />
                        <TooltipContent side="top">
                          {i18n.t('providerDialog.syncModelsTitle')}
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setModelConfigTarget(null);
                                setModelConfigOpen(true);
                              }}
                              className="h-6.5 text-xs gap-1 px-1.5"
                              aria-label={i18n.t('providerDialog.addManualTitle')}
                            >
                              <Plus className="size-3" />
                              <span>{i18n.t('providerDialog.manual')}</span>
                            </Button>
                          }
                        />
                        <TooltipContent side="top">
                          {i18n.t('providerDialog.addManualTitle')}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </TooltipProvider>
                </div>

                {/* Inline fetch status feedback */}
                {fetchResultMsg && (
                  <div className="text-[11px] text-muted-foreground bg-muted/40 p-1.5 rounded">
                    {fetchResultMsg}
                  </div>
                )}
                {fetchErrorMsg && (
                  <div className="text-[11px] text-destructive bg-destructive/10 p-1.5 rounded">
                    {fetchErrorMsg}
                  </div>
                )}

                {/* Search input for models */}
                {draft.models.length > 3 && (
                  <div className="relative">
                    <Search className="absolute left-2 top-2 size-3 text-muted-foreground" />
                    <Input
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      placeholder={i18n.t('providerDialog.filterModelsPlaceholder')}
                      className="h-7 pl-7 text-xs font-mono"
                    />
                  </div>
                )}

                {/* Model items */}
                {draft.models.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                    <p>{i18n.t('providerDialog.noModelsTitle')}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                      {i18n.t('providerDialog.noModelsDesc')}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-0.5">
                    {filteredModels.map((m) => {
                      const ctx = formatTokens(m.contextWindow);
                      const out = formatTokens(m.maxTokens);

                      return (
                        <div
                          key={m.id}
                          className="group relative flex items-center justify-between rounded-lg border bg-card p-2 text-left"
                        >
                          <div className="flex flex-1 flex-col min-w-0 pr-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="truncate text-xs font-mono font-medium text-foreground">
                                {m.id}
                              </span>
                              {m.displayName && (
                                <span className="truncate text-[10px] text-muted-foreground">
                                  ({m.displayName})
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1 mt-0.5 flex-wrap text-[10px] text-muted-foreground">
                              {ctx && <span>{ctx} ctx</span>}
                              {out && <span>· {out} out</span>}
                              {m.vision && (
                                <Badge variant="outline" className="text-[9px] h-3.5 px-1 font-normal">
                                  Vision
                                </Badge>
                              )}
                              {m.reasoning && (
                                <Badge variant="outline" className="text-[9px] h-3.5 px-1 font-normal">
                                  {i18n.t('providerDialog.badgeReasoning')}
                                </Badge>
                              )}
                              {m.tools && (
                                <Badge variant="outline" className="text-[9px] h-3.5 px-1 font-normal">
                                  {i18n.t('providerDialog.badgeTools')}
                                </Badge>
                              )}
                            </div>
                          </div>

                          <TooltipProvider delay={200}>
                            <div className="flex items-center gap-0.5 shrink-0">
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => {
                                        setModelConfigTarget(m);
                                        setModelConfigOpen(true);
                                      }}
                                      className="size-6 text-muted-foreground hover:text-foreground"
                                      aria-label={i18n.t('providerDialog.configParamsTitle')}
                                    >
                                      <Pencil className="size-3" />
                                    </Button>
                                  }
                                />
                                <TooltipContent side="top">
                                  {i18n.t('providerDialog.configParamsTitle')}
                                </TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => handleDeleteModel(m.id)}
                                      className="size-6 text-muted-foreground hover:text-destructive"
                                      aria-label={i18n.t('providerDialog.deleteModelTitle')}
                                    >
                                      <Trash2 className="size-3" />
                                    </Button>
                                  }
                                />
                                <TooltipContent side="top">
                                  {i18n.t('providerDialog.deleteModelTitle')}
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </TooltipProvider>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="flex-row justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-7 text-xs"
            >
              {i18n.t('providerDialog.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!draft.name.trim() || !draft.baseUrl.trim()}
              onClick={handleSave}
              className="h-7 text-xs"
            >
              {i18n.t('providerDialog.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Model Config Dialog */}
      <ModelConfigDialog
        open={modelConfigOpen}
        onOpenChange={setModelConfigOpen}
        model={modelConfigTarget}
        onSave={handleSaveModelConfig}
      />
    </>
  );
}
