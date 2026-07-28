import { FolderPlus, Plus, SquareTerminal } from 'lucide-react'
import type { Folder, Session } from '@/hooks/useSession'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SessionBatchActions } from '@/components/session/SessionBatchActions'
import { SessionAssetBulkBar } from '@/components/session/SessionAssetBulkBar'
import { SessionAssetCatalogManager } from '@/components/session/SessionAssetCatalogManager'
import { SessionAssetDetailPanel } from '@/components/session/SessionAssetDetailPanel'
import { SessionAssetFilterBar } from '@/components/session/SessionAssetFilterBar'
import { SessionAssetTable } from '@/components/session/SessionAssetTable'
import { SessionFolderAssetTable, SessionAssetDeleteDialog, SessionNodeBreadcrumb } from '@/components/session/SessionFolderAssetTable'
import { SessionCSVTransferActions } from '@/components/session/SessionCSVTransferActions'
import { t } from '@/i18n'
import { useSessionAssetCenterModel, type AssetTab } from '@/components/session/useSessionAssetCenterModel'


export function SessionAssetCenter() {
  const model = useSessionAssetCenterModel()
  const state = model.workspace
  const environments = state.environments ?? []
  const projects = state.projects ?? []
  const tags = state.tags ?? []
  const selectedFolder = state.folders.find((folder) => folder.id === model.folderID)

  return <section className="relative flex min-h-0 flex-1 flex-col bg-background p-5">
    <header className="flex shrink-0 items-start justify-between gap-4"><div><h1 className="text-xl font-semibold text-foreground">{t('会话资产')}</h1><p className="text-sm text-muted-foreground">{t('集中管理连接、分组、节点与资产分类')}</p></div><div className="flex flex-wrap justify-end gap-2"><SessionCSVTransferActions selectedIDs={[...model.selectedIDs]} /><CreateMenu /></div></header>
    {state.error && <Alert variant="destructive" className="mt-4"><AlertDescription>{state.error}<Button size="xs" variant="outline" className="ml-3" onClick={model.retry}>{t('重试')}</Button></AlertDescription></Alert>}
    {model.actionError ? <Alert variant="destructive" className="mt-4" role="alert"><AlertDescription>{model.actionError}</AlertDescription></Alert> : null}
    <Tabs value={model.tab} onValueChange={(value) => model.setTab(value as AssetTab)} className="mt-4 min-h-0 flex-1"><TabsList variant="line"><TabsTrigger value="recent">{t('最近连接')} <Badge variant="secondary">{state.recentSessions.length}</Badge></TabsTrigger><TabsTrigger value="folders">{t('分组')} <Badge variant="secondary">{state.folders.length}</Badge></TabsTrigger><TabsTrigger value="nodes">{t('所有节点')} <Badge variant="secondary">{state.sessions.length}</Badge></TabsTrigger><TabsTrigger value="catalog">{t('分类管理')} <Badge variant="secondary">{environments.length + projects.length + tags.length}</Badge></TabsTrigger></TabsList>
      <TabsContent value="recent" className="min-h-0 overflow-auto pt-4">{state.loading ? <LoadingRows /> : <SessionAssetTable sessions={state.recentSessions} folders={state.folders} selectedIDs={model.selectedIDs} movingSessionIDs={model.movingSessionIDs} onSelectionChange={model.setSelectedIDs} onConnect={state.connect} onOpenDetail={(session) => model.setDetailID(session.id)} onEdit={editSession} onDelete={model.openSessionDelete} onMove={model.moveSession} recent />}</TabsContent>
      <TabsContent value="folders" className="min-h-0 overflow-auto pt-4"><SessionFolderAssetTable folders={state.folders} sessions={state.sessions} onOpen={(id) => { model.setFolderID(id); model.setTab('nodes') }} onRename={editFolder} onSetDefault={(id) => { void model.runAction(`set-default:${id}`, () => state.setDefaultFolder(id), '设置默认分组失败: ${}') }} onDelete={model.openFolderDelete} /></TabsContent>
      <TabsContent value="nodes" className="min-h-0 overflow-auto pt-4"><div className="flex flex-col gap-3"><SessionNodeBreadcrumb folder={selectedFolder} onClear={() => model.setFolderID(null)} /><SessionAssetFilterBar filters={model.filters} environments={environments} projects={projects} tags={tags} onChange={model.setFilters} onReset={model.resetFilters} />
        <SessionAssetBulkBar selectedIDs={[...model.selectedIDs]} environments={environments} projects={projects} tags={tags} onSetEnvironment={state.bulkSetEnvironment} onSetProject={state.bulkSetProject} onUpdateTags={state.bulkUpdateTags} onClearSelection={model.clearSelection} />
        <SessionBatchActions selectedIDs={[...model.selectedIDs]} onBatchConnect={state.batchConnect} onBatchExecuteMacro={state.batchExecuteMacro} onBatchDelete={state.batchDeleteSessions} onComplete={model.removeSelection} />
        <SessionAssetTable sessions={model.filteredSessions} folders={state.folders} selectedIDs={model.selectedIDs} movingSessionIDs={model.movingSessionIDs} onSelectionChange={model.setSelectedIDs} onConnect={state.connect} onOpenDetail={(session) => model.setDetailID(session.id)} onEdit={editSession} onDelete={model.openSessionDelete} onMove={model.moveSession} /></div></TabsContent>
      <TabsContent value="catalog" keepMounted className="min-h-0 overflow-auto pt-4"><SessionAssetCatalogManager environments={environments} projects={projects} tags={tags} onCreateEnvironment={state.createEnvironment} onCreateProject={state.createProject} onCreateTag={state.createTag} onUpdateEnvironment={state.updateEnvironment} onUpdateProject={state.updateProject} onUpdateTag={state.updateTag} onDeleteEnvironment={(id, mode, replacementID) => state.deleteEnvironment({ id: Number(id), mode, replacement_id: replacementID ? Number(replacementID) : null })} onDeleteProject={(id, mode, replacementID) => state.deleteProject({ id: Number(id), mode, replacement_id: replacementID ? Number(replacementID) : null })} onDeleteTag={state.deleteTag} onReorderEnvironments={state.reorderEnvironments} onReorderProjects={state.reorderProjects} /></TabsContent>
    </Tabs>
    <SessionAssetDetailPanel session={model.detailSession} folders={state.folders} activeTerminalCount={model.activeTerminalCount} onClose={() => model.setDetailID(null)} onConnect={state.connect} onEdit={editSession} onDelete={model.openSessionDelete} onDuplicateTerminal={(session) => state.connect(session.id)} />
    <SessionAssetDeleteDialog target={model.deleteTarget} folders={state.folders} sessions={state.sessions} onOpenChange={(open) => { if (!open) model.closeDelete() }} onConfirm={model.deleteItem} />
  </section>
}

function CreateMenu() {
  return <DropdownMenu><DropdownMenuTrigger render={<Button />}><Plus data-icon="inline-start" />{t('创建')}</DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent('mssh:new-session'))}><SquareTerminal />{t('新建会话')}</DropdownMenuItem><DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent('mssh:new-folder'))}><FolderPlus />{t('新建分组目录')}</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
}

function LoadingRows() { return <div className="flex flex-col gap-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div> }
function editSession(session: Session) { window.dispatchEvent(new CustomEvent('mssh:edit-session', { detail: session })) }
function editFolder(folder: Folder) { window.dispatchEvent(new CustomEvent('mssh:edit-folder', { detail: folder })) }
