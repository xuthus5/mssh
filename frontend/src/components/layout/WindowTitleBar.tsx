import { useState } from 'react'
import { LayoutDashboard, Menu, Minus, Moon, Settings, Square, SquareTerminal, Sun, Workflow, X } from 'lucide-react'
import { Events, Window } from '@wailsio/runtime'
import { logger } from '@/lib/logger'
import { useAppStore } from '@/store/appStore'
import { workspaceTabID, type WorkspaceID } from '@/store/tabNavigation'
import { useThemeCatalog } from '@/hooks/useThemeCatalog'
import { DynamicTabOverflowMenu, DynamicTabStrip } from '@/components/layout/DynamicTabStrip'
import { WINDOW_OPEN_SETTINGS_EVENT } from '@/lib/settingsWindowEvents'
import { APP_NEW_LOCAL_TERMINAL_EVENT, emitAppEvent } from '@/lib/appEvents'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'


const COLLAPSED_NAVIGATION_WIDTH = 36

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
  const sidebarWidth = useAppStore((state) => state.sidebarWidth)
  const activateWorkspace = useAppStore((state) => state.activateWorkspace)
  const toggleNavigation = useAppStore((state) => state.toggleNavigation)
  const overviewActive = activeSurface?.type === 'workspace' && activeSurface.id === 'overview'
  const terminalSurfaceActive = activeSurface !== null && activeSurface.type !== 'workspace'

  const toggleColorMode = () => {
    const nextMode = colorMode === 'dark' ? 'light' : 'dark'
    void themeCatalog.setColorMode(nextMode).catch((error: unknown) => logger.error('toggle color mode failed', error))
  }
  const colorModeError = themeCatalog.colorModeError

  const navigationButton = (tab: WorkspaceID, label: string) => {
    const Icon = tab === 'overview' ? LayoutDashboard : tab === 'sessions' ? SquareTerminal : Workflow
    const selected = tab === 'overview' ? overviewActive : !overviewActive && workspaceTab === tab
    return <button id={workspaceTabID(tab)} type="button" aria-controls="sidebar-navigation" aria-pressed={selected} className={cn('flex h-6 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors duration-150 [--wails-draggable:no-drag] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70', selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground')} onClick={() => activateWorkspace(tab)}><Icon data-icon="inline-start" aria-hidden="true" className="size-3.5" />{label}</button>
  }

  return <>
  <header className={cn('flex h-9 shrink-0 select-none items-stretch bg-card', !terminalSurfaceActive && 'border-b border-border')}>
    <div data-testid="title-navigation-region" style={{ width: navigationCollapsed ? COLLAPSED_NAVIGATION_WIDTH : sidebarWidth }} className="flex shrink-0 items-center gap-1 overflow-hidden px-1 transition-[width] duration-200 ease-out [--wails-draggable:no-drag]">
      <button type="button" aria-label={navigationCollapsed ? t('展开导航') : t('收起导航')} aria-controls="sidebar-navigation" aria-expanded={!navigationCollapsed} className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70" onClick={toggleNavigation}><Menu className="size-3.5" /></button>
      {!navigationCollapsed && <nav aria-label={t('侧边栏导航')} className="flex h-7 items-center gap-0.5 rounded-lg border border-border/60 bg-muted/40 p-0.5">{navigationButton('overview', t('总览'))}{!overviewActive && <>{navigationButton('sessions', t('会话'))}{navigationButton('macros', t('宏'))}</>}</nav>}
    </div>
    <DynamicTabStrip onOverflowChange={setTabsOverflow} />
    <div data-testid="window-drag-region" className="min-w-20 flex-1 [--wails-draggable:drag]" onDoubleClick={() => runWindowAction('toggle maximise', Window.ToggleMaximise)} />
    <div className="relative flex [--wails-draggable:no-drag]">
      {tabsOverflow && <div className="absolute right-full top-0 h-full"><DynamicTabOverflowMenu /></div>}
      <button type="button" aria-label={colorMode === 'dark' ? t('切换到浅色模式') : t('切换到深色模式')} className="grid w-10 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={toggleColorMode}>{colorMode === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}</button>
      <button type="button" aria-label={t('打开本地终端')} className="grid w-10 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => emitAppEvent(APP_NEW_LOCAL_TERMINAL_EVENT)}><SquareTerminal className="size-4" /></button>
      <button type="button" aria-label={t('打开设置')} className="grid w-10 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => runWindowAction('open settings', () => Events.Emit(WINDOW_OPEN_SETTINGS_EVENT))}><Settings className="size-4" /></button>
      <span className="my-2 w-px bg-border" />
      <button type="button" aria-label={t('最小化窗口')} className="grid w-11 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => runWindowAction('minimise', Window.Minimise)}><Minus className="size-4" /></button>
      <button type="button" aria-label={t('最大化或还原窗口')} className="grid w-11 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => runWindowAction('toggle maximise', Window.ToggleMaximise)}><Square className="size-3.5" /></button>
      <button type="button" aria-label={t('关闭窗口')} className="grid w-11 place-items-center text-muted-foreground transition-colors hover:bg-destructive hover:text-white" onClick={() => runWindowAction('close', Window.Close)}><X className="size-4" /></button>
    </div>
  </header>
  {colorModeError ? <p role="alert" className="border-b border-destructive/30 bg-destructive/10 px-3 py-1 text-xs text-destructive">{colorModeError}</p> : null}
</>
}
