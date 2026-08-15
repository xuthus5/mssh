import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '@/components/ui/toast'
import { useSidebarDialogs } from '@/hooks/useSidebarDialogs'
import type { Session } from '@/hooks/useSession'

const workspace = vi.hoisted(() => ({
  sessions: [] as Session[],
  createSession: vi.fn(async () => undefined),
  updateSession: vi.fn(async () => undefined),
  deleteSession: vi.fn(async () => undefined),
  deleteFolder: vi.fn(async () => undefined),
  listFolders: vi.fn(async () => undefined),
  listSessions: vi.fn(async () => undefined),
}))

const sessionService = vi.hoisted(() => ({
  GetSessionCredentials: vi.fn(),
}))
const clipboard = vi.hoisted(() => ({ writeText: vi.fn() }))
const confirm = vi.hoisted(() => ({ requestConfirm: vi.fn() }))
const logger = vi.hoisted(() => ({ debug: vi.fn(), error: vi.fn() }))

vi.mock('@/hooks/SessionWorkspaceContext', () => ({ useSessionWorkspace: () => workspace }))
vi.mock('@/lib/wails', () => ({ SessionService: sessionService }))
vi.mock('@/lib/clipboard', () => ({ getClipboard: () => clipboard }))
vi.mock('@/lib/confirmDialog', () => confirm)
vi.mock('@/lib/logger', () => ({ logger }))

const session: Session = {
  id: '1', name: 'web-01', host: '10.0.0.1', port: 22, username: 'root',
  authMethod: 'password', keepAlive: 30, termType: 'xterm', folderId: null,
}

describe('useSidebarDialogs session context actions', () => {
  beforeEach(() => {
    Object.assign(workspace, { sessions: [session] })
    for (const value of Object.values(workspace)) if (typeof value === 'function' && 'mockClear' in value) value.mockClear()
    sessionService.GetSessionCredentials.mockReset()
    clipboard.writeText.mockReset().mockResolvedValue(undefined)
    confirm.requestConfirm.mockReset().mockResolvedValue(true)
    logger.debug.mockClear()
    logger.error.mockClear()
    useToastStore.setState({ toasts: [] })
  })

  it('duplicates a session with a copy suffix and preserves the password', async () => {
    sessionService.GetSessionCredentials.mockResolvedValue({ username: 'root', password: 's3cret' })
    const { result } = renderHook(() => useSidebarDialogs(workspace as never))

    await act(async () => { await result.current.duplicateSession(session) })

    expect(sessionService.GetSessionCredentials).toHaveBeenCalledWith(1)
    expect(workspace.createSession).toHaveBeenCalledWith(expect.objectContaining({
      name: 'web-01 副本', host: '10.0.0.1', username: 'root', password: 's3cret',
    }))
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ type: 'success' })
  })

  it('appends a counter when the copy name already exists', async () => {
    sessionService.GetSessionCredentials.mockResolvedValue({ username: 'root', password: '' })
    Object.assign(workspace, { sessions: [session, { ...session, id: '2', name: 'web-01 副本' }] })
    const { result } = renderHook(() => useSidebarDialogs(workspace as never))

    await act(async () => { await result.current.duplicateSession(session) })

    expect(workspace.createSession).toHaveBeenCalledWith(expect.objectContaining({ name: 'web-01 副本 2' }))
  })

  it('surfaces duplicate failures without swallowing', async () => {
    sessionService.GetSessionCredentials.mockRejectedValue(new Error('vault locked'))
    const { result } = renderHook(() => useSidebarDialogs(workspace as never))

    await expect(result.current.duplicateSession(session)).rejects.toThrow('vault locked')
    expect(workspace.createSession).not.toHaveBeenCalled()
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ type: 'error' })
  })

  it('copies account and password to the clipboard', async () => {
    sessionService.GetSessionCredentials.mockResolvedValue({ username: 'deploy', password: 'pw-123' })
    const { result } = renderHook(() => useSidebarDialogs(workspace as never))

    await act(async () => { await result.current.copyCredentials(session) })

    expect(clipboard.writeText).toHaveBeenCalledWith('deploy:pw-123')
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ type: 'success' })
  })

  it('copies only the username when no password is stored', async () => {
    sessionService.GetSessionCredentials.mockResolvedValue({ username: 'deploy', password: '' })
    const { result } = renderHook(() => useSidebarDialogs(workspace as never))

    await act(async () => { await result.current.copyCredentials(session) })

    expect(clipboard.writeText).toHaveBeenCalledWith('deploy')
  })

  it('reports copy failures and does not throw', async () => {
    sessionService.GetSessionCredentials.mockRejectedValue(new Error('no credentials'))
    const { result } = renderHook(() => useSidebarDialogs(workspace as never))

    await act(async () => { await result.current.copyCredentials(session) })

    expect(clipboard.writeText).not.toHaveBeenCalled()
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ type: 'error' })
  })

  it('deletes a session after confirmation', async () => {
    confirm.requestConfirm.mockResolvedValue(true)
    const { result } = renderHook(() => useSidebarDialogs(workspace as never))

    await act(async () => { await result.current.deleteSession(session) })

    expect(confirm.requestConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: '删除会话', destructive: true }))
    expect(workspace.deleteSession).toHaveBeenCalledWith('1')
  })

  it('skips deletion when the user cancels', async () => {
    confirm.requestConfirm.mockResolvedValue(false)
    const { result } = renderHook(() => useSidebarDialogs(workspace as never))

    await act(async () => { await result.current.deleteSession(session) })

    expect(workspace.deleteSession).not.toHaveBeenCalled()
  })

  it('deletes a folder after confirmation', async () => {
    const folder = { id: 'f1', name: '生产环境', parentId: null, isDefault: false }
    confirm.requestConfirm.mockResolvedValue(true)
    const { result } = renderHook(() => useSidebarDialogs(workspace as never))

    await act(async () => { await result.current.deleteFolder(folder) })

    expect(workspace.deleteFolder).toHaveBeenCalledWith('f1')
  })

  it('opens the quick rename dialog with the session name prefilled', async () => {
    const { result } = renderHook(() => useSidebarDialogs(workspace as never))

    act(() => { result.current.quickRenameSession(session) })

    expect(result.current.renameSession).toEqual(session)
    expect(result.current.renameName).toBe('web-01')
    expect(result.current.renameError).toBe('')
  })

  it('renames a session with the trimmed name and closes the dialog', async () => {
    const { result } = renderHook(() => useSidebarDialogs(workspace as never))
    act(() => { result.current.quickRenameSession(session) })

    await act(async () => { await result.current.saveRename() })

    expect(workspace.updateSession).toHaveBeenCalledWith({ ...session, name: 'web-01' })
    expect(result.current.renameSession).toBeNull()
  })

  it('renames a session with a new value', async () => {
    const { result } = renderHook(() => useSidebarDialogs(workspace as never))
    act(() => { result.current.quickRenameSession(session) })
    act(() => { result.current.setRenameName('  prod-web  ') })

    await act(async () => { await result.current.saveRename() })

    expect(workspace.updateSession).toHaveBeenCalledWith({ ...session, name: 'prod-web' })
  })

  it('rejects empty rename names without calling updateSession', async () => {
    const { result } = renderHook(() => useSidebarDialogs(workspace as never))
    act(() => { result.current.quickRenameSession(session) })
    act(() => { result.current.setRenameName('   ') })

    await act(async () => { await result.current.saveRename() })

    expect(workspace.updateSession).not.toHaveBeenCalled()
    expect(result.current.renameError).toBe('请输入会话名称')
  })

  it('keeps the rename dialog open and reports failures', async () => {
    workspace.updateSession.mockRejectedValueOnce(new Error('rename failed'))
    const { result } = renderHook(() => useSidebarDialogs(workspace as never))
    act(() => { result.current.quickRenameSession(session) })

    await act(async () => { await result.current.saveRename() })

    expect(result.current.renameSession).toEqual(session)
    expect(result.current.renameError).toBe('重命名失败: rename failed')
    await waitFor(() => expect(logger.error).toHaveBeenCalled())
  })
})
