import { useState, useCallback, useMemo, useEffect } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import SessionTree from '@/components/session/SessionTree'
import QuickCommands from '@/components/session/QuickCommands'
import { SidebarDialogs } from '@/components/layout/SidebarDialogs'
import { type Session, type Folder } from '@/hooks/useSession'
import { useSessionWorkspace } from '@/hooks/SessionWorkspaceContext'
import { useSettings } from '@/hooks/useSettings'
import { useThemeCatalog } from '@/hooks/useThemeCatalog'
import type { CommandItem } from '@/components/session/QuickCommands'
import { useAppStore } from '@/store/appStore'
import { workspaceTabID } from '@/store/tabNavigation'
import { MacroService } from '@/lib/wails'
import type { Macro, MacroInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { logger } from '@/lib/logger'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { useResizablePanel } from '@/hooks/useResizablePanel'

export default function Sidebar() {
  const activeTab = useAppStore((state) => state.workspaceTab)
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null)
  const [editingSession, setEditingSession] = useState<Session | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [macros, setMacros] = useState<CommandItem[]>([])
  const { width, collapsed, displayedWidth, resizeHandleProps } = useResizablePanel()

  const {
    folders,
    sessions,
    createFolder,
    updateFolder,
    createSession,
    updateSession,
    connect,
    loading,
    error,
    listFolders,
    listSessions,
  } = useSessionWorkspace()

  const settings = useSettings()
  const themeCatalog = useThemeCatalog()

  useEffect(() => {
    MacroService.List()
      .then((result) => {
        const items = (result ?? []).map((m: Macro) => ({
          id: String(m.id),
          name: m.name,
          shortcut: m.shortcut,
          command: m.command,
        }))
        setMacros(items)
      })
      .catch((err: unknown) => { logger.error('Sidebar: list macros error', err) })
  }, [])

  useEffect(() => {
    const openFolder = () => { setEditingFolder(null); setFolderName(''); setFolderDialogOpen(true) }
    const editSession = (event: Event) => { setEditingSession((event as CustomEvent<Session>).detail); setSessionDialogOpen(true) }
    const editFolder = (event: Event) => { const folder = (event as CustomEvent<Folder>).detail; setEditingFolder(folder); setFolderName(folder.name); setFolderDialogOpen(true) }
    window.addEventListener('mssh:new-folder', openFolder)
    window.addEventListener('mssh:edit-session', editSession)
    window.addEventListener('mssh:edit-folder', editFolder)
    return () => {
      window.removeEventListener('mssh:new-folder', openFolder)
      window.removeEventListener('mssh:edit-session', editSession)
      window.removeEventListener('mssh:edit-folder', editFolder)
    }
  }, [])

  useEffect(() => {
    const openSettings = () => setSettingsOpen(true)
    window.addEventListener('mssh:open-settings', openSettings)
    return () => window.removeEventListener('mssh:open-settings', openSettings)
  }, [])

  useEffect(() => {
    const openNewSession = () => {
      setEditingSession(null)
      setSessionDialogOpen(true)
    }
    window.addEventListener('mssh:new-session', openNewSession)
    return () => window.removeEventListener('mssh:new-session', openNewSession)
  }, [])

  const filteredSessions = useMemo(
    () =>
      searchQuery.trim()
        ? sessions.filter(
            (s) =>
              s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
              s.host.toLowerCase().includes(searchQuery.toLowerCase()) ||
              s.username.toLowerCase().includes(searchQuery.toLowerCase()),
          )
        : sessions,
    [sessions, searchQuery],
  )

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
    for (const folder of folders) {
      if (folder.name.toLowerCase().includes(searchQuery.toLowerCase())) included.add(folder.id)
    }
    return folders.filter((folder) => included.has(folder.id))
  }, [folders, filteredSessions, searchQuery])

  const handleSaveSession = useCallback(
    async (data: Omit<Session, 'id'>) => {
      if (editingSession) {
        logger.debug('Sidebar: updateSession', { id: editingSession.id, name: data.name, authMethod: data.authMethod })
        await updateSession({ ...editingSession, ...data })
      } else {
        logger.debug('Sidebar: createSession', { name: data.name, authMethod: data.authMethod })
        await createSession(data)
      }
      setSessionDialogOpen(false)
      setEditingSession(null)
    },
    [editingSession, createSession, updateSession],
  )

  const handleCreateFolder = () => {
    if (!folderName.trim()) return
    if (editingFolder) void updateFolder(editingFolder.id, folderName.trim())
    else void createFolder(folderName.trim(), null)
    setFolderName('')
    setEditingFolder(null)
    setFolderDialogOpen(false)
  }

  const handleOpenEditSession = (s: Session) => {
    logger.debug('Sidebar: openEditSession', { id: s.id, name: s.name })
    setEditingSession(s)
    setTimeout(() => setSessionDialogOpen(true), 0)
  }

  const handleMacroExecute = useCallback((cmd: string) => {
    const state = useAppStore.getState()
    if (state.activeSurface?.type !== 'terminal') return
    const activeTab = state.tabs.find((tab) => tab.id === state.activeSurface?.id)
    const terminalId = state.activePaneId ?? activeTab?.terminalId ?? state.activeSurface.id
    logger.debug('Sidebar: MacroService.Execute', terminalId, cmd)
    MacroService.Execute(terminalId, cmd).catch((err: unknown) => {
      logger.error('Sidebar: execute macro error', err)
    })
  }, [])

  const handleMacroAdd = useCallback(async (item: Omit<CommandItem, 'id'>) => {
    try {
      logger.debug('Sidebar: MacroService.Create', item)
      const input = { name: item.name, command: item.command, shortcut: item.shortcut, id: 0, delay_ms: 0, sort_order: 0 } satisfies MacroInput
      const result = await MacroService.Create(input)
      const newItem: CommandItem = {
        id: String(result?.id ?? ''),
        name: result?.name ?? item.name,
        shortcut: result?.shortcut ?? item.shortcut,
        command: result?.command ?? item.command,
      }
      setMacros((prev) => [...prev, newItem])
    } catch (err) {
      logger.error('Sidebar: create macro error', err)
    }
  }, [])

  const handleMacroDelete = useCallback(async (id: string) => {
    try {
      logger.debug('Sidebar: MacroService.Delete', id)
      await MacroService.Delete(Number(id))
      setMacros((prev) => prev.filter((m) => m.id !== id))
    } catch (err) {
      logger.error('Sidebar: delete macro error', err)
    }
  }, [])

  return (
    <div style={{ width: displayedWidth }} className="relative shrink-0 transition-[width] duration-200 ease-out">
      <aside id="sidebar-navigation" style={{ width }} aria-labelledby={workspaceTabID(activeTab)} aria-hidden={collapsed} inert={collapsed ? true : undefined} className={`relative flex h-full flex-col border-r border-border bg-card transition-transform duration-200 ease-out ${collapsed ? '-translate-x-full pointer-events-none' : 'translate-x-0'}`}>
      {!collapsed && <div {...resizeHandleProps} className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-primary/60 focus-visible:after:bg-primary active:after:bg-primary" />}
      {activeTab === 'sessions' && (
        <>
          <div className="px-2 py-2 flex flex-col gap-1.5 border-b border-border/50">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索会话..."
                className="h-7 pl-7 text-xs"
              />
            </div>
          </div>
          <div className="flex items-center justify-between px-3 py-1 border-b border-border/30">
            <span className="text-[11px] text-muted-foreground">
              {searchQuery.trim() ? `匹配 ${filteredSessions.length} 个会话` : `共 ${sessions.length} 个会话`}
            </span>
            {searchQuery.trim() && (
              <span className="text-[10px] text-muted-foreground/60">
                已筛选
              </span>
            )}
          </div>
          <div className="flex-1 min-h-0">
            {loading ? <div className="flex flex-col gap-2 p-3"><Skeleton className="h-7 w-full" /><Skeleton className="h-7 w-4/5" /><Skeleton className="h-7 w-3/5" /></div> : error ? (
              <Alert variant="destructive" className="m-2"><AlertDescription>{error}<Button size="xs" variant="outline" className="mt-2" onClick={() => { void Promise.all([listFolders(), listSessions()]) }}>重试</Button></AlertDescription></Alert>
            ) : <SessionTree
              folders={filteredFolders}
              sessions={filteredSessions}
              onConnect={connect}
              onEditSession={handleOpenEditSession}
              onSelectFolder={(id) => window.dispatchEvent(new CustomEvent('mssh:select-folder', { detail: id }))}
              navigationOnly
              revealAll={Boolean(searchQuery.trim())}
            />}
          </div>
        </>
      )}

      {activeTab === 'macros' && (
        <div className="flex-1 min-h-0">
          <QuickCommands
            commands={macros}
            onExecute={handleMacroExecute}
            onAdd={handleMacroAdd}
            onDelete={handleMacroDelete}
            showAddForm
          />
        </div>
      )}

      <SidebarDialogs
        sessionDialogOpen={sessionDialogOpen}
        onSessionOpenChange={(open) => { setSessionDialogOpen(open); if (!open) setEditingSession(null) }}
        editingSession={editingSession}
        onSaveSession={handleSaveSession}
        folders={folders}
        folderDialogOpen={folderDialogOpen}
        onFolderOpenChange={(open) => { setFolderDialogOpen(open); if (!open) { setEditingFolder(null); setFolderName('') } }}
        editingFolder={editingFolder}
        folderName={folderName}
        setFolderName={setFolderName}
        onCreateOrUpdateFolder={handleCreateFolder}
        settingsProps={{ open: settingsOpen, onOpenChange: setSettingsOpen, general: settings.general, systemFonts: settings.systemFonts, themeProfiles: themeCatalog.profiles, themeAssignments: themeCatalog.assignments, keys: settings.keys, sync: settings.sync, onSaveGeneral: settings.saveGeneral, onPreviewUIFont: settings.previewUIFont, onRestoreUIFont: settings.restoreUIFont, onPreviewWindowOpacity: settings.previewWindowOpacity, onRestoreWindowOpacity: settings.restoreWindowOpacity, onSaveThemeConfiguration: themeCatalog.saveConfiguration, onImportThemes: themeCatalog.importThemes, onCreateThemeProfile: themeCatalog.createProfile, onUpdateThemeProfile: themeCatalog.saveProfile, onDeleteThemeProfile: themeCatalog.deleteProfile, onDeleteThemeDefinition: themeCatalog.deleteDefinition, onResetBuiltinThemes: themeCatalog.resetBuiltinStyles, onGenerateKey: settings.generateKey, onImportKey: settings.importKey, onDeleteKey: settings.deleteKey, onExportKey: settings.exportKey, onSaveSync: settings.saveSync, onExportConfig: settings.exportConfig, onImportConfig: settings.importConfig }}
      />
      </aside>
    </div>
  )
}
