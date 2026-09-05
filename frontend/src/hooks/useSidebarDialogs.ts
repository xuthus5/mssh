import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { APP_NEW_SESSION_EVENT, onAppEvent } from '@/lib/appEvents'
import type { Folder, Session } from '@/hooks/useSession'
import { useSessionWorkspace } from '@/hooks/SessionWorkspaceContext'
import { logger } from '@/lib/logger'
import { SessionService } from '@/lib/wails'
import { getClipboard } from '@/lib/clipboard'
import { requestConfirm } from '@/lib/confirmDialog'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'

type Workspace = ReturnType<typeof useSessionWorkspace>

function useSidebarDialogEvents(options: {
  openFolder: () => void
  editSession: (session: Session) => void
  editFolder: (folder: Folder) => void
  newSession: () => void
}) {
  useEffect(() => {
    const openFolder = () => options.openFolder()
    const editSession = (event: Event) => options.editSession((event as CustomEvent<Session>).detail)
    const editFolder = (event: Event) => options.editFolder((event as CustomEvent<Folder>).detail)
    const newSession = () => options.newSession()
    window.addEventListener('mssh:new-folder', openFolder)
    window.addEventListener('mssh:edit-session', editSession)
    window.addEventListener('mssh:edit-folder', editFolder)
    const stop = onAppEvent(APP_NEW_SESSION_EVENT, newSession)
    return () => {
      window.removeEventListener('mssh:new-folder', openFolder)
      window.removeEventListener('mssh:edit-session', editSession)
      window.removeEventListener('mssh:edit-folder', editFolder)
      stop()
    }
  }, [options])
}

function useDialogState() {
  const [sessionDialogOpen, setSessionDialogOpenState] = useState(false)
  const [folderDialogOpen, setFolderDialogOpenState] = useState(false)
  const [folderName, setFolderNameState] = useState('')
  const [folderError, setFolderError] = useState('')
  const [editingFolder, setEditingFolderState] = useState<Folder | null>(null)
  const [editingSession, setEditingSessionState] = useState<Session | null>(null)
  const [renameSession, setRenameSessionState] = useState<Session | null>(null)
  const [renameName, setRenameNameState] = useState('')
  const [renameError, setRenameErrorState] = useState('')
  const lifecycle = useRef(0)
  const sessionGeneration = useRef(0)
  const folderGeneration = useRef(0)
  const folderSaveRequest = useRef(0)
  const folderSaveGeneration = useRef<number | null>(null)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  const setSessionDialogOpen = useCallback((open: boolean) => { sessionGeneration.current++; setSessionDialogOpenState(open) }, [])
  const setFolderDialogOpen = useCallback((open: boolean) => { folderGeneration.current++; setFolderDialogOpenState(open) }, [])
  const setFolderName = useCallback((name: string) => { folderGeneration.current++; setFolderNameState(name) }, [])
  const setEditingFolder = useCallback((folder: Folder | null) => { folderGeneration.current++; setEditingFolderState(folder) }, [])
  const setEditingSession = useCallback((session: Session | null) => { sessionGeneration.current++; setEditingSessionState(session) }, [])
  const setRenameSession = useCallback((session: Session | null) => { setRenameSessionState(session); setRenameNameState(session?.name ?? ''); setRenameErrorState('') }, [])
  const setRenameName = useCallback((name: string) => { setRenameNameState(name); setRenameErrorState('') }, [])
  return { sessionDialogOpen, setSessionDialogOpen, setSessionDialogOpenState, folderDialogOpen, setFolderDialogOpen, setFolderDialogOpenState, folderName, setFolderName, setFolderNameState, folderError, setFolderError, editingFolder, setEditingFolder, setEditingFolderState, editingSession, setEditingSession, setEditingSessionState, renameSession, setRenameSession, renameName, setRenameName, renameError, setRenameErrorState, lifecycle, sessionGeneration, folderGeneration, folderSaveRequest, folderSaveGeneration }
}

type DialogState = ReturnType<typeof useDialogState>

function useDialogOpeners(state: DialogState) {
  return useMemo(() => ({
    openFolder: () => { state.setEditingFolder(null); state.setFolderName(''); state.setFolderError(''); state.setFolderDialogOpen(true) },
    editSession: (session: Session) => { state.setEditingSession(session); state.setSessionDialogOpen(true) },
    editFolder: (folder: Folder) => { state.setEditingFolder(folder); state.setFolderName(folder.name); state.setFolderError(''); state.setFolderDialogOpen(true) },
    newSession: () => { state.setEditingSession(null); state.setSessionDialogOpen(true) },
  }), [state.setEditingFolder, state.setEditingSession, state.setFolderDialogOpen, state.setFolderName, state.setSessionDialogOpen])
}

function useSaveSession(workspace: Workspace, state: DialogState) {
  return useCallback(async (data: Omit<Session, 'id'>) => {
    const lifecycleToken = state.lifecycle.current
    const generation = state.sessionGeneration.current
    const target = state.editingSession
    const isCurrent = () => state.lifecycle.current === lifecycleToken && state.sessionGeneration.current === generation
    if (target) await workspace.updateSession({ ...target, ...data })
    else await workspace.createSession(data)
    if (!isCurrent()) return
    state.sessionGeneration.current++
    state.setSessionDialogOpenState(false)
    state.setEditingSessionState(null)
  }, [state.editingSession, workspace])
}

function saveFolder(workspace: Workspace, state: DialogState) {
  if (!state.folderName.trim()) { state.setFolderError(t('请输入分组名称')); return }
  const name = state.folderName.trim()
  const lifecycleToken = state.lifecycle.current
  const generation = state.folderGeneration.current
  if (state.folderSaveGeneration.current === generation) return
  state.folderSaveGeneration.current = generation
  const request = ++state.folderSaveRequest.current
  const target = state.editingFolder
  const isCurrent = () => state.lifecycle.current === lifecycleToken
    && state.folderGeneration.current === generation && state.folderSaveRequest.current === request
  state.setFolderError('')
  const action = target ? workspace.updateFolder(target.id, name) : workspace.createFolder(name, null)
  void Promise.resolve(action).then(() => {
    if (!isCurrent()) return
    state.folderGeneration.current++
    state.setFolderNameState('')
    state.setEditingFolderState(null)
    state.setFolderDialogOpenState(false)
  }).catch((error: unknown) => {
    if (!isCurrent()) return
    const message = error instanceof Error ? error.message : String(error)
    state.setFolderError(target ? t('更新分组失败: ${}', message) : t('创建分组失败: ${}', message))
  }).finally(() => {
    if (state.folderSaveGeneration.current === generation) state.folderSaveGeneration.current = null
  })
}

function editSession(state: DialogState, session: Session) {
  logger.debug('Sidebar: openEditSession', { id: session.id, name: session.name })
  state.setEditingSession(session)
  const lifecycleToken = state.lifecycle.current
  const generation = state.sessionGeneration.current
  setTimeout(() => {
    if (state.lifecycle.current === lifecycleToken && state.sessionGeneration.current === generation) state.setSessionDialogOpenState(true)
  }, 0)
}

function duplicateSessionName(session: Session, existing: string[]) {
  const base = `${session.name} ${t('副本')}`
  const names = new Set(existing.map((name) => name.trim()))
  if (!names.has(base)) return base
  let index = 2
  while (names.has(`${base} ${index}`)) index++
  return `${base} ${index}`
}

async function duplicateSession(workspace: Workspace, session: Session) {
  try {
    const credentials = await SessionService.GetSessionCredentials(Number(session.id))
    const name = duplicateSessionName(session, workspace.sessions.map((item) => item.name))
    const input: Omit<Session, 'id'> = {
      name, host: session.host, port: session.port, username: session.username, notes: session.notes ?? '',
      tags: session.tags, environmentId: session.environmentId, projectId: session.projectId,
      authMethod: session.authMethod, password: credentials?.password ?? undefined,
      keyId: session.keyId, keepAlive: session.keepAlive, termType: session.termType, folderId: session.folderId,
    }
    await workspace.createSession(input)
    toast(t('已复制会话「${}」', name), 'success')
  } catch (error) {
    logger.error('Sidebar: duplicate session error', error)
    toast(t('复制会话失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
    throw error
  }
}

async function copySessionCredentials(workspace: Workspace, session: Session) {
  try {
    const credentials = await SessionService.GetSessionCredentials(Number(session.id))
    if (!credentials) throw new Error(t('未找到会话凭据'))
    const text = credentials.password ? `${credentials.username}:${credentials.password}` : credentials.username
    await getClipboard().writeText(text)
    toast(t('账号密码已复制'), 'success')
  } catch (error) {
    logger.error('Sidebar: copy session credentials error', error)
    toast(t('复制账号密码失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
  }
}

async function copySessionConnectionInfo(workspace: Workspace, session: Session) {
  try {
    const credentials = await SessionService.GetSessionCredentials(Number(session.id))
    if (!credentials) throw new Error(t('未找到会话凭据'))
    
    const folder = workspace.folders.find((f) => f.id === session.folderId)
    const fields = [
      { key: t('连接名称'), value: session.name },
      { key: t('分组'), value: folder?.name ?? t('未分组') },
      { key: t('IP'), value: session.host },
      { key: t('端口'), value: String(session.port) },
      { key: t('用户名'), value: credentials.username },
      { key: t('密码'), value: credentials.password ?? '' },
    ]
    
    const text = fields.map((f) => `${f.key}  ${f.value}`).join('\n')
    
    await getClipboard().writeText(text)
    toast(t('连接信息已复制'), 'success')
  } catch (error) {
    logger.error('Sidebar: copy session connection info error', error)
    toast(t('复制连接信息失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
  }
}

async function deleteSession(workspace: Workspace, session: Session) {
  const confirmed = await requestConfirm({
    title: t('删除会话'),
    description: t('确认删除会话「${}」？此操作不可撤销。', session.name),
    confirmLabel: t('删除'),
    cancelLabel: t('取消'),
    destructive: true,
  })
  if (!confirmed) return
  try {
    await workspace.deleteSession(session.id)
  } catch (error) {
    logger.error('Sidebar: delete session error', error)
    toast(t('删除会话失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
    throw error
  }
}

async function deleteFolder(workspace: Workspace, folder: Folder) {
  const confirmed = await requestConfirm({
    title: t('删除分组'),
    description: t('确认删除分组「${}」？其下会话将移动到根目录。', folder.name),
    confirmLabel: t('删除'),
    cancelLabel: t('取消'),
    destructive: true,
  })
  if (!confirmed) return
  try {
    await workspace.deleteFolder(folder.id)
  } catch (error) {
    logger.error('Sidebar: delete folder error', error)
    toast(t('删除分组失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
    throw error
  }
}

export function useSidebarDialogs(workspace: Workspace) {
  const state = useDialogState()
  const events = useDialogOpeners(state)
  useSidebarDialogEvents(events)
  const saveSession = useSaveSession(workspace, state)
  const quickRenameSession = useCallback((session: Session) => { state.setRenameSession(session) }, [state.setRenameSession])
  const saveRename = useCallback(async () => {
    const target = state.renameSession
    if (!target) return
    const name = state.renameName.trim()
    if (!name) { state.setRenameErrorState(t('请输入会话名称')); return }
    try {
      await workspace.updateSession({ ...target, name })
      state.setRenameSession(null)
    } catch (error) {
      logger.error('Sidebar: rename session error', error)
      state.setRenameErrorState(t('重命名失败: ${}', error instanceof Error ? error.message : String(error)))
    }
  }, [state, workspace])
  return {
    sessionDialogOpen: state.sessionDialogOpen, setSessionDialogOpen: state.setSessionDialogOpen,
    folderDialogOpen: state.folderDialogOpen, setFolderDialogOpen: state.setFolderDialogOpen,
    folderName: state.folderName, setFolderName: state.setFolderName, folderError: state.folderError, setFolderError: state.setFolderError,
    editingFolder: state.editingFolder, setEditingFolder: state.setEditingFolder,
    editingSession: state.editingSession, setEditingSession: state.setEditingSession,
    renameSession: state.renameSession, setRenameSession: state.setRenameSession,
    renameName: state.renameName, setRenameName: state.setRenameName, renameError: state.renameError,
    quickRenameSession, saveRename,
    duplicateSession: (session: Session) => duplicateSession(workspace, session),
    copyConnectionInfo: (session: Session) => copySessionConnectionInfo(workspace, session),
    copyCredentials: (session: Session) => copySessionCredentials(workspace, session),
    deleteSession: (session: Session) => deleteSession(workspace, session),
    editFolder: events.editFolder,
    deleteFolder: (folder: Folder) => deleteFolder(workspace, folder),
    saveSession, saveFolder: () => saveFolder(workspace, state), editSession: (session: Session) => editSession(state, session),
  }
}
