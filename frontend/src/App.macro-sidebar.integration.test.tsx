import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const closeTerminal = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({
    folders: [], sessions: [], recentSessions: [], tunnels: [], loading: false, error: '',
    listFolders: vi.fn(async () => {}), listSessions: vi.fn(async () => {}),
    createFolder: vi.fn(), updateFolder: vi.fn(), createSession: vi.fn(), updateSession: vi.fn(),
    connect: vi.fn(async () => {}),
  }),
}))
vi.mock('@/hooks/useSettings', () => ({ useSettings: () => ({}) }))
vi.mock('@/hooks/useThemeCatalog', () => ({
  useThemeCatalog: () => ({ colorMode: 'dark', setColorMode: vi.fn(async () => {}) }),
}))
vi.mock('@/components/session/SessionTree', () => ({ default: () => <div>session tree</div> }))
vi.mock('@/components/session/QuickCommands', () => ({ default: () => <div data-testid="macro-sidebar">macro sidebar</div> }))
vi.mock('@/components/session/SessionAssetCenter', () => ({ SessionAssetCenter: () => <div>会话资产工作区</div> }))
vi.mock('@/components/layout/SidebarDialogs', () => ({ SidebarDialogs: () => null }))
vi.mock('@/components/layout/StatusBar', () => ({ default: () => null }))
vi.mock('@/components/layout/ConnectDialog', () => ({ ConnectDialog: () => null }))
vi.mock('@/components/terminal/TerminalTab', () => ({
  TerminalTab: ({ terminalID, onOpenFiles }: { terminalID: string; onOpenFiles: () => void }) => (
    <div data-testid={`terminal-${terminalID}`}>
      terminal<button type="button" onClick={onOpenFiles}>files</button>
    </div>
  ),
}))
vi.mock('@/components/terminal/PlaybackTab', () => ({ PlaybackTab: () => null }))
vi.mock('@/components/file/FilePanel', () => ({ default: () => <div data-testid="file-panel">files panel</div> }))
vi.mock('@/hooks/useFileTransfer', () => ({
  useFileTransfer: () => ({
    files: [], currentPath: '/', loading: false, error: '', listFiles: vi.fn(async () => {}),
    navigateTo: vi.fn(), navigateUp: vi.fn(), deleteFile: vi.fn(), renameFile: vi.fn(), makeDir: vi.fn(),
    upload: vi.fn(async () => {}), uploadMany: vi.fn(async () => {}), download: vi.fn(async () => {}),
  }),
}))
vi.mock('@wailsio/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wailsio/runtime')>()
  return {
    ...actual,
    Window: { ...actual.Window, Minimise: vi.fn(), ToggleMaximise: vi.fn(), Close: vi.fn() },
    Dialogs: { ...actual.Dialogs, OpenFile: vi.fn(), SaveFile: vi.fn() },
    Events: { ...actual.Events, On: vi.fn(() => () => {}) },
  }
})
vi.mock('@/lib/wails', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wails')>()
  return {
    ...actual,
    MacroService: { List: vi.fn(async () => []), Execute: vi.fn(), Create: vi.fn(), Delete: vi.fn() },
    TerminalService: { ...actual.TerminalService, Close: closeTerminal },
  }
})

import App from '@/App'
import { useAppStore } from '@/store/appStore'

describe('App macro sidebar integration', () => {
  beforeEach(() => {
    closeTerminal.mockClear()
    useAppStore.setState({
      tabs: [{ id: 'terminal-1', title: '生产服务器', type: 'terminal', terminalId: 'term-1', sessionId: 1 }],
      activeSurface: { type: 'terminal', id: 'terminal-1' },
      workspaceTab: 'sessions',
      navigationCollapsed: false,
      activePaneId: 'split-1',
      focusRequest: { id: 'terminal-1', terminalId: 'split-1', sequence: 4 },
      connectionStatus: { 'term-1': 'connected' },
      recordingState: { 'term-1': 'recording' },
    })
  })

  it('keeps the terminal and tools visible while showing macros in the sidebar', async () => {
    render(<App />)
    const terminalLayer = (await screen.findByTestId('terminal-term-1')).closest('[data-layer-id="terminal-1"]') as HTMLElement
    fireEvent.click(within(terminalLayer).getByRole('button', { name: 'files' }))
    expect(await within(terminalLayer).findByTestId('file-panel')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '宏' }))

    expect(useAppStore.getState()).toMatchObject({
      activeSurface: { type: 'terminal', id: 'terminal-1' },
      workspaceTab: 'macros', activePaneId: 'split-1',
      focusRequest: { id: 'terminal-1', terminalId: 'split-1', sequence: 4 },
      recordingState: { 'term-1': 'recording' },
    })
    expect(terminalLayer).toHaveAttribute('aria-hidden', 'false')
    expect(terminalLayer).not.toHaveAttribute('inert')
    expect(within(terminalLayer).getByTestId('file-panel')).toBeInTheDocument()
    expect(screen.getByTestId('macro-sidebar')).toBeInTheDocument()
    expect(screen.getByRole('complementary')).toHaveAttribute('aria-labelledby', 'workspace-tab-macros')
    expect(document.getElementById('workspace-panel')).toHaveAttribute('aria-hidden', 'true')

    await act(async () => { await useAppStore.getState().closeTab('terminal-1') })
    expect(closeTerminal).toHaveBeenCalledWith('term-1')
    expect(useAppStore.getState()).toMatchObject({
      activeSurface: { type: 'workspace', id: 'sessions' },
      workspaceTab: 'sessions',
    })
    expect(screen.getByText('会话资产工作区')).toBeInTheDocument()
  })
})
