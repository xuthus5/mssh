import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const workspace = vi.hoisted(() => ({ connect: vi.fn(async () => {}) }))

vi.mock('@/hooks/useSession', () => ({ useSession: () => workspace }))
vi.mock('@/hooks/useThemeCatalog', () => ({
  useThemeCatalog: () => ({ colorMode: 'dark', setColorMode: vi.fn(async () => {}) }),
}))
vi.mock('@wailsio/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wailsio/runtime')>()
  return {
    ...actual,
    Window: {
      ...actual.Window,
      Minimise: vi.fn(async () => {}),
      ToggleMaximise: vi.fn(async () => {}),
      Close: vi.fn(async () => {}),
    },
  }
})
vi.mock('@/components/layout/Sidebar', () => ({ default: () => null }))
vi.mock('@/components/layout/StatusBar', () => ({ default: () => null }))
vi.mock('@/components/layout/ConnectDialog', () => ({ ConnectDialog: () => null }))
vi.mock('@/components/layout/WorkspaceContent', () => ({ WorkspaceContent: () => null }))
vi.mock('@/components/terminal/TerminalLayers', () => ({ TerminalLayers: () => null }))

import App from '@/App'
import { useAppStore } from '@/store/appStore'

describe('App session workspace integration', () => {
  beforeEach(() => {
    workspace.connect.mockClear()
    useAppStore.setState({
      tabs: [{
        id: 'terminal-term-1',
        title: '生产服务器',
        type: 'terminal',
        terminalId: 'term-1',
        sessionId: 7,
        terminalInstance: 1,
      }],
      activeSurface: { type: 'terminal', id: 'terminal-term-1' },
      connectionStatus: { 'term-1': 'connected' },
      recordingState: {},
    })
  })

  it('provides the shared session connection action to terminal title tabs', async () => {
    render(<App />)

    fireEvent.contextMenu(screen.getByRole('tab', { name: /生产服务器/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: '复制终端' }))

    expect(workspace.connect).toHaveBeenCalledWith('7')
  })
})
