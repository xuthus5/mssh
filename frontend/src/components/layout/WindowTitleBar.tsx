import { Menu, Minus, Moon, Settings, Square, SquareTerminal, Sun, Workflow, X } from 'lucide-react'
import { Window } from '@wailsio/runtime'
import { logger } from '@/lib/logger'
import { useAppStore, type SidebarTab } from '@/store/appStore'
import { useThemeCatalog } from '@/hooks/useThemeCatalog'
import { DynamicTabStrip } from '@/components/layout/DynamicTabStrip'

function runWindowAction(name: string, action: () => Promise<unknown>) {
  void action().catch((error: unknown) => logger.error(`window ${name} failed`, error))
}

export function WindowTitleBar() {
  const themeCatalog = useThemeCatalog()
  const colorMode = themeCatalog.colorMode
  const hasEnteredWorkspace = useAppStore((state) => state.hasEnteredWorkspace)
  const navigationCollapsed = useAppStore((state) => state.navigationCollapsed)
  const sidebarTab = useAppStore((state) => state.sidebarTab)
  const activateWorkspace = useAppStore((state) => state.activateWorkspace)
  const enterWorkspace = useAppStore((state) => state.enterWorkspace)
  const toggleNavigation = useAppStore((state) => state.toggleNavigation)

  const toggleColorMode = () => {
    const nextMode = colorMode === 'dark' ? 'light' : 'dark'
    void themeCatalog.setColorMode(nextMode)
  }

  const navigationButton = (tab: SidebarTab, label: string) => {
    const Icon = tab === 'sessions' ? SquareTerminal : Workflow
    const selected = hasEnteredWorkspace && sidebarTab === tab
    return <button type="button" role="tab" aria-selected={selected} className={`flex items-center gap-1.5 px-3.5 text-sm font-medium transition-colors [--wails-draggable:no-drag] ${selected ? 'bg-background text-foreground shadow-[inset_0_-2px_0_var(--primary)]' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`} onClick={() => { enterWorkspace(); activateWorkspace(tab) }}><Icon data-icon="inline-start" aria-hidden="true" className="size-4" />{label}</button>
  }

  return <header className="flex h-9 shrink-0 select-none items-stretch border-b border-border bg-card">
    <div className="flex shrink-0 [--wails-draggable:no-drag]">
      <button type="button" aria-label={navigationCollapsed ? '展开导航' : '收起导航'} aria-controls="sidebar-navigation" aria-expanded={!navigationCollapsed} className="grid w-10 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={toggleNavigation}><Menu className="size-4" /></button>
      {!navigationCollapsed && <nav role="tablist" aria-label="侧边栏导航" className="flex">{navigationButton('sessions', '会话')}{navigationButton('macros', '宏')}</nav>}
    </div>
    <DynamicTabStrip />
    <div data-testid="window-drag-region" className="min-w-0 flex-1 [--wails-draggable:drag]" onDoubleClick={() => runWindowAction('toggle maximise', Window.ToggleMaximise)} />
    <div className="flex [--wails-draggable:no-drag]">
      <button type="button" aria-label={colorMode === 'dark' ? '切换到浅色模式' : '切换到深色模式'} className="grid w-10 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={toggleColorMode}>{colorMode === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}</button>
      <button type="button" aria-label="打开设置" className="grid w-10 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => window.dispatchEvent(new CustomEvent('mssh:open-settings'))}><Settings className="size-4" /></button>
      <span className="my-2 w-px bg-border" />
      <button type="button" aria-label="最小化窗口" className="grid w-11 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => runWindowAction('minimise', Window.Minimise)}><Minus className="size-4" /></button>
      <button type="button" aria-label="最大化或还原窗口" className="grid w-11 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => runWindowAction('toggle maximise', Window.ToggleMaximise)}><Square className="size-3.5" /></button>
      <button type="button" aria-label="关闭窗口" className="grid w-11 place-items-center text-muted-foreground transition-colors hover:bg-destructive hover:text-white" onClick={() => runWindowAction('close', Window.Close)}><X className="size-4" /></button>
    </div>
  </header>
}
