import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { t } from '@/i18n'
import { logger } from '@/lib/logger'
import { AsyncPoller } from '@/lib/asyncPoller'
import { openTerminalWithPoolCapacity } from '@/lib/openTerminal'
import { resolveOpenTerminalSize } from '@/lib/terminalOpenSize'
import { createTerminalTab } from '@/lib/terminalTabs'
import { SerialService, TerminalService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'
import type { SerialPort, SerialPortInput } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'

export type SerialRefresh = (options?: { silent?: boolean }) => Promise<void>

type SerialCatalog = {
  ports: SerialPort[]
  devices: string[]
  activeDevices: Record<string, string>
  loading: boolean
  error: string
  deviceProbeError: string
  activeMapError: string
  setPorts: Dispatch<SetStateAction<SerialPort[]>>
  setDevices: Dispatch<SetStateAction<string[]>>
  setActiveDevices: Dispatch<SetStateAction<Record<string, string>>>
  setLoading: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string>>
  setDeviceProbeError: Dispatch<SetStateAction<string>>
  setActiveMapError: Dispatch<SetStateAction<string>>
  lifecycle: MutableRefObject<number>
  requestID: MutableRefObject<number>
}

type SerialCatalogRuntime = Pick<SerialCatalog,
  'setPorts' | 'setDevices' | 'setActiveDevices' | 'setLoading' | 'setError'
  | 'setDeviceProbeError' | 'setActiveMapError' | 'lifecycle' | 'requestID'>

export function useSerialCatalog(): SerialCatalog {
  const [ports, setPorts] = useState<SerialPort[]>([])
  const [devices, setDevices] = useState<string[]>([])
  const [activeDevices, setActiveDevices] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [deviceProbeError, setDeviceProbeError] = useState('')
  const [activeMapError, setActiveMapError] = useState('')
  const lifecycle = useRef(0)
  const requestID = useRef(0)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  return {
    ports, devices, activeDevices, loading, error, deviceProbeError, activeMapError,
    setPorts, setDevices, setActiveDevices, setLoading, setError,
    setDeviceProbeError, setActiveMapError, lifecycle, requestID,
  }
}

async function loadSerialDevices() {
  try {
    return { devices: await SerialService.ListDevices() ?? [], error: '' }
  } catch (error) {
    logger.error('list serial devices failed', error)
    return { devices: [] as string[], error: error instanceof Error ? error.message : String(error) }
  }
}

async function loadActiveDeviceMap() {
  try {
    const active = await SerialService.ActiveDeviceMap() ?? {}
    return {
      active: Object.fromEntries(Object.entries(active).filter((entry): entry is [string, string] => entry[1] !== undefined)),
      error: '',
    }
  } catch (error) {
    logger.error('list active serial devices failed', error)
    return { active: {} as Record<string, string>, error: error instanceof Error ? error.message : String(error) }
  }
}

async function refreshSerialCatalog(catalog: SerialCatalogRuntime, options?: { silent?: boolean }) {
  const lifecycleToken = catalog.lifecycle.current
  const currentRequest = ++catalog.requestID.current
  const isCurrent = () => catalog.lifecycle.current === lifecycleToken && catalog.requestID.current === currentRequest
  catalog.setLoading(true)
  if (!options?.silent) catalog.setError('')
  try {
    const [ports, deviceResult, activeResult] = await Promise.all([
      SerialService.List(), loadSerialDevices(), loadActiveDeviceMap(),
    ])
    if (!isCurrent()) return
    catalog.setPorts(ports ?? [])
    catalog.setDevices(deviceResult.devices)
    catalog.setActiveDevices(activeResult.active)
    catalog.setDeviceProbeError(deviceResult.error)
    catalog.setActiveMapError(activeResult.error)
    catalog.setError('')
  } catch (error) {
    logger.error('list serial ports failed', error)
    if (isCurrent() && !options?.silent) catalog.setError(error instanceof Error ? error.message : String(error))
  } finally {
    if (isCurrent()) catalog.setLoading(false)
  }
}

export function useSerialRefresh(catalog: SerialCatalog): SerialRefresh {
  const { lifecycle, requestID, setLoading, setError, setPorts, setDevices,
    setActiveDevices, setDeviceProbeError, setActiveMapError } = catalog
  return useCallback((options) => refreshSerialCatalog({
    lifecycle, requestID, setLoading, setError, setPorts, setDevices,
    setActiveDevices, setDeviceProbeError, setActiveMapError,
  }, options), [lifecycle, requestID, setActiveDevices, setActiveMapError, setDeviceProbeError,
    setDevices, setError, setLoading, setPorts])
}

export function useSerialPolling(refresh: SerialRefresh) {
  useEffect(() => {
    const poller = new AsyncPoller({
      task: async () => {
        if (document.visibilityState === 'visible') await refresh()
      },
      delayMs: 5000,
      onError: (error) => logger.error('serial catalog polling failed', error),
    })
    void poller.start()
    const onFocus = () => { void poller.trigger() }
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      poller.stop()
    }
  }, [refresh])
}

async function closeSerialTabsForPorts(portIDs: Iterable<number>) {
  const targets = new Set([...portIDs].map(Number).filter((id) => id > 0))
  if (targets.size === 0) return
  const store = useAppStore.getState()
  const tabs = store.tabs.filter((tab) => tab.type === 'terminal'
    && tab.connectionKind === 'serial' && targets.has(Number(tab.serialPortId)))
  for (const tab of tabs) {
    try {
      await store.closeTab(tab.id)
    } catch (error) {
      logger.error('close serial terminal tab failed', tab.id, error)
    }
  }
}

type MutationOptions = {
  refresh: SerialRefresh
  lifecycle: MutableRefObject<number>
  setError: Dispatch<SetStateAction<string>>
}

function clearMutationError(options: MutationOptions, lifecycleToken: number) {
  if (options.lifecycle.current === lifecycleToken) options.setError('')
}

export function useCreateSerialPort(options: MutationOptions) {
  const { lifecycle, refresh, setError } = options
  return useCallback(async (input: SerialPortInput) => {
    const lifecycleToken = lifecycle.current
    const created = await SerialService.Create(input)
    clearMutationError({ lifecycle, refresh, setError }, lifecycleToken)
    await refresh({ silent: true })
    return created
  }, [lifecycle, refresh, setError])
}

export function useUpdateSerialPort(options: MutationOptions) {
  const { lifecycle, refresh, setError } = options
  return useCallback(async (input: SerialPortInput) => {
    const lifecycleToken = lifecycle.current
    await SerialService.Update(input)
    clearMutationError({ lifecycle, refresh, setError }, lifecycleToken)
    await refresh({ silent: true })
  }, [lifecycle, refresh, setError])
}

export function useDeleteSerialPort(options: MutationOptions) {
  const { lifecycle, refresh, setError } = options
  return useCallback(async (id: number) => {
    const lifecycleToken = lifecycle.current
    await SerialService.Delete(id)
    clearMutationError({ lifecycle, refresh, setError }, lifecycleToken)
    await closeSerialTabsForPorts([id])
    await refresh({ silent: true })
  }, [lifecycle, refresh, setError])
}

export function useDeleteManySerialPorts(options: MutationOptions) {
  const { lifecycle, refresh, setError } = options
  return useCallback(async (ids: number[]) => {
    const lifecycleToken = lifecycle.current
    await SerialService.DeleteMany(ids)
    clearMutationError({ lifecycle, refresh, setError }, lifecycleToken)
    await closeSerialTabsForPorts(ids)
    await refresh({ silent: true })
  }, [lifecycle, refresh, setError])
}

function duplicateSerialInput(port: SerialPort): SerialPortInput {
  return {
    id: 0,
    name: `${port.name} ${t('副本')}`,
    device: port.device,
    baud_rate: port.baud_rate,
    data_bits: port.data_bits,
    parity: port.parity,
    stop_bits: port.stop_bits,
    flow_control: port.flow_control,
    line_ending: port.line_ending,
    local_echo: Boolean(port.local_echo),
    dtr_on_open: port.dtr_on_open !== false,
    rts_on_open: port.rts_on_open !== false,
    notes: port.notes,
    sort_order: port.sort_order,
  }
}

export function useDuplicateSerialPort(options: MutationOptions) {
  const { lifecycle, refresh, setError } = options
  return useCallback(async (port: SerialPort) => {
    const lifecycleToken = lifecycle.current
    await SerialService.Create(duplicateSerialInput(port))
    clearMutationError({ lifecycle, refresh, setError }, lifecycleToken)
    await refresh({ silent: true })
  }, [lifecycle, refresh, setError])
}

async function openSerialTerminal(port: SerialPort) {
  const size = resolveOpenTerminalSize()
  const terminalID = await openTerminalWithPoolCapacity(
    () => TerminalService.OpenSerial(Number(port.id), size.cols, size.rows),
  )
  const store = useAppStore.getState()
  const tab = createTerminalTab({
    sessionID: 0, sessionName: port.name || port.device, terminalID, tabs: store.tabs,
    connectionKind: 'serial', serialPortId: Number(port.id),
  })
  store.setConnectionStatus(terminalID, 'connected')
  store.openTab(tab)
  return terminalID
}

export function useConnectSerialPort(options: MutationOptions) {
  const { lifecycle, refresh, setError } = options
  return useCallback(async (port: SerialPort) => {
    const lifecycleToken = lifecycle.current
    try {
      const terminalID = await openSerialTerminal(port)
      clearMutationError({ lifecycle, refresh, setError }, lifecycleToken)
      await refresh({ silent: true })
      return terminalID
    } catch (error) {
      logger.error('serial connect failed', error)
      if (lifecycle.current === lifecycleToken) {
        setError(t('串口连接失败: ${}', error instanceof Error ? error.message : String(error)))
      }
      throw error
    }
  }, [lifecycle, refresh, setError])
}
