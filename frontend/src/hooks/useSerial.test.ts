import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'
import { useSerial } from '@/hooks/useSerial'
import { useToastStore } from '@/components/ui/toast'

const service = 'github.com/xuthus5/mssh/internal/service.'

describe('useSerial', () => {
  beforeEach(() => {
    __clearHandlers()
    useToastStore.setState({ toasts: [] })
    __registerHandler(service + 'SerialService.List', async () => [])
    __registerHandler(service + 'SerialService.ListDevices', async () => [])
    __registerHandler(service + 'SerialService.ActiveDeviceMap', async () => ({}))
  })

  it('toasts when serial profile list fails', async () => {
    __registerHandler(service + 'SerialService.List', async () => {
      throw new Error('serial list failed')
    })
    const { result } = renderHook(() => useSerial())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toContain('serial list failed')
    expect(useToastStore.getState().toasts.some((item) => item.message.includes('serial list failed'))).toBe(true)
  })

  it('toasts when serial device discovery fails', async () => {
    __registerHandler(service + 'SerialService.ListDevices', async () => {
      throw new Error('device list failed')
    })
    renderHook(() => useSerial())
    await waitFor(() => expect(useToastStore.getState().toasts.some((item) => item.message.includes('device list failed'))).toBe(true))
  })

  it('toasts when active serial map fails', async () => {
    __registerHandler(service + 'SerialService.ActiveDeviceMap', async () => {
      throw new Error('active map failed')
    })
    renderHook(() => useSerial())
    await waitFor(() => expect(useToastStore.getState().toasts.some((item) => item.message.includes('active map failed'))).toBe(true))
  })

  it('suppresses device discovery toasts during silent mutation refresh', async () => {
    __registerHandler(service + 'SerialService.Create', async (input: any) => ({ ...input, id: 9 }))
    __registerHandler(service + 'SerialService.List', async () => [{
      id: 9, name: 'COM1', device: '/dev/ttyUSB0', baud_rate: 115200, data_bits: 8, parity: 'none', stop_bits: 1,
      flow_control: 'none', line_ending: 'lf', local_echo: false, dtr_on_open: true, rts_on_open: true, notes: '', sort_order: 0,
    }])
    __registerHandler(service + 'SerialService.ListDevices', async () => { throw new Error('device list failed') })
    const { result } = renderHook(() => useSerial())
    await waitFor(() => expect(result.current.loading).toBe(false))
    useToastStore.setState({ toasts: [] })
    await act(async () => {
      await result.current.createPort({
        id: 0, name: 'COM1', device: '/dev/ttyUSB0', baud_rate: 115200, data_bits: 8, parity: 'none', stop_bits: 1,
        flow_control: 'none', line_ending: 'lf', local_echo: false, dtr_on_open: true, rts_on_open: true, notes: '', sort_order: 0,
      } as any)
    })
    expect(useToastStore.getState().toasts.some((item) => item.message.includes('device list failed'))).toBe(false)
  })

  it('keeps mutation success free of primary list toast on silent refresh', async () => {
    __registerHandler(service + 'SerialService.Create', async (input: any) => ({ ...input, id: 11 }))
    __registerHandler(service + 'SerialService.List', async () => { throw new Error('ports list failed') })
    const { result } = renderHook(() => useSerial())
    await waitFor(() => expect(result.current.loading).toBe(false))
    useToastStore.setState({ toasts: [] })
    await act(async () => {
      await result.current.createPort({
        id: 0, name: 'COM2', device: '/dev/ttyUSB1', baud_rate: 115200, data_bits: 8, parity: 'none', stop_bits: 1,
        flow_control: 'none', line_ending: 'lf', local_echo: false, dtr_on_open: true, rts_on_open: true, notes: '', sort_order: 0,
      } as any)
    })
    expect(useToastStore.getState().toasts.some((item) => item.message.includes('ports list failed'))).toBe(false)
  })
})
