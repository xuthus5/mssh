import { useState, useCallback } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import SessionTree from '@/components/session/SessionTree'
import SessionDialog from '@/components/session/SessionDialog'
import QuickCommands from '@/components/session/QuickCommands'
import { useSession, type Session, type Folder } from '@/hooks/useSession'

type SidebarTab = 'sessions' | 'macros'

export default function Sidebar() {
  const [activeTab, setActiveTab] = useState<SidebarTab>('sessions')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSession, setEditingSession] = useState<Session | null>(null)

  const {
    folders,
    sessions,
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
      setDialogOpen(false)
      setEditingSession(null)
    },
    [editingSession, createSession, updateSession],
  )

  const handleOpenNewSession = () => {
    setEditingSession(null)
    setDialogOpen(true)
  }

  const handleOpenEditSession = (s: Session) => {
    setEditingSession(s)
    setDialogOpen(true)
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
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        session={editingSession}
        onSave={handleSaveSession}
      />
    </aside>
  )
}
