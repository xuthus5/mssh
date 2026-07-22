import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'

const loggerError = vi.hoisted(() => vi.fn())
const createCopyOnSelectController = vi.hoisted(() => vi.fn())

vi.mock('@/lib/logger', () => ({ logger: { error: loggerError } }))
vi.mock('@/lib/terminalInteractions', () => ({ createCopyOnSelectController }))

import { installTerminalCopyOnSelect } from '@/components/terminal/terminalBehaviorRuntime'

describe('terminal behavior runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTerminalBehaviorStore.setState({ rightClickAction: 'menu', copyOnSelect: false, autoReconnect: false, restoreTabsOnStartup: true, scrollbackLines: 10000 })
  })

  it('follows copy-on-select settings and disposes only once', () => {
    const controller = { setEnabled: vi.fn(), dispose: vi.fn() }
    const terminal = {} as never
    createCopyOnSelectController.mockReturnValue(controller)

    const cleanup = installTerminalCopyOnSelect(terminal, 'primary')
    useTerminalBehaviorStore.getState().setSettings({ rightClickAction: 'menu', copyOnSelect: true, scrollbackLines: 10000, autoReconnect: false, restoreTabsOnStartup: true })
    useTerminalBehaviorStore.getState().setSettings({ rightClickAction: 'paste', copyOnSelect: true, scrollbackLines: 10000, autoReconnect: false, restoreTabsOnStartup: true })
    cleanup()
    cleanup()
    useTerminalBehaviorStore.getState().setSettings({ rightClickAction: 'menu', copyOnSelect: false, scrollbackLines: 10000, autoReconnect: false, restoreTabsOnStartup: true })

    expect(controller.setEnabled).toHaveBeenNthCalledWith(1, false)
    expect(controller.setEnabled).toHaveBeenNthCalledWith(2, true)
    expect(controller.setEnabled).toHaveBeenCalledTimes(2)
    expect(controller.dispose).toHaveBeenCalledOnce()
  })

  it('logs automatic copy errors with the terminal label', () => {
    const controller = { setEnabled: vi.fn(), dispose: vi.fn() }
    createCopyOnSelectController.mockReturnValue(controller)
    const cleanup = installTerminalCopyOnSelect({} as never, 'replay')

    const options = createCopyOnSelectController.mock.calls[0][1]
    const error = new Error('clipboard denied')
    options.onError(error)

    expect(loggerError).toHaveBeenCalledWith('replay automatic selection copy failed', error)
    cleanup()
  })
})
