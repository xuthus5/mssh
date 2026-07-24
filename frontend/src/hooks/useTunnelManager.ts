import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { toast } from '@/components/ui/toast'
import type { Tunnel } from '@/hooks/useSession'
import { logger } from '@/lib/logger'
import { TunnelService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'
import { TunnelType, type TunnelInput } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'


type TunnelRecord = NonNullable<Awaited<ReturnType<typeof TunnelService.List>>>[number]

function mapTunnel(item: TunnelRecord, states: Record<string, 'running' | 'stopped'>): Tunnel {
  return {
    id: String(item.id), sessionId: String(item.session_id), type: item.type as Tunnel['type'],
    localAddress: item.local_host ?? '', localPort: item.local_port,
    remoteAddress: item.remote_host ?? '', remotePort: item.remote_port,
    running: states[String(item.id)] === 'running',
  }
}

type TunnelStartInput = Omit<Tunnel, 'id' | 'running'> & { id?: string }

function tunnelInput(tunnel: Omit<Tunnel, 'id' | 'running'> | TunnelStartInput): TunnelInput {
  return {
    id: 0, name: `${tunnel.type}-${tunnel.localPort}`, session_id: Number(tunnel.sessionId),
    type: ({ local: TunnelType.TunnelLocal, remote: TunnelType.TunnelRemote, dynamic: TunnelType.TunnelDynamic })[tunnel.type],
    local_host: tunnel.localAddress, local_port: tunnel.localPort,
    remote_host: tunnel.remoteAddress, remote_port: tunnel.remotePort,
  }
}

function useTunnelStart(load: (options?: { silent?: boolean }) => Promise<void>, setTunnels: Dispatch<SetStateAction<Tunnel[]>>) {
  return useCallback(async (tunnel: TunnelStartInput, options?: { silent?: boolean }) => {
    try {
      let id = Number(tunnel.id)
      if (!Number.isFinite(id) || id <= 0) {
        const created = await TunnelService.Create(tunnelInput(tunnel))
        if (!created) throw new Error(t('创建隧道失败'))
        id = created.id
      }
      await TunnelService.Start(id)
      await load({ silent: true })
      setTunnels((items) => items.map((item) => item.id === String(id) ? { ...item, running: true } : item))
    } catch (error) {
      logger.error('tunnel start failed', error)
      // TunnelDialog owns start failures (form inline or list action banner).
      void options
      throw error
    }
  }, [load, setTunnels])
}

function useTunnelStop(setTunnels: Dispatch<SetStateAction<Tunnel[]>>) {
  return useCallback(async (id: string) => {
    try {
      await TunnelService.Stop(Number(id))
      setTunnels((items) => items.map((item) => item.id === id ? { ...item, running: false } : item))
    } catch (error) {
      logger.error('tunnel stop failed', error)
      // TunnelDialog owns stop failures via action banner.
      throw error
    }
  }, [setTunnels])
}

function useTunnelRemove(setTunnels: Dispatch<SetStateAction<Tunnel[]>>) {
  return useCallback(async (id: string) => {
    try {
      // Best-effort stop if currently running; Delete also closes active tunnels server-side.
      try {
        await TunnelService.Stop(Number(id))
      } catch {
        // ignore stop-not-running
      }
      await TunnelService.Delete(Number(id))
      setTunnels((items) => items.filter((item) => item.id !== id))
      toast(t('隧道已删除'), 'success')
    } catch (error) {
      logger.error('tunnel delete failed', error)
      // TunnelDialog owns delete failures via action banner.
      throw error
    }
  }, [setTunnels])
}

export function useTunnelManager(sessionID?: number) {
  const states = useAppStore((state) => state.tunnelState)
  const [tunnels, setTunnels] = useState<Tunnel[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true)
    try {
      const result = await TunnelService.List()
      setTunnels((result ?? []).filter((item) => sessionID === undefined || item.session_id === sessionID).map((item) => mapTunnel(item, states)))
      if (!options?.silent) setError('')
    } catch (error) {
      logger.error('load tunnels failed', error)
      // Non-silent loads own a page/panel error so empty table is not mistaken for "no tunnels".
      if (!options?.silent) {
        setError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (!options?.silent) setLoading(false)
    }
  }, [sessionID, states])
  useEffect(() => { setTunnels((items) => items.map((item) => ({ ...item, running: states[item.id] === 'running' }))) }, [states])
  return { tunnels, error, loading, load, start: useTunnelStart(load, setTunnels), stop: useTunnelStop(setTunnels), remove: useTunnelRemove(setTunnels) }
}
