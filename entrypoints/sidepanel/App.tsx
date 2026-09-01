// 占位骨架:仅验证 Tailwind v4 + shadcn 主题 token + 自动深浅色跑通。
// 完整 UI 按根目录 AGENTS.md 的 Roadmap 实现。

export default function App() {
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-semibold tracking-tight">AI Sidebar</span>
        <span className="text-xs text-muted-foreground">v0 · 基座就绪</span>
      </header>
      <main className="flex flex-1 items-center justify-center p-6 text-center">
        <p className="text-sm leading-relaxed text-muted-foreground">
          WXT + React + Tailwind v4 + shadcn 主题 token 已就绪
          <br />
          深浅色自动跟随系统
          <br />
          <span className="text-xs">下一步见 AGENTS.md · Roadmap</span>
        </p>
      </main>
    </div>
  );
}
