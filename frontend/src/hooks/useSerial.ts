import type { SerialPort, SerialPortInput } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import {
  useConnectSerialPort,
  useCreateSerialPort,
  useDeleteManySerialPorts,
  useDeleteSerialPort,
  useDuplicateSerialPort,
  useSerialCatalog,
  useSerialPolling,
  useSerialRefresh,
  useUpdateSerialPort,
} from '@/hooks/serialRuntime'

export type { SerialPort, SerialPortInput }
export function useSerial() {
  const catalog = useSerialCatalog()
  const refresh = useSerialRefresh(catalog)
  useSerialPolling(refresh)
  const mutationOptions = { refresh, lifecycle: catalog.lifecycle, setError: catalog.setError }
  const createPort = useCreateSerialPort(mutationOptions)
  const updatePort = useUpdateSerialPort(mutationOptions)
  const deletePort = useDeleteSerialPort(mutationOptions)
  const deleteMany = useDeleteManySerialPorts(mutationOptions)
  const duplicatePort = useDuplicateSerialPort(mutationOptions)
  const connectPort = useConnectSerialPort(mutationOptions)
  return {
    ports: catalog.ports,
    devices: catalog.devices,
    activeDevices: catalog.activeDevices,
    loading: catalog.loading,
    error: catalog.error,
    deviceProbeError: catalog.deviceProbeError,
    activeMapError: catalog.activeMapError,
    refresh,
    createPort,
    updatePort,
    deletePort,
    deleteMany,
    duplicatePort,
    connectPort,
  }
}
