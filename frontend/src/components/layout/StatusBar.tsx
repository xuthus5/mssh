import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Clock, Cpu, Circle, HardDrive, MemoryStick } from 'lucide-react'
import { TransferCenter } from '@/components/file/TransferCenter'
import { connectionStatusVisual } from '@/lib/connectionStatusVisual'
import { logger } from '@/lib/logger'
import { useAppStore } from '@/store/appStore'
import { TerminalService } from '@/lib/wails'

type SystemInfo = { cpu_percent: number; cpu_count: number; memory_used: number; memory_total: number; disk_used: number; disk_total: number; download_rate: number; upload_rate: number }

function useSystemInfo(terminalID: string | undefined, connected: boolean) {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setInfo(null); setFailed(false)
    if (!terminalID || !connected) return
    let cancelled = false
    const load = async () => {
      try { const result = await TerminalService.SystemInfo(terminalID); if (!cancelled) { setInfo(result); setFailed(false) } }
      catch (error) { logger.error('system info collection failed', error); if (!cancelled) { setInfo(null); setFailed(true) } }
    }
    void load()
    const timer = setInterval(() => { void load() }, 3000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [terminalID, connected])
  return { info, failed }
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value}B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(0)}K`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)}M`
  return `${(value / 1024 ** 3).toFixed(1)}G`
}

function SystemInfoBar({ info, failed }: { info: SystemInfo | null; failed: boolean }) {
  if (failed) return <span className="text-destructive">系统信息采集失败</span>
  if (!info) return null
  return <div className="flex items-center gap-3 whitespace-nowrap" aria-label="系统信息">
    <span className="flex items-center gap-1" title="CPU"><Cpu className="size-3.5" />{info.cpu_percent.toFixed(0)}% ({info.cpu_count}c)</span>
    <span className="flex items-center gap-1" title="内存"><MemoryStick className="size-3.5" />{formatBytes(info.memory_used)}/{formatBytes(info.memory_total)}</span>
    <span className="flex items-center gap-1" title="磁盘"><HardDrive className="size-3.5" />{formatBytes(info.disk_used)}/{formatBytes(info.disk_total)}</span>
    <span className="flex items-center gap-1" title="下载"><ArrowDown className="size-3.5" />{formatBytes(info.download_rate)}/s</span>
    <span className="flex items-center gap-1" title="上传"><ArrowUp className="size-3.5" />{formatBytes(info.upload_rate)}/s</span>
  </div>
}

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
  const systemInfo = useSystemInfo(activeTerminal?.terminalId, activeTerminal ? connectionStatus[activeTerminal.terminalId] === 'connected' : false)
  const now = useClock()
  const displayStatus = activeTerminal ? statusVisual.label : appStatus
  logger.debug('[StatusBar]', { tabs: tabs.length, activeSurface, status: displayStatus })
  return <footer className="flex-shrink-0 flex items-center justify-between px-3 py-1 border-t border-border bg-card text-xs text-muted-foreground">
    <StatusSummary label={displayStatus} dotClass={statusVisual.dotClass} title={activeTab?.title} />
    {activeTerminal && connectionStatus[activeTerminal.terminalId] === 'connected' && <SystemInfoBar {...systemInfo} />}
    <StatusActions now={now} />
  </footer>
}
