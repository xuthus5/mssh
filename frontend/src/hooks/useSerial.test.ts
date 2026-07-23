import { renderHook, waitFor } from '@testing-library/react'
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
})
