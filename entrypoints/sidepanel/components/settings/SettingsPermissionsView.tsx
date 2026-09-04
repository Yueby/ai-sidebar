import React, { useState, useEffect } from 'react';
import { Shield, ShieldCheck, Globe, Lock, ExternalLink } from 'lucide-react';
import {
  INSTALL_PERMISSIONS,
  WEB_ACCESS_PERMISSION,
} from '@/lib/permissions';
import { isUserScriptsAvailable } from '@/lib/pageScripting';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

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

  /** 直达扩展详情页(「允许运行用户脚本」开关所在;Chrome 无 API 可代开,只能引导) */
  const openExtensionDetails = () => {
    void browser.tabs.create({ url: `chrome://extensions/?id=${browser.runtime.id}` });
  };

  return (
    <div className="space-y-3.5 text-left animate-in fade-in-0 duration-150 motion-reduce:animate-none">
      {/* 1. 网页访问(host <all_urls>:随安装授予) */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Globe className="size-3.5 text-muted-foreground" />
            <span>网页访问权限</span>
          </h2>
          <Badge
            variant="outline"
            className="text-[10px] h-4.5 px-1.5 font-normal flex items-center gap-1 bg-emerald-600 dark:bg-emerald-500 text-white dark:text-neutral-950 border-transparent"
          >
            <ShieldCheck className="size-2.5" />
            <span>随安装授予</span>
          </Badge>
        </div>

        <div className="rounded-lg border bg-card p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground">
              {WEB_ACCESS_PERMISSION.name}
            </span>
            <code className="text-[10px] font-mono px-1 py-0.5 rounded bg-muted text-muted-foreground border border-border/50">
              {WEB_ACCESS_PERMISSION.raw}
            </code>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {WEB_ACCESS_PERMISSION.description}
          </p>
        </div>
      </div>

      {/* 2. 安装时静态权限列表 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Lock className="size-3.5 text-muted-foreground" />
            <span>安装时已授予权限 ({INSTALL_PERMISSIONS.length})</span>
          </h2>
          <span className="text-[10px] text-muted-foreground font-mono">MANIFEST</span>
        </div>

        <div className="rounded-lg border bg-card divide-y divide-border/60 overflow-hidden">
          {INSTALL_PERMISSIONS.map((p) =>
            p.id === 'userScripts' ? (
              // 用户脚本开关特殊行:Chrome 138+ 需在详情页手动开启,无 API 可代开;状态感知 + 直达引导
              <div key={p.id} className="p-2.5 flex items-start gap-2.5 text-xs">
                <div
                  className={cn(
                    'size-1.5 rounded-full shrink-0 mt-1.5',
                    userScriptsReady ? 'bg-emerald-500' : 'bg-amber-500',
                  )}
                />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground text-[11px]">{p.name}</span>
                    <code className="text-[9px] font-mono px-1 py-0.5 rounded bg-muted text-muted-foreground">
                      {p.raw}
                    </code>
                    <span
                      className={cn(
                        'text-[9px] px-1 py-0.2 rounded font-medium',
                        userScriptsReady
                          ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/15'
                          : 'text-amber-700 dark:text-amber-300 bg-amber-500/15',
                      )}
                    >
                      {userScriptsReady ? '已开启' : '未开启'}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-normal">{p.description}</p>
                  {!userScriptsReady && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 pt-0.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={openExtensionDetails}
                        className="h-6 text-[11px] px-2 gap-1 cursor-pointer w-fit"
                      >
                        <ExternalLink className="size-3 shrink-0" />
                        <span>前往扩展详情页开启</span>
                      </Button>
                      <span className="text-[10px] text-muted-foreground">
                        开启后 execute_js 可在隔离通道执行
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div key={p.id} className="p-2.5 flex items-start gap-2.5 text-xs">
                <div className="size-1.5 rounded-full bg-emerald-500 shrink-0 mt-1.5" />
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground text-[11px]">{p.name}</span>
                    <code className="text-[9px] font-mono px-1 py-0.5 rounded bg-muted text-muted-foreground">
                      {p.raw}
                    </code>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-normal">
                    {p.description}
                  </p>
                </div>
              </div>
            ),
          )}
        </div>
      </div>

      {/* 3. 底部说明与可扩展性提示 */}
      <div className="rounded-lg border bg-muted/20 p-3 flex items-start gap-2 text-muted-foreground text-[11px] leading-relaxed">
        <Shield className="size-3.5 shrink-0 mt-0.5 text-muted-foreground/80" />
        <div>
          <span className="font-medium text-foreground">权限最小化声明：</span>
          ai-sidebar 仅申请实现功能所需的权限，所有网络请求直连目标服务，无中间服务器拦截。未来若引入更多能力所需的权限，也会在此处集中透明列出。
        </div>
      </div>
    </div>
  );
}
