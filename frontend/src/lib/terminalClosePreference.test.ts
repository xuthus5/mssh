import { beforeEach, describe, expect, it, vi } from 'vitest'
import { persistTerminalClosePreference } from '@/lib/terminalClosePreference'
import { useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'

const settings = vi.hoisted(() => ({ Set: vi.fn(), GetMany: vi.fn() }))
const logger = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() }))
const emit = vi.hoisted(() => vi.fn())
vi.mock('@/lib/wails', () => ({ SettingService: settings }))
vi.mock('@/lib/logger', () => ({ logger }))
vi.mock('@wailsio/runtime', () => ({ Events: { Emit: emit, On: vi.fn(() => () => {}) } }))

describe('persistTerminalClosePreference', () => {
  beforeEach(() => {
    settings.Set.mockReset().mockResolvedValue(undefined)
    settings.GetMany.mockReset().mockResolvedValue({})
    emit.mockClear()
    logger.error.mockClear()
    useTerminalBehaviorStore.setState({ autoCloseTerminalOnExit: false })
  })

  it('updates the behavior store and persists the setting', async () => {
    await persistTerminalClosePreference(true)

    expect(useTerminalBehaviorStore.getState().autoCloseTerminalOnExit).toBe(true)
    expect(settings.Set).toHaveBeenCalledWith(expect.objectContaining({
      key: 'terminal.auto_close_terminal_on_exit',
      value: 'true',
      value_type: 'boolean',
    }))
  })

  it('switches the preference back to off', async () => {
    useTerminalBehaviorStore.setState({ autoCloseTerminalOnExit: true })

    await persistTerminalClosePreference(false)

    expect(useTerminalBehaviorStore.getState().autoCloseTerminalOnExit).toBe(false)
    expect(settings.Set).toHaveBeenCalledWith(expect.objectContaining({ value: 'false' }))
  })

  it('broadcasts the persisted settings change for immediate sync', async () => {
    settings.GetMany.mockResolvedValue({ 'terminal.auto_close_terminal_on_exit': { key: 'terminal.auto_close_terminal_on_exit', value: 'true' } })

    await persistTerminalClosePreference(true)

    expect(settings.GetMany).toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith('settings:general-changed', expect.objectContaining({ autoCloseTerminalOnExit: true }))
  })

  it('logs and swallows persistence failures', async () => {
    settings.Set.mockRejectedValueOnce(new Error('persist boom'))

    await persistTerminalClosePreference(true)

    expect(logger.error).toHaveBeenCalledWith('persist terminal close preference failed', expect.any(Error))
    expect(useTerminalBehaviorStore.getState().autoCloseTerminalOnExit).toBe(true)
  })
})
