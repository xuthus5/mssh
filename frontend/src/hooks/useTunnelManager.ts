import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { toast } from '@/components/ui/toast'
import type { Tunnel } from '@/hooks/useSession'
import { logger } from '@/lib/logger'
import { TunnelService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'
import { TunnelType, type TunnelInput } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'
import { isOperationBusyError } from '@/lib/operationBusyError'
import {
  emitTunnelCatalogChanged,
  onTunnelCatalogChanged,
  runTunnelMutation,
} from '@/lib/tunnelMutationCoordinator'


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

interface TunnelMutationContext {
  sessionID?: number
  load: (options?: { silent?: boolean }) => Promise<void>
  setTunnels: Dispatch<SetStateAction<Tunnel[]>>
  lifecycle: MutableRefObject<number>
  source: symbol
}

interface TunnelLifecycleState {
  setCatalogSessionID: Dispatch<SetStateAction<number | undefined>>
  setTunnels: Dispatch<SetStateAction<Tunnel[]>>
  setError: Dispatch<SetStateAction<string>>
  setLoading: Dispatch<SetStateAction<boolean>>
}

function tunnelInput(tunnel: Omit<Tunnel, 'id' | 'running'> | TunnelStartInput): TunnelInput {
  return {
    id: 0, name: `${tunnel.type}-${tunnel.localPort}`, session_id: Number(tunnel.sessionId),
    type: ({ local: TunnelType.TunnelLocal, remote: TunnelType.TunnelRemote, dynamic: TunnelType.TunnelDynamic })[tunnel.type],
    local_host: tunnel.localAddress, local_port: tunnel.localPort,
    remote_host: tunnel.remoteAddress, remote_port: tunnel.remotePort,
  }
}

function useTunnelStart({ load, setTunnels, lifecycle, source }: TunnelMutationContext) {
  return useCallback(async (tunnel: TunnelStartInput, options?: { silent?: boolean }) => {
    try {
      await runTunnelMutation(tunnel.sessionId, async () => {
        const lifecycleToken = lifecycle.current
        let id = Number(tunnel.id)
        if (!Number.isFinite(id) || id <= 0) {
          const created = await TunnelService.Create(tunnelInput(tunnel))
          if (!created) throw new Error(t('创建隧道失败'))
          id = created.id
        }
        await TunnelService.Start(id)
        await load({ silent: true })
        if (lifecycle.current === lifecycleToken) {
          setTunnels((items) => items.map((item) => item.id === String(id) ? { ...item, running: true } : item))
        }
      })
      emitTunnelCatalogChanged(tunnel.sessionId, source)
    } catch (error) {
      if (!isOperationBusyError(error)) logger.error('tunnel start failed', error)
      // TunnelDialog owns start failures (form inline or list action banner).
      void options
      throw error
    }
  }, [lifecycle, load, setTunnels, source])
}

function useTunnelStop({ sessionID, setTunnels, lifecycle, source }: TunnelMutationContext) {
  return useCallback(async (id: string) => {
    try {
      const scope = String(sessionID ?? 'all')
      await runTunnelMutation(scope, async () => {
        const lifecycleToken = lifecycle.current
        await TunnelService.Stop(Number(id))
        if (lifecycle.current === lifecycleToken) {
          setTunnels((items) => items.map((item) => item.id === id ? { ...item, running: false } : item))
        }
      })
      emitTunnelCatalogChanged(scope, source)
    } catch (error) {
      if (!isOperationBusyError(error)) logger.error('tunnel stop failed', error)
      // TunnelDialog owns stop failures via action banner.
      throw error
    }
  }, [lifecycle, sessionID, setTunnels, source])
}

function useTunnelRemove({ sessionID, setTunnels, lifecycle, source }: TunnelMutationContext) {
  return useCallback(async (id: string) => {
    try {
      const scope = String(sessionID ?? 'all')
      await runTunnelMutation(scope, async () => {
        const lifecycleToken = lifecycle.current
        // Best-effort stop if currently running; Delete also closes active tunnels server-side.
        try {
          await TunnelService.Stop(Number(id))
        } catch (stopError) {
          void stopError
        }
        await TunnelService.Delete(Number(id))
        if (lifecycle.current === lifecycleToken) {
          setTunnels((items) => items.filter((item) => item.id !== id))
          toast(t('隧道已删除'), 'success')
        }
      })
      emitTunnelCatalogChanged(scope, source)
    } catch (error) {
      if (!isOperationBusyError(error)) logger.error('tunnel delete failed', error)
      // TunnelDialog owns delete failures via action banner.
      throw error
    }
  }, [lifecycle, sessionID, setTunnels, source])
}

function useTunnelSessionLifecycle(sessionID: number | undefined, state: TunnelLifecycleState) {
  const lifecycle = useRef(0)
  const requestID = useRef(0)
  useEffect(() => {
    const token = ++lifecycle.current
    requestID.current++
    state.setCatalogSessionID(sessionID)
    state.setTunnels([])
    state.setError('')
    state.setLoading(false)
    return () => {
      if (lifecycle.current === token) lifecycle.current++
      requestID.current++
    }
  }, [sessionID, state.setCatalogSessionID, state.setError, state.setLoading, state.setTunnels])
  return { lifecycle, requestID }
}

export function useTunnelManager(sessionID?: number) {
  const states = useAppStore((state) => state.tunnelState)
  const [tunnels, setTunnels] = useState<Tunnel[]>([])
  const [catalogSessionID, setCatalogSessionID] = useState<number | undefined>(sessionID)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const source = useRef(Symbol('tunnel-manager')).current
  const { lifecycle, requestID } = useTunnelSessionLifecycle(sessionID, {
    setCatalogSessionID, setTunnels, setError, setLoading,
  })
  const load = useCallback(async (options?: { silent?: boolean }) => {
    const lifecycleToken = lifecycle.current
    const currentRequest = ++requestID.current
    const isCurrent = () => lifecycle.current === lifecycleToken && requestID.current === currentRequest
    if (!options?.silent) setLoading(true)
    try {
      const result = await TunnelService.List()
      if (!isCurrent()) return
      setCatalogSessionID(sessionID)
      setTunnels((result ?? []).filter((item) => sessionID === undefined || item.session_id === sessionID).map((item) => mapTunnel(item, states)))
      if (!options?.silent) setError('')
    } catch (error) {
      logger.error('load tunnels failed', error)
      // Non-silent loads own a page/panel error so empty table is not mistaken for "no tunnels".
      if (isCurrent() && !options?.silent) {
        setError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (isCurrent() && !options?.silent) setLoading(false)
    }
  }, [sessionID, states])
  useEffect(() => {
    if (sessionID === undefined) return
    return onTunnelCatalogChanged(sessionID, source, () => { void load({ silent: true }) })
  }, [load, sessionID, source])
  useEffect(() => { setTunnels((items) => items.map((item) => ({ ...item, running: states[item.id] === 'running' }))) }, [states])
  const mutationContext = { sessionID, load, setTunnels, lifecycle, source }
  const currentCatalog = catalogSessionID === sessionID
  return { tunnels: currentCatalog ? tunnels : [], error: currentCatalog ? error : '', loading: currentCatalog ? loading : false, load,
    start: useTunnelStart(mutationContext),
    stop: useTunnelStop(mutationContext),
    remove: useTunnelRemove(mutationContext) }
}
