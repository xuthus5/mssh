import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Circle, Copy, List, Play, Plus, Server, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { connectionStatusVisual } from '@/lib/connectionStatusVisual'
import { useAppStore, type AppState, type Tab } from '@/store/appStore'
import { dynamicPanelID, dynamicTabID } from '@/store/tabNavigation'
import { TabCloseConfirmation, useTabCloseCoordinator } from '@/hooks/useTabCloseCoordinator'
import { useSessionWorkspace } from '@/hooks/SessionWorkspaceContext'
import { SESSION_QUICK_SEARCH_EVENT } from '@/lib/sessionQuickSearch'

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

function useTabOverflow(tabs: Tab[], onOverflowChange?: (overflow: boolean) => void) {
  const tabListRef = useRef<HTMLDivElement>(null)
  const lastOverflowRef = useRef<boolean | null>(null)
  const reportOverflow = useCallback(() => {
    const tabList = tabListRef.current
    const overflow = tabList !== null && tabList.scrollWidth > tabList.clientWidth
    if (lastOverflowRef.current === overflow) return
    lastOverflowRef.current = overflow
    onOverflowChange?.(overflow)
  }, [onOverflowChange])

  useLayoutEffect(() => { reportOverflow() }, [reportOverflow, tabs])
  useLayoutEffect(() => {
    const tabList = tabListRef.current
    if (!tabList || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => reportOverflow())
    observer.observe(tabList)
    for (const tab of tabList.children) observer.observe(tab)
    return () => observer.disconnect()
  }, [reportOverflow, tabs])
  useEffect(() => () => {
    lastOverflowRef.current = false
    onOverflowChange?.(false)
  }, [onOverflowChange])

  return tabListRef
}

function tabStatusLabel(tab: Tab, connectionStatus: AppState['connectionStatus']): string {
  if (tab.type === 'playback') return '回放'
  return connectionStatusVisual(connectionStatus[tab.terminalId]).label
}

function TabLeadingIcon({ tab }: { tab: Tab }) {
	if (tab.type === 'playback') return <Play aria-hidden="true" className="size-3 shrink-0 fill-current text-muted-foreground" />
	return <Server aria-hidden="true" data-testid={`server-icon-${tab.id}`} className="size-3.5 shrink-0 text-muted-foreground" />
}

function TabStatusIcon({ tab, connectionStatus }: { tab: Tab; connectionStatus: AppState['connectionStatus'] }) {
	if (tab.type === 'playback') return null
	const visual = connectionStatusVisual(connectionStatus[tab.terminalId])
	return <Circle aria-hidden="true" className={`size-2 shrink-0 ${visual.dotClass}`} />
}

function requestCloseFromKeyboard(event: KeyboardEvent<HTMLButtonElement>, tabID: string, onClose: (tabID: string) => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  event.stopPropagation()
  onClose(tabID)
}

function DynamicTab({ tab, active, connectionStatus, navigation, onActivate, onClose, onDuplicate }: {
  tab: Tab
  active: boolean
  connectionStatus: AppState['connectionStatus']
  navigation: TabNavigation
  onActivate: (tabID: string) => void
  onClose: (tabID: string) => void
  onDuplicate: (sessionID: number) => void
}) {
  const statusLabel = tabStatusLabel(tab, connectionStatus)
  const content = (
    <div
      className={`group flex h-8 shrink-0 items-center gap-1 rounded-md px-1.5 text-sm transition-colors duration-150 ${active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
    >
      <button ref={(element) => navigation.registerTab(tab.id, element)} id={dynamicTabID(tab.id)} type="button" role="tab" tabIndex={active ? 0 : -1} aria-controls={dynamicPanelID(tab.id)} aria-label={`${tab.title}，状态：${statusLabel}`} aria-selected={active} className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onActivate(tab.id)} onKeyDown={(event) => navigation.onKeyDown(event, tab.id)}>
        <TabLeadingIcon tab={tab} />
        <span className="min-w-0 max-w-40 truncate">{tab.title}</span>
        <TabStatusIcon tab={tab} connectionStatus={connectionStatus} />
      </button>
      <button type="button" aria-label={`关闭 ${tab.title}`} className={`rounded-sm p-0.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`} onClick={(event) => { event.stopPropagation(); onClose(tab.id) }} onKeyDown={(event) => requestCloseFromKeyboard(event, tab.id, onClose)}>
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  )

  if (tab.type !== 'terminal') return content
  return (
    <ContextMenu>
      <ContextMenuTrigger>{content}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuItem onClick={() => onDuplicate(tab.sessionId)}>
            <Copy aria-hidden="true" />
            复制终端
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function TabListMenu({ tabs, activeID, onActivate }: { tabs: Tab[]; activeID: string | null; onActivate: (tabID: string) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="打开标签列表" className="h-full w-9 shrink-0 rounded-none" onClick={() => setOpen(true)} />}>
        <List aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {tabs.map((tab) => <DropdownMenuItem key={tab.id} onClick={() => { onActivate(tab.id); setOpen(false) }} className={tab.id === activeID ? 'bg-accent text-accent-foreground' : undefined}>{tab.title}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function lastTerminalTabIndex(tabs: Tab[]) {
  let result = -1
  tabs.forEach((tab, index) => { if (tab.type === 'terminal') result = index })
  return result
}

function QuickConnectButton() {
  const openSearch = () => window.dispatchEvent(new CustomEvent(SESSION_QUICK_SEARCH_EVENT))
  return <Button type="button" variant="ghost" size="icon-sm" aria-label="快速连接会话" title="快速连接会话"
    className="h-8 w-8 shrink-0 rounded-md border-0 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground" onClick={openSearch}>
    <Plus aria-hidden="true" />
  </Button>
}

export function DynamicTabOverflowMenu() {
  const tabs = useAppStore((state) => state.tabs)
  const activeSurface = useAppStore((state) => state.activeSurface)
  const activateTab = useAppStore((state) => state.activateTab)
  const activateWithFocus = useCallback((tabID: string) => activateTab(tabID, true), [activateTab])
  if (tabs.length === 0) return null
  return <TabListMenu tabs={tabs} activeID={activeSurface?.id ?? null} onActivate={activateWithFocus} />
}

export function DynamicTabStrip({ onOverflowChange }: { onOverflowChange?: (overflow: boolean) => void }) {
  const { connect } = useSessionWorkspace()
  const tabs = useAppStore((state) => state.tabs)
  const activeSurface = useAppStore((state) => state.activeSurface)
  const activateTab = useAppStore((state) => state.activateTab)
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const navigation = useTabNavigation(tabs, activeSurface?.id ?? null, activateTab)
  const tabListRef = useTabOverflow(tabs, onOverflowChange)
  const activateWithFocus = useCallback((tabID: string) => activateTab(tabID, true), [activateTab])
  const duplicateTerminal = useCallback((sessionID: number) => { void connect(String(sessionID)) }, [connect])
  const closeCoordinator = useTabCloseCoordinator()
  const quickConnectAfter = lastTerminalTabIndex(tabs)

  if (tabs.length === 0) return null

  return (
    <div className="flex min-w-0 shrink overflow-hidden [--wails-draggable:no-drag]">
      <div ref={tabListRef} role="tablist" aria-label="动态标签" className="flex min-w-0 gap-0.5 overflow-x-auto p-0.5">
        {tabs.map((tab, index) => <Fragment key={tab.id}>
          <DynamicTab tab={tab} active={activeSurface?.id === tab.id} connectionStatus={connectionStatus} navigation={navigation} onActivate={activateWithFocus} onClose={closeCoordinator.requestClose} onDuplicate={duplicateTerminal} />
          {index === quickConnectAfter && <QuickConnectButton />}
        </Fragment>)}
      </div>
      <TabCloseConfirmation {...closeCoordinator.confirmation} />
    </div>
  )
}
