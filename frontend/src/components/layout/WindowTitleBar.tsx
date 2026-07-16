import { useState } from 'react'
import { LayoutDashboard, Menu, Minus, Moon, Settings, Square, SquareTerminal, Sun, Workflow, X } from 'lucide-react'
import { Events, Window } from '@wailsio/runtime'
import { logger } from '@/lib/logger'
import { useAppStore } from '@/store/appStore'
import { workspaceTabID, type WorkspaceID } from '@/store/tabNavigation'
import { useThemeCatalog } from '@/hooks/useThemeCatalog'
import { DynamicTabOverflowMenu, DynamicTabStrip } from '@/components/layout/DynamicTabStrip'
import { WINDOW_OPEN_SETTINGS_EVENT } from '@/lib/settingsWindowEvents'

function runWindowAction(name: string, action: () => Promise<unknown>) {
  void action().catch((error: unknown) => logger.error(`window ${name} failed`, error))
}

export function WindowTitleBar() {
  const [tabsOverflow, setTabsOverflow] = useState(false)
  const themeCatalog = useThemeCatalog()
  const colorMode = themeCatalog.colorMode
  const activeSurface = useAppStore((state) => state.activeSurface)
  const workspaceTab = useAppStore((state) => state.workspaceTab)
  const navigationCollapsed = useAppStore((state) => state.navigationCollapsed)
  const activateWorkspace = useAppStore((state) => state.activateWorkspace)
  const toggleNavigation = useAppStore((state) => state.toggleNavigation)
  const overviewActive = activeSurface?.type === 'workspace' && activeSurface.id === 'overview'

  const toggleColorMode = () => {
    const nextMode = colorMode === 'dark' ? 'light' : 'dark'
    void themeCatalog.setColorMode(nextMode)
  }

  const navigationButton = (tab: WorkspaceID, label: string) => {
    const Icon = tab === 'overview' ? LayoutDashboard : tab === 'sessions' ? SquareTerminal : Workflow
    const selected = tab === 'overview' ? overviewActive : !overviewActive && workspaceTab === tab
    return <button id={workspaceTabID(tab)} type="button" aria-controls="sidebar-navigation" aria-pressed={selected} className={`flex items-center gap-1.5 px-3.5 text-sm font-medium transition-colors [--wails-draggable:no-drag] ${selected ? 'bg-background text-foreground shadow-[inset_0_-2px_0_var(--primary)]' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`} onClick={() => activateWorkspace(tab)}><Icon data-icon="inline-start" aria-hidden="true" className="size-4" />{label}</button>
  }

  return <header className="flex h-9 shrink-0 select-none items-stretch border-b border-border bg-card">
    <div className="flex shrink-0 [--wails-draggable:no-drag]">
      <button type="button" aria-label={navigationCollapsed ? '展开导航' : '收起导航'} aria-controls="sidebar-navigation" aria-expanded={!navigationCollapsed} className="grid w-10 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={toggleNavigation}><Menu className="size-4" /></button>
      {!navigationCollapsed && <nav aria-label="侧边栏导航" className="flex">{navigationButton('overview', '总览')}{!overviewActive && <>{navigationButton('sessions', '会话')}{navigationButton('macros', '宏')}</>}</nav>}
    </div>
    <DynamicTabStrip onOverflowChange={setTabsOverflow} />
    <div data-testid="window-drag-region" className="min-w-20 flex-1 [--wails-draggable:drag]" onDoubleClick={() => runWindowAction('toggle maximise', Window.ToggleMaximise)} />
    <div className="relative flex [--wails-draggable:no-drag]">
      {tabsOverflow && <div className="absolute right-full top-0 h-full"><DynamicTabOverflowMenu /></div>}
      <button type="button" aria-label={colorMode === 'dark' ? '切换到浅色模式' : '切换到深色模式'} className="grid w-10 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={toggleColorMode}>{colorMode === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}</button>
      <button type="button" aria-label="打开设置" className="grid w-10 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => runWindowAction('open settings', () => Events.Emit(WINDOW_OPEN_SETTINGS_EVENT))}><Settings className="size-4" /></button>
      <span className="my-2 w-px bg-border" />
      <button type="button" aria-label="最小化窗口" className="grid w-11 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => runWindowAction('minimise', Window.Minimise)}><Minus className="size-4" /></button>
      <button type="button" aria-label="最大化或还原窗口" className="grid w-11 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => runWindowAction('toggle maximise', Window.ToggleMaximise)}><Square className="size-3.5" /></button>
      <button type="button" aria-label="关闭窗口" className="grid w-11 place-items-center text-muted-foreground transition-colors hover:bg-destructive hover:text-white" onClick={() => runWindowAction('close', Window.Close)}><X className="size-4" /></button>
    </div>
  </header>
}
