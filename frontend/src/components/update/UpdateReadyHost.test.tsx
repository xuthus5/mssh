import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => {
  const handlers = new Map<string, (event: { data?: { latest_version?: string; update_available?: boolean } }) => void>()
  return {
    handlers,
    on: vi.fn((name: string, callback: (event: { data?: { latest_version?: string; update_available?: boolean } }) => void) => {
      handlers.set(name, callback)
      return () => handlers.delete(name)
    }),
    readyUpdate: vi.fn(async () => null as { latest_version: string; update_available: boolean } | null),
    restartUpdate: vi.fn(async () => {}),
    requestConfirm: vi.fn(async () => true),
  }
})

vi.mock('@wailsio/runtime', () => ({ Events: { On: runtime.on } }))
vi.mock('@/lib/wails', () => ({ AboutService: { ReadyUpdate: runtime.readyUpdate, RestartUpdate: runtime.restartUpdate } }))
vi.mock('@/lib/confirmDialog', () => ({ requestConfirm: runtime.requestConfirm }))

import { UPDATE_READY_EVENT, UpdateReadyHost } from '@/components/update/UpdateReadyHost'
import { useToastStore } from '@/components/ui/toast'

describe('UpdateReadyHost', () => {
  afterEach(() => {
    runtime.handlers.clear()
    useToastStore.setState({ toasts: [] })
    vi.clearAllMocks()
  })

  it('prompts and restarts when a ready update event arrives', async () => {
    render(<UpdateReadyHost />)
    await waitFor(() => expect(runtime.on).toHaveBeenCalledWith(UPDATE_READY_EVENT, expect.any(Function)))
    act(() => runtime.handlers.get(UPDATE_READY_EVENT)?.({ data: { latest_version: 'v0.2.0', update_available: true } }))
    await waitFor(() => expect(runtime.requestConfirm).toHaveBeenCalledTimes(1))
    expect(runtime.restartUpdate).toHaveBeenCalledTimes(1)
  })

  it('prompts for an update fetched when the window mounts', async () => {
    runtime.readyUpdate.mockResolvedValueOnce({ latest_version: 'v0.2.0', update_available: true })
    render(<UpdateReadyHost />)
    await waitFor(() => expect(runtime.requestConfirm).toHaveBeenCalledTimes(1))
  })

  it('does not restart when the user chooses later', async () => {
    runtime.requestConfirm.mockResolvedValueOnce(false)
    runtime.readyUpdate.mockResolvedValueOnce({ latest_version: 'v0.2.0', update_available: true })
    render(<UpdateReadyHost />)
    await waitFor(() => expect(runtime.requestConfirm).toHaveBeenCalledTimes(1))
    expect(runtime.restartUpdate).not.toHaveBeenCalled()
  })

  it('shows a toast when restart fails', async () => {
    runtime.readyUpdate.mockResolvedValueOnce({ latest_version: 'v0.2.0', update_available: true })
    runtime.restartUpdate.mockRejectedValueOnce(new Error('restart failed'))
    render(<UpdateReadyHost />)
    await waitFor(() => expect(useToastStore.getState().toasts.some((item) => item.message.includes('restart failed'))).toBe(true))
  })
})
