import { APP_NEW_SESSION_EVENT, onAppEvent } from '@/lib/appEvents'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CommandItem } from '@/components/session/QuickCommands'
import type { Folder, Session } from '@/hooks/useSession'
import { useSessionWorkspace } from '@/hooks/SessionWorkspaceContext'
import { MacroService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { executeMacroOnActiveTerminal } from '@/lib/executeMacro'
import { t } from '@/i18n'
import type { Macro, MacroInput } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { sessionAssetSearchText } from '@/lib/sessionAssetSearch'

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

export function useSidebarDialogs(workspace: Workspace) {
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderError, setFolderError] = useState('')
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null)
  const [editingSession, setEditingSession] = useState<Session | null>(null)
  const events = useMemo(() => ({
    openFolder: () => { setEditingFolder(null); setFolderName(''); setFolderError(''); setFolderDialogOpen(true) },
    editSession: (session: Session) => { setEditingSession(session); setSessionDialogOpen(true) },
    editFolder: (folder: Folder) => { setEditingFolder(folder); setFolderName(folder.name); setFolderError(''); setFolderDialogOpen(true) },
    newSession: () => { setEditingSession(null); setSessionDialogOpen(true) },
  }), [])
  useSidebarDialogEvents(events)
  const saveSession = useCallback(async (data: Omit<Session, 'id'>) => {
    if (editingSession) await workspace.updateSession({ ...editingSession, ...data })
    else await workspace.createSession(data)
    setSessionDialogOpen(false)
    setEditingSession(null)
  }, [editingSession, workspace])
  const saveFolder = () => {
    if (!folderName.trim()) {
      setFolderError(t('请输入分组名称'))
      return
    }
    const name = folderName.trim()
    setFolderError('')
    const action = editingFolder
      ? workspace.updateFolder(editingFolder.id, name)
      : workspace.createFolder(name, null)
    void Promise.resolve(action).then(() => {
      setFolderName('')
      setEditingFolder(null)
      setFolderDialogOpen(false)
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      setFolderError(editingFolder ? t('更新分组失败: ${}', message) : t('创建分组失败: ${}', message))
    })
  }
  const editSession = (session: Session) => {
    logger.debug('Sidebar: openEditSession', { id: session.id, name: session.name })
    setEditingSession(session)
    setTimeout(() => setSessionDialogOpen(true), 0)
  }
  return { sessionDialogOpen, setSessionDialogOpen, folderDialogOpen, setFolderDialogOpen, folderName, setFolderName, folderError, setFolderError, editingFolder, setEditingFolder, editingSession, setEditingSession, saveSession, saveFolder, editSession }
}

export function useSidebarFilter(folders: Folder[], sessions: Session[]) {
  const [searchQuery, setSearchQuery] = useState('')
  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]))
    return query ? sessions.filter((session) => sessionAssetSearchText(session, folderNames.get(session.folderId ?? '') ?? '').includes(query)) : sessions
  }, [folders, sessions, searchQuery])
  const filteredFolders = useMemo(() => {
    if (!searchQuery.trim()) return folders
    const included = new Set<string>()
    for (const session of filteredSessions) {
      let parentID = session.folderId
      while (parentID) {
        if (included.has(parentID)) break
        included.add(parentID)
        parentID = folders.find((folder) => folder.id === parentID)?.parentId ?? null
      }
    }
    const query = searchQuery.toLowerCase()
    for (const folder of folders) if (folder.name.toLowerCase().includes(query)) included.add(folder.id)
    return folders.filter((folder) => included.has(folder.id))
  }, [folders, filteredSessions, searchQuery])
  return { searchQuery, setSearchQuery, filteredSessions, filteredFolders }
}

function macroItem(macro: Macro): CommandItem {
  return { id: String(macro.id), name: macro.name, shortcut: macro.shortcut, command: macro.command }
}

function macroErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function loadMacros(
  setMacros: (update: CommandItem[]) => void,
  setError: (message: string) => void,
) {
  try {
    setMacros((await MacroService.List() ?? []).map(macroItem))
    setError('')
  } catch (error: unknown) {
    logger.error('Sidebar: list macros error', error)
    setMacros([])
    setError(macroErrorMessage(error))
  }
}

async function addMacro(
  item: Omit<CommandItem, 'id'>,
  update: (callback: (items: CommandItem[]) => CommandItem[]) => void,
  setError: (message: string) => void,
) {
  try {
    const input = { name: item.name, command: item.command, shortcut: item.shortcut, id: 0, delay_ms: 0, sort_order: 0 } satisfies MacroInput
    const result = await MacroService.Create(input)
    update((items) => [...items, { id: String(result?.id ?? ''), name: result?.name ?? item.name, shortcut: result?.shortcut ?? item.shortcut, command: result?.command ?? item.command }])
    setError('')
  } catch (error: unknown) {
    logger.error('Sidebar: create macro error', error)
    // Sidebar macro panel owns create failures via fixed banner.
    setError(t('创建宏失败: ${}', macroErrorMessage(error)))
    throw error instanceof Error ? error : new Error(macroErrorMessage(error))
  }
}

async function deleteMacro(
  id: string,
  update: (callback: (items: CommandItem[]) => CommandItem[]) => void,
  setError: (message: string) => void,
) {
  try {
    await MacroService.Delete(Number(id))
    update((items) => items.filter((item) => item.id !== id))
    setError('')
  } catch (error: unknown) {
    logger.error('Sidebar: delete macro error', error)
    setError(t('删除宏失败: ${}', macroErrorMessage(error)))
    throw error instanceof Error ? error : new Error(macroErrorMessage(error))
  }
}

export function useSidebarMacros() {
  const [macros, setMacros] = useState<CommandItem[]>([])
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    await loadMacros(setMacros, setError)
  }, [])
  useEffect(() => { void reload() }, [reload])
  const execute = useCallback((command: string) => {
    void executeMacroOnActiveTerminal(command, { requireTerminalSurface: true })
  }, [])
  const add = useCallback((item: Omit<CommandItem, 'id'>) => addMacro(item, setMacros, setError), [])
  const remove = useCallback((id: string) => deleteMacro(id, setMacros, setError), [])
  return { macros, error, reload, execute, add, remove }
}
