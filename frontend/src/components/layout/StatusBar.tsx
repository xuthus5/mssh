import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Clock, Cpu, Circle, HardDrive, MemoryStick } from 'lucide-react'
import { TransferCenter } from '@/components/file/TransferCenter'
import { connectionStatusVisual } from '@/lib/connectionStatusVisual'
import { logger } from '@/lib/logger'
import { useAppStore } from '@/store/appStore'
import { TerminalService } from '@/lib/wails'

type SystemInfo = {
  cpu_percent: number
  cpu_count: number
  memory_used: number
  memory_total: number
  disk_used: number
  disk_total: number
  download_rate: number
  upload_rate: number
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value}B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(0)}K`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)}M`
  return `${(value / 1024 ** 3).toFixed(1)}G`
}

function formatTime(date: Date): string {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => part.toString().padStart(2, '0'))
    .join(':')
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' ? true : document.visibilityState !== 'hidden')
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}

function useClock(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [enabled])
  return now
}

function useSystemInfo(terminalID: string | undefined, connected: boolean, visible: boolean) {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setInfo(null)
    setFailed(false)
    if (!terminalID || !connected || !visible) return
    let cancelled = false
    const load = async () => {
      try {
        const result = await TerminalService.SystemInfo(terminalID)
        if (!cancelled) { setInfo(result); setFailed(false) }
      } catch (error) {
        logger.error('system info collection failed', error)
        if (!cancelled) { setInfo(null); setFailed(true) }
      }
    }
    void load()
    const timer = window.setInterval(() => { void load() }, 3000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [terminalID, connected, visible])
  return { info, failed }
}

function SystemInfoBar({ info, failed }: { info: SystemInfo | null; failed: boolean }) {
  if (failed) return <span className="text-destructive">系统信息采集失败</span>
  if (!info) return null
  return (
    <div className="flex items-center gap-3 whitespace-nowrap" aria-label="系统信息">
      <span className="flex items-center gap-1" title="CPU"><Cpu className="size-3.5" />{info.cpu_percent.toFixed(0)}% ({info.cpu_count}c)</span>
      <span className="flex items-center gap-1" title="内存"><MemoryStick className="size-3.5" />{formatBytes(info.memory_used)}/{formatBytes(info.memory_total)}</span>
      <span className="flex items-center gap-1" title="磁盘"><HardDrive className="size-3.5" />{formatBytes(info.disk_used)}/{formatBytes(info.disk_total)}</span>
      <span className="flex items-center gap-1" title="下载"><ArrowDown className="size-3.5" />{formatBytes(info.download_rate)}/s</span>
      <span className="flex items-center gap-1" title="上传"><ArrowUp className="size-3.5" />{formatBytes(info.upload_rate)}/s</span>
    </div>
  )
}

function StatusClock() {
  const visible = useDocumentVisible()
  const now = useClock(visible)
  return (
    <span className="flex items-center gap-1 tabular-nums">
      <Clock className="h-3 w-3" />
      {formatTime(now)}
    </span>
  )
}

function ActiveSystemInfo() {
  const visible = useDocumentVisible()
  const activeSurface = useAppStore((state) => state.activeSurface)
  const tabs = useAppStore((state) => state.tabs)
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const activeTab = activeSurface && activeSurface.type !== 'workspace'
    ? tabs.find((tab) => tab.id === activeSurface.id)
    : undefined
  const activeTerminal = activeTab?.type === 'terminal' ? activeTab : undefined
  const connected = activeTerminal ? connectionStatus[activeTerminal.terminalId] === 'connected' : false
  const systemInfo = useSystemInfo(activeTerminal?.terminalId, connected, visible)
  return <SystemInfoBar info={systemInfo.info} failed={systemInfo.failed} />
}

function ConnectionStatusSummary() {
  const activeSurface = useAppStore((state) => state.activeSurface)
  const tabs = useAppStore((state) => state.tabs)
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const appStatus = useAppStore((state) => state.appStatus)
  const activeTab = activeSurface && activeSurface.type !== 'workspace'
    ? tabs.find((tab) => tab.id === activeSurface.id)
    : undefined
  const activeTerminal = activeTab?.type === 'terminal' ? activeTab : undefined
  const statusVisual = connectionStatusVisual(activeTerminal ? connectionStatus[activeTerminal.terminalId] : undefined)
  const displayStatus = activeTerminal ? statusVisual.label : appStatus
  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center gap-1.5">
        <Circle className={`inline-block size-2.5 rounded-full ${statusVisual.dotClass}`} fill="currentColor" />
        {displayStatus}
      </span>
      {activeTab ? <span className="text-foreground/80">{activeTab.title}</span> : null}
      <TransferCenter />
    </div>
  )
}

export default function StatusBar() {
  return (
    <footer className="flex flex-shrink-0 items-center justify-between border-t border-border bg-card px-3 py-1 text-xs text-muted-foreground" aria-live="polite">
      <ConnectionStatusSummary />
      <div className="flex items-center gap-3">
        <ActiveSystemInfo />
        <StatusClock />
      </div>
    </footer>
  )
}
