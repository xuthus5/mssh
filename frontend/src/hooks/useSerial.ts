import { useCallback, useEffect, useState } from 'react'
import { SerialService, TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'
import { useAppStore } from '@/store/appStore'
import { createTerminalTab } from '@/lib/terminalTabs'
import { openTerminalWithPoolCapacity } from '@/lib/openTerminal'
import type { SerialPort, SerialPortInput } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'

export type { SerialPort, SerialPortInput }

export function useSerial() {
  const [ports, setPorts] = useState<SerialPort[]>([])
  const [devices, setDevices] = useState<string[]>([])
  const [activeDevices, setActiveDevices] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [list, deviceList, active] = await Promise.all([
        SerialService.List(),
        SerialService.ListDevices().catch((err: unknown) => {
          logger.error('list serial devices failed', err)
          return [] as string[]
        }),
        SerialService.ActiveDeviceMap().catch((err: unknown) => {
          logger.error('list active serial devices failed', err)
          return {} as Record<string, string>
        }),
      ])
      setPorts(list ?? [])
      setDevices(deviceList ?? [])
      setActiveDevices(active ?? {})
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      logger.error('list serial ports failed', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const createPort = useCallback(async (input: SerialPortInput) => {
    const created = await SerialService.Create(input)
    await refresh()
    return created
  }, [refresh])

  const updatePort = useCallback(async (input: SerialPortInput) => {
    await SerialService.Update(input)
    await refresh()
  }, [refresh])

  const deletePort = useCallback(async (id: number) => {
    await SerialService.Delete(id)
    await refresh()
  }, [refresh])

  const deleteMany = useCallback(async (ids: number[]) => {
    await SerialService.DeleteMany(ids)
    await refresh()
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
    await refresh()
  }, [refresh])

  const connectPort = useCallback(async (port: SerialPort) => {
    try {
      const terminalId = await openTerminalWithPoolCapacity(
        () => TerminalService.OpenSerial(Number(port.id), 80, 24),
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
      await refresh()
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
    refresh,
    createPort,
    updatePort,
    deletePort,
    deleteMany,
    duplicatePort,
    connectPort,
  }
}
