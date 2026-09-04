import { useRef } from 'react';
import { toast } from 'sonner';
import { Download, Upload, FileJson, TriangleAlert } from 'lucide-react';
import type { Settings } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { sanitizeSettings } from '@/lib/storage';

interface SettingsBackupViewProps {
  settings: Settings;
  onUpdateSettings: (settings: Settings) => void;
}

/**
 * 备份视图: 配置文件导出/导入(重启 dev / 更换 profile 后一键恢复)。
 * 导出与导入紧凑成组，单行警示，无多余卡片嵌套。
 */
export function SettingsBackupView({ settings, onUpdateSettings }: SettingsBackupViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);

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
      toast.success('备份文件已导出并下载。');
    } catch {
      toast.error('导出失败，请重试。');
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
        toast.error('导入失败：文件中未包含有效提供商配置。');
        return;
      }
      onUpdateSettings(next);
      toast.success(`已成功导入 ${next.providers.length} 个提供商配置（已覆盖当前设置）。`);
    } catch {
      toast.error('导入失败：文件不是合法的 JSON 备份。');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3.5 text-left animate-in fade-in-0 duration-150 motion-reduce:animate-none">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <FileJson className="size-3.5 text-muted-foreground" />
            <span>配置备份与恢复</span>
          </h2>
          <span className="text-[10px] text-muted-foreground font-mono">JSON</span>
        </div>

        <div className="rounded-lg border bg-card p-3 space-y-2.5">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            导出所有提供商配置、API Key 与模型设置；在环境重置或换机时导入即可一键恢复。
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
              <span>导出配置文件</span>
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
              <span>导入备份文件…</span>
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
              备份含 API Key 明文请妥善保管；导入将直接覆盖当前配置。
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
