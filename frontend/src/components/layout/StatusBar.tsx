import { useState, useEffect } from 'react'
import { useAppStore } from '@/store/appStore'
import { Clock, Circle, Network } from 'lucide-react'
import { TransferCenter } from '@/components/file/TransferCenter'
import TunnelDialog from '@/components/session/TunnelDialog'
import type { Tunnel } from '@/hooks/useSession'
import { logger } from '@/lib/logger'
import { TunnelService } from '@/lib/wails'
import { TunnelType, type TunnelInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { toast } from '@/components/ui/toast'
import { connectionStatusVisual } from '@/lib/connectionStatusVisual'

function formatTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, '0')
  const m = date.getMinutes().toString().padStart(2, '0')
  const s = date.getSeconds().toString().padStart(2, '0')
  return `${h}:${m}:${s}`
}

export default function StatusBar() {
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const connectionStatus = useAppStore((s) => s.connectionStatus)
  const appStatus = useAppStore((s) => s.appStatus)
  const tunnelState = useAppStore((s) => s.tunnelState)
  const [now, setNow] = useState(new Date())
  const [tunnelOpen, setTunnelOpen] = useState(false)
  const [tunnels, setTunnels] = useState<Tunnel[]>([])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const status = activeTab
    ? connectionStatus[activeTab.terminalId ?? activeTab.id]
    : undefined
  const statusVisual = connectionStatusVisual(status)
  const displayStatus = activeTab ? statusVisual.label : appStatus

  const loadTunnels = async () => {
    try {
      const result = await TunnelService.List()
      setTunnels((result ?? []).filter((item) => !activeTab?.sessionId || item.session_id === activeTab.sessionId).map((item) => ({
        id: String(item.id), sessionId: String(item.session_id), type: item.type as Tunnel['type'],
        localAddress: item.local_host ?? '', localPort: item.local_port,
        remoteAddress: item.remote_host ?? '', remotePort: item.remote_port, running: tunnelState[String(item.id)] === 'running',
      })))
    } catch (err) {
      toast(`加载隧道失败: ${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  useEffect(() => {
    setTunnels((items) => items.map((item) => ({ ...item, running: tunnelState[item.id] === 'running' })))
  }, [tunnelState])

  const handleOpenTunnels = () => {
    if (!activeTab?.sessionId) return
    setTunnelOpen(true)
    void loadTunnels()
  }

  const handleTunnelStart = async (tunnel: Omit<Tunnel, 'id' | 'running'>) => {
    try {
      let id = Number((tunnel as Tunnel).id)
      if (!id) {
        const created = await TunnelService.Create({
          id: 0, name: `${tunnel.type}-${tunnel.localPort}`, session_id: Number(tunnel.sessionId), type: ({ local: TunnelType.TunnelLocal, remote: TunnelType.TunnelRemote, dynamic: TunnelType.TunnelDynamic })[tunnel.type],
          local_host: tunnel.localAddress, local_port: tunnel.localPort,
          remote_host: tunnel.remoteAddress, remote_port: tunnel.remotePort,
        } satisfies TunnelInput)
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
  }

  const handleTunnelStop = async (tunnelId: string) => {
    try {
      await TunnelService.Stop(Number(tunnelId))
      setTunnels((items) => items.map((item) => item.id === tunnelId ? { ...item, running: false } : item))
    } catch (err) {
      toast(`停止隧道失败: ${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  logger.debug('[StatusBar]', {
    tabs: tabs.length,
    activeTabId,
    status: displayStatus,
  })

  return (
    <footer className="flex-shrink-0 flex items-center justify-between px-3 py-1 border-t border-border bg-card text-xs text-muted-foreground">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <Circle
            className={`inline-block size-2.5 rounded-full ${statusVisual.dotClass}`}
            fill="currentColor"
          />
          {displayStatus}
        </span>
        {activeTab && (
          <span className="text-foreground/80">{activeTab.title}</span>
        )}
        <TransferCenter />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={handleOpenTunnels}
          title="隧道管理"
          disabled={!activeTab?.sessionId}
        >
          <Network className="h-3 w-3" />
          隧道
        </button>
        <span className="flex items-center gap-1 tabular-nums">
          <Clock className="h-3 w-3" />
          {formatTime(now)}
        </span>
      </div>
      <TunnelDialog
        open={tunnelOpen}
        onOpenChange={setTunnelOpen}
        tunnels={tunnels}
        onStart={handleTunnelStart}
        onStop={handleTunnelStop}
        sessionId={activeTab?.sessionId ? String(activeTab.sessionId) : ''}
      />
    </footer>
  )
}
