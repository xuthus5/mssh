import { useRef, useState, useEffect, useCallback } from 'react'
import { X, Circle } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { logger } from '@/lib/logger'
import { connectionStatusVisual } from '@/lib/connectionStatusVisual'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

const contextMenuItems: Array<{
  label: string
  action: 'close' | 'closeOthers'
  destructive?: boolean
}> = [
  { label: '关闭', action: 'close' },
  { label: '关闭其他', action: 'closeOthers', destructive: true },
]

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  tabId: string
}

export default function TabBar() {
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const connectionStatus = useAppStore((s) => s.connectionStatus)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const recordingState = useAppStore((s) => s.recordingState)
  const [pendingClose, setPendingClose] = useState<string[]>([])
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    tabId: '',
  })
  const menuRef = useRef<HTMLDivElement>(null)

  const closeOthers = useCallback(
    (keepId: string) => {
      const others = tabs.filter((t) => t.id !== keepId)
      logger.debug('TabBar: closeOthers: found', others.length, 'other tabs')
      requestClose(others.map((tab) => tab.id))
    },
    [tabs],
  )

  const requestClose = useCallback((ids: string[]) => {
    const requiresConfirmation = ids.some((id) => {
      const tab = tabs.find((item) => item.id === id)
      if (!tab?.terminalId) return false
      return connectionStatus[tab.terminalId] === 'connected' || recordingState[tab.terminalId] === 'recording'
    })
    if (requiresConfirmation) setPendingClose(ids)
    else ids.forEach(closeTab)
  }, [tabs, connectionStatus, recordingState, closeTab])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.preventDefault()
      setContextMenu({ visible: true, x: e.clientX, y: e.clientY, tabId })
      logger.debug('TabBar: contextMenu', tabId)
    },
    [],
  )

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu((prev) => ({ ...prev, visible: false }))
      }
    }
    if (contextMenu.visible) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [contextMenu.visible])

  const handleMenuAction = useCallback(
    (action: 'close' | 'closeOthers', tabId: string) => {
      if (action === 'close') {
        logger.debug('TabBar: contextMenu: close', tabId)
        requestClose([tabId])
      } else {
        closeOthers(tabId)
      }
      setContextMenu((prev) => ({ ...prev, visible: false }))
    },
    [requestClose, closeOthers],
  )

  if (tabs.length === 0) {
    return null
  }

  return (
    <div role="tablist" aria-label="终端标签" className="flex items-center border-b border-border bg-card overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId
        const status = connectionStatus[tab.terminalId ?? tab.id]
        return (
          <div
            key={tab.id}
            className={`group flex items-center gap-1.5 px-3 py-2 text-sm cursor-pointer border-r border-border transition-colors select-none flex-shrink-0 ${
              isActive
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:bg-secondary/50'
            }`}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            tabIndex={isActive ? 0 : -1}
            aria-selected={isActive}
            onKeyDown={(event) => {
              const index = tabs.findIndex((item) => item.id === tab.id)
              if (event.key === 'ArrowRight') setActiveTab(tabs[(index + 1) % tabs.length].id)
              if (event.key === 'ArrowLeft') setActiveTab(tabs[(index - 1 + tabs.length) % tabs.length].id)
              if (event.key === 'Enter' || event.key === ' ') setActiveTab(tab.id)
            }}
            onContextMenu={(e) => handleContextMenu(e, tab.id)}
          >
            <Circle
              className={`size-2 shrink-0 ${connectionStatusVisual(status).dotClass}`}
            />
            <span className="truncate max-w-[160px]">{tab.title}</span>
            <button
              type="button"
              className={`flex-shrink-0 rounded-sm p-0.5 hover:bg-muted transition-opacity ${
                isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
              onClick={(e) => {
                e.stopPropagation()
                logger.debug('TabBar: close', tab.id)
                requestClose([tab.id])
              }}
              aria-label={`关闭 ${tab.title}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}

      {contextMenu.visible && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[120px] overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-md"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenuItems.map((item) => (
            <button
              key={item.action}
              type="button"
              className={`flex w-full items-center rounded-md px-2 py-1.5 text-sm outline-none transition-colors ${
                item.destructive
                  ? 'text-destructive hover:bg-destructive/10'
                  : 'text-popover-foreground hover:bg-accent'
              }`}
              onClick={() => handleMenuAction(item.action, contextMenu.tabId)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <AlertDialog open={pendingClose.length > 0} onOpenChange={(open) => { if (!open) setPendingClose([]) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>关闭活动连接？</AlertDialogTitle>
            <AlertDialogDescription>所选标签仍有活动 SSH 连接或录制任务。关闭将终止远程会话且无法恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { pendingClose.forEach(closeTab); setPendingClose([]) }}>关闭连接</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
