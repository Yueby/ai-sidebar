import React, { useState, useEffect } from 'react';
import { Shield, ExternalLink } from 'lucide-react';
import {
  INSTALL_PERMISSIONS,
  WEB_ACCESS_PERMISSION,
  openExtensionDetails,
} from '@/lib/permissions';
import { isUserScriptsAvailable } from '@/lib/pageScripting';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { i18n } from '#i18n';

export function SettingsPermissionsView() {
  // 用户脚本开关(Chrome 138+ 扩展详情页手动开启,无 API 可代开;仅检测+直达引导)
  const [userScriptsReady, setUserScriptsReady] = useState<boolean>(() => isUserScriptsAvailable());

  useEffect(() => {
    // 刷新触发器:侧边栏 dock 在主窗口旁,用户切回来看它时 document 一直 visible,
    // visibilitychange 不可靠;focus 覆盖点回侧边栏,轮询覆盖“主标签页翻开关后盯着侧边栏看”的场景
    const refresh = () => setUserScriptsReady(isUserScriptsAvailable());
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    const interval = setInterval(refresh, 2000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="space-y-4 text-left animate-in fade-in-0 duration-150 motion-reduce:animate-none">
      {/* 1. 权限清单节 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Shield className="size-3.5 text-muted-foreground" />
            <span>{i18n.t('permissions.installedListTitle', { count: INSTALL_PERMISSIONS.length + 1 })}</span>
          </h2>
          <span className="text-[10px] text-muted-foreground font-mono">MANIFEST</span>
        </div>

        <Card className="gap-0 py-0 divide-y divide-border/60 overflow-hidden">
          {/* 网页访问 (host <all_urls>) */}
          <div className="flex items-center justify-between gap-2.5 p-2.5">
            <div className="w-6 flex items-center justify-center shrink-0">
              <span className="size-2 rounded-full bg-emerald-500" />
            </div>
            <div className="flex-1 min-w-0 space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-[11px] text-foreground">{WEB_ACCESS_PERMISSION.name}</span>
                <code className="text-[9px] font-mono px-1 py-0.2 rounded bg-muted text-muted-foreground">
                  {WEB_ACCESS_PERMISSION.raw}
                </code>
              </div>
              <div className="text-[10px] text-muted-foreground truncate leading-tight">
                {WEB_ACCESS_PERMISSION.description}
              </div>
            </div>
          </div>

          {/* 安装时静态权限列表 */}
          {INSTALL_PERMISSIONS.map((p) => {
            const isUserScripts = p.id === 'userScripts';
            return (
              <div key={p.id} className="flex items-center justify-between gap-2.5 p-2.5">
                <div className="w-6 flex items-center justify-center shrink-0">
                  <span
                    className={cn(
                      'size-2 rounded-full',
                      isUserScripts
                        ? (userScriptsReady ? 'bg-emerald-500' : 'bg-amber-500')
                        : 'bg-emerald-500',
                    )}
                  />
                </div>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-[11px] text-foreground">{p.name}</span>
                    <code className="text-[9px] font-mono px-1 py-0.2 rounded bg-muted text-muted-foreground">
                      {p.raw}
                    </code>
                    {isUserScripts && (
                      <span
                        className={cn(
                          'text-[9px] px-1 py-0.2 rounded font-normal leading-none',
                          userScriptsReady
                            ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/15'
                            : 'text-amber-700 dark:text-amber-300 bg-amber-500/15',
                        )}
                      >
                        {userScriptsReady ? i18n.t('permissions.enabled') : i18n.t('permissions.disabled')}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate leading-tight">
                    {p.description}
                  </div>
                </div>
              </div>
            );
          })}
        </Card>
      </div>

      {/* 2. userScripts 引导节 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Shield className="size-3.5 text-muted-foreground" />
            <span>{i18n.t('permissions.userScriptsTitle')}</span>
          </h2>
          <span
            className={cn(
              'text-[10px] font-mono',
              userScriptsReady ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
            )}
          >
            {userScriptsReady ? i18n.t('permissions.enabled') : i18n.t('permissions.disabled')}
          </span>
        </div>

        <Card className="gap-2 p-3 text-[11px] text-muted-foreground leading-relaxed">
          <p>
            {INSTALL_PERMISSIONS.find((p) => p.id === 'userScripts')?.description}
          </p>
          {!userScriptsReady && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-0.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={openExtensionDetails}
                className="h-7 text-xs px-2.5 gap-1.5 cursor-pointer w-fit"
              >
                <ExternalLink className="size-3 shrink-0" />
                <span>{i18n.t('permissions.openDetails')}</span>
              </Button>
              <span className="text-[10px] text-muted-foreground">
                {i18n.t('permissions.userScriptsHint')}
              </span>
            </div>
          )}
        </Card>
      </div>

      {/* 3. 权限最小化声明 */}
      <div className="rounded-xl border bg-muted/20 p-3 flex items-start gap-2 text-muted-foreground text-[11px] leading-relaxed">
        <Shield className="size-3.5 shrink-0 mt-0.5 text-muted-foreground/80" />
        <div>
          <span className="font-medium text-foreground">{i18n.t('permissions.declarationTitle')}</span>
          {i18n.t('permissions.declarationText')}
        </div>
      </div>
    </div>
  );
}
