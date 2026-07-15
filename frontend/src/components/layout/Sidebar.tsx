import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import SessionTree from '@/components/session/SessionTree'
import QuickCommands from '@/components/session/QuickCommands'
import { SidebarDialogs } from '@/components/layout/SidebarDialogs'
import { useSessionWorkspace } from '@/hooks/SessionWorkspaceContext'
import { useResizablePanel } from '@/hooks/useResizablePanel'
import { useSidebarDialogs, useSidebarFilter, useSidebarMacros } from '@/hooks/useSidebarState'
import { useAppStore } from '@/store/appStore'
import { workspaceTabID } from '@/store/tabNavigation'

function SessionPanel({ workspace, filter, editSession }: {
  workspace: ReturnType<typeof useSessionWorkspace>
  filter: ReturnType<typeof useSidebarFilter>
  editSession: ReturnType<typeof useSidebarDialogs>['editSession']
}) {
  const retry = () => { void Promise.all([workspace.listFolders(), workspace.listSessions()]) }
  return <>
    <div className="flex flex-col gap-1.5 border-b border-border/50 px-2 py-2"><div className="relative"><Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={filter.searchQuery} onChange={(event) => filter.setSearchQuery(event.target.value)} placeholder="搜索会话..." className="h-7 pl-7 text-xs" /></div></div>
    <div className="flex items-center justify-between border-b border-border/30 px-3 py-1"><span className="text-[11px] text-muted-foreground">{filter.searchQuery.trim() ? `匹配 ${filter.filteredSessions.length} 个会话` : `共 ${workspace.sessions.length} 个会话`}</span>{filter.searchQuery.trim() && <span className="text-[10px] text-muted-foreground/60">已筛选</span>}</div>
    <div className="min-h-0 flex-1">
      {workspace.loading ? <div className="flex flex-col gap-2 p-3"><Skeleton className="h-7 w-full" /><Skeleton className="h-7 w-4/5" /><Skeleton className="h-7 w-3/5" /></div> : workspace.error ? <Alert variant="destructive" className="m-2"><AlertDescription>{workspace.error}<Button size="xs" variant="outline" className="mt-2" onClick={retry}>重试</Button></AlertDescription></Alert> : <SessionTree folders={filter.filteredFolders} sessions={filter.filteredSessions} onConnect={workspace.connect} onEditSession={editSession} onSelectFolder={(id) => window.dispatchEvent(new CustomEvent('mssh:select-folder', { detail: id }))} navigationOnly revealAll={Boolean(filter.searchQuery.trim())} />}
    </div>
  </>
}

export default function Sidebar() {
  const activeTab = useAppStore((state) => state.workspaceTab)
  const panel = useResizablePanel()
  const workspace = useSessionWorkspace()
  const dialogs = useSidebarDialogs(workspace)
  const filter = useSidebarFilter(workspace.folders, workspace.sessions)
  const macro = useSidebarMacros()
  return <div style={{ width: panel.displayedWidth }} className="relative shrink-0 transition-[width] duration-200 ease-out">
    <aside id="sidebar-navigation" style={{ width: panel.width }} aria-labelledby={workspaceTabID(activeTab)} aria-hidden={panel.collapsed} inert={panel.collapsed ? true : undefined} className={`relative flex h-full flex-col border-r border-border bg-card transition-transform duration-200 ease-out ${panel.collapsed ? '-translate-x-full pointer-events-none' : 'translate-x-0'}`}>
      {!panel.collapsed && <div {...panel.resizeHandleProps} className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-primary/60 focus-visible:after:bg-primary active:after:bg-primary" />}
      {activeTab === 'sessions' && <SessionPanel workspace={workspace} filter={filter} editSession={dialogs.editSession} />}
      {activeTab === 'macros' && <div className="min-h-0 flex-1"><QuickCommands commands={macro.macros} onExecute={macro.execute} onAdd={macro.add} onDelete={macro.remove} showAddForm /></div>}
      <SidebarDialogs sessionDialogOpen={dialogs.sessionDialogOpen} onSessionOpenChange={(open) => { dialogs.setSessionDialogOpen(open); if (!open) dialogs.setEditingSession(null) }} editingSession={dialogs.editingSession} onSaveSession={dialogs.saveSession} folders={workspace.folders} folderDialogOpen={dialogs.folderDialogOpen} onFolderOpenChange={(open) => { dialogs.setFolderDialogOpen(open); if (!open) { dialogs.setEditingFolder(null); dialogs.setFolderName('') } }} editingFolder={dialogs.editingFolder} folderName={dialogs.folderName} setFolderName={dialogs.setFolderName} onCreateOrUpdateFolder={dialogs.saveFolder} />
    </aside>
  </div>
}
