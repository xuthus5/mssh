import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Circle, List, Play, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { connectionStatusVisual } from '@/lib/connectionStatusVisual'
import { useAppStore, type AppState, type Tab } from '@/store/appStore'
import { dynamicPanelID, dynamicTabID } from '@/store/tabNavigation'
import { TabCloseConfirmation, useTabCloseCoordinator } from '@/hooks/useTabCloseCoordinator'

interface TabNavigation {
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, tabID: string) => void
  registerTab: (tabID: string, element: HTMLButtonElement | null) => void
}

function useTabNavigation(tabs: Tab[], activeID: string | null, activateTab: AppState['activateTab']): TabNavigation {
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())

  useEffect(() => {
    const activeTab = activeID ? tabRefs.current.get(activeID) : undefined
    if (typeof activeTab?.scrollIntoView === 'function') activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeID])

  const activate = useCallback((tabID: string, focus = false) => {
    activateTab(tabID, focus)
    if (focus) tabRefs.current.get(tabID)?.focus()
  }, [activateTab])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, tabID: string) => {
    if (!['ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Enter' || event.key === ' ') return activate(tabID, true)
    const currentIndex = tabs.findIndex((tab) => tab.id === tabID)
    const nextIndex = event.key === 'ArrowRight' ? currentIndex + 1 : currentIndex - 1
    const nextTab = tabs[(nextIndex + tabs.length) % tabs.length]
    activate(nextTab.id, true)
  }, [activate, tabs])

  const registerTab = useCallback((tabID: string, element: HTMLButtonElement | null) => {
    if (element) tabRefs.current.set(tabID, element)
    else tabRefs.current.delete(tabID)
  }, [])

  return { onKeyDown, registerTab }
}

function tabStatusLabel(tab: Tab, connectionStatus: AppState['connectionStatus']): string {
  if (tab.type === 'playback') return '回放'
  return connectionStatusVisual(connectionStatus[tab.terminalId ?? tab.id]).label
}

function TabStatusIcon({ tab, connectionStatus }: { tab: Tab; connectionStatus: AppState['connectionStatus'] }) {
  if (tab.type === 'playback') return <Play aria-hidden="true" className="size-3 shrink-0 fill-current text-muted-foreground" />
  const visual = connectionStatusVisual(connectionStatus[tab.terminalId ?? tab.id])
  return <Circle aria-hidden="true" className={`size-2 shrink-0 ${visual.dotClass}`} />
}

function requestCloseFromKeyboard(event: KeyboardEvent<HTMLButtonElement>, tabID: string, onClose: (tabID: string) => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  event.stopPropagation()
  onClose(tabID)
}

function DynamicTab({ tab, active, connectionStatus, navigation, onActivate, onClose }: {
  tab: Tab
  active: boolean
  connectionStatus: AppState['connectionStatus']
  navigation: TabNavigation
  onActivate: (tabID: string) => void
  onClose: (tabID: string) => void
}) {
  const statusLabel = tabStatusLabel(tab, connectionStatus)

  return (
    <div
      className={`group flex h-full shrink-0 items-center gap-1.5 border-r border-border px-2 text-sm transition-colors ${active ? 'bg-background text-foreground shadow-[inset_0_-2px_0_var(--primary)]' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
    >
      <button ref={(element) => navigation.registerTab(tab.id, element)} id={dynamicTabID(tab.id)} type="button" role="tab" tabIndex={active ? 0 : -1} aria-controls={dynamicPanelID(tab.id)} aria-label={`${tab.title}，状态：${statusLabel}`} aria-selected={active} className="flex h-full min-w-0 items-center gap-1.5 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onActivate(tab.id)} onKeyDown={(event) => navigation.onKeyDown(event, tab.id)}>
        <TabStatusIcon tab={tab} connectionStatus={connectionStatus} />
        <span className="max-w-40 truncate">{tab.title}</span>
      </button>
      <button type="button" aria-label={`关闭 ${tab.title}`} className={`rounded-sm p-0.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`} onClick={(event) => { event.stopPropagation(); onClose(tab.id) }} onKeyDown={(event) => requestCloseFromKeyboard(event, tab.id, onClose)}>
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  )
}

function TabListMenu({ tabs, activeID, onActivate }: { tabs: Tab[]; activeID: string | null; onActivate: (tabID: string) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="打开标签列表" className="h-full w-9 shrink-0 rounded-none" onClick={() => setOpen(true)} />}>
        <List aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {tabs.map((tab) => <DropdownMenuItem key={tab.id} onClick={() => { onActivate(tab.id); setOpen(false) }} className={tab.id === activeID ? 'bg-accent text-accent-foreground' : undefined}>{tab.title}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function DynamicTabStrip() {
  const tabs = useAppStore((state) => state.tabs)
  const activeSurface = useAppStore((state) => state.activeSurface)
  const activateTab = useAppStore((state) => state.activateTab)
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const navigation = useTabNavigation(tabs, activeSurface?.id ?? null, activateTab)
  const activateWithFocus = useCallback((tabID: string) => activateTab(tabID, true), [activateTab])
  const closeCoordinator = useTabCloseCoordinator()

  if (tabs.length === 0) return null

  return (
    <div className="flex min-w-0 flex-1 [--wails-draggable:no-drag]">
      <div role="tablist" aria-label="动态标签" className="flex min-w-0 flex-1 overflow-x-auto">
        {tabs.map((tab) => <DynamicTab key={tab.id} tab={tab} active={activeSurface?.id === tab.id} connectionStatus={connectionStatus} navigation={navigation} onActivate={activateWithFocus} onClose={closeCoordinator.requestClose} />)}
      </div>
      <TabListMenu tabs={tabs} activeID={activeSurface?.id ?? null} onActivate={activateWithFocus} />
      <TabCloseConfirmation {...closeCoordinator.confirmation} />
    </div>
  )
}
