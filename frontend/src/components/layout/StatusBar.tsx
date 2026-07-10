import { useState, useEffect } from 'react'
import { useAppStore, type ConnectionStatus } from '@/store/appStore'
import { Gauge, Clock, Circle } from 'lucide-react'

function formatTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, '0')
  const m = date.getMinutes().toString().padStart(2, '0')
  const s = date.getSeconds().toString().padStart(2, '0')
  return `${h}:${m}:${s}`
}

function statusDot(status: ConnectionStatus | undefined): string {
  switch (status) {
    case 'connected':
      return 'bg-green-500'
    case 'connecting':
      return 'bg-yellow-500'
    case 'disconnected':
    default:
      return 'bg-gray-500'
  }
}

function statusText(status: ConnectionStatus | undefined): string {
  switch (status) {
    case 'connected':
      return '已连接'
    case 'connecting':
      return '连接中'
    case 'disconnected':
      return '未连接'
    default:
      return '就绪'
  }
}

export default function StatusBar() {
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const connectionStatus = useAppStore((s) => s.connectionStatus)
  const appStatus = useAppStore((s) => s.appStatus)
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const status = activeTab
    ? connectionStatus[activeTab.terminalId ?? activeTab.id]
    : undefined
  const displayStatus = activeTab ? statusText(status) : appStatus

  console.log('[StatusBar]', {
    tabs: tabs.length,
    activeTabId,
    status: displayStatus,
  })

  return (
    <footer className="flex-shrink-0 flex items-center justify-between px-3 py-1 border-t border-border bg-card text-xs text-muted-foreground">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <Circle
            className={`h-2 w-2 rounded-full inline-block ${statusDot(status)}`}
            fill="currentColor"
          />
          {displayStatus}
        </span>
        {activeTab && (
          <span className="text-foreground/80">{activeTab.title}</span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <Gauge className="h-3 w-3" />
          <span className="tabular-nums">0%</span>
        </span>
        <span className="flex items-center gap-1 tabular-nums">
          <Clock className="h-3 w-3" />
          {formatTime(now)}
        </span>
      </div>
    </footer>
  )
}
