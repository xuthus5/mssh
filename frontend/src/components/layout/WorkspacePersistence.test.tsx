import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const services = vi.hoisted(() => ({
  get: vi.fn(), set: vi.fn(async (_setting: { value: string }) => {}), open: vi.fn(async () => 'fresh-terminal'),
}))

vi.mock('@/lib/wails', () => ({
  SettingService: { Get: services.get, Set: services.set },
  TerminalService: { Open: services.open },
}))
vi.mock('@/hooks/SessionWorkspaceContext', () => ({
  useSessionWorkspace: () => ({ sessionsLoaded: true, sessions: [{ id: '7' }] }),
}))

import { WorkspacePersistence } from '@/components/layout/WorkspacePersistence'
import { useAppStore } from '@/store/appStore'

describe('WorkspacePersistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({ tabs: [], activeSurface: null, workspaceTab: 'sessions', overviewSection: 'sessions', connectionStatus: {}, activePaneId: null })
  })

  it('restores saved workspace intents and persists later layout changes', async () => {
    services.get.mockResolvedValue({ value: JSON.stringify({
      version: 2,
      tabs: [{ type: 'terminal', title: 'prod', sessionId: 7, toolPanel: 'history' }],
      active: { type: 'tab', index: 0 }, workspaceTab: 'sessions', overviewSection: 'keys',
    }) })
    render(<WorkspacePersistence />)

    await waitFor(() => expect(useAppStore.getState().tabs[0]).toMatchObject({ terminalId: 'fresh-terminal', toolPanel: 'history' }))
    act(() => useAppStore.getState().updateTerminalWorkspace('terminal-fresh-terminal', { toolPanel: 'system' }))
    await waitFor(() => expect(services.set).toHaveBeenCalled(), { timeout: 1000 })

    const saved = JSON.parse(services.set.mock.calls.at(-1)?.[0].value ?? '{}')
    expect(saved.tabs[0]).toMatchObject({ sessionId: 7, toolPanel: 'system' })
    expect(JSON.stringify(saved)).not.toContain('fresh-terminal')
  })
})
