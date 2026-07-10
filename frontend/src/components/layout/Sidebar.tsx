import { useState, useCallback, useMemo, useEffect } from 'react'
import { Plus, FolderPlus, Search, Settings } from 'lucide-react'
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

type SidebarTab = 'sessions' | 'macros'

export default function Sidebar() {
  const [activeTab, setActiveTab] = useState<SidebarTab>('sessions')
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [editingSession, setEditingSession] = useState<Session | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [macros, setMacros] = useState<CommandItem[]>([])

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
    connect,
  } = useSession()

  const settings = useSettings()

  useEffect(() => {
    MacroService.List()
      .then((result: any) => {
        const items = (result as { id?: number; name?: string; shortcut?: string; command?: string }[]).map((m) => ({
          id: String(m.id ?? ''),
          name: m.name ?? '',
          shortcut: m.shortcut ?? '',
          command: m.command ?? '',
        }))
        setMacros(items)
      })
      .catch((err: unknown) => { console.error('[Sidebar] list macros error', err) })
  }, [])

  const filteredFolders = useMemo(
    () =>
      searchQuery.trim()
        ? folders.filter((f) =>
            f.name.toLowerCase().includes(searchQuery.toLowerCase()),
          )
        : folders,
    [folders, searchQuery],
  )

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

  const handleSaveSession = useCallback(
    (data: Omit<Session, 'id'>) => {
      if (editingSession) {
        console.log('[Sidebar] updateSession', { id: editingSession.id, name: data.name, authMethod: data.authMethod })
        updateSession({ ...editingSession, ...data })
      } else {
        console.log('[Sidebar] createSession', { name: data.name, authMethod: data.authMethod })
        createSession(data)
      }
      setSessionDialogOpen(false)
      setEditingSession(null)
    },
    [editingSession, createSession, updateSession],
  )

  const handleCreateFolder = () => {
    if (!folderName.trim()) return
    console.log('[Sidebar] createFolder', folderName.trim())
    createFolder(folderName.trim(), null)
    setFolderName('')
    setFolderDialogOpen(false)
  }

  const handleOpenNewSession = () => {
    console.log('[Sidebar] openNewSession')
    setEditingSession(null)
    setTimeout(() => setSessionDialogOpen(true), 0)
  }

  const handleOpenEditSession = (s: Session) => {
    console.log('[Sidebar] openEditSession', { id: s.id, name: s.name })
    setEditingSession(s)
    setTimeout(() => setSessionDialogOpen(true), 0)
  }

  const handleMacroExecute = useCallback((cmd: string) => {
    const activeTabId = useAppStore.getState().activeTabId
    if (!activeTabId) return
    const activeTab = useAppStore.getState().tabs.find((t) => t.id === activeTabId)
    const terminalId = activeTab?.terminalId ?? activeTabId
    console.log('[Sidebar] MacroService.Execute', terminalId, cmd)
    MacroService.Execute(terminalId, cmd).catch((err: unknown) => {
      console.error('[Sidebar] execute macro error', err)
    })
  }, [])

  const handleMacroAdd = useCallback(async (item: Omit<CommandItem, 'id'>) => {
    try {
      console.log('[Sidebar] MacroService.Create', item)
      const result = (await MacroService.Create(item as any)) as { id?: number; name?: string; shortcut?: string; command?: string }
      const newItem: CommandItem = {
        id: String(result.id ?? ''),
        name: result.name ?? item.name,
        shortcut: result.shortcut ?? item.shortcut,
        command: result.command ?? item.command,
      }
      setMacros((prev) => [...prev, newItem])
    } catch (err) {
      console.error('[Sidebar] create macro error', err)
    }
  }, [])

  const handleMacroDelete = useCallback(async (id: string) => {
    try {
      console.log('[Sidebar] MacroService.Delete', id)
      await MacroService.Delete(Number(id))
      setMacros((prev) => prev.filter((m) => m.id !== id))
    } catch (err) {
      console.error('[Sidebar] delete macro error', err)
    }
  }, [])

  return (
    <aside className="w-[280px] flex-shrink-0 flex flex-col border-r border-border bg-card">
      <div className="flex border-b border-border">
        <button
          type="button"
          className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'sessions'
              ? 'bg-background text-foreground border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('sessions')}
        >
          会话
        </button>
        <button
          type="button"
          className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'macros'
              ? 'bg-background text-foreground border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('macros')}
        >
          宏
        </button>
        <Button variant="ghost" size="icon-sm" className="mx-1" onClick={() => setSettingsOpen(true)} title="设置">
          <Settings className="h-4 w-4" />
        </Button>
      </div>

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
                onClick={() => { console.log('[Sidebar] 新建会话 click'); handleOpenNewSession() }}
              >
                <Plus className="h-3 w-3" />
                新建会话
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7 w-7 p-0 justify-center"
                onClick={() => { console.log('[Sidebar] 新建分组 click'); setFolderDialogOpen(true) }}
                title="新建分组"
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between px-3 py-1 border-b border-border/30">
            <span className="text-[11px] text-muted-foreground">
              共 {sessions.length} 个会话
            </span>
            {searchQuery.trim() && (
              <span className="text-[10px] text-muted-foreground/60">
                已筛选
              </span>
            )}
          </div>
          <div className="flex-1 min-h-0">
            <SessionTree
              folders={filteredFolders}
              sessions={filteredSessions}
              onConnect={connect}
              onEditSession={handleOpenEditSession}
              onDeleteSession={deleteSession}
              onEditFolder={(f: Folder) => {
                const newName = prompt('修改分组名称', f.name)
                if (newName && newName.trim() !== '' && newName !== f.name) {
                  updateFolder(f.id, newName.trim())
                }
              }}
              onDeleteFolder={deleteFolder}
              onMoveToFolder={moveSession}
            />
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

      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>新建分组</DialogTitle>
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
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        general={settings.general}
        theme={settings.theme}
        keys={settings.keys}
        sync={settings.sync}
        onSaveGeneral={settings.saveGeneral}
        onSaveTheme={settings.saveTheme}
        onGenerateKey={settings.generateKey}
        onImportKey={settings.importKey}
        onDeleteKey={settings.deleteKey}
        onExportKey={settings.exportKey}
        onSaveSync={settings.saveSync}
        onExportConfig={settings.exportConfig}
        onImportConfig={settings.importConfig}
      />
    </aside>
  )
}
