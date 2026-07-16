import { useEffect, useState } from 'react'
import { Clock, Circle } from 'lucide-react'
import { TransferCenter } from '@/components/file/TransferCenter'
import { connectionStatusVisual } from '@/lib/connectionStatusVisual'
import { logger } from '@/lib/logger'
import { useAppStore, type TerminalTab } from '@/store/appStore'

function formatTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, '0')
  const m = date.getMinutes().toString().padStart(2, '0')
  const s = date.getSeconds().toString().padStart(2, '0')
  return `${h}:${m}:${s}`
}

function useClock(): Date {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  return now
}

function StatusSummary({ label, dotClass, title }: { label: string; dotClass: string; title?: string }) {
  return <div className="flex items-center gap-3">
    <span className="flex items-center gap-1.5">
      <Circle className={`inline-block size-2.5 rounded-full ${dotClass}`} fill="currentColor" />
      {label}
    </span>
    {title !== undefined ? <span className="text-foreground/80">{title}</span> : null}
    <TransferCenter />
  </div>
}

function StatusActions({ now }: { now: Date }) {
  return <div className="flex items-center gap-3">
    <span className="flex items-center gap-1 tabular-nums">
      <Clock className="h-3 w-3" />
      {formatTime(now)}
    </span>
  </div>
}

export default function StatusBar() {
  const tabs = useAppStore((state) => state.tabs)
  const activeSurface = useAppStore((state) => state.activeSurface)
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const appStatus = useAppStore((state) => state.appStatus)
  const activeTab = activeSurface && activeSurface.type !== 'workspace'
    ? tabs.find((tab) => tab.id === activeSurface.id) : undefined
  const activeTerminal = activeTab?.type === 'terminal' ? activeTab : undefined
  const statusVisual = connectionStatusVisual(activeTerminal ? connectionStatus[activeTerminal.terminalId] : undefined)
  const now = useClock()
  const displayStatus = activeTerminal ? statusVisual.label : appStatus
  logger.debug('[StatusBar]', { tabs: tabs.length, activeSurface, status: displayStatus })
  return <footer className="flex-shrink-0 flex items-center justify-between px-3 py-1 border-t border-border bg-card text-xs text-muted-foreground">
    <StatusSummary label={displayStatus} dotClass={statusVisual.dotClass} title={activeTab?.title} />
    <StatusActions now={now} />
  </footer>
}
