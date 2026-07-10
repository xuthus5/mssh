import { useRef, useState, useEffect, useCallback } from 'react'
import { X, Circle } from 'lucide-react'
import { useAppStore, type ConnectionStatus } from '@/store/appStore'

const contextMenuItems: Array<{
  label: string
  action: 'close' | 'closeOthers'
  destructive?: boolean
}> = [
  { label: '关闭', action: 'close' },
  { label: '关闭其他', action: 'closeOthers', destructive: true },
]

function statusDot(status: ConnectionStatus | undefined): string {
  switch (status) {
    case 'connected':
      return 'text-green-500 fill-green-500'
    case 'connecting':
      return 'text-yellow-500 fill-yellow-500'
    case 'disconnected':
    default:
      return 'text-gray-500 fill-gray-500'
  }
}

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
      console.log('[TabBar] closeOthers: found', others.length, 'other tabs')
      for (const t of others) {
        closeTab(t.id)
      }
    },
    [tabs, closeTab],
  )

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.preventDefault()
      setContextMenu({ visible: true, x: e.clientX, y: e.clientY, tabId })
      console.log('[TabBar] contextMenu', tabId)
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
        console.log('[TabBar] contextMenu: close', tabId)
        closeTab(tabId)
      } else {
        closeOthers(tabId)
      }
      setContextMenu((prev) => ({ ...prev, visible: false }))
    },
    [closeTab, closeOthers],
  )

  if (tabs.length === 0) {
    return null
  }

  return (
    <div className="flex items-center border-b border-border bg-card overflow-x-auto">
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
            onContextMenu={(e) => handleContextMenu(e, tab.id)}
          >
            <Circle
              className={`h-2 w-2 flex-shrink-0 ${statusDot(status)}`}
            />
            <span className="truncate max-w-[160px]">{tab.title}</span>
            <button
              type="button"
              className={`flex-shrink-0 rounded-sm p-0.5 hover:bg-muted transition-opacity ${
                isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
              onClick={(e) => {
                e.stopPropagation()
                console.log('[TabBar] close', tab.id)
                closeTab(tab.id)
              }}
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
    </div>
  )
}
