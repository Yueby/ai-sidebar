import React from "react"
import { Toaster as Sonner } from "sonner"

/**
 * shadcn/ui 官方 sonner 封装,theme 固定 "system":
 * 主题由 theme.ts 跟随系统切换 html.dark,与 Sonner 的 system 语义一致,
 * 故不引入 next-themes(本侧边栏无 ThemeProvider)。
 * 注:不从 sonner 导入 ToasterProps 类型——其 ESM 运行时导出不含该名字,
 * 混合导入会在 vite dev 下炸出 ERR_FILE_NOT_FOUND;用 ComponentProps 推导。
 */
type ToasterProps = React.ComponentProps<typeof Sonner>

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
