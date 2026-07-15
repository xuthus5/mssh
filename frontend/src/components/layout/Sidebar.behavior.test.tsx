import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const workspace = vi.hoisted(() => ({
  folders: [] as any[],
  sessions: [] as any[],
  createFolder: vi.fn(async () => {}),
  updateFolder: vi.fn(async () => {}),
  createSession: vi.fn(async () => {}),
  updateSession: vi.fn(async () => {}),
  connect: vi.fn(async () => {}),
  loading: false,
  error: '',
  listFolders: vi.fn(async () => {}),
  listSessions: vi.fn(async () => {}),
}))
const macroService = vi.hoisted(() => ({
  List: vi.fn(),
  Execute: vi.fn(),
  Create: vi.fn(),
  Delete: vi.fn(),
}))
const logger = vi.hoisted(() => ({ debug: vi.fn(), error: vi.fn() }))

vi.mock('@/hooks/SessionWorkspaceContext', () => ({ useSessionWorkspace: () => workspace }))
vi.mock('@/hooks/useSettings', () => ({ useSettings: () => ({ general: {}, systemFonts: [], keys: [], sync: {} }) }))
vi.mock('@/hooks/useThemeCatalog', () => ({ useThemeCatalog: () => ({ profiles: [], assignments: {} }) }))
vi.mock('@/hooks/useResizablePanel', () => ({ useResizablePanel: () => ({ width: 280, collapsed: false, displayedWidth: 280, resizeHandleProps: {} }) }))
vi.mock('@/lib/logger', () => ({ logger }))
vi.mock('@/lib/wails', () => ({ MacroService: macroService }))
vi.mock('@/components/session/SessionTree', () => ({
  default: (props: any) => <div>
    <span data-testid="tree-state">folders:{props.folders.map((item: any) => item.name).join(',')}|sessions:{props.sessions.map((item: any) => item.name).join(',')}|reveal:{String(props.revealAll)}</span>
    <button type="button" onClick={() => props.onEditSession?.(props.sessions[0])}>tree-edit</button>
    <button type="button" onClick={() => props.onSelectFolder?.('child')}>tree-select</button>
  </div>,
}))
vi.mock('@/components/layout/SidebarDialogs', () => ({
  SidebarDialogs: (props: any) => <div>
    <span data-testid="session-dialog">session:{String(props.sessionDialogOpen)}:{props.editingSession?.name ?? 'new'}</span>
    <button type="button" onClick={() => void props.onSaveSession(sessionDraft)}>session-save</button>
    <button type="button" onClick={() => props.onSessionOpenChange(false)}>session-close</button>
    <span data-testid="folder-dialog">folder:{String(props.folderDialogOpen)}:{props.editingFolder?.name ?? 'new'}</span>
    <input aria-label="mock-folder-name" value={props.folderName} onChange={(event) => props.setFolderName(event.target.value)} />
    <button type="button" onClick={props.onCreateOrUpdateFolder}>folder-submit</button>
    <button type="button" onClick={() => props.onFolderOpenChange(false)}>folder-close</button>
    <span data-testid="settings-dialog">settings:{String(props.settingsProps.open)}</span>
    <button type="button" onClick={() => props.settingsProps.onOpenChange(false)}>settings-close</button>
  </div>,
}))

import Sidebar from '@/components/layout/Sidebar'
import { useAppStore } from '@/store/appStore'

const folders = [
  { id: 'parent', name: 'Production', parentId: null, isDefault: true },
  { id: 'child', name: 'Databases', parentId: 'parent', isDefault: false },
]
const sessions = [
  { id: 'root', name: 'Root node', host: 'root.internal', port: 22, username: 'root', authMethod: 'password', keepAlive: 30, termType: 'xterm', folderId: null },
  { id: 'db', name: 'Database', host: 'db.internal', port: 22, username: 'dba', authMethod: 'key', keepAlive: 30, termType: 'xterm', folderId: 'child' },
]
const sessionDraft = { name: 'Saved', host: 'saved.internal', port: 22, username: 'root', authMethod: 'password', keepAlive: 30, termType: 'xterm', folderId: null }

describe('Sidebar behavior', () => {
  beforeEach(() => {
    Object.assign(workspace, { folders: [...folders], sessions: [...sessions], loading: false, error: '' })
    for (const value of Object.values(workspace)) if (typeof value === 'function' && 'mockClear' in value) value.mockClear()
    macroService.List.mockReset().mockResolvedValue([])
    macroService.Execute.mockReset().mockResolvedValue(undefined)
    macroService.Create.mockReset().mockResolvedValue(null)
    macroService.Delete.mockReset().mockResolvedValue(undefined)
    logger.debug.mockClear()
    logger.error.mockClear()
    useAppStore.setState({ tabs: [], activeSurface: { type: 'workspace', id: 'sessions' }, activePaneId: null, workspaceTab: 'sessions' })
  })

  it('filters sessions with folder ancestry and retries failed loads', async () => {
    const user = userEvent.setup()
    const selectFolder = vi.fn()
    window.addEventListener('mssh:select-folder', selectFolder)
    const { unmount } = render(<Sidebar />)

    await user.type(screen.getByPlaceholderText('搜索会话...'), 'db.internal')
    expect(screen.getByText('匹配 1 个会话')).toBeInTheDocument()
    expect(screen.getByTestId('tree-state')).toHaveTextContent('folders:Production,Databases|sessions:Database|reveal:true')

    await user.clear(screen.getByPlaceholderText('搜索会话...'))
    await user.type(screen.getByPlaceholderText('搜索会话...'), 'production')
    expect(screen.getByTestId('tree-state')).toHaveTextContent('folders:Production|sessions:')
    await user.click(screen.getByRole('button', { name: 'tree-select' }))
    expect(selectFolder).toHaveBeenCalled()
    unmount()
    window.removeEventListener('mssh:select-folder', selectFolder)

    workspace.error = 'load failed'
    render(<Sidebar />)
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(workspace.listFolders).toHaveBeenCalled()
    expect(workspace.listSessions).toHaveBeenCalled()
  })

  it('coordinates folder, session, and settings dialogs', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    act(() => window.dispatchEvent(new CustomEvent('mssh:new-folder')))
    await user.click(screen.getByRole('button', { name: 'folder-submit' }))
    expect(workspace.createFolder).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('mock-folder-name'), '  Ops  ')
    await user.click(screen.getByRole('button', { name: 'folder-submit' }))
    expect(workspace.createFolder).toHaveBeenCalledWith('Ops', null)

    act(() => window.dispatchEvent(new CustomEvent('mssh:edit-folder', { detail: folders[1] })))
    await user.clear(screen.getByLabelText('mock-folder-name'))
    await user.type(screen.getByLabelText('mock-folder-name'), 'Data')
    await user.click(screen.getByRole('button', { name: 'folder-submit' }))
    expect(workspace.updateFolder).toHaveBeenCalledWith('child', 'Data')
    await user.click(screen.getByRole('button', { name: 'folder-close' }))
    expect(screen.getByTestId('folder-dialog')).toHaveTextContent('folder:false:new')

    act(() => window.dispatchEvent(new CustomEvent('mssh:new-session')))
    await user.click(screen.getByRole('button', { name: 'session-save' }))
    await waitFor(() => expect(workspace.createSession).toHaveBeenCalledWith(sessionDraft))
    act(() => window.dispatchEvent(new CustomEvent('mssh:edit-session', { detail: sessions[1] })))
    await user.click(screen.getByRole('button', { name: 'session-save' }))
    await waitFor(() => expect(workspace.updateSession).toHaveBeenCalledWith({ ...sessions[1], ...sessionDraft }))

    await user.click(screen.getByRole('button', { name: 'tree-edit' }))
    await waitFor(() => expect(screen.getByTestId('session-dialog')).toHaveTextContent('session:true:Root node'))
    await user.click(screen.getByRole('button', { name: 'session-close' }))
    expect(screen.getByTestId('session-dialog')).toHaveTextContent('session:false:new')

    act(() => window.dispatchEvent(new CustomEvent('mssh:open-settings')))
    expect(screen.getByTestId('settings-dialog')).toHaveTextContent('settings:true')
    await user.click(screen.getByRole('button', { name: 'settings-close' }))
    expect(screen.getByTestId('settings-dialog')).toHaveTextContent('settings:false')
  })

  it('loads, executes, creates, and deletes macros with failure handling', async () => {
    const user = userEvent.setup()
    macroService.List.mockResolvedValue([{ id: 1, name: 'Initial', shortcut: 'Ctrl+I', command: 'initial' }])
    useAppStore.setState({
      workspaceTab: 'macros',
      tabs: [{ id: 'tab-1', title: 'Terminal', type: 'terminal', terminalId: 'term-1', sessionId: 1 }],
      activeSurface: { type: 'terminal', id: 'tab-1' },
      activePaneId: 'pane-1',
    })
    render(<Sidebar />)
    expect(await screen.findByText('Initial')).toBeInTheDocument()
    const quickCommands = screen.getByText('快捷命令').parentElement?.parentElement
    if (!quickCommands) throw new Error('quick commands were not rendered')

    await user.click(screen.getByText('Initial'))
    expect(macroService.Execute).toHaveBeenCalledWith('pane-1', 'initial')
    useAppStore.setState({ activeSurface: { type: 'workspace', id: 'macros' } })
    await user.click(screen.getByText('Initial'))
    expect(macroService.Execute).toHaveBeenCalledTimes(1)

    macroService.Create.mockResolvedValueOnce({ id: 2, name: 'Created', shortcut: '', command: 'created' })
    await user.click(within(quickCommands).getAllByRole('button')[0])
    await user.type(screen.getByPlaceholderText('名称'), 'Created')
    await user.type(screen.getByPlaceholderText('命令'), 'created')
    await user.click(screen.getByRole('button', { name: '添加' }))
    expect(await screen.findByText('Created')).toBeInTheDocument()
    const initialRow = screen.getByText('Initial').closest<HTMLElement>('[draggable="true"]')
    if (!initialRow) throw new Error('initial macro row was not rendered')
    await user.click(within(initialRow).getByRole('button'))
    await waitFor(() => expect(screen.queryByText('Initial')).not.toBeInTheDocument())

    const unhandledRejection = vi.fn()
    window.addEventListener('unhandledrejection', unhandledRejection)
    macroService.Create.mockRejectedValueOnce(new Error('create failed'))
    await user.click(within(quickCommands).getAllByRole('button')[0])
    await user.type(screen.getByPlaceholderText('名称'), 'Deploy')
    await user.type(screen.getByPlaceholderText('命令'), 'deploy')
    await user.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => expect(logger.error).toHaveBeenCalledWith('Sidebar: create macro error', expect.objectContaining({ message: 'create failed' })))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByText('Created')).toBeInTheDocument()
    expect(screen.queryByText('Deploy')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('名称')).not.toBeInTheDocument()
    expect(within(quickCommands).getAllByRole('button')[0]).toBeEnabled()
    expect(unhandledRejection).not.toHaveBeenCalled()
    window.removeEventListener('unhandledrejection', unhandledRejection)

    macroService.Delete.mockRejectedValueOnce(new Error('delete failed'))
    const createdRow = screen.getByText('Created').closest<HTMLElement>('[draggable="true"]')
    if (!createdRow) throw new Error('created macro row was not rendered')
    await user.click(within(createdRow).getByRole('button'))
    await waitFor(() => expect(logger.error).toHaveBeenCalledWith('Sidebar: delete macro error', expect.any(Error)))
    expect(screen.getByText('Created')).toBeInTheDocument()

    useAppStore.setState({ activeSurface: { type: 'terminal', id: 'tab-1' }, activePaneId: null })
    macroService.Execute.mockRejectedValueOnce(new Error('execute failed'))
    await user.click(screen.getByText('Created'))
    await waitFor(() => expect(logger.error).toHaveBeenCalledWith('Sidebar: execute macro error', expect.any(Error)))
  })

  it('logs macro loading failures', async () => {
    macroService.List.mockRejectedValue(new Error('list failed'))
    render(<Sidebar />)
    await waitFor(() => expect(logger.error).toHaveBeenCalledWith('Sidebar: list macros error', expect.any(Error)))
  })
})
