import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { Clock, Circle, Network } from 'lucide-react'
import { TransferCenter } from '@/components/file/TransferCenter'
import TunnelDialog from '@/components/session/TunnelDialog'
import { toast } from '@/components/ui/toast'
import type { Tunnel } from '@/hooks/useSession'
import { connectionStatusVisual } from '@/lib/connectionStatusVisual'
import { logger } from '@/lib/logger'
import { TunnelService } from '@/lib/wails'
import { useAppStore, type TerminalTab } from '@/store/appStore'
import { TunnelType, type TunnelInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

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

type TunnelRecord = NonNullable<Awaited<ReturnType<typeof TunnelService.List>>>[number]

function mapTunnel(item: TunnelRecord, tunnelState: Record<string, 'running' | 'stopped'>): Tunnel {
  return {
    id: String(item.id), sessionId: String(item.session_id), type: item.type as Tunnel['type'],
    localAddress: item.local_host ?? '', localPort: item.local_port,
    remoteAddress: item.remote_host ?? '', remotePort: item.remote_port,
    running: tunnelState[String(item.id)] === 'running',
  }
}

function useTunnelList(activeTerminal: TerminalTab | undefined, tunnelState: Record<string, 'running' | 'stopped'>) {
  const [tunnels, setTunnels] = useState<Tunnel[]>([])
  const loadTunnels = useCallback(async () => {
    try {
      const result = await TunnelService.List()
      setTunnels((result ?? [])
        .filter((item) => !activeTerminal || item.session_id === activeTerminal.sessionId)
        .map((item) => mapTunnel(item, tunnelState)))
    } catch (err) {
      toast(`加载隧道失败: ${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }, [activeTerminal, tunnelState])
  useEffect(() => {
    setTunnels((items) => items.map((item) => ({ ...item, running: tunnelState[item.id] === 'running' })))
  }, [tunnelState])
  return { tunnels, setTunnels, loadTunnels }
}

function tunnelInput(tunnel: Omit<Tunnel, 'id' | 'running'>): TunnelInput {
  return {
    id: 0, name: `${tunnel.type}-${tunnel.localPort}`, session_id: Number(tunnel.sessionId),
    type: ({ local: TunnelType.TunnelLocal, remote: TunnelType.TunnelRemote, dynamic: TunnelType.TunnelDynamic })[tunnel.type],
    local_host: tunnel.localAddress, local_port: tunnel.localPort,
    remote_host: tunnel.remoteAddress, remote_port: tunnel.remotePort,
  }
}

function useTunnelStart(loadTunnels: () => Promise<void>, setTunnels: Dispatch<SetStateAction<Tunnel[]>>) {
  return useCallback(async (tunnel: Omit<Tunnel, 'id' | 'running'>) => {
    try {
      let id = Number((tunnel as Tunnel).id)
      if (!id) {
        const created = await TunnelService.Create(tunnelInput(tunnel))
        if (!created) throw new Error('创建隧道失败')
        id = created.id
      }
      await TunnelService.Start(id)
      await loadTunnels()
      setTunnels((items) => items.map((item) => item.id === String(id) ? { ...item, running: true } : item))
    } catch (err) {
      logger.error('StatusBar: tunnel start error', err)
      toast(`启动隧道失败: ${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }, [loadTunnels, setTunnels])
}

function useTunnelStop(setTunnels: Dispatch<SetStateAction<Tunnel[]>>) {
  return useCallback(async (tunnelId: string) => {
    try {
      await TunnelService.Stop(Number(tunnelId))
      setTunnels((items) => items.map((item) => item.id === tunnelId ? { ...item, running: false } : item))
    } catch (err) {
      toast(`停止隧道失败: ${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }, [setTunnels])
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

function StatusActions({ disabled, now, onOpen }: { disabled: boolean; now: Date; onOpen: () => void }) {
  return <div className="flex items-center gap-3">
    <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      onClick={onOpen} title="隧道管理" disabled={disabled}>
      <Network className="h-3 w-3" />
      隧道
    </button>
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
  const tunnelState = useAppStore((state) => state.tunnelState)
  const activeTab = activeSurface && activeSurface.type !== 'workspace'
    ? tabs.find((tab) => tab.id === activeSurface.id) : undefined
  const activeTerminal = activeTab?.type === 'terminal' ? activeTab : undefined
  const statusVisual = connectionStatusVisual(activeTerminal ? connectionStatus[activeTerminal.terminalId] : undefined)
  const { tunnels, setTunnels, loadTunnels } = useTunnelList(activeTerminal, tunnelState)
  const [tunnelOpen, setTunnelOpen] = useState(false)
  const now = useClock()
  const handleStart = useTunnelStart(loadTunnels, setTunnels)
  const handleStop = useTunnelStop(setTunnels)
  const handleOpen = () => {
    if (!activeTerminal) return
    setTunnelOpen(true)
    void loadTunnels()
  }
  const displayStatus = activeTerminal ? statusVisual.label : appStatus
  logger.debug('[StatusBar]', { tabs: tabs.length, activeSurface, status: displayStatus })
  return <footer className="flex-shrink-0 flex items-center justify-between px-3 py-1 border-t border-border bg-card text-xs text-muted-foreground">
    <StatusSummary label={displayStatus} dotClass={statusVisual.dotClass} title={activeTab?.title} />
    <StatusActions disabled={!activeTerminal} now={now} onOpen={handleOpen} />
    <TunnelDialog open={tunnelOpen} onOpenChange={setTunnelOpen} tunnels={tunnels}
      onStart={handleStart} onStop={handleStop} sessionId={activeTerminal ? String(activeTerminal.sessionId) : ''} />
  </footer>
}
