import React, { useState, useEffect, useCallback } from 'react';
import { i18n } from '#i18n';
import { ShieldAlert, ExternalLink } from 'lucide-react';
import { isUserScriptsAvailable } from '@/lib/pageScripting';
import { openExtensionDetails } from '@/lib/permissions';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

/**
 * 用户脚本 (userScripts) 强引导弹窗。
 *
 * 行为契约：
 * 1. 挂载时同步检测，若已开启则立即返回 null（零闪烁、零挂载开销）。
 * 2. 未开启时弹出强引导 AlertDialog，拦截 Esc、点遮罩及外部交互，仅能通过按钮操作。
 * 3. 前往扩展详情页按钮仅负责打开新标签页，弹窗保持打开状态等待用户操作。
 * 4. 监听 window focus、document visibilitychange 及轮询探测，在用户切回或开启后自动闭环关闭。
 * 5. 「{i18n.t('gate.skip')}」仅在当前面板会话跳过，面板重新挂载时恢复检测与引导。
 */
export function UserScriptsGateDialog() {
  const [ready, setReady] = useState<boolean>(() => isUserScriptsAvailable());
  const [skipped, setSkipped] = useState(false);

  // 状态自动同步闭环:用户在详情页开启后切回面板,自动重检并关闭弹窗
  // (已开启或已跳过后全部停止——跳过后轮询无意义,execute_js 在调用时动态探测)
  useEffect(() => {
    if (ready || skipped) return;

    const check = () => {
      if (isUserScriptsAvailable()) {
        setReady(true);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        check();
      }
    };

    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisibilityChange);
    // 侧边栏与主窗口并排展示时，用户开启后可能未立即点击侧边栏，轮询提供无缝感知
    const interval = setInterval(check, 1500);

    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearInterval(interval);
    };
  }, [ready, skipped]);

  const handleOpenDetails = useCallback(() => {
    openExtensionDetails();
  }, []);

  const handleSkip = useCallback(() => {
    setSkipped(true);
  }, []);

  // 零闪烁守卫：已开启或本次已跳过则完全不渲染
  if (ready || skipped) {
    return null;
  }

  return (
    <AlertDialog open={true}>
      <AlertDialogContent className="sm:max-w-md select-none">
        <AlertDialogHeader className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="size-7 rounded-full bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
              <ShieldAlert className="size-4" />
            </div>
            <AlertDialogTitle>
              {i18n.t('gate.title')}
            </AlertDialogTitle>
          </div>

          <AlertDialogDescription
            render={
              <div className="text-xs text-muted-foreground leading-relaxed space-y-2 pt-0.5" />
            }
          >
            <p>
              {i18n.t('gate.desc1')}
            </p>
            <div className="rounded-md bg-muted/60 p-2.5 text-[11px] border border-border/50 text-foreground/85 leading-normal">
              {i18n.t('gate.desc2')}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="flex flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button
            type="button"
            onClick={handleOpenDetails}
            className="w-full justify-center gap-1.5 text-xs font-medium"
          >
            <ExternalLink className="size-3.5" />
            <span>{i18n.t('gate.openDetails')}</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleSkip}
            className="w-full text-xs text-muted-foreground hover:text-foreground h-7"
          >
            {i18n.t('gate.skip')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
