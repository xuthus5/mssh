import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Events } from '@wailsio/runtime'
import { __clearHandlers } from '@/test/__mocks__/wails-runtime'

const ai = vi.hoisted(() => ({
  dashboard: vi.fn(),
  saveProvider: vi.fn(),
  deleteProvider: vi.fn(),
  testProvider: vi.fn(),
  saveSettings: vi.fn(),
  detect: vi.fn(),
}))
const toast = vi.hoisted(() => vi.fn())
vi.mock('@/lib/wails', () => ({
  AIService: {
    Dashboard: ai.dashboard,
    SaveProvider: ai.saveProvider,
    DeleteProvider: ai.deleteProvider,
    TestProvider: ai.testProvider,
    SaveSettings: ai.saveSettings,
    DetectAgentCLIs: ai.detect,
  },
}))
vi.mock('@/components/ui/toast', () => ({ toast }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))

import { useAISettings } from '@/hooks/useAISettings'
import { AI_CONFIGURATION_CHANGED_EVENT } from '@/lib/settingsWindowEvents'

describe('useAISettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __clearHandlers()
    localStorage.clear()
    ai.dashboard.mockResolvedValue({ settings: {}, providers: [], keychain_available: true })
    ai.saveProvider.mockResolvedValue({ id: 2 })
    ai.deleteProvider.mockResolvedValue(undefined)
    ai.testProvider.mockResolvedValue(undefined)
    ai.saveSettings.mockResolvedValue(undefined)
    ai.detect.mockResolvedValue([{ command: 'codex' }])
  })

  it('loads and executes every AI settings operation', async () => {
    const { result } = renderHook(() => useAISettings())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await result.current.saveProvider({ id: 0 } as never) })
    await act(async () => { await result.current.deleteProvider(2) })
    await act(async () => { await result.current.testProvider(2) })
    await act(async () => { await result.current.saveSettings({ interaction: { panel_width: 500 } } as never) })
    await act(async () => { await result.current.detectAgents() })
    expect(ai.saveProvider).toHaveBeenCalled()
    expect(ai.deleteProvider).toHaveBeenCalledWith(2)
    expect(ai.testProvider).toHaveBeenCalledWith(2)
    expect(localStorage.getItem('mssh:tool-panel-width:ai')).toBe('500')
    expect(result.current.agents).toEqual([{ command: 'codex' }])
    expect(toast).toHaveBeenCalled()
  })

  it('broadcasts successful dashboard-changing operations', async () => {
    const changed = vi.fn()
    const stop = Events.On(AI_CONFIGURATION_CHANGED_EVENT, changed)
    const { result } = renderHook(() => useAISettings())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => { await result.current.saveProvider({ id: 0 } as never) })
    await act(async () => { await result.current.deleteProvider(2) })
    await act(async () => { await result.current.saveSettings({ interaction: { panel_width: 500 } } as never) })
    await act(async () => { await result.current.testProvider(2) })
    await act(async () => { await result.current.detectAgents() })

    expect(changed).toHaveBeenCalledTimes(3)
    stop()
  })

  it('exposes backend action errors via page error without toast', async () => {
    const { result } = renderHook(() => useAISettings())
    await waitFor(() => expect(result.current.loading).toBe(false))
    ai.deleteProvider.mockRejectedValueOnce(new Error('delete failed'))
    await act(async () => {
      await result.current.deleteProvider(1).catch(() => undefined)
    })
    await waitFor(() => expect(result.current.error).toContain('delete failed'))
    expect(result.current.pending).toBeNull()
    expect(toast).not.toHaveBeenCalledWith(expect.stringContaining('delete failed'), 'error')
  })

  it('sets page error when dashboard load fails without toast', async () => {
    ai.dashboard.mockRejectedValue(new Error('ai dashboard failed'))
    const { result } = renderHook(() => useAISettings())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('ai dashboard failed')
    expect(toast).not.toHaveBeenCalledWith(expect.stringContaining('ai dashboard failed'), 'error')
  })

  it('does not let an older dashboard reload overwrite a newer one', async () => {
    const first = deferred<unknown>()
    const second = deferred<unknown>()
    ai.dashboard.mockReset()
    ai.dashboard.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
    const { result } = renderHook(() => useAISettings())
    await waitFor(() => expect(ai.dashboard).toHaveBeenCalledTimes(1))

    let latestReload!: Promise<void>
    act(() => { latestReload = result.current.reload() })
    await waitFor(() => expect(ai.dashboard).toHaveBeenCalledTimes(2))
    await act(async () => { second.resolve(dashboardWithProvider('new')); await latestReload })
    expect(result.current.dashboard?.providers[0].name).toBe('new')

    await act(async () => { first.resolve(dashboardWithProvider('old')); await first.promise })
    expect(result.current.dashboard?.providers[0].name).toBe('new')
  })

  it('rejects overlapping AI operations without calling a second backend action', async () => {
    const save = deferred<unknown>()
    ai.saveProvider.mockImplementationOnce(() => save.promise)
    const { result } = renderHook(() => useAISettings())
    await waitFor(() => expect(result.current.loading).toBe(false))

    let savePromise!: Promise<unknown>
    let deletePromise!: Promise<void>
    act(() => {
      savePromise = result.current.saveProvider({ id: 0 } as never)
      deletePromise = result.current.deleteProvider(2)
    })

    await expect(deletePromise).rejects.toThrow('AI 设置操作正在进行')
    expect(ai.deleteProvider).not.toHaveBeenCalled()
    expect(result.current.pending).toBe('provider-save')

    await act(async () => { save.resolve({ id: 2 }); await savePromise })
    expect(result.current.pending).toBeNull()
  })

  it('keeps the active Agent detection result after a duplicate request is rejected', async () => {
    const detection = deferred<unknown>()
    ai.detect.mockImplementationOnce(() => detection.promise)
    const { result } = renderHook(() => useAISettings())
    await waitFor(() => expect(result.current.loading).toBe(false))

    let first!: Promise<void>
    let duplicate!: Promise<void>
    act(() => {
      first = result.current.detectAgents()
      duplicate = result.current.detectAgents()
    })

    await expect(duplicate).rejects.toThrow('AI 设置操作正在进行')
    await act(async () => {
      detection.resolve([{ command: 'codex', installed: true }])
      await first
    })
    expect(result.current.agents).toEqual([{ command: 'codex', installed: true }])
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function dashboardWithProvider(name: string) {
  return { keychain_available: true, providers: [{ id: 1, name }], settings: {} }
}
