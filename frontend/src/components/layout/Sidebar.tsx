import { useState, useCallback, useMemo, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Plus, FolderPlus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import SessionTree from '@/components/session/SessionTree'
import SessionDialog from '@/components/session/SessionDialog'
import QuickCommands from '@/components/session/QuickCommands'
import SettingsDialog from '@/components/settings/SettingsDialog'
import { useSession, type Session, type Folder } from '@/hooks/useSession'
import { useSettings } from '@/hooks/useSettings'
import type { CommandItem } from '@/components/session/QuickCommands'
import { useAppStore } from '@/store/appStore'
import { MacroService } from '@/lib/wails'
import type { Macro, MacroInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { logger } from '@/lib/logger'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useResizablePanel } from '@/hooks/useResizablePanel'

export default function Sidebar() {
  const activeTab = useAppStore((state) => state.sidebarTab)
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null)
  const [editingSession, setEditingSession] = useState<Session | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [macros, setMacros] = useState<CommandItem[]>([])
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'session' | 'folder'; id: string; name: string } | null>(null)
  const { width, collapsed, displayedWidth, toggleCollapsed, resizeHandleProps } = useResizablePanel()

  const {
    folders,
    sessions,
    createFolder,
    deleteFolder,
    updateFolder,
    createSession,
    updateSession,
    deleteSession,
    moveSession,
    setDefaultFolder,
    connect,
    loading,
    error,
    listFolders,
    listSessions,
  } = useSession()

  const settings = useSettings()

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

  const handleOpenNewSession = () => {
    logger.debug('Sidebar: openNewSession')
    setEditingSession(null)
    setTimeout(() => setSessionDialogOpen(true), 0)
  }

  const handleOpenEditSession = (s: Session) => {
    logger.debug('Sidebar: openEditSession', { id: s.id, name: s.name })
    setEditingSession(s)
    setTimeout(() => setSessionDialogOpen(true), 0)
  }

  const handleMacroExecute = useCallback((cmd: string) => {
    const activeTabId = useAppStore.getState().activeTabId
    if (!activeTabId) return
    const activeTab = useAppStore.getState().tabs.find((t) => t.id === activeTabId)
    const terminalId = useAppStore.getState().activePaneId ?? activeTab?.terminalId ?? activeTabId
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
      <aside style={{ width }} aria-hidden={collapsed} inert={collapsed ? true : undefined} className={`relative flex h-full flex-col border-r border-border bg-card transition-transform duration-200 ease-out ${collapsed ? '-translate-x-full pointer-events-none' : 'translate-x-0'}`}>
      <div {...resizeHandleProps} className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-primary/60 focus-visible:after:bg-primary active:after:bg-primary" />
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
            <div className="flex gap-1 items-center">
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 text-xs h-7 justify-start gap-1"
                onClick={() => { logger.debug('Sidebar: 新建会话 click'); handleOpenNewSession() }}
              >
                <Plus className="h-3 w-3" />
                新建会话
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7 w-7 p-0 justify-center"
                onClick={() => { logger.debug('Sidebar: 新建分组 click'); setFolderDialogOpen(true) }}
                title="新建分组"
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </Button>
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
              onDeleteSession={(id) => {
                const session = sessions.find((item) => item.id === id)
                if (session) setDeleteTarget({ type: 'session', id, name: session.name })
              }}
              onEditFolder={(folder: Folder) => { setEditingFolder(folder); setFolderName(folder.name); setFolderDialogOpen(true) }}
              onDeleteFolder={(id) => {
                const folder = folders.find((item) => item.id === id)
                if (folder) setDeleteTarget({ type: 'folder', id, name: folder.name })
              }}
              onMoveToFolder={moveSession}
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

      <SessionDialog
        key={sessionDialogOpen ? 'open' : 'closed'}
        open={sessionDialogOpen}
        onOpenChange={(v) => { setSessionDialogOpen(v); if (!v) setEditingSession(null) }}
        session={editingSession}
        folders={folders}
        onSave={handleSaveSession}
      />

      <Dialog open={folderDialogOpen} onOpenChange={(open) => { setFolderDialogOpen(open); if (!open) { setEditingFolder(null); setFolderName('') } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingFolder ? '编辑分组' : '新建分组'}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                分组名称
              </label>
              <Input
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder="例如：生产环境"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolder()
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateFolder}>
              {editingFolder ? '保存' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        general={settings.general}
        systemFonts={settings.systemFonts}
        theme={settings.theme}
        keys={settings.keys}
        sync={settings.sync}
        onSaveGeneral={settings.saveGeneral}
        onPreviewUIFont={settings.previewUIFont}
        onRestoreUIFont={settings.restoreUIFont}
        onPreviewWindowOpacity={settings.previewWindowOpacity}
        onRestoreWindowOpacity={settings.restoreWindowOpacity}
        onSaveTheme={settings.saveTheme}
        onGenerateKey={settings.generateKey}
        onImportKey={settings.importKey}
        onDeleteKey={settings.deleteKey}
        onExportKey={settings.exportKey}
        onSaveSync={settings.saveSync}
        onExportConfig={settings.exportConfig}
        onImportConfig={settings.importConfig}
        folders={folders}
        sessions={sessions}
        onCreateFolder={createFolder}
        onRenameFolder={updateFolder}
        onSetDefaultFolder={setDefaultFolder}
        onDeleteFolder={deleteFolder}
      />
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除“{deleteTarget?.name}”</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === 'folder' ? '删除分组可能影响其中会话的组织方式。此操作不可撤销。' : '该会话配置将被永久删除，此操作不可撤销。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => {
              if (!deleteTarget) return
              if (deleteTarget.type === 'session') void deleteSession(deleteTarget.id)
              else void deleteFolder(deleteTarget.id)
              setDeleteTarget(null)
            }}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </aside>
      <button type="button" aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'} aria-expanded={!collapsed} onClick={toggleCollapsed} className="absolute left-full top-1/2 z-30 grid size-6 -translate-y-1/2 place-items-center rounded-r-lg border border-l-0 border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronLeft className="size-3.5" />}
      </button>
    </div>
  )
}
