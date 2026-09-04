import { Toaster as Sonner, type ToasterProps } from "sonner"

/**
 * shadcn/ui 官方 sonner 封装,theme 固定 "system":
 * 主题由 theme.ts 跟随系统切换 html.dark,与 Sonner 的 system 语义一致,
 * 故不引入 next-themes(本侧边栏无 ThemeProvider)。
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
