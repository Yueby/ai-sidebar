import React, { useState, useEffect, useCallback } from 'react';
import { ShieldAlert, ExternalLink, RefreshCw } from 'lucide-react';
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
import { cn } from '@/lib/utils';

/**
 * 用户脚本 (userScripts) 强引导弹窗。
 *
 * 行为契约：
 * 1. 挂载时同步检测，若已开启则立即返回 null（零闪烁、零挂载开销）。
 * 2. 未开启时弹出强引导 AlertDialog，拦截 Esc、点遮罩及外部交互，仅能通过按钮操作。
 * 3. 前往扩展详情页按钮仅负责打开新标签页，弹窗保持打开状态等待用户操作。
 * 4. 监听 window focus、document visibilitychange 及轮询探测，在用户切回或开启后自动闭环关闭。
 * 5. 「暂时跳过」仅在当前面板会话跳过，面板重新挂载时恢复检测与引导。
 */
export function UserScriptsGateDialog() {
  const [ready, setReady] = useState<boolean>(() => isUserScriptsAvailable());
  const [skipped, setSkipped] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [notReadyTip, setNotReadyTip] = useState(false);

  // 状态自动同步闭环:用户在详情页开启后切回面板,自动重检并关闭弹窗
  // (已开启或已跳过后全部停止——跳过后轮询无意义,execute_js 在调用时动态探测)
  useEffect(() => {
    if (ready || skipped) return;

    const check = () => {
      if (isUserScriptsAvailable()) {
        setReady(true);
        setNotReadyTip(false);
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
    setNotReadyTip(false);
    openExtensionDetails();
  }, []);

  const handleRecheck = useCallback(() => {
    setIsChecking(true);
    const available = isUserScriptsAvailable();
    if (available) {
      setReady(true);
      setNotReadyTip(false);
    } else {
      setNotReadyTip(true);
    }
    setIsChecking(false);
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
      <AlertDialogContent
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="sm:max-w-md p-5 gap-4 select-none"
      >
        <AlertDialogHeader className="text-left space-y-2">
          <div className="flex items-center gap-2">
            <div className="size-7 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <ShieldAlert className="size-4" />
            </div>
            <AlertDialogTitle className="text-sm font-semibold text-foreground">
              开启“允许用户脚本”
            </AlertDialogTitle>
          </div>

          <AlertDialogDescription asChild>
            <div className="text-xs text-muted-foreground leading-relaxed space-y-2 pt-0.5">
              <p>
                AI 在网页执行脚本需要此开关（隔离环境、不受页面安全策略限制）。
              </p>
              <div className="rounded-md bg-muted/60 p-2.5 text-[11px] border border-border/50 text-foreground/85 leading-normal">
                点击下方按钮打开扩展详情页，找到<strong>「允许用户脚本」</strong>（Allow User Scripts）开关并打开（Chrome 138+；更低版本打开页面右上角<strong>「开发者模式」</strong>），然后回到本面板。
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="flex flex-col gap-2 sm:flex-col sm:space-x-0 pt-1">
          <Button
            type="button"
            onClick={handleOpenDetails}
            className="w-full justify-center gap-1.5 text-xs font-medium cursor-pointer"
          >
            <ExternalLink className="size-3.5" />
            <span>前往扩展详情页</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={handleRecheck}
            disabled={isChecking}
            className="w-full justify-center gap-1.5 text-xs cursor-pointer"
          >
            <RefreshCw className={cn('size-3.5', isChecking && 'animate-spin')} />
            <span>我已开启，重新检测</span>
          </Button>

          {notReadyTip && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 text-center animate-in fade-in-0">
              尚未检测到开关开启，请在扩展详情页开启后重试
            </p>
          )}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleSkip}
            className="w-full text-xs text-muted-foreground hover:text-foreground cursor-pointer h-7"
          >
            暂时跳过
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
