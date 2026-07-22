import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const services = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(async (_setting: { value: string }) => {}),
  open: vi.fn(async () => 'fresh-terminal'),
  openLocal: vi.fn(async () => 'fresh-local'),
  openSerial: vi.fn(async () => 'fresh-serial'),
  listSerial: vi.fn(async () => [{ id: 9 }]),
}))

vi.mock('@/lib/wails', () => ({
  SettingService: { Get: services.get, Set: services.set },
  TerminalService: {
    Open: services.open,
    OpenLocal: services.openLocal,
    OpenSerial: services.openSerial,
  },
  SerialService: { List: services.listSerial },
}))
vi.mock('@/hooks/SessionWorkspaceContext', () => ({
  useSessionWorkspace: () => ({ sessionsLoaded: true, sessions: [{ id: '7' }] }),
}))

import { WorkspacePersistence } from '@/components/layout/WorkspacePersistence'
import { useAppStore } from '@/store/appStore'
import { DEFAULT_TERMINAL_BEHAVIOR, useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'

describe('WorkspacePersistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({
      tabs: [],
      activeSurface: null,
      workspaceTab: 'sessions',
      overviewSection: 'sessions',
      connectionStatus: {},
      activePaneId: null,
    })
    useTerminalBehaviorStore.setState({
      ...DEFAULT_TERMINAL_BEHAVIOR,
      settingsHydrated: true,
      restoreTabsOnStartup: true,
    })
  })

  it('restores saved workspace intents and persists later layout changes', async () => {
    services.get.mockResolvedValue({
      value: JSON.stringify({
        version: 2,
        tabs: [{ type: 'terminal', title: 'prod', sessionId: 7, toolPanel: 'history' }],
        active: { type: 'tab', index: 0 },
        workspaceTab: 'sessions',
        overviewSection: 'keys',
      }),
    })
    render(<WorkspacePersistence />)

    await waitFor(() => expect(useAppStore.getState().tabs[0]).toMatchObject({
      terminalId: 'fresh-terminal',
      toolPanel: 'history',
    }))
    act(() => useAppStore.getState().updateTerminalWorkspace('terminal-fresh-terminal', { toolPanel: 'system' }))
    await waitFor(() => expect(services.set).toHaveBeenCalled(), { timeout: 1000 })

    const saved = JSON.parse(services.set.mock.calls.at(-1)?.[0].value ?? '{}')
    expect(saved.tabs[0]).toMatchObject({ sessionId: 7, toolPanel: 'system' })
    expect(JSON.stringify(saved)).not.toContain('fresh-terminal')
  })

  it('restores local shell tabs via OpenLocal', async () => {
    services.get.mockResolvedValue({
      value: JSON.stringify({
        version: 2,
        tabs: [{ type: 'terminal', title: '本地终端', sessionId: 0, connectionKind: 'local' }],
        active: { type: 'tab', index: 0 },
        workspaceTab: 'sessions',
        overviewSection: 'sessions',
      }),
    })
    render(<WorkspacePersistence />)
    await waitFor(() => expect(services.openLocal).toHaveBeenCalled())
    expect(useAppStore.getState().tabs[0]).toMatchObject({
      terminalId: 'fresh-local',
      connectionKind: 'local',
    })
  })

  it('skips restoring terminal tabs when restore-on-startup is disabled', async () => {
    services.open.mockClear()
    services.get.mockClear()
    useAppStore.setState({
      tabs: [],
      activeSurface: null,
      workspaceTab: 'sessions',
      overviewSection: 'sessions',
      connectionStatus: {},
      activePaneId: null,
    })
    useTerminalBehaviorStore.setState({
      ...DEFAULT_TERMINAL_BEHAVIOR,
      settingsHydrated: false,
      restoreTabsOnStartup: false,
    })
    services.get.mockResolvedValue({
      value: JSON.stringify({
        version: 2,
        tabs: [{ type: 'terminal', title: 'prod', sessionId: 7, toolPanel: 'history' }],
        active: { type: 'tab', index: 0 },
        workspaceTab: 'sessions',
        overviewSection: 'keys',
      }),
    })
    const view = render(<WorkspacePersistence />)
    act(() => {
      useTerminalBehaviorStore.setState({
        settingsHydrated: true,
        restoreTabsOnStartup: false,
        renderer: 'dom',
        historyPredict: false,
      })
    })
    await waitFor(() => expect(services.get).not.toHaveBeenCalled())
    expect(services.open).not.toHaveBeenCalled()
    expect(useAppStore.getState().tabs).toHaveLength(0)
    view.unmount()
  })
})
