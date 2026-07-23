import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('useAISettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('exposes backend action errors via toast without leaving pending state', async () => {
    const { result } = renderHook(() => useAISettings())
    await waitFor(() => expect(result.current.loading).toBe(false))
    ai.deleteProvider.mockRejectedValueOnce(new Error('delete failed'))
    await expect(act(async () => result.current.deleteProvider(1))).rejects.toThrow('delete failed')
    expect(result.current.pending).toBeNull()
    expect(result.current.error).toBeNull()
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('delete failed'), 'error')
  })

  it('sets page error when dashboard load fails without toast', async () => {
    ai.dashboard.mockRejectedValue(new Error('ai dashboard failed'))
    const { result } = renderHook(() => useAISettings())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('ai dashboard failed')
    expect(toast).not.toHaveBeenCalledWith(expect.stringContaining('ai dashboard failed'), 'error')
  })
})
