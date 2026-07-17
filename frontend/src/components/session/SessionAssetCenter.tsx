import { useEffect, useMemo, useState } from 'react'
import { FolderPlus, Plus, Server, SquareTerminal } from 'lucide-react'
import { useSessionWorkspace } from '@/hooks/SessionWorkspaceContext'
import type { Folder, Session } from '@/hooks/useSession'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toast'
import { SessionBatchActions } from '@/components/session/SessionBatchActions'
import { SessionAssetBulkBar } from '@/components/session/SessionAssetBulkBar'
import { SessionAssetCatalogManager } from '@/components/session/SessionAssetCatalogManager'
import { SessionAssetDetailPanel } from '@/components/session/SessionAssetDetailPanel'
import { SessionAssetFilterBar } from '@/components/session/SessionAssetFilterBar'
import { SessionAssetTable } from '@/components/session/SessionAssetTable'
import { SessionFolderAssetTable, SessionAssetDeleteDialog, SessionNodeBreadcrumb, type DeleteTarget } from '@/components/session/SessionFolderAssetTable'
import { filterSessionAssets } from '@/lib/sessionAssetSearch'
import { useSessionAssetFilterStore } from '@/store/sessionAssetFilterStore'
import { useAppStore } from '@/store/appStore'

type AssetTab = 'recent' | 'folders' | 'nodes' | 'catalog'

export function SessionAssetCenter() {
  const state = useSessionWorkspace()
  const filters = useSessionAssetFilterStore((store) => store.filters)
  const setFilters = useSessionAssetFilterStore((store) => store.setFilters)
  const resetFilters = useSessionAssetFilterStore((store) => store.resetFilters)
  const tabs = useAppStore((store) => store.tabs)
  const connectionStatus = useAppStore((store) => store.connectionStatus)
  const [tab, setTab] = useState<AssetTab>('recent')
  const [folderID, setFolderID] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [selectedIDs, setSelectedIDs] = useState<Set<string>>(() => new Set())
  const [detailID, setDetailID] = useState<string | null>(null)
  const environments = state.environments ?? []
  const projects = state.projects ?? []
  const tags = state.tags ?? []

  useEffect(() => {
    const selectFolder = (event: Event) => { setFolderID((event as CustomEvent<string>).detail); setTab('nodes') }
    window.addEventListener('mssh:select-folder', selectFolder)
    return () => window.removeEventListener('mssh:select-folder', selectFolder)
  }, [])

  const selectedFolder = state.folders.find((folder) => folder.id === folderID)
  const folderSessions = useMemo(() => state.sessions.filter((session) => !folderID || session.folderId === folderID), [folderID, state.sessions])
  const filteredSessions = useMemo(() => filterSessionAssets(folderSessions, state.folders, filters), [filters, folderSessions, state.folders])
  const detailSession = state.sessions.find((session) => session.id === detailID) ?? null
  const activeTerminalCount = useMemo(() => tabs.filter((item) => item.type === 'terminal' && String(item.sessionId) === detailID && ['connected', 'reconnecting'].includes(connectionStatus[item.terminalId])).length, [connectionStatus, detailID, tabs])

  const retry = () => { void Promise.all([state.listFolders(), state.listSessions(), state.listRecentSessions(), state.listAssetCatalogs?.()]) }
  const clearSelection = () => setSelectedIDs(new Set())
  const deleteItem = async (target: DeleteTarget) => {
    if (target.type === 'folder') await state.deleteFolder(target.item.id)
    else await state.deleteSession(target.item.id)
    if (target.type === 'session' && detailID === target.item.id) setDetailID(null)
    setDeleteTarget(null)
  }
  const runFolderAction = async (action: () => Promise<unknown>) => {
    try { await action() } catch (error) { toast(error instanceof Error ? error.message : String(error), 'error') }
  }

  return <section className="relative flex min-h-0 flex-1 flex-col bg-background p-5">
    <header className="flex shrink-0 items-start justify-between gap-4"><div><h1 className="text-xl font-semibold text-foreground">会话资产</h1><p className="text-sm text-muted-foreground">集中管理连接、分组、节点与资产分类</p></div><CreateMenu /></header>
    {state.error && <Alert variant="destructive" className="mt-4"><AlertDescription>{state.error}<Button size="xs" variant="outline" className="ml-3" onClick={retry}>重试</Button></AlertDescription></Alert>}
    <Tabs value={tab} onValueChange={(value) => setTab(value as AssetTab)} className="mt-4 min-h-0 flex-1"><TabsList variant="line"><TabsTrigger value="recent">最近连接 <Badge variant="secondary">{state.recentSessions.length}</Badge></TabsTrigger><TabsTrigger value="folders">分组 <Badge variant="secondary">{state.folders.length}</Badge></TabsTrigger><TabsTrigger value="nodes">所有节点 <Badge variant="secondary">{state.sessions.length}</Badge></TabsTrigger><TabsTrigger value="catalog">分类管理 <Badge variant="secondary">{environments.length + projects.length + tags.length}</Badge></TabsTrigger></TabsList>
      <TabsContent value="recent" className="min-h-0 overflow-auto pt-4">{state.loading ? <LoadingRows /> : <SessionAssetTable sessions={state.recentSessions} folders={state.folders} selectedIDs={selectedIDs} onSelectionChange={setSelectedIDs} onConnect={state.connect} onOpenDetail={(session) => setDetailID(session.id)} onEdit={editSession} onDelete={(session) => setDeleteTarget({ type: 'session', item: session })} onMove={state.moveSession} recent />}</TabsContent>
      <TabsContent value="folders" className="min-h-0 overflow-auto pt-4"><SessionFolderAssetTable folders={state.folders} sessions={state.sessions} onOpen={(id) => { setFolderID(id); setTab('nodes') }} onRename={editFolder} onSetDefault={(id) => { void runFolderAction(() => state.setDefaultFolder(id)) }} onDelete={(folder) => setDeleteTarget({ type: 'folder', item: folder })} /></TabsContent>
      <TabsContent value="nodes" className="min-h-0 overflow-auto pt-4"><div className="flex flex-col gap-3"><SessionNodeBreadcrumb folder={selectedFolder} onClear={() => setFolderID(null)} /><SessionAssetFilterBar filters={filters} environments={environments} projects={projects} tags={tags} onChange={setFilters} onReset={resetFilters} />
        <SessionAssetBulkBar selectedIDs={[...selectedIDs]} environments={environments} projects={projects} tags={tags} onSetEnvironment={state.bulkSetEnvironment} onSetProject={state.bulkSetProject} onUpdateTags={state.bulkUpdateTags} onClearSelection={clearSelection} />
        <SessionBatchActions selectedIDs={[...selectedIDs]} onBatchConnect={state.batchConnect} onBatchExecuteMacro={state.batchExecuteMacro} onComplete={clearSelection} />
        <SessionAssetTable sessions={filteredSessions} folders={state.folders} selectedIDs={selectedIDs} onSelectionChange={setSelectedIDs} onConnect={state.connect} onOpenDetail={(session) => setDetailID(session.id)} onEdit={editSession} onDelete={(session) => setDeleteTarget({ type: 'session', item: session })} onMove={state.moveSession} /></div></TabsContent>
      <TabsContent value="catalog" className="min-h-0 overflow-auto pt-4"><SessionAssetCatalogManager environments={environments} projects={projects} tags={tags} onCreateEnvironment={state.createEnvironment} onCreateProject={state.createProject} onCreateTag={state.createTag} onUpdateEnvironment={state.updateEnvironment} onUpdateProject={state.updateProject} onUpdateTag={state.updateTag} onDeleteEnvironment={(id, mode, replacementID) => state.deleteEnvironment({ id: Number(id), mode, replacement_id: replacementID ? Number(replacementID) : null })} onDeleteProject={(id, mode, replacementID) => state.deleteProject({ id: Number(id), mode, replacement_id: replacementID ? Number(replacementID) : null })} onDeleteTag={state.deleteTag} onReorderEnvironments={state.reorderEnvironments} onReorderProjects={state.reorderProjects} /></TabsContent>
    </Tabs>
    <SessionAssetDetailPanel session={detailSession} folders={state.folders} activeTerminalCount={activeTerminalCount} onClose={() => setDetailID(null)} onConnect={state.connect} onEdit={editSession} onDelete={(session) => setDeleteTarget({ type: 'session', item: session })} onDuplicateTerminal={(session) => state.connect(session.id)} />
    <SessionAssetDeleteDialog target={deleteTarget} folders={state.folders} sessions={state.sessions} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }} onConfirm={deleteItem} />
  </section>
}

function CreateMenu() {
  return <DropdownMenu><DropdownMenuTrigger render={<Button />}><Plus data-icon="inline-start" />创建</DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent('mssh:new-session'))}><SquareTerminal />新建会话</DropdownMenuItem><DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent('mssh:new-folder'))}><FolderPlus />新建分组目录</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
}

function LoadingRows() { return <div className="flex flex-col gap-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div> }
function editSession(session: Session) { window.dispatchEvent(new CustomEvent('mssh:edit-session', { detail: session })) }
function editFolder(folder: Folder) { window.dispatchEvent(new CustomEvent('mssh:edit-folder', { detail: folder })) }
