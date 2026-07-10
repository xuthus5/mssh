import { useState, useCallback } from 'react'
import { Plus, FolderPlus } from 'lucide-react'
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
import { useSession, type Session, type Folder } from '@/hooks/useSession'

type SidebarTab = 'sessions' | 'macros'

export default function Sidebar() {
  const [activeTab, setActiveTab] = useState<SidebarTab>('sessions')
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [editingSession, setEditingSession] = useState<Session | null>(null)

  const {
    folders,
    sessions,
    createFolder,
    deleteFolder,
    createSession,
    updateSession,
    deleteSession,
    connect,
  } = useSession()

  const handleSaveSession = useCallback(
    (data: Omit<Session, 'id'>) => {
      if (editingSession) {
        updateSession({ ...editingSession, ...data })
      } else {
        createSession(data)
      }
      setSessionDialogOpen(false)
      setEditingSession(null)
    },
    [editingSession, createSession, updateSession],
  )

  const handleCreateFolder = () => {
    if (!folderName.trim()) return
    createFolder(folderName.trim(), null)
    setFolderName('')
    setFolderDialogOpen(false)
  }

  const handleOpenNewSession = () => {
    setEditingSession(null)
    // small delay ensures react state is flushed before opening
    setTimeout(() => setSessionDialogOpen(true), 0)
  }

  const handleOpenEditSession = (s: Session) => {
    setEditingSession(s)
    setTimeout(() => setSessionDialogOpen(true), 0)
  }

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
      </div>

      {activeTab === 'sessions' && (
        <>
          <div className="px-2 py-2 flex gap-1 border-b border-border/50">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-xs h-7 justify-start gap-1"
              onClick={handleOpenNewSession}
            >
              <Plus className="h-3 w-3" />
              新建会话
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7 w-7 p-0 justify-center"
              onClick={() => setFolderDialogOpen(true)}
              title="新建分组"
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex-1 min-h-0">
            <SessionTree
              folders={folders}
              sessions={sessions}
              onConnect={connect}
              onEditSession={handleOpenEditSession}
              onDeleteSession={deleteSession}
              onEditFolder={(f: Folder) => console.debug('[folder/edit]', f)}
              onDeleteFolder={deleteFolder}
            />
          </div>
        </>
      )}

      {activeTab === 'macros' && (
        <div className="flex-1 min-h-0">
          <QuickCommands
            commands={[]}
            onExecute={(cmd: string) => console.debug('[macro]', cmd)}
            onAdd={(item) => console.debug('[macro/add]', item)}
            onDelete={(id: string) => console.debug('[macro/delete]', id)}
          />
        </div>
      )}

      <SessionDialog
        key={sessionDialogOpen ? 'open' : 'closed'}
        open={sessionDialogOpen}
        onOpenChange={(v) => { setSessionDialogOpen(v); if (!v) setEditingSession(null) }}
        session={editingSession}
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
    </aside>
  )
}
