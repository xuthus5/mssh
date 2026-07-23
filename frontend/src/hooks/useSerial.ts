import { useCallback, useEffect, useState } from 'react'
import { SerialService, TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'
import { useAppStore } from '@/store/appStore'
import { createTerminalTab } from '@/lib/terminalTabs'
import { openTerminalWithPoolCapacity } from '@/lib/openTerminal'
import { resolveOpenTerminalSize } from '@/lib/terminalOpenSize'
import type { SerialPort, SerialPortInput } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'

export type { SerialPort, SerialPortInput }


async function closeSerialTabsForPorts(portIDs: Iterable<number>) {
  const targets = new Set([...portIDs].map(Number).filter((id) => id > 0))
  if (targets.size === 0) return
  const store = useAppStore.getState()
  const tabs = store.tabs.filter((tab) => (
    tab.type === 'terminal'
    && tab.connectionKind === 'serial'
    && targets.has(Number(tab.serialPortId))
  ))
  for (const tab of tabs) {
    try {
      await store.closeTab(tab.id)
    } catch (error) {
      logger.error('close serial terminal tab failed', tab.id, error)
    }
  }
}

export function useSerial() {
  const [ports, setPorts] = useState<SerialPort[]>([])
  const [devices, setDevices] = useState<string[]>([])
  const [activeDevices, setActiveDevices] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [deviceProbeError, setDeviceProbeError] = useState('')
  const [activeMapError, setActiveMapError] = useState('')

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    setLoading(true)
    if (!options?.silent) setError('')
    try {
      let nextDeviceError = ''
      let nextActiveError = ''
      const [list, deviceList, active] = await Promise.all([
        SerialService.List(),
        SerialService.ListDevices().catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)
          logger.error('list serial devices failed', err)
          nextDeviceError = message
          return [] as string[]
        }),
        SerialService.ActiveDeviceMap().catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)
          logger.error('list active serial devices failed', err)
          nextActiveError = message
          return {} as Record<string, string>
        }),
      ])
      setPorts(list ?? [])
      setDevices(deviceList ?? [])
      setActiveDevices(active ?? {})
      setDeviceProbeError(nextDeviceError)
      setActiveMapError(nextActiveError)
      setError('')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('list serial ports failed', err)
      // Nested mutation refresh must not paint a failure banner over a successful save/connect.
      if (!options?.silent) {
        setError(message)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 5000)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.clearInterval(timer)
    }
  }, [refresh])

  const createPort = useCallback(async (input: SerialPortInput) => {
    const created = await SerialService.Create(input)
    setError('')
    await refresh({ silent: true })
    return created
  }, [refresh])

  const updatePort = useCallback(async (input: SerialPortInput) => {
    await SerialService.Update(input)
    setError('')
    await refresh({ silent: true })
  }, [refresh])

  const deletePort = useCallback(async (id: number) => {
    await SerialService.Delete(id)
    setError('')
    await closeSerialTabsForPorts([id])
    await refresh({ silent: true })
  }, [refresh])

  const deleteMany = useCallback(async (ids: number[]) => {
    await SerialService.DeleteMany(ids)
    setError('')
    await closeSerialTabsForPorts(ids)
    await refresh({ silent: true })
  }, [refresh])

  const duplicatePort = useCallback(async (port: SerialPort) => {
    await SerialService.Create({
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
    })
    setError('')
    await refresh({ silent: true })
  }, [refresh])

  const connectPort = useCallback(async (port: SerialPort) => {
    try {
      const size = resolveOpenTerminalSize()
      const terminalId = await openTerminalWithPoolCapacity(
        () => TerminalService.OpenSerial(Number(port.id), size.cols, size.rows),
      )
      const store = useAppStore.getState()
      const tab = createTerminalTab({
        sessionID: 0,
        sessionName: port.name || port.device,
        terminalID: terminalId,
        tabs: store.tabs,
        connectionKind: 'serial',
        serialPortId: Number(port.id),
      })
      store.setConnectionStatus(terminalId, 'connected')
      store.openTab(tab)
      setError('')
      await refresh({ silent: true })
      return terminalId
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('serial connect failed', err)
      toast(t('串口连接失败: ${}', message), 'error')
      throw err
    }
  }, [refresh])

  return {
    ports,
    devices,
    activeDevices,
    loading,
    error,
    deviceProbeError,
    activeMapError,
    refresh,
    createPort,
    updatePort,
    deletePort,
    deleteMany,
    duplicatePort,
    connectPort,
  }
}
