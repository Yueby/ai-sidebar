import { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import { faviconUrl } from '@/lib/favicon';
import { useTabMeta } from '@/lib/tabMetaStore';

/**
 * 单个网站图标(回退链:tabMetaStore 实时 favicon(单源,事件驱动自愈)→ _favicon 服务(浏览器历史库)→ Globe):
 * favIconUrl 已从数据层退出(审计窄版收敛),渲染层经 useTabMeta 直接订阅单一读源;
 * 新开 tab 的 favicon 异步生成、任何时序漏网都由 store 的 hydrate/事件刷新补齐。
 * 引用栏(输入框上方)、消息气泡与编辑态 HoverCard 共用同一实现。
 */
export function FaviconIcon({
  url,
  tabId,
  className = 'size-3.5',
}: {
  url: string;
  tabId?: number;
  className?: string;
}) {
  const meta = useTabMeta(tabId);
  const liveFav = meta?.favIconUrl;
  const [failedStage, setFailedStage] = useState<'live' | 'service' | null>(null);
  // 实时值/页面变化后重置失败标记(新 favicon/新页面两级都值得一试)
  useEffect(() => {
    setFailedStage(null);
  }, [liveFav, url]);
  const useLive = Boolean(liveFav) && failedStage !== 'live';
  const src = useLive ? liveFav : faviconUrl(url, 32);
  if (failedStage === 'service' || !src) {
    return <Globe className={`${className} text-muted-foreground shrink-0`} />;
  }
  return (
    <img
      src={src}
      alt=""
      onError={() => setFailedStage(useLive ? 'live' : 'service')}
      className={`${className} rounded-[2px] shrink-0 object-contain`}
    />
  );
}

/**
 * 引用项 tooltip:网址优先(元素引用必须能看出"来自哪一页",尤其是同一条消息引了多页时),
 * 定位细节次行。无网址(旧消息、无 refs 块、元素来自已关闭的 tab)时退化为单行细节。
 */
export function RefTooltipContent({ url, detail }: { url?: string; detail: string }) {
  if (!url) return <>{detail}</>;
  return (
    <>
      <span className="block font-mono text-[10px] leading-tight break-all">{url}</span>
      <span className="block mt-0.5 text-[10px] leading-tight opacity-70">{detail}</span>
    </>
  );
}
