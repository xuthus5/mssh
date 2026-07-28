import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { APP_NEW_SESSION_EVENT, onAppEvent } from '@/lib/appEvents'
import type { Folder, Session } from '@/hooks/useSession'
import { useSessionWorkspace } from '@/hooks/SessionWorkspaceContext'
import { logger } from '@/lib/logger'
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
  return { sessionDialogOpen, setSessionDialogOpen, setSessionDialogOpenState, folderDialogOpen, setFolderDialogOpen, setFolderDialogOpenState, folderName, setFolderName, setFolderNameState, folderError, setFolderError, editingFolder, setEditingFolder, setEditingFolderState, editingSession, setEditingSession, setEditingSessionState, lifecycle, sessionGeneration, folderGeneration, folderSaveRequest, folderSaveGeneration }
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

export function useSidebarDialogs(workspace: Workspace) {
  const state = useDialogState()
  const events = useDialogOpeners(state)
  useSidebarDialogEvents(events)
  const saveSession = useSaveSession(workspace, state)
  return {
    sessionDialogOpen: state.sessionDialogOpen, setSessionDialogOpen: state.setSessionDialogOpen,
    folderDialogOpen: state.folderDialogOpen, setFolderDialogOpen: state.setFolderDialogOpen,
    folderName: state.folderName, setFolderName: state.setFolderName, folderError: state.folderError, setFolderError: state.setFolderError,
    editingFolder: state.editingFolder, setEditingFolder: state.setEditingFolder,
    editingSession: state.editingSession, setEditingSession: state.setEditingSession,
    saveSession, saveFolder: () => saveFolder(workspace, state), editSession: (session: Session) => editSession(state, session),
  }
}
