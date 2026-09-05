import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Download, Upload, FileJson, TriangleAlert, CloudUpload, CloudDownload, CloudCog, Loader2, Eye, EyeOff } from 'lucide-react';
import type { Settings, Session } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { sanitizeSettings } from '@/lib/storage';
import { i18n } from '#i18n';
import { buildSyncBundle, serializeSyncBundle, parseSyncBlob, decryptSyncBlob, formatBytes, type SyncBundle } from '@/lib/syncPayload';
import { webdavProbe, webdavPut, webdavGet, validateConfig, joinDavUrl, type WebdavConfig } from '@/lib/webdav';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface SettingsBackupViewProps {
  settings: Settings;
  onUpdateSettings: (settings: Settings) => void;
  /** WebDAV 恢复的全量落盘与 store 刷新由 App 完成(会话/激活项/设置一体替换) */
  onRestoreAll: (bundle: SyncBundle) => void;
  /** 本地最新会话时间(冲突对比展示用) */
  latestLocalSessionAt: number | null;
  /** 当前激活会话(上传快照元数据) */
  activeSessionId: string | null;
}

type DavConfig = Settings['webdav'];

/**
 * 备份视图: 本地导出/导入 + WebDAV 同步(全量快照,手动推拉,冲突手动选边)。
 * 加密开关开 = 密码派生 AES-GCM 加密整个备份;关 = 明文上传(含 API Key,红字警示)。
 */
export function SettingsBackupView({ settings, onUpdateSettings, onRestoreAll, latestLocalSessionAt, activeSessionId }: SettingsBackupViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [davBusy, setDavBusy] = useState<'test' | 'upload' | 'restore' | null>(null);
  const [remoteBundle, setRemoteBundle] = useState<SyncBundle | null>(null);
  const [remoteSize, setRemoteSize] = useState<number | null>(null);
  const [needPassword, setNeedPassword] = useState(false);
  const [visiblePassword, setVisiblePassword] = useState<'webdav' | 'encrypt' | null>(null);
  // 远端备份是加密的而本地开关为关时,临时显示密码输入(恢复需要)
  const dav = settings.webdav;

  const updateDav = (patch: Partial<DavConfig>) => {
    onUpdateSettings({ ...settings, webdav: { ...dav, ...patch } });
  };

  const davConfig: WebdavConfig = {
    url: dav.url,
    username: dav.username,
    password: dav.password,
  };

  const handleExport = () => {
    setBusy('export');
    try {
      const payload = {
        app: 'ai-sidebar',
        version: 1,
        exportedAt: new Date().toISOString(),
        settings,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      a.href = url;
      a.download = `ai-sidebar-backup-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(i18n.t('backup.toast.exportSuccess'));
    } catch {
      toast.error(i18n.t('backup.toast.exportFailed'));
    } finally {
      setBusy(null);
    }
  };

  const handleImportFile = async (file: File) => {
    setBusy('import');
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const raw =
        parsed && typeof parsed === 'object' && 'settings' in parsed
          ? (parsed as { settings: unknown }).settings
          : parsed;
      const next = sanitizeSettings(raw);
      if (next.providers.length === 0) {
        toast.error(i18n.t('backup.toast.importNoValidConfig'));
        return;
      }
      onUpdateSettings(next);
      toast.success(i18n.t('backup.toast.importSuccess', { count: next.providers.length }));
    } catch {
      toast.error(i18n.t('backup.toast.importInvalidJson'));
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async () => {
    setDavBusy('test');
    try {
      const res = await webdavProbe(davConfig);
      if (res.ok) toast.success(i18n.t('sync.testOk'));
      else toast.error(res.error ?? i18n.t('sync.testFailed'));
    } finally {
      setDavBusy(null);
    }
  };

  const handleUpload = async () => {
    const invalid = validateConfig(davConfig);
    if (invalid) { toast.error(invalid); return; }
    if (dav.encrypt && !dav.encryptPassword) { toast.error(i18n.t('sync.error.needEncryptPassword')); return; }
    setDavBusy('upload');
    try {
      const bundle = await buildSyncBundle(settings, activeSessionId);
      const blob = await serializeSyncBundle(bundle, dav.encrypt ? dav.encryptPassword : undefined);
      await webdavPut(davConfig, dav.remotePath, blob);
      toast.success(i18n.t('sync.uploadSuccess', { size: formatBytes(blob.length) }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('sync.error.network'));
    } finally {
      setDavBusy(null);
    }
  };

  const handleRestoreClick = async () => {
    const invalid = validateConfig(davConfig);
    if (invalid) { toast.error(invalid); return; }
    setDavBusy('restore');
    try {
      const blob = await webdavGet(davConfig, dav.remotePath);
      if (!blob) { toast.info(i18n.t('sync.noRemote')); return; }
      const parsed = await parseSyncBlob(blob);
      if (parsed.kind === 'invalid') { toast.error(parsed.error); return; }
      let bundle: SyncBundle;
      if (parsed.kind === 'encrypted') {
        if (!dav.encryptPassword) {
          setNeedPassword(true);
          toast.error(i18n.t('sync.error.needEncryptPassword'));
          return;
        }
        bundle = await decryptSyncBlob(parsed.blob, dav.encryptPassword);
      } else {
        bundle = parsed.bundle;
      }
      setRemoteSize(blob.length);
      setRemoteBundle(bundle);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('sync.error.network'));
    } finally {
      setDavBusy(null);
    }
  };

  const handleRestoreConfirm = async () => {
    if (!remoteBundle) return;
    const sessions = remoteBundle.sessions;
    // 落盘唯一入口 = App 的 onRestoreAll(内含流式守卫 + IDB 原子替换),视图不直接写
    try {
      await onRestoreAll({ ...remoteBundle, sessions });
      setRemoteBundle(null);
      setNeedPassword(false);
      toast.success(i18n.t('sync.restoreSuccess', { count: sessions.length }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('sync.error.network'));
    }
  };

  const fmtTime = (ts: number | undefined) => (ts ? new Date(ts).toLocaleString() : '—');

  /** 密码输入(带显示/隐藏切换):visibleKey 区分多个密码框 */
  const renderPasswordInput = (
    visibleKey: 'webdav' | 'encrypt',
    value: string,
    onChange: (v: string) => void,
    placeholderClass = 'bg-background',
  ) => {
    const visible = visiblePassword === visibleKey;
    return (
      <div className="relative">
        <Input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={'h-7 text-xs pr-8 ' + placeholderClass}
        />
        <button
          type="button"
          onClick={() => setVisiblePassword(visible ? null : visibleKey)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
          title={visible ? i18n.t('sync.hidePassword') : i18n.t('sync.showPassword')}
        >
          {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-3.5 text-left animate-in fade-in-0 duration-150 motion-reduce:animate-none">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <FileJson className="size-3.5 text-muted-foreground" />
            <span>{i18n.t('backup.title')}</span>
          </h2>
          <span className="text-[10px] text-muted-foreground font-mono">JSON</span>
        </div>

        <div className="rounded-lg border bg-card p-3 space-y-2.5">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {i18n.t('backup.desc')}
          </p>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={handleExport}
              className="gap-1.5 h-7 text-xs flex-1 cursor-pointer"
            >
              <Download className="size-3.5" />
              <span>{i18n.t('backup.exportButton')}</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => fileInputRef.current?.click()}
              className="gap-1.5 h-7 text-xs flex-1 cursor-pointer"
            >
              <Upload className="size-3.5" />
              <span>{i18n.t('backup.importButton')}</span>
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void handleImportFile(file);
              }}
            />
          </div>

          {/* 收敛为单行紧凑警示 */}
          <div className="flex items-center gap-1.5 text-[10px] text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-md px-2.5 py-1.5">
            <TriangleAlert className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="leading-snug">
              {i18n.t('backup.warning')}
            </span>
          </div>
        </div>
      </div>

      {/* WebDAV 同步段 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <CloudCog className="size-3.5 text-muted-foreground" />
            <span>{i18n.t('sync.title')}</span>
          </h2>
          <span className="text-[10px] text-muted-foreground font-mono">WebDAV</span>
        </div>

        <div className="rounded-lg border bg-card p-3 space-y-2.5 text-xs">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {i18n.t('sync.desc')}
          </p>

          <div className="space-y-2">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">{i18n.t('sync.urlLabel')}</Label>
              <Input
                value={dav.url}
                onChange={(e) => updateDav({ url: e.target.value })}
                placeholder={i18n.t('sync.urlPlaceholder')}
                className="h-7 text-xs bg-background"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">{i18n.t('sync.usernameLabel')}</Label>
                <Input
                  value={dav.username}
                  onChange={(e) => updateDav({ username: e.target.value })}
                  className="h-7 text-xs bg-background"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">{i18n.t('sync.passwordLabel')}</Label>
                {renderPasswordInput('webdav', dav.password, (v) => updateDav({ ...dav, password: v }))}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">{i18n.t('sync.pathLabel')}</Label>
              <Input
                value={dav.remotePath}
                onChange={(e) => updateDav({ remotePath: e.target.value })}
                className="h-7 text-xs font-mono bg-background"
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={davBusy !== null}
              onClick={handleTest}
              className="h-7 text-xs cursor-pointer"
            >
              {davBusy === 'test' && <Loader2 className="size-3.5 animate-spin" />}
              <span>{i18n.t('sync.testButton')}</span>
            </Button>
          </div>

          <div className="border-t border-border/50 pt-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-foreground">{i18n.t('sync.encryptLabel')}</div>
                <div className="text-[10px] text-muted-foreground leading-snug">{i18n.t('sync.encryptDesc')}</div>
              </div>
              <Switch
                checked={dav.encrypt}
                onCheckedChange={(v) => updateDav({ encrypt: v === true })}
                className="shrink-0 cursor-pointer"
              />
            </div>
            {(dav.encrypt || needPassword) && (
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">{i18n.t('sync.encryptPasswordLabel')}</Label>
                {renderPasswordInput('encrypt', dav.encryptPassword, (v) => updateDav({ ...dav, encryptPassword: v }))}
              </div>
            )}
            {!dav.encrypt && (
              <div className="flex items-center gap-1.5 text-[10px] text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-md px-2.5 py-1.5">
                <TriangleAlert className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="leading-snug">{i18n.t('sync.encryptWarning')}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-border/50 pt-2.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={davBusy !== null}
              onClick={handleUpload}
              className="gap-1.5 h-7 text-xs flex-1 cursor-pointer"
            >
              {davBusy === 'upload' ? <Loader2 className="size-3.5 animate-spin" /> : <CloudUpload className="size-3.5" />}
              <span>{i18n.t('sync.upload')}</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={davBusy !== null}
              onClick={handleRestoreClick}
              className="gap-1.5 h-7 text-xs flex-1 cursor-pointer"
            >
              {davBusy === 'restore' ? <Loader2 className="size-3.5 animate-spin" /> : <CloudDownload className="size-3.5" />}
              <span>{i18n.t('sync.restore')}</span>
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground leading-snug">
            {i18n.t('sync.remoteHint')}
          </p>
        </div>
      </div>

      {/* 恢复确认:展示远端/本地时间对比,选边由用户显式点击 */}
      <AlertDialog open={remoteBundle !== null} onOpenChange={(open) => !open && setRemoteBundle(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{i18n.t('sync.restoreConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {i18n.t('sync.restoreConfirmDesc', { time: fmtTime(remoteBundle?.exportedAt) })}
              <br />
              {i18n.t('sync.restoreConfirmLocal', { time: fmtTime(latestLocalSessionAt ?? 0) })}
              {remoteSize !== null ? `\n${i18n.t('sync.restoreConfirmSize', { size: formatBytes(remoteSize) })}` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setRemoteBundle(null)}>{i18n.t('sync.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleRestoreConfirm}
            >
              {i18n.t('sync.restoreConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
