import { useRef, useState } from 'react';
import { Download, Upload, FileJson, TriangleAlert } from 'lucide-react';
import type { Settings } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { sanitizeSettings } from '@/lib/storage';

interface SettingsBackupViewProps {
  settings: Settings;
  onUpdateSettings: (settings: Settings) => void;
}

/**
 * 备份视图:配置文件导出/导入(重启 dev / 更换 profile 后一键恢复)。
 * 备份包含 API Key 明文——UI 明确警示;导入走 sanitizeSettings 校验。
 */
export function SettingsBackupView({ settings, onUpdateSettings }: SettingsBackupViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );

  const handleExport = () => {
    setBusy('export');
    setFeedback(null);
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
      setFeedback({
        type: 'success',
        message: '备份文件已下载。注意:备份包含 API Key 明文,请妥善保管,不要分享给他人。',
      });
    } catch {
      setFeedback({ type: 'error', message: '导出失败,请重试。' });
    } finally {
      setBusy(null);
    }
  };

  const handleImportFile = async (file: File) => {
    setBusy('import');
    setFeedback(null);
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const raw =
        parsed && typeof parsed === 'object' && 'settings' in parsed
          ? (parsed as { settings: unknown }).settings
          : parsed;
      const next = sanitizeSettings(raw);
      if (next.providers.length === 0) {
        setFeedback({
          type: 'error',
          message: '导入失败:文件中没有提供商配置,不是有效的备份文件。',
        });
        return;
      }
      onUpdateSettings(next);
      setFeedback({
        type: 'success',
        message: `已导入 ${next.providers.length} 个提供商的配置(已覆盖当前设置)。`,
      });
    } catch {
      setFeedback({ type: 'error', message: '导入失败:文件不是有效的备份 JSON。' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 text-left animate-in fade-in-0 duration-150 motion-reduce:animate-none">
      {/* 导出/导入合并区块 */}
      <div className="rounded-lg border bg-card p-3 space-y-2.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <FileJson className="size-3.5 text-muted-foreground" />
          <span>配置备份</span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          将所有提供商配置、API Key、模型参数与设置导出为 JSON 文件;重启开发环境或更换
          Profile 后导入即可一键恢复。
          <span className="text-amber-600 dark:text-amber-400">
            导入将覆盖当前的全部配置
          </span>
          。
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={handleExport}
            className="gap-1.5 h-6.5 text-[11px] flex-1"
          >
            <Download className="size-3.5" />
            <span>导出配置文件</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => fileInputRef.current?.click()}
            className="gap-1.5 h-6.5 text-[11px] flex-1"
          >
            <Upload className="size-3.5" />
            <span>导入备份文件…</span>
          </Button>
        </div>
        <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
          <TriangleAlert className="size-3 shrink-0 mt-0.5" />
          <span>
            备份文件包含全部 API Key 明文,等同于账号凭据——请像保管密码一样保管,不要分享给他人。
          </span>
        </div>
      </div>

      {/* 反馈条 */}
      {feedback && (
        <div
          className={`rounded-md border p-2.5 text-[11px] leading-relaxed flex items-start gap-1.5 ${
            feedback.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
              : 'border-destructive/30 bg-destructive/10 text-destructive'
          }`}
        >
          <TriangleAlert className="size-3.5 shrink-0 mt-0.5" />
          <span>{feedback.message}</span>
        </div>
      )}
    </div>
  );
}
